import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { soundEngine, SoundEngine } from './SoundEngine.js';
import { mapEventToSounds, resetSoundState } from './soundMap.js';
import type { GameEvent } from '../state/types.js';

const STALE_THRESHOLD_MS = 3000;

/** Subscribe to engine state changes for React re-renders */
const listeners = new Set<() => void>();
function notify() { listeners.forEach(fn => fn()); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

let snapshotVersion = 0;
function getSnapshot() { return snapshotVersion; }

function bumpSnapshot() {
  snapshotVersion++;
  notify();
}

export function useSoundEngine() {
  const disabledRef = useRef(false);
  const replayModeRef = useRef(false);

  // Force re-render when volume/muted changes
  useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    soundEngine.startBackgroundMusic();
    return () => {
      soundEngine.stopBackgroundMusic();
    };
  }, []);

  /** Play sounds for a game event (call before reducer) */
  const playSoundForEvent = useCallback((ev: GameEvent) => {
    if (disabledRef.current) return;
    if (soundEngine.muted) return;

    // Skip stale events on live mode (SSE reconnect flood)
    // In replay mode, timestamps are in the past so skip this check
    if (!replayModeRef.current && Date.now() - ev.t > STALE_THRESHOLD_MS) return;

    const effects = mapEventToSounds(ev);
    for (const effect of effects) {
      try { effect(soundEngine); } catch { /* ignore audio errors */ }
    }
  }, []);

  /** Temporarily disable sounds (e.g., during replay seek) */
  const setDisabled = useCallback((d: boolean) => {
    disabledRef.current = d;
    if (d) resetSoundState();
  }, []);

  /** Enable/disable replay mode (skips stale-event check) */
  const setReplayMode = useCallback((r: boolean) => {
    replayModeRef.current = r;
    if (r) resetSoundState();
  }, []);

  /** Reset sound tracking state (call on SSE reconnect) */
  const resetTracking = useCallback(() => {
    resetSoundState();
  }, []);

  const setVolume = useCallback((v: number) => {
    soundEngine.volume = v;
    bumpSnapshot();
  }, []);

  const setMuted = useCallback((m: boolean) => {
    soundEngine.muted = m;
    bumpSnapshot();
  }, []);

  const toggleMuted = useCallback(() => {
    soundEngine.muted = !soundEngine.muted;
    bumpSnapshot();
  }, []);

  return {
    playSoundForEvent,
    setDisabled,
    setReplayMode,
    resetTracking,
    volume: soundEngine.volume,
    muted: soundEngine.muted,
    setVolume,
    setMuted,
    toggleMuted,
    engine: soundEngine as SoundEngine,
  };
}
