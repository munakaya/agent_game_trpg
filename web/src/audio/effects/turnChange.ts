import type { SoundEngine } from '../SoundEngine.js';

export function turnChange(engine: SoundEngine) {
  engine.playSfx('turnChange', 0.7);
}
