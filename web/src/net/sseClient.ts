import type { GameEvent } from '../state/types';

export interface SseConnection {
  close: () => void;
}

export function connectSse(
  fromSeq: number,
  onEvent: (ev: GameEvent) => void,
  onError?: () => void,
): SseConnection {
  const url = `/api/session/current/stream?fromSeq=${fromSeq}`;
  const es = new EventSource(url);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  es.onmessage = (e) => {
    if (closed) return;
    try {
      const ev: GameEvent = JSON.parse(e.data);
      onEvent(ev);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = () => {
    if (closed) return;
    es.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      onError?.();
    }, 2000);
  };

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      es.close();
    },
  };
}
