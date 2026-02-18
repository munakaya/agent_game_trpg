import type { SoundEngine } from '../SoundEngine.js';

export function floorCleared(engine: SoundEngine) {
  engine.playSfx('floorCleared', 0.85);
}
