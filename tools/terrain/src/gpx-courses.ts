/**
 * Parcours Garmin Connect publics (GPX `COURSE_*.gpx` de data/garmin) → tours de zones ouvertes.
 *
 *   pnpm --filter @allezrobert/terrain exec tsx src/gpx-courses.ts
 *
 * Chaque parcours est affecté à la zone qui contient la plus grande part de ses points
 * (emprise de `world.json`). Seule la partie dans l'emprise est gardée, puis réduite à quelques
 * points de passage : la route elle-même est reconstruite sur OSM par build:world, jamais copiée
 * depuis la trace. Écrit un rapport (data/cache/gpx-courses.json) et affiche des blocs `tours`
 * à coller dans config.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GARMIN_DIR, CACHE_DIR, REPO_ROOT } from './config.ts';
import { parseGpx } from './gpx.ts';

// Lambert-93 (IGNF, RGF93) : projection conique conforme, 2 parallèles 44° et 49°.
const A = 6378137;
const E = 0.0818191910428158;
const N_ = 0.725607765053;
const C_ = 11754255.426;
const XS = 700000;
const YS = 12655612.0499;
const L0 = (3 * Math.PI) / 180;
function toL93(lon: number, lat: number): { e: number; n: number } {
  const p = (lat * Math.PI) / 180;
  const es = E * Math.sin(p);
  const L = Math.log(Math.tan(Math.PI / 4 + p / 2) * Math.pow((1 - es) / (1 + es), E / 2));
  const R = C_ * Math.exp(-N_ * L);
  const g = N_ * ((lon * Math.PI) / 180 - L0);
  return { e: XS + R * Math.sin(g), n: YS - R * Math.cos(g) };
}
void A;

interface Zone {
  id: string;
  name: string;
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

const worldsDir = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');
const zones: Zone[] = [];
for (const id of fs.readdirSync(worldsDir)) {
  const f = path.join(worldsDir, id, 'world.json');
  if (!fs.existsSync(f)) continue;
  const w = JSON.parse(fs.readFileSync(f, 'utf8')) as { name: string; originL93: { x: number; y: number }; bounds: { minX: number; minZ: number; maxX: number; maxZ: number } };
  const { originL93: o, bounds: b } = w;
  zones.push({ id, name: w.name, minE: o.x + b.minX, maxE: o.x + b.maxX, minN: o.y - b.maxZ, maxN: o.y - b.minZ });
}

const inside = (z: Zone, e: number, n: number) => e >= z.minE && e <= z.maxE && n >= z.minN && n <= z.maxN;

const KEEP_M = 2500; // espacement approximatif des points de passage
const files = fs.readdirSync(GARMIN_DIR).filter((f) => /^COURSE_\d+\.gpx$/i.test(f)).sort();
const report: unknown[] = [];

for (const f of files) {
  const ride = parseGpx(fs.readFileSync(path.join(GARMIN_DIR, f), 'utf8'), f);
  const pts = ride.points.map((p) => ({ lon: p.lon, lat: p.lat, ...toL93(p.lon, p.lat) }));
  let best: { z: Zone; n: number } | null = null;
  for (const z of zones) {
    const n = pts.filter((p) => inside(z, p.e, p.n)).length;
    if (!best || n > best.n) best = { z, n };
  }
  const share = best ? best.n / pts.length : 0;
  const row: Record<string, unknown> = { file: f, name: ride.name, points: pts.length, zone: best?.z.id ?? null, shareInZone: Math.round(share * 100) };
  if (!best || share < 0.5) {
    row.status = 'rejeté : moins de la moitié du parcours dans une zone';
    report.push(row);
    continue;
  }
  const z = best.z;
  // plus longue suite continue de points dans l'emprise
  let runs: typeof pts[] = [];
  let cur: typeof pts = [];
  for (const p of pts) {
    if (inside(z, p.e, p.n)) cur.push(p);
    else if (cur.length) (runs.push(cur), (cur = []));
  }
  if (cur.length) runs.push(cur);
  const run = runs.sort((a, b) => b.length - a.length)[0]!;
  // points de passage espacés d'au moins KEEP_M le long de la trace
  const via: Array<{ lon: number; lat: number }> = [];
  let acc = 0;
  let lastKeep = run[0]!;
  let length = 0;
  for (let i = 1; i < run.length; i++) {
    const d = Math.hypot(run[i]!.e - run[i - 1]!.e, run[i]!.n - run[i - 1]!.n);
    acc += d;
    length += d;
    if (acc >= KEEP_M) {
      via.push({ lon: +run[i]!.lon.toFixed(5), lat: +run[i]!.lat.toFixed(5) });
      acc = 0;
      lastKeep = run[i]!;
    }
  }
  void lastKeep;
  const start = { lon: +run[0]!.lon.toFixed(5), lat: +run[0]!.lat.toFixed(5) };
  const end = { lon: +run[run.length - 1]!.lon.toFixed(5), lat: +run[run.length - 1]!.lat.toFixed(5) };
  const closed = Math.hypot(run[0]!.e - run[run.length - 1]!.e, run[0]!.n - run[run.length - 1]!.n) < 300;
  Object.assign(row, { status: 'ok', keptKm: Math.round(length / 100) / 10, closed, start, end, via });
  report.push(row);
}

fs.mkdirSync(CACHE_DIR, { recursive: true });
const out = path.join(CACHE_DIR, '..', 'gpx-courses.json');
fs.writeFileSync(out, JSON.stringify(report, null, 1));

for (const r of report as Array<Record<string, any>>) {
  console.log(`${r.zone ?? '—'}\t${r.shareInZone}%\t${r.status === 'ok' ? `${r.keptKm} km${r.closed ? ' boucle' : ''}, ${r.via.length} via` : r.status}\t${r.name}`);
}
console.log(`\nRapport : ${path.relative(REPO_ROOT, out)}`);
