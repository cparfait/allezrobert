/** Géométrie plane de l'île : lissage, rééchantillonnage, découpe aux tuiles, distances. */
import type { Vec2 } from './design.ts';

export type Vec3 = [number, number, number];

/** Lissage de Chaikin des angles d'une polyligne ouverte (extrémités conservées). */
export function chaikin(pts: Vec2[], iterations = 3): Vec2[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) return p;
    const q: Vec2[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]!);
    p = q;
  }
  return p;
}

/** Points espacés de `step` mètres le long de la polyligne (boucle : fermée, dernier point avant le premier). */
export function resample(pts: Vec2[], step: number, loop = false): Vec2[] {
  const src = loop ? [...pts, pts[0]!] : pts;
  const out: Vec2[] = [src[0]!];
  let carry = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i]!;
    const b = src[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += step;
    }
    carry = len - (d - step);
  }
  if (loop) {
    // Le dernier point ne doit pas doubler le premier.
    const l = out[out.length - 1]!;
    if (Math.hypot(l[0] - out[0]![0], l[1] - out[0]![1]) < step * 0.5) out.pop();
  } else {
    const last = src[src.length - 1]!;
    const l = out[out.length - 1]!;
    if (Math.hypot(l[0] - last[0], l[1] - last[1]) > step * 0.3) out.push(last);
    else out[out.length - 1] = last;
  }
  return out;
}

export function polylineLength(pts: Array<Vec2 | Vec3>, loop = false): number {
  let d = 0;
  const xz = (p: Vec2 | Vec3): Vec2 => (p.length === 3 ? [p[0], p[2]] : [p[0], p[1]]);
  for (let i = 1; i < pts.length; i++) {
    const a = xz(pts[i - 1]!);
    const b = xz(pts[i]!);
    d += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (loop && pts.length > 1) {
    const a = xz(pts[pts.length - 1]!);
    const b = xz(pts[0]!);
    d += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return d;
}

/** Projection d'un point sur un segment : paramètre t ∈ [0,1] et distance. */
export function projectSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { t: number; d: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return { t, d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)) };
}

/** Découpe d'un segment 3D par un rectangle (Liang–Barsky) ; null s'il est dehors. */
export function clipSeg(a: Vec3, b: Vec3, r: { minX: number; minZ: number; maxX: number; maxZ: number }): [Vec3, Vec3] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const test = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!test(-dx, a[0] - r.minX) || !test(dx, r.maxX - a[0]) || !test(-dz, a[2] - r.minZ) || !test(dz, r.maxZ - a[2])) return null;
  const at = (t: number): Vec3 => [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
  return [at(t0), at(t1)];
}

/** Morceaux d'une polyligne 3D à l'intérieur d'un rectangle (coupés exactement au bord). */
export function clipPolyline(pts: Vec3[], r: { minX: number; minZ: number; maxX: number; maxZ: number }): Vec3[][] {
  const out: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const c = clipSeg(pts[i]!, pts[i + 1]!, r);
    if (!c) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const [p, q] = c;
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[2] - p[2]) > 1e-6) {
      if (cur.length > 1) out.push(cur);
      cur = [p];
    }
    cur.push(q);
    // Sortie du rectangle au milieu du segment : morceau terminé.
    if (Math.hypot(q[0] - pts[i + 1]![0], q[2] - pts[i + 1]![2]) > 1e-6) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Découpe d'un polygone (anneau [x,z][]) par un rectangle (Sutherland–Hodgman). */
export function clipPolygon(poly: Vec2[], r: { minX: number; minZ: number; maxX: number; maxZ: number }): Vec2[] {
  let out = poly;
  const edges: Array<[(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2]> = [
    [(p) => p[0] >= r.minX, (a, b) => lerpAt(a, b, (r.minX - a[0]) / (b[0] - a[0]))],
    [(p) => p[0] <= r.maxX, (a, b) => lerpAt(a, b, (r.maxX - a[0]) / (b[0] - a[0]))],
    [(p) => p[1] >= r.minZ, (a, b) => lerpAt(a, b, (r.minZ - a[1]) / (b[1] - a[1]))],
    [(p) => p[1] <= r.maxZ, (a, b) => lerpAt(a, b, (r.maxZ - a[1]) / (b[1] - a[1]))],
  ];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i]!;
      const prev = inp[(i + inp.length - 1) % inp.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}

function lerpAt(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function polygonArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPolygon(x: number, z: number, p: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Ellipse en polygone (n côtés). */
export function ellipse(cx: number, cz: number, rx: number, rz: number, n = 24, rot = 0): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    out.push([cx + x * Math.cos(rot) - z * Math.sin(rot), cz + x * Math.sin(rot) + z * Math.cos(rot)]);
  }
  return out;
}

/** Rectangle orienté : centre, demi-dimensions, direction de la longueur (rad). */
export function orientedRect(cx: number, cz: number, halfLen: number, halfWid: number, angle: number): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corner = (u: number, v: number): Vec2 => [cx + u * c - v * s, cz + u * s + v * c];
  return [corner(-halfLen, -halfWid), corner(halfLen, -halfWid), corner(halfLen, halfWid), corner(-halfLen, halfWid)];
}
