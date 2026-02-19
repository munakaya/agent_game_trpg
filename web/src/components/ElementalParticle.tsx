import { CSSProperties, useEffect, useState } from 'react';

interface ElementalParticleProps {
  x: number;
  y: number;
  type: 'fire' | 'ice' | 'lightning' | 'physical';
  offsetX: number;
  offsetY: number;
}

export default function ElementalParticle({ x, y, type, offsetX, offsetY }: ElementalParticleProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const duration = 600;
    const startTime = performance.now();
    let rafId = 0;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);

      if (p < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // 타입별 색상과 이모지
  const getParticleStyle = () => {
    switch (type) {
      case 'fire':
        return { emoji: '🔥', color: '#ff4500', glow: '#ff8c00' };
      case 'ice':
        return { emoji: '❄️', color: '#00bfff', glow: '#87ceeb' };
      case 'lightning':
        return { emoji: '⚡', color: '#ffd700', glow: '#ffff00' };
      case 'physical':
        return { emoji: '💥', color: '#ffffff', glow: '#cccccc' };
      default:
        return { emoji: '✨', color: '#ffffff', glow: '#cccccc' };
    }
  };

  const { emoji, color, glow } = getParticleStyle();

  // 중력과 가속도 적용
  const gravity = type === 'fire' ? -30 : 50; // 불은 위로, 나머지는 아래로
  const currentX = x + offsetX * progress;
  const currentY = y + offsetY * progress + gravity * progress * progress;

  const opacity = 1 - progress;
  const scale = type === 'lightning' ? 1 + progress * 0.5 : 1 - progress * 0.5;

  const style: CSSProperties = {
    position: 'absolute',
    left: currentX,
    top: currentY,
    transform: `translate(-50%, -50%) scale(${scale})`,
    opacity,
    pointerEvents: 'none',
    zIndex: 100,
    fontSize: 16,
    filter: `drop-shadow(0 0 8px ${glow})`,
  };

  return (
    <div className="elemental-particle" style={style}>
      {emoji}
    </div>
  );
}
