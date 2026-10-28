import * as THREE from 'three/webgpu';

/**
 * Corps du cycliste low poly d'un seul tenant (par défaut ; `?corps=prismes` pour l'ancien, voir lowPolyRider.ts) : tronc, jambes
 * et bras sont des tubes balayés le long des articulations, dont la section (demi-largeur, avant, arrière)
 * suit des stations — hanches, mollets, épaules — et dont la couleur change net aux bords du cuissard, des
 * manches, des chaussettes et des bandes du maillot (anneaux doublés). Un maillage squeletté de 10 os,
 * réorienté à chaque image d'après les articulations calculées par lowPolyRider.ts. Environ 750 triangles,
 * à facettes, une couleur par sommet : un seul appel de dessin pour le corps.
 * Inspiré du principe du corps de Veloworld (tubes à section musculaire sur un squelette plat), réécrit ici.
 */

/** Os : 0 bassin, 1 buste, 2/3 cuisse/tibia gauche, 4/5 droite, 6/7 bras/avant-bras gauche, 8/9 droite. */
const BONES = 10;
const SIDES = 8;
const LEFT = new THREE.Vector3(1, 0, 0);

export interface BodyJoints {
  /** Tronc : bas du bassin (sur la selle), bassin, milieu du dos, épaules, base du cou. */
  seat: THREE.Vector3;
  hip: THREE.Vector3;
  mid: THREE.Vector3;
  shoulder: THREE.Vector3;
  neck: THREE.Vector3;
  /** Gauche (côté +x) puis droite. */
  legs: Array<{ hip: THREE.Vector3; knee: THREE.Vector3; ankle: THREE.Vector3 }>;
  arms: Array<{ sh: THREE.Vector3; el: THREE.Vector3; wr: THREE.Vector3 }>;
}

export function makeJoints(): BodyJoints {
  const v = () => new THREE.Vector3();
  return {
    seat: v(),
    hip: v(),
    mid: v(),
    shoulder: v(),
    neck: v(),
    legs: [0, 1].map(() => ({ hip: v(), knee: v(), ankle: v() })),
    arms: [0, 1].map(() => ({ sh: v(), el: v(), wr: v() })),
  };
}

export interface BodyLook {
  jersey: THREE.Color;
  accent: THREE.Color;
  shorts: THREE.Color;
  skin: THREE.Color;
  sock: THREE.Color;
  /** Bandes de poitrine (fractions du buste milieu du dos → épaules) et leur couleur. */
  bands: Array<{ from: number; to: number; color: THREE.Color }>;
  /** Moitié basse du maillot à la couleur d'accent ; manches à la couleur d'accent. */
  lowerHalf: boolean;
  accentSleeves: boolean;
  longLegs: boolean;
  longSleeves: boolean;
  /** Hauteur des chaussettes au-dessus de la cheville (m). */
  sockLen: number;
  build: number;
  female: boolean;
}

/** Station d'un tube : position (fraction de la longueur), section et poids des os. */
interface Key {
  t: number;
  /** Demi-largeur (x), rayon côté `ez` et côté opposé. */
  w: number;
  p: number;
  n: number;
  bones: Array<[number, number]>;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  bone.position.copy(from);
  _y.subVectors(to, from).normalize();
  _x.copy(LEFT).addScaledVector(_y, -LEFT.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1);
  _x.normalize();
  _z.crossVectors(_x, _y);
  bone.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly index: number[] = [];

  private vertex(p: THREE.Vector3, c: THREE.Color, bones: Array<[number, number]>): number {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    const b = [...bones].sort((a, z) => z[1] - a[1]).slice(0, 4);
    const sum = b.reduce((s, x) => s + x[1], 0) || 1;
    for (let i = 0; i < 4; i++) {
      this.si.push(b[i]?.[0] ?? 0);
      this.sw.push((b[i]?.[1] ?? 0) / sum);
    }
    return this.pos.length / 3 - 1;
  }

  /**
   * Tube le long de `pts` : `keys` donnent la section (interpolée linéairement), `colorAt(t)` la couleur ;
   * `edges` : positions où la couleur change, doublées pour un bord net. Bouts fermés en éventail.
   */
  tube(pts: THREE.Vector3[], keys: Key[], colorAt: (t: number) => THREE.Color, edges: number[], scale: number): void {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3));
    const total = cum[cum.length - 1] as number;
    const at = (t: number, out: THREE.Vector3, tan: THREE.Vector3) => {
      const d = t * total;
      let i = 0;
      while (i < pts.length - 2 && d > (cum[i + 1] as number)) i++;
      const a = pts[i] as THREE.Vector3;
      const b = pts[i + 1] as THREE.Vector3;
      const u = Math.min(1, Math.max(0, (d - (cum[i] as number)) / Math.max(1e-6, (cum[i + 1] as number) - (cum[i] as number))));
      out.lerpVectors(a, b, u);
      tan.subVectors(b, a).normalize();
      // tangente adoucie aux articulations (moyenne avec le segment voisin)
      if (u < 0.15 && i > 0) tan.add(_z.subVectors(a, pts[i - 1] as THREE.Vector3).normalize()).normalize();
      else if (u > 0.85 && i < pts.length - 2) tan.add(_z.subVectors(pts[i + 2] as THREE.Vector3, b).normalize()).normalize();
    };
    const keyAt = (t: number): Key => {
      let i = 0;
      while (i < keys.length - 2 && t > (keys[i + 1] as Key).t) i++;
      const A = keys[i] as Key;
      const B = keys[i + 1] as Key;
      const u = Math.min(1, Math.max(0, (t - A.t) / Math.max(1e-6, B.t - A.t)));
      const bones = new Map<number, number>();
      for (const [b, w] of A.bones) bones.set(b, (bones.get(b) ?? 0) + w * (1 - u));
      for (const [b, w] of B.bones) bones.set(b, (bones.get(b) ?? 0) + w * u);
      return { t, w: A.w + (B.w - A.w) * u, p: A.p + (B.p - A.p) * u, n: A.n + (B.n - A.n) * u, bones: [...bones] };
    };
    // Anneaux : stations, plus un anneau de chaque côté de chaque changement de couleur.
    const rings: Array<{ t: number; c: THREE.Color }> = [];
    for (const k of keys) rings.push({ t: k.t, c: colorAt(k.t) });
    for (const e of edges) rings.push({ t: e, c: colorAt(e - 1e-4) }, { t: e + 1e-6, c: colorAt(e + 1e-4) });
    rings.sort((a, b) => a.t - b.t);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const ex = new THREE.Vector3();
    const ez = new THREE.Vector3();
    const v = new THREE.Vector3();
    let prev: number[] | null = null;
    let first: number[] | null = null;
    let firstC: THREE.Vector3 | null = null;
    let last: { row: number[]; c: THREE.Vector3; k: Key; color: THREE.Color } | null = null;
    for (const r of rings) {
      at(r.t, p, tan);
      const k = keyAt(r.t);
      ex.copy(LEFT).addScaledVector(tan, -LEFT.dot(tan));
      if (ex.lengthSq() < 1e-8) ex.set(0, 0, 1);
      ex.normalize();
      ez.crossVectors(ex, tan);
      const row: number[] = [];
      for (let j = 0; j < SIDES; j++) {
        // un demi-pan de décalage : faces planes devant, derrière et sur les côtés
        const phi = ((j + 0.5) / SIDES) * Math.PI * 2;
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        v.copy(p).addScaledVector(ex, c * k.w * scale).addScaledVector(ez, s * (s >= 0 ? k.p : k.n) * scale);
        row.push(this.vertex(v, r.c, k.bones));
      }
      if (prev) for (let j = 0; j < SIDES; j++) {
        const j1 = (j + 1) % SIDES;
        this.index.push(prev[j] as number, row[j] as number, prev[j1] as number, prev[j1] as number, row[j] as number, row[j1] as number);
      }
      if (!first) {
        first = row;
        firstC = p.clone();
      }
      prev = row;
      last = { row, c: p.clone(), k, color: r.c };
    }
    // Bouts fermés (éventail autour du centre).
    const cap = (row: number[], centre: THREE.Vector3, k: Key, c: THREE.Color, flip: boolean) => {
      const ci = this.vertex(centre, c, k.bones);
      for (let j = 0; j < SIDES; j++) {
        const j1 = (j + 1) % SIDES;
        if (flip) this.index.push(ci, row[j1] as number, row[j] as number);
        else this.index.push(ci, row[j] as number, row[j1] as number);
      }
    };
    if (first && firstC) cap(first, firstC, keyAt(0), colorAt(0), false);
    if (last) cap(last.row, last.c, last.k, last.color, true);
  }
}

export class SweptBody {
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[];

  constructor(rest: BodyJoints, look: BodyLook) {
    const b = new Builder();
    const s = look.build;
    // ── Tronc : selle → bassin → milieu du dos → épaules → base du cou ──
    const trunkPts = [rest.seat, rest.hip, rest.mid, rest.shoulder, rest.neck];
    const tr = fractions(trunkPts);
    const T = (i: number, f: number) => (tr[i] as number) + f * ((tr[i + 1] ?? 1) - (tr[i] as number));
    const chest = look.female ? 0.9 : 1;
    const hips = look.female ? 1.05 : 1;
    // Fessier : posé à plat sur la selle, large et rebondi vers l'arrière (n), qui couvre le haut des cuisses vu
    // de dos ; il rejoint le bassin à la ceinture.
    const trunkKeys: Key[] = [
      { t: 0, w: 0.11 * hips, p: 0.07, n: 0.065, bones: [[0, 1]] },
      { t: T(0, 0.35), w: 0.155 * hips, p: 0.09, n: 0.1, bones: [[0, 1]] },
      { t: T(0, 0.75), w: 0.16 * hips, p: 0.1, n: 0.1, bones: [[0, 1]] },
      { t: T(1, 0), w: 0.152 * hips, p: 0.1, n: 0.095, bones: [[0, 1]] },
      { t: T(1, 0.5), w: 0.138, p: 0.09, n: 0.09, bones: [[0, 1]] },
      { t: T(2, 0), w: 0.135, p: 0.085, n: 0.085, bones: [[0, 0.5], [1, 0.5]] },
      { t: T(2, 0.45), w: 0.15 * chest, p: 0.095, n: 0.095, bones: [[1, 1]] },
      { t: T(2, 0.8), w: 0.168 * chest, p: 0.105, n: 0.1, bones: [[1, 1]] },
      { t: T(3, 0), w: 0.145 * chest, p: 0.07, n: 0.075, bones: [[1, 1]] },
      { t: T(3, 0.6), w: 0.066, p: 0.05, n: 0.05, bones: [[1, 1]] },
      { t: 1, w: 0.055, p: 0.046, n: 0.046, bones: [[1, 1]] },
    ];
    const hem = T(1, 0.45);
    const collar = T(3, 0.55);
    const B = (f: number) => T(2, 0) + f * (T(3, 0) - T(2, 0));
    const trunkEdges = [hem, collar];
    for (const band of look.bands) trunkEdges.push(B(band.from), B(band.to));
    const midT = T(2, 0);
    if (look.lowerHalf) trunkEdges.push(midT);
    b.tube(
      trunkPts,
      trunkKeys,
      (t) => {
        if (t < hem) return look.shorts;
        if (t > collar) return look.accent;
        for (const band of look.bands) if (t > B(band.from) && t < B(band.to)) return band.color;
        if (look.lowerHalf && t < midT) return look.accent;
        return look.jersey;
      },
      trunkEdges,
      s,
    );
    // ── Jambes : haut de cuisse → hanche → genou → cheville ──
    rest.legs.forEach((g, i) => {
      const side = i === 0 ? 1 : -1;
      const thigh = 2 + i * 2;
      const shin = thigh + 1;
      const pts = [g.hip.clone().add(new THREE.Vector3(-side * 0.02, 0.06, -0.01)), g.hip, g.knee, g.ankle];
      const fr = fractions(pts);
      const L = (k: number, f: number) => (fr[k] as number) + f * ((fr[k + 1] ?? 1) - (fr[k] as number));
      const total = length(pts);
      const keys: Key[] = [
        { t: 0, w: 0.07, p: 0.075, n: 0.07, bones: [[0, 1]] },
        { t: L(1, 0), w: 0.085, p: 0.088, n: 0.085, bones: [[0, 0.4], [thigh, 0.6]] },
        { t: L(1, 0.3), w: 0.08, p: 0.08, n: 0.085, bones: [[thigh, 1]] },
        { t: L(1, 0.65), w: 0.068, p: 0.066, n: 0.075, bones: [[thigh, 1]] },
        { t: L(2, 0), w: 0.05, p: 0.047, n: 0.053, bones: [[thigh, 0.5], [shin, 0.5]] },
        { t: L(2, 0.25), w: 0.046, p: 0.062, n: 0.044, bones: [[shin, 1]] },
        { t: L(2, 0.55), w: 0.04, p: 0.05, n: 0.037, bones: [[shin, 1]] },
        { t: 1, w: 0.029, p: 0.031, n: 0.03, bones: [[shin, 1]] },
      ];
      const shortsEnd = L(1, 0.8);
      const sockStart = Math.max(L(2, 0.3), 1 - look.sockLen / total);
      b.tube(
        pts,
        keys,
        (t) => (t < shortsEnd || look.longLegs ? look.shorts : t >= sockStart ? look.sock : look.skin),
        look.longLegs ? [] : [shortsEnd, sockStart],
        s,
      );
    });
    // ── Bras : haut de l'épaule → épaule → coude → poignet ──
    rest.arms.forEach((g, i) => {
      const side = i === 0 ? 1 : -1;
      const upper = 6 + i * 2;
      const fore = upper + 1;
      const pts = [g.sh.clone().add(new THREE.Vector3(-side * 0.03, 0.02, 0)), g.sh, g.el, g.wr];
      const fr = fractions(pts);
      const A = (k: number, f: number) => (fr[k] as number) + f * ((fr[k + 1] ?? 1) - (fr[k] as number));
      const keys: Key[] = [
        { t: 0, w: 0.05, p: 0.05, n: 0.05, bones: [[1, 1]] },
        { t: A(1, 0), w: 0.062, p: 0.06, n: 0.064, bones: [[1, 0.4], [upper, 0.6]] },
        { t: A(1, 0.35), w: 0.053, p: 0.052, n: 0.053, bones: [[upper, 1]] },
        { t: A(1, 0.75), w: 0.045, p: 0.044, n: 0.046, bones: [[upper, 1]] },
        { t: A(2, 0), w: 0.038, p: 0.038, n: 0.038, bones: [[upper, 0.5], [fore, 0.5]] },
        { t: A(2, 0.3), w: 0.042, p: 0.04, n: 0.041, bones: [[fore, 1]] },
        { t: 1, w: 0.027, p: 0.024, n: 0.025, bones: [[fore, 1]] },
      ];
      const sleeve = look.accentSleeves ? look.accent : look.jersey;
      const cuffA = look.longSleeves ? A(2, 0.78) : A(1, 0.5);
      const cuffB = look.longSleeves ? A(2, 0.9) : A(1, 0.6);
      b.tube(
        pts,
        keys,
        (t) => (t < cuffA ? sleeve : t < cuffB ? (look.accentSleeves ? look.jersey : look.accent) : look.longSleeves ? sleeve : look.skin),
        [cuffA, cuffB],
        s,
      );
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
    geo.setIndex(b.index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    mat.flatShading = true;
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.bones = Array.from({ length: BONES }, () => new THREE.Bone());
    this.mesh.add(...this.bones);
    this.pose(rest);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
  }

  /** Oriente les os sur les articulations de l'image. */
  pose(J: BodyJoints): void {
    const b = this.bones;
    aim(b[0] as THREE.Bone, J.hip, J.mid);
    aim(b[1] as THREE.Bone, J.mid, J.shoulder);
    J.legs.forEach((g, i) => {
      aim(b[2 + i * 2] as THREE.Bone, g.hip, g.knee);
      aim(b[3 + i * 2] as THREE.Bone, g.knee, g.ankle);
    });
    J.arms.forEach((g, i) => {
      aim(b[6 + i * 2] as THREE.Bone, g.sh, g.el);
      aim(b[7 + i * 2] as THREE.Bone, g.el, g.wr);
    });
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function length(pts: THREE.Vector3[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3);
  return d;
}

/** Position (0–1) de chaque point le long de la polyligne. */
function fractions(pts: THREE.Vector3[]): number[] {
  const total = length(pts) || 1;
  const out = [0];
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3);
    out.push(d / total);
  }
  return out;
}
