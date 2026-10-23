import * as THREE from 'three/webgpu';
import { color, emissive, float, fract, mrt, normalView, output, packNormalToRGB, pass, positionWorld, sample, step, uniform, unpackRGBToNormal, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type { AvatarLook, TuneSlot } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { onBikeFamilyLoaded } from '../rider/bikes.ts';
import type { Engine } from '../engine/renderer.ts';

/**
 * Atelier du garage : le vélo du joueur sur un pied d'atelier, dans une pièce procédurale (établi,
 * panneau perforé et outils, râtelier à roues, lampe chaude, home trainer dans un coin). Scène et
 * chaîne de rendu propres (bloom des jantes lumineuses), rendue à la demande comme l'image
 * d'accueil : seulement quand quelque chose change (pièce essayée, caméra, surbrillance) ou tant
 * qu'un effet animé est monté (film irisé, jantes lumineuses, décors holographiques).
 */

/** Ce que le menu demande à l'atelier. */
export interface AtelierState {
  look: AvatarLook;
  /** Emplacement mis en avant (caméra) ; « overview » : tout le vélo. */
  focus: TuneSlot | 'overview';
  /** Coureur en selle (vélo posé au sol) ou vélo seul sur le pied. */
  rider: boolean;
  /** Rotation de la vue autour du vélo (rad). */
  yaw: number;
  /** Matériaux à faire briller brièvement (pièce qui vient d'être changée). */
  pulse?: readonly string[];
  /** Cadrage imposé (bancs d'essai) : remplace celui de `focus`, sans rotation ni recul. */
  view?: Shot;
}

/** Matériaux du vélo concernés par chaque emplacement (surbrillance). */
export const SLOT_PARTS: Record<TuneSlot, readonly string[]> = {
  wheelset: ['rim', 'rim_decal', 'disc_face', 'spokes', 'hub', 'tire', 'tire_wall'],
  tyres: ['tire', 'tire_wall'],
  cockpit: ['bar_tape', 'spacers', 'topcap'],
  groupset: ['chain', 'chainring', 'crank', 'cassette', 'pulley', 'caliper'],
  crank: ['crank', 'chainring'],
  cassette: ['cassette'],
  pulleys: ['pulley'],
  rotors: ['rotor'],
  saddle: ['saddle'],
  seatpost: ['seatpost'],
  finish: ['frame'],
  paint: ['frame'],
  sticker: ['frame'],
  number: ['frame'],
  rimdecal: ['rim_decal'],
  spokes: ['spokes'],
  rimglow: ['rim_decal'],
  valves: ['valve'],
  tape: ['bar_tape'],
  bottles: ['bottle', 'cage'],
  topcap: ['topcap'],
  spacers: ['spacers'],
  bolts: ['bolts'],
  computer: ['computer'],
  chain: ['chain'],
};

export type Shot = { cam: [number, number, number]; look: [number, number, number]; fov: number };
/** Cadrages (repère du vélo : +z avant, +x à gauche, côté transmission en −x). */
const SHOTS: Record<'overview' | 'wheel' | 'cockpit' | 'drive' | 'rotor' | 'saddle' | 'frame' | 'bottles', Shot> = {
  overview: { cam: [2.7, 1.4, 2.15], look: [0, 0.66, 0], fov: 36 },
  wheel: { cam: [1.5, 0.78, 1.55], look: [0, 0.48, 0.55], fov: 34 },
  cockpit: { cam: [0.95, 1.5, 1.5], look: [0, 1.0, 0.5], fov: 32 },
  drive: { cam: [-1.55, 0.92, 0.55], look: [0, 0.42, -0.12], fov: 34 },
  rotor: { cam: [1.15, 0.66, 1.25], look: [0.04, 0.4, 0.58], fov: 30 },
  saddle: { cam: [1.35, 1.32, -1.15], look: [0, 0.95, -0.2], fov: 30 },
  frame: { cam: [2.7, 1.15, 0.45], look: [0, 0.68, 0.08], fov: 36 },
  bottles: { cam: [1.6, 1.0, 0.95], look: [0, 0.6, 0.15], fov: 32 },
};
const SLOT_SHOT: Record<TuneSlot | 'overview', keyof typeof SHOTS> = {
  overview: 'overview',
  wheelset: 'wheel',
  tyres: 'wheel',
  rimdecal: 'wheel',
  spokes: 'wheel',
  rimglow: 'wheel',
  valves: 'wheel',
  cockpit: 'cockpit',
  tape: 'cockpit',
  topcap: 'cockpit',
  spacers: 'cockpit',
  computer: 'cockpit',
  groupset: 'drive',
  crank: 'drive',
  cassette: 'drive',
  pulleys: 'drive',
  chain: 'drive',
  rotors: 'rotor',
  saddle: 'saddle',
  seatpost: 'saddle',
  number: 'saddle',
  paint: 'frame',
  finish: 'frame',
  sticker: 'frame',
  bottles: 'bottles',
  bolts: 'bottles',
};

/** Hauteur du vélo sur le pied d'atelier (roues décollées). */
const LIFT = 0.24;

const mat = (c: string, rough = 0.7, metal = 0): THREE.MeshStandardNodeMaterial => new THREE.MeshStandardNodeMaterial({ color: c, roughness: rough, metalness: metal });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

function cyl(r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Tube de rayon r entre deux points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), m);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  o.castShadow = true;
  return o;
}

/** Texture d'affiche (canevas) : texte sur fond, pour le mur de l'atelier. */
function posterTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 720;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 720);
  grad.addColorStop(0, '#1b2a4a');
  grad.addColorStop(1, '#0d1220');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 720);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 520, 512, 18);
  g.fillStyle = '#e63946';
  g.fillRect(0, 548, 512, 10);
  g.textAlign = 'center';
  g.fillStyle = '#ffd23f';
  g.font = 'italic 900 86px "Arial Black", Arial, sans-serif';
  g.fillText('ALLEZ', 256, 230);
  g.fillText('ROBERT !', 256, 330);
  g.fillStyle = '#f4f4f2';
  g.font = '700 34px Arial, sans-serif';
  g.fillText('ATELIER · DEPUIS 1972', 256, 420);
  g.font = '600 26px Arial, sans-serif';
  g.fillText('Châtillon · Chevreuse · Saclay', 256, 640);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Environnement de studio (reflets et lumière ambiante, préfiltré par PMREM) : pièce chaude et
 * sombre, grande boîte à lumière avant droite (lumière principale), panneau au plafond, deux bandes
 * de contre-jour derrière le coureur qui dessinent sa silhouette, fenêtre froide à droite.
 */
function studioEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicNodeMaterial({ color: '#2e2620', side: THREE.BackSide }));
  room.position.y = 2.6;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicNodeMaterial({ color: '#4a3c30' }));
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);
  const panel = (w: number, h: number, hex: string, power: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 1.1, 0);
    env.add(m);
  };
  panel(2.4, 1.8, '#fff3e4', 7, [-2.4, 2.9, 2.4]); // boîte à lumière principale
  panel(3, 3, '#ffeedd', 2.2, [0, 5.4, 0.3]); // plafond
  panel(0.6, 3.2, '#e8f0ff', 9, [-2.4, 2.2, -3.2]); // contre-jour gauche
  panel(0.6, 3.2, '#e8f0ff', 7, [2.4, 2.2, -3.2]); // contre-jour droit
  panel(1.6, 1.2, '#cfe0ff', 2.5, [4.8, 2.0, -0.5]); // fenêtre
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  pm.dispose();
  return rt.texture;
}

/** Roue suspendue au râtelier : pneu, jante, rayons, moyeu. */
function rackWheel(rim: string, deep: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.013, 10, 48), mat('#141416', 0.85));
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.3 - deep / 2, deep / 2, 8, 48), mat(rim, 0.35, 0.2));
  rimM.scale.set(1, 1, 0.45);
  g.add(tire, rimM);
  const spokeM = mat('#b9bcc2', 0.3, 1);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.27 - deep, 4), spokeM);
    s.position.set(Math.cos(a) * (0.15 - deep / 2), Math.sin(a) * (0.15 - deep / 2), 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12).rotateX(Math.PI / 2), mat('#2a2c30', 0.4, 0.5)));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** Pièce de l'atelier (repère : sol y = 0, vélo au centre, mur du fond en x = −3). */
function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'atelier_room';
  // Sol béton ciré avec un léger damier de dalles, tapis caoutchouc sous le pied.
  const tile = uniform(0.6);
  const floorM = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  const p = positionWorld;
  const joint = step(0.985, fract(p.x.div(tile))).add(step(0.985, fract(p.z.div(tile)))).clamp(0, 1);
  floorM.colorNode = color('#8a8178').mul(float(1).sub(joint.mul(0.25)));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), floorM);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);
  const mat_ = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), mat('#202224', 0.95));
  mat_.rotation.x = -Math.PI / 2;
  mat_.position.set(0, 0.003, 0);
  mat_.receiveShadow = true;
  room.add(mat_);
  // Murs (enduit chaud) et plafond.
  const wallM = mat('#d8c7ad', 0.9);
  const walls: Array<[number, number, number, number, number]> = [
    // largeur, x, z, rotation y
    [7, -3.2, 0, Math.PI / 2, 0],
    [7, 3.4, 0, -Math.PI / 2, 0],
    [6.6, 0.1, -3.0, 0, 0],
    [6.6, 0.1, 3.4, Math.PI, 0],
  ];
  for (const [w, x, z, ry] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), wallM);
    m.position.set(x, 1.6, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    room.add(m);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), mat('#e6dccb', 0.95));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.2;
  room.add(ceil);
  // Plinthe sombre.
  room.add(box(0.02, 0.12, 6.4, mat('#4a3b2e', 0.8), -3.19, 0.06, 0.2));

  // Établi le long du mur du fond : plateau bois, pieds, étau, caisse à outils rouge.
  const wood = mat('#a0703f', 0.75);
  room.add(box(0.75, 0.06, 2.4, wood, -2.78, 0.92, -0.9));
  for (const [x, z] of [[-3.05, -2.0], [-3.05, 0.2], [-2.5, -2.0], [-2.5, 0.2]] as const) room.add(box(0.06, 0.9, 0.06, mat('#3a3c40', 0.5, 0.6), x, 0.45, z));
  room.add(box(0.7, 0.04, 2.3, wood, -2.78, 0.25, -0.9));
  room.add(box(0.16, 0.12, 0.22, mat('#2f5d8a', 0.45, 0.6), -2.55, 1.01, -1.75));
  room.add(box(0.36, 0.22, 0.6, mat('#c0262d', 0.4, 0.3), -2.82, 1.06, -0.25));
  room.add(box(0.32, 0.03, 0.56, mat('#1a1b1e', 0.4, 0.6), -2.82, 1.18, -0.25));
  // Pots de peinture et bombes sur l'établi.
  ['#e63946', '#ffd23f', '#1e5bd8', '#2a9d8f'].forEach((c, i) => room.add(cyl(0.05, 0.12, mat(c, 0.5), -2.92, 1.01, -1.3 + i * 0.13)));
  [0, 1, 2].forEach((i) => room.add(cyl(0.028, 0.2, mat(['#f4f4f2', '#111214', '#d4af37'][i] as string, 0.3, 0.4), -2.62, 1.05, -1.2 + i * 0.08, 12)));

  // Panneau perforé et outils au-dessus de l'établi.
  const pegM = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const holes = step(0.82, fract(p.z.mul(20))).mul(step(0.82, fract(p.y.mul(20))));
  pegM.colorNode = color('#b98e5f').mul(float(1).sub(holes.mul(0.75)));
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), pegM);
  peg.rotation.y = Math.PI / 2;
  peg.position.set(-3.18, 1.75, -0.9);
  peg.receiveShadow = true;
  room.add(peg);
  const steel = mat('#aab0b8', 0.3, 1);
  // Clés plates de tailles croissantes, marteau, tournevis, pinces, démonte-pneus.
  for (let i = 0; i < 7; i++) {
    const L = 0.14 + i * 0.025;
    const k = box(0.012, L, 0.022, steel, -3.15, 1.85 - L / 2 + 0.1, -1.95 + i * 0.075);
    room.add(k);
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.018 + i * 0.002, 0.006, 6, 14), steel);
    head.rotation.y = Math.PI / 2;
    head.position.set(-3.15, 1.86 + 0.1, -1.95 + i * 0.075);
    room.add(head);
  }
  room.add(box(0.03, 0.3, 0.025, mat('#6b4a2b', 0.7), -3.15, 1.65, -1.3));
  room.add(box(0.035, 0.05, 0.14, steel, -3.15, 1.82, -1.3));
  ['#e63946', '#ffd23f', '#1e5bd8', '#111214', '#2a9d8f'].forEach((c, i) => {
    room.add(cyl(0.013, 0.1, mat(c, 0.45), -3.14, 1.7, -1.05 + i * 0.06, 10));
    room.add(cyl(0.004, 0.12, steel, -3.14, 1.59, -1.05 + i * 0.06, 6));
  });
  for (const [z, c] of [[-0.6, '#d0021b'], [-0.48, '#1e5bd8'], [-0.36, '#ffd23f']] as const) {
    room.add(box(0.01, 0.12, 0.025, mat(c, 0.5), -3.15, 1.7, z));
  }
  // Pompe à pied contre l'établi.
  room.add(cyl(0.022, 0.62, mat('#d0021b', 0.4, 0.3), -2.35, 0.31, 0.55, 12));
  room.add(box(0.2, 0.025, 0.08, mat('#1a1b1e', 0.6), -2.35, 0.012, 0.55));
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 16).rotateZ(Math.PI / 2), mat('#f4f4f2', 0.3));
  gauge.position.set(-2.35, 0.2, 0.55);
  room.add(gauge);

  // Râtelier à roues sur le mur de gauche (z = −3).
  room.add(box(2.0, 0.05, 0.06, mat('#3a3c40', 0.5, 0.6), 0.4, 2.35, -2.95));
  ([['#1b1c1f', 0.05], ['#d4af37', 0.03], ['#1b1c1f', 0.065], ['#c0c6cf', 0.02]] as const).forEach(([c, deep], i) => {
    const w = rackWheel(c, deep);
    w.position.set(-0.4 + i * 0.55, 1.98, -2.88);
    room.add(w);
    room.add(cyl(0.008, 0.06, steel, -0.4 + i * 0.55, 2.31, -2.92, 8));
  });
  // Affiche et étagère de pneus.
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), new THREE.MeshStandardNodeMaterial({ map: posterTexture(), roughness: 0.7 }));
  poster.position.set(1.9, 1.75, -2.98);
  room.add(poster);
  room.add(box(1.0, 0.03, 0.3, wood, 2.8, 1.2, -2.85));
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 24), mat('#141416', 0.85));
    t.position.set(2.5 + i * 0.28, 1.35, -2.85);
    t.castShadow = true;
    room.add(t);
  }

  // Home trainer dans le coin : corps, volant, pieds, câble.
  const tr = new THREE.Group();
  tr.add(box(0.3, 0.42, 0.55, mat('#111214', 0.4, 0.2), 0, 0.33, 0));
  const fly = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 32).rotateZ(Math.PI / 2), mat('#2a2c30', 0.35, 0.8));
  fly.position.set(0.17, 0.33, 0);
  tr.add(fly);
  tr.add(box(0.95, 0.04, 0.06, mat('#2a2c30', 0.5, 0.6), 0, 0.03, -0.18));
  tr.add(box(0.95, 0.04, 0.06, mat('#2a2c30', 0.5, 0.6), 0, 0.03, 0.22));
  tr.add(box(0.02, 0.05, 0.3, mat('#ffd23f', 0.5), -0.16, 0.45, 0));
  tr.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  tr.position.set(2.6, 0, 2.6);
  tr.rotation.y = 0.6;
  room.add(tr);
  // Fenêtre lumineuse sur le mur de droite (vue côté transmission).
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshStandardNodeMaterial({ color: '#000000', emissive: '#dfeaff', emissiveIntensity: 0.6 }));
  win.rotation.y = -Math.PI / 2;
  win.position.set(3.39, 1.8, -0.4);
  room.add(win);
  room.add(box(0.04, 1.06, 0.04, mat('#f4f4f2', 0.6), 3.37, 1.8, -0.4));

  // Suspension : abat-jour et ampoule (émissive, diffuse un peu avec le bloom).
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 24, 1, true), new THREE.MeshStandardNodeMaterial({ color: '#2f5d4a', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
  shade.position.set(0, 2.55, 0);
  room.add(shade);
  room.add(cyl(0.006, 0.55, mat('#111214'), 0, 2.92, 0, 6));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardNodeMaterial({ color: '#000000', emissive: '#ffd9a0', emissiveIntensity: 3 }));
  bulb.position.set(0, 2.47, 0);
  room.add(bulb);
  return room;
}

/** Pied d'atelier : trépied, colonne, bras, mâchoire sur la tige de selle. */
function buildStand(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'atelier_stand';
  const red = mat('#c0262d', 0.4, 0.4);
  const steel = mat('#3a3c40', 0.4, 0.8);
  // Colonne derrière le vélo, bras court jusqu'au tube de selle (≈ 0,70 m sur le vélo, + levée).
  const base = new THREE.Vector3(-0.42, 0, -0.66);
  const hub = new THREE.Vector3(base.x, 0.28, base.z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    g.add(rod(hub, new THREE.Vector3(base.x + Math.cos(a) * 0.4, 0.01, base.z + Math.sin(a) * 0.4), 0.014, steel));
  }
  const clamp = new THREE.Vector3(-0.05, 0.7 + LIFT, -0.13);
  const top = new THREE.Vector3(base.x, clamp.y + 0.06, base.z);
  g.add(rod(new THREE.Vector3(base.x, 0.02, base.z), top, 0.022, red));
  g.add(rod(top, clamp, 0.018, red));
  g.add(box(0.06, 0.07, 0.07, steel, clamp.x - 0.02, clamp.y, clamp.z));
  return g;
}

export class AtelierHost {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 40);
  private pipeline: THREE.RenderPipeline | null = null;
  private avatar: RiderAvatarLike | null = null;
  private readonly bikeRoot = new THREE.Group();
  private stand: THREE.Group | null = null;
  private lookKey = '';
  private state: AtelierState | null = null;
  /** Images à rendre (0 : rien ne bouge). */
  private frames = 0;
  /** Caméra : position et cible courantes, interpolées vers le cadrage demandé. */
  private readonly camPos = new THREE.Vector3(2.5, 1.6, 2.1);
  private readonly camLook = new THREE.Vector3(0, 0.9, 0);
  private camFov = 36;
  private readonly goalPos = new THREE.Vector3();
  private readonly goalLook = new THREE.Vector3();
  private goalFov = 36;
  private pulseT = 1;
  private pulseParts: readonly string[] = [];
  private lastT = 0;
  /** Effet animé monté (film irisé, jantes lumineuses, lettres holographiques) : rendu continu. */
  private animated = false;
  private lastAnimRender = 0;

  constructor(private readonly engine: Engine) {
    this.scene.add(this.bikeRoot);
    onBikeFamilyLoaded(() => {
      if (this.state) this.frames = Math.max(this.frames, 2);
    });
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Construction paresseuse : pièce, lumières, environnement, chaîne de rendu. */
  private build(): void {
    if (this.pipeline) return;
    this.scene.background = new THREE.Color('#2a2420');
    this.scene.environment = studioEnvironment(this.engine.renderer);
    this.scene.environmentIntensity = 0.4;
    this.scene.add(buildRoom());
    this.scene.add(new THREE.HemisphereLight(0xffe7c7, 0x3a3027, 0.2));
    // Éclairage de studio : lumière principale douce de côté (à droite du coureur, à l'opposé des
    // caméras de l'atelier : le volume se lit), plafonnier (ombre au sol), contre-jours froids qui
    // détachent la silhouette du fond, débouchage léger côté caméra.
    const key = new THREE.SpotLight(0xfff1e2, 80, 12, 0.5, 1, 1.4);
    key.position.set(-2.4, 3.0, 2.2);
    key.target.position.set(0, 0.95, 0.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 6;
    this.scene.add(key, key.target);
    const lamp = new THREE.SpotLight(0xffd6a0, 10, 9, 0.85, 0.7, 1.6);
    lamp.position.set(0, 2.45, 0);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.radius = 8;
    this.scene.add(lamp, lamp.target);
    for (const [x, power] of [[-1.6, 4], [1.6, 2.8]] as const) {
      const rim = new THREE.DirectionalLight(0xe6eeff, power);
      rim.position.set(x, 2.4, -3.0);
      rim.target.position.set(0, 1.0, 0);
      this.scene.add(rim, rim.target);
    }
    const benchLight = new THREE.PointLight(0xffc58a, 4, 4, 1.5);
    benchLight.position.set(-2.4, 1.9, -0.9);
    this.scene.add(benchLight);
    const fill = new THREE.PointLight(0xfff0dc, 2, 6, 1.2);
    fill.position.set(2.4, 1.4, 2.4);
    this.scene.add(fill);
    this.stand = buildStand();
    this.scene.add(this.stand);
    this.pipeline = new THREE.RenderPipeline(this.engine.renderer);
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive, normal: packNormalToRGB(normalView) }));
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    const col = scenePass.getTextureNode('output');
    // Occlusion ambiante (plis du tissu, aisselles, contact avec le sol), comme en jeu.
    const normalTex = scenePass.getTextureNode('normal');
    const aoPass = ao(scenePass.getTextureNode('depth'), sample((uvNode) => unpackRGBToNormal(normalTex.sample(uvNode))), this.camera);
    aoPass.radius.value = 0.35;
    aoPass.distanceExponent.value = 1;
    aoPass.thickness.value = 1;
    const occ = aoPass.getTextureNode().r.mul(0.7).add(0.3);
    const glow = bloom(scenePass.getTextureNode('emissive'), 0.55, 0.35, 0);
    this.pipeline.outputNode = vec4(col.rgb.mul(occ), col.a).add(glow);
  }

  /** Nouvel état demandé par le menu (null : l'atelier se ferme). */
  set(st: AtelierState | null): void {
    if (!st) {
      this.state = null;
      return;
    }
    this.build();
    const first = !this.state;
    this.state = st;
    const key = JSON.stringify(st.look);
    if (!this.avatar) {
      this.avatar = createAvatar(st.look);
      this.bikeRoot.add(this.avatar.root);
      this.lookKey = key;
    } else if (key !== this.lookKey) {
      this.avatar.setLook(st.look);
      this.lookKey = key;
    }
    const av = this.avatar as RiderAvatarLike & { setRiderVisible?(on: boolean): void };
    av.setRiderVisible?.(st.rider);
    // Coureur en selle : vélo au sol (pied replié) ; sinon sur le pied d'atelier, roues décollées.
    this.bikeRoot.position.y = st.rider ? 0 : LIFT;
    if (this.stand) this.stand.visible = !st.rider;
    for (let i = 0; i < 4; i++) this.avatar.update(1 / 60, 0, 0, 'coasting');
    if (st.pulse?.length) {
      this.pulseParts = st.pulse;
      this.pulseT = 0;
    }
    const tune = st.look.tune ?? [];
    this.animated = tune.some((id) => /^tune-(gl-|ev-streak30|fi-irise|rd-holo|pa-aurore)/.test(id));
    this.aim(first);
    this.frames = Math.max(this.frames, 3);
  }

  /** Cadrage demandé : imposé (`view`) ou celui de l'emplacement. */
  private aim(snap: boolean): void {
    const st = this.state;
    if (!st) return;
    if (st.view) {
      this.goalPos.set(...st.view.cam);
      this.goalLook.set(...st.view.look);
      this.goalFov = st.view.fov;
    } else this.aimShot(st);
    if (snap) {
      this.camPos.copy(this.goalPos);
      this.camLook.copy(this.goalLook);
      this.camFov = this.goalFov;
    }
  }

  /** Cadrage de l'emplacement demandé, tourné de `yaw` autour du vélo. */
  private aimShot(st: AtelierState): void {
    const shot = SHOTS[SLOT_SHOT[st.focus] ?? 'overview'];
    const lift = st.rider ? 0 : LIFT;
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const [x, y, z] = shot.cam;
    // Coureur affiché : un peu plus de recul.
    const k = st.rider && SLOT_SHOT[st.focus] === 'overview' ? 1.25 : 1;
    this.goalPos.set((x * c + z * s) * k, y + lift + (k - 1) * 0.4, (-x * s + z * c) * k);
    this.goalLook.set(shot.look[0], shot.look[1] + lift + (k - 1) * 0.25, shot.look[2]);
    this.goalFov = shot.fov;
  }

  /** À appeler à chaque image de la boucle du menu ; rend si besoin. Renvoie vrai si l'atelier est ouvert. */
  tick(now = performance.now()): boolean {
    if (!this.state || !this.pipeline) return false;
    const dt = Math.min((now - (this.lastT || now)) / 1000, 0.1);
    this.lastT = now;
    // Caméra : approche amortie du cadrage demandé.
    const k = 1 - Math.exp(-dt * 7);
    const moving = this.camPos.distanceToSquared(this.goalPos) > 1e-6 || this.camLook.distanceToSquared(this.goalLook) > 1e-6 || Math.abs(this.camFov - this.goalFov) > 0.01;
    if (moving) {
      this.camPos.lerp(this.goalPos, k);
      this.camLook.lerp(this.goalLook, k);
      this.camFov += (this.goalFov - this.camFov) * k;
      this.frames = Math.max(this.frames, 1);
    }
    // Surbrillance de la pièce changée : éclat bref (0,7 s).
    if (this.pulseT < 1) {
      this.pulseT = Math.min(1, this.pulseT + dt / 0.7);
      const a = Math.sin(Math.PI * this.pulseT) ** 2;
      (this.avatar as { highlightBike?(n: readonly string[], a: number): void } | null)?.highlightBike?.(this.pulseParts, this.pulseT >= 1 ? 0 : a);
      this.frames = Math.max(this.frames, 1);
    }
    // Effets animés : ~30 images/s suffisent.
    if (this.animated && now - this.lastAnimRender > 33) this.frames = Math.max(this.frames, 1);
    if (this.frames <= 0) return true;
    this.frames--;
    this.lastAnimRender = now;
    this.render();
    return true;
  }

  private render(): void {
    const canvas = this.engine.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const cam = this.camera;
    cam.aspect = w / h;
    // Écran large : le vélo à gauche du panneau de l'atelier (à droite).
    if (cam.aspect > 1.2) cam.setViewOffset(w, h, w * 0.07, 0, w, h);
    else cam.clearViewOffset();
    cam.fov = cam.aspect > 1.2 ? this.camFov : this.camFov * 1.45;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    cam.updateProjectionMatrix();
    this.pipeline?.render();
  }

  /** Rendu immédiat hors boucle d'animation (onglet masqué, captures) : comme engine.renderManual. */
  renderManual(): void {
    if (!this.state || !this.pipeline) return;
    this.camPos.copy(this.goalPos);
    this.camLook.copy(this.goalLook);
    this.camFov = this.goalFov;
    const r = this.engine.renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } }; info: { frame: number } };
    r._nodes.nodeFrame.update();
    r.info.frame = r._nodes.nodeFrame.frameId;
    this.render();
  }
}
