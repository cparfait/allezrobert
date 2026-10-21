/**
 * Worker de rendu vidéo (conteneur « renderer » : Node 22 + FFmpeg + Chromium + HyperFrames).
 * Boucle : réserve une tâche `render_jobs` (FOR UPDATE SKIP LOCKED), écrit les variables
 * dans un fichier JSON, lance `hyperframes render`, enregistre le résultat dans RENDERS_DIR
 * (volume partagé avec le serveur, qui sert le fichier via /api/renders/:id/file).
 *
 * Variables d'environnement propres au worker :
 *   RENDER_PROJECT_DIR      projet HyperFrames (défaut /app/packages/sequences)
 *   RENDER_COMPOSITION      motif du fichier de composition (défaut compositions/{name}.html)
 *   RENDER_BIN              exécutable (défaut « hf-render » s'il existe, sinon « hyperframes render »)
 *   RENDER_TIMEOUT_S        délai maximal d'un rendu (défaut 900)
 *   RENDER_POLL_S           intervalle d'interrogation de la file (défaut 5)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.ts';
import { DataCipher } from '../crypto.ts';
import { createDb } from '../db/db.ts';
import { Repos, type RenderJob } from '../db/repos.ts';

const config = loadConfig();
const projectDir = process.env.RENDER_PROJECT_DIR ?? path.resolve('packages/sequences');
const pattern = process.env.RENDER_COMPOSITION ?? 'compositions/{name}.html';
const timeoutS = Number(process.env.RENDER_TIMEOUT_S ?? 900);
const pollS = Number(process.env.RENDER_POLL_S ?? 5);
const rendersDir = path.resolve(config.RENDERS_DIR);

const db = await createDb(config.DATABASE_URL, config.DATABASE_SSL);
const repos = new Repos(db, new DataCipher(config.DATA_ENCRYPTION_KEY));
let stopping = false;

function log(msg: string): void {
  console.log(`${new Date().toISOString()} [renderer] ${msg}`);
}

function command(): { bin: string; args: string[] } {
  if (process.env.RENDER_BIN) return { bin: process.env.RENDER_BIN, args: [] };
  if (existsSync('/usr/local/bin/hf-render')) return { bin: '/usr/local/bin/hf-render', args: [] };
  return { bin: 'hyperframes', args: ['render'] };
}

async function render(job: RenderJob): Promise<void> {
  await mkdir(rendersDir, { recursive: true });
  const varsFile = path.join(os.tmpdir(), `ar-render-${job.id}.json`);
  const outName = `${job.id}.mp4`;
  const out = path.join(rendersDir, outName);
  await writeFile(varsFile, JSON.stringify(job.payload));
  const { bin, args } = command();
  const fullArgs = [...args, projectDir, '-c', pattern.replace('{name}', job.composition), '-o', out, '--variables-file', varsFile, '--workers', '1', '--quiet'];
  log(`rendu ${job.id} (${job.composition})`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, fullArgs, { stdio: ['ignore', 'inherit', 'pipe'], env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' } });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr = (stderr + String(d)).slice(-2000)));
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutS * 1000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`hyperframes a échoué (code ${code}) : ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
      });
    });
    await repos.finishRender(job.id, true, outName, null);
    log(`terminé ${job.id}`);
  } catch (e) {
    await repos.finishRender(job.id, false, null, (e as Error).message.slice(0, 1000));
    log(`échec ${job.id} : ${(e as Error).message}`);
  } finally {
    await rm(varsFile, { force: true });
  }
}

async function loop(): Promise<void> {
  log(`prêt (projet ${projectDir}, sortie ${rendersDir})`);
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
