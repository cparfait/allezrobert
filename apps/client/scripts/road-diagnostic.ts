/**
 * Diagnostic de la géométrie routière d'un monde (sans rendu), avant / après les corrections
 * de src/world/ribbon.ts :
 *  (a) ruban de l'itinéraire : bords qui se replient (triangles retournés) dans les virages plus
 *      serrés que le décalage (demi-tours, angles de carrefour, épingles) ;
 *  (b) réseau OSM et autres itinéraires : rubans qui recouvrent la chaussée de l'itinéraire actif
 *      (doublons décalés, carrefours qui débordent) et lignes de rive tracées en travers ;
 *  (c) terrain : sommets du maillage (LOD 0) qui dépassent au-dessus du ruban.
 *
 * Usage : npx tsx apps/client/scripts/road-diagnostic.ts [monde=chevreuse] [--route=<id>] [--seg=224]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteData, RoutePoint, WorldMeta, WorldTile } from '@allezrobert/shared';
import { RouteFootprint, ribbonEdges, ribbonIndex, roundCorners, sideRoadStrips, type AxisPoint3, type SideStrip } from '../src/world/ribbon.ts';

const args = process.argv.slice(2);
const worldId = args.find((a) => !a.startsWith('--')) ?? 'chevreuse';
const only = args.find((a) => a.startsWith('--route='))?.slice(8);
const SEG = Number(args.find((a) => a.startsWith('--seg='))?.slice(6) ?? 224);
const dir = join(import.meta.dirname, '..', 'public', 'worlds', worldId);
const meta = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldMeta;
const SHOULDER = 1.2; // = road.ts
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']); // = network.ts
const MARKED = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link']);

const routes: RouteData[] = readdirSync(join(dir, 'routes'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, 'routes', f), 'utf8')) as RouteData)
  .filter((r) => !only || r.id === only);

const tiles = new Map<string, WorldTile | null>();
function tileOf(id: string): WorldTile | null {
  if (!tiles.has(id)) {
    try {
      tiles.set(id, JSON.parse(readFileSync(join(dir, 'tiles', `${id}.json`), 'utf8')) as WorldTile);
    } catch {
      tiles.set(id, null);
    }
  }
  return tiles.get(id) ?? null;
}

function groupRuns(ds: number[], gap = 20): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const d of [...ds].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && d - last[1] <= gap) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}
const fmtRuns = (ds: number[], max = 20) => {
  const r = groupRuns(ds);
  return r
    .slice(0, max)
    .map((x) => (x[0] === x[1] ? `${x[0].toFixed(0)}` : `${x[0].toFixed(0)}–${x[1].toFixed(0)}`))
    .join(', ') + (r.length > max ? `, … (${r.length} zones)` : '');
};

/** Ancien ruban (décalage brut le long de la normale, diagonale fixe). */
function oldRibbon(pts: RoutePoint[], offsets: number[], loop: boolean): Float64Array[] {
  const n = pts.length;
  return offsets.map((off) => {
    const e = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const prev = pts[loop ? (i - 1 + n) % n : Math.max(i - 1, 0)]!;
      const next = pts[loop ? (i + 1) % n : Math.min(i + 1, n - 1)]!;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      e[i * 2] = p.x - (dz / l) * off;
      e[i * 2 + 1] = p.z + (dx / l) * off;
    }
    return e;
  });
}

/** Triangles retournés (aire signée xz > 0) d'un ruban ; d du premier profil de chacun. */
function flipped(route: RouteData, pts: readonly AxisPoint3[], cols: Float64Array[], fixedDiag: boolean): number[] {
  const n = pts.length;
  const rows = route.loop ? n + 1 : n;
  const C = cols.length;
  const pos: number[] = [];
  for (let k = 0; k < rows; k++) for (const e of cols) pos.push(e[(k % n) * 2]!, 0, e[(k % n) * 2 + 1]!);
  let index: number[];
  if (fixedDiag) {
    index = [];
    for (let k = 0; k < rows - 1; k++)
      for (let c = 0; c < C - 1; c++) {
        const a = k * C + c;
        index.push(a, a + 1, a + C, a + 1, a + C + 1, a + C);
      }
  } else index = ribbonIndex(pos, 3, C, rows);
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t]!, index[t + 1]!, index[t + 2]!];
    const ar = (pos[j * 3]! - pos[i * 3]!) * (pos[k * 3 + 2]! - pos[i * 3 + 2]!) - (pos[j * 3 + 2]! - pos[i * 3 + 2]!) * (pos[k * 3]! - pos[i * 3]!);
    if (ar > 1e-6) out.push(pts[Math.floor(i / C) % n]!.d);
  }
  return out;
}

/** Tuiles traversées par l'itinéraire (et voisines immédiates du tracé). */
function routeTiles(r: RouteData): string[] {
  const T = meta.tileSizeM;
  const ids = new Set<string>();
  for (const p of r.points)
    for (const [dx, dz] of [
      [0, 0],
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ] as const)
      ids.add(`${Math.floor((p.x + dx) / T)}_${Math.floor((p.z + dz) / T)}`);
  return [...ids];
}

/** Triangles retournés (aire signée xz > 0) des rubans du réseau. */
function stripFlips(strips: SideStrip[], drop: boolean): number {
  let k = 0;
  for (const s of strips) {
    const n = s.along.length;
    const pos: number[] = [];
    for (let i = 0; i < n; i++) pos.push(s.left[i * 3]!, 0, s.left[i * 3 + 2]!, s.right[i * 3]!, 0, s.right[i * 3 + 2]!);
    const idx = ribbonIndex(pos, 3, 2, n, drop);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      if ((pos[b * 3]! - pos[a * 3]!) * (pos[c * 3 + 2]! - pos[a * 3 + 2]!) - (pos[b * 3 + 2]! - pos[a * 3 + 2]!) * (pos[c * 3]! - pos[a * 3]!) > 1e-6) k++;
    }
  }
  return k;
}

interface Intrusion {
  d: number;
  area: number;
  paint: number;
  who: string;
}

/** Recouvrement de la chaussée de l'itinéraire par des rubans du réseau (même niveau). */
function intrusions(strips: SideStrip[], fp: RouteFootprint, rh: number, marked: boolean, who: string): Intrusion | null {
  let area = 0;
  let paint = 0;
  let d = 0;
  const inside = (x: number, z: number, y: number, margin: number) => {
    const h = fp.nearest(x, z, fp.half);
    return h && h.dist < fp.half - margin && Math.abs(y - 0.05 - h.y) < 2.5 ? h : null;
  };
  for (const s of strips) {
    const n = s.along.length;
    const o = rh + 0.6;
    for (let i = 0; i < n - 1; i++) {
      const L = s.left;
      const R = s.right;
      // quadrilatère i → i+1 : centre et aire
      const cx = (L[i * 3]! + R[i * 3]! + L[i * 3 + 3]! + R[i * 3 + 3]!) / 4;
      const cz = (L[i * 3 + 2]! + R[i * 3 + 2]! + L[i * 3 + 5]! + R[i * 3 + 5]!) / 4;
      const cy = (L[i * 3 + 1]! + R[i * 3 + 1]!) / 2;
      const ar = Math.abs((R[i * 3]! - L[i * 3 + 3]!) * (L[i * 3 + 2]! - R[i * 3 + 5]!) - (R[i * 3 + 2]! - L[i * 3 + 5]!) * (L[i * 3]! - R[i * 3 + 3]!)) / 2;
      // échantillons dans le quadrilatère (5 × 3) pour la part dans la chaussée
      let inN = 0;
      for (let a = 0; a < 5; a++)
        for (let b = 0; b < 3; b++) {
          const u = (a + 0.5) / 5;
          const v = (b + 0.5) / 3;
          const x = (L[i * 3]! * (1 - u) + R[i * 3]! * u) * (1 - v) + (L[i * 3 + 3]! * (1 - u) + R[i * 3 + 3]! * u) * v;
          const z = (L[i * 3 + 2]! * (1 - u) + R[i * 3 + 2]! * u) * (1 - v) + (L[i * 3 + 5]! * (1 - u) + R[i * 3 + 5]! * u) * v;
          if (inside(x, z, cy, 0.05)) inN++;
        }
      if (inN) {
        area += (ar * inN) / 15;
        d = fp.nearest(cx, cz, 50)?.d ?? d;
      }
      if (marked) {
        // lignes de rive du tronçon (à rh − 0,25 m de son axe) tracées dans la chaussée, hors de sa propre rive
        for (const t of [(o - (rh - 0.25)) / (2 * o), (o + (rh - 0.25)) / (2 * o)]) {
          const x = L[i * 3]! + (R[i * 3]! - L[i * 3]!) * t;
          const z = L[i * 3 + 2]! + (R[i * 3 + 2]! - L[i * 3 + 2]!) * t;
          if (inside(x, z, cy, 0.4)) paint += Math.hypot(L[i * 3 + 3]! - L[i * 3]!, L[i * 3 + 5]! - L[i * 3 + 2]!);
        }
      }
    }
  }
  return area > 0.05 || paint > 0 ? { d, area, paint, who } : null;
}

for (const r of routes) {
  const pts = r.points;
  const half = r.roadWidthM / 2;
  const offsets = [-(half + SHOULDER), -half, half, half + SHOULDER];
  console.log(`\n══ ${r.id} (${(r.lengthM / 1000).toFixed(1)} km, chaussée ${r.roadWidthM} m, pas ${r.stepM?.toFixed(1) ?? '?'} m)`);

  // (a)
  let minR = Infinity;
  let minRd = 0;
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const R = cross < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(a.x - c.x, a.z - c.z)) / (2 * cross);
    if (R < minR) {
      minR = R;
      minRd = b.d;
    }
  }
  const before = flipped(r, pts, oldRibbon(pts, offsets, r.loop), true);
  const rc = roundCorners(pts, r.loop); // comme RoadMesh
  const after = flipped(r, rc.pts, ribbonEdges(rc.pts, offsets, r.loop, rc.normals), false);
  console.log(`(a) ruban : rayon d'axe minimal ${minR.toFixed(1)} m @ d=${minRd.toFixed(0)} ; triangles retournés avant ${before.length}${before.length ? ` @ d=${fmtRuns(before)}` : ''} ; après ${after.length}${after.length ? ` @ d=${fmtRuns(after)}` : ''}`);

  // (b)
  const fp = new RouteFootprint(pts, r.loop, half, SHOULDER);
  const tot = { before: { area: 0, paint: 0 }, after: { area: 0, paint: 0 } };
  const worst: Intrusion[] = [];
  const worstAfter: Intrusion[] = [];
  const seen = new Set<string>();
  let flipsB = 0;
  let flipsA = 0;
  for (const id of routeTiles(r)) {
    const t = tileOf(id);
    if (!t) continue;
    for (const road of t.roads) {
      if (road.route === r.id || road.tunnel || SKIP.has(road.kind)) continue;
      const k = `${road.id}:${road.pts[0]}:${road.pts[2]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const rh = Math.max(road.width, 2.5) / 2;
      const marked = MARKED.has(road.kind) && road.width >= 5;
      const who = road.route ? `itinéraire ${road.route}` : `${road.kind} ${road.width} m${road.name ? ` (${road.name})` : ''}`;
      const sb = sideRoadStrips(road.pts, rh + 0.6, rh, null, 0.05);
      const sa = sideRoadStrips(road.pts, rh + 0.6, rh, fp, 0.05);
      flipsB += stripFlips(sb, false);
      flipsA += stripFlips(sa, true);
      const b = intrusions(sb, fp, rh, marked, who);
      if (!b) continue;
      tot.before.area += b.area;
      tot.before.paint += b.paint;
      worst.push(b);
      const a = intrusions(sa, fp, rh, marked, who);
      if (a) {
        tot.after.area += a.area;
        tot.after.paint += a.paint;
        worstAfter.push(a);
      }
    }
  }
  console.log(
    `(b) réseau sur la chaussée : avant ${tot.before.area.toFixed(0)} m² dont ${worst.length} tronçons, ${tot.before.paint.toFixed(0)} m de ligne de rive en travers ; ` +
      `après ${tot.after.area.toFixed(1)} m², ${tot.after.paint.toFixed(1)} m de ligne ; triangles retournés (taches noires) ${flipsB} → ${flipsA}`,
  );
  for (const w of worst.sort((x, y) => y.area + 3 * y.paint - (x.area + 3 * x.paint)).slice(0, 8))
    console.log(`     d=${w.d.toFixed(0)} : ${w.area.toFixed(0)} m² sur la chaussée${w.paint ? `, ${w.paint.toFixed(0)} m de ligne de rive` : ''} — ${w.who}`);
  for (const w of worstAfter.sort((x, y) => y.area - x.area).slice(0, 3)) console.log(`     reste d=${w.d.toFixed(0)} : ${w.area.toFixed(1)} m²${w.paint ? `, ${w.paint.toFixed(1)} m de ligne` : ''} — ${w.who}`);

  // (c)
  let badB = 0;
  let badA = 0;
  let worstB = { dh: 0, d: 0, across: 0 };
  let worstA = { dh: 0, d: 0, across: 0 };
  const zonesB: number[] = [];
  for (const id of routeTiles(r)) {
    const t = tileOf(id);
    if (!t) continue;
    const grid = t.heights.hi ?? t.heights.lo;
    const raw = new Uint16Array(readFileSync(join(dir, 'tiles', grid.file)).buffer.slice(0));
    const gn = grid.n;
    const w = gn + 1;
    const T = meta.tileSizeM;
    const hAt = (u: number, v: number) => {
      const fx = u * gn;
      const fz = v * gn;
      const i = Math.min(Math.floor(fx), gn - 1);
      const j = Math.min(Math.floor(fz), gn - 1);
      const a = fx - i;
      const b = fz - j;
      const q = (ii: number, jj: number) => t.heights.baseM + raw[jj * w + ii]! * t.heights.stepM;
      return q(i, j) * (1 - a) * (1 - b) + q(i + 1, j) * a * (1 - b) + q(i, j + 1) * (1 - a) * b + q(i + 1, j + 1) * a * b;
    };
    const seg = Math.max(16, Math.min(SEG, gn * 2));
    const axisGround = (x: number, z: number) => {
      const u = (x - t.bounds.minX) / T;
      const v = (z - t.bounds.minZ) / T;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? hAt(u, v) : Number.NaN;
    };
    const reach = (T / seg) * Math.SQRT2 + 0.1;
    const x0 = t.bounds.minX;
    const z0 = t.bounds.minZ;
    // grille du maillage + son altitude ; on teste aussi le centre des triangles (interpolation)
    const H = new Float64Array((seg + 1) * (seg + 1));
    const HA = new Float64Array((seg + 1) * (seg + 1));
    for (let j = 0; j <= seg; j++)
      for (let i = 0; i <= seg; i++) {
        const h = hAt(i / seg, j / seg);
        H[j * (seg + 1) + i] = h;
        HA[j * (seg + 1) + i] = fp.clampTerrain(x0 + (i / seg) * T, z0 + (j / seg) * T, h, reach, axisGround);
      }
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++)
        for (const [fu, fv] of [
          [0, 0],
          [0.5, 0.5],
          [0.25, 0.25],
          [0.75, 0.75],
        ] as const) {
          const x = x0 + ((i + fu) / seg) * T;
          const z = z0 + ((j + fv) / seg) * T;
          if (!fp.near(x, z, half + SHOULDER)) continue;
          const hit = fp.nearest(x, z, half + SHOULDER);
          if (!hit) continue;
          const lift = hit.dist < half ? 0.06 : 0.06 - (0.04 * (hit.dist - half)) / SHOULDER;
          // interpolation du maillage (triangles a,c,b / b,c,d de TerrainManager : diagonale b–c)
          const val = (G: Float64Array) => {
            const a = G[j * (seg + 1) + i]!;
            const b = G[j * (seg + 1) + i + 1]!;
            const c = G[(j + 1) * (seg + 1) + i]!;
            const d = G[(j + 1) * (seg + 1) + i + 1]!;
            return fu + fv <= 1 ? a + (b - a) * fu + (c - a) * fv : d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
          };
          const dB = val(H) - (hit.y + lift);
          const dA = val(HA) - (hit.y + lift);
          const g = axisGround(hit.px, hit.pz);
          if (Number.isFinite(g) ? g - hit.y > 2.5 : dB > 5) continue; // tunnel
          if (dB > 0.02) {
            badB++;
            zonesB.push(hit.d);
            if (dB > worstB.dh) worstB = { dh: dB, d: hit.d, across: hit.dist };
          }
          if (dA > 0.02) {
            badA++;
            if (dA > worstA.dh) worstA = { dh: dA, d: hit.d, across: hit.dist };
          }
        }
  }
  console.log(
    `(c) terrain au-dessus du ruban (maillage ${SEG} seg./tuile) : avant ${badB} points, ${groupRuns(zonesB, 30).length} zones, pire +${worstB.dh.toFixed(2)} m @ d=${worstB.d.toFixed(0)} (à ${worstB.across.toFixed(1)} m de l'axe) ; ` +
      `après ${badA} points${badA ? `, pire +${worstA.dh.toFixed(2)} m @ d=${worstA.d.toFixed(0)}` : ''}`,
  );
}
