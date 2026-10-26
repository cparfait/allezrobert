/**
 * Tours automatiques des zones du maillage d'Île-de-France (docs/MAILLAGE_ILE_DE_FRANCE.md) :
 * une boucle d'environ 20, 30, 40 et 50 km par zone, calculée par `zone-plan.ts` (mêmes données OSM que
 * la construction). Reprenable : une zone qui a déjà ses tours n'est pas recalculée.
 *
 *   npx tsx src/mesh-tours.ts [--only <id>[,<id>…]] [--limit <n>] [--lengths 20,30,40,50]
 *
 * Entrée : `mesh/zones/<id>.json` (sans tours, écrit par `mesh-idf.ts`). Sortie : la zone avec ses tours
 * dans `zones/<id>.json` (prise en compte par `build:world`), le fichier d'attente est retiré, et
 * `mesh/tours-report.json` garde le détail (longueur réelle, D+, doublons, échecs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TERRAIN = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(TERRAIN, '../..');
const PENDING = path.join(TERRAIN, 'mesh', 'zones');
const DONE = path.join(TERRAIN, 'zones');
const REPORT = path.join(TERRAIN, 'mesh', 'tours-report.json');
const WORK = path.join(REPO_ROOT, 'data', 'cache', 'mesh');
/** Écart toléré entre la longueur visée et la boucle retenue. */
const TOLERANCE = 0.15;

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const only = arg('--only')?.split(',');
const limit = Number(arg('--limit') ?? Infinity);
const lengths = (arg('--lengths') ?? '20,30,40,50').split(',').map(Number);

interface Loop { lengthM: number; gainM: number | null; overlapPct: number; roads: string[]; via: Array<{ lon: number; lat: number }> }
interface PlanResult { degraded: boolean; start: { lon: number; lat: number; name: string }; loops: Loop[] }

function plan(worldFile: string, reqFile: string): Promise<PlanResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(`npx tsx src/zone-plan.ts ${JSON.stringify(reqFile)}`, { shell: true, cwd: TERRAIN, env: { ...process.env, TERRAIN_WORLD_JSON: worldFile, FORCE_COLOR: '0' } });
    let result: PlanResult | undefined;
    let error = '';
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('@@result ')) result = JSON.parse(line.slice(9));
        else if (line.startsWith('@@error ')) error = line.slice(8);
        else if (line.startsWith('@@progress ')) process.stdout.write(`    ${line.slice(11)}\n`);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('close', (code) => (result ? resolve(result) : reject(new Error(error || `zone-plan interrompu (code ${code})`))));
  });
}

const report: Record<string, unknown> = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {};
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(DONE, { recursive: true });

const files = fs.existsSync(PENDING) ? fs.readdirSync(PENDING).filter((f) => f.endsWith('.json')).sort() : [];
let n = 0;
for (const f of files) {
  const id = f.replace(/\.json$/, '');
  if (only && !only.includes(id)) continue;
  if (n >= limit) break;
  n++;
  const zone = JSON.parse(fs.readFileSync(path.join(PENDING, f), 'utf8')) as Record<string, unknown> & { start: { lon: number; lat: number }; tours: unknown[] };
  const worldFile = path.join(WORK, `plan-${id}.json`);
  fs.writeFileSync(worldFile, JSON.stringify({ ...zone, id: '__plan__', tours: [] }));
  console.log(`\n=== ${id} ===`);
  const tours: unknown[] = [];
  const detail: unknown[] = [];
  let start = zone.start;
  let startName = '';
  for (const km of lengths) {
    const reqFile = path.join(WORK, `plan-${id}-${km}.json`);
    fs.writeFileSync(reqFile, JSON.stringify({ targetKm: km, variants: 3, seed: km, start }));
    try {
      const r = await plan(worldFile, reqFile);
      // des trois variantes, la plus proche de la longueur visée
      const l = [...r.loops].sort((a, b) => Math.abs(a.lengthM - km * 1000) - Math.abs(b.lengthM - km * 1000))[0]!;
      const real = l.lengthM / 1000;
      // même départ pour tous les tours de la zone : celui du premier calculé (déjà recalé sur une route)
      if (!tours.length) { start = { lon: r.start.lon, lat: r.start.lat }; startName = String(zone.name).replace(/^.*— /, ''); }
      const ok = Math.abs(real - km) / km <= TOLERANCE;
      console.log(`  ${km} km → ${real.toFixed(1)} km, D+ ${l.gainM ?? '?'} m, ${l.overlapPct} % en doublon${ok ? '' : '  (hors tolérance)'}`);
      detail.push({ km, lengthKm: Math.round(real * 10) / 10, gainM: l.gainM, overlapPct: l.overlapPct, ok, degraded: r.degraded });
      if (!ok && real < km * 0.5) continue;
      // hors tolérance (zone trop petite, forêt…) : nommé d'après sa vraie longueur, jamais en double
      const label = ok ? km : Math.round(real);
      if (tours.some((t) => (t as { routeId: string }).routeId === `boucle-${label}-km`)) continue;
      const [first, ...via] = l.via;
      const place = startName || 'le départ';
      tours.push({
        routeId: `boucle-${label}-km`,
        routeName: `Boucle de ${label} km depuis ${place}`,
        routeNameEn: `${label} km loop from ${place}`,
        start: first,
        via,
      });
    } catch (e) {
      console.log(`  ${km} km → échec : ${e instanceof Error ? e.message : e}`);
      detail.push({ km, error: e instanceof Error ? e.message : String(e) });
    }
  }
  report[id] = { start: startName, tours: detail };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  if (tours.length) {
    const first = (tours[0] as { start: { lon: number; lat: number } }).start;
    fs.writeFileSync(path.join(DONE, f), JSON.stringify({ ...zone, start: first, tours }, null, 2) + '\n');
    fs.rmSync(path.join(PENDING, f));
    console.log(`  → zones/${f} (${tours.length} tour${tours.length > 1 ? 's' : ''})`);
  }
}
console.log(`\n${n} zone(s) traitée(s)`);
