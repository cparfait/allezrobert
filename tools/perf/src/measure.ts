/**
 * Mesure de fluidité d'une sortie : un Chrome sans fenêtre (WebGPU, profil vierge = premier lancement,
 * aucun ralentissement d'arrière-plan) lance une sortie, pousse le simulateur à 1 500 W (≈ 70 km/h :
 * une tuile nouvelle toutes les 50 s) et mesure les images, les saccades et les shaders compilés en
 * roulant. Voir docs/ETUDE_PERFORMANCE.md et tools/perf/README.md.
 *
 *   pnpm --filter @allezrobert/perf measure
 *   pnpm --filter @allezrobert/perf measure -- --world billom --quality high --seconds 90 --cpu
 *
 * Bilan dans out/perf/<monde>-<qualité>-<date>.json ; code de sortie 1 si le budget est dépassé.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { formatStartup, formatSummary, overBudget, summarize, type Probe } from './summary.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(ROOT, 'out/perf');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const world = arg('world', 'billom') as string;
const quality = arg('quality', 'low') as string;
const seconds = Number(arg('seconds', '60'));
/** Secondes de route avant la mesure (départ, premières tuiles). */
const warm = Number(arg('warm', '20'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  if (!found) throw new Error('Chrome introuvable : CHROME_PATH=…');
  return found;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

/** Serveur de dev dédié, sans rechargement à chaud, arrêté à la fin (journal : out/perf/vite.log). */
async function ownServer(): Promise<{ url: string; stop: () => void }> {
  const port = Number(process.env.PERF_PORT) || 5198;
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
  for (let k = 0; k < 90; k++) {
    if ((await fetch(url).catch(() => null))?.ok) return { url, stop };
    await sleep(1000);
  }
  stop();
  throw new Error(`Le serveur de dev ne répond pas sur ${url}`);
}

mkdirSync(OUT, { recursive: true });
const server = arg('url') ? { url: arg('url') as string, stop: () => undefined } : await ownServer();
const profileDir = resolve(OUT, 'chrome-profile');
// Profil vierge par défaut : aucun shader en cache, comme au premier lancement (--warm-cache pour le garder).
if (!arg('warm-cache')) rmSync(profileDir, { recursive: true, force: true });
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: arg('headed') ? false : true,
  userDataDir: profileDir,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1600,900', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 600_000,
});
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const stem = resolve(OUT, `${world}-${quality}-${stamp}`);
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[page]', String(e).slice(0, 200)));
  // tsx (esbuild) ajoute `__name(...)` aux fonctions nommées : les fonctions envoyées à la page en ont besoin.
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f');
  // Sondes posées avant le jeu : appels WebGPU comptés sur le prototype (le jeu relit le prototype à chaque appel).
  await page.evaluateOnNewDocument(() => {
    type Perf = { frames: number; gaps: Array<{ t: number; d: number }>; gpu: Record<string, { c: number; ms: number; max: number }>; shaders: Set<string>; before: number; t0: number };
    const P: Perf = { frames: 0, gaps: [], gpu: {}, shaders: new Set(), before: 0, t0: 0 };
    (window as unknown as { __perf: Perf }).__perf = P;
    if (!('GPUDevice' in window)) return;
    const wrap = (proto: object, name: string) => {
      const o = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
      if (!o) return;
      (proto as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) {
        const s = performance.now();
        const r = o.apply(this, a);
        const d = performance.now() - s;
        const g = (P.gpu[name] ??= { c: 0, ms: 0, max: 0 });
        g.c++;
        g.ms += d;
        g.max = Math.max(g.max, d);
        if (name === 'createShaderModule') P.shaders.add(String((a[0] as { code: string }).code));
        return r;
      };
    };
    for (const n of ['createRenderPipeline', 'createRenderPipelineAsync', 'createShaderModule', 'createTexture', 'createBuffer']) wrap(GPUDevice.prototype, n);
    for (const n of ['copyExternalImageToTexture', 'writeTexture', 'writeBuffer']) wrap(GPUQueue.prototype, n);
  });
  // --query "compileconc=1&ao=0" : paramètres d'URL supplémentaires du jeu.
  const url = `${server.url}/?world=${world}&autostart&nointro&quality=${quality}${arg('query') ? `&${arg('query')}` : ''}`;
  console.log('ouvre', url);
  // --cpu-load : profil processeur du chargement (ouverture de la page → départ de la sortie).
  const loadCdp = arg('cpu-load') ? await page.createCDPSession() : null;
  if (loadCdp) {
    await loadCdp.send('Profiler.enable');
    await loadCdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await loadCdp.send('Profiler.start');
  }
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  // Départ de la sortie : repère posé par le jeu après la précompilation (main.ts).
  const t0 = Date.now();
  for (let k = 0; k < 480 && !(await page.evaluate(() => performance.getEntriesByName('ar:ride-start').length > 0).catch(() => false)); k++) await sleep(500);
  console.log(`sortie lancée en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (loadCdp) writeFileSync(`${stem}.load.cpuprofile`, JSON.stringify((await loadCdp.send('Profiler.stop')).profile));
  // Détail du chargement : repères « ar:… » posés par le jeu (temps depuis l'ouverture de la page) et
  // fichiers de monde reçus.
  const startup = await page.evaluate(() => {
    const marks = performance
      .getEntriesByType('mark')
      .filter((m) => m.name.startsWith('ar:'))
      .map((m) => ({ name: m.name.slice(3), t: Math.round(m.startTime) }))
      .sort((a, b) => a.t - b.t);
    const worlds = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((r) => r.name.includes('/worlds/'));
    return { marks, worldFiles: worlds.length, worldMB: Math.round(worlds.reduce((s, r) => s + r.decodedBodySize, 0) / 1e5) / 10 };
  });
  console.log(formatStartup(startup));
  await page.mouse.click(800, 450).catch(() => undefined);
  for (let i = 0; i < 130; i++) await page.keyboard.press('Equal');
  await sleep(warm * 1000);
  const cdp = arg('cpu') ? await page.createCDPSession() : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  if (arg('trace')) await page.tracing.start({ path: `${stem}.trace.json`, categories: arg('trace') === 'gpu' ? ['gpu.dawn'] : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.gc', 'gpu.dawn', 'toplevel'] });
  await page.evaluate(() => {
    const P = (window as unknown as { __perf: { frames: number; gaps: Array<{ t: number; d: number }>; gpu: Record<string, unknown>; shaders: Set<string>; before: number; t0: number } }).__perf;
    P.gpu = {};
    P.before = P.shaders.size;
    P.t0 = performance.now();
    let last = 0;
    const tick = (t: number) => {
      P.frames++;
      if (last && t - last > 40) P.gaps.push({ t: Math.round(last - P.t0), d: Math.round(t - last) });
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await sleep(seconds * 1000);
  const probe = await page.evaluate(() => {
    const P = (window as unknown as { __perf: { frames: number; gaps: Array<{ t: number; d: number }>; gpu: Record<string, { c: number; ms: number; max: number }>; shaders: Set<string>; before: number } }).__perf;
    return { frames: P.frames, gaps: P.gaps, gpu: P.gpu, shadersDuring: P.shaders.size - P.before, shadersBefore: P.before } satisfies Probe;
  });
  // Scène en fin de mesure : appels de dessin et triangles de la dernière image, maillages du bâti
  // (sommets et octets des attributs : coût mémoire des façades).
  const scene = await page.evaluate(() => {
    type Geo = { attributes: Record<string, { count: number; array: ArrayLike<number> & { BYTES_PER_ELEMENT: number } }> };
    type Obj = { isMesh?: boolean; geometry?: Geo; children: Obj[] };
    const ar = (window as unknown as { __ar?: { engine?: { renderer?: { info?: { render?: { drawCalls: number; triangles: number } } } }; world?: { buildings?: { group: Obj } } } }).__ar;
    const info = ar?.engine?.renderer?.info?.render;
    let meshes = 0;
    let vertices = 0;
    let bytes = 0;
    const walk = (o: Obj) => {
      if (o.isMesh && o.geometry) {
        meshes++;
        vertices += o.geometry.attributes.position?.count ?? 0;
        for (const a of Object.values(o.geometry.attributes)) bytes += a.array.length * a.array.BYTES_PER_ELEMENT;
      }
      for (const c of o.children) walk(c);
    };
    if (ar?.world?.buildings) walk(ar.world.buildings.group);
    return { drawCalls: info?.drawCalls ?? -1, triangles: info?.triangles ?? -1, buildings: { meshes, vertices, mb: Math.round(bytes / 1e5) / 10 } };
  });
  // --probe-buildings : part des sommets des bâtiments qui se répètent à l'identique (gain possible d'une indexation).
  if (arg('probe-buildings')) {
    const dup = await page.evaluate(() => {
      type A = { array: ArrayLike<number>; itemSize: number; count: number };
      type M = { isMesh?: boolean; geometry?: { attributes: Record<string, A>; index: unknown }; children: M[] };
      const ar = (window as unknown as { __ar?: { world?: { buildings?: { group: M } } } }).__ar;
      const meshes: M[] = [];
      const walk = (o: M) => {
        if (o.isMesh && o.geometry) meshes.push(o);
        o.children.forEach(walk);
      };
      if (ar?.world?.buildings) walk(ar.world.buildings.group);
      let total = 0;
      let unique = 0;
      let indexed = 0;
      for (const m of meshes.slice(0, 6)) {
        const g = m.geometry as NonNullable<M['geometry']>;
        if (g.index) indexed++;
        const attrs = Object.values(g.attributes);
        const n = attrs[0]?.count ?? 0;
        const seen = new Set<string>();
        for (let i = 0; i < n; i++) {
          let key = '';
          for (const a of attrs) for (let k = 0; k < a.itemSize; k++) key += `${a.array[i * a.itemSize + k]},`;
          seen.add(key);
        }
        total += n;
        unique += seen.size;
      }
      return { meshes: Math.min(meshes.length, 6), indexed, total, unique };
    });
    console.log(`sommets de bâtiments (${dup.meshes} maillages, ${dup.indexed} indexés) : ${dup.total} dont ${dup.unique} uniques (${((100 * dup.unique) / Math.max(dup.total, 1)).toFixed(0)} %)`);
  }
  if (arg('trace')) await page.tracing.stop();
  if (cdp) writeFileSync(`${stem}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  await page.screenshot({ path: `${stem}.jpg`, quality: 70 });
  const summary = summarize(probe, seconds);
  writeFileSync(`${stem}.json`, JSON.stringify({ world, quality, seconds, summary, startup, scene, probe }, null, 1));
  console.log(`shaders compilés avant la mesure (chargement, départ) : ${probe.shadersBefore}`);
  console.log(formatSummary(summary));
  console.log(`scène : ${scene.drawCalls} appels de dessin, ${(scene.triangles / 1e6).toFixed(2)} M triangles · bâti : ${scene.buildings.meshes} maillages, ${(scene.buildings.vertices / 1e6).toFixed(2)} M sommets, ${scene.buildings.mb} Mo d'attributs`);
  console.log('pires saccades (ms depuis le début : durée) :', [...probe.gaps].sort((a, b) => b.d - a.d).slice(0, 8).map((g) => `${g.t}:${g.d}`).join(' '));
  console.log(`bilan : ${stem}.json${cdp ? ' (+ .cpuprofile)' : ''}${arg('trace') ? ' (+ .trace.json)' : ''}`);
  const over = overBudget(summary);
  if (over.length) {
    console.log(`BUDGET DÉPASSÉ :\n  ${over.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log('budget tenu');
} finally {
  await browser.close();
  server.stop();
}
