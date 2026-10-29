/**
 * Routes de l'île : polylignes tous les 2 m avec profil en long, index spatial, sol arasé sous la chaussée,
 * graphe routier (nœuds aux extrémités, aux raccords et aux croisements).
 */
import type { RoadGraphData, RoadGraphEdge } from '../../../packages/shared/src/roadgraph.ts';
import { terrain, type Vec2 } from './design.ts';
import { chaikin, projectSeg, resample, type Vec3 } from './geom.ts';

export const STEP = 2;
export const ATTRIBUTION = ["L'île de Robert — monde imaginaire d'Allez Robert ! (généré par tools/island)"];
export const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Road {
  id: string;
  name: string;
  kind: string;
  width: number;
  surface: string;
  loop: boolean;
  /** Points tous les 2 m [x, y, z] ; boucle : le dernier précède le premier. */
  pts: Vec3[];
  /** Demi-largeur arasée (chaussée + accotement) et largeur du raccord au terrain naturel. */
  flat: number;
  blend: number;
  /** Route dessinée (rues, anneau, front de mer) plutôt que tracée par la recherche de chemin. */
  designed?: boolean;
  /** Pente maximale visée (fraction). */
  gmax: number;
}

export interface RoadSpec {
  id: string;
  name: string;
  kind: string;
  width: number;
  pts: Vec2[];
  loop?: boolean;
  surface?: string;
  /** Lissage des angles (itérations de Chaikin), 0 pour un tracé déjà lisse. */
  smooth?: number;
  gmax?: number;
  designed?: boolean;
  /** Altitudes imposées aux extrémités (raccords). */
  y0?: number;
  y1?: number;
}

/** Altitude d'un carrefour : terrain moyen sur un disque de 14 m (même valeur pour toutes les routes). */
export function nodeHeight(x: number, z: number): number {
  let s = terrain(x, z) * 2;
  let c = 2;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    s += terrain(x + Math.cos(a) * 14, z + Math.sin(a) * 14);
    c++;
  }
  return s / c;
}

/** Profil en long : moyenne glissante du terrain (± `win` m), extrémités imposées, pente plafonnée. */
export function profile(xz: Vec2[], loop: boolean, win: number, maxGrade: number, y0?: number, y1?: number): number[] {
  const n = xz.length;
  const raw = xz.map(([x, z]) => terrain(x, z));
  const k = Math.max(1, Math.round(win / STEP));
  // Moyenne glissante par sommes cumulées.
  const y = new Array<number>(n);
  if (loop) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -k; j <= k; j++) s += raw[(i + j + n) % n]!;
      y[i] = s / (2 * k + 1);
    }
  } else {
    const cum = [0];
    for (let i = 0; i < n; i++) cum.push(cum[i]! + raw[i]!);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - k);
      const b = Math.min(n - 1, i + k);
      y[i] = (cum[b + 1]! - cum[a]!) / (b - a + 1);
    }
  }
  if (!loop && n > 1) {
    // Extrémités imposées : écart réparti sur 80 m (ou la moitié de la route).
    const span = Math.max(1, Math.min(Math.round(80 / STEP), Math.floor((n - 1) / 2)));
    const d0 = y0 === undefined ? 0 : y0 - y[0]!;
    const d1 = y1 === undefined ? 0 : y1 - y[n - 1]!;
    for (let i = 0; i <= span; i++) {
      const t = 1 - i / span;
      y[i] = y[i]! + d0 * t * t * (3 - 2 * t);
      y[n - 1 - i] = y[n - 1 - i]! + d1 * t * t * (3 - 2 * t);
    }
  }
  // Pente plafonnée dans les deux sens ; extrémités imposées conservées.
  const lim = maxGrade * STEP;
  const pin0 = y0 !== undefined ? y[0]! : null;
  const pin1 = y1 !== undefined ? y[n - 1]! : null;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i - 1]! + lim, Math.max(y[i - 1]! - lim, y[i]!));
    if (pin1 !== null) y[n - 1] = pin1;
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i + 1]! + lim, Math.max(y[i + 1]! - lim, y[i]!));
    if (pin0 !== null) y[0] = pin0;
  }
  return y;
}

export function makeRoad(s: RoadSpec): Road {
  const loop = !!s.loop;
  const sm = s.smooth ?? 4;
  const xz = loop ? resample(s.pts, STEP, true) : resample(sm ? chaikin(s.pts, sm) : s.pts, STEP);
  const gmax = s.gmax ?? 0.09;
  const y = profile(xz, loop, s.kind === 'track' ? 16 : 30, gmax, s.y0, s.y1);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    width: s.width,
    surface: s.surface ?? 'asphalt',
    loop,
    pts: xz.map(([x, z], i) => [x, y[i]!, z]),
    flat: s.width / 2 + (s.kind === 'track' ? 0.8 : 1.5),
    blend: s.kind === 'track' ? 5 : 7,
    gmax,
    ...(s.designed ? { designed: true } : {}),
  };
}

// ── Index spatial des segments ──

export class SegGrid<T> {
  private cells = new Map<number, Array<{ ax: number; az: number; bx: number; bz: number; data: T; i: number }>>();
  constructor(private readonly cs: number) {}
  private key(i: number, j: number) {
    return i * 1000003 + j;
  }
  add(ax: number, az: number, bx: number, bz: number, data: T, i: number, reach = 0): void {
    const e = { ax, az, bx, bz, data, i };
    for (let ci = Math.floor((Math.min(ax, bx) - reach) / this.cs); ci <= Math.floor((Math.max(ax, bx) + reach) / this.cs); ci++)
      for (let cj = Math.floor((Math.min(az, bz) - reach) / this.cs); cj <= Math.floor((Math.max(az, bz) + reach) / this.cs); cj++) {
        const k = this.key(ci, cj);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(e);
      }
  }
  at(x: number, z: number) {
    return this.cells.get(this.key(Math.floor(x / this.cs), Math.floor(z / this.cs))) ?? [];
  }
  near(x: number, z: number, r: number) {
    const out = new Set<{ ax: number; az: number; bx: number; bz: number; data: T; i: number }>();
    for (let ci = Math.floor((x - r) / this.cs); ci <= Math.floor((x + r) / this.cs); ci++)
      for (let cj = Math.floor((z - r) / this.cs); cj <= Math.floor((z + r) / this.cs); cj++) for (const e of this.cells.get(this.key(ci, cj)) ?? []) out.add(e);
    return [...out];
  }
}

export function roadSegGrid(roads: Road[], cs = 32): SegGrid<Road> {
  const g = new SegGrid<Road>(cs);
  for (const r of roads) {
    const n = r.pts.length;
    for (let i = 0; i < (r.loop ? n : n - 1); i++) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % n]!;
      g.add(a[0], a[2], b[0], b[2], r, i);
    }
  }
  return g;
}

/** Point le plus proche d'une route : index du segment, paramètre, distance, altitude. */
export function nearestOn(road: Road, x: number, z: number): { i: number; t: number; d: number; y: number } {
  let best = { i: 0, t: 0, d: Infinity, y: 0 };
  const n = road.pts.length;
  const segs = road.loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = road.pts[i]!;
    const b = road.pts[(i + 1) % n]!;
    const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
    if (p.d < best.d) best = { i, t: p.t, d: p.d, y: a[1] + (b[1] - a[1]) * p.t };
  }
  return best;
}

/** Point le plus proche parmi les routes d'un index (null au-delà de `r`). */
export function nearestRoad(g: SegGrid<Road>, x: number, z: number, r: number, skip?: Road): { road: Road; i: number; t: number; d: number; y: number } | null {
  let best: { road: Road; i: number; t: number; d: number; y: number } | null = null;
  for (const e of g.near(x, z, r)) {
    if (e.data === skip) continue;
    const p = projectSeg(x, z, e.ax, e.az, e.bx, e.bz);
    if (p.d > r || (best && p.d >= best.d)) continue;
    const a = e.data.pts[e.i]!;
    const b = e.data.pts[(e.i + 1) % e.data.pts.length]!;
    best = { road: e.data, i: e.i, t: p.t, d: p.d, y: a[1] + (b[1] - a[1]) * p.t };
  }
  return best;
}

/**
 * Raccords : l'extrémité d'une route posée sur une autre prend la position et l'altitude du point qui
 * portera le nœud ; l'écart est réparti sur les 40 m qui précèdent.
 */
export function snapEnds(road: Road, onto: Road[], fallback: Road[] = [], reach = 4): void {
  for (const end of [0, road.pts.length - 1]) {
    const p = road.pts[end]!;
    let target: Vec3 | null = null;
    let bestD = reach;
    for (const o of onto.some((q) => q !== road && nearestOn(q, p[0], p[2]).d < reach) ? onto : fallback) {
      if (o === road) continue;
      const q = nearestOn(o, p[0], p[2]);
      if (q.d < bestD) {
        bestD = q.d;
        target = o.pts[q.t < 0.5 ? q.i : (q.i + 1) % o.pts.length]!;
      }
    }
    if (target === null) continue;
    p[0] = target[0];
    p[2] = target[2];
    const delta = target[1] - p[1];
    const span = Math.round(40 / STEP);
    for (let k = 0; k <= span && k < road.pts.length; k++) {
      const idx = end === 0 ? k : road.pts.length - 1 - k;
      road.pts[idx]![1] += delta * (1 - k / span);
    }
  }
}

// ── Terrain arasé sous les routes ──

export class RoadIndex {
  private cells = new Map<number, Array<{ r: Road; i: number }>>();
  private readonly cs = 25;
  constructor(readonly roads: Road[]) {
    for (const r of roads) {
      const n = r.pts.length;
      const segs = r.loop ? n : n - 1;
      const reach = r.flat + 2.2 + r.blend;
      for (let i = 0; i < segs; i++) {
        const a = r.pts[i]!;
        const b = r.pts[(i + 1) % n]!;
        const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / this.cs);
        const x1 = Math.floor((Math.max(a[0], b[0]) + reach) / this.cs);
        const z0 = Math.floor((Math.min(a[2], b[2]) - reach) / this.cs);
        const z1 = Math.floor((Math.max(a[2], b[2]) + reach) / this.cs);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const k = cx * 1000003 + cz;
            let l = this.cells.get(k);
            if (!l) this.cells.set(k, (l = []));
            l.push({ r, i });
          }
      }
    }
  }

  /** Route la plus « contraignante » au point : distance, altitude de chaussée, route. */
  query(x: number, z: number): { d: number; y: number; r: Road } | null {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return null;
    let best: { d: number; y: number; r: Road; score: number } | null = null;
    for (const { r, i } of l) {
      const n = r.pts.length;
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % n]!;
      const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
      if (p.d > r.flat + r.blend) continue;
      // La chaussée la plus proche (relativement à sa largeur) l'emporte.
      const score = p.d - r.flat;
      if (!best || score < best.score) best = { d: p.d, y: a[1] + (b[1] - a[1]) * p.t, r, score };
    }
    return best;
  }

  /** Sol arasé : minimum, sur les routes proches, de leur chaussée (−10 cm) raccordée au terrain `h0`. */
  lowest(x: number, z: number, h0: number): number {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return h0;
    let h = h0;
    let touched = false;
    for (const { r, i } of l) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % r.pts.length]!;
      const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
      // Plateforme arasée une case de grille (2 m) au-delà de l'accotement : entre deux sommets de la grille,
      // le sol interpolé ne remonte jamais au-dessus de la chaussée.
      const flat = r.flat + 2.2;
      if (p.d > flat + r.blend) continue;
      const under = a[1] + (b[1] - a[1]) * p.t - 0.1;
      const v = p.d <= flat ? under : under + (h0 - under) * smoothstep01((p.d - flat) / r.blend);
      if (!touched || v < h) h = v;
      touched = true;
    }
    return h;
  }

  /** Distance à la chaussée la plus proche (bord compris), Infinity au-delà de la zone indexée. */
  edgeDist(x: number, z: number): number {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return Infinity;
    let best = Infinity;
    for (const { r, i } of l) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % r.pts.length]!;
      best = Math.min(best, projectSeg(x, z, a[0], a[2], b[0], b[2]).d - r.width / 2);
    }
    return best;
  }
}

const smoothstep01 = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * Altitude finale : terrain naturel, arasé 10 cm sous la chaussée et ses accotements, raccordé au-delà.
 * Plusieurs routes (carrefours) : le sol le plus bas l'emporte, jamais de terre au-dessus d'une chaussée.
 */
export function finalHeight(idx: RoadIndex, x: number, z: number): number {
  const h0 = terrain(x, z);
  return idx.lowest(x, z, h0);
}

// ── Graphe routier ──

/** Paramètres (t, u) du croisement de deux segments en plan, extrémités comprises ; null s'ils ne se coupent pas. */
export function segCross(p: Vec3, q: Vec3, u: Vec3, v: Vec3): [number, number] | null {
  const rx = q[0] - p[0];
  const rz = q[2] - p[2];
  const sx = v[0] - u[0];
  const sz = v[2] - u[2];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((u[0] - p[0]) * sz - (u[2] - p[2]) * sx) / den;
  const w = ((u[0] - p[0]) * rz - (u[2] - p[2]) * rx) / den;
  return t >= 0 && t <= 1 && w >= 0 && w <= 1 ? [t, w] : null;
}

export interface Crossing {
  ra: Road;
  i: number;
  ta: number;
  rb: Road;
  j: number;
  tb: number;
}

/** Croisements entre routes, hors des abords (8 m) d'une extrémité (raccords en T, gérés à part). */
export function findCrossings(roads: Road[]): Crossing[] {
  const grid = roadSegGrid(roads, 24);
  const out: Crossing[] = [];
  const ends = (r: Road): Vec3[] => (r.loop ? [] : [r.pts[0]!, r.pts[r.pts.length - 1]!]);
  for (const ra of roads) {
    const na = ra.pts.length;
    for (let i = 0; i < (ra.loop ? na : na - 1); i++) {
      const p = ra.pts[i]!;
      const q = ra.pts[(i + 1) % na]!;
      for (const e of grid.near((p[0] + q[0]) / 2, (p[2] + q[2]) / 2, 3)) {
        const rb = e.data;
        if (rb === ra || rb.id < ra.id) continue;
        const nb = rb.pts.length;
        const u = rb.pts[e.i]!;
        const v = rb.pts[(e.i + 1) % nb]!;
        const c = segCross(p, q, u, v);
        if (!c) continue;
        const x = p[0] + (q[0] - p[0]) * c[0];
        const z = p[2] + (q[2] - p[2]) * c[0];
        if ([...ends(ra), ...ends(rb)].some((w) => Math.hypot(w[0] - x, w[2] - z) < 8)) continue;
        if (out.some((o) => o.ra === ra && o.rb === rb && Math.abs(o.i - i) < 4)) continue;
        out.push({ ra, i, ta: c[0], rb, j: e.i, tb: c[1] });
      }
    }
  }
  return out;
}

/** Croisements : les deux routes passent à la même altitude (écart réparti sur ± 40 m de chacune). */
export function joinCrossings(roads: Road[]): number {
  const xs = findCrossings(roads);
  for (const c of xs) {
    const ya = c.ra.pts[c.i]![1] + (c.ra.pts[(c.i + 1) % c.ra.pts.length]![1] - c.ra.pts[c.i]![1]) * c.ta;
    const yb = c.rb.pts[c.j]![1] + (c.rb.pts[(c.j + 1) % c.rb.pts.length]![1] - c.rb.pts[c.j]![1]) * c.tb;
    const target = (ya + yb) / 2;
    for (const [r, k, y] of [[c.ra, c.i, ya], [c.rb, c.j, yb]] as const) {
      const delta = target - y;
      const span = 20;
      for (let o = -span; o <= span + 1; o++) {
        let idx = k + o;
        if (r.loop) idx = (idx + r.pts.length) % r.pts.length;
        else if (idx < 0 || idx >= r.pts.length) continue;
        const w = 1 - Math.min(1, Math.abs(o - 0.5) / (span + 0.5));
        r.pts[idx]![1] += delta * w * w * (3 - 2 * w);
      }
    }
  }
  return xs.length;
}

export function buildGraph(roads: Road[]): RoadGraphData {
  const grid = roadSegGrid(roads, 24);
  const cuts = new Map<Road, Set<number>>();
  const addCut = (r: Road, i: number) => (cuts.get(r) ?? cuts.set(r, new Set()).get(r)!).add(i);
  for (const r of roads) {
    if (r.loop) continue;
    addCut(r, 0);
    addCut(r, r.pts.length - 1);
    // Extrémité posée sur une autre route : nœud sur celle-ci.
    for (const end of [0, r.pts.length - 1]) {
      const p = r.pts[end]!;
      const seen = new Set<Road>();
      for (const e of grid.near(p[0], p[2], 4)) {
        if (e.data === r || seen.has(e.data)) continue;
        const q = projectSeg(p[0], p[2], e.ax, e.az, e.bx, e.bz);
        if (q.d >= 4) continue;
        const o = e.data;
        const best = nearestOn(o, p[0], p[2]);
        if (best.d < 4) {
          seen.add(o);
          addCut(o, best.t < 0.5 ? best.i : (best.i + 1) % o.pts.length);
        }
      }
    }
  }
  // Croisements en X : un nœud commun aux deux routes.
  for (const c of findCrossings(roads)) {
    addCut(c.ra, c.ta < 0.5 ? c.i : (c.i + 1) % c.ra.pts.length);
    addCut(c.rb, c.tb < 0.5 ? c.j : (c.j + 1) % c.rb.pts.length);
  }
  const nodes: number[] = [];
  const nodeCells = new Map<number, number[]>();
  const nodeAt = (p: Vec3): number => {
    const ci = Math.floor(p[0] / 5);
    const cj = Math.floor(p[2] / 5);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const k of nodeCells.get((ci + di) * 1000003 + cj + dj) ?? []) if (Math.hypot(nodes[k * 3]! - p[0], nodes[k * 3 + 2]! - p[2]) < 4.5) return k;
    nodes.push(r2(p[0]), r2(p[1]), r2(p[2]));
    const k = nodes.length / 3 - 1;
    const key = ci * 1000003 + cj;
    (nodeCells.get(key) ?? nodeCells.set(key, []).get(key)!).push(k);
    return k;
  };
  const edges: RoadGraphEdge[] = [];
  for (const r of roads) {
    const idx = [...(cuts.get(r) ?? [])].sort((a, b) => a - b);
    if (!idx.length) continue;
    const n = r.pts.length;
    const pieces: number[][] = [];
    if (r.loop) {
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k]!;
        const b = idx[(k + 1) % idx.length]!;
        const seq: number[] = [];
        for (let i = a; ; i = (i + 1) % n) {
          seq.push(i);
          if (i === b && seq.length > 1) break;
        }
        pieces.push(seq);
      }
    } else for (let k = 0; k < idx.length - 1; k++) pieces.push(Array.from({ length: idx[k + 1]! - idx[k]! + 1 }, (_, j) => idx[k]! + j));
    for (const seq of pieces) {
      if (seq.length < 2) continue;
      const pts = seq.map((i) => r.pts[i]!);
      const a = nodeAt(pts[0]!);
      const b = nodeAt(pts[pts.length - 1]!);
      if (a === b && pts.length < 4) continue;
      // Extrémités posées exactement sur les nœuds (altitude unique au carrefour).
      pts[0] = [nodes[a * 3]!, nodes[a * 3 + 1]!, nodes[a * 3 + 2]!];
      pts[pts.length - 1] = [nodes[b * 3]!, nodes[b * 3 + 1]!, nodes[b * 3 + 2]!];
      // Point voisin d'un nœud à moins de 0,5 m : retiré (pas de pas minuscule au raccord).
      if (pts.length > 2 && Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![2] - pts[0]![2]) < 0.5) pts.splice(1, 1);
      if (pts.length > 2 && Math.hypot(pts[pts.length - 2]![0] - pts[pts.length - 1]![0], pts[pts.length - 2]![2] - pts[pts.length - 1]![2]) < 0.5) pts.splice(pts.length - 2, 1);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
      edges.push({ a, b, kind: r.kind, name: r.name, width: r.width, surface: r.surface, oneway: 0, len: r2(len), pts: pts.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]) });
    }
  }
  return { formatVersion: 1, nodes, edges, attribution: ATTRIBUTION };
}
