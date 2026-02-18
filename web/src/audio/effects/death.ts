import type { SoundEngine } from '../SoundEngine.js';

export function death(engine: SoundEngine) {
  engine.playSfx('death', 0.95);
}
