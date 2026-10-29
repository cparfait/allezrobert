/**
 * Son procédural du jeu (WebAudio, aucun fichier) : moteur qui transforme l'état de la sortie en
 * couches continues (vent, roulement selon le revêtement, pluie, feuillage, grillons, rumeur du
 * village, public, voitures) et en événements (oiseaux, cloches, cliquets de roue libre,
 * dérailleur, souffle, cris du public). La logique des niveaux est dans soundscape.ts (testée) ;
 * le mixage par bus dans mix.ts. La musique est à part (music.ts).
 *
 * Graphe : couches → bus de catégorie (ambiance, vélo, souffle, public, trafic) → général →
 * gain de compensation → compresseur doux (les scènes chargées) → écrêteur doux (crête
 * < −0,9 dBFS quoi qu'il arrive) → sortie. Niveaux mesurés : apps/client/scripts/audio-bench.mjs.
 */
import { followSink } from './devices.ts';
import type { SoundSource } from './spatial.ts';
import { freewheelDef, loopVoices, type FreewheelDef } from './freewheels.ts';
import { BUSES, busGains, DEFAULT_MIX, type Bus, type SoundMix } from './mix.ts';
import { COBBLE_BUFFER_RATE, cobbles, crackle, cricketChorus, hubClick, noise, roomImpulse, seeded } from './buffers.ts';
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
  reverbWet,
  tireMix,
  vehicleVoice,
  windMix,
  type AmbienceMix,
  type BreathParams,
  type Season,
  type Surface,
  type VehicleSound,
} from './soundscape.ts';
import { bells, bird, bleat, clap, cowbell, dogBark, fanWhistle, moo, neigh, shiftSound, shout, type BirdKind } from './voices.ts';

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
  vehicles?: readonly VehicleSound[];
  /** Pause, intro : le vélo se tait, l'ambiance baisse. */
  paused?: boolean;
}

interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
  src: AudioBufferSourceNode;
}

interface TrafficVoice {
  engine: OscillatorNode;
  engine2: OscillatorNode;
  lfo: OscillatorNode | null;
  tire: AudioBufferSourceNode;
  air: BiquadFilterNode;
  tireFilter: BiquadFilterNode;
  out: GainNode;
  /** Position binaurale (HRTF) dans le repère de l'auditeur : devant, derrière, à gauche, à droite. */
  pan: PannerNode;
  base: number;
  idle: number;
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
  /** Envoi vers la réverbération (rues, sous-bois). */
  private reverbSend!: GainNode;
  private breathVca!: GainNode;
  private clickBus!: GainNode;
  private readonly breathModel = new BreathModel();
  private breathParams: BreathParams = { rate: 12, gain: 0, open: 0, effort: 0, hr: 0.5 };
  private nextBreath = 0;
  private nextClick = 0;
  private coastT = 0;
  private readonly loops = new Map<string, AudioBuffer | null>();
  private loopNode: { id: string; voices: { src: AudioBufferSourceNode; gain: GainNode }[] } | null = null;
  private gust = 1;
  private gustV = 0;
  private swell = 1;
  /**
   * Public enregistré (Gregor Quendel, CC-BY 4.0, voir ASSETS_LICENSES.md) : rumeur et bavardages,
   * encouragements forts, encouragements rythmés ; boucles chargées au premier public rencontré.
   */
  private crowdRec: { gains: GainNode[]; ready: boolean } | null = null;
  private cadence = 0;
  private sources: SoundSource[] = [];
  private readonly nextEvent = new Map<SoundSource, number>();
  private readonly traffic = new Map<number, TrafficVoice>();
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
    // Sortie choisie dans les réglages (pas pour le banc d'essai hors ligne).
    if (!context) followSink(ctx);
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
      crunch: layer(b.crackle, B.bike, 'bandpass', 1800, 0.45),
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
    // Réverbération : le vélo, la circulation et le public renvoyés par les façades d'une rue de village
    // ou les troncs d'une forêt ; rien en rase campagne (dosée dans update selon l'occupation du sol).
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    const reverb = ctx.createConvolver();
    reverb.buffer = make(roomImpulse(sr, 1.2, rnd));
    for (const bus of [B.bike, B.traffic, B.crowd]) bus.connect(this.reverbSend);
    this.reverbSend.connect(reverb).connect(this.master);
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

  /** Sortie de la voix de course (après le volume général, avant la compression) ; null tant que l'audio n'est pas lancé. */
  voiceOut(): { ctx: BaseAudioContext; dest: AudioNode } | null {
    if (!this.ctx) return null;
    this.voiceBus ??= (() => {
      const g = this.ctx!.createGain();
      g.gain.value = 1;
      g.connect(this.master);
      return g;
    })();
    return { ctx: this.ctx, dest: this.voiceBus };
  }
  private voiceBus: GainNode | null = null;

  setMix(m: SoundMix): void {
    this.mix = { ...m };
    this.applyBuses(0.08);
  }

  /** Volume général (compatibilité). */
  setVolume(v: number): void {
    this.setMix({ ...this.mix, master: v });
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyBuses(0.08);
    return this.muted;
  }

  setSources(list: SoundSource[]): void {
    this.sources = list;
    // prochains événements des sources disparues (tuiles déchargées, troupeaux oubliés)
    if (this.nextEvent.size > list.length * 2 + 64) {
      const keep = new Set(list);
      for (const s of this.nextEvent.keys()) if (!keep.has(s)) this.nextEvent.delete(s);
    }
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
    const def = freewheelDef(this.mix.freewheel);
    const loopBuf = coasting ? this.freewheelLoop(def) : null;
    if (loopBuf) this.playLoop(def, loopBuf, Math.min(freewheelRate(v), 400), now);
    else this.stopLoop(now);
    if (coasting) {
      const rate = Math.min(freewheelRate(v), 400);
      this.set(this.clickBus.gain, Math.min(1, this.coastT / 0.25), 0.05);
      if (this.nextClick < now) this.nextClick = now + 0.02;
      const g = freewheelClickGain(rate);
      let k = 0;
      while (!loopBuf && this.nextClick < now + 0.1 && k++ < 64) {
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

    // Écho des façades en village, plus doux en forêt.
    this.set(this.reverbSend.gain, reverbWet(s.land), 0.6);
    this.updateBreath(s, dt, coasting, now);
    this.updateAmbience(s, dt, now);
    this.updateCrowd(s, dt, now);
    this.updateTraffic(s, dt);
  }

  /** Boucle de moyeu décodée, ou null (variante synthétisée, pas encore chargée, échec). */
  private freewheelLoop(def: FreewheelDef): AudioBuffer | null {
    if (!def.file) return null;
    const cached = this.loops.get(def.id);
    if (cached !== undefined) return cached;
    this.loops.set(def.id, null);
    const ctx = this.ctx;
    if (ctx && typeof fetch === 'function') {
      void fetch(`${import.meta.env.BASE_URL}audio/freewheel/${def.file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((a) => ctx.decodeAudioData(a))
        .then((b) => this.loops.set(def.id, b))
        .catch(() => undefined); // repli : cliquet synthétisé
    }
    return null;
  }

  private playLoop(def: FreewheelDef, buf: AudioBuffer, clicksPerSecond: number, now: number): void {
    const ctx = this.ctx as BaseAudioContext;
    if (this.loopNode && this.loopNode.id !== def.id) this.stopLoop(now);
    const { voices, rate } = loopVoices(def, clicksPerSecond);
    const node = (this.loopNode ??= { id: def.id, voices: [] });
    // Plusieurs copies décalées de la boucle : plus de cliquets par seconde sans transposer le son.
    while (node.voices.length < voices) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.05;
      src.loopEnd = buf.duration - 0.05;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.clickBus);
      src.start(0, 0.05 + Math.random() * Math.max(0, buf.duration - 0.3));
      node.voices.push({ src, gain });
    }
    // Les boucles sont normalisées : le niveau suit la vitesse de la roue sans exploser au sprint ;
    // en puissance constante quel que soit le nombre de copies.
    const level = Math.min(1, 0.35 + 0.65 * Math.min(1, clicksPerSecond / 60));
    node.voices.forEach((v, i) => {
      v.src.playbackRate.setTargetAtTime(rate, now, 0.08);
      v.gain.gain.setTargetAtTime(i < voices ? ((def.gain ?? 1) * level) / Math.sqrt(voices) : 0, now, 0.1);
    });
  }

  private stopLoop(now: number): void {
    const n = this.loopNode;
    if (!n) return;
    this.loopNode = null;
    for (const v of n.voices) {
      v.gain.gain.setTargetAtTime(0, now, 0.04);
      try {
        v.src.stop(now + 0.3);
      } catch {
        // déjà arrêtée
      }
    }
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
        const herd = src.herd === true || src.kind === 'sheep' || src.kind === 'horses';
        if (next === undefined) {
          // troupeaux visibles (style jeu vidéo) : premier cri vite, le coureur ne fait que passer
          this.nextEvent.set(src, now + Math.random() * (src.kind === 'bells' ? 60 : herd ? 6 : 20));
          continue;
        }
        if (now < next) continue;
        if (src.kind === 'bells') {
          if (bellsOk) bells(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
          this.nextEvent.set(src, now + 90 + Math.random() * 120);
        } else if (herd) {
          // mêmes heures et saisons que les vaches ; plus bavards quand le coureur est tout près
          if (amb0?.cows ?? true) {
            if (src.kind === 'sheep') {
              bleat(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
              if (Math.random() < 0.4) bleat(ctx(this), this.buses.ambience, now + 0.6 + Math.random() * 0.8, gain * 0.7, Math.max(-1, Math.min(1, pan + (Math.random() - 0.5) * 0.4)));
            } else if (src.kind === 'horses') neigh(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
            else moo(ctx(this), this.buses.ambience, now + 0.05, gain, pan);
          }
          this.nextEvent.set(src, now + (d < 60 ? 5 : 10) + Math.random() * (src.kind === 'sheep' ? 12 : 22));
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

  /** Boucles du public enregistré, lancées en silence (le niveau suit ensuite la densité du public). */
  private startCrowdRecordings(): void {
    const c = this.ctx;
    if (!c || this.crowdRec || typeof fetch !== 'function') return;
    const rec: { gains: GainNode[]; ready: boolean } = { gains: [], ready: false };
    this.crowdRec = rec;
    const files = ['murmure.ogg', 'encouragements.ogg', 'rythme.ogg'];
    void Promise.all(
      files.map((f) =>
        fetch(`${import.meta.env.BASE_URL}audio/crowd/${f}`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((a) => c.decodeAudioData(a)),
      ),
    )
      .then((bufs) => {
        for (const buf of bufs) {
          const src = c.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const g = c.createGain();
          g.gain.value = 0;
          src.connect(g).connect(this.buses.crowd);
          // départ au hasard dans la boucle : les trois couches ne repartent jamais ensemble
          src.start(0, Math.random() * buf.duration);
          rec.gains.push(g);
        }
        rec.ready = true;
      })
      .catch(() => undefined); // repli : public synthétisé
  }

  /** Public : rumeur qui enfle, applaudissements, « Allez ! », sifflets, cloches de vache. */
  private updateCrowd(s: AudioState, dt: number, now: number): void {
    const act = crowdActivity(this.paused ? 0 : s.crowd, s.watts / Math.max(s.ftp, 1), s.mountain);
    this.swell += ((0.75 + 0.5 * Math.random()) - this.swell) * Math.min(1, dt * 0.7);
    if (act.bed > 0) this.startCrowdRecordings();
    const rec = this.crowdRec?.ready ? this.crowdRec : null;
    if (rec) {
      // Enregistrements : rumeur selon la densité, encouragements forts quand l'effort monte, rythmés dans
      // les côtes ; la rumeur synthétisée se tait.
      const l = this.paused ? 0 : Math.min(1, Math.max(0, s.crowd));
      const excite = Math.min(1, Math.max(0, (s.watts / Math.max(s.ftp, 1) - 0.75) / 0.5));
      // Niveaux à la mesure d'un public de bord de route (quelques dizaines de personnes, pas un stade).
      this.set(rec.gains[0]!.gain, 0.42 * l, 0.6);
      this.set(rec.gains[1]!.gain, 0.32 * l * (0.2 + 0.8 * excite) * this.swell, 0.6);
      this.set(rec.gains[2]!.gain, (s.mountain ? 0.3 : 0.1) * l * l * (0.3 + 0.7 * excite), 0.8);
      this.set(this.L.crowdLow.gain.gain, 0, 0.5);
      this.set(this.L.crowdHigh.gain.gain, 0, 0.5);
    } else {
      this.set(this.L.crowdLow.gain.gain, act.bed * this.swell, 0.5);
      this.set(this.L.crowdHigh.gain.gain, act.bed * 0.5 * this.swell, 0.5);
    }
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
    // Avec les enregistrements : applaudissements synthétisés plus rares, plus de « Allez ! » de synthèse.
    for (let i = n(act.claps * (rec ? 0.3 : 1)); i > 0; i--) clap(c, out, this.buf.whiteMono, now + Math.random() * 0.05, 0.5 + Math.random() * 0.5, side());
    if (!rec) for (let i = n(act.shouts); i > 0; i--) shout(c, out, now + Math.random() * 0.1, 0.5 + Math.random() * 0.5, side());
    for (let i = n(act.whistles); i > 0; i--) fanWhistle(c, out, now + 0.02, 0.6 + Math.random() * 0.4, side());
    for (let i = n(act.cowbells); i > 0; i--) cowbell(c, out, now + 0.02, 0.6 + Math.random() * 0.4, side());
  }

  /** Voitures : moteur + pneus, atténués, panoramiqués, effet Doppler. */
  private updateTraffic(s: AudioState, dt: number): void {
    const c = ctx(this);
    const list = s.vehicles ?? [];
    const seen = new Set<number>();
    if (s.x !== undefined && s.z !== undefined) {
      const listener = { x: s.x, z: s.z, vx: Math.sin(s.heading) * s.speedMs, vz: Math.cos(s.heading) * s.speedMs, heading: s.heading };
      for (const veh of list) {
        const vv = vehicleVoice(veh, listener);
        let voice = this.traffic.get(veh.id);
        if (!voice) {
          if (vv.gain <= 0) continue;
          voice = this.makeVehicle(veh.kind);
          this.traffic.set(veh.id, voice);
        }
        seen.add(veh.id);
        const speed = Math.hypot(veh.vx, veh.vz);
        const f0 = veh.kind === 'tractor' ? voice.base : voice.base + speed * (veh.kind === 'van' ? 1.3 : 1.6);
        this.set(voice.engine.frequency, f0 * vv.doppler, 0.08);
        this.set(voice.engine2.frequency, f0 * 2.01 * vv.doppler, 0.08);
        this.set(voice.tireFilter.frequency, (500 + speed * 25) * vv.doppler, 0.08);
        this.set(voice.air.frequency, vv.lowpass, 0.08);
        // Repère de l'auditeur (Web Audio : x à droite, −z devant) ; dans le sens de marche f, droite = (−fz, fx).
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        const rx = veh.x - s.x;
        const rz = veh.z - s.z;
        this.set(voice.pan.positionX, rx * -fz + rz * fx, 0.05);
        this.set(voice.pan.positionZ, -(rx * fx + rz * fz), 0.05);
        this.set(voice.out.gain, vv.gain * 0.25, 0.06);
        voice.idle = vv.gain > 0 ? 0 : voice.idle + dt;
      }
    }
    // Véhicules disparus ou hors de portée depuis 2 s : on libère la voix.
    for (const [id, voice] of this.traffic) {
      if (!seen.has(id)) voice.idle += dt;
      if (voice.idle > 2) {
        this.set(voice.out.gain, 0, 0.05);
        const end = c.currentTime + 0.3;
        voice.engine.stop(end);
        voice.engine2.stop(end);
        voice.lfo?.stop(end);
        voice.tire.stop(end);
        this.traffic.delete(id);
      }
    }
  }

  private makeVehicle(kind: VehicleSound['kind']): TrafficVoice {
    const c = ctx(this);
    const out = c.createGain();
    out.gain.value = 0;
    // Volume réglé par vehicleVoice (distance, portée) : le panoramique 3D ne fait que placer le son.
    const pan = c.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0;
    const air = c.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 2000;
    out.connect(air).connect(pan).connect(this.buses.traffic);
    // Moteur : dent de scie + harmonique, filtrés bas ; tracteur : ronflement diesel haché.
    const engineLp = c.createBiquadFilter();
    engineLp.type = 'lowpass';
    engineLp.frequency.value = kind === 'tractor' ? 420 : 650;
    engineLp.Q.value = 1.5;
    const engineGain = c.createGain();
    engineGain.gain.value = kind === 'tractor' ? 0.9 : 0.45;
    engineLp.connect(engineGain).connect(out);
    const engine = c.createOscillator();
    engine.type = 'sawtooth';
    const engine2 = c.createOscillator();
    engine2.type = 'square';
    const e2g = c.createGain();
    e2g.gain.value = 0.25;
    engine.connect(engineLp);
    engine2.connect(e2g).connect(engineLp);
    let lfo: OscillatorNode | null = null;
    if (kind === 'tractor') {
      lfo = c.createOscillator();
      lfo.frequency.value = 9 + Math.random() * 3;
      const depth = c.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth).connect(engineGain.gain);
      lfo.start();
    }
    const tire = c.createBufferSource();
    tire.buffer = this.buf.pinkMono;
    tire.loop = true;
    const tireFilter = c.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.Q.value = 0.7;
    tireFilter.frequency.value = 800;
    const tireGain = c.createGain();
    tireGain.gain.value = kind === 'tractor' ? 0.5 : 1.4;
    tire.connect(tireFilter).connect(tireGain).connect(out);
    const now = c.currentTime;
    engine.start(now);
    engine2.start(now);
    tire.start(now, Math.random() * 3);
    const base = kind === 'tractor' ? 30 + Math.random() * 6 : kind === 'van' ? 34 + Math.random() * 6 : 40 + Math.random() * 10;
    return { engine, engine2, lfo, tire, air, tireFilter, out, pan, base, idle: 0 };
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
