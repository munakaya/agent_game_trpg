import type { SoundEngine } from '../SoundEngine.js';

export function healRestore(engine: SoundEngine) {
  engine.playSfx('healRestore', 0.7);
}
