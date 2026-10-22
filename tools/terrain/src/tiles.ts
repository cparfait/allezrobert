/**
 * Génération des tuiles du monde : grilles d'altitude (avec routes déjà creusées dans le
 * terrain et raccord progressif des accotements) et entités vectorielles par tuile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOD_HI, LOD_LO, ORIGIN_L93, TILE_SIZE_M } from './config.ts';
import type { Dem } from './dem.ts';
import { tileId, tileRect, type Rect } from './frame.ts';
import { clipPolylineToBox, clipRingToBox, simplify, type Pt } from './geom.ts';
import type { AreaFeature, BuildingFeature, LineFeature, Poi } from './osm.ts';

export const HEIGHT_STEP_M = 0.01;

/** Couloir de chaussée à creuser : polyligne 3D (x, y, z) et demi-largeur. */
export interface CarveLine {
  pts: Array<[number, number, number]>;
  halfWidth: number;
  /** 2 : itinéraire principal, 1 : autre itinéraire, 0 : route OSM. */
  priority: number;
  closed?: boolean;
}

/** Route rendue dans une tuile (géométrie 3D). */
export interface TileRoad {
  id: string;
  kind: string;
  name?: string;
  ref?: string;
  width: number;
  surface: string;
  bridge?: boolean;
  tunnel?: boolean;
  route?: string;
  flatten?: [number, number];
  pts: Array<[number, number, number]>;
}

export interface Grid {
  n: number; // intervalles par côté
  res: number;
  x0: number;
  z0: number;
  h: Float32Array; // (n+1)², ligne 0 = nord (z min)
}

export function sampleGrid(dem: Dem, tx: number, tz: number, n: number, filter: boolean): Grid {
  const res = TILE_SIZE_M / n;
  const x0 = tx * TILE_SIZE_M;
  const z0 = tz * TILE_SIZE_M;
  const N = n + 1;
  const h = new Float32Array(N * N);
  const e0 = ORIGIN_L93.x + x0;
  const n0 = ORIGIN_L93.y - z0;
  const off = dem.res;
  for (let j = 0; j < N; j++) {
    const nn = n0 - j * res;
    for (let i = 0; i < N; i++) {
      const ee = e0 + i * res;
      let v: number;
      if (filter) {
        // filtre binomial [1 2 1]² sur le MNT source (anti-crénelage)
        let s = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ww = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
            const val = dem.sample(ee + di * off, nn + dj * off);
            if (Number.isFinite(val)) {
              s += val * ww;
              w += ww;
            }
          }
        v = w ? s / w : NaN;
      } else v = dem.sample(ee, nn);
      h[j * N + i] = v;
    }
  }
  fillNaN(h, N);
  return { n, res, x0, z0, h };
}

function fillNaN(h: Float32Array, N: number): void {
  let bad = 0;
  let sum = 0;
  let cnt = 0;
  for (const v of h) {
    if (Number.isFinite(v)) {
      sum += v;
      cnt++;
    } else bad++;
  }
  if (!bad) return;
  const mean = cnt ? sum / cnt : 0;
  for (let i = 0; i < h.length; i++) if (!Number.isFinite(h[i]!)) h[i] = mean;
  void N;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Creuse les routes dans la grille : sur la chaussée (|d| ≤ demi-largeur + marge) le terrain
 * prend l'altitude du profil de route, puis raccord smoothstep sur `shoulder` mètres.
 */
export function carveGrid(g: Grid, lines: CarveLine[], shoulderOf: (hw: number) => number, minHalfWidth: number): void {
  const N = g.n + 1;
  const bestW = new Float32Array(N * N);
  const bestH = new Float32Array(N * N);
  const bestD = new Float32Array(N * N).fill(Infinity);
  const bestP = new Int8Array(N * N).fill(-1);
  const xMax = g.x0 + g.n * g.res;
  const zMax = g.z0 + g.n * g.res;
  for (const L of lines) {
    const hw = Math.max(L.halfWidth + 0.5, minHalfWidth);
    const sh = shoulderOf(hw);
    const R = hw + sh;
    const m = L.pts.length;
    const segs = L.closed ? m : m - 1;
    for (let s = 0; s < segs; s++) {
      const a = L.pts[s]!;
      const b = L.pts[(s + 1) % m]!;
      const minX = Math.min(a[0], b[0]) - R;
      const maxX = Math.max(a[0], b[0]) + R;
      const minZ = Math.min(a[2], b[2]) - R;
      const maxZ = Math.max(a[2], b[2]) + R;
      if (maxX < g.x0 || minX > xMax || maxZ < g.z0 || minZ > zMax) continue;
      const i0 = Math.max(0, Math.ceil((minX - g.x0) / g.res));
      const i1 = Math.min(g.n, Math.floor((maxX - g.x0) / g.res));
      const j0 = Math.max(0, Math.ceil((minZ - g.z0) / g.res));
      const j1 = Math.min(g.n, Math.floor((maxZ - g.z0) / g.res));
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz;
      for (let j = j0; j <= j1; j++) {
        const pz = g.z0 + j * g.res;
        for (let i = i0; i <= i1; i++) {
          const px = g.x0 + i * g.res;
          let t = l2 > 0 ? ((px - a[0]) * dx + (pz - a[2]) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(px - a[0] - dx * t, pz - a[2] - dz * t);
          if (d >= R) continue;
          const w = d <= hw ? 1 : 1 - smoothstep((d - hw) / sh);
          const k = j * N + i;
          const pw = bestW[k]!;
          const better = w > pw + 1e-6 || (Math.abs(w - pw) <= 1e-6 && (L.priority > bestP[k]! || (L.priority === bestP[k]! && d < bestD[k]!)));
          if (better) {
            bestW[k] = w;
            bestD[k] = d;
            bestP[k] = L.priority;
            bestH[k] = a[1] + (b[1] - a[1]) * t;
          }
        }
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const w = bestW[k]!;
    if (w > 0) g.h[k] = g.h[k]! + (bestH[k]! - g.h[k]!) * w;
  }
}

/**
 * Creusement « par passage » des itinéraires (montées en lacets) : là où deux branches d'un
 * même itinéraire sont proches (intérieur d'un lacet), `carveGrid` prend l'altitude de la
 * branche la plus proche, d'où une marche de plusieurs mètres à mi-distance des deux branches.
 * Ici chaque minimum local de la distance le long de la polyligne (un « passage ») contribue :
 * altitude visée = moyenne pondérée des passages, avec un poids qui tend vers l'infini sur la
 * chaussée (plate à l'altitude de sa branche), raccord continu entre les branches.
 * À appliquer après `carveGrid` des routes OSM : l'itinéraire passe par-dessus.
 */
export function carveGridPasses(g: Grid, lines: CarveLine[], shoulderOf: (hw: number) => number, minHalfWidth: number): void {
  const N = g.n + 1;
  const xMax = g.x0 + g.n * g.res;
  const zMax = g.z0 + g.n * g.res;
  // candidats par point de grille : [ligne, segment, distance, altitude, poids]
  const cands = new Map<number, number[]>();
  lines.forEach((L, li) => {
    const hw = Math.max(L.halfWidth + 0.5, minHalfWidth);
    const sh = shoulderOf(hw);
    const R = hw + sh;
    const m = L.pts.length;
    const segs = L.closed ? m : m - 1;
    for (let s = 0; s < segs; s++) {
      const a = L.pts[s]!;
      const b = L.pts[(s + 1) % m]!;
      const minX = Math.min(a[0], b[0]) - R;
      const maxX = Math.max(a[0], b[0]) + R;
      const minZ = Math.min(a[2], b[2]) - R;
      const maxZ = Math.max(a[2], b[2]) + R;
      if (maxX < g.x0 || minX > xMax || maxZ < g.z0 || minZ > zMax) continue;
      const i0 = Math.max(0, Math.ceil((minX - g.x0) / g.res));
      const i1 = Math.min(g.n, Math.floor((maxX - g.x0) / g.res));
      const j0 = Math.max(0, Math.ceil((minZ - g.z0) / g.res));
      const j1 = Math.min(g.n, Math.floor((maxZ - g.z0) / g.res));
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz;
      for (let j = j0; j <= j1; j++) {
        const pz = g.z0 + j * g.res;
        for (let i = i0; i <= i1; i++) {
          const px = g.x0 + i * g.res;
          let t = l2 > 0 ? ((px - a[0]) * dx + (pz - a[2]) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(px - a[0] - dx * t, pz - a[2] - dz * t);
          if (d >= R) continue;
          const w = d <= hw ? 1 : 1 - smoothstep((d - hw) / sh);
          const k = j * N + i;
          let c = cands.get(k);
          if (!c) cands.set(k, (c = []));
          c.push(li, s, d, a[1] + (b[1] - a[1]) * t, w);
        }
      }
    }
  });
  for (const [k, c] of cands) {
    const cnt = c.length / 5;
    // tri par (ligne, segment) : les segments d'une ligne sont émis dans l'ordre, les lignes aussi
    let W = 0;
    let sw = 0;
    let sh = 0;
    for (let q = 0; q < cnt; q++) {
      const li = c[q * 5]!;
      const s = c[q * 5 + 1]!;
      const d = c[q * 5 + 2]!;
      const L = lines[li]!;
      const segs = L.closed ? L.pts.length : L.pts.length - 1;
      const adj = (q2: number, ds: number) => {
        if (q2 < 0 || q2 >= cnt || c[q2 * 5] !== li) return false;
        const s2 = c[q2 * 5 + 1]!;
        return s2 === s + ds || (!!L.closed && (s2 - s - ds) % segs === 0);
      };
      const prevD = adj(q - 1, -1) ? c[(q - 1) * 5 + 2]! : Infinity;
      const nextD = adj(q + 1, 1) ? c[(q + 1) * 5 + 2]! : Infinity;
      if (!(prevD > d && nextD >= d)) continue; // pas un minimum local : même passage qu'un voisin
      const w = c[q * 5 + 4]!;
      const om = (w * w) / (1 - w + 1e-3);
      W = Math.max(W, w);
      sw += om;
      sh += om * c[q * 5 + 3]!;
    }
    if (W > 0 && sw > 0) g.h[k] = g.h[k]! + (sh / sw - g.h[k]!) * W;
  }
}

/**
 * Recolle les morceaux consécutifs d'un même couloir (découpage pour l'index par tuile : le
 * dernier point d'un morceau est le premier du suivant), sinon chaque raccord compterait
 * comme un passage de plus dans `carveGridPasses`.
 */
export function mergeChunks(lines: CarveLine[]): CarveLine[] {
  const out: CarveLine[] = [];
  for (const L of lines) {
    const prev = out[out.length - 1];
    const a = prev?.pts[prev.pts.length - 1];
    const b = L.pts[0];
    if (prev && !prev.closed && !L.closed && a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && prev.halfWidth === L.halfWidth && prev.priority === L.priority) {
      prev.pts = [...prev.pts, ...L.pts.slice(1)];
    } else out.push({ ...L, pts: L.pts.slice() });
  }
  return out;
}

/** Échantillonnage bilinéaire d'une grille en coordonnées monde (bornées à la grille). */
export function gridSample(g: Grid, x: number, z: number): number {
  const N = g.n + 1;
  let fx = (x - g.x0) / g.res;
  let fz = (z - g.z0) / g.res;
  fx = Math.max(0, Math.min(g.n - 1e-6, fx));
  fz = Math.max(0, Math.min(g.n - 1e-6, fz));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const h = g.h;
  return (h[j * N + i]! * (1 - tx) + h[j * N + i + 1]! * tx) * (1 - tz) + (h[(j + 1) * N + i]! * (1 - tx) + h[(j + 1) * N + i + 1]! * tx) * tz;
}

export function encodeGrid(g: Grid, baseM: number, stepM = HEIGHT_STEP_M): Buffer {
  const N = g.n + 1;
  const buf = Buffer.alloc(N * N * 2);
  for (let k = 0; k < N * N; k++) {
    const q = Math.round((g.h[k]! - baseM) / stepM);
    buf.writeUInt16LE(Math.max(0, Math.min(65535, q)), k * 2);
  }
  return buf;
}

export function decodeGrid(buf: Buffer, n: number, baseM: number, stepM = HEIGHT_STEP_M): Float32Array {
  const N = n + 1;
  const out = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = baseM + buf.readUInt16LE(k * 2) * stepM;
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function flatXZ(pts: Pt[]): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(r2(p[0]), r2(p[1]));
  return out;
}

function flatXYZ(pts: Array<[number, number, number]>): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(r2(p[0]), r2(p[1]), r2(p[2]));
  return out;
}

/**
 * Pas de quantification d'une tuile : 1 cm si le dénivelé de la tuile tient dans un Uint16
 * (655 m), sinon le centimètre entier le plus petit qui le fait tenir (tuiles de haute montagne).
 */
export function tileStepM(rangeM: number): number {
  return rangeM <= 650 ? HEIGHT_STEP_M : Math.ceil((rangeM / 65000) * 100) / 100;
}

/** Index « tuile → éléments » par emprise. */
export class TileBuckets<T> {
  private m = new Map<string, T[]>();
  add(box: { minX: number; minZ: number; maxX: number; maxZ: number }, item: T, margin = 0): void {
    const tx0 = Math.floor((box.minX - margin) / TILE_SIZE_M);
    const tx1 = Math.floor((box.maxX + margin) / TILE_SIZE_M);
    const tz0 = Math.floor((box.minZ - margin) / TILE_SIZE_M);
    const tz1 = Math.floor((box.maxZ + margin) / TILE_SIZE_M);
    if ((tx1 - tx0 + 1) * (tz1 - tz0 + 1) > 4000) return;
    for (let tx = tx0; tx <= tx1; tx++)
      for (let tz = tz0; tz <= tz1; tz++) {
        const k = tileId(tx, tz);
        let a = this.m.get(k);
        if (!a) this.m.set(k, (a = []));
        a.push(item);
      }
  }
  get(tx: number, tz: number): T[] {
    return this.m.get(tileId(tx, tz)) ?? [];
  }
}

export interface TileInputs {
  roads: TileBuckets<TileRoad>;
  carve: TileBuckets<CarveLine>;
  buildings: TileBuckets<BuildingFeature>;
  areas: TileBuckets<AreaFeature & { level?: number }>;
  lines: TileBuckets<LineFeature>;
  pois: TileBuckets<Poi>;
}

export interface TileResult {
  id: string;
  tx: number;
  tz: number;
  baseM: number;
  minM: number;
  maxM: number;
  lods: string[];
  bytes: number;
  /** Pas de quantification des altitudes (m). */
  stepM: number;
  counts: Record<string, number>;
}

function clipRings(polys: AreaFeature['polygons'], rect: Rect, tol: number): number[][][] {
  const out: number[][][] = [];
  for (const p of polys) {
    const outer = clipRingToBox(p.outer, rect);
    if (outer.length < 3) continue;
    const o = simplify([...outer, outer[0]!], tol).slice(0, -1);
    if (o.length < 3) continue;
    const rings = [flatXZ(o)];
    for (const h of p.holes) {
      const c = clipRingToBox(h, rect);
      if (c.length < 3) continue;
      const s = simplify([...c, c[0]!], tol).slice(0, -1);
      if (s.length >= 3) rings.push(flatXZ(s));
    }
    out.push(rings);
  }
  return out;
}

export function buildTile(
  tx: number,
  tz: number,
  hi: boolean,
  dems: { lo: Dem; hi: Dem },
  inputs: TileInputs,
  outDir: string,
  /** « passes » : itinéraires creusés par `carveGridPasses` (lacets), routes OSM par `carveGrid`. */
  carveMode: 'max' | 'passes' = 'max',
  /** Retouche du JSON avant écriture (données fines), avec le terrain creusé le plus fin. */
  decorate?: (json: Record<string, unknown>, groundAt: (x: number, z: number) => number) => void,
): TileResult {
  const id = tileId(tx, tz);
  const rect = tileRect(tx, tz);
  const carve = inputs.carve.get(tx, tz);
  const carveAll = (grid: Grid, shoulderOf: (hw: number) => number, minHw: number) => {
    if (carveMode === 'max') carveGrid(grid, carve, shoulderOf, minHw);
    else {
      carveGrid(grid, carve.filter((c) => c.priority === 0), shoulderOf, minHw);
      carveGridPasses(grid, mergeChunks(carve.filter((c) => c.priority > 0)), shoulderOf, minHw);
    }
  };
  // grilles
  // niveau lo : toujours depuis le MNT 8 m (bords identiques entre toutes les tuiles lo)
  const lo = sampleGrid(dems.lo, tx, tz, LOD_LO.n, false);
  carveAll(lo, () => 14, 4);
  let hiGrid: Grid | null = null;
  if (hi) {
    hiGrid = sampleGrid(dems.hi, tx, tz, LOD_HI.n, true);
    carveAll(hiGrid, (hw) => 4 + hw, 0);
  }
  const fine = hiGrid ?? lo;
  let minM = Infinity;
  let maxM = -Infinity;
  for (const g of hiGrid ? [lo, hiGrid] : [lo])
    for (const v of g.h) {
      if (v < minM) minM = v;
      if (v > maxM) maxM = v;
    }
  const baseM = Math.floor(minM) - 1;
  const stepM = tileStepM(maxM - baseM);
  const tilesDir = path.join(outDir, 'tiles');
  let bytes = 0;
  const loBuf = encodeGrid(lo, baseM, stepM);
  fs.writeFileSync(path.join(tilesDir, `${id}.lo.u16`), loBuf);
  bytes += loBuf.length;
  if (hiGrid) {
    const hb = encodeGrid(hiGrid, baseM, stepM);
    fs.writeFileSync(path.join(tilesDir, `${id}.hi.u16`), hb);
    bytes += hb.length;
  }
  // entités
  const roads: Array<Record<string, unknown>> = [];
  for (const r of inputs.roads.get(tx, tz)) {
    for (const piece of clipPolylineToBox(r.pts, rect)) {
      if (piece.length < 2) continue;
      const o: Record<string, unknown> = { id: r.id, kind: r.kind, width: r.width, surface: r.surface };
      if (r.name) o.name = r.name;
      if (r.ref) o.ref = r.ref;
      if (r.bridge) o.bridge = true;
      if (r.tunnel) o.tunnel = true;
      if (r.route) o.route = r.route;
      if (r.flatten) o.flatten = r.flatten;
      o.pts = flatXYZ(piece);
      roads.push(o);
    }
  }
  const buildings: Array<Record<string, unknown>> = [];
  for (const b of inputs.buildings.get(tx, tz)) {
    const c = b.centroid;
    if (c[0] < rect.minX || c[0] >= rect.maxX || c[1] < rect.minZ || c[1] >= rect.maxZ) continue;
    const p0 = b.polygons[0]!;
    let y = Infinity;
    for (const p of p0.outer) y = Math.min(y, gridSample(fine, p[0], p[1]));
    const o: Record<string, unknown> = {
      id: b.id,
      kind: b.kind,
      height: b.height,
      levels: b.levels,
      roof: { shape: b.roofShape, height: b.roofHeight, ...(b.roofColour ? { colour: b.roofColour } : {}) },
      y: r2(y),
      pts: flatXZ(p0.outer),
    };
    if (p0.holes.length) o.holes = p0.holes.map(flatXZ);
    if (b.minHeight) o.minHeight = b.minHeight;
    if (b.colour) o.colour = b.colour;
    if (b.material) o.material = b.material;
    if (b.name) o.name = b.name;
    buildings.push(o);
  }
  const forests: Array<Record<string, unknown>> = [];
  const fields: Array<Record<string, unknown>> = [];
  const landuse: Array<Record<string, unknown>> = [];
  const water: Array<Record<string, unknown>> = [];
  const tol = hi ? 0.5 : 1.5;
  for (const a of inputs.areas.get(tx, tz)) {
    const polys = clipRings(a.polygons, rect, tol);
    for (const rings of polys) {
      const o: Record<string, unknown> = { id: a.id, kind: a.kind, rings };
      if (a.name) o.name = a.name;
      if (a.cat === 'forest') forests.push(o);
      else if (a.cat === 'field') fields.push(o);
      else if (a.cat === 'landuse') landuse.push(o);
      else {
        o.level = r2(a.level ?? 0);
        water.push(o);
      }
    }
  }
  const waterways: Array<Record<string, unknown>> = [];
  const railways: Array<Record<string, unknown>> = [];
  for (const l of inputs.lines.get(tx, tz)) {
    for (const piece of clipPolylineToBox(l.pts, rect)) {
      const o: Record<string, unknown> = { id: l.id, kind: l.kind, width: l.width };
      if (l.name) o.name = l.name;
      if (l.tunnel) o.tunnel = true;
      if (l.bridge) o.bridge = true;
      o.pts = flatXZ(piece);
      (l.cat === 'waterway' ? waterways : railways).push(o);
    }
  }
  const pois: Array<Record<string, unknown>> = [];
  for (const p of inputs.pois.get(tx, tz)) {
    if (p.x < rect.minX || p.x >= rect.maxX || p.z < rect.minZ || p.z >= rect.maxZ) continue;
    pois.push({ id: p.id, kind: p.kind, name: p.name, x: p.x, y: r2(gridSample(fine, p.x, p.z)), z: p.z, ...(p.ele !== undefined ? { ele: p.ele } : {}) });
  }
  const json = {
    id,
    tx,
    tz,
    bounds: rect,
    heights: {
      baseM,
      stepM,
      encoding: 'uint16le',
      lo: { n: LOD_LO.n, resolutionM: LOD_LO.resM, file: `${id}.lo.u16` },
      ...(hiGrid ? { hi: { n: LOD_HI.n, resolutionM: LOD_HI.resM, file: `${id}.hi.u16` } } : {}),
    },
    roads,
    buildings,
    forests,
    fields,
    landuse,
    water,
    waterways,
    railways,
    pois,
  };
  decorate?.(json, (x, z) => gridSample(fine, x, z));
  const s = JSON.stringify(json);
  fs.writeFileSync(path.join(tilesDir, `${id}.json`), s);
  bytes += Buffer.byteLength(s);
  return {
    id,
    tx,
    tz,
    baseM,
    minM: r2(minM),
    maxM: r2(maxM),
    lods: hiGrid ? ['lo', 'hi'] : ['lo'],
    bytes,
    stepM,
    counts: { roads: roads.length, buildings: buildings.length, forests: forests.length, fields: fields.length, water: water.length },
  };
}
