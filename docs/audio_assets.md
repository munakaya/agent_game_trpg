# Audio Assets

웹 오디오를 합성음(WebAudio Oscillator) 중심에서 오픈소스(CC0) 실제 음원 기반으로 전환했다.

## Sources
- SFX: `50 RPG Sound Effects` by Kenney (CC0), OpenGameArt
  - https://opengameart.org/content/50-rpg-sound-effects
- BGM: `Background Music 1` by Tozan (CC0), OpenGameArt
  - https://opengameart.org/content/background-music-1

## Runtime Paths
- BGM: `web/public/audio/bgm/adventure_loop_cc0.ogg`
- SFX: `web/public/audio/sfx/*.ogg`
- 라이선스 문서: `web/public/audio/licenses/THIRD_PARTY_AUDIO.md`

## Mapping
- 이벤트 매핑은 `web/src/audio/audioLibrary.ts`에서 관리한다.
- 효과 실행 함수는 `web/src/audio/effects/*.ts`에서 `engine.playSfx(...)`를 호출한다.
- 배경음은 `web/src/audio/useSoundEngine.ts`에서 페이지 진입 시 시작/이탈 시 정지한다.
