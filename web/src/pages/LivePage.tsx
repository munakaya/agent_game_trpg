import { useEffect, useRef, useCallback, useState } from 'react';
import { useGameState } from '../state/useGameState';
import { connectSse } from '../net/sseClient';
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

export default function LivePage() {
  const { state, applyEvent, stateRef } = useGameState();
  const { playSoundForEvent, resetTracking, volume, muted, setVolume, toggleMuted } = useSoundEngine();
  const { activeAnimations, damageNumbers, projectiles, particles, elementalParticles, slashEffects, impactEffects, cameraEffect, shouldShake, isHitStop, addAnimationFromEvent, clear: clearAnimations } = useAnimationQueue();
  const sseRef = useRef<{ close: () => void } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const connect = useCallback(() => {
    const fromSeq = stateRef.current.meta.lastSeq + 1;
    sseRef.current?.close();
    resetTracking(); // Reset sound state on reconnect
    clearAnimations(); // Reset animation state on reconnect
    sseRef.current = connectSse(fromSeq, (ev: GameEvent) => {
      playSoundForEvent(ev);

      // 토큰 위치 맵 생성
      const tokenPositions = new Map<string, { x: number; y: number }>();
      stateRef.current.map.mapState?.tokens.forEach(t => {
        tokenPositions.set(t.id, { x: t.x, y: t.y });
      });

      addAnimationFromEvent(ev, tokenPositions); // 애니메이션 트리거
      applyEvent(ev);
    }, () => {
      // Reconnect on error
      setTimeout(() => connect(), 2000);
    });
  }, [applyEvent, stateRef, playSoundForEvent, resetTracking, addAnimationFromEvent, clearAnimations]);

  useEffect(() => {
    connect();
    return () => sseRef.current?.close();
  }, [connect]);

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

  const isLobby = !state.session.state || state.session.state === 'LOBBY';
  const isEnded = state.session.state === 'ENDED';
  const isRoguelike = state.session.isRoguelike;
  const runEnd = state.roguelike.runEnd;

  return (
    <div>
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
              /* Classic mode: Token HP list */
              <div style={{
                background: '#16213e', borderRadius: 8, padding: 12,
                fontSize: 13, flex: 1, overflow: 'auto',
              }}>
                <div style={{ color: '#aaa', marginBottom: 8 }}>Party Status</div>
                {state.map.mapState?.tokens
                  .filter(t => t.kind === 'player' || t.kind === 'npc')
                  .map(t => (
                    <div key={t.id} style={{
                      display: 'flex', justifyContent: 'space-between',
                      marginBottom: 4, padding: '2px 4px',
                      borderRadius: 4, background: 'rgba(255,255,255,0.03)',
                    }}>
                      <span style={{ color: t.kind === 'player' ? '#4ecdc4' : '#ffe66d' }}>
                        {t.name}
                      </span>
                      <span>
                        <span style={{
                          color: t.hp <= 0 ? '#e94560' : t.hp < t.hpMax * 0.3 ? '#ffe66d' : '#4ecdc4',
                        }}>
                          {t.hp}
                        </span>
                        /{t.hpMax}
                      </span>
                    </div>
                  ))}

                <div style={{ color: '#aaa', marginTop: 12, marginBottom: 8 }}>Enemies</div>
                {state.map.mapState?.tokens
                  .filter(t => t.kind === 'enemy')
                  .map(t => (
                    <div key={t.id} style={{
                      display: 'flex', justifyContent: 'space-between',
                      marginBottom: 4, padding: '2px 4px',
                      borderRadius: 4, background: 'rgba(255,255,255,0.03)',
                    }}>
                      <span style={{ color: '#e94560' }}>{t.name}</span>
                      <span style={{ color: t.hp <= 0 ? '#555' : '#e94560' }}>
                        {t.hp}/{t.hpMax}
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
