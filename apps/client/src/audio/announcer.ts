/**
 * Voix de course : enchaîne les morceaux générés à l'avance (public/voice/announcer, voir announcerLines.ts)
 * pour annoncer temps et records, le speaker de départ et d'arrivée (effet de sono), le bilan de sortie, et
 * les cris du public près des spectateurs.
 *
 * Un cri du public = une seule voix, placée à gauche ou à droite, timbre un peu changé (vitesse de lecture),
 * filtrée par la distance et prise dans une courte réverbération : une personne parmi la foule enregistrée
 * (les copies superposées d'une même voix sonnaient comme un chœur).
 */
import { getLang } from '../i18n/index.ts';
import { CROWD_SHOUTS, durationKeys } from './announcerLines.ts';

type Effect = 'plain' | 'pa';

let table: Promise<Record<string, string>> | null = null;
const loadTable = (lang: 'fr' | 'en'): Promise<Record<string, string>> =>
  (table ??= fetch('/voice/announcer/announcer.json')
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, Record<string, string>>>) : {}))
    .then((t) => (t as Record<string, Record<string, string>>)[lang] ?? {})
    .catch(() => ({})));

export class Announcer {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** Fin de la dernière phrase programmée (pas deux annonces l'une sur l'autre). */
  private busyUntil = 0;
  private reverb: ConvolverNode | null = null;
  private nextShout = 0;
  private readonly lang: 'fr' | 'en';

  constructor(private readonly out: () => { ctx: BaseAudioContext; dest: AudioNode } | null) {
    this.lang = getLang() === 'fr' ? 'fr' : 'en';
    void loadTable(this.lang);
  }

  private buffer(key: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(key);
    if (!p) {
      p = loadTable(this.lang).then(async (t) => {
        const file = t[key];
        const o = this.out();
        if (!file || !o) return null;
        try {
          const r = await fetch(`/voice/announcer/${file}`);
          return r.ok ? await o.ctx.decodeAudioData(await r.arrayBuffer()) : null;
        } catch {
          return null;
        }
      });
      this.buffers.set(key, p);
    }
    return p;
  }

  /** Précharge des morceaux (évite un blanc à la première annonce). */
  preload(keys: string[]): void {
    for (const k of keys) void this.buffer(k);
  }

  /** Dit une suite de morceaux, après l'annonce en cours ; `skipIfBusy` : abandonnée si une annonce est en cours. */
  async say(keys: string[], effect: Effect = 'plain', skipIfBusy = false): Promise<void> {
    const o = this.out();
    if (!o || !keys.length) return;
    if (skipIfBusy && o.ctx.currentTime < this.busyUntil) return;
    const bufs = await Promise.all(keys.map((k) => this.buffer(k)));
    const ctx = o.ctx;
    let t = Math.max(ctx.currentTime + 0.05, this.busyUntil);
    const input = this.effectChain(effect, o);
    for (const b of bufs) {
      if (!b) continue;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(input);
      s.start(t);
      t += b.duration - 0.05;
    }
    this.busyUntil = t + 0.25;
  }

  private effectChain(effect: Effect, o: { ctx: BaseAudioContext; dest: AudioNode }): AudioNode {
    const ctx = o.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    gain.connect(o.dest);
    if (effect === 'plain') return gain;
    // Sono de course : haut-parleur à pavillon (bande étroite, saturation douce) et écho de la place.
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3600 });
    const drive = new WaveShaperNode(ctx, { curve: Float32Array.from({ length: 256 }, (_, i) => Math.tanh((i / 128 - 1) * 2.2)) });
    const delay = new DelayNode(ctx, { delayTime: 0.19 });
    const fb = new GainNode(ctx, { gain: 0.3 });
    hp.connect(drive).connect(lp).connect(gain);
    lp.connect(delay).connect(fb).connect(delay);
    fb.connect(gain);
    return hp;
  }

  /** Réverbération courte (bruit qui décroît en 0,7 s), créée une fois. */
  private room(ctx: BaseAudioContext): ConvolverNode {
    if (this.reverb) return this.reverb;
    const len = Math.floor(ctx.sampleRate * 0.7);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb = new ConvolverNode(ctx, { buffer: ir });
    return this.reverb;
  }

  /**
   * Cris du public : à appeler à chaque image avec la présence du public (0–1). De temps en temps (toutes les
   * 2,5 à 6 s en pleine foule), une voix isolée crie un encouragement, d'un côté de la route.
   */
  crowd(level: number, standing: boolean): void {
    const o = this.out();
    if (!o || level < 0.35) return;
    const ctx = o.ctx;
    const now = ctx.currentTime;
    if (now < this.nextShout) return;
    this.nextShout = now + (2.5 + Math.random() * 3.5) / Math.max(level, 0.5);
    if (now < this.busyUntil) return; // pas par-dessus une annonce
    const pool = CROWD_SHOUTS.filter((k) => k !== 'danseuse' || !standing);
    const key = pool[Math.floor(Math.random() * pool.length)] as string;
    void this.buffer(key).then((b) => {
      if (!b) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      // timbre d'une autre personne : ±12 % de vitesse de lecture
      s.playbackRate.value = 0.88 + Math.random() * 0.24;
      const dist = 6 + Math.random() * 14;
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 5200 - dist * 120 });
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 220 });
      const dry = new GainNode(ctx, { gain: (0.55 * level) / (1 + dist / 10) });
      const wet = new GainNode(ctx, { gain: 0.18 * level });
      const pan = new StereoPannerNode(ctx, { pan: (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.5) });
      s.connect(hp).connect(lp);
      lp.connect(dry).connect(pan).connect(o.dest);
      lp.connect(wet).connect(this.room(ctx)).connect(o.dest);
      s.start(ctx.currentTime + 0.02);
    });
  }

  /** « Ton temps : 5 minutes 11 », puis le record. */
  segmentResult(kind: 'kom' | 'sprint', timeS: number, recordS: number | null): void {
    const keys = [kind === 'kom' ? 'summit' : 'sprintLine', 'time', ...durationKeys(timeS)];
    if (recordS === null) keys.push('firstTime');
    else if (timeS < recordS - 0.5) keys.push('newRecord', 'recordBy', ...durationKeys(recordS - timeS));
    else keys.push('missedBy', ...durationKeys(timeS - recordS), 'missedTail');
    void this.say(keys);
  }

  /** Bilan de sortie lu à l'ouverture des statistiques. */
  summary(d: { distanceKm: number; avgSpeedKmh: number; records: boolean; levelUp: boolean; trophy: boolean; previousSpeedKmh: number | null }): void {
    const keys = ['sumGreat'];
    const km = Math.round(d.distanceKm);
    if (km >= 1 && km <= 59) keys.push('sumDistance', `n${km}`, 'kilometres');
    const v = Math.round(d.avgSpeedKmh);
    if (v >= 5 && v <= 59) keys.push('sumSpeed', `n${v}`, 'kmh');
    if (d.records) keys.push('sumRecords');
    if (d.levelUp) keys.push('sumLevelUp');
    if (d.trophy) keys.push('sumTrophy');
    if (d.previousSpeedKmh === null) keys.push('sumFirstTime');
    else keys.push(d.avgSpeedKmh >= d.previousSpeedKmh ? 'sumFaster' : 'sumSlower');
    keys.push('sumRest');
    void this.say(keys);
  }
}
