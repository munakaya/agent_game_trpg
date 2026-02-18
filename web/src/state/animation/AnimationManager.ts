import type { GameEvent, AnimationState, DamageNumberState, ProjectileState, ParticleState, SlashEffectState, ImpactEffectState, CameraEffectState, ElementalParticleState } from '../types';

export type AnimationCallback = (
  animations: Map<string, AnimationState>,
  damageNumbers: DamageNumberState[],
  projectiles: ProjectileState[],
  particles: ParticleState[],
  elementalParticles: ElementalParticleState[],
  slashEffects: SlashEffectState[],
  impactEffects: ImpactEffectState[],
  cameraEffect: CameraEffectState,
  shouldShake: boolean,
  isHitStop: boolean
) => void;

export class AnimationManager {
  private queue: AnimationState[] = [];
  private activeAnimations = new Map<string, AnimationState>();
  private damageNumbers: DamageNumberState[] = [];
  private projectiles: ProjectileState[] = [];
  private particles: ParticleState[] = [];
  private elementalParticles: ElementalParticleState[] = [];
  private slashEffects: SlashEffectState[] = [];
  private impactEffects: ImpactEffectState[] = [];
  private cameraEffect: CameraEffectState = {};
  private isHitStop = false;
  private tokenPositions = new Map<string, { x: number; y: number }>(); // 토큰 위치 추적
  private cellSize = 42; // MapView의 cellSize와 동일
  private isPlaying = false;
  private callback?: AnimationCallback;
  private damageNumberIdCounter = 0;
  private projectileIdCounter = 0;
  private particleIdCounter = 0;
  private elementalParticleIdCounter = 0;
  private slashEffectIdCounter = 0;
  private impactEffectIdCounter = 0;
  private shouldShake = false;
  private readonly MAX_CONCURRENT_ANIMATIONS = 10; // 동시 애니메이션 제한
  private readonly MAX_DAMAGE_NUMBERS = 8; // 동시 데미지 숫자 제한
  private readonly MAX_PROJECTILES = 5; // 동시 발사체 제한
  private readonly MAX_PARTICLES = 12; // 동시 파티클 제한
  private readonly MAX_ELEMENTAL_PARTICLES = 20; // 동시 속성 파티클 제한
  private readonly MAX_SLASH_EFFECTS = 5; // 동시 슬래시 이펙트 제한
  private readonly MAX_IMPACT_EFFECTS = 5; // 동시 임팩트 이펙트 제한

  constructor(callback?: AnimationCallback, cellSize = 42) {
    this.callback = callback;
    this.cellSize = cellSize;
  }

  /**
   * 게임 이벤트를 받아서 애니메이션 큐에 추가
   * @param event 게임 이벤트
   * @param tokenPositions 현재 토큰 위치 맵 (tokenId -> {x, y})
   */
  addAnimationFromEvent(event: GameEvent, tokenPositions?: Map<string, { x: number; y: number }>): void {
    if (tokenPositions) {
      this.tokenPositions = tokenPositions;
    }

    const animations = this.eventToAnimations(event);

    for (const anim of animations) {
      this.queue.push(anim);
    }

    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * 이벤트 타입에 따라 애니메이션 생성
   */
  private eventToAnimations(event: GameEvent): AnimationState[] {
    const result: AnimationState[] = [];

    switch (event.type) {
      case 'token_moved': {
        const { tokenId, to } = event.payload;
        result.push({
          tokenId,
          type: 'move',
          target: to,
          duration: 300,
        });
        break;
      }

      case 'attack_resolved': {
        const { attackerId, targetId, toHit, damage } = event.payload;

        // Miss인 경우
        if (!toHit?.hit) {
          result.push({
            tokenId: targetId,
            type: 'miss',
            duration: 400,
          });

          // MISS 텍스트 표시
          const pos = this.tokenPositions.get(targetId);
          if (pos) {
            const pixelX = pos.x * this.cellSize + this.cellSize / 2;
            const pixelY = pos.y * this.cellSize;
            this.addDamageNumber(0, pixelX, pixelY, 'miss');
          }
        } else {
          // 공격자의 bump attack 애니메이션
          const attackerPos = this.tokenPositions.get(attackerId);
          const targetPos = this.tokenPositions.get(targetId);

          if (attackerPos && targetPos) {
            // 거리 계산
            const dx = targetPos.x - attackerPos.x;
            const dy = targetPos.y - attackerPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // 원거리 공격 (거리 > 1.5)
            if (distance > 1.5) {
              const fromPixelX = attackerPos.x * this.cellSize + this.cellSize / 2;
              const fromPixelY = attackerPos.y * this.cellSize + this.cellSize / 2;
              const toPixelX = targetPos.x * this.cellSize + this.cellSize / 2;
              const toPixelY = targetPos.y * this.cellSize + this.cellSize / 2;

              // 발사체 타입 결정 (나중에 토큰 종류에 따라 변경 가능)
              const projectileType = 'arrow';
              this.addProjectile(fromPixelX, fromPixelY, toPixelX, toPixelY, projectileType);
            } else {
              // 근접 공격
              result.push({
                tokenId: attackerId,
                type: 'attack',
                target: targetPos,
                duration: 400,
              });

              // 슬래시 이펙트 추가 (근접 공격만)
              const slashX = (attackerPos.x + targetPos.x) / 2 * this.cellSize + this.cellSize / 2;
              const slashY = (attackerPos.y + targetPos.y) / 2 * this.cellSize + this.cellSize / 2;
              const angle = Math.atan2(dy, dx);
              this.addSlashEffect(slashX, slashY, angle, 'physical');
            }

            // 임팩트 이펙트 추가 (타격 성공 시)
            const targetPixelX = targetPos.x * this.cellSize + this.cellSize / 2;
            const targetPixelY = targetPos.y * this.cellSize + this.cellSize / 2;
            const isCritical = damage?.amount && damage.amount >= 15;
            this.addImpactEffect(targetPixelX, targetPixelY, 'physical', isCritical ? 'critical' : 'normal');

            // 타격감 효과
            if (isCritical) {
              // 크리티컬: 강한 효과
              this.triggerHitStop(100);
              this.triggerZoomPulse(0.08);
              this.triggerChromaticAberration(8, 250);
            } else {
              // 일반 공격: 약한 효과
              this.triggerHitStop(60);
              this.triggerZoomPulse(0.03);
            }

            // 치명타 판정 (데미지가 15 이상이면 치명타로 간주)
            if (damage?.amount && damage.amount >= 15) {
              const pixelX = targetPos.x * this.cellSize + this.cellSize / 2;
              const pixelY = targetPos.y * this.cellSize + this.cellSize / 2;
              this.addParticle(pixelX, pixelY, 'crit');
              // 속성 파티클 추가 (물리 속성)
              this.addElementalParticle(pixelX, pixelY, 'physical');
            }
          } else {
            // 위치 정보가 없으면 기본 공격 애니메이션
            result.push({
              tokenId: attackerId,
              type: 'attack',
              duration: 400,
            });
          }
        }
        break;
      }

      case 'hp_changed': {
        const { targetId, from, to, reason } = event.payload;
        const delta = to - from;

        if (reason === 'damage' || reason === 'hazard') {
          // 타격 효과
          result.push({
            tokenId: targetId,
            type: 'hit',
            value: Math.abs(delta),
            duration: 200,
          });

          // 데미지 숫자 표시
          const pos = this.tokenPositions.get(targetId);
          if (pos) {
            const pixelX = pos.x * this.cellSize + this.cellSize / 2;
            const pixelY = pos.y * this.cellSize;
            const damageAmount = Math.abs(delta);
            // 크리티컬 판정: 15 이상
            const damageType = damageAmount >= 15 ? 'critical' : 'damage';
            this.addDamageNumber(damageAmount, pixelX, pixelY, damageType);
          }

          // 높은 데미지 시 화면 흔들림 (10 이상)
          if (Math.abs(delta) >= 10) {
            this.triggerShake();
          }

          // HP가 0이 되면 사망 애니메이션
          if (to <= 0) {
            result.push({
              tokenId: targetId,
              type: 'death',
              duration: 500,
            });
          }
        } else if (reason === 'heal') {
          // 회복 숫자 표시
          const pos = this.tokenPositions.get(targetId);
          if (pos) {
            const pixelX = pos.x * this.cellSize + this.cellSize / 2;
            const pixelY = pos.y * this.cellSize;
            this.addDamageNumber(delta, pixelX, pixelY, 'heal');
          }
        }
        break;
      }
    }

    return result;
  }

  /**
   * 애니메이션 큐의 다음 항목을 재생
   */
  private async playNext(): Promise<void> {
    // 큐가 너무 길면 일부 스킵 (성능 최적화)
    if (this.queue.length > this.MAX_CONCURRENT_ANIMATIONS) {
      // 오래된 애니메이션 중 일부를 즉시 완료 처리
      const skipCount = this.queue.length - this.MAX_CONCURRENT_ANIMATIONS;
      this.queue.splice(0, skipCount);
    }

    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const anim = this.queue.shift()!;

    // 애니메이션 활성화
    this.activeAnimations.set(anim.tokenId, anim);
    this.notifyCallback();

    // 애니메이션 재생 대기
    await new Promise((resolve) => setTimeout(resolve, anim.duration || 300));

    // 애니메이션 제거
    this.activeAnimations.delete(anim.tokenId);
    this.notifyCallback();

    // 다음 애니메이션 재생
    this.playNext();
  }

  /**
   * 콜백 호출 (상태 업데이트용)
   */
  private notifyCallback(): void {
    if (this.callback) {
      this.callback(
        new Map(this.activeAnimations),
        [...this.damageNumbers],
        [...this.projectiles],
        [...this.particles],
        [...this.elementalParticles],
        [...this.slashEffects],
        [...this.impactEffects],
        { ...this.cameraEffect },
        this.shouldShake,
        this.isHitStop
      );
    }
  }

  /**
   * 화면 흔들림 트리거
   */
  triggerShake(): void {
    this.shouldShake = true;
    this.notifyCallback();

    // 150ms 후 shake 해제
    setTimeout(() => {
      this.shouldShake = false;
      this.notifyCallback();
    }, 150);
  }

  /**
   * Hit Stop 트리거 (프레임 멈춤 효과)
   */
  triggerHitStop(duration: number = 80): void {
    this.isHitStop = true;
    this.notifyCallback();

    setTimeout(() => {
      this.isHitStop = false;
      this.notifyCallback();
    }, duration);
  }

  /**
   * 줌 펄스 효과
   */
  triggerZoomPulse(intensity: number = 0.05): void {
    // Zoom in
    this.cameraEffect.zoom = 1 + intensity;
    this.notifyCallback();

    // Zoom out (smooth)
    setTimeout(() => {
      this.cameraEffect.zoom = 1.0;
      this.notifyCallback();
    }, 100);
  }

  /**
   * 색수차 효과 (Chromatic Aberration)
   */
  triggerChromaticAberration(strength: number = 5, duration: number = 200): void {
    this.cameraEffect.chromaticAberration = strength;
    this.notifyCallback();

    setTimeout(() => {
      this.cameraEffect.chromaticAberration = 0;
      this.notifyCallback();
    }, duration);
  }

  /**
   * 모션 블러 효과
   */
  triggerMotionBlur(strength: number = 3, duration: number = 150): void {
    this.cameraEffect.blur = strength;
    this.notifyCallback();

    setTimeout(() => {
      this.cameraEffect.blur = 0;
      this.notifyCallback();
    }, duration);
  }

  /**
   * 발사체 추가
   */
  addProjectile(fromX: number, fromY: number, toX: number, toY: number, type: 'arrow' | 'magic' | 'bullet'): void {
    // 동시 발사체 제한
    if (this.projectiles.length >= this.MAX_PROJECTILES) {
      this.projectiles.shift();
    }

    const id = `proj-${this.projectileIdCounter++}`;
    this.projectiles.push({ id, fromX, fromY, toX, toY, type });
    this.notifyCallback();

    // 250ms 후 제거
    setTimeout(() => {
      this.projectiles = this.projectiles.filter(p => p.id !== id);
      this.notifyCallback();
    }, 250);
  }

  /**
   * 파티클 추가 (치명타, 스파클 등)
   */
  addParticle(x: number, y: number, type: 'crit' | 'sparkle'): void {
    // 동시 파티클 제한
    if (this.particles.length >= this.MAX_PARTICLES) {
      this.particles.shift();
    }

    // 여러 파티클을 랜덤 방향으로 생성
    const count = type === 'crit' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const id = `particle-${this.particleIdCounter++}`;
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const distance = 20 + Math.random() * 20;
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;

      this.particles.push({ id, x, y, type, offsetX, offsetY });

      // 800ms 후 제거
      setTimeout(() => {
        this.particles = this.particles.filter(p => p.id !== id);
        this.notifyCallback();
      }, 800);
    }

    this.notifyCallback();
  }

  /**
   * 속성 파티클 추가 (불, 얼음, 번개, 물리)
   */
  addElementalParticle(x: number, y: number, type: 'fire' | 'ice' | 'lightning' | 'physical'): void {
    // 동시 파티클 제한
    if (this.elementalParticles.length >= this.MAX_ELEMENTAL_PARTICLES) {
      this.elementalParticles.shift();
    }

    // 여러 파티클을 랜덤 방향으로 생성
    const count = type === 'lightning' ? 8 : type === 'fire' ? 12 : 6;
    for (let i = 0; i < count; i++) {
      const id = `elem-particle-${this.elementalParticleIdCounter++}`;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8;
      const distance = 30 + Math.random() * 40;
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;

      this.elementalParticles.push({ id, x, y, type, offsetX, offsetY });

      // 600ms 후 제거
      setTimeout(() => {
        this.elementalParticles = this.elementalParticles.filter(p => p.id !== id);
        this.notifyCallback();
      }, 600);
    }

    this.notifyCallback();
  }

  /**
   * 데미지 숫자 추가
   */
  addDamageNumber(value: number, x: number, y: number, type: 'damage' | 'heal' | 'miss' | 'critical' | 'weak'): void {
    // 동시 데미지 숫자 제한
    if (this.damageNumbers.length >= this.MAX_DAMAGE_NUMBERS) {
      // 가장 오래된 것 제거
      this.damageNumbers.shift();
    }

    const id = `dmg-${this.damageNumberIdCounter++}`;
    this.damageNumbers.push({ id, value, x, y, type });
    this.notifyCallback();

    // 600ms 후 제거
    setTimeout(() => {
      this.damageNumbers = this.damageNumbers.filter(d => d.id !== id);
      this.notifyCallback();
    }, 600);
  }

  /**
   * 슬래시 이펙트 추가
   */
  addSlashEffect(x: number, y: number, angle: number, type: 'physical' | 'magic' | 'fire' | 'ice' | 'lightning' = 'physical'): void {
    if (this.slashEffects.length >= this.MAX_SLASH_EFFECTS) {
      this.slashEffects.shift();
    }

    const id = `slash-${this.slashEffectIdCounter++}`;
    this.slashEffects.push({ id, x, y, angle, type });
    this.notifyCallback();

    // 300ms 후 제거
    setTimeout(() => {
      this.slashEffects = this.slashEffects.filter(s => s.id !== id);
      this.notifyCallback();
    }, 300);
  }

  /**
   * 임팩트 이펙트 추가
   */
  addImpactEffect(x: number, y: number, type: 'physical' | 'magic' | 'fire' | 'ice' | 'lightning' = 'physical', intensity: 'normal' | 'critical' = 'normal'): void {
    if (this.impactEffects.length >= this.MAX_IMPACT_EFFECTS) {
      this.impactEffects.shift();
    }

    const id = `impact-${this.impactEffectIdCounter++}`;
    this.impactEffects.push({ id, x, y, type, intensity });
    this.notifyCallback();

    // 300ms (normal) 또는 400ms (critical) 후 제거
    const duration = intensity === 'critical' ? 400 : 300;
    setTimeout(() => {
      this.impactEffects = this.impactEffects.filter(i => i.id !== id);
      this.notifyCallback();
    }, duration);
  }

  /**
   * 현재 활성화된 애니메이션 가져오기
   */
  getActiveAnimations(): Map<string, AnimationState> {
    return new Map(this.activeAnimations);
  }

  /**
   * 애니메이션 큐 초기화
   */
  clear(): void {
    this.queue = [];
    this.activeAnimations.clear();
    this.damageNumbers = [];
    this.projectiles = [];
    this.particles = [];
    this.elementalParticles = [];
    this.slashEffects = [];
    this.impactEffects = [];
    this.cameraEffect = {};
    this.isHitStop = false;
    this.isPlaying = false;
    this.notifyCallback();
  }

  /**
   * 토큰 위치 설정 (데미지 숫자 위치 계산용)
   */
  setTokenPosition(tokenId: string, x: number, y: number): void {
    // 이 정보는 데미지 숫자 표시 시 사용됩니다
  }
}
