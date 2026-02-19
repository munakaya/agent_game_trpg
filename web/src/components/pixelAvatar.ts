import type { Token } from '../state/types';

// Open-source pixel sprites loaded from web/public/sprites (project-local assets).
const SPRITE_PATH_BY_KEY: Record<string, string> = {
  fighter: '/sprites/fighter.png',
  wizard: '/sprites/wizard.png',
  rogue: '/sprites/rogue.png',
  cleric: '/sprites/cleric.png',
  grunt: '/sprites/grunt.png',
  spitter: '/sprites/spitter.png',
  brute: '/sprites/brute.png',
  npc: '/sprites/npc.png',
  dead: '/sprites/dead.png',
  unknown: '/sprites/unknown.png',
};

const KNOWN_KEYS = new Set(Object.keys(SPRITE_PATH_BY_KEY));

function normalizeSpriteKey(sprite?: string): string {
  if (!sprite) return 'unknown';
  const key = sprite.toLowerCase();
  if (KNOWN_KEYS.has(key)) return key;
  return 'unknown';
}

export function resolveTokenSpriteKey(token: Token): string {
  if (token.hp <= 0) return 'dead';
  if (token.sprite) return normalizeSpriteKey(token.sprite);
  if (token.kind === 'player') return 'fighter';
  if (token.kind === 'npc') return 'npc';
  return 'grunt';
}

function spritePath(spriteKey: string): string {
  return SPRITE_PATH_BY_KEY[spriteKey] || SPRITE_PATH_BY_KEY.unknown;
}

export function getTokenAvatarUri(token: Token): string {
  const key = resolveTokenSpriteKey(token);
  return spritePath(key);
}

export function getLegendAvatarUri(spriteKey: string): string {
  const key = normalizeSpriteKey(spriteKey);
  return spritePath(key);
}
