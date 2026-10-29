import * as THREE from 'three/webgpu';
import { attribute, mix } from 'three/tsl';
import type { AvatarLook } from '@allezrobert/shared';
import { jerseyPattern } from './jerseyPattern.ts';
import { shortsShell } from './shortsShell.ts';

/**
 * Corps du cycliste low poly d'un seul tenant (par défaut ; `?corps=prismes` pour l'ancien, voir lowPolyRider.ts) : tronc, jambes
 * et bras sont des tubes balayés le long des articulations, dont la section (demi-largeur, avant, arrière)
 * suit des stations — hanches, mollets, épaules — et dont la couleur change net aux bords du cuissard, des
 * manches, des chaussettes et des bandes du maillot (anneaux doublés). Un maillage squeletté de 10 os,
 * réorienté à chaque image d'après les articulations calculées par lowPolyRider.ts. Environ 750 triangles,
 * à facettes, une couleur par sommet : un seul appel de dessin pour le corps.
 * Inspiré du principe du corps de Veloworld (tubes à section musculaire sur un squelette plat), réécrit ici.
 */

/** Coque du cuissard (shortsShell.ts) ; ?coque=0 : ancien fessier en bloc (comparaison). */
const SHELL = (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('coque')) !== '0';

/** Genou : chevauchement de la cuisse et du tibia au-delà de l'articulation, rayon et avancée du bloc de genou (m). */
const KNEE_OVERLAP = 0.03;
const KNEE_R = 0.052;
const KNEE_FORWARD = 0.012;

/** Ourlet du cuissard : fraction de la cuisse (hanche → genou). */
const SHORTS_END = 0.8;

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
  /** 0 : bassin vertical sur le vélo (assis) ; 1 : bassin dans la ligne du buste (danseuse). */
  pelvisFollow?: number;
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
  /**
   * Motifs du maillot dessinés dans le shader (pois, dégradé, chevrons, logo : jerseyPattern.ts, les mêmes
   * que l'avatar réaliste) ; les aplats (bandes, manches, moitié) restent des couleurs de sommets.
   */
  pattern?: AvatarLook;
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
const _mid = new THREE.Vector3();
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  bone.position.copy(from);
  _y.subVectors(to, from).normalize();
  _x.copy(LEFT).addScaledVector(_y, -LEFT.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1);
  _x.normalize();
  _z.crossVectors(_x, _y);
  bone.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/** Point (et tangente adoucie aux articulations) à la fraction t de la longueur d'une polyligne. */
function pathSampler(pts: THREE.Vector3[]): (t: number, out: THREE.Vector3, tan: THREE.Vector3) => void {
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
  return at;
}

/** Section interpolée (rayons et os) à la fraction t d'un tube. */
function keySampler(keys: Key[]): (t: number) => Key {
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
  return keyAt;
}

class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  /** 1 sur le tissu du maillot (motifs), 0 ailleurs (peau, cuissard, col, liserés). */
  readonly mask: number[] = [];
  readonly index: number[] = [];

  vertex(p: THREE.Vector3, c: THREE.Color, bones: Array<[number, number]>, m = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.mask.push(m);
    const b = [...bones].sort((a, z) => z[1] - a[1]).slice(0, 4);
    const sum = b.reduce((s, x) => s + x[1], 0) || 1;
    for (let i = 0; i < 4; i++) {
      this.si.push(b[i]?.[0] ?? 0);
      this.sw.push((b[i]?.[1] ?? 0) / sum);
    }
    return this.pos.length / 3 - 1;
  }

  /**
   * Poches arrière du maillot, devinées à leurs traits : une poche par pan du dos du tube `pts` / `keys`
   * (pans arrière de l'octogone, entre `t0` et `t1`), sans relief ni tissu à part — trait sombre de
   * l'ouverture en haut (hauteur `lip`), coutures fines sur les bords des pans ; traits plaqués 1,5 mm devant
   * le dos pour ne pas scintiller.
   */
  pockets(pts: THREE.Vector3[], keys: Key[], scale: number, t0: number, t1: number, lip: number, colorAt: (t: number) => THREE.Color): void {
    const at = pathSampler(pts);
    const keyAt = keySampler(keys);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const ex = new THREE.Vector3();
    const ez = new THREE.Vector3();
    /** Sommet `j` (bord de pan) de l'anneau à t, décalé vers l'extérieur de `out` (m). */
    const corner = (t: number, phi: number, out: number): THREE.Vector3 => {
      at(t, p, tan);
      const k = keyAt(t);
      ex.copy(LEFT).addScaledVector(tan, -LEFT.dot(tan));
      if (ex.lengthSq() < 1e-8) ex.set(0, 0, 1);
      ex.normalize();
      ez.crossVectors(ex, tan);
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const v = p.clone().addScaledVector(ex, c * k.w * scale).addScaledVector(ez, sn * (sn >= 0 ? k.p : k.n) * scale);
      return v.addScaledVector(v.clone().sub(p).normalize(), out);
    };
    const shade = (c: THREE.Color, k: number) => new THREE.Color(c.r * k, c.g * k, c.b * k);
    /** Trait : bande de t = ta à tb entre les angles fa et fb (sur un même pan), plaquée sur le dos. */
    const stroke = (ta: number, tb: number, fa: number, fb: number, k: number): void => {
      const ids = [ta, tb].map((t) => {
        const col = shade(colorAt(t), k);
        const bones = keyAt(t).bones;
        return [this.vertex(corner(t, fa, 0.0015 * scale), col, bones), this.vertex(corner(t, fb, 0.0015 * scale), col, bones)];
      });
      const [q0, q1] = ids[0] as number[];
      const [q2, q3] = ids[1] as number[];
      this.index.push(q0 as number, q2 as number, q1 as number, q1 as number, q2 as number, q3 as number);
    };
    // Pans arrière : entre les sommets 4–5, 5–6 et 6–7 (sin < 0 : côté dos). Une poche par pan, devinée à ses
    // traits : ouverture en haut, coutures sur les deux bords du pan (les poches voisines se touchent).
    for (let j = 4; j <= 6; j++) {
      const a0 = ((j + 0.5) / SIDES) * Math.PI * 2;
      const a1 = ((j + 1.5) / SIDES) * Math.PI * 2;
      const w = (a1 - a0) * 0.035;
      stroke(t1 - lip, t1, a0, a1, 0.45);
      stroke(t0, t1 - lip, a0, a0 + w, 0.62);
      stroke(t0, t1 - lip, a1 - w, a1, 0.62);
    }
  }

  /**
   * Tube le long de `pts` : `keys` donnent la section (interpolée linéairement), `colorAt(t)` la couleur ;
   * `edges` : positions où la couleur change, doublées pour un bord net. Bouts fermés en éventail.
   */
  tube(pts: THREE.Vector3[], keys: Key[], colorAt: (t: number) => THREE.Color, edges: number[], scale: number, maskAt: (t: number) => number = () => 0): void {
    const at = pathSampler(pts);
    const keyAt = keySampler(keys);
    // Anneaux : stations, plus un anneau de chaque côté de chaque changement de couleur.
    const rings: Array<{ t: number; c: THREE.Color; m: number }> = [];
    // Une station posée pile sur un changement de couleur prendrait la couleur d'un seul côté et ferait
    // un dégradé sur toute la bande voisine : les deux anneaux du bord suffisent.
    for (const k of keys) if (!edges.some((e) => Math.abs(e - k.t) < 1e-7)) rings.push({ t: k.t, c: colorAt(k.t), m: maskAt(k.t) });
    for (const e of edges) rings.push({ t: e, c: colorAt(e - 1e-4), m: maskAt(e - 1e-4) }, { t: e + 1e-6, c: colorAt(e + 1e-4), m: maskAt(e + 1e-4) });
    rings.sort((a, b) => a.t - b.t);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const ex = new THREE.Vector3();
    const ez = new THREE.Vector3();
    const v = new THREE.Vector3();
    let prev: number[] | null = null;
    let first: number[] | null = null;
    let firstC: THREE.Vector3 | null = null;
    let last: { row: number[]; c: THREE.Vector3; k: Key; color: THREE.Color; m: number } | null = null;
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
        row.push(this.vertex(v, r.c, k.bones, r.m));
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
      last = { row, c: p.clone(), k, color: r.c, m: r.m };
    }
    // Bouts fermés (éventail autour du centre).
    const cap = (row: number[], centre: THREE.Vector3, k: Key, c: THREE.Color, flip: boolean, m: number) => {
      const ci = this.vertex(centre, c, k.bones, m);
      for (let j = 0; j < SIDES; j++) {
        const j1 = (j + 1) % SIDES;
        if (flip) this.index.push(ci, row[j1] as number, row[j] as number);
        else this.index.push(ci, row[j] as number, row[j1] as number);
      }
    };
    if (first && firstC) cap(first, firstC, keyAt(0), colorAt(0), false, maskAt(0));
    if (last) cap(last.row, last.c, last.k, last.color, true, last.m);
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
    // Bas du tronc (selle → bassin) : caché sous la coque du cuissard (shortsShell.ts), qui donne seule la
    // forme du fessier, de la taille et du haut des cuisses.
    // (?coque=0 : ancien fessier en bloc, sans la coque, pour comparer.)
    const trunkKeys: Key[] = [
      ...(SHELL
        ? ([
            { t: 0, w: 0.1 * hips, p: 0.05, n: 0.06, bones: [[0, 1]] },
            { t: T(0, 0.35), w: 0.125 * hips, p: 0.065, n: 0.075, bones: [[0, 1]] },
            { t: T(0, 0.75), w: 0.125 * hips, p: 0.07, n: 0.075, bones: [[0, 1]] },
            { t: T(1, 0), w: 0.122 * hips, p: 0.072, n: 0.072, bones: [[0, 1]] },
          ] as Key[])
        : ([
            { t: 0, w: 0.158 * hips, p: 0.075, n: 0.085, bones: [[0, 1]] },
            { t: T(0, 0.35), w: 0.175 * hips, p: 0.095, n: 0.115, bones: [[0, 1]] },
            { t: T(0, 0.75), w: 0.172 * hips, p: 0.1, n: 0.11, bones: [[0, 1]] },
            { t: T(1, 0), w: 0.16 * hips, p: 0.1, n: 0.1, bones: [[0, 1]] },
          ] as Key[])),
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
    const trunkLen = length(trunkPts);
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
      (t) => (t >= hem && t <= collar ? 1 : 0),
    );
    // Trois poches arrière tout en bas du dos, juste au-dessus de l'ourlet sans le dépasser (≈ 8 cm de haut, ouverture en haut).
    const trunkColor = (t: number) => (look.lowerHalf && t < midT ? look.accent : look.jersey);
    b.pockets(trunkPts, trunkKeys, s, hem + 0.004 / trunkLen, hem + (0.085 * s) / trunkLen, 0.006 / trunkLen, trunkColor);
    // ── Jambes : deux segments rigides qui se chevauchent au genou, et un bloc de genou (rotule) ──
    // Comme les coureurs NCT : la cuisse et le tibia ne partagent aucun anneau (un tube unique se pinçait en V
    // au pli du genou) ; le bloc de genou, à moitié sur chacun, comble le pli et marque la rotule.
    rest.legs.forEach((g, i) => {
      const side = i === 0 ? 1 : -1;
      const thigh = 2 + i * 2;
      const shin = thigh + 1;
      const thighDir = new THREE.Vector3().subVectors(g.knee, g.hip).normalize();
      const shinUp = new THREE.Vector3().subVectors(g.knee, g.ankle).normalize();
      const legColor = (cover: boolean) => (cover || look.longLegs ? look.shorts : look.skin);
      // Cuisse : du cœur du fessier au genou, un peu au-delà (bout fermé caché sous le bloc de genou).
      const tPts = [g.hip.clone().add(new THREE.Vector3(-side * 0.035, 0.025, 0)), g.hip, g.knee.clone().addScaledVector(thighDir, KNEE_OVERLAP)];
      const tf = fractions(tPts);
      const LT = (f: number) => (tf[1] as number) + f * (1 - (tf[1] as number));
      const thighLen = g.hip.distanceTo(g.knee);
      const tKeys: Key[] = [
        { t: 0, w: 0.05, p: 0.06, n: 0.05, bones: [[0, 1]] },
        { t: LT(0), w: 0.076, p: 0.085, n: 0.075, bones: [[0, 0.4], [thigh, 0.6]] },
        { t: LT(0.3), w: 0.08, p: 0.08, n: 0.085, bones: [[thigh, 1]] },
        { t: LT(0.65), w: 0.068, p: 0.066, n: 0.075, bones: [[thigh, 1]] },
        { t: 1, w: 0.054, p: 0.054, n: 0.056, bones: [[thigh, 1]] },
      ];
      const shortsEnd = LT((SHORTS_END * thighLen) / (thighLen + KNEE_OVERLAP));
      b.tube(tPts, tKeys, (t) => legColor(t < shortsEnd), look.longLegs ? [] : [shortsEnd], s);
      // Tibia : d'un peu au-dessus du genou (dans la cuisse) à la cheville.
      const sPts = [g.knee.clone().addScaledVector(shinUp, KNEE_OVERLAP), g.knee, g.ankle];
      const sf = fractions(sPts);
      const LS = (f: number) => (sf[1] as number) + f * (1 - (sf[1] as number));
      const sKeys: Key[] = [
        { t: 0, w: 0.05, p: 0.054, n: 0.05, bones: [[shin, 1]] },
        { t: LS(0), w: 0.05, p: 0.05, n: 0.053, bones: [[shin, 1]] },
        { t: LS(0.25), w: 0.046, p: 0.062, n: 0.044, bones: [[shin, 1]] },
        { t: LS(0.55), w: 0.04, p: 0.05, n: 0.037, bones: [[shin, 1]] },
        { t: 1, w: 0.029, p: 0.031, n: 0.03, bones: [[shin, 1]] },
      ];
      const sockStart = Math.max(LS(0.3), 1 - look.sockLen / length(sPts));
      b.tube(sPts, sKeys, (t) => (look.longLegs ? look.shorts : t >= sockStart ? look.sock : look.skin), look.longLegs ? [] : [sockStart], s);
      // Bloc de genou : polyèdre à facettes sur l'articulation, avancé vers la pointe du genou (rotule).
      const front = thighDir.clone().add(shinUp).normalize();
      const centre = g.knee.clone().addScaledVector(front, KNEE_FORWARD * s);
      const knee = new THREE.IcosahedronGeometry(KNEE_R * s, 0);
      const kp = knee.getAttribute('position');
      const base = b.pos.length / 3;
      const v = new THREE.Vector3();
      for (let k = 0; k < kp.count; k++) b.vertex(v.fromBufferAttribute(kp, k).add(centre), legColor(false), [[thigh, 0.5], [shin, 0.5]]);
      for (let k = 0; k < kp.count; k++) b.index.push(base + k);
      knee.dispose();
    });
    // ── Cuissard : coque d'un seul tenant (bassin, taille, haut des cuisses) par-dessus les tubes ──
    if (SHELL) {
      const shell = shortsShell(rest, { hemP: pointAt(trunkPts, hem), shortsEnd: SHORTS_END, scale: s, female: look.female });
      const base = b.pos.length / 3;
      for (const v of shell.vertices) b.vertex(v.p, look.shorts, v.bones);
      for (const i of shell.index) b.index.push(base + i);
    }
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
        (t) => (t < cuffA || (t >= cuffB && look.longSleeves) ? 1 : 0),
      );
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
    geo.setIndex(b.index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: !look.pattern, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    mat.flatShading = true;
    if (look.pattern) {
      // Repère du maillot au repos (comme addJerseyFrame pour l'avatar réaliste) : y de l'ourlet vers la base du
      // cou le long du buste penché, x latéral, z vers la poitrine.
      const hemP = pointAt(trunkPts, hem);
      const ay = new THREE.Vector3().subVectors(rest.neck, hemP).setX(0).normalize();
      const az = new THREE.Vector3().crossVectors(LEFT, ay).normalize();
      const s0 = hemP.dot(ay);
      const torsoLen = rest.neck.dot(ay) - s0;
      const pos = geo.getAttribute('position');
      const nor = geo.getAttribute('normal');
      const jp = new Float32Array(pos.count * 3);
      const jn = new Float32Array(pos.count * 3);
      const q = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        q.fromBufferAttribute(pos, i);
        jp.set([q.x, q.dot(ay) - s0, q.dot(az)], i * 3);
        q.fromBufferAttribute(nor, i);
        jn.set([q.x, q.dot(ay), q.dot(az)], i * 3);
      }
      geo.setAttribute('jpos', new THREE.BufferAttribute(jp, 3));
      geo.setAttribute('jnor', new THREE.BufferAttribute(jn, 3));
      geo.setAttribute('jmask', new THREE.Float32BufferAttribute(b.mask, 1));
      // Pois : centres posés sur le tissu du maillot (triangles dont les trois sommets sont du maillot).
      const index: number[] = [];
      for (let t = 0; t < b.index.length; t += 3) if (b.mask[b.index[t] as number] && b.mask[b.index[t + 1] as number] && b.mask[b.index[t + 2] as number]) index.push(b.index[t] as number, b.index[t + 1] as number, b.index[t + 2] as number);
      const pattern = jerseyPattern(look.pattern, { sleeveX: 0.16 * s, torsoLen, surface: { jp, index } });
      pattern.set(look.pattern);
      const vc = attribute<'vec3'>('color', 'vec3');
      mat.colorNode = mix(vc, pattern.color(vc), attribute<'float'>('jmask', 'float'));
    }
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
    // Bassin visé sans composante latérale : fessier immobile sur la selle, seul le haut du dos suit le roulis
    // des épaules (assis) ; en danseuse (pelvisFollow), il suit la ligne droite du buste.
    _mid.copy(J.mid).setX(J.hip.x + (J.mid.x - J.hip.x) * (J.pelvisFollow ?? 0));
    aim(b[0] as THREE.Bone, J.hip, _mid);
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

/** Point à la fraction t (0–1) de la longueur d'une polyligne. */
function pointAt(pts: THREE.Vector3[], t: number): THREE.Vector3 {
  const fr = fractions(pts);
  let i = 0;
  while (i < pts.length - 2 && t > (fr[i + 1] as number)) i++;
  const a = fr[i] as number;
  const b = fr[i + 1] as number;
  return new THREE.Vector3().lerpVectors(pts[i] as THREE.Vector3, pts[i + 1] as THREE.Vector3, Math.min(1, Math.max(0, (t - a) / Math.max(1e-6, b - a))));
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
