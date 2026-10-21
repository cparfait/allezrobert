import * as THREE from 'three/webgpu';
import type { AvatarLook } from '@allezrobert/shared';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Fusionne les maillages enfants directs d'un groupe, par matériau (transformations locales
 * appliquées) : un vélo passe d'une quarantaine d'appels de dessin à quelques-uns.
 */
function mergeByMaterial(group: THREE.Object3D): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || child.children.length) continue;
    mesh.updateMatrix();
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    const mat = mesh.material as THREE.Material;
    let list = byMat.get(mat);
    if (!list) byMat.set(mat, (list = []));
    list.push(geo);
    group.remove(mesh);
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

/**
 * Cycliste et vélo procéduraux. Repère local : +z = avant, +y = haut, +x = gauche.
 * Pédalage PROCÉDURAL : la manivelle tourne à la cadence réelle, les pieds sont
 * verrouillés sur les pédales et les jambes suivent par cinématique inverse à deux os.
 * Positions : assis, danseuse (balancement du vélo), roue libre.
 */

const BB = new THREE.Vector3(0, 0.27, 0);
const CRANK = 0.1725;
const WHEEL_R = 0.335;
const REAR_AXLE = new THREE.Vector3(0, WHEEL_R, -0.41);
const FRONT_AXLE = new THREE.Vector3(0, WHEEL_R, 0.59);
const SADDLE = new THREE.Vector3(0, 0.95, -0.2);
const HOODS_Z = 0.53;
const THIGH = 0.46;
const SHIN = 0.47;
const UPPER_ARM = 0.3;
const FOREARM = 0.29;
const UP = new THREE.Vector3(0, 1, 0);

type Pose = 'seated' | 'standing' | 'coasting';

function mat(color: THREE.ColorRepresentation, rough = 0.6, metal = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
  return m;
}

/** Segment (cylindre ou capsule) orienté entre deux points, réutilisable chaque image. */
class Limb {
  readonly mesh: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  constructor(radius: number, material: THREE.Material, capsule = true, radiusEnd?: number) {
    const geo = capsule ? new THREE.CapsuleGeometry(radius, 1, 4, 10) : new THREE.CylinderGeometry(radiusEnd ?? radius, radius, 1, 10);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  /** Place le segment de a à b (le rayon de la capsule déborde légèrement : articulations arrondies). */
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    this.tmp.subVectors(b, a);
    const len = this.tmp.length();
    this.mesh.position.addVectors(a, b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, this.tmp.normalize());
    this.mesh.scale.set(1, Math.max(len, 0.001), 1);
  }
}

/** Cinématique inverse à deux os dans un plan défini par un vecteur « genou ». */
function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(target, root);
  const d = Math.min(Math.max(dir.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  dir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const bend = new THREE.Vector3().copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
}

export class RiderAvatar {
  readonly root = new THREE.Group();
  /** Groupe incliné (danseuse / virages) contenant vélo et coureur. */
  private readonly lean = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly crankGroup = new THREE.Group();
  private readonly rearWheel = new THREE.Group();
  private readonly frontWheel = new THREE.Group();
  private readonly legs: Array<{ thigh: Limb; shin: Limb; shoe: THREE.Mesh; side: number; sock: Limb }> = [];
  private readonly arms: Array<{ upper: Limb; fore: Limb; side: number }> = [];
  private readonly torso: Limb;
  private readonly head: THREE.Group;
  private readonly pedals: THREE.Mesh[] = [];
  private crankAngle = Math.random() * Math.PI * 2;
  private wheelAngle = 0;
  private poseBlend = 0; // 0 assis → 1 danseuse
  private coastBlend = 0;
  private readonly materials: Record<string, THREE.MeshStandardNodeMaterial>;
  private time = Math.random() * 10;
  /** Nom affiché au-dessus du coureur. */
  readonly label: THREE.Sprite | null = null;

  constructor(look: AvatarLook) {
    this.materials = {
      jersey: mat(look.jersey, 0.7),
      accent: mat(look.jerseyAccent, 0.7),
      shorts: mat('#15171c', 0.55),
      skin: mat(look.skin, 0.65),
      sock: mat('#f2f2f2', 0.8),
      shoe: mat('#1c1d22', 0.4),
      helmet: mat(look.helmet, 0.35),
      visor: mat('#20242c', 0.1, 0.4),
      frame: mat(look.bike, 0.3, 0.3),
      dark: mat('#18191c', 0.45, 0.2),
      tire: mat('#121214', 0.85),
      rim: mat('#2b2e33', 0.25, 0.8),
      chrome: mat('#b9bcc2', 0.2, 1),
      hair: mat(look.hair, 0.8),
    };
    this.root.add(this.lean);
    this.lean.add(this.buildBike());
    this.lean.add(this.body);

    const m = this.materials;
    const build = 0.85 + look.build * 0.35;
    for (const side of [1, -1]) {
      const thigh = new Limb(0.074 * build, m.shorts as THREE.Material);
      const shin = new Limb(0.052 * build, m.skin as THREE.Material);
      const sock = new Limb(0.046, m.sock as THREE.Material, false);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.27), m.shoe);
      shoe.castShadow = true;
      this.body.add(thigh.mesh, shin.mesh, sock.mesh, shoe);
      this.legs.push({ thigh, shin, shoe, side, sock });
      const upper = new Limb(0.047 * build, m.jersey as THREE.Material);
      const fore = new Limb(0.04 * build, m.skin as THREE.Material);
      this.body.add(upper.mesh, fore.mesh);
      this.arms.push({ upper, fore, side });
    }
    this.torso = new Limb(0.15 * build, m.jersey as THREE.Material);
    this.torso.mesh.scale.x = 1;
    this.body.add(this.torso.mesh);
    // Bande de couleur du maillot (accent) : un anneau sur la poitrine.
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.15 * build, 0.03, 8, 20), m.accent);
    band.name = 'band';
    this.body.add(band);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), m.skin);
    skull.scale.set(0.95, 1.05, 1.1);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.108, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
    hair.rotation.x = -0.5;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m.helmet);
    helmet.scale.set(0.95, 0.85, 1.25);
    helmet.position.set(0, 0.03, -0.01);
    helmet.rotation.x = 0.25;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.04), m.visor);
    visor.position.set(0, 0.01, 0.1);
    for (const o of [skull, hair, helmet, visor]) {
      o.castShadow = true;
      this.head.add(o);
    }
    this.body.add(this.head);
    this.update(0, 0, 0, 'seated');
  }

  private buildBike(): THREE.Group {
    const g = new THREE.Group();
    const m = this.materials;
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, material: THREE.Material) => {
      const l = new Limb(r, material, false);
      l.set(a, b);
      g.add(l.mesh);
    };
    const seatTop = new THREE.Vector3(0, 0.8, -0.155);
    const headTop = new THREE.Vector3(0, 0.83, 0.43);
    const headBottom = new THREE.Vector3(0, 0.67, 0.475);
    const frame = m.frame as THREE.Material;
    tube(BB, seatTop, 0.017, frame); // tube de selle
    tube(seatTop, headTop, 0.016, frame); // tube horizontal
    tube(BB, headBottom, 0.022, frame); // tube diagonal
    tube(headBottom, headTop, 0.022, frame); // douille
    for (const s of [1, -1]) {
      const axle = REAR_AXLE.clone().setX(0.06 * s);
      tube(BB.clone().setX(0.03 * s), axle, 0.011, frame);
      tube(seatTop.clone().setX(0.015 * s).setY(0.77), axle, 0.009, frame);
      tube(headBottom.clone().setX(0.02 * s), FRONT_AXLE.clone().setX(0.05 * s), 0.012, frame);
    }
    // Tige de selle, selle, potence, cintre.
    const dark = m.dark as THREE.Material;
    tube(seatTop, SADDLE.clone().setY(SADDLE.y - 0.03), 0.013, dark);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.27), dark);
    saddle.position.copy(SADDLE);
    saddle.castShadow = true;
    g.add(saddle);
    const stemEnd = new THREE.Vector3(0, 0.88, 0.53);
    tube(headTop, stemEnd, 0.016, dark);
    const bar = new Limb(0.013, dark, false);
    bar.set(new THREE.Vector3(0.21, 0.88, 0.53), new THREE.Vector3(-0.21, 0.88, 0.53));
    g.add(bar.mesh);
    for (const s of [1, -1]) {
      tube(new THREE.Vector3(0.2 * s, 0.88, 0.53), new THREE.Vector3(0.2 * s, 0.86, 0.62), 0.014, dark);
      tube(new THREE.Vector3(0.2 * s, 0.86, 0.62), new THREE.Vector3(0.2 * s, 0.74, 0.6), 0.013, dark);
      tube(new THREE.Vector3(0.2 * s, 0.74, 0.6), new THREE.Vector3(0.2 * s, 0.73, 0.5), 0.013, dark);
      // Cocottes de levier (prise sur les cocottes).
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.07), dark);
      hood.position.set(0.2 * s, 0.9, HOODS_Z + 0.08);
      g.add(hood);
    }
    // Roues : pneu, jante haute, moyeu, rayons.
    for (const [wheel, axle] of [
      [this.rearWheel, REAR_AXLE],
      [this.frontWheel, FRONT_AXLE],
    ] as const) {
      wheel.position.copy(axle);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.014, 0.014, 10, 48), m.tire);
      tire.rotation.y = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.045, 0.02, 6, 48), m.rim);
      rim.rotation.y = Math.PI / 2;
      rim.scale.set(1, 1, 0.6);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 12), m.chrome);
      hub.rotation.z = Math.PI / 2;
      wheel.add(tire, rim, hub);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const sp = new Limb(0.0016, m.chrome as THREE.Material, false);
        sp.set(new THREE.Vector3((k % 2 ? 1 : -1) * 0.03, 0, 0), new THREE.Vector3(0, Math.sin(a) * (WHEEL_R - 0.06), Math.cos(a) * (WHEEL_R - 0.06)));
        wheel.add(sp.mesh);
      }
      mergeByMaterial(wheel);
      g.add(wheel);
    }
    // Pédalier : plateau, manivelles, pédales.
    this.crankGroup.position.copy(BB);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.006, 40), m.chrome);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = -0.045;
    this.crankGroup.add(ring);
    for (const s of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, CRANK, 0.025), m.dark);
      arm.position.set(0.075 * s, (-CRANK / 2) * s, 0);
      this.crankGroup.add(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.09), m.dark);
      this.pedals.push(pedal);
      g.add(pedal);
    }
    mergeByMaterial(this.crankGroup);
    g.add(this.crankGroup);
    // Pièces fixes du vélo (cadre, cintre, selle…) fusionnées ; pédales, roues et pédalier restent mobiles.
    const pedals = new Set<THREE.Object3D>(this.pedals);
    const keep = g.children.filter((c) => pedals.has(c));
    keep.forEach((c) => g.remove(c));
    mergeByMaterial(g);
    keep.forEach((c) => g.add(c));
    return g;
  }

  /**
   * @param dt pas de temps (s)
   * @param cadence tr/min
   * @param speed m/s (rotation des roues)
   * @param pose position du coureur
   * @param bank inclinaison dans les virages (rad)
   */
  update(dt: number, cadence: number, speed: number, pose: Pose, bank = 0): void {
    this.time += dt;
    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.wheelAngle += (speed / WHEEL_R) * dt;
    this.rearWheel.rotation.x = this.wheelAngle;
    this.frontWheel.rotation.x = this.wheelAngle;
    const k = 1 - Math.exp(-dt * 4);
    this.poseBlend += ((pose === 'standing' ? 1 : 0) - this.poseBlend) * k;
    this.coastBlend += ((pose === 'coasting' || cadence < 5 ? 1 : 0) - this.coastBlend) * k;
    if (this.coastBlend > 0.5 && cadence < 5) {
      // Roue libre : manivelles ramenées à l'horizontale (pied avant légèrement haut).
      const target = Math.round((this.crankAngle - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crankAngle += (target - this.crankAngle) * k * 0.5;
    }
    this.crankGroup.rotation.x = this.crankAngle;

    const stand = this.poseBlend;
    // Balancement du vélo en danseuse, synchronisé sur les coups de pédale.
    this.lean.rotation.z = bank + Math.sin(this.crankAngle) * 0.13 * stand;

    const hip = new THREE.Vector3(0, SADDLE.y + 0.06 + 0.13 * stand, SADDLE.z + 0.02 + 0.2 * stand);
    hip.y += Math.sin(this.crankAngle * 2) * 0.01 * (1 - stand);
    const shoulder = new THREE.Vector3(0, 1.4 + 0.08 * stand, 0.24 + 0.08 * stand);
    shoulder.y -= this.coastBlend * 0.03;
    // Torse.
    this.torso.set(hip.clone().add(new THREE.Vector3(0, 0.05, 0.02)), shoulder);
    const band = this.body.getObjectByName('band') as THREE.Mesh;
    band.position.lerpVectors(hip, shoulder, 0.62);
    band.quaternion.copy(this.torso.mesh.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    // Tête : regarde la route.
    this.head.position.copy(shoulder).add(new THREE.Vector3(0, 0.16, 0.1));
    this.head.rotation.x = 0.35 - 0.15 * stand;

    // Jambes : pieds verrouillés sur les pédales.
    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedal = new THREE.Vector3(0.11 * leg.side, BB.y - Math.cos(a) * CRANK, BB.z - Math.sin(a) * CRANK);
      const p = this.pedals[leg.side > 0 ? 0 : 1] as THREE.Mesh;
      p.position.copy(pedal);
      const ankle = pedal.clone().add(new THREE.Vector3(0, 0.06, -0.05));
      const hipJ = hip.clone().setX(0.095 * leg.side);
      const knee = new THREE.Vector3();
      solveTwoBone(hipJ, ankle, THIGH, SHIN, new THREE.Vector3(0.05 * leg.side, 0.2, 1), knee);
      leg.thigh.set(hipJ, knee);
      leg.shin.set(knee, ankle);
      leg.sock.set(ankle.clone().add(new THREE.Vector3(0, 0.1, 0.02)), ankle);
      leg.shoe.position.copy(pedal).add(new THREE.Vector3(0, 0.035, 0.03));
      // Cheville : orteils légèrement vers le bas en haut de course.
      leg.shoe.rotation.x = 0.15 + Math.sin(a) * 0.12;
    }
    // Bras : mains sur les cocottes, coudes fléchis vers l'extérieur.
    for (const arm of this.arms) {
      const sh = shoulder.clone().add(new THREE.Vector3(0.18 * arm.side, -0.03, 0));
      const hand = new THREE.Vector3(0.2 * arm.side, 0.92, HOODS_Z + 0.08);
      const elbow = new THREE.Vector3();
      solveTwoBone(sh, hand, UPPER_ARM, FOREARM, new THREE.Vector3(0.6 * arm.side, -0.6, -0.4), elbow);
      arm.upper.set(sh, elbow);
      arm.fore.set(elbow, hand);
    }
  }

  private shadows = true;
  /** Active ou coupe les ombres portées de tout l'avatar (coureurs lointains : coupées). */
  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.root.traverse((o) => (o.castShadow = on));
  }

  setLook(look: AvatarLook): void {
    const m = this.materials;
    (m.jersey as THREE.MeshStandardNodeMaterial).color.set(look.jersey);
    (m.accent as THREE.MeshStandardNodeMaterial).color.set(look.jerseyAccent);
    (m.skin as THREE.MeshStandardNodeMaterial).color.set(look.skin);
    (m.helmet as THREE.MeshStandardNodeMaterial).color.set(look.helmet);
    (m.frame as THREE.MeshStandardNodeMaterial).color.set(look.bike);
    (m.hair as THREE.MeshStandardNodeMaterial).color.set(look.hair);
  }
}
