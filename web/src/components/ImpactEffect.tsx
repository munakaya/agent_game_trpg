import { CSSProperties, useEffect, useRef, useState } from 'react';

interface ImpactEffectProps {
  x: number;
  y: number;
  type?: 'physical' | 'magic' | 'fire' | 'ice' | 'lightning';
  intensity?: 'normal' | 'critical';
  onComplete: () => void;
}

export default function ImpactEffect({ x, y, type = 'physical', intensity = 'normal', onComplete }: ImpactEffectProps) {
  const [scale, setScale] = useState(0.3);
  const [opacity, setOpacity] = useState(1);
  const gradientIdRef = useRef(`impact-gradient-${Math.random().toString(36).slice(2)}`);
  const duration = intensity === 'critical' ? 400 : 300;

  useEffect(() => {
    const timer = setTimeout(onComplete, duration);
    let rafId = 0;

    // Scale and fade animation
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = elapsed / duration;

      // Scale: 0.3 -> 2.0 (elastic easing)
      const elasticScale = 0.3 + (1.7 * (1 - Math.pow(1 - progress, 3)));
      setScale(elasticScale);

      // Fade out
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
  const getColors = () => {
    switch (type) {
      case 'physical':
        return { primary: '#ffffff', secondary: '#cbd5e1' };
      case 'magic':
        return { primary: '#a855f7', secondary: '#7c3aed' };
      case 'fire':
        return { primary: '#f87171', secondary: '#dc2626' };
      case 'ice':
        return { primary: '#60a5fa', secondary: '#2563eb' };
      case 'lightning':
        return { primary: '#fbbf24', secondary: '#f59e0b' };
      default:
        return { primary: '#ffffff', secondary: '#cbd5e1' };
    }
  };

  const { primary, secondary } = getColors();
  const size = intensity === 'critical' ? 120 : 80;

  const style: CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    transform: `translate(-50%, -50%) scale(${scale})`,
    pointerEvents: 'none',
    zIndex: 55,
    opacity,
  };

  const gradientId = gradientIdRef.current;

  return (
    <div style={style} className="impact-effect">
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor={primary} stopOpacity="0.8" />
            <stop offset="50%" stopColor={secondary} stopOpacity="0.4" />
            <stop offset="100%" stopColor={secondary} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer ring */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={primary}
          strokeWidth="3"
          opacity="0.6"
        />

        {/* Inner burst */}
        <circle
          cx="50"
          cy="50"
          r="30"
          fill={`url(#${gradientId})`}
        />

        {/* Radial lines */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = 50 + Math.cos(rad) * 20;
          const y1 = 50 + Math.sin(rad) * 20;
          const x2 = 50 + Math.cos(rad) * 40;
          const y2 = 50 + Math.sin(rad) * 40;

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={primary}
              strokeWidth="2"
              opacity="0.8"
            />
          );
        })}
      </svg>
    </div>
  );
}
