/**
 * Film d'accueil du menu : capture des images (mode cinématique du client de dev) puis encodage
 * de la boucle par saison dans apps/client/public/menu/loop-<saison>.mp4 (+ .webm) et de l'image
 * fixe still-<saison>.jpg. Mode d'emploi : tools/menu-loop/README.md.
 *
 *   pnpm --filter @allezrobert/menu-loop capture                      (4 saisons, ~1 h 30)
 *   pnpm --filter @allezrobert/menu-loop capture -- --season autumn
 *   pnpm --filter @allezrobert/menu-loop encode -- --season autumn    (images déjà capturées)
 *
 * Par défaut le script lance son propre serveur de dev du client (port 5199, sans rechargement à
 * chaud : une modification de fichier pendant la capture ne recharge pas la page) et un Chrome
 * sans fenêtre (WebGPU, profil dédié dans out/menu-loop/chrome-profile, aucun ralentissement en
 * arrière-plan). --url http://localhost:5173 utilise un serveur existant ; --browser open ouvre
 * l'adresse dans le navigateur par défaut, --browser manual l'affiche seulement ; --headed montre
 * la fenêtre de Chrome. Il vide out/menu-loop/<saison>/, attend le manifeste écrit par la page à
 * la fin de chaque saison (images PNG sans perte), encode avec ffmpeg et extrait des images de
 * contrôle dans out/menu-loop/check-<saison>/.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPoints, DEFAULT_ENCODE, av1Args, mp4Args, stillArgs, webmPasses, type EncodeOptions, type Manifest } from './encode.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(ROOT, 'out/menu-loop');
const PUBLIC = resolve(ROOT, 'apps/client/public/menu');
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null';
/** Image fixe du menu : JPEG d'environ 200 à 300 ko. */
const STILL_MAX_BYTES = 300 * 1024;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const mode = process.argv[2] === 'encode' ? 'encode' : 'capture';
const seasonArg = arg('season', 'all') as string;
const seasons = seasonArg === 'all' ? [...SEASONS] : seasonArg.split(',');
const [w, h] = (arg('size', `${DEFAULT_ENCODE.width}x${DEFAULT_ENCODE.height}`) as string).split('x').map(Number) as [number, number];
/** Suréchantillonnage (rendu à w·ss × h·ss, réduit dans la page) et sous-rendus de l'anticrénelage temporel. */
const ss = Number(arg('ss', '2'));
const sub = Number(arg('sub', '8'));
/** Plafond du MP4 (kbit/s) ; 0 : CRF pur, sans plafond. */
const maxKbps = Number(arg('mp4-max-kbps', String(DEFAULT_ENCODE.mp4MaxKbps ?? 0)));
const enc: EncodeOptions = {
  width: w,
  height: h,
  crf: Number(arg('crf', String(DEFAULT_ENCODE.crf))),
  vp9Crf: Number(arg('vp9-crf', String(DEFAULT_ENCODE.vp9Crf))),
  av1Crf: Number(arg('av1-crf', String(DEFAULT_ENCODE.av1Crf))),
  ...(maxKbps > 0 ? { mp4MaxKbps: maxKbps } : {}),
};
const withWebm = arg('no-webm') === undefined;
const withAv1 = arg('no-av1') === undefined;
const browser = arg('browser', 'chrome') as 'chrome' | 'open' | 'manual';

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

function chromePath(): string {
  const env = process.env.CHROME_PATH;
  if (env) return env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome introuvable : CHROME_PATH=… ou --browser open');
  return found;
}

/**
 * Chrome dédié (WebGPU, profil à part, sans ralentissement des pages masquées), arrêté à la fin.
 * Journal (console de la page comprise) dans out/menu-loop/chrome-<saison>.log.
 */
function launchChrome(url: string, log: string): ChildProcess {
  const args = [
    `--user-data-dir=${resolve(OUT, 'chrome-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1920,1080',
    '--enable-logging=stderr',
    '--v=0',
    ...(arg('headed') ? [] : ['--headless=new']),
    url,
  ];
  mkdirSync(OUT, { recursive: true });
  const fd = openSync(log, 'a');
  const child = spawn(chromePath(), args, { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  process.on('exit', () => killTree(child));
  return child;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

/** Serveur de dev dédié (sans rechargement à chaud), arrêté à la fin du script ; journal dans out/menu-loop/vite.log. */
async function ownServer(): Promise<{ url: string; stop: () => void }> {
  const port = Number(process.env.MENU_LOOP_PORT) || 5199;
  mkdirSync(OUT, { recursive: true });
  const fd = openSync(resolve(OUT, 'vite.log'), 'a');
  const child = spawn('pnpm', ['--filter', '@allezrobert/client', 'exec', 'vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, AR_HMR: '0' },
    stdio: ['ignore', fd, fd],
    shell: process.platform === 'win32',
  });
  closeSync(fd);
  const stop = () => killTree(child);
  process.on('exit', stop);
  const url = `http://localhost:${port}`;
  for (let k = 0; k < 60; k++) {
    if ((await fetch(url).catch(() => null))?.ok) return { url, stop };
    await sleep(1000);
  }
  stop();
  throw new Error(`Le serveur de dev ne répond pas sur ${url}`);
}

/**
 * Attend le manifeste d'une saison (la page écrit les images puis le manifeste). `keepServer` :
 * relance le serveur de dev s'il est tombé (la page retente ses envois pendant 3 min).
 */
async function waitCapture(season: string, chrome: ChildProcess | null, keepServer: () => Promise<void>): Promise<void> {
  const dir = resolve(OUT, season);
  const manifest = resolve(dir, 'manifest.json');
  let last = -1;
  let lastChange = Date.now();
  while (!existsSync(manifest)) {
    await sleep(5000);
    if (chrome && chrome.exitCode !== null) throw new Error(`[${season}] Chrome s'est arrêté (code ${chrome.exitCode})`);
    await keepServer();
    const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).length : 0;
    if (n !== last) {
      last = n;
      lastChange = Date.now();
      process.stdout.write(`\r[${season}] ${n} images`);
    } else if (Date.now() - lastChange > (n > 0 ? 300_000 : 900_000)) throw new Error(`[${season}] capture arrêtée à ${n} images (onglet fermé ?)`);
  }
  console.log(`\n[${season}] capture terminée`);
}

const mb = (f: string) => `${(statSync(f).size / 1048576).toFixed(1)} Mo`;

function encode(season: string): void {
  const dir = resolve(OUT, season);
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as Manifest;
  mkdirSync(PUBLIC, { recursive: true });
  const frames = dir.replaceAll('\\', '/');
  const mp4 = resolve(PUBLIC, `loop-${season}.mp4`);
  console.log(`[${season}] MP4 H.264 ${enc.width}×${enc.height} CRF ${enc.crf}${enc.mp4MaxKbps ? ` (≤ ${enc.mp4MaxKbps} kbit/s)` : ''}…`);
  ffmpeg(mp4Args(m, frames, mp4, enc));
  const outputs = [mp4];
  if (withAv1) {
    const av1 = resolve(PUBLIC, `loop-${season}.av1.mp4`);
    console.log(`[${season}] MP4 AV1 CRF ${enc.av1Crf}…`);
    ffmpeg(av1Args(m, frames, av1, enc));
    outputs.push(av1);
  }
  if (withWebm) {
    const webm = resolve(PUBLIC, `loop-${season}.webm`);
    const passlog = resolve(OUT, `pass-${season}`).replaceAll('\\', '/');
    console.log(`[${season}] WebM VP9 CRF ${enc.vp9Crf}, deux passes…`);
    for (const a of webmPasses(m, frames, webm, passlog, enc, NULL_DEV)) ffmpeg(a);
    for (const f of readdirSync(OUT)) if (f.startsWith(`pass-${season}`)) rmSync(resolve(OUT, f), { force: true });
    outputs.push(webm);
  }
  // Image fixe : première image de la vidéo, la meilleure qualité JPEG sous STILL_MAX_BYTES.
  const still = resolve(PUBLIC, `still-${season}.jpg`);
  for (let q = 2; q <= 12; q++) {
    ffmpeg(stillArgs(mp4, still, q));
    if (statSync(still).size <= STILL_MAX_BYTES) break;
  }
  outputs.push(still);
  // Images de contrôle (dont les deux côtés du raccord) extraites de la vidéo finale, en PNG.
  const check = resolve(OUT, `check-${season}`);
  rmSync(check, { recursive: true, force: true });
  mkdirSync(check, { recursive: true });
  for (const p of checkPoints(m)) {
    ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', `select=eq(n\\,${p.frame})`, '-frames:v', '1', resolve(check, `${p.name}.png`)]);
  }
  for (const f of outputs) console.log(`[${season}] ${f} : ${mb(f)}`);
  console.log(`[${season}] images de contrôle : ${check}`);
}

for (const season of seasons) if (!(SEASONS as readonly string[]).includes(season)) throw new Error(`Saison inconnue : ${season}`);
if (mode === 'encode') {
  for (const season of seasons) encode(season);
} else {
  // Serveur : celui de --url, ou le nôtre (relancé s'il tombe entre deux tentatives).
  let server = arg('url') ? { url: arg('url') as string, stop: () => undefined } : await ownServer();
  const alive = async () => !!(await fetch(server.url, { signal: AbortSignal.timeout(20_000) }).catch(() => null))?.ok;
  const keepServer = async () => {
    if (arg('url') || (await alive())) return;
    console.warn(`
${new Date().toLocaleTimeString()} : serveur de dev arrêté, relance (journal : out/menu-loop/vite.log).`);
    server.stop();
    server = await ownServer();
  };
  if (!(await alive())) throw new Error(`Serveur de dev injoignable sur ${server.url} : lancer « pnpm dev » d'abord.`);
  for (const season of seasons) rmSync(resolve(OUT, season), { recursive: true, force: true });
  const t0 = Date.now();
  /** Saisons restant à capturer ; une capture interrompue reprend sa saison depuis le début. */
  const pending = [...seasons];
  const MAX_RETRIES = 3;
  let retries = 0;
  let chrome: ChildProcess | null = null;
  try {
    while (pending.length) {
      const [first, ...rest] = pending as [string, ...string[]];
      const url = `${server.url}/?cinematic=${first}&world=chevreuse&route=chevreuse-boucle&quality=ultra&fps=30&w=${w}&h=${h}&ss=${ss}&sub=${sub}&capture=1${rest.length ? `&then=${rest.join(',')}` : ''}`;
      if (browser === 'chrome') {
        console.log(`Chrome dédié${arg('headed') ? '' : ' sans fenêtre'} : ${url}`);
        chrome = launchChrome(url, resolve(OUT, `chrome-${first}.log`));
      } else {
        console.log(`Ouvrir dans un onglet d'un navigateur WebGPU (Chrome, Edge) ; il peut rester en arrière-plan :
  ${url}`);
        if (browser === 'open') openBrowser(url);
      }
      try {
        while (pending.length) {
          const season = pending[0] as string;
          await waitCapture(season, chrome, keepServer);
          encode(season);
          pending.shift();
        }
      } catch (err) {
        // Onglet ou serveur tombé (carte graphique partagée, processus arrêté…) : on relance la saison.
        if (chrome) killTree(chrome);
        chrome = null;
        if (browser !== 'chrome' || ++retries > MAX_RETRIES) throw err;
        console.warn(`
${String(err)} : nouvelle tentative ${retries}/${MAX_RETRIES} à partir de « ${pending[0]} »`);
        rmSync(resolve(OUT, pending[0] as string), { recursive: true, force: true });
        if (arg('url') && !(await alive())) throw new Error(`Serveur de dev injoignable sur ${server.url}`);
        await keepServer();
      }
    }
    console.log(`Terminé en ${Math.round((Date.now() - t0) / 60000)} min.`);
  } finally {
    if (chrome) killTree(chrome);
    server.stop();
  }
}
