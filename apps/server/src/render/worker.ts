/**
 * Worker de rendu vidéo : file `render_jobs` (PostgreSQL ; pg-mem en développement) → MP4
 * dans RENDERS_DIR, servis par `GET /api/renders/:id/file`.
 *
 * Moteurs, du plus riche au plus simple (voir capabilities.ts) :
 *  1. HyperFrames (Chromium + FFmpeg) : scripts de packages/sequences —
 *     « summary » : scripts/render-summary.ts ; autres séquences : scripts/hf.ts render ;
 *  2. repli FFmpeg seul pour la vidéo résumé (ffmpeg-summary.ts), aussi utilisé si le rendu
 *     HyperFrames échoue ;
 *  3. sans FFmpeg : la tâche échoue avec un message clair ; le jeu propose alors le résumé
 *     animé dans le navigateur.
 *
 * Tourne dans le conteneur « renderer » (render-worker.ts) ou dans le serveur lui-même
 * (`RENDER_INLINE=true`, petit VPS ou développement). Pouls et moteur écrits dans
 * RENDERS_DIR/worker.json, lu par `GET /api/renders/capabilities`.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { RenderJob } from '../db/repos.ts';
import { detectCapabilities, type RenderCapabilities, type RenderEngine } from './capabilities.ts';
import { renderFallbackSummary, type FallbackSummaryInput } from './ffmpeg-summary.ts';

export interface RenderQueue {
  claimRender(): Promise<RenderJob | null>;
  finishRender(id: string, ok: boolean, outputFile: string | null, error: string | null): Promise<void>;
  requeueStaleRenders(olderThanMin?: number): Promise<void>;
}

export interface RenderWorkerOptions {
  queue: RenderQueue;
  rendersDir: string;
  /** Paquet des séquences (scripts HyperFrames). */
  projectDir: string;
  quality?: string;
  timeoutS?: number;
  pollS?: number;
  inline?: boolean;
  log?: (msg: string) => void;
  /** Capacités imposées (tests) ; sinon détectées au démarrage. */
  capabilities?: RenderCapabilities;
  /** Rendu HyperFrames (tests) ; sinon scripts de packages/sequences via tsx. */
  hyperframes?: (job: RenderJob, out: string) => Promise<void>;
}

/** Contenu de RENDERS_DIR/worker.json. */
export interface WorkerHeartbeat {
  at: number;
  engine: RenderEngine | null;
  ffmpeg: string | null;
  chrome: boolean;
  inline: boolean;
  pollS: number;
}

export const HEARTBEAT_FILE = 'worker.json';

/** Pouls du worker : disponible s'il a donné signe de vie récemment. */
export async function readHeartbeat(rendersDir: string, now = Date.now()): Promise<{ available: boolean; heartbeat: WorkerHeartbeat | null }> {
  try {
    const hb = JSON.parse(await readFile(path.join(rendersDir, HEARTBEAT_FILE), 'utf8')) as WorkerHeartbeat;
    const fresh = now - hb.at < Math.max(60_000, hb.pollS * 3000 + 30_000);
    return { available: fresh && hb.engine !== null, heartbeat: hb };
  } catch {
    return { available: false, heartbeat: null };
  }
}

export class RenderWorker {
  readonly o: Required<Omit<RenderWorkerOptions, 'capabilities' | 'hyperframes'>> & Pick<RenderWorkerOptions, 'hyperframes'>;
  caps: RenderCapabilities | null;
  private stopping = false;
  private wake: (() => void) | null = null;
  private loopDone: Promise<void> | null = null;

  constructor(o: RenderWorkerOptions) {
    this.o = {
      queue: o.queue,
      rendersDir: path.resolve(o.rendersDir),
      projectDir: path.resolve(o.projectDir),
      quality: o.quality ?? 'looks',
      timeoutS: o.timeoutS ?? 900,
      pollS: o.pollS ?? 5,
      inline: o.inline ?? false,
      log: o.log ?? ((m) => console.log(`${new Date().toISOString()} [renderer] ${m}`)),
      ...(o.hyperframes ? { hyperframes: o.hyperframes } : {}),
    };
    this.caps = o.capabilities ?? null;
  }

  async init(): Promise<RenderCapabilities> {
    this.caps ??= await detectCapabilities(this.o.projectDir);
    const c = this.caps;
    await mkdir(this.o.rendersDir, { recursive: true });
    this.o.log(
      c.engine === 'hyperframes'
        ? `prêt : HyperFrames + FFmpeg ${c.ffmpegVersion} (sortie ${this.o.rendersDir})`
        : c.engine === 'ffmpeg'
          ? `prêt en mode simplifié : FFmpeg ${c.ffmpegVersion} sans ${c.hyperframesCli ? 'Chromium' : 'CLI HyperFrames'} (vidéo résumé de repli)`
          : 'FFmpeg introuvable : aucune vidéo ne pourra être rendue (installer ffmpeg ou définir FFMPEG_PATH)',
    );
    await this.heartbeat();
    return c;
  }

  async heartbeat(): Promise<void> {
    const c = this.caps;
    const hb: WorkerHeartbeat = { at: Date.now(), engine: c?.engine ?? null, ffmpeg: c?.ffmpeg ?? null, chrome: c?.chrome ?? false, inline: this.o.inline, pollS: this.o.pollS };
    await writeFile(path.join(this.o.rendersDir, HEARTBEAT_FILE), JSON.stringify(hb)).catch(() => undefined);
  }

  /** Traite au plus une tâche ; renvoie vrai si une tâche a été prise. */
  async tick(): Promise<boolean> {
    await this.o.queue.requeueStaleRenders(Math.ceil(this.o.timeoutS / 60) + 5).catch(() => undefined);
    const job = await this.o.queue.claimRender();
    if (!job) return false;
    await this.render(job);
    return true;
  }

  async render(job: RenderJob): Promise<void> {
    const outName = `${job.id}.mp4`;
    const out = path.join(this.o.rendersDir, outName);
    const c = this.caps ?? (await this.init());
    this.o.log(`rendu ${job.id} (${job.composition}, ${c.engine ?? 'aucun moteur'})`);
    try {
      if (!c.ffmpeg) throw new Error('ffmpeg absent sur le serveur de rendu : vidéo impossible (voir docs/DEPLOY.md, rendu vidéo)');
      let done = false;
      if (c.engine === 'hyperframes') {
        try {
          await (this.o.hyperframes ?? ((j, o) => this.runHyperframes(j, o)))(job, out);
          done = true;
        } catch (e) {
          if (job.composition !== 'summary') throw e;
          this.o.log(`HyperFrames en échec (${(e as Error).message}) : repli FFmpeg`);
        }
      }
      if (!done) {
        if (job.composition !== 'summary') throw new Error(`la séquence « ${job.composition} » nécessite HyperFrames (Chromium) ; seule la vidéo résumé a un repli FFmpeg`);
        const p = job.payload as { lang?: string; input?: FallbackSummaryInput };
        await renderFallbackSummary({ ...(p.input ?? {}), lang: p.lang === 'en' ? 'en' : 'fr' }, out, c, { timeoutS: this.o.timeoutS });
      }
      await this.o.queue.finishRender(job.id, true, outName, null);
      this.o.log(`terminé ${job.id}`);
    } catch (e) {
      await rm(out, { force: true });
      await this.o.queue.finishRender(job.id, false, null, (e as Error).message.slice(0, 1000));
      this.o.log(`échec ${job.id} : ${(e as Error).message}`);
    }
  }

  /** Rendu HyperFrames : scripts de packages/sequences exécutés avec tsx. */
  private async runHyperframes(job: RenderJob, out: string): Promise<void> {
    const inputFile = path.join(os.tmpdir(), `ar-render-${job.id}.json`);
    const p = job.payload as { lang?: string; input?: unknown; variables?: unknown };
    try {
      if (job.composition === 'summary') {
        await writeFile(inputFile, JSON.stringify(p.input ?? {}));
        await this.tsx(['scripts/render-summary.ts', inputFile, out, '--lang', p.lang === 'en' ? 'en' : 'fr', '--quality', this.o.quality, '--workers', '1']);
      } else {
        await writeFile(inputFile, JSON.stringify(p.variables ?? {}));
        await this.tsx(['scripts/hf.ts', 'render', job.composition, inputFile, '--out', out, '--quality', this.o.quality]);
      }
    } finally {
      await rm(inputFile, { force: true });
    }
  }

  private tsx(args: string[]): Promise<void> {
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [tsxCli, ...args], {
        cwd: this.o.projectDir,
        stdio: ['ignore', 'inherit', 'pipe'],
        env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
      });
      let stderr = '';
      child.stderr.on('data', (d) => {
        process.stderr.write(d);
        stderr = (stderr + String(d)).slice(-2000);
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), this.o.timeoutS * 1000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`rendu échoué (code ${code}) : ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
      });
    });
  }

  /** Boucle : une tâche après l'autre, pouls à chaque tour ; `nudge()` réveille tout de suite. */
  start(): Promise<void> {
    this.loopDone ??= (async () => {
      if (!this.caps) await this.init();
      while (!this.stopping) {
        try {
          await this.heartbeat();
          if (await this.tick()) continue;
        } catch (e) {
          this.o.log(`erreur de file : ${(e as Error).message}`);
        }
        await new Promise<void>((r) => {
          const t = setTimeout(r, this.o.pollS * 1000);
          this.wake = () => {
            clearTimeout(t);
            r();
          };
        });
        this.wake = null;
      }
    })();
    return this.loopDone;
  }

  /** Nouvelle tâche en file : ne pas attendre la prochaine interrogation. */
  nudge(): void {
    this.wake?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.nudge();
    await this.loopDone;
  }
}
