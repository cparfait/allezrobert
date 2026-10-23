/**
 * Banc d'essai du son dans Chromium sans écran : rend chaque situation (src/audio/bench.ts),
 * vérifie l'absence de NaN, la crête (< −0,5 dBFS), des niveaux RMS raisonnables et l'ordre
 * des revêtements et des efforts ; enregistre les WAV dans out/audio/ pour écoute.
 *
 * Prérequis : serveur de développement lancé (AR_HMR=0 pnpm exec vite --port 5202 --strictPort
 * dans apps/client). Usage : node apps/client/scripts/audio-bench.mjs [--port=5202] [--no-save]
 * Playwright : module du système (/opt/node-tools) ou variable PLAYWRIGHT_MODULE.
 */
const args = process.argv.slice(2);
const port = args.find((a) => a.startsWith('--port='))?.slice(7) ?? '5202';
const save = !args.includes('--no-save');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright/index.mjs');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${port}/audio-bench.html?${save ? 'save=1' : ''}${only ? `&only=${only}` : ''}`);
await page.waitForFunction(() => window.__bench?.done, null, { timeout: 300000 });
const bench = await page.evaluate(() => window.__bench);
await browser.close();
if (bench.error) {
  console.error('Échec du banc :', bench.error);
  process.exit(1);
}

const fails = [];
const by = Object.fromEntries(bench.results.map((r) => [r.name, r]));
console.log('Situation                     RMS (dBFS)  crête (dBFS)  NaN  rendu');
for (const r of bench.results) {
  console.log(`${r.name.padEnd(28)} ${r.rmsDb.toFixed(1).padStart(8)} ${r.peakDb.toFixed(1).padStart(12)} ${String(r.nan).padStart(5)}  ${r.renderMs} ms`);
  if (r.nan) fails.push(`${r.name} : ${r.nan} échantillons NaN`);
  if (r.peakDb >= -0.5) fails.push(`${r.name} : crête ${r.peakDb.toFixed(2)} dBFS (saturation)`);
  const solo = r.name.startsWith('solo-') || r.name === 'pause';
  if (!solo && (r.rmsDb < -50 || r.rmsDb > -12)) fails.push(`${r.name} : RMS ${r.rmsDb.toFixed(1)} dBFS hors de [−50, −12]`);
}
const lt = (a, b, why) => by[a] && by[b] && !(by[a].rmsDb < by[b].rmsDb) && fails.push(`${why} : ${a} ${by[a].rmsDb.toFixed(1)} ≥ ${b} ${by[b].rmsDb.toFixed(1)}`);
lt('solo-roulement-smooth', 'solo-roulement-rough', 'revêtement');
lt('solo-roulement-rough', 'solo-roulement-cobbles', 'revêtement');
lt('solo-roulement-rough', 'solo-roulement-gravel', 'revêtement');
lt('solo-roulement-dirt', 'solo-roulement-gravel', 'revêtement');
lt('solo-souffle-150w', 'solo-souffle-220w', 'souffle');
lt('solo-souffle-220w', 'solo-souffle-260w', 'souffle');
lt('solo-souffle-260w', 'solo-souffle-320w', 'souffle');
lt('pause', 'paves', 'pause');
if (by['solo-souffle-150w'] && by['solo-souffle-150w'].rmsDb > -70) fails.push('souffle audible à 60 % de la FTP');
for (const e of errors) fails.push(`erreur de page : ${e}`);
if (save) console.log(`\nWAV : out/audio/ (${bench.results.length} fichiers)`);
if (fails.length) {
  console.error('\nÉCHECS :\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('\nBanc du son : tout est conforme.');
