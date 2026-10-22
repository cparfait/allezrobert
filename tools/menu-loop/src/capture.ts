/**
 * Film d'accueil du menu : capture des images (mode cinématique du client de dev) puis encodage
 * de la boucle par saison dans apps/client/public/menu/loop-<saison>.webm (+ .mp4).
 *
 *   pnpm --filter @allezrobert/menu-loop capture                      (4 saisons)
 *   pnpm --filter @allezrobert/menu-loop capture -- --season autumn --open
 *   pnpm --filter @allezrobert/menu-loop encode -- --season autumn    (images déjà capturées)
 *
 * Par défaut le script lance son propre serveur de dev du client (port 5199, sans rechargement à
 * chaud : une modification de fichier pendant la capture ne recharge pas la page) ; --url
 * http://localhost:5173 utilise un serveur existant. Il vide out/menu-loop/<saison>/, affiche
 * l'adresse à ouvrir dans un navigateur WebGPU (--open : navigateur par défaut ; l'onglet peut
 * rester en arrière-plan, les saisons s'y enchaînent), attend le manifeste écrit par la page à la
 * fin de chaque saison, encode avec ffmpeg et extrait des images de contrôle dans
 * out/menu-loop/check-<saison>/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPoints, DEFAULT_ENCODE, mp4Passes, webmPasses, type EncodeOptions, type Manifest } from './encode.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(ROOT, 'out/menu-loop');
const PUBLIC = resolve(ROOT, 'apps/client/public/menu');
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const mode = process.argv[2] === 'encode' ? 'encode' : 'capture';
const seasonArg = arg('season', 'all') as string;
const seasons = seasonArg === 'all' ? [...SEASONS] : seasonArg.split(',');
const base = arg('url', 'http://localhost:5173') as string;
const [w, h] = (arg('capture-size', '1920x1080') as string).split('x').map(Number) as [number, number];
const [ow, oh] = (arg('size', `${DEFAULT_ENCODE.width}x${DEFAULT_ENCODE.height}`) as string).split('x').map(Number) as [number, number];
const enc: EncodeOptions = {
  width: ow,
  height: oh,
  webmKbps: Number(arg('kbps', String(DEFAULT_ENCODE.webmKbps))),
  mp4Kbps: Number(arg('mp4-kbps', String(DEFAULT_ENCODE.mp4Kbps))),
};
const withMp4 = arg('no-mp4') === undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg a échoué (${r.status}) : ffmpeg ${args.join(' ')}`);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

/** Serveur de dev dédié (sans rechargement à chaud), arrêté à la fin du script. */
async function ownServer(): Promise<{ url: string; stop: () => void }> {
  const port = 5199;
  const child = spawn('pnpm', ['--filter', '@allezrobert/client', 'exec', 'vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, AR_HMR: '0' },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  const stop = () => {
    if (child.pid === undefined) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  };
  process.on('exit', stop);
  const url = `http://localhost:${port}`;
  for (let k = 0; k < 60; k++) {
    if ((await fetch(url).catch(() => null))?.ok) return { url, stop };
    await sleep(1000);
  }
  stop();
  throw new Error(`Le serveur de dev ne répond pas sur ${url}`);
}

/** Attend le manifeste d'une saison (la page écrit les images puis le manifeste). */
async function waitCapture(season: string): Promise<void> {
  const dir = resolve(OUT, season);
  const manifest = resolve(dir, 'manifest.json');
  let last = -1;
  let lastChange = Date.now();
  while (!existsSync(manifest)) {
    await sleep(3000);
    const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')).length : 0;
    if (n !== last) {
      last = n;
      lastChange = Date.now();
      process.stdout.write(`[${season}] ${n} images`);
    } else if (n > 0 && Date.now() - lastChange > 180_000) throw new Error(`[${season}] capture arrêtée à ${n} images (onglet fermé ?)`);
  }
  console.log(`
[${season}] capture terminée`);
}

function encode(season: string): void {
  const dir = resolve(OUT, season);
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as Manifest;
  mkdirSync(PUBLIC, { recursive: true });
  const frames = dir.replaceAll('\\', '/');
  const passlog = resolve(OUT, `pass-${season}`).replaceAll('\\', '/');
  const webm = resolve(PUBLIC, `loop-${season}.webm`);
  console.log(`[${season}] encodage WebM VP9 ${enc.width}×${enc.height} ${enc.webmKbps} kbit/s…`);
  for (const a of webmPasses(m, frames, webm, passlog, enc, NULL_DEV)) ffmpeg(a);
  const outputs = [webm];
  if (withMp4) {
    const mp4 = resolve(PUBLIC, `loop-${season}.mp4`);
    console.log(`[${season}] encodage MP4 H.264 ${enc.mp4Kbps} kbit/s…`);
    for (const a of mp4Passes(m, frames, mp4, `${passlog}-264`, enc, NULL_DEV)) ffmpeg(a);
    outputs.push(mp4);
  }
  for (const f of readdirSync(OUT)) if (f.startsWith(`pass-${season}`)) rmSync(resolve(OUT, f), { force: true });
  // Images de contrôle (dont les deux côtés du raccord) extraites de la vidéo finale.
  const check = resolve(OUT, `check-${season}`);
  rmSync(check, { recursive: true, force: true });
  mkdirSync(check, { recursive: true });
  for (const p of checkPoints(m)) {
    ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-vf', `select=eq(n\\,${p.frame})`, '-frames:v', '1', '-q:v', '3', resolve(check, `${p.name}.jpg`)]);
  }
  for (const f of outputs) console.log(`[${season}] ${f} : ${(statSync(f).size / 1048576).toFixed(2)} Mo`);
  console.log(`[${season}] images de contrôle : ${check}`);
}

for (const season of seasons) if (!(SEASONS as readonly string[]).includes(season)) throw new Error(`Saison inconnue : ${season}`);
if (mode === 'encode') {
  for (const season of seasons) encode(season);
} else {
  const server = arg('url') ? { url: base, stop: () => undefined } : await ownServer();
  if (!(await fetch(server.url).catch(() => null))?.ok) throw new Error(`Serveur de dev injoignable sur ${server.url} : lancer « pnpm dev » d'abord.`);
  for (const season of seasons) rmSync(resolve(OUT, season), { recursive: true, force: true });
  const rest = seasons.slice(1);
  const url = `${server.url}/?cinematic=${seasons[0]}&route=chevreuse-boucle&quality=ultra&fps=30&w=${w}&h=${h}&capture=1${rest.length ? `&then=${rest.join(',')}` : ''}`;
  console.log(`Ouvrir dans un onglet d'un navigateur WebGPU (Chrome, Edge) ; il peut rester en arrière-plan :
  ${url}`);
  if (arg('open')) openBrowser(url);
  try {
    for (const season of seasons) {
      await waitCapture(season);
      encode(season);
    }
  } finally {
    server.stop();
  }
}
