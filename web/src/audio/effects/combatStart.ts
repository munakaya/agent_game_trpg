import type { SoundEngine } from '../SoundEngine.js';

export function combatStart(engine: SoundEngine) {
  engine.playSfx('combatStart', 0.9);
}
