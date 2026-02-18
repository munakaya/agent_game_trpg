import type { UIState } from '../state/types';

interface Props {
  state: UIState;
  elapsed?: number;
  volume?: number;
  muted?: boolean;
  onVolumeChange?: (v: number) => void;
  onToggleMute?: () => void;
}

const genreLabel: Record<string, string> = {
  fantasy: 'Fantasy',
  cyberpunk: 'Cyberpunk',
  zombie: 'Zombie',
};

export default function Header({ state, elapsed, volume, muted, onVolumeChange, onToggleMute }: Props) {
  const { session, combat } = state;

  const remaining = session.startedAt
    ? Math.max(0, 600 - Math.floor((elapsed ?? (Date.now() - session.startedAt)) / 1000))
    : null;

  const mins = remaining !== null ? Math.floor(remaining / 60) : '--';
  const secs = remaining !== null ? (remaining % 60).toString().padStart(2, '0') : '--';

  return (
    <div className="header-bar">
      <div className="header-title-wrap">
        <strong className="header-title">{session.title || 'Rise of Agents'}</strong>
        {session.genre && (
          <span className="header-chip">
            [{genreLabel[session.genre] ?? session.genre}]
          </span>
        )}
        {session.objective && (
          <span className="header-objective">
            {session.objective}
          </span>
        )}
      </div>
      <div className="header-meta">
        {combat.active && (
          <span className="header-round">
            Round {combat.round}
            {combat.currentActor && (
              <span className="header-actor">
                {' '}· {combat.currentActor.name}
              </span>
            )}
          </span>
        )}
        <span className={`header-timer ${session.state === 'ENDING' ? 'danger' : ''}`}>
          {mins}:{secs}
        </span>
        <span className={`header-state ${String(session.state || 'idle').toLowerCase()}`}>
          {session.state || 'IDLE'}
        </span>

        {onToggleMute && (
          <div className="volume-control">
            <button
              className="volume-btn"
              onClick={onToggleMute}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? '\u{1F507}' : volume !== undefined && volume < 0.3 ? '\u{1F509}' : '\u{1F50A}'}
            </button>
            {onVolumeChange && (
              <input
                type="range"
                className="volume-slider"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : (volume ?? 0.5)}
                onChange={e => onVolumeChange(parseFloat(e.target.value))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
