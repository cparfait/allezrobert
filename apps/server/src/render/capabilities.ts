/**
 * Ce que la machine sait rendre, détecté au démarrage du worker vidéo :
 *  - `hyperframes` : CLI HyperFrames + Chromium (chrome-headless-shell) + FFmpeg → vidéo résumé
 *    complète et toutes les séquences ;
 *  - `ffmpeg` : FFmpeg seul → vidéo résumé simplifiée (repli : textes, profil animé) ;
 *  - `null` : pas de FFmpeg → aucun MP4 ; le jeu propose le résumé animé dans le navigateur.
 *
 * FFmpeg : `HYPERFRAMES_FFMPEG_PATH` / `FFMPEG_PATH`, sinon `ffmpeg` du PATH (paquet système de
 * l'image Docker « renderer »). Aucun binaire FFmpeg n'est embarqué dans le dépôt.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export type RenderEngine = 'hyperframes' | 'ffmpeg';

export interface RenderCapabilities {
  ffmpeg: string | null;
  ffmpegVersion: string | null;
  /** Filtre drawtext (libfreetype) : textes du rendu de repli. */
  drawtext: boolean;
  /** Encodeur H.264 (libx264) ; sinon MPEG-4 part 2. */
  libx264: boolean;
  /** CLI HyperFrames installée dans le paquet des séquences. */
  hyperframesCli: boolean;
  /** Chromium headless disponible pour HyperFrames. */
  chrome: boolean;
  engine: RenderEngine | null;
}

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: -1, out: '' });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, out });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
  });
}

/** Chemin de FFmpeg à essayer (variable d'environnement, sinon PATH). */
export function ffmpegCandidate(env: NodeJS.ProcessEnv = process.env): string {
  return env.HYPERFRAMES_FFMPEG_PATH || env.FFMPEG_PATH || 'ffmpeg';
}

function chromeAvailable(env: NodeJS.ProcessEnv): boolean {
  const pinned = env.PRODUCER_HEADLESS_SHELL_PATH;
  if (pinned) return existsSync(pinned);
  // Cache de `npx hyperframes browser ensure`.
  const dir = path.join(os.homedir(), '.cache', 'hyperframes', 'chrome');
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function hyperframesInstalled(projectDir: string): boolean {
  // Le paquet des séquences (scripts de rendu) doit être là, avec sa CLI HyperFrames.
  if (!existsSync(path.join(projectDir, 'scripts', 'render-summary.ts'))) return false;
  try {
    createRequire(path.join(projectDir, 'package.json')).resolve('hyperframes/package.json');
    return true;
  } catch {
    return false;
  }
}

export async function detectCapabilities(projectDir: string, env: NodeJS.ProcessEnv = process.env): Promise<RenderCapabilities> {
  const cand = ffmpegCandidate(env);
  const v = await run(cand, ['-hide_banner', '-version']);
  const ffmpeg = v.code === 0 ? cand : null;
  let drawtext = false;
  let libx264 = false;
  if (ffmpeg) {
    drawtext = /\bdrawtext\b/.test((await run(ffmpeg, ['-hide_banner', '-filters'])).out);
    libx264 = /\blibx264\b/.test((await run(ffmpeg, ['-hide_banner', '-encoders'])).out);
  }
  const hyperframesCli = hyperframesInstalled(projectDir);
  const chrome = chromeAvailable(env);
  const engine: RenderEngine | null = !ffmpeg ? null : hyperframesCli && chrome ? 'hyperframes' : 'ffmpeg';
  return {
    ffmpeg,
    ffmpegVersion: ffmpeg ? (/ffmpeg version (\S+)/.exec(v.out)?.[1] ?? '?') : null,
    drawtext,
    libx264,
    hyperframesCli,
    chrome,
    engine,
  };
}
