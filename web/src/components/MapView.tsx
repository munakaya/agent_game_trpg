import { CSSProperties, memo, useEffect, useMemo, useRef } from 'react';
import { Application, BaseTexture, Container, Graphics, SCALE_MODES, Sprite, Texture } from 'pixi.js';
import type {
  MapState,
  Token as TokenType,
  AnimationState,
  DamageNumberState,
  ProjectileState,
  ParticleState,
  ElementalParticleState,
  SlashEffectState,
  ImpactEffectState,
  CameraEffectState,
  ItemPickup,
} from '../state/types';
import DamageNumber from './DamageNumber';
import Projectile from './Projectile';
import CritParticle from './CritParticle';
import ElementalParticle from './ElementalParticle';
import SlashEffect from './SlashEffect';
import ImpactEffect from './ImpactEffect';
import { getLegendAvatarUri, getTokenAvatarUri, resolveTokenSpriteKey } from './pixelAvatar';

interface Props {
  mapState?: MapState;
  activeAnimations?: Map<string, AnimationState>;
  damageNumbers?: DamageNumberState[];
  projectiles?: ProjectileState[];
  particles?: ParticleState[];
  elementalParticles?: ElementalParticleState[];
  slashEffects?: SlashEffectState[];
  impactEffects?: ImpactEffectState[];
  cameraEffect?: CameraEffectState;
  shouldShake?: boolean;
  isHitStop?: boolean;
}

function tileStyle(ch: string, hasExit: boolean, hasItem: boolean): { fill: number; border: number } {
  if (hasExit) return { fill: 0x0f4f2a, border: 0x2a8f55 };
  if (hasItem || ch === 'I') return { fill: 0x193428, border: 0x2a5a44 };

  switch (ch) {
    case '#':
      return { fill: 0x3a3d4a, border: 0x505567 };
    case 'O':
      return { fill: 0x2d313d, border: 0x4e5263 };
    case 'D':
      return { fill: 0x533623, border: 0x7c563a };
    case 'H':
      return { fill: 0x5c1f25, border: 0x8f2c35 };
    case 'E':
      return { fill: 0x0f4f2a, border: 0x2a8f55 };
    default:
      return { fill: 0x121428, border: 0x222640 };
  }
}

function drawObstacleIcon(g: Graphics, x: number, y: number, cellSize: number): void {
  const p = Math.max(2, Math.floor(cellSize / 11));
  const ox = x + Math.floor(cellSize * 0.2);
  const oy = y + Math.floor(cellSize * 0.2);

  g.beginFill(0x7b808c, 1);
  g.drawRect(ox + p, oy + p, p * 2, p);
  g.drawRect(ox, oy + p * 2, p * 4, p * 2);
  g.drawRect(ox + p, oy + p * 4, p * 2, p);
  g.endFill();

  g.beginFill(0xa8adb8, 0.9);
  g.drawRect(ox + p * 2, oy + p * 2, p, p);
  g.endFill();
}

function drawItemIcon(g: Graphics, x: number, y: number, cellSize: number, itemType: string): void {
  const p = Math.max(2, Math.floor(cellSize / 12));
  const cx = x + Math.floor(cellSize / 2);
  const cy = y + Math.floor(cellSize / 2);

  const colorByType: Record<string, number> = {
    hp_potion: 0x40c057,
    atk_boost: 0xf08c00,
    def_boost: 0x4dabf7,
    spd_boost: 0xf783ac,
  };

  const color = colorByType[itemType] || 0xe9ecef;
  g.beginFill(color, 1);
  g.drawRect(cx - p, cy - p * 2, p * 2, p * 3);
  g.drawRect(cx - p * 2, cy - p, p * 4, p);
  g.endFill();

  g.beginFill(0xffffff, 0.8);
  g.drawRect(cx - p, cy - p * 2, p, p);
  g.endFill();
}

function drawExitIcon(g: Graphics, x: number, y: number, cellSize: number): void {
  const p = Math.max(2, Math.floor(cellSize / 12));
  const ox = x + Math.floor(cellSize * 0.22);
  const oy = y + Math.floor(cellSize * 0.18);

  g.beginFill(0x74c69d, 0.95);
  g.drawRect(ox, oy, p * 6, p * 7);
  g.endFill();

  g.beginFill(0x2d6a4f, 1);
  g.drawRect(ox + p, oy + p, p * 4, p * 5);
  g.endFill();

  g.beginFill(0xb7efc5, 1);
  g.drawRect(ox + p * 4, oy + p * 3, p, p);
  g.endFill();
}

function getTokenAnimationOffset(token: TokenType, animation: AnimationState | undefined, cellSize: number): { x: number; y: number; alpha: number; hitFlash: boolean } {
  if (!animation) return { x: 0, y: 0, alpha: token.hp <= 0 ? 0.45 : 1, hitFlash: false };

  if (animation.type === 'attack' && animation.target) {
    const dx = animation.target.x - token.x;
    const dy = animation.target.y - token.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const bump = Math.floor(cellSize * 0.22);
      return {
        x: (dx / len) * bump,
        y: (dy / len) * bump,
        alpha: token.hp <= 0 ? 0.45 : 1,
        hitFlash: false,
      };
    }
  }

  if (animation.type === 'death') {
    return { x: 0, y: 0, alpha: 0.2, hitFlash: false };
  }

  if (animation.type === 'hit') {
    return { x: 0, y: 0, alpha: token.hp <= 0 ? 0.45 : 1, hitFlash: true };
  }

  return { x: 0, y: 0, alpha: token.hp <= 0 ? 0.45 : 1, hitFlash: false };
}

function getStatusColor(token: TokenType): number | null {
  if (!token.status || token.status.length === 0) return null;

  if (token.status.some((s) => s.includes('freeze') || s.includes('frozen'))) {
    return 0x4dabf7;
  }
  if (token.status.some((s) => s.includes('poison'))) {
    return 0x69db7c;
  }
  if (token.status.some((s) => s.includes('burn') || s.includes('fire'))) {
    return 0xff922b;
  }

  return 0xe9ecef;
}

function MapView({
  mapState,
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
}: Props) {
  const ms = mapState;
  const pixiHostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const tileLayerRef = useRef<Container | null>(null);
  const tokenLayerRef = useRef<Container | null>(null);
  const textureCacheRef = useRef<Map<string, Texture>>(new Map());
  const cellSize = 42;
  const rows = ms?.rows ?? [];
  const tokens = ms?.tokens ?? [];
  const poi = ms?.poi ?? [];
  const items = ms?.items ?? [];
  const hasMap = rows.length > 0 && rows[0].length > 0;
  const mapWidth = hasMap ? rows[0].length * cellSize : cellSize;
  const mapHeight = hasMap ? rows.length * cellSize : cellSize;

  const animations = activeAnimations || new Map<string, AnimationState>();
  const damages = damageNumbers || [];
  const projs = projectiles || [];
  const parts = particles || [];
  const elemParts = elementalParticles || [];
  const slashes = slashEffects || [];
  const impacts = impactEffects || [];
  const camera = cameraEffect || {};

  const poiMap = useMemo(() => {
    const map = new Map<string, string>();
    poi.forEach((p) => {
      map.set(`${p.x},${p.y}`, p.type);
    });
    return map;
  }, [poi]);

  const itemMap = useMemo(() => {
    const map = new Map<string, ItemPickup>();
    items.forEach((item) => {
      map.set(`${item.x},${item.y}`, item);
    });
    return map;
  }, [items]);

  const legendSprites = useMemo(() => ({
    player: getLegendAvatarUri('fighter'),
    enemy: getLegendAvatarUri('grunt'),
    npc: getLegendAvatarUri('npc'),
    dead: getLegendAvatarUri('dead'),
  }), []);

  const cameraStyle: CSSProperties = {
    transform: `scale(${camera.zoom || 1.0})`,
    filter: `${camera.blur ? `blur(${camera.blur}px)` : ''} ${camera.chromaticAberration ? `drop-shadow(${camera.chromaticAberration}px 0 0 red) drop-shadow(-${camera.chromaticAberration}px 0 0 cyan)` : ''}`.trim(),
    transition: camera.zoom ? 'transform 100ms ease-out' : 'none',
    transformOrigin: 'top left',
    position: 'relative',
    width: mapWidth,
    height: mapHeight,
  };

  const ensureTexture = (uri: string): Texture => {
    const cached = textureCacheRef.current.get(uri);
    if (cached) return cached;

    const texture = Texture.from(uri);
    texture.baseTexture.scaleMode = SCALE_MODES.NEAREST;
    textureCacheRef.current.set(uri, texture);
    return texture;
  };

  useEffect(() => {
    if (!pixiHostRef.current || appRef.current) return;

    BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

    const app = new Application({
      width: mapWidth,
      height: mapHeight,
      antialias: false,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: Math.max(1, window.devicePixelRatio || 1),
    });

    pixiHostRef.current.innerHTML = '';
    pixiHostRef.current.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;

    const tileLayer = new Container();
    const tokenLayer = new Container();
    app.stage.addChild(tileLayer, tokenLayer);
    tileLayerRef.current = tileLayer;
    tokenLayerRef.current = tokenLayer;

    return () => {
      app.destroy(true, { children: true });
      appRef.current = null;
      tileLayerRef.current = null;
      tokenLayerRef.current = null;

      for (const texture of textureCacheRef.current.values()) {
        texture.destroy(true);
      }
      textureCacheRef.current.clear();
    };
  }, [mapHeight, mapWidth]);

  useEffect(() => {
    const app = appRef.current;
    const tileLayer = tileLayerRef.current;
    if (!app || !tileLayer || !hasMap) return;

    app.renderer.resize(mapWidth, mapHeight);
    tileLayer.removeChildren();

    const tiles = new Graphics();
    const decorations = new Graphics();

    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const key = `${x},${y}`;
        const hasExit = poiMap.get(key) === 'exit';
        const item = itemMap.get(key);
        const paint = tileStyle(ch, hasExit, !!item);

        const px = x * cellSize;
        const py = y * cellSize;

        tiles.beginFill(paint.fill, 1);
        tiles.drawRect(px, py, cellSize, cellSize);
        tiles.endFill();

        tiles.lineStyle(1, paint.border, 0.45);
        tiles.drawRect(px, py, cellSize, cellSize);

        if (ch === 'O') {
          drawObstacleIcon(decorations, px, py, cellSize);
        }

        if (item) {
          drawItemIcon(decorations, px, py, cellSize, item.type);
        }

        if (hasExit) {
          drawExitIcon(decorations, px, py, cellSize);
        }
      }
    }

    tileLayer.addChild(tiles, decorations);
  }, [cellSize, hasMap, itemMap, mapHeight, mapWidth, poiMap, rows]);

  useEffect(() => {
    const tokenLayer = tokenLayerRef.current;
    if (!tokenLayer || !hasMap) return;
    tokenLayer.removeChildren();

    for (const token of tokens) {
      const anim = animations.get(token.id);
      const animOffset = getTokenAnimationOffset(token, anim, cellSize);
      const statusColor = getStatusColor(token);

      const spriteSize = Math.floor(cellSize * 0.82);
      const baseX = token.x * cellSize + Math.floor((cellSize - spriteSize) / 2);
      const baseY = token.y * cellSize + Math.floor((cellSize - spriteSize) / 2);

      const haloColor = token.kind === 'player'
        ? 0x4ecdc4
        : token.kind === 'npc'
          ? 0xffe066
          : 0xe94560;

      const halo = new Graphics();
      halo.beginFill(haloColor, token.hp <= 0 ? 0.14 : 0.24);
      halo.drawRoundedRect(baseX - 2, baseY - 2, spriteSize + 4, spriteSize + 4, 6);
      halo.endFill();
      tokenLayer.addChild(halo);

      const avatarUri = getTokenAvatarUri(token);
      const texture = ensureTexture(avatarUri);
      const sprite = new Sprite(texture);

      sprite.x = baseX + animOffset.x;
      sprite.y = baseY + animOffset.y;
      sprite.width = spriteSize;
      sprite.height = spriteSize;
      sprite.alpha = animOffset.alpha;
      sprite.roundPixels = true;

      if (animOffset.hitFlash) {
        sprite.tint = 0xff8787;
      }

      tokenLayer.addChild(sprite);

      if (statusColor) {
        const statusRing = new Graphics();
        statusRing.lineStyle(2, statusColor, 0.95);
        statusRing.drawRoundedRect(baseX - 3, baseY - 3, spriteSize + 6, spriteSize + 6, 7);
        tokenLayer.addChild(statusRing);
      }

      if (token.hp <= 0 || resolveTokenSpriteKey(token) === 'dead') {
        const deadMark = new Graphics();
        deadMark.lineStyle(2, 0x212529, 0.8);
        deadMark.moveTo(baseX + 6, baseY + 6);
        deadMark.lineTo(baseX + spriteSize - 6, baseY + spriteSize - 6);
        deadMark.moveTo(baseX + spriteSize - 6, baseY + 6);
        deadMark.lineTo(baseX + 6, baseY + spriteSize - 6);
        tokenLayer.addChild(deadMark);
      }
    }
  }, [animations, cellSize, hasMap, tokens]);

  if (!hasMap) {
    return <div className="map-container" style={{ color: '#555', textAlign: 'center', padding: 40 }}>Map not loaded</div>;
  }

  return (
    <div className={`map-container ${shouldShake ? 'shake' : ''} ${isHitStop ? 'hitstop' : ''}`}>
      <div style={cameraStyle}>
        <div
          ref={pixiHostRef}
          className="pixi-map-root"
          style={{ width: mapWidth, height: mapHeight }}
        />

        <div
          className="token-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: mapWidth,
            height: mapHeight,
          }}
        >
          {damages.map((dmg) => (
            <DamageNumber
              key={dmg.id}
              value={dmg.value}
              x={dmg.x}
              y={dmg.y}
              type={dmg.type}
              onComplete={() => {}}
            />
          ))}

          {projs.map((proj) => (
            <Projectile
              key={proj.id}
              fromX={proj.fromX}
              fromY={proj.fromY}
              toX={proj.toX}
              toY={proj.toY}
              type={proj.type}
              onComplete={() => {}}
            />
          ))}

          {parts.map((particle) => (
            <CritParticle
              key={particle.id}
              x={particle.x}
              y={particle.y}
              offsetX={particle.offsetX}
              offsetY={particle.offsetY}
            />
          ))}

          {elemParts.map((particle) => (
            <ElementalParticle
              key={particle.id}
              x={particle.x}
              y={particle.y}
              type={particle.type}
              offsetX={particle.offsetX}
              offsetY={particle.offsetY}
            />
          ))}

          {slashes.map((slash) => (
            <SlashEffect
              key={slash.id}
              x={slash.x}
              y={slash.y}
              angle={slash.angle}
              type={slash.type}
              onComplete={() => {}}
            />
          ))}

          {impacts.map((impact) => (
            <ImpactEffect
              key={impact.id}
              x={impact.x}
              y={impact.y}
              type={impact.type}
              intensity={impact.intensity}
              onComplete={() => {}}
            />
          ))}
        </div>
      </div>

      <div className="map-legend">
        <span className="legend-item">
          <img src={legendSprites.player} className="legend-sprite" alt="player" /> Player
        </span>
        <span className="legend-item">
          <img src={legendSprites.enemy} className="legend-sprite" alt="enemy" /> Enemy
        </span>
        <span className="legend-item">
          <img src={legendSprites.npc} className="legend-sprite" alt="npc" /> NPC
        </span>
        <span className="legend-item">
          <img src={legendSprites.dead} className="legend-sprite" alt="dead" /> Dead
        </span>
        <span>Rock / Item / Exit are rendered in pixel tiles</span>
      </div>
    </div>
  );
}

export default memo(MapView);
