import { useEffect, useState, CSSProperties } from 'react';

interface ProjectileProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: 'arrow' | 'magic' | 'bullet';
  onComplete: () => void;
}

export default function Projectile({ fromX, fromY, toX, toY, type, onComplete }: ProjectileProps) {
  const [progress, setProgress] = useState(0);
  const duration = 250; // 250ms로 빠르게 이동

  useEffect(() => {
    const startTime = performance.now();
    let rafId = 0;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const newProgress = Math.min(elapsed / duration, 1);
      setProgress(newProgress);

      if (newProgress < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        onComplete();
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [duration, onComplete]);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const currentX = fromX + dx * progress;
  const currentY = fromY + dy * progress;

  const style: CSSProperties = {
    position: 'absolute',
    left: currentX,
    top: currentY,
    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
    pointerEvents: 'none',
    zIndex: 50,
  };

  // 발사체 타입별 스타일
  const getProjectileContent = () => {
    switch (type) {
      case 'arrow':
        return <div className="projectile-arrow">➤</div>;
      case 'magic':
        return <div className="projectile-magic">✦</div>;
      case 'bullet':
        return <div className="projectile-bullet">●</div>;
      default:
        return <div className="projectile-default">•</div>;
    }
  };

  return <div style={style}>{getProjectileContent()}</div>;
}
