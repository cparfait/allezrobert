import { AERO_COAST_FULL, AERO_SPEED, AERO_SPEED_OUT, FOREARMS_IN, FOREARMS_OUT, HARD_EFFORT, HARD_EFFORT_OUT } from './poseThresholds.ts';
import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { flatLook } from './flatLook.ts';
import { LowPolyRider } from './lowPolyRider.ts';
import { ShoeMaterial } from './shoeMaterial.ts';
import { shoeDialOf } from './shoeLook.ts';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HAIR_STYLE_COUNT, PLAIN_BIKE_FAMILY, bikeOfLook, decodeFace, lookSex, type AvatarLook, type BikeBuild, type BikeFamily, type HelmetShape } from '@allezrobert/shared';
import { RiderAvatar } from './avatar.ts';
import { buildBikeKit, roadPartsReplaced, type BikeType } from './bikeKits.ts';
import { FaceAnimator } from './face.ts';
import { boxOfMeshes, capGeometry, capMaterials } from './cap.ts';
import { AERO_HELMET_GROUPS, aeroHelmetGeometry } from './aeroHelmet.ts';
import { SkinMaterial, loadSkinTextures, skinTextures, type SkinLook } from './skin.ts';
import { applyClothLook, clothTextures, isClothPart, loadClothTextures, makeClothMaterial, type JerseyAxis } from './cloth.ts';
import { addFrameAttributes, addJerseyFrame, addSleeveMask, type JerseyFrame } from './jerseyPattern.ts';
import { applyTexturedLook, loadTexturedMasks, texturedMaterial } from './texturedLook.ts';
import { aerobarAnchors } from './aerobars.ts';
import { BikeMaterials, assembleBike, availableFamily, bikeAnchors, bikeFamilyReady, familyScene, loadBikeFamily, type AssembledBike, type BikeAnchors, type FamilyKey } from './bikes.ts';

/**
 * Cycliste et vélo modélisés dans Blender (tools/blender/build_cyclist.py), squelette piloté
 * procéduralement. Même API publique que RiderAvatar. Le vélo est assemblé à partir du
 * catalogue (bikes.ts) ; tant que sa famille de cadre n'est pas chargée, le vélo de base
 * (même livrée) le remplace.
 *
 * Repère local : +z = avant, +y = haut, +x = gauche. La pose de repos des modèles est la pose
 * de conduite (assis, mains sur les cocottes, pieds sur les pédales à l'angle de manivelle 0) ;
 * on calcule donc toutes les rotations comme des écarts à cette pose :
 *  - jambes : cinématique inverse à deux os, cheville calée sur la pédale (manivelle à la cadence),
 *    pied incliné selon le coup de pédale (« ankling ») ; les pédales automatiques suivent le pied ;
 *  - bras : cinématique inverse vers les mains du vélo (cocottes, ou prolongateurs des vélos de
 *    chrono, coudes vers les repose-coudes) ;
 *  - bassin / tronc : position assise, danseuse (bassin avancé, vélo qui balance, corps qui
 *    compense), roue libre (buste un peu relevé) ;
 *  - tête : regarde la route et compense en partie l'inclinaison du vélo.
 * LOD : niveaux simplifiés (FILES) au-delà de LOD_DISTANCES, liés au même squelette.
 */

export type RiderPose = 'seated' | 'standing' | 'coasting';

/**
 * Geste imposé (film d'accueil) : mains sur le cintre (sinon selon la vitesse et l'effort), regard
 * (rad : lacet > 0 vers la gauche du coureur, tangage > 0 tête baissée) et angle du pédalier (rad,
 * fonction du temps ; absent : il suit la cadence).
 */
export interface RiderGesture {
  hands?: 'hoods' | 'drops' | 'tops';
  yaw?: number;
  pitch?: number;
  crank?: number;
}

const RIDER_CAST_SHADOWS = false;

/**
 * Pièce assez grande pour que son ombre se voie (corps, cadre, roues, casque…) : les petites pièces
 * (visserie, valves, yeux, lunettes, cales…) ne projettent pas d'ombre. Chaque pièce qui en projette est
 * redessinée dans chaque cascade d'ombres : sur un coureur d'une soixantaine de pièces, c'est l'essentiel
 * des appels de dessin.
 */
function bigPart(mesh: THREE.Mesh): boolean {
  // Coureurs : plus d'ombres portées (elles scintillaient, la carte d'ombres n'étant recalculée qu'une
  // image sur deux) ; c'est aussi un gros gain d'appels de dessin.
  if (!RIDER_CAST_SHADOWS) return false;
  const cached = mesh.userData.bigPart as boolean | undefined;
  if (cached !== undefined) return cached;
  let big: boolean;
  const name = `${mesh.parent?.name ?? ''} ${mesh.name}`;
  // Coureur (maillage articulé, positions compressées : pas en mètres) : d'après le nom de la pièce.
  if (/rider_/.test(name)) big = !/rider_(eyes|glasses|moustache|helmet_straps)/.test(name);
  else {
    // Vélo et roues (en mètres) : rayon de la pièce d'au moins 10 cm.
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    big = (g.boundingSphere?.radius ?? 1) >= 0.1;
  }
  mesh.userData.bigPart = big;
  return big;
}

/** Interface commune aux avatars procédural et glTF. */
export interface RiderAvatarLike {
  readonly root: THREE.Group;
  readonly label: THREE.Sprite | null;
  update(dt: number, cadence: number, speed: number, pose: RiderPose, bank?: number): void;
  setLook(look: AvatarLook): void;
  /** Bras levés en V (victoire à la ligne d'arrivée). */
  setCelebrating?(on: boolean): void;
  /** Tête nue (aperçu de l'éditeur de visage). */
  setBareHead?(on: boolean): void;
  /** Effort du coureur (puissance / FTP, FC / FC max) : expressions du visage (avatar MPFB). */
  setEffort?(ftpFrac: number, hrFrac?: number): void;
  /** Geste imposé (film d'accueil), pris en compte au prochain update(). */
  setGesture?(g: RiderGesture): void;
  setHeadVisible(on: boolean): void;
  setShadows(on: boolean): void;
  /** Position des yeux (repère monde) pour la vue subjective ; absente : position estimée par la caméra. */
  eyeWorld?(out: THREE.Vector3, hands?: THREE.Vector3): THREE.Vector3;
}

/** Rôles des os pilotés (noms de cyclist.glb) ; spine2 et les clavicules n'existent que dans certains squelettes. */
const BONES = [
  'hips', 'spine', 'spine2', 'chest', 'neck', 'head',
  'clavicle_L', 'upper_arm_L', 'forearm_L', 'hand_L', 'thigh_L', 'shin_L', 'foot_L',
  'clavicle_R', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R',
] as const;
type BoneName = (typeof BONES)[number];
type Side = 'L' | 'R';
const SIDES: readonly Side[] = ['L', 'R'];
const OPTIONAL_BONES: ReadonlySet<BoneName> = new Set(['spine2', 'clavicle_L', 'clavicle_R']);

/**
 * Nom des os par squelette : cyclist.glb (build_cyclist.py) ou avatar MPFB, squelette « game_engine »
 * (tools/blender/avatars/build_avatar.py, docs/AVATARS.md).
 */
const RIG_BONES: Record<'classic' | 'mpfb', Partial<Record<BoneName, string>>> = {
  classic: Object.fromEntries(BONES.filter((b) => !OPTIONAL_BONES.has(b)).map((b) => [b, b])),
  mpfb: {
    hips: 'pelvis', spine: 'spine_01', spine2: 'spine_02', chest: 'spine_03', neck: 'neck_01', head: 'head',
    clavicle_L: 'clavicle_l', upper_arm_L: 'upperarm_l', forearm_L: 'lowerarm_l', hand_L: 'hand_l', thigh_L: 'thigh_l', shin_L: 'calf_l', foot_L: 'foot_l',
    clavicle_R: 'clavicle_r', upper_arm_R: 'upperarm_r', forearm_R: 'lowerarm_r', hand_R: 'hand_r', thigh_R: 'thigh_r', shin_R: 'calf_r', foot_R: 'foot_r',
  },
};

/**
 * Coureur affiché : avatar MPFB (docs/AVATARS.md) par défaut ; modèle acheté texturé
 * (tools/blender/avatars/build_boutique.py), pour les tests, avec ?avatar=boutique ; l'ancien
 * coureur (cyclist.glb) avec ?avatar=classic.
 */
const AVATAR_PARAM = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('avatar');
export type AvatarKind = 'boutique' | 'mpfb' | 'classic' | 'female';
const AVATAR_KIND: AvatarKind = AVATAR_PARAM === 'classic' || AVATAR_PARAM === 'boutique' ? AVATAR_PARAM : 'mpfb';
/**
 * Fichiers du coureur par niveau de détail et distance (m) d'apparition de chaque niveau
 * (avatar MPFB : 27,9 k, 5 k et 2,5 k triangles pour le corps ; modèle acheté : 47,8 k, 16,7 k
 * et 7,1 k triangles en tout).
 */
const FILES: Record<AvatarKind, readonly string[]> = {
  boutique: ['avatar/boutique/rider.glb', 'avatar/boutique/rider_lod1.glb', 'avatar/boutique/rider_lod2.glb'],
  // Style jeu vidéo : le niveau le plus simple (2,5 k triangles) à toutes les distances, à facettes.
  mpfb: LOW_POLY ? ['avatar/rider_lod2.glb'] : ['avatar/rider.glb', 'avatar/rider_lod1.glb', 'avatar/rider_lod2.glb'],
  classic: ['cyclist.glb', 'cyclist_lod1.glb'],
  // Modèle MPFB féminin de base (build_avatar.py --variant female) : choisi pour les looks « sex < 0 ».
  female: LOW_POLY ? ['avatar/rider_female_lod2.glb'] : ['avatar/rider_female.glb', 'avatar/rider_female_lod1.glb', 'avatar/rider_female_lod2.glb'],
};
const LOD_DISTANCES: Record<AvatarKind, readonly number[]> = { boutique: [0, 10, 30], mpfb: [0, 10, 30], classic: [0, 30], female: [0, 10, 30] };
const WHEEL_R = 0.335;
/** Phase de pédale des deux pieds dans la pose de repos de l'avatar MPFB (BIND_PHASE de build_avatar.py : en bas). */
const BIND_PHASE = 0;
/**
 * Taille du coureur (look.heightCm, profil du joueur) : modèle acheté construit à 1,765 m
 * (build_boutique.py), coureurs de 1,60 à 1,95 m. Coureur, cadre, poste de pilotage et selle
 * suivent la taille (taille de cadre) ; roues, pédalier et pédales gardent leurs dimensions
 * réelles. Point fixe : axe des roues à l'aplomb du pédalier (roues toujours au sol).
 */
const MODEL_HEIGHT_CM = 176.5;
/** Avatar MPFB (build_avatar.py) : stature mesurée sur le squelette (jambe + tronc + cou + tête) ≈ 1,75 m. */
const MPFB_HEIGHT_CM = 175;
/** Avatar féminin (build_avatar.py --variant female, jambes à la longueur du vélo de référence) : stature mesurée ≈ 1,748 m. */
const FEMALE_HEIGHT_CM = 175;
/** Flexion du genou visée, pédale en bas (route : 145° ± 5°). */
const KNEE_BOTTOM_DEG = 145;
const HEIGHT_RANGE_CM: readonly [number, number] = [160, 195];
/**
 * Position chrono, par unité de « tuck » (rad) : surtout le bassin qui bascule vers l'avant (dos
 * plat), un peu la colonne et le thorax ; la tête se relève pour regarder la route.
 */
const TUCK_HIPS = 0.5;
const TUCK_SPINE = 0.08;
const TUCK_CHEST = 0.12;

/** Coque de cheveux montrée tête nue, par coiffure (objets `rider_hairs_<nom>` du modèle). */
const HAIR_SHELL: Record<number, string> = { 0: 'cut', 1: 'slick', 2: 'slick', 4: 'fade', 5: 'curls', 6: 'bob', 7: 'slick', 8: 'quiff', 9: 'long', 10: 'slick', 11: 'slick' };
const TUCK_HEAD = 0.35;
/**
 * Positions sur un cintre route (bascule en unités de « tuck », ajoutée à la position assise validée
 * sur les cocottes, dos ≈ 41° : « détendue »), d'après la planche des quatre positions (angle du dos,
 * hanche → épaule) : course, mains en bas du cintre (dos ≈ 20°) ; aéro en descente, dos à plat, tête
 * basse, mains en bas du cintre, avant-bras presque à l'horizontale ; très détendue à petite allure, mains en
 * haut du cintre, buste relevé (≈ 46° : au-delà, les bras tendus n'atteignent plus un cintre route).
 */
const DROPS_BEND = 0.62;
const AERO_BEND = 1.0;
const RELAX_BEND = -0.06;
/** Ischions sur la selle par rapport à l'os du bassin (mesuré : selle 6 cm sous lui et 6 cm derrière). */
const SEAT_FROM_HIPS = { y: -0.06, z: -0.06 };
/** Tête en position de course (rad par unité, > 0 : vers le bas) : basse, dans l'alignement du dos, regard sous la visière. */
const RACE_HEAD = 0.12;
/** Vitesses (m/s) : bas du cintre au-dessus de DROPS_IN, retour aux cocottes sous DROPS_OUT ; aéro en roue libre au-delà de AERO_FROM → AERO_FULL. */
const DROPS_IN = AERO_SPEED;
const DROPS_OUT = AERO_SPEED_OUT;
const AERO_FROM = AERO_SPEED;
const AERO_FULL = AERO_COAST_FULL;
/**
 * Positions aéro sur un cintre route, sans prolongateurs, en pédalant assis (en plus des positions
 * ci-dessus) :
 *  - « très fort » (au-delà de HOODS_AERO_EFFORT × FTP, plus vite que HOODS_AERO_SPEED) : mains sur les
 *    cocottes, avant-bras à l'horizontale, coudes rentrés vers l'arrière, dos à plat (HOODS_AERO_BEND) ;
 *  - « très vite » (au-delà de FOREARMS_IN m/s, ≈ 50 km/h) : avant-bras posés sur le haut du cintre de part
 *    et d'autre de la potence (FOREARM_ELBOW : coude posé sur le cintre), mains en avant ;
 *    le buste bascule jusqu'à poser les avant-bras, comme sur les repose-coudes d'un vélo de chrono.
 */
const HOODS_AERO_EFFORT = HARD_EFFORT;
const HOODS_AERO_EFFORT_OUT = HARD_EFFORT_OUT;
const HOODS_AERO_SPEED = AERO_SPEED;
const HOODS_AERO_BEND = 0.95;
const FOREARM_ELBOW = new THREE.Vector3(0.075, 0.915, 0.51);
/**
 * Prolongateurs de l'atelier sur un vélo de route (aerobars.ts) : couché dessus (coudes sur les
 * repose-coudes, mains aux poignées) au-delà de CLIP_IN m/s (≈ 40 km/h) ou très fort ; cocottes sinon.
 */
const CLIP_IN = AERO_SPEED;
const CLIP_OUT = AERO_SPEED_OUT;
/**
 * Vélos de chrono (en plus de la position sur les prolongateurs) :
 *  - mains sur les cornes (cintre de base, build_tt_cockpit : bout des cornes) sous HORNS_IN m/s
 *    (≈ 25 km/h) et en danseuse, buste relevé (HORNS_UNTUCK de la bascule de chrono en moins) ;
 *  - « tortue » très vite (> TURTLE_IN, ≈ 50 km/h) ou très fort : dos encore plus plat, tête rentrée
 *    entre les épaules haussées, mains un peu plus hautes (photos d'Evenepoel, de Cofidis sur piste).
 */
const HORNS_IN = 7;
const HORNS_OUT = 8;
const HORNS_UNTUCK = 0.65;
const TT_HORN_PALM: Partial<Record<FamilyKey, THREE.Vector3>> = {
  tt: new THREE.Vector3(0.201, 0.774, 0.534),
  lotus: new THREE.Vector3(0.201, 0.772, 0.534),
  espada: new THREE.Vector3(0.201, 0.772, 0.534),
  lowpro: new THREE.Vector3(0.195, 0.778, 0.6),
};
const TURTLE_IN = 13.9;
const TURTLE_OUT = 12.8;
const TURTLE_BEND = 0.18;
const TURTLE_HEAD = 0.4;
const TURTLE_SHRUG = 0.28;
const TURTLE_HANDS_UP = 0.035;
/** Très détendue : sous RELAX_IN (≈ 20 km/h), en roue libre ou sans forcer (< RELAX_EFFORT × FTP) ; quittée au-delà de RELAX_OUT. */
const RELAX_IN = 5.5;
const RELAX_OUT = 6.5;
const RELAX_EFFORT = 0.45;
/** Relevé du cou (rad) d'une morphologie entièrement féminine : tête nettement plus en arrière. */
const NECK_LIFT = -0.24;
/** Raccourcissement du cou (fraction) d'une morphologie entièrement féminine ; la tête garde sa taille. */
const NECK_SHORTEN = 0.3;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Matériaux : nom (glTF) → couleur par défaut, rugosité, métal. Les couleurs perso viennent du look. */
const MATERIALS: Record<string, [string, number, number]> = {
  skin: ['#e0b48f', 0.6, 0],
  jersey: ['#1f6feb', 0.7, 0],
  jersey_accent: ['#ffd23f', 0.7, 0],
  shorts: ['#15171c', 0.55, 0],
  sock: ['#f2f2f2', 0.8, 0],
  shoe: ['#f2f2f2', 0.4, 0],
  // Kits VTT et gravel (rider/bikeKits.ts) : poignées et selle, flancs beiges des pneus gravel.
  saddle_grip: ['#141518', 0.8, 0],
  tire_wall: ['#a9825a', 0.85, 0],
  mouth: ['#4a1c1e', 0.75, 0],
  lashes: ['#2b2019', 0.8, 0],
  shoe_sole: ['#151619', 0.3, 0],
  // Chaussures (build_shoes) : doublure et col, molettes (couleur selon la tige), câble et bande
  // réfléchissante, cale (corps rouge ; patins et têtes de vis gris).
  shoe_lining: ['#141518', 0.85, 0],
  shoe_dial: ['#f4f4f4', 0.3, 0],
  shoe_reflect: ['#c9ccd1', 0.3, 0.5],
  cleat: ['#c62828', 0.45, 0],
  cleat_pad: ['#6e7278', 0.8, 0],
  helmet: ['#f4f4f4', 0.35, 0],
  helmet_detail: ['#1c1d22', 0.6, 0],
  lens: ['#1c1f26', 0.06, 0.75],
  visor: ['#2a3340', 0.05, 0.7],
  glasses_frame: ['#141518', 0.35, 0],
  hair: ['#3b2a1e', 0.8, 0],
  components: ['#18191c', 0.45, 0.2],
  // Avatar MPFB : globes oculaires.
  eye: ['#eeebe4', 0.18, 0],
  iris: ['#5a3d22', 0.2, 0],
  pupil: ['#070707', 0.1, 0],
};

interface BoneRest {
  parent: BoneName | null;
  localQ: THREE.Quaternion;
  localP: THREE.Vector3;
  modelQ: THREE.Quaternion;
  modelP: THREE.Vector3;
}

/** Chaîne à deux os (jambe ou bras) : longueurs, pli de repos, repères de repos inversés. */
interface ChainRest {
  upper: BoneName;
  lower: BoneName;
  end: BoneName;
  l1: number;
  l2: number;
  pole: THREE.Vector3;
  invUpper: THREE.Quaternion;
  invLower: THREE.Quaternion;
}

interface Templates {
  /** Niveaux de détail du coureur (0 : complet, avec le squelette animé). */
  riders: GLTF[];
  /** Rôle → nom de l'os dans le fichier (rôles facultatifs absents si le squelette ne les a pas). */
  names: Partial<Record<BoneName, string>>;
  bones: Record<BoneName, BoneRest>;
  armQ: THREE.Quaternion;
  armP: THREE.Vector3;
  legs: Record<Side, ChainRest>;
  arms: Record<Side, ChainRest>;
  bb: THREE.Vector3;
  crank: number;
  pedalRest: Record<Side, THREE.Vector3>;
  pedalPitch: number;
  /** Cheville par rapport à l'axe de pédale, pied à plat. */
  ankleFlat: Record<Side, THREE.Vector3>;
  /** Yeux par rapport à l'os de la tête, pose de repos (repère modèle). */
  eyeRest: THREE.Vector3;
  /** Mains sur le vélo de base (= pose de repos) : les mains du coureur suivent l'écart. */
  refHands: Record<Side, THREE.Vector3>;
  /**
   * Poignet moins milieu de la paume, pose de repos (avatar MPFB, qui a des doigts) : sur un cintre
   * route, la paume est posée sur la cocotte (HOOD_PALM) plutôt que d'appliquer l'écart d'ancres.
   */
  wristFromPalm: Record<Side, THREE.Vector3> | null;
  /**
   * Modèle acheté : matériaux « tex_* » du niveau 0, texturés, gardés tels quels (pas de couleurs
   * de tenue) ; les niveaux suivants, exportés sans images, prennent les mêmes. Vide sinon.
   */
  textured: Map<string, THREE.MeshStandardMaterial>;
  /** Avatar MPFB : axe du buste au repos (bandes des maillots de champion), repère du maillage. */
  jerseyAxis: JerseyAxis | null;
  /** Mesures du maillot (motifs et logos du shader : pois, manches, logo…) ; null sans maillot. */
  jersey: JerseyFrame | null;
}

/**
 * Milieu de la paume sur la cocotte gauche (repère du vélo ; x opposé à droite). Les familles
 * route partagent le même poste de pilotage : cocotte de z 0,554 à 0,670, sommet 0,917 m au bec,
 * dessus ≈ 0,90 m au milieu ; la paume repose dessus, les doigts tombent sur le côté.
 */
/** Part de l'écart latéral du pli de coude de repos conservée sur route / VTT (1 = pli du modèle, coudes très ouverts vus de dos). */
const ELBOW_FLARE = 0.45;
/** Position aéro (descente) : part de cet écart encore retirée, coudes rentrés le long du buste. */
const AERO_ELBOW_IN = 0.8;
const HOOD_PALM = new THREE.Vector3(0.2, 0.9, 0.565);
/** VTT : milieu de la paume sur la poignée du cintre plat (bikeKits.ts : poignées à y 0,958, z 0,54, x de 0,165 à 0,3). */
const MTB_PALM = new THREE.Vector3(0.235, 1.0, 0.535);
/** Bas du cintre route : milieu de la paume sur la partie droite du crochet (ruban mesuré : bas à y 0,746, de z 0,49 à 0,56). */
const DROP_PALM = new THREE.Vector3(0.215, 0.772, 0.532);
/** Haut du cintre : paume sur le cintre de part et d'autre de la potence (cintre à z ≈ 0,515, dessus ≈ 0,885 m). */
const TOP_PALM = new THREE.Vector3(0.12, 0.895, 0.505);
/** Doigts refermés sur la cocotte (ou le prolongateur) : flexion par phalange (rad, axe X local) ; l'index, tendu au repos, plus. */
const GRIP_CURL = 0.5;
const GRIP_CURL_INDEX = 0.8;

/** Modèles chargés par type d'avatar (le film mêle l'avatar MPFB de Robert et le modèle acheté). */
const templates = new Map<AvatarKind, Templates>();
const loading = new Map<AvatarKind, Promise<boolean>>();

// Temporaires (aucune allocation par image).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _vPole = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _id = new THREE.Quaternion();

/** Quaternion de la base orthonormée (dir, n ⟂ dir, dir × n). */
function frameQuat(dir: THREE.Vector3, n: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _bx.copy(dir).normalize();
  _by.copy(n).addScaledVector(_bx, -n.dot(_bx)).normalize();
  _bz.crossVectors(_bx, _by);
  _m.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_m);
}

/**
 * Cinématique inverse à deux os (même formule que le script Blender) : renvoie l'articulation
 * intermédiaire (genou / coude) dans outMid et la normale du plan de flexion dans outN.
 */
function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3, outN: THREE.Vector3): void {
  const dir = _v1.subVectors(target, root);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  dir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const bend = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  outMid.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
  outN.crossVectors(bend, dir).normalize();
}

function decompose(o: THREE.Object3D, q: THREE.Quaternion, p: THREE.Vector3): void {
  o.matrixWorld.decompose(p, q, _scale);
}

function chainRest(bones: Record<BoneName, BoneRest>, upper: BoneName, lower: BoneName, end: BoneName): ChainRest {
  const a = bones[upper].modelP;
  const b = bones[lower].modelP;
  const c = bones[end].modelP;
  const dir = new THREE.Vector3().subVectors(c, a).normalize();
  const ab = new THREE.Vector3().subVectors(b, a);
  const pole = ab.clone().addScaledVector(dir, -ab.dot(dir)).normalize();
  const n = new THREE.Vector3().crossVectors(pole, dir).normalize();
  const bc = new THREE.Vector3().subVectors(c, b);
  return {
    upper,
    lower,
    end,
    l1: ab.length(),
    l2: bc.length(),
    pole,
    invUpper: frameQuat(ab, n, new THREE.Quaternion()).invert(),
    invLower: frameQuat(bc, n, new THREE.Quaternion()).invert(),
  };
}

/**
 * Cibles d'identité (curseurs de forme « nom+ » / « nom− », docs/AVATARS.md § 4) d'une géométrie,
 * retirées des cibles animées : elles ne bougent pas pendant une sortie et sont appliquées une fois
 * sur le processeur (setFace), sans coût au rendu.
 */
interface IdentityTargets {
  names: string[];
  pos: Float32Array[];
  nrm: (Float32Array | null)[];
}

const IDENTITY = /[+-]$/;

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i);
    out[i * 3 + 1] = a.getY(i);
    out[i * 3 + 2] = a.getZ(i);
  }
  return out;
}

/**
 * Attributs flottants, non entrelacés (positions, normales et cibles quantifiées par la
 * compression du modèle) : three.js r186 (WebGPURenderer) applique mal les cibles animées sur des
 * attributs quantifiés et entrelacés. Les valeurs restent dans l'espace quantifié du maillage
 * (la transformation du nœud, intégrée à la liaison du squelette, les remet à l'échelle).
 */
function plainAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, a.itemSize);
}

function plainAttributes(g: THREE.BufferGeometry): void {
  for (const k of ['position', 'normal']) {
    const a = g.getAttribute(k);
    if (a && (a.normalized || (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(a.array instanceof Float32Array))) g.setAttribute(k, plainAttribute(a));
  }
  const ma = g.morphAttributes as Record<string, Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>>;
  for (const k of Object.keys(ma)) ma[k] = (ma[k] ?? []).map(plainAttribute);
}

function extractIdentity(scene: THREE.Object3D): void {
  const done = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    const dict = mesh.morphTargetDictionary;
    if (!mesh.isMesh || !g || !dict) return;
    if (!done.has(g)) {
      done.add(g);
      plainAttributes(g);
      const names = Object.keys(dict).sort((a, b) => (dict[a] as number) - (dict[b] as number));
      const keep = names.map((n) => !IDENTITY.test(n));
      if (keep.every(Boolean)) return;
      const pos = g.morphAttributes.position ?? [];
      const nrm = g.morphAttributes.normal;
      const id: IdentityTargets = { names: [], pos: [], nrm: [] };
      names.forEach((n, i) => {
        if (keep[i]) return;
        id.names.push(n);
        id.pos.push(toFloat(pos[i] as THREE.BufferAttribute));
        id.nrm.push(nrm?.[i] ? toFloat(nrm[i] as THREE.BufferAttribute) : null);
      });
      g.morphAttributes.position = pos.filter((_, i) => keep[i]);
      if (nrm) g.morphAttributes.normal = nrm.filter((_, i) => keep[i]);
      if (g.morphAttributes.position.length === 0) {
        delete g.morphAttributes.position;
        delete g.morphAttributes.normal;
      }
      g.userData.identity = id;
      g.userData.animNames = names.filter((_, i) => keep[i]);
    }
    // Dictionnaire et poids recalculés sur les cibles animées restantes.
    const anim = g.userData.animNames as string[] | undefined;
    if (anim) {
      mesh.morphTargetDictionary = Object.fromEntries(anim.map((n, i) => [n, i]));
      mesh.morphTargetInfluences = anim.map(() => 0);
      if (!anim.length) {
        mesh.morphTargetDictionary = undefined;
        mesh.morphTargetInfluences = undefined;
      }
    }
  });
}

function smoothNormals(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position');
  const idx = g.index;
  const n = new Float32Array(p.count * 3);
  const key = (i: number): string => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  const weld = new Map<string, number>();
  const rep = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    let r = weld.get(k);
    if (r === undefined) weld.set(k, (r = i));
    rep[i] = r;
  }
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const count = idx ? idx.count : p.count;
  for (let f = 0; f < count; f += 3) {
    const i0 = idx ? idx.getX(f) : f;
    const i1 = idx ? idx.getX(f + 1) : f + 1;
    const i2 = idx ? idx.getX(f + 2) : f + 2;
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1).sub(a);
    c.fromBufferAttribute(p, i2).sub(a);
    b.cross(c); // aire × normale
    for (const i of [i0, i1, i2]) {
      const r = rep[i] as number;
      n[r * 3] = (n[r * 3] as number) + b.x;
      n[r * 3 + 1] = (n[r * 3 + 1] as number) + b.y;
      n[r * 3 + 2] = (n[r * 3 + 2] as number) + b.z;
    }
  }
  for (let i = 0; i < p.count; i++) {
    const r = rep[i] as number;
    a.set(n[r * 3] as number, n[r * 3 + 1] as number, n[r * 3 + 2] as number).normalize();
    a.toArray(n, i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

/** Géométrie propre à l'avatar : base + Σ poids × cibles d'identité (positions et normales). */
function bakeIdentity(base: THREE.BufferGeometry, id: IdentityTargets, w: readonly number[]): THREE.BufferGeometry {
  // Index, UV, poids et cibles animées partagés avec le modèle : seules positions et normales sont propres.
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
  g.morphAttributes = base.morphAttributes;
  g.morphTargetsRelative = base.morphTargetsRelative;
  for (const gr of base.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.userData = base.userData;
  const p0 = base.getAttribute('position');
  const n0 = base.getAttribute('normal');
  const p = toFloat(p0);
  const n = n0 ? toFloat(n0) : null;
  w.forEach((k, t) => {
    if (!k) return;
    const dp = id.pos[t] as Float32Array;
    for (let i = 0; i < p.length; i++) p[i] = (p[i] as number) + k * (dp[i] as number);
    const dn = id.nrm[t];
    if (n && dn) for (let i = 0; i < n.length; i++) n[i] = (n[i] as number) + k * (dn[i] as number);
  });
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (n && !id.nrm.some(Boolean)) {
    // Cibles sans normales : normales recalculées, lissées à travers les coutures (sommets
    // dédoublés aux bords d'UV et de matériaux, mêmes positions).
    smoothNormals(g);
    return g;
  }
  if (n) {
    const na = new THREE.BufferAttribute(n, 3);
    for (let i = 0; i < na.count; i++) _v1.fromBufferAttribute(na, i).normalize().toArray(n, i * 3);
    g.setAttribute('normal', na);
  }
  return g;
}

/**
 * Axe du buste (haut de la ceinture de poitrine, vers le cou) dans le repère des sommets du corps.
 * Les sommets sont dans la pose de construction (debout) ; seul le squelette est en pose de
 * conduite : l'origine des os vient donc des matrices inverses de liaison.
 */
function jerseyAxisOf(scene: THREE.Object3D): JerseyAxis | null {
  let body: THREE.SkinnedMesh | undefined;
  scene.traverse((o) => {
    if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh && /^rider_body/.test(o.name)) body = o as THREE.SkinnedMesh;
  });
  if (!body) return null;
  const { bones, boneInverses } = body.skeleton;
  const head = (name: string): THREE.Vector3 | null => {
    const i = bones.findIndex((b) => b.name === name);
    const inv = boneInverses[i];
    return inv ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(body!.bindMatrixInverse).multiply(inv.clone().invert())) : null;
  };
  const origin = head('spine_03');
  const neck = head('neck_01');
  if (!origin || !neck) return null;
  return { origin, dir: neck.sub(origin).normalize() };
}

/** Pièces de la chaussure dont le col suit en partie la jambe (cales, semelle et patins restent rigides). */
const SHOE_UPPER = /^shoe(_lining|_reflect|_dial)?$/;
/** Col de la chaussure : hauteur (m, le long de la jambe, sous le haut de la tige) sur laquelle il suit le mollet, et part prise au bord. */
const COLLAR_DEPTH = 0.04;
const COLLAR_SHIN = 0.55;
/** Haut du talon resserré contre le tendon d'Achille (m, derrière la cheville, au bord de la tige). */
const COLLAR_HUG = 0.011;

/**
 * Col souple des chaussures : la tige n'est liée qu'à l'os du pied, la chaussette au mollet et au pied ;
 * quand la cheville plie (coup de pédale), le haut du talon s'écartait du tendon d'Achille (trou entre la
 * chaussette et la chaussure). Le haut de la tige suit en partie l'os parent du pied (mollet), comme un
 * col souple serré sur la cheville, et le haut du talon est resserré contre la jambe.
 */
function softenShoeCollars(scene: THREE.Object3D): void {
  const shoes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && SHOE_UPPER.test((m.material as THREE.Material).name)) shoes.push(m);
  });
  // Articulations en pose de liaison (repère « bindMatrix · sommet », commun à tous les maillages).
  const joint = (m: THREE.SkinnedMesh, i: number): THREE.Vector3 => new THREE.Vector3().applyMatrix4((m.skeleton.boneInverses[i] as THREE.Matrix4).clone().invert());
  interface Leg {
    ankle: THREE.Vector3;
    axis: THREE.Vector3;
    fwd: THREE.Vector3;
    /** Haut de la tige devant et derrière la cheville (le talon est plus bas que la languette). */
    top: [number, number];
  }
  const legs = new Map<string, Leg>();
  /** Os du pied d'un sommet, et sa jambe (mollet, cheville, axe cheville → genou). */
  const legOf = (m: THREE.SkinnedMesh, k: number): [string, Leg] | null => {
    const fi = m.geometry.getAttribute('skinIndex').getComponent(k, 0);
    const foot = m.skeleton.bones[fi];
    if (!foot) return null;
    let leg = legs.get(foot.name);
    if (!leg) {
      const shin = foot.parent ? m.skeleton.bones.indexOf(foot.parent as THREE.Bone) : -1;
      if (shin < 0) return null;
      const ankle = joint(m, fi);
      leg = { ankle, axis: joint(m, shin).sub(ankle).normalize(), fwd: new THREE.Vector3(), top: [-Infinity, -Infinity] };
      legs.set(foot.name, leg);
    }
    return [foot.name, leg];
  };
  const v = new THREE.Vector3();
  const rel = (m: THREE.SkinnedMesh, k: number, leg: Leg): THREE.Vector3 => v.fromBufferAttribute(m.geometry.getAttribute('position'), k).applyMatrix4(m.bindMatrix).sub(leg.ankle);
  const each = (fn: (m: THREE.SkinnedMesh, k: number, leg: Leg) => void): void => {
    for (const m of shoes) {
      for (let k = 0; k < m.geometry.getAttribute('position').count; k++) {
        const l = legOf(m, k);
        if (l) fn(m, k, l[1]);
      }
    }
  };
  // Avant du pied : vers le centre de la tige, perpendiculairement à la jambe.
  each((m, k, leg) => leg.fwd.add(rel(m, k, leg)));
  for (const leg of legs.values()) leg.fwd.addScaledVector(leg.axis, -leg.fwd.dot(leg.axis)).normalize();
  each((m, k, leg) => {
    const p = rel(m, k, leg);
    const i = p.dot(leg.fwd) >= 0 ? 0 : 1;
    leg.top[i] = Math.max(leg.top[i], p.dot(leg.axis));
  });
  const toMesh = new THREE.Matrix4();
  const perp = new THREE.Vector3();
  for (const m of shoes) {
    const g = m.geometry;
    const n = g.getAttribute('position').count;
    const si = g.getAttribute('skinIndex');
    let pos = g.getAttribute('position');
    if (pos.normalized || (pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(pos.array instanceof Float32Array)) g.setAttribute('position', (pos = plainAttribute(pos)));
    toMesh.copy(m.bindMatrix).invert();
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      idx[k * 4] = si.getComponent(k, 0);
      w[k * 4] = 1;
      const leg = legOf(m, k)?.[1];
      // Mollet : indice dans le squelette de ce maillage (l'ordre des os peut changer d'un maillage à l'autre).
      const shin = m.skeleton.bones.indexOf(m.skeleton.bones[si.getComponent(k, 0)]?.parent as THREE.Bone);
      if (!leg || shin < 0) continue;
      const p = rel(m, k, leg);
      const hTop = leg.top[p.dot(leg.fwd) >= 0 ? 0 : 1];
      const edge = THREE.MathUtils.smoothstep(p.dot(leg.axis), hTop - COLLAR_DEPTH, hTop);
      const t = edge * COLLAR_SHIN;
      if (t <= 0) continue;
      // Talon : resserré vers l'axe de la jambe, en plein derrière, un peu sur les côtés, rien devant.
      perp.copy(p).addScaledVector(leg.axis, -p.dot(leg.axis));
      const back = THREE.MathUtils.smoothstep(-perp.dot(leg.fwd) / Math.max(perp.length(), 1e-6), -0.4, 0.7);
      if (back > 0) {
        const pull = Math.min(COLLAR_HUG * edge * back, perp.length() * 0.5);
        const q = p.addScaledVector(perp.normalize(), -pull).add(leg.ankle).applyMatrix4(toMesh);
        (pos as THREE.BufferAttribute).setXYZ(k, q.x, q.y, q.z);
      }
      idx[k * 4 + 1] = shin;
      w[k * 4] = 1 - t;
      w[k * 4 + 1] = t;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  }
}

function buildTemplates(riders: GLTF[]): Templates {
  for (const r of riders) extractIdentity(r.scene);
  for (const r of riders) {
    r.scene.updateMatrixWorld(true);
    softenShoeCollars(r.scene);
  }
  const scene = (riders[0] as GLTF).scene;
  scene.updateMatrixWorld(true);
  // Repère du torse des maillots (motifs du shader) ; mesures prises sur le niveau 0.
  let jersey: JerseyFrame | null = null;
  for (const r of riders) {
    r.scene.updateMatrixWorld(true);
    const jerseys: THREE.Mesh[] = [];
    const arms: THREE.Mesh[] = [];
    const accents: THREE.Mesh[] = [];
    r.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.isMesh ? (mesh.material as THREE.Material).name : '';
      if (/^(tex_)?jersey$/.test(mat)) jerseys.push(mesh);
      else if (mat === 'skin' || mat === 'tex_arms') arms.push(mesh);
      else if (mat === 'jersey_accent') accents.push(mesh);
    });
    let frame: JerseyFrame | null = null;
    for (const mesh of jerseys) frame ??= addJerseyFrame(mesh);
    jersey ??= frame;
    if (frame) for (const mesh of accents) addFrameAttributes(mesh, frame);
    // Manches longues : « jsl » (tissu sur l'avant-bras) sur la peau des bras de ce niveau de détail.
    const ref = jerseys.find((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
    if (frame && ref) for (const mesh of arms) if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) addSleeveMask(mesh as THREE.SkinnedMesh, ref, frame);
  }
  // Le modèle acheté reprend les noms d'os du squelette MPFB (build_boutique.py).
  const mpfb = !!scene.getObjectByName('pelvis');
  const textured = new Map<string, THREE.MeshStandardMaterial>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && m?.name.startsWith('tex_')) textured.set(m.name, m);
  });
  const names = RIG_BONES[mpfb ? 'mpfb' : 'classic'];
  // Milieu de la paume au repos : entre le poignet et la base du majeur.
  const finger = (s: Side) => scene.getObjectByName(`middle_01_${s === 'L' ? 'l' : 'r'}`);
  const wrist = (s: Side) => scene.getObjectByName(names[`hand_${s}`] ?? '');
  const wristFromPalm = SIDES.every((s) => finger(s) && wrist(s))
    ? (Object.fromEntries(
        SIDES.map((s) => {
          const w = (wrist(s) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
          const palm = (finger(s) as THREE.Object3D).getWorldPosition(new THREE.Vector3()).add(w).multiplyScalar(0.5);
          return [s, w.sub(palm)];
        }),
      ) as Record<Side, THREE.Vector3>)
    : null;
  const roleOf = new Map(Object.entries(names).map(([role, node]) => [node, role as BoneName]));
  const bones = {} as Record<BoneName, BoneRest>;
  let armature: THREE.Object3D | null = null;
  for (const name of BONES) {
    const node = names[name];
    const b = node ? scene.getObjectByName(node) : undefined;
    if (!b) {
      if (OPTIONAL_BONES.has(name) && !node) continue;
      throw new Error(`os manquant dans le modèle du coureur : ${node ?? name}`);
    }
    const parent = roleOf.get(b.parent?.name ?? '') ?? null;
    if (!parent) armature = b.parent;
    const rest: BoneRest = { parent, localQ: b.quaternion.clone(), localP: b.position.clone(), modelQ: new THREE.Quaternion(), modelP: new THREE.Vector3() };
    decompose(b, rest.modelQ, rest.modelP);
    bones[name] = rest;
  }
  const armQ = new THREE.Quaternion();
  const armP = new THREE.Vector3();
  if (armature) decompose(armature, armQ, armP);

  // Pédalier et pédales : mêmes cotes pour toutes les familles (repère du vélo de base).
  const bscene = familyScene(PLAIN_BIKE_FAMILY);
  bscene.updateMatrixWorld(true);
  const crankset = bscene.getObjectByName('crankset');
  const pl = bscene.getObjectByName('pedal_L');
  const pr = bscene.getObjectByName('pedal_R');
  if (!crankset || !pl || !pr) throw new Error(`${PLAIN_BIKE_FAMILY}.glb incomplet (crankset / pedal_L / pedal_R)`);
  const bb = crankset.position.clone();
  const pedalRest = { L: pl.position.clone(), R: pr.position.clone() };
  const crank = Math.hypot(pedalRest.L.y - bb.y, pedalRest.L.z - bb.z);
  const pedalPitch = 2 * Math.atan2(pl.quaternion.x, pl.quaternion.w);
  // Pédales sous les pieds au repos : manivelle 0 (gauche en bas, droite en haut, comme le vélo) ou,
  // pieds à la même hauteur (avatar MPFB depuis le 29/10/2026, jambes liées en miroir), les deux
  // pédales à BIND_PHASE.
  const level = Math.abs(bones.foot_L.modelP.y - bones.foot_R.modelP.y) < 0.05;
  const pedalBind = (s: Side): THREE.Vector3 =>
    level ? new THREE.Vector3(pedalRest[s].x, bb.y - Math.cos(BIND_PHASE) * crank, bb.z - Math.sin(BIND_PHASE) * crank) : pedalRest[s];
  const ankleFlat = {} as Record<Side, THREE.Vector3>;
  const legs = {} as Record<Side, ChainRest>;
  const arms = {} as Record<Side, ChainRest>;
  for (const s of SIDES) {
    ankleFlat[s] = new THREE.Vector3().subVectors(bones[`foot_${s}`].modelP, pedalBind(s)).applyAxisAngle(X_AXIS, -pedalPitch);
    legs[s] = chainRest(bones, `thigh_${s}`, `shin_${s}`, `foot_${s}`);
    arms[s] = chainRest(bones, `upper_arm_${s}`, `forearm_${s}`, `hand_${s}`);
  }
  // Yeux : l'os de la tête va de l'atlas au sommet du crâne (axe Y de l'os) ; dans le script Blender
  // ils sont ≈ 6 cm au-dessus de l'atlas et 9,5 cm devant. On se place juste devant (verres des lunettes).
  const uh = new THREE.Vector3(0, 1, 0).applyQuaternion(bones.head.modelQ).normalize();
  const fh = new THREE.Vector3(0, 0, 1).addScaledVector(uh, -uh.z).normalize();
  const eyeRest = uh.multiplyScalar(0.06).addScaledVector(fh, 0.11);
  return { riders, names, bones, armQ, armP, legs, arms, bb, crank, pedalRest, pedalPitch, ankleFlat, eyeRest, refHands: bikeAnchors(PLAIN_BIKE_FAMILY).hands, wristFromPalm, textured, jerseyAxis: mpfb && !textured.size ? jerseyAxisOf(scene) : null, jersey };
}

/** Géométrie de la casquette par niveau de détail du modèle (null : modèle sans casque pour s'ajuster). */
const capGeometries = new WeakMap<GLTF, THREE.BufferGeometry | null>();
/** Boîte du casque route du modèle (niveau 0), repère du modèle, gabarit des casques chrono du garage. */
const helmetBoxes = new WeakMap<GLTF, THREE.Box3 | null>();
/**
 * Boîte des cheveux plaqués portés sous le casque (coque « slick », niveau 0), gabarit de la casquette :
 * une casquette de cycliste est petite et serrée sur les cheveux. Sans coque (ancien modèle) : casque route.
 */
const capBoxes = new WeakMap<GLTF, THREE.Box3 | null>();

function capGeometryOf(riders: readonly GLTF[], level: number, headName: string | undefined): THREE.BufferGeometry | null {
  const rider = riders[level] as GLTF;
  const known = capGeometries.get(rider);
  if (known !== undefined) return known;
  const first = riders[0] as GLTF;
  if (!helmetBoxes.has(first)) {
    const meshes: THREE.Mesh[] = [];
    first.scene.updateMatrixWorld(true);
    first.scene.traverse((o) => {
      if (o.name.startsWith('rider_helmet') && !o.name.startsWith('rider_helmet_aero')) o.traverse((c) => (c as THREE.Mesh).isMesh && meshes.push(c as THREE.Mesh));
    });
    helmetBoxes.set(first, boxOfMeshes(meshes));
    const hair: THREE.Mesh[] = [];
    first.scene.traverse((o) => {
      if (o.name.startsWith('rider_hairs_slick')) o.traverse((c) => (c as THREE.Mesh).isMesh && hair.push(c as THREE.Mesh));
    });
    capBoxes.set(first, hair.length ? boxOfMeshes(hair) : null);
  }
  const box = capBoxes.get(first) ?? helmetBoxes.get(first);
  let ref: THREE.SkinnedMesh | undefined;
  rider.scene.traverse((o) => {
    if (!ref && (o as THREE.SkinnedMesh).isSkinnedMesh) ref = o as THREE.SkinnedMesh;
  });
  rider.scene.updateMatrixWorld(true);
  const head = ref ? ref.skeleton.bones.findIndex((b) => b.name === headName) : -1;
  let geo: THREE.BufferGeometry | null = null;
  if (box && ref && head >= 0) {
    // Sommet du maillage → monde en pose de repos : bindMatrix, puis matrice d'os (os × inverse de liaison).
    // Le repère de la boîte est celui de la pose de repos ; on remonte jusqu'au maillage.
    const bone = ref.skeleton.bones[head] as THREE.Bone;
    const skin = bone.matrixWorld.clone().multiply(ref.skeleton.boneInverses[head] as THREE.Matrix4).multiply(ref.bindMatrix);
    geo = capGeometry(box, skin.invert(), head);
  }
  capGeometries.set(rider, geo);
  return geo;
}

/** Casques chrono du garage par niveau de détail du modèle et par forme (null : modèle sans casque route pour s'ajuster). */
const aeroHelmetGeometries = new WeakMap<GLTF, Map<HelmetShape, THREE.BufferGeometry | null>>();

function aeroHelmetGeometryOf(riders: readonly GLTF[], level: number, headName: string | undefined, shape: HelmetShape): THREE.BufferGeometry | null {
  const rider = riders[level] as GLTF;
  let byShape = aeroHelmetGeometries.get(rider);
  if (!byShape) aeroHelmetGeometries.set(rider, (byShape = new Map()));
  const known = byShape.get(shape);
  if (known !== undefined) return known;
  // La boîte du casque route est calculée avec la casquette (capGeometryOf).
  capGeometryOf(riders, level, headName);
  const box = helmetBoxes.get(riders[0] as GLTF);
  let ref: THREE.SkinnedMesh | undefined;
  rider.scene.traverse((o) => {
    if (!ref && (o as THREE.SkinnedMesh).isSkinnedMesh) ref = o as THREE.SkinnedMesh;
  });
  const head = ref ? ref.skeleton.bones.findIndex((b) => b.name === headName) : -1;
  let geo: THREE.BufferGeometry | null = null;
  if (box && ref && head >= 0) {
    const bone = ref.skeleton.bones[head] as THREE.Bone;
    const skin = bone.matrixWorld.clone().multiply(ref.skeleton.boneInverses[head] as THREE.Matrix4).multiply(ref.bindMatrix);
    geo = aeroHelmetGeometry(shape, box, skin.invert(), head);
  }
  byShape.set(shape, geo);
  return geo;
}

/** L'objet ou l'un de ses parents porte-t-il un nom commençant par `prefix` ? */
function underNode(o: THREE.Object3D, prefix: string): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith(prefix)) return true;
  return false;
}

/** Tiges des chaussures : matériau à motifs (shoeMaterial.ts), retrouvé pour les changements de look. */
const shoeMaterials = new WeakMap<THREE.Material, ShoeMaterial>();

function makeMaterial(name: string, look: AvatarLook): THREE.MeshStandardNodeMaterial {
  if (name === 'shoe') {
    const sm = new ShoeMaterial(look);
    shoeMaterials.set(sm.material, sm);
    return sm.material;
  }
  const def = MATERIALS[name] ?? ['#808080', 0.6, 0];
  // Écran des lunettes : verre miroir irisé (reflets verts, violets, orangés selon l'angle).
  const m = name === 'lens'
    ? new THREE.MeshPhysicalNodeMaterial({ color: def[0], roughness: def[1], metalness: def[2], iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [280, 520] })
    : new THREE.MeshStandardNodeMaterial({ color: def[0], roughness: def[1], metalness: def[2] });
  m.name = name;
  // Visière teintée : on devine les yeux derrière, le ciel s'y reflète (lunettes : verres opaques).
  if (name === 'visor') {
    m.transparent = true;
    m.opacity = 0.7;
    m.depthWrite = false;
  }
  applyLookColor(m, look);
  return m;
}

/** Réglages de peau d'une tenue : teint, rides selon l'âge, barbe de la couleur des cheveux. */
function skinLook(look: AvatarLook): SkinLook {
  return { tone: look.skin, age: Math.max(0, decodeFace(look.face).age ?? 0), beard: lookSex(look) === 'female' ? 0 : (look.beard ?? 0), beardColor: look.hair, freckles: look.freckles ?? 0 };
}

function applyLookColor(m: THREE.MeshStandardNodeMaterial, look: AvatarLook): void {
  shoeMaterials.get(m)?.setLook(look);
  applyTexturedLook(m, look);
  applyClothLook(m, look);
  const c: Partial<Record<string, string>> = {
    skin: look.skin,
    jersey: look.jersey,
    // Maillot uni ou à bandes de champion : la bande de poitrine et les poignets prennent la couleur du maillot.
    jersey_accent: look.jerseyStyle ? look.jersey : look.jerseyAccent,
    helmet: look.helmet,
    hair: look.hair,
    shoe_dial: shoeDialOf(look),
    sock: look.socks,
    // Lunettes du garage (monture, verres miroir teintés) ; sans couleurs, celles d'origine.
    glasses_frame: look.glassesFrame ?? MATERIALS.glasses_frame?.[0],
    lens: look.glassesLens ?? MATERIALS.lens?.[0],
  };
  const col = c[m.name];
  if (col) m.color.set(col);
}

interface BikeParts {
  crank: THREE.Object3D[];
  wheels: THREE.Object3D[];
  pedals: Record<Side, THREE.Object3D[]>;
}

/** Vélo affiché selon la tenue (route par défaut) : VTT et gravel posent leur kit sur le cadre. */
function bikeTypeOf(look: AvatarLook): BikeType {
  return look.bikeType ?? 'road';
}

/** Vélo monté sur l'avatar : modèle demandé, famille réellement affichée, pièces des deux LOD. */
interface MountedBike {
  key: string;
  build: BikeBuild;
  family: FamilyKey;
  levels: AssembledBike[];
  materials: BikeMaterials;
  anchors: BikeAnchors;
}

export class GltfRiderAvatar implements RiderAvatarLike {
  readonly root = new THREE.Group();
  /** Nom affiché au-dessus du coureur. */
  readonly label: THREE.Sprite | null = null;
  /** Groupe incliné (danseuse / virages) contenant vélo et coureur. */
  private readonly lean = new THREE.Group();
  private readonly lod = new THREE.LOD();
  private readonly t: Templates;
  private readonly bones = {} as Record<BoneName, THREE.Object3D>;
  private readonly mQ = {} as Record<BoneName, THREE.Quaternion>;
  private readonly mP = {} as Record<BoneName, THREE.Vector3>;
  private readonly materials = new Map<string, THREE.MeshStandardNodeMaterial>();
  private readonly morphMeshes: THREE.Mesh[] = [];
  /** Maillages à curseurs de forme et leur géométrie partagée (avant précalcul). */
  private faceKey = '[]';
  /** Morphologie féminine (curseur « sex » < 0, de 0 à 1) : cou relevé, tête plus en arrière (NECK_LIFT). */
  private feminine = 0;
  /** Type de modèle utilisé (mpfb, female, boutique, classic). */
  private readonly kind: AvatarKind;
  /** Expressions en sortie (modèle à formes ARKit seulement). */
  private faceAnim: FaceAnimator | null = null;
  /**
   * Coiffures (avatar MPFB) : sous le casque, 0 courts, 1 queue de cheval, 2 tresse, 3 rasé, 10 deux
   * tresses (bouts dans la nuque), 11 queue tressée (et un bonnet de cheveux pour les autres) ; tête nue,
   * une coque par coiffure (`shells`, voir HAIR_SHELL), les deux tresses collées sur le crâne ; moustache.
   */
  private readonly hair = {
    cap: [] as THREE.Object3D[], ponytail: [] as THREE.Object3D[], braid: [] as THREE.Object3D[], moustache: [] as THREE.Object3D[],
    bun: [] as THREE.Object3D[], plait: [] as THREE.Object3D[], dutch: [] as THREE.Object3D[], dutchTail: [] as THREE.Object3D[],
    shells: new Map<string, THREE.Object3D[]>(),
  };
  private skin: SkinMaterial | null = null;
  private ftpFrac = 0.7;
  private hrFrac: number | undefined;
  private readonly identityMeshes: Array<{ mesh: THREE.Mesh; base: THREE.BufferGeometry }> = [];
  private readonly bike: BikeParts = { crank: [], wheels: [], pedals: { L: [], R: [] } };
  /** Groupes recevant le vélo : niveau 0, niveau 1. */
  /** Vélo de chaque niveau de détail (au-delà du premier : le vélo simplifié). */
  private readonly bikeSlots: THREE.Group[];
  private mounted: MountedBike | null = null;
  /** Kits VTT / gravel (rider/bikeKits.ts) posés sur chaque niveau du vélo monté. */
  private readonly kits = new Map<BikeType, THREE.Group[]>();
  private readonly lodDistances: readonly number[];
  /** Taille / taille du modèle (1 : 1,765 m) ; voir MODEL_HEIGHT_CM. */
  private size = 1;
  private bikeType: BikeType = 'road';
  private look: AvatarLook;
  /** Cible des mains (repère modèle) et direction des coudes, selon le vélo monté. */
  private readonly handTarget: Record<Side, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private readonly elbowPole: Record<Side, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  /** Mains en bas et en haut du cintre (repère modèle) ; null si le vélo n'en a pas (VTT, prolongateurs). */
  private celebrating = false;
  private celebrateBlend = 0;
  /** Bas et haut du cintre (mains), coudes posés sur le haut du cintre (avant-bras à plat). */
  private barTargets: { drop: Record<Side, THREE.Vector3>; top: Record<Side, THREE.Vector3>; elbow: Record<Side, THREE.Vector3> } | null = null;
  /** Bascule du buste qui pose les avant-bras sur le haut du cintre. */
  private forearmTuck = 0;
  /** Prolongateurs de l'atelier : coudes (repose-coudes) et poignées, repère du modèle ; null sans prolongateurs. */
  private clip: { elbow: Record<Side, THREE.Vector3>; grip: Record<Side, THREE.Vector3> } | null = null;
  private clipTuck = 0;
  private clipOn = false;
  private clipBlend = 0;
  /** Vélo de chrono : mains sur les cornes (paumes, repère du modèle ; null sans cornes) et pli des coudes. */
  private horns: { hand: Record<Side, THREE.Vector3>; pole: Record<Side, THREE.Vector3> } | null = null;
  /** Vélo de chrono : coudes dans les repose-coudes et poignées des prolongateurs (avant-bras couchés dessus). */
  private ttLay: { elbow: Record<Side, THREE.Vector3>; grip: Record<Side, THREE.Vector3> } | null = null;
  private hornsOn = false;
  private hornsBlend = 0;
  private turtleOn = false;
  private turtleBlend = 0;
  private hoodsAeroOn = false;
  private forearmsOn = false;
  private hoodsAeroBlend = 0;
  private forearmsBlend = 0;
  private dropsOn = false;
  private relaxOn = false;
  private dropsBlend = 0;
  private aeroBlend = 0;
  private relaxBlend = 0;
  /** Position chrono (vélo à prolongateurs ; 0 = buste de repos) : dos plongeant jusqu'à poser les coudes. */
  private tuck = 0;
  /** Décalage de selle et de bassin (m, repère du coureur) : voir saddleLiftFor. */
  private saddleLift = 0;
  private readonly tmpAnkle = new THREE.Vector3();
  private readonly tmpPedal = new THREE.Vector3();
  /** Casques route et chrono, lunettes (les deux LOD) : casque chrono à visière selon le vélo. */
  private readonly headgear: Record<'road' | 'straps' | 'aero' | 'glasses' | 'cap', THREE.Object3D[]> = { road: [], straps: [], aero: [], glasses: [], cap: [] };
  /** Casques chrono du garage (aeroHelmet.ts), par forme : un maillage par niveau de détail, construit au premier port. */
  private readonly garageHelmets = new Map<HelmetShape, THREE.SkinnedMesh[]>();
  /** Casque et lunettes masqués (éditeur de visage). */
  private bareHead = false;
  private headHidden = false;
  private crankAngle = Math.random() * Math.PI * 2;
  private wheelAngle = 0;
  private poseBlend = 0; // 0 assis → 1 danseuse
  private coastBlend = 0;
  private gesture: RiderGesture = {};
  private time = Math.random() * 10;
  private shadows = true;
  // Temporaires propres à l'instance.
  private readonly knee = new THREE.Vector3();
  private readonly bendN = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly pedal = new THREE.Vector3();

  /**
   * Charge le coureur et le vélo de base (une seule fois), plus les familles de cadres demandées
   * (attendues aussi ; les autres se chargent à la demande). Renvoie false si le coureur ou le
   * vélo de base manque.
   */
  static async load(families: readonly BikeFamily[] = [], baseUrl = `${import.meta.env.BASE_URL}models/`, kinds: readonly AvatarKind[] = AVATAR_KIND === 'mpfb' ? ['mpfb', 'female'] : [AVATAR_KIND]): Promise<boolean> {
    const extra = Promise.all(families.map((f) => loadBikeFamily(f)));
    const ok = await Promise.all(kinds.map((k) => GltfRiderAvatar.loadKind(k, baseUrl)));
    await extra;
    // Le modèle féminin est facultatif : sans lui, les looks féminins gardent l'avatar de base.
    return ok.every((v, i) => v || kinds[i] === 'female');
  }

  private static loadKind(kind: AvatarKind, baseUrl: string): Promise<boolean> {
    let p = loading.get(kind);
    if (!p) {
      p = (async () => {
        try {
          const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
          const skin = kind === 'mpfb' || kind === 'female' ? loadSkinTextures(`${baseUrl}avatar/`) : null;
          const cloth = kind === 'mpfb' || kind === 'female' ? loadClothTextures(`${baseUrl}avatar/`) : null;
          const masks = kind === 'boutique' ? loadTexturedMasks(`${baseUrl}avatar/boutique/`) : null;
          const [riders, plain] = await Promise.all([Promise.all(FILES[kind].map((f) => loader.loadAsync(baseUrl + f))), loadBikeFamily(PLAIN_BIKE_FAMILY), skin, cloth, masks]);
          if (!plain) throw new Error(`vélo de base (${PLAIN_BIKE_FAMILY}) indisponible`);
          templates.set(kind, buildTemplates(riders));
          return true;
        } catch (e) {
          console.warn(`Avatar glTF « ${kind} » indisponible, repli sur l’avatar procédural`, e);
          loading.delete(kind);
          return false;
        }
      })();
      loading.set(kind, p);
    }
    return p;
  }

  /** Facteur des distances de niveau de détail (préréglage graphique : 0,6 bas → 1,5 ultra). */
  static lodScale = 1;
  /**
   * Caméra de la scène : le niveau de détail est choisi avant le calcul des matrices, et les niveaux
   * masqués (plus d'une centaine d'objets chacun) ne sont plus recalculés à chaque image.
   * Sans caméra (outils, garage), le fonctionnement par défaut de three.js.
   */
  static camera: THREE.Camera | null = null;

  /** Modèles chargés ? */
  static get ready(): boolean {
    return templates.has(AVATAR_KIND);
  }

  /** Type d'avatar chargé (load(…, kinds)) ? */
  static has(kind: AvatarKind): boolean {
    return templates.has(kind);
  }

  /**
   * Niveaux de détail : choix du niveau avant le calcul des matrices (avec la caméra de l'image
   * précédente), puis matrices des seuls niveaux affichés. Le niveau 0 porte les os, partagés par
   * tous les niveaux : il est toujours tenu à jour. Un niveau masqué garde `matrixWorldNeedsUpdate`
   * et se recalcule entièrement à son retour.
   */
  private skipHiddenLevels(level0: THREE.Object3D): void {
    const lod = this.lod;
    lod.updateMatrixWorld = function (this: THREE.LOD, force?: boolean) {
      const camera = GltfRiderAvatar.camera;
      if (!camera) return THREE.LOD.prototype.updateMatrixWorld.call(this, force);
      this.autoUpdate = false;
      if (this.matrixAutoUpdate) this.updateMatrix();
      let f = !!force;
      if (this.matrixWorldNeedsUpdate || f) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
        this.matrixWorldNeedsUpdate = false;
        f = true;
      }
      this.update(camera);
      for (const child of this.children) {
        if (child.visible || child === level0) child.updateMatrixWorld(f);
        else child.matrixWorldNeedsUpdate = true;
      }
    };
  }

  constructor(look: AvatarLook, kindWanted: AvatarKind = AVATAR_KIND) {
    // Look féminin (curseur « sex » < 0) : modèle féminin s'il est chargé (le modèle ne change plus ensuite).
    const kind: AvatarKind = kindWanted === 'mpfb' && templates.has('female') && decodeFace(look.face).sex !== undefined && (decodeFace(look.face).sex as number) <= -0.25 ? 'female' : kindWanted;
    this.kind = kind;
    const loaded = templates.get(kind);
    if (!loaded) throw new Error('GltfRiderAvatar.load() doit être appelé (et attendu) avant la création');
    this.look = look;
    const t = (this.t = loaded);
    this.lodDistances = LOD_DISTANCES[kind];
    this.bikeSlots = t.riders.map(() => new THREE.Group());
    this.look = look;
    this.root.add(this.lean);
    this.lean.add(this.lod);

    // Niveau 0 : squelette cloné + vélo complet.
    const rider0 = SkeletonUtils.clone((t.riders[0] as GLTF).scene);
    for (const name of BONES) {
      const node = t.names[name];
      if (!node) continue;
      const b = rider0.getObjectByName(node);
      if (!b) throw new Error(`os manquant : ${node}`);
      this.bones[name] = b;
      this.mQ[name] = new THREE.Quaternion();
      this.mP[name] = new THREE.Vector3();
    }
    // Mains qui tiennent le cintre : doigts fléchis une fois pour toutes (os non animés).
    rider0.traverse((o) => {
      const m = /^(index|middle|ring|pinky)_0[123]_[lr]$/.exec(o.name);
      if (m) o.quaternion.multiply(_q1.setFromAxisAngle(X_AXIS, m[1] === 'index' ? GRIP_CURL_INDEX : GRIP_CURL));
    });
    const level0 = new THREE.Group();
    level0.add(this.bikeSlots[0] as THREE.Group, rider0);

    this.lod.addLevel(level0, 0, 0.1);
    this.addCap(rider0, 0);
    // Niveaux suivants : maillages simplifiés liés aux os du niveau 0 (un seul squelette à animer).
    t.riders.forEach((r, i) => {
      if (i === 0) return;
      const level = new THREE.Group();
      level.add(this.bikeSlots[i] as THREE.Group);
      r.scene.updateMatrixWorld(true);
      r.scene.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        const m = sm.clone();
        const bones = sm.skeleton.bones.map((b) => (rider0.getObjectByName(b.name) as THREE.Bone | undefined) ?? b);
        m.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses), sm.bindMatrix);
        sm.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        level.add(m);
      });
      this.addCap(level, i);
      this.lod.addLevel(level, (this.lodDistances[i] ?? 30 * i) * GltfRiderAvatar.lodScale, 0.1);
    });

    this.skipHiddenLevels(level0);

    // Coureur : matériaux (instances propres à l'avatar), ombres, sphères englobantes des maillages skinnés.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0.05), 1.1);
    this.lod.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === 'rider_cap') return;
      const src = mesh.material as THREE.Material;
      // Visière du casque chrono : verre plus clair que celui des lunettes.
      const key = src.name === 'lens' && underNode(mesh, 'rider_helmet_aero') ? 'visor' : src.name;
      let mat = this.materials.get(key);
      if (!mat) {
        // Avatar MPFB : peau texturée (teint, rides, barbe, rougeur d'effort, sueur) et tissu
        // de la tenue (plis, maille, reflet de lycra).
        const mpfb = t.names.hips === 'pelvis';
        const tex = key === 'skin' && mpfb ? skinTextures() : null;
        const cloth = mpfb && isClothPart(key) ? clothTextures() : null;
        const texSrc = t.textured.get(key);
        if (texSrc) {
          mat = texturedMaterial(texSrc, look, t.jersey);
        } else if (tex) {
          this.skin = new SkinMaterial(tex, skinLook(look), t.jersey, look);
          mat = this.skin.material;
        } else if (cloth) {
          mat = makeClothMaterial(key, cloth, MATERIALS[key]?.[0] ?? '#808080', t.jerseyAxis ?? undefined, t.jersey, look);
          applyLookColor(mat, look);
        } else mat = makeMaterial(key, look);
        this.materials.set(key, mat);
      }
      if (LOW_POLY) flatLook(mat);
      mesh.material = mat;
      mesh.castShadow = bigPart(mesh);
      mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        (mesh as THREE.SkinnedMesh).boundingSphere = bounds.clone();
        if (mesh.morphTargetDictionary) this.morphMeshes.push(mesh);
        if (mesh.geometry.userData.identity) this.identityMeshes.push({ mesh, base: mesh.geometry });
      }
    });
    this.lod.traverse((o) => {
      const n = o.name;
      if (/^rider_hair_ponytail/.test(n)) this.hair.ponytail.push(o);
      else if (/^rider_hair_braid/.test(n)) this.hair.braid.push(o);
      else if (/^rider_hair_bun/.test(n)) this.hair.bun.push(o);
      else if (/^rider_hair_plait/.test(n)) this.hair.plait.push(o);
      else if (/^rider_hair_dutchtail/.test(n)) this.hair.dutchTail.push(o);
      else if (/^rider_hair_dutch/.test(n)) this.hair.dutch.push(o);
      else if (/^rider_moustache/.test(n)) this.hair.moustache.push(o);
      else if (/^rider_hairs_/.test(n)) {
        const key = n.slice('rider_hairs_'.length).replace(/_lod\d$/, '');
        this.hair.shells.set(key, [...(this.hair.shells.get(key) ?? []), o]);
      }
      else if (/^rider_hair(_lod\d)?$/.test(n)) this.hair.cap.push(o);
      if (n.startsWith('rider_helmet_aero')) this.headgear.aero.push(o);
      // Sangles du casque route (pas avec les casques chrono).
      else if (n.startsWith('rider_helmet_straps')) this.headgear.straps.push(o);
      else if (n.startsWith('rider_helmet')) this.headgear.road.push(o);
      else if (n.startsWith('rider_glasses')) this.headgear.glasses.push(o);
    });
    if (this.morphMeshes.some((m) => m.morphTargetDictionary?.jawOpen !== undefined)) this.faceAnim = new FaceAnimator();
    this.size = this.sizeOf(look);
    this.mountBike(bikeOfLook(look), look);
    if (bikeTypeOf(look) !== 'road') this.setBikeType(bikeTypeOf(look));
    this.setBuild(look.build);
    this.applyHair(look);
    this.update(0, 0, 0, 'seated');
  }

  /**
   * Casquette d'un niveau de détail : maillage lié à l'os de la tête, posé à côté du premier maillage
   * articulé du niveau (même repère et même liaison). Masquée tant qu'aucune casquette n'est portée.
   */
  private addCap(level: THREE.Object3D, i: number): void {
    const geo = capGeometryOf(this.t.riders, i, this.t.names.head);
    let ref: THREE.SkinnedMesh | undefined;
    level.traverse((o) => {
      if (!ref && (o as THREE.SkinnedMesh).isSkinnedMesh) ref = o as THREE.SkinnedMesh;
    });
    if (!geo || !ref || !ref.parent) return;
    const cap = new THREE.SkinnedMesh(geo, capMaterials({ style: 'uni', color: '#16171a' }));
    cap.name = 'rider_cap';
    cap.position.copy(ref.position);
    cap.quaternion.copy(ref.quaternion);
    cap.scale.copy(ref.scale);
    cap.bind(ref.skeleton, ref.bindMatrix);
    cap.frustumCulled = false;
    cap.visible = false;
    cap.receiveShadow = true;
    ref.parent.add(cap);
    this.headgear.cap.push(cap);
  }

  /**
   * Cibles des mains et des coudes selon le vélo monté : paume sur la cocotte (route, gravel), sur la
   * poignée du cintre plat (VTT), prolongateurs (chrono : écart des ancres à celles du vélo de base) ;
   * coudes tirés vers les repose-coudes s'il y en a, sinon pli de repos.
   */
  private aimHands(): void {
    const anchors = this.mounted?.anchors;
    if (!anchors) return;
    const palm = this.bikeType === 'mtb' && !anchors.pads ? MTB_PALM : HOOD_PALM;
    const drops = this.bikeType !== 'mtb' && !anchors.pads;
    const pair = (): Record<Side, THREE.Vector3> => ({ L: new THREE.Vector3(), R: new THREE.Vector3() });
    this.barTargets = drops ? { drop: pair(), top: pair(), elbow: pair() } : null;
    for (const s of SIDES) {
      const c = this.t.arms[s];
      const rest = this.t.bones[c.end].modelP;
      const pad = anchors.pads?.[s];
      const grip = this.t.wristFromPalm?.[s];
      if (grip && !anchors.pads) this.handTarget[s].set(s === 'L' ? palm.x : -palm.x, palm.y, palm.z).add(grip);
      else this.handTarget[s].copy(rest).add(anchors.hands[s]).sub(this.t.refHands[s]);
      if (pad) {
        const sh = this.t.bones[c.upper].modelP;
        const dir = _v1.subVectors(this.handTarget[s], sh).normalize();
        const toPad = _v2.subVectors(pad, sh);
        this.elbowPole[s].copy(toPad).addScaledVector(dir, -toPad.dot(dir)).normalize();
      } else {
        // Pli de repos, resserré : de dos (caméra de suivi), les coudes ne partent pas en V vers l'extérieur.
        this.elbowPole[s].copy(c.pole);
        this.elbowPole[s].x *= ELBOW_FLARE;
        this.elbowPole[s].normalize();
      }
      this.handTarget[s].y += this.saddleLift;
      // Bas et haut du cintre : même écart à la cocotte que celui des paumes.
      const sx = s === 'L' ? 1 : -1;
      const bar = this.barTargets;
      bar?.drop[s].set(sx * (DROP_PALM.x - HOOD_PALM.x), DROP_PALM.y - HOOD_PALM.y, DROP_PALM.z - HOOD_PALM.z).add(this.handTarget[s]);
      bar?.top[s].set(sx * (TOP_PALM.x - HOOD_PALM.x), TOP_PALM.y - HOOD_PALM.y, TOP_PALM.z - HOOD_PALM.z).add(this.handTarget[s]);
      bar?.elbow[s].set(sx * (FOREARM_ELBOW.x - HOOD_PALM.x), FOREARM_ELBOW.y - HOOD_PALM.y, FOREARM_ELBOW.z - HOOD_PALM.z).add(this.handTarget[s]);
    }
    // Vélo de chrono : paumes sur les cornes, coudes pliés comme sur un cintre route.
    const horn = anchors.pads && this.mounted ? TT_HORN_PALM[this.mounted.family] : undefined;
    const wrist = this.t.wristFromPalm;
    if (horn && wrist) {
      const hand = (s: Side) => new THREE.Vector3(s === 'L' ? horn.x : -horn.x, horn.y + this.saddleLift, horn.z).add(wrist[s]);
      const pole = (s: Side) => {
        const p = this.t.arms[s].pole.clone();
        p.x *= ELBOW_FLARE;
        return p.normalize();
      };
      this.horns = { hand: { L: hand('L'), R: hand('R') }, pole: { L: pole('L'), R: pole('R') } };
    } else this.horns = null;
    // Prolongateurs du vélo de chrono : coude à un rayon d'avant-bras au-dessus du repose-coude, un peu en arrière.
    const pads = anchors.pads;
    if (pads) {
      const elbow = (s: Side) => pads[s].clone().add(new THREE.Vector3(0, 0.028 + this.saddleLift, -0.02));
      const grip = (s: Side) => anchors.hands[s].clone().setY(anchors.hands[s].y + this.saddleLift);
      this.ttLay = { elbow: { L: elbow('L'), R: elbow('R') }, grip: { L: grip('L'), R: grip('R') } };
    } else this.ttLay = null;
    // Prolongateurs de l'atelier (vélo de route) : relevés avec le poste de pilotage (saddleLift).
    const kind = this.mounted?.build.extras?.aerobars;
    if (kind && this.barTargets) {
      const a = aerobarAnchors(kind, anchors.hands);
      const lift = (v: THREE.Vector3) => v.clone().setY(v.y + this.saddleLift);
      this.clip = { elbow: { L: lift(a.pads.L), R: lift(a.pads.R) }, grip: { L: lift(a.grips.L), R: lift(a.grips.R) } };
      this.clipTuck = this.solveTuck(a.pads);
    } else {
      this.clip = null;
      this.clipTuck = 0;
    }
    // Avant-bras sur le cintre : bascule calculée sans la hauteur de selle (le bassin la reprend).
    const elbows = this.barTargets?.elbow;
    this.forearmTuck = elbows ? this.solveTuck({ L: elbows.L.clone().setY(elbows.L.y - this.saddleLift), R: elbows.R.clone().setY(elbows.R.y - this.saddleLift) }) : 0;
  }

  /**
   * Monte le vélo demandé (ses deux niveaux de détail). Famille pas encore chargée : vélo de
   * base à la même livrée, remplacé dès que la famille arrive.
   */
  private mountBike(build: BikeBuild, look: AvatarLook): void {
    // Modèle, roues, marque des jantes et plaque de cadre changent la géométrie : vélo remonté.
    // Vélo gravel ou VTT : modèle complet (gravel.glb, mtb.glb : cadre, roues, cintre, selle) à la livrée du vélo choisi ; sinon kit sur le vélo route (bikeKits.ts).
    const type = bikeTypeOf(look);
    const ownType = type === 'gravel' || type === 'mtb' ? type : null;
    const own = ownType !== null && bikeFamilyReady(ownType) ? ownType : null;
    const key = JSON.stringify([look.bikeModel ?? 'plain', build.params.wheels, build.params.rimBrand ?? '', build.extras?.number ?? null, look.bottles ?? null, own, build.extras?.aerobars ?? null]);
    const family: FamilyKey = own ?? (availableFamily(build.family) ?? PLAIN_BIKE_FAMILY);
    const cur = this.mounted;
    if (cur && cur.key === key && cur.family === family) {
      cur.build = build;
      cur.materials.update(build, look);
      return;
    }
    if (cur) {
      for (const lv of cur.levels) lv.group.removeFromParent();
      cur.materials.dispose();
    }
    const materials = new BikeMaterials(build, look, family);
    const levels = this.bikeSlots.map((_, i) => assembleBike(build, family, i === 0 ? 0 : 1, look.bottles));
    const parts: BikeParts = { crank: [], wheels: [], pedals: { L: [], R: [] } };
    levels.forEach((lv, i) => {
      lv.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Plaque de cadre : matériau texturé propre.
        if (mesh.userData.matKey === 'number') {
          mesh.castShadow = this.shadows && bigPart(mesh);
          return;
        }
        mesh.material = materials.get((mesh.userData.matKey as string | undefined) ?? (mesh.material as THREE.Material).name);
        mesh.castShadow = this.shadows && bigPart(mesh);
        mesh.receiveShadow = true;
      });
      (this.bikeSlots[i] as THREE.Group).add(lv.group);
      if (lv.crank) parts.crank.push(lv.crank);
      parts.wheels.push(...lv.wheels);
      for (const s of SIDES) {
        const p = lv.pedals[s];
        if (p) parts.pedals[s].push(p);
      }
    });
    Object.assign(this.bike, parts);
    const anchors = bikeAnchors(family);
    this.mounted = { key, build, family, levels, materials, anchors };
    this.aimHands();
    this.tuck = anchors.pads ? this.solveTuck(anchors.pads) : 0;
    // Casque chrono (modèles qui le demandent) : sa visière remplace les lunettes. Sans casque chrono
    // dans le modèle du coureur (ancien cyclist.glb), casque route.
    this.applyHeadgear(build);
    if (this.bikeType !== 'road') this.setBikeType(this.bikeType);
    this.applySize();
    if (ownType && !own) {
      void loadBikeFamily(ownType).then((ok) => {
        if (ok && this.mounted?.key === key) this.mountBike(this.mounted.build, this.look);
      });
    }
    if (family !== 'gravel' && family !== 'mtb' && family !== build.family) {
      void loadBikeFamily(build.family).then((ok) => {
        if (ok && this.mounted?.key === key) this.mountBike(this.mounted.build, this.look);
      });
    }
  }

  /**
   * Bascule du buste qui met les épaules à une longueur de bras (os supérieur) au-dessus des
   * repose-coudes : avec le pli des coudes tiré vers eux, les avant-bras s'y posent.
   */
  private solveTuck(pads: Record<Side, THREE.Vector3>): number {
    const b = this.t.bones;
    let best = 1;
    let bestErr = Infinity;
    // Bassin, colonne et thorax basculent autour de leurs origines (axes X parallèles), dans cet ordre.
    const pivots: Array<[BoneName, number]> = [['hips', TUCK_HIPS], ['spine', TUCK_SPINE], ['chest', TUCK_CHEST]];
    const pts = pivots.map(() => new THREE.Vector3());
    for (let a = 0; a <= 2.5; a += 0.01) {
      let err = 0;
      for (const s of SIDES) {
        const c = this.t.arms[s];
        pivots.forEach(([name], i) => pts[i]?.copy(b[name].modelP));
        const sh = _v2.copy(b[c.upper].modelP);
        pivots.forEach(([, k], i) => {
          const o = pts[i] as THREE.Vector3;
          for (let j = i + 1; j < pts.length; j++) (pts[j] as THREE.Vector3).sub(o).applyAxisAngle(X_AXIS, k * a).add(o);
          sh.sub(o).applyAxisAngle(X_AXIS, k * a).add(o);
        });
        const pad = pads[s];
        // Bras supérieur posé : épaule à l1 du coude et au-dessus de lui.
        err += Math.abs(sh.distanceTo(pad) - c.l1) + Math.max(0, pad.y + 0.15 - sh.y);
      }
      if (err < bestErr) {
        bestErr = err;
        best = a;
      }
    }
    return best;
  }

  /** Repère « modèle » (= groupe incliné) d'un os à partir de son parent et de sa rotation locale. */
  private fk(name: BoneName): void {
    const r = this.t.bones[name];
    const b = this.bones[name];
    const pq = r.parent ? this.mQ[r.parent] : this.t.armQ;
    const pp = r.parent ? this.mP[r.parent] : this.t.armP;
    this.mQ[name].multiplyQuaternions(pq, b.quaternion);
    this.mP[name].copy(b.position).applyQuaternion(pq).add(pp);
  }

  /** Impose l'orientation d'un os dans le repère modèle (position : celle de repos, via le parent). */
  private setModelQ(name: BoneName, q: THREE.Quaternion): void {
    const r = this.t.bones[name];
    const b = this.bones[name];
    const pq = r.parent ? this.mQ[r.parent] : this.t.armQ;
    b.quaternion.copy(pq).invert().multiply(q);
    this.fk(name);
  }

  /** Pilote une chaîne à deux os vers une cible (repère modèle) ; pli vers `pole` (sinon celui de repos). */
  private solveChain(c: ChainRest, target: THREE.Vector3, pole = c.pole): void {
    const root = this.mP[c.upper];
    solveTwoBone(root, target, c.l1, c.l2, pole, this.knee, this.bendN);
    // Os supérieur : rotation qui amène le repère de repos (direction, normale du pli) sur le nouveau.
    frameQuat(_v3.subVectors(this.knee, root), this.bendN, _q1).multiply(c.invUpper);
    this.setModelQ(c.upper, _q2.multiplyQuaternions(_q1, this.t.bones[c.upper].modelQ));
    frameQuat(_v3.subVectors(target, this.knee), this.bendN, _q1).multiply(c.invLower);
    this.setModelQ(c.lower, _q2.multiplyQuaternions(_q1, this.t.bones[c.lower].modelQ));
  }

  /**
   * @param dt pas de temps (s)
   * @param cadence tr/min
   * @param speed m/s (rotation des roues)
   * @param pose position du coureur
   * @param bank inclinaison dans les virages (rad)
   */
  setCelebrating(on: boolean): void {
    this.celebrating = on;
  }

  update(dt: number, cadence: number, speed: number, pose: RiderPose, bank = 0): void {
    // Visage : seulement au premier niveau de détail (au-delà, invisible).
    if (this.faceAnim && dt > 0 && this.lod.getCurrentLevel() === 0) {
      const inp = { ftpFrac: this.ftpFrac, cadence, speed, standing: pose === 'standing' };
      this.setExpressions(this.faceAnim.update(dt, this.hrFrac === undefined ? inp : { ...inp, hrFrac: this.hrFrac }));
      this.skin?.update(dt, this.faceAnim.effortLevel);
    }
    const t = this.t;
    this.time += dt;
    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.wheelAngle = (this.wheelAngle + (speed / WHEEL_R) * dt) % (Math.PI * 2);
    const k = 1 - Math.exp(-dt * 4);
    this.poseBlend += ((pose === 'standing' ? 1 : 0) - this.poseBlend) * k;
    this.coastBlend += ((pose === 'coasting' || cadence < 5 ? 1 : 0) - this.coastBlend) * k;
    if (this.coastBlend > 0.5 && cadence < 5) {
      // Roue libre : manivelles ramenées à l'horizontale.
      const target = Math.round((this.crankAngle - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crankAngle += (target - this.crankAngle) * k * 0.5;
    }
    this.crankAngle %= Math.PI * 2;
    if (this.gesture.crank !== undefined) this.crankAngle = this.gesture.crank;
    const a = this.crankAngle;
    const stand = this.poseBlend;
    this.celebrateBlend += ((this.celebrating ? 1 : 0) - this.celebrateBlend) * (1 - Math.exp(-dt * 6));
    const coast = this.coastBlend * (1 - stand);
    // Bas du cintre à vitesse de course, aéro en roue libre rapide (descente), très détendue à
    // petite allure (avec hystérésis).
    const coasting = pose === 'coasting' || cadence < 5;
    const bars = this.barTargets !== null && pose !== 'standing';
    const hands = this.gesture.hands;
    this.dropsOn = bars && (hands ? hands === 'drops' : speed > DROPS_IN || (this.dropsOn && speed > DROPS_OUT));
    this.relaxOn = bars && (hands ? hands === 'tops' : (speed < RELAX_IN || (this.relaxOn && speed < RELAX_OUT)) && (coasting || this.ftpFrac < RELAX_EFFORT));
    const aeroOn = bars && coasting ? THREE.MathUtils.smoothstep(speed, AERO_FROM, AERO_FULL) : 0;
    // Positions aéro en pédalant (pas avec un geste imposé) : avant-bras sur le cintre très vite, sinon
    // avant-bras à plat sur les cocottes très fort.
    const pedalling = bars && !coasting && !hands;
    // Avec prolongateurs : couché dessus très vite ou très fort, à la place des deux positions ci-dessous.
    const hard = (on: boolean) => this.ftpFrac > HOODS_AERO_EFFORT || (on && this.ftpFrac > HOODS_AERO_EFFORT_OUT);
    this.clipOn = pedalling && this.clip !== null && (speed > CLIP_IN || (this.clipOn && speed > CLIP_OUT) || (speed > HOODS_AERO_SPEED && hard(this.clipOn)));
    this.forearmsOn = pedalling && !this.clip && (speed > FOREARMS_IN || (this.forearmsOn && speed > FOREARMS_OUT));
    this.hoodsAeroOn = pedalling && !this.clip && !this.forearmsOn && speed > HOODS_AERO_SPEED && hard(this.hoodsAeroOn);
    // Vélo de chrono : cornes à petite allure et en danseuse, tortue très vite ou très fort.
    const tt = this.horns !== null && !hands;
    this.hornsOn = tt && (pose === 'standing' || speed < HORNS_IN || (this.hornsOn && speed < HORNS_OUT));
    this.turtleOn = tt && !this.hornsOn && !coasting && (speed > TURTLE_IN || (this.turtleOn && speed > TURTLE_OUT) || (speed > HOODS_AERO_SPEED && hard(this.turtleOn)));
    const k2 = 1 - Math.exp(-dt * 2.5);
    this.dropsBlend += ((this.dropsOn ? 1 : 0) - this.dropsBlend) * k2;
    this.aeroBlend += (aeroOn - this.aeroBlend) * k2;
    this.relaxBlend += ((this.relaxOn ? 1 : 0) - this.relaxBlend) * k2;
    this.hoodsAeroBlend += ((this.hoodsAeroOn ? 1 : 0) - this.hoodsAeroBlend) * k2;
    this.forearmsBlend += ((this.forearmsOn ? 1 : 0) - this.forearmsBlend) * k2;
    this.clipBlend += ((this.clipOn ? 1 : 0) - this.clipBlend) * k2;
    this.hornsBlend += ((this.hornsOn ? 1 : 0) - this.hornsBlend) * k2;
    this.turtleBlend += ((this.turtleOn ? 1 : 0) - this.turtleBlend) * k2;
    const horns = this.hornsBlend;
    const turtle = this.turtleBlend * (1 - stand) * (1 - horns);
    const aero = this.aeroBlend * (1 - stand);
    const clip = this.clipBlend * (1 - stand) * (1 - aero);
    const forearms = this.forearmsBlend * (1 - stand) * (1 - aero);
    const hoodsAero = this.hoodsAeroBlend * (1 - stand) * (1 - aero) * (1 - forearms);
    // Aéro : mains en bas du cintre aussi (dos à plat, épaules au-dessus du crochet : avant-bras à l'horizontale).
    const keep = (1 - forearms) * (1 - hoodsAero) * (1 - clip);
    const dropHands = Math.max(this.dropsBlend * (1 - stand) * keep, aero);
    const drops = this.dropsBlend * (1 - stand) * (1 - aero) * keep;
    const relax = this.relaxBlend * (1 - stand) * (1 - aero) * keep;

    // Vélo : en danseuse il balance à l'opposé de la jambe qui appuie ; le corps compense en partie. Assis, un
    // léger balancement aussi (≈ 1°, un peu plus quand l'effort monte), nul en roue libre.
    const seatedRock = 0.014 + 0.01 * THREE.MathUtils.clamp(this.ftpFrac - 0.6, 0, 0.6);
    const rock = -Math.sin(a) * (0.11 * stand + seatedRock * (1 - stand) * (1 - this.coastBlend));
    this.lean.rotation.z = bank + rock;
    const counter = -rock * 0.65;

    // Pédalier, roues, pédales (les pédales automatiques suivent l'inclinaison du pied).
    for (const c of this.bike.crank) c.rotation.x = a;
    for (const w of this.bike.wheels) w.rotation.x = this.wheelAngle;

    // --- Bassin
    const hipsR = t.bones.hips;
    const roll = 0.02 * Math.sin(a) * (1 - stand) * (1 - coast);
    const race = DROPS_BEND * drops + AERO_BEND * aero + RELAX_BEND * relax + HOODS_AERO_BEND * hoodsAero + this.forearmTuck * forearms + this.clipTuck * clip + TURTLE_BEND * turtle;
    const tuck = this.tuck * (1 - 0.6 * stand) * (1 - HORNS_UNTUCK * horns) + race;
    const tilt = -0.09 * stand - 0.05 * coast + TUCK_HIPS * tuck;
    _q1.setFromAxisAngle(Z_AXIS, counter + roll);
    _q2.setFromAxisAngle(X_AXIS, tilt);
    _q3.multiplyQuaternions(_q1, _q2).multiply(hipsR.modelQ);
    _v4.copy(hipsR.modelP);
    _v4.y += this.saddleLift;
    _v4.y += 0.02 * stand + 0.004 * Math.sin(2 * a) * (1 - stand) * (1 - coast) - 0.01 * Math.abs(Math.cos(a)) * stand;
    _v4.z += 0.13 * stand;
    if (race !== 0) {
      // Bascule de course autour des ischions posés sur la selle (pas de l'os du bassin) : les fesses restent assises.
      const r = TUCK_HIPS * race;
      const { y, z } = SEAT_FROM_HIPS;
      _v4.y += -y * Math.cos(r) + z * Math.sin(r) + y;
      _v4.z += -y * Math.sin(r) - z * Math.cos(r) + z;
    }
    _v4.applyAxisAngle(Z_AXIS, counter);
    const hips = this.bones.hips;
    const invArm = _q1.copy(t.armQ).invert();
    hips.quaternion.copy(invArm).multiply(_q3);
    hips.position.copy(_v4).sub(t.armP).applyQuaternion(invArm);
    this.fk('hips');

    // --- Colonne : le thorax compense le roulis du bassin (épaules stables) ; dos plongeant en
    // position chrono (moins en danseuse).
    this.bones.spine.quaternion.copy(t.bones.spine.localQ);
    this.fk('spine');
    if (tuck !== 0) this.setModelQ('spine', _q3.setFromAxisAngle(X_AXIS, TUCK_SPINE * tuck).multiply(this.mQ.spine));
    if (t.names.spine2) {
      this.bones.spine2.quaternion.copy(t.bones.spine2.localQ);
      this.fk('spine2');
    }
    _q1.multiplyQuaternions(this.mQ[t.bones.chest.parent ?? 'spine'], t.bones.chest.localQ);
    _q2.setFromAxisAngle(Z_AXIS, -roll * 0.9);
    if (tuck !== 0) _q2.multiply(_q3.setFromAxisAngle(X_AXIS, TUCK_CHEST * tuck));
    // Regard de côté : les épaules suivent un peu la tête.
    const yaw = this.gesture.yaw ?? 0;
    if (yaw !== 0) _q2.premultiply(_q3.setFromAxisAngle(Y_AXIS, 0.2 * yaw));
    this.setModelQ('chest', _q3.multiplyQuaternions(_q2, _q1));

    // --- Tête : regarde devant, compense une partie de l'inclinaison ; le cou en prend la moitié.
    this.bones.neck.quaternion.copy(t.bones.neck.localQ);
    this.fk('neck');
    const look = 0.06 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.13) + yaw;
    _q1.setFromAxisAngle(Z_AXIS, -(0.7 * bank + rock + counter));
    // Tête : relevée vers la route en chrono ; en position de course, basse dans l'alignement du dos ;
    // buste relevé : regard inchangé.
    if (tuck !== 0) _q1.multiply(_q3.setFromAxisAngle(X_AXIS, -TUCK_HEAD * (tuck - race) + RACE_HEAD * Math.max(race, 0) + TURTLE_HEAD * turtle));
    _q2.setFromAxisAngle(Y_AXIS, look);
    if (this.gesture.pitch) _q2.multiply(_q3.setFromAxisAngle(X_AXIS, this.gesture.pitch));
    const headTarget = _q3.multiplyQuaternions(_q1, _q2).multiply(t.bones.head.modelQ);
    _q1.multiplyQuaternions(this.mQ.neck, t.bones.head.localQ).invert(); // tête si cou au repos
    _q2.multiplyQuaternions(headTarget, _q1); // écart restant
    _q1.slerpQuaternions(_id, _q2, 0.5);
    _q2.multiplyQuaternions(_q1, this.mQ.neck);
    // Buste moins profond des profils féminins : la tête déborde plus devant le torse ; cou relevé, tête au regard inchangé (absolue).
    // (_q4, pas _q3 : _q3 porte headTarget.)
    if (this.feminine > 0) _q2.premultiply(_q4.setFromAxisAngle(X_AXIS, ((globalThis as unknown as { __lift?: number }).__lift ?? NECK_LIFT) * this.feminine));
    this.setModelQ('neck', _q2);
    this.setModelQ('head', headTarget);
    // Cou raccourci des profils féminins : l'os du cou est réduit, la tête (son enfant) garde sa taille.
    const neckK = 1 - NECK_SHORTEN * this.feminine;
    this.bones.neck.scale.setScalar(this.headHidden ? 1e-3 : neckK);
    this.bones.head.scale.setScalar(1 / neckK);

    // --- Bras : mains fixes sur le cintre (ou les prolongateurs).
    for (const s of SIDES) {
      const c = t.arms[s];
      const clav: BoneName = `clavicle_${s}`;
      if (t.names[clav]) {
        this.bones[clav].quaternion.copy(t.bones[clav].localQ);
        this.fk(clav);
        // Tortue : épaules haussées autour de la tête (rotation autour de l'axe avant).
        if (turtle > 0) this.setModelQ(clav, _q1.setFromAxisAngle(Z_AXIS, (s === 'L' ? 1 : -1) * TURTLE_SHRUG * turtle).multiply(this.mQ[clav]));
      }
      this.bones[c.upper].quaternion.copy(t.bones[c.upper].localQ);
      this.fk(c.upper);
      this.target.copy(this.handTarget[s]);
      const bar = this.barTargets;
      if (bar && dropHands > 0) this.target.lerp(bar.drop[s], dropHands);
      if (bar && relax > 0) this.target.lerp(bar.top[s], relax);
      let pole = this.elbowPole[s];
      if (aero > 0) {
        pole = _vPole.copy(pole);
        pole.x *= 1 - AERO_ELBOW_IN * aero;
        pole.normalize();
      }
      const sx = s === 'L' ? 1 : -1;
      if (hoodsAero > 0) {
        // Avant-bras à plat : coudes tirés vers l'arrière (un peu en dehors), mains sur les cocottes.
        pole = _vPole.copy(pole).lerp(_v1.set(0.3 * sx, -0.1, -1).normalize(), hoodsAero).normalize();
      }
      // Avant-bras posés (haut du cintre, ou repose-coudes des prolongateurs) : coude sur son appui, poignet
      // un avant-bras plus loin (mains rapprochées devant la potence, ou vers les poignées) ; le coude est
      // tiré vers son point d'appui.
      const lay = (elbow: THREE.Vector3, aim: THREE.Vector3, w: number): void => {
        _v1.copy(aim).multiplyScalar(c.l2).add(elbow);
        this.target.lerp(_v1, w);
        const sh = this.mP[c.upper];
        const dir = _v2.subVectors(this.target, sh).normalize();
        const toElbow = _v3.subVectors(elbow, sh);
        toElbow.addScaledVector(dir, -toElbow.dot(dir)).normalize();
        pole = _vPole.copy(pole).lerp(toElbow, w).normalize();
      };
      if (bar && forearms > 0) lay(bar.elbow[s], _v4.set(-0.22 * sx, -0.06, 1).normalize(), forearms);
      if (this.clip && clip > 0) lay(this.clip.elbow[s], _v4.subVectors(this.clip.grip[s], this.clip.elbow[s]).normalize(), clip);
      // Vélo de chrono : avant-bras couchés sur les prolongateurs (sauf mains sur les cornes).
      if (this.ttLay && horns < 1 && this.celebrateBlend < 0.99) lay(this.ttLay.elbow[s], _v4.subVectors(this.ttLay.grip[s], this.ttLay.elbow[s]).normalize(), 1 - horns);
      if (this.horns && horns > 0) {
        this.target.lerp(this.horns.hand[s], horns);
        pole = _vPole.copy(pole).lerp(this.horns.pole[s], horns).normalize();
      }
      if (turtle > 0) this.target.y += TURTLE_HANDS_UP * turtle;
      if (this.celebrateBlend > 0.01) {
        // Victoire : bras tendus en V au-dessus de la tête.
        _v1.set(sx * 0.5, 0.85, 0.1).normalize().multiplyScalar((c.l1 + c.l2) * 0.97).add(t.bones[c.upper].modelP);
        this.target.lerp(_v1, this.celebrateBlend);
        pole = _v2.set(sx, 0, 0.3).normalize().lerp(pole, 1 - this.celebrateBlend);
      }
      this.solveChain(c, this.target, pole);
      this.setModelQ(c.end, t.bones[c.end].modelQ);
    }

    // --- Jambes : cheville calée sur la pédale.
    for (const s of SIDES) {
      const c = t.legs[s];
      const as = a + (s === 'L' ? 0 : Math.PI);
      const rest = t.pedalRest[s];
      const crank = t.crank / this.size;
      this.pedal.set(rest.x, t.bb.y - Math.cos(as) * crank, t.bb.z - Math.sin(as) * crank);
      // Inclinaison du pied : talon plus haut en remontée (arrière), plus à plat en poussée (avant).
      let pitch = t.pedalPitch + 0.15 * Math.sin(as);
      pitch += (0.18 - pitch) * coast - 0.08 * stand;
      for (const p of this.bike.pedals[s]) {
        p.position.copy(this.pedal);
        p.quaternion.setFromAxisAngle(X_AXIS, pitch);
      }
      this.target.copy(t.ankleFlat[s]).applyAxisAngle(X_AXIS, pitch).add(this.pedal);
      this.bones[c.upper].quaternion.copy(t.bones[c.upper].localQ);
      this.fk(c.upper);
      this.solveChain(c, this.target);
      _q1.setFromAxisAngle(X_AXIS, pitch - t.pedalPitch);
      this.setModelQ(c.end, _q2.multiplyQuaternions(_q1, t.bones[c.end].modelQ));
    }
  }

  /**
   * Curseurs de forme (avatar MPFB, docs/AVATARS.md § 4) : valeur −1 → 1 par curseur, appliquée
   * aux cibles « nom+ » / « nom− », une fois, sur le processeur (géométrie propre à l'avatar ;
   * tout à 0 : géométrie partagée du modèle).
   */
  setFace(values: Readonly<Record<string, number>>): void {
    const key = JSON.stringify(Object.entries(values).filter(([, v]) => v).sort());
    if (key === this.faceKey) return;
    this.faceKey = key;
    this.feminine = this.kind === 'female' ? 1 : this.kind === 'mpfb' ? THREE.MathUtils.clamp(-(values.sex ?? 0), 0, 1) : 0;
    for (const it of this.identityMeshes) {
      const id = it.base.userData.identity as IdentityTargets;
      const w = id.names.map((n) => {
        const x = THREE.MathUtils.clamp(values[n.slice(0, -1)] ?? 0, -1, 1);
        return n.endsWith('+') ? Math.max(x, 0) : Math.max(-x, 0);
      });
      const old = it.mesh.geometry;
      it.mesh.geometry = w.some(Boolean) ? bakeIdentity(it.base, id, w) : it.base;
      if (old !== it.base && old !== it.mesh.geometry) old.dispose();
    }
  }

  /**
   * Expressions (formes ARKit de l'avatar MPFB, docs/AVATARS.md § 5) : poids 0 → 1 par nom ;
   * les noms absents du modèle sont ignorés.
   */
  setExpressions(weights: Readonly<Record<string, number>>): void {
    for (const m of this.morphMeshes) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      if (!dict || !inf) continue;
      for (const [k, v] of Object.entries(weights)) {
        const i = dict[k];
        if (i !== undefined) inf[i] = THREE.MathUtils.clamp(v, 0, 1);
      }
    }
  }

  /**
   * Morphologie de la tenue : cible « build » du coureur actuel ; avatar MPFB : curseurs de forme
   * (`look.face`), la carrure `build` (0 = fin, 1 = costaud) servant de poids tant que la forme ne le
   * fixe pas. Pas la musculature : à poids égal, plus de muscle donne une silhouette plus sèche (le
   * curseur paraissait inversé).
   */
  private setBuild(build: number): void {
    if (this.identityMeshes.length) {
      const shape: Record<string, number> = { weight: THREE.MathUtils.clamp((build - 0.4) / 0.6, -1, 1) };
      this.setFace({ ...shape, ...decodeFace(this.look.face) });
    }
    for (const m of this.morphMeshes) {
      const i = m.morphTargetDictionary?.build;
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = THREE.MathUtils.clamp(build, 0, 1);
    }
  }

  /**
   * Yeux du coureur (repère monde) pour la vue subjective : suivent la tête animée (bassin qui
   * roule, danseuse, virages), plus un léger hochement au rythme du pédalage. Si `hands` est fourni,
   * y écrit le milieu des mains (sur les cocottes), pour cadrer le cintre. À appeler après update()
   * et le placement de root.
   */
  eyeWorld(out: THREE.Vector3, hands?: THREE.Vector3): THREE.Vector3 {
    const t = this.t;
    _q1.copy(t.bones.head.modelQ).invert().premultiply(this.mQ.head);
    out.copy(t.eyeRest).applyQuaternion(_q1).add(this.mP.head);
    const pedal = 1 - this.coastBlend;
    const a = this.crankAngle;
    out.y += 0.006 * Math.sin(2 * a) * pedal * (1 - this.poseBlend * 0.5);
    out.x += 0.008 * Math.sin(a) * pedal * (1 + this.poseBlend);
    this.lod.updateWorldMatrix(true, false);
    if (hands) this.lod.localToWorld(hands.addVectors(this.mP.hand_L, this.mP.hand_R).multiplyScalar(0.5));
    return this.lod.localToWorld(out);
  }

  /**
   * Masque la tête (vue subjective, caméra embarquée) : l'os du cou est réduit à un point, la tête
   * (son enfant) avec lui ; sinon le moignon du cou resterait dans le champ, sous la caméra.
   */
  setHeadVisible(on: boolean): void {
    this.headHidden = !on;
    this.bones.neck.scale.setScalar(on ? 1 : 1e-3);
  }

  /** Active ou coupe les ombres portées de tout l'avatar (coureurs lointains : coupées). */
  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = on && bigPart(o as THREE.Mesh);
    });
  }

  /**
   * Casque route ou chrono selon le vélo, lunettes avec le casque route ; rien tête nue. Une casquette
   * (look.cap) remplace le casque, chrono compris, et se porte avec les lunettes. « Sans casque »
   * (look.noHelmet) et « Sans lunettes » (look.noGlasses) retirent l'un ou l'autre en selle.
   */
  private applyHeadgear(build: BikeBuild): void {
    const cap = !!this.look.cap && this.headgear.cap.length > 0;
    // Casque chrono choisi au garage : il passe avant le casque d'office des vélos de chrono.
    const garage = !cap && this.look.helmetShape ? this.garageHelmet(this.look.helmetShape) : null;
    const aero = !garage && !!build.params.aeroHelmet && this.headgear.aero.length > 0 && !cap;
    const helmet = !this.bareHead && !this.look.noHelmet;
    const glasses = !this.bareHead && !this.look.noGlasses;
    for (const [shape, meshes] of this.garageHelmets) for (const o of meshes) o.visible = helmet && garage !== null && shape === this.look.helmetShape;
    for (const o of this.headgear.aero) o.visible = aero && helmet;
    for (const o of this.headgear.road) o.visible = !aero && !cap && !garage && helmet;
    // Pas de sangles sous les casques chrono du garage (le casque chrono d'office a les siennes, dans le modèle).
    for (const o of this.headgear.straps) o.visible = !aero && !cap && !garage && helmet;
    // Les casques chrono ont leur visière : lunettes seulement sans eux.
    for (const o of this.headgear.glasses) o.visible = (!(aero || garage) || !helmet) && glasses;
    const mats = this.look.cap ? capMaterials(this.look.cap) : null;
    for (const o of this.headgear.cap) {
      o.visible = cap && helmet;
      if (mats) (o as THREE.Mesh).material = mats;
    }
  }

  /**
   * Casque chrono du garage (une forme) : maillages liés à l'os de la tête, à côté du premier maillage
   * articulé de chaque niveau (comme la casquette), construits au premier port ; null si le modèle n'a
   * pas de casque route pour s'ajuster.
   */
  private garageHelmet(shape: HelmetShape): THREE.SkinnedMesh[] | null {
    const known = this.garageHelmets.get(shape);
    if (known) return known.length ? known : null;
    const meshes: THREE.SkinnedMesh[] = [];
    this.lod.levels.forEach(({ object: level }, i) => {
      const geo = aeroHelmetGeometryOf(this.t.riders, i, this.t.names.head, shape);
      let ref: THREE.SkinnedMesh | undefined;
      level.traverse((o) => {
        if (!ref && (o as THREE.SkinnedMesh).isSkinnedMesh && o.name !== 'rider_cap') ref = o as THREE.SkinnedMesh;
      });
      if (!geo || !ref || !ref.parent) return;
      const mats = AERO_HELMET_GROUPS.map((key) => {
        let mat = this.materials.get(key);
        if (!mat) {
          mat = makeMaterial(key, this.look);
          if (LOW_POLY) flatLook(mat);
          this.materials.set(key, mat);
        }
        return mat;
      });
      const m = new THREE.SkinnedMesh(geo, mats);
      m.name = `rider_helmet_garage_${shape}`;
      m.position.copy(ref.position);
      m.quaternion.copy(ref.quaternion);
      m.scale.copy(ref.scale);
      m.bind(ref.skeleton, ref.bindMatrix);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.visible = false;
      ref.parent.add(m);
      meshes.push(m);
    });
    this.garageHelmets.set(shape, meshes);
    return meshes.length ? meshes : null;
  }

  /** Tête nue (aperçu de l'éditeur de visage) ou casquée. */
  setBareHead(on: boolean): void {
    this.bareHead = on;
    if (this.mounted) {
      this.applyHeadgear(this.mounted.build);
      this.applyHair(this.look);
    }
  }

  private applyHair(look: AvatarLook): void {
    if (!this.hair.ponytail.length) return; // modèle sans coiffures (cyclist.glb)
    const style = ((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT;
    const bare = this.bareHead || !!look.noHelmet;
    // Sous le casque : cheveux plaqués (coque « slick » : tempes, autour des oreilles, nuque).
    const shell = style === 3 ? undefined : bare ? HAIR_SHELL[style] : 'slick';
    const shown = shell && this.hair.shells.has(shell) ? shell : undefined;
    for (const [k, objs] of this.hair.shells) for (const o of objs) o.visible = k === shown;
    for (const o of this.hair.cap) o.visible = style !== 3 && !shown;
    // Sous le casque, les coiffures longues sortent en queue de cheval ou en tresse.
    for (const o of this.hair.ponytail) o.visible = style === 1 || (!bare && style === 9);
    for (const o of this.hair.braid) o.visible = style === 2;
    for (const o of this.hair.bun) o.visible = style === 7 && bare;
    for (const o of this.hair.plait) o.visible = style === 11;
    for (const o of this.hair.dutch) o.visible = style === 10 && bare;
    for (const o of this.hair.dutchTail) o.visible = style === 10;
    for (const o of this.hair.moustache) o.visible = !!look.moustache && lookSex(look) === 'male';
  }

  setEffort(ftpFrac: number, hrFrac?: number): void {
    this.ftpFrac = ftpFrac;
    this.hrFrac = hrFrac;
  }

  setGesture(g: RiderGesture): void {
    this.gesture = g;
  }

  /**
   * VTT ou gravel : kit (cadre, roues, selle, poignées) posé sur chaque niveau du vélo monté, à la
   * place des pièces route correspondantes ; route : vélo du catalogue tel quel.
   */
  setBikeType(type: BikeType): void {
    this.bikeType = type;
    for (const list of this.kits.values()) for (const k of list) k.removeFromParent();
    this.kits.clear();
    const levels = this.mounted?.levels.map((lv) => lv.group) ?? [];
    // Gravel ou VTT avec son propre modèle monté : rien à poser sur le vélo.
    const kitted = type !== 'road' && this.mounted?.family !== type;
    if (kitted) {
      const list: THREE.Group[] = [];
      for (const level of levels) {
        const kit = buildBikeKit(level, type);
        if (!kit) continue;
        kit.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.material as THREE.Material;
          let mat = this.materials.get(src.name);
          if (!mat) {
            mat = makeMaterial(src.name, this.look);
            this.materials.set(src.name, mat);
          }
          mesh.material = mat;
          mesh.castShadow = this.shadows && bigPart(mesh);
          mesh.receiveShadow = true;
        });
        for (const w of ['wheel_front', 'wheel_rear']) {
          const o = kit.getObjectByName(w);
          if (o) this.bike.wheels.push(o);
        }
        list.push(kit);
      }
      this.kits.set(type, list);
    }
    const hidden = new Set(kitted ? roadPartsReplaced(type) : []);
    for (const level of levels) {
      level.traverse((o) => {
        if (o.parent?.name.startsWith('kit_') || o.name.startsWith('kit_')) return;
        if (['frame', 'wheel_front', 'wheel_rear', 'cockpit'].includes(o.name)) o.visible = !hidden.has(o.name);
      });
    }
    this.aimHands();
    this.applySize();
  }

  /** Rapport de taille d'un look (modèles MPFB et acheté ; l'ancien coureur garde la sienne). */
  private sizeOf(look: AvatarLook): number {
    if (this.t.names.hips !== 'pelvis' || !look.heightCm) return 1;
    const ref = this.t.textured.size ? MODEL_HEIGHT_CM : this.kind === 'female' ? FEMALE_HEIGHT_CM : MPFB_HEIGHT_CM;
    return THREE.MathUtils.clamp(look.heightCm, HEIGHT_RANGE_CM[0], HEIGHT_RANGE_CM[1]) / ref;
  }

  /**
   * Hauteur de selle : décalage vertical (repère du coureur) qui donne un genou à KNEE_BOTTOM_DEG
   * pédale en bas (manivelle verticale), compte tenu des longueurs réelles du squelette et de la
   * manivelle réelle (non mise à l'échelle avec le cadre).
   */
  private saddleLiftFor(k: number): number {
    const t = this.t;
    const leg = t.legs.R;
    const thigh = t.bones[leg.upper].modelP;
    const ankle = this.tmpAnkle.copy(t.ankleFlat.R).applyAxisAngle(X_AXIS, t.pedalPitch).add(this.tmpPedal.set(t.pedalRest.R.x, t.bb.y - t.crank / k, t.bb.z));
    const target = Math.sqrt(leg.l1 * leg.l1 + leg.l2 * leg.l2 - 2 * leg.l1 * leg.l2 * Math.cos(THREE.MathUtils.degToRad(KNEE_BOTTOM_DEG)));
    const dx = thigh.x - ankle.x;
    const dz = thigh.z - ankle.z;
    const dy = Math.sqrt(Math.max(target * target - dx * dx - dz * dz, 0));
    return THREE.MathUtils.clamp(dy - (thigh.y - ankle.y), -0.04, 0.05);
  }

  /**
   * Coureur et vélo à la taille : tout le niveau de détail mis à l'échelle autour de l'axe des
   * roues, puis roues, pédalier et pédales ramenés à leurs dimensions réelles (échelle inverse).
   */
  private applySize(): void {
    const k = this.size;
    this.lod.scale.setScalar(k);
    this.lod.position.set(0, WHEEL_R * (1 - k), 0);
    // VTT : kit de cadre propre (selle et poignées fusionnées), pas de réglage de selle.
    this.saddleLift = this.bikeType === 'mtb' ? 0 : this.saddleLiftFor(k);
    this.aimHands();
    // Selle et poste de pilotage (le bassin et les mains suivent, voir update et aimHands) relevés ou
    // abaissés de saddleLift : jambe à ≈ 145° au point bas, buste et coudes inchangés.
    for (const slot of this.bikeSlots) {
      slot.traverse((o) => {
        if (o.name !== 'saddle' && o.name !== 'cockpit' && o.name !== 'aerobars') return;
        o.userData.baseY ??= o.position.y;
        o.position.y = (o.userData.baseY as number) + this.saddleLift;
      });
    }
    for (const o of [...this.bike.wheels, ...this.bike.crank, ...this.bike.pedals.L, ...this.bike.pedals.R]) {
      const base = (o.userData.baseScale ??= o.scale.clone()) as THREE.Vector3;
      o.scale.copy(base).divideScalar(k);
    }
  }

  /** Coureur affiché ou masqué (atelier : le vélo seul sur le pied d'atelier). */
  setRiderVisible(on: boolean): void {
    for (const lv of this.lod.levels) for (const c of lv.object.children) if (!this.bikeSlots.includes(c as THREE.Group)) c.visible = on;
  }

  /** Surbrillance de l'atelier sur des matériaux du vélo (voir BikeMaterials.highlight). */
  highlightBike(names: readonly string[], amount: number): void {
    this.mounted?.materials.highlight(names, amount);
  }

  setLook(look: AvatarLook): void {
    this.look = look;
    this.size = this.sizeOf(look);
    for (const m of this.materials.values()) applyLookColor(m, look);
    this.skin?.setLook(skinLook(look));
    this.skin?.setJersey(look);
    this.applyHair(look);
    this.mountBike(bikeOfLook(look), look);
    if (this.mounted) this.applyHeadgear(this.mounted.build);
    this.setBuild(look.build);
    if (bikeTypeOf(look) !== this.bikeType) this.setBikeType(bikeTypeOf(look));
  }
}

/** Avatar glTF si les modèles sont chargés (GltfRiderAvatar.load()), sinon l'avatar procédural. */
export function createAvatar(look: AvatarLook, kind: AvatarKind = AVATAR_KIND): RiderAvatarLike {
  // Style jeu vidéo : cycliste et vélo low poly construits de zéro (lowPolyRider.ts).
  if (LOW_POLY) return new LowPolyRider(look);
  if (GltfRiderAvatar.has(kind)) return new GltfRiderAvatar(look, kind);
  return GltfRiderAvatar.ready ? new GltfRiderAvatar(look) : new RiderAvatar(look);
}
