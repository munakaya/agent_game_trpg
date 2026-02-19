import { useEffect, memo, useState } from 'react';

interface DamageNumberProps {
  value: number;
  x: number;
  y: number;
  type: 'damage' | 'heal' | 'miss' | 'critical' | 'weak';
  onComplete: () => void;
}

function DamageNumberComponent({ value, x, y, type, onComplete }: DamageNumberProps) {
  const [scale, setScale] = useState(0.5);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const duration = type === 'critical' ? 800 : 600;
    const timer = setTimeout(onComplete, duration);
    let rafId = 0;

    // Elastic popup animation
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Elastic scale: overshoot then settle
      if (progress < 0.3) {
        const t = progress / 0.3;
        setScale(0.5 + t * 1.8); // 0.5 -> 2.3
      } else if (progress < 0.5) {
        const t = (progress - 0.3) / 0.2;
        setScale(2.3 - t * 0.5); // 2.3 -> 1.8
      } else {
        setScale(1.8 - (progress - 0.5) * 0.8); // 1.8 -> 1.0
      }

      // Fade out at the end
      if (progress > 0.7) {
        setOpacity(1 - (progress - 0.7) / 0.3);
      }

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [onComplete, type]);

  const isCritical = type === 'critical';
  const isWeak = type === 'weak';

  return (
    <div
      className={`damage-number-enhanced damage-${type}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        pointerEvents: 'none',
      }}
    >
      {type === 'miss' ? (
        <span className="damage-text-miss">MISS</span>
      ) : (
        <>
          {isCritical && <span className="damage-label">CRITICAL!</span>}
          {isWeak && <span className="damage-label weak">WEAK!</span>}
          <span className="damage-value">{value}</span>
        </>
      )}
    </div>
  );
}

// React.memo로 메모이제이션
export default memo(DamageNumberComponent);
