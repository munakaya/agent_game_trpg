import type { SoundEngine } from '../SoundEngine.js';

export function sessionStart(engine: SoundEngine) {
  engine.playSfx('sessionStart', 0.8);
}
