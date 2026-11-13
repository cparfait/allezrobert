/**
 * Contrôle : les largeurs de route des parcours (`roadWidths`) ne dépassent pas celles du graphe publié
 * (`graph.json`, ce qui est dessiné). Sinon le vélo vise une voie hors de la chaussée.
 *
 *   npx tsx src/check-route-widths.ts [zone ...]      (sans argument : toutes les zones)
 *
 * Code de sortie 1 si un parcours dépasse sur plus de 10 % de son tracé. Les parcours dont moins de 70 % des
 * points trouvent une route du graphe (pistes absentes du graphe) sont signalés et ignorés.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoadGraphData } from '@allezrobert/shared';

const WORLDS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public/worlds');
const CELL = 20;
const TOLERANCE_M = 0.4;
const MAX_WIDER_SHARE = 0.1;

type Seg = [number, number, number, number, number];
interface RoutePoint { x: number; z: number }
interface RouteFile { points: RoutePoint[]; stepM: number; roadWidthM: number; roadWidths?: Array<{ startM: number; endM: number; widthM: number }> }

function buildGrid(graph: RoadGraphData): Map<string, Seg[]> {
  const grid = new Map<string, Seg[]>();
  for (const e of graph.edges) {
    const p = e.pts;
    for (let i = 0; i + 5 < p.length; i += 3) {
      const seg: Seg = [p[i]!, p[i + 2]!, p[i + 3]!, p[i + 5]!, e.width];
      for (let cx = Math.floor(Math.min(seg[0], seg[2]) / CELL); cx <= Math.floor(Math.max(seg[0], seg[2]) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(seg[1], seg[3]) / CELL); cz <= Math.floor(Math.max(seg[1], seg[3]) / CELL); cz++) {
          const k = `${cx},${cz}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(seg);
        }
      }
    }
  }
  return grid;
}

/** Largeur du tronçon du graphe le plus proche (< 6 m) et de même direction, sinon null. */
function widthNear(grid: Map<string, Seg[]>, x: number, z: number, hx: number, hz: number): number | null {
  let best: [number, number] | null = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (const [ax, az, bx, bz, w] of grid.get(`${Math.floor(x / CELL) + dx},${Math.floor(z / CELL) + dz}`) ?? []) {
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
        if (l2 < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        const d = Math.hypot(x - ax - t * vx, z - az - t * vz);
        if (d > 6 || Math.abs(vx * hx + vz * hz) / Math.sqrt(l2) < 0.8) continue;
        if (!best || d < best[0]) best = [d, w];
      }
    }
  }
  return best ? best[1] : null;
}

const only = process.argv.slice(2);
let failures = 0;
for (const zone of fs.readdirSync(WORLDS)) {
  if (only.length && !only.includes(zone)) continue;
  const graphFile = path.join(WORLDS, zone, 'graph.json');
  const routesDir = path.join(WORLDS, zone, 'routes');
  if (!fs.existsSync(graphFile) || !fs.existsSync(routesDir)) continue;
  const grid = buildGrid(JSON.parse(fs.readFileSync(graphFile, 'utf8')) as RoadGraphData);
  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(fs.readFileSync(path.join(routesDir, file), 'utf8')) as RouteFile | { route: RouteFile };
    const r = 'route' in raw ? raw.route : raw;
    if (!r.points?.length || !r.roadWidths?.length) continue;
    const widthAt = (d: number) => r.roadWidths!.find((q) => d >= q.startM && d <= q.endM)?.widthM ?? r.roadWidthM;
    let seen = 0, wider = 0, n = 0;
    for (let i = 0; i < r.points.length; i += 5) {
      const a = r.points[Math.max(0, i - 1)]!, b = r.points[Math.min(r.points.length - 1, i + 1)]!;
      const h = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const p = r.points[i]!;
      n++;
      const w = widthNear(grid, p.x, p.z, (b.x - a.x) / h, (b.z - a.z) / h);
      if (w === null) continue;
      seen++;
      if (widthAt((i + 0.5) * r.stepM) > w + TOLERANCE_M) wider++;
    }
    const name = `${zone}/${file}`;
    if (seen < 0.7 * n) console.log(`~ ${name} : ${seen}/${n} points trouvent une route du graphe, ignoré`);
    else if (wider > MAX_WIDER_SHARE * seen) {
      failures++;
      console.log(`✗ ${name} : largeur annoncée > graphe sur ${Math.round((100 * wider) / seen)} % du tracé`);
    }
  }
}
console.log(failures ? `${failures} parcours à recaler` : 'largeurs des parcours conformes au graphe');
process.exit(failures ? 1 : 0);
