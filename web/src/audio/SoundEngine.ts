/**
 * SoundEngine — Web Audio API manager for TRPG sound effects.
 * Handles AudioContext lifecycle, master volume, and provides
 * utility methods for synthesizing sounds programmatically.
 */

import { BGM_MAIN_TRACK, SFX_LIBRARY, type SfxKey } from './audioLibrary.js';

const STORAGE_KEY = 'trpg_sound_prefs';
const BGM_VOLUME_SCALE = 0.35;
const MAX_POOL_PER_FILE = 8;

interface SoundPrefs {
  volume: number;
  muted: boolean;
}

function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { volume: 0.5, muted: false };
}

function savePrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

export interface Envelope {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume: number;
  private _muted: boolean;
  private noiseBuffer: AudioBuffer | null = null;
  private sfxPool = new Map<string, HTMLAudioElement[]>();
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmPath = '';

  constructor() {
    const prefs = loadPrefs();
    this._volume = prefs.volume;
    this._muted = prefs.muted;
  }

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.effectiveVolume(1);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  get destination(): GainNode {
    this.ensureContext();
    return this.masterGain!;
  }

  get now(): number {
    return this.ensureContext().currentTime;
  }

  get sampleRate(): number {
    return this.ensureContext().sampleRate;
  }

  private effectiveVolume(scale = 1): number {
    if (this._muted) return 0;
    return Math.max(0, Math.min(1, this._volume * scale));
  }

  private syncVolumes() {
    if (this.masterGain) {
      this.masterGain.gain.value = this.effectiveVolume(1);
    }
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.effectiveVolume(BGM_VOLUME_SCALE);
    }
  }

  private createAudio(path: string): HTMLAudioElement {
    const audio = new Audio(path);
    audio.preload = 'auto';
    return audio;
  }

  private getAudioFromPool(path: string): HTMLAudioElement {
    let pool = this.sfxPool.get(path);
    if (!pool) {
      pool = [this.createAudio(path), this.createAudio(path)];
      this.sfxPool.set(path, pool);
    }

    const reusable = pool.find(a => a.paused || a.ended);
    if (reusable) return reusable;

    const extra = this.createAudio(path);
    pool.push(extra);
    if (pool.length > MAX_POOL_PER_FILE) {
      pool.shift();
    }
    return extra;
  }

  playSfx(key: SfxKey, gain = 1) {
    const candidates = SFX_LIBRARY[key];
    if (!candidates || candidates.length === 0) return;

    const idx = candidates.length === 1 ? 0 : Math.floor(Math.random() * candidates.length);
    const path = candidates[idx];
    if (!path) return;

    const audio = this.getAudioFromPool(path);
    audio.currentTime = 0;
    audio.volume = this.effectiveVolume(gain);
    void audio.play().catch(() => {
      // ignore autoplay / decode errors
    });
  }

  startBackgroundMusic() {
    if (this.bgmAudio && this.bgmPath === BGM_MAIN_TRACK) {
      if (this.bgmAudio.paused) {
        this.bgmAudio.volume = this.effectiveVolume(BGM_VOLUME_SCALE);
        void this.bgmAudio.play().catch(() => {
          // ignore autoplay errors
        });
      }
      return;
    }

    this.stopBackgroundMusic();

    const bgm = this.createAudio(BGM_MAIN_TRACK);
    bgm.loop = true;
    bgm.volume = this.effectiveVolume(BGM_VOLUME_SCALE);
    this.bgmAudio = bgm;
    this.bgmPath = BGM_MAIN_TRACK;

    void bgm.play().catch(() => {
      // ignore autoplay errors
    });
  }

  stopBackgroundMusic() {
    if (!this.bgmAudio) return;
    this.bgmAudio.pause();
    this.bgmAudio.currentTime = 0;
    this.bgmAudio = null;
    this.bgmPath = '';
  }

  get volume(): number { return this._volume; }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    this.syncVolumes();
    savePrefs({ volume: this._volume, muted: this._muted });
  }

  get muted(): boolean { return this._muted; }
  set muted(m: boolean) {
    this._muted = m;
    this.syncVolumes();
    savePrefs({ volume: this._volume, muted: this._muted });
  }

  /** Play a simple tone with optional envelope */
  playTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    gain: number,
    envelope?: Envelope,
    startTime?: number,
  ) {
    const ctx = this.ensureContext();
    const t = startTime ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0;

    osc.connect(g);
    g.connect(this.destination);

    const atk = envelope?.attack ?? 0.005;
    const rel = envelope?.release ?? 0.02;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.setValueAtTime(gain, t + duration - rel);
    g.gain.linearRampToValueAtTime(0, t + duration);

    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  /** Play a frequency sweep */
  playSweep(
    freqStart: number,
    freqEnd: number,
    type: OscillatorType,
    duration: number,
    gain: number,
    startTime?: number,
  ) {
    const ctx = this.ensureContext();
    const t = startTime ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.linearRampToValueAtTime(freqEnd, t + duration);

    g.gain.setValueAtTime(gain, t);
    g.gain.linearRampToValueAtTime(0, t + duration);

    osc.connect(g);
    g.connect(this.destination);

    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  /** Create a reusable white noise buffer (cached) */
  createNoiseBuffer(seconds = 1): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.duration >= seconds) {
      return this.noiseBuffer;
    }
    const ctx = this.ensureContext();
    const len = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
    return buf;
  }

  /** Play filtered noise burst */
  playNoise(
    duration: number,
    filterType: BiquadFilterType,
    filterFreq: number,
    filterQ: number,
    gain: number,
    startTime?: number,
  ) {
    const ctx = this.ensureContext();
    const t = startTime ?? ctx.currentTime;
    const buf = this.createNoiseBuffer();

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.value = filterFreq;
    flt.Q.value = filterQ;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.linearRampToValueAtTime(0, t + duration);

    src.connect(flt);
    flt.connect(g);
    g.connect(this.destination);

    src.start(t);
    src.stop(t + duration + 0.01);
  }

  /** Play noise with frequency sweep on filter */
  playNoiseSweep(
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    filterQ: number,
    gain: number,
    startTime?: number,
  ) {
    const ctx = this.ensureContext();
    const t = startTime ?? ctx.currentTime;
    const buf = this.createNoiseBuffer();

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(freqStart, t);
    flt.frequency.linearRampToValueAtTime(freqEnd, t + duration);
    flt.Q.value = filterQ;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.linearRampToValueAtTime(0, t + duration);

    src.connect(flt);
    flt.connect(g);
    g.connect(this.destination);

    src.start(t);
    src.stop(t + duration + 0.01);
  }

  dispose() {
    this.stopBackgroundMusic();
    this.sfxPool.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
    }
  }
}

/** Singleton instance */
export const soundEngine = new SoundEngine();
