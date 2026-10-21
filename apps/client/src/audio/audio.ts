/**
 * Son procédural (WebAudio, aucun fichier) : souffle du vent selon la vitesse, roulement
 * des pneus selon revêtement et vitesse, cliquetis de roue libre (moyeu à cliquets) quand la
 * cadence tombe à zéro, chaîne, ambiance forêt / oiseaux, pluie, public sur les côtes.
 * La musique est coupée par défaut (décision 18).
 */
import type { SoundSource } from './spatial.ts';

export interface AudioState {
  speedMs: number;
  cadence: number;
  /** Puissance (souffle du coureur à l'effort). */
  watts: number;
  ftp: number;
  /** 0 = asphalte lisse, 1 = revêtement rugueux / gravier. */
  roughness: number;
  rain: number;
  /** Densité de forêt autour (0–1) : oiseaux, bruissement. */
  forest: number;
  /** Public présent (côtes, arrivée). */
  crowd: number;
  windMs: number;
  /** Position et cap de l'auditeur (son positionné). */
  x?: number;
  z?: number;
  /** Cap en radians (atan2(dirX, dirZ)). */
  heading?: number;
}

function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (pink) {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else d[i] = w * 0.5;
  }
  return buf;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private tire!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private crowd!: GainNode;
  private breath!: { gain: GainNode; filter: BiquadFilterNode };
  private clickBuffer!: AudioBuffer;
  private nextClick = 0;
  private nextBird = 0;
  private breathPhase = 0;
  volume = Number(localStorage.getItem('ar.volume') ?? 0.7);
  muted = false;

  /** Doit être appelé après une interaction utilisateur (politique d'autoplay). */
  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const pink = noiseBuffer(ctx, 4, true);
    const white = noiseBuffer(ctx, 2, false);
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * buf.duration);
      return s;
    };
    const chain = (src: AudioNode, type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      return { gain: g, filter: f };
    };
    this.wind = chain(loop(pink), 'lowpass', 400);
    this.tire = chain(loop(white), 'bandpass', 250, 0.9);
    this.breath = chain(loop(pink), 'bandpass', 900, 1.2);
    const r = chain(loop(white), 'highpass', 2500);
    this.rain = r.gain;
    const c = chain(loop(pink), 'bandpass', 1200, 0.5);
    this.crowd = c.gain;
    // Cliquet du moyeu : impulsion courte et métallique.
    const len = Math.floor(ctx.sampleRate * 0.012);
    this.clickBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.clickBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12)) * 0.9 + Math.sin(i * 0.9) * Math.exp(-i / (len * 0.2)) * 0.5;
  }

  setVolume(v: number): void {
    this.volume = v;
    localStorage.setItem('ar.volume', String(v));
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  private click(at: number, gain: number): void {
    const ctx = this.ctx as AudioContext;
    const s = ctx.createBufferSource();
    s.buffer = this.clickBuffer;
    s.playbackRate.value = 0.9 + Math.random() * 0.25;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.master);
    s.start(at);
  }

  /** Sources positionnées (tags OSM) actuellement connues. */
  private sources: SoundSource[] = [];
  private readonly nextEvent = new Map<SoundSource, number>();
  private waterGain: GainNode | null = null;
  private waterPan: StereoPannerNode | null = null;

  setSources(list: SoundSource[]): void {
    this.sources = list;
  }

  /** Cloche : partiels inharmoniques à décroissance lente (volée de 3 à 6 coups). */
  private bells(at: number, gain: number, pan: number): void {
    const ctx = this.ctx as AudioContext;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    const strikes = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < strikes; k++) {
      const t0 = at + k * 1.4;
      for (const [ratio, amp] of [
        [1, 1],
        [2.4, 0.5],
        [3.0, 0.35],
        [4.2, 0.2],
      ] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 392 * ratio;
        g.gain.setValueAtTime(gain * amp * 0.08, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5);
        o.connect(g).connect(p);
        o.start(t0);
        o.stop(t0 + 3.6);
      }
    }
  }

  /** Meuglement : dent de scie grave, formant filtré, glissando descendant. */
  private moo(at: number, gain: number, pan: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 3;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const base = 110 + Math.random() * 30;
    o.frequency.setValueAtTime(base * 1.2, at);
    o.frequency.linearRampToValueAtTime(base, at + 0.4);
    o.frequency.linearRampToValueAtTime(base * 0.85, at + 1.4);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain * 0.12, at + 0.25);
    g.gain.linearRampToValueAtTime(gain * 0.08, at + 1.1);
    g.gain.linearRampToValueAtTime(0, at + 1.6);
    o.connect(f).connect(g).connect(p).connect(this.master);
    o.start(at);
    o.stop(at + 1.7);
  }

  /** Atténuation et panoramique d'une source par rapport à l'auditeur. */
  private spatial(src: SoundSource, x: number, z: number, heading: number): { gain: number; pan: number } | null {
    const dx = src.x - x;
    const dz = src.z - z;
    const d = Math.hypot(dx, dz);
    if (d > src.range) return null;
    const gain = Math.min(1, (1 - d / src.range) ** 2 * (40 / Math.max(d, 40)) * 1.5);
    // Angle de la source par rapport au cap : droite = (−dirZ, dirX) dans le repère x est / z sud.
    const rightX = -Math.cos(heading);
    const rightZ = Math.sin(heading);
    const pan = d > 1 ? Math.max(-1, Math.min(1, -(dx * rightX + dz * rightZ) / d)) : 0;
    return { gain, pan };
  }

  private updateSpatial(s: AudioState): void {
    const ctx = this.ctx as AudioContext;
    if (s.x === undefined || s.z === undefined) return;
    const now = ctx.currentTime;
    const heading = s.heading ?? 0;
    let water = 0;
    let waterPan = 0;
    for (const src of this.sources) {
      const sp = this.spatial(src, s.x, s.z, heading);
      if (!sp) continue;
      if (src.kind === 'water') {
        if (sp.gain > water) {
          water = sp.gain;
          waterPan = sp.pan;
        }
        continue;
      }
      if (src.kind === 'village') continue;
      const next = this.nextEvent.get(src) ?? now + Math.random() * 20;
      if (now >= next) {
        if (src.kind === 'bells') this.bells(now + 0.05, sp.gain, sp.pan);
        else this.moo(now + 0.05, sp.gain, sp.pan);
        this.nextEvent.set(src, now + (src.kind === 'bells' ? 90 + Math.random() * 120 : 12 + Math.random() * 25));
      } else if (!this.nextEvent.has(src)) this.nextEvent.set(src, next);
    }
    // Eau : bruit filtré continu, piloté par la source d'eau la plus proche.
    if (!this.waterGain) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
      const srcNode = ctx.createBufferSource();
      srcNode.buffer = buf;
      srcNode.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 0.6;
      this.waterGain = ctx.createGain();
      this.waterGain.gain.value = 0;
      this.waterPan = ctx.createStereoPanner();
      srcNode.connect(f).connect(this.waterGain).connect(this.waterPan).connect(this.master);
      srcNode.start();
    }
    this.waterGain.gain.setTargetAtTime(water * 0.06, now, 0.5);
    this.waterPan?.pan.setTargetAtTime(waterPan, now, 0.3);
  }

  private bird(at: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const base = 2600 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    g.gain.setValueAtTime(0, at);
    for (let i = 0; i < notes; i++) {
      const t0 = at + i * 0.13;
      o.frequency.setValueAtTime(base * (1 + (Math.random() - 0.5) * 0.3), t0);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t0 + 0.09);
      g.gain.linearRampToValueAtTime(0.025, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + 0.1);
    }
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + notes * 0.13 + 0.1);
  }

  update(s: AudioState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.updateSpatial(s);
    const now = ctx.currentTime;
    const v = s.speedMs;
    const k = 0.15;
    // Vent : volume et brillance croissent avec la vitesse apparente.
    const air = v + Math.max(s.windMs, 0) * 0.5;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.5, (air / 14) ** 2 * 0.35 + 0.01), now, k);
    this.wind.filter.frequency.setTargetAtTime(250 + air * 90, now, k);
    // Pneus : bourdonnement dont la hauteur suit la vitesse ; rugosité = plus large et plus fort.
    this.tire.gain.gain.setTargetAtTime(Math.min(0.25, v * 0.012 * (1 + s.roughness * 1.5)), now, k);
    this.tire.filter.frequency.setTargetAtTime(120 + v * 28 + s.roughness * 300, now, k);
    this.tire.filter.Q.setTargetAtTime(1.2 - s.roughness * 0.8, now, k);
    this.rain.gain.setTargetAtTime(s.rain * 0.12, now, 0.5);
    this.crowd.gain.setTargetAtTime(s.crowd * 0.08, now, 0.6);
    // Souffle à l'effort : rythme et volume liés à l'intensité.
    const intensity = Math.max(0, s.watts / Math.max(s.ftp, 1) - 0.6);
    this.breathPhase += dt * (0.35 + intensity * 0.6) * Math.PI * 2;
    const breath = Math.max(0, Math.sin(this.breathPhase)) ** 2 * Math.min(0.05, intensity * 0.05);
    this.breath.gain.gain.setTargetAtTime(breath, now, 0.05);

    // Roue libre : cliquets à fréquence proportionnelle à la vitesse quand on ne pédale pas.
    if (s.cadence < 5 && v > 0.8) {
      const rate = (v / (2 * Math.PI * 0.335)) * 36; // 36 cliquets par tour de moyeu
      const interval = 1 / Math.min(rate, 300);
      if (this.nextClick < now) this.nextClick = now;
      while (this.nextClick < now + 0.1) {
        this.click(this.nextClick, 0.05 + Math.min(v / 15, 1) * 0.08);
        this.nextClick += interval * (0.9 + Math.random() * 0.2);
      }
    }
    // Oiseaux en forêt, par beau temps.
    if (s.forest > 0.2 && s.rain < 0.3 && now > this.nextBird) {
      this.bird(now + 0.05);
      this.nextBird = now + 1.5 + Math.random() * 6 / s.forest;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
