import type { CoachLine } from '../game/ftpCoach.ts';
import { music } from './music.ts';

/**
 * Voix du coach (test FTP) : morceaux enregistrés livrés avec le jeu (public/voice/coach, voir coachLines.ts),
 * aucun appel d'API pendant le test. Joués sur le bus « voix » du jeu (volume général, sortie audio choisie),
 * enchaînés après avoir rogné leurs blancs (`trimSilence`).
 *
 * File d'attente : une phrase à la fois ; une phrase périmée (`ttlS`) est abandonnée ; une phrase `urgent`
 * passe devant et coupe une phrase ordinaire en cours. La musique est baissée pendant la voix.
 */

type Out = { ctx: BaseAudioContext; dest: AudioNode };

interface Queued {
  keys: string[];
  urgent: boolean;
  deadline: number;
}

type Table = Record<string, Record<string, string> | undefined>;
/** Banques de morceaux (public/voice/<banque>/<banque>.json) : « coach », « ds » (directeur sportif, dsLines.ts). */
const tables = new Map<string, Promise<Table>>();
const loadTable = (bank: string): Promise<Table> => {
  let t = tables.get(bank);
  if (!t) {
    t = fetch(`/voice/${bank}/${bank}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Table>) : {}))
      .catch((): Table => ({}));
    tables.set(bank, t);
  }
  return t;
};

/** Seuil du blanc (≈ −40 dB) et marge gardée autour de la voix (s). */
const SILENCE = 0.01;
const PAD_S = 0.025;

/**
 * Retire les blancs de début et de fin d'un morceau (≈ 0,15 s devant, 0,2 s derrière dans les fichiers
 * Cartesia) : sans cela, « deux cent | quarante-cinq | watts » serait haché.
 */
export function trimSilence(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const n = b.length;
  let first = n;
  let last = -1;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    let i = 0;
    while (i < first && Math.abs(d[i] as number) < SILENCE) i++;
    first = Math.min(first, i);
    let j = n - 1;
    while (j > last && Math.abs(d[j] as number) < SILENCE) j--;
    last = Math.max(last, j);
  }
  if (last < first) return b;
  const pad = Math.round(PAD_S * b.sampleRate);
  const from = Math.max(0, first - pad);
  const to = Math.min(n, last + pad + 1);
  if (from === 0 && to === n) return b;
  const out = ctx.createBuffer(b.numberOfChannels, to - from, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(from, to), c);
  return out;
}

export class CoachVoice {
  private readonly queue: Queued[] = [];
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing: { urgent: boolean; stop: () => void } | null = null;
  private running = false;
  private stopped = false;

  /** `banks` : banques lues dans l'ordre, la première qui a la clé la donne (le directeur sportif lit « ds » puis « coach »). */
  constructor(
    private readonly out: () => Out | null,
    private readonly lang: 'fr' | 'en',
    private readonly banks: readonly string[] = ['coach'],
  ) {
    for (const b of banks) void loadTable(b);
  }

  /** Toutes ces clés sont-elles enregistrées ? (Sinon l'appelant dit la phrase autrement.) */
  async has(keys: readonly string[]): Promise<boolean> {
    const ts = await Promise.all(this.banks.map(loadTable));
    return keys.every((k) => ts.some((t) => t[this.lang]?.[k]));
  }

  /** Décode des morceaux à l'avance (alertes dites sans délai). */
  preload(keys: string[]): void {
    for (const k of keys) void this.buffer(k);
  }

  say(lines: CoachLine[]): void {
    if (this.stopped || !lines.length) return;
    const now = performance.now();
    for (const l of lines) {
      if (!l.keys.length) continue;
      const q: Queued = { keys: l.keys, urgent: !!l.urgent, deadline: now + (l.ttlS ?? 12) * 1000 };
      this.preload(l.keys);
      if (q.urgent) {
        // Devant les phrases ordinaires, derrière les autres urgences.
        const at = this.queue.findIndex((x) => !x.urgent);
        this.queue.splice(at < 0 ? this.queue.length : at, 0, q);
        if (this.playing && !this.playing.urgent) this.playing.stop();
      } else this.queue.push(q);
    }
    if (!this.running) void this.next();
  }

  /** Coupe tout (fin de sortie). */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.playing?.stop();
    this.playing = null;
    music.talkOver(false);
  }

  private buffer(key: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(key);
    if (!p) {
      p = Promise.all(this.banks.map(loadTable)).then(async (ts) => {
        const i = ts.findIndex((t) => t[this.lang]?.[key]);
        const file = i < 0 ? undefined : ts[i]?.[this.lang]?.[key];
        const o = this.out();
        if (!file || !o) return null;
        try {
          const r = await fetch(`/voice/${this.banks[i]}/${file}`);
          return r.ok ? trimSilence(o.ctx, await o.ctx.decodeAudioData(await r.arrayBuffer())) : null;
        } catch {
          return null;
        }
      });
      // Audio du jeu pas encore lancé : le morceau sera redemandé.
      void p.then((b) => {
        if (!b) this.buffers.delete(key);
      });
      this.buffers.set(key, p);
    }
    return p;
  }

  private async next(): Promise<void> {
    this.running = true;
    while (!this.stopped) {
      const q = this.queue.shift();
      if (!q) break;
      if (performance.now() > q.deadline) continue;
      const o = this.out();
      if (!o) continue;
      const bufs = (await Promise.all(q.keys.map((k) => this.buffer(k)))).filter((b): b is AudioBuffer => !!b);
      if (this.stopped) break;
      // Une urgence arrivée pendant le chargement passe d'abord ; cette phrase revient ensuite.
      if (!q.urgent && this.queue[0]?.urgent) {
        this.queue.splice(1, 0, q);
        continue;
      }
      if (!bufs.length) continue;
      music.talkOver(true);
      await this.play(bufs, q.urgent, o);
    }
    this.playing = null;
    this.running = false;
    music.talkOver(false);
  }

  /** Enchaîne les morceaux et attend la fin. */
  private play(bufs: AudioBuffer[], urgent: boolean, o: Out): Promise<void> {
    return new Promise((res) => {
      const ctx = o.ctx;
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(o.dest);
      const srcs: AudioBufferSourceNode[] = [];
      let t = ctx.currentTime + 0.03;
      for (const b of bufs) {
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(g);
        s.start(t);
        srcs.push(s);
        // Morceaux rognés : un souffle de 60 ms entre deux, comme une phrase dite d'une traite.
        t += b.duration + 0.06;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const s of srcs) {
          try {
            s.stop();
          } catch {
            // déjà finie
          }
          s.disconnect();
        }
        g.disconnect();
        this.playing = null;
        res();
      };
      const timer = setTimeout(finish, (t - ctx.currentTime + 0.15) * 1000);
      this.playing = { urgent, stop: finish };
    });
  }
}
