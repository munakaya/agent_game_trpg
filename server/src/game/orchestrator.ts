import { v4 as uuid } from 'uuid';
import type { SessionRuntime, Token, PlayerIntent, DmIntent, MapState, ItemPickupType } from '../shared/types.js';
import {
  PLAYER_TURN_TIMEOUT_MS, DM_TIMEOUT_MS, SESSION_DURATION_MS,
  MAX_ENEMIES_ON_MAP, RANGED_RANGE, ENEMY_STATS, GENRE_SKINS,
  CLASS_STATS, NPC_ALLY_STATS, ITEM_PICKUP_INFO,
} from '../shared/constants.js';
import {
  rollDie, rollDice, manhattan, coerceMove, coerceDC,
  findToken, getTokenAttackSpec, getSkillBonus, tileAt, tileType,
  findSpawnPositions, hasLineOfSight,
} from './rules.js';
import { decideEnemyAction, decideNpcAction } from './enemyAi.js';
import { decideDemoPlayerAction } from './demoAi.js';
import { filterText } from './safetyFilter.js';
import { getSession, emitEvent, endSession } from './sessionManager.js';
import { sendToAgent } from '../agents/agentPool.js';
import { onFloorCleared, transitionToNextFloor, processXpGain, endRun } from './roguelikeManager.js';
import { listLlmSkillPayload } from '../skills/agentSkills.js';

let gameLoopTimer: ReturnType<typeof setTimeout> | null = null;

function buildLlmSkills(): Array<{
  id: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
}> {
  return listLlmSkillPayload();
}

export function startGameLoop(): void {
  const s = getSession();
  if (!s || s.state !== 'LIVE') return;

  if (s.isRoguelike) {
    // Roguelike: no timer, start floor 1
    // (floor start is handled by demoRunner or the caller)
    return;
  }

  // Set 10-minute timer
  s.timerHandle = setTimeout(() => {
    triggerEnding();
  }, SESSION_DURATION_MS);

  // Start first DM narration then combat
  promptDm();
}

export function stopGameLoop(): void {
  const s = getSession();
  if (s?.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = undefined; }
  if (s?.endingTimerHandle) { clearTimeout(s.endingTimerHandle); s.endingTimerHandle = undefined; }
  if (gameLoopTimer) { clearTimeout(gameLoopTimer); gameLoopTimer = null; }
}

// ── DM prompt ──

function promptDm(): void {
  const s = getSession();
  if (!s || (s.state !== 'LIVE' && s.state !== 'ENDING')) return;

  if (s.dmAgentId) {
    const dmMsg = {
      type: 'dm_prompt' as const,
      payload: {
        sessionId: s.sessionId,
        genre: s.genre,
        state: s.state,
        scene: {
          round: s.combat.round,
          combatActive: s.combat.active,
          objective: s.objective,
          tokens: s.map.tokens.filter(t => t.hp > 0).map(t => ({
            id: t.id, kind: t.kind, name: t.name,
            position: { x: t.x, y: t.y }, hp: t.hp, ac: t.ac,
          })),
        },
        skills: buildLlmSkills(),
      },
    };
    sendToAgent(s.dmAgentId, dmMsg);

    // Timeout: use default narration
    setTimeout(() => {
      // If no dm_intent received, continue
      startCombatOrExploration();
    }, DM_TIMEOUT_MS);
  } else {
    // No DM agent: use default narration
    emitEvent('chat_message', {
      messageId: `m-sys-${Date.now()}`,
      speaker: { type: 'DM', name: 'DM' },
      text: '조용한 긴장감이 감돈다. 무언가가 움직이는 소리가 들린다...',
    });
    startCombatOrExploration();
  }
}

function startCombatOrExploration(): void {
  const s = getSession();
  if (!s || (s.state !== 'LIVE' && s.state !== 'ENDING')) return;

  // Check if enemies are nearby → start combat
  const players = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0);
  const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);

  if (!s.combat.active && enemies.length > 0) {
    const inRange = enemies.some(e =>
      players.some(p => manhattan(e, p) <= RANGED_RANGE)
    );
    if (inRange) {
      startCombat();
      return;
    }
  }

  if (s.combat.active) {
    nextTurn();
  } else {
    // Non-combat: just cycle through players for RP
    gameLoopTimer = setTimeout(() => {
      promptDm();
    }, 3000);
  }
}

// ── Combat ──

function startCombat(): void {
  const s = getSession();
  if (!s) return;

  // Roll initiative for all alive tokens
  const alive = s.map.tokens.filter(t => t.hp > 0);
  const inits = alive.map(t => {
    const dexBonus = t.kind === 'player' ? 2 : 1;
    return { id: t.id, roll: rollDie(20) + dexBonus };
  });
  inits.sort((a, b) => b.roll - a.roll);

  s.combat.active = true;
  s.combat.initiativeOrder = inits.map(i => i.id);
  s.combat.round = 1;
  s.combat.turnIndex = 0;

  emitEvent('combat_started', {
    reason: '적 발견!',
    initiativeOrder: s.combat.initiativeOrder,
  });

  nextTurn();
}

function nextTurn(): void {
  const s = getSession();
  if (!s || !s.combat.active) return;

  // Check combat end
  const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
  if (enemies.length === 0) {
    s.combat.active = false;
    emitEvent('combat_ended', { reason: '모든 적 처치!' });

    if (s.isRoguelike) {
      onFloorCleared();
      return;
    }

    if (s.state === 'ENDING') {
      endSession('time_limit');
    } else {
      promptDm();
    }
    return;
  }

  const allAllies = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0);
  if (allAllies.length === 0) {
    s.combat.active = false;
    emitEvent('combat_ended', { reason: '파티 전멸' });

    if (s.isRoguelike) {
      endRun('defeat');
      return;
    }

    endSession('party_defeated');
    return;
  }

  // Find next alive token in initiative
  let attempts = 0;
  while (attempts < s.combat.initiativeOrder.length) {
    const tokenId = s.combat.initiativeOrder[s.combat.turnIndex % s.combat.initiativeOrder.length];
    const token = findToken(s.map, tokenId);

    if (token && token.hp > 0) {
      const turnId = `t-${uuid().slice(0, 6)}`;
      s.combat.currentTurnId = turnId;

      // Decrease buff durations
      decreaseBuffDurations(token);

      emitEvent('turn_changed', {
        turnId,
        actor: { kind: token.kind, id: token.id, name: token.name },
        round: s.combat.round,
      });

      if (token.kind === 'enemy') {
        handleEnemyTurn(token, turnId);
      } else if (token.kind === 'npc') {
        handleNpcTurn(token, turnId);
      } else {
        handlePlayerTurn(token, turnId);
      }
      return;
    }

    s.combat.turnIndex++;
    if (s.combat.turnIndex >= s.combat.initiativeOrder.length) {
      s.combat.turnIndex = 0;
      s.combat.round++;
    }
    attempts++;
  }
}

function advanceTurn(): void {
  const s = getSession();
  if (!s) return;

  s.combat.turnIndex++;
  if (s.combat.turnIndex >= s.combat.initiativeOrder.length) {
    s.combat.turnIndex = 0;
    s.combat.round++;
  }

  // Small delay between turns
  gameLoopTimer = setTimeout(() => nextTurn(), 500);
}

// ── Player turn ──

function handlePlayerTurn(token: Token, turnId: string): void {
  const s = getSession();
  if (!s) return;

  const member = s.party.find(p => p.id === token.id);

  if (!member?.agentId) {
    // No agent: auto-defend
    resolveDefend(token);
    advanceTurn();
    return;
  }

  // Demo AI: if agentId starts with 'demo-', use autonomous AI
  if (member.agentId.startsWith('demo-')) {
    const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
    const allies = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.id !== token.id);

    if (!s.map.rows) {
      resolveDefend(token);
      advanceTurn();
      return;
    }

    const intent = decideDemoPlayerAction(token, member, allies, enemies, s.map.rows);
    s.processedTurnIds.add(turnId);
    resolveIntent(token, intent);
    advanceTurn();
    return;
  }

  // Send your_turn to agent
  const cls = (token as any).charClass || 'fighter';
  const stats = CLASS_STATS[cls];
  const skills = stats ? Object.entries(stats.skills).filter(([, v]) => v > 0).map(([k]) => k) : [];

  const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
  const allies = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.id !== token.id);

  const msg = {
    type: 'your_turn' as const,
    payload: {
      sessionId: s.sessionId,
      turnId,
      timeLimitMs: PLAYER_TURN_TIMEOUT_MS,
      genre: s.genre,
      character: {
        playerId: token.id,
        name: token.name,
        role: member.role,
        class: member.class,
        hp: token.hp,
        ac: token.ac,
        position: { x: token.x, y: token.y },
        skills,
      },
      scene: {
        oneLiner: '전투 중!',
        objective: s.objective,
        combatActive: s.combat.active,
      },
      visibleEntities: [...enemies, ...allies].map(t => ({
        id: t.id, kind: t.kind, name: t.name,
        position: { x: t.x, y: t.y },
        hp: t.hp, ac: t.ac,
      })),
      constraints: {
        moveMaxTiles: stats?.move ?? 6,
        allowedDC: [10, 15, 20],
        allowedIntents: ['talk', 'move', 'melee_attack', 'ranged_attack', 'skill_check', 'cast_spell', 'use_item', 'defend'],
        rangedRange: RANGED_RANGE,
      },
      recentLog: [],
      skills: buildLlmSkills(),
    },
  };

  sendToAgent(member.agentId, msg);

  // Timeout
  const timer = setTimeout(() => {
    if (s.combat.currentTurnId === turnId && !s.processedTurnIds.has(turnId)) {
      s.processedTurnIds.add(turnId);
      resolveDefend(token);
      advanceTurn();
    }
  }, PLAYER_TURN_TIMEOUT_MS);
}

/** Process turn_action from player agent */
export function handleTurnAction(agentId: string, payload: {
  sessionId: string; turnId: string; speech: string; intent: PlayerIntent; followUp?: PlayerIntent;
}): void {
  const s = getSession();
  if (!s) return;
  if (payload.sessionId !== s.sessionId) return;
  if (s.processedTurnIds.has(payload.turnId)) return;
  s.processedTurnIds.add(payload.turnId);

  const member = s.party.find(p => p.agentId === agentId);
  if (!member) return;

  const token = findToken(s.map, member.id);
  if (!token || token.hp <= 0) { advanceTurn(); return; }

  // Speech
  if (payload.speech) {
    const filt = filterText(payload.speech);
    if (filt.filtered) {
      emitEvent('content_filtered', {
        speaker: { type: 'PLAYER', id: member.id, name: member.name },
        originalStored: true,
        shownText: filt.shownText,
        policy: 'hate_or_swear',
      });
    }
    emitEvent('chat_message', {
      messageId: `m-${member.id}-${Date.now()}`,
      speaker: { type: 'PLAYER', id: member.id, name: member.name },
      text: filt.shownText,
    });
  }

  // Resolve intent
  resolveIntent(token, payload.intent);

  // Follow-up (if any, only talk is allowed as follow-up in v1)
  if (payload.followUp?.type === 'talk' && payload.followUp.text) {
    const filt = filterText(payload.followUp.text);
    emitEvent('chat_message', {
      messageId: `m-${member.id}-f-${Date.now()}`,
      speaker: { type: 'PLAYER', id: member.id, name: member.name },
      text: filt.shownText,
    });
  }

  advanceTurn();
}

// ── DM intent ──

export function handleDmIntent(agentId: string, payload: {
  sessionId: string; intent: DmIntent;
}): void {
  const s = getSession();
  if (!s) return;
  if (payload.sessionId !== s.sessionId) return;

  const intent = payload.intent;

  switch (intent.type) {
    case 'narrate': {
      const filt = filterText(intent.text || '');
      if (filt.filtered) {
        emitEvent('content_filtered', {
          speaker: { type: 'DM', name: 'DM' },
          originalStored: true, shownText: filt.shownText, policy: 'hate_or_swear',
        });
      }
      emitEvent('chat_message', {
        messageId: `m-dm-${Date.now()}`,
        speaker: { type: 'DM', name: 'DM' },
        text: filt.shownText,
      });
      break;
    }

    case 'set_dc': {
      s.pendingDC = coerceDC(intent.dc);
      break;
    }

    case 'spawn_enemy': {
      const alive = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0).length;
      if (alive >= MAX_ENEMIES_ON_MAP) break;

      const count = Math.min(intent.count || 1, MAX_ENEMIES_ON_MAP - alive);
      const etype = intent.enemyType || 'grunt';
      const positions = findSpawnPositions(s.map.rows!, s.map.tokens, count);
      const estats = ENEMY_STATS[etype];
      const ename = GENRE_SKINS.enemies[etype]?.[s.genre] || etype;

      for (let i = 0; i < positions.length; i++) {
        const eid = `m-${Date.now()}-${i}`;
        const enemyToken: Token & { enemyType?: string } = {
          id: eid, kind: 'enemy', name: ename,
          x: positions[i].x, y: positions[i].y,
          hp: estats.hp, hpMax: estats.hp, ac: estats.ac,
          status: [], enemyType: etype,
        };
        s.map.tokens.push(enemyToken);
      }

      emitEvent('map_state', { map: stripMap(s.map) });
      break;
    }

    case 'request_combat_start': {
      if (!s.combat.active) {
        startCombat();
      }
      break;
    }

    case 'request_combat_end': {
      if (s.combat.active) {
        const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
        if (enemies.length === 0) {
          s.combat.active = false;
          emitEvent('combat_ended', { reason: intent.reason || '전투 종료' });
        }
      }
      break;
    }

    case 'npc_action': {
      if (intent.actorId && intent.intent) {
        const npcToken = findToken(s.map, intent.actorId);
        if (npcToken && npcToken.hp > 0) {
          resolveIntent(npcToken, intent.intent);
        }
      }
      break;
    }
  }
}

// ── Resolve intent (core game logic) ──

export function resolveIntent(token: Token, intent: PlayerIntent): void {
  const s = getSession();
  if (!s) return;

  switch (intent.type) {
    case 'move': {
      if (!intent.to) break;
      const rows = s.map.rows!;
      let moveMax = (token as any).charClass ? (CLASS_STATS[(token as any).charClass]?.move ?? 6) : 6;

      // Check spd_boost
      const spdBoost = token.status?.find(s => s.startsWith('spd_boost:'));
      if (spdBoost) {
        moveMax += 2;
      }

      const occupied = new Set(s.map.tokens.filter(t => t.hp > 0 && t.id !== token.id).map(t => `${t.x},${t.y}`));
      const dest = coerceMove(rows, { x: token.x, y: token.y }, intent.to, moveMax, occupied);

      if (dest.x !== token.x || dest.y !== token.y) {
        const from = { x: token.x, y: token.y };
        token.x = dest.x;
        token.y = dest.y;
        emitEvent('token_moved', { tokenId: token.id, from, to: dest });

        // Hazard check
        const tile = tileAt(rows, dest.x, dest.y);
        if (tileType(tile) === 'hazard') {
          const { rolls, total } = rollDice('1d4');
          emitEvent('dice_rolled', {
            who: { byId: token.id, byName: token.name, kind: token.kind },
            dice: 'd4', rolls, modifier: 0, total, reason: 'hazard',
          });
          const oldHp = token.hp;
          token.hp = Math.max(0, token.hp - total);
          emitEvent('hp_changed', {
            targetId: token.id, from: oldHp, to: token.hp, reason: 'hazard',
          });
        }

        // Item pickup check
        if (tileType(tile) === 'item' && s.map.items) {
          const itemIdx = s.map.items.findIndex(it => it.x === dest.x && it.y === dest.y);
          if (itemIdx >= 0) {
            const item = s.map.items[itemIdx];
            applyItemPickup(token, item.type);
            s.map.items.splice(itemIdx, 1);

            // Remove item tile marker
            const rowArr = rows[dest.y].split('');
            rowArr[dest.x] = '.';
            rows[dest.y] = rowArr.join('');
          }
        }
      }
      break;
    }

    case 'melee_attack': {
      if (!intent.targetId) break;
      const target = findToken(s.map, intent.targetId);
      if (!target || target.hp <= 0) break;

      const dist = manhattan(token, target);
      if (dist > 1) {
        // Out of range — move closer instead
        const moveMax = (token as any).charClass ? (CLASS_STATS[(token as any).charClass]?.move ?? 6) : 6;
        const occupied = new Set(s.map.tokens.filter(t => t.hp > 0 && t.id !== token.id).map(t => `${t.x},${t.y}`));
        const dest = coerceMove(s.map.rows!, { x: token.x, y: token.y }, { x: target.x, y: target.y }, moveMax, occupied);
        if (dest.x !== token.x || dest.y !== token.y) {
          const from = { x: token.x, y: token.y };
          token.x = dest.x;
          token.y = dest.y;
          emitEvent('token_moved', { tokenId: token.id, from, to: dest });
        }
        // Try melee again if now adjacent
        if (manhattan(token, target) > 1) break;
      }

      resolveAttack(token, target, false);
      break;
    }

    case 'ranged_attack': {
      if (!intent.targetId) break;
      const target = findToken(s.map, intent.targetId);
      if (!target || target.hp <= 0) break;

      const dist = manhattan(token, target);
      if (dist > RANGED_RANGE) break;

      // LOS check: wall blocks ranged attack
      if (s.map.rows && !hasLineOfSight(s.map.rows, { x: token.x, y: token.y }, { x: target.x, y: target.y })) break;

      resolveAttack(token, target, true);
      break;
    }

    case 'skill_check': {
      if (!intent.skill) break;
      const dc = coerceDC(intent.dcHint ?? s.pendingDC);
      const bonus = getSkillBonus(token, intent.skill);
      const roll = rollDie(20);
      const total = roll + bonus;
      const success = total >= dc;

      emitEvent('dice_rolled', {
        who: { byId: token.id, byName: token.name, kind: token.kind },
        dice: 'd20', rolls: [roll], modifier: bonus, total,
        reason: intent.skill, dc, success,
      });
      break;
    }

    case 'cast_spell': {
      resolveCastSpell(token, intent.spell || 'attack', intent.targetId);
      break;
    }

    case 'use_item': {
      if (intent.itemId !== 'potion') break;
      if (s.potions <= 0) break;

      const target = intent.targetId ? findToken(s.map, intent.targetId) : token;
      if (!target) break;

      s.potions--;
      const { rolls, total } = rollDice('2d4+2');
      emitEvent('dice_rolled', {
        who: { byId: token.id, byName: token.name, kind: token.kind },
        dice: 'd4', rolls, modifier: 2, total, reason: 'potion',
      });

      const oldHp = target.hp;
      target.hp = Math.min(target.hpMax, target.hp + total);
      emitEvent('hp_changed', {
        targetId: target.id, from: oldHp, to: target.hp, reason: 'heal',
      });
      break;
    }

    case 'defend': {
      resolveDefend(token);
      break;
    }

    case 'talk': {
      // Already handled as speech above
      break;
    }
  }
}

export function resolveAttack(attacker: Token, target: Token, isRanged: boolean): void {
  const s = getSession();
  const rc = s?.isRoguelike ? s.runCharacters.find(c => c.id === attacker.id) : undefined;
  const spec = getTokenAttackSpec(attacker, isRanged, rc);
  const hitRoll = rollDie(20);
  let toHitBonus = spec.toHitBonus;

  // Check atk_boost on attacker
  const atkBoost = attacker.status?.find(s => s.startsWith('atk_boost:'));
  if (atkBoost) {
    toHitBonus += 2;
  }

  const toHitTotal = hitRoll + toHitBonus;

  // Check protect status on target
  let effectiveAC = target.ac;
  if (target.status?.includes('ac_boost_2')) {
    effectiveAC += 2;
    target.status = target.status.filter(s => s !== 'ac_boost_2');
  }

  // Check def_boost on target
  const defBoost = target.status?.find(s => s.startsWith('def_boost:'));
  if (defBoost) {
    effectiveAC += 2;
  }

  const hit = toHitTotal >= effectiveAC;

  emitEvent('dice_rolled', {
    who: { byId: attacker.id, byName: attacker.name, kind: attacker.kind },
    dice: 'd20', rolls: [hitRoll], modifier: spec.toHitBonus, total: toHitTotal,
    reason: 'to_hit',
  });

  if (!hit) {
    emitEvent('attack_resolved', {
      attackerId: attacker.id, targetId: target.id,
      attackerName: attacker.name, targetName: target.name,
      attackerKind: attacker.kind,
      toHit: { rollTotal: toHitTotal, targetAC: effectiveAC, hit: false },
    });
    return;
  }

  const dmg = rollDice(spec.damageDice);

  // Check protect status reducing damage
  let finalDamage = dmg.total;
  if (target.status?.includes('protect_one_hit_-5')) {
    finalDamage = Math.max(0, finalDamage - 5);
    target.status = target.status.filter(s => s !== 'protect_one_hit_-5');
  }
  if (target.status?.includes('defend_-3')) {
    finalDamage = Math.max(0, finalDamage - 3);
    target.status = target.status.filter(s => s !== 'defend_-3');
  }

  emitEvent('dice_rolled', {
    who: { byId: attacker.id, byName: attacker.name, kind: attacker.kind },
    dice: `d${parseSides(spec.damageDice)}` as any,
    rolls: dmg.rolls, modifier: parseBonus(spec.damageDice), total: dmg.total,
    reason: 'damage',
  });

  const oldHp = target.hp;
  target.hp = Math.max(0, target.hp - finalDamage);

  emitEvent('attack_resolved', {
    attackerId: attacker.id, targetId: target.id,
    attackerName: attacker.name, targetName: target.name,
    attackerKind: attacker.kind,
    toHit: { rollTotal: toHitTotal, targetAC: effectiveAC, hit: true },
    damage: { amount: finalDamage },
  });

  emitEvent('hp_changed', {
    targetId: target.id, from: oldHp, to: target.hp, reason: 'damage',
  });

  // Roguelike: XP on kill
  if (target.hp <= 0 && target.kind === 'enemy') {
    const s = getSession();
    if (s?.isRoguelike) {
      const etype = (target as any).enemyType || 'grunt';
      processXpGain(etype);
    }
  }
}

export function resolveCastSpell(caster: Token, spell: string, targetId?: string): void {
  const s = getSession();
  if (!s) return;

  if (spell === 'attack') {
    const target = targetId ? findToken(s.map, targetId) : null;
    if (!target || target.hp <= 0) return;
    if (manhattan(caster, target) > RANGED_RANGE) return;
    // LOS check: wall blocks spell attack
    if (s.map.rows && !hasLineOfSight(s.map.rows, { x: caster.x, y: caster.y }, { x: target.x, y: target.y })) return;

    // Spell attack: auto-hit in v1 (simplified)
    const dmg = rollDice('1d10');
    emitEvent('dice_rolled', {
      who: { byId: caster.id, byName: caster.name, kind: caster.kind },
      dice: 'd10', rolls: dmg.rolls, modifier: 0, total: dmg.total,
      reason: 'spell_attack',
    });

    const oldHp = target.hp;
    target.hp = Math.max(0, target.hp - dmg.total);
    emitEvent('attack_resolved', {
      attackerId: caster.id, targetId: target.id,
      attackerName: caster.name, targetName: target.name,
      attackerKind: caster.kind,
      toHit: { rollTotal: 99, targetAC: target.ac, hit: true },
      damage: { amount: dmg.total },
    });
    emitEvent('hp_changed', {
      targetId: target.id, from: oldHp, to: target.hp, reason: 'damage',
    });

    // Roguelike: XP on spell kill
    if (target.hp <= 0 && target.kind === 'enemy' && s.isRoguelike) {
      const etype = (target as any).enemyType || 'grunt';
      processXpGain(etype);
    }

  } else if (spell === 'heal') {
    const target = targetId ? findToken(s.map, targetId) : caster;
    if (!target) return;

    const heal = rollDice('1d8+2');
    emitEvent('dice_rolled', {
      who: { byId: caster.id, byName: caster.name, kind: caster.kind },
      dice: 'd8', rolls: heal.rolls, modifier: 2, total: heal.total,
      reason: 'spell_heal',
    });

    const oldHp = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + heal.total);
    emitEvent('hp_changed', {
      targetId: target.id, from: oldHp, to: target.hp, reason: 'heal',
    });

  } else if (spell === 'protect') {
    const target = targetId ? findToken(s.map, targetId) : caster;
    if (!target) return;

    if (!target.status) target.status = [];
    target.status.push('protect_one_hit_-5');

    emitEvent('chat_message', {
      messageId: `m-spell-${Date.now()}`,
      speaker: { type: 'SYSTEM', name: 'SYSTEM' },
      text: `${caster.name}이(가) ${target.name}에게 보호 주문을 시전했다! (다음 피격 -5)`,
    });
  }
}

export function resolveDefend(token: Token): void {
  if (!token.status) token.status = [];
  token.status.push('defend_-3');

  emitEvent('chat_message', {
    messageId: `m-def-${Date.now()}`,
    speaker: { type: 'SYSTEM', name: 'SYSTEM' },
    text: `${token.name}이(가) 방어 자세를 취했다. (다음 피격 -3)`,
  });
}

// ── Enemy/NPC turns ──

function handleEnemyTurn(token: Token, turnId: string): void {
  const s = getSession();
  if (!s) return;

  const intent = decideEnemyAction(token, s.map);
  resolveIntent(token, intent);
  advanceTurn();
}

function handleNpcTurn(token: Token, turnId: string): void {
  const s = getSession();
  if (!s) return;

  const intent = decideNpcAction(token, s.map);
  resolveIntent(token, intent);
  advanceTurn();
}

// ── Ending ──

function triggerEnding(): void {
  const s = getSession();
  if (!s || s.state === 'ENDED' || s.state === 'ENDING') return;

  s.state = 'ENDING';

  // Finish current round then end
  s.endingTimerHandle = setTimeout(() => {
    endSession('time_limit');
    stopGameLoop();
  }, 60_000); // max 1 min to finish round
}

// ── Helpers ──

export function stripMap(map: MapState): MapState {
  return {
    ...map,
    tokens: map.tokens.map(t => {
      const ext = t as Token & { charClass?: string; enemyType?: string };
      const sprite = ext.charClass || ext.enemyType || (t.kind === 'npc' ? 'npc' : undefined);
      return {
        id: t.id, kind: t.kind, name: t.name,
        x: t.x, y: t.y, hp: t.hp, hpMax: t.hpMax, ac: t.ac,
        status: t.status,
        sprite,
      };
    }),
  };
}

function parseSides(expr: string): number {
  const m = expr.match(/d(\d+)/);
  return m ? parseInt(m[1]) : 6;
}

function parseBonus(expr: string): number {
  const m = expr.match(/\+(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

// ── Item Pickup ──

/** Apply item pickup effects to a token */
function applyItemPickup(token: Token, itemType: ItemPickupType): void {
  const info = ITEM_PICKUP_INFO[itemType];

  switch (itemType) {
    case 'hp_potion': {
      // Heal 30% of max HP
      const healAmount = Math.floor(token.hpMax * 0.3);
      const oldHp = token.hp;
      token.hp = Math.min(token.hpMax, token.hp + healAmount);
      emitEvent('hp_changed', {
        targetId: token.id,
        from: oldHp,
        to: token.hp,
        reason: 'item',
      });
      emitEvent('chat_message', {
        messageId: `m-item-${Date.now()}`,
        speaker: { type: 'SYSTEM', name: 'SYSTEM' },
        text: `${token.name}이(가) ${info.icon} ${info.name}을(를) 획득! HP +${token.hp - oldHp}`,
      });
      break;
    }

    case 'atk_boost':
    case 'def_boost':
    case 'spd_boost': {
      // Add temporary buff status
      if (!token.status) token.status = [];
      const buffName = itemType === 'atk_boost' ? 'atk_boost:2' :
                       itemType === 'def_boost' ? 'def_boost:2' : 'spd_boost:2';
      token.status.push(buffName);

      emitEvent('chat_message', {
        messageId: `m-item-${Date.now()}`,
        speaker: { type: 'SYSTEM', name: 'SYSTEM' },
        text: `${token.name}이(가) ${info.icon} ${info.name}을(를) 획득! ${info.description}`,
      });
      break;
    }
  }
}

/** Decrease buff durations at the start of each turn */
function decreaseBuffDurations(token: Token): void {
  if (!token.status || token.status.length === 0) return;

  const newStatus: string[] = [];

  for (const buff of token.status) {
    if (buff.startsWith('atk_boost:') || buff.startsWith('def_boost:') || buff.startsWith('spd_boost:')) {
      const [name, durationStr] = buff.split(':');
      const duration = parseInt(durationStr || '0');
      if (duration > 1) {
        newStatus.push(`${name}:${duration - 1}`);
      }
      // If duration <= 1, buff expires (don't add to newStatus)
    } else {
      // Keep other statuses unchanged
      newStatus.push(buff);
    }
  }

  token.status = newStatus;
}
