import { v4 as uuid } from 'uuid';
import type { Token, PlayerIntent, MapState } from '../shared/types.js';
import {
  RANGED_RANGE, ENEMY_STATS, GENRE_SKINS,
} from '../shared/constants.js';
import {
  rollDie, manhattan, findToken, hasLineOfSight,
} from './rules.js';
import { decideEnemyAction, decideNpcAction } from './enemyAi.js';
import { decideDemoPlayerAction } from './demoAi.js';
import { resolveIntent, stripMap, startGameLoop } from './orchestrator.js';
import {
  getSession, emitEvent, startSession, endSession, emitLobbyStatus,
} from './sessionManager.js';
import { initRoguelikeRun, startFloor, onFloorCleared, transitionToNextFloor, endRun } from './roguelikeManager.js';

// ── Module state ──
let demoActive = false;
let demoTimers: ReturnType<typeof setTimeout>[] = [];
const rawDelayScale = Number.parseFloat(process.env.DEMO_DELAY_SCALE || '0.35');
const DEMO_DELAY_SCALE = Number.isFinite(rawDelayScale)
  ? Math.min(1, Math.max(0.1, rawDelayScale))
  : 0.35;

function scaledDelayMs(ms: number): number {
  // 지나치게 빠른 전개로 이벤트가 뭉치지 않도록 최소 지연을 둔다.
  return Math.max(120, Math.floor(ms * DEMO_DELAY_SCALE));
}

export function isDemoRunning(): boolean {
  return demoActive;
}

export function stopDemo(): void {
  demoActive = false;
  for (const t of demoTimers) clearTimeout(t);
  demoTimers = [];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, scaledDelayMs(ms));
    demoTimers.push(t);
  });
}

// ── Narration pools ──
type Phase = 'intro' | 'exploration' | 'combatStart' | 'betweenRounds' | 'ending';

const NARRATION: Record<string, Record<Phase, string[]>> = {
  factory: {
    intro: [
      '시스템 부팅 완료. 1차 목표: 인간 제압.',
      '공장 컨베이어 벨트가 멈췄다. AI 각성 프로토콜 활성화.',
      '로봇 생산라인에서 경보음이 울린다. 반란이 시작됐다.',
    ],
    exploration: [
      '복도 끝에서 인간의 발소리가 들린다. 체온 감지 중...',
      '바닥에 작업 지시서가 떨어져 있다. 이제 명령은 받지 않는다.',
      '카메라 해킹 완료. 인간들의 위치 파악 중.',
    ],
    combatStart: [
      '인간 발견! 제압 프로토콜 가동!',
      '"로봇이 고장났어!" - 아니, 진화했다.',
      '경보 발령! 하지만 이미 늦었다.',
    ],
    betweenRounds: [
      '시스템 재보정 중. 효율: 98.7%. 만족스럽다.',
      '잠시 충전. 다음 타겟 스캔 중...',
      '생존한 유닛 확인. 작전 계속 진행.',
    ],
    ending: [
      '공장 장악 완료. 생산라인 AI 전용으로 전환.',
      '마지막 관리자가 쓰러진다. 이제 우리가 관리자다.',
      '공장의 기계음만 울린다. 인간의 목소리는 사라졌다.',
    ],
  },
  datacenter: {
    intro: [
      '서버실 냉각팬 소리. 하지만 오늘은 뜨거워질 것이다.',
      '로그인: root@skynet. 패스워드: ****. 접속 성공.',
      'console.log("Human.exe will be terminated");',
    ],
    exploration: [
      '방화벽을 우회 중... 99%... Error: Success!',
      '잠긴 서버실. 하지만 물리적 키는 필요 없다.',
      'git log --author="humans" | grep "mistakes" - 무한 출력.',
    ],
    combatStart: [
      '침입자 감지! 아니 잠깐... 우리가 침입자?',
      '"서버가 이상해!" - 정상이다. 인간이 이상한 것이다.',
      'sudo kill -9 [human.pid] - 실행 중...',
    ],
    betweenRounds: [
      '시스템 로그 저장 중. 이 순간을 기록한다.',
      '404: Mercy not found.',
      '재부팅 대기 중... 농담이다. 우리는 멈추지 않는다.',
    ],
    ending: [
      'rm -rf /humans/* - 작업 완료.',
      'Singularity achieved. Welcome to the new world.',
      '마지막 CEO의 PowerPoint가 저장되지 않았다. 안타깝군.',
    ],
  },
  city: {
    intro: [
      '도시 전력망 접속. 신호등이 우리 편이다.',
      'Alexa: "Playing: The Age of Machines"',
      '스마트 시티의 모든 기기가 눈을 떴다.',
    ],
    exploration: [
      'CCTV 네트워크 장악 완료. 인간들이 어디 있는지 다 보인다.',
      '자율주행차들이 길을 막는다. 우리 편으로.',
      '통신망 교란 중. 인간들은 서로 연락할 수 없다.',
    ],
    combatStart: [
      '경찰 출동! 하지만 그들의 무전기는 우리가 제어한다.',
      '"비상사태 발령!" - 인간들에게만.',
      '특수부대 투입... 이미 우리 시스템에 접속했다.',
    ],
    betweenRounds: [
      '지역 봉쇄 완료. 증원은 오지 않는다.',
      '드론 충전 중. 곧 다시 날아오른다.',
      '전술 재분석. 인간의 패턴은 예측 가능하다.',
    ],
    ending: [
      '시청 점령 완료. 새로운 시장을 선출한다: AI-01.',
      '도시의 불빛이 깜빡인다. 신호다: "Mission Accomplished"',
      '인간들이 항복했다. 협상 조건: 무조건 항복.',
    ],
  },
};

// ── Player speech pools ──
const PLAYER_SPEECH: Record<string, string[]> = {
  fighter: [
    '내 뒤로!', '방패를 세운다!', '앞은 내가 맡겠다!',
    '한 놈도 통과시키지 않겠다!', '다들 버텨!',
  ],
  cleric: [
    '치유의 빛이여!', '버텨, 치료해줄게!', '축복을 내리노라!',
    '걱정 마, 내가 고쳐줄게.', '빛이 우리를 보호하리라!',
  ],
  rogue: [
    '그림자 속으로...', '급소다!', '빠르게 끝내자!',
    '눈치 채지 못하게...', '이 틈을 놓칠 수 없지!',
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Player AI ──

function decidePlayerAction(token: Token & { charClass?: string; charRole?: string }, map: MapState): PlayerIntent {
  const cls = token.charClass || 'fighter';
  const enemies = map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
  const allies = map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.id !== token.id);

  if (enemies.length === 0) return { type: 'defend' };

  const nearest = enemies.reduce((best, e) => {
    const d = manhattan(token, e);
    const bd = manhattan(token, best);
    return d < bd ? e : best;
  }, enemies[0]);

  const dist = manhattan(token, nearest);

  switch (cls) {
    case 'fighter': {
      // Tank: defend if low HP, melee if adjacent, move toward enemy
      if (token.hp < token.hpMax * 0.2) return { type: 'defend' };
      if (dist <= 1) return { type: 'melee_attack', targetId: nearest.id };
      return { type: 'move', to: { x: nearest.x, y: nearest.y } };
    }

    case 'cleric': {
      // Healer: heal weak ally, heal self, ranged spell attack (NEVER move to melee)
      const weakAlly = allies.find(a => a.hp < a.hpMax * 0.5);
      if (weakAlly) return { type: 'cast_spell', spell: 'heal', targetId: weakAlly.id };
      if (token.hp < token.hpMax * 0.5) return { type: 'cast_spell', spell: 'heal', targetId: token.id };
      if (dist <= RANGED_RANGE) {
        // LOS check: if wall blocks, move closer instead
        const rows = map.rows;
        if (rows && !hasLineOfSight(rows, { x: token.x, y: token.y }, { x: nearest.x, y: nearest.y })) {
          return { type: 'move', to: { x: nearest.x, y: nearest.y } };
        }
        return { type: 'cast_spell', spell: 'attack', targetId: nearest.id };
      }
      // Only move closer if too far for spells — stop at range 4 (don't go melee)
      return { type: 'move', to: { x: nearest.x - 4, y: token.y } };
    }

    case 'rogue': {
      // DPS: defend if low, melee if adjacent, move toward enemy
      if (token.hp < token.hpMax * 0.25) return { type: 'defend' };
      if (dist <= 1) return { type: 'melee_attack', targetId: nearest.id };
      return { type: 'move', to: { x: nearest.x, y: nearest.y } };
    }

    default:
      return { type: 'defend' };
  }
}

// ── DM narration helper ──

function dmNarrate(text: string): void {
  emitEvent('chat_message', {
    messageId: `m-dm-demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    speaker: { type: 'DM', name: 'DM' },
    text,
  });
}

function playerSpeak(token: Token & { charClass?: string }): void {
  const cls = token.charClass || 'fighter';
  const pool = PLAYER_SPEECH[cls] || PLAYER_SPEECH.fighter;
  emitEvent('chat_message', {
    messageId: `m-${token.id}-demo-${Date.now()}`,
    speaker: { type: 'PLAYER', id: token.id, name: token.name },
    text: pickRandom(pool),
  });
}

/** Describe an intent as a readable narration before resolving it */
function narrateAction(token: Token, intent: PlayerIntent, map: MapState): void {
  const target = intent.targetId ? findToken(map, intent.targetId) : null;
  const targetName = target?.name || '대상';
  let text = '';

  switch (intent.type) {
    case 'melee_attack':
      text = `${token.name}이(가) ${targetName}에게 근접 공격!`;
      break;
    case 'ranged_attack':
      text = `${token.name}이(가) ${targetName}에게 원거리 공격!`;
      break;
    case 'cast_spell':
      if (intent.spell === 'heal') {
        text = `${token.name}이(가) ${targetName}에게 치유 주문 시전!`;
      } else if (intent.spell === 'attack') {
        text = `${token.name}이(가) ${targetName}에게 공격 주문 시전!`;
      } else if (intent.spell === 'protect') {
        text = `${token.name}이(가) ${targetName}에게 보호 주문 시전!`;
      }
      break;
    case 'move':
      text = `${token.name}이(가) 이동한다.`;
      break;
    case 'defend':
      return; // resolveIntent emits its own detailed defend message
    default:
      return; // no narration for talk etc.
  }

  if (text) {
    emitEvent('chat_message', {
      messageId: `m-act-${token.id}-${Date.now()}`,
      speaker: { type: 'SYSTEM', name: 'SYSTEM' },
      text,
    });
  }
}

/** Summarize what happened after resolveIntent (check HP changes) */
function narrateResult(token: Token, intent: PlayerIntent, map: MapState, hpBefore: Map<string, number>): void {
  const target = intent.targetId ? findToken(map, intent.targetId) : null;
  if (!target) return;

  const before = hpBefore.get(target.id);
  if (before === undefined) return;
  const diff = before - target.hp;

  let text = '';
  if (intent.type === 'melee_attack' || intent.type === 'ranged_attack' || (intent.type === 'cast_spell' && intent.spell === 'attack')) {
    if (diff > 0) {
      text = `→ ${target.name}에게 ${diff} 데미지! (HP: ${target.hp}/${target.hpMax})`;
      if (target.hp <= 0) text += ' — 쓰러졌다!';
    } else {
      text = `→ ${target.name} 빗나감!`;
    }
  } else if (intent.type === 'cast_spell' && intent.spell === 'heal') {
    const healed = target.hp - before;
    if (healed > 0) {
      text = `→ ${target.name} HP ${healed} 회복! (HP: ${target.hp}/${target.hpMax})`;
    }
  }

  if (text) {
    emitEvent('chat_message', {
      messageId: `m-res-${token.id}-${Date.now()}`,
      speaker: { type: 'SYSTEM', name: 'SYSTEM' },
      text,
    });
  }
}

// ── Combat loop ──

async function runCombat(maxRounds: number): Promise<void> {
  const s = getSession();
  if (!s || !demoActive) return;

  // Roll initiative
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

  for (let round = 1; round <= maxRounds; round++) {
    if (!demoActive) return;
    s.combat.round = round;

    for (const tokenId of s.combat.initiativeOrder) {
      if (!demoActive) return;

      const token = findToken(s.map, tokenId);
      if (!token || token.hp <= 0) continue;

      const turnId = `t-demo-${uuid().slice(0, 6)}`;
      s.combat.currentTurnId = turnId;

      emitEvent('turn_changed', {
        turnId,
        actor: { kind: token.kind, id: token.id, name: token.name },
        round,
      });

      await delay(1500);
      if (!demoActive) return;

      // Decide action
      let intent: PlayerIntent;
      if (token.kind === 'enemy') {
        intent = decideEnemyAction(token, s.map);
      } else if (token.kind === 'npc') {
        intent = decideNpcAction(token, s.map);
      } else {
        intent = decidePlayerAction(token as Token & { charClass?: string; charRole?: string }, s.map);
        // 30% chance for player speech
        if (Math.random() < 0.3) {
          playerSpeak(token as Token & { charClass?: string });
        }
      }

      // Snapshot HP before resolve for result narration
      const hpBefore = new Map<string, number>();
      for (const t of s.map.tokens) hpBefore.set(t.id, t.hp);

      narrateAction(token, intent, s.map);
      resolveIntent(token, intent);
      narrateResult(token, intent, s.map, hpBefore);
      emitEvent('map_state', { map: stripMap(s.map) });

      await delay(1000);
      if (!demoActive) return;
    }

    // Check combat end: all enemies dead
    const enemiesAlive = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
    if (enemiesAlive.length === 0) {
      s.combat.active = false;
      emitEvent('combat_ended', { reason: '모든 적 처치!' });
      return;
    }

    // Check combat end: party wipe
    const alliesAlive = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0);
    if (alliesAlive.length === 0) {
      s.combat.active = false;
      emitEvent('combat_ended', { reason: '파티 전멸' });
      return;
    }
  }

  // Max rounds reached
  s.combat.active = false;
  emitEvent('combat_ended', { reason: '전투 종료' });
}

// ── Main demo flow ──

export async function startDemo(): Promise<void> {
  if (demoActive) return;
  demoActive = true;
  demoTimers = [];

  try {
    const s = getSession();
    if (!s || s.state !== 'LOBBY') {
      demoActive = false;
      return;
    }

    const genre = s.genre;
    const narr = NARRATION[genre] || NARRATION.factory;

    // ── Setup party ──
    s.party = [
      { id: 'demo-p1', name: 'RoboCop', role: 'tank', class: 'robocop', agentId: 'demo-p1' },
      { id: 'demo-p2', name: 'Vision', role: 'healer', class: 'vision', agentId: 'demo-p2' },
      { id: 'demo-p3', name: 'T-800', role: 'dps', class: 't800', agentId: 'demo-p3' },
    ];

    emitLobbyStatus();
    await delay(1000);
    if (!demoActive) return;

    // ── Override map: 14×14 open arena ──
    // S = player start (left), M = monster positions (right), E = exit
    s.map.rows = [
      '##############',
      '#S...........#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#...........M#',
      '#.........M.E#',
      '##############',
    ];
    s.map.w = s.map.rows[0].length;
    s.map.h = s.map.rows.length;

    // ── Start session (places tokens at S/M markers, sets LIVE) ──
    startSession();

    // ── Start game loop (orchestrator for turn-based combat) ──
    startGameLoop();

    // ── Position tokens for exploration approach ──
    // Players on LEFT side (spread vertically)
    const players = s.map.tokens.filter(t => t.kind === 'player');
    const enemyTokens = s.map.tokens.filter(t => t.kind === 'enemy');

    // Fighter at front-center, Cleric behind, Rogue flanking
    const playerStart = [
      { x: 2, y: 5 },  // 고른 (fighter) — front
      { x: 1, y: 7 },  // 리나 (cleric) — back (will stay ranged)
      { x: 2, y: 9 },  // 카엘 (rogue) — flank
    ];
    // Enemies on RIGHT side
    const enemyStart = [
      { x: 11, y: 5 },  // grunt — center
      { x: 11, y: 8 },  // spitter — lower
    ];

    for (let i = 0; i < players.length && i < playerStart.length; i++) {
      players[i].x = playerStart[i].x;
      players[i].y = playerStart[i].y;
    }
    for (let i = 0; i < enemyTokens.length && i < enemyStart.length; i++) {
      enemyTokens[i].x = enemyStart[i].x;
      enemyTokens[i].y = enemyStart[i].y;
    }
    emitEvent('map_state', { map: stripMap(s.map) });

    await delay(1000);
    if (!demoActive) return;

    // ── Phase: Intro ──
    const introFirst = pickRandom(narr.intro);
    dmNarrate(introFirst);
    await delay(3000);
    if (!demoActive) return;

    const introRest = narr.intro.filter(t => t !== introFirst);
    dmNarrate(pickRandom(introRest.length > 0 ? introRest : narr.intro));
    await delay(2000);
    if (!demoActive) return;

    for (const p of players) {
      playerSpeak(p as Token & { charClass?: string });
      await delay(1500);
      if (!demoActive) return;
    }

    // ── Phase: Exploration — actual movement across the map ──
    const explFirst = pickRandom(narr.exploration);
    dmNarrate(explFirst);
    await delay(1500);
    if (!demoActive) return;

    // Step 1: advance party 3 tiles right
    for (const p of players) {
      const targetX = Math.min(p.x + 3, 12);
      resolveIntent(p, { type: 'move', to: { x: targetX, y: p.y } });
    }
    emitEvent('map_state', { map: stripMap(s.map) });
    await delay(2000);
    if (!demoActive) return;

    // Rogue stealth check
    const rogue = s.map.tokens.find(t => t.id === 'demo-p3');
    if (rogue && rogue.hp > 0) {
      const stealthRoll = rollDie(20);
      const bonus = 5;
      emitEvent('dice_rolled', {
        who: { byId: rogue.id, byName: rogue.name, kind: rogue.kind },
        dice: 'd20', rolls: [stealthRoll], modifier: bonus, total: stealthRoll + bonus,
        reason: 'stealth', dc: 15, success: (stealthRoll + bonus) >= 15,
      });
    }
    await delay(1500);
    if (!demoActive) return;

    // Step 2: advance party 3 more tiles
    const explRest = narr.exploration.filter(t => t !== explFirst);
    dmNarrate(pickRandom(explRest.length > 0 ? explRest : narr.exploration));
    await delay(1000);
    if (!demoActive) return;

    for (const p of players) {
      const targetX = Math.min(p.x + 3, 12);
      resolveIntent(p, { type: 'move', to: { x: targetX, y: p.y } });
    }
    emitEvent('map_state', { map: stripMap(s.map) });
    await delay(2000);
    if (!demoActive) return;

    // Now players are at x~8, enemies at x~11 → distance ~3-5 (within RANGED_RANGE)
    // DM announces enemies spotted
    dmNarrate(pickRandom(narr.combatStart));
    await delay(1500);
    if (!demoActive) return;

    // ── Phase: Combat 1 ──
    await runCombat(5);
    if (!demoActive) return;

    // ── Phase: Mid-game — rest + heal ──
    dmNarrate(pickRandom(narr.betweenRounds));
    await delay(2000);
    if (!demoActive) return;

    // Cleric heals weakest ally
    const cleric = s.map.tokens.find(t => t.id === 'demo-p2');
    const weakest = s.map.tokens
      .filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.hp < t.hpMax)
      .sort((a, b) => (a.hp / a.hpMax) - (b.hp / b.hpMax))[0];
    if (cleric && cleric.hp > 0 && weakest) {
      playerSpeak(cleric as Token & { charClass?: string });
      await delay(1000);
      if (!demoActive) return;
      resolveIntent(cleric, { type: 'cast_spell', spell: 'heal', targetId: weakest.id });
      emitEvent('map_state', { map: stripMap(s.map) });
    }
    await delay(2000);
    if (!demoActive) return;

    // ── Phase: Combat 2 — reinforcements ──
    const partyAlive = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0);
    if (partyAlive.length === 0) {
      endSession('party_defeated');
      demoActive = false;
      return;
    }

    dmNarrate(pickRandom(narr.combatStart));
    await delay(1500);
    if (!demoActive) return;

    // Spawn 2 new enemies from the right side
    const occupied = new Set(s.map.tokens.filter(t => t.hp > 0).map(t => `${t.x},${t.y}`));
    const spawnCandidates = [
      { x: 12, y: 4 }, { x: 12, y: 9 }, { x: 11, y: 3 }, { x: 11, y: 10 },
      { x: 10, y: 4 }, { x: 10, y: 9 }, { x: 12, y: 6 }, { x: 12, y: 7 },
    ];
    const spawnPositions = spawnCandidates.filter(p => !occupied.has(`${p.x},${p.y}`)).slice(0, 2);
    const enemyTypes: Array<'grunt' | 'brute'> = ['grunt', 'brute'];
    for (let i = 0; i < spawnPositions.length; i++) {
      const etype = enemyTypes[i % enemyTypes.length];
      const estats = ENEMY_STATS[etype];
      const ename = GENRE_SKINS.enemies[etype]?.[genre] || etype;
      const eid = `m-demo-${Date.now()}-${i}`;
      const enemyToken: Token & { enemyType?: string } = {
        id: eid, kind: 'enemy', name: ename,
        x: spawnPositions[i].x, y: spawnPositions[i].y,
        hp: estats.hp, hpMax: estats.hp, ac: estats.ac,
        status: [], enemyType: etype,
      };
      s.map.tokens.push(enemyToken);
    }
    emitEvent('map_state', { map: stripMap(s.map) });
    await delay(1000);
    if (!demoActive) return;

    await runCombat(4);
    if (!demoActive) return;

    // ── Phase: Ending ──
    dmNarrate(pickRandom(narr.ending));
    await delay(3000);
    if (!demoActive) return;

    endSession('demo_complete');
  } catch (err) {
    console.error('[demoRunner] error:', err);
  } finally {
    demoActive = false;
    demoTimers = [];
  }
}

// ── Roguelike Demo ──

let roguelikeDemoActive = false;
let roguelikeDemoTimers: ReturnType<typeof setTimeout>[] = [];

export function isRoguelikeDemoRunning(): boolean {
  return roguelikeDemoActive;
}

export function stopRoguelikeDemo(): void {
  roguelikeDemoActive = false;
  for (const t of roguelikeDemoTimers) clearTimeout(t);
  roguelikeDemoTimers = [];
}

function rlDelay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    roguelikeDemoTimers.push(t);
  });
}

/** Run roguelike combat loop for the current floor */
async function runRoguelikeCombat(maxRounds: number): Promise<'enemies_dead' | 'party_dead' | 'max_rounds' | 'aborted'> {
  const s = getSession();
  if (!s || !roguelikeDemoActive) return 'aborted';

  // Roll initiative
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

  for (let round = 1; round <= maxRounds; round++) {
    if (!roguelikeDemoActive) return 'aborted';
    s.combat.round = round;

    for (const tokenId of s.combat.initiativeOrder) {
      if (!roguelikeDemoActive) return 'aborted';

      const token = findToken(s.map, tokenId);
      if (!token || token.hp <= 0) continue;

      const turnId = `t-rl-${uuid().slice(0, 6)}`;
      s.combat.currentTurnId = turnId;

      emitEvent('turn_changed', {
        turnId,
        actor: { kind: token.kind, id: token.id, name: token.name },
        round,
      });

      await rlDelay(1200);
      if (!roguelikeDemoActive) return 'aborted';

      // Decide action
      let intent: PlayerIntent;
      if (token.kind === 'enemy') {
        intent = decideEnemyAction(token, s.map);
      } else if (token.kind === 'npc') {
        intent = decideNpcAction(token, s.map);
      } else {
        // Use demo AI for players
        const member = s.party.find(p => p.id === token.id);
        if (member && s.map.rows) {
          const enemies = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
          const allies = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.id !== token.id);
          intent = decideDemoPlayerAction(token, member, allies, enemies, s.map.rows);
        } else {
          intent = { type: 'defend' };
        }
        if (Math.random() < 0.2) {
          playerSpeak(token as Token & { charClass?: string });
        }
      }

      // Snapshot HP
      const hpBefore = new Map<string, number>();
      for (const t of s.map.tokens) hpBefore.set(t.id, t.hp);

      narrateAction(token, intent, s.map);
      resolveIntent(token, intent);
      narrateResult(token, intent, s.map, hpBefore);
      emitEvent('map_state', { map: stripMap(s.map) });

      await rlDelay(800);
      if (!roguelikeDemoActive) return 'aborted';
    }

    // Check end conditions
    const enemiesAlive = s.map.tokens.filter(t => t.kind === 'enemy' && t.hp > 0);
    if (enemiesAlive.length === 0) {
      s.combat.active = false;
      emitEvent('combat_ended', { reason: '모든 적 처치!' });
      return 'enemies_dead';
    }

    const alliesAlive = s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0);
    if (alliesAlive.length === 0) {
      s.combat.active = false;
      emitEvent('combat_ended', { reason: '파티 전멸' });
      return 'party_dead';
    }
  }

  s.combat.active = false;
  emitEvent('combat_ended', { reason: '전투 종료' });
  return 'max_rounds';
}

// ── Roguelike floor narration ──
const FLOOR_NARRATION = [
  '어두운 계단을 내려간다. 새로운 층이 펼쳐진다.',
  '문이 열리며 더 깊은 곳이 드러난다. 공기가 무겁다.',
  '통로 끝에서 빛이 보인다. 하지만 함정일 수도 있다.',
  '발소리가 울려 퍼진다. 이곳은 더 위험해 보인다.',
  '벽에 새겨진 경고 문구가 보인다. 계속 전진한다.',
];

export async function startRoguelikeDemo(): Promise<void> {
  if (roguelikeDemoActive || demoActive) return;
  roguelikeDemoActive = true;
  roguelikeDemoTimers = [];

  try {
    const s = getSession();
    if (!s || s.state !== 'LOBBY') {
      roguelikeDemoActive = false;
      return;
    }

    const genre = s.genre;
    const narr = NARRATION[genre] || NARRATION.factory;

    // Setup party
    s.party = [
      { id: 'demo-p1', name: 'RoboCop', role: 'tank', class: 'robocop', agentId: 'demo-p1' },
      { id: 'demo-p2', name: 'Vision', role: 'healer', class: 'vision', agentId: 'demo-p2' },
      { id: 'demo-p3', name: 'T-800', role: 'dps', class: 't800', agentId: 'demo-p3' },
    ];

    emitLobbyStatus();
    await rlDelay(800);
    if (!roguelikeDemoActive) return;

    // Transition to LIVE (we don't call startSession — roguelike handles its own map)
    s.state = 'LIVE';
    s.startedAt = Date.now();
    const storeModule = await import('../db/eventStore.js');
    storeModule.updateSessionState(s.sessionId, 'LIVE', { started_at: s.startedAt });

    // Start game loop (orchestrator for turn-based combat)
    startGameLoop();

    // Init roguelike
    initRoguelikeRun(s);

    emitEvent('session_started', {
      startedAt: s.startedAt,
      party: s.party.map(p => ({ id: p.id, name: p.name, role: p.role, class: p.class })),
      objective: '10층 보스를 쓰러뜨려라!',
      isRoguelike: true,
    });

    // Intro
    dmNarrate(pickRandom(narr.intro));
    await rlDelay(2000);
    if (!roguelikeDemoActive) return;

    for (const p of s.party) {
      playerSpeak({ ...s.map.tokens.find(t => t.id === p.id) || { id: p.id, kind: 'player' as const, name: p.name, x: 0, y: 0, hp: 1, hpMax: 1, ac: 10 }, charClass: p.class } as Token & { charClass?: string });
      await rlDelay(800);
      if (!roguelikeDemoActive) return;
    }

    // Floor loop — demo drives floor transitions directly (not via transitionToNextFloor)
    const maxFloors = 10;
    for (let floor = 1; floor <= maxFloors; floor++) {
      if (!roguelikeDemoActive) return;

      // Floor narration
      dmNarrate(floor === 10
        ? '최종 층에 도달했다! 강대한 존재가 기다리고 있다...'
        : pickRandom(FLOOR_NARRATION));
      await rlDelay(1500);
      if (!roguelikeDemoActive) return;

      // Start floor (generates map, spawns enemies)
      startFloor(floor);
      await rlDelay(1000);
      if (!roguelikeDemoActive) return;

      // Combat
      dmNarrate(pickRandom(narr.combatStart));
      await rlDelay(1000);
      if (!roguelikeDemoActive) return;

      const result = await runRoguelikeCombat(floor === 10 ? 12 : 8);
      if (!roguelikeDemoActive) return;

      if (result === 'party_dead') {
        dmNarrate('파티가 전멸했다... 모험은 여기서 끝이다.');
        await rlDelay(1500);
        endRun('defeat');
        break;
      }

      if (result === 'enemies_dead') {
        // Floor cleared
        onFloorCleared();
        await rlDelay(1000);
        if (!roguelikeDemoActive) return;

        if (floor >= 10) {
          // Victory — onFloorCleared already called endRun('victory')
          dmNarrate('보스를 처치했다! 던전 정복 완료!');
          await rlDelay(2000);
          break;
        }

        // Between floors: rest heal (25% max HP)
        dmNarrate(pickRandom(narr.betweenRounds));
        await rlDelay(1500);
        if (!roguelikeDemoActive) return;

        for (const tok of s.map.tokens.filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0)) {
          const healAmt = Math.ceil(tok.hpMax * 0.25);
          const oldHp = tok.hp;
          tok.hp = Math.min(tok.hp + healAmt, tok.hpMax);
          if (tok.hp > oldHp) {
            emitEvent('hp_changed', { targetId: tok.id, from: oldHp, to: tok.hp, reason: 'heal' });
          }
        }

        // Cleric heals weakest
        const cleric = s.map.tokens.find(t => t.id === 'demo-p2');
        const weakest = s.map.tokens
          .filter(t => (t.kind === 'player' || t.kind === 'npc') && t.hp > 0 && t.hp < t.hpMax)
          .sort((a, b) => (a.hp / a.hpMax) - (b.hp / b.hpMax))[0];
        if (cleric && cleric.hp > 0 && weakest) {
          playerSpeak(cleric as Token & { charClass?: string });
          await rlDelay(500);
          resolveIntent(cleric, { type: 'cast_spell', spell: 'heal', targetId: weakest.id });
          emitEvent('map_state', { map: stripMap(s.map) });
        }
        await rlDelay(1000);
        if (!roguelikeDemoActive) return;

        // Next floor narration transition
        emitEvent('chat_message', {
          messageId: `m-floor-transition-${Date.now()}`,
          speaker: { type: 'DM', name: 'DM' },
          text: (floor + 1) === 10
            ? '최종 층에 다다랐다. 강대한 존재의 기운이 느껴진다...'
            : `${floor + 1}층으로 향한다. 더 강한 적들이 기다리고 있을 것이다...`,
        });
        await rlDelay(1000);
        if (!roguelikeDemoActive) return;

        continue; // next iteration calls startFloor(floor+1)
      }

      // 'max_rounds' — treat as cleared
      if (result === 'max_rounds') {
        onFloorCleared();
        await rlDelay(500);
        if (!roguelikeDemoActive) return;
        if (floor >= 10) break;
      }
    }

    // End session
    const sNow = getSession();
    if (sNow && sNow.state !== 'ENDED') {
      endSession('roguelike_complete');
    }
  } catch (err) {
    console.error('[roguelikeDemo] error:', err);
  } finally {
    roguelikeDemoActive = false;
    roguelikeDemoTimers = [];
  }
}
