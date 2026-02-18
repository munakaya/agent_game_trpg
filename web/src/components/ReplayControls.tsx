interface Props {
  playing: boolean;
  speed: number;
  progress: number; // 0..1
  onTogglePlay: () => void;
  onSetSpeed: (speed: number) => void;
  onSeek: (ratio: number) => void;
}

export default function ReplayControls({ playing, speed, progress, onTogglePlay, onSetSpeed, onSeek }: Props) {
  return (
    <div className="replay-controls">
      <button className="replay-btn" onClick={onTogglePlay}>
        {playing ? 'Pause' : 'Play'}
      </button>

      <button
        className={`replay-btn ${speed === 1 ? 'active' : ''}`}
        onClick={() => onSetSpeed(1)}
      >
        1x
      </button>
      <button
        className={`replay-btn ${speed === 2 ? 'active' : ''}`}
        onClick={() => onSetSpeed(2)}
      >
        2x
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="replay-slider"
      />

      <span className="replay-percent">
        {Math.round(progress * 100)}%
      </span>
    </div>
  );
}
