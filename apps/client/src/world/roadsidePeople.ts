import * as THREE from 'three/webgpu';
import { abs, attribute, cos, float, floor, instancedBufferAttribute, min, mix, positionGeometry, sin, step, time, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../engine/noise.ts';
import { box } from './lowPolyKit.ts';
import type { LifeChunk, PersonSpot, RoadsideLife } from './roadsideLife.ts';

/**
 * Personnages des abords (style jeu vidéo) : joggeurs qui font demi-tour au bout de leur parcours,
 * promeneurs et leur chien, enfants qui saluent le coureur quand il passe, habitants devant leur
 * maison ou à la fontaine, pêcheurs assis au bord de l'eau qui lancent leur ligne, enfants qui jouent
 * au foot. Corps en prismes à facettes comme le cycliste (rider/lowPolyRider.ts), un seul maillage
 * instancié pour tous (chien et ballon compris) : membres, salut, lancer et course animés dans le
 * shader, positions et états mis à jour par le processeur pour les quelques dizaines de personnages
 * proches. Tout reste immobile loin du coureur ; chacun s'anime quand il approche (comme le train).
 *
 * Deux lots : les personnages à moins de ~60 m projettent une ombre, les autres non.
 */

/** Personnages créés à moins de SPAWN_M de leur place, oubliés au-delà de FORGET_M. */
const SPAWN_M = 320;
const FORGET_M = 400;
/** Ombres portées en deçà (avec hystérésis). */
const SHADOW_IN = 55;
const SHADOW_OUT = 65;

/** Modes d'animation (attribut `anim.x`). */
const STAND = 0;
const WALK = 1;
const JOG = 2;
const SIT = 3;
const WAVE = 4;
const PLAY = 5;
const DOG = 6;
const BALL = 7;

const col = (list: string[]) => list.map((c) => new THREE.Color(c));
const SKIN = col(['#f1c7a5', '#e0ac85', '#c68a62', '#8d5a3b', '#f5d2b8', '#d9a07a']);
const SHIRTS: Record<string, THREE.Color[]> = {
  jogger: col(['#ff4f6d', '#2fd2c6', '#ffd23f', '#4f8cff', '#ff8a3d', '#b3ff4f', '#f2f2f2']),
  walker: col(['#c0392b', '#7f8c8d', '#2e86c1', '#a9746e', '#556b2f', '#d4c19c', '#6c3483']),
  child: col(['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#ff7f50', '#ff69b4']),
  villager: col(['#8e44ad', '#2c3e50', '#d35400', '#7f8c8d', '#c0392b', '#f0e6d2', '#16a085']),
  fisher: col(['#6b7a3a', '#556b2f', '#8a7a55', '#3f5a4a']),
};
const PANTS: Record<string, THREE.Color[]> = {
  jogger: col(['#1f2228', '#2c3e66', '#23262b']),
  walker: col(['#3b5b8a', '#b8a68a', '#5a5d63', '#2f3a4a']),
  child: col(['#2c3e50', '#34495e', '#3b5b8a', '#8a5a3a']),
  villager: col(['#3b5b8a', '#4a4a4a', '#6b5a45', '#2f3a4a']),
  fisher: col(['#4a4a3a', '#3a3f2f', '#5a5040']),
};
const DOGS = col(['#8a5a36', '#2b2420', '#e8dcc8', '#c49a5a', '#5a4a3a', '#f2efe8']);
const TEAMS = col(['#d63b3b', '#2f6fd6', '#f2c21b', '#22a45d', '#f4f4f4', '#7b3fbf']);
const WHITE = new THREE.Color('#f4f4f2');
const BLACK = new THREE.Color('#1c1c1e');

/**
 * Pièce du personnage. `paint` : 0 couleur propre, 1 haut (ou robe du chien), 2 bas, 3 peau.
 * `limb` : 0 fixe, 1/2 jambe gauche/droite, 3/4 bras gauche/droit (canne comprise), 5/6 paires de
 * pattes du chien, 7 ballon. `grp` : 0 personne, 1 accessoires du pêcheur, 2 chien, 3 ballon.
 */
function piece(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, paint: number, limb: number, grp: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
  const n = ng.getAttribute('position').count;
  const c = new THREE.Color(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  // paint, limb et grp dans un seul attribut : WebGPU limite à 8 les tampons de sommets d'un pipeline
  // (géométrie + matrice et attributs d'instance), et l'ombre des personnages proches dépassait.
  const part = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) part.set([paint, limb, grp], i * 3);
  ng.setAttribute('part', new THREE.BufferAttribute(part, 3));
  return ng;
}

/** Prisme de y0 à y1 (rayons r0 en bas, r1 en haut). */
const prism = (r0: number, r1: number, y0: number, y1: number, x = 0, z = 0, sides = 6) => new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1).translate(x, (y0 + y1) / 2, z);

/** Tige fine de a à b (canne, fil). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), 4, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/**
 * Personnage debout (1,78 m, avant +z, gauche +x, pieds en y = 0), plus le chien, le ballon et les
 * accessoires du pêcheur (masqués selon le mode).
 */
function peopleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [side, limbLeg, limbArm] of [
    [1, 1, 3],
    [-1, 2, 4],
  ] as const) {
    const x = 0.1 * side;
    parts.push(piece(box(0.1, 0.07, 0.24, x, 0.035, 0.03), '#2a2a2e', 0, limbLeg, 0));
    // Jambe en deux : haut (bas du vêtement) et bas de jambe (peau pour les coureurs en short, `paint` 4).
    parts.push(piece(prism(0.064, 0.075, 0.52, 0.94, x), '#ffffff', 2, limbLeg, 0));
    parts.push(piece(prism(0.054, 0.064, 0.07, 0.52, x), '#ffffff', 4, limbLeg, 0));
    const ax = 0.225 * side;
    parts.push(piece(prism(0.048, 0.055, 1.14, 1.45, ax), '#ffffff', 1, limbArm, 0));
    parts.push(piece(prism(0.04, 0.046, 0.86, 1.15, ax), '#ffffff', 3, limbArm, 0));
    parts.push(piece(box(0.07, 0.09, 0.08, ax, 0.8, 0.01), '#ffffff', 3, limbArm, 0));
  }
  parts.push(piece(box(0.34, 0.2, 0.2, 0, 0.98, 0), '#ffffff', 2, 0, 0));
  parts.push(piece(new THREE.CylinderGeometry(0.2, 0.15, 0.5, 6).scale(1, 1, 0.65).translate(0, 1.23, 0), '#ffffff', 1, 0, 0));
  parts.push(piece(prism(0.05, 0.05, 1.46, 1.57), '#ffffff', 3, 0, 0));
  parts.push(piece(new THREE.IcosahedronGeometry(0.125, 0).scale(0.9, 1.1, 0.95).translate(0, 1.68, 0), '#ffffff', 3, 0, 0));
  parts.push(piece(box(0.21, 0.08, 0.21, 0, 1.78, -0.02), '#3a2a1e', 0, 0, 0));
  parts.push(piece(box(0.035, 0.035, 0.035, 0, 1.66, 0.12), '#ffffff', 3, 0, 0));

  // Pêcheur (assis par terre, corps abaissé de 0,82 m dans le shader) : bob, seau, canne et fil.
  parts.push(piece(prism(0.15, 0.115, 1.73, 1.84), '#7a7a52', 0, 0, 1));
  parts.push(piece(prism(0.21, 0.21, 1.72, 1.745), '#7a7a52', 0, 0, 1));
  parts.push(piece(prism(0.13, 0.15, 0.82, 1.08, 0.48, 0.15, 8), '#4a6fa5', 0, 0, 1));
  // canne et fil dans le repère du bras pendant (le bras droit est levé de 1,1 rad dans le shader)
  const hand = new THREE.Vector3(-0.225, 0.8, 0.04);
  const tip = hand.clone().add(new THREE.Vector3(0, -0.548, 0.84).multiplyScalar(2.6));
  parts.push(piece(rod(hand, tip, 0.016, 0.006), '#3b2a1c', 0, 4, 1));
  parts.push(piece(rod(tip, tip.clone().add(new THREE.Vector3(0, -0.454, -0.891).multiplyScalar(1.9)), 0.004, 0.004), '#e8e8e8', 0, 4, 1));

  // Chien (avant +z) : corps, tête, museau, oreilles, queue, pattes par paires diagonales.
  parts.push(piece(box(0.2, 0.22, 0.6, 0, 0.42, 0), '#ffffff', 1, 0, 2));
  parts.push(piece(box(0.18, 0.18, 0.22, 0, 0.58, 0.36), '#ffffff', 1, 0, 2));
  parts.push(piece(box(0.1, 0.09, 0.12, 0, 0.53, 0.5), '#2a211c', 0, 0, 2));
  parts.push(piece(box(0.04, 0.08, 0.05, 0.065, 0.69, 0.32), '#2a211c', 0, 0, 2));
  parts.push(piece(box(0.04, 0.08, 0.05, -0.065, 0.69, 0.32), '#2a211c', 0, 0, 2));
  parts.push(piece(new THREE.BoxGeometry(0.04, 0.04, 0.28).rotateX(-0.6).translate(0, 0.58, -0.4), '#ffffff', 1, 0, 2));
  for (const [x, z, limb] of [
    [0.07, 0.22, 5],
    [-0.07, 0.22, 6],
    [0.07, -0.22, 6],
    [-0.07, -0.22, 5],
  ] as const)
    parts.push(piece(box(0.06, 0.32, 0.06, x, 0.16, z), '#ffffff', 1, limb, 2));

  // Ballon : icosaèdre blanc, une face sur quatre noire.
  const ball = piece(new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.11, 0), '#f4f4f2', 0, 7, 3);
  const bc = ball.getAttribute('color') as THREE.BufferAttribute;
  for (let f = 0; f < bc.count / 3; f++) if (f % 4 === 0) for (let v = 0; v < 3; v++) bc.setXYZ(f * 3 + v, 0.02, 0.02, 0.02);
  parts.push(ball);
  const g = mergeGeometries(parts, false) as THREE.BufferGeometry;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/**
 * Lot instancié : position et cap (`pose`), mode et phases (`anim`), couleurs. La matrice d'instance
 * reste l'identité (le shader pose et anime chaque personnage).
 */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  private readonly pose: THREE.InstancedBufferAttribute;
  private readonly anim: THREE.InstancedBufferAttribute;
  /** Haut, bas et peau, chacun codé en un nombre (r × 65536 + g × 256 + b, sur 8 bits) : un seul tampon. */
  private readonly tints: THREE.InstancedBufferAttribute;
  private readonly used: Uint8Array;
  private top = 0;
  private colorsDirty = false;

  constructor(geo: THREE.BufferGeometry, readonly cap: number, shadows: boolean) {
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.pose = attr(4);
    this.anim = attr(4);
    this.tints = attr(3);
    this.used = new Uint8Array(cap);
    this.mesh = new THREE.InstancedMesh(geo, peopleMaterial(this.pose, this.anim, this.tints), cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.name = shadows ? 'people-near' : 'people-far';
  }

  alloc(): number {
    for (let i = 0; i < this.cap; i++)
      if (!this.used[i]) {
        this.used[i] = 1;
        if (i + 1 > this.top) this.top = i + 1;
        this.mesh.count = this.top;
        return i;
      }
    return -1;
  }

  free(i: number): void {
    if (i < 0 || !this.used[i]) return;
    this.used[i] = 0;
    // masquée : mode négatif, échelle nulle dans le shader
    this.anim.setXYZW(i, -1, 0, 0, 0);
    while (this.top > 0 && !this.used[this.top - 1]) this.top--;
    this.mesh.count = this.top;
  }

  /** `shorts` : bas de jambe nu (coureurs, enfants qui jouent), codé par le signe de la couleur du bas. */
  colors(i: number, shirt: THREE.Color, pants: THREE.Color, skin: THREE.Color, shorts = false): void {
    this.tints.setXYZ(i, packColor(shirt), packColor(pants) * (shorts ? -1 : 1) - (shorts ? 1 : 0), packColor(skin));
    this.colorsDirty = true;
  }

  /** Pose d'une instance ; `mode` < 0 = masquée. L'échelle est codée avec le mode (mode + 10 × échelle). */
  write(i: number, x: number, y: number, z: number, yaw: number, scale: number, mode: number, phase: number, wave: number, cast: number): void {
    this.pose.setXYZW(i, x, y, z, yaw);
    // + 0,5 : décodage robuste (divisions approchées du GPU)
    this.anim.setXYZW(i, mode < 0 ? -1 : mode + 10 * Math.round(scale * 100) + 0.5, phase, wave, cast);
  }

  commit(): void {
    this.pose.needsUpdate = true;
    this.anim.needsUpdate = true;
    if (this.colorsDirty) {
      this.tints.needsUpdate = true;
      this.colorsDirty = false;
    }
  }

  dispose(): void {
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Matériau des personnages : couleurs par partie, membres animés, pose et cap appliqués dans le shader. */
/** Couleur codée en un nombre exact en flottant 32 bits (24 bits utiles). */
function packColor(c: THREE.Color): number {
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return q(c.r) * 65536 + q(c.g) * 256 + q(c.b);
}

/** Décode une couleur de packColor dans le shader. */
function unpackColor(code: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const r = floor(code.div(65536));
  const g = floor(code.sub(r.mul(65536)).div(256));
  const b = code.sub(r.mul(65536)).sub(g.mul(256));
  return vec3(r, g, b).div(255) as unknown as THREE.Node<'vec3'>;
}

function peopleMaterial(pose: THREE.InstancedBufferAttribute, anim: THREE.InstancedBufferAttribute, tints: THREE.InstancedBufferAttribute): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  m.flatShading = true;
  const own = attribute<'vec3'>('color');
  const part = attribute<'vec3'>('part');
  const paint = part.x;
  const limb = part.y;
  const grp = part.z;
  const P = instancedBufferAttribute(pose) as unknown as THREE.Node<'vec4'>;
  const A = instancedBufferAttribute(anim) as unknown as THREE.Node<'vec4'>;
  const T = instancedBufferAttribute(tints) as unknown as THREE.Node<'vec3'>;
  const cS = unpackColor(T.x);
  // bas négatif : en short (−code − 1, pour distinguer le noir pur)
  const shorts = step(T.y, -0.5);
  const cP = unpackColor(mix(T.y, T.y.negate().sub(1), shorts));
  const cK = unpackColor(T.z);
  const lowerLeg = mix(cP, cK, shorts);
  const is = (v: THREE.Node<'float'>, n: number) => float(1).sub(min(abs(v.sub(n)), 1));
  m.colorNode = own.mul(is(paint, 0)).add(cS.mul(is(paint, 1))).add(cP.mul(is(paint, 2))).add(cK.mul(is(paint, 3))).add(lowerLeg.mul(is(paint, 4)));

  // anim.x = mode + 10 × échelle (en centièmes) + 0,5 ; < 0 : instance masquée (échelle nulle)
  const code = A.x;
  const hundredths = floor(code.div(10));
  const mode = floor(code.sub(hundredths.mul(10)));
  const scale = hundredths.mul(0.01).mul(step(0, code));
  const ph = A.y;
  const wave = A.z;
  const cast = A.w;
  const walk = is(mode, WALK);
  const jog = is(mode, JOG).add(is(mode, PLAY));
  const sit = is(mode, SIT);
  const dog = is(mode, DOG);
  const ball = is(mode, BALL);
  const human = float(1).sub(dog).sub(ball);
  const vis = is(grp, 0).mul(human).add(is(grp, 1).mul(sit)).add(is(grp, 2).mul(dog)).add(is(grp, 3).mul(ball));
  const s = sin(ph);
  const legL = is(limb, 1);
  const legR = is(limb, 2);
  const armL = is(limb, 3);
  const armR = is(limb, 4);
  const dA = is(limb, 5);
  const dB = is(limb, 6);
  const bl = is(limb, 7);
  const legAmp = walk.mul(0.45).add(jog.mul(0.8));
  const armAmp = walk.mul(0.35).add(jog.mul(0.55));
  const angLeg = legL.sub(legR).mul(legAmp).mul(s).add(legL.add(legR).mul(sit).mul(-1.5));
  const castLift = sin(cast.mul(Math.PI)).mul(1.4);
  const angArm = armR
    .sub(armL)
    .mul(armAmp)
    .mul(s)
    .add(armL.add(armR).mul(jog).mul(-0.7))
    .add(armL.mul(sit).mul(-0.5))
    .add(armR.mul(sit).mul(float(-1.1).sub(castLift)));
  const ang = angLeg.add(angArm).add(dA.sub(dB).mul(0.6).mul(s)).add(bl.mul(ph));
  const py = legL.add(legR).mul(0.93).add(armL.add(armR).mul(1.44)).add(dA.add(dB).mul(0.32)).add(bl.mul(0.11));
  const p0 = positionGeometry;
  // rotation des membres autour de l'axe x, au pivot (hanche, épaule, épaule du chien, centre du ballon)
  const qy = p0.y.sub(py);
  const ca = cos(ang);
  const sa = sin(ang);
  const y1 = qy.mul(ca).sub(p0.z.mul(sa)).add(py);
  const z1 = qy.mul(sa).add(p0.z.mul(ca));
  // salut : bras droit levé sur le côté (rotation autour de z à l'épaule), main qui s'agite
  const wv = armR.mul(wave).mul(float(2.5).add(sin(time.mul(9).add(ph)).mul(0.3))).negate();
  const wx = p0.x.add(0.225);
  const wy = y1.sub(1.44);
  const cw = cos(wv);
  const sw = sin(wv);
  const x2 = wx.mul(cw).sub(wy.mul(sw)).sub(0.225);
  const y2 = wx.mul(sw).add(wy.mul(cw)).add(1.44).sub(sit.mul(0.82)).add(jog.mul(abs(s)).mul(0.06));
  // course : buste penché en avant
  const lean = jog.mul(0.12);
  const cl = cos(lean);
  const sl = sin(lean);
  const y3 = y2.mul(cl).sub(z1.mul(sl));
  const z3 = y2.mul(sl).add(z1.mul(cl));
  // pose : échelle, cap (l'avant +z regarde (sin yaw, cos yaw)), position
  const cy = cos(P.w);
  const sy = sin(P.w);
  const lx = x2.mul(scale).mul(vis);
  const ly = y3.mul(scale).mul(vis);
  const lz = z3.mul(scale).mul(vis);
  m.positionNode = vec3(P.x.add(lx.mul(cy)).add(lz.mul(sy)), P.y.add(ly), P.z.sub(lx.mul(sy)).add(lz.mul(cy)));
  return m;
}

type Role = 'jogger' | 'walker' | 'dog' | 'child' | 'villager' | 'fisher' | 'kid' | 'ball';

interface Actor {
  role: Role;
  batch: 0 | 1;
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  mode: number;
  phase: number;
  wave: number;
  cast: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  /** Trajet : position (m) le long du chemin, sens, vitesse, pause. */
  t: number;
  dir: number;
  speed: number;
  pause: number;
  /** Salut, lancer : durée restante, réarmé quand le coureur s'éloigne. */
  timer: number;
  armed: boolean;
  /** Terrain de foot : position (u, v) dans le repère du terrain, vitesse, cible. */
  u: number;
  v: number;
  vu: number;
  vv: number;
  tu: number;
  tv: number;
}

interface Group {
  spot: PersonSpot;
  actors: Actor[];
  /** Terrain : rien ne bouge tant que le coureur est loin ; ballon et joueurs. */
  active: boolean;
  kick: number;
  ball: Actor | null;
  kids: Actor[];
}

export class RoadsidePeople {
  readonly group = new THREE.Group();
  private readonly geo = peopleGeometry();
  private readonly batches: [Batch, Batch];
  private readonly groups = new Map<PersonSpot, Group>();
  private spots: PersonSpot[] = [];
  private version = -1;
  private scan = 0;
  private readonly heightAt: (x: number, z: number) => number;

  constructor(
    private readonly life: RoadsideLife,
    heightAt: (x: number, z: number) => number,
    people: number,
  ) {
    this.heightAt = heightAt;
    const cap = Math.round(48 + 48 * Math.min(1, Math.max(0, people)));
    this.batches = [new Batch(this.geo, 28, true), new Batch(this.geo, cap, false)];
    this.group.name = 'roadside-people';
    for (const b of this.batches) this.group.add(b.mesh);
  }

  /** Itinéraire changé : tout le monde repart de zéro. */
  reset(): void {
    for (const g of [...this.groups.values()]) this.release(g);
    this.groups.clear();
    this.version = -1;
  }

  update(dt: number, focus: THREE.Vector3): void {
    if (this.life.version !== this.version) {
      this.version = this.life.version;
      const list: PersonSpot[] = [];
      for (const c of this.life.chunkList as readonly LifeChunk[]) for (const s of c.spots) list.push(s);
      this.spots = list;
      const alive = new Set(list);
      for (const [spot, g] of this.groups) if (!alive.has(spot)) this.forget(spot, g);
      this.scan = 0;
    }
    // Apparitions et oublis : deux fois par seconde.
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.5;
      for (const spot of this.spots) {
        const d = Math.hypot(spot.x - focus.x, spot.z - focus.z);
        const g = this.groups.get(spot);
        if (!g && d < SPAWN_M) this.spawn(spot);
        else if (g && d > FORGET_M) this.forget(spot, g);
      }
      // Personnages immobiles reposés sur le sol dessiné : la hauteur du point d'apparition date de la
      // construction du tronçon, et le terrain peut s'être affiné depuis (tuile détaillée chargée).
      for (const g of this.groups.values())
        for (const a of g.actors) {
          if (a.role !== 'villager' && a.role !== 'child' && a.role !== 'fisher') continue;
          const y = this.heightAt(a.x, a.z);
          if (Number.isFinite(y)) a.y = y;
        }
    }
    for (const g of this.groups.values()) this.animate(g, dt, focus);
    for (const b of this.batches) b.commit();
  }

  private forget(spot: PersonSpot, g: Group): void {
    this.release(g);
    this.groups.delete(spot);
  }

  private release(g: Group): void {
    for (const a of g.actors) {
      (this.batches[a.batch] as Batch).free(a.slot);
      a.slot = -1;
    }
  }

  private actor(role: Role, x: number, y: number, z: number, yaw: number, r: () => number, shirt?: THREE.Color, pants?: THREE.Color): Actor | null {
    const b = this.batches[1];
    const slot = b.alloc();
    if (slot < 0) return null;
    const key = role === 'kid' || role === 'ball' ? 'child' : role === 'dog' ? 'walker' : role;
    const pick = (l: THREE.Color[]) => l[Math.floor(r() * l.length)] as THREE.Color;
    const a: Actor = {
      role,
      batch: 1,
      slot,
      x,
      y,
      z,
      yaw,
      scale: role === 'child' || role === 'kid' ? 0.58 + r() * 0.12 : role === 'dog' ? 0.8 + r() * 0.5 : role === 'ball' ? 1 : 0.94 + r() * 0.1,
      mode: role === 'dog' ? DOG : role === 'ball' ? BALL : role === 'fisher' ? SIT : STAND,
      phase: r() * 6.28,
      wave: 0,
      cast: 0,
      shirt: role === 'dog' ? pick(DOGS) : (shirt ?? pick(SHIRTS[key] as THREE.Color[])),
      pants: pants ?? pick(PANTS[key] as THREE.Color[]),
      skin: pick(SKIN),
      t: 0,
      dir: 1,
      speed: 0,
      pause: 0,
      timer: 0,
      armed: true,
      u: 0,
      v: 0,
      vu: 0,
      vv: 0,
      tu: 0,
      tv: 0,
    };
    b.colors(slot, a.shirt, a.pants, a.skin, a.role === 'jogger' || a.role === 'kid');
    return a;
  }

  private spawn(spot: PersonSpot): void {
    const r = rng(Math.floor(spot.seed * 1e9));
    const g: Group = { spot, actors: [], active: false, kick: 0, ball: null, kids: [] };
    const add = (a: Actor | null) => a && g.actors.push(a);
    switch (spot.kind) {
      case 'jogger':
      case 'walker': {
        const p = spot.path as Float32Array;
        const a = this.actor(spot.kind, p[0] as number, p[1] as number, p[2] as number, 0, r);
        if (a) {
          a.speed = spot.kind === 'jogger' ? 2.6 + r() * 0.8 : 1.2 + r() * 0.3;
          a.t = r() * (p.length / 3 - 1) * 4;
          a.dir = r() < 0.5 ? 1 : -1;
          add(a);
          if (spot.kind === 'walker') add(this.actor('dog', a.x, a.y, a.z, 0, r));
        }
        break;
      }
      case 'child':
        add(this.actor('child', spot.x, spot.y, spot.z, spot.yaw, r));
        // parfois un frère ou une sœur à côté
        if (r() < 0.4) add(this.actor('child', spot.x + Math.cos(spot.yaw) * 0.7, spot.y, spot.z - Math.sin(spot.yaw) * 0.7, spot.yaw, r));
        break;
      case 'villager':
        add(this.actor('villager', spot.x, spot.y, spot.z, spot.yaw, r));
        if (r() < 0.5) {
          // deux voisins qui discutent, face à face
          const ox = Math.sin(spot.yaw + 1.2) * 0.9;
          const oz = Math.cos(spot.yaw + 1.2) * 0.9;
          add(this.actor('villager', spot.x + ox, spot.y, spot.z + oz, spot.yaw + Math.PI - 0.6, r));
        }
        break;
      case 'fisher':
        add(this.actor('fisher', spot.x, spot.y, spot.z, spot.yaw, r));
        break;
      case 'pitch': {
        const pt = spot.pitch;
        if (!pt) break;
        const teamA = TEAMS[Math.floor(r() * TEAMS.length)] as THREE.Color;
        let teamB = TEAMS[Math.floor(r() * TEAMS.length)] as THREE.Color;
        if (teamB === teamA) teamB = TEAMS[(TEAMS.indexOf(teamA) + 1) % TEAMS.length] as THREE.Color;
        const n = 6 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) {
          const a = this.actor('kid', spot.x, spot.y, spot.z, 0, r, i % 2 ? teamA : teamB, i % 2 ? BLACK : WHITE);
          if (!a) continue;
          a.u = (r() - 0.5) * pt.hl * 1.6;
          a.v = (r() - 0.5) * pt.hw * 1.6;
          a.tu = a.u;
          a.tv = a.v;
          add(a);
        }
        const ball = this.actor('ball', spot.x, spot.y, spot.z, 0, r);
        if (ball) {
          ball.u = (r() - 0.5) * 6;
          ball.v = (r() - 0.5) * 6;
          add(ball);
        }
        break;
      }
    }
    for (const a of g.actors) {
      if (a.role === 'ball') g.ball = a;
      else if (a.role === 'kid') g.kids.push(a);
    }
    if (g.actors.length) this.groups.set(spot, g);
  }

  /** Lot proche (ombres) ou lointain, avec hystérésis. */
  private place(a: Actor, d: number): void {
    const want: 0 | 1 = d < (a.batch === 0 ? SHADOW_OUT : SHADOW_IN) ? 0 : 1;
    if (want === a.batch || a.slot < 0) return;
    const to = this.batches[want];
    const slot = to.alloc();
    if (slot < 0) return;
    (this.batches[a.batch] as Batch).free(a.slot);
    a.batch = want;
    a.slot = slot;
    to.colors(slot, a.shirt, a.pants, a.skin, a.role === 'jogger' || a.role === 'kid');
  }

  private animate(g: Group, dt: number, f: THREE.Vector3): void {
    const spot = g.spot;
    const dSpot = Math.hypot(spot.x - f.x, spot.z - f.z);
    if (spot.kind === 'pitch') this.playFootball(g, dt, dSpot);
    for (const a of g.actors) {
      if (a.slot < 0) continue;
      const d = Math.hypot(a.x - f.x, a.z - f.z);
      switch (a.role) {
        case 'jogger':
        case 'walker':
          this.walkPath(a, spot.path as Float32Array, dt, d < (a.role === 'jogger' ? 260 : 200));
          break;
        case 'dog': {
          const m = g.actors[0] as Actor;
          // à côté de son maître, un peu devant, qui flâne
          const wob = Math.sin(m.t * 0.35 + a.scale * 5);
          const rx = Math.cos(m.yaw);
          const rz = -Math.sin(m.yaw);
          const fx = Math.sin(m.yaw);
          const fz = Math.cos(m.yaw);
          a.x = m.x - rx * (0.75 + 0.2 * wob) + fx * (0.6 + 0.4 * wob);
          a.z = m.z - rz * (0.75 + 0.2 * wob) + fz * (0.6 + 0.4 * wob);
          a.y = m.y;
          a.yaw = m.yaw + wob * 0.25;
          if (m.mode === WALK) a.phase = (a.phase + ((m.speed * 1.2) / 0.7) * Math.PI * 2 * dt) % (Math.PI * 2);
          break;
        }
        case 'child':
        case 'villager': {
          // salut quand le coureur passe à moins de 25 m (une fois par passage) ; un habitant sur trois
          const reach = a.role === 'child' ? 25 : 18;
          if (a.armed && d < reach && (a.role === 'child' || a.shirt.r + a.pants.g < 0.5)) {
            a.armed = false;
            a.timer = a.role === 'child' ? 4.5 : 2.5;
          }
          if (!a.armed && d > reach + 25) a.armed = true;
          a.timer = Math.max(0, a.timer - dt);
          const target = a.timer > 0 ? (a.role === 'child' ? 1 : 0.75) : 0;
          a.wave += (target - a.wave) * Math.min(1, dt * 5);
          a.mode = a.wave > 0.02 ? WAVE : STAND;
          if (a.timer > 0) a.yaw = turnTo(a.yaw, Math.atan2(f.x - a.x, f.z - a.z), dt * 3);
          break;
        }
        case 'fisher':
          // lancer quand le coureur approche (< 60 m), une fois par passage
          if (a.armed && d < 60) {
            a.armed = false;
            a.timer = 1.6;
          }
          if (!a.armed && d > 120) a.armed = true;
          a.timer = Math.max(0, a.timer - dt);
          a.cast = a.timer > 0 ? 1 - a.timer / 1.6 : 0;
          break;
        default:
          break;
      }
      this.place(a, d);
      (this.batches[a.batch] as Batch).write(a.slot, a.x, a.y, a.z, a.yaw, a.scale, a.mode, a.phase, a.wave, a.cast);
    }
  }

  /** Joggeur ou promeneur : suit son chemin, demi-tour au bout ; immobile tant que le coureur est loin. */
  private walkPath(a: Actor, p: Float32Array, dt: number, active: boolean): void {
    const n = p.length / 3;
    const L = (n - 1) * 4;
    if (active && a.pause <= 0) {
      a.t += a.dir * a.speed * dt;
      if (a.t >= L || a.t <= 0) {
        a.t = Math.min(Math.max(a.t, 0), L);
        a.dir = -a.dir;
        a.pause = 1 + Math.random();
      }
      a.mode = a.role === 'jogger' ? JOG : WALK;
      // foulée : 2,2 m par cycle en courant, 1,4 m en marchant
      a.phase = (a.phase + (a.speed / (a.role === 'jogger' ? 2.2 : 1.4)) * Math.PI * 2 * dt) % (Math.PI * 2);
    } else {
      a.pause = Math.max(0, a.pause - dt);
      a.mode = STAND;
    }
    const i = Math.min(Math.floor(a.t / 4), n - 2);
    const u = Math.min(1, Math.max(0, a.t / 4 - i));
    const ax = p[i * 3] as number;
    const ay = p[i * 3 + 1] as number;
    const az = p[i * 3 + 2] as number;
    const bx = p[i * 3 + 3] as number;
    const by = p[i * 3 + 4] as number;
    const bz = p[i * 3 + 5] as number;
    a.x = ax + (bx - ax) * u;
    a.y = ay + (by - ay) * u;
    a.z = az + (bz - az) * u;
    const target = Math.atan2((bx - ax) * a.dir, (bz - az) * a.dir);
    a.yaw = turnTo(a.yaw, target, dt * 4);
  }

  /** Foot : les deux joueurs les plus proches courent après le ballon, les autres se replacent. */
  private playFootball(g: Group, dt: number, dSpot: number): void {
    const pt = g.spot.pitch;
    if (!pt) return;
    // le jeu démarre quand le coureur approche (< 150 m)
    if (!g.active && dSpot < 150) g.active = true;
    else if (g.active && dSpot > 220) g.active = false;
    const ball = g.ball;
    const kids = g.kids;
    const vx = -pt.uz;
    const vz = pt.ux;
    const toWorld = (a: Actor) => {
      a.x = g.spot.x + pt.ux * a.u + vx * a.v;
      a.z = g.spot.z + pt.uz * a.u + vz * a.v;
      const y = this.heightAt(a.x, a.z);
      a.y = Number.isFinite(y) ? y + 0.07 : g.spot.y;
    };
    if (ball && g.active) {
      ball.u += ball.vu * dt;
      ball.v += ball.vv * dt;
      const sp = Math.hypot(ball.vu, ball.vv);
      const k = Math.exp(-0.8 * dt);
      ball.vu *= k;
      ball.vv *= k;
      ball.phase = (ball.phase + (sp / 0.11) * dt) % (Math.PI * 2);
      if (Math.abs(ball.u) > pt.hl || Math.abs(ball.v) > pt.hw) {
        ball.u = Math.max(-pt.hl, Math.min(pt.hl, ball.u));
        ball.v = Math.max(-pt.hw, Math.min(pt.hw, ball.v));
        ball.vu *= -0.5;
        ball.vv *= -0.5;
      }
      g.kick -= dt;
    }
    // les deux plus proches du ballon
    let n1: Actor | null = null;
    let n2: Actor | null = null;
    let d1 = Infinity;
    let d2 = Infinity;
    if (ball)
      for (const a of kids) {
        const d = Math.hypot(a.u - ball.u, a.v - ball.v);
        if (d < d1) {
          n2 = n1;
          d2 = d1;
          n1 = a;
          d1 = d;
        } else if (d < d2) {
          n2 = a;
          d2 = d;
        }
      }
    for (const a of kids) {
      if (g.active && ball) {
        const chase = a === n1 || a === n2;
        if (chase) {
          a.tu = ball.u;
          a.tv = ball.v;
        } else if (Math.hypot(a.tu - a.u, a.tv - a.v) < 1 || Math.random() < dt * 0.3) {
          a.tu = Math.max(-pt.hl, Math.min(pt.hl, ball.u * 0.5 + (Math.random() - 0.5) * pt.hl));
          a.tv = Math.max(-pt.hw, Math.min(pt.hw, ball.v * 0.5 + (Math.random() - 0.5) * pt.hw));
        }
        const du = a.tu - a.u;
        const dv = a.tv - a.v;
        const dist = Math.hypot(du, dv);
        const speed = chase ? 3.6 : 2.2;
        if (dist > 0.4) {
          const step = Math.min(dist, speed * dt);
          a.u += (du / dist) * step;
          a.v += (dv / dist) * step;
          a.mode = PLAY;
          a.phase = (a.phase + (speed / 1.6) * Math.PI * 2 * dt) % (Math.PI * 2);
          // cap monde du déplacement
          a.yaw = turnTo(a.yaw, Math.atan2(pt.ux * du + vx * dv, pt.uz * du + vz * dv), dt * 6);
        } else a.mode = STAND;
        // tir : vers un point au hasard du terrain
        if (chase && d1 < 0.8 && a === n1 && g.kick <= 0) {
          const tu = (Math.random() < 0.5 ? -1 : 1) * pt.hl * (0.4 + Math.random() * 0.6);
          const tv = (Math.random() - 0.5) * pt.hw * 1.4;
          const L = Math.hypot(tu - ball.u, tv - ball.v) || 1;
          const v = 6 + Math.random() * 4;
          ball.vu = ((tu - ball.u) / L) * v;
          ball.vv = ((tv - ball.v) / L) * v;
          g.kick = 0.8 + Math.random() * 1.2;
        }
      } else {
        a.mode = STAND;
        if (ball) a.yaw = turnTo(a.yaw, Math.atan2(pt.ux * (ball.u - a.u) + vx * (ball.v - a.v), pt.uz * (ball.u - a.u) + vz * (ball.v - a.v)), dt * 2);
      }
      toWorld(a);
    }
    if (ball) toWorld(ball);
  }

  dispose(): void {
    this.reset();
    for (const b of this.batches) b.dispose();
    this.geo.dispose();
  }
}

/** Rapproche un cap d'un autre (au plus `step` radians), par le plus court. */
function turnTo(from: number, to: number, step: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + Math.max(-step, Math.min(step, d));
}
