import * as THREE from 'three/webgpu';
import { attribute, vec3, float, sin, cos, max, floor, mod, exp2, pow, abs, mix, step, varying, hash, instanceIndex, color, transformNormalToView } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';

/*
 * Piétons des villages : silhouettes humaines « low poly » (jambes, chaussures, buste, bras,
 * mains, cou, tête, cheveux, casquette, sac à dos, manteau, jupe, chien en laisse, banc),
 * toutes fusionnées dans une seule géométrie instanciée. La marche (jambes, genoux, bras,
 * coudes, balancement du corps) est calculée dans le nuanceur de sommets à partir de la phase
 * et de l'amplitude de chaque instance : un seul appel de dessin (plus la passe d'ombre).
 *
 * Repère d'un piéton : y vers le haut, regard vers +z, 1,75 m (mis à l'échelle par instance).
 */

// Articulations du gabarit (m).
const HIP_Y = 0.93;
const HIP_X = 0.083;
const KNEE_Y = 0.5;
const SHO_Y = 1.425;
const SHO_X = 0.205;
const ELB_Y = 1.135;
const WRIST_Y = 0.89;
/** Abaissement du bassin en position assise (assise du banc à 0,45 m). */
const SEAT_DROP = 0.41;
/** Bras qui tient la laisse : épaule et coude fixes (rad). */
const HOLD_SHOULDER = -0.35;
const HOLD_ELBOW = -0.75;
/** Chien : décalage latéral (côté main droite, −x) et vers l'avant. */
const DOG_X = -0.62;
const DOG_Z = 0.45;

/** Membres (rotation autour de l'axe x, pivot propre) : 0 corps rigide. */
const L = { BODY: 0, LEG_L: 1, LEG_R: 2, ARM_L: 3, ARM_R: 4, BENCH: 5, DOG_A: 6, DOG_B: 7, DOG: 8, TAIL: 9 } as const;
/** Teintes : 0–7 lues par instance, au-delà constantes. */
const M = { SKIN: 0, TOP: 1, SLEEVE: 2, TROUSERS: 3, SHIN: 4, SHOES: 5, HAIR: 6, ACCENT: 7, DARK: 8, WOOD: 9, FUR: 10, FUR_DARK: 11 } as const;
/** Pièces optionnelles : bit (n − 1) du style de l'instance ; 0 = toujours visible. */
const O = { ALWAYS: 0, HAIR_SHORT: 1, HAIR_LONG: 2, HAIR_BUN: 3, CAP: 4, BEANIE: 5, BACKPACK: 6, COAT: 7, SKIRT: 8, DOG: 9, BENCH: 10 } as const;
const bitOf = (opt: number) => 1 << (opt - 1);

interface Tag {
  limb?: number;
  seg?: number;
  mat: number;
  opt?: number;
  /** Pivot principal (y, z) et articulation basse (y), dans le repère au repos. */
  joint?: [number, number, number];
}

const parts: THREE.BufferGeometry[] = [];

function add(geo: THREE.BufferGeometry, t: Tag): void {
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const rig = new Float32Array(n * 4);
  const joint = new Float32Array(n * 4);
  const [jy, jz, ly] = t.joint ?? [0, 0, 0];
  for (let i = 0; i < n; i++) {
    rig.set([t.limb ?? L.BODY, t.seg ?? 0, t.mat, t.opt ?? O.ALWAYS], i * 4);
    joint.set([jy, jz, ly, 0], i * 4);
  }
  geo.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  geo.setAttribute('joint', new THREE.BufferAttribute(joint, 4));
  parts.push(geo.index ? geo : geo.setIndex([...Array(n).keys()]));
}

/** Ellipsoïde (éventuellement tronqué vers le bas par `theta`). */
function ellip(rx: number, ry: number, rz: number, x: number, y: number, z: number, ws = 10, hs = 8, theta = Math.PI): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, theta).scale(rx, ry, rz).translate(x, y, z);
}

/** Tronc de cône vertical entre deux hauteurs. */
function tube(rTop: number, rBot: number, yTop: number, yBot: number, x: number, z: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, yTop - yBot, seg, 1).translate(x, (yTop + yBot) / 2, z);
}

/** Cylindre fin entre deux points (laisse, queue). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 5, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Volume de révolution (profil [rayon, hauteur] de bas en haut), aplati en profondeur. */
function lathe(profile: Array<[number, number]>, depth: number, seg = 12): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  ).scale(1, 1, depth);
}

function box(w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, l).translate(x, y, z);
}

/** Rotation autour de x (même convention que le nuanceur). */
function rotX(p: THREE.Vector3, pivotY: number, pivotZ: number, a: number): THREE.Vector3 {
  const y = p.y - pivotY;
  const z = p.z - pivotZ;
  return new THREE.Vector3(p.x, pivotY + y * Math.cos(a) - z * Math.sin(a), pivotZ + y * Math.sin(a) + z * Math.cos(a));
}

function personGeometry(): THREE.InstancedBufferGeometry {
  parts.length = 0;
  // Bassin (pantalon) et buste (haut), aplatis en profondeur.
  add(lathe([[0, 0.83], [0.1, 0.835], [0.145, 0.87], [0.153, 0.93], [0.15, 1.0], [0, 1.0]], 0.64), { mat: M.TROUSERS });
  add(lathe([[0, 0.95], [0.158, 0.96], [0.15, 1.06], [0.155, 1.16], [0.166, 1.27], [0.178, 1.36], [0.19, 1.42], [0.175, 1.455], [0.12, 1.485], [0.05, 1.505], [0, 1.51]], 0.6), { mat: M.TOP });
  // Cou, tête, nez, yeux, oreilles.
  add(tube(0.047, 0.05, 1.59, 1.46, 0, 0.005), { mat: M.SKIN });
  add(ellip(0.079, 0.108, 0.094, 0, 1.66, 0.008, 14, 10), { mat: M.SKIN });
  add(box(0.022, 0.04, 0.03, 0, 1.645, 0.1), { mat: M.SKIN });
  for (const sx of [1, -1]) {
    add(box(0.013, 0.009, 0.01, sx * 0.03, 1.672, 0.092), { mat: M.DARK });
    add(ellip(0.014, 0.03, 0.022, sx * 0.078, 1.655, 0, 6, 4), { mat: M.SKIN });
  }
  // Coiffures : calotte (relevée sur le front, descendant sur la nuque), cheveux longs, chignon.
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.087, 0.112, 0.103).rotateX(-0.35).translate(0, 1.664, -0.004), { mat: M.HAIR, opt: O.HAIR_SHORT });
  add(ellip(0.085, 0.13, 0.05, 0, 1.6, -0.068, 10, 6), { mat: M.HAIR, opt: O.HAIR_LONG });
  add(ellip(0.045, 0.042, 0.045, 0, 1.73, -0.1, 8, 6), { mat: M.HAIR, opt: O.HAIR_BUN });
  // Casquette (calotte + visière) et bonnet à pompon.
  add(ellip(0.089, 0.085, 0.104, 0, 1.675, -0.004, 14, 6, Math.PI / 2), { mat: M.ACCENT, opt: O.CAP });
  add(new THREE.BoxGeometry(0.15, 0.012, 0.09).rotateX(0.15).translate(0, 1.68, 0.125), { mat: M.ACCENT, opt: O.CAP });
  add(ellip(0.088, 0.1, 0.103, 0, 1.68, -0.003, 14, 7, Math.PI / 2), { mat: M.ACCENT, opt: O.BEANIE });
  add(ellip(0.026, 0.026, 0.026, 0, 1.785, -0.003, 6, 5), { mat: M.ACCENT, opt: O.BEANIE });
  // Sac à dos et bretelles.
  add(box(0.27, 0.36, 0.12, 0, 1.2, -0.165), { mat: M.ACCENT, opt: O.BACKPACK });
  for (const sx of [1, -1]) add(box(0.03, 0.3, 0.012, sx * 0.085, 1.3, 0.108), { mat: M.DARK, opt: O.BACKPACK });
  // Pan de manteau, jupe.
  add(lathe([[0.205, 0.64], [0.19, 0.78], [0.175, 0.9], [0.163, 1.02]], 0.75), { mat: M.TOP, opt: O.COAT });
  add(lathe([[0.23, 0.52], [0.2, 0.7], [0.17, 0.88], [0.16, 0.96]], 0.8), { mat: M.TROUSERS, opt: O.SKIRT });
  // Jambes : cuisse (pivot à la hanche), genou, tibia et chaussure (pivot au genou).
  for (const [limb, sx] of [[L.LEG_L, 1], [L.LEG_R, -1]] as const) {
    const x = sx * HIP_X;
    const joint: [number, number, number] = [HIP_Y, 0, KNEE_Y];
    add(tube(0.07, 0.055, 0.96, 0.5, x, 0), { limb, mat: M.TROUSERS, joint });
    add(ellip(0.054, 0.054, 0.054, x, 0.5, 0, 8, 6), { limb, seg: 1, mat: M.SHIN, joint });
    add(tube(0.053, 0.04, 0.5, 0.1, x, 0), { limb, seg: 1, mat: M.SHIN, joint });
    add(tube(0.04, 0.038, 0.1, 0.05, x, 0), { limb, seg: 1, mat: M.SHIN, joint });
    add(ellip(0.048, 0.07, 0.125, x, 0.03, 0.035, 10, 6, Math.PI / 2), { limb, seg: 1, mat: M.SHOES, joint });
    add(box(0.1, 0.03, 0.26, x, 0.015, 0.035), { limb, seg: 1, mat: M.SHOES, joint });
  }
  // Bras : épaule et bras (pivot à l'épaule), coude, avant-bras et main (pivot au coude).
  for (const [limb, sx] of [[L.ARM_L, 1], [L.ARM_R, -1]] as const) {
    const x = sx * SHO_X;
    const joint: [number, number, number] = [SHO_Y, 0, ELB_Y];
    add(ellip(0.05, 0.055, 0.055, x - sx * 0.008, SHO_Y - 0.03, 0, 8, 6), { limb, mat: M.TOP, joint });
    add(tube(0.048, 0.042, SHO_Y - 0.03, ELB_Y - 0.01, x, 0), { limb, mat: M.TOP, joint });
    add(ellip(0.041, 0.041, 0.041, x, ELB_Y, 0, 8, 6), { limb, seg: 1, mat: M.SLEEVE, joint });
    add(tube(0.041, 0.033, ELB_Y, WRIST_Y, x, 0), { limb, seg: 1, mat: M.SLEEVE, joint });
    add(ellip(0.028, 0.07, 0.042, x, 0.835, 0.005, 8, 6), { limb, seg: 1, mat: M.SKIN, joint });
  }
  // Chien en laisse : corps, tête, museau, oreilles, queue, pattes (diagonales en phase).
  add(ellip(0.1, 0.115, 0.29, DOG_X, 0.42, DOG_Z, 10, 8), { limb: L.DOG, mat: M.FUR, opt: O.DOG });
  add(ellip(0.1, 0.12, 0.12, DOG_X, 0.45, DOG_Z + 0.18, 8, 6), { limb: L.DOG, mat: M.FUR, opt: O.DOG });
  add(ellip(0.072, 0.075, 0.09, DOG_X, 0.6, DOG_Z + 0.33, 8, 6), { limb: L.DOG, mat: M.FUR, opt: O.DOG });
  add(ellip(0.04, 0.038, 0.07, DOG_X, 0.58, DOG_Z + 0.42, 8, 5), { limb: L.DOG, mat: M.FUR, opt: O.DOG });
  add(ellip(0.018, 0.015, 0.015, DOG_X, 0.592, DOG_Z + 0.488, 5, 4), { limb: L.DOG, mat: M.FUR_DARK, opt: O.DOG });
  for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.025, 0.075, 0.045).rotateZ(sx * 0.35).translate(DOG_X + sx * 0.058, 0.635, DOG_Z + 0.31), { limb: L.DOG, mat: M.FUR_DARK, opt: O.DOG });
  const tailBase = new THREE.Vector3(DOG_X, 0.47, DOG_Z - 0.26);
  add(rod(tailBase, new THREE.Vector3(DOG_X, 0.62, DOG_Z - 0.42), 0.022), { limb: L.TAIL, mat: M.FUR, opt: O.DOG, joint: [tailBase.y, tailBase.z, 0] });
  for (const [fx, fz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const limb = fx * fz > 0 ? L.DOG_A : L.DOG_B;
    const x = DOG_X + fx * 0.055;
    const z = DOG_Z + fz * 0.2;
    const joint: [number, number, number] = [0.4, z, 0];
    add(tube(0.034, 0.026, 0.42, 0.03, x, z, 6), { limb, mat: M.FUR, opt: O.DOG, joint });
    add(ellip(0.03, 0.022, 0.042, x, 0.022, z + 0.012, 6, 4), { limb, mat: M.FUR, opt: O.DOG, joint });
  }
  // Laisse : de la main droite (bras tenu en avant) au collier, légèrement détendue.
  const hand = rotX(rotX(new THREE.Vector3(-SHO_X, 0.82, 0.01), ELB_Y, 0, HOLD_ELBOW), SHO_Y, 0, HOLD_SHOULDER);
  const collar = new THREE.Vector3(DOG_X, 0.56, DOG_Z + 0.27);
  const mid = hand.clone().lerp(collar, 0.5).add(new THREE.Vector3(0, -0.12, 0));
  add(rod(hand, mid, 0.007), { mat: M.DARK, opt: O.DOG });
  add(rod(mid, collar, 0.007), { mat: M.DARK, opt: O.DOG });
  // Banc public (lattes de bois, piètement métallique) pour les piétons assis.
  add(box(1.5, 0.05, 0.4, -0.35, 0.425, -0.08), { limb: L.BENCH, mat: M.WOOD, opt: O.BENCH });
  add(new THREE.BoxGeometry(1.5, 0.3, 0.04).rotateX(-0.12).translate(-0.35, 0.72, -0.31), { limb: L.BENCH, mat: M.WOOD, opt: O.BENCH });
  for (const x of [-0.35 - 0.65, -0.35 + 0.65]) {
    add(box(0.05, 0.4, 0.4, x, 0.2, -0.08), { limb: L.BENCH, mat: M.DARK, opt: O.BENCH });
    add(box(0.05, 0.36, 0.04, x, 0.6, -0.31), { limb: L.BENCH, mat: M.DARK, opt: O.BENCH });
  }
  const merged = mergeGeometries(parts) as THREE.BufferGeometry;
  parts.length = 0;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(merged.index);
  geo.setAttribute('position', merged.getAttribute('position'));
  geo.setAttribute('normal', merged.getAttribute('normal'));
  // WebGPU limite à 8 tampons de sommets : attributs de gréement entrelacés dans un seul tampon.
  const rig = merged.getAttribute('rig');
  const joint = merged.getAttribute('joint');
  const packed = new Float32Array(rig.count * 8);
  for (let i = 0; i < rig.count; i++) {
    packed.set([rig.getX(i), rig.getY(i), rig.getZ(i), rig.getW(i), joint.getX(i), joint.getY(i), joint.getZ(i), 0], i * 8);
  }
  const ib = new THREE.InterleavedBuffer(packed, 8);
  geo.setAttribute('rig', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('joint', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  return geo;
}

/** Rotation autour de x dans le nuanceur (convention de `rotX`). */
function rotXNode(p: THREE.Node<'vec3'>, a: THREE.Node<'float'>) {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
}

/** Rotation autour de y (convention Object3D.rotation.y). */
function rotYNode(p: THREE.Node<'vec3'>, a: THREE.Node<'float'>) {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
}

/** Couleur 0xRRGGBB (sRVB) stockée dans un flottant (exact jusqu'à 2^24), en linéaire. */
function decode(f: THREE.Node<'float'>) {
  const rgb = vec3(floor(f.div(65536)), mod(floor(f.div(256)), 256), mod(f, 256));
  return pow(rgb.div(255), vec3(2.2));
}

function pedestrianMaterial(): THREE.MeshStandardNodeMaterial {
  const raw = attribute<'vec3'>('position');
  const nrm = attribute<'vec3'>('normal');
  const rig = attribute<'vec4'>('rig');
  const joint = attribute<'vec4'>('joint');
  const iPos = attribute<'vec4'>('iPos');
  const iAnim = attribute<'vec4'>('iAnim');
  const iStyle = attribute<'float'>('iStyle');
  const iCol0 = attribute<'vec4'>('iCol0');
  const iCol1 = attribute<'vec4'>('iCol1');
  const limb = rig.x;
  const seg = rig.y;
  const matId = rig.z;
  const opt = rig.w;
  const phase = iAnim.x;
  const amp = iAnim.y;
  const gest = iAnim.z;
  const scl = iAnim.w;
  const is = (k: number) => step(abs(limb.sub(k)), float(0.5));
  const bit = (opt1: number) => mod(floor(iStyle.div(2 ** (opt1 - 1))), 2);
  const seated = bit(O.BENCH);
  const dog = bit(O.DOG);
  const s = sin(phase);
  const c = cos(phase);
  const isLeg = is(L.LEG_L).add(is(L.LEG_R));
  const isArm = is(L.ARM_L).add(is(L.ARM_R));
  const legSide = is(L.LEG_L).sub(is(L.LEG_R));
  const armSide = is(L.ARM_L).sub(is(L.ARM_R));
  // Jambes : la cuisse avance (angle négatif) quand l'autre recule ; le genou plie pendant le
  // retour de la jambe vers l'avant. Assis : cuisse à l'horizontale, tibia vertical.
  const swing = amp.mul(0.42).mul(s);
  const hip = mix(swing.negate().mul(legSide), float(-1.5), seated).mul(isLeg);
  const knee = mix(amp.mul(float(0.06).add(max(c.mul(legSide), 0).mul(0.65))), float(1.5), seated).mul(isLeg);
  // Bras en opposition de phase avec la jambe du même côté, coude un peu plus fléchi vers l'avant.
  let shoulder = amp.mul(0.36).mul(s).mul(armSide);
  let elbow = float(-0.14).sub(amp.mul(0.22).mul(float(0.5).sub(s.mul(armSide).mul(0.5)))).mul(isArm);
  // Conversation : la main droite accompagne la parole.
  const talk = gest.mul(is(L.ARM_R));
  shoulder = shoulder.sub(talk.mul(sin(phase).mul(0.1).add(0.3)));
  elbow = elbow.sub(talk.mul(sin(phase.mul(2).add(1)).mul(0.3).add(0.95)));
  // Laisse tenue (bras droit fixe) ; assis, les mains reposent sur les cuisses.
  const hold = dog.mul(is(L.ARM_R));
  shoulder = mix(mix(shoulder, float(HOLD_SHOULDER), hold), float(-0.4).mul(isArm), seated);
  elbow = mix(mix(elbow, float(HOLD_ELBOW), hold), float(-0.85).mul(isArm), seated);
  // Chien : pas deux fois plus fréquents, pattes en diagonale, queue qui remue.
  const dogLeg = amp.mul(0.55).mul(sin(phase.mul(2))).mul(is(L.DOG_A).sub(is(L.DOG_B)));
  const tail = is(L.TAIL).mul(sin(phase.mul(4)).mul(0.3));
  const a1 = hip.add(shoulder).add(dogLeg).add(tail);
  const a2 = knee.add(elbow).mul(seg);
  // Le bassin descend quand les jambes s'écartent (pied d'appui au sol) ; assis : sur le banc.
  const person = step(limb, float(4.5));
  const bodyY = mix(float(-HIP_Y).mul(float(1).sub(cos(swing))), float(-SEAT_DROP), seated).mul(person);
  const dogY = is(L.DOG).add(is(L.TAIL)).mul(amp).mul(abs(sin(phase.mul(2)))).mul(0.015);
  const vis = mix(mod(floor(iStyle.div(exp2(opt.sub(1)))), 2), float(1), step(opt, float(0.5)));
  const p2 = vec3(0, joint.z, joint.y);
  const p1 = vec3(0, joint.x, joint.y);
  const bent = rotXNode(raw.sub(p2), a2).add(p2);
  const posed = rotXNode(bent.sub(p1), a1).add(p1).add(vec3(0, bodyY.add(dogY), 0));
  const heading = iPos.w;
  const m = new THREE.MeshStandardNodeMaterial();
  m.positionNode = rotYNode(posed.mul(vis).mul(scl), heading).add(iPos.xyz);
  const n = rotYNode(rotXNode(rotXNode(nrm, a2), a1), heading);
  m.normalNode = transformNormalToView(varying(n)).normalize();
  // Teintes : peau, haut, manches, pantalon, bas des jambes, chaussures, cheveux, accessoire.
  const slots = [iCol0.x, iCol0.y, iCol0.z, iCol0.w, iCol1.x, iCol1.y, iCol1.z, iCol1.w].map(decode);
  const h = hash(instanceIndex.add(7));
  const fur = mix(mix(color('#5a3a22'), color('#d8c39a'), step(0.4, h)), color('#1c1a18'), step(0.75, h));
  const consts = [color('#1d1d21'), color('#6b4a2e'), fur, color('#21170f')];
  let col = slots[0] as ReturnType<typeof decode>;
  [...slots, ...consts].forEach((cc, k) => {
    if (k > 0) col = abs(matId.sub(k)).lessThan(0.5).select(cc, col) as typeof col;
  });
  m.colorNode = varying(col);
  m.roughnessNode = float(0.82);
  m.metalnessNode = float(0);
  return m;
}

const hex = (s: string) => parseInt(s.slice(1), 16);
const SKINS = ['#f3d4bf', '#e8bc9a', '#d6a07a', '#c4895f', '#a66a45', '#86533a', '#5c3a26'].map(hex);
const JACKETS = ['#1f2a44', '#3b4a3f', '#7a1f2b', '#c2ae84', '#2f2f33', '#d8d4cc', '#4f6f94', '#a9532f', '#d9a93a', '#476b5a', '#8c8f94', '#a33b3b', '#5a4a6e'].map(hex);
const TROUSERS = ['#1d2533', '#3a4f6e', '#2b2b2b', '#6b5d4b', '#8a8270', '#4a4f57', '#2e3b55'].map(hex);
const SHOES = ['#1b1b1b', '#3d2a1e', '#e6e6e6', '#5a5f66', '#7a4a28'].map(hex);
const HAIR = ['#1a1410', '#3b2618', '#5e3c22', '#8f6538', '#cfae6e', '#9a9a96', '#dedbd4', '#7a2e14'].map(hex);
const ACCENTS = ['#c0392b', '#1f6feb', '#2e7d32', '#e0b020', '#222222', '#e67e22', '#ecf0f1', '#6c3483'].map(hex);

type Mode = 'walk' | 'talk' | 'sit';

interface Ped {
  mode: Mode;
  /** Distance déroulée (m) et décalage latéral (m, positif à droite). */
  d: number;
  lateral: number;
  side: 1 | -1;
  dir: 1 | -1;
  speed: number;
  /** Tronçon parcouru (aller-retour) et pause au demi-tour (s). */
  from: number;
  to: number;
  pause: number;
  /** Écart de cap pour les piétons immobiles (rad). */
  turn: number;
  heading: number;
  phase: number;
  amp: number;
  gest: number;
  /** Décalage du tour de parole dans une conversation. */
  talkOffset: number;
  scale: number;
  style: number;
  cols: number[];
}

/** Rayon (m, le long de l'itinéraire) autour du joueur dans lequel les piétons sont dessinés. */
const DRAW_RADIUS = 320;
/** Largeur de l'accotement gravillonné de la chaussée (voir road.ts). */
const SHOULDER = 1.2;

/**
 * Piétons des villages traversés : promeneurs (parfois avec un chien) qui font des allers-retours
 * sur l'accotement, deux personnes qui discutent, quelqu'un assis sur un banc.
 */
export class Pedestrians {
  readonly mesh: THREE.Mesh;
  private readonly peds: Ped[] = [];
  private readonly geo: THREE.InstancedBufferGeometry;
  /** Par instance, entrelacés : position + cap et animation (chaque image), apparence (au besoin). */
  private readonly motion: THREE.InstancedInterleavedBuffer;
  private readonly look: THREE.InstancedInterleavedBuffer;
  private readonly iPos: THREE.InterleavedBufferAttribute;
  private readonly iAnim: THREE.InterleavedBufferAttribute;
  private readonly iStyle: THREE.InterleavedBufferAttribute;
  private readonly iCol0: THREE.InterleavedBufferAttribute;
  private readonly iCol1: THREE.InterleavedBufferAttribute;
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private active: number[] = [];
  private time = 0;

  constructor(
    private readonly track: RouteTrack,
    private readonly groundAt?: (x: number, z: number) => number,
  ) {
    const r = rng(1789);
    const half = track.route.roadWidthM / 2;
    for (const lm of track.route.landmarks ?? []) {
      // Promeneurs : un aller-retour de ±130 m autour du centre du village, des deux côtés.
      let dogs = 0;
      for (let k = 0; k < 4; k++) {
        const withDog = dogs === 0 && r() < 0.3;
        if (withDog) dogs++;
        const side: 1 | -1 = k % 2 ? 1 : -1;
        const span = 110 + r() * 40;
        this.peds.push(this.person(r, { mode: 'walk', d: lm.d + (r() - 0.5) * 2 * span * 0.9, side, from: lm.d - span, to: lm.d + span, dog: withDog }));
      }
      // Deux personnes qui discutent, face à face, un peu tournées vers la route.
      const side: 1 | -1 = r() < 0.5 ? 1 : -1;
      const dc = lm.d + (r() - 0.5) * 90;
      this.peds.push(this.person(r, { mode: 'talk', d: dc - 0.45, side, turn: 0.45 * side, talkOffset: 0 }));
      this.peds.push(this.person(r, { mode: 'talk', d: dc + 0.45, side, turn: Math.PI - 0.45 * side, talkOffset: Math.PI }));
      // Quelqu'un sur un banc, face à la route (le dossier vers l'extérieur).
      if (r() < 0.65) {
        const sb: 1 | -1 = side > 0 ? -1 : 1;
        this.peds.push(this.person(r, { mode: 'sit', d: lm.d + (r() - 0.5) * 120, side: sb, turn: (sb * Math.PI) / 2, lateral: sb * (half + 0.72) }));
      }
    }
    const n = Math.max(this.peds.length, 1);
    this.geo = personGeometry();
    this.motion = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 8), 8, 1).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 12), 12, 1).setUsage(THREE.DynamicDrawUsage);
    this.iPos = new THREE.InterleavedBufferAttribute(this.motion, 4, 0);
    this.iAnim = new THREE.InterleavedBufferAttribute(this.motion, 4, 4);
    this.iCol0 = new THREE.InterleavedBufferAttribute(this.look, 4, 0);
    this.iCol1 = new THREE.InterleavedBufferAttribute(this.look, 4, 4);
    this.iStyle = new THREE.InterleavedBufferAttribute(this.look, 1, 8);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iAnim', this.iAnim);
    this.geo.setAttribute('iStyle', this.iStyle);
    this.geo.setAttribute('iCol0', this.iCol0);
    this.geo.setAttribute('iCol1', this.iCol1);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, pedestrianMaterial());
    this.mesh.name = 'pedestrians';
    // Les instances sont placées dans le nuanceur : pas de sphère englobante exploitable.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  /** Tire une silhouette : taille, peau, vêtements, coiffure et accessoires. */
  private person(
    r: () => number,
    o: { mode: Mode; d: number; side: 1 | -1; from?: number; to?: number; dog?: boolean; turn?: number; talkOffset?: number; lateral?: number },
  ): Ped {
    const pick = (a: number[]) => a[Math.floor(r() * a.length)] as number;
    const skin = pick(SKINS);
    const top = pick(JACKETS);
    let style = 0;
    const longHair = r() < 0.45;
    const hairRoll = r();
    if (longHair) style |= bitOf(O.HAIR_SHORT) | bitOf(hairRoll < 0.55 ? O.HAIR_LONG : O.HAIR_BUN);
    else if (hairRoll < 0.18) style |= bitOf(O.CAP);
    else if (hairRoll < 0.26) style |= bitOf(O.BEANIE);
    else if (hairRoll < 0.9) style |= bitOf(O.HAIR_SHORT);
    // sinon crâne rasé ou dégarni : pas de pièce de cheveux.
    const skirt = longHair && r() < 0.35;
    const coat = !skirt && r() < 0.25;
    const shorts = !skirt && !coat && r() < 0.12;
    if (skirt) style |= bitOf(O.SKIRT);
    if (coat) style |= bitOf(O.COAT);
    if (o.mode === 'walk' && !o.dog && r() < 0.18) style |= bitOf(O.BACKPACK);
    if (o.dog) style |= bitOf(O.DOG);
    if (o.mode === 'sit') style |= bitOf(O.BENCH);
    const trousers = skirt ? pick([...JACKETS, ...TROUSERS]) : pick(TROUSERS);
    const legs = shorts ? skin : skirt ? (r() < 0.5 ? skin : hex('#2a2a2e')) : trousers;
    const sleeve = coat || r() < 0.6 ? top : skin;
    const cols = [skin, top, sleeve, trousers, legs, pick(SHOES), pick(HAIR), pick(ACCENTS)];
    const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
    return {
      mode: o.mode,
      d: o.d,
      lateral: o.lateral ?? this.laneOf(o.side, dir),
      side: o.side,
      dir,
      speed: 1.05 + r() * 0.45,
      from: o.from ?? o.d,
      to: o.to ?? o.d,
      pause: 0,
      turn: o.turn ?? 0,
      heading: Number.NaN,
      phase: r() * Math.PI * 2,
      amp: o.mode === 'walk' ? 1 : 0,
      gest: 0,
      talkOffset: o.talkOffset ?? 0,
      // 1,61 à 1,85 m (gabarit de 1,75 m).
      scale: 0.92 + r() * 0.14,
      style,
      cols,
    };
  }

  /** Sur l'accotement, chacun garde sa file selon son sens de marche. */
  private laneOf(side: 1 | -1, dir: 1 | -1): number {
    const half = this.track.route.roadWidthM / 2;
    return side * (half + (side * dir > 0 ? 0.42 : 0.9));
  }

  /** Altitude du sol sous un point : accotement de la chaussée (léger dévers), sinon terrain. */
  private groundY(y: number, x: number, z: number, lateral: number): number {
    const half = this.track.route.roadWidthM / 2;
    const a = Math.abs(lateral);
    if (a <= half) return y + 0.06;
    if (a <= half + SHOULDER) return y + 0.06 - (0.04 * (a - half)) / SHOULDER;
    const g = this.groundAt?.(x, z);
    return g !== undefined && Number.isFinite(g) ? g : y;
  }

  update(dt: number, playerD: number): void {
    const L = this.track.length;
    this.time += dt;
    const active: number[] = [];
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i] as Ped;
      let rel = (p.d - playerD) % L;
      if (rel > L / 2) rel -= L;
      if (rel < -L / 2) rel += L;
      if (Math.abs(rel) > DRAW_RADIUS) continue;
      active.push(i);
      if (p.mode === 'walk') {
        if (p.pause > 0) {
          p.pause -= dt;
          if (p.pause <= 0) p.dir = p.dir > 0 ? -1 : 1;
        } else if ((p.dir > 0 && p.d >= p.to) || (p.dir < 0 && p.d <= p.from)) {
          // Demi-tour au bout du village après une courte halte.
          p.pause = 1.5 + ((i * 0.37) % 1) * 3;
        }
        const target = p.pause > 0 ? 0 : 1;
        p.amp += Math.max(-dt * 2.5, Math.min(dt * 2.5, target - p.amp));
        p.d += p.dir * p.speed * p.amp * dt;
        p.lateral += (this.laneOf(p.side, p.dir) - p.lateral) * Math.min(1, dt * 0.8);
        // Une enjambée (deux pas) d'environ 1,45 m pour 1,75 m.
        p.phase += (dt * Math.PI * 2 * p.speed * p.amp) / (1.45 * p.scale) + dt * 0.5 * (1 - p.amp);
      } else {
        p.phase += dt * 1.3;
        // Conversation : chacun parle à son tour (le geste suit la parole).
        p.gest = p.mode === 'talk' ? Math.max(0, Math.sin(this.time * 0.45 + p.talkOffset)) * 0.9 : 0;
      }
      p.phase %= Math.PI * 2;
      const s = this.track.positionAt(((p.d % L) + L) % L, p.lateral, this.sample);
      const road = Math.atan2(s.dirX, s.dirZ);
      const want = p.mode === 'walk' ? road + (p.dir < 0 ? Math.PI : 0) : road + p.turn;
      if (Number.isNaN(p.heading)) p.heading = want;
      // Rotation progressive (demi-tours, virages).
      let dh = (want - p.heading) % (Math.PI * 2);
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      p.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * 3.5);
      const j = active.length - 1;
      this.iPos.setXYZW(j, s.x, this.groundY(s.y, s.x, s.z, p.lateral), s.z, p.heading);
      this.iAnim.setXYZW(j, p.phase, p.amp, p.gest, p.scale);
    }
    // Apparence : réécrite seulement quand l'ensemble des piétons proches change.
    if (active.length !== this.active.length || active.some((v, k) => v !== this.active[k])) {
      active.forEach((i, j) => {
        const p = this.peds[i] as Ped;
        const c = p.cols;
        this.iStyle.setX(j, p.style);
        this.iCol0.setXYZW(j, c[0] as number, c[1] as number, c[2] as number, c[3] as number);
        this.iCol1.setXYZW(j, c[4] as number, c[5] as number, c[6] as number, c[7] as number);
      });
      this.look.needsUpdate = true;
      this.active = active;
    }
    this.motion.needsUpdate = true;
    this.geo.instanceCount = active.length;
    this.mesh.visible = active.length > 0;
  }
}
