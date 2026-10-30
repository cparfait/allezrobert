import * as THREE from 'three/webgpu';
import { Fn, If, abs, int, attribute, clamp, dot, float, floor, fract, fwidth, ivec2, length, max, min, mix, mod, smoothstep, step, texture, textureLoad, uniform, vec2, vec3 } from 'three/tsl';
import type { AvatarLook } from '@allezrobert/shared';
import { colorUniform } from '../engine/tsl.ts';

type Vec3Node = THREE.Node<'vec3'>;

/**
 * Motifs de maillot rendus dans le shader du tissu (avatar MPFB, cloth.ts) et du modèle acheté
 * (texturedLook.ts) : pois, manches, moitié, dégradé, chevrons. Ils s'appuient sur deux attributs
 * ajoutés au chargement (addJerseyFrame) : « jpos » (position au repos dans un repère aligné sur
 * le torse, en mètres : x latéral, y le long du torse depuis l'ourlet, z profondeur) et « jnor »
 * (normale dans ce repère). Indépendants des UV (îlots de tailles très variables sur le modèle
 * acheté) et de la pose (position de repos).
 */

export const JERSEY_PATTERNS = ['pois', 'manches', 'moitie', 'degrade', 'chevrons'] as const;

const BANDS_CENTER = 0.645;
/** Poches arrière : demi-largeur de l'ensemble des trois poches et hauteur au-dessus de l'ourlet (m). */
const POCKET_HALF_W = 0.15;
const POCKET_TOP = 0.17;
const BANDS_TOTAL = 0.225;
const BAND_MAX = 0.07;
const MAX_BANDS = 5;

/**
 * Logos de maillot (décalcomanie plane sur la poitrine et le dos) : images de public/models/avatar/logos/,
 * chargées à la demande (look.jerseyLogo), sources dans SOURCES.md.
 */
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
type LogoImage = { tex: THREE.Texture; aspect: number };
const logos = new Map<string, Promise<LogoImage | null>>();
const logosReady = new Map<string, LogoImage>();
/** Charge un logo à l'avance (banc d'essai : il faut qu'il soit prêt au premier rendu). */
export function preloadJerseyLogo(id: string): Promise<unknown> {
  return loadLogo(id);
}
function loadLogo(id: string): Promise<LogoImage | null> {
  let p = logos.get(id);
  if (!p) {
    p = new THREE.TextureLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/avatar/logos/${id}.png`)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.generateMipmaps = true;
        const img = tex.image as { width: number; height: number };
        const r = { tex, aspect: img.width / img.height };
        logosReady.set(id, r);
        return r;
      })
      .catch(() => null);
    logos.set(id, p);
  }
  return p;
}

/** Pois par défaut : rayon et pas (cm), ≈ 7 cm de diamètre pour 12 cm d'écart. */
export const DEFAULT_DOTS = { r: 3.5, step: 12 };

/**
 * Mesures du maillot (mètres) : longueur du torse (ourlet → col) et distance latérale où commence
 * la manche ; repère du torse (ay, az, s0) pour poser les mêmes attributs sur la peau des bras.
 */
export interface JerseyFrame {
  torsoLen: number;
  sleeveX: number;
  ay: THREE.Vector3;
  az: THREE.Vector3;
  s0: number;
  /** Tissu du maillot dans ce repère (maillot, bande d'accent, avant-bras des manches longues ; « jpos » et triangles) : centres des pois. */
  surface?: JerseySurface;
}

export interface JerseySurface {
  jp: Float32Array;
  index: ArrayLike<number> | null;
}

/** Repère du maillage : position au repos (monde de liaison) → « jpos », normales → « jnor ». */
function setFrameAttributes(mesh: THREE.Mesh, f: Pick<JerseyFrame, 'ay' | 'az' | 's0'>): Float32Array {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const m = ((mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh).bindMatrix : mesh.matrixWorld).clone();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const jp = new Float32Array(pos.count * 3);
  const jn = new Float32Array(pos.count * 3);
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    q.fromBufferAttribute(pos, i).applyMatrix4(m);
    jp.set([q.x, q.dot(f.ay) - f.s0, q.dot(f.az)], i * 3);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    jn.set([n.x, n.dot(f.ay), n.dot(f.az)], i * 3);
  }
  g.setAttribute('jpos', new THREE.BufferAttribute(jp, 3));
  g.setAttribute('jnor', new THREE.BufferAttribute(jn, 3));
  return jp;
}

/**
 * Pois du maillot, posés comme sur le vrai maillot de meilleur grimpeur : une grille de pas `step` projetée
 * de face (devant et dos : rangées et colonnes droites, une colonne au milieu), de côté (flancs) et de dessus
 * (épaules) : chaque triangle propose les points des projections face auxquelles il est assez tourné, les
 * mieux orientés passent d'abord et les autres comblent les trous (dos penché de la pose de liaison), à un
 * espacement minimal. Le shader dessine un disque autour du centre le plus proche (distance 3D) : pois ronds et
 * de même taille partout, quelles que soient les UV ; les anciens pois d'un treillis 3D étaient coupés partout
 * où la surface traverse une case. Centres en mètres dans le repère du maillot, gardés par pas.
 */
const centresCache = new WeakMap<JerseySurface, Map<number, Float32Array>>();
export function dotCentres(surface: JerseySurface, stepM: number): Float32Array {
  let byStep = centresCache.get(surface);
  if (!byStep) centresCache.set(surface, (byStep = new Map()));
  const hit = byStep.get(stepM);
  if (hit) return hit;
  const { jp, index } = surface;
  const tris = (index ? index.length : jp.length / 3) / 3;
  const vi = (t: number, c: number): number => (index ? (index[t * 3 + c] as number) : t * 3 + c);
  // Projections : axe de visée, puis les deux axes de la grille (0 : x, 1 : y le long du torse, 2 : z).
  const AXES: Array<[number, number, number]> = [
    [2, 0, 1],
    [0, 2, 1],
    [1, 0, 2],
  ];
  const cand: Array<{ p: [number, number, number]; prio: number }> = [];
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    for (let c = 0; c < 3; c++) (P[c] as THREE.Vector3).fromArray(jp, vi(t, c) * 3);
    const [A, B, C] = P as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const n = e1.subVectors(B, A).cross(e2.subVectors(C, A));
    const nl = n.length();
    if (nl < 1e-12) continue;
    for (let axis = 0; axis < AXES.length; axis++) {
      const [ax, ia, ib] = AXES[axis] as [number, number, number];
      const cos = Math.abs(n.getComponent(ax)) / nl;
      if (cos < 0.3) continue;
      // Devant / dos d'abord, puis par orientation : un point bien de face passe avant un point rasant.
      const prio = axis + (1 - cos);
      const a = [A.getComponent(ia), B.getComponent(ia), C.getComponent(ia)];
      const b = [A.getComponent(ib), B.getComponent(ib), C.getComponent(ib)];
      const det = ((a[1] as number) - (a[0] as number)) * ((b[2] as number) - (b[0] as number)) - ((a[2] as number) - (a[0] as number)) * ((b[1] as number) - (b[0] as number));
      if (Math.abs(det) < 1e-12) continue;
      // Colonne au milieu (x = 0) ; première rangée un demi-pas au-dessus de l'ourlet.
      const i0 = Math.ceil(Math.min(...a) / stepM);
      const i1 = Math.floor(Math.max(...a) / stepM);
      const j0 = Math.ceil(Math.min(...b) / stepM - 0.5);
      const j1 = Math.floor(Math.max(...b) / stepM - 0.5);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const pa = i * stepM;
          const pb = (j + 0.5) * stepM;
          const w1 = ((pa - (a[0] as number)) * ((b[2] as number) - (b[0] as number)) - ((a[2] as number) - (a[0] as number)) * (pb - (b[0] as number))) / det;
          const w2 = (((a[1] as number) - (a[0] as number)) * (pb - (b[0] as number)) - (pa - (a[0] as number)) * ((b[1] as number) - (b[0] as number))) / det;
          const w0 = 1 - w1 - w2;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          cand.push({ p: [A.x * w0 + B.x * w1 + C.x * w2, A.y * w0 + B.y * w1 + C.y * w2, A.z * w0 + B.z * w1 + C.z * w2], prio });
        }
    }
  }
  cand.sort((u, v) => u.prio - v.prio);
  // Doublons (plusieurs triangles, plusieurs projections) : un centre par voisinage de 0,85 pas.
  const minD = stepM * 0.85;
  const cell = (v: number) => Math.floor(v / minD);
  const grid = new Map<string, Array<[number, number, number]>>();
  const kept: number[] = [];
  for (const { p } of cand) {
    const [x, y, z] = p;
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++)
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dz = -1; dz <= 1 && !near; dz++)
          for (const q of grid.get(`${cell(x) + dx},${cell(y) + dy},${cell(z) + dz}`) ?? []) if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) < minD) near = true;
    if (near) continue;
    const key = `${cell(x)},${cell(y)},${cell(z)}`;
    const list = grid.get(key) ?? [];
    list.push(p);
    grid.set(key, list);
    kept.push(x, y, z);
  }
  const out = new Float32Array(kept);
  byStep.set(stepM, out);
  return out;
}

/** Centres rangés par case de `cell` mètres (4 au plus par case), texture lue par le shader. */
const DOT_SLOTS = 4;
const DOT_TEX_W = 256;
interface DotGrid {
  tex: THREE.DataTexture;
  origin: THREE.Vector3;
  dims: THREE.Vector3;
  cell: number;
}
function dotGrid(centres: Float32Array, cellM: number): DotGrid {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < centres.length; i += 3) {
    v.fromArray(centres, i);
    min.min(v);
    max.max(v);
  }
  if (!Number.isFinite(min.x)) min.set(0, 0, 0), max.set(0, 0, 0);
  const origin = min.clone().subScalar(cellM);
  const dims = max.clone().sub(origin).divideScalar(cellM).floor().addScalar(2);
  const cells = dims.x * dims.y * dims.z;
  const h = Math.max(1, Math.ceil((cells * DOT_SLOTS) / DOT_TEX_W));
  const data = new Float32Array(DOT_TEX_W * h * 4);
  const used = new Uint8Array(cells);
  for (let i = 0; i < centres.length; i += 3) {
    v.fromArray(centres, i);
    const c = v.clone().sub(origin).divideScalar(cellM).floor();
    const id = (c.z * dims.y + c.y) * dims.x + c.x;
    const slot = used[id] as number;
    if (slot >= DOT_SLOTS) continue;
    used[id] = slot + 1;
    data.set([v.x, v.y, v.z, 1], (id * DOT_SLOTS + slot) * 4);
  }
  const tex = new THREE.DataTexture(data, DOT_TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return { tex, origin, dims, cell: cellM };
}

/** Ajoute « jpos » et « jnor » à un autre maillage du maillot (bande d'accent) avec le repère du maillot. */
export function addFrameAttributes(mesh: THREE.Mesh, f: JerseyFrame): void {
  if (!mesh.geometry.getAttribute('position') || !mesh.geometry.getAttribute('normal')) return;
  // Bande de poitrine et poignets (« jersey_accent ») : peints aux couleurs et motifs du maillot, ils portent
  // aussi des pois.
  extendSurface(f, setFrameAttributes(mesh, f), mesh.geometry.index);
}

/**
 * Ajoute des triangles d'un autre maillage à la surface des pois (nouvel objet : les centres sont recalculés).
 * `keep` : seuls les triangles dont les trois sommets passent sont gardés.
 */
function extendSurface(f: JerseyFrame, jp: Float32Array, index: THREE.BufferAttribute | null, keep: (i: number) => boolean = () => true): void {
  const base = f.surface;
  if (!base) return;
  const n0 = base.jp.length / 3;
  const tris = (index ? index.count : jp.length / 3) / 3;
  const vi = (t: number, c: number): number => (index ? index.getX(t * 3 + c) : t * 3 + c);
  const baseIdx = base.index ?? Array.from({ length: n0 }, (_, i) => i);
  const idx: number[] = Array.from(baseIdx);
  for (let t = 0; t < tris; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    if (keep(a) && keep(b) && keep(c)) idx.push(n0 + a, n0 + b, n0 + c);
  }
  const all = new Float32Array(base.jp.length + jp.length);
  all.set(base.jp);
  all.set(jp, base.jp.length);
  f.surface = { jp: all, index: idx };
}

/**
 * Ajoute à la géométrie d'un maillot les attributs « jpos » et « jnor » (repère du torse au
 * repos, mètres). Repère : y le long du torse (de l'ourlet au col), x latéral, z = x × y.
 */
export function addJerseyFrame(mesh: THREE.Mesh): JerseyFrame | null {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  if (!pos || !nor) return null;
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
  const m = (skinned ? (mesh as THREE.SkinnedMesh).bindMatrix : mesh.matrixWorld).clone();
  const all: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) all.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
  // Axe du torse : du centre des sommets centraux les plus bas à celui des plus hauts.
  const centre = all.filter((q) => Math.abs(q.x) < 0.1);
  const pts = centre.length > 20 ? centre : all;
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const k = Math.max(1, Math.floor(sorted.length * 0.08));
  const mean = (a: THREE.Vector3[]) => a.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / a.length);
  const ay0 = mean(sorted.slice(-k)).sub(mean(sorted.slice(0, k))).normalize();
  const ax = new THREE.Vector3(1, 0, 0);
  const az = new THREE.Vector3().crossVectors(ax, ay0).normalize();
  const ay = new THREE.Vector3().crossVectors(az, ax).normalize();
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const q of pts) {
    s0 = Math.min(s0, q.dot(ay));
    s1 = Math.max(s1, q.dot(ay));
  }
  const len = s1 - s0;
  let torsoHalf = 0;
  for (const q of all) {
    const rel = (q.dot(ay) - s0) / len;
    if (rel > 0.12 && rel < 0.45) torsoHalf = Math.max(torsoHalf, Math.abs(q.x));
  }
  const jp = setFrameAttributes(mesh, { ay, az, s0 });
  return { torsoLen: len, sleeveX: torsoHalf + 0.012, ay, az, s0, surface: { jp, index: g.index ? g.index.array : null } };
}

/** Os des bras (squelette MPFB, et modèle acheté qui reprend ces noms) : épaule, coude, poignet. */
const ARM_BONES = {
  L: { upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
  R: { upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
} as const;

/** Où finit la manche longue sur l'avant-bras (fraction épaule → poignet) : juste avant la main. */
const CUFF_T = 0.965;

/**
 * Manches longues : prépare la peau des bras (« skin » MPFB, « tex_arms » du modèle acheté).
 * Ajoute « jpos », « jnor » (même repère que le maillot, donc pois et motifs continus) et « jsl » :
 * 1 sur le bras du coude au poignet, en dessous de l'ourlet de la manche courte (mesuré sur le
 * maillot), 0 ailleurs ; le shader y peint le tissu. Sommets et os sont pris dans l'espace des
 * sommets (pose de construction ; matrices inverses de liaison pour les os).
 */
export function addSleeveMask(mesh: THREE.SkinnedMesh, jersey: THREE.SkinnedMesh, frame: JerseyFrame): void {
  const g = mesh.geometry;
  if (!g.getAttribute('position') || !g.getAttribute('normal')) return;
  const sleeveJp = setFrameAttributes(mesh, frame);
  const pos = g.getAttribute('position');
  // « jsl » : −1 hors du bras, sinon t (0 épaule → 1 poignet) ; un seul attribut (8 tampons de sommets au plus).
  const jsl = new Float32Array(pos.count).fill(-1);
  const sk = mesh.skeleton;
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  if (!sk || !si || !sw || !jersey.skeleton) {
    g.setAttribute('jsl', new THREE.BufferAttribute(jsl, 1));
    return;
  }
  // Os dans l'espace des sommets de chaque maillage (la même pose de construction).
  const head = (m: THREE.SkinnedMesh, name: string): THREE.Vector3 | null => {
    const i = m.skeleton.bones.findIndex((b) => b.name === name);
    const inv = m.skeleton.boneInverses[i];
    return inv ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(m.bindMatrixInverse).multiply(inv.clone().invert())) : null;
  };
  const jpos = jersey.geometry.getAttribute('position');
  const jsi = jersey.geometry.getAttribute('skinIndex');
  const jsw = jersey.geometry.getAttribute('skinWeight');
  const v = new THREE.Vector3();
  for (const side of ['L', 'R'] as const) {
    const names = ARM_BONES[side];
    const shoulder = head(mesh, names.upper);
    const wrist = head(mesh, names.hand);
    const jShoulder = head(jersey, names.upper);
    const jWrist = head(jersey, names.hand);
    if (!shoulder || !wrist || !jShoulder || !jWrist) continue;
    const armOf = (m: THREE.SkinnedMesh, i: number, idx: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, w: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, withHand = false): number => {
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        const b = m.skeleton.bones[idx.getComponent(i, c)]?.name;
        if (b && ((/^(upperarm|lowerarm)/.test(b) && b.endsWith(`_${side.toLowerCase()}`)) || (withHand && (b === names.hand || (/^(thumb|index|middle|ring|pinky)/.test(b) && b.endsWith(`_${side.toLowerCase()}`)))))) sum += w.getComponent(i, c);
      }
      return sum;
    };
    // Ourlet de la manche courte : t maximal des sommets du maillot portés par ce bras.
    const jAxis = jWrist.clone().sub(jShoulder);
    const jLen = jAxis.length();
    jAxis.normalize();
    let tHem = 0;
    for (let i = 0; i < jpos.count; i++) {
      if (!jsi || !jsw || armOf(jersey, i, jsi, jsw) < 0.6) continue;
      v.fromBufferAttribute(jpos, i).sub(jShoulder);
      tHem = Math.max(tHem, v.dot(jAxis) / jLen);
    }
    const elbow = head(mesh, names.lower);
    const fore = elbow ? wrist.clone().sub(elbow).normalize() : wrist.clone().sub(shoulder).normalize();
    // Axe de la main (poignet → articulation du majeur) : le tissu s'arrête aussi devant ce plan.
    const knuckle = head(mesh, `middle_01_${side.toLowerCase()}`) ?? head(mesh, `index_01_${side.toLowerCase()}`);
    const handDir = knuckle ? knuckle.clone().sub(wrist).normalize() : fore.clone();
    const axis = wrist.clone().sub(shoulder);
    const len = axis.length();
    axis.normalize();
    // Masque NET (0 ou 1 par sommet, jamais de dégradé de poids) : le sommet appartient au bras s'il
    // est près de l'axe épaule → poignet et que le tronc, la jambe ou la tête ne le portent pas
    // (les os de torsion ou de correction du bras n'ont pas besoin d'être connus). La coupe au
    // poignet est faite dans le shader sur « jst » (t interpolé, donc franche).
    const torsoOf = (i: number): number => {
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        const b = mesh.skeleton.bones[si.getComponent(i, c)]?.name;
        if (b && /(pelvis|spine|neck|head|thigh|calf|foot|clavicle|breast)/.test(b)) sum += sw.getComponent(i, c);
      }
      return sum;
    };
    // Poids de la main et des doigts : leurs sommets ne portent jamais de tissu (main courbée au repos).
    const handOf = (i: number): number => {
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        const b = mesh.skeleton.bones[si.getComponent(i, c)]?.name;
        if (b && /(hand|thumb|index|middle|ring|pinky|finger)/.test(b)) sum += sw.getComponent(i, c);
      }
      return sum;
    };
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(shoulder);
      const t = v.dot(axis) / len;
      if (t < -0.02 || t > 1.6 || armOf(mesh, i, si, sw, true) < 0.25 || torsoOf(i) > 0.5) continue;
      // Distance au poignet le long de l'avant-bras (négative avant le poignet), décalée de +2 : > 1 sur le bras.
      // Coupe franche au poignet ; un sommet de la main passe « au-delà du poignet » (2 ou plus),
      // valeur continue avec celle de l'anneau du poignet : ni biseau ni dents.
      const rel = v.clone().add(shoulder).sub(wrist);
      const d = 2 + Math.max(rel.dot(fore), rel.dot(handDir) + 0.012) / len;
      jsl[i] = handOf(i) > 0.08 ? Math.max(d, 2) : d; // 4 : la coupe tombe contre l'anneau du poignet, pas dans la main
    }
  }
  // Jambes (chaussettes hautes, cuissard long) : jsl = −2 − u, u continu le long de la jambe pour
  // que l'interpolation ne coupe pas au genou : 0 à la hanche, 1 au genou, 2 à la cheville.
  // ≤ −2 n'est jamais un bras. Tout sommet porté (même un peu) par la cuisse ou le mollet est marqué.
  for (const side of ['l', 'r'] as const) {
    const hip = head(mesh, `thigh_${side}`);
    const knee = head(mesh, `calf_${side}`);
    const ankle = head(mesh, `foot_${side}`);
    if (!hip || !knee || !ankle) continue;
    const upper = knee.clone().sub(hip);
    const lower = ankle.clone().sub(knee);
    for (let i = 0; i < pos.count; i++) {
      let th = 0;
      let calf = 0;
      for (let c = 0; c < 4; c++) {
        const b = sk.bones[si.getComponent(i, c)]?.name;
        if (b === `thigh_${side}`) th += sw.getComponent(i, c);
        else if (b === `calf_${side}`) calf += sw.getComponent(i, c);
      }
      if (th + calf < 0.2) continue;
      v.fromBufferAttribute(pos, i);
      const u = calf >= th ? 1 + THREE.MathUtils.clamp(v.clone().sub(knee).dot(lower) / Math.max(lower.lengthSq(), 1e-9), 0, 1) : THREE.MathUtils.clamp(v.clone().sub(hip).dot(upper) / Math.max(upper.lengthSq(), 1e-9), 0, 1);
      jsl[i] = -2 - u;
    }
  }
  g.setAttribute('jsl', new THREE.BufferAttribute(jsl, 1));
  // Manche longue : le tissu peint sur l'avant-bras (1 ≤ jsl < 1,97, voir jerseySleeve) porte aussi des pois.
  extendSurface(frame, sleeveJp, g.index, (i) => (jsl[i] as number) >= 1 && (jsl[i] as number) < 1.97);
}

/** Où commencent les chaussettes hautes sur le mollet (fraction genou → cheville) ; les basses : 0,78 (maillage). */
export const SOCK_HIGH_T = 0.42;
/** Où le cuissard long commence sur la cuisse (fraction hanche → genou) : sous l'ourlet du cuissard (0,74 au maillage). */
export const SUIT_THIGH_T = 0.6;

export interface JerseyPatternNodes {
  /** Couleur du maillot avec le motif (base = couleur du maillot ; seconde couleur = look.jerseyAccent). */
  color(base: Vec3Node, accentShade?: THREE.Node<'float'> | number): Vec3Node;
  set(look: AvatarLook): void;
}

/**
 * Nœuds du motif d'un maillot. `sleeveX` : distance latérale (m) où commence la manche ;
 * `torsoLen` : longueur du torse (m, de l'ourlet au col).
 */
export function jerseyPattern(look: AvatarLook, opt: { sleeveX: number; torsoLen: number; bands?: boolean; surface?: JerseySurface }): JerseyPatternNodes {
  const accent = colorUniform(look.jerseyAccent);
  const mode = uniform(0);
  const dotR = uniform(0.035);
  const dotStep = uniform(0.12);
  const jp = attribute<'vec3'>('jpos', 'vec3');
  const jn = attribute<'vec3'>('jnor', 'vec3');
  const s = jp.y.div(opt.torsoLen); // 0 ourlet → 1 col
  const flag = (i: number) => step(i - 0.5, mode).mul(step(mode, i + 0.5));
  let dots: THREE.Node<'float'>;
  // Disque autour du centre le plus proche (dotCentres), cherché dans les 8 cases voisines.
  const loads: THREE.TextureNode[] = [];
  const gOrigin = uniform(new THREE.Vector3());
  const gDims = uniform(new THREE.Vector3(1, 1, 1));
  const gCell = uniform(0.065);
  let gridStep = 0;
  let gridSurface: JerseySurface | undefined;
  const surface = opt.surface;
  // Texture des centres : le corps du Fn n'est exécuté qu'à la compilation du matériau, souvent après set().
  const blankF = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  blankF.needsUpdate = true;
  let dotTex: THREE.Texture = blankF;
  if (surface) {
    dots = Fn(() => {
      const out = float(0).toVar();
      If(flag(1).greaterThan(0.5), () => {
        const best = float(1e3).toVar();
        const base = floor(jp.sub(gOrigin).div(gCell).sub(0.5));
        for (let o = 0; o < 8; o++) {
          const c = base.add(vec3(o & 1, (o >> 1) & 1, (o >> 2) & 1));
          const inside = step(0, c.x).mul(step(0, c.y)).mul(step(0, c.z)).mul(step(c.x, gDims.x.sub(1))).mul(step(c.y, gDims.y.sub(1))).mul(step(c.z, gDims.z.sub(1)));
          const cc = clamp(c, vec3(0), gDims.sub(1));
          const id = cc.z.mul(gDims.y).add(cc.y).mul(gDims.x).add(cc.x).mul(DOT_SLOTS);
          for (let k = 0; k < DOT_SLOTS; k++) {
            const t = id.add(k);
            const node = textureLoad(dotTex, ivec2(int(mod(t, DOT_TEX_W)), int(floor(t.div(DOT_TEX_W)))));
            loads.push(node);
            const d = length(node.xyz.sub(jp));
            best.assign(min(best, mix(float(1e3), d, node.w.mul(inside))));
          }
        }
        const aa = fwidth(best).mul(0.8).add(1e-4);
        out.assign(float(1).sub(smoothstep(dotR.sub(aa), dotR.add(aa), best)));
      });
      return out;
    })() as THREE.Node<'float'>;
  } else {
    // Sans surface connue : treillis 3D décalé une rangée sur deux ; disque perpendiculaire à la normale.
    const q = jp.div(dotStep);
    const qs = vec3(q.x.add(mod(floor(q.y), 2).mul(0.5)), q.y, q.z);
    const d3 = fract(qs).sub(0.5);
    const nrm = jn.add(1e-5).normalize(); // normale nulle : NaN → triangle noir
    const dist = length(d3.sub(nrm.mul(dot(d3, nrm))));
    const rr = dotR.div(dotStep);
    const aa = fwidth(dist).mul(0.8).add(1e-4);
    dots = float(1).sub(smoothstep(rr.sub(aa), rr.add(aa), dist)) as THREE.Node<'float'>;
  }
  // Manches : seconde couleur au-delà de sleeveX.
  const sleeve = smoothstep(opt.sleeveX - 0.006, opt.sleeveX + 0.006, abs(jp.x));
  // Moitié : bas du maillot (sous 45 % du torse), manches comprises.
  const half = float(1).sub(smoothstep(0.43, 0.47, s));
  // Dégradé : de la couleur du maillot (col) vers la seconde (ourlet).
  const grad = smoothstep(0.15, 0.85, float(1).sub(s));
  // Chevrons : bande en V sur la poitrine (devant seulement), pointe vers le bas.
  const v = s.sub(abs(jp.x).mul(0.55)).sub(0.42);
  const chev = step(0, v).mul(step(v, 0.1)).mul(step(0, jn.z));
  // Logo : devant (poitrine) et derrière (dos), lisible de l'extérieur ; largeur logoW (m).
  const logoW = uniform(0.16);
  const logoAspect = uniform(1);
  const logoTint = colorUniform('#ffffff');
  const logoTinted = uniform(0);
  const logoOn = uniform(0);
  const logoY = uniform(0.62);
  let want = ''; // logo demandé (une réponse tardive d'un ancien maillot est ignorée)
  const front = step(0.5, jn.z);
  const back = step(0.5, jn.z.negate());
  const lw = logoW.mul(float(1).sub(back.mul(0.15)));
  const lu = jp.x.mul(front.sub(back)).div(lw).add(0.5);
  const lv = jp.y.sub(logoY.mul(opt.torsoLen)).div(lw.div(logoAspect)).add(0.5);
  const inside = step(0, lu).mul(step(lu, 1)).mul(step(0, lv)).mul(step(lv, 1)).mul(front.add(back));
  const lg = texture(blank, vec2(lu, lv).clamp(0.001, 0.999));
  const logoAlpha = lg.a.mul(inside).mul(logoOn);
  const logoRgb = mix(lg.rgb, logoTint.node, logoTinted);
  // Bandes de poitrine (maillots de champion) : même répartition que le modèle acheté (texturedLook.ts).
  const nBands = uniform(0);
  const from = uniform(0.5);
  const height = uniform(0.05);
  const bandColors = Array.from({ length: MAX_BANDS }, () => colorUniform('#ffffff'));
  const rel = s.sub(from).div(height);
  const idx = floor(rel);
  const inBand = step(0, rel).mul(step(rel, nBands)).mul(step(abs(jp.x), opt.sleeveX));
  let band: Vec3Node = bandColors[0]!.node as Vec3Node;
  for (let i = 1; i < MAX_BANDS; i++) band = mix(band, bandColors[i]!.node, step(i, idx));
  // Poches arrière : trois poches au bas du dos (de l'ourlet à POCKET_TOP), coutures verticales, ouverture
  // sombre en haut avec l'ombre de l'intérieur juste dessous, tissu de la poche un peu plus sombre.
  const onBack = smoothstep(0.15, 0.4, jn.z.negate());
  const ax = abs(jp.x);
  const inPocket = step(ax, POCKET_HALF_W).mul(step(0.004, jp.y)).mul(step(jp.y, POCKET_TOP)).mul(onBack);
  const line = (d: THREE.Node<'float'>, w: number) => {
    const aa = fwidth(d).add(1e-4);
    return float(1).sub(smoothstep(float(w).sub(aa), float(w).add(aa), d));
  };
  const seams = max(line(abs(ax.sub(POCKET_HALF_W / 3)), 0.0025), line(abs(ax.sub(POCKET_HALF_W)), 0.0025));
  const opening = line(abs(jp.y.sub(POCKET_TOP)), 0.004);
  const inner = smoothstep(POCKET_TOP - 0.02, POCKET_TOP, jp.y);
  const pocket = float(1).sub(
    inPocket.mul(0.07).add(inPocket.mul(inner).mul(0.12)).add(seams.mul(inPocket).mul(0.3)).add(opening.mul(step(ax, POCKET_HALF_W)).mul(onBack).mul(0.55)),
  );
  return {
    color: (base, shade = 1) => {
      const w = clamp(flag(1).mul(dots).add(flag(2).mul(sleeve)).add(flag(3).mul(half)).add(flag(4).mul(grad)).add(flag(5).mul(chev)), 0, 1);
      const c = mix(base, accent.node.mul(shade), w);
      const d = opt.bands ? mix(c, band, inBand) : c;
      return mix(d, logoRgb, logoAlpha).mul(pocket);
    },
    set: (l) => {
      const lg0 = l.jerseyLogo;
      logoOn.value = 0;
      if (lg0) {
        const show = (r: LogoImage) => {
          lg.value = r.tex;
          logoAspect.value = r.aspect;
          logoW.value = lg0.w ?? 0.16;
          logoY.value = lg0.y ?? 0.62;
          logoTinted.value = lg0.tint ? 1 : 0;
          if (lg0.tint) logoTint.set(lg0.tint);
          logoOn.value = 1;
          want = lg0.id;
        };
        want = lg0.id;
        const ready = logosReady.get(lg0.id);
        if (ready) show(ready);
        else void loadLogo(lg0.id).then((r) => r && want === lg0.id && show(r));
      } else {
        want = '';
      }
      const b = l.jerseyStyle === 'bandes' ? (l.jerseyBands ?? []).slice(0, MAX_BANDS).reverse() : [];
      const h = b.length ? Math.min(BAND_MAX, BANDS_TOTAL / b.length) : 0.05;
      nBands.value = b.length;
      height.value = h;
      from.value = BANDS_CENTER - (h * b.length) / 2;
      b.forEach((c, i) => bandColors[i]?.set(c));
      accent.set(l.jerseyAccent);
      mode.value = (JERSEY_PATTERNS as readonly string[]).indexOf(l.jerseyStyle ?? '') + 1;
      const d = l.jerseyDots ?? DEFAULT_DOTS;
      dotR.value = d.r / 100;
      dotStep.value = d.step / 100;
      // Centres des pois du maillot réaliste : recalculés quand le pas change (gardés par pas).
      // (surface relue ici : la bande d'accent et les manches longues l'étendent après la création du motif)
      const surf = opt.surface;
      if (surf && l.jerseyStyle === 'pois' && (gridStep !== d.step || gridSurface !== surf)) {
        gridStep = d.step;
        gridSurface = surf;
        const grid = dotGrid(dotCentres(surf, d.step / 100), d.step / 100);
        dotTex = grid.tex;
        for (const n of loads) n.value = grid.tex;
        gOrigin.value.copy(grid.origin);
        gDims.value.copy(grid.dims);
        gCell.value = grid.cell;
      }
    },
  };
}

export interface SleeveNodes {
  /** Part de tissu sur ce sommet (0 : peau ; 1 : manche longue du maillot). */
  weight: THREE.Node<'float'>;
  /** Couleur du tissu (maillot, motifs et accent compris), à mélanger à la peau avec `weight`. */
  color: Vec3Node;
  set(look: AvatarLook): void;
}

/** Manche longue peinte sur la peau du bras : tissu du maillot (couleur, motifs) là où « jsl » = 1. */
export function jerseySleeve(look: AvatarLook, frame: JerseyFrame): SleeveNodes {
  const main = colorUniform(look.jersey);
  const pattern = jerseyPattern(look, frame);
  const long = uniform(0);
  // Masque franc : 1 sur le bras jusqu'au poignet (coupe nette sur t interpolé), 0 sur la main.
  const t = attribute<'float'>('jsl', 'float');
  // t = 2 + distance au poignet / longueur du bras : coupe franche 1,6 cm avant le poignet.
  const weight = step(1, t).mul(float(1).sub(smoothstep(1.967, 1.982, t))).mul(long);
  return {
    weight: weight as THREE.Node<'float'>,
    color: pattern.color(main.node as Vec3Node),
    set: (l) => {
      main.set(l.jersey);
      pattern.set(l);
      long.value = l.sleeves === 'long' ? 1 : 0;
    },
  };
}

/**
 * Bande d'accent du maillot MPFB (« jersey_accent ») :
 * - avec les manches longues, la partie qui borde la manche courte (au-delà de sleeveX) prend la
 *   couleur et le motif du maillot ;
 * - sans style choisi (look.jerseyStyle absent, le maillot par défaut), la bande de poitrine
 *   (en deçà de sleeveX) prend aussi la couleur du maillot : pas de bande sur le torse. Seul le
 *   liseré au bout des manches courtes garde la couleur d'accent.
 */
export function jerseySleeveEdge(look: AvatarLook, frame: JerseyFrame): { weight: THREE.Node<'float'>; color: Vec3Node; set(look: AvatarLook): void } {
  const main = colorUniform(look.jersey);
  const pattern = jerseyPattern(look, frame);
  const long = uniform(0);
  const plain = uniform(0);
  const jp = attribute<'vec3'>('jpos', 'vec3');
  // 1 au-delà de la limite torse / manche (bout de manche), 0 sur le torse.
  const cuff = step(frame.sleeveX - 0.01, abs(jp.x));
  return {
    weight: max(cuff.mul(long), float(1).sub(cuff).mul(plain)) as THREE.Node<'float'>,
    color: pattern.color(main.node as Vec3Node),
    set: (l) => {
      main.set(l.jersey);
      pattern.set(l);
      long.value = l.sleeves === 'long' ? 1 : 0;
      plain.value = 1; // jamais de bande d'accent sur le torse (maillot uni, à pois, à motif…) : couleur et motif du maillot
    },
  };
}
