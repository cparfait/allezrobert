/**
 * Banc d'essai automatisé du lecteur en jeu (SequencePlayer dans le banc dev/ servi par Vite).
 *
 *   pnpm --filter @allezrobert/sequences dev        (dans un autre terminal)
 *   tsx scripts/bench.ts [--url http://localhost:5180] [--width 1920 --height 1080]
 *
 * Lance le Chrome épinglé de HyperFrames (headless), joue chaque séquence par-dessus un canvas
 * animé, mesure la cadence d'images de la page hôte (rAF) et enregistre des captures dans
 * out/bench/. Les fps en headless (rendu logiciel) sont indicatifs : comparer avec / sans
 * séquence, pas à une valeur absolue.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hyperframesBin } from './render-summary.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1]! : d;
};
const URL_ = arg('--url', 'http://localhost:5180/?nopreload');
const W = Number(arg('--width', '1920'));
const H = Number(arg('--height', '1080'));
const OUT = join(ROOT, 'out', 'bench', `${W}x${H}`);

// puppeteer-core vient des dépendances de la CLI hyperframes (types non exposés ici).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Puppeteer = { launch: (options: object) => Promise<any> };

async function main() {
  const req = createRequire(createRequire(join(ROOT, 'package.json')).resolve('hyperframes/package.json'));
  const puppeteer = req('puppeteer-core') as Puppeteer;
  const chrome = execFileSync(process.execPath, [hyperframesBin(), 'browser', 'path'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .pop()!;
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    defaultViewport: { width: W, height: H },
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', (m: { text(): string; type(): string }) => {
    const t = m.text();
    if (t.startsWith('[sequences]') || m.type() === 'error') console.log('  console:', t);
  });
  // tsx (esbuild keepNames) injecte __name() dans les fonctions passées à evaluate.
  await page.evaluateOnNewDocument('window.__name = (f) => f;');
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.seq !== undefined');
  const tp = Date.now();
  await page.evaluate((warm: boolean) => (window as any).seq.preload(undefined, { warm }), !argv.includes('--no-warm'));
  console.log(`préchargement + chauffe : ${Date.now() - tp} ms`);

  // Mesure rAF de la page hôte sur une fenêtre de temps.
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const loop = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const stats = async (fromIdx: number) =>
    page.evaluate((from: number) => {
      const f: number[] = (window as any).__frames.slice(from);
      const sorted = [...f].sort((a, b) => a - b);
      const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
      return {
        frames: f.length,
        fps: +(1000 / avg).toFixed(1),
        p95ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
        worstMs: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
      };
    }, fromIdx);
  const mark = () => page.evaluate(() => (window as any).__frames.length as number);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Référence sans séquence
  let m0 = await mark();
  await sleep(2000);
  console.log('référence (sans séquence)', await stats(m0));

  const runs: Array<{ name: string; vars: Record<string, unknown>; shots: number[]; opts?: Record<string, unknown> }> = [
    { name: 'intro', vars: { route_name: 'Les 17 Tournants', distance_km: 28.6, elevation_m: 418, riders: 9, profile: [88, 104, 160, 120, 171, 205, 140, 177, 203] }, shots: [1.9, 3.2, 5.4] },
    { name: 'kom', vars: { segment_name: 'Côte des 17 Tournants', time_s: 402.1, rank: 4, rank_total: 12, gap_s: 18.6, pr: true, pr_delta_s: 11 }, shots: [1.8] },
    { name: 'sprint', vars: { segment_name: 'Sprint de Dampierre', time_s: 21.8, rank: 1, rank_total: 12 }, shots: [1.6], opts: { lang: 'en' } },
    { name: 'podium', vars: {}, shots: [3.0] },
  ];
  const repeat = Number(arg('--repeat', '1'));
  for (const r of Array.from({ length: repeat }, () => runs).flat()) {
    m0 = await mark();
    const t0 = Date.now();
    const done = page.evaluate(
      (name: string, vars: Record<string, unknown>, opts: Record<string, unknown>) =>
        (window as any).seq.play(name, vars, { ...opts, onCue: (c: string) => console.log(`[sequences] cue ${c}`) }),
      r.name,
      r.vars,
      r.opts ?? {}
    );
    // Les captures sont prises en temps mural depuis l'appel (inclut le chargement).
    for (const s of r.shots) {
      const wait = s * 1000 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      await page.screenshot({ path: join(OUT, `${r.name}-${s}s.png`) as `${string}.png` });
    }
    const res = await done;
    console.log(r.name, res, `${((Date.now() - t0) / 1000).toFixed(2)} s`, await stats(m0));
  }

  // Habillage TV : maintien, mise à jour en direct, sortie.
  m0 = await mark();
  let t0 = Date.now();
  const tv = page.evaluate(() =>
    (window as any).seq.play('tv', { rider_name: 'Christophe P.', team: 'Les Pois Chiches', position: 4, wkg: 4.6, watts: 341 }, { hold: true })
  );
  await sleep(3000);
  await page.screenshot({ path: join(OUT, 'tv-hold.png') as `${string}.png` });
  await page.evaluate(() =>
    (window as any).seq.update({ wkg: 5.1, watts: 378, position: 3, groups: [{ label: 'tv.breakaway', riders: 4, gap_s: 0 }, { label: 'tv.peloton', riders: 11, gap_s: 31 }], focus_group: 0 })
  );
  await sleep(6000);
  const holding = await page.evaluate(() => (window as any).seq.holding as boolean);
  await page.screenshot({ path: join(OUT, 'tv-updated.png') as `${string}.png` });
  await page.evaluate(() => (window as any).seq.release());
  console.log('tv', { holdingAfter9s: holding }, await tv, `${((Date.now() - t0) / 1000).toFixed(2)} s`, await stats(m0));

  // Interruption : stop() résout la promesse avec completed=false.
  t0 = Date.now();
  const p = page.evaluate(() => (window as any).seq.play('summary', {}));
  await sleep(1500);
  await page.evaluate(() => (window as any).seq.stop());
  console.log('summary interrompu', await p, `${((Date.now() - t0) / 1000).toFixed(2)} s`);

  await browser.close();
  console.log(`captures : ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
