import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PLAIN_BIKE_FAMILY, bikeOfLook, type AvatarLook, type BikeBuild, type BikeFamily } from '@allezrobert/shared';
import { RiderAvatar } from './avatar.ts';
import { BikeMaterials, assembleBike, availableFamily, bikeAnchors, familyScene, loadBikeFamily, type AssembledBike, type BikeAnchors } from './bikes.ts';

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
 * LOD : niveau 1 (≈ 25 % des triangles) au-delà de LOD1_DISTANCE, lié au même squelette.
 */

export type RiderPose = 'seated' | 'standing' | 'coasting';

/** Interface commune aux avatars procédural et glTF. */
export interface RiderAvatarLike {
  readonly root: THREE.Group;
  readonly label: THREE.Sprite | null;
  update(dt: number, cadence: number, speed: number, pose: RiderPose, bank?: number): void;
  setLook(look: AvatarLook): void;
  setHeadVisible(on: boolean): void;
  setShadows(on: boolean): void;
  /** Position des yeux (repère monde) pour la vue subjective ; absente : position estimée par la caméra. */
  eyeWorld?(out: THREE.Vector3, hands?: THREE.Vector3): THREE.Vector3;
}

const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upper_arm_L', 'forearm_L', 'hand_L', 'thigh_L', 'shin_L', 'foot_L',
  'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R',
] as const;
type BoneName = (typeof BONES)[number];
type Side = 'L' | 'R';
const SIDES: readonly Side[] = ['L', 'R'];

const FILES = ['cyclist.glb', 'cyclist_lod1.glb'] as const;
/** Distance (m) au-delà de laquelle on affiche le LOD1. */
const LOD1_DISTANCE = 30;
const WHEEL_R = 0.335;
/**
 * Position chrono, par unité de « tuck » (rad) : surtout le bassin qui bascule vers l'avant (dos
 * plat), un peu la colonne et le thorax ; la tête se relève pour regarder la route.
 */
const TUCK_HIPS = 0.5;
const TUCK_SPINE = 0.08;
const TUCK_CHEST = 0.12;
const TUCK_HEAD = 0.35;
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
  shoe_sole: ['#1a1b1f', 0.6, 0],
  helmet: ['#f4f4f4', 0.35, 0],
  helmet_detail: ['#1c1d22', 0.6, 0],
  lens: ['#20242c', 0.08, 0.6],
  glasses_frame: ['#141518', 0.35, 0],
  hair: ['#3b2a1e', 0.8, 0],
  components: ['#18191c', 0.45, 0.2],
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
  rider0: GLTF;
  rider1: GLTF;
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
}

let templates: Templates | null = null;
let loading: Promise<boolean> | null = null;

// Temporaires (aucune allocation par image).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
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

function buildTemplates(rider0: GLTF, rider1: GLTF): Templates {
  const scene = rider0.scene;
  scene.updateMatrixWorld(true);
  const bones = {} as Record<BoneName, BoneRest>;
  let armature: THREE.Object3D | null = null;
  for (const name of BONES) {
    const b = scene.getObjectByName(name);
    if (!b) throw new Error(`os manquant dans cyclist.glb : ${name}`);
    const parentName = b.parent?.name ?? '';
    const parent = (BONES as readonly string[]).includes(parentName) ? (parentName as BoneName) : null;
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
  const ankleFlat = {} as Record<Side, THREE.Vector3>;
  const legs = {} as Record<Side, ChainRest>;
  const arms = {} as Record<Side, ChainRest>;
  for (const s of SIDES) {
    ankleFlat[s] = new THREE.Vector3().subVectors(bones[`foot_${s}`].modelP, pedalRest[s]).applyAxisAngle(X_AXIS, -pedalPitch);
    legs[s] = chainRest(bones, `thigh_${s}`, `shin_${s}`, `foot_${s}`);
    arms[s] = chainRest(bones, `upper_arm_${s}`, `forearm_${s}`, `hand_${s}`);
  }
  // Yeux : l'os de la tête va de l'atlas au sommet du crâne (axe Y de l'os) ; dans le script Blender
  // ils sont ≈ 6 cm au-dessus de l'atlas et 9,5 cm devant. On se place juste devant (verres des lunettes).
  const uh = new THREE.Vector3(0, 1, 0).applyQuaternion(bones.head.modelQ).normalize();
  const fh = new THREE.Vector3(0, 0, 1).addScaledVector(uh, -uh.z).normalize();
  const eyeRest = uh.multiplyScalar(0.06).addScaledVector(fh, 0.11);
  return { rider0, rider1, bones, armQ, armP, legs, arms, bb, crank, pedalRest, pedalPitch, ankleFlat, eyeRest, refHands: bikeAnchors(PLAIN_BIKE_FAMILY).hands };
}

function makeMaterial(name: string, look: AvatarLook): THREE.MeshStandardNodeMaterial {
  const def = MATERIALS[name] ?? ['#808080', 0.6, 0];
  const m = new THREE.MeshStandardNodeMaterial({ color: def[0], roughness: def[1], metalness: def[2] });
  m.name = name;
  applyLookColor(m, look);
  return m;
}

function applyLookColor(m: THREE.MeshStandardNodeMaterial, look: AvatarLook): void {
  const c: Partial<Record<string, string>> = {
    skin: look.skin,
    jersey: look.jersey,
    jersey_accent: look.jerseyAccent,
    helmet: look.helmet,
    hair: look.hair,
  };
  const col = c[m.name];
  if (col) m.color.set(col);
}

interface BikeParts {
  crank: THREE.Object3D[];
  wheels: THREE.Object3D[];
  pedals: Record<Side, THREE.Object3D[]>;
}

/** Vélo monté sur l'avatar : modèle demandé, famille réellement affichée, pièces des deux LOD. */
interface MountedBike {
  key: string;
  build: BikeBuild;
  family: BikeFamily;
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
  private readonly bike: BikeParts = { crank: [], wheels: [], pedals: { L: [], R: [] } };
  /** Groupes recevant le vélo : niveau 0, niveau 1. */
  private readonly bikeSlots: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private mounted: MountedBike | null = null;
  private look: AvatarLook;
  /** Cible des mains (repère modèle) et direction des coudes, selon le vélo monté. */
  private readonly handTarget: Record<Side, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private readonly elbowPole: Record<Side, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  /** Position chrono (vélo à prolongateurs ; 0 = buste de repos) : dos plongeant jusqu'à poser les coudes. */
  private tuck = 0;
  /** Casques route et chrono, lunettes (les deux LOD) : casque chrono à visière selon le vélo. */
  private readonly headgear: Record<'road' | 'aero' | 'glasses', THREE.Object3D[]> = { road: [], aero: [], glasses: [] };
  private crankAngle = Math.random() * Math.PI * 2;
  private wheelAngle = 0;
  private poseBlend = 0; // 0 assis → 1 danseuse
  private coastBlend = 0;
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
  static async load(families: readonly BikeFamily[] = [], baseUrl = `${import.meta.env.BASE_URL}models/`): Promise<boolean> {
    const extra = Promise.all(families.map((f) => loadBikeFamily(f)));
    loading ??= (async () => {
      try {
        const loader = new GLTFLoader();
        const [riders, plain] = await Promise.all([Promise.all(FILES.map((f) => loader.loadAsync(baseUrl + f))), loadBikeFamily(PLAIN_BIKE_FAMILY)]);
        if (!plain) throw new Error(`vélo de base (${PLAIN_BIKE_FAMILY}) indisponible`);
        const [r0, r1] = riders;
        templates = buildTemplates(r0 as GLTF, r1 as GLTF);
        return true;
      } catch (e) {
        console.warn('Avatar glTF indisponible, repli sur l’avatar procédural', e);
        loading = null;
        return false;
      }
    })();
    const ok = await loading;
    await extra;
    return ok;
  }

  /** Modèles chargés ? */
  static get ready(): boolean {
    return templates !== null;
  }

  constructor(look: AvatarLook) {
    if (!templates) throw new Error('GltfRiderAvatar.load() doit être appelé (et attendu) avant la création');
    const t = (this.t = templates);
    this.look = look;
    this.root.add(this.lean);
    this.lean.add(this.lod);

    // Niveau 0 : squelette cloné + vélo complet.
    const rider0 = SkeletonUtils.clone(t.rider0.scene);
    for (const name of BONES) {
      const b = rider0.getObjectByName(name);
      if (!b) throw new Error(`os manquant : ${name}`);
      this.bones[name] = b;
      this.mQ[name] = new THREE.Quaternion();
      this.mP[name] = new THREE.Vector3();
    }
    const level0 = new THREE.Group();
    level0.add(this.bikeSlots[0], rider0);

    // Niveau 1 : maillages simplifiés liés aux os du niveau 0 (un seul squelette à animer).
    const level1 = new THREE.Group();
    level1.add(this.bikeSlots[1]);
    t.rider1.scene.updateMatrixWorld(true);
    t.rider1.scene.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const m = sm.clone();
      const bones = sm.skeleton.bones.map((b) => (this.bones[b.name as BoneName] as THREE.Bone | undefined) ?? b);
      m.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses), sm.bindMatrix);
      sm.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      level1.add(m);
    });

    this.lod.addLevel(level0, 0, 0.1);
    this.lod.addLevel(level1, LOD1_DISTANCE, 0.1);

    // Coureur : matériaux (instances propres à l'avatar), ombres, sphères englobantes des maillages skinnés.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0.05), 1.1);
    this.lod.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      let mat = this.materials.get(src.name);
      if (!mat) {
        mat = makeMaterial(src.name, look);
        this.materials.set(src.name, mat);
      }
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        (mesh as THREE.SkinnedMesh).boundingSphere = bounds.clone();
        if (mesh.morphTargetDictionary && mesh.morphTargetDictionary.build !== undefined) this.morphMeshes.push(mesh);
      }
    });
    this.lod.traverse((o) => {
      const n = o.name;
      if (n.startsWith('rider_helmet_aero')) this.headgear.aero.push(o);
      else if (n.startsWith('rider_helmet')) this.headgear.road.push(o);
      else if (n.startsWith('rider_glasses')) this.headgear.glasses.push(o);
    });
    this.mountBike(bikeOfLook(look), look);
    this.setBuild(look.build);
    this.update(0, 0, 0, 'seated');
  }

  /**
   * Monte le vélo demandé (ses deux niveaux de détail). Famille pas encore chargée : vélo de
   * base à la même livrée, remplacé dès que la famille arrive.
   */
  private mountBike(build: BikeBuild, look: AvatarLook): void {
    const key = look.bikeModel ?? 'plain';
    const family = availableFamily(build.family) ?? PLAIN_BIKE_FAMILY;
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
    const materials = new BikeMaterials(build, look);
    const levels = [assembleBike(build, family, 0), assembleBike(build, family, 1)];
    const parts: BikeParts = { crank: [], wheels: [], pedals: { L: [], R: [] } };
    levels.forEach((lv, i) => {
      lv.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = materials.get((mesh.material as THREE.Material).name);
        mesh.castShadow = this.shadows;
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
    // Mains : écart des ancres du vélo à celles du vélo de base (pose de repos) ; coudes tirés
    // vers les repose-coudes s'il y en a, sinon pli de repos.
    for (const s of SIDES) {
      const c = this.t.arms[s];
      const rest = this.t.bones[c.end].modelP;
      this.handTarget[s].copy(rest).add(anchors.hands[s]).sub(this.t.refHands[s]);
      const pad = anchors.pads?.[s];
      if (pad) {
        const sh = this.t.bones[c.upper].modelP;
        const dir = _v1.subVectors(this.handTarget[s], sh).normalize();
        const toPad = _v2.subVectors(pad, sh);
        this.elbowPole[s].copy(toPad).addScaledVector(dir, -toPad.dot(dir)).normalize();
      } else this.elbowPole[s].copy(c.pole);
    }
    this.tuck = anchors.pads ? this.solveTuck(anchors.pads) : 0;
    // Casque chrono (modèles qui le demandent) : sa visière remplace les lunettes. Sans casque chrono
    // dans le modèle du coureur (ancien cyclist.glb), casque route.
    const aero = !!build.params.aeroHelmet && this.headgear.aero.length > 0;
    for (const o of this.headgear.aero) o.visible = aero;
    for (const o of this.headgear.road) o.visible = !aero;
    for (const o of this.headgear.glasses) o.visible = !aero;
    if (family !== build.family) {
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
  update(dt: number, cadence: number, speed: number, pose: RiderPose, bank = 0): void {
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
    const a = this.crankAngle;
    const stand = this.poseBlend;
    const coast = this.coastBlend * (1 - stand);

    // Vélo : en danseuse il balance à l'opposé de la jambe qui appuie ; le corps compense en partie.
    const rock = -Math.sin(a) * 0.11 * stand;
    this.lean.rotation.z = bank + rock;
    const counter = -rock * 0.65;

    // Pédalier, roues, pédales (les pédales automatiques suivent l'inclinaison du pied).
    for (const c of this.bike.crank) c.rotation.x = a;
    for (const w of this.bike.wheels) w.rotation.x = this.wheelAngle;

    // --- Bassin
    const hipsR = t.bones.hips;
    const roll = 0.02 * Math.sin(a) * (1 - stand) * (1 - coast);
    const tuck = this.tuck * (1 - 0.6 * stand);
    const tilt = -0.09 * stand - 0.05 * coast + TUCK_HIPS * tuck;
    _q1.setFromAxisAngle(Z_AXIS, counter + roll);
    _q2.setFromAxisAngle(X_AXIS, tilt);
    _q3.multiplyQuaternions(_q1, _q2).multiply(hipsR.modelQ);
    _v4.copy(hipsR.modelP);
    _v4.y += 0.02 * stand + 0.004 * Math.sin(2 * a) * (1 - stand) * (1 - coast) - 0.01 * Math.abs(Math.cos(a)) * stand;
    _v4.z += 0.13 * stand;
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
    if (tuck > 0) this.setModelQ('spine', _q3.setFromAxisAngle(X_AXIS, TUCK_SPINE * tuck).multiply(this.mQ.spine));
    _q1.multiplyQuaternions(this.mQ.spine, t.bones.chest.localQ);
    _q2.setFromAxisAngle(Z_AXIS, -roll * 0.9);
    if (tuck > 0) _q2.multiply(_q3.setFromAxisAngle(X_AXIS, TUCK_CHEST * tuck));
    this.setModelQ('chest', _q3.multiplyQuaternions(_q2, _q1));

    // --- Tête : regarde devant, compense une partie de l'inclinaison ; le cou en prend la moitié.
    this.bones.neck.quaternion.copy(t.bones.neck.localQ);
    this.fk('neck');
    const look = 0.06 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.13);
    _q1.setFromAxisAngle(Z_AXIS, -(0.7 * bank + rock + counter));
    if (tuck > 0) _q1.multiply(_q3.setFromAxisAngle(X_AXIS, -TUCK_HEAD * tuck));
    _q2.setFromAxisAngle(Y_AXIS, look);
    const headTarget = _q3.multiplyQuaternions(_q1, _q2).multiply(t.bones.head.modelQ);
    _q1.multiplyQuaternions(this.mQ.neck, t.bones.head.localQ).invert(); // tête si cou au repos
    _q2.multiplyQuaternions(headTarget, _q1); // écart restant
    _q1.slerpQuaternions(_id, _q2, 0.5);
    this.setModelQ('neck', _q2.multiplyQuaternions(_q1, this.mQ.neck));
    this.setModelQ('head', headTarget);

    // --- Bras : mains fixes sur le cintre (ou les prolongateurs).
    for (const s of SIDES) {
      const c = t.arms[s];
      this.bones[c.upper].quaternion.copy(t.bones[c.upper].localQ);
      this.fk(c.upper);
      this.solveChain(c, this.target.copy(this.handTarget[s]), this.elbowPole[s]);
      this.setModelQ(c.end, t.bones[c.end].modelQ);
    }

    // --- Jambes : cheville calée sur la pédale.
    for (const s of SIDES) {
      const c = t.legs[s];
      const as = a + (s === 'L' ? 0 : Math.PI);
      const rest = t.pedalRest[s];
      this.pedal.set(rest.x, t.bb.y - Math.cos(as) * t.crank, t.bb.z - Math.sin(as) * t.crank);
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

  private setBuild(build: number): void {
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
    this.lean.updateWorldMatrix(true, false);
    if (hands) this.lean.localToWorld(hands.addVectors(this.mP.hand_L, this.mP.hand_R).multiplyScalar(0.5));
    return this.lean.localToWorld(out);
  }

  /**
   * Masque la tête (vue subjective, caméra embarquée) : l'os du cou est réduit à un point, la tête
   * (son enfant) avec lui ; sinon le moignon du cou resterait dans le champ, sous la caméra.
   */
  setHeadVisible(on: boolean): void {
    this.bones.neck.scale.setScalar(on ? 1 : 1e-3);
  }

  /** Active ou coupe les ombres portées de tout l'avatar (coureurs lointains : coupées). */
  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = on;
    });
  }

  setLook(look: AvatarLook): void {
    this.look = look;
    for (const m of this.materials.values()) applyLookColor(m, look);
    this.mountBike(bikeOfLook(look), look);
    this.setBuild(look.build);
  }
}

/** Avatar glTF si les modèles sont chargés (GltfRiderAvatar.load()), sinon l'avatar procédural. */
export function createAvatar(look: AvatarLook): RiderAvatarLike {
  return GltfRiderAvatar.ready ? new GltfRiderAvatar(look) : new RiderAvatar(look);
}
