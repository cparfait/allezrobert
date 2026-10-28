import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeOfLook, type AvatarLook } from '@allezrobert/shared';
import type { RiderAvatarLike, RiderPose } from './gltfAvatar.ts';

/**
 * Cycliste et vélo du style jeu vidéo (low poly, voir engine/style.ts), construits de zéro en prismes
 * à facettes et aplats de couleur : aucun modèle téléchargé, quelques centaines de triangles.
 * Repère local : +z = avant, +y = haut, +x = gauche ; le sol est à y = 0 sous les roues.
 * Pédalage procédural : la manivelle tourne à la cadence réelle, pieds verrouillés sur les pédales,
 * jambes et bras par cinématique inverse à deux os. Positions : assis, danseuse, roue libre.
 */

const WHEEL_R = 0.335;
const BB = new THREE.Vector3(0, 0.28, 0);
const CRANK = 0.1725;
const REAR_AXLE = new THREE.Vector3(0, WHEEL_R, -0.41);
const FRONT_AXLE = new THREE.Vector3(0, WHEEL_R, 0.6);
const SADDLE = new THREE.Vector3(0, 0.95, -0.2);
const HOODS = new THREE.Vector3(0.2, 0.9, 0.6);
const THIGH = 0.46;
const SHIN = 0.47;
const UPPER_ARM = 0.3;
const FOREARM = 0.29;
/** Part de l'inclinaison physique appliquée en virage, et plafond (rad). */
const BANK_SHARE = 0.55;
const MAX_BANK = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const LEFT = new THREE.Vector3(1, 0, 0);

/** Matériau à facettes (normales de face), mat. */
function flat(color: THREE.ColorRepresentation, roughness = 0.75, metalness = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
  m.flatShading = true;
  return m;
}

/** Prisme à `sides` pans de y = −0,5 à 0,5, rayon `bottom` en bas et `top` en haut. */
function prism(bottom: number, top: number, sides = 6): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(top, bottom, 1, sides, 1);
}

/**
 * Segment orienté entre deux points (membre, tube) : l'axe y du prisme suit a → b, l'axe x reste du
 * côté gauche du coureur (face avant du torse vers l'avant), l'épaisseur se règle par `sx` / `sz`.
 */
class Seg {
  readonly mesh: THREE.Mesh;
  private readonly d = new THREE.Vector3();
  private readonly x = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly sx = 1,
    private readonly sz = 1,
  ) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    this.d.subVectors(b, a);
    const len = Math.max(this.d.length(), 1e-3);
    this.d.divideScalar(len);
    this.x.copy(LEFT).addScaledVector(this.d, -LEFT.dot(this.d));
    if (this.x.lengthSq() < 1e-6) this.x.set(0, 0, 1);
    this.x.normalize();
    this.z.crossVectors(this.x, this.d);
    this.m.makeBasis(this.x, this.d, this.z);
    this.mesh.quaternion.setFromRotationMatrix(this.m);
    this.mesh.position.addVectors(a, b).multiplyScalar(0.5);
    this.mesh.scale.set(this.sx, len, this.sz);
  }
}

/** Cinématique inverse à deux os dans le plan donné par le vecteur `pole` (genou, coude). */
function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(target, root);
  const d = Math.min(Math.max(dir.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  dir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const bend = new THREE.Vector3().copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
}

/** Tube fixe du vélo (géométrie transformée, à fusionner). */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, rEnd = r, sides = 6): THREE.BufferGeometry {
  const s = new Seg(prism(r, rEnd, sides), new THREE.MeshBasicMaterial());
  s.set(a, b);
  s.mesh.updateMatrix();
  return (s.mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(s.mesh.matrix);
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function merged(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const g = mergeGeometries(
    parts.map((p) => {
      const n = p.index ? p.toNonIndexed() : p;
      for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
      return n;
    }),
    false,
  ) as THREE.BufferGeometry;
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Couleur dominante du cadre (vélo du catalogue ou vélo de base). */
function frameColor(look: AvatarLook): string {
  return bikeOfLook(look).livery.colors[0] ?? look.bike;
}
function accentColor(look: AvatarLook): string {
  return bikeOfLook(look).livery.colors[1] ?? '#1c1d22';
}

/** Casque à facettes : calotte allongée à fond plat, coque à la couleur du casque. */
function helmetGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.145, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * 0.95, Math.max(y, -0.01) * 0.82, p.getZ(i) * 1.22 - (y > 0 ? 0 : 0.01));
  }
  g.computeVertexNormals();
  return g;
}

export class LowPolyRider implements RiderAvatarLike {
  readonly root = new THREE.Group();
  readonly label: THREE.Sprite | null = null;
  /** Groupe incliné (virages, danseuse) : vélo et coureur. */
  private readonly lean = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly crank = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly pedals: THREE.Mesh[] = [];
  private readonly legs: Array<{ side: number; thigh: Seg; shin: Seg; sock: Seg; shoe: THREE.Mesh }> = [];
  private readonly arms: Array<{ side: number; upper: Seg; fore: Seg; glove: THREE.Mesh }> = [];
  private readonly torso: Seg;
  private readonly stripe: Seg;
  private readonly pelvis: Seg;
  private readonly neck: Seg;
  private readonly head = new THREE.Group();
  private readonly helmet = new THREE.Group();
  private readonly beard: THREE.Mesh;
  private readonly mats: Record<'jersey' | 'accent' | 'shorts' | 'skin' | 'sock' | 'shoe' | 'glove' | 'helmet' | 'vent' | 'glasses' | 'hair' | 'frame' | 'frameAccent' | 'dark' | 'tire' | 'rim' | 'metal', THREE.MeshStandardNodeMaterial>;
  private crankAngle = Math.random() * Math.PI * 2;
  private wheelAngle = 0;
  private poseBlend = 0;
  private coastBlend = 0;
  private celebrate = 0;
  private celebrating = false;
  private shadows = true;
  // Points de l'image courante (réutilisés).
  private readonly hip = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();

  constructor(look: AvatarLook) {
    this.mats = {
      jersey: flat(look.jersey),
      accent: flat(look.jerseyAccent),
      shorts: flat(look.legs === 'long' ? '#1a1c22' : '#17191e', 0.7),
      skin: flat(look.skin, 0.8),
      sock: flat(look.socks ?? '#f2f2f0'),
      shoe: flat(look.shoes ?? '#f4f4f2', 0.5),
      glove: flat(look.gloveColor ?? '#1c1d22'),
      helmet: flat(look.helmet, 0.45),
      vent: flat('#1d1f24'),
      glasses: flat('#15171b', 0.3, 0.3),
      hair: flat(look.hair, 0.9),
      frame: flat(frameColor(look), 0.4, 0.1),
      frameAccent: flat(accentColor(look), 0.4, 0.1),
      dark: flat('#1a1b1f', 0.6),
      tire: flat('#151517', 0.9),
      rim: flat('#26292e', 0.4, 0.3),
      metal: flat('#b9bcc2', 0.35, 0.6),
    };
    this.root.add(this.lean);
    this.lean.add(this.buildBike(), this.body);
    const m = this.mats;
    const build = 0.9 + look.build * 0.3;

    for (const side of [1, -1]) {
      const thigh = new Seg(prism(0.068, 0.085, 6), m.shorts, build, build);
      const shin = new Seg(prism(0.04, 0.058, 6), look.legs === 'long' ? m.shorts : m.skin, build, build);
      const sock = new Seg(prism(0.042, 0.046, 6), m.sock);
      const shoe = new THREE.Mesh(box(0.085, 0.07, 0.26, 0, 0, 0.02), m.shoe);
      shoe.castShadow = true;
      this.body.add(thigh.mesh, shin.mesh, sock.mesh, shoe);
      this.legs.push({ side, thigh, shin, sock, shoe });
      const upper = new Seg(prism(0.045, 0.055, 6), m.jersey, build, build);
      const fore = new Seg(prism(0.034, 0.042, 6), m.skin, build, build);
      const glove = new THREE.Mesh(box(0.07, 0.06, 0.09), look.gloves === 'none' ? m.skin : m.glove);
      glove.castShadow = true;
      this.body.add(upper.mesh, fore.mesh, glove);
      this.arms.push({ side, upper, fore, glove });
    }
    // Torse : prisme hexagonal évasé (épaules larges, taille fine), aplati d'avant en arrière.
    this.torso = new Seg(prism(0.13, 0.175, 6), m.jersey, 1.15 * build, 0.72 * build);
    this.stripe = new Seg(prism(0.165, 0.172, 6), m.accent, 1.16 * build, 0.74 * build);
    this.pelvis = new Seg(prism(0.12, 0.12, 6), m.shorts, 1.15 * build, 0.85 * build);
    this.neck = new Seg(prism(0.045, 0.045, 6), m.skin);
    this.body.add(this.torso.mesh, this.stripe.mesh, this.pelvis.mesh, this.neck.mesh);

    // Tête : icosaèdre à facettes (un peu grosse : lisible de loin), nez, oreilles, lunettes, barbe.
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1).scale(0.92, 1.05, 1), m.skin);
    const nose = new THREE.Mesh(box(0.03, 0.04, 0.04, 0, -0.01, 0.11), m.skin);
    const ears = merged([box(0.03, 0.05, 0.04, 0.102, -0.005, -0.005), box(0.03, 0.05, 0.04, -0.102, -0.005, -0.005)], m.skin);
    const glasses = merged([box(0.2, 0.045, 0.02, 0, 0.022, 0.1), box(0.01, 0.015, 0.12, 0.098, 0.03, 0.04), box(0.01, 0.015, 0.12, -0.098, 0.03, 0.04)], m.glasses);
    this.beard = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1).scale(0.95, 0.6, 0.9).translate(0, -0.06, 0.025), m.hair);
    this.beard.visible = (look.beard ?? 0) > 0.25;
    const hair = new THREE.Mesh(box(0.19, 0.09, 0.08, 0, -0.01, -0.085), m.hair);
    // Casque : coque, aérations sombres sur le dessus, sangles.
    const shell = new THREE.Mesh(helmetGeometry(), m.helmet);
    shell.position.set(0, 0.045, -0.01);
    const vents = merged([-0.06, -0.02, 0.02, 0.06].map((x) => box(0.022, 0.03, 0.17, x, 0.155, -0.01)), m.vent);
    const straps = merged([box(0.008, 0.11, 0.02, 0.095, -0.03, 0.02), box(0.008, 0.11, 0.02, -0.095, -0.03, 0.02)], m.vent);
    this.helmet.add(shell, vents, straps);
    for (const o of [skull, nose, ears, glasses, this.beard, hair, shell]) o.castShadow = true;
    this.head.add(skull, nose, ears, glasses, this.beard, hair, this.helmet);
    this.body.add(this.head);
    this.update(0, 0, 0, 'seated');
  }

  private buildBike(): THREE.Group {
    const g = new THREE.Group();
    const m = this.mats;
    const seatTop = new THREE.Vector3(0, 0.8, -0.15);
    const headTop = new THREE.Vector3(0, 0.84, 0.44);
    const headBottom = new THREE.Vector3(0, 0.66, 0.49);
    const frame: THREE.BufferGeometry[] = [
      tube(BB, seatTop, 0.02),
      tube(seatTop, headTop, 0.019),
      tube(BB, headBottom, 0.028, 0.024),
      tube(headBottom, headTop, 0.026),
    ];
    for (const s of [1, -1]) {
      const axle = REAR_AXLE.clone().setX(0.06 * s);
      frame.push(tube(BB.clone().setX(0.03 * s), axle, 0.012, 0.01, 5));
      frame.push(tube(seatTop.clone().setX(0.015 * s).setY(0.76), axle, 0.011, 0.009, 5));
      frame.push(tube(headBottom.clone().setX(0.022 * s), FRONT_AXLE.clone().setX(0.05 * s), 0.016, 0.011, 5));
    }
    g.add(merged(frame, m.frame));
    // Bande de couleur sur le tube diagonal et la douille (seconde couleur de la livrée).
    g.add(merged([tube(BB.clone().lerp(headBottom, 0.35), BB.clone().lerp(headBottom, 0.75), 0.03, 0.03), tube(headBottom.clone().lerp(headTop, 0.2), headBottom.clone().lerp(headTop, 0.8), 0.029)], m.frameAccent));
    // Tige de selle, selle (bec effilé), potence, cintre route avec cocottes et drops.
    const stemEnd = new THREE.Vector3(0, 0.89, 0.55);
    const saddle = box(0.14, 0.045, 0.27, SADDLE.x, SADDLE.y, SADDLE.z);
    const sp = saddle.getAttribute('position');
    for (let i = 0; i < sp.count; i++) if (sp.getZ(i) > SADDLE.z) sp.setX(i, sp.getX(i) * 0.35);
    const dark = [tube(seatTop, SADDLE.clone().setY(SADDLE.y - 0.03), 0.014), saddle, tube(headTop, stemEnd, 0.018), tube(new THREE.Vector3(0.21, 0.89, 0.55), new THREE.Vector3(-0.21, 0.89, 0.55), 0.014)];
    for (const s of [1, -1]) {
      dark.push(tube(new THREE.Vector3(0.2 * s, 0.89, 0.55), new THREE.Vector3(0.2 * s, 0.87, 0.64), 0.015));
      dark.push(tube(new THREE.Vector3(0.2 * s, 0.87, 0.64), new THREE.Vector3(0.2 * s, 0.75, 0.62), 0.014));
      dark.push(tube(new THREE.Vector3(0.2 * s, 0.75, 0.62), new THREE.Vector3(0.2 * s, 0.74, 0.52), 0.014));
      dark.push(box(0.035, 0.065, 0.075, 0.2 * s, 0.915, HOODS.z + 0.03));
    }
    g.add(merged(dark, m.dark));
    // Roues : pneu à 20 pans, jante haute, moyeu, 10 rayons.
    for (const axle of [REAR_AXLE, FRONT_AXLE]) {
      const w = new THREE.Group();
      w.position.copy(axle);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.015, 0.016, 4, 20).rotateY(Math.PI / 2), m.tire);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.05, 0.022, 3, 20).rotateY(Math.PI / 2).scale(0.6, 1, 1), m.rim);
      const spokes: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.028, 0.028, 0.1, 6).rotateZ(Math.PI / 2)];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        spokes.push(tube(new THREE.Vector3((k % 2 ? 1 : -1) * 0.03, 0, 0), new THREE.Vector3(0, Math.sin(a) * (WHEEL_R - 0.06), Math.cos(a) * (WHEEL_R - 0.06)), 0.003, 0.003, 3));
      }
      for (const o of [tire, rim]) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      w.add(tire, rim, merged(spokes, m.metal));
      this.wheels.push(w);
      g.add(w);
    }
    // Pédalier : plateau à 14 pans, manivelles ; pédales mobiles (suivent le pied).
    this.crank.position.copy(BB);
    const ring = new THREE.CylinderGeometry(0.105, 0.105, 0.008, 14).rotateZ(Math.PI / 2).translate(-0.045, 0, 0);
    this.crank.add(merged([ring], m.metal), merged([box(0.014, CRANK, 0.026, 0.075, -CRANK / 2, 0), box(0.014, CRANK, 0.026, -0.075, CRANK / 2, 0)], m.dark));
    g.add(this.crank);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(box(0.075, 0.016, 0.09), m.dark);
      this.pedals.push(p);
      g.add(p);
    }
    return g;
  }

  update(dt: number, cadence: number, speed: number, pose: RiderPose, bank = 0): void {
    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.wheelAngle += (speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    const k = 1 - Math.exp(-dt * 4);
    this.poseBlend += ((pose === 'standing' ? 1 : 0) - this.poseBlend) * k;
    this.coastBlend += ((pose === 'coasting' || cadence < 5 ? 1 : 0) - this.coastBlend) * k;
    this.celebrate += ((this.celebrating ? 1 : 0) - this.celebrate) * k;
    if (this.coastBlend > 0.5 && cadence < 5) {
      // Roue libre : manivelles ramenées à l'horizontale.
      const target = Math.round((this.crankAngle - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crankAngle += (target - this.crankAngle) * k * 0.5;
    }
    this.crank.rotation.x = this.crankAngle;
    const stand = this.poseBlend;
    // Virages : inclinaison adoucie et plafonnée (≈ 17°) ; l'angle physique, tout entier, couchait le vélo.
    const tilt = Math.max(-MAX_BANK, Math.min(MAX_BANK, bank * BANK_SHARE));
    // Balancement au rythme des coups de pédale : à peine perceptible assis (≈ 0,7°), marqué en danseuse.
    const pedaling = 1 - this.coastBlend;
    this.lean.rotation.z = tilt + Math.sin(this.crankAngle) * (0.012 * pedaling * (1 - stand) + 0.13 * stand);

    const hip = this.hip.set(0, SADDLE.y + 0.07 + 0.13 * stand, SADDLE.z + 0.02 + 0.2 * stand);
    hip.y += Math.sin(this.crankAngle * 2) * 0.01 * (1 - stand);
    const up = this.celebrate;
    const shoulder = this.shoulder.set(0, 1.38 + 0.08 * stand + 0.14 * up, 0.24 + 0.08 * stand - 0.22 * up);
    shoulder.y -= this.coastBlend * 0.03;
    const chestBase = hip.clone().add(new THREE.Vector3(0, 0.06, 0.02));
    this.torso.set(chestBase, shoulder);
    this.stripe.set(chestBase.clone().lerp(shoulder, 0.55), chestBase.clone().lerp(shoulder, 0.68));
    this.pelvis.set(hip.clone().add(new THREE.Vector3(0, -0.06, -0.02)), chestBase);
    const neckTop = shoulder.clone().add(new THREE.Vector3(0, 0.1, 0.07));
    this.neck.set(shoulder.clone().add(new THREE.Vector3(0, 0.02, 0.02)), neckTop);
    this.head.position.copy(neckTop).add(new THREE.Vector3(0, 0.08, 0.03));
    // Tête relevée pour regarder la route (le dos est penché vers l'avant).
    this.head.rotation.x = 0.3 - 0.12 * stand - 0.25 * up;

    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedal = new THREE.Vector3(0.11 * leg.side, BB.y - Math.cos(a) * CRANK, BB.z - Math.sin(a) * CRANK);
      (this.pedals[leg.side > 0 ? 0 : 1] as THREE.Mesh).position.copy(pedal);
      const ankle = pedal.clone().add(new THREE.Vector3(0, 0.065, -0.05));
      const hipJ = hip.clone().setX(0.095 * leg.side);
      const knee = new THREE.Vector3();
      solveTwoBone(hipJ, ankle, THIGH, SHIN, new THREE.Vector3(0.05 * leg.side, 0.2, 1), knee);
      leg.thigh.set(hipJ, knee);
      leg.shin.set(knee, ankle);
      leg.sock.set(ankle.clone().add(new THREE.Vector3(0, 0.11, 0.015)), ankle);
      leg.shoe.position.copy(pedal).add(new THREE.Vector3(0, 0.038, 0.02));
      leg.shoe.rotation.x = 0.15 + Math.sin(a) * 0.12;
    }
    for (const arm of this.arms) {
      const sh = shoulder.clone().add(new THREE.Vector3(0.19 * arm.side, -0.035, 0));
      // Mains sur les cocottes ; bras levés en V pour fêter la victoire.
      const handBar = new THREE.Vector3(HOODS.x * arm.side, HOODS.y + 0.02, HOODS.z + 0.03);
      const handUp = sh.clone().add(new THREE.Vector3(0.2 * arm.side, 0.52, 0.08));
      const hand = handBar.lerp(handUp, up);
      const elbow = new THREE.Vector3();
      solveTwoBone(sh, hand, UPPER_ARM, FOREARM, new THREE.Vector3(0.6 * arm.side, -0.6 + up, -0.4), elbow);
      arm.upper.set(sh, elbow);
      arm.fore.set(elbow, hand);
      arm.glove.position.copy(hand);
      arm.glove.quaternion.copy(arm.fore.mesh.quaternion);
    }
  }

  setLook(look: AvatarLook): void {
    const m = this.mats;
    m.jersey.color.set(look.jersey);
    m.accent.color.set(look.jerseyAccent);
    m.skin.color.set(look.skin);
    m.helmet.color.set(look.helmet);
    m.hair.color.set(look.hair);
    m.frame.color.set(frameColor(look));
    m.frameAccent.color.set(accentColor(look));
    m.sock.color.set(look.socks ?? '#f2f2f0');
    m.shoe.color.set(look.shoes ?? '#f4f4f2');
    m.glove.color.set(look.gloveColor ?? '#1c1d22');
    this.beard.visible = (look.beard ?? 0) > 0.25;
  }

  setCelebrating(on: boolean): void {
    this.celebrating = on;
  }

  setBareHead(on: boolean): void {
    this.helmet.visible = !on;
  }

  setHeadVisible(on: boolean): void {
    this.head.visible = on;
  }

  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.root.traverse((o) => (o.castShadow = on));
  }

  eyeWorld(out: THREE.Vector3, hands?: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    out.set(0, 0.03, 0.09).applyMatrix4(this.head.matrixWorld);
    if (hands) hands.set(0, HOODS.y, HOODS.z).applyMatrix4(this.lean.matrixWorld);
    return out;
  }
}
