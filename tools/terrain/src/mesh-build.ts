/**
 * Construction enchaînée des zones du maillage d'Île-de-France (docs/MAILLAGE_ILE_DE_FRANCE.md), une
 * à la fois, en vidant le cache lourd entre deux zones pour que le disque suffise.
 *
 *   npx tsx src/mesh-build.ts [--only <id>[,<id>…]] [--limit <n>] [--keep-cache] [--min-free-gb 30]
 *
 * 1. Attend qu'aucune autre construction (`build-world`) ni calcul de tours (`mesh-tours`, `zone-plan`)
 *    ne tourne : le cache est partagé, rien n'est lancé en parallèle.
 * 2. Inscrit les zones au menu (`mesh-register.ts`), retire `enrich` des zones (bâti : qualité standard).
 * 3. Photographie le cache lourd (LiDAR, MNT, BD TOPO, orthophotos) la première fois seulement
 *    (`data/cache/mesh/cache-snapshot.json`, reprenable) : après chaque zone, seuls les fichiers
 *    ABSENTS de cette photo sont supprimés. Le cache des autres zones n'est jamais touché ; OSM est gardé.
 * 4. Construit les zones dans l'ordre du plan (du centre vers la périphérie), saute celles déjà
 *    construites (`world.json` présent), continue après un échec, s'arrête sous `--min-free-gb`.
 * 5. Recopie le `.gitignore` des tuiles, puis `packs` (catalogue) à la fin.
 *
 * Journaux : `data/cache/mesh/build-<id>.log` et `data/cache/mesh/build-report.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TERRAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(TERRAIN, '../..');
const CACHE = path.join(ROOT, 'data', 'cache', 'terrain');
const WORK = path.join(ROOT, 'data', 'cache', 'mesh');
const WORLDS = path.join(ROOT, 'apps', 'client', 'public', 'worlds');
const SNAP = path.join(WORK, 'cache-snapshot.json');
const REPORT = path.join(WORK, 'build-report.json');

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const only = arg('--only')?.split(',');
const limit = Number(arg('--limit') ?? Infinity);
const keepCache = argv.includes('--keep-cache');
const minFreeGb = Number(arg('--min-free-gb') ?? 30);
const DLL_INIT_FAILED = 3221225794;

const log = (s: string) => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Processus de construction ou de calcul qui partagent le cache (hors ce script). */
function busy(): string[] {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'build-world|mesh-tours|zone-plan' } | % { $_.CommandLine }";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.slice(-110));
}

/** Dossiers du cache lourd : régénérables, volumineux. OSM (`osm`, `osm-api`) est gardé. */
function heavyDirs(): string[] {
  return fs.readdirSync(CACHE, { withFileTypes: true }).filter((d) => d.isDirectory() && /^(lidar-mns|lidar-mnh|dem|bdtopo-batiment|bdtopo-route|ortho-.*)$/.test(d.name)).map((d) => d.name);
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out);
    else out.push(r);
  }
}

function listCache(): string[] {
  const out: string[] = [];
  for (const d of heavyDirs()) walk(CACHE, d, out);
  return out;
}

function freeGb(): number {
  const s = fs.statfsSync(ROOT);
  return (s.bavail * s.bsize) / 1024 ** 3;
}

function run(cmd: string, logFile: string): Promise<number> {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'a');
    const p = spawn(cmd, { shell: true, cwd: ROOT, stdio: ['ignore', out, out], env: { ...process.env, FORCE_COLOR: '0' } });
    p.on('close', (code) => { fs.closeSync(out); resolve(code ?? 1); });
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(WORK, { recursive: true });
  for (let first = true; ; first = false) {
    const b = busy();
    if (!b.length) break;
    if (first) log(`attente : ${b.length} processus en cours (construction ou tours)\n  ${b.join('\n  ')}`);
    await sleep(60_000);
  }
  log('plus rien ne tourne');

  execFileSync('npx', ['tsx', 'src/mesh-register.ts'], { cwd: TERRAIN, stdio: 'inherit', shell: true });
  const plan = JSON.parse(fs.readFileSync(path.join(TERRAIN, 'mesh', 'ile-de-france.json'), 'utf8')) as { zones: Array<{ id: string; rect: { minE: number; minN: number; maxE: number; maxN: number } }> };
  const zonesDir = path.join(TERRAIN, 'zones');
  // du centre (Paris) vers la périphérie
  const cx = 652000, cy = 6862000;
  const order = plan.zones.map((z) => ({ id: z.id, d: Math.hypot((z.rect.minE + z.rect.maxE) / 2 - cx, (z.rect.minN + z.rect.maxN) / 2 - cy) })).sort((a, b) => a.d - b.d).map((z) => z.id);

  if (!keepCache && !fs.existsSync(SNAP)) {
    const files = listCache();
    fs.writeFileSync(SNAP, JSON.stringify(files));
    log(`photo du cache : ${files.length} fichiers conservés quoi qu'il arrive`);
  }
  const keep = new Set<string>(!keepCache ? (JSON.parse(fs.readFileSync(SNAP, 'utf8')) as string[]) : []);
  const report: Record<string, unknown> = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {};

  function purge(): number {
    if (keepCache) return 0;
    let n = 0;
    for (const f of listCache()) if (!keep.has(f)) { fs.rmSync(path.join(CACHE, f), { force: true }); n++; }
    return n;
  }
  // restes d'une zone interrompue
  log(`nettoyage initial : ${purge()} fichier(s) hors photo, ${freeGb().toFixed(0)} Go libres`);

  let done = 0;
  let failures = 0;
  for (const id of order) {
    if (only && !only.includes(id)) continue;
    if (done >= limit) break;
    const zf = path.join(zonesDir, `${id}.json`);
    if (!fs.existsSync(zf)) { log(`${id} : pas de tours, ignorée`); continue; }
    if (fs.existsSync(path.join(WORLDS, id, 'world.json'))) { log(`${id} : déjà construite`); continue; }
    if (failures >= 3) break;
    if (freeGb() < minFreeGb) { log(`arrêt : ${freeGb().toFixed(0)} Go libres (< ${minFreeGb})`); break; }
    const z = JSON.parse(fs.readFileSync(zf, 'utf8')) as Record<string, unknown>;
    if ('enrich' in z) { delete z.enrich; fs.writeFileSync(zf, JSON.stringify(z, null, 2) + '\n'); }

    done++;
    const t0 = Date.now();
    const logFile = path.join(WORK, `build-${id}.log`);
    fs.rmSync(logFile, { force: true });
    log(`${id} : construction (${done})`);
    // L'IGN renvoie parfois 502 puis 400 pendant plusieurs minutes : le cache garde les blocs déjà reçus, une
    // nouvelle tentative reprend là où la précédente s'est arrêtée (jusqu'à 3 essais, 3 minutes d'écart).
    let code = 1;
    for (let essai = 1; essai <= 3 && code !== 0; essai++) {
      if (essai > 1) { log(`${id} : nouvel essai ${essai}/3 dans 3 min`); await sleep(180_000); }
      code = await run(`pnpm --filter @allezrobert/terrain build:world -- --world ${id}`, logFile);
      // 0xC0000142 : Windows n'arrive plus à lancer de processus (session fermée, veille) — rien à voir avec la zone
      if (code === DLL_INIT_FAILED && Date.now() - t0 < 60_000) {
        log(`arrêt : Windows ne lance plus de processus (code ${code}) — relancer mesh-build quand la session est de nouveau ouverte`);
        process.exit(2);
      }
    }
    const removed = purge();
    const gitignore = path.join(WORLDS, 'meudon', '.gitignore');
    if (code === 0 && fs.existsSync(gitignore)) fs.copyFileSync(gitignore, path.join(WORLDS, id, '.gitignore'));
    const minutes = Math.round((Date.now() - t0) / 60000);
    report[id] = { code, minutes, cachePurged: removed, freeGb: Math.round(freeGb()) };
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
    failures = code === 0 ? 0 : failures + 1;
    log(`${id} : ${code === 0 ? 'OK' : `ÉCHEC (code ${code}, voir ${path.basename(logFile)})`} en ${minutes} min, ${removed} fichiers de cache supprimés, ${freeGb().toFixed(0)} Go libres`);
  }
  if (failures >= 3) log('arrêt : 3 zones de suite en échec (voir les journaux)');
  log('catalogue (packs)');
  await run('pnpm --filter @allezrobert/terrain packs', path.join(WORK, 'build-packs.log'));
  log(`terminé : ${done} zone(s) traitée(s)`);
}

await main();
