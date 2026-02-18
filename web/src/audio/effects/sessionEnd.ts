import type { SoundEngine } from '../SoundEngine.js';

export function sessionEnd(engine: SoundEngine) {
  engine.playSfx('sessionEnd', 0.8);
}
