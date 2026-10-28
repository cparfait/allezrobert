import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeOfLook, lookSex, type AvatarLook, type BikeBuild, type WheelType } from '@allezrobert/shared';
import type { RiderAvatarLike, RiderPose } from './gltfAvatar.ts';
import { SweptBody, makeJoints, type BodyLook } from './sweptBody.ts';

/**
 * Cycliste et vélo du style jeu vidéo (low poly, voir engine/style.ts), construits de zéro en prismes
 * à facettes et aplats de couleur : aucun modèle téléchargé, un millier de triangles environ.
 * Suit la tenue du garage : vélo (route, aéro, chrono, rétro, gravel, VTT), roues (basses, 35, 50, 65,
 * lenticulaire, trois bâtons), bidons et compteur, casque (route, aéro des vélos de chrono) ou
 * casquette, coiffure, barbe et moustache, coureuse, maillot (bande, bandes de champion, manches,
 * moitié), manches longues, cuissard long, chaussettes hautes, gants.
 * Repère local : +z = avant, +y = haut, +x = gauche ; le sol est à y = 0 sous les roues.
 * Pédalage procédural : la manivelle tourne à la cadence réelle, pieds verrouillés sur les pédales,
 * jambes et bras par cinématique inverse à deux os. Positions : assis, danseuse, roue libre.
 */

const WHEEL_R = 0.335;
const BB = new THREE.Vector3(0, 0.28, 0);
const CRANK = 0.1725;
const REAR_AXLE = new THREE.Vector3(0, WHEEL_R, -0.41);
const FRONT_AXLE = new THREE.Vector3(0, WHEEL_R, 0.6);
const SADDLE = new THREE.Vector3(0, 0.965, -0.2);
const THIGH = 0.46;
const SHIN = 0.47;
const UPPER_ARM = 0.3;
/** Coude → creux de la main (prise du cintre), pas seulement jusqu'au poignet. */
const FOREARM = 0.31;
/** Part de l'inclinaison physique appliquée en virage, et plafond (rad). */
const BANK_SHARE = 0.55;
const MAX_BANK = 0.3;
const LEFT = new THREE.Vector3(1, 0, 0);
/** Corps d'un seul tenant en tubes à section musculaire (sweptBody.ts) ; ?corps=prismes : anciens prismes séparés. */
const TUBES_DEFAULT = (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('corps')) !== 'prismes';

type BikeKind = 'road' | 'aero' | 'tt' | 'retro' | 'gravel' | 'mtb';
type BarKind = 'drop' | 'flat' | 'tt';

/** Position du coureur selon le vélo : mains (côté gauche, x > 0), décalage des épaules, regard. */
interface Fit {
  bar: BarKind;
  hand: THREE.Vector3;
  shoulderDy: number;
  shoulderDz: number;
  /** Coudes : vers l'extérieur (route) ou posés sur les manchons (chrono). */
  elbowPole: THREE.Vector3;
  headTilt: number;
}

const FITS: Record<BarKind, Fit> = {
  drop: { bar: 'drop', hand: new THREE.Vector3(0.2, 0.92, 0.63), shoulderDy: -0.03, shoulderDz: 0.03, elbowPole: new THREE.Vector3(0.3, -0.75, -0.45), headTilt: 0 },
  flat: { bar: 'flat', hand: new THREE.Vector3(0.31, 0.96, 0.5), shoulderDy: 0.06, shoulderDz: -0.08, elbowPole: new THREE.Vector3(0.8, -0.4, -0.3), headTilt: -0.08 },
  tt: { bar: 'tt', hand: new THREE.Vector3(0.075, 0.95, 0.76), shoulderDy: -0.13, shoulderDz: 0.1, elbowPole: new THREE.Vector3(0.1, -1, 0), headTilt: 0.18 },
};

function bikeKind(look: AvatarLook, build: BikeBuild): BikeKind {
  if (look.bikeType === 'mtb') return 'mtb';
  if (look.bikeType === 'gravel') return 'gravel';
  switch (build.family) {
    case 'aero':
      return 'aero';
    case 'tt':
    case 'lowpro':
    case 'espada':
    case 'lotus':
      return 'tt';
    case 'retro':
    case 'retro_compact':
    case 'steel':
      return 'retro';
    default:
      return 'road';
  }
}

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

/** Section carrée (faces devant, derrière et sur les côtés) : membres anguleux, lisibles de loin. */
function quad(bottom: number, top: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(top, bottom, 1, 4, 1).rotateY(Math.PI / 4);
}

/** Prisme à 8 pans tourné d'un demi-pan : faces planes devant, derrière et sur les côtés (torse, cuisses). */
function octo(bottom: number, top: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(top, bottom, 1, 8, 1).rotateY(Math.PI / 8);
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

const _tubeMat = new THREE.MeshBasicMaterial();
/** Tube fixe (géométrie transformée, à fusionner) ; `sx` / `sz` : profil (aéro : étroit et profond). */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, rEnd = r, sides = 6, sx = 1, sz = 1): THREE.BufferGeometry {
  const s = new Seg(prism(r, rEnd, sides), _tubeMat, sx, sz);
  s.set(a, b);
  s.mesh.updateMatrix();
  return (s.mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(s.mesh.matrix);
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

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

/** Hauteur de jante (m) par type de roue. */
const RIM_DEPTH: Record<WheelType, number> = { box: 0.02, c35: 0.035, c50: 0.05, c65: 0.065, disc: 0.05, tri: 0.05 };

/** Calotte à facettes à fond plat (casque, casquette). */
function dome(r: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * sx, Math.max(p.getY(i), -0.01) * sy, p.getZ(i) * sz);
  return g;
}

/**
 * Coque qui épouse la tête (casque, cheveux) : calotte ovale dont le bord descend plus ou moins selon la
 * direction — angle depuis le sommet (rad) devant, sur les côtés et derrière. `tail` allonge l'arrière
 * (casque profilé). Géométrie indexée, faces tournées vers l'extérieur.
 */
function headShell(rx: number, ry: number, rz: number, front: number, side: number, back: number, tail = 0, segs = 24, rows = 8): THREE.BufferGeometry {
  const pos: number[] = [0, ry, 0];
  const index: number[] = [];
  for (let r = 1; r <= rows; r++)
    for (let j = 0; j < segs; j++) {
      const phi = (j / segs) * Math.PI * 2;
      const dx = Math.sin(phi);
      const dz = Math.cos(phi);
      const rim = dz >= 0 ? side + (front - side) * dz : side + (back - side) * -dz;
      const th = (rim * r) / rows;
      const sn = Math.sin(th);
      pos.push(rx * sn * dx, ry * Math.cos(th), rz * sn * dz * (1 + tail * Math.max(0, -dz) * sn));
    }
  const at = (r: number, j: number) => (r === 0 ? 0 : 1 + (r - 1) * segs + (j % segs));
  for (let j = 0; j < segs; j++) index.push(0, at(1, j), at(1, j + 1));
  for (let r = 2; r <= rows; r++)
    for (let j = 0; j < segs; j++) index.push(at(r - 1, j), at(r, j), at(r, j + 1), at(r - 1, j), at(r, j + 1), at(r - 1, j + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** Part du torse (0 = taille, 1 = épaules) couverte par chaque bande du maillot. */
interface Band {
  seg: Seg;
  from: number;
  to: number;
}

export class LowPolyRider implements RiderAvatarLike {
  readonly root = new THREE.Group();
  readonly label: THREE.Sprite | null = null;
  /** Groupe incliné (virages, danseuse) : vélo et coureur. */
  private readonly lean = new THREE.Group();
  private body = new THREE.Group();
  private crank = new THREE.Group();
  private wheels: THREE.Group[] = [];
  /** Écran du compteur (canevas rafraîchi par setComputer, 4 fois par seconde au plus). */
  private screen: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; t: number } | null = null;
  private pedals: THREE.Mesh[] = [];
  private legs: Array<{ side: number; shorts: Seg; knee: Seg; shin: Seg; sock: Seg; shoe: THREE.Mesh }> = [];
  private arms: Array<{ side: number; sleeve: Seg; cuff: Seg; upper: Seg; fore: Seg; glove: THREE.Mesh }> = [];
  private torso!: Seg;
  private bands: Band[] = [];
  private collar!: Seg;
  private pelvis!: Seg;
  private neck!: Seg;
  private head = new THREE.Group();
  private headgear = new THREE.Group();
  private fit: Fit = FITS.drop;
  private sockLen = 0.11;
  private longSleeves = false;
  private lookKey = '';
  private crankAngle = Math.random() * Math.PI * 2;
  private wheelAngle = 0;
  private poseBlend = 0;
  private coastBlend = 0;
  /** Mains en bas du cintre (vitesse de course) et position aéro (descente rapide, très haute vitesse). */
  private dropsBlend = 0;
  private aeroBlend = 0;
  private dropsOn = false;
  private celebrate = 0;
  private celebrating = false;
  private shadows = true;
  private bareHead = false;
  // Points de l'image courante (réutilisés).
  private readonly hip = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();

  /** Corps en tubes d'un seul tenant (sweptBody.ts) au lieu des prismes séparés. */
  private readonly tubes: boolean;
  private swept: SweptBody | null = null;
  /** Articulations de l'image (remplies par update, lues par le corps en tubes). */
  private readonly J = makeJoints();

  constructor(look: AvatarLook, opts: { tubes?: boolean } = {}) {
    this.tubes = opts.tubes ?? TUBES_DEFAULT;
    this.root.add(this.lean);
    this.build(look);
  }

  /** (Re)construit vélo et coureur pour la tenue (changement au garage : tout est refait, c'est léger). */
  private build(look: AvatarLook): void {
    this.lookKey = JSON.stringify(look);
    for (const c of [...this.lean.children]) {
      this.lean.remove(c);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
    this.body = new THREE.Group();
    this.crank = new THREE.Group();
    this.wheels = [];
    this.pedals = [];
    this.legs = [];
    this.arms = [];
    this.bands = [];
    this.head = new THREE.Group();
    this.headgear = new THREE.Group();

    const bike = bikeOfLook(look);
    const kind = bikeKind(look, bike);
    this.fit = FITS[kind === 'mtb' ? 'flat' : kind === 'tt' ? 'tt' : 'drop'];
    this.lean.add(this.buildBike(look, bike, kind), this.body);
    this.buildRider(look, bike);
    this.headgear.visible = !this.bareHead;
    this.swept = null;
    this.update(0, 0, 0, 'seated');
    if (this.tubes) this.buildTubes(look);
    if (!this.shadows) this.root.traverse((o) => (o.castShadow = false));
  }

  /**
   * Corps en tubes, construit sur les articulations de la pose de repos ; les prismes du torse et des membres
   * restent calculés mais masqués (tête, cou, chaussures et gants sont communs aux deux corps).
   */
  private buildTubes(look: AvatarLook): void {
    const female = lookSex(look) === 'female';
    const c = (v: string) => new THREE.Color(v);
    const style = look.jerseyStyle;
    const bands: BodyLook['bands'] = [];
    if (style === 'bandes' && look.jerseyBands?.length) {
      const n = Math.min(look.jerseyBands.length, 5);
      const h = 0.6 / n;
      look.jerseyBands.slice(0, n).forEach((col, i) => bands.push({ from: 0.85 - (i + 1) * h, to: 0.85 - i * h, color: c(col) }));
    } else if (style !== 'uni' && style !== 'manches' && style !== 'moitie') bands.push({ from: 0.42, to: 0.6, color: c(look.jerseyAccent) });
    this.swept = new SweptBody(this.J, {
      jersey: c(look.jersey),
      accent: c(look.jerseyAccent),
      shorts: c('#17191e'),
      skin: c(look.skin),
      sock: c(look.socks ?? '#f2f2f0'),
      bands,
      lowerHalf: style === 'moitie',
      accentSleeves: style === 'manches',
      longLegs: look.legs === 'long',
      longSleeves: look.sleeves === 'long',
      sockLen: this.sockLen,
      build: (female ? 0.86 : 0.92) + look.build * 0.3,
      female,
    });
    this.body.add(this.swept.mesh);
    for (const sg of [this.torso, this.collar, this.pelvis, ...this.bands.map((b) => b.seg)]) sg.mesh.visible = false;
    for (const l of this.legs) for (const sg of [l.shorts, l.knee, l.shin, l.sock]) sg.mesh.visible = false;
    for (const a of this.arms) for (const sg of [a.sleeve, a.cuff, a.upper, a.fore]) sg.mesh.visible = false;
  }

  private buildRider(look: AvatarLook, bike: BikeBuild): void {
    const female = lookSex(look) === 'female';
    const build = (female ? 0.86 : 0.92) + look.build * 0.3;
    const jersey = flat(look.jersey);
    const accent = flat(look.jerseyAccent);
    const shorts = flat('#17191e', 0.7);
    const skin = flat(look.skin, 0.8);
    const sock = flat(look.socks ?? '#f2f2f0');
    const shoe = flat(look.shoes ?? '#f4f4f2', 0.5);
    const glove = flat(look.gloveColor ?? '#1c1d22');
    const hair = flat(look.hair, 0.9);
    const longLegs = look.legs === 'long';
    this.longSleeves = look.sleeves === 'long';
    this.sockLen = look.sockHeight === 'high' ? 0.2 : 0.1;
    const style = look.jerseyStyle;

    for (const side of [1, -1]) {
      // Cuisse : cuissard jusqu'au-dessus du genou, puis peau (ou cuissard long jusqu'à la cheville).
      const thighShorts = new Seg(octo(0.056, 0.07), shorts, build, build);
      const knee = new Seg(prism(0.05, 0.056, 6), longLegs ? shorts : skin, build, build);
      const shin = new Seg(quad(0.045, 0.064), longLegs ? shorts : skin, build, build);
      const sk = new Seg(prism(0.042, 0.047, 6), sock);
      const sh = new THREE.Mesh(box(0.085, 0.07, 0.26, 0, 0, 0.02), shoe);
      sh.castShadow = true;
      this.body.add(thighShorts.mesh, knee.mesh, shin.mesh, sk.mesh, sh);
      this.legs.push({ side, shorts: thighShorts, knee, shin, sock: sk, shoe: sh });
      // Bras : manche courte et son poignet de couleur (comme une bande de manche), puis peau, gant.
      const sleeveMat = style === 'manches' ? accent : jersey;
      const sleeve = new Seg(octo(0.052, 0.062), sleeveMat, build, build);
      const cuff = new Seg(prism(0.054, 0.054, 8), style === 'manches' ? jersey : accent, build, build);
      const upper = new Seg(quad(0.046, 0.05), this.longSleeves ? sleeveMat : skin, build, build);
      const fore = new Seg(quad(0.037, 0.047), this.longSleeves ? sleeveMat : skin, build, build);
      const gl = new THREE.Mesh(box(0.07, 0.06, 0.09), look.gloves === 'none' ? skin : glove);
      gl.castShadow = true;
      this.body.add(sleeve.mesh, cuff.mesh, upper.mesh, fore.mesh, gl);
      this.arms.push({ side, sleeve, cuff, upper, fore, glove: gl });
    }
    // Torse : prisme à 8 pans évasé (épaules larges, taille plus fine), aplati d'avant en arrière.
    const shoulderR = female ? 0.148 : 0.166;
    this.torso = new Seg(octo(0.135, shoulderR), jersey, 1.12 * build, 0.72 * build);
    // Bande : même évasement que le torse, 1 cm au-dessus de sa surface (une bande droite croisait le torse
    // évasé et scintillait), et passe devant en cas d'égalité de profondeur.
    const band = (from: number, to: number, mat: THREE.Material) => {
      const at = (f: number) => 0.135 + (shoulderR - 0.135) * f + 0.01;
      const m = mat as THREE.MeshStandardNodeMaterial;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -1;
      const seg = new Seg(octo(at(from), at(to)), mat, 1.12 * build, 0.72 * build);
      this.bands.push({ seg, from, to });
      this.body.add(seg.mesh);
    };
    if (style === 'bandes' && look.jerseyBands?.length) {
      // Maillots de champion : bandes de poitrine de haut en bas.
      const n = Math.min(look.jerseyBands.length, 5);
      const h = 0.28 / n;
      look.jerseyBands.slice(0, n).forEach((c, i) => band(0.82 - (i + 1) * h, 0.82 - i * h, flat(c)));
    } else if (style === 'moitie') band(0, 0.45, accent);
    else if (style !== 'uni' && style !== 'manches') {
      // Dessin d'origine : bande de poitrine et liseré bas du maillot.
      band(0.56, 0.68, accent);
      band(0, 0.05, accent);
    }
    this.collar = new Seg(prism(0.06, 0.055, 8), accent);
    this.pelvis = new Seg(octo(0.112, 0.118), shorts, 1.02 * build, 0.82 * build);
    this.neck = new Seg(prism(0.047, 0.045, 6), skin);
    this.body.add(this.torso.mesh, this.collar.mesh, this.pelvis.mesh, this.neck.mesh);

    // Tête : icosaèdre à facettes un peu grand (lisible de loin), nez, oreilles, lunettes de sport.
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.112, 1).scale(0.92, 1.05, 1), skin);
    const face = merged([box(0.03, 0.04, 0.04, 0, -0.01, 0.112), box(0.03, 0.05, 0.04, 0.104, -0.005, -0.005), box(0.03, 0.05, 0.04, -0.104, -0.005, -0.005)], skin);
    const glasses = merged([box(0.2, 0.045, 0.02, 0, 0.022, 0.102), box(0.01, 0.015, 0.12, 0.099, 0.03, 0.04), box(0.01, 0.015, 0.12, -0.099, 0.03, 0.04)], flat('#15171b', 0.3, 0.3));
    this.head.add(skull, face, glasses);
    if (!female && (look.beard ?? 0) > 0.25) this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1).scale(0.96, 0.6, 0.9).translate(0, -0.06, 0.027), hair));
    if (!female && look.moustache) this.head.add(new THREE.Mesh(box(0.08, 0.018, 0.025, 0, -0.038, 0.104), hair));
    const hairParts = this.hairGeometry(look.hairStyle);
    // Coureuses (façon NCT) : queue de cheval qui sort sous l'arrière du casque et tombe sur la nuque, en deux
    // tronçons effilés ; attache sombre.
    if (female) {
      const knot = v3(0, -0.02, -0.122);
      const mid = v3(0, -0.13, -0.165);
      const end = v3(0, -0.25, -0.15);
      hairParts.push(tube(knot, mid, 0.034, 0.03, 6), tube(mid, end, 0.03, 0.012, 6));
    }
    if (hairParts.length) this.head.add(merged(hairParts, hair));
    if (female) this.head.add(new THREE.Mesh(tube(v3(0, -0.005, -0.118), v3(0, -0.035, -0.128), 0.038, 0.038, 6), flat('#1b1c20')));
    this.buildHeadgear(look, bike);
    this.head.add(this.headgear);
    this.head.traverse((o) => (o.castShadow = true));
    this.body.add(this.head);
  }

  /** Coiffure (AvatarLook.hairStyle, voir faceEditor.ts), sous le casque : nuque, queue, tresses, chignon… */
  private hairGeometry(style: number): THREE.BufferGeometry[] {
    const s = ((style % 12) + 12) % 12;
    if (s === 3) return [];
    // Coupe courte qui épouse le crâne : ligne de front haute, tempes au-dessus des oreilles, nuque dégagée
    // (style 4 : plus court derrière). Les autres styles ajoutent queue, tresses, chignon ou carré par-dessus.
    const cap = headShell(0.109, 0.125, 0.119, 0.85, 1.72, s === 4 ? 2.0 : 2.22, 0, 20, 7).translate(0, 0.004, -0.004);
    const parts: THREE.BufferGeometry[] = [cap];
    const tail = (x: number, len: number, r: number) => tube(v3(x, -0.01, -0.11), v3(x * 1.3, -0.04 - len, -0.16 - len * 0.25), r, r * 0.7, 6);
    switch (s) {
      case 1:
        parts.push(tail(0, 0.13, 0.034));
        break;
      case 2:
        parts.push(tail(0, 0.24, 0.024));
        break;
      case 5:
        for (const [x, y, z] of [[0.08, -0.02, -0.06], [-0.08, -0.02, -0.06], [0.05, -0.05, -0.1], [-0.05, -0.05, -0.1], [0, -0.04, -0.115]]) parts.push(new THREE.IcosahedronGeometry(0.04, 0).translate(x as number, y as number, z as number));
        break;
      case 6:
        parts.push(box(0.235, 0.14, 0.17, 0, -0.045, -0.035));
        break;
      case 7:
        parts.push(new THREE.IcosahedronGeometry(0.052, 0).translate(0, 0, -0.14));
        break;
      case 9:
        parts.push(box(0.21, 0.26, 0.06, 0, -0.13, -0.09));
        break;
      case 10:
        parts.push(tail(0.07, 0.2, 0.022), tail(-0.07, 0.2, 0.022));
        break;
      case 11:
        parts.push(tail(0, 0.2, 0.03));
        break;
    }
    return parts;
  }

  /** Casque de route (aérations, bande de couleur), casque aéro des vélos de chrono, ou casquette. */
  private buildHeadgear(look: AvatarLook, bike: BikeBuild): void {
    const g = this.headgear;
    const shellMat = flat(look.helmet, 0.45);
    const dark = flat('#1d1f24');
    if (look.cap) {
      const cap = look.cap;
      // Calotte qui enveloppe la coupe de cheveux (sinon les cheveux la traversent), bord au-dessus des
      // lunettes devant, cheveux visibles sur la nuque.
      const capMat = new THREE.MeshStandardNodeMaterial({ color: cap.color, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
      capMat.flatShading = true;
      g.add(new THREE.Mesh(headShell(0.119, 0.14, 0.13, 1.22, 1.55, 1.75, 0, 20, 6).translate(0, 0, -0.004), capMat));
      // Visière relevée, comme les coureurs la portent.
      g.add(new THREE.Mesh(box(0.15, 0.012, 0.075, 0, 0.0, 0.035).rotateX(-0.45).translate(0, 0.05, 0.11), flat(cap.accent ?? cap.colors?.[1] ?? cap.color)));
      return;
    }
    if (bike.params.aeroHelmet) {
      // Casque de chrono : goutte d'eau allongée vers l'arrière, visière sombre.
      const shell = new THREE.IcosahedronGeometry(0.14, 1);
      const p = shell.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const back = z < 0 ? -z * 1.4 : 0;
        p.setXYZ(i, p.getX(i) * (1 - back * 1.6) * 0.95, Math.max(p.getY(i), -0.02) * 0.85 + back * 0.25, z * 1.25 - back * 0.9);
      }
      g.add(new THREE.Mesh(shell.translate(0, 0.04, -0.02), shellMat));
      g.add(new THREE.Mesh(box(0.21, 0.07, 0.02, 0, 0.0, 0.135), flat('#20242c', 0.15, 0.4)));
      g.add(merged([box(0.02, 0.03, 0.2, 0, 0.16, -0.05)], flat(look.jerseyAccent)));
      return;
    }
    // Casque de route : coque ovale profilée vers l'arrière, bord qui remonte au-dessus des lunettes et descend
    // sur la nuque ; aérations sombres creusées dans la coque (faces colorées, rien ne dépasse) et serrage
    // noir à l'arrière.
    const SEGS = 24;
    const geo = headShell(0.128, 0.12, 0.145, 1.27, 1.7, 2.05, 0.22, SEGS, 8).toNonIndexed();
    const p = geo.getAttribute('position');
    const shellC = new THREE.Color(look.helmet);
    const ventC = new THREE.Color('#202329');
    // Bandes décoratives à la couleur d'accent du maillot, le long des aérations (casques NCT).
    const stripeC = new THREE.Color(look.jerseyAccent);
    const cols: number[] = [];
    const tris = p.count / 3;
    for (let t = 0; t < tris; t++) {
      // Facette (rangée r depuis le sommet, colonne j) ; les deux triangles d'un quadrilatère ont la même couleur.
      const qi = t < SEGS ? t : Math.floor((t - SEGS) / 2);
      const r = t < SEGS ? 1 : 2 + Math.floor(qi / SEGS);
      const j = qi % SEGS;
      const dz = Math.cos(((j + 0.5) / SEGS) * Math.PI * 2);
      // Aérations en fentes qui rayonnent du sommet vers l'avant et l'arrière ; serrage noir sur la nuque.
      const vent = r >= 3 && r <= 6 && j % 3 === 1 && Math.abs(dz) > 0.3;
      const cradle = r >= 8 && dz < -0.5;
      const stripe = r >= 2 && r <= 7 && j % 3 === 2 && Math.abs(dz) > 0.2;
      const col = vent || cradle ? ventC : stripe ? stripeC : shellC;
      for (let v = 0; v < 3; v++) cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const helmetMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, side: THREE.DoubleSide });
    helmetMat.flatShading = true;
    const shell = new THREE.Mesh(geo, helmetMat);
    shell.position.set(0, 0.025, -0.012);
    g.add(shell);
    // Sangles fines en Y : une devant et une derrière l'oreille, réunies sous l'oreille, puis jusqu'au menton.
    const straps: THREE.BufferGeometry[] = [];
    for (const sx of [1, -1]) {
      const knot = v3(0.1 * sx, -0.065, 0.005);
      straps.push(tube(v3(0.112 * sx, 0.012, 0.05), knot, 0.0055, 0.0055, 4), tube(v3(0.108 * sx, -0.005, -0.07), knot, 0.0055, 0.0055, 4), tube(knot, v3(0.035 * sx, -0.125, 0.055), 0.0055, 0.0055, 4));
    }
    straps.push(box(0.04, 0.016, 0.012, 0, -0.13, 0.062));
    g.add(merged(straps, dark));
  }

  private buildBike(look: AvatarLook, bike: BikeBuild, kind: BikeKind): THREE.Group {
    const g = new THREE.Group();
    const liv = bike.livery;
    const frameMat = flat(liv.colors[0] ?? look.bike, kind === 'retro' ? 0.3 : 0.4, kind === 'retro' ? 0.3 : 0.1);
    const accentMat = flat(liv.colors[1] ?? '#1c1d22', 0.4, 0.1);
    const dark = flat('#1a1b1f', 0.6);
    const tireMat = flat(liv.tireWall ?? '#151517', 0.9);
    const rimMat = flat(liv.rim ?? '#26292e', 0.4, 0.3);
    const metal = flat('#b9bcc2', 0.35, 0.6);
    const tapeMat = liv.tape ? flat(liv.tape) : dark;

    // Géométrie du cadre selon le type : VTT à tube horizontal plongeant, rétro à tube horizontal droit.
    const mtb = kind === 'mtb';
    const aeroTubes = kind === 'aero' || kind === 'tt';
    const seatTop = mtb ? v3(0, 0.72, -0.14) : kind === 'retro' ? v3(0, 0.83, -0.155) : v3(0, 0.8, -0.15);
    const headTop = mtb ? v3(0, 0.87, 0.42) : kind === 'retro' ? v3(0, 0.83, 0.44) : kind === 'gravel' ? v3(0, 0.86, 0.44) : v3(0, 0.84, 0.44);
    const headBottom = mtb ? v3(0, 0.64, 0.47) : v3(0, 0.66, 0.49);
    const k = mtb ? 1.35 : kind === 'retro' ? 0.7 : 1;
    const sides = kind === 'retro' ? 8 : 6;
    const sx = aeroTubes ? 0.7 : 1;
    const sz = aeroTubes ? 1.8 : 1;
    const frame = [
      tube(BB, seatTop, 0.02 * k, 0.02 * k, sides, sx, sz),
      tube(seatTop, headTop, 0.019 * k, 0.019 * k, sides, sx, aeroTubes ? 1.4 : 1),
      tube(BB, headBottom, 0.028 * k, 0.024 * k, sides, sx, sz),
      tube(headBottom, headTop, 0.026 * k, 0.026 * k, sides),
    ];
    for (const s of [1, -1]) {
      const axle = REAR_AXLE.clone().setX(0.06 * s);
      frame.push(tube(BB.clone().setX(0.03 * s), axle, 0.012 * k, 0.01 * k, 5));
      frame.push(tube(seatTop.clone().setX(0.015 * s).setY(seatTop.y - 0.04), axle, 0.011 * k, 0.009 * k, 5));
      if (!mtb) frame.push(tube(headBottom.clone().setX(0.022 * s), FRONT_AXLE.clone().setX(0.05 * s), 0.016, 0.011, 5, aeroTubes ? 0.7 : 1, aeroTubes ? 1.6 : 1));
    }
    g.add(merged(frame, frameMat));
    // Seconde couleur de la livrée : bande sur le diagonal et la douille.
    g.add(merged([tube(BB.clone().lerp(headBottom, 0.35), BB.clone().lerp(headBottom, 0.75), 0.03 * k, 0.03 * k, sides, sx, sz), tube(headBottom.clone().lerp(headTop, 0.2), headBottom.clone().lerp(headTop, 0.8), 0.029 * k, 0.029 * k, sides)], accentMat));

    const parts: THREE.BufferGeometry[] = [];
    // Fourche suspendue du VTT : fourreaux épais, té, plongeurs.
    if (mtb) {
      const crown = headBottom.clone().add(v3(0, -0.03, 0.01));
      parts.push(box(0.15, 0.04, 0.06, crown.x, crown.y, crown.z));
      for (const s of [1, -1]) {
        const top = crown.clone().setX(0.065 * s);
        const mid = top.clone().lerp(FRONT_AXLE.clone().setX(0.065 * s), 0.45);
        parts.push(tube(top, mid, 0.022, 0.022, 6), tube(mid, FRONT_AXLE.clone().setX(0.06 * s), 0.016, 0.015, 6));
      }
    }
    // Tige de selle, selle à bec effilé, potence.
    const saddle = box(0.14, 0.045, 0.27, SADDLE.x, SADDLE.y, SADDLE.z);
    const sp = saddle.getAttribute('position');
    for (let i = 0; i < sp.count; i++) if (sp.getZ(i) > SADDLE.z) sp.setX(i, sp.getX(i) * 0.35);
    const fit = this.fit;
    const stemEnd = fit.bar === 'flat' ? v3(0, 0.95, 0.5) : v3(0, 0.89, 0.55);
    parts.push(tube(seatTop, SADDLE.clone().setY(SADDLE.y - 0.03), 0.014 * (mtb ? 1.4 : 1)), saddle, tube(headTop, stemEnd, 0.018));
    const bar: THREE.BufferGeometry[] = [];
    if (fit.bar === 'flat') {
      bar.push(tube(v3(0.36, 0.955, 0.5), v3(-0.36, 0.955, 0.5), 0.014, 0.014, 6));
      for (const s of [1, -1]) parts.push(tube(v3(0.28 * s, 0.955, 0.5), v3(0.36 * s, 0.955, 0.5), 0.02, 0.02, 6));
    } else if (fit.bar === 'tt') {
      // Chrono : cintre de base en cornes, prolongateurs et manchons.
      bar.push(tube(v3(0.2, 0.88, 0.56), v3(-0.2, 0.88, 0.56), 0.014));
      for (const s of [1, -1]) {
        bar.push(tube(v3(0.2 * s, 0.88, 0.56), v3(0.21 * s, 0.86, 0.66), 0.014));
        parts.push(tube(v3(0.075 * s, 0.92, 0.5), v3(0.075 * s, 0.93, 0.8), 0.011), box(0.07, 0.025, 0.11, 0.09 * s, 0.925, 0.52));
      }
    } else {
      const flare = kind === 'gravel' ? 0.04 : 0;
      bar.push(tube(v3(0.21, 0.89, 0.55), v3(-0.21, 0.89, 0.55), 0.014));
      for (const s of [1, -1]) {
        bar.push(tube(v3(0.2 * s, 0.89, 0.55), v3(0.2 * s, 0.87, 0.64), 0.015));
        bar.push(tube(v3(0.2 * s, 0.87, 0.64), v3((0.2 + flare) * s, 0.75, 0.62), 0.014));
        bar.push(tube(v3((0.2 + flare) * s, 0.75, 0.62), v3((0.2 + flare) * s, 0.74, 0.52), 0.014));
        parts.push(box(0.035, 0.065, 0.075, 0.2 * s, 0.915, 0.66));
      }
    }
    g.add(merged(bar, tapeMat));
    // Compteur sur la potence.
    if (bike.params.computer !== false) {
      parts.push(box(0.05, 0.016, 0.075, 0, 0.915, 0.6));
      g.add(this.buildScreen());
    }
    g.add(merged(parts, dark));
    // Bidons : sur le diagonal puis le tube de selle (selon le cadre, ou le choix du garage).
    const maxBottles = kind === 'tt' || bike.params.track || bike.params.bottles === false ? 0 : 2;
    const nBottles = Math.min(look.bottles ?? maxBottles, maxBottles);
    if (nBottles) {
      const bottles: THREE.BufferGeometry[] = [];
      const along = (a: THREE.Vector3, b: THREE.Vector3, f0: number, f1: number, off: THREE.Vector3) => tube(a.clone().lerp(b, f0).add(off), a.clone().lerp(b, f1).add(off), 0.034, 0.034, 8);
      bottles.push(along(BB, headBottom, 0.3, 0.62, v3(0, 0.045, -0.02)));
      if (nBottles > 1) bottles.push(along(BB, seatTop, 0.25, 0.55, v3(0, 0.0, 0.045)));
      g.add(merged(bottles, flat('#f2f2ee', 0.5)));
    }

    // Roues : pneu (large en gravel, très large en VTT), jante à la hauteur du modèle, rayons,
    // lenticulaire ou trois bâtons.
    const tireR = mtb ? 0.032 : kind === 'gravel' ? 0.022 : 0.016;
    const types: [WheelType, WheelType] = mtb ? ['box', 'box'] : bike.params.wheels;
    [REAR_AXLE, FRONT_AXLE].forEach((axle, i) => {
      const type = (i === 0 ? types[1] : types[0]) ?? 'c35';
      const w = new THREE.Group();
      w.position.copy(axle);
      w.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - tireR, tireR, 6, 48).rotateY(Math.PI / 2), tireMat));
      const depth = RIM_DEPTH[type];
      const rimR = WHEEL_R - tireR * 2 - depth / 2;
      w.add(new THREE.Mesh(new THREE.TorusGeometry(rimR, depth / 2, 4, 48).rotateY(Math.PI / 2).scale(0.026 / depth, 1, 1), rimMat));
      const inner = rimR - depth / 2;
      const hub: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.028, 0.028, 0.1, 6).rotateZ(Math.PI / 2)];
      if (type === 'disc') w.add(new THREE.Mesh(new THREE.CylinderGeometry(inner + 0.004, inner + 0.004, 0.024, 48).rotateZ(Math.PI / 2), liv.disc ? flat(liv.disc) : dark));
      else if (type === 'tri') {
        const blades = [0, 1, 2].map((n) => {
          const a = (n / 3) * Math.PI * 2;
          return tube(v3(0, 0, 0), v3(0, Math.sin(a) * inner, Math.cos(a) * inner), 0.012, 0.012, 4, 1, 3);
        });
        w.add(merged(blades, dark));
      } else {
        const n = type === 'box' ? 14 : 10;
        for (let s = 0; s < n; s++) {
          const a = (s / n) * Math.PI * 2;
          hub.push(tube(v3((s % 2 ? 1 : -1) * 0.03, 0, 0), v3(0, Math.sin(a) * inner, Math.cos(a) * inner), 0.003, 0.003, 3));
        }
      }
      w.add(merged(hub, metal));
      w.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      this.wheels.push(w);
      g.add(w);
    });
    // Pédalier : plateau à 14 pans, manivelles ; pédales mobiles (suivent le pied).
    this.crank.position.copy(BB);
    this.crank.add(
      merged([new THREE.CylinderGeometry(0.105, 0.105, 0.008, 14).rotateZ(Math.PI / 2).translate(-0.045, 0, 0)], metal),
      merged([box(0.014, CRANK, 0.026, 0.075, -CRANK / 2, 0), box(0.014, CRANK, 0.026, -0.075, CRANK / 2, 0)], dark),
    );
    g.add(this.crank);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(box(0.075, 0.016, 0.09), dark);
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
    // Le vélo bascule au rythme des coups de pédale, du côté opposé à la jambe qui appuie : à peine assis
    // (≈ ±0,5°), franchement en danseuse (≈ ±9°, comme les coureurs NCT). Le bassin reste fixe sur le vélo et
    // bascule avec lui ; seules les épaules compensent (le buste reste presque d'aplomb). Moins à haute
    // vitesse : −60 % de 20 à 45 km/h.
    const pedaling = 1 - this.coastBlend;
    const fast = Math.min(1, Math.max(0, (speed * 3.6 - 20) / 25));
    const rock = -Math.sin(this.crankAngle) * (0.22 * stand + 0.009 * (1 - stand)) * pedaling * (1 - 0.6 * fast);
    this.lean.rotation.z = tilt + rock;
    /** Décalage latéral des épaules (repère du vélo) qui garde le buste presque d'aplomb malgré la bascule. */
    // Assis : buste fixe sur le vélo (aucune compensation) ; en danseuse, épaules ramenées vers l'aplomb.
    const upright = (y: number) => 0.85 * stand * rock * y;
    // Roulis des épaules assis : l'épaule du côté de la jambe qui appuie (manivelle vers l'avant, sin < 0 à
    // gauche) descend d'environ 1 cm et le buste glisse un peu vers elle.
    // Les pros restent immobiles du haut à haute cadence : roulis réduit de moitié de 80 à 120 tr/min.
    const calm = 1 - 0.5 * Math.min(1, Math.max(0, (cadence - 80) / 40));
    const roll = -Math.sin(this.crankAngle) * pedaling * (1 - stand) * calm;

    const fit = this.fit;
    // Cintre route : bas du cintre au-dessus de 43 km/h (retour aux cocottes sous 36), position aéro dans les
    // descentes rapides : dos presque à plat, épaules basses et avancées, avant-bras à l'horizontale, tête relevée.
    const bars = fit.bar === 'drop' && pose !== 'standing';
    const coasting = pose === 'coasting' || cadence < 5;
    this.dropsOn = bars && (speed > 12 || (this.dropsOn && speed > 10));
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Descente rapide : position aéro dès 32 km/h en roue libre (pleine à 40), dès 45 km/h en pédalant.
    const aeroOn = bars ? (coasting ? smooth(8.9, 11.1, speed) : smooth(12.5, 14, speed)) : 0;
    const k2 = 1 - Math.exp(-dt * 2.5);
    this.dropsBlend += ((this.dropsOn ? 1 : 0) - this.dropsBlend) * k2;
    this.aeroBlend += (aeroOn - this.aeroBlend) * k2;
    const aero = this.aeroBlend * (1 - stand) * (1 - this.celebrate);
    const dropHands = Math.max(this.dropsBlend * (1 - stand), aero) * (1 - this.celebrate);
    // Danseuse : bassin monté de 16 cm et avancé vers le pédalier ; il reste à l'aplomb pendant que le vélo bascule.
    const hip = this.hip.set(0, SADDLE.y + 0.07 + 0.16 * stand, SADDLE.z + 0.02 + 0.23 * stand - 0.02 * aero);
    hip.x += stand * upright(hip.y);
    const up = this.celebrate;
    // Les bras levés ou la danseuse annulent la position de chrono (on se redresse).
    const fitK = 1 - Math.max(up, stand * 0.6);
    // Buste penché à ≈ 36° assis (comme les coureurs NCT), plus couché en chrono ; en danseuse, le buste plonge et
    // les épaules passent presque au-dessus des mains, coudes fléchis (GCN).
    const shoulder = this.shoulder.set(0, 1.395 + fit.shoulderDy * fitK + 0.07 * stand + 0.15 * up, 0.243 + fit.shoulderDz * fitK + 0.17 * stand - 0.23 * up);
    shoulder.y -= this.coastBlend * 0.03 * (1 - aero) + 0.13 * aero + 0.04 * dropHands * (1 - aero);
    shoulder.z += 0.07 * aero + 0.02 * dropHands * (1 - aero);
    shoulder.x += upright(shoulder.y);
    const chestBase = hip.clone().add(v3(0, 0.06, 0.02));
    this.torso.set(chestBase, shoulder);
    for (const b of this.bands) b.seg.set(chestBase.clone().lerp(shoulder, b.from), chestBase.clone().lerp(shoulder, b.to));
    this.pelvis.set(hip.clone().add(v3(0, -0.06, -0.02)), chestBase);
    const neckTop = shoulder.clone().add(v3(0, 0.08, 0.09));
    // Articulations du corps en tubes : selle → bassin → dos arrondi → épaules → base du cou.
    const J = this.J;
    J.seat.copy(hip).add(v3(0, -0.09, -0.035));
    J.hip.copy(hip);
    J.shoulder.copy(shoulder);
    J.mid.lerpVectors(hip, shoulder, 0.5).add(v3(0, 0.03, -0.03));
    J.neck.copy(shoulder).add(v3(0, 0.05, 0.04));
    this.neck.set(shoulder.clone().add(v3(0, 0.02, 0.02)), neckTop);
    this.collar.set(shoulder.clone().add(v3(0, 0.0, 0.015)), shoulder.clone().add(v3(0, 0.045, 0.035)));
    this.head.position.copy(neckTop).add(v3(0, 0.07, 0.04));
    // Tête relevée pour regarder la route (le dos est penché vers l'avant).
    this.head.rotation.x = 0.3 + fit.headTilt * fitK - 0.12 * stand - 0.25 * up - 0.22 * aero;

    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedal = v3(0.125 * leg.side, BB.y - Math.cos(a) * CRANK, BB.z - Math.sin(a) * CRANK);
      (this.pedals[leg.side > 0 ? 0 : 1] as THREE.Mesh).position.copy(pedal);
      const ankle = pedal.clone().add(v3(0, 0.065, -0.05));
      const hipJ = hip.clone().setX(hip.x + 0.09 * leg.side);
      const knee = new THREE.Vector3();
      // Genoux légèrement ouverts (naturel), qui montent et descendent sans balayer.
      solveTwoBone(hipJ, ankle, THIGH, SHIN, v3(0.09 * leg.side, 0.2, 1), knee);
      // Cuissard jusqu'à 80 % de la cuisse, puis le genou.
      const hem = hipJ.clone().lerp(knee, 0.8);
      const jl = this.J.legs[leg.side > 0 ? 0 : 1];
      if (jl) {
        jl.hip.copy(hipJ);
        jl.knee.copy(knee);
        jl.ankle.copy(ankle);
      }
      leg.shorts.set(hipJ, hem);
      leg.knee.set(hem, knee);
      leg.shin.set(knee, ankle);
      leg.sock.set(ankle.clone().add(v3(0, this.sockLen, 0.015)), ankle);
      leg.shoe.position.copy(pedal).add(v3(0, 0.038, 0.02));
      leg.shoe.rotation.x = 0.15 + Math.sin(a) * 0.12;
    }
    for (const arm of this.arms) {
      // Seule l'articulation de l'épaule descend un peu du côté de la jambe qui appuie (±6 mm), buste immobile.
      const sh = shoulder.clone().add(v3(0.17 * arm.side, -0.04 - roll * 0.006 * arm.side, 0));
      // Mains au cintre (cocottes, guidon plat ou prolongateurs) ; bras levés en V pour fêter la victoire.
      // Cocottes, ou crochet du cintre (bas du cintre, aéro).
      const handBar = v3(fit.hand.x * arm.side, fit.hand.y - 0.135 * dropHands, fit.hand.z - 0.035 * dropHands);
      const handUp = sh.clone().add(v3(0.2 * arm.side, 0.52, 0.08));
      const hand = handBar.lerp(handUp, up);
      const elbow = new THREE.Vector3();
      // Coude qui s'ouvre légèrement du côté de l'épaule qui descend (roulis assis).
      const pole = v3((fit.elbowPole.x + Math.max(0, roll * arm.side) * 0.12) * arm.side, fit.elbowPole.y + up, fit.elbowPole.z);
      solveTwoBone(sh, hand, UPPER_ARM, FOREARM, pole, elbow);
      // Manche courte : 60 % du bras, poignet de couleur, puis peau ; manche longue jusqu'au poignet.
      const sleeveEnd = this.longSleeves ? elbow : sh.clone().lerp(elbow, 0.6);
      arm.sleeve.set(sh, sleeveEnd);
      if (this.longSleeves) arm.cuff.set(elbow.clone().lerp(hand, 0.8), elbow.clone().lerp(hand, 0.9));
      else arm.cuff.set(sh.clone().lerp(elbow, 0.56), sh.clone().lerp(elbow, 0.66));
      arm.upper.set(this.longSleeves ? sh : sleeveEnd, elbow);
      arm.fore.set(elbow, hand);
      arm.glove.position.copy(hand);
      arm.glove.quaternion.copy(arm.fore.mesh.quaternion);
      const ja = this.J.arms[arm.side > 0 ? 0 : 1];
      if (ja) {
        ja.sh.copy(sh);
        ja.el.copy(elbow);
        ja.wr.copy(hand);
      }
    }
    this.swept?.pose(this.J);
  }

  setLook(look: AvatarLook): void {
    if (JSON.stringify(look) !== this.lookKey) this.build(look);
  }

  setCelebrating(on: boolean): void {
    this.celebrating = on;
  }

  setBareHead(on: boolean): void {
    this.bareHead = on;
    this.headgear.visible = !on;
  }

  /** Écran allumé du compteur, incliné vers le coureur sur la potence. */
  private buildScreen(): THREE.Object3D {
    const g = new THREE.Group();
    if (typeof document === 'undefined') return g;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 176;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.screen = { ctx, tex, t: 0 };
    this.drawScreen({ speedKmh: 0, watts: 0, cadence: 0 });
    const mat = new THREE.MeshBasicNodeMaterial({ map: tex });
    // face vers le haut, inclinée de 20° vers le coureur ; haut de l'écran vers l'avant du vélo
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.062).rotateZ(Math.PI).rotateX(-1.92), mat);
    plane.position.set(0, 0.9245, 0.6);
    g.add(plane);
    return g;
  }

  private drawScreen(d: { speedKmh: number; watts: number; cadence: number; hr?: number; timeS?: number }): void {
    const sc = this.screen;
    if (!sc) return;
    const g = sc.ctx;
    const W = 128;
    g.fillStyle = '#0b0f14';
    g.fillRect(0, 0, W, 176);
    // bandeau de tête (couleur de la zone d'effort) et heure de sortie
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, W, 22);
    g.fillStyle = '#0b0f14';
    g.font = 'bold 15px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const t = Math.max(0, Math.round(d.timeS ?? 0));
    g.fillText(`${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, W / 2, 12);
    const cell = (y: number, label: string, value: string, color: string) => {
      g.fillStyle = '#7d8a99';
      g.font = 'bold 11px Arial, sans-serif';
      g.fillText(label, W / 2, y);
      g.fillStyle = color;
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText(value, W / 2, y + 22);
    };
    cell(36, 'KM/H', d.speedKmh.toFixed(1).replace('.', ','), '#ffffff');
    cell(84, 'WATTS', String(Math.round(d.watts)), '#7ee081');
    g.fillStyle = '#26303b';
    g.fillRect(6, 130, W - 12, 1);
    g.font = 'bold 18px Arial, sans-serif';
    g.fillStyle = '#ff7b88';
    g.fillText(d.hr ? `♥${Math.round(d.hr)}` : '♥ --', W * 0.3, 152);
    g.fillStyle = '#5fc8ff';
    g.fillText(`${Math.round(d.cadence)}`, W * 0.75, 152);
    sc.tex.needsUpdate = true;
  }

  /** Données du compteur (coureur du joueur) : redessiné au plus 4 fois par seconde. */
  setComputer(d: { speedKmh: number; watts: number; cadence: number; hr?: number; timeS?: number }): void {
    const sc = this.screen;
    if (!sc) return;
    const now = performance.now();
    if (now - sc.t < 250) return;
    sc.t = now;
    this.drawScreen(d);
  }

  /** Vélo seul (garage : vélos sur les râteliers et contre les murs). */
  setRiderVisible(on: boolean): void {
    this.body.visible = on;
  }

  /**
   * Vues embarquées (cockpit, caméra d'action) : sans la tête ni le buste et les bras, qui bouchaient l'image
   * de grands aplats (corps en tubes : jambes comprises) ; restent le vélo et les gants sur le cintre.
   */
  setHeadVisible(on: boolean): void {
    this.head.visible = on;
    if (this.swept) this.swept.mesh.visible = on;
    this.torso.mesh.visible = on && !this.swept;
    for (const b of this.bands) b.seg.mesh.visible = on && !this.swept;
    this.collar.mesh.visible = on && !this.swept;
    this.neck.mesh.visible = on && !this.swept;
    for (const a of this.arms) for (const sg of [a.sleeve, a.cuff, a.upper, a.fore]) sg.mesh.visible = on && !this.swept;
  }

  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.root.traverse((o) => (o.castShadow = on));
  }

  eyeWorld(out: THREE.Vector3, hands?: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    out.set(0, 0.03, 0.09).applyMatrix4(this.head.matrixWorld);
    if (hands) hands.set(0, this.fit.hand.y, this.fit.hand.z).applyMatrix4(this.lean.matrixWorld);
    return out;
  }
}
