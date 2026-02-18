import type { SoundEngine } from '../SoundEngine.js';

export function meleeHit(engine: SoundEngine) {
  engine.playSfx('meleeHit', 0.85);
}
