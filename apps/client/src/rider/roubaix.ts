/**
 * Specialized Roubaix Sport 2020, modèle dédié par taille de cadre (asset Tripo retravaillé, fil T2c) : chargeur ISOLÉ.
 *
 * Étape I-3 : utilisé seulement par le banc roubaix-test.html. Il n'est branché ni sur bikes.ts ni sur gltfAvatar.ts
 * (étape I-4 : vraies tailles de cadre choisies d'après la taille du coureur, plage 142–195 cm).
 *
 * Fichiers : public/models/bikes/roubaix/<taille>_lod{0,1,2}.glb. Chaque GLB a les nœuds frame, fork, cockpit, saddle,
 * seatpost, etrier_arriere, etrier_avant (une primitive par matériau : frame, components, boot, bar_tape, hood, saddle,
 * seatpost, caliper ; COLOR_0 = zones de livrée sur « frame ») et les ancres axle_front, axle_rear, hand_L, hand_R, decal_*.
 * Repère du client (mètres, +x gauche, +y haut, +z avant), origine au sol : boîtier à groundOffsetMm, roues du jeu au sol.
 *
 * Le cadre s'affiche à l'échelle 1 (décision du 14/11/2026) : ne jamais le mettre à l'échelle avec le coureur, les étriers
 * sont à 0,30 mm des disques. Les roues sont celles du jeu, avec les disques propres à la taille (fitRoubaixWheels).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BIKE_REFERENCE, PLAIN_BIKE_FAMILY, type BikeBuild } from '@allezrobert/shared';
import { ROUBAIX_MODEL_ID, ROUBAIX_SIZE_GUIDE, ROUBAIX_SIZES, roubaixSizeFor, type RoubaixSizeBand, type RoubaixSizeSpec } from '../../../../packages/shared/src/roubaixMetric.ts';
import { LOOK785_MODEL_ID, LOOK785_SIZE_GUIDE, LOOK785_SIZES } from '../../../../packages/shared/src/look785Metric.ts';
import { type BikeMaterials, familyScene, libraryWheel } from './bikes.ts';
import { LiveryMaterial } from './livery.ts';
import { decalBoxes, frameMarks, wordmarkTexture } from './wordmarks.ts';

/** Couleur, rugosité, métal des matériaux autres que le cadre (le cadre prend la livrée). */
export const ROUBAIX_MATERIALS: Readonly<Record<string, readonly [string, number, number]>> = {
  components: ['#1b1c1f', 0.45, 0.3],
  boot: ['#151515', 0.85, 0],
  bar_tape: ['#141414', 0.9, 0],
  hood: ['#111111', 0.75, 0],
  saddle: ['#121212', 0.7, 0],
  seatpost: ['#16171a', 0.4, 0.1],
  caliper: ['#2a2b2f', 0.4, 0.6],
};

export interface RoubaixBike {
  readonly spec: RoubaixSizeSpec;
  /** Niveaux de détail 0, 1, 2 (scènes glTF, une par niveau). */
  readonly lods: readonly [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  /** Disque avant et araignée de la taille (repère de la roue, axe à l'origine). */
  readonly frontRotor: THREE.Object3D;
}

/**
 * Modèles du catalogue montés en vélo dédié par taille (même chargeur, même ajustement du coureur) : Roubaix Sport 2020
 * (tailles 44, 54) et LOOK 785 Huez RS (XS, M, L, XL, cadre procédural). Les noms de taille sont uniques entre modèles.
 */
export const DEDICATED_BIKES: Readonly<Record<string, { readonly sizes: readonly RoubaixSizeSpec[]; readonly guide: readonly RoubaixSizeBand[] }>> = {
  [ROUBAIX_MODEL_ID]: { sizes: ROUBAIX_SIZES, guide: ROUBAIX_SIZE_GUIDE },
  [LOOK785_MODEL_ID]: { sizes: LOOK785_SIZES, guide: LOOK785_SIZE_GUIDE },
};

export function roubaixSpec(size: string): RoubaixSizeSpec | undefined {
  for (const m of Object.values(DEDICATED_BIKES)) {
    const s = m.sizes.find((x) => x.size === size);
    if (s) return s;
  }
  return undefined;
}

/**
 * Charge une taille (de n'importe quel modèle dédié) ; null si elle n'est pas modélisée ou si un fichier manque (le jeu garde
 * alors le vélo générique). Fichiers dans /models/bikes/<dir>/ ; la pièce de disque avant est toujours dans roubaix/.
 */
export async function loadRoubaix(size: string, baseUrl?: string): Promise<RoubaixBike | null> {
  const spec = roubaixSpec(size);
  if (!spec) return null;
  const loader = new GLTFLoader();
  const dir = baseUrl ?? `/models/bikes/${spec.dir ?? 'roubaix'}/`;
  try {
    const [l0, l1, l2, rotor] = await Promise.all([
      ...spec.lods.map((f) => loader.loadAsync(`${dir}${f}`)),
      loader.loadAsync(`${baseUrl ?? '/models/bikes/roubaix/'}${spec.frontRotorPiece}`),
    ]);
    if (!l0 || !l1 || !l2 || !rotor) return null;
    return { spec, lods: [l0.scene, l1.scene, l2.scene], frontRotor: rotor.scene };
  } catch (e) {
    console.warn(`Roubaix ${size} : fichiers indisponibles`, e);
    return null;
  }
}

/** Déplacement (m) de la selle et de la tige pour un abaissement donné (mm), borné à [minDropMm (≤ 0, rehausse) ; maxDropMm]. */
export function seatpostOffset(spec: RoubaixSizeSpec, dropMm: number): THREE.Vector3 {
  const d = THREE.MathUtils.clamp(Number.isFinite(dropMm) ? dropMm : 0, spec.seatpost.minDropMm ?? 0, spec.seatpost.maxDropMm) / 1000;
  const [x, y, z] = spec.seatpost.directionUp;
  return new THREE.Vector3(-x * d, -y * d, -z * d);
}

/** Abaisse selle et tige (nœuds « saddle » et « seatpost ») le long de l'axe de la tige ; renvoie l'abaissement appliqué (mm). */
export function setSaddleDrop(root: THREE.Object3D, spec: RoubaixSizeSpec, dropMm: number): number {
  const off = seatpostOffset(spec, dropMm);
  for (const name of ['saddle', 'seatpost']) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    const base = (o.userData.basePosition ??= o.position.clone()) as THREE.Vector3;
    o.position.copy(base).add(off);
  }
  return off.length() * 1000;
}

/** Matériaux d'un Roubaix habillé : livrée du cadre (avec inscriptions) et matériaux simples des pièces. */
export interface RoubaixDress {
  readonly livery: LiveryMaterial;
  dispose(): void;
}

/**
 * Habille un niveau de détail : le cadre (primitives « frame » des nœuds frame et fork) prend la livrée du catalogue avec
 * ses inscriptions dans les boîtes decal_* du modèle ; les autres primitives des matériaux simples (selle et guidoline aux
 * couleurs `livery.saddle` et `livery.tape` du catalogue quand elles sont données). Navigateur seulement
 * (les inscriptions sont dessinées sur un canevas).
 */
export function dressRoubaix(root: THREE.Object3D, spec: RoubaixSizeSpec, build: BikeBuild): RoubaixDress {
  const livery = new LiveryMaterial(build.livery);
  livery.setFrameOffset(...spec.liveryFrameOffsetM);
  // Boîtes posées sur le modèle (comme la Madone) : pas de recalage sur des tubes génériques, pas de bidon.
  const boxes = decalBoxes(root, false, false);
  livery.setDecals(wordmarkTexture(build, boxes), boxes, frameMarks(build));
  const owned = new Map<string, THREE.MeshStandardNodeMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    if (name === 'frame') mesh.material = livery.material;
    else {
      let m = owned.get(name);
      if (!m) {
        const def = ROUBAIX_MATERIALS[name] ?? (['#808080', 0.6, 0] as const);
        // Selle et guidoline aux couleurs de la livrée du catalogue quand elle les donne (comme les vélos des familles).
        const color = (name === 'saddle' ? build.livery.saddle : name === 'bar_tape' ? build.livery.tape : undefined) ?? def[0];
        m = new THREE.MeshStandardNodeMaterial({ color, roughness: def[1], metalness: def[2] });
        m.name = name;
        owned.set(name, m);
      }
      mesh.material = m;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return { livery, dispose: () => { livery.dispose(); for (const m of owned.values()) m.dispose(); } };
}

/**
 * Disques propres à la taille sur les roues du jeu (wheels.glb, roues à l'origine) : à l'avant, le disque du jeu est masqué et
 * remplacé par la pièce de la taille (disque au plan rotors.front, araignée dérivée) ; à l'arrière, le disque de 140 est
 * masqué et remplacé par le disque de 160 de la roue avant, décalé au plan rotors.rear. Les matériaux des disques du jeu sont
 * repris. Renvoie false si une roue n'a pas de disque.
 */
export function fitRoubaixWheels(front: THREE.Object3D, rear: THREE.Object3D, bike: RoubaixBike): boolean {
  const fr = front.getObjectByName(`${front.name}_rotor`), rr = rear.getObjectByName(`${rear.name}_rotor`);
  if (!fr || !rr) return false;
  const rotorMats: THREE.Material[] = [];
  fr.traverse((o) => { if ((o as THREE.Mesh).isMesh) rotorMats.push((o as THREE.Mesh).material as THREE.Material); });
  // Avant : pièce de la taille, matériaux du disque du jeu dans l'ordre (disque, araignée).
  const piece = bike.frontRotor.clone(true);
  piece.name = `${front.name}_rotor_roubaix`;
  let i = 0;
  piece.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = rotorMats[Math.min(i++, rotorMats.length - 1)] ?? m.material; });
  fr.visible = false;
  front.add(piece);
  // Arrière : disque de 160 (celui de l'avant du jeu, plan 44) décalé au plan de la taille.
  const r160 = fr.clone(true);
  r160.name = `${rear.name}_rotor_roubaix`;
  r160.visible = true;
  r160.position.x += (bike.spec.rotors.rear.planeXMm - 44) / 1000;
  rr.visible = false;
  rear.add(r160);
  return true;
}

/** Position (m) d'une ancre du modèle (axle_front, axle_rear, hand_L, hand_R…), null si absente. */
export function roubaixAnchor(root: THREE.Object3D, name: string): THREE.Vector3 | null {
  const o = root.getObjectByName(name);
  return o ? o.position.clone() : null;
}

// ---------------------------------------------------------------------------------------------
// Montage complet et ajustement du coureur (étape I-4b)
// ---------------------------------------------------------------------------------------------

/**
 * Taille de vélo dédié pour une taille de coureur : la taille modélisée la plus proche dans le guide du modèle (Roubaix :
 * 44 jusqu'à 160 cm, 54 jusqu'à 183, 61 au-delà ; LOOK 785 : XS jusqu'à 168 cm, M jusqu'à 179, L jusqu'à 187, XL au-delà) ; `forced` (option
 * ?roubaix=<taille>) l'emporte quand c'est une taille de ce modèle.
 */
export function roubaixSizeForRider(heightCm: number | undefined, forced?: string | null, bikeModel: string = ROUBAIX_MODEL_ID): string | null {
  const m = DEDICATED_BIKES[bikeModel];
  if (!m) return null;
  if (forced) return m.sizes.some((s) => s.size === forced) ? forced : null;
  if (!heightCm) return null;
  return roubaixSizeFor(heightCm, m.sizes.map((s) => s.size), m.guide);
}

/** Le look choisit-il un modèle monté en vélo dédié (Roubaix Sport 2020, LOOK 785 Huez RS) ? */
export function isRoubaixLook(bikeModel: string | undefined): boolean {
  return bikeModel !== undefined && bikeModel in DEDICATED_BIKES;
}

/** Un niveau de détail du Roubaix monté : cadre habillé, roues du jeu (disques de la taille), pédalier et pédales de série. */
export interface RoubaixAssembly {
  readonly group: THREE.Group;
  readonly frame: THREE.Object3D;
  readonly wheels: THREE.Object3D[];
  readonly crank: THREE.Object3D | null;
  readonly pedals: Record<'L' | 'R', THREE.Object3D | null>;
  readonly dress: RoubaixDress;
}

/**
 * Monte un niveau de détail (0, 1, 2) dans le repère du vélo (mètres, échelle 1) : cadre habillé de la livrée (dressRoubaix),
 * roues du look (bibliothèque du jeu, niveau 0 ou 1) aux ancres d'axe avec les disques de la taille, pédalier et pédales de
 * la famille de base descendus au boîtier du Roubaix, manivelle ramenée à celle du contrat le long du bras. Roues, pédalier
 * et pédales sont habillés par `materials` (matériaux du jeu). Null si la famille de base n'est pas chargée.
 */
export function assembleRoubaix(bike: RoubaixBike, lod: 0 | 1 | 2, build: BikeBuild, materials: BikeMaterials): RoubaixAssembly | null {
  let plain: THREE.Object3D;
  try {
    plain = familyScene(PLAIN_BIKE_FAMILY);
  } catch {
    return null;
  }
  const group = new THREE.Group();
  group.name = 'bike';
  const frame = bike.lods[lod].clone(true);
  group.add(frame);
  const dress = dressRoubaix(frame, bike.spec, build);
  const parts: THREE.Object3D[] = [];
  const wheels: THREE.Object3D[] = [];
  const f = libraryWheel(build, true, lod === 0 ? 0 : 1);
  const r = libraryWheel(build, false, lod === 0 ? 0 : 1);
  const af = roubaixAnchor(frame, 'axle_front');
  const ar = roubaixAnchor(frame, 'axle_rear');
  if (f && r && af && ar) {
    f.position.copy(af);
    r.position.copy(ar);
    fitRoubaixWheels(f, r, bike);
    f.name = 'wheel_front';
    r.name = 'wheel_rear';
    wheels.push(f, r);
    parts.push(f, r);
  }
  const bbRef = BIKE_REFERENCE.bottomBracket[1];
  const bb = bike.spec.groundOffsetMm / 1000;
  const ratio = (bike.spec.metric.dimensions.crankLengthM ?? BIKE_REFERENCE.crankLengthM) / BIKE_REFERENCE.crankLengthM;
  const crank = plain.getObjectByName('crankset')?.clone(true) ?? null;
  if (crank) {
    crank.position.y += bb - bbRef;
    crank.scale.multiplyScalar(ratio);
    parts.push(crank);
  }
  const pedals = { L: null, R: null } as Record<'L' | 'R', THREE.Object3D | null>;
  for (const s of ['L', 'R'] as const) {
    const p = plain.getObjectByName(`pedal_${s}`)?.clone(true);
    if (!p) continue;
    // Position de repos : même angle de manivelle, bras ramené à la longueur du contrat, autour du boîtier du Roubaix.
    p.position.set(p.position.x, bb + (p.position.y - bbRef) * ratio, p.position.z * ratio);
    pedals[s] = p;
    parts.push(p);
  }
  for (const o of parts) {
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = materials.get((mesh.userData.matKey as string | undefined) ?? (mesh.material as THREE.Material).name);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    group.add(o);
  }
  return { group, frame, wheels, crank, pedals, dress };
}

/**
 * Point d'assise d'une selle (ischions), même définition que le contrat (V1e-11) : milieu de la zone où la largeur atteint
 * 90 % du maximum, dessus de la selle près du plan médian (fenêtre élargie pour les maillages grossiers). Coordonnées du
 * repère de `root` (matrices mises à jour) ; null sans sommet.
 */
export function sitPointOf(saddle: THREE.Object3D, root: THREE.Object3D): THREE.Vector3 | null {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const P: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  saddle.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const a = m.geometry.getAttribute('position');
    const mw = m.matrixWorld.clone().premultiply(inv);
    for (let i = 0; i < a.count; i++) P.push(v.fromBufferAttribute(a, i).applyMatrix4(mw).clone());
  });
  if (!P.length) return null;
  const width = new Map<number, [number, number]>();
  for (const p of P) {
    const k = Math.round(p.z / 0.005);
    const e = width.get(k) ?? [Infinity, -Infinity];
    e[0] = Math.min(e[0], p.x);
    e[1] = Math.max(e[1], p.x);
    width.set(k, e);
  }
  const span = (k: number) => { const e = width.get(k) as [number, number]; return e[1] - e[0]; };
  const keys = [...width.keys()];
  const wmax = Math.max(...keys.map(span));
  const wide = keys.filter((k) => span(k) >= 0.9 * wmax);
  const z = ((Math.min(...wide) + Math.max(...wide)) / 2) * 0.005;
  for (const [xw, zw] of [[0.004, 0.004], [0.1 * wmax, 0.01], [0.25 * wmax, 0.02]] as const) {
    let y = -Infinity;
    for (const p of P) if (Math.abs(p.x) < xw && Math.abs(p.z - z) < zw) y = Math.max(y, p.y);
    if (Number.isFinite(y)) return new THREE.Vector3(0, y, z);
  }
  return null;
}

/** Point d'assise du Roubaix (repère du vélo, m) pour un abaissement de selle donné (mm, le long de la tige). */
export function roubaixSeat(spec: RoubaixSizeSpec, dropMm: number): THREE.Vector3 {
  const s = spec.metric.contacts.saddle?.originM ?? [0, 0, 0];
  return new THREE.Vector3(s[0], s[1], s[2]).add(seatpostOffset(spec, dropMm));
}

/**
 * Abaissement de selle (mm, dans [minMm ; maxMm], minMm ≤ 0 = rehausse permise) qui annule `f`, fonction décroissante de
 * l'abaissement (p. ex. distance hanche–cheville au point bas moins la distance visée). f(min) ≤ 0 : min (jambe trop longue,
 * selle déjà au plus haut) ; f(max) ≥ 0 : max (jambe trop courte pour ce cadre).
 */
export function solveSeatDrop(f: (dropMm: number) => number, maxMm: number, minMm = 0): number {
  if (f(minMm) <= 0) return minMm;
  if (f(maxMm) >= 0) return maxMm;
  let a = minMm, b = maxMm;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (f(m) > 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * Option d'URL ?roubaix (étape I-4d : Roubaix dédié actif par défaut). Absente ou « 1 » : actif, taille de cadre choisie
 * d'après la taille du coureur ; « 0 » : coupé (vélo de la famille partout) ; une taille (« 44 ») : forcée.
 */
export function roubaixOption(search: string | null | undefined): { enabled: boolean; forced: string | null } {
  const v = search ? new URLSearchParams(search).get('roubaix') : null;
  if (v === '0') return { enabled: false, forced: null };
  return { enabled: true, forced: v && v !== '1' ? v : null };
}
