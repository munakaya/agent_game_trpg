export type SfxKey =
  | 'footstep'
  | 'diceRoll'
  | 'meleeHit'
  | 'miss'
  | 'spellAttack'
  | 'healChime'
  | 'potionBubble'
  | 'hazard'
  | 'death'
  | 'combatStart'
  | 'combatEndVictory'
  | 'combatEndDefeat'
  | 'turnChange'
  | 'sessionStart'
  | 'sessionEnd'
  | 'defend'
  | 'healRestore'
  | 'floorCleared'
  | 'levelUp'
  | 'runVictory'
  | 'runDefeat';

const SFX_BASE = '/audio/sfx/';

export const BGM_MAIN_TRACK = '/audio/bgm/adventure_loop_cc0.ogg';

export const SFX_LIBRARY: Record<SfxKey, readonly string[]> = {
  footstep: [`${SFX_BASE}footstep04.ogg`],
  diceRoll: [`${SFX_BASE}handleCoins2.ogg`],
  meleeHit: [`${SFX_BASE}knifeSlice2.ogg`],
  miss: [`${SFX_BASE}drawKnife1.ogg`],
  spellAttack: [`${SFX_BASE}metalClick.ogg`],
  healChime: [`${SFX_BASE}bookFlip1.ogg`],
  potionBubble: [`${SFX_BASE}cloth2.ogg`],
  hazard: [`${SFX_BASE}metalPot1.ogg`],
  death: [`${SFX_BASE}dropLeather.ogg`],
  combatStart: [`${SFX_BASE}doorOpen_1.ogg`],
  combatEndVictory: [`${SFX_BASE}doorClose_3.ogg`],
  combatEndDefeat: [`${SFX_BASE}doorClose_4.ogg`],
  turnChange: [`${SFX_BASE}metalLatch.ogg`],
  sessionStart: [`${SFX_BASE}bookOpen.ogg`],
  sessionEnd: [`${SFX_BASE}bookClose.ogg`],
  defend: [`${SFX_BASE}clothBelt.ogg`],
  healRestore: [`${SFX_BASE}handleSmallLeather2.ogg`],
  floorCleared: [`${SFX_BASE}doorOpen_2.ogg`],
  levelUp: [`${SFX_BASE}handleCoins.ogg`],
  runVictory: [`${SFX_BASE}chop.ogg`],
  runDefeat: [`${SFX_BASE}creak3.ogg`],
};
