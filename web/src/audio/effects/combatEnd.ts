import type { SoundEngine } from '../SoundEngine.js';

export function combatEndVictory(engine: SoundEngine) {
  engine.playSfx('combatEndVictory', 0.9);
}

export function combatEndDefeat(engine: SoundEngine) {
  engine.playSfx('combatEndDefeat', 0.9);
}
