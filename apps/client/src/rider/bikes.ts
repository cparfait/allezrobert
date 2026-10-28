import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { abs, atan, color, float, floor, fract, length, materialColor, max, mix, mod, positionGeometry, sign, sin, step, uniform, vec2, vec3 } from 'three/tsl';
import { BIKES, DEFAULT_LOOK, PLAIN_BIKE_FAMILY, bikeOfLook, type AvatarLook, type BikeBuild, type BikeFamily, type TuneNumber } from '@allezrobert/shared';
import { LiveryMaterial } from './livery.ts';
import { RimDecalMaterial, crankLetters, measureBand, polarLetters, type RimBand } from './rimDecal.ts';
import { decalBoxes, frameMarks, wordmarkTexture } from './wordmarks.ts';

/**
 * Vélos du catalogue assemblés à partir des modèles Blender (tools/blender/build_cyclist.py) :
 *  - public/models/bikes/<famille>.glb (+ _lod1) : cadre, cockpit, selle, pédalier, pédales,
 *    options (opt_brakes_disc, opt_brakes_rim, opt_derailleur, opt_bottles, opt_toeclips_*,
 *    opt_shifters_dt) et ancres (axle_front / axle_rear, hand_*, pad_*, decal_*) ;
 *  - public/models/bikes/wheels.glb (+ _lod1) : wheel_<type>_<F|R>, disque de frein en enfant.
 * Les familles se chargent à la demande ; celle du vélo de base est chargée au démarrage.
 */

export type Side = 'L' | 'R';

/**
 * Famille chargeable : celles du catalogue, plus « gravel » (gravel.glb : « Road Bike » de Tanya Andreeva, CC BY 4.0) et « mtb »
 * (mtb.glb : « Carbon Frame Bike » de prefrontal cortex, CC BY-SA 4.0), hors catalogue, voir ASSETS_LICENSES.md. Elles prennent la
 * livrée du vélo choisi quand le vélo équipé a des pneus gravel ou VTT, et apportent leurs propres roues (wheel_front /
 * wheel_rear, disques de frein) : celles de wheels.glb ne servent pas.
 */
export type FamilyKey = BikeFamily | 'gravel' | 'mtb';

/** Types de vélo qui ont leur modèle complet (famille du même nom). */
export const OWN_MODEL_TYPES = ['gravel', 'mtb'] as const;
const isOwnModel = (family: FamilyKey): family is (typeof OWN_MODEL_TYPES)[number] => family === 'gravel' || family === 'mtb';

/** Vélo assemblé (un niveau de détail), prêt à être ajouté au groupe d'un avatar. */
export interface AssembledBike {
  group: THREE.Group;
  crank: THREE.Object3D | null;
  wheels: THREE.Object3D[];
  pedals: Record<Side, THREE.Object3D | null>;
}

/** Ancres d'une famille (repère du vélo) utiles au coureur. */
export interface BikeAnchors {
  hands: Record<Side, THREE.Vector3>;
  /** Repose-coudes des prolongateurs (vélos de chrono). */
  pads: Record<Side, THREE.Vector3> | null;
}

/** Matériaux du vélo : couleur, rugosité, métal (mêmes valeurs que MAT_DEFS du script Blender). */
const BIKE_MATERIALS: Record<string, [string, number, number]> = {
  components: ['#18191c', 0.45, 0.2],
  tire: ['#121214', 0.85, 0],
  tire_wall: ['#1a1a1c', 0.8, 0],
  rim: ['#1e2024', 0.35, 0.1],
  disc_face: ['#1e2024', 0.35, 0.1],
  rim_decal: ['#6a7079', 0.45, 0.1],
  chrome: ['#b9bcc2', 0.2, 1],
  bar_tape: ['#ffd23f', 0.75, 0],
  computer_screen: ['#1b2a30', 0.15, 0],
  computer: ['#1b1c20', 0.45, 0],
  bottle: ['#ffd23f', 0.5, 0],
  // Bidons d'équipe des modèles dédiés (Madone Lidl-Trek) : bande, filets et bouchon, haut.
  bottle_band: ['#ffe100', 0.5, 0],
  bottle_trim: ['#d71f26', 0.5, 0],
  bottle_white: ['#f2f2ee', 0.5, 0],
  // Pédalier SRAM Red du Madone : dents argentées, anneau rouge.
  ring_teeth: ['#b9bcc2', 0.3, 1],
  crank_accent: ['#c8102e', 0.4, 0.2],
  cage: ['#18191c', 0.45, 0.1],
  spokes: ['#151618', 0.4, 0.3],
  hub: ['#1c1d21', 0.4, 0.3],
  rotor: ['#b9bcc2', 0.25, 1],
  valve: ['#b9bcc2', 0.3, 1],
  cassette: ['#b9bcc2', 0.25, 1],
  saddle: ['#141518', 0.55, 0],
  saddle_lattice: ['#202226', 0.6, 0],
  crank: ['#18191c', 0.4, 0.2],
  chainring: ['#2a2c31', 0.35, 0.5],
  chain: ['#9a9da3', 0.3, 1],
  pulley: ['#1c1d21', 0.5, 0],
  caliper: ['#1c1d21', 0.4, 0.3],
  spacers: ['#18191c', 0.4, 0.2],
  topcap: ['#18191c', 0.4, 0.3],
  bolts: ['#b9bcc2', 0.3, 1],
  pad: ['#202124', 0.8, 0],
  // Tige de selle (primitive « components » du nœud saddle), recolorable à part (atelier).
  seatpost: ['#18191c', 0.4, 0.2],
};

/** Flancs beiges des pneus gravel (les mêmes que ceux du kit gravel de bikeKits.ts). */
const GRAVEL_WALL = '#a9825a';

/** Pièces dont la couleur peut venir de l'atelier (BikeExtras.parts). */
const TUNABLE = new Set(['chain', 'chainring', 'crank', 'cassette', 'pulley', 'rotor', 'cage', 'topcap', 'spacers', 'bolts', 'computer', 'spokes', 'valve', 'seatpost']);
/** Pièces qui peuvent passer en carbone apparent (tissage dans le nuanceur). */
const CARBON_CAPABLE = new Set(['crank', 'seatpost']);

const plateCache = new Map<string, THREE.CanvasTexture>();

/** Texture d'une plaque de cadre : fond, liseré, numéro (à l'envers pour le 13 superstitieux). */
function plateTexture(n: TuneNumber): THREE.CanvasTexture {
  const key = JSON.stringify(n);
  let tex = plateCache.get(key);
  if (tex) return tex;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 176;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = n.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  if (n.stripe) {
    g.fillStyle = n.stripe;
    g.fillRect(0, cv.height - 26, cv.width, 26);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, cv.width - 6, cv.height - 6);
  g.save();
  g.translate(cv.width / 2, cv.height / 2 - (n.stripe ? 10 : 0));
  if (n.flip) g.rotate(Math.PI);
  g.fillStyle = n.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 128px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  g.fillText(n.text, 0, 6);
  g.restore();
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  plateCache.set(key, tex);
  return tex;
}

/**
 * Plaque de cadre sous la selle (ancre « anchor_number » des familles) : deux faces dos à dos,
 * lisibles des deux côtés. Matériau propre (« number », surbrillance de l'atelier).
 */
function numberPlate(n: TuneNumber, at: THREE.Vector3, postZ?: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'number_plate';
  const mat = new THREE.MeshStandardNodeMaterial({ map: plateTexture(n), roughness: 0.55, metalness: 0 });
  mat.name = 'number';
  const geo = new THREE.PlaneGeometry(0.115, 0.08);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * 0.0025;
    m.userData.matKey = 'number';
    g.add(m);
  }
  g.position.copy(at).add(new THREE.Vector3(0, -0.035, -0.045));
  if (postZ !== undefined) {
    // Plaque fixée derrière la tige de selle par un collier : bord avant contre la tige.
    g.position.z = postZ - 0.0575 - 0.006;
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.016), new THREE.MeshStandardNodeMaterial({ color: '#16171a', roughness: 0.6 }));
    clamp.position.z = 0.0575 + 0.002;
    g.add(clamp);
  }
  return g;
}

/**
 * Arrière de la tige de selle (z, repère du vélo) à la hauteur `y` : sommets de la tige proches du plan
 * médian, le plus en arrière. Les tiges diffèrent d'un modèle à l'autre (angle, recul) : la plaque s'y cale.
 */
function seatpostRearZ(group: THREE.Object3D, y: number): number | undefined {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let best: number | undefined;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.matKey !== 'seatpost') return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (Math.abs(v.x) < 0.03 && Math.abs(v.y - y) < 0.015 && (best === undefined || v.z < best)) best = v.z;
    }
  });
  return best;
}

const EMISSIVE: Record<string, [string, number]> = {
  computer_screen: ['#3f7f8f', 0.6],
};

/** Vélos des coureurs du décor (IA, photo d'accueil, film) : modèles route 2026, familles préchargées. */
const CROWD = BIKES.filter((b) => b.collection === 'saison-2026' && (b.family === 'aero' || b.family === 'climb'));
export const CROWD_FAMILIES: readonly BikeFamily[] = ['aero', 'climb'];

/** Modèle de vélo du coureur n° i du décor (varié, stable d'une partie à l'autre). */
export function crowdBike(i: number): string | undefined {
  return CROWD.length ? CROWD[(i * 7 + 3) % CROWD.length]?.id : undefined;
}

type Lods = [GLTF, GLTF];

const base = `${import.meta.env.BASE_URL}models/bikes/`;
const loader = new GLTFLoader();
const families = new Map<FamilyKey, Lods>();
const pending = new Map<FamilyKey, Promise<boolean>>();
let wheels: Lods | null = null;
let wheelsLoading: Promise<Lods> | null = null;
const listeners = new Set<(family: BikeFamily) => void>();

/**
 * Bidons des cadres route : le fichier fusionne les deux bidons (tube de selle, tube oblique) et
 * leurs porte-bidons dans les maillages « opt_bottles ». On les sépare une fois au chargement :
 * « opt_bottle_up » (tube de selle, plus haut) et « opt_bottle_down » (tube oblique) ; un cadre
 * qui n'a qu'un bidon (acier) n'a que « opt_bottle_down ». Les triangles sont répartis en deux
 * groupes (k-moyennes sur leur centre dans le plan y-z), calculés sur le maillage du bidon.
 */
function splitBottles(scene: THREE.Object3D): void {
  const parts: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name.startsWith('opt_bottles')) parts.push(o as THREE.Mesh);
  });
  if (!parts.length) return;
  const centroid = (g: THREE.BufferGeometry, t: number): [number, number] => {
    const p = g.getAttribute('position');
    const ix = g.index;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const i = ix ? ix.getX(t * 3 + k) : t * 3 + k;
      y += p.getY(i) / 3;
      z += p.getZ(i) / 3;
    }
    return [y, z];
  };
  const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const ref = parts.find((m) => (m.material as THREE.Material).name === 'bottle') ?? (parts[0] as THREE.Mesh);
  const cs = Array.from({ length: triCount(ref.geometry) }, (_, t) => centroid(ref.geometry, t));
  let hi = cs[0] as [number, number];
  let lo = cs[0] as [number, number];
  for (const c of cs) {
    if (c[0] > hi[0]) hi = c;
    if (c[0] < lo[0]) lo = c;
  }
  const centers: Array<[number, number]> = [[...hi], [...lo]];
  for (let it = 0; it < 8; it++) {
    const sum = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const c of cs) {
      const k = Math.hypot(c[0] - (centers[0] as number[])[0]!, c[1] - (centers[0] as number[])[1]!) <= Math.hypot(c[0] - (centers[1] as number[])[0]!, c[1] - (centers[1] as number[])[1]!) ? 0 : 1;
      const s = sum[k] as number[];
      s[0]! += c[0];
      s[1]! += c[1];
      s[2]! += 1;
    }
    sum.forEach((s, k) => {
      if (s[2]) centers[k] = [(s[0] as number) / (s[2] as number), (s[1] as number) / (s[2] as number)];
    });
  }
  const two = Math.hypot(centers[0]![0] - centers[1]![0], centers[0]![1] - centers[1]![1]) > 0.12;
  for (const mesh of parts) {
    const g = mesh.geometry;
    const index = g.index ? Array.from(g.index.array) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i);
    const groups: number[][] = [[], []];
    for (let t = 0; t < index.length / 3; t++) {
      const c = centroid(g, t);
      const k = two && Math.hypot(c[0] - centers[0]![0], c[1] - centers[0]![1]) <= Math.hypot(c[0] - centers[1]![0], c[1] - centers[1]![1]) ? 0 : 1;
      (groups[k] as number[]).push(index[t * 3] as number, index[t * 3 + 1] as number, index[t * 3 + 2] as number);
    }
    ['up', 'down'].forEach((name, k) => {
      const ids = groups[k] as number[];
      if (!ids.length) return;
      const sub = new THREE.BufferGeometry();
      for (const [key, a] of Object.entries(g.attributes)) sub.setAttribute(key, a);
      sub.setIndex(ids);
      const m = new THREE.Mesh(sub, mesh.material);
      m.name = `opt_bottle_${name}`;
      m.castShadow = mesh.castShadow;
      m.receiveShadow = mesh.receiveShadow;
      mesh.parent?.add(m);
    });
    mesh.removeFromParent();
  }
}

async function loadLods(name: string): Promise<Lods> {
  const [a, b] = await Promise.all([loader.loadAsync(`${base}${name}.glb`), loader.loadAsync(`${base}${name}_lod1.glb`)]);
  splitBottles(a.scene);
  splitBottles(b.scene);
  return [a as GLTF, b as GLTF];
}

/** Charge une famille (et la bibliothèque de roues) ; false si les fichiers sont indisponibles. */
export function loadBikeFamily(family: FamilyKey): Promise<boolean> {
  if (families.has(family)) return Promise.resolve(true);
  let p = pending.get(family);
  if (!p) {
    wheelsLoading ??= loadLods('wheels').then((w) => (wheels = w));
    p = Promise.all([loadLods(family), wheelsLoading])
      .then(([lods]) => {
        families.set(family, lods);
        if (!isOwnModel(family)) for (const cb of listeners) cb(family);
        return true;
      })
      .catch((e: unknown) => {
        console.warn(`Vélos : famille ${family} indisponible`, e);
        // Modèles gravel et VTT facultatifs : fichier absent, on garde le kit sans réessayer à chaque montage.
        if (isOwnModel(family)) pending.set(family, Promise.resolve(false));
        else pending.delete(family);
        return false;
      });
    pending.set(family, p);
  }
  return p;
}

export function bikeFamilyReady(family: FamilyKey): boolean {
  return families.has(family) && wheels !== null;
}

/** Clés de matériau propres à une roue : flancs de lenticulaire, bande décor à la marque des jantes. */
function tagWheel(w: THREE.Object3D, type: string, build: BikeBuild): void {
  w.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    // Roue lenticulaire : flancs peints de la couleur `disc` de la livrée (matériau à part).
    if (type === 'disc' && m?.name === 'rim') o.userData.matKey = 'disc_face';
    // Bande décor : nom de la marque des roues, matériau propre à la largeur de bande.
    // Flancs écrits (p. ex. « P ZERO ») : matériau propre à la largeur du flanc.
    if (m?.name === 'tire_wall' && build.livery.tireText) {
      const b = measureBand((o as THREE.Mesh).geometry);
      o.userData.matKey = `tire_wall:${b.r0.toFixed(4)}:${b.r1.toFixed(4)}`;
    }
    if (m?.name === 'rim_decal' && build.params.rimBrand) {
      const b = measureBand((o as THREE.Mesh).geometry);
      o.userData.matKey = `rim_decal:${type === 'box' ? 'box' : type === 'disc' ? 'disc' : 'carbon'}:${b.r0.toFixed(4)}:${b.r1.toFixed(4)}`;
    }
  });
}

/**
 * Roue seule d'une paire de roues de l'atelier (décor : roues accrochées au mur), habillée comme
 * sur le vélo : jante, bande décor à la marque, flancs, moyeu. `rear` : roue arrière de la paire
 * (p. ex. la lenticulaire). Null tant que la bibliothèque de roues n'est pas chargée.
 */
export function loneWheel(tuneId: string, rear = false): THREE.Object3D | null {
  if (!wheels || !families.has(PLAIN_BIKE_FAMILY)) return null;
  const build = bikeOfLook({ bike: '#1e2024', tune: [tuneId] });
  const type = build.params.wheels[rear ? 1 : 0];
  const src = wheels[0].scene.getObjectByName(`wheel_${type}_${rear ? 'R' : 'F'}`);
  if (!src) return null;
  const w = src.clone(true);
  tagWheel(w, type, build);
  const materials = new BikeMaterials(build, DEFAULT_LOOK, PLAIN_BIKE_FAMILY);
  w.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = materials.get((mesh.userData.matKey as string | undefined) ?? (mesh.material as THREE.Material).name);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return w;
}

/** Appelé à chaque famille chargée (p. ex. pour refaire l'image fixe de l'accueil). */
export function onBikeFamilyLoaded(cb: (family: BikeFamily) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Famille à afficher tout de suite : celle demandée si chargée, sinon celle du vélo de base. */
export function availableFamily(family: BikeFamily): BikeFamily | null {
  if (bikeFamilyReady(family)) return family;
  return bikeFamilyReady(PLAIN_BIKE_FAMILY) ? PLAIN_BIKE_FAMILY : null;
}

/** Scène (LOD 0) d'une famille chargée : référence du pédalier, des pédales et des mains. */
export function familyScene(family: FamilyKey): THREE.Object3D {
  const lods = families.get(family);
  if (!lods) throw new Error(`famille de vélo non chargée : ${family}`);
  return lods[0].scene;
}

export function bikeAnchors(family: FamilyKey): BikeAnchors {
  const s = familyScene(family);
  const at = (name: string): THREE.Vector3 | null => s.getObjectByName(name)?.position.clone() ?? null;
  const hands = { L: at('hand_L') ?? new THREE.Vector3(0.2, 0.958, 0.54), R: at('hand_R') ?? new THREE.Vector3(-0.2, 0.958, 0.54) };
  const pl = at('pad_L');
  const pr = at('pad_R');
  return { hands, pads: pl && pr ? { L: pl, R: pr } : null };
}

/** Assemble un vélo (famille chargée) : options visibles selon le modèle, roues posées aux axes. */
export function assembleBike(build: BikeBuild, family: FamilyKey, lod: 0 | 1, bottles?: number): AssembledBike {
  const lods = families.get(family);
  if (!lods || !wheels) throw new Error(`famille de vélo non chargée : ${family}`);
  const group = lods[lod].scene.clone(true);
  group.name = 'bike';
  const { track = false, toeClips = false } = build.params;
  // Gravel et VTT : freins à disque (rotors dans les roues du fichier), quel que soit le vélo dont ils prennent la livrée.
  const brakes = isOwnModel(family) ? 'disc' : build.params.brakes;
  // Bidons : 0, 1 (tube oblique) ou 2 (et tube de selle), dans la limite du cadre ; défaut : ceux du modèle.
  let hasUp = false;
  let hasDown = false;
  group.traverse((o) => {
    if (o.name.startsWith('opt_bottle_up')) hasUp = true;
    if (o.name.startsWith('opt_bottle_down')) hasDown = true;
  });
  const capacity = track || build.params.bottles === false ? 0 : (hasUp ? 1 : 0) + (hasDown ? 1 : 0);
  const nBottles = Math.min(bottles ?? 1, capacity);
  group.traverse((o) => {
    const n = o.name;
    // Tige de selle : matériau à part (pièces de l'atelier).
    const mm = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mm?.name === 'components' && (o.name === 'saddle' || o.parent?.name === 'saddle')) o.userData.matKey = 'seatpost';
    if (n.startsWith('opt_brakes_disc')) o.visible = brakes === 'disc';
    else if (n.startsWith('opt_brakes_rim')) o.visible = brakes === 'rim';
    else if (n.startsWith('opt_derailleur')) o.visible = !track;
    else if (n.startsWith('opt_bottle_up')) o.visible = nBottles >= 2;
    else if (n.startsWith('opt_bottle_down')) o.visible = nBottles >= 1;
    else if (n.startsWith('opt_bottles')) o.visible = !track && build.params.bottles !== false;
    else if (n.startsWith('opt_toeclips')) o.visible = toeClips;
  });
  const lib = wheels[lod].scene;
  const out: THREE.Object3D[] = [];
  (['front', 'rear'] as const).forEach((pos, i) => {
    // Roues propres au fichier (gravel, VTT) : déjà posées à leurs axes, tournent autour de leur nœud.
    const own = isOwnModel(family) ? group.getObjectByName(`wheel_${pos}`) : undefined;
    if (own) {
      out.push(own);
      return;
    }
    const type = build.params.wheels[i] ?? 'c35';
    const src = lib.getObjectByName(`wheel_${type}_${pos === 'front' ? 'F' : 'R'}`);
    const axle = group.getObjectByName(`axle_${pos}`);
    if (!src || !axle) return;
    const w = src.clone(true);
    w.name = `wheel_${pos}`;
    w.position.copy(axle.position);
    w.scale.copy(axle.scale);
    tagWheel(w, type, build);
    const rotor = w.getObjectByName(`${src.name}_rotor`);
    if (rotor) rotor.visible = brakes === 'disc';
    group.add(w);
    out.push(w);
  });
  // Plaque de cadre (atelier) sous la selle.
  const num = build.extras?.number;
  const anchor = group.getObjectByName('anchor_number');
  if (num && anchor && typeof document !== 'undefined') group.add(numberPlate(num, anchor.position, seatpostRearZ(group, anchor.position.y - 0.035)));
  return {
    group,
    crank: group.getObjectByName('crankset') ?? null,
    wheels: out,
    pedals: { L: group.getObjectByName('pedal_L') ?? null, R: group.getObjectByName('pedal_R') ?? null },
  };
}

/**
 * Matériaux d'un vélo, partagés par ses deux niveaux de détail : livrée du cadre, jantes et
 * guidoline aux couleurs du modèle, bidons à l'accent du maillot.
 */
export class BikeMaterials {
  private readonly livery: LiveryMaterial;
  private readonly byName = new Map<string, THREE.MeshStandardNodeMaterial>();
  /** Interrupteurs des effets de l'atelier (flancs arc-en-ciel, carbone apparent), par matériau. */
  private readonly fx = new Map<string, { value: number }>();
  private readonly boxes: (ReturnType<typeof decalBoxes>[number])[];
  private decalKey = '';
  private build: BikeBuild;
  private look: AvatarLook;
  /** Famille gravel : flancs de pneus beiges par défaut. */
  private readonly gravel: boolean;

  constructor(build: BikeBuild, look: AvatarLook, family: FamilyKey) {
    this.build = build;
    this.gravel = family === 'gravel';
    this.look = look;
    this.livery = new LiveryMaterial(build.livery);
    // Inscriptions du cadre (comme sur le vrai vélo) dans les boîtes de la famille.
    this.boxes = decalBoxes(familyScene(family));
    this.refreshDecals();
  }

  /** Inscriptions du cadre (marque, autocollants de l'atelier) : texture refaite si elles changent. */
  private refreshDecals(): void {
    const marks = frameMarks(this.build);
    const key = JSON.stringify(marks);
    if (key === this.decalKey) return;
    this.decalKey = key;
    this.livery.setDecals(wordmarkTexture(this.build, this.boxes), this.boxes, marks);
  }

  get(name: string): THREE.Material {
    if (name === 'frame') return this.livery.material;
    if (name.startsWith('rim_decal:')) return this.rimDecal(name);
    let m = this.byName.get(name);
    if (!m) {
      // « tire_wall:<r0>:<r1> » : flanc avec inscription, mêmes réglages que « tire_wall ».
      const [kind = name, r0, r1] = name.split(':');
      const def = BIKE_MATERIALS[kind] ?? ['#808080', 0.6, 0];
      m = new THREE.MeshStandardNodeMaterial({ color: def[0], roughness: def[1], metalness: def[2] });
      m.name = kind;
      const em = EMISSIVE[name];
      if (em) {
        m.emissive.set(em[0]);
        m.emissiveIntensity = em[1];
      }
      if (kind === 'tire_wall') {
        // Flancs arc-en-ciel : teinte selon l'angle autour de l'axe du moyeu (X).
        const on = uniform(0);
        const a = atan(positionGeometry.z, positionGeometry.y).mul(3);
        const hue = vec3(sin(a), sin(a.add(2.094)), sin(a.add(4.188))).mul(0.5).add(0.5);
        m.colorNode = mix(materialColor, hue, on);
        const tt = this.build.livery.tireText;
        if (tt && r0 && r1) m.colorNode = mix(m.colorNode, color(tt.color), polarLetters(tt.text, Number(r0), Number(r1), 0.62));
        m.userData.fx = on;
      } else if (name === 'disc_face') {
        // Flancs peints : graphisme en coordonnées polaires autour de l'axe du moyeu (X), lisible des deux côtés.
        const kind = uniform(0);
        const p = positionGeometry;
        const r = length(vec2(p.y, p.z)).div(0.33);
        const t = atan(p.z, p.y).div(2 * Math.PI).mul(sign(p.x));
        const rR = max(r, float(0.1));
        const ring = step(float(0.2), r).mul(step(r, float(0.94)));
        const wedge = (c: number, w: number) => step(abs(t.sub(c)), rR.mul(w)).mul(ring);
        // « espada » : grand triangle rouge en haut à l'avant, pan bleu en bas, filet jaune.
        const espada = mix(mix(mix(materialColor, color('#d8262e'), wedge(0.2, 0.17)), color('#1d3fa8'), wedge(-0.15, 0.15)), color('#f4c300'), wedge(0.4, 0.04));
        // « petals » : huit secteurs qui tournent avec le rayon, rouge, jaune, bleu, blanc ; moyeu et jante gardent le fond.
        const sector = mod(floor(fract(t.add(r.mul(0.22))).mul(8)), 4);
        const pal = mix(mix(mix(color('#c8202a'), color('#f2c000'), step(float(1), sector)), color('#1d3fa8'), step(float(2), sector)), color('#f6f6f2'), step(float(3), sector));
        const petals = mix(materialColor, pal, step(float(0.24), r).mul(step(r, float(0.95))));
        m.colorNode = mix(mix(materialColor, espada, step(float(0.5), kind).mul(step(kind, float(1.5)))), petals, step(float(1.5), kind));
        this.fx.set(name, kind);
      } else if (CARBON_CAPABLE.has(name)) {
        // Carbone apparent : tissage fin, un peu de la couleur de la pièce.
        const on = uniform(0);
        const p = positionGeometry;
        const weave = mod(floor(p.x.mul(320)).add(floor(p.y.mul(320))).add(floor(p.z.mul(320))), 2);
        const carbon = mix(mix(color('#141518'), color('#2c2d33'), weave), materialColor, float(0.15));
        m.colorNode = mix(materialColor, carbon, on);
        const ct = this.build.livery.crankText;
        if (name === 'crank' && ct) m.colorNode = mix(m.colorNode, color(ct.color), crankLetters(ct.text));
        this.fx.set(name, on);
      }
      this.byName.set(name, m);
      this.tint(m);
    }
    return m;
  }

  /**
   * Surbrillance de l'atelier : lueur passagère (0–1) sur les matériaux nommés (« frame » : le
   * cadre, « rim_decal » : toutes les bandes décor, « number » : la plaque).
   */
  highlight(names: readonly string[], amount: number): void {
    const set = new Set(names);
    this.livery.highlight(set.has('frame') ? amount : 0);
    for (const [key, r] of this.rims) r.highlight(set.has('rim_decal') || set.has(key) ? amount : 0);
    for (const m of this.byName.values()) {
      const em = EMISSIVE[m.name];
      if (set.has(m.name) && amount > 0) {
        m.emissive.setRGB(1, 0.82, 0.25);
        m.emissiveIntensity = 0.55 * amount;
      } else if (em) {
        m.emissive.set(em[0]);
        m.emissiveIntensity = em[1];
      } else m.emissiveIntensity = 0;
    }
  }

  private readonly rims = new Map<string, RimDecalMaterial>();

  /** Bande décor d'une roue avec le nom de la marque (clé : rim_decal:<fond>:<r0>:<r1>). */
  private rimDecal(key: string): THREE.Material {
    let r = this.rims.get(key);
    if (!r) {
      const [, base, r0, r1] = key.split(':');
      r = new RimDecalMaterial({ base: base as RimBand['base'], r0: Number(r0), r1: Number(r1) }, this.build.params.rimBrand ?? '');
      this.rims.set(key, r);
      this.tintRim(r, base as RimBand['base']);
    }
    return r.material;
  }

  private tintRim(r: RimDecalMaterial, base: RimBand['base']): void {
    r.set(this.build.livery.rim, base === 'disc' ? (this.build.livery.disc ?? BIKE_MATERIALS.disc_face?.[0]) : undefined);
    r.setGlow(this.build.extras?.glow, !!this.build.extras?.holoRim);
  }

  /** Même vélo, nouvelle livrée ou nouvelle tenue : couleurs mises à jour sans recompiler. */
  update(build: BikeBuild, look: AvatarLook): void {
    this.build = build;
    this.look = look;
    this.livery.set(build.livery);
    this.refreshDecals();
    for (const m of this.byName.values()) this.tint(m);
    for (const [key, r] of this.rims) this.tintRim(r, key.split(':')[1] as RimBand['base']);
  }

  dispose(): void {
    this.livery.dispose();
    for (const m of this.byName.values()) m.dispose();
    for (const r of this.rims.values()) r.material.dispose();
  }

  private tint(m: THREE.MeshStandardNodeMaterial): void {
    // Vélo d'avant les compteurs GPS : compteur du cintre masqué.
    if (m.name === 'computer' || m.name === 'computer_screen') m.visible = this.build.params.computer !== false;
    const liv = this.build.livery;
    const ex = this.build.extras;
    const parts = (ex?.parts ?? {}) as Partial<Record<string, string>>;
    const col: Partial<Record<string, string | undefined>> = {
      // Bande décor sans marque de roue (vélo de base) : fondue dans la jante.
      rim_decal: this.build.params.rimBrand ? liv.rim : BIKE_MATERIALS.rim?.[0],
      disc_face: liv.disc,
      tire_wall: liv.tireWall ?? (this.gravel ? GRAVEL_WALL : undefined),
      saddle: liv.saddle,
      bar_tape: liv.tape ?? this.look.jerseyAccent,
      bottle: parts.bottle ?? liv.bottle ?? this.look.jerseyAccent,
    };
    const def = BIKE_MATERIALS[m.name];
    const own = (liv.parts ?? {}) as Partial<Record<string, string>>;
    const c = col[m.name] ?? (TUNABLE.has(m.name) ? (parts[m.name] ?? own[m.name]) : undefined) ?? def?.[0];
    if (c) m.color.set(c);
    // Pièces anodisées / dorées de l'atelier : métal poli ; sinon valeurs du modèle.
    const metal = !!ex?.metal?.includes(m.name as never);
    if (def) {
      m.metalness = metal ? 1 : def[2];
      m.roughness = metal ? 0.22 : def[1];
    }
    const fx = this.fx.get(m.name) ?? (m.userData.fx as { value: number } | undefined);
    if (fx) {
      if (m.name === 'disc_face') fx.value = liv.discArt === 'espada' ? 1 : liv.discArt === 'petals' ? 2 : 0;
      else fx.value = m.name === 'tire_wall' ? (ex?.rainbowWall ? 1 : 0) : ex?.carbon?.includes(m.name as never) ? 1 : 0;
    }
  }
}
