import { CSSProperties, useEffect, useRef, useState } from 'react';

interface SlashEffectProps {
  x: number;
  y: number;
  angle: number; // 공격 방향 (라디안)
  type?: 'physical' | 'magic' | 'fire' | 'ice' | 'lightning';
  onComplete: () => void;
}

export default function SlashEffect({ x, y, angle, type = 'physical', onComplete }: SlashEffectProps) {
  const [opacity, setOpacity] = useState(1);
  const gradientIdRef = useRef(`slash-gradient-${Math.random().toString(36).slice(2)}`);
  const duration = 300;

  useEffect(() => {
    const timer = setTimeout(onComplete, duration);
    let rafId = 0;

    // Fade out animation
    const fadeStart = performance.now();
    const animate = (now: number) => {
      const elapsed = now - fadeStart;
      const progress = elapsed / duration;
      setOpacity(1 - progress);

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [onComplete, duration]);

  // 타입별 색상
  const getColor = () => {
    switch (type) {
      case 'physical': return '#ffffff';
      case 'magic': return '#9333ea';
      case 'fire': return '#ef4444';
      case 'ice': return '#3b82f6';
      case 'lightning': return '#eab308';
      default: return '#ffffff';
    }
  };

  const color = getColor();
  const angleDeg = (angle * 180) / Math.PI;

  const style: CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
    pointerEvents: 'none',
    zIndex: 60,
    opacity,
  };

  const gradientId = gradientIdRef.current;

  return (
    <div style={style} className="slash-effect">
      <svg width="80" height="80" viewBox="0 0 80 80" style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="50%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Arc slash */}
        <path
          d="M 10 40 Q 40 20, 70 40"
          stroke={`url(#${gradientId})`}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 10 40 Q 40 20, 70 40"
          stroke={color}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
    </div>
  );
}
