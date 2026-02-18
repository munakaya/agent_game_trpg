import type { SoundEngine } from '../SoundEngine.js';

export function hazard(engine: SoundEngine) {
  engine.playSfx('hazard', 0.9);
}
