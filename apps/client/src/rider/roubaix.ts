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
import type { BikeBuild } from '@allezrobert/shared';
import { ROUBAIX_SIZES, type RoubaixSizeSpec } from '../../../../packages/shared/src/roubaixMetric.ts';
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

export function roubaixSpec(size: string): RoubaixSizeSpec | undefined {
  return ROUBAIX_SIZES.find((s) => s.size === size);
}

/** Charge une taille ; null si elle n'est pas modélisée ou si un fichier manque (le jeu garde alors le vélo générique). */
export async function loadRoubaix(size: string, baseUrl = '/models/bikes/roubaix/'): Promise<RoubaixBike | null> {
  const spec = roubaixSpec(size);
  if (!spec) return null;
  const loader = new GLTFLoader();
  try {
    const [l0, l1, l2, rotor] = await Promise.all([...spec.lods, spec.frontRotorPiece].map((f) => loader.loadAsync(`${baseUrl}${f}`)));
    if (!l0 || !l1 || !l2 || !rotor) return null;
    return { spec, lods: [l0.scene, l1.scene, l2.scene], frontRotor: rotor.scene };
  } catch (e) {
    console.warn(`Roubaix ${size} : fichiers indisponibles`, e);
    return null;
  }
}

/** Déplacement (m) de la selle et de la tige pour un abaissement donné (mm), borné à [0 ; maxDropMm]. */
export function seatpostOffset(spec: RoubaixSizeSpec, dropMm: number): THREE.Vector3 {
  const d = THREE.MathUtils.clamp(Number.isFinite(dropMm) ? dropMm : 0, 0, spec.seatpost.maxDropMm) / 1000;
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
 * ses inscriptions dans les boîtes decal_* du modèle ; les autres primitives des matériaux simples. Navigateur seulement
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
        m = new THREE.MeshStandardNodeMaterial({ color: def[0], roughness: def[1], metalness: def[2] });
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
