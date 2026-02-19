import { useState, useEffect, useRef } from 'react';
import { AnimationManager } from './AnimationManager';
import type { GameEvent, AnimationState, DamageNumberState, ProjectileState, ParticleState, ElementalParticleState, SlashEffectState, ImpactEffectState, CameraEffectState } from '../types';

/**
 * 애니메이션 큐를 관리하는 React Hook
 */
export function useAnimationQueue(cellSize = 42) {
  const [activeAnimations, setActiveAnimations] = useState<Map<string, AnimationState>>(new Map());
  const [damageNumbers, setDamageNumbers] = useState<DamageNumberState[]>([]);
  const [projectiles, setProjectiles] = useState<ProjectileState[]>([]);
  const [particles, setParticles] = useState<ParticleState[]>([]);
  const [elementalParticles, setElementalParticles] = useState<ElementalParticleState[]>([]);
  const [slashEffects, setSlashEffects] = useState<SlashEffectState[]>([]);
  const [impactEffects, setImpactEffects] = useState<ImpactEffectState[]>([]);
  const [cameraEffect, setCameraEffect] = useState<CameraEffectState>({});
  const [shouldShake, setShouldShake] = useState(false);
  const [isHitStop, setIsHitStop] = useState(false);
  const managerRef = useRef<AnimationManager | null>(null);

  useEffect(() => {
    // AnimationManager 초기화
    managerRef.current = new AnimationManager((animations, damages, projs, parts, elemParts, slashes, impacts, camera, shake, hitStop) => {
      setActiveAnimations(animations);
      setDamageNumbers(damages);
      setProjectiles(projs);
      setParticles(parts);
      setElementalParticles(elemParts);
      setSlashEffects(slashes);
      setImpactEffects(impacts);
      setCameraEffect(camera);
      setShouldShake(shake);
      setIsHitStop(hitStop);
    }, cellSize);

    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, [cellSize]);

  const addAnimationFromEvent = (event: GameEvent, tokenPositions?: Map<string, { x: number; y: number }>) => {
    managerRef.current?.addAnimationFromEvent(event, tokenPositions);
  };

  const clear = () => {
    managerRef.current?.clear();
  };

  return {
    activeAnimations,
    damageNumbers,
    projectiles,
    particles,
    elementalParticles,
    slashEffects,
    impactEffects,
    cameraEffect,
    shouldShake,
    isHitStop,
    addAnimationFromEvent,
    clear,
  };
}
