/**
 * Vérification d'un monde construit : tailles, cohérence itinéraire ↔ terrain creusé,
 * continuité des bords de tuiles. `npx tsx tools/terrain/src/verify-world.ts [--world <id>]`
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RouteData, WorldMeta } from '@allezrobert/shared';
import { OUT_DIR, TILE_SIZE_M } from './config.ts';
import { decodeGrid, gridSample, type Grid } from './tiles.ts';

const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as WorldMeta;
const tilesDir = path.join(OUT_DIR, 'tiles');

const sizes: Record<string, number> = {};
for (const f of fs.readdirSync(tilesDir)) {
  const ext = f.replace(/^[^.]+/, '');
  sizes[ext] = (sizes[ext] ?? 0) + fs.statSync(path.join(tilesDir, f)).size;
}
console.log(`world.json : ${meta.tiles.length} tuiles, ${meta.routes.length} itinéraires`);
for (const [ext, s] of Object.entries(sizes)) console.log(`  *${ext} : ${(s / 1e6).toFixed(1)} Mo`);

const cache = new Map<string, Grid | null>();
function grid(tx: number, tz: number, lod: 'hi' | 'lo'): Grid | null {
  const k = `${tx}_${tz}.${lod}`;
  if (cache.has(k)) return cache.get(k)!;
  const t = meta.tiles.find((q) => q.tx === tx && q.tz === tz);
  const l = meta.lods.find((q) => q.id === lod)!;
  let g: Grid | null = null;
  if (t && t.lods.includes(lod)) {
    const buf = fs.readFileSync(path.join(tilesDir, `${t.id}${l.suffix}`));
    g = { n: l.n, res: l.resolutionM, x0: tx * TILE_SIZE_M, z0: tz * TILE_SIZE_M, h: decodeGrid(buf, l.n, t.baseM, t.stepM ?? meta.heightEncoding.stepM) };
  }
  cache.set(k, g);
  return g;
}

for (const r of meta.routes) {
  const route = JSON.parse(fs.readFileSync(path.join(OUT_DIR, r.file), 'utf8')) as RouteData;
  let maxErr = 0;
  let sumErr = 0;
  let n = 0;
  let maxStep = 0;
  for (let i = 0; i < route.points.length; i++) {
    const p = route.points[i]!;
    const q = route.points[(i + 1) % route.points.length]!;
    if (route.loop || i + 1 < route.points.length) maxStep = Math.max(maxStep, Math.abs(q.y - p.y));
    const tx = Math.floor(p.x / TILE_SIZE_M);
    const tz = Math.floor(p.z / TILE_SIZE_M);
    const g = grid(tx, tz, 'hi');
    if (!g) continue;
    const e = Math.abs(gridSample(g, p.x, p.z) - p.y);
    maxErr = Math.max(maxErr, e);
    sumErr += e;
    n++;
  }
  console.log(
    `${r.id} : ${(route.lengthM / 1000).toFixed(2)} km, D+ ${route.elevationGainM.toFixed(0)} m, ${route.segments.length} segments ; ` +
      `écart terrain hi/route : moyen ${(sumErr / Math.max(1, n) * 100).toFixed(1)} cm, max ${(maxErr * 100).toFixed(1)} cm sur ${n} points ; Δy max entre points ${(maxStep * 100).toFixed(1)} cm`,
  );
}

// continuité des bords (même LOD) entre tuiles voisines
for (const lod of ['hi', 'lo'] as const) {
  let maxSeam = 0;
  let pairs = 0;
  for (const t of meta.tiles) {
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const a = grid(t.tx, t.tz, lod);
      const b = grid(t.tx + dx, t.tz + dz, lod);
      if (!a || !b) continue;
      pairs++;
      const N = a.n + 1;
      for (let k = 0; k < N; k++) {
        const va = dx ? a.h[k * N + a.n]! : a.h[a.n * N + k]!;
        const vb = dx ? b.h[k * N]! : b.h[k]!;
        maxSeam = Math.max(maxSeam, Math.abs(va - vb));
      }
    }
  }
  console.log(`raccord des bords ${lod}/${lod} : écart max ${(maxSeam * 100).toFixed(1)} cm sur ${pairs} bords`);
}
