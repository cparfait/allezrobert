import { AERO_COAST_FULL, AERO_SPEED, AERO_SPEED_OUT, FOREARMS_IN, FOREARMS_OUT, HARD_EFFORT, HARD_EFFORT_OUT } from './poseThresholds.ts';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeOfLook, lookSex, type AvatarLook, type BikeBuild, type WheelType } from '@allezrobert/shared';
import type { RiderAvatarLike, RiderGesture, RiderPose } from './gltfAvatar.ts';
import { SweptBody, makeJoints, type BodyLook } from './sweptBody.ts';
import { HELMET_FACETED, aeroHelmetGeometry } from './aeroHelmet.ts';
import { aerobarAnchors, buildAerobars, type AerobarAnchors } from './aerobars.ts';
import { shoeDialOf } from './shoeLook.ts';
import { BikeMaterials, assembleBike, bikeAnchors, bikeFamilyReady, libraryWheel, loadBikeFamily, type FamilyKey } from './bikes.ts';
import { flatLook } from './flatLook.ts';

/**
 * Cycliste et vélo du style jeu vidéo (low poly, voir engine/style.ts), construits de zéro en prismes
 * à facettes et aplats de couleur, un millier de triangles environ. Vélo : celui du style réaliste (modèles du
 * catalogue, niveau de détail simplifié) à facettes, voir REAL_BIKE_DEFAULT ; vélo en prismes en attendant.
 * Suit la tenue du garage : vélo (route, aéro, chrono, rétro, gravel, VTT), roues (basses, 35, 50, 65,
 * lenticulaire, trois bâtons), bidons et compteur, casque (route, aéro des vélos de chrono, chrono du garage) ou
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
const FRONT_AXLE = new THREE.Vector3(0, WHEEL_R, 0.62);
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
/**
 * Vélo des modèles du style réaliste (bikes.ts, niveau de détail simplifié) rendu à facettes : mêmes cadres, livrées et
 * inscriptions que le catalogue. Le vélo en prismes (buildBike) reste affiché le temps que la famille se charge, et
 * remplace le modèle s'il est indisponible ; ?velo-prismes : toujours le vélo en prismes.
 */
const REAL_BIKE_DEFAULT = (typeof location === 'undefined' ? null : new URLSearchParams(location.search).has('velo-prismes')) !== true;
/** Familles dont le chargement a échoué (fichiers absents) : vélo en prismes sans réessayer. */
const failedFamilies = new Set<FamilyKey>();
/** Selle des modèles : dessus 2,7 cm plus bas que celle du vélo en prismes (SADDLE). */
const REAL_SEAT_DY = -0.027;
/**
 * Mains sur le poste de chrono des modèles (bikes/tt.glb…) : prolongateurs 12 cm plus courts et un peu plus bas que
 * ceux du vélo en prismes, cornes du cintre de base 8,5 cm plus bas.
 */
const REAL_TT_HAND = new THREE.Vector3(0, -0.015, -0.12);
const REAL_TT_HORNS = new THREE.Vector3(0, -0.085, -0.02);
/** Distance (m) au-delà de laquelle les roues du modèle passent au niveau simplifié. */
const NEAR_WHEELS = 12;

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
const _handY = new THREE.Vector3();
const _handZ = new THREE.Vector3();
const _handM = new THREE.Matrix4();

/**
 * Tube d'un seul tenant le long d'une polyligne (cintre) : anneaux orientés par transport parallèle, tangente
 * moyenne aux coudes, extrémités fermées. Des cylindres mis bout à bout faisaient des bourrelets aux jointures.
 */
function sweep(path: THREE.Vector3[], r: number, sides = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const t = new THREE.Vector3();
  const n = new THREE.Vector3(0, 1, 0);
  const b = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)] as THREE.Vector3;
    const c = path[Math.min(path.length - 1, i + 1)] as THREE.Vector3;
    t.subVectors(c, a).normalize();
    if (i === 0) {
      // Normale de départ perpendiculaire à la tangente.
      if (Math.abs(n.dot(t)) > 0.9) n.set(1, 0, 0);
      n.addScaledVector(t, -n.dot(t)).normalize();
    } else {
      q.setFromUnitVectors(prevT, t);
      n.applyQuaternion(q).addScaledVector(t, -n.dot(t)).normalize();
    }
    prevT.copy(t);
    b.crossVectors(t, n);
    const p = path[i] as THREE.Vector3;
    for (let j = 0; j < sides; j++) {
      const ang = (j / sides) * Math.PI * 2;
      pos.push(p.x + (n.x * Math.cos(ang) + b.x * Math.sin(ang)) * r, p.y + (n.y * Math.cos(ang) + b.y * Math.sin(ang)) * r, p.z + (n.z * Math.cos(ang) + b.z * Math.sin(ang)) * r);
    }
    if (i > 0)
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        const r0 = (i - 1) * sides;
        const r1 = i * sides;
        index.push(r0 + j, r1 + j, r0 + j1, r0 + j1, r1 + j, r1 + j1);
      }
  }
  // Bouts fermés.
  for (const [ring, flip] of [[0, true], [path.length - 1, false]] as const) {
    const c = pos.length / 3;
    const p = path[ring] as THREE.Vector3;
    pos.push(p.x, p.y, p.z);
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      if (flip) index.push(c, ring * sides + j1, ring * sides + j);
      else index.push(c, ring * sides + j, ring * sides + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
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
      // headShell n'a pas de normales : sans elles la fusion avec un tube (queue de cheval) échoue.
      if (!n.getAttribute('normal')) n.computeVertexNormals();
      return n;
    }),
    false,
  ) as THREE.BufferGeometry;
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Aérations du casque de route (repère de la coque) : canaux d'avant en arrière, parallèles — au milieu, de
 * part et d'autre, sur les flancs — qui descendent jusqu'au bord avant (casques Kask, Bell). `x` : écart
 * latéral (symétrique sauf au milieu), `w` : demi-largeur, de `z0` (arrière) à `z1` (avant).
 */
const HELMET_VENTS: ReadonlyArray<{ x: number; w: number; z0: number; z1: number }> = [
  { x: 0, w: 0.009, z0: -0.075, z1: 0.1 },
  { x: 0.042, w: 0.011, z0: -0.11, z1: 0.11 },
  { x: 0.08, w: 0.009, z0: -0.085, z1: 0.07 },
];

/**
 * Fentes d'aération posées sur la coque `shell` (repère de la coque) : bandes sombres qui suivent sa surface
 * (lancer de rayons vers le bas sur la coque, trois points en travers), effilées aux deux bouts, 3 mm au-dessus
 * de la surface et dessinées devant elle (décalage de profondeur).
 */
function helmetVents(shell: THREE.Mesh, mat: THREE.Material): THREE.Mesh {
  const ray = new THREE.Raycaster();
  const probe = new THREE.Mesh(shell.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const down = new THREE.Vector3(0, -1, 0);
  const onShell = (x: number, z: number): THREE.Vector3 | null => {
    ray.set(new THREE.Vector3(x, 1, z), down);
    const hit = ray.intersectObject(probe, false)[0];
    if (!hit || !hit.face) return null;
    return hit.point.clone().addScaledVector(hit.face.normal, 0.003);
  };
  const parts: THREE.BufferGeometry[] = [];
  const N = 14;
  for (const v of HELMET_VENTS) {
    for (const sx of v.x === 0 ? [0] : [1, -1]) {
      const pos: number[] = [];
      let prev: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const z = v.z0 + (v.z1 - v.z0) * u;
        // Bouts arrondis : la fente s'effile vers ses extrémités.
        const w = v.w * Math.sqrt(Math.max(0.15, Math.sin(Math.PI * u)));
        // Trois points en travers (bords et milieu) : la fente épouse la coque sans y plonger.
        const a = onShell(sx * v.x - w, z);
        const m = onShell(sx * v.x, z);
        const b = onShell(sx * v.x + w, z);
        if (!a || !m || !b) {
          // Une fente reste d'un seul tenant : elle s'arrête au premier point hors de la coque.
          if (prev) break;
          continue;
        }
        if (prev) {
          const [pa, pm, pb] = prev;
          pos.push(...pa.toArray(), ...a.toArray(), ...m.toArray(), ...pa.toArray(), ...m.toArray(), ...pm.toArray());
          pos.push(...pm.toArray(), ...m.toArray(), ...b.toArray(), ...pm.toArray(), ...b.toArray(), ...pb.toArray());
        }
        prev = [a, m, b];
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      parts.push(g);
    }
  }
  (probe.material as THREE.Material).dispose();
  const out = new THREE.Mesh(mergeGeometries(parts) ?? new THREE.BufferGeometry(), mat);
  // Toujours devant la coque (pas de points blancs dans les fentes selon l'angle).
  mat.side = THREE.DoubleSide;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  return out;
}

/** Hauteur de jante (m) par type de roue. */
const RIM_DEPTH: Record<WheelType, number> = { box: 0.02, c35: 0.035, c50: 0.05, c65: 0.065, disc: 0.05, tri: 0.05 };

/**
 * Boîte de la coque du casque de route (repère de la tête : headShell(0.128, 0.12, 0.145, …, queue 0.22)
 * posée en (0, 0,025, −0,012)), gabarit des casques chrono du garage.
 */
/**
 * Cocottes du cintre route à facettes, comme les ancres hand_L / hand_R des modèles réalistes : haut du
 * cintre (aerobars.ts : 7,3 cm sous elles, 2,5 cm derrière) à y 0,904, z 0,55.
 */
const LOW_POLY_HOODS = { L: new THREE.Vector3(0.2, 0.977, 0.575), R: new THREE.Vector3(-0.2, 0.977, 0.575) };

const ROAD_HELMET_BOX = new THREE.Box3(new THREE.Vector3(-0.128, -0.1, -0.012 - 0.177), new THREE.Vector3(0.128, 0.025 + 0.12, -0.012 + 0.145));

/**
 * Nez à facettes (repère de la tête) : petite pyramide au lieu d'un cube — arête fine qui part sous les
 * lunettes, pointe avancée qui descend, ailes plus larges en bas (narines) ; le dos rentre dans le visage.
 */
function noseGeometry(): THREE.BufferGeometry {
  const B = [0, 0.012, 0.104]; // haut de l'arête
  const T = [0, -0.015, 0.129]; // pointe
  const L = [0.013, -0.025, 0.11]; // aile gauche
  const R = [-0.013, -0.025, 0.11]; // aile droite
  const C = [0, -0.02, 0.094]; // racine, dans le visage
  const tris = [B, T, L, B, R, T, T, R, L, B, L, C, B, C, R, C, L, R];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Lunettes-écran enveloppantes (repère de la tête) : bande qui suit la courbure du visage d'une tempe à
 * l'autre (arc ±SHIELD_SPAN autour de l'axe vertical), plus étroite vers les côtés, avec une encoche au
 * milieu du bord bas pour le nez ; `frame` : fine monture le long du bord haut.
 */
const SHIELD_SPAN = 1.3;
function shieldGeometry(): { lens: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  const N = 12;
  const at = (phi: number, y: number, out = 0): THREE.Vector3 => v3((0.109 + out) * Math.sin(phi), y, (0.124 + out) * Math.cos(phi));
  const lensPos: number[] = [];
  const framePos: number[] = [];
  const quad = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => arr.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray());
  for (let i = 0; i < N; i++) {
    const cols = [i, i + 1].map((k) => {
      const phi = -SHIELD_SPAN + (2 * SHIELD_SPAN * k) / N;
      const u = phi / SHIELD_SPAN;
      const top = 0.046 - 0.007 * u * u;
      // Bord bas : remonte vers les côtés, encoche du nez au milieu.
      const bottom = 0.004 + 0.013 * u * u + 0.017 * Math.max(0, 1 - Math.abs(phi) / 0.24);
      return { phi, top, bottom };
    });
    const [l, r] = cols as [{ phi: number; top: number; bottom: number }, { phi: number; top: number; bottom: number }];
    quad(lensPos, at(l.phi, l.bottom), at(r.phi, r.bottom), at(r.phi, r.top), at(l.phi, l.top));
    quad(framePos, at(l.phi, l.top - 0.002, 0.002), at(r.phi, r.top - 0.002, 0.002), at(r.phi, r.top + 0.005, 0.002), at(l.phi, l.top + 0.005, 0.002));
  }
  const geo = (pos: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  return { lens: geo(lensPos), frame: geo(framePos) };
}

/** Tête à facettes (icosaèdre de buildBody) : demi-axes x, y, z. */
const HEAD_AXES = v3(0.112 * 0.92, 0.112 * 1.05, 0.112);

/**
 * Point de la surface de la tête dans la direction (x, y, z) depuis son centre, décalé de `out` (m) vers
 * l'extérieur : sangles posées sur la peau.
 */
function onHead(x: number, y: number, z: number, out = 0.0045): THREE.Vector3 {
  const d = v3(x, y, z).normalize();
  const t = 1 / Math.sqrt((d.x / HEAD_AXES.x) ** 2 + (d.y / HEAD_AXES.y) ** 2 + (d.z / HEAD_AXES.z) ** 2);
  return d.multiplyScalar(t + out);
}

/**
 * Oreille à facettes (côté `side` : +1 gauche) : disque à six pans aplati, plus haut que large, penché vers
 * l'arrière, plus épais au bord avant collé à la tête qu'au bord arrière décollé (pavillon).
 */
function earGeometry(side: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.021, 0.021, 0.012, 6).rotateZ(Math.PI / 2).scale(1, 1.3, 0.9);
  const p = g.getAttribute('position');
  // Pavillon : l'arrière s'écarte de la tête, l'avant s'y colle.
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + side * Math.max(0, -p.getZ(i)) * 0.25);
  g.rotateX(0.22);
  return g.translate(0.103 * side, -0.006, -0.008);
}

/**
 * Chaussure à facettes, à l'échelle du corps (pointure 42 : 21,5 cm de semelle à cette échelle) : talon
 * 11,5 cm derrière l'axe de la pédale (6 cm derrière la cheville), pointe 10 cm devant ; tige qui
 * s'abaisse et s'affine vers la pointe. Origine : axe de la pédale, semelle 3,3 cm plus bas.
 */
function shoeGeometry(): THREE.BufferGeometry {
  const W = 0.074;
  const H = 0.06;
  const HEEL = -0.115;
  const TOE = 0.1;
  const g = new THREE.BoxGeometry(W, H, TOE - HEEL, 1, 1, 3).translate(0, 0, (TOE + HEEL) / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = (p.getZ(i) - HEEL) / (TOE - HEEL); // 0 talon → 1 pointe
    const top = p.getY(i) > 0;
    // Pointe : 70 % de la largeur ; dessus abaissé vers l'avant (cou-de-pied puis bout arrondi).
    p.setX(i, p.getX(i) * (1 - 0.3 * t * t));
    if (top) p.setY(i, -H / 2 + H * (t < 0.4 ? 1 : 1 - 0.65 * ((t - 0.4) / 0.6) ** 1.3));
  }
  return g;
}

/**
 * Deux molettes BOA sur le dessus de la chaussure (shoeGeometry), côté extérieur du pied (`side` : +1
 * gauche) : devant la chaussette et au milieu du pied, posées à plat sur la tige, avec leur câble.
 */
function boaGeometry(side: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [z, y, tilt] of [[-0.012, 0.03, 0.05], [0.038, 0.014, 0.35]] as const) {
    parts.push(new THREE.CylinderGeometry(0.0155, 0.017, 0.01, 8).rotateX(tilt).translate(0.012 * side, y + 0.004, z));
    // Câble : de la molette vers l'intérieur du pied.
    parts.push(new THREE.BoxGeometry(0.03, 0.003, 0.004).rotateX(tilt).translate(-0.006 * side, y + 0.001, z));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed())) as THREE.BufferGeometry;
}

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
/**
 * Cheveux qui tombent : sous la ligne des oreilles, la calotte ne se referme plus vers le cou mais descend
 * presque droit (légère cloche vers l'intérieur), comme un carré ou des cheveux longs ; `drop` allonge
 * l'arrière (cheveux longs sur la nuque, qui suivent la tête penchée).
 */
function hangDown(g: THREE.BufferGeometry, ry: number, drop = 0): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const th = Math.acos(Math.max(-1, Math.min(1, p.getY(i) / ry)));
    if (th <= Math.PI / 2) continue;
    const k = (1 - 0.22 * (th - Math.PI / 2)) / Math.max(0.05, Math.sin(th));
    const x = p.getX(i);
    const z = p.getZ(i);
    const back = Math.max(0, -z / Math.max(1e-6, Math.hypot(x, z)));
    p.setXYZ(i, x * k, p.getY(i) * (1 + drop * back * back), z * k);
  }
  return g;
}

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
  /** Coureur masqué (vélo seul) : à réappliquer quand le corps est reconstruit. */
  private riderHidden = false;
  private crank: THREE.Object3D = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  /** Écran du compteur (canevas rafraîchi par setComputer, 4 fois par seconde au plus). */
  private screen: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; t: number } | null = null;
  /** Pédales (gauche, droite) ; celles du modèle gardent leur écart d'axe (`pedalX`), celles en prismes sont sous le pied. */
  private pedals: THREE.Object3D[] = [];
  private pedalX: number | null = null;
  /** Vélo du modèle réaliste (REAL_BIKE_DEFAULT) : ses matériaux, et les réglages du coureur posé dessus. */
  private readonly realBike: boolean;
  private realMats: BikeMaterials | null = null;
  private bb = BB.clone();
  private seatDy = 0;
  private readonly ttHandFix = new THREE.Vector3();
  private readonly hornsFix = new THREE.Vector3();
  private legs: Array<{ side: number; shorts: Seg; knee: Seg; shin: Seg; sock: Seg; shoe: THREE.Mesh }> = [];
  private arms: Array<{ side: number; sleeve: Seg; cuff: Seg; upper: Seg; fore: Seg; glove: THREE.Object3D }> = [];
  private torso!: Seg;
  private bands: Band[] = [];
  private collar!: Seg;
  private pelvis!: Seg;
  private neck!: Seg;
  private head = new THREE.Group();
  private headgear = new THREE.Group();
  private glasses: THREE.Object3D | null = null;
  /** « Sans casque » / « Sans lunettes » de la tenue (look.noHelmet, look.noGlasses). */
  private noHelmet = false;
  private noGlasses = false;
  /** Casque chrono porté : sa visière tient lieu de lunettes (lunettes masquées, sauf tête nue). */
  private visorOn = false;
  private fit: Fit = FITS.drop;
  private sockLen = 0.11;
  private longSleeves = false;
  private lookKey = '';
  private crankAngle = Math.random() * Math.PI * 2;
  /** Pose de repos du corps en tubes : les deux pieds pédale en bas (jambes en miroir). */
  private bindPose = false;
  private wheelAngle = 0;
  private poseBlend = 0;
  private coastBlend = 0;
  /** Mains en bas du cintre (vitesse de course) et position aéro (descente rapide, très haute vitesse). */
  private dropsBlend = 0;
  private aeroBlend = 0;
  /** Sprint (danseuse basse, mains en bas du cintre) plutôt que danseuse de montée ; fondu. */
  private sprintOn = false;
  private sprintBlend = 0;
  private dropsOn = false;
  /**
   * Positions aéro en pédalant assis sur un cintre route (comme l'avatar réaliste) : avant-bras à plat sur
   * les cocottes quand on roule très fort (> 105 % de la FTP, plus de 29 km/h), avant-bras posés sur le haut
   * du cintre quand on roule très vite (> 50 km/h).
   */
  private ftpFrac = 0.7;
  /** Geste imposé (film d'accueil) : angle des manivelles, regard de côté et vers le haut. */
  private gesture: RiderGesture = {};
  private hoodsAeroOn = false;
  private forearmsOn = false;
  private hoodsAeroBlend = 0;
  private forearmsBlend = 0;
  /** Prolongateurs de l'atelier : repose-coudes et poignées (null sans prolongateurs) ; couché dessus très vite ou très fort. */
  private clip: AerobarAnchors | null = null;
  private clipOn = false;
  private clipBlend = 0;
  /** Vélo de chrono : mains sur les cornes (petite allure, danseuse), tortue (très vite ou très fort). */
  private hornsOn = false;
  private hornsBlend = 0;
  private turtleOn = false;
  private turtleBlend = 0;
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

  constructor(look: AvatarLook, opts: { tubes?: boolean; realBike?: boolean } = {}) {
    this.tubes = opts.tubes ?? TUBES_DEFAULT;
    this.realBike = opts.realBike ?? REAL_BIKE_DEFAULT;
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
        // Vélo du modèle : géométries partagées avec la famille chargée, matériaux rendus par realMats.
        if (!mesh.isMesh || o.userData.shared) return;
        mesh.geometry.dispose();
        // (casques chrono : plusieurs matériaux)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      });
    }
    this.realMats?.dispose();
    this.realMats = null;
    this.body = new THREE.Group();
    this.crank = new THREE.Group();
    this.wheels = [];
    this.pedals = [];
    this.pedalX = null;
    this.screen = null;
    this.legs = [];
    this.arms = [];
    this.bands = [];
    this.head = new THREE.Group();
    this.headgear = new THREE.Group();

    const bike = bikeOfLook(look);
    const kind = bikeKind(look, bike);
    this.fit = FITS[kind === 'mtb' ? 'flat' : kind === 'tt' ? 'tt' : 'drop'];
    const real = this.realBike ? this.mountRealBike(look, bike) : null;
    this.bb.set(BB.x, real ? 0.27 : BB.y, BB.z);
    this.seatDy = real ? REAL_SEAT_DY : 0;
    this.ttHandFix.copy(real ? REAL_TT_HAND : new THREE.Vector3());
    this.hornsFix.copy(real ? REAL_TT_HORNS : new THREE.Vector3());
    this.lean.add(real ?? this.buildBike(look, bike, kind), this.body);
    this.buildRider(look, bike);
    this.body.visible = !this.riderHidden;
    this.noHelmet = !!look.noHelmet;
    this.noGlasses = !!look.noGlasses;
    this.applyHeadwear();
    this.swept = null;
    // Corps en tubes lié dans une pose de repos fixe et symétrique, les deux pieds pédale en bas, comme
    // l'avatar réaliste (BIND_PHASE de build_avatar.py) : lié à l'angle de manivelle du moment (au hasard),
    // la fesse de la jambe levée se froissait dès que la jambe redescendait.
    const crank = this.crankAngle;
    this.crankAngle = 0;
    this.bindPose = true;
    this.update(0, 0, 0, 'seated');
    if (this.tubes) this.buildTubes(look);
    this.bindPose = false;
    this.crankAngle = crank;
    this.update(0, 0, 0, 'seated');
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
    } else if (!style) bands.push({ from: 0.42, to: 0.6, color: c(look.jerseyAccent) });
    // Pois, dégradé, chevrons et logo : dans le shader du corps (mêmes motifs que l'avatar réaliste).
    const shaderStyle = style === 'pois' || style === 'degrade' || style === 'chevrons' ? style : undefined;
    // Logo un peu plus petit et plus bas : le dos du corps low poly est plus étroit que celui du modèle réaliste.
    const logo = look.jerseyLogo && { ...look.jerseyLogo, w: (look.jerseyLogo.w ?? 0.16) * 0.78, y: (look.jerseyLogo.y ?? 0.62) * 0.93 };
    const pattern = shaderStyle || logo ? { ...look, jerseyStyle: shaderStyle, jerseyLogo: logo } : undefined;
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
      pattern,
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
    // Molettes BOA contrastées : sombres sur chaussure claire, claires sur chaussure foncée.
    const boa = flat(shoeDialOf(look) === '#f4f4f4' ? '#1b1c20' : '#d9dce0', 0.35, 0.2);
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
      const sh = new THREE.Mesh(shoeGeometry(), shoe);
      sh.add(new THREE.Mesh(boaGeometry(side), boa));
      sh.castShadow = true;
      this.body.add(thighShorts.mesh, knee.mesh, shin.mesh, sk.mesh, sh);
      this.legs.push({ side, shorts: thighShorts, knee, shin, sock: sk, shoe: sh });
      // Bras : manche courte et son poignet de couleur (comme une bande de manche), puis peau, gant.
      const sleeveMat = style === 'manches' ? accent : jersey;
      const sleeve = new Seg(octo(0.052, 0.062), sleeveMat, build, build);
      const cuff = new Seg(prism(0.054, 0.054, 8), style === 'manches' ? jersey : accent, build, build);
      const upper = new Seg(quad(0.046, 0.05), this.longSleeves ? sleeveMat : skin, build, build);
      const fore = new Seg(quad(0.037, 0.047), this.longSleeves ? sleeveMat : skin, build, build);
      const gl = this.buildHand(side, look.gloves === 'none' ? skin : glove, look.gloves === 'none' || look.gloves === 'mitts' ? skin : glove);
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
    const face = merged([noseGeometry(), earGeometry(1), earGeometry(-1)], skin);
    // Lunettes : écran à la couleur des verres, branches à celle de la monture (garage).
    const glasses = new THREE.Group();
    // Écran enveloppant d'une pièce (comme les coureurs NCT), monture fine en haut ; branches des bouts de
    // l'écran jusqu'au haut des oreilles (earGeometry : haut à y ≈ 0,02, z ≈ −0,01), en biais.
    const lensMat = flat(look.glassesLens ?? '#15171b', 0.3, 0.3);
    lensMat.side = THREE.DoubleSide;
    const frameMat = flat(look.glassesFrame ?? '#15171b', 0.3, 0.3);
    const shield = shieldGeometry();
    glasses.add(
      new THREE.Mesh(shield.lens, lensMat),
      new THREE.Mesh(shield.frame, frameMat),
      merged([1, -1].map((sx) => tube(v3(0.104 * sx, 0.034, 0.04), v3(0.118 * sx, 0.017, -0.012), 0.0065, 0.006, 4)), frameMat),
    );
    this.glasses = glasses;
    // Yeux (sous les lunettes, visibles sans elles) : blanc, pupille et sourcil posés à plat sur la facette du
    // visage, qui fuit vers les tempes (pente ≈ 0,41).
    const whites: THREE.BufferGeometry[] = [];
    const pupils: THREE.BufferGeometry[] = [];
    const brows: THREE.BufferGeometry[] = [];
    for (const sx of [1, -1]) {
      const at = (w: number, h: number, d: number, y: number, out: number) =>
        new THREE.BoxGeometry(w, h, d).translate(0, 0, out).rotateY(0.39 * sx).translate(0.038 * sx, y, 0.0965);
      whites.push(at(0.03, 0.017, 0.006, 0.014, 0.001));
      pupils.push(at(0.013, 0.014, 0.004, 0.013, 0.004));
      brows.push(at(0.034, 0.007, 0.007, 0.033, 0.002));
    }
    this.head.add(skull, face, glasses, merged(whites, flat('#f3efe6', 0.5)), merged(pupils, flat('#2b1d14', 0.3)), merged(brows, hair));
    if (!female && (look.beard ?? 0) > 0.25) this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1).scale(0.96, 0.6, 0.9).translate(0, -0.06, 0.027), hair));
    if (!female && look.moustache) this.head.add(new THREE.Mesh(box(0.08, 0.018, 0.025, 0, -0.038, 0.104), hair));
    const hairParts = this.hairGeometry(look.hairStyle);
    // Coureuses (façon NCT) : queue de cheval qui sort sous l'arrière du casque et tombe sur la nuque, en deux
    // tronçons effilés ; attache sombre.
    // Seulement avec une coupe courte : les coiffures longues, attachées ou le carré ont leur propre arrière.
    const hairStyle = ((look.hairStyle % 12) + 12) % 12;
    const ponytail = female && [0, 4, 8].includes(hairStyle);
    if (ponytail) {
      const knot = v3(0, -0.02, -0.122);
      const mid = v3(0, -0.13, -0.165);
      const end = v3(0, -0.25, -0.15);
      hairParts.push(tube(knot, mid, 0.034, 0.03, 6), tube(mid, end, 0.03, 0.012, 6));
    }
    if (hairParts.length) this.head.add(merged(hairParts, hair));
    if (ponytail) this.head.add(new THREE.Mesh(tube(v3(0, -0.005, -0.118), v3(0, -0.035, -0.128), 0.038, 0.038, 6), flat('#1b1c20')));
    this.buildHeadgear(look, bike);
    this.head.add(this.headgear);
    this.head.traverse((o) => (o.castShadow = true));
    this.body.add(this.head);
  }

  /**
   * Main sur la cocotte, dans le repère de l'avant-bras (y vers les doigts, x latéral, +z vers le bas) : dos de main
   * qui s'élargit vers les jointures, doigts recourbés autour de l'avant de la cocotte, pouce côté intérieur. Gant
   * (ou peau) ; les doigts restent nus avec des mitaines.
   */
  private buildHand(side: number, palmMat: THREE.Material, fingerMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const palm = new THREE.BoxGeometry(0.07, 0.08, 0.026).translate(0, -0.012, -0.01);
    const pp = palm.getAttribute('position');
    // Plus étroite et plus fine au poignet.
    for (let i = 0; i < pp.count; i++) if (pp.getY(i) < 0) pp.setXYZ(i, pp.getX(i) * 0.82, pp.getY(i), pp.getZ(i) * 0.85);
    const thumb = new THREE.BoxGeometry(0.02, 0.05, 0.021).rotateZ(0.45 * side).translate(-0.036 * side, 0.012, 0.012);
    // Doigts : première phalange dans le prolongement, puis repliés vers le bas autour de la cocotte.
    const fingers = [
      new THREE.BoxGeometry(0.068, 0.032, 0.02).rotateX(0.35).translate(0, 0.042, -0.002),
      new THREE.BoxGeometry(0.064, 0.036, 0.018).rotateX(1.35).translate(0, 0.06, 0.022),
    ];
    const a = merged([palm, thumb], palmMat);
    const b = merged(fingers, fingerMat);
    g.add(a, b);
    return g;
  }

  /** Coiffure (AvatarLook.hairStyle, voir faceEditor.ts), sous le casque : nuque, queue, tresses, chignon… */
  private hairGeometry(style: number): THREE.BufferGeometry[] {
    const s = ((style % 12) + 12) % 12;
    if (s === 3) return [];
    // Coupe courte qui épouse le crâne : ligne de front haute, tempes au-dessus des oreilles, nuque dégagée
    // (style 4 : plus court derrière). Carré (6) et cheveux longs (9) : calotte plus ample qui descend sur les
    // côtés jusqu'à la mâchoire en couvrant les oreilles, visage dégagé. Les autres styles ajoutent queue,
    // tresses ou chignon par-dessus.
    const cap =
      s === 6 || s === 9
        ? hangDown(headShell(0.132, 0.13, 0.129, 0.85, 2.25, s === 9 ? 2.7 : 2.45, 0, 20, 8), 0.13, s === 9 ? 0.9 : 0).translate(0, 0.004, -0.006)
        : headShell(0.109, 0.125, 0.119, 0.85, 1.72, s === 4 ? 2.0 : 2.22, 0, 20, 7).translate(0, 0.004, -0.004);
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
        break;
      case 7:
        parts.push(new THREE.IcosahedronGeometry(0.052, 0).translate(0, 0, -0.14));
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
    this.visorOn = !look.cap && (!!look.helmetShape || !!bike.params.aeroHelmet);
    // Visière des casques chrono : lunettes aéro, à la couleur des verres choisis au garage.
    const visorMat = flat(look.glassesLens ?? '#20242c', 0.15, 0.4);
    const shellMat = flat(look.helmet, 0.45);
    const dark = flat('#1d1f24');
    if (look.cap) {
      const cap = look.cap;
      // Petite calotte serrée sur la coupe de cheveux (headShell(0.109, 0.125, 0.119) de hairGeometry), bord
      // au-dessus des lunettes devant, cheveux visibles sur la nuque.
      const capMat = new THREE.MeshStandardNodeMaterial({ color: cap.color, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
      capMat.flatShading = true;
      g.add(new THREE.Mesh(headShell(0.115, 0.126, 0.125, 1.22, 1.55, 1.75, 0, 20, 6).translate(0, 0.007, -0.004), capMat));
      // Visière courte, bien relevée, comme les coureurs la portent.
      g.add(new THREE.Mesh(box(0.13, 0.01, 0.038, 0, 0.0, 0.019).rotateX(-1.0).translate(0, 0.055, 0.105), flat(cap.accent ?? cap.colors?.[1] ?? cap.color)));
      return;
    }
    // Sangles en Y qui suivent la tête (quelques millimètres au-dessus de la peau) : une branche devant l'oreille
    // et une derrière, qui sortent de sous le bord du casque, réunies sous l'oreille, puis une sangle le long
    // de la mâchoire jusque sous le menton, boucle sur le côté (casque de route seulement).
    const straps = (): THREE.Mesh => {
      const parts: THREE.BufferGeometry[] = [];
      const path = (dirs: Array<[number, number, number]>, sx: number) => {
        const pts = dirs.map(([x, y, z]) => onHead(x * sx, y, z));
        for (let i = 0; i + 1 < pts.length; i++) parts.push(tube(pts[i] as THREE.Vector3, pts[i + 1] as THREE.Vector3, 0.0042, 0.0042, 4));
      };
      for (const sx of [1, -1]) {
        const knot: [number, number, number] = [0.86, -0.5, 0.08];
        path([[0.96, 0.16, 0.26], [0.95, -0.18, 0.22], knot], sx); // devant l'oreille
        path([[0.84, 0.14, -0.52], [0.9, -0.24, -0.3], knot], sx); // derrière l'oreille
        path([knot, [0.66, -0.72, 0.24], [0.32, -0.86, 0.4], [0, -0.86, 0.5]], sx); // mâchoire, menton
      }
      // Boucle, sous le menton sur le côté.
      parts.push(new THREE.BoxGeometry(0.026, 0.01, 0.016).lookAt(v3(0, -1, 0.4)).translate(...onHead(0.16, -0.86, 0.48, 0.008).toArray()));
      return merged(parts, dark);
    };
    if (look.helmetShape || bike.params.aeroHelmet) {
      // Casque chrono du garage, ou d'office sur un vélo de chrono (à longue queue) : mêmes formes que le style
      // réaliste (aeroHelmet.ts), à facettes, ajustées à la coque du casque de route ci-dessous.
      const geo = aeroHelmetGeometry(look.helmetShape ?? 'chrono', ROAD_HELMET_BOX, new THREE.Matrix4(), 0, HELMET_FACETED);
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      const faceted = geo.toNonIndexed();
      faceted.computeVertexNormals();
      // Pas de sangles sous un casque chrono.
      g.add(new THREE.Mesh(faceted, [shellMat, dark, visorMat]));
      return;
    }
    // Casque de route : coque ovale profilée vers l'arrière, bord qui remonte au-dessus des lunettes et descend
    // bas sur l'occiput (protection de l'arrière du crâne, comme les casques actuels) ; fentes d'aération sombres
    // posées sur la coque et serrage noir à l'arrière. Aérations comme les casques de route actuels (Kask, POC,
    // Bell) : canaux allongés d'avant en arrière, parallèles (HELMET_VENTS, helmetVents).
    const SEGS = 24;
    const ROWS = 8;
    const geo = headShell(0.128, 0.12, 0.145, 1.27, 1.7, 2.35, 0.22, SEGS, ROWS).toNonIndexed();
    const p = geo.getAttribute('position');
    const shellC = new THREE.Color(look.helmet);
    const ventC = new THREE.Color('#202329');
    const cols: number[] = [];
    const tris = p.count / 3;
    for (let t = 0; t < tris; t++) {
      // Facette (rangée r depuis le sommet, colonne j) : serrage noir sur la nuque, coque ailleurs.
      const qi = t < SEGS ? t : Math.floor((t - SEGS) / 2);
      const r = t < SEGS ? 1 : 2 + Math.floor(qi / SEGS);
      const j = qi % SEGS;
      const dz = Math.cos(((j + 0.5) / SEGS) * Math.PI * 2);
      const col = r >= ROWS && dz < -0.5 ? ventC : shellC;
      for (let v = 0; v < 3; v++) cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const helmetMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, side: THREE.DoubleSide });
    helmetMat.flatShading = true;
    const shell = new THREE.Mesh(geo, helmetMat);
    shell.position.set(0, 0.025, -0.012);
    shell.add(helmetVents(shell, flat('#202329', 0.6)));
    g.add(shell);
    g.add(straps());
  }

  /**
   * Vélo du style réaliste (niveau de détail simplifié, matériaux à facettes) : cadre, livrée, inscriptions, roues,
   * cockpit, transmission. Null tant que la famille n'est pas chargée (le vélo est remonté à son arrivée) ou si elle
   * est indisponible. Gravel et VTT : leurs modèles complets.
   */
  private mountRealBike(look: AvatarLook, bike: BikeBuild): THREE.Group | null {
    const own = look.bikeType === 'gravel' || look.bikeType === 'mtb' ? look.bikeType : null;
    const family: FamilyKey = own ?? bike.family;
    if (failedFamilies.has(family)) return null;
    if (!bikeFamilyReady(family)) {
      const key = this.lookKey;
      void loadBikeFamily(family).then((ok) => {
        if (!ok) failedFamilies.add(family);
        else if (this.lookKey === key) this.build(look);
      });
      return null;
    }
    const a = assembleBike(bike, family, 1, look.bottles);
    // Roues bien rondes et rayonnées de près (niveau détaillé : 64 facettes), simplifiées au loin (20 facettes, sans
    // rayons) : chaque roue devient un LOD posé à son axe, qui tourne d'un bloc.
    const wheels = own
      ? a.wheels
      : a.wheels.map((far, i) => {
          const near = libraryWheel(bike, i === 0, 0);
          if (!near) return far;
          const lod = new THREE.LOD();
          lod.name = far.name;
          lod.position.copy(far.position);
          lod.scale.copy(far.scale);
          far.position.set(0, 0, 0);
          far.scale.set(1, 1, 1);
          far.parent?.add(lod);
          lod.addLevel(near, 0);
          lod.addLevel(far, NEAR_WHEELS);
          return lod;
        });
    const mats = new BikeMaterials(bike, look, family);
    this.realMats = mats;
    a.group.traverse((o) => {
      o.userData.shared = true;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Plaque de cadre : matériau texturé propre.
      if (mesh.userData.matKey === 'number') return;
      const m = mats.get((mesh.userData.matKey as string | undefined) ?? (mesh.material as THREE.Material).name);
      flatLook(m);
      mesh.material = m;
    });
    this.crank = a.crank ?? new THREE.Group();
    this.wheels = wheels;
    const pl = a.pedals.L;
    const pr = a.pedals.R;
    if (pl && pr) {
      this.pedals = [pl, pr];
      this.pedalX = Math.abs(pl.position.x);
    } else {
      for (let i = 0; i < 2; i++) {
        const p = new THREE.Mesh(box(0.075, 0.016, 0.09), flat('#1a1b1f', 0.6));
        this.pedals.push(p);
        a.group.add(p);
      }
    }
    // Prolongateurs de l'atelier (posés par assembleBike sur les cintres route) : poignées et repose-coudes.
    const clipKind = bike.extras?.aerobars;
    const anchors = bikeAnchors(family);
    this.clip = clipKind && !anchors.pads && !own ? aerobarAnchors(clipKind, anchors.hands) : null;
    // Compteur : l'écran du modèle lui-même s'allume (BikeMaterials.setComputer), collé sur le compteur.
    return a.group;
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
    // Douille d'un vrai cadre (route : stack 565 mm, reach 390, douille de 15 cm à 73°) : son bas est à 37 cm
    // de l'axe de roue (longueur d'une fourche), et le diagonal passe à 1 ou 2 cm du pneu.
    const headTop = mtb ? v3(0, 0.88, 0.39) : kind === 'retro' ? v3(0, 0.83, 0.405) : kind === 'gravel' ? v3(0, 0.87, 0.4) : v3(0, 0.85, 0.4);
    const headBottom = mtb ? v3(0, 0.72, 0.44) : v3(0, 0.7, 0.445);
    const k = mtb ? 1.35 : kind === 'retro' ? 0.7 : 1;
    const sides = kind === 'retro' ? 8 : 6;
    const sx = aeroTubes ? 0.7 : 1;
    const sz = aeroTubes ? 1.8 : 1;
    const frame = [
      tube(BB, seatTop, 0.02 * k, 0.02 * k, sides, sx, sz),
      tube(seatTop, headTop, 0.019 * k, 0.019 * k, sides, sx, aeroTubes ? 1.4 : 1),
      // Diagonal aéro moins profond vers la roue (il la frôlait).
      tube(BB, headBottom, 0.028 * k, 0.024 * k, sides, sx, aeroTubes ? 1.35 : 1),
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
    g.add(merged([tube(BB.clone().lerp(headBottom, 0.35), BB.clone().lerp(headBottom, 0.75), 0.03 * k, 0.03 * k, sides, sx, aeroTubes ? 1.4 : 1), tube(headBottom.clone().lerp(headTop, 0.2), headBottom.clone().lerp(headTop, 0.8), 0.029 * k, 0.029 * k, sides)], accentMat));

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
    const steer = headTop.clone().add(headTop.clone().sub(headBottom).normalize().multiplyScalar(0.035));
    parts.push(tube(seatTop, SADDLE.clone().setY(SADDLE.y - 0.03), 0.014 * (mtb ? 1.4 : 1)), saddle, tube(headTop, steer, 0.017, 0.017, 8), tube(steer.clone().add(v3(0, -0.005, -0.012)), stemEnd, 0.017, 0.016, 8), box(0.05, 0.036, 0.03, stemEnd.x, stemEnd.y, stemEnd.z));
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
      // Cocottes gris anthracite : distinctes du gant et du guidoline.
      const hoodMat = flat('#3a3d44', 0.6);
      const hoods: THREE.BufferGeometry[] = [];
      // Partie centrale (tops) : un peu plus épaisse au collier de potence.
      bar.push(tube(v3(0.05, 0.89, 0.55), v3(-0.05, 0.89, 0.55), 0.016, 0.016, 8));
      for (const s of [1, -1]) {
        // Tracé du cintre (côté +x), puis courbe régulière : tops → virage vers l'avant → sommet du crochet →
        // descente du drop → bas du cintre qui revient vers le coureur.
        const path = [
          [0.04, 0.89, 0.55],
          [0.15, 0.89, 0.55],
          [0.183, 0.889, 0.558],
          [0.199, 0.887, 0.582],
          [0.204, 0.884, 0.615],
          [0.205, 0.877, 0.645],
          [0.205, 0.862, 0.668],
          [0.205, 0.838, 0.68],
          [0.205, 0.81, 0.68],
          [0.205, 0.784, 0.668],
          [0.205, 0.765, 0.645],
          [0.205, 0.755, 0.615],
          [0.205, 0.752, 0.58],
          [0.205, 0.752, 0.535],
        ].map(([x, y, z], i, all) => {
          const f = Math.max(0, i - 5) / (all.length - 6);
          return v3(((x as number) + flare * f) * s, y as number, z as number);
        });
        bar.push(sweep(path, 0.0125, 8));
        // Cocotte : corps galbé posé sur le haut du crochet, plus haut et plus étroit vers l'avant, corne relevée.
        const hood = new THREE.CylinderGeometry(0.014, 0.017, 0.085, 7).rotateX(Math.PI / 2 - 0.25).scale(1, 1.25, 1).translate(0.205 * s, 0.904, 0.637);
        hoods.push(hood, new THREE.IcosahedronGeometry(0.011, 0).scale(1, 1.2, 1.1).translate(0.205 * s, 0.919, 0.676));
        // Levier de frein : lame qui descend devant le crochet.
        parts.push(tube(v3(0.205 * s, 0.9, 0.679), v3(0.205 * s, 0.84, 0.693), 0.007, 0.006, 5, 1, 2), tube(v3(0.205 * s, 0.84, 0.693), v3(0.205 * s, 0.79, 0.686), 0.006, 0.005, 5, 1, 2));
      }
      g.add(merged(hoods, hoodMat));
    }
    g.add(merged(bar, tapeMat));
    // Prolongateurs de l'atelier (mêmes pièces que l'avatar réaliste, aerobars.ts), sur le cintre route.
    this.clip = null;
    const clipKind = bike.extras?.aerobars;
    if (clipKind && fit.bar === 'drop' && kind !== 'gravel') {
      const bars = buildAerobars(clipKind, LOW_POLY_HOODS, 1);
      const foam = flat('#26282c', 0.85);
      bars.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = (m.material as THREE.Material).name === 'aerobar_pad' ? foam : dark;
      });
      g.add(bars);
      this.clip = aerobarAnchors(clipKind, LOW_POLY_HOODS);
    }
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
      // Moyeu : corps fin et deux flasques (plus grandes à l'arrière).
      const flangeR = i === 0 ? 0.026 : 0.021;
      const hub: THREE.BufferGeometry[] = [
        new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8).rotateZ(Math.PI / 2),
        new THREE.CylinderGeometry(flangeR, flangeR, 0.005, 12).rotateZ(Math.PI / 2).translate(0.034, 0, 0),
        new THREE.CylinderGeometry(flangeR, flangeR, 0.005, 12).rotateZ(Math.PI / 2).translate(-0.034, 0, 0),
      ];
      const spokes: THREE.BufferGeometry[] = [];
      if (type === 'disc') w.add(new THREE.Mesh(new THREE.CylinderGeometry(inner + 0.004, inner + 0.004, 0.024, 48).rotateZ(Math.PI / 2), liv.disc ? flat(liv.disc) : dark));
      else if (type === 'tri') {
        const blades = [0, 1, 2].map((n) => {
          const a = (n / 3) * Math.PI * 2;
          return tube(v3(0, 0, 0), v3(0, Math.sin(a) * inner, Math.cos(a) * inner), 0.012, 0.012, 4, 1, 3);
        });
        w.add(merged(blades, dark));
      } else {
        // Rayons fins (1,6 mm) : 20 radiaux devant, 24 croisés derrière (départ décalé sur la flasque), un sur
        // deux de chaque côté.
        const n = i === 0 ? 24 : type === 'box' ? 28 : 20;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const side = k % 2 ? 1 : -1;
          const cross = i === 0 ? (Math.floor(k / 2) % 2 ? 0.55 : -0.55) : 0;
          const b = a + cross;
          spokes.push(tube(v3(side * 0.034, Math.sin(b) * flangeR, Math.cos(b) * flangeR), v3(side * 0.004, Math.sin(a) * (inner + 0.002), Math.cos(a) * (inner + 0.002)), 0.0016, 0.0016, 4));
        }
      }
      w.add(merged(hub, metal));
      if (spokes.length) w.add(merged(spokes, type === 'box' ? metal : flat('#2b2d33', 0.45, 0.4)));
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
    if (this.gesture.crank !== undefined && !this.bindPose) this.crankAngle = this.gesture.crank;
    this.crank.rotation.x = this.crankAngle;
    const stand = this.poseBlend;
    // Virages : inclinaison adoucie et plafonnée (≈ 17°) ; l'angle physique, tout entier, couchait le vélo.
    const tilt = Math.max(-MAX_BANK, Math.min(MAX_BANK, bank * BANK_SHARE));
    // Le vélo bascule au rythme des coups de pédale, du côté opposé à la jambe qui appuie : à peine assis
    // (≈ ±0,5°), franchement en danseuse (≈ ±9°, comme les coureurs NCT vus de dos). Le bassin reste dans l'axe
    // du vélo et bascule avec lui ; le buste, droit du bassin aux épaules, reste presque d'aplomb (les bras
    // compensent : coude plié et ouvert du côté où le cintre remonte, bras tendu de l'autre). Moins à haute
    // vitesse : −60 % de 20 à 45 km/h.
    const pedaling = 1 - this.coastBlend;
    const fast = Math.min(1, Math.max(0, (speed * 3.6 - 20) / 25));
    // Sprint : le vélo est jeté franchement d'un côté à l'autre (≈ ±16°), même à pleine vitesse.
    this.sprintBlend += ((this.sprintOn ? 1 : 0) - this.sprintBlend) * (1 - Math.exp(-dt * 4));
    const sprint = this.sprintBlend * stand;
    const rock = -Math.sin(this.crankAngle) * (0.16 * stand + 0.12 * sprint + 0.009 * (1 - stand)) * pedaling * (1 - 0.6 * fast * (1 - sprint));
    this.lean.rotation.z = tilt + rock;
    /**
     * Décalage latéral (repère du vélo) d'un point du buste à la hauteur `y` : en danseuse, le buste pivote autour du
     * bassin (resté dans l'axe du vélo) pour revenir presque d'aplomb ; il reste droit, sans pliure. Assis : aucun.
     */
    const upright = (y: number) => 0.95 * stand * rock * (y - this.hip.y);
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
    this.dropsOn = bars && (speed > AERO_SPEED || (this.dropsOn && speed > AERO_SPEED_OUT));
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Très vite en pédalant : avant-bras sur le haut du cintre (> 50 km/h, quittée sous 46) ; très fort :
    // avant-bras à plat sur les cocottes.
    const hard = (on: boolean) => this.ftpFrac > HARD_EFFORT || (on && this.ftpFrac > HARD_EFFORT_OUT);
    this.clipOn = bars && !coasting && this.clip !== null && (speed > AERO_SPEED || (this.clipOn && speed > AERO_SPEED_OUT) || (speed > AERO_SPEED && hard(this.clipOn)));
    this.forearmsOn = bars && !coasting && !this.clip && (speed > FOREARMS_IN || (this.forearmsOn && speed > FOREARMS_OUT));
    this.hoodsAeroOn = bars && !coasting && !this.clip && !this.forearmsOn && speed > AERO_SPEED && hard(this.hoodsAeroOn);
    const tt = fit.bar === 'tt';
    this.hornsOn = tt && (pose === 'standing' || speed < 7 || (this.hornsOn && speed < 8));
    this.turtleOn = tt && !this.hornsOn && !coasting && (speed > FOREARMS_IN || (this.turtleOn && speed > FOREARMS_OUT) || (speed > AERO_SPEED && hard(this.turtleOn)));
    // Descente rapide : position aéro à partir de 45 km/h, en roue libre comme en pédalant.
    const aeroOn = bars ? (coasting ? smooth(AERO_SPEED, AERO_COAST_FULL, speed) : smooth(12.5, 14, speed) * (this.forearmsOn || this.clipOn ? 0 : 1)) : 0;
    const k2 = 1 - Math.exp(-dt * 2.5);
    this.dropsBlend += ((this.dropsOn ? 1 : 0) - this.dropsBlend) * k2;
    this.aeroBlend += (aeroOn - this.aeroBlend) * k2;
    this.forearmsBlend += ((this.forearmsOn ? 1 : 0) - this.forearmsBlend) * k2;
    this.hoodsAeroBlend += ((this.hoodsAeroOn ? 1 : 0) - this.hoodsAeroBlend) * k2;
    this.clipBlend += ((this.clipOn ? 1 : 0) - this.clipBlend) * k2;
    this.hornsBlend += ((this.hornsOn ? 1 : 0) - this.hornsBlend) * k2;
    this.turtleBlend += ((this.turtleOn ? 1 : 0) - this.turtleBlend) * k2;
    const horns = this.hornsBlend * (1 - this.celebrate);
    const turtle = this.turtleBlend * (1 - stand) * (1 - horns) * (1 - this.celebrate);
    const aero = this.aeroBlend * (1 - stand) * (1 - this.celebrate);
    const clip = this.clipBlend * (1 - stand) * (1 - this.celebrate) * (1 - aero);
    const forearms = this.forearmsBlend * (1 - stand) * (1 - this.celebrate) * (1 - aero);
    const hoodsAero = this.hoodsAeroBlend * (1 - stand) * (1 - this.celebrate) * (1 - aero) * (1 - forearms);
    const dropHands = Math.max(this.dropsBlend * (1 - stand) * (1 - forearms) * (1 - hoodsAero) * (1 - clip), aero, sprint) * (1 - this.celebrate);
    // Danseuse : bassin monté de 16 cm et avancé vers le pédalier ; il reste à l'aplomb pendant que le vélo bascule.
    // Sprint : bassin hors de la selle mais bas, au-dessus du bec de selle.
    const hip = this.hip.set(0, SADDLE.y + this.seatDy + 0.07 + 0.16 * stand - 0.07 * sprint, SADDLE.z + 0.02 + 0.23 * stand - 0.12 * sprint - 0.02 * aero);
    const up = this.celebrate;
    // Les bras levés ou la danseuse annulent la position de chrono (on se redresse).
    const fitK = 1 - Math.max(up, stand * 0.6);
    // Buste penché à ≈ 36° assis (comme les coureurs NCT), plus couché en chrono ; en danseuse, le buste plonge et
    // les épaules passent presque au-dessus des mains, coudes fléchis (GCN).
    // Sprint (vidéos Eurosport) : dos presque horizontal (≈ 17°), épaules basses et avancées au-dessus de la potence.
    const shoulder = this.shoulder.set(0, 1.395 + fit.shoulderDy * fitK + 0.07 * stand - 0.12 * sprint + 0.15 * up, 0.243 + fit.shoulderDz * fitK + 0.17 * stand + 0.08 * sprint - 0.23 * up);
    shoulder.y -= this.coastBlend * 0.03 * (1 - aero) + 0.13 * aero + 0.04 * dropHands * (1 - aero);
    shoulder.z += 0.07 * aero + 0.02 * dropHands * (1 - aero);
    // Dos à plat : épaules basses et avancées (avant-bras sur le cintre : jusqu'à poser les coudes).
    shoulder.y -= 0.15 * forearms + 0.12 * hoodsAero + 0.15 * clip;
    shoulder.z += 0.12 * forearms + 0.06 * hoodsAero + 0.1 * clip;
    // Chrono : buste relevé sur les cornes ; tortue : dos encore plus bas.
    shoulder.y += 0.1 * horns - 0.03 * turtle;
    shoulder.z += -0.07 * horns + 0.02 * turtle;
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
    // En danseuse, le bassin suit la ligne du buste (sinon il restait vertical sur le vélo : buste plié).
    J.pelvisFollow = stand;
    J.neck.copy(shoulder).add(v3(0, 0.05, 0.04));
    this.neck.set(shoulder.clone().add(v3(0, 0.02, 0.02)), neckTop);
    this.collar.set(shoulder.clone().add(v3(0, 0.0, 0.015)), shoulder.clone().add(v3(0, 0.045, 0.035)));
    this.head.position.copy(neckTop).add(v3(0, 0.07, 0.04));
    // Tête relevée pour regarder la route (le dos est penché vers l'avant).
    this.head.rotation.x = 0.3 + fit.headTilt * fitK - 0.12 * stand - 0.2 * sprint - 0.25 * up - 0.22 * aero - 0.18 * forearms - 0.12 * hoodsAero - 0.18 * clip - 0.18 * horns + 0.22 * turtle + (this.gesture.pitch ?? 0);
    this.head.rotation.y = this.gesture.yaw ?? 0;

    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 || this.bindPose ? 0 : Math.PI);
      const pedal = v3(0.125 * leg.side, this.bb.y - Math.cos(a) * CRANK, this.bb.z - Math.sin(a) * CRANK);
      const pm = this.pedals[leg.side > 0 ? 0 : 1];
      if (pm) pm.position.copy(pedal).setX(this.pedalX === null ? pedal.x : this.pedalX * leg.side);
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
      leg.shoe.position.copy(pedal).add(v3(0, 0.033, 0));
      leg.shoe.rotation.x = 0.15 + Math.sin(a) * 0.12;
    }
    for (const arm of this.arms) {
      // Seule l'articulation de l'épaule descend un peu du côté de la jambe qui appuie (±6 mm), buste immobile.
      const sh = shoulder.clone().add(v3(0.17 * arm.side, -0.04 - roll * 0.006 * arm.side, 0));
      // Mains au cintre (cocottes, guidon plat ou prolongateurs) ; bras levés en V pour fêter la victoire.
      // Cocottes, ou crochet du cintre (bas du cintre, aéro).
      const handBar = v3(fit.hand.x * arm.side, fit.hand.y - 0.135 * dropHands, fit.hand.z - 0.035 * dropHands);
      if (fit.bar === 'tt') handBar.add(this.ttHandFix);
      // Avant-bras sur le cintre : mains rapprochées devant la potence.
      if (forearms > 0) handBar.lerp(v3(0.05 * arm.side, 0.94, 0.74), forearms);
      // Vélo de chrono : mains sur les cornes ; tortue : mains plus hautes.
      if (horns > 0) handBar.lerp(v3(0.205 * arm.side, 0.875, 0.62).add(this.hornsFix), horns);
      handBar.y += 0.03 * turtle;
      // Prolongateurs : mains aux poignées.
      if (this.clip && clip > 0) handBar.lerp(arm.side > 0 ? this.clip.grips.L : this.clip.grips.R, clip);
      const handUp = sh.clone().add(v3(0.2 * arm.side, 0.52, 0.08));
      const hand = handBar.lerp(handUp, up);
      const elbow = new THREE.Vector3();
      // Coude qui s'ouvre légèrement du côté de l'épaule qui descend (roulis assis).
      // En danseuse, coudes nettement ouverts vers l'extérieur (coureurs vus de dos).
      const pole = v3((fit.elbowPole.x + Math.max(0, roll * arm.side) * 0.12 + 0.25 * stand) * arm.side, fit.elbowPole.y + up, fit.elbowPole.z);
      // Avant-bras à plat sur les cocottes : coudes tirés vers l'arrière ; sur le cintre : coudes posés dessous.
      if (hoodsAero > 0) pole.lerp(v3(0.3 * arm.side, -0.1, -1), hoodsAero);
      if (forearms > 0) pole.lerp(v3(0.15 * arm.side, -1, -0.1), forearms);
      if (clip > 0) pole.lerp(v3(0.1 * arm.side, -1, 0), clip);
      if (horns > 0) pole.lerp(v3(0.3 * arm.side, -0.75, -0.45), horns);
      solveTwoBone(sh, hand, UPPER_ARM, FOREARM, pole, elbow);
      // Manche courte : 60 % du bras, poignet de couleur, puis peau ; manche longue jusqu'au poignet.
      const sleeveEnd = this.longSleeves ? elbow : sh.clone().lerp(elbow, 0.6);
      arm.sleeve.set(sh, sleeveEnd);
      if (this.longSleeves) arm.cuff.set(elbow.clone().lerp(hand, 0.8), elbow.clone().lerp(hand, 0.9));
      else arm.cuff.set(sh.clone().lerp(elbow, 0.56), sh.clone().lerp(elbow, 0.66));
      arm.upper.set(this.longSleeves ? sh : sleeveEnd, elbow);
      arm.fore.set(elbow, hand);
      // Main posée à plat sur la cocotte, dans son axe (un peu plus inclinée au bas du cintre, à plat sur les
      // prolongateurs) ; elle ne suit l'avant-bras que bras levés.
      arm.glove.position.copy(hand);
      _handY.set(0, fit.bar === 'tt' ? -0.1 : -0.25 - 0.35 * dropHands, 1).normalize();
      _handZ.crossVectors(LEFT, _handY);
      arm.glove.quaternion.setFromRotationMatrix(_handM.makeBasis(LEFT, _handY, _handZ)).slerp(arm.fore.mesh.quaternion, up);
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

  /** Effort (puissance / FTP) : positions aéro quand on roule très fort. */
  setEffort(ftpFrac: number): void {
    this.ftpFrac = ftpFrac;
  }

  setGesture(g: RiderGesture): void {
    this.gesture = g;
  }

  /** Sprint en cours (segment de sprint ou effort maximal) : danseuse de sprint. */
  setSprint(on: boolean): void {
    this.sprintOn = on;
  }

  setCelebrating(on: boolean): void {
    this.celebrating = on;
  }

  setBareHead(on: boolean): void {
    this.bareHead = on;
    this.applyHeadwear();
  }

  /** Casque et lunettes : retirés tête nue (aperçu de l'éditeur de visage) ou par la tenue. */
  private applyHeadwear(): void {
    this.headgear.visible = !this.bareHead && !this.noHelmet;
    if (this.glasses) this.glasses.visible = !this.bareHead && !this.noGlasses && (!this.visorOn || this.noHelmet);
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
    if (this.realMats) {
      this.realMats.setComputer(d);
      return;
    }
    const sc = this.screen;
    if (!sc) return;
    const now = performance.now();
    if (now - sc.t < 250) return;
    sc.t = now;
    this.drawScreen(d);
  }

  /** Vélo seul (garage : vélos sur les râteliers et contre les murs). */
  setRiderVisible(on: boolean): void {
    this.riderHidden = !on;
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
