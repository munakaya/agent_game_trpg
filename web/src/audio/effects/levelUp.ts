import type { SoundEngine } from '../SoundEngine.js';

export function levelUp(engine: SoundEngine) {
  engine.playSfx('levelUp', 0.85);
}
