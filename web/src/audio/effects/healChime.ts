import type { SoundEngine } from '../SoundEngine.js';

export function healChime(engine: SoundEngine) {
  engine.playSfx('healChime', 0.7);
}
