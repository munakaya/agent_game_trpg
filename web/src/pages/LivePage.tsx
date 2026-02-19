import { useEffect, useRef, useCallback, useState } from 'react';
import { useGameState } from '../state/useGameState';
import { connectSse } from '../net/sseClient';
import { fetchCurrentBootstrap } from '../net/apiClient';
import { useSoundEngine } from '../audio/useSoundEngine';
import { useAnimationQueue } from '../state/animation/useAnimationQueue';
import Header from '../components/Header';
import LobbyView from '../components/LobbyView';
import ChatLog from '../components/ChatLog';
import MapView from '../components/MapView';
import DicePanel from '../components/DicePanel';
import FloorHeader from '../components/FloorHeader';
import CharacterPanel from '../components/CharacterPanel';
import RewardModal from '../components/RewardModal';
import RunEndScreen from '../components/RunEndScreen';
import type { GameEvent } from '../state/types';
import { Link } from 'react-router-dom';

const ANIMATION_STALE_THRESHOLD_MS = 2000;

export default function LivePage() {
  const { state, applyEvent, applyEvents, stateRef } = useGameState();
  const { playSoundForEvent, resetTracking, volume, muted, setVolume, toggleMuted } = useSoundEngine();
  const { activeAnimations, damageNumbers, projectiles, particles, elementalParticles, slashEffects, impactEffects, cameraEffect, shouldShake, isHitStop, addAnimationFromEvent, clear: clearAnimations } = useAnimationQueue();
  const sseRef = useRef<{ close: () => void } | null>(null);
  const mountedRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const connect = useCallback(() => {
    const fromSeq = stateRef.current.meta.lastSeq + 1;
    sseRef.current?.close();
    resetTracking(); // Reset sound state on reconnect
    clearAnimations(); // Reset animation state on reconnect
    sseRef.current = connectSse(fromSeq, (ev: GameEvent) => {
      playSoundForEvent(ev);

      // Catch-up 구간의 과거 이벤트는 애니메이션을 건너뛰어 UI 멈춤을 방지한다.
      const isStaleAnimationEvent = Date.now() - ev.t > ANIMATION_STALE_THRESHOLD_MS;
      if (!isStaleAnimationEvent) {
        const tokenPositions = new Map<string, { x: number; y: number }>();
        stateRef.current.map.mapState?.tokens.forEach(t => {
          tokenPositions.set(t.id, { x: t.x, y: t.y });
        });

        addAnimationFromEvent(ev, tokenPositions); // 애니메이션 트리거
      }
      applyEvent(ev);
    }, () => {
      // Reconnect on error (connectSse 내부에서 backoff 지연 후 호출됨)
      if (!mountedRef.current) return;
      connect();
    });
  }, [applyEvent, stateRef, playSoundForEvent, resetTracking, addAnimationFromEvent, clearAnimations]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [connect]);

  // SSE가 늦거나 일시 실패해도 초기 화면이 멈추지 않게 HTTP bootstrap 폴백을 주기적으로 적용한다.
  useEffect(() => {
    if (state.meta.lastSeq > 0) return;

    let cancelled = false;
    let timer: number | null = null;

    const runBootstrap = async () => {
      if (cancelled || stateRef.current.meta.lastSeq > 0) return;
      try {
        const boot = await fetchCurrentBootstrap(80);
        if (!boot || cancelled) return;
        if (boot.events.length > 0 && stateRef.current.meta.lastSeq === 0) {
          applyEvents(boot.events);
        }
      } catch {
        // bootstrap failure is non-fatal; retry loop continues
      }

      if (!cancelled && stateRef.current.meta.lastSeq === 0) {
        timer = window.setTimeout(runBootstrap, 1500);
      }
    };

    timer = window.setTimeout(runBootstrap, 120);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [state.meta.lastSeq, applyEvents, stateRef]);

  // Timer
  useEffect(() => {
    if (state.session.state !== 'LIVE' && state.session.state !== 'ENDING') return;
    const iv = setInterval(() => {
      if (state.session.startedAt) {
        setElapsed(Date.now() - state.session.startedAt);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [state.session.state, state.session.startedAt]);

  const isBootstrapping = !state.session.state && state.meta.lastSeq === 0;
  const isLobby = state.session.state === 'LOBBY';
  const isEnded = state.session.state === 'ENDED';
  const isRoguelike = state.session.isRoguelike;
  const runEnd = state.roguelike.runEnd;

  if (isBootstrapping) {
    return <div className="archive-empty">세션 연결 중입니다…</div>;
  }

  return (
    <div className="live-page">
      {isLobby ? (
        <LobbyView state={state} />
      ) : (
        <div className="live-layout">
          <Header state={state} elapsed={elapsed} volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMuted} />

          {isRoguelike && <FloorHeader state={state} />}

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

            {isRoguelike ? (
              <CharacterPanel state={state} />
            ) : (
              <div className="party-panel">
                <div className="party-panel-title">Party Status</div>
                {state.map.mapState?.tokens
                  .filter(t => t.kind === 'player' || t.kind === 'npc')
                  .map(t => (
                    <div
                      key={t.id}
                      className={`party-row ${t.hp <= 0 ? 'dead' : ''} ${t.kind === 'player' ? 'ally' : 'npc'}`}
                    >
                      <span className="party-name">
                        {t.name}
                      </span>
                      <span className="party-hp">
                        <span className={`party-hp-current ${t.hp <= 0 ? 'dead' : t.hp < t.hpMax * 0.3 ? 'warn' : 'ok'}`}>
                          {t.hp}
                        </span>
                        /{t.hpMax}
                      </span>
                    </div>
                  ))}

                <div className="party-panel-divider">Enemies</div>
                {state.map.mapState?.tokens
                  .filter(t => t.kind === 'enemy')
                  .map(t => (
                    <div key={t.id} className={`party-row enemy ${t.hp <= 0 ? 'dead' : ''}`}>
                      <span className="party-name">{t.name}</span>
                      <span className="party-hp">
                        <span className={`party-hp-current ${t.hp <= 0 ? 'dead' : 'enemy'}`}>
                          {t.hp}
                        </span>
                        /{t.hpMax}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Roguelike reward modal (brief flash before auto-selection) */}
      {isRoguelike && state.roguelike.rewardChoices && (
        <RewardModal
          choices={state.roguelike.rewardChoices}
          forCharacterName={state.roguelike.partyStatus.find(c => c.id === state.roguelike.rewardForCharacterId)?.name}
        />
      )}

      {/* Roguelike run end overlay */}
      {isRoguelike && runEnd && (
        <RunEndScreen runEnd={runEnd} sessionId={state.session.sessionId} />
      )}

      {/* Classic ended overlay */}
      {!isRoguelike && isEnded && state.ending.summary && (
        <div className="ending-overlay">
          <div className="ending-card">
            <h2 style={{ color: '#e94560', marginBottom: 12 }}>Session Ended</h2>
            <p style={{ marginBottom: 20, lineHeight: 1.6 }}>{state.ending.summary}</p>
            <Link
              to={`/replay/${state.session.sessionId}`}
              style={{
                display: 'inline-block', padding: '8px 24px',
                background: '#4ecdc4', color: '#1a1a2e',
                borderRadius: 4, textDecoration: 'none', fontWeight: 'bold',
              }}
            >
              Watch Replay
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
