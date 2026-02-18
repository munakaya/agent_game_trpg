import type { SoundEngine } from '../SoundEngine.js';

export function diceRoll(engine: SoundEngine) {
  engine.playSfx('diceRoll', 0.7);
}
