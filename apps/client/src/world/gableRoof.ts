/**
 * Toit à deux pans autour d'une ligne de faîtage libre (correction visuelle v2, `kind: "gable"`), sans Three.js.
 * Hauteur en (x, z) : ridgeM − tan(pente du côté) × distance horizontale à la ligne. Chaque pan est la
 * partie de l'emprise élargie du débord située d'un côté de la ligne. Les murs montent jusqu'au pan
 * (fonction `topAt` de walls()) ; un mur que la ligne coupe reçoit en plus le triangle de pignon au-dessus
 * de la droite qui joint ses deux angles. La ligne doit couper le contour exactement deux fois (deux pans
 * d'un seul tenant) : sinon `null` et toit historique. Légers rentrants admis (triangulation par oreilles).
 */
import * as THREE from 'three';
import type { GableVisualCorrection } from '@allezrobert/shared/building-visual';
import type { RoofMesh } from './roofs.ts';

export interface GableRoof {
  /** Pans : triangles (x, y, z), normales vers le haut ; uv = (le long du faîtage, distance dans la pente depuis l'égout). */
  roof: RoofMesh;
  /** Triangles de pignon au-dessus des murs droits ; uv = (le long du mur, hauteur au-dessus du mur + 3), comme roofBuffers. */
  gables: RoofMesh;
  /** Hauteur du toit au droit d'un point (altitude absolue). */
  at: (x: number, z: number) => number;
  /** Égout le plus bas au droit des angles de l'emprise (absolu). */
  eaveMin: number;
  ridgeM: number;
}

const rad = Math.PI / 180;
type P = [number, number];

/** Ligne de faîtage absolue : relative au premier sommet de l'emprise (contrat v2). */
export function gableSurface(pts: readonly number[], c: GableVisualCorrection) {
  const x1 = pts[0]! + c.ridge[0], z1 = pts[1]! + c.ridge[1];
  const x2 = pts[0]! + c.ridge[2], z2 = pts[1]! + c.ridge[3];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
  const tl = Math.tan(c.pitchLeftDeg * rad), tr = Math.tan(c.pitchRightDeg * rad);
  /** Distance signée à la ligne : négative à gauche (convention du contrat). */
  const side = (x: number, z: number) => dx * (z - z1) - dz * (x - x1);
  const along = (x: number, z: number) => dx * (x - x1) + dz * (z - z1);
  const at = (x: number, z: number) => { const s = side(x, z); return c.ridgeM - (s < 0 ? tl : tr) * Math.abs(s); };
  return { side, along, at, tl, tr };
}

function ring(pts: readonly number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push([pts[i]!, pts[i + 1]!]);
  return out;
}

function area(poly: readonly P[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Nombre de traversées du contour par la ligne (prolongée) de faîtage. */
export function ridgeCrossings(poly: readonly P[], side: (x: number, z: number) => number): number {
  let n = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if (side(a[0], a[1]) < 0 !== side(b[0], b[1]) < 0) n++;
  }
  return n;
}

/** Décalage en onglet de chaque arête vers l'extérieur de d (emprise convexe ou à légers rentrants). */
function offset(poly: readonly P[], d: number): P[] {
  const s = area(poly) > 0 ? 1 : -1;
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Normale extérieure : à droite de l'arête pour un anneau positif (x est, z sud).
    const nx = (s * (b[1] - a[1])) / l, nz = (-s * (b[0] - a[0])) / l;
    return [a[0] + nx * d, a[1] + nz * d, b[0] - a[0], b[1] - a[1]] as const;
  });
  return poly.map((a, i) => {
    const p = lines[(i + n - 1) % n]!, q = lines[i]!;
    const den = p[2] * q[3] - p[3] * q[2];
    if (Math.abs(den) < 1e-9) return [q[0], q[1]] as P;
    const t = ((q[0] - p[0]) * q[3] - (q[1] - p[1]) * q[2]) / den;
    return [p[0] + p[2] * t, p[1] + p[3] * t] as P;
  });
}

function clip(poly: readonly P[], side: (x: number, z: number) => number, left: boolean): P[] {
  const out: P[] = [];
  const keep = (p: P) => (left ? side(p[0], p[1]) <= 0 : side(p[0], p[1]) >= 0);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ka = keep(a), kb = keep(b);
    if (ka) out.push(a);
    if (ka !== kb) {
      const sa = side(a[0], a[1]), sb = side(b[0], b[1]);
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function gableRoof(pts: readonly number[], c: GableVisualCorrection, overhang: number): GableRoof | null {
  const poly = ring(pts);
  if (poly.length < 3 || Math.abs(area(poly)) < 1e-6) return null;
  const { side, along, at, tl, tr } = gableSurface(pts, c);
  const eave = offset(poly, overhang);
  if (ridgeCrossings(poly, side) !== 2 || ridgeCrossings(eave, side) !== 2) return null;
  const roof: RoofMesh = { pos: [], uv: [] };
  for (const left of [true, false]) {
    const pan = clip(eave, side, left);
    if (pan.length < 3) continue;
    const cos = Math.cos(Math.atan(left ? tl : tr));
    const reach = Math.max(...pan.map((p) => Math.abs(side(p[0], p[1]))));
    const vtx = pan.map((p) => ({ x: p[0], z: p[1], y: at(p[0], p[1]), u: along(p[0], p[1]), v: (reach - Math.abs(side(p[0], p[1]))) / cos }));
    const tris = THREE.ShapeUtils.triangulateShape(pan.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [i0, i1, i2] of tris) {
      const a = vtx[i0!]!, b = vtx[i1!]!, d = vtx[i2!]!;
      const ny = (b.z - a.z) * (d.x - a.x) - (b.x - a.x) * (d.z - a.z);
      for (const q of ny < 0 ? [a, d, b] : [a, b, d]) {
        roof.pos.push(q.x, q.y, q.z);
        roof.uv.push(q.u, q.v);
      }
    }
  }
  const gables: RoofMesh = { pos: [], uv: [] };
  let eaveMin = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ya = at(a[0], a[1]), yb = at(b[0], b[1]);
    eaveMin = Math.min(eaveMin, ya);
    const sa = side(a[0], a[1]), sb = side(b[0], b[1]);
    if (!((sa < 0 && sb > 0) || (sa > 0 && sb < 0))) continue;
    const t = sa / (sa - sb);
    const m: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const line = ya + (yb - ya) * t;
    // Triangle vu des deux côtés par le matériau des murs (double face) : l'ordre importe peu.
    gables.pos.push(a[0], ya, a[1], m[0], at(m[0], m[1]), m[1], b[0], yb, b[1]);
    gables.uv.push(0, 3, len * t, at(m[0], m[1]) - line + 3, len, 3);
  }
  return { roof, gables, at, eaveMin, ridgeM: c.ridgeM };
}
