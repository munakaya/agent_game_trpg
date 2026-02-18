import type { SoundEngine } from '../SoundEngine.js';

export function potionBubble(engine: SoundEngine) {
  engine.playSfx('potionBubble', 0.7);
}
