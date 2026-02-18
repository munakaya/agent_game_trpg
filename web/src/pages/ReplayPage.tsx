import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameState } from '../state/useGameState';
import { useSoundEngine } from '../audio/useSoundEngine';
import { useAnimationQueue } from '../state/animation/useAnimationQueue';
import { fetchSessionEvents } from '../net/apiClient';
import Header from '../components/Header';
import ChatLog from '../components/ChatLog';
import MapView from '../components/MapView';
import DicePanel from '../components/DicePanel';
import ReplayControls from '../components/ReplayControls';
import type { GameEvent } from '../state/types';

export default function ReplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { state, applyEvent, resetState, stateRef } = useGameState();
  const { playSoundForEvent, setDisabled, setReplayMode, volume, muted, setVolume, toggleMuted } = useSoundEngine();
  const { activeAnimations, damageNumbers, projectiles, particles, elementalParticles, slashEffects, impactEffects, cameraEffect, shouldShake, isHitStop, addAnimationFromEvent, clear: clearAnimations } = useAnimationQueue();
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursor, setCursor] = useState(0);

  const cursorRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const eventsRef = useRef<GameEvent[]>([]);
  const rafRef = useRef<number>(0);
  const baseRealTimeRef = useRef(0);
  const baseEventTimeRef = useRef(0);

  // Enable replay mode for sound engine (skip stale-event check)
  useEffect(() => {
    setReplayMode(true);
    return () => setReplayMode(false);
  }, [setReplayMode]);

  // Load events (compress time gaps > 3s to 1s for smooth replay)
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    resetState();
    fetchSessionEvents(sessionId).then(rawEvs => {
      // Compress time gaps > 3s down to 1s for smooth replay
      const MAX_GAP = 3000;
      const COMPRESSED_GAP = 1000;
      let cumulativeShift = 0;
      const evs = rawEvs.map((ev: GameEvent, i: number) => {
        if (i === 0) return ev;
        const gap = rawEvs[i].t - rawEvs[i - 1].t;
        if (gap > MAX_GAP) {
          cumulativeShift += gap - COMPRESSED_GAP;
        }
        return cumulativeShift > 0 ? { ...ev, t: ev.t - cumulativeShift } : ev;
      });
      setEvents(evs);
      eventsRef.current = evs;
      setLoading(false);
      setCursor(0);
      cursorRef.current = 0;
    });
  }, [sessionId, resetState]);

  // Tick loop
  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const evs = eventsRef.current;
    if (cursorRef.current >= evs.length) {
      setPlaying(false);
      playingRef.current = false;
      return;
    }

    const now = performance.now();
    const targetEventTime = baseEventTimeRef.current +
      (now - baseRealTimeRef.current) * speedRef.current;

    while (cursorRef.current < evs.length && evs[cursorRef.current].t <= targetEventTime) {
      const ev = evs[cursorRef.current];
      playSoundForEvent(ev);

      // 토큰 위치 맵 생성
      const tokenPositions = new Map<string, { x: number; y: number }>();
      stateRef.current.map.mapState?.tokens.forEach(t => {
        tokenPositions.set(t.id, { x: t.x, y: t.y });
      });

      addAnimationFromEvent(ev, tokenPositions);
      applyEvent(ev);
      cursorRef.current++;
      setCursor(cursorRef.current);
    }

    if (cursorRef.current >= evs.length) {
      setPlaying(false);
      playingRef.current = false;
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [applyEvent, playSoundForEvent, addAnimationFromEvent, stateRef]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    } else {
      if (cursorRef.current >= eventsRef.current.length) {
        // Reset
        resetState();
        cursorRef.current = 0;
        setCursor(0);
      }

      playingRef.current = true;
      setPlaying(true);
      speedRef.current = speed;
      baseRealTimeRef.current = performance.now();
      baseEventTimeRef.current = eventsRef.current[cursorRef.current]?.t ?? 0;
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [speed, tick, resetState]);

  const handleSetSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeed(s);
    if (playingRef.current) {
      // Adjust base times to maintain position
      baseRealTimeRef.current = performance.now();
      baseEventTimeRef.current = eventsRef.current[cursorRef.current]?.t ?? 0;
    }
  }, []);

  const handleSeek = useCallback((ratio: number) => {
    const evs = eventsRef.current;
    if (evs.length === 0) return;

    cancelAnimationFrame(rafRef.current);
    playingRef.current = false;
    setPlaying(false);

    setDisabled(true); // disable sounds during fast-forward
    clearAnimations(); // clear animations during seek
    resetState();
    const targetIdx = Math.min(Math.floor(ratio * evs.length), evs.length - 1);

    for (let i = 0; i <= targetIdx; i++) {
      applyEvent(evs[i]);
    }
    cursorRef.current = targetIdx + 1;
    setCursor(cursorRef.current);
    setDisabled(false); // re-enable sounds
  }, [applyEvent, resetState, setDisabled, clearAnimations]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const progress = events.length > 0 ? cursor / events.length : 0;

  if (loading) {
    return <div className="archive-empty">리플레이를 불러오는 중입니다…</div>;
  }

  if (events.length === 0) {
    return (
      <div className="archive-empty">
        <p>재생 가능한 이벤트가 없습니다.</p>
        <Link to="/archive" className="top-nav-link">아카이브로 이동</Link>
      </div>
    );
  }

  return (
    <div>
      <ReplayControls
        playing={playing}
        speed={speed}
        progress={progress}
        onTogglePlay={togglePlay}
        onSetSpeed={handleSetSpeed}
        onSeek={handleSeek}
      />

      <div className="live-layout" style={{ marginTop: 12 }}>
        <Header state={state} volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMuted} />

        <div className="main-panel">
          <MapView
            mapState={state.map.mapState}
            activeAnimations={activeAnimations}
            damageNumbers={damageNumbers}
            projectiles={projectiles}
            particles={particles}
            elementalParticles={elementalParticles}
            slashEffects={slashEffects}
            impactEffects={impactEffects}
            cameraEffect={cameraEffect}
            shouldShake={shouldShake}
            isHitStop={isHitStop}
          />
          <ChatLog state={state} />
        </div>

        <div className="side-panel">
          <DicePanel state={state} />
        </div>
      </div>

      {state.ending.summary && !playing && cursor >= events.length && (
        <div className="ending-overlay" onClick={togglePlay}>
          <div className="ending-card">
            <h2 style={{ color: '#e94560', marginBottom: 12 }}>Replay Complete</h2>
            <p style={{ marginBottom: 20, lineHeight: 1.6 }}>{state.ending.summary}</p>
            <button className="replay-btn" onClick={(e) => { e.stopPropagation(); handleSeek(0); }}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
