import { useReducer, useCallback, useRef } from 'react';
import type { UIState, GameEvent } from './types';
import { initialState } from './types';
import { reduce, reduceMany, reset } from './reducer';

type GameAction =
  | { type: 'event'; event: GameEvent }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'reset' };

function gameReducer(state: UIState, action: GameAction): UIState {
  if (action.type === 'reset') return reset();
  if (action.type === 'events') return reduceMany(state, action.events);
  return reduce(state, action.event);
}

export function useGameState() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyEvent = useCallback((ev: GameEvent) => {
    dispatch({ type: 'event', event: ev });
  }, []);

  const applyEvents = useCallback((events: GameEvent[]) => {
    if (events.length === 0) return;
    dispatch({ type: 'events', events });
  }, []);

  const resetState = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  return { state, applyEvent, applyEvents, resetState, stateRef };
}
