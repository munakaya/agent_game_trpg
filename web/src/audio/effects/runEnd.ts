import type { SoundEngine } from '../SoundEngine.js';

export function runVictory(engine: SoundEngine) {
  engine.playSfx('runVictory', 0.95);
}

export function runDefeat(engine: SoundEngine) {
  engine.playSfx('runDefeat', 0.95);
}
