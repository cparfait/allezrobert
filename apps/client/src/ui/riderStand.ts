/**
 * Coureur du jeu debout, sans son vélo, mains sur les hanches (portrait de « Prêt à rouler ? » en Réel et en Poly, voir
 * startRider.ts). Pose originale calculée une fois sur le squelette, après quoi l'avatar n'est plus mis à jour.
 */
import * as THREE from 'three/webgpu';
import type { AvatarLook } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { LowPolyRider } from '../rider/lowPolyRider.ts';
import type { BodyJoints, SweptBody } from '../rider/sweptBody.ts';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0): V => new THREE.Vector3(x, y, z);

export interface StandingRider {
  root: THREE.Object3D;
  /** Semelles et haut du casque (repère monde), pour le cadrage. */
  feetY: number;
  topY: number;
  /** Sens du regard. */
  ahead: V;
}

/** Coude ou genou : deux os de longueurs `a` et `b`, plié du côté de `pole`. */
export function elbowAt(from: V, to: V, a: number, b: number, pole: V): V {
  const dir = to.clone().sub(from);
  const d = Math.min(dir.length(), (a + b) * 0.999);
  dir.normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, a * a - along * along));
  const side = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return from.clone().addScaledVector(dir, along).addScaledVector(side, off);
}

// ————————————————————————————————————————————— Réel (squelette glTF)

/** Tourne l'os pour que son enfant se trouve dans la direction voulue (repère monde). */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: V): void {
  bone.updateWorldMatrix(true, true);
  const p = bone.getWorldPosition(v3());
  const now = child.getWorldPosition(v3()).sub(p).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(now, dir.clone().normalize());
  const world = turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
  bone.quaternion.copy(parent.multiply(world));
  bone.updateWorldMatrix(false, true);
}

function standGltf(avatar: RiderAvatarLike): StandingRider | null {
  const root = avatar.root;
  root.updateMatrixWorld(true);
  const bone = (name: string) => root.getObjectByName(name);
  const names = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'] as const;
  const b = Object.fromEntries(names.map((n) => [n, bone(n)])) as Record<(typeof names)[number], THREE.Object3D | undefined>;
  const get = (n: (typeof names)[number]): THREE.Object3D => b[n] as THREE.Object3D;
  if (names.some((n) => !b[n])) return null;
  // Vélo masqué : tout ce qui n'est pas lié au squelette.
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let onBone = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) onBone ||= (p as THREE.Bone).isBone;
    if (!(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh && !onBone) mesh.visible = false;
    mesh.frustumCulled = false;
  });
  const up = v3(0, 1, 0);
  // La tête regarde déjà la route : on garde son orientation, seul le corps se redresse dessous.
  const headWorld = get('head').getWorldQuaternion(new THREE.Quaternion());
  // Bassin encore un peu penché vers l'avant (le modèle est lié assis sur le vélo, bassin à ≈ 54°) : redressé à la
  // verticale, la peau se plissait en bourrelet à l'aine ; les lombaires compensent au-dessus.
  aim(get('pelvis'), get('spine_01'), v3(0, 1, 0.3));
  aim(get('spine_01'), get('spine_02'), v3(0, 1, -0.12));
  aim(get('spine_02'), get('spine_03'), v3(0, 1, 0));
  aim(get('spine_03'), get('neck_01'), v3(0, 1, -0.08));
  aim(get('neck_01'), get('head'), v3(0, 1, 0.16));
  for (const s of ['l', 'r'] as const) {
    const side = get(`thigh_${s}`).getWorldPosition(v3()).x >= get('pelvis').getWorldPosition(v3()).x ? 1 : -1;
    aim(get(`thigh_${s}`), get(`calf_${s}`), v3(0.09 * side, -1, 0.02));
    aim(get(`calf_${s}`), get(`foot_${s}`), v3(0.03 * side, -1, -0.05));
    const toe = get(`foot_${s}`).children.find((c) => (c as THREE.Bone).isBone);
    if (toe) aim(get(`foot_${s}`), toe, v3(0.1 * side, -0.56, 1));
    // Épaules basses, mains sur les hanches, coudes ouverts.
    aim(get(`clavicle_${s}`), get(`upperarm_${s}`), v3(side, -0.02, -0.05));
    const sh = get(`upperarm_${s}`).getWorldPosition(v3());
    const el = get(`lowerarm_${s}`).getWorldPosition(v3());
    const wr = get(`hand_${s}`).getWorldPosition(v3());
    const hip = get('pelvis').getWorldPosition(v3());
    // Poignet sur le côté de la taille, au-dessus de l'os iliaque (l'os `pelvis` du modèle MPFB est à hauteur des
    // articulations des hanches) : plus bas ou plus en avant, les doigts tombent sur le haut des cuisses.
    const target = hip.clone().add(v3(0.21 * side, 0.15, -0.035));
    const elbow = elbowAt(sh, target, sh.distanceTo(el), el.distanceTo(wr), v3(side, -0.1, -0.55));
    aim(get(`upperarm_${s}`), get(`lowerarm_${s}`), elbow.clone().sub(sh));
    aim(get(`lowerarm_${s}`), get(`hand_${s}`), target.clone().sub(get(`lowerarm_${s}`).getWorldPosition(v3())));
    const fingers = get(`hand_${s}`).children.find((c) => /middle/.test(c.name)) ?? get(`hand_${s}`).children.find((c) => (c as THREE.Bone).isBone);
    // Doigts vers l'avant et le bas, le long de la hanche (pouce en arrière).
    const fd = v3(-0.12 * side, -0.55, 0.85).normalize();
    if (fingers) aim(get(`hand_${s}`), fingers, fd);
    // Doigts serrés et à peine fléchis contre la hanche, pouce vers l'arrière : la pose de repos du modèle est la prise
    // des cocottes (poing), qui se déformait mains sur les hanches.
    for (const fn of ['index', 'middle', 'ring', 'pinky']) {
      for (let k = 1; k <= 2; k++) {
        const a = bone(`${fn}_0${k}_${s}`);
        const c = bone(`${fn}_0${k + 1}_${s}`);
        if (a && c) aim(a, c, fd.clone().add(v3(-0.18 * k * side, -0.1 * k, 0)));
      }
    }
    const t1 = bone(`thumb_01_${s}`);
    const t2 = bone(`thumb_02_${s}`);
    const t3 = bone(`thumb_03_${s}`);
    if (t1 && t2) aim(t1, t2, v3(-0.25 * side, -0.35, -0.9));
    if (t2 && t3) aim(t2, t3, v3(-0.3 * side, -0.4, -0.85));
  }
  const head = get('head');
  const parent = head.parent as THREE.Object3D;
  parent.updateWorldMatrix(true, false);
  // Regard à l'horizontale, dans le sens du vélo.
  const yawless = new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), -0.06);
  head.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(yawless).multiply(headWorld));
  root.updateMatrixWorld(true);
  const feetY = Math.min(get('foot_l').getWorldPosition(v3()).y, get('foot_r').getWorldPosition(v3()).y) - 0.1;
  return { root, feetY, topY: head.getWorldPosition(v3()).addScaledVector(up, 0.26).y, ahead: v3(0, 0, 1) };
}

// ————————————————————————————————————————————— Poly (corps en tubes)

/** Ce que la pose touche dans le coureur low poly (champs privés : lus ici seulement, sans changer la classe). */
interface PolyParts {
  lean: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  neck: { set(a: V, b: V): void };
  legs: Array<{ side: number; shoe: THREE.Object3D }>;
  arms: Array<{ side: number; glove: THREE.Object3D }>;
  J: BodyJoints;
  swept: SweptBody | null;
  /** Construit le corps en tubes sur les articulations du moment (J). */
  buildTubes(look: AvatarLook): void;
}

function standPoly(rider: LowPolyRider, look: AvatarLook): StandingRider | null {
  const p = rider as unknown as PolyParts;
  if (!p.swept || !p.J) return null;
  for (const c of p.lean.children) if (c !== p.body) c.visible = false;
  p.lean.rotation.set(0, 0, 0);
  const J = p.J;
  const thigh = 0.46;
  const shin = 0.47;
  const hip = v3(0, thigh + shin + 0.07, 0);
  const torso = J.hip.distanceTo(J.shoulder);
  const shoulder = hip.clone().add(v3(0, torso, 0.02));
  J.hip.copy(hip);
  J.seat.copy(hip).add(v3(0, -0.1, 0));
  // Bassin à peine basculé : le corps est reconstruit debout (plus bas), sa coque de cuissard n'a plus à se redresser.
  J.mid.lerpVectors(hip, shoulder, 0.5).add(v3(0, 0, 0.015));
  J.shoulder.copy(shoulder);
  J.neck.copy(shoulder).add(v3(0, 0.06, 0.012));
  J.pelvisFollow = 1;
  // Cou court, tête près des épaules (modèle de référence de l'utilisateur, 25/11/2026).
  const neckTop = shoulder.clone().add(v3(0, 0.085, 0.025));
  p.neck.set(shoulder.clone().add(v3(0, 0.02, 0.008)), neckTop);
  p.head.position.copy(neckTop).add(v3(0, 0.06, 0.03));
  p.head.rotation.set(0.02, 0, 0);
  for (const leg of p.legs) {
    const j = J.legs[leg.side > 0 ? 0 : 1];
    if (!j) continue;
    j.hip.copy(hip).add(v3(0.1 * leg.side, 0, 0));
    j.ankle.set(0.145 * leg.side, 0.085, -0.02);
    j.knee.copy(elbowAt(j.hip, j.ankle, thigh, shin, v3(0.15 * leg.side, 0, 1)));
    leg.shoe.position.copy(j.ankle).add(v3(0.008 * leg.side, -0.032, 0.05));
    leg.shoe.rotation.set(0.02, 0.22 * leg.side, 0);
  }
  for (const arm of p.arms) {
    const j = J.arms[arm.side > 0 ? 0 : 1];
    if (!j) continue;
    j.sh.copy(shoulder).add(v3(0.17 * arm.side, -0.04, 0));
    // Poignet sur le côté de la taille (plus bas ou plus en avant, les gants tombent sur l'entrejambe).
    j.wr.copy(hip).add(v3(0.18 * arm.side, 0.17, 0.0));
    j.el.copy(elbowAt(j.sh, j.wr, 0.265, 0.27, v3(arm.side, -0.1, -0.5)));
    arm.glove.position.copy(j.wr);
    const y = v3(-0.15 * arm.side, -0.6, 0.75).normalize();
    const x = v3(0, 0.3 * arm.side, 1).addScaledVector(y, -v3(0, 0.3 * arm.side, 1).dot(y)).normalize();
    arm.glove.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
  }
  // Corps reconstruit sur la pose debout : lié assis sur le vélo puis redressé, le cuissard faisait une bosse devant
  // (coque du bassin basculée de 30°) et une pointe derrière.
  p.body.remove(p.swept.mesh);
  p.swept.dispose();
  p.buildTubes(look);
  if (!p.swept) return null;
  rider.root.updateMatrixWorld(true);
  rider.root.traverse((o) => (o.frustumCulled = false));
  return { root: rider.root, feetY: 0.01, topY: p.head.getWorldPosition(v3()).y + 0.2, ahead: v3(0, 0, 1) };
}

/** Coureur du style courant (Réel ou Poly), debout ; `null` si son modèle n'est pas chargé. */
export function standingRider(look: AvatarLook): StandingRider | null {
  const avatar = createAvatar(look);
  avatar.setShadows(false);
  avatar.update(0.016, 0, 0, 'seated');
  return avatar instanceof LowPolyRider ? standPoly(avatar, look) : standGltf(avatar);
}
