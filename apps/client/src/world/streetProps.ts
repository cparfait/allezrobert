import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LampSpot } from './streetLamps.ts';
import { CURB_H, SHOP_WALL_STRIDE, type StreetIndex } from './sidewalks.ts';

/**
 * Mobilier de rue du style réaliste, pour toutes les zones : potelets le long des bordures (près des passages
 * piétons, et sur une rue sur trois environ), stores bannes au-dessus des vitrines quand le trottoir est assez
 * large, terrasses de café sur les trottoirs larges. Tout est tiré d'après la position (même décor à chaque
 * chargement) et ne paraît que là où il y a des trottoirs et des boutiques.
 */

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedAt = (x: number, z: number, k = 0) => (Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663) ^ Math.imul(k + 1, 83492791)) >>> 0;

/** Pas des potelets (m) et recul depuis la face de la bordure (m). */
export const BOLLARD_SPACING = 1.6;
export const BOLLARD_FROM_CURB = 0.35;

export interface BollardInput {
  /** Bord de chaussée (face de la bordure) : [x, y, z] par profil. */
  edge: readonly number[];
  along: readonly number[];
  widths: readonly number[];
  /** Sens du travers, de la gauche vers la droite de la voie, par profil. */
  ux: readonly number[];
  uz: readonly number[];
  /** −1 à gauche, +1 à droite. */
  sign: number;
  /** Passages piétons du tronçon (abscisses curvilignes). */
  crossings: ReadonlyArray<{ a0: number; a1: number }>;
  /** Lampadaires déjà posés (on ne colle pas un potelet à leur pied). */
  lamps: readonly LampSpot[];
  /** Rue entière bordée de potelets (tirage par tronçon). */
  wholeStreet: boolean;
}

/** Pieds des potelets d'un côté de la voie (pur, testé). */
export function placeBollards(b: BollardInput): LampSpot[] {
  const out: LampSpot[] = [];
  const n = b.along.length;
  if (n < 2) return out;
  const asc = (b.along[n - 1] as number) >= (b.along[0] as number);
  const A0 = Math.min(b.along[0] as number, b.along[n - 1] as number);
  const A1 = Math.max(b.along[0] as number, b.along[n - 1] as number);
  const near = (a: number) => b.crossings.some((c) => a >= c.a0 - 6 && a <= c.a1 + 6);
  for (let a = A0 + BOLLARD_SPACING / 2; a <= A1 - 0.3; a += BOLLARD_SPACING) {
    const crossing = near(a);
    if (!crossing && !b.wholeStreet) continue;
    // Profil qui encadre `a`.
    let i = 0;
    while (i < n - 2 && (asc ? (b.along[i + 1] as number) < a : (b.along[i + 1] as number) > a)) i++;
    const w0 = b.widths[i] as number;
    const w1 = b.widths[i + 1] as number;
    // Trottoir présent des deux côtés du pas, assez large pour passer à côté (sauf près d'un passage piéton).
    const w = Math.min(w0, w1);
    if (!(w >= (crossing ? 0.8 : 1.0)) || w > 6) continue;
    const a0 = b.along[i] as number;
    const a1 = b.along[i + 1] as number;
    const f = a1 !== a0 ? Math.min(1, Math.max(0, (a - a0) / (a1 - a0))) : 0;
    const lerp = (arr: readonly number[], k: number, stride = 1, c = 0) => (arr[k * stride + c] as number) + ((arr[(k + 1) * stride + c] as number) - (arr[k * stride + c] as number)) * f;
    const ex = lerp(b.edge, i, 3, 0);
    const ey = lerp(b.edge, i, 3, 1);
    const ez = lerp(b.edge, i, 3, 2);
    const ux = lerp(b.ux, i) * b.sign;
    const uz = lerp(b.uz, i) * b.sign;
    const l = Math.hypot(ux, uz) || 1;
    const x = ex + (ux / l) * BOLLARD_FROM_CURB;
    const z = ez + (uz / l) * BOLLARD_FROM_CURB;
    if (b.lamps.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.1 * 1.1)) continue;
    out.push({ x, y: ey + CURB_H, z });
  }
  return out;
}

/** Potelet parisien : fût de fonte, bague, tête en boule (≈ 1 m). */
export function bollardGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(0.048, 0.06, 0.86, 7, 1, true).translate(0, 0.43, 0),
    new THREE.CylinderGeometry(0.066, 0.066, 0.06, 7).translate(0, 0.78, 0),
    new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.92, 0),
    new THREE.CylinderGeometry(0.075, 0.08, 0.06, 7).translate(0, 0.03, 0),
  ].map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.deleteAttribute('uv');
    return ni;
  });
  const g = mergeGeometries(parts, false) as THREE.BufferGeometry;
  g.computeVertexNormals();
  return g;
}

/** Fonte vert bronze, un peu polie par les mains. */
export function createBollardMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.color = new THREE.Color(0.045, 0.05, 0.038);
  m.roughness = 0.5;
  m.metalness = 0.35;
  return m;
}

/** Toiles des stores : bordeaux, vert bouteille, bleu nuit, rouge, noir, beige ; rayées avec un écru. */
const AWNING = ['#5b1420', '#1d3b2a', '#1b2540', '#8a1d1d', '#1a1a1a', '#b49a6a', '#2f5d4a', '#6b2a3a'].map((c) => new THREE.Color(c));
const CREAM = new THREE.Color('#e9e2cf');
/** Tables (marbre, fonte sombre) et chaises de bistrot (rotin, rouge, vert). */
const TABLE_TOP = [new THREE.Color(0.72, 0.7, 0.65), new THREE.Color(0.08, 0.08, 0.085)];
const CHAIR = [new THREE.Color(0.42, 0.28, 0.14), new THREE.Color(0.55, 0.08, 0.07), new THREE.Color(0.1, 0.3, 0.18), new THREE.Color(0.5, 0.36, 0.2)];
const IRON = new THREE.Color(0.05, 0.05, 0.05);

/** Sommets d'une pièce de mobilier sans indices (positions, normales), préparés une fois par géométrie. */
const flatCache = new WeakMap<THREE.BufferGeometry, { pos: Float32Array; nor: Float32Array }>();
function flat(g: THREE.BufferGeometry): { pos: Float32Array; nor: Float32Array } {
  let f = flatCache.get(g);
  if (!f) {
    const ni = g.index ? g.toNonIndexed() : g;
    if (!ni.getAttribute('normal')) ni.computeVertexNormals();
    f = { pos: Float32Array.from(ni.getAttribute('position').array), nor: Float32Array.from(ni.getAttribute('normal').array) };
    flatCache.set(g, f);
  }
  return f;
}

/**
 * Accumule des pièces colorées (sans indices : positions, normales, couleurs) directement dans des tableaux, au lieu
 * d'une géométrie three.js par pied de chaise ou bande de store fusionnées ensuite : 4,9 % du processeur en roulant
 * dans Boulogne à 40 coureurs (copie, transformation et fusion de milliers de petites géométries, 26/11/2026).
 */
class PropSink {
  private pos = new Float32Array(3 * 4096);
  private nor = new Float32Array(3 * 4096);
  private col = new Float32Array(3 * 4096);
  /** Sommets écrits. */
  count = 0;

  private reserve(n: number): void {
    const need = (this.count + n) * 3;
    if (need <= this.pos.length) return;
    const size = Math.max(need, this.pos.length * 2);
    for (const k of ['pos', 'nor', 'col'] as const) {
      const a = new Float32Array(size);
      a.set(this[k]);
      this[k] = a;
    }
  }

  /** Pièce `g` dans le repère orthonormé `basis` (le long du mur, haut, vers la rue), posée en `at`. */
  add(g: THREE.BufferGeometry, color: THREE.Color, basis: THREE.Matrix4, at: THREE.Vector3): void {
    const { pos, nor } = flat(g);
    const n = pos.length / 3;
    this.reserve(n);
    const e = basis.elements;
    const P = this.pos;
    const N = this.nor;
    const C = this.col;
    let o = this.count * 3;
    for (let i = 0; i < pos.length; i += 3, o += 3) {
      const x = pos[i] as number;
      const y = pos[i + 1] as number;
      const z = pos[i + 2] as number;
      P[o] = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + at.x;
      P[o + 1] = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + at.y;
      P[o + 2] = (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + at.z;
      // Repère orthonormé : les normales tournent comme les positions.
      const a = nor[i] as number;
      const b = nor[i + 1] as number;
      const c = nor[i + 2] as number;
      N[o] = (e[0] as number) * a + (e[4] as number) * b + (e[8] as number) * c;
      N[o + 1] = (e[1] as number) * a + (e[5] as number) * b + (e[9] as number) * c;
      N[o + 2] = (e[2] as number) * a + (e[6] as number) * b + (e[10] as number) * c;
      C[o] = color.r;
      C[o + 1] = color.g;
      C[o + 2] = color.b;
    }
    this.count += n;
  }

  /** Quad (quatre coins dans le monde, deux triangles a-b-c et a-c-d), une couleur. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.reserve(3);
    // Normale du triangle (comme computeVertexNormals sur des sommets non partagés).
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    let o = this.count * 3;
    for (const p of [a, b, c]) {
      this.pos[o] = p.x;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z;
      this.nor[o] = nx;
      this.nor[o + 1] = ny;
      this.nor[o + 2] = nz;
      this.col[o] = color.r;
      this.col[o + 1] = color.g;
      this.col[o + 2] = color.b;
      o += 3;
    }
    this.count += 3;
  }

  /** Géométrie finale (null si vide). */
  geometry(): THREE.BufferGeometry | null {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    const n = this.count * 3;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Écart libre devant un mur, du pied du mur vers la rue : jusqu'à une chaussée ou un autre bâtiment (m, max 4,5). */
function freeDepth(street: StreetIndex, x: number, z: number, nx: number, nz: number): number {
  for (let t = 0.3; t <= 4.5; t += 0.25) {
    const px = x + nx * t;
    const pz = z + nz * t;
    if (street.onRoad(px, pz, 0.6) || street.inBuilding(px, pz)) return t;
  }
  return 4.5;
}

/**
 * Stores bannes et terrasses devant les murs à vitrine d'une tuile (un maillage, une matière à couleurs par
 * sommet). `shopWalls` : SHOP_WALL_STRIDE nombres par mur (voir Buildings.shopWalls).
 */
export function buildShopProps(shopWalls: readonly number[], street: StreetIndex, groundAt: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const sink = new PropSink();
  const up = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const { tableTop, tableFoot, tableBase, seat, back, leg } = furniture();
  const cb = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  for (let i = 0; i + SHOP_WALL_STRIDE - 1 < shopWalls.length; i += SHOP_WALL_STRIDE) {
    const ax = shopWalls[i] as number;
    const az = shopWalls[i + 1] as number;
    const bx = shopWalls[i + 2] as number;
    const bz = shopWalls[i + 3] as number;
    const rdc = shopWalls[i + 4] as number;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2.6) continue;
    const r = rng(seedAt((ax + bx) / 2, (az + bz) / 2, 7));
    if (r() > 0.6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    // Vers la rue : la normale qui ne rentre pas dans le bâtiment.
    let nx = -dz;
    let nz = dx;
    if (street.inBuilding(mx + nx * 0.6, mz + nz * 0.6)) {
      nx = -nx;
      nz = -nz;
    }
    const free = Math.min(freeDepth(street, ax + dx * len * 0.2, az + dz * len * 0.2, nx, nz), freeDepth(street, mx, mz, nx, nz), freeDepth(street, ax + dx * len * 0.8, az + dz * len * 0.8, nx, nz));
    if (free < 1.1) continue;
    const g = groundAt(mx + nx * 0.5, mz + nz * 0.5);
    if (!Number.isFinite(g)) continue;
    const y0 = g + CURB_H;
    const D = Math.min(1.4, free - 0.45);
    const top = y0 + Math.max(2.5, rdc - 0.35);
    const front = top - D * 0.42;
    const valance = 0.22;
    const colA = AWNING[Math.floor(r() * AWNING.length)] as THREE.Color;
    const striped = r() < 0.35;
    const L = len - 0.6;
    const nSec = Math.max(1, Math.round(L / 3.4));
    const secW = L / nSec;
    const at = (s: number, out: number, y: number) => v(ax + dx * s + nx * out, y, az + dz * s + nz * out);
    for (let k = 0; k < nSec; k++) {
      const s0 = 0.3 + k * secW + 0.06;
      const s1 = 0.3 + (k + 1) * secW - 0.06;
      const stripes = striped ? Math.max(1, Math.round((s1 - s0) / 0.32)) : 1;
      for (let q = 0; q < stripes; q++) {
        const t0 = s0 + ((s1 - s0) * q) / stripes;
        const t1 = s0 + ((s1 - s0) * (q + 1)) / stripes;
        const c = striped && q % 2 === 1 ? CREAM : colA;
        // Toile en pente, du mur vers la rue, puis lambrequin vertical.
        sink.quad(at(t0, 0.02, top), at(t1, 0.02, top), at(t1, D, front), at(t0, D, front), c);
        sink.quad(at(t0, D, front), at(t1, D, front), at(t1, D, front - valance), at(t0, D, front - valance), c);
      }
    }
    // Terrasse : sur un trottoir large, une ou deux rangées de tables sous le store.
    if (free < 2.6 || r() > 0.5) continue;
    basis.makeBasis(v(dx, 0, dz), up, v(nx, 0, nz));
    const rows = free >= 3.5 ? [0.75, 1.85] : [0.8];
    const top0 = TABLE_TOP[Math.floor(r() * TABLE_TOP.length)] as THREE.Color;
    const chair = CHAIR[Math.floor(r() * CHAIR.length)] as THREE.Color;
    for (const out of rows) {
      for (let s = 0.9; s <= len - 0.9; s += 1.55) {
        if (r() < 0.12) continue;
        const ground = groundAt(ax + dx * s + nx * out, az + dz * s + nz * out);
        const y = (Number.isFinite(ground) ? ground : g) + CURB_H;
        const p = at(s, out, y);
        sink.add(tableBase, IRON, basis, tmp.copy(p).setY(y + 0.015));
        sink.add(tableFoot, IRON, basis, tmp.copy(p).setY(y + 0.37));
        sink.add(tableTop, top0, basis, tmp.copy(p).setY(y + 0.73));
        for (const side of [-1, 1]) {
          const cp = at(s + side * 0.5, out, y);
          // Chaise tournée vers la table : dossier du côté opposé.
          cb.makeBasis(v(nx, 0, nz), up, v(dx * side, 0, dz * side));
          sink.add(seat, chair, cb, tmp.copy(cp).setY(y + 0.45));
          sink.add(back, chair, cb, tmp.set(cp.x + dx * side * 0.19, y + 0.66, cp.z + dz * side * 0.19));
          for (const [lx, lz] of LEGS) sink.add(leg, IRON, cb, tmp.set(cp.x + nx * lx + dx * side * lz, y + 0.225, cp.z + nz * lx + dz * side * lz));
        }
      }
    }
  }
  return sink.geometry();
}

const LEGS = [
  [-0.17, -0.17],
  [0.17, -0.17],
  [-0.17, 0.17],
  [0.17, 0.17],
] as const;

/** Pièces de mobilier (locales : x le long du mur, y en haut, z vers la rue), créées une fois. */
let furnitureParts: Record<'tableTop' | 'tableFoot' | 'tableBase' | 'seat' | 'back' | 'leg', THREE.BufferGeometry> | null = null;
function furniture(): NonNullable<typeof furnitureParts> {
  return (furnitureParts ??= {
    tableTop: new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12),
    tableFoot: new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
    tableBase: new THREE.CylinderGeometry(0.2, 0.22, 0.03, 10),
    seat: new THREE.BoxGeometry(0.4, 0.04, 0.4),
    back: new THREE.BoxGeometry(0.4, 0.38, 0.035),
    leg: new THREE.BoxGeometry(0.03, 0.45, 0.03),
  });
}

/** Toiles, tables et chaises : couleurs par sommet, toile visible des deux côtés. */
export function createPropMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  m.roughness = 0.78;
  m.metalness = 0;
  m.side = THREE.DoubleSide;
  return m;
}
