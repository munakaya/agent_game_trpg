import type { SoundEngine } from '../SoundEngine.js';

export function spellAttack(engine: SoundEngine) {
  engine.playSfx('spellAttack', 0.75);
}
