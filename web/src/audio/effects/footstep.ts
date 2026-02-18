import type { SoundEngine } from '../SoundEngine.js';

export function footstep(engine: SoundEngine) {
  engine.playSfx('footstep', 0.65);
}
