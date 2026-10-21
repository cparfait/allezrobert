/**
 * Worker de rendu vidéo (conteneur « renderer » : Node 22 + FFmpeg + Chromium + HyperFrames).
 * Boucle : réserve une tâche `render_jobs` (FOR UPDATE SKIP LOCKED), puis délègue le rendu
 * aux scripts de packages/sequences (source unique des compositions et de leurs variables) :
 *   - « summary » : scripts/render-summary.ts <entrée RideSummaryInput> <sortie.mp4>
 *   - autres séquences (intro, kom, sprint, podium, tv) : scripts/hf.ts render <nom> <vars.json> --out <sortie.mp4>
 * Le MP4 est écrit dans RENDERS_DIR (volume partagé avec le serveur, qui le sert via
 * /api/renders/:id/file).
 *
 * Variables d'environnement propres au worker :
 *   RENDER_PROJECT_DIR   paquet des séquences (défaut : packages/sequences du dépôt)
 *   RENDER_QUALITY       draft | looks | delivery (défaut looks)
 *   RENDER_TIMEOUT_S     délai maximal d'un rendu (défaut 900)
 *   RENDER_POLL_S        intervalle d'interrogation de la file (défaut 5)
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.ts';
import { DataCipher } from '../crypto.ts';
import { createDb } from '../db/db.ts';
import { Repos, type RenderJob } from '../db/repos.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const projectDir = path.resolve(process.env.RENDER_PROJECT_DIR ?? path.join(here, '../../../../packages/sequences'));
const quality = process.env.RENDER_QUALITY ?? 'looks';
const timeoutS = Number(process.env.RENDER_TIMEOUT_S ?? 900);
const pollS = Number(process.env.RENDER_POLL_S ?? 5);
const rendersDir = path.resolve(config.RENDERS_DIR);
/** CLI tsx du serveur (exécute les scripts TypeScript des séquences). */
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

const db = await createDb(config.DATABASE_URL, config.DATABASE_SSL);
const repos = new Repos(db, new DataCipher(config.DATA_ENCRYPTION_KEY));
let stopping = false;

function log(msg: string): void {
  console.log(`${new Date().toISOString()} [renderer] ${msg}`);
}

function run(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, ...args], {
      cwd: projectDir,
      stdio: ['ignore', 'inherit', 'pipe'],
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      stderr = (stderr + String(d)).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutS * 1000);
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

async function render(job: RenderJob): Promise<void> {
  await mkdir(rendersDir, { recursive: true });
  const inputFile = path.join(os.tmpdir(), `ar-render-${job.id}.json`);
  const outName = `${job.id}.mp4`;
  const out = path.join(rendersDir, outName);
  const p = job.payload as { kind?: string; lang?: string; input?: unknown; variables?: unknown };
  log(`rendu ${job.id} (${job.composition})`);
  try {
    if (job.composition === 'summary') {
      await writeFile(inputFile, JSON.stringify(p.input ?? {}));
      await run(['scripts/render-summary.ts', inputFile, out, '--lang', p.lang === 'en' ? 'en' : 'fr', '--quality', quality, '--workers', '1']);
    } else {
      await writeFile(inputFile, JSON.stringify(p.variables ?? {}));
      await run(['scripts/hf.ts', 'render', job.composition, inputFile, '--out', out, '--quality', quality]);
    }
    await repos.finishRender(job.id, true, outName, null);
    log(`terminé ${job.id}`);
  } catch (e) {
    await repos.finishRender(job.id, false, null, (e as Error).message.slice(0, 1000));
    log(`échec ${job.id} : ${(e as Error).message}`);
  } finally {
    await rm(inputFile, { force: true });
  }
}

async function loop(): Promise<void> {
  log(`prêt (séquences ${projectDir}, sortie ${rendersDir})`);
  while (!stopping) {
    try {
      await repos.requeueStaleRenders(Math.ceil(timeoutS / 60) + 5);
      const job = await repos.claimRender();
      if (job) {
        await render(job);
        continue;
      }
    } catch (e) {
      log(`erreur de file : ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, pollS * 1000));
  }
  await db.close();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));
await loop();
