import type { SoundEngine } from '../SoundEngine.js';

export function defend(engine: SoundEngine) {
  engine.playSfx('defend', 0.75);
}
