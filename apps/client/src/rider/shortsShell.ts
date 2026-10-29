import * as THREE from 'three/webgpu';
import type { BodyJoints } from './sweptBody.ts';

/**
 * Coque « cuissard » du corps low poly (sweptBody.ts) : bassin, taille et haut des deux cuisses d'un seul
 * tenant, à la place du fessier en bloc et des tubes de cuisse qui s'y croisaient (marche au bas du dos,
 * encoche en haut des cuisses, fond plat). La forme est une union adoucie de volumes simples — fessier
 * (ellipsoïde dissymétrique, fond dans la selle), taille (capsule ovale le long du bas du dos), cuisses
 * (capsules effilées qui rentrent à mi-cuisse dans le tube de la cuisse, sans bord) — coupée sous l'ourlet
 * du maillot, puis
 * mise en facettes par « surface nets » (pas de grille SHELL_CELL) et un peu lissée : même aspect à facettes
 * que le reste.
 * Chaque sommet est lié au bassin, au buste et à sa cuisse selon sa place (os de sweptBody.ts).
 */

/** Pas de la grille (m) : taille des facettes. */
const SHELL_CELL = 0.03;
/** Lissage des sommets (passes, part du déplacement vers la moyenne des voisins) : facettes régulières. */
const SMOOTH_PASSES = 2;
const SMOOTH_K = 0.5;
/** Rayon d'adoucissement des unions (m) : pas d'arête entre fessier, taille et cuisses. */
const BLEND = 0.04;

export interface ShellParams {
  /** Ourlet du maillot (repos) : la coque s'arrête un peu au-dessus, sous le maillot. */
  hemP: THREE.Vector3;
  /**
   * Fraction de la cuisse (hanche → genou) où la coque s'enfonce dans le tube de la cuisse : elle ne fait
   * que la jonction avec le fessier (le tube porte la couleur et l'ourlet du cuissard), sans bord visible.
   */
  thighEnd: number;
  /** Corpulence (échelle des sections) et bassin féminin (plus large). */
  scale: number;
  female: boolean;
}

export interface ShellVertex {
  p: THREE.Vector3;
  bones: Array<[number, number]>;
}

const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance (approchée) à une capsule a → b de rayons ra → rb, section ovale (x étiré par `sx`). */
function capsule(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sx: number, tmp: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2));
  tmp.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  const dx = (p.x - tmp.x) / sx;
  const dy = p.y - tmp.y;
  const dz = p.z - tmp.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}

/**
 * Coque au repos : sommets (avec leurs os) et triangles. `rest` : articulations au repos (assis), comme
 * pour les tubes de sweptBody.ts ; os 0 bassin, 1 buste, 2 cuisse gauche, 4 cuisse droite.
 */
export function shortsShell(rest: BodyJoints, P: ShellParams): { vertices: ShellVertex[]; index: number[] } {
  const H = rest.hip;
  const s = P.scale;
  const hips = P.female ? 1.05 : 1;
  const up = new THREE.Vector3().subVectors(rest.mid, H).normalize();
  // Fessier : centre un peu sous et derrière le bassin, fond dans l'épaisseur de la selle ; plus profond
  // derrière (fesses) que devant (bas-ventre), plus haut que bas.
  const gC = H.clone().add(new THREE.Vector3(0, -0.012, -0.02));
  const gR = { x: 0.145 * hips * s, up: 0.08 * s, down: 0.07 * s, front: 0.078 * s, back: 0.088 * s };
  // Taille : capsule ovale le long du bas du dos, jusqu'au-dessus de l'ourlet du maillot.
  const top = P.hemP.clone().addScaledVector(up, 0.02);
  const waistR = 0.083 * s;
  const waistSx = (0.13 * hips) / 0.083;
  // Cuisses : du cœur du fessier à l'ourlet du cuissard, rayon effilé.
  const legs = rest.legs.map((g, i) => {
    const side = i === 0 ? 1 : -1;
    const a = g.hip.clone().add(new THREE.Vector3(-side * 0.02, 0.015, -0.015));
    const hem = g.hip.clone().lerp(g.knee, P.thighEnd);
    const dir = new THREE.Vector3().subVectors(g.knee, g.hip).normalize();
    return { side, a, hem, dir, hip: g.hip, len: g.hip.distanceTo(g.knee), bone: 2 + i * 2 };
  });
  const tmp = new THREE.Vector3();
  const q = new THREE.Vector3();
  const sdf = (p: THREE.Vector3): number => {
    // Fessier : ellipsoïde dissymétrique (distance approchée).
    q.subVectors(p, gC);
    const ex = q.x / gR.x;
    const ey = q.y / (q.y > 0 ? gR.up : gR.down);
    const ez = q.z / (q.z > 0 ? gR.front : gR.back);
    let d = (Math.sqrt(ex * ex + ey * ey + ez * ez) - 1) * Math.min(gR.down, gR.front);
    d = smin(d, capsule(p, H, top, waistR, waistR * 0.96, waistSx, tmp), BLEND);
    // Cuisses : rayon qui finit sous celui du tube de la cuisse (≈ 7,2 cm à mi-cuisse) : la coque y rentre.
    for (const L of legs) d = smin(d, capsule(p, L.a, L.hem, 0.09 * s, 0.062 * s, 1, tmp), BLEND);
    // Coupe sous le maillot (plan de la taille) ; les cuisses finissent arrondies dans leur tube.
    d = Math.max(d, q.subVectors(p, top).dot(up));
    return d;
  };

  // Grille autour du bassin et des deux cuisses.
  const box = new THREE.Box3().expandByPoint(gC).expandByPoint(top);
  for (const L of legs) box.expandByPoint(L.a).expandByPoint(L.hem);
  box.expandByScalar(0.17);
  const n = box.getSize(new THREE.Vector3()).divideScalar(SHELL_CELL).ceil();
  const nx = n.x;
  const ny = n.y;
  const nz = n.z;
  const at = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
  const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const p = new THREE.Vector3();
  for (let k = 0; k <= nz; k++)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) field[at(i, j, k)] = sdf(p.set(box.min.x + i * SHELL_CELL, box.min.y + j * SHELL_CELL, box.min.z + k * SHELL_CELL));

  // Surface nets : un sommet par cellule traversée (moyenne des points de passage sur ses arêtes).
  const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const cell = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const vertices: ShellVertex[] = [];
  const val = new Float32Array(8);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c] as readonly [number, number, number];
          val[c] = field[at(i + o[0], j + o[1], k + o[2])] as number;
          if ((val[c] as number) < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        const v = new THREE.Vector3();
        let m = 0;
        for (const [a, b] of EDGES) {
          const va = val[a] as number;
          const vb = val[b] as number;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = CORNERS[a] as readonly number[];
          const ob = CORNERS[b] as readonly number[];
          v.x += i + (oa[0] as number) + ((ob[0] as number) - (oa[0] as number)) * t;
          v.y += j + (oa[1] as number) + ((ob[1] as number) - (oa[1] as number)) * t;
          v.z += k + (oa[2] as number) + ((ob[2] as number) - (oa[2] as number)) * t;
          m++;
        }
        v.divideScalar(m).multiplyScalar(SHELL_CELL).add(box.min);
        cellVertex[cell(i, j, k)] = vertices.length;
        vertices.push({ p: v, bones: weights(v) });
      }

  // Faces : une par arête de la grille traversée par la surface (quatre cellules autour).
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = (field[at(i, j, k)] as number) < 0;
        if (a === (field[at(i + 1, j, k)] as number) < 0) continue;
        quad(cellVertex[cell(i, j - 1, k - 1)] as number, cellVertex[cell(i, j, k - 1)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i, j - 1, k)] as number, a);
      }
  for (let k = 1; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const a = (field[at(i, j, k)] as number) < 0;
        if (a === (field[at(i, j + 1, k)] as number) < 0) continue;
        quad(cellVertex[cell(i - 1, j, k - 1)] as number, cellVertex[cell(i - 1, j, k)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i, j, k - 1)] as number, a);
      }
  for (let k = 0; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const a = (field[at(i, j, k)] as number) < 0;
        if (a === (field[at(i, j, k + 1)] as number) < 0) continue;
        quad(cellVertex[cell(i - 1, j - 1, k)] as number, cellVertex[cell(i, j - 1, k)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i - 1, j, k)] as number, a);
      }
  // Lissage : chaque sommet glisse vers la moyenne de ses voisins (facettes régulières, pas de froissé).
  const near: Array<Set<number>> = vertices.map(() => new Set());
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number;
    const b = index[t + 1] as number;
    const c = index[t + 2] as number;
    near[a]?.add(b).add(c);
    near[b]?.add(a).add(c);
    near[c]?.add(a).add(b);
  }
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const avg = vertices.map((v, i) => {
      const m = new THREE.Vector3();
      const ns = near[i] as Set<number>;
      if (!ns.size) return v.p.clone();
      for (const j of ns) m.add((vertices[j] as ShellVertex).p);
      return m.divideScalar(ns.size);
    });
    vertices.forEach((v, i) => v.p.lerp(avg[i] as THREE.Vector3, SMOOTH_K));
  }
  return { vertices, index };

  /** Os d'un sommet : sa cuisse le long du cuissard (pas à l'entrejambe), le buste en haut de la taille, le bassin ailleurs. */
  function weights(v: THREE.Vector3): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let left = 1;
    for (const L of legs) {
      const along = q.subVectors(v, L.hip).dot(L.dir) / L.len;
      const w = smooth(0.02, 0.38, along) * smooth(-0.005, 0.045, v.x * L.side);
      if (w > 0) {
        out.push([L.bone, w * left]);
        left -= w * left;
      }
    }
    const h = q.subVectors(v, H).dot(up);
    const wb = 0.55 * smooth(0.02, 0.13, h) * left;
    if (wb > 0) out.push([1, wb]);
    out.push([0, left - wb]);
    return out;
  }
}
