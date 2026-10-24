/**
 * Banc d'essai hors ligne du son (développement) : rend quelques secondes de chaque situation
 * avec un OfflineAudioContext, mesure RMS, crête et NaN, et enregistre les WAV dans out/audio/
 * (?save=1). Page : /audio-bench.html ; lanceur : apps/client/scripts/audio-bench.mjs.
 */
import { GameAudio, type AudioState } from './audio.ts';
import { DEFAULT_MIX, type SoundMix } from './mix.ts';
import type { Surface } from './soundscape.ts';

export interface BenchResult {
  name: string;
  seconds: number;
  rmsDb: number;
  peakDb: number;
  nan: number;
  renderMs: number;
  file?: string;
}

interface Scenario {
  name: string;
  seconds?: number;
  mix?: Partial<SoundMix>;
  state: (t: number) => Partial<AudioState>;
  /** Changements de vitesse : [instant, plateau ?]. */
  shifts?: Array<[number, boolean]>;
}

const SR = 48000;
const STEP = 1 / 30;
/** Les bus montent en ~1 s au démarrage : on mesure après. */
const SKIP_S = 1.5;

const base: AudioState = {
  speedMs: 9,
  cadence: 85,
  watts: 180,
  ftp: 250,
  surface: 'smooth',
  wet: 0,
  windMs: 2,
  windFrom: 0,
  heading: 0,
  x: 0,
  z: 0,
  env: { hour: 10, season: 'spring', night: 0, rain: 0 },
  land: { forest: 0.2, urban: 0, open: 0.8 },
  crowd: 0,
  paused: false,
};

const SOLO_BIKE: Partial<SoundMix> = { ambience: 0, breath: 0, crowd: 0, bike: 1, master: 1 };
const SOLO_BREATH: Partial<SoundMix> = { ambience: 0, bike: 0, crowd: 0, breath: 1, master: 1 };
const SOLO_AMB: Partial<SoundMix> = { bike: 0, breath: 0, crowd: 0, ambience: 1, master: 1 };
const ALL_MAX:Partial<SoundMix> = { master: 1, ambience: 1, bike: 1, breath: 1, crowd: 1 };

/** L'auditeur avance vers le sud (z croissant) à la vitesse du scénario. */
const moving = (v: number) => (t: number) => ({ speedMs: v, z: v * t });

export const SCENARIOS: Scenario[] = [
  { name: 'campagne-printemps-aube', seconds: 12, state: (t) => ({ ...moving(8)(t), env: { hour: 7.4, season: 'spring', night: 0.05, rain: 0 } }) },
  { name: 'foret-ete-vent', seconds: 10, state: (t) => ({ ...moving(7)(t), windMs: 8, land: { forest: 1, urban: 0, open: 0 }, env: { hour: 14, season: 'summer', night: 0, rain: 0 } }) },
  { name: 'nuit-ete-grillons', seconds: 12, state: (t) => ({ ...moving(6)(t), land: { forest: 0.5, urban: 0, open: 0.8 }, env: { hour: 22.5, season: 'summer', night: 1, rain: 0 } }) },
  { name: 'village-automne', seconds: 10, state: (t) => ({ ...moving(7)(t), land: { forest: 0, urban: 1, open: 0.1 }, env: { hour: 11, season: 'autumn', night: 0, rain: 0 } }) },
  { name: 'hiver-pluie', seconds: 10, state: (t) => ({ ...moving(8)(t), wet: 1, windMs: 6, env: { hour: 15, season: 'winter', night: 0.1, rain: 0.8 } }) },
  { name: 'paves', seconds: 8, state: (t) => ({ ...moving(8)(t), surface: 'cobbles' }) },
  { name: 'gravier', seconds: 8, state: (t) => ({ ...moving(6)(t), surface: 'gravel', land: { forest: 0.8, urban: 0, open: 0.2 } }) },
  { name: 'roue-libre-descente', seconds: 8, state: (t) => ({ ...moving(15)(t), cadence: 0, watts: 0 }) },
  { name: 'roue-libre-lente', seconds: 6, state: (t) => ({ ...moving(3)(t), cadence: 0, watts: 0 }) },
  {
    name: 'changements-vitesse',
    seconds: 6,
    state: moving(9),
    shifts: [
      [2, false],
      [2.7, false],
      [3.4, false],
      [4.4, true],
    ],
  },
  { name: 'souffle-seuil', seconds: 10, state: (t) => ({ ...moving(9)(t), watts: 260, hr: 172 }) },
  { name: 'public-kom', seconds: 10, state: (t) => ({ ...moving(5)(t), watts: 300, crowd: 1, mountain: true }) },
  {
    name: 'pire-cas',
    seconds: 10,
    mix: ALL_MAX,
    state: (t) => ({
      ...moving(20)(t),
      surface: 'gravel',
      wet: 1,
      windMs: 15,
      watts: 420,
      hr: 195,
      crowd: 1,
      mountain: true,
      land: { forest: 1, urban: 1, open: 1 },
      env: { hour: 20, season: 'summer', night: 0.6, rain: 1 },
    }),
  },
  { name: 'pause', seconds: 6, state: (t) => ({ ...moving(10)(t), paused: true, crowd: 1 }) },
  ...(['smooth', 'rough', 'cobbles', 'gravel', 'dirt'] as Surface[]).map((surface) => ({
    name: `solo-roulement-${surface}`,
    seconds: 5,
    mix: SOLO_BIKE,
    state: (t: number) => ({ ...moving(9)(t), windMs: 0, surface }),
  })),
  ...[150, 220, 260, 320].map((watts) => ({ name: `solo-souffle-${watts}w`, seconds: 8, mix: SOLO_BREATH, state: (t: number) => ({ ...moving(9)(t), watts }) })),
  // Équilibre entre catégories (référence : solo-roulement-smooth, 9 m/s, vent relatif compris).
  { name: 'solo-ambiance-aube', seconds: 12, mix: SOLO_AMB, state: () => ({ speedMs: 0, env: { hour: 7.4, season: 'spring', night: 0.05, rain: 0 } }) },
  { name: 'solo-ambiance-grillons', seconds: 10, mix: SOLO_AMB, state: () => ({ speedMs: 0, land: { forest: 0.3, urban: 0, open: 0.8 }, env: { hour: 22.5, season: 'summer', night: 1, rain: 0 } }) },
  { name: 'solo-ambiance-village', seconds: 10, mix: SOLO_AMB, state: () => ({ speedMs: 0, land: { forest: 0, urban: 1, open: 0 }, env: { hour: 11, season: 'autumn', night: 0, rain: 0 } }) },
  { name: 'solo-ambiance-foret-vent', seconds: 10, mix: SOLO_AMB, state: () => ({ speedMs: 0, windMs: 8, land: { forest: 1, urban: 0, open: 0 }, env: { hour: 14, season: 'summer', night: 0, rain: 0 } }) },
  { name: 'solo-ambiance-pluie', seconds: 8, mix: SOLO_AMB, state: () => ({ speedMs: 0, env: { hour: 15, season: 'autumn', night: 0, rain: 0.8 } }) },
  { name: 'solo-public', seconds: 10, mix: { ...SOLO_AMB, ambience: 0, crowd: 1 }, state: () => ({ speedMs: 5, watts: 280, crowd: 1 }) },
  { name: 'solo-roue-libre-lente', seconds: 6, mix: SOLO_BIKE, state: (t: number) => ({ ...moving(3)(t), cadence: 0, watts: 0, windMs: 0 }) },
];

function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (const c of chans) {
      const x = Math.max(-1, Math.min(1, c[i] as number));
      data.setInt16(o, Math.round(x * 32767), true);
      o += 2;
    }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export async function runScenario(sc: Scenario, save: boolean): Promise<BenchResult> {
  const seconds = sc.seconds ?? 8;
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const audio = new GameAudio({ ...DEFAULT_MIX, ...sc.mix });
  audio.start(ctx);
  const stateAt = (t: number): AudioState => ({ ...base, ...sc.state(t) });
  audio.update(stateAt(0), STEP);
  const shifts = [...(sc.shifts ?? [])];
  for (let t = STEP; t < seconds - STEP; t += STEP) {
    const tt = t;
    void ctx.suspend(tt).then(() => {
      audio.update(stateAt(tt), STEP);
      while (shifts.length && (shifts[0] as [number, boolean])[0] <= tt) audio.shift((shifts.shift() as [number, boolean])[1]);
      void ctx.resume();
    });
  }
  const t0 = performance.now();
  const out = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  let sum = 0;
  let count = 0;
  let peak = 0;
  let nan = 0;
  const from = Math.floor(SKIP_S * SR);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i] as number;
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      peak = Math.max(peak, Math.abs(x));
      if (i >= from) {
        sum += x * x;
        count++;
      }
    }
  }
  const res: BenchResult = { name: sc.name, seconds, rmsDb: db(Math.sqrt(sum / Math.max(1, count))), peakDb: db(peak), nan, renderMs: Math.round(renderMs) };
  if (save) {
    const r = await fetch(`/__save?dir=audio&name=${sc.name}.wav`, { method: 'POST', body: toWav(out) });
    res.file = await r.text();
  }
  return res;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const save = params.has('save');
  const only = params.get('only');
  const results: BenchResult[] = [];
  const log = document.getElementById('log') as HTMLElement;
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue;
    const r = await runScenario(sc, save);
    results.push(r);
    log.textContent += `${r.name.padEnd(28)} RMS ${r.rmsDb.toFixed(1).padStart(6)} dBFS   crête ${r.peakDb.toFixed(1).padStart(6)} dBFS   NaN ${r.nan}   ${r.renderMs} ms\n`;
  }
  (window as unknown as { __bench: unknown }).__bench = { done: true, results };
}

void main().catch((e: unknown) => {
  (window as unknown as { __bench: unknown }).__bench = { done: true, error: String(e) };
});
