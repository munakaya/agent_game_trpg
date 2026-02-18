import type { SoundEngine } from '../SoundEngine.js';

export function miss(engine: SoundEngine) {
  engine.playSfx('miss', 0.75);
}
