import type { UIState, GameEvent, MapState } from './types';
import { initialState } from './types';

function tokenName(ms: MapState | undefined, id: string): string {
  return ms?.tokens.find(t => t.id === id)?.name ?? id;
}

export function reduce(state: UIState, ev: GameEvent): UIState {
  if (ev.seq <= state.meta.lastSeq) return state;

  const next: UIState = { ...state, meta: { ...state.meta, lastSeq: ev.seq } };

  switch (ev.type) {
    case 'session_created': {
      next.session = {
        sessionId: ev.sessionId,
        title: ev.payload.title,
        genre: ev.payload.genre,
        state: ev.payload.state,
      };
      next.ending = { isEnding: false };
      next.chat = { messages: [], streaming: {} };
      next.dice = { recent: [] };
      next.combat = { active: false, initiativeOrder: [], round: 0 };
      return next;
    }

    case 'lobby_status': {
      next.lobby = {
        dmConnected: ev.payload.dmConnected,
        playersConnected: ev.payload.playersConnected,
        roleNeed: ev.payload.roleNeed,
      };
      return next;
    }

    case 'session_started': {
      next.session = {
        ...next.session,
        state: 'LIVE',
        startedAt: ev.payload.startedAt,
        objective: ev.payload.objective,
        isRoguelike: ev.payload.isRoguelike ?? false,
      };
      return next;
    }

    case 'map_state': {
      next.map = { mapState: ev.payload.map };
      return next;
    }

    case 'token_moved': {
      const ms = next.map.mapState;
      if (!ms) return next;
      const tokens = ms.tokens.map(t =>
        t.id === ev.payload.tokenId
          ? { ...t, x: ev.payload.to.x, y: ev.payload.to.y }
          : t
      );
      next.map = { mapState: { ...ms, tokens } };
      return next;
    }

    case 'hp_changed': {
      const ms = next.map.mapState;
      if (!ms) return next;
      const tokens = ms.tokens.map(t =>
        t.id === ev.payload.targetId
          ? { ...t, hp: ev.payload.to }
          : t
      );
      next.map = { mapState: { ...ms, tokens } };

      const name = tokenName(ms, ev.payload.targetId);
      const from = ev.payload.from as number;
      const to = ev.payload.to as number;
      const diff = to - from;
      const reason = ev.payload.reason as string | undefined;
      const messages = [...next.chat.messages];

      if (reason === 'hazard') {
        messages.push({
          messageId: `combat-${ev.seq}`,
          speaker: { type: 'COMBAT' as const, name: '' },
          text: `⚡ ${name} 함정 피해! ${Math.abs(diff)} 피해 (${from}→${to} HP)`,
        });
      } else if (reason === 'heal') {
        messages.push({
          messageId: `combat-${ev.seq}`,
          speaker: { type: 'COMBAT' as const, name: '' },
          text: `💚 ${name} 회복 +${diff} HP (${from}→${to})`,
        });
      }

      if (to <= 0) {
        messages.push({
          messageId: `combat-${ev.seq}-death`,
          speaker: { type: 'COMBAT' as const, name: '' },
          text: `💀 ${name} 쓰러짐!`,
        });
      }

      next.chat = { ...next.chat, messages };
      return next;
    }

    case 'dice_rolled': {
      const recent = [...next.dice.recent, ev.payload];
      next.dice = { recent: recent.slice(-10) };
      return next;
    }

    case 'chat_chunk': {
      const cur = next.chat.streaming[ev.payload.messageId] ?? '';
      next.chat = {
        ...next.chat,
        streaming: { ...next.chat.streaming, [ev.payload.messageId]: cur + ev.payload.chunk },
      };
      return next;
    }

    case 'chat_message': {
      const msg = {
        messageId: ev.payload.messageId,
        speaker: ev.payload.speaker,
        text: ev.payload.text,
      };
      const streaming = { ...next.chat.streaming };
      delete streaming[ev.payload.messageId];
      next.chat = { messages: [...next.chat.messages, msg], streaming };
      return next;
    }

    case 'attack_resolved': {
      const ms = next.map.mapState;
      const atk = tokenName(ms, ev.payload.attackerId);
      const tgt = tokenName(ms, ev.payload.targetId);
      const hit = ev.payload.toHit?.hit;
      const dmg = ev.payload.damage?.amount;

      let text: string;
      if (hit) {
        text = `⚔ ${atk} → ${tgt} 명중! ${dmg} 피해`;
      } else {
        text = `⚔ ${atk} → ${tgt} 빗나감`;
      }

      const msg = {
        messageId: `combat-${ev.seq}`,
        speaker: { type: 'COMBAT' as const, name: '' },
        text,
      };
      next.chat = { ...next.chat, messages: [...next.chat.messages, msg] };
      return next;
    }

    case 'combat_started': {
      next.combat = {
        ...next.combat,
        active: true,
        initiativeOrder: ev.payload.initiativeOrder,
      };
      return next;
    }

    case 'combat_ended': {
      next.combat = { ...next.combat, active: false, initiativeOrder: [] };
      return next;
    }

    case 'turn_changed': {
      next.combat = {
        ...next.combat,
        round: ev.payload.round,
        currentActor: {
          id: ev.payload.actor.id,
          name: ev.payload.actor.name,
          kind: ev.payload.actor.kind,
        },
      };
      return next;
    }

    case 'session_ending': {
      next.session = { ...next.session, state: 'ENDING' };
      next.ending = { ...next.ending, isEnding: true };
      return next;
    }

    case 'session_ended': {
      next.session = { ...next.session, state: 'ENDED', endedAt: ev.payload.endedAt };
      next.ending = { isEnding: false, summary: ev.payload.summary };
      return next;
    }

    // ── Roguelike events ──

    case 'floor_started': {
      next.roguelike = {
        ...next.roguelike,
        floor: {
          floorNumber: ev.payload.floorNumber,
          enemyCount: ev.payload.enemyCount,
          cleared: false,
          isBossFloor: ev.payload.isBossFloor,
        },
        partyStatus: ev.payload.partyStatus ?? next.roguelike.partyStatus,
      };
      return next;
    }

    case 'floor_cleared': {
      next.roguelike = {
        ...next.roguelike,
        floor: { ...next.roguelike.floor, cleared: true },
      };
      const msg = {
        messageId: `floor-cleared-${ev.seq}`,
        speaker: { type: 'COMBAT' as const, name: '' },
        text: `Floor ${ev.payload.floorNumber} 클리어!`,
      };
      next.chat = { ...next.chat, messages: [...next.chat.messages, msg] };
      return next;
    }

    case 'xp_gained': {
      const ps = next.roguelike.partyStatus.map(c =>
        c.id === ev.payload.characterId
          ? { ...c, xp: ev.payload.totalXp }
          : c
      );
      next.roguelike = { ...next.roguelike, partyStatus: ps };
      return next;
    }

    case 'level_up': {
      const ps = next.roguelike.partyStatus.map(c =>
        c.id === ev.payload.characterId
          ? { ...c, level: ev.payload.newLevel }
          : c
      );
      next.roguelike = { ...next.roguelike, partyStatus: ps };
      const msg = {
        messageId: `levelup-${ev.seq}`,
        speaker: { type: 'COMBAT' as const, name: '' },
        text: `Level Up! Lv.${ev.payload.newLevel}`,
      };
      next.chat = { ...next.chat, messages: [...next.chat.messages, msg] };
      return next;
    }

    case 'run_ended': {
      next.roguelike = {
        ...next.roguelike,
        runEnd: {
          reason: ev.payload.reason,
          finalFloor: ev.payload.finalFloor,
          totalKills: ev.payload.totalKills,
          partyFinalStatus: ev.payload.partyFinalStatus,
        },
      };
      return next;
    }

    case 'reward_offered': {
      next.roguelike = {
        ...next.roguelike,
        rewardChoices: ev.payload.choices,
        rewardForCharacterId: ev.payload.forCharacterId,
      };
      return next;
    }

    case 'reward_chosen': {
      next.roguelike = {
        ...next.roguelike,
        rewardChoices: undefined,
        rewardForCharacterId: undefined,
      };
      return next;
    }

    case 'equipment_changed': {
      const ps = next.roguelike.partyStatus.map(c => {
        if (c.id !== ev.payload.characterId) return c;
        const equip = c.equipment ?? { weapon: undefined, armor: undefined, consumables: [null, null, null] };
        const newItem = ev.payload.newItem;
        if (ev.payload.slot === 'weapon') {
          return { ...c, equipment: { ...equip, weapon: newItem } };
        } else if (ev.payload.slot === 'armor') {
          return { ...c, equipment: { ...equip, armor: newItem } };
        }
        return c;
      });
      next.roguelike = { ...next.roguelike, partyStatus: ps };
      return next;
    }

    case 'content_filtered': {
      return next;
    }

    case 'error': {
      return next;
    }

    default:
      return next;
  }
}

export function reduceMany(state: UIState, events: GameEvent[]): UIState {
  let next = state;
  for (const ev of events) {
    next = reduce(next, ev);
  }
  return next;
}

export function reset(): UIState {
  return {
    ...initialState,
    chat: { messages: [], streaming: {} },
    dice: { recent: [] },
    roguelike: { floor: { floorNumber: 0, enemyCount: 0, cleared: false }, partyStatus: [] },
  };
}
