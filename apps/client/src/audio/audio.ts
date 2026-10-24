/**
 * Son procédural du jeu (WebAudio, aucun fichier) : moteur qui transforme l'état de la sortie en
 * couches continues (vent, roulement selon le revêtement, pluie, feuillage, grillons, rumeur du
 * village, public) et en événements (oiseaux, cloches, cliquets de roue libre,
 * dérailleur, souffle, cris du public). La logique des niveaux est dans soundscape.ts (testée) ;
 * le mixage par bus dans mix.ts. La musique est à part (music.ts).
 *
 * Graphe : couches → bus de catégorie (ambiance, vélo, souffle, public) → général →
 * gain de compensation → compresseur doux (les scènes chargées) → écrêteur doux (crête
 * < −0,9 dBFS quoi qu'il arrive) → sortie. Niveaux mesurés : apps/client/scripts/audio-bench.mjs.
 */
import type { SoundSource } from './spatial.ts';
import { BUSES, busGains, DEFAULT_MIX, type Bus, type SoundMix } from './mix.ts';
import { COBBLE_BUFFER_RATE, cobbles, crackle, cricketChorus, hubClick, noise, seeded } from './buffers.ts';
import {
  BreathModel,
  ambienceMix,
  apparentWind,
  breathEnvelope,
  crowdActivity,
  eventChance,
  freewheelClickGain,
  freewheelRate,
  isCoasting,
  panFor,
  tireMix,
  windMix,
  type AmbienceMix,
  type BreathParams,
  type Season,
  type Surface,
} from './soundscape.ts';
import { bells, bird, clap, cowbell, dogBark, fanWhistle, moo, shiftSound, shout, type BirdKind } from './voices.ts';

export interface AudioState {
  speedMs: number;
  cadence: number;
  watts: number;
  ftp: number;
  /** Fréquence cardiaque mesurée et FC max (souffle). */
  hr?: number;
  hrMax?: number;
  surface: Surface;
  /** Chaussée mouillée (0–1). */
  wet: number;
  windMs: number;
  /** D'où vient le vent (radians, 0 = nord). */
  windFrom: number;
  /** Cap en radians (atan2(dirX, dirZ)). */
  heading: number;
  /** Position de l'auditeur (sons positionnés). */
  x?: number;
  z?: number;
  env: { hour: number; season: Season; night: number; rain: number };
  /** Occupation du sol autour du coureur (0–1). */
  land: { forest: number; urban: number; open: number };
  /** Présence du public (0–1, voir crowdLevel). */
  crowd: number;
  /** Montée de montagne : cloches de vache dans le public. */
  mountain?: boolean;
  /** Pause, intro : le vélo se tait, l'ambiance baisse. */
  paused?: boolean;
}

interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
  src: AudioBufferSourceNode;
}

const SONGS: BirdKind[] = ['warble', 'tit', 'chiff'];
/**
 * Gain de compensation après le général (+13 dB) ; le compresseur de WebAudio ajoute sa propre
 * compensation automatique (~+4,5 dB avec ces réglages).
 */
const MAKEUP = 4.5;

export class GameAudio {
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private mix: SoundMix;
  private muted = false;
  private paused = false;
  private buf!: {
    pink: AudioBuffer;
    pinkMono: AudioBuffer;
    white: AudioBuffer;
    whiteMono: AudioBuffer;
    crackle: AudioBuffer;
    drops: AudioBuffer;
    cobbles: AudioBuffer;
    crickets: AudioBuffer;
    clicks: AudioBuffer[];
  };
  private L!: {
    wind: Layer;
    roar: Layer;
    hiss: Layer;
    crunch: Layer;
    cobble: Layer;
    spray: Layer;
    windAmb: Layer;
    foliage: Layer;
    crickets: Layer;
    village: Layer;
    rainHiss: Layer;
    rainDrops: Layer;
    rainLeaves: Layer;
    water: Layer;
    crowdLow: Layer;
    crowdHigh: Layer;
    breath: Layer;
  };
  private waterPan!: StereoPannerNode;
  private breathVca!: GainNode;
  private clickBus!: GainNode;
  private readonly breathModel = new BreathModel();
  private breathParams: BreathParams = { rate: 12, gain: 0, open: 0, effort: 0, hr: 0.5 };
  private nextBreath = 0;
  private nextClick = 0;
  private coastT = 0;
  private gust = 1;
  private gustV = 0;
  private swell = 1;
  private cadence = 0;
  private sources: SoundSource[] = [];
  private readonly nextEvent = new Map<SoundSource, number>();
  private onVisibility: (() => void) | null = null;
  /** Dernières valeurs d'ambiance calculées (banc d'essai, débogage). */
  lastAmbience: AmbienceMix | null = null;

  constructor(mix: SoundMix = DEFAULT_MIX) {
    this.mix = { ...mix };
  }

  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  /**
   * Construit le graphe. Sans argument : AudioContext réel (à appeler après un geste de
   * l'utilisateur, politique d'autoplay). Le banc d'essai passe un OfflineAudioContext.
   */
  start(context?: BaseAudioContext): void {
    if (this.ctx) return;
    const ctx = context ?? new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    const rnd = seeded(2026);
    const make = (chans: Float32Array[]): AudioBuffer => {
      const b = ctx.createBuffer(chans.length, (chans[0] as Float32Array).length, sr);
      chans.forEach((c, i) => b.getChannelData(i).set(c));
      return b;
    };
    this.buf = {
      pink: make([noise(sr, 4, true, rnd), noise(sr, 4, true, rnd)]),
      pinkMono: make([noise(sr, 4, true, rnd)]),
      white: make([noise(sr, 3, false, rnd), noise(sr, 3, false, rnd)]),
      whiteMono: make([noise(sr, 2, false, rnd)]),
      crackle: make([crackle(sr, 2, 400, rnd)]),
      drops: make([crackle(sr, 3, 700, rnd), crackle(sr, 3, 700, rnd)]),
      cobbles: make([cobbles(sr, 2, rnd)]),
      crickets: make(cricketChorus(sr, 6, 7, rnd)),
      clicks: [make([hubClick(sr, 0, rnd)]), make([hubClick(sr, 1, rnd)])],
    };

    // Écrêteur doux : linéaire jusqu'à 1,2 (entrée ×0,5), puis tangente vers 1,96 ; sortie ×0,5.
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    const n = 2049;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = ((i / (n - 1)) * 2 - 1) * 2; // −2 … 2 (avant le ×0,5)
      const a = Math.abs(x);
      const y = a <= 1.2 ? a : 1.2 + 0.76 * Math.tanh((a - 1.2) / 0.76);
      curve[i] = (Math.sign(x) * y) / 2;
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // Les couches sont réglées avec de la marge (somme bornée) : on remonte l'ensemble ici.
    const makeup = ctx.createGain();
    makeup.gain.value = MAKEUP;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.3;
    this.master.connect(makeup).connect(comp).connect(pre).connect(shaper).connect(ctx.destination);
    this.buses = Object.fromEntries(
      BUSES.map((b) => {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.master);
        return [b, g];
      }),
    ) as Record<Bus, GainNode>;

    const layer = (buf: AudioBuffer, bus: AudioNode, type: BiquadFilterType, freq: number, q = 0.7): Layer => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(bus);
      src.start(0, rnd() * buf.duration);
      return { gain, filter, src };
    };
    const B = this.buses;
    const b = this.buf;
    this.waterPan = ctx.createStereoPanner();
    this.waterPan.connect(B.ambience);
    this.breathVca = ctx.createGain();
    this.breathVca.gain.value = 0;
    this.breathVca.connect(B.breath);
    this.L = {
      wind: layer(b.pink, B.bike, 'lowpass', 400),
      roar: layer(b.pinkMono, B.bike, 'bandpass', 250, 0.9),
      hiss: layer(b.whiteMono, B.bike, 'highpass', 4000),
      crunch: layer(b.crackle, B.bike, 'bandpass', 2500, 0.6),
      cobble: layer(b.cobbles, B.bike, 'lowpass', 1400),
      spray: layer(b.white, B.bike, 'bandpass', 5000, 0.5),
      windAmb: layer(b.pink, B.ambience, 'lowpass', 380),
      foliage: layer(b.white, B.ambience, 'bandpass', 3500, 0.4),
      crickets: layer(b.crickets, B.ambience, 'highpass', 2500),
      village: layer(b.pink, B.ambience, 'bandpass', 450, 0.6),
      rainHiss: layer(b.white, B.ambience, 'highpass', 1800),
      rainDrops: layer(b.drops, B.ambience, 'highpass', 1500),
      rainLeaves: layer(b.pink, B.ambience, 'bandpass', 1200, 0.8),
      water: layer(b.whiteMono, this.waterPan, 'bandpass', 1800, 0.6),
      crowdLow: layer(b.pink, B.crowd, 'bandpass', 650, 0.9),
      crowdHigh: layer(b.pink, B.crowd, 'bandpass', 1800, 1.2),
      breath: layer(b.pinkMono, this.breathVca, 'bandpass', 1000, 1.1),
    };
    this.L.breath.gain.gain.value = 1;
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0;
    this.clickBus.connect(B.bike);

    this.applyBuses(1);
    // Onglet caché : la boucle de rendu s'arrête, on suspend le son plutôt que de figer les nappes.
    if (ctx instanceof AudioContext && typeof document !== 'undefined') {
      this.onVisibility = () => void (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => undefined);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** Volumes des bus (fondu `tau` s). */
  private applyBuses(tau = 0.25): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = busGains(this.mix, { paused: this.paused, muted: this.muted });
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(g.master, now, tau);
    for (const b of BUSES) this.buses[b].gain.setTargetAtTime(g[b], now, tau);
  }

  setMix(m: SoundMix): void {
    this.mix = { ...m };
    this.applyBuses(0.08);
  }

  /** Volume général (compatibilité). */
  setVolume(v: number): void {
    this.setMix({ ...this.mix, master: v });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyBuses(0.08);
    return this.muted;
  }

  setSources(list: SoundSource[]): void {
    this.sources = list;
  }

  /** Changement de vitesse virtuelle : `front` = plateau. */
  shift(front: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    shiftSound(ctx, this.buses.bike, this.buf.whiteMono, ctx.currentTime + 0.01, front, this.cadence > 20, 1);
  }

  private set(p: AudioParam, v: number, tau = 0.15): void {
    p.setTargetAtTime(Number.isFinite(v) ? v : 0, (this.ctx as BaseAudioContext).currentTime, tau);
  }

  update(s: AudioState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const paused = !!s.paused;
    if (paused !== this.paused) {
      this.paused = paused;
      this.applyBuses(0.3);
    }
    const now = ctx.currentTime;
    const v = paused ? 0 : Math.max(0, s.speedMs);
    this.cadence = s.cadence;
    // Rafales : marche aléatoire lissée autour de 1.
    this.gustV += (Math.random() - 0.5) * dt * 1.6 - this.gustV * dt * 0.8;
    this.gust = Math.min(1.5, Math.max(0.55, this.gust + this.gustV * dt));

    // Vélo : air, pneus.
    const air = windMix(apparentWind(v, s.windMs * (0.8 + 0.2 * this.gust), s.windFrom, s.heading));
    this.set(this.L.wind.gain.gain, air.gain);
    this.set(this.L.wind.filter.frequency, air.freq);
    const t = tireMix(s.surface, v, s.wet);
    this.set(this.L.roar.gain.gain, t.roar.gain);
    this.set(this.L.roar.filter.frequency, t.roar.freq);
    this.set(this.L.roar.filter.Q, t.roar.q);
    this.set(this.L.hiss.gain.gain, t.hiss.gain);
    this.set(this.L.hiss.filter.frequency, t.hiss.freq);
    this.set(this.L.crunch.gain.gain, t.crunch.gain);
    this.set(this.L.crunch.src.playbackRate, t.crunch.rate);
    this.set(this.L.cobble.gain.gain, t.cobble.gain);
    this.set(this.L.cobble.src.playbackRate, Math.max(0.05, t.cobble.rate / COBBLE_BUFFER_RATE));
    this.set(this.L.spray.gain.gain, t.spray);

    // Roue libre : cliquets programmés un peu à l'avance, rythme selon la vitesse de roue.
    const coasting = !paused && isCoasting(s.cadence, s.watts, v);
    this.coastT = coasting ? this.coastT + dt : 0;
    if (coasting) {
      const rate = Math.min(freewheelRate(v), 400);
      this.set(this.clickBus.gain, Math.min(1, this.coastT / 0.25), 0.05);
      if (this.nextClick < now) this.nextClick = now + 0.02;
      const g = freewheelClickGain(rate);
      let k = 0;
      while (this.nextClick < now + 0.1 && k++ < 64) {
        const src = ctx.createBufferSource();
        src.buffer = this.buf.clicks[k & 1] as AudioBuffer;
        src.playbackRate.value = 0.92 + Math.random() * 0.2;
        const cg = ctx.createGain();
        cg.gain.value = g * (0.8 + Math.random() * 0.4);
        src.connect(cg).connect(this.clickBus);
        src.start(this.nextClick);
        this.nextClick += (1 / rate) * (0.92 + Math.random() * 0.16);
      }
    } else this.set(this.clickBus.gain, 0, 0.04);

    this.updateBreath(s, dt, coasting, now);
    this.updateAmbience(s, dt, now);
    this.updateCrowd(s, dt, now);
  }

  /** Souffle : un cycle (inspiration, expiration) programmé à l'avance selon l'effort. */
  private updateBreath(s: AudioState, dt: number, coasting: boolean, now: number): void {
    const hrFrac = s.hr !== undefined && s.hr > 0 ? s.hr / (s.hrMax ?? 190) : undefined;
    this.breathParams = this.breathModel.update(dt, s.watts / Math.max(s.ftp, 1), hrFrac, coasting);
    if (this.nextBreath < now) this.nextBreath = now + 0.05;
    if (this.nextBreath > now + 0.15) return;
    const p = this.breathParams;
    const t0 = this.nextBreath;
    const env = breathEnvelope(p.rate, p.gain * (0.9 + Math.random() * 0.2));
    const g = this.breathVca.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0);
    for (const [dtk, val] of env) g.linearRampToValueAtTime(val, t0 + dtk);
    // Inspiration plus aiguë (nez, sifflante) ; expiration plus ouverte quand ça tire.
    const f = this.L.breath.filter.frequency;
    const inhaleEnd = (env[2] as [number, number])[0];
    f.cancelScheduledValues(t0);
    f.setValueAtTime(1500 + 300 * p.open, t0);
    f.setValueAtTime(650 + 450 * p.open, t0 + inhaleEnd);
    this.nextBreath = t0 + 60 / p.rate;
  }

  private updateAmbience(s: AudioState, dt: number, now: number): void {
    // Sons positionnés (OSM) : eau continue ; cloches, vaches, proximité des villages.
    let water = 0;
    let waterPan = 0;
    let villageNear = 0;
    const bellsOk = s.env.hour >= 7 && s.env.hour <= 21.5;
    const amb0 = this.lastAmbience;
    if (s.x !== undefined && s.z !== undefined) {
      for (const src of this.sources) {
        const dx = src.x - s.x;
        const dz = src.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > src.range) continue;
        const gain = Math.min(1, (1 - d / src.range) ** 2 * (40 / Math.max(d, 40)) * 1.5);
        const pan = panFor(dx, dz, s.heading);
        if (src.kind === 'water') {
          if (gain > water) {
            water = gain;
            waterPan = pan;
          }
          continue;
        }
        if (src.kind === 'village') {
          villageNear = Math.max(villageNear, 1 - d / src.range);
          continue;
        }
        const next = this.nextEvent.get(src);
        if (next === undefined) {
          this.nextEvent.set(src, now + Math.random() * (src.kind === 'bells' ? 60 : 20));
          continue;
        }
        if (now < next) continue;
        if (src.kind === 'bells') {
          if (bellsOk) bells(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
          this.nextEvent.set(src, now + 90 + Math.random() * 120);
        } else {
          if (amb0?.cows ?? true) moo(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
          this.nextEvent.set(src, now + 12 + Math.random() * 25);
        }
      }
    }
    this.set(this.L.water.gain.gain, water * 0.06, 0.5);
    this.set(this.waterPan.pan, waterPan, 0.3);

    const a = ambienceMix({
      hour: s.env.hour,
      season: s.env.season,
      night: s.env.night,
      rain: s.env.rain,
      windMs: s.windMs,
      forest: s.land.forest,
      urban: Math.max(s.land.urban, villageNear * 0.8),
      open: s.land.open,
    });
    this.lastAmbience = a;
    const g = this.gust;
    this.set(this.L.windAmb.gain.gain, a.wind * g, 0.4);
    this.set(this.L.windAmb.filter.frequency, 260 + 120 * g, 0.4);
    this.set(this.L.foliage.gain.gain, a.foliage * g * g, 0.3);
    this.set(this.L.crickets.gain.gain, a.crickets, 1);
    // Rumeur : houle lente.
    this.set(this.L.village.gain.gain, a.village * (0.8 + 0.2 * Math.sin(now * 0.37) * Math.sin(now * 0.13)), 0.8);
    this.set(this.L.rainHiss.gain.gain, a.rainHiss, 0.8);
    this.set(this.L.rainDrops.gain.gain, a.rainDrops, 0.8);
    this.set(this.L.rainLeaves.gain.gain, a.rainLeaves, 0.8);

    // Événements : oiseaux et compagnie, position et distance au hasard.
    const c = ctx(this);
    const out = this.buses.ambience;
    const noiseBuf = this.buf.whiteMono;
    const spot = () => {
      const far = Math.random();
      return { gain: (1 - 0.7 * far) * a.birdGain, pan: Math.random() * 1.8 - 0.9, lp: 12000 - far * 8500 };
    };
    const fire = (perMin: number, play: () => void) => {
      if (Math.random() < eventChance(perMin, dt)) play();
    };
    fire(a.songbirds, () => {
      const p = spot();
      bird(c, out, noiseBuf, now + 0.05, SONGS[Math.floor(Math.random() * SONGS.length)] as BirdKind, p.gain, p.pan, p.lp);
    });
    fire(a.calls, () => {
      const p = spot();
      bird(c, out, noiseBuf, now + 0.05, 'chip', p.gain, p.pan, p.lp);
    });
    fire(a.skylark, () => bird(c, out, noiseBuf, now + 0.05, 'skylark', 0.6, Math.random() * 0.8 - 0.4, 9000));
    fire(a.cuckoo, () => bird(c, out, noiseBuf, now + 0.05, 'cuckoo', 0.5, Math.random() * 1.6 - 0.8, 5000));
    fire(a.woodpecker, () => {
      const p = spot();
      bird(c, out, noiseBuf, now + 0.05, 'woodpecker', p.gain, p.pan, p.lp);
    });
    fire(a.pigeon, () => bird(c, out, noiseBuf, now + 0.05, 'pigeon', 0.6, Math.random() * 1.6 - 0.8, 4000));
    fire(a.crows, () => bird(c, out, noiseBuf, now + 0.05, 'crow', 0.4 + Math.random() * 0.4, Math.random() * 1.8 - 0.9, 7000));
    fire(a.owl, () => bird(c, out, noiseBuf, now + 0.05, 'owl', 0.5 + Math.random() * 0.4, Math.random() * 1.6 - 0.8, 3500));
    fire(a.dogs, () => dogBark(c, out, noiseBuf, now + 0.05, 0.4 + Math.random() * 0.5, Math.random() * 1.8 - 0.9));
  }

  /** Public : rumeur qui enfle, applaudissements, « Allez ! », sifflets, cloches de vache. */
  private updateCrowd(s: AudioState, dt: number, now: number): void {
    const act = crowdActivity(this.paused ? 0 : s.crowd, s.watts / Math.max(s.ftp, 1), s.mountain);
    this.swell += ((0.75 + 0.5 * Math.random()) - this.swell) * Math.min(1, dt * 0.7);
    this.set(this.L.crowdLow.gain.gain, act.bed * this.swell, 0.5);
    this.set(this.L.crowdHigh.gain.gain, act.bed * 0.5 * this.swell, 0.5);
    if (act.bed <= 0) return;
    const c = ctx(this);
    const out = this.buses.crowd;
    const side = () => (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7);
    const n = (perS: number) => {
      // Plusieurs événements possibles par image quand le public est dense.
      let k = 0;
      let lambda = perS * dt;
      while (lambda > 0 && Math.random() < 1 - Math.exp(-lambda) && k < 6) {
        k++;
        lambda -= 1;
      }
      return k;
    };
    for (let i = n(act.claps); i > 0; i--) clap(c, out, this.buf.whiteMono, now + Math.random() * 0.05, 0.5 + Math.random() * 0.5, side());
    for (let i = n(act.shouts); i > 0; i--) shout(c, out, now + Math.random() * 0.1, 0.5 + Math.random() * 0.5, side());
    for (let i = n(act.whistles); i > 0; i--) fanWhistle(c, out, now + 0.02, 0.6 + Math.random() * 0.4, side());
    for (let i = n(act.cowbells); i > 0; i--) cowbell(c, out, now + 0.02, 0.6 + Math.random() * 0.4, side());
  }

  /** Arrêt avec un fondu court (fin de sortie). */
  dispose(): void {
    const c = this.ctx;
    if (!c) return;
    this.ctx = null;
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    this.master.gain.setTargetAtTime(0, c.currentTime, 0.08);
    if (c instanceof AudioContext) setTimeout(() => void c.close().catch(() => undefined), 400);
  }
}

function ctx(a: GameAudio): BaseAudioContext {
  return a.context as BaseAudioContext;
}
