/** Outils géométriques 2D (plan x/z du repère monde). */

export type Pt = [number, number];

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** Distances cumulées. */
export function cumulative(pts: Pt[]): number[] {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return d;
}

/** Rééchantillonne une polyligne ouverte à pas régulier (le dernier point est conservé). */
export function resampleOpen(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const cum = cumulative(pts);
  const total = cum[cum.length - 1]!;
  const n = Math.max(1, Math.round(total / step));
  const out: Pt[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (k < pts.length - 2 && cum[k + 1]! < s) k++;
    const seg = cum[k + 1]! - cum[k]!;
    const t = seg > 0 ? (s - cum[k]!) / seg : 0;
    const a = pts[k]!;
    const b = pts[k + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * Rééchantillonne une boucle fermée (le premier point n'est pas répété en fin) à un pas
 * qui divise exactement la longueur totale. Renvoie aussi le pas effectif.
 */
export function resampleClosed(pts: Pt[], step: number): { pts: Pt[]; step: number } {
  const ring = [...pts, pts[0]!];
  const cum = cumulative(ring);
  const total = cum[cum.length - 1]!;
  const n = Math.max(3, Math.round(total / step));
  const out: Pt[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / n;
    while (k < ring.length - 2 && cum[k + 1]! < s) k++;
    const seg = cum[k + 1]! - cum[k]!;
    const t = seg > 0 ? (s - cum[k]!) / seg : 0;
    const a = ring[k]!;
    const b = ring[k + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts: out, step: total / n };
}

/** Noyau gaussien discret (σ en échantillons), tronqué à 3σ. */
export function gaussianKernel(sigma: number): number[] {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    s += v;
  }
  return k.map((v) => v / s);
}

/** Lissage gaussien d'un signal, circulaire (boucle) ou avec réflexion aux bords. */
export function smooth1d(v: ArrayLike<number>, sigma: number, circular: boolean): number[] {
  const n = v.length;
  if (sigma <= 0 || n < 3) return Array.from(v);
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) {
      let idx = i + j;
      if (circular) idx = ((idx % n) + n) % n;
      else {
        if (idx < 0) idx = -idx;
        if (idx >= n) idx = 2 * (n - 1) - idx;
        idx = Math.max(0, Math.min(n - 1, idx));
      }
      s += (k[j + r] ?? 0) * (v[idx] ?? 0);
    }
    out[i] = s;
  }
  return out;
}

/** Interpolation Catmull-Rom centripète entre p1 et p2 (t ∈ [0,1]). */
export function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const alpha = 0.5;
  const tj = (ti: number, a: Pt, b: Pt) => ti + Math.max(1e-6, Math.pow(dist(a, b), alpha));
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Densifie une boucle fermée par Catmull-Rom centripète (`sub` points par segment). */
export function catmullRomClosed(pts: Pt[], sub: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let s = 0; s < sub; s++) out.push(catmullRom(p0, p1, p2, p3, s / sub));
  }
  return out;
}

/** Densifie une polyligne ouverte par Catmull-Rom centripète. */
export function catmullRomOpen(pts: Pt[], sub: number): Pt[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = i > 0 ? pts[i - 1]! : ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] as Pt);
    const p3 = i + 2 < n ? pts[i + 2]! : ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] as Pt);
    for (let s = 0; s < sub; s++) out.push(catmullRom(p0, p1, p2, p3, s / sub));
  }
  out.push(pts[n - 1]!);
  return out;
}

/** Projection d'un point sur un segment : distance, paramètre t ∈ [0,1]. */
export function projectOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t;
  const qz = az + dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t };
}

/** Cap (radians, 0 = est, sens trigonométrique dans le plan x/z). */
export function heading(a: Pt, b: Pt): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** Aire signée (formule du lacet), positive si sens trigonométrique dans (x, z). */
export function signedArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return s / 2;
}

export function pointInRing(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const zi = ring[i]![1];
    const xj = ring[j]![0];
    const zj = ring[j]![1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function bboxOf(pts: Pt[]): Box {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/** Découpe d'un anneau par un rectangle (Sutherland–Hodgman). */
export function clipRingToBox(ring: Pt[], b: Box): Pt[] {
  let out = ring;
  const edges: Array<[(p: Pt) => boolean, (p: Pt, q: Pt) => Pt]> = [
    [(p) => p[0] >= b.minX, (p, q) => interX(p, q, b.minX)],
    [(p) => p[0] <= b.maxX, (p, q) => interX(p, q, b.maxX)],
    [(p) => p[1] >= b.minZ, (p, q) => interZ(p, q, b.minZ)],
    [(p) => p[1] <= b.maxZ, (p, q) => interZ(p, q, b.maxZ)],
  ];
  for (const [inside, inter] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(inter(prev, cur));
        out.push(cur);
      } else if (pi) out.push(inter(prev, cur));
    }
  }
  return out;
}

function interX(p: Pt, q: Pt, x: number): Pt {
  const t = (x - p[0]) / (q[0] - p[0]);
  return [x, p[1] + (q[1] - p[1]) * t];
}
function interZ(p: Pt, q: Pt, z: number): Pt {
  const t = (z - p[1]) / (q[1] - p[1]);
  return [p[0] + (q[0] - p[0]) * t, z];
}

/** Découpe d'une polyligne par un rectangle (Liang–Barsky par segment) ; renvoie les morceaux. */
export function clipPolylineToBox<T extends number[]>(pts: T[], b: Box): T[][] {
  const pieces: T[][] = [];
  let cur: T[] = [];
  const lerp = (p: T, q: T, t: number): T => p.map((v, i) => v + ((q[i] ?? v) - v) * t) as T;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    // coordonnées planes : indices 0 (x) et dernier (z)
    const zi = p.length - 1;
    const x0 = p[0]!;
    const z0 = p[zi]!;
    const dx = q[0]! - x0;
    const dz = q[zi]! - z0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    const checks: Array<[number, number]> = [
      [-dx, x0 - b.minX],
      [dx, b.maxX - x0],
      [-dz, z0 - b.minZ],
      [dz, b.maxZ - z0],
    ];
    for (const [pp, qq] of checks) {
      if (pp === 0) {
        if (qq < 0) ok = false;
      } else {
        const r = qq / pp;
        if (pp < 0) {
          if (r > t1) ok = false;
          else if (r > t0) t0 = r;
        } else {
          if (r < t0) ok = false;
          else if (r < t1) t1 = r;
        }
      }
    }
    if (!ok) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    const a = t0 > 0 ? lerp(p, q, t0) : p;
    const c = t1 < 1 ? lerp(p, q, t1) : q;
    if (cur.length === 0 || t0 > 0) {
      if (cur.length > 1) pieces.push(cur);
      cur = [a];
    }
    cur.push(c);
    if (t1 < 1) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/** Simplification Douglas–Peucker. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const pa = pts[a]!;
    const pb = pts[b]!;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i]!;
      const d = projectOnSegment(p[0], p[1], pa[0], pa[1], pb[0], pb[1]).d;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Index spatial à grille régulière. */
export class GridIndex<T> {
  private cells = new Map<number, T[]>();
  constructor(readonly cell: number) {}
  private key(i: number, j: number): number {
    return (i + 100000) * 200003 + (j + 100000);
  }
  insertBox(b: Box, item: T): void {
    const i0 = Math.floor(b.minX / this.cell);
    const i1 = Math.floor(b.maxX / this.cell);
    const j0 = Math.floor(b.minZ / this.cell);
    const j1 = Math.floor(b.maxZ / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(item);
      }
  }
  query(x: number, z: number, r: number): T[] {
    const out = new Set<T>();
    const i0 = Math.floor((x - r) / this.cell);
    const i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell);
    const j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) for (const it of this.cells.get(this.key(i, j)) ?? []) out.add(it);
    return [...out];
  }
  queryBox(b: Box): T[] {
    const out = new Set<T>();
    const i0 = Math.floor(b.minX / this.cell);
    const i1 = Math.floor(b.maxX / this.cell);
    const j0 = Math.floor(b.minZ / this.cell);
    const j1 = Math.floor(b.maxZ / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) for (const it of this.cells.get(this.key(i, j)) ?? []) out.add(it);
    return [...out];
  }
}
