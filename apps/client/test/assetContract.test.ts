/**
 * Contrat des modèles 3D (audit n° 3, étape E0.1) : protège l'état ACTUEL des GLB de coureurs et de vélos
 * tel que le jeu les charge (rider/gltfAvatar.ts, rider/bikes.ts), sans rien modifier.
 *
 * Lecture en mémoire uniquement :
 *  - bloc JSON du glTF : noms, hiérarchie, transformations des nœuds (pose de repos), métadonnées min/max des
 *    accesseurs (non compressés pour les vélos : positions en mètres) ;
 *  - bloc binaire, seulement là où c'est nécessaire (matrices inverses de liaison, poids des os) : décodé par le
 *    décodeur meshopt de three.js déjà utilisé par le jeu (aucun outil ajouté).
 *
 * Trois parties distinctes :
 *  1. contrats respectés (doivent rester vrais) ;
 *  2. écarts connus (D3, D4… de l'audit), protégés tels quels : ce ne sont PAS des géométries correctes ;
 *     quand un écart est corrigé, son test échoue et doit être remplacé par le contrôle strict indiqué ;
 *  3. contrôles non exécutés (it.todo), avec leur motif.
 *
 * Repère du client : +x gauche du coureur, +y haut, +z avant, mètres, origine au sol sous le pédalier.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BIKE_FAMILIES, DEFAULT_BIKE, FACE_SLIDERS } from '@allezrobert/shared';

// ---------------------------------------------------------------------------------------------
// Lecture des GLB (en mémoire)
// ---------------------------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

interface GNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  translation?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
}
interface GPrimitive {
  attributes: Record<string, number>;
  material?: number;
  targets?: unknown[];
}
interface GMesh {
  name?: string;
  primitives: GPrimitive[];
  extras?: { targetNames?: string[] };
}
interface GAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}
interface GMeshopt {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
  filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}
interface GBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: GMeshopt };
}
interface Gltf {
  extensionsUsed?: string[];
  scenes: Array<{ nodes: number[] }>;
  nodes: GNode[];
  meshes?: GMesh[];
  materials?: Array<{ name?: string }>;
  skins?: Array<{ joints: number[]; inverseBindMatrices?: number }>;
  accessors: GAccessor[];
  bufferViews: GBufferView[];
}
interface Glb {
  file: string;
  json: Gltf;
  bin: Uint8Array | null;
}

const MODELS = fileURLToPath(new URL('../public/models/', import.meta.url));
const has = (rel: string): boolean => existsSync(MODELS + rel);
const cache = new Map<string, Glb>();

/** En-tête GLB (magie « glTF », version 2), bloc JSON puis bloc BIN facultatif. */
function readGlb(rel: string): Glb {
  const hit = cache.get(rel);
  if (hit) return hit;
  const b = readFileSync(MODELS + rel);
  expect(b.toString('ascii', 0, 4), `${rel} : en-tête GLB`).toBe('glTF');
  expect(b.readUInt32LE(4), `${rel} : version glTF`).toBe(2);
  const jsonLen = b.readUInt32LE(12);
  expect(b.readUInt32LE(16), `${rel} : premier bloc JSON`).toBe(0x4e4f534a);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen)) as Gltf;
  const binAt = 20 + jsonLen;
  let bin: Uint8Array | null = null;
  if (b.length >= binAt + 8 && b.readUInt32LE(binAt + 4) === 0x004e4942) {
    const len = b.readUInt32LE(binAt);
    bin = new Uint8Array(b.buffer, b.byteOffset + binAt + 8, len);
  }
  const out = { file: rel, json, bin };
  cache.set(rel, out);
  return out;
}

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q: Quat, v: Vec3): Vec3 => {
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
};

interface WorldNode {
  index: number;
  parent: string | null;
  pos: Vec3;
}

/** Nœuds par nom : parent et position dans le repère de la scène (transformations du JSON, pose de repos). */
function worldNodes(g: Glb): Map<string, WorldNode> {
  const out = new Map<string, WorldNode>();
  const { nodes } = g.json;
  const walk = (i: number, parent: string | null, pq: Quat, pt: Vec3, ps: Vec3): void => {
    const n = nodes[i] as GNode;
    const t = n.translation ?? [0, 0, 0];
    const s = n.scale ?? [1, 1, 1];
    const local = qrot(pq, [t[0] * ps[0], t[1] * ps[1], t[2] * ps[2]]);
    const pos: Vec3 = [pt[0] + local[0], pt[1] + local[1], pt[2] + local[2]];
    const q = qmul(pq, n.rotation ?? [0, 0, 0, 1]);
    if (n.name) out.set(n.name, { index: i, parent, pos });
    for (const c of n.children ?? []) walk(c, n.name ?? null, q, pos, [ps[0] * s[0], ps[1] * s[1], ps[2] * s[2]]);
  };
  for (const r of g.json.scenes[0]?.nodes ?? []) walk(r, null, [0, 0, 0, 1], [0, 0, 0], [1, 1, 1]);
  return out;
}

/** Données d'une vue de tampon (décodée par meshopt si elle est compressée). */
async function viewBytes(g: Glb, vi: number): Promise<{ bytes: Uint8Array; stride: number | undefined }> {
  const bv = g.json.bufferViews[vi] as GBufferView;
  if (!g.bin) throw new Error(`${g.file} : pas de bloc binaire`);
  const ext = bv.extensions?.EXT_meshopt_compression;
  if (ext) {
    await MeshoptDecoder.ready;
    expect(ext.buffer, `${g.file} : tampon compressé dans le bloc BIN`).toBe(0);
    const src = g.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
    return { bytes: out, stride: ext.byteStride };
  }
  expect(bv.buffer, `${g.file} : vue dans le bloc BIN`).toBe(0);
  return { bytes: g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride };
}

/** Matrices inverses de liaison d'un squelette (Float32, colonne par colonne). */
async function inverseBindMatrices(g: Glb, skin: number): Promise<Float32Array> {
  const s = g.json.skins?.[skin];
  const acc = g.json.accessors[s?.inverseBindMatrices ?? -1] as GAccessor;
  expect(acc.componentType).toBe(5126);
  const { bytes } = await viewBytes(g, acc.bufferView as number);
  const copy = bytes.slice(acc.byteOffset ?? 0, (acc.byteOffset ?? 0) + acc.count * 64);
  return new Float32Array(copy.buffer, copy.byteOffset, acc.count * 16);
}

/** Lecture d'une composante d'attribut (entier ou normalisé, selon le type glTF). */
function component(dv: DataView, off: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5121:
      return normalized ? dv.getUint8(off) / 255 : dv.getUint8(off);
    case 5123:
      return normalized ? dv.getUint16(off, true) / 65535 : dv.getUint16(off, true);
    case 5126:
      return dv.getFloat32(off, true);
    default:
      throw new Error(`type de composante non géré : ${type}`);
  }
}
const SIZE: Record<number, number> = { 5121: 1, 5123: 2, 5126: 4 };

/** Os qui portent au moins un sommet (poids > 1 %), tous maillages du fichier confondus. */
async function weightedJoints(g: Glb): Promise<Set<string>> {
  const used = new Set<string>();
  const { json } = g;
  for (const node of json.nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const joints = (json.skins?.[node.skin]?.joints ?? []).map((j) => json.nodes[j]?.name ?? '');
    for (const p of json.meshes?.[node.mesh]?.primitives ?? []) {
      const ja = json.accessors[p.attributes.JOINTS_0 as number] as GAccessor;
      const wa = json.accessors[p.attributes.WEIGHTS_0 as number] as GAccessor;
      const jv = await viewBytes(g, ja.bufferView as number);
      const wv = await viewBytes(g, wa.bufferView as number);
      const js = jv.stride ?? 4 * (SIZE[ja.componentType] as number);
      const ws = wv.stride ?? 4 * (SIZE[wa.componentType] as number);
      const jd = new DataView(jv.bytes.buffer, jv.bytes.byteOffset, jv.bytes.byteLength);
      const wd = new DataView(wv.bytes.buffer, wv.bytes.byteOffset, wv.bytes.byteLength);
      for (let i = 0; i < ja.count; i++) {
        for (let c = 0; c < 4; c++) {
          const w = component(wd, (wa.byteOffset ?? 0) + i * ws + c * (SIZE[wa.componentType] as number), wa.componentType, wa.componentType !== 5126);
          if (w > 0.01) used.add(joints[component(jd, (ja.byteOffset ?? 0) + i * js + c * (SIZE[ja.componentType] as number), ja.componentType, false)] ?? '?');
        }
      }
    }
  }
  return used;
}

const meshNodeNames = (g: Glb): string[] => g.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name ?? '');
const materialNames = (g: Glb): string[] => (g.json.materials ?? []).map((m) => m.name ?? '');
const close = (a: readonly number[], b: readonly number[], tol: number, label: string): void => {
  for (let k = 0; k < 3; k++) expect(Math.abs((a[k] as number) - (b[k] as number)), `${label} [${'xyz'[k]}] ${a[k]} ≠ ${b[k]}`).toBeLessThanOrEqual(tol);
};
const mirror = (v: readonly number[]): Vec3 => [-(v[0] as number), v[1] as number, v[2] as number];
const nodeT = (g: Glb, name: string): GNode | undefined => g.json.nodes.find((n) => n.name === name);

// ---------------------------------------------------------------------------------------------
// Coureurs
// ---------------------------------------------------------------------------------------------

/** 52 os communs aux squelettes « game_engine » (MPFB) et Unreal (Tripo, kit acheté), noms exacts. */
const CORE_BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  ...['l', 'r'].flatMap((s) => [
    `clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`,
    ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((k) => `${f}_0${k}_${s}`)),
    `thigh_${s}`, `calf_${s}`, `foot_${s}`, `ball_${s}`,
  ]),
];
/** Os de torsion des squelettes Unreal (Tripo, kit acheté). */
const TWIST_BONES = ['l', 'r'].flatMap((s) => [`upperarm_twist_01_${s}`, `lowerarm_twist_01_${s}`, `thigh_twist_01_${s}`, `calf_twist_01_${s}`]);
/** Squelette de l'ancien coureur (cyclist.glb, ?avatar=classic). */
const CLASSIC_BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];

/**
 * Rôles pilotés par la cinématique inverse → nom de l'os, recopiés de RIG_BONES (rider/gltfAvatar.ts, non exporté).
 * Si RIG_BONES change, cette table doit changer avec lui. `parent` : rôle parent attendu (buildTemplates prend
 * pour repère du squelette le parent du seul rôle sans parent-rôle, le bassin).
 */
type Role = { role: string; mpfb: string; classic?: string; parent: string | null; optional?: boolean };
const ROLES: Role[] = [
  { role: 'hips', mpfb: 'pelvis', classic: 'hips', parent: null },
  { role: 'spine', mpfb: 'spine_01', classic: 'spine', parent: 'hips' },
  { role: 'spine2', mpfb: 'spine_02', parent: 'spine', optional: true },
  { role: 'chest', mpfb: 'spine_03', classic: 'chest', parent: 'spine2|spine' },
  { role: 'neck', mpfb: 'neck_01', classic: 'neck', parent: 'chest' },
  { role: 'head', mpfb: 'head', classic: 'head', parent: 'neck' },
  ...(['L', 'R'] as const).flatMap((S): Role[] => {
    const s = S.toLowerCase();
    return [
      { role: `clavicle_${S}`, mpfb: `clavicle_${s}`, parent: 'chest', optional: true },
      { role: `upper_arm_${S}`, mpfb: `upperarm_${s}`, classic: `upper_arm_${S}`, parent: `clavicle_${S}|chest` },
      { role: `forearm_${S}`, mpfb: `lowerarm_${s}`, classic: `forearm_${S}`, parent: `upper_arm_${S}` },
      { role: `hand_${S}`, mpfb: `hand_${s}`, classic: `hand_${S}`, parent: `forearm_${S}` },
      { role: `thigh_${S}`, mpfb: `thigh_${s}`, classic: `thigh_${S}`, parent: 'hips' },
      { role: `shin_${S}`, mpfb: `calf_${s}`, classic: `shin_${S}`, parent: `thigh_${S}` },
      { role: `foot_${S}`, mpfb: `foot_${s}`, classic: `foot_${S}`, parent: `shin_${S}` },
    ];
  }),
];

/** Coques de cheveux tête nue (HAIR_SHELL de rider/gltfAvatar.ts, objets `rider_hairs_<nom>`). */
const HAIR_SHELLS = ['cut', 'slick', 'fade', 'curls', 'bob', 'quiff', 'long'];
/** Objets cherchés par nom dans le modèle MPFB (constructeur et applyHair / applyHeadgear de gltfAvatar.ts). */
const MPFB_PARTS = [
  'rider_body', 'rider_eyes', 'rider_glasses', 'rider_hair', 'rider_hair_ponytail', 'rider_hair_braid', 'rider_hair_bun', 'rider_hair_plait',
  'rider_hair_dutch0', 'rider_hair_dutch1', 'rider_hair_dutchtail0', 'rider_hair_dutchtail1', ...HAIR_SHELLS.map((h) => `rider_hairs_${h}`),
  'rider_helmet', 'rider_helmet_aero', 'rider_helmet_straps', 'rider_moustache',
];
/** Matériaux recolorés ou texturés par nom (MATERIALS, cloth.ts, skin.ts, jerseyPattern.ts : maillot, cuissard, chaussettes…). */
const MPFB_MATERIALS = ['skin', 'jersey', 'jersey_accent', 'shorts', 'sock', 'hair', 'helmet', 'helmet_detail', 'lens', 'glasses_frame', 'eye', 'iris', 'shoe', 'shoe_sole', 'shoe_lining', 'cleat', 'cleat_pad', 'shoe_dial', 'mouth', 'lashes'];
/** Modèles texturés (kit acheté, Tripo) : matériaux « tex_* » gardés tels quels, maillot et bras reconnus par nom. */
const TEXTURED_MATERIALS = ['tex_head', 'tex_jersey', 'tex_shorts', 'tex_arms', 'tex_legs'];

/**
 * Cheville sur la pédale (pédale à BB ± CRANK, plus ANKLE_FLAT de build_avatar.py tourné de REST_PITCH) :
 * pédale en bas (manivelle verticale, y 0,0975) → cheville à y 0,2313 ; pédale en haut (y 0,4425) → y 0,5763.
 * Pied gauche en bas pour tous les modèles ; pied droit en bas aussi (« pieds au même niveau », MPFB depuis le
 * 29/10/2026 et Tripo) ou en haut (manivelle 0 : kit acheté, ancien coureur). Le moteur gère les deux cas
 * (gltfAvatar.ts, buildTemplates : `level`).
 */
const FOOT_L: Vec3 = [0.105, 0.2313, -0.0895];
const FOOT_R_UP: Vec3 = [-0.105, 0.5763, -0.0895];

interface AvatarSpec {
  kind: string;
  files: string[];
  rig: 'mpfb' | 'classic';
  joints: string[];
  /** Os sans aucun poids (mesuré sur le niveau 0). */
  unweighted?: string[];
  /** Main gauche au repos (poignet). */
  hand: Vec3;
  /** Tolérance de symétrie gauche/droite des mains (m). */
  handSym: number;
  /** Pied droit au repos : en bas comme le gauche (défaut) ou en haut (manivelle 0). */
  footR?: 'down' | 'up';
}

const AVATARS: AvatarSpec[] = [
  {
    kind: 'MPFB (défaut, hommes et femmes)',
    files: ['avatar/rider.glb', 'avatar/rider_lod1.glb', 'avatar/rider_lod2.glb'],
    rig: 'mpfb',
    joints: ['Root', ...CORE_BONES],
    unweighted: ['Root', 'ball_l', 'ball_r'],
    hand: [0.2, 0.976, 0.465],
    handSym: 1e-3,
  },
  {
    kind: 'MPFB féminin dédié (?femmes=modele)',
    files: ['avatar/rider_female.glb', 'avatar/rider_female_lod1.glb', 'avatar/rider_female_lod2.glb'],
    rig: 'mpfb',
    joints: ['Root', ...CORE_BONES],
    unweighted: ['Root', 'ball_l', 'ball_r'],
    hand: [0.2, 0.976, 0.465],
    handSym: 1e-3,
  },
  {
    kind: 'kit acheté (?avatar=boutique)',
    files: ['avatar/boutique/rider.glb', 'avatar/boutique/rider_lod1.glb', 'avatar/boutique/rider_lod2.glb'],
    rig: 'mpfb',
    joints: [...CORE_BONES, ...TWIST_BONES],
    unweighted: ['thigh_twist_01_l', 'thigh_twist_01_r', 'calf_twist_01_l', 'calf_twist_01_r'],
    hand: [0.2, 0.976, 0.465],
    handSym: 1e-3,
    footR: 'up',
  },
  {
    kind: 'Tripo homme (?avatar=tripo)',
    files: ['avatar/tripo/rider.glb', 'avatar/tripo/rider_lod1.glb', 'avatar/tripo/rider_lod2.glb'],
    rig: 'mpfb',
    joints: [...CORE_BONES, ...TWIST_BONES],
    unweighted: ['thigh_twist_01_l', 'thigh_twist_01_r', 'calf_twist_01_l', 'calf_twist_01_r'],
    hand: [0.2, 0.8969, 0.5],
    handSym: 2e-3,
  },
  {
    kind: 'Tripo femme (?avatar=tripo-femme)',
    files: ['avatar/tripo-femme/rider.glb', 'avatar/tripo-femme/rider_lod1.glb', 'avatar/tripo-femme/rider_lod2.glb'],
    rig: 'mpfb',
    joints: [...CORE_BONES, ...TWIST_BONES],
    unweighted: ['thigh_twist_01_l', 'thigh_twist_01_r', 'calf_twist_01_l', 'calf_twist_01_r'],
    hand: [0.2, 0.8973, 0.5089],
    handSym: 2e-3,
  },
  {
    kind: 'ancien coureur (?avatar=classic)',
    files: ['cyclist.glb', 'cyclist_lod1.glb'],
    rig: 'classic',
    joints: CLASSIC_BONES,
    hand: [0.2, 0.958, 0.54],
    handSym: 1e-3,
    footR: 'up',
  },
];

describe('inventaire des coureurs', () => {
  it('tous les fichiers de coureurs sont présents, sauf éventuellement Tripo (non suivi par Git : tests ignorés et signalés)', () => {
    const missing = AVATARS.flatMap((a) => a.files).filter((f) => !has(f));
    // Les dossiers Tripo ne sont pas suivis par Git à la date de l'audit : absents d'un clone, leurs tests sont ignorés (voir describe.skipIf).
    expect(missing.every((f) => f.startsWith('avatar/tripo')), `fichiers manquants : ${missing.join(', ')}`).toBe(true);
  });
});

for (const spec of AVATARS) {
  const present = spec.files.every(has);
  describe.skipIf(!present)(`coureur ${spec.kind}${present ? '' : ' — IGNORÉ : fichiers absents'}`, () => {
    const lod0 = (): Glb => readGlb(spec.files[0] as string);

    describe.each(spec.files)('%s', (file) => {
      it('un seul squelette partagé par tous les maillages, os attendus aux noms exacts', () => {
        const g = readGlb(file);
        const skins = g.json.skins ?? [];
        expect(skins.length).toBeGreaterThan(0);
        const first = JSON.stringify(skins[0]?.joints);
        for (const s of skins) expect(JSON.stringify(s.joints)).toBe(first);
        const names = (skins[0]?.joints ?? []).map((j) => g.json.nodes[j]?.name);
        expect(names).toHaveLength(spec.joints.length);
        expect([...names].sort()).toEqual([...spec.joints].sort());
      });

      it('rôles de la cinématique inverse présents, hiérarchie attendue (seul le bassin a un parent hors rôles)', () => {
        const w = worldNodes(readGlb(file));
        const nameOf = (r: Role): string | undefined => (spec.rig === 'mpfb' ? r.mpfb : r.classic);
        const present = new Map<string, string>();
        for (const r of ROLES) {
          const n = nameOf(r);
          if (!n) {
            expect(r.optional, `rôle ${r.role} sans os dans le squelette ${spec.rig}`).toBe(true);
            continue;
          }
          expect(w.has(n), `os ${n} (rôle ${r.role})`).toBe(true);
          present.set(r.role, n);
        }
        const roleOfNode = new Map([...present].map(([role, n]) => [n, role]));
        for (const [role, n] of present) {
          const spec2 = ROLES.find((r) => r.role === role) as Role;
          const parentRole = roleOfNode.get(w.get(n)?.parent ?? '') ?? null;
          if (spec2.parent === null) expect(parentRole, `${n} : parent hors rôles attendu`).toBeNull();
          else expect(spec2.parent.split('|').filter((p) => present.has(p))[0], `${n} : parent ${w.get(n)?.parent}`).toBe(parentRole);
        }
      });

      it('pose de repos = pose de pédalage (mains sur les cocottes, pieds sur les pédales en bas), Y vers le haut, Z vers l\'avant', () => {
        const w = worldNodes(readGlb(file));
        const n = (mpfb: string, classic: string): Vec3 => (w.get(spec.rig === 'mpfb' ? mpfb : classic)?.pos ?? [Number.NaN, Number.NaN, Number.NaN]) as Vec3;
        const handL = n('hand_l', 'hand_L');
        const handR = n('hand_r', 'hand_R');
        const footL = n('foot_l', 'foot_L');
        const footR = n('foot_r', 'foot_R');
        const hips = n('pelvis', 'hips');
        close(handL, spec.hand, 1e-3, 'main gauche');
        close(handR, mirror(handL), spec.handSym, 'main droite (miroir)');
        close(footL, FOOT_L, 1e-3, 'pied gauche');
        if (spec.footR === 'up') close(footR, FOOT_R_UP, 1e-3, 'pied droit (pédale en haut, manivelle 0)');
        else close(footR, mirror(FOOT_L), 1e-3, 'pied droit (pédale en bas, miroir du gauche)');
        // Conventions : bassin au-dessus des pieds, mains devant le bassin, gauche = +x.
        expect(hips[1]).toBeGreaterThan(footL[1] + 0.6);
        expect(handL[2]).toBeGreaterThan(hips[2]);
        expect(handL[0]).toBeGreaterThan(0);
      });
    });

    it('niveaux de détail : même squelette et même pose de repos que le niveau 0 (ils sont liés à ses os)', () => {
      const ref = worldNodes(lod0());
      for (const f of spec.files.slice(1)) {
        const w = worldNodes(readGlb(f));
        for (const j of spec.joints) close(w.get(j)?.pos ?? [Number.NaN, 0, 0], ref.get(j)?.pos ?? [0, 0, 0], 1e-4, `${f} : ${j}`);
      }
    });

    it('pose de liaison (matrices inverses, bloc binaire décodé) identique à la pose de repos des nœuds', async () => {
      const g = lod0();
      const w = worldNodes(g);
      const ibm = await inverseBindMatrices(g, 0);
      const names = (g.json.skins?.[0]?.joints ?? []).map((j) => g.json.nodes[j]?.name ?? '');
      // Position de liaison d'un os : −Rᵀ·t de sa matrice inverse ; échelle uniforme de la quantification des sommets (compress.mjs).
      const bind = (name: string): { p: Vec3; s: number } => {
        const k = names.indexOf(name);
        const m = ibm.subarray(k * 16, k * 16 + 16);
        const s = Math.hypot(m[0] as number, m[1] as number, m[2] as number);
        const t = [m[12], m[13], m[14]] as Vec3;
        const p = [0, 1, 2].map((c) => -((m[c * 4] as number) * t[0] + (m[c * 4 + 1] as number) * t[1] + (m[c * 4 + 2] as number) * t[2]) / (s * s)) as Vec3;
        return { p, s };
      };
      const hips = spec.rig === 'mpfb' ? 'pelvis' : 'hips';
      const b0 = bind(hips);
      for (const j of spec.rig === 'mpfb' ? ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'head', 'lowerarm_l', 'calf_l'] : ['hand_L', 'hand_R', 'foot_L', 'foot_R', 'head', 'forearm_L', 'shin_L']) {
        const b = bind(j);
        expect(b.s, `${j} : échelle de liaison uniforme`).toBeCloseTo(b0.s, 5);
        const fromBind = [0, 1, 2].map((c) => ((b.p[c] as number) - (b0.p[c] as number)) * b0.s) as Vec3;
        const rj = w.get(j)?.pos as Vec3;
        const rh = w.get(hips)?.pos as Vec3;
        close(fromBind, [rj[0] - rh[0], rj[1] - rh[1], rj[2] - rh[2]], 1e-3, `${j} − bassin`);
      }
    });

    if (spec.unweighted) {
      it('os sans poids (bloc binaire décodé) : seulement ceux connus', async () => {
        const used = await weightedJoints(lod0());
        const unweighted = spec.joints.filter((j) => !used.has(j));
        expect(unweighted.sort()).toEqual([...(spec.unweighted as string[])].sort());
      });
    }

    if (spec.joints.includes('upperarm_twist_01_l')) {
      it('os de torsion : enfants de l\'os qu\'ils doublent (non pilotés par la cinématique inverse)', () => {
        const w = worldNodes(lod0());
        for (const s of ['l', 'r']) {
          expect(w.get(`upperarm_twist_01_${s}`)?.parent).toBe(`upperarm_${s}`);
          expect(w.get(`lowerarm_twist_01_${s}`)?.parent).toBe(`lowerarm_${s}`);
          expect(w.get(`thigh_twist_01_${s}`)?.parent).toBe(`thigh_${s}`);
          expect(w.get(`calf_twist_01_${s}`)?.parent).toBe(`calf_${s}`);
        }
      });
    }

    if (spec.joints.includes('middle_01_l')) {
      it('doigts présents (paume calculée entre le poignet et middle_01 ; doigts fléchis sur le cintre)', () => {
        const w = worldNodes(lod0());
        for (const s of ['l', 'r']) for (const f of ['index', 'middle', 'ring', 'pinky']) for (const k of [1, 2, 3]) expect(w.has(`${f}_0${k}_${s}`)).toBe(true);
      });
    }
  });
}

describe('MPFB : objets et matériaux cherchés par nom', () => {
  const files = ['avatar/rider.glb', 'avatar/rider_lod1.glb', 'avatar/rider_lod2.glb', 'avatar/rider_female.glb', 'avatar/rider_female_lod1.glb', 'avatar/rider_female_lod2.glb'];
  it.each(files)('%s : corps, yeux, cheveux, coques tête nue, casques, lunettes, moustache, chaussures', (f) => {
    const g = readGlb(f);
    const sfx = f.match(/_lod\d/)?.[0] ?? '';
    const names = meshNodeNames(g);
    for (const p of MPFB_PARTS) expect(names, `${p}${sfx}`).toContain(`${p}${sfx}`);
    expect(names).toContain('rider_shoes');
    const mats = materialNames(g);
    for (const m of MPFB_MATERIALS) expect(mats, m).toContain(m);
  });
});

describe('modèles texturés (kit acheté, Tripo) : matériaux « tex_* »', () => {
  const files = ['avatar/boutique/rider.glb', 'avatar/tripo/rider.glb', 'avatar/tripo-femme/rider.glb'].filter(has);
  it.each(files)('%s', (f) => {
    const mats = materialNames(readGlb(f));
    for (const m of TEXTURED_MATERIALS) expect(mats, m).toContain(m);
  });
  it('kit acheté : objets séparés (tête, maillot, cuissard, bras, jambes, casque, lunettes)', () => {
    expect(meshNodeNames(readGlb('avatar/boutique/rider.glb')).sort()).toEqual(['rider_arms', 'rider_glasses', 'rider_glasses_lens', 'rider_head', 'rider_helmet', 'rider_jersey', 'rider_legs', 'rider_shorts']);
  });
});

describe('ancien coureur (cyclist.glb) : objets repris par l\'avatar MPFB (chaussures, casque chrono)', () => {
  it.each(['cyclist.glb', 'cyclist_lod1.glb'])('%s', (f) => {
    const names = meshNodeNames(readGlb(f));
    for (const p of ['rider_body', 'rider_hair', 'rider_helmet', 'rider_helmet_aero', 'rider_shoes']) expect(names.some((n) => n.startsWith(p)), p).toBe(true);
  });
});

describe('MPFB : cibles de morphing ↔ curseurs du visage (FACE_SLIDERS)', () => {
  const SLIDERS = new Set<string>(FACE_SLIDERS.map((s) => s.id));
  const targets = (f: string, mesh: string): string[] => {
    const g = readGlb(f);
    const m = (g.json.meshes ?? []).find((x) => x.name === mesh);
    const names = m?.extras?.targetNames ?? [];
    expect(names.length, `${f} : ${mesh} sans noms de cibles`).toBe(m?.primitives[0]?.targets?.length ?? 0);
    return names;
  };
  const identity = (names: string[]): string[] => names.filter((n) => /[+-]$/.test(n));

  it('corps (niveau 0) : 132 cibles = 80 d\'identité + 52 expressions ARKit', () => {
    const names = targets('avatar/rider.glb', 'rider_body');
    expect(names).toHaveLength(132);
    expect(identity(names)).toHaveLength(80);
    expect(names.length - identity(names).length).toBe(52);
    expect(names).toContain('jawOpen');
    expect(names).toContain('eyeBlinkLeft');
  });

  it('chaque curseur de FACE_SLIDERS a au moins une cible « + » ou « − » sur le corps, à chaque niveau de détail', () => {
    for (const [f, mesh] of [['avatar/rider.glb', 'rider_body'], ['avatar/rider_lod1.glb', 'rider_body_lod1'], ['avatar/rider_lod2.glb', 'rider_body_lod2']] as const) {
      const ids = new Set(identity(targets(f, mesh)).map((n) => n.slice(0, -1)));
      for (const s of SLIDERS) expect(ids.has(s), `${f} : curseur ${s}`).toBe(true);
    }
  });

  it('toutes les cibles d\'identité de tous les objets correspondent à un curseur (sinon setFace les ignore)', () => {
    for (const f of ['avatar/rider.glb', 'avatar/rider_lod1.glb', 'avatar/rider_lod2.glb', 'avatar/rider_female.glb']) {
      const g = readGlb(f);
      for (const m of g.json.meshes ?? []) for (const n of identity(m.extras?.targetNames ?? [])) expect(SLIDERS.has(n.slice(0, -1)), `${f} : ${m.name} → ${n}`).toBe(true);
    }
  });

  it('expressions seulement au niveau 0 (niveaux 1 et 2 : cibles d\'identité seules)', () => {
    for (const [f, mesh] of [['avatar/rider_lod1.glb', 'rider_body_lod1'], ['avatar/rider_lod2.glb', 'rider_body_lod2']] as const) {
      const names = targets(f, mesh);
      expect(names).toEqual(identity(names));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Vélos
// ---------------------------------------------------------------------------------------------

const ALL_FAMILIES = [...BIKE_FAMILIES, 'gravel', 'mtb'] as const;
const TT_FAMILIES = new Set(['tt', 'lotus', 'espada', 'lowpro']);
const OWN_WHEELS = new Set(['gravel', 'mtb']);
const R = DEFAULT_BIKE.wheelRadiusM;
/** Pédalier commun (build_cyclist.py : BB, CRANK, PEDAL_AXIS_X ; bike_families.py : REST_PITCH). */
const BB: Vec3 = [0, 0.27, 0];
const CRANK = 0.1725;
const PEDAL_X = 0.072;
const REST_PITCH = 0.35;
/** Ancres des mains (bike_families.py : ROAD_HAND, TT_HAND, TT_PAD) et numéro de cadre. */
const ROAD_HAND: Vec3 = [0.2, 0.958, 0.54];
const TT_HAND: Vec3 = [0.066, 0.93, 0.53];
const TT_PAD: Vec3 = [0.1, 0.86, 0.27];
/** VTT : milieu de la poignée gauche construite par build_vtt.py (BAR_HALF, GRIP_AXIS), ancre hand_L depuis E1.3b. */
const MTB_GRIP: Vec3 = [0.2325, 0.958, 0.54];
/** Objets cherchés par nom par rider/bikes.ts (assembleBike, bikeAnchors) et gltfAvatar.ts (applySize, setBikeType). */
const BIKE_MESHES = ['frame', 'cockpit', 'saddle', 'crankset', 'pedal_L', 'pedal_R'];
const BIKE_EMPTIES = ['axle_front', 'axle_rear', 'hand_L', 'hand_R', 'anchor_number'];
const WHEEL_TYPES = ['box', 'c35', 'c50', 'c65', 'disc', 'tri'];

const tireRadius = (g: Glb, node: string): number => {
  const n = nodeT(g, node);
  const m = g.json.meshes?.[n?.mesh ?? -1];
  const tire = m?.primitives.find((p) => g.json.materials?.[p.material ?? -1]?.name === 'tire');
  const acc = g.json.accessors[tire?.attributes.POSITION ?? -1];
  // Métadonnées min/max de l'accesseur (JSON) : positions non compressées, en mètres.
  return Math.max(Math.abs(acc?.min?.[1] ?? Number.NaN), Math.abs(acc?.max?.[1] ?? Number.NaN));
};

describe('inventaire des vélos', () => {
  it('familles du catalogue (BIKE_FAMILIES) + gravel et VTT, deux niveaux de détail chacune', () => {
    expect([...BIKE_FAMILIES].sort()).toEqual(['aero', 'climb', 'espada', 'lotus', 'lowpro', 'madone', 'retro', 'retro_compact', 'steel', 'tt']);
    for (const f of ALL_FAMILIES) for (const sfx of ['', '_lod1']) expect(has(`bikes/${f}${sfx}.glb`), `bikes/${f}${sfx}.glb`).toBe(true);
    expect(has('bikes/wheels.glb') && has('bikes/wheels_lod1.glb')).toBe(true);
  });
});

describe.each(ALL_FAMILIES.flatMap((f) => [`${f}`, `${f}_lod1`]))('vélo %s', (name) => {
  const family = name.replace(/_lod1$/, '');
  const g = (): Glb => readGlb(`bikes/${name}.glb`);
  const at = (n: string): Vec3 => (nodeT(g(), n)?.translation ?? [Number.NaN, Number.NaN, Number.NaN]) as Vec3;

  it('sans extension glTF (chargé par un GLTFLoader sans décodeur meshopt : positions en mètres)', () => {
    expect(g().json.extensionsUsed ?? []).toEqual([]);
  });

  it('objets et ancres attendus, ancres à la racine de la scène (position locale = position du vélo)', () => {
    const w = worldNodes(g());
    const meshes = meshNodeNames(g());
    for (const m of BIKE_MESHES) expect(meshes, m).toContain(m);
    const empties = [...BIKE_EMPTIES, ...(TT_FAMILIES.has(family) ? ['pad_L', 'pad_R'] : [])];
    for (const e of empties) {
      expect(w.has(e), e).toBe(true);
      expect(w.get(e)?.parent, `${e} à la racine`).toBeNull();
    }
    if (!TT_FAMILIES.has(family)) expect(w.has('pad_L')).toBe(false);
    if (OWN_WHEELS.has(family)) for (const wn of ['wheel_front', 'wheel_rear']) expect(meshes).toContain(wn);
  });

  it('peinture : cadre au matériau « frame » avec l\'attribut de zones (COLOR_0 : avant, arrière, fourche, douille)', () => {
    const frame = g().json.meshes?.[nodeT(g(), 'frame')?.mesh ?? -1];
    const prims = frame?.primitives.filter((p) => g().json.materials?.[p.material ?? -1]?.name === 'frame') ?? [];
    expect(prims.length).toBeGreaterThan(0);
    for (const p of prims) expect(p.attributes.COLOR_0).toBeDefined();
  });

  it('pédalier commun à toutes les familles (le moteur ne lit que celui de climb, gltfAvatar.ts buildTemplates)', () => {
    close(at('crankset'), BB, 1e-4, 'crankset');
    close(at('pedal_L'), [PEDAL_X, BB[1] - CRANK, 0], 1e-4, 'pedal_L (manivelle 0 : gauche en bas)');
    close(at('pedal_R'), [-PEDAL_X, BB[1] + CRANK, 0], 1e-4, 'pedal_R');
    for (const p of ['pedal_L', 'pedal_R']) {
      const q = nodeT(g(), p)?.rotation ?? [0, 0, 0, 1];
      expect(q[1]).toBeCloseTo(0, 6);
      expect(q[2]).toBeCloseTo(0, 6);
      expect(2 * Math.atan2(q[0], q[3]), `${p} : inclinaison de repos`).toBeCloseTo(REST_PITCH, 4);
    }
  });

  it('axes de roues : roue au sol (hauteur = rayon × échelle), avant devant (+z), arrière derrière', () => {
    const f = nodeT(g(), 'axle_front');
    const r = nodeT(g(), 'axle_rear');
    const sf = f?.scale?.[0] ?? 1;
    if (family === 'mtb') {
      // VTT : empattement propre (≈ 1,159 m) ; axes = roues réelles du fichier (E1.3b), détaillé dans « VTT : ancres… ».
      expect(f?.scale).toBeUndefined();
      close(at('axle_front'), at('wheel_front'), 1e-9, 'axle_front = wheel_front');
      close(at('axle_rear'), at('wheel_rear'), 1e-9, 'axle_rear = wheel_rear');
      expect(at('axle_front')[1]).toBeCloseTo(R, 6);
      expect(at('axle_rear')[1], 'axe arrière au sol (au dixième de millimètre)').toBeCloseTo(R, 3);
      expect(at('axle_front')[2]).toBeGreaterThan(0.5);
      expect(at('axle_rear')[2]).toBeLessThan(0);
      expect(at('axle_front')[2] - at('axle_rear')[2], 'empattement du VTT').toBeCloseTo(1.1587, 3);
      return;
    }
    expect(at('axle_front')[1]).toBeCloseTo(R * sf, 4);
    expect(at('axle_rear')[1]).toBeCloseTo(R * (r?.scale?.[0] ?? 1), 4);
    expect(at('axle_front')[2]).toBeGreaterThan(0.5);
    expect(at('axle_rear')[2]).toBeCloseTo(-0.41, 4);
    expect(at('axle_front')[0]).toBe(0);
    expect(at('axle_rear')[0]).toBe(0);
    if (family === 'lowpro') {
      expect(sf).toBeCloseTo(0.86, 5);
      expect(at('axle_front')[2]).toBeCloseTo(0.585, 4);
    } else {
      expect(f?.scale).toBeUndefined();
      expect(at('axle_front')[2], 'empattement 1,00 m').toBeCloseTo(0.59, 4);
    }
  });

  it('mains (et repose-coudes des vélos de chrono) : symétriques, devant le pédalier, au-dessus de la selle', () => {
    close(at('hand_R'), mirror(at('hand_L')), 1e-6, 'hand_R (miroir de hand_L)');
    expect(at('hand_L')[0]).toBeGreaterThan(0);
    expect(at('hand_L')[2]).toBeGreaterThan(0.4);
    if (TT_FAMILIES.has(family)) {
      close(at('hand_L'), TT_HAND, 1e-4, 'hand_L (chrono)');
      close(at('pad_L'), TT_PAD, 1e-4, 'pad_L');
      close(at('pad_R'), mirror(TT_PAD), 1e-4, 'pad_R');
    } else if (family === 'mtb') {
      close(at('hand_L'), MTB_GRIP, 1e-4, 'hand_L (milieu de la poignée gauche du VTT)');
    } else if (family !== 'gravel') {
      close(at('hand_L'), ROAD_HAND, 1e-4, 'hand_L (cocotte route)');
    }
  });

  if (OWN_WHEELS.has(family)) {
    it('roues propres (gravel, VTT) : pneu de rayon 0,335 m (métadonnées min/max)', () => {
      for (const wn of ['wheel_front', 'wheel_rear']) expect(tireRadius(g(), wn), wn).toBeCloseTo(R, 3);
    });
  }
});

describe.each(['wheels', 'wheels_lod1'])('bibliothèque de roues %s', (name) => {
  it('roues F/R de chaque type, disque de frein en enfant, pneu de rayon DEFAULT_BIKE.wheelRadiusM', () => {
    const g = readGlb(`bikes/${name}.glb`);
    expect(g.json.extensionsUsed ?? []).toEqual([]);
    const w = worldNodes(g);
    for (const t of WHEEL_TYPES) {
      for (const s of ['F', 'R']) {
        const n = `wheel_${t}_${s}`;
        expect(w.has(n), n).toBe(true);
        expect(w.get(`${n}_rotor`)?.parent, `${n}_rotor`).toBe(n);
        expect(tireRadius(g, n), n).toBeCloseTo(R, 3);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// VTT : ancres corrigées (audit n° 3, E1.3b ; auparavant écart connu D3 : valeurs du vélo aero).
// ---------------------------------------------------------------------------------------------

/** Centre (boîte englobante) d'une poignée du VTT : sommets du matériau « bar_tape » du cintre, côté +x ou −x (bloc binaire, non compressé). */
async function gripCenter(file: string, side: 1 | -1): Promise<Vec3> {
  const g = readGlb(file);
  const node = nodeT(g, 'cockpit');
  const t = node?.translation ?? [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of g.json.meshes?.[node?.mesh ?? -1]?.primitives ?? []) {
    if (g.json.materials?.[p.material ?? -1]?.name !== 'bar_tape') continue;
    const acc = g.json.accessors[p.attributes.POSITION as number] as GAccessor;
    expect(acc.componentType).toBe(5126);
    const { bytes, stride } = await viewBytes(g, acc.bufferView as number);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < acc.count; i++) {
      const o = (acc.byteOffset ?? 0) + i * (stride ?? 12);
      const v = [dv.getFloat32(o, true) + t[0], dv.getFloat32(o + 4, true) + t[1], dv.getFloat32(o + 8, true) + t[2]];
      if ((v[0] as number) * side <= 0) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k] as number, v[k] as number);
        hi[k] = Math.max(hi[k] as number, v[k] as number);
      }
    }
  }
  return [0, 1, 2].map((k) => ((lo[k] as number) + (hi[k] as number)) / 2) as Vec3;
}

describe('VTT : ancres sur les roues et les poignées réelles', () => {
  const files = ['bikes/mtb.glb', 'bikes/mtb_lod1.glb'];
  const at = (file: string, n: string): Vec3 => (nodeT(readGlb(file), n)?.translation ?? [Number.NaN, Number.NaN, Number.NaN]) as Vec3;

  it.each(files)('%s : axle_front et axle_rear = positions des roues réelles du fichier', (f) => {
    close(at(f, 'axle_front'), at(f, 'wheel_front'), 1e-9, 'axle_front = wheel_front');
    close(at(f, 'axle_rear'), at(f, 'wheel_rear'), 1e-9, 'axle_rear = wheel_rear');
    // Ce ne sont plus les axes du vélo route (0,59 / −0,41).
    expect(Math.abs(at(f, 'axle_front')[2] - 0.59)).toBeGreaterThan(0.1);
    expect(Math.abs(at(f, 'axle_rear')[2] + 0.41)).toBeGreaterThan(0.02);
  });

  it.each(files)('%s : mains au milieu des poignées construites, gauche = +x, droite en miroir', async (f) => {
    close(at(f, 'hand_L'), MTB_GRIP, 1e-6, 'hand_L');
    close(at(f, 'hand_R'), mirror(at(f, 'hand_L')), 1e-9, 'hand_R (miroir)');
    // Géométrie : milieu mesuré de la poignée gauche à moins de 1 mm de hand_L (le script la place sur GRIP_AXIS).
    close(await gripCenter(f, 1), at(f, 'hand_L'), 1e-3, 'poignée gauche mesurée');
    // Poignée droite non recalée par le script : modèle source asymétrique, jusqu'à 4 mm (mesuré : 1,4 à 3,8 mm).
    close(await gripCenter(f, -1), at(f, 'hand_R'), 4e-3, 'poignée droite mesurée');
  });

  it('LOD 0 et LOD 1 : mêmes ancres', () => {
    for (const n of ['axle_front', 'axle_rear', 'hand_L', 'hand_R']) close(at(files[1] as string, n), at(files[0] as string, n), 0, n);
  });
});

// ---------------------------------------------------------------------------------------------
// VTT : selle relevée par la tige télescopique (audit n° 3, A5b ; build_vtt.py --seatpost-rise 0.045).
// La branche haute de la tige (tube haut, tête, rails, coque) coulisse le long de l'axe réel du tube bas, qui reste
// dans le cadre ; seules ces positions de sommets et leurs bornes min/max ont changé dans les fichiers.
// ---------------------------------------------------------------------------------------------

/** Rehaussement vertical de la selle du VTT (m). */
const MTB_SEATPOST_RISE = 0.045;
interface MtbSaddleBefore {
  /** Primitive « components » du nœud saddle : les `fixed` premiers sommets = tube bas (fixe), les suivants = tube haut, tête, rails. */
  fixed: number;
  comp: number;
  shell: number;
  /** SHA-256 des positions du tube bas. */
  fixedSha: string;
  /** Centre et étendue des sommets mobiles de « components », puis de la coque (primitive « saddle »), avant A5b. */
  moved: Vec3;
  movedSize: Vec3;
  shellCentre: Vec3;
  shellSize: Vec3;
  shellTop: number;
  /** SHA-256 du bloc binaire hors des deux vues POSITION de la selle, et du JSON hors des bornes de ces deux accesseurs. */
  binRest: string;
  jsonRest: string;
}
/** Relevé sur les fichiers d'origine (avant A5b, empreintes 16ba4b9c… et 466c2811…). */
const MTB_SADDLE_BEFORE: Record<string, MtbSaddleBefore> = {
  'bikes/mtb.glb': {
    fixed: 491, comp: 1242, shell: 315,
    fixedSha: 'cf17694a8f60fcbe2a617d2b41d6f73413e1c85c625f008b838a4e5c836d3a97',
    moved: [0.000054, 0.8866078, -0.2253114], movedSize: [0.1297715, 0.2017397, 0.2484736],
    shellCentre: [0.0009591, 0.9053986, -0.2394352], shellSize: [0.1300451, 0.05254, 0.2484736], shellTop: 0.93,
    binRest: '324a9190e501a6e2863c97942712f3fc5d0c1455c8b8de7e0fa38e523e1388b1',
    jsonRest: 'f1fdaa3c3ff1493454b92848fff182fbe6be296f16d239ff753e560a0174b554',
  },
  'bikes/mtb_lod1.glb': {
    fixed: 333, comp: 780, shell: 138,
    fixedSha: '8f04358eea5e5f1703b64248f51ecc3b06406fb0cfe37ffcbd49f12ebf26fe84',
    moved: [-0.000658, 0.8836407, -0.2215619], movedSize: [0.1300101, 0.2025447, 0.2486267],
    shellCentre: [0.0032871, 0.9063185, -0.2297352], shellSize: [0.1313987, 0.0518591, 0.2489353], shellTop: 0.929519,
    binRest: '926907251734748f0bb6a1a333912213faab44155094ad3a3814ab654f71b0f5',
    jsonRest: 'cebf259aef553670df7f57bb33346c4e2d09b8c77ad90e6894fb2cbec43afe4a',
  },
};

interface MtbSaddle {
  fixed: Vec3[];
  moved: Vec3[];
  shell: Vec3[];
  fixedSha: string;
  binRest: string;
  jsonRest: string;
  /** Axe du tube bas (direction principale de ses sommets, vers le haut) et son centre. */
  axis: Vec3;
  axisAt: Vec3;
}
const vsub = (a: readonly number[], b: readonly number[]): Vec3 => [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number)];
const vdot = (a: readonly number[], b: readonly number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
const vmean = (P: Vec3[]): Vec3 => [0, 1, 2].map((k) => P.reduce((s, q) => s + (q[k] as number), 0) / P.length) as Vec3;
const vsize = (P: Vec3[]): Vec3 => [0, 1, 2].map((k) => Math.max(...P.map((q) => q[k] as number)) - Math.min(...P.map((q) => q[k] as number))) as Vec3;

async function mtbSaddle(file: string): Promise<MtbSaddle> {
  const ref = MTB_SADDLE_BEFORE[file] as MtbSaddleBefore;
  const g = readGlb(file);
  const node = nodeT(g, 'saddle');
  expect(node?.translation, `${file} : nœud saddle sans translation`).toBeUndefined();
  const prims = g.json.meshes?.[node?.mesh ?? -1]?.primitives ?? [];
  expect(prims.map((p) => g.json.materials?.[p.material ?? -1]?.name)).toEqual(['components', 'saddle']);
  const read = async (p: (typeof prims)[number]): Promise<{ P: Vec3[]; bytes: Uint8Array }> => {
    const acc = g.json.accessors[p.attributes.POSITION as number] as GAccessor;
    expect(acc.componentType).toBe(5126);
    const { bytes, stride } = await viewBytes(g, acc.bufferView as number);
    expect(stride ?? 12).toBe(12);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const o0 = acc.byteOffset ?? 0;
    const P = Array.from({ length: acc.count }, (_, i) => [0, 4, 8].map((c) => dv.getFloat32(o0 + i * 12 + c, true)) as Vec3);
    return { P, bytes: bytes.subarray(o0, o0 + acc.count * 12) };
  };
  const comp = await read(prims[0] as (typeof prims)[number]);
  const shell = await read(prims[1] as (typeof prims)[number]);
  expect(comp.P.length).toBe(ref.comp);
  expect(shell.P.length).toBe(ref.shell);
  const fixed = comp.P.slice(0, ref.fixed);
  const fixedSha = createHash('sha256').update(comp.bytes.subarray(0, ref.fixed * 12)).digest('hex');
  // Reste du fichier : toutes les vues du bloc binaire sauf les deux vues POSITION de la selle ; JSON sans leurs bornes.
  const posAcc = new Set(prims.map((p) => p.attributes.POSITION as number));
  const posViews = new Set([...posAcc].map((a) => g.json.accessors[a]?.bufferView));
  const hb = createHash('sha256');
  g.json.bufferViews.forEach((bv, i) => {
    if (!posViews.has(i)) hb.update((g.bin as Uint8Array).subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  });
  const json = { ...g.json, accessors: g.json.accessors.map((a, i) => (posAcc.has(i) ? { ...a, min: undefined, max: undefined } : a)) };
  // Axe du tube bas : itération de puissance sur la covariance de ses sommets (même calcul que build_vtt.py).
  const m = vmean(fixed);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as number[][];
  for (const q of fixed) { const d = vsub(q, m); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) (C[a] as number[])[b] = ((C[a] as number[])[b] as number) + (d[a] as number) * (d[b] as number); }
  let v: Vec3 = [0, 1, 0];
  for (let i = 0; i < 200; i++) { const w = [0, 1, 2].map((a) => vdot(C[a] as number[], v)); const n = Math.hypot(...w); v = w.map((x) => x / n) as Vec3; }
  if (v[1] < 0) v = v.map((x) => -x) as Vec3;
  return { fixed, moved: comp.P.slice(ref.fixed), shell: shell.P, fixedSha, binRest: hb.digest('hex'), jsonRest: createHash('sha256').update(JSON.stringify(json)).digest('hex'), axis: v, axisAt: m };
}

describe('VTT : selle relevée par la tige télescopique (A5b)', () => {
  const files = ['bikes/mtb.glb', 'bikes/mtb_lod1.glb'];

  it.each(files)('%s : tube bas immobile, reste du fichier (géométries, normales, indices, nœuds, ancres) inchangé', async (f) => {
    const ref = MTB_SADDLE_BEFORE[f] as MtbSaddleBefore;
    const s = await mtbSaddle(f);
    expect(s.fixedSha, 'positions du tube bas').toBe(ref.fixedSha);
    expect(s.binRest, 'bloc binaire hors positions de la selle').toBe(ref.binRest);
    expect(s.jsonRest, 'JSON hors bornes des positions de la selle').toBe(ref.jsonRest);
  });

  it.each(files)('%s : branche haute et coque relevées de 4,5 cm, en bloc, le long de l\'axe réel du tube bas', async (f) => {
    const ref = MTB_SADDLE_BEFORE[f] as MtbSaddleBefore;
    const s = await mtbSaddle(f);
    const angle = (Math.acos(s.axis[1]) * 180) / Math.PI;
    expect(angle, 'inclinaison de la tige (°)').toBeGreaterThan(36);
    expect(angle, 'inclinaison de la tige (°)').toBeLessThan(38);
    const slide = s.axis.map((x) => (x * MTB_SEATPOST_RISE) / s.axis[1]) as Vec3;
    const dShell = vsub(vmean(s.shell), ref.shellCentre);
    const dMoved = vsub(vmean(s.moved), ref.moved);
    expect(dShell[1], 'composante verticale').toBeCloseTo(MTB_SEATPOST_RISE, 5);
    close(dShell, slide, 1e-5, 'coque : déplacement le long de l\'axe');
    close(dMoved, dShell, 1e-6, 'tube haut, tête et rails : même déplacement que la coque');
    expect(dShell[2], 'la selle recule (axe incliné)').toBeLessThan(-0.03);
    // Translation sans déformation : étendues inchangées.
    close(vsize(s.shell), ref.shellSize, 1e-6, 'coque : étendue');
    close(vsize(s.moved), ref.movedSize, 1e-6, 'branche haute : étendue');
    expect(Math.max(...s.shell.map((q) => q[1])), 'dessus de selle').toBeCloseTo(ref.shellTop + MTB_SEATPOST_RISE, 6);
  });

  it.each(files)('%s : tube haut centré et engagé d\'au moins 2 cm dans le collier du tube bas', async (f) => {
    const s = await mtbSaddle(f);
    const t = (q: Vec3): number => vdot(vsub(q, s.axisAt), s.axis);
    const collarTop = Math.max(...s.fixed.map(t));
    const ringBottom = Math.min(...s.moved.map(t));
    expect(collarTop - ringBottom, 'longueur engagée (m)').toBeGreaterThan(0.02);
    // Bague du bas du tube haut : sommets mobiles les plus bas (1 cm), centrés sur l'axe à 2 mm près.
    const ring = s.moved.filter((q) => t(q) < ringBottom + 0.01);
    const d = vsub(vmean(ring), s.axisAt);
    const along = vdot(d, s.axis);
    expect(Math.hypot(...d.map((x, k) => x - along * (s.axis[k] as number))), 'décalage de la bague par rapport à l\'axe (m)').toBeLessThan(0.002);
    expect(Math.max(...ring.map((q) => Math.hypot(...vsub(q, s.axisAt).map((x, k) => x - t(q) * (s.axis[k] as number))))), 'rayon de la bague').toBeLessThan(0.02);
  });

  it('LOD 0 et LOD 1 : même hauteur de selle, même coulissement, même axe', async () => {
    const [a, b] = await Promise.all(files.map(mtbSaddle));
    const sa = a as MtbSaddle;
    const sb = b as MtbSaddle;
    expect(Math.abs(Math.max(...sa.shell.map((q) => q[1])) - Math.max(...sb.shell.map((q) => q[1]))), 'dessus de selle').toBeLessThan(0.001);
    const da = vsub(vmean(sa.shell), (MTB_SADDLE_BEFORE[files[0] as string] as MtbSaddleBefore).shellCentre);
    const db = vsub(vmean(sb.shell), (MTB_SADDLE_BEFORE[files[1] as string] as MtbSaddleBefore).shellCentre);
    close(db, da, 5e-4, 'coulissement');
    expect((Math.acos(Math.min(1, vdot(sa.axis, sb.axis))) * 180) / Math.PI, 'écart entre les axes (°)').toBeLessThan(0.5);
    expect(Math.abs(Math.min(...sa.fixed.map((q) => q[1])) - Math.min(...sb.fixed.map((q) => q[1]))), 'bas du tube bas').toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------------------------
// Écarts connus : état actuel protégé, PAS une géométrie correcte (audit n° 3, D3, D4, D5).
// Quand l'écart est corrigé, ce test échoue : le remplacer par le contrôle strict indiqué.
// ---------------------------------------------------------------------------------------------

describe('écarts connus (documentés, non corrigés)', () => {
  const at = (file: string, n: string): Vec3 => (nodeT(readGlb(file), n)?.translation ?? [Number.NaN, Number.NaN, Number.NaN]) as Vec3;

  it.each(['bikes/mtb.glb', 'bikes/mtb_lod1.glb'])('D3 — %s : roue avant décalée latéralement (x ≈ −2,8 mm)', (f) => {
    // À rendre strict après correction : wheel_front x = 0.
    expect(at(f, 'wheel_front')[0]).toBeCloseTo(-0.0028, 4);
    expect(at(f, 'wheel_rear')[0]).toBeCloseTo(0, 4);
  });

  it.each(['bikes/gravel.glb', 'bikes/gravel_lod1.glb'])('D4 — %s : ancres des mains du vélo aero, alors que le cintre a été déplacé (0, −2 cm, +1 cm)', (f) => {
    // build_gravel.py:463-465 décale le cintre sans déplacer hand_* (gardées de aero.glb).
    // À rendre strict après correction : hand_L = ROAD_HAND + (0, −0,02, +0,01).
    close(at(f, 'hand_L'), at(f.replace('gravel', 'aero'), 'hand_L'), 1e-6, 'hand_L = aero');
    close(at(f, 'hand_L'), ROAD_HAND, 1e-6, 'hand_L');
  });

  it('D5 — route et gravel : la paume visée par l\'avatar MPFB (HOOD_PALM) n\'est pas l\'ancre hand_* du GLB', () => {
    // HOOD_PALM recopiée de rider/gltfAvatar.ts:396 (non exportée) ; l'avatar MPFB l'utilise à la place des ancres
    // sur route et gravel (aimHands) : une nouvelle géométrie de cintre serait ignorée par lui.
    const HOOD_PALM: Vec3 = [0.2, 0.9, 0.565];
    const hand = at('bikes/climb.glb', 'hand_L');
    expect(Math.abs(hand[1] - HOOD_PALM[1]) + Math.abs(hand[2] - HOOD_PALM[2])).toBeGreaterThan(0.05);
    // Repli de bikeAnchors (bikes.ts:511) : même valeur que l'ancre route.
    close([0.2, 0.958, 0.54], hand, 1e-6, 'repli de bikeAnchors');
  });

  it('modèle féminin dédié : sans cible « sex− » (131 cibles), topologie différente du corps masculin', () => {
    const body = (f: string): GMesh | undefined => (readGlb(f).json.meshes ?? []).find((m) => m.name === 'rider_body');
    const m = body('avatar/rider.glb');
    const fm = body('avatar/rider_female.glb');
    expect(fm?.extras?.targetNames).toHaveLength(131);
    expect(fm?.extras?.targetNames).not.toContain('sex-');
    expect(m?.extras?.targetNames).toContain('sex-');
    const verts = (x: GMesh | undefined, f: string): number => (x?.primitives ?? []).reduce((s, p) => s + (readGlb(f).json.accessors[p.attributes.POSITION as number]?.count ?? 0), 0);
    expect(verts(m, 'avatar/rider.glb')).not.toBe(verts(fm, 'avatar/rider_female.glb'));
  });

  it('ancien coureur : ni spine2 ni clavicules (rôles facultatifs), pas d\'os de doigts', () => {
    const w = worldNodes(readGlb('cyclist.glb'));
    for (const n of ['spine2', 'clavicle_L', 'clavicle_R', 'middle_01_l']) expect(w.has(n), n).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Contrôles non exécutés (motif)
// ---------------------------------------------------------------------------------------------

describe('contrôles non exécutés', () => {
  it.todo('positions réelles des sommets des coureurs (contact main/cocotte, pied/pédale) : positions quantifiées et compressées, non décodées ici ; couvert par le banc avatar-test.html');
  it.todo('étanchéité des maillages gravel et VTT (arêtes ouvertes) : exige la lecture complète des index et positions ; défaut connu D13, non protégé');
  it.todo('cohérence avec les constantes du moteur non exportées (WHEEL_R, HOOD_PALM, MTB_PALM, TT_HORN_PALM de gltfAvatar.ts ; BB 0,28 de lowPolyRider.ts) : les importer chargerait three/webgpu ; prévu à l\'étape E1.2');
  it.todo('parts.glb : généré par build_cyclist.py mais jamais chargé par le client ; non couvert');
});
