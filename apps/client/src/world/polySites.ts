import * as THREE from 'three/webgpu';
import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import { box, MeshBuilder, part, prism, template, type LandProbe, type Template } from './lowPolyKit.ts';
import { KERBROU_HARBOUR, ROBERTVILLE_HARBOUR, buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from './polyHarbour.ts';
import type { BirdPerch, LifeChunk, PersonSpot } from './roadsideLife.ts';
import { ROBERT_ISLAND } from './worlds.ts';
import { crossingSites, outdoorSites } from './polyOutdoor.ts';

/**
 * Lieux phares de l'île (mode Poly) : ports de Robertville et de Kerbrou, circuit de l'Anneau et fête en son centre,
 * place du marché de Saint-Robert. Décor original en primitives, posé aux coordonnées du générateur (tools/island) ;
 * chaque lieu est un maillage fixe, plus quelques pièces animées et des places de personnages (roadsidePeople.ts).
 */
const WHITE = new THREE.Color(0xffffff);
const UP = new THREE.Vector3(0, 1, 0);
const C = (...list: string[]) => list.map((c) => new THREE.Color(c));
export const GAY = C('#e2604f', '#f4d35e', '#2f9c95', '#5c6bc0', '#ef8fb0', '#ff8a3d', '#4fa3d9', '#7fb069');

/** Circuit (tools/island/src/design.ts, ANNEAU). */
export const RING = { x: -4700, z: 900, half: 560, radius: 215 } as const;
/** Place de Saint-Robert : croisement des deux rues principales, axe de la Grand-Rue. */
const SQUARE = { x: 300, z: -200, angle: 0.08 } as const;

/** Distance à l'axe de l'Anneau (m). */
export function ringDistance(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - RING.x) - RING.half);
  const d = Math.hypot(dx, z - RING.z) - RING.radius;
  // Lignes droites un peu bombées vers l'extérieur (18 m au plus).
  return dx === 0 ? Math.max(0, d - 19, -d) : Math.abs(d);
}

interface Moving {
  object: THREE.Object3D;
  step: (t: number, dt: number) => void;
}

/** Ce qu'un lieu construit : maillage fixe (via `mesh`), pièces animées, personnages et oiseaux. */
interface Built {
  meshes: THREE.Mesh[];
  moving: Moving[];
  chunk: LifeChunk;
  x: number;
  z: number;
}

export interface SiteContext {
  mesh: MeshBuilder;
  probe: LandProbe;
  season: Season;
  density: number;
  spots: PersonSpot[];
  perches: BirdPerch[];
  flowers: number[];
  moving: Moving[];
  mat: THREE.Material;
  /** Termine un morceau : maillage à part, écarté du champ et de la carte d'ombre séparément. */
  flush(): void;
}

export interface Site {
  id: string;
  x: number;
  z: number;
  reach: number;
  /** Points dont la tuile doit être prête. */
  needs: ReadonlyArray<readonly [number, number]>;
  /** Construction par pas (quelques millisecondes par image). */
  build(c: SiteContext): Generator<void>;
}

// ───────────────────────────── Gabarits

const person = (shirt: string, pants: string) => [
  part(box(0.3, 0.75, 0.2, 0, 0.42), pants),
  part(box(0.4, 0.58, 0.24, 0, 1.08), shirt, shirt === '#ffffff' ? 1 : 0),
  part(new THREE.IcosahedronGeometry(0.13, 0).translate(0, 1.52, 0), '#e0b48f'),
  part(box(0.22, 0.08, 0.2, 0, 1.63), '#3a2a1e'),
];

function kit() {
  return {
    /** Gradin de 12 m : sept rangs face à −z, dossiers colorés, garde-corps. */
    stand: template([
      ...Array.from({ length: 7 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -3.4 + i * 0.95), i % 2 ? '#c9c4b8' : '#d6d1c4')),
      ...Array.from({ length: 7 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -3.4 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12, 0.08, 0.08, 0, 1.2, -3.95), '#3a4a52'),
      ...[-5.9, -3, 0, 3, 5.9].map((x) => part(box(0.08, 1.2, 0.08, x, 0.6, -3.95), '#3a4a52')),
      part(box(12.4, 0.22, 8.6, 0, 6.6, -0.4).rotateX(-0.06), '#f2efe6'),
      part(box(12.4, 0.5, 0.12, 0, 6.55, -4.7), '#ffffff', 1),
      ...[-5.8, 5.8].flatMap((x) => [part(prism(0.12, 0.1, 0, 6.6, 6, x, 3.2), '#8f9699'), part(prism(0.09, 0.08, 0, 6.6, 6, x, -3.9), '#8f9699')]),
    ]),
    fan: template(person('#ffffff', '#3b5b8a')),
    /** Barnum d'équipe ouvert, 4 × 4 m. */
    tent: template([
      ...[-1.9, 1.9].flatMap((x) => [-1.9, 1.9].map((z) => part(prism(0.05, 0.05, -0.1, 2.3, 5, x, z), '#e9e6dc'))),
      part(new THREE.CylinderGeometry(0.05, 2.95, 1.1, 4, 1).rotateY(Math.PI / 4).translate(0, 2.85, 0), '#ffffff', 1),
      part(box(4, 0.32, 4, 0, 2.28), '#f7f3e8'),
      part(box(1.8, 0.08, 0.8, 0, 0.8, -0.6), '#c9c2b1'),
      ...[-0.8, 0.8].map((x) => part(box(0.06, 0.8, 0.6, x, 0.4, -0.6), '#8f9699')),
    ]),
    van: template([
      part(box(2, 1.55, 4.4, 0, 1.35), '#ffffff', 1),
      part(box(2, 0.75, 0.9, 0, 0.85, 2.5), '#ffffff', 1),
      part(box(1.85, 0.6, 0.08, 0, 1.75, 2.24), '#3e5a66'),
      part(box(2.02, 0.55, 1.2, 0, 1.7, 1.4), '#3e5a66'),
      ...[-0.95, 0.95].flatMap((x) => [-1.5, 1.8].map((z) => part(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 8).rotateZ(Math.PI / 2).translate(x, 0.36, z), '#23262b'))),
    ]),
    camper: template([
      part(box(2.2, 2, 5, 0, 1.65, -0.4), '#f4f1e8'),
      part(box(2.22, 0.35, 5.02, 0, 1.5, -0.4), '#ffffff', 1),
      part(box(2.1, 1.1, 1.2, 0, 1.0, 2.6), '#f4f1e8'),
      part(box(1.9, 0.55, 0.06, 0, 1.45, 3.0), '#3e5a66'),
      part(box(2.24, 0.6, 1.4, 0, 2.0, -0.9), '#4a6f83'),
      part(box(2.6, 0.06, 2.2, 1.9, 2.4, -0.4).rotateZ(-0.08), '#e9d9b0'),
      ...[-1.05, 1.05].flatMap((x) => [-2, 2].map((z) => part(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 8).rotateZ(Math.PI / 2).translate(x, 0.4, z), '#23262b'))),
    ]),
    igloo: template([part(new THREE.IcosahedronGeometry(1.3, 1).scale(1, 0.75, 1.25), '#ffffff', 1), part(box(0.8, 0.8, 0.06, 0, 0.4, 1.58), '#3a3f44')]),
    /** Camion de restauration, auvent levé vers +z. */
    truck: template([
      part(box(4.6, 2.2, 2.1, 0, 1.65), '#ffffff', 1),
      part(box(3, 0.1, 1.2, -0.3, 2.45, 1.5).rotateX(0.18), '#f7ebd2'),
      part(box(3, 0.95, 0.05, -0.3, 1.75, 1.06), '#2b2f33'),
      part(box(3.1, 0.08, 0.5, -0.3, 1.22, 1.25), '#d9c7a8'),
      part(box(1.3, 1.5, 2, 2.85, 1.1), '#f4f1e8'),
      part(box(0.06, 0.6, 1.7, 3.5, 1.5), '#3e5a66'),
      ...[-1.5, 2.7].flatMap((x) => [-0.95, 0.95].map((z) => part(new THREE.CylinderGeometry(0.4, 0.4, 0.24, 8).rotateX(Math.PI / 2).translate(x, 0.4, z), '#23262b'))),
    ]),
    table: template([part(box(1.8, 0.08, 0.8, 0, 0.75), '#b08660'), ...[-0.7, 0.7].map((x) => part(box(0.08, 0.75, 0.6, x, 0.37), '#8b6a4a')), ...[-0.75, 0.75].map((z) => part(box(1.8, 0.06, 0.3, 0, 0.45, z), '#b08660'))]),
    parasol: template([part(prism(0.04, 0.04, 0, 2.4, 5), '#e9e6dc'), part(new THREE.CylinderGeometry(0.05, 1.6, 0.6, 8, 1).translate(0, 2.35, 0), '#ffffff', 1)]),
    round: template([part(prism(0.45, 0.45, 0.72, 0.77, 8), '#f2efe6'), part(prism(0.04, 0.04, 0, 0.72, 5), '#3a3f44'), ...[0, 1, 2].map((i) => part(box(0.4, 0.45, 0.4, Math.cos(i * 2.1) * 0.85, 0.24, Math.sin(i * 2.1) * 0.85), '#ffffff', 1))]),
    /** Étal de marché : plateau incliné vers +z, toile rayée. */
    stall: template([
      ...[-1.3, 1.3].flatMap((x) => [-0.9, 0.9].map((z) => part(prism(0.045, 0.045, 0, 2.3, 5, x, z), '#8b6a4a'))),
      ...[-1.05, -0.35, 0.35, 1.05].map((x, i) => part(box(0.7, 0.06, 2.4, x, 2.45).rotateX(0.14), i % 2 ? '#f7f3e8' : '#ffffff', i % 2 ? 0 : 1)),
      part(box(2.6, 0.1, 1.1, 0, 0.85, 0.35).rotateX(0.12), '#b08660'),
      part(box(2.6, 0.7, 0.06, 0, 0.45, 0.85), '#ffffff', 1),
      ...[-0.9, -0.3, 0.3, 0.9].flatMap((x, i) => [0.15, 0.6].map((z, j) => part(box(0.5, 0.14, 0.4, x, 1.0 - j * 0.06, z), ['#d9443a', '#e9a23b', '#5f9a3a', '#8e4fa3', '#f2d35e', '#c96a3a', '#7fb069', '#e8e2d2'][i * 2 + j]!))),
    ]),
    /** Kiosque à musique : socle, colonnettes, toit en pointe. */
    bandstand: template([
      part(prism(4.2, 4.2, 0, 0.8, 8), '#e9e2d0'),
      ...Array.from({ length: 8 }, (_, i) => part(prism(0.12, 0.12, 0.8, 3.6, 6, Math.cos((i * Math.PI) / 4) * 3.8, Math.sin((i * Math.PI) / 4) * 3.8), '#3e6b52')),
      part(new THREE.ConeGeometry(4.8, 2.2, 8).translate(0, 4.7, 0), '#ffffff', 1),
    ]),
    fountain: template([
      part(prism(2.6, 2.6, 0, 0.55, 12), '#c9bfa8'),
      part(prism(2.3, 2.3, 0.5, 0.58, 12), '#5fb2d9'),
      part(prism(0.35, 0.3, 0.5, 1.7, 8), '#c9bfa8'),
      part(prism(0.2, 1.0, 1.6, 1.85, 10), '#c9bfa8'),
      part(prism(0.9, 0.9, 1.84, 1.88, 10), '#7cc4e4'),
      part(new THREE.IcosahedronGeometry(0.25, 0).translate(0, 2.1, 0), '#8f7f5a'),
    ]),
    /** Cycliste de bronze sur son socle. */
    statue: template([
      part(box(3, 0.5, 1.4, 0, 0.25), '#bdb5a4'),
      part(box(2.4, 1, 0.9, 0, 1), '#d0c8b6'),
      ...[-0.55, 0.55].map((x) => part(new THREE.TorusGeometry(0.36, 0.045, 5, 12).translate(x, 1.9, 0), '#6f5a34')),
      part(box(1.0, 0.06, 0.06, 0.02, 2.25).rotateZ(0), '#6f5a34'),
      part(box(0.06, 0.5, 0.06, -0.2, 2.1).rotateZ(0.02), '#6f5a34'),
      part(box(0.75, 0.22, 0.24, 0.05, 2.72).rotateZ(0.1), '#7a6338'),
      part(box(0.14, 0.75, 0.14, -0.05, 2.2).rotateZ(0.03), '#7a6338'),
      part(box(0.55, 0.1, 0.12, 0.45, 2.48).rotateZ(0.02), '#7a6338'),
      part(new THREE.IcosahedronGeometry(0.16, 0).translate(0.46, 2.98, 0), '#7a6338'),
    ]),
    bench: template([part(box(1.8, 0.09, 0.45, 0, 0.45), '#a87850'), part(box(1.8, 0.3, 0.07, 0, 0.72, 0.22), '#a87850'), ...[-0.7, 0.7].map((x) => part(box(0.1, 0.75, 0.32, x, 0.36, 0.1), '#43555d'))]),
    planter: template([part(box(1.4, 0.55, 0.6, 0, 0.27), '#8b6a4a'), part(new THREE.IcosahedronGeometry(0.42, 0).scale(1.5, 0.7, 0.7).translate(0, 0.72, 0), '#4f8a34'), ...[-0.4, 0, 0.4].map((x, i) => part(new THREE.IcosahedronGeometry(0.13, 0).translate(x, 0.98, 0.05), ['#e0413a', '#f4cf3a', '#f07aa8'][i]!))]),
    tree: template([part(prism(0.2, 0.15, 0, 2.2, 6), '#7a5a3a'), part(new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.6, 0), '#ffffff', 1)]),
    fir: template([part(prism(0.25, 0.2, 0, 1, 6), '#5d4630'), ...[0, 1, 2, 3].map((i) => part(cone(2.3 - i * 0.5, 2.4).translate(0, 2 + i * 1.5, 0), '#2f6b3d')), part(new THREE.OctahedronGeometry(0.35).translate(0, 8, 0), '#f6d65a'), ...Array.from({ length: 16 }, (_, i) => part(new THREE.IcosahedronGeometry(0.14, 0).translate(Math.cos(i * 2.4) * (2 - i * 0.1), 1.6 + i * 0.36, Math.sin(i * 2.4) * (2 - i * 0.1)), ['#e0413a', '#f4cf3a', '#4fa3d9'][i % 3]!))]),
    flag: template([part(prism(0.07, 0.05, -0.2, 8, 6), '#e9e6dc'), part(box(0.03, 2.2, 0.8, 0, 6.6, 0.45), '#ffffff', 1)]),
    /** Barrière de 2,5 m. */
    barrier: template([part(box(2.4, 0.06, 0.05, 0, 1.05), '#9aa0a4'), part(box(2.4, 0.06, 0.05, 0, 0.2), '#9aa0a4'), ...[-1.1, -0.55, 0, 0.55, 1.1].map((x) => part(box(0.04, 0.85, 0.04, x, 0.62), '#9aa0a4')), ...[-0.9, 0.9].map((x) => part(box(0.06, 0.06, 0.7, x, 0.05), '#9aa0a4'))]),
    tower: template([
      ...[-1.2, 1.2].flatMap((x) => [-1.2, 1.2].map((z) => part(box(0.15, 5, 0.15, x, 2.5, z), '#8f9699'))),
      part(box(3.4, 2.4, 3.4, 0, 6.1), '#f2efe6'),
      part(box(3.45, 1, 3.45, 0, 6.3), '#3e5a66'),
      part(box(3.9, 0.25, 3.9, 0, 7.45), '#d9443a'),
      part(box(2.6, 0.9, 0.12, 0, 8.1, 1.4), '#16181a'),
      ...[-0.9, -0.3, 0.3, 0.9].map((x) => part(box(0.36, 0.6, 0.06, x, 8.1, 1.48), '#f4b63a')),
    ]),
    podium: template([part(box(1.6, 1.1, 1.4, 0, 0.55), '#f4d35e'), part(box(1.6, 0.8, 1.4, -1.6, 0.4), '#c9ced2'), part(box(1.6, 0.6, 1.4, 1.6, 0.3), '#c98a52'), part(box(7, 3.4, 0.15, 0, 1.7, -1.2), '#2f5d7c'), part(box(7, 0.5, 0.17, 0, 3.1, -1.2), '#f4d35e')]),
    stage: template([
      part(box(14, 1, 8, 0, 0.5), '#3a3f44'),
      ...[-6.6, 6.6].flatMap((x) => [-3.6, 3.6].map((z) => part(box(0.35, 7, 0.35, x, 3.5, z), '#8f9699'))),
      part(box(14.6, 0.4, 8.6, 0, 7.1), '#5c6bc0'),
      part(box(13, 5, 0.2, 0, 4, -3.6), '#e2604f'),
      ...[-5.2, 5.2].map((x) => part(box(1.4, 3, 1.2, x, 2.5, 3), '#16181a')),
      ...[-4, -1.5, 1.5, 4].map((x, i) => part(prism(0.16, 0.24, 6.3, 6.8, 6, x, 3.4), ['#f4d35e', '#ef8fb0', '#4fa3d9', '#7fb069'][i]!)),
      ...[[-2.5, 0], [0, -0.6], [2.4, 0.2]].flatMap(([x, z], i) => person(['#e2604f', '#f4d35e', '#2f9c95'][i]!, '#23262b').map((g) => g.translate(x!, 1, z!))),
    ]),
    /** Portique de départ, en travers d'une route de 8 m (axe x = le long de la route). */
    gantry: template([
      ...[-6, 6].map((z) => part(box(0.9, 6.2, 0.9, 0, 3.1, z), '#2f5d7c')),
      part(box(0.8, 1.3, 13, 0, 6.2), '#f4d35e'),
      ...Array.from({ length: 10 }, (_, i) => part(box(0.84, 0.3, 0.6, 0, 5.75, -2.7 + i * 0.6), i % 2 ? '#16181a' : '#ffffff')),
    ]),
    cone: template([part(cone(0.18, 0.5).translate(0, 0.27, 0), '#ff7a2a'), part(box(0.4, 0.05, 0.4, 0, 0.03), '#ff7a2a')]),
    rug: template([part(box(2, 0.03, 1.6, 0, 0.02), '#ffffff', 1), part(box(0.5, 0.3, 0.35, 0.5, 0.17, 0.2), '#b08660')]),
    rowboat: template([part(prism(0.35, 0.75, -0.1, 0.4, 6).scale(0.8, 1, 2), '#ffffff', 1), part(box(0.9, 0.06, 0.3, 0, 0.36), '#8b6a4a')]),
    /** Cheval de manège (avant +x). */
    horse: template([part(box(0.9, 0.35, 0.28, 0, 1.2), '#ffffff', 1), part(box(0.25, 0.55, 0.22, 0.5, 1.5).rotateZ(0), '#ffffff', 1), part(box(0.35, 0.2, 0.2, 0.68, 1.75), '#ffffff', 1), ...[-0.35, 0.35].flatMap((x) => [-0.1, 0.1].map((z) => part(box(0.08, 0.5, 0.08, x, 0.85, z), '#f2efe6'))), part(prism(0.03, 0.03, 0, 2.9, 5), '#e6c25a')]),
  };
}
type Kit = ReturnType<typeof kit>;

function cone(r: number, h: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, 7);
}

export function meshOf(parts: Array<{ t: Template; x: number; y: number; z: number; yaw?: number; s?: number; c?: THREE.Color }>, mat: THREE.Material): THREE.Mesh {
  const b = new MeshBuilder(1024);
  for (const p of parts) b.put(p.t, p.x, p.y, p.z, p.yaw ?? 0, p.s ?? 1, p.s ?? 1, p.s ?? 1, p.c ?? WHITE);
  const m = new THREE.Mesh(b.geometry() ?? new THREE.BufferGeometry(), mat);
  m.castShadow = true;
  return m;
}

/** Polygone plat dans le plan du sol. */
function disc(mesh: MeshBuilder, x: number, y: number, z: number, rx: number, rz: number, c: THREE.Color, n = 18): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    const w = (q: number) => 1 + 0.12 * Math.sin(q * 3 + 1);
    mesh.triUp(x, y, z, x + Math.cos(a) * rx * w(a), y, z + Math.sin(a) * rz * w(a), x + Math.cos(b) * rx * w(b), y, z + Math.sin(b) * rz * w(b), c);
  }
}

// ───────────────────────────── Pièces animées

function ferrisWheel(c: SiteContext, x: number, y: number, z: number): void {
  const R = 21;
  const hub = y + R + 3.5;
  const g = new THREE.Group();
  g.name = 'anneau-grande-roue';
  const spokes: THREE.BufferGeometry[] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    spokes.push(part(box(0.18, R, 0.18, 0, R / 2, 0.9).rotateZ(a), '#f2f0e6'), part(box(0.18, R, 0.18, 0, R / 2, -0.9).rotateZ(a), '#f2f0e6'));
    spokes.push(part(box(2 * R * Math.sin(Math.PI / N) + 0.2, 0.3, 0.3, 0, R * Math.cos(Math.PI / N), 0.9).rotateZ(a + Math.PI / N), '#e2604f'), part(box(2 * R * Math.sin(Math.PI / N) + 0.2, 0.3, 0.3, 0, R * Math.cos(Math.PI / N), -0.9).rotateZ(a + Math.PI / N), '#e2604f'));
  }
  spokes.push(part(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 10).rotateX(Math.PI / 2), '#f4d35e'));
  const wheel = meshOf([{ t: template(spokes), x: 0, y: 0, z: 0 }], c.mat);
  wheel.position.set(x, hub, z);
  g.add(wheel);
  const legs = meshOf([{ t: template([-2.2, 2.2].flatMap((dz) => [-1, 1].map((s) => part(box(0.45, R + 5.2, 0.45).rotateZ(s * 0.34).translate(s * 3.1, -(R + 3.5) / 2, dz), '#4a7a9a')))), x, y: hub, z }, { t: template([part(box(9, 0.6, 7, 0, 0.3), '#8b6a4a'), part(box(3, 2.4, 2.4, 7, 1.2, 3), '#f4d35e'), part(box(3.4, 0.2, 2.8, 7, 2.5, 3), '#e2604f')]), x, y, z }], c.mat);
  g.add(legs);
  const cabin = template([part(box(1.5, 0.9, 1.3, 0, -1.15), '#ffffff', 1), part(box(1.7, 0.16, 1.5, 0, 0.05), '#f7f3e8'), ...[-0.65, 0.65].map((dx) => part(box(0.08, 1.2, 0.08, dx, -0.5), '#f7f3e8'))]);
  const cabins = Array.from({ length: N }, (_, i) => {
    const m = meshOf([{ t: cabin, x: 0, y: 0, z: 0, c: GAY[i % GAY.length]! }], c.mat);
    g.add(m);
    return m;
  });
  c.moving.push({
    object: g,
    step: (t) => {
      const a0 = t * 0.11;
      wheel.rotation.z = a0;
      cabins.forEach((m, i) => {
        const a = a0 + (i / N) * Math.PI * 2;
        m.position.set(x - Math.sin(a) * R, hub + Math.cos(a) * R, z);
        m.rotation.z = Math.sin(t * 0.8 + i) * 0.05;
      });
    },
  });
}

function carousel(c: SiteContext, k: Kit, x: number, y: number, z: number): void {
  const parts: Parameters<typeof meshOf>[0] = [{ t: template([part(prism(5.2, 5.2, 0, 0.5, 14), '#8b6a4a'), part(prism(0.7, 0.7, 0.5, 4.2, 10), '#f4d35e'), ...Array.from({ length: 14 }, (_, i) => {
    const g = new THREE.BufferGeometry();
    const a = (i / 14) * Math.PI * 2;
    const b = ((i + 1) / 14) * Math.PI * 2;
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 6, 0, Math.cos(b) * 5.6, 4, Math.sin(b) * 5.6, Math.cos(a) * 5.6, 4, Math.sin(a) * 5.6, 0, 6, 0, Math.cos(a) * 5.6, 4, Math.sin(a) * 5.6, Math.cos(b) * 5.6, 4, Math.sin(b) * 5.6], 3));
    return part(g, i % 2 ? '#f7f3e8' : '#e2604f');
  })]), x: 0, y: 0, z: 0 }];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push({ t: k.horse, x: Math.cos(a) * 3.9, y: 0.5, z: -Math.sin(a) * 3.9, yaw: a + Math.PI / 2, c: GAY[i % GAY.length]! });
  }
  const m = meshOf(parts, c.mat);
  m.position.set(x, y, z);
  c.moving.push({ object: m, step: (t) => (m.rotation.y = t * 0.45) });
}

function balloon(c: SiteContext, x: number, y: number, z: number, colours: [string, string], height: number, seed: number): void {
  const pieces: THREE.BufferGeometry[] = [];
  const N = 12;
  const prof: Array<[number, number]> = [[0.9, 0], [3.6, 3.2], [5.6, 6.6], [6.1, 9.4], [5, 12.4], [2.8, 14.2], [0, 14.8]];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    const pos: number[] = [];
    for (let j = 0; j + 1 < prof.length; j++) {
      const [r0, y0] = prof[j]!;
      const [r1, y1] = prof[j + 1]!;
      const P = (q: number, r: number, h: number) => [Math.cos(q) * r, h, -Math.sin(q) * r];
      pos.push(...P(a, r0, y0), ...P(b, r0, y0), ...P(b, r1, y1), ...P(a, r0, y0), ...P(b, r1, y1), ...P(a, r1, y1));
    }
    pieces.push(part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), colours[i % 2]!));
  }
  // Corde en tige fine : même matériau que le reste, rien à compiler en roulant.
  pieces.push(part(box(0.06, height - 3.5, 0.06, 0, -3.5 - (height - 3.5) / 2), '#5d4630'));
  pieces.push(part(box(1.3, 1.1, 1.3, 0, -3), '#a87850'));
  for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) pieces.push(part(box(0.05, 2.8, 0.05, sx!, -1.4, sz!), '#5d4630'));
  const m = meshOf([{ t: template(pieces), x: 0, y: 0, z: 0 }], c.mat);
  m.name = 'anneau-montgolfiere';
  c.moving.push({
    object: m,
    step: (t) => {
      m.position.set(x + Math.sin(t * 0.17 + seed) * 2.2, y + height + Math.sin(t * 0.33 + seed * 2) * 1.6, z + Math.cos(t * 0.13 + seed) * 1.8);
      m.rotation.y = Math.sin(t * 0.07 + seed) * 0.8;
      m.rotation.z = Math.sin(t * 0.25 + seed) * 0.04;
    },
  });
}

function kite(c: SiteContext, x: number, y: number, z: number, i: number): void {
  const shape = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 1.1, 0, 0.75, 0, 0, 0, -1.5, 0, 0, 1.1, 0, 0, -1.5, 0, -0.75, 0, 0, 0, 1.1, 0, 0, -1.5, 0, 0.75, 0, 0, 0, 1.1, 0, -0.75, 0, 0, 0, -1.5, 0], 3));
  const m = meshOf([{ t: template([part(shape, '#ffffff', 1), ...[0, 1, 2, 3].map((k) => part(box(0.3, 0.12, 0.04, 0, -2 - k * 0.55), k % 2 ? '#f4d35e' : '#e2604f'))]), x: 0, y: 0, z: 0, c: GAY[i % GAY.length]! }], c.mat);
  m.castShadow = false;
  // Fil : tige de longueur 1 (axe y) étirée de la main au cerf-volant.
  const rope = meshOf([{ t: template([part(box(0.025, 1, 0.025, 0, 0.5), '#f2f0e6')]), x: 0, y: 0, z: 0 }], c.mat);
  rope.castShadow = false;
  rope.position.set(x, y + 1.3, z);
  const g = new THREE.Group();
  g.add(m, rope);
  const span = new THREE.Vector3();
  c.moving.push({
    object: g,
    step: (t) => {
      const q = t * 0.6 + i * 2.1;
      m.position.set(x + 8 + Math.sin(q) * 5, y + 17 + Math.sin(q * 2) * 2.5 + i * 2, z - 8 + Math.cos(q * 0.7) * 3);
      m.rotation.set(0.5, Math.sin(q) * 0.5, Math.cos(q) * 0.6);
      span.copy(m.position).sub(rope.position);
      rope.scale.set(1, span.length(), 1);
      rope.quaternion.setFromUnitVectors(UP, span.normalize());
    },
  });
}

// ───────────────────────────── Lieux

const harbourSite = (id: string, h: HarbourSite, reach: number, templates: () => HarbourTemplates): Site => ({
  id,
  x: h.x,
  z: h.z,
  reach,
  needs: harbourCorners(h),
  *build(c) {
    yield* buildHarbour(c.mesh, c.probe, templates(), h);
    // Mouettes sur le quai.
    const r = rng(771 + Math.round(h.x));
    for (let k = 0; k < 3; k++) {
      const u = (r() - 0.5) * h.halfLen * 1.2;
      const w = h.side * (h.halfWid + 4);
      const ux = Math.cos(h.dir);
      const uz = Math.sin(h.dir);
      const gx = h.x + ux * u - uz * w;
      const gz = h.z + uz * u + ux * w;
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const x = gx + (r() - 0.5) * 8;
        const z = gz + (r() - 0.5) * 8;
        const y = c.probe.heightAt(x, z);
        if (y > 1.5) pts.push(x, y + 0.2, z);
      }
      if (pts.length > 5) c.perches.push({ pts: new Float32Array(pts), yaw: r() * 6, ground: true, x: gx, z: gz, gull: true });
    }
  },
});

/** Parcours de promeneur : boucle fermée sur elle-même, un point tous les 4 m environ. */
export function strollPath(c: SiteContext, pts: ReadonlyArray<readonly [number, number]>, seed: number, kind: 'walker' | 'jogger' = 'walker'): void {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 4));
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const y = c.probe.heightAt(x, z);
      if (Number.isFinite(y)) out.push(x, y, z);
    }
  }
  if (out.length > 18) c.spots.push({ kind, x: out[0]!, y: out[1]!, z: out[2]!, yaw: 0, path: new Float32Array(out), seed });
}

function anneau(k: () => Kit): Site {
  const { x: CX, z: CZ } = RING;
  return {
    id: 'anneau',
    x: CX,
    z: CZ,
    reach: 1150,
    needs: [[CX, CZ], [CX, CZ + 238], [CX - 420, CZ], [CX + 420, CZ]],
    *build(c) {
      const t = k();
      yield;
      const r = rng(5531);
      const Y = (x: number, z: number) => c.probe.heightAt(x, z);
      const put = (q: Template, dx: number, dz: number, yaw = 0, colour = WHITE, s = 1, dy = 0) => {
        const y = Y(CX + dx, CZ + dz);
        if (Number.isFinite(y)) c.mesh.put(q, CX + dx, y + dy, CZ + dz, yaw, s, s, s, colour);
      };
      const spot = (kind: 'villager' | 'child', dx: number, dz: number, yaw: number) => {
        const y = Y(CX + dx, CZ + dz);
        if (Number.isFinite(y)) c.spots.push({ kind, x: CX + dx, y, z: CZ + dz, yaw, seed: r() });
      };
      const few = c.density < 0.7 ? 0.6 : 1;
      const winter = c.season === 'winter';
      // ── Ligne : damier, portique, gradins (à la place des hangars), panneaux 150 / 100 / 50.
      const y0 = Y(CX, CZ + 225);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 14; j++) {
          const x0 = CX - 0.9 + i * 0.45;
          const z0 = CZ + 221 + j * 0.57;
          const q = (i + j) % 2 ? new THREE.Color('#16181a') : new THREE.Color('#f4f2ea');
          const y = y0 + 0.09;
          c.mesh.triUp(x0, y, z0, x0 + 0.45, y, z0, x0 + 0.45, y, z0 + 0.57, q);
          c.mesh.triUp(x0, y, z0, x0 + 0.45, y, z0 + 0.57, x0, y, z0 + 0.57, q);
        }
      put(t.gantry, 0, 225);
      for (let i = -6; i <= 6; i++) {
        if (i % 4 === 0) c.flush();
        yield;
        put(t.stand, i * 12.2, 237.5, 0, GAY[Math.abs(i) % 3]!);
        if (winter && i % 3) continue;
        for (let n = 0; n < Math.round(9 * few); n++) {
          const row = Math.floor(r() * 7);
          put(t.fan, i * 12.2 + (r() - 0.5) * 11, 237.5 - 3.4 + row * 0.95, Math.PI + (r() - 0.5), GAY[Math.floor(r() * GAY.length)]!, 0.95, 0.45 * (row + 1) + 0.02);
        }
      }
      for (let dx = -240; dx <= 240; dx += 20) {
        put(t.flag, dx, 246, Math.PI / 2, GAY[Math.abs(dx / 20) % GAY.length | 0]!);
        if (Math.abs(dx) > 30) put(t.barrier, dx, 218, 0);
      }
      for (let dx = -110; dx <= 110; dx += 2.6) put(t.barrier, dx, 231.2, 0);
      c.flush();
      yield;
      // ── Paddock, côté pelouse.
      for (let i = 0; i < 12; i++) {
        const dx = -132 + i * 24;
        put(t.tent, dx, 196, 0, GAY[i % GAY.length]!);
        put(t.van, dx + 8, 194, Math.PI / 2 + (r() - 0.5) * 0.1, GAY[(i + 3) % GAY.length]!);
        if (i % 2) spot('villager', dx + 1, 200, 0);
      }
      put(t.tower, 22, 208, Math.PI);
      put(t.podium, -24, 206, 0);
      for (let dx = -150; dx <= 150; dx += 3) if (Math.abs(dx) > 8) put(t.barrier, dx, 188, 0);
      c.flush();
      yield;
      // ── Fête au centre : grande roue, manège, camions, scène, guirlandes.
      ferrisWheel(c, CX, Y(CX, CZ + 78), CZ + 78);
      yield;
      carousel(c, t, CX - 66, Y(CX - 66, CZ + 122), CZ + 122);
      carousel(c, t, CX + 92, Y(CX + 92, CZ + 60), CZ + 60);
      yield;
      bigTop(put, 150, 112);
      yield;
      put(t.stage, -128, 100, Math.PI / 2 - 0.2);
      ([[-40, 150], [-16, 156], [10, 156], [36, 152], [70, 142]] as const).forEach(([dx, dz], i) => put(t.truck, dx, dz, Math.PI + (i - 2) * 0.12, GAY[(i * 3) % GAY.length]!));
      for (let i = 0; i < 12; i++) {
        const dx = -46 + (i % 6) * 18 + (r() - 0.5) * 3;
        const dz = 128 + Math.floor(i / 6) * 9;
        put(t.table, dx, dz, r() * 3);
        if (!winter) put(t.parasol, dx, dz, 0, GAY[i % GAY.length]!);
      }
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        put(t.flag, Math.cos(a) * 178, Math.sin(a) * 62 + 108, a, GAY[i % GAY.length]!, 0.8);
      }
      for (let i = 0; i < Math.round(20 * few); i++) spot(r() < 0.4 ? 'child' : 'villager', -100 + r() * 220, 90 + r() * 72, r() * 6.28);
      c.flush();
      yield;
      // ── Lac, barques, canards (perchoirs), promenade tout autour avec chiens.
      const lx = CX - 300;
      const lz = CZ - 20;
      const ly = Y(lx, lz);
      disc(c.mesh, lx, ly + 0.05, lz, 74, 42, new THREE.Color('#c9b98f'), 24);
      disc(c.mesh, lx, ly + 0.09, lz, 69, 37, winter ? new THREE.Color('#a9c9d9') : new THREE.Color('#4fa3cf'), 24);
      disc(c.mesh, lx + 6, ly + 0.11, lz, 46, 22, winter ? new THREE.Color('#bcd6e2') : new THREE.Color('#3d8fc0'), 20);
      if (!winter) for (let i = 0; i < 6; i++) put(t.rowboat, -300 + (r() - 0.5) * 80, -20 + (r() - 0.5) * 34, r() * 6, GAY[i]!, 1.3, 0.1);
      const loop = Array.from({ length: 33 }, (_, i) => [lx + Math.cos((i / 32) * Math.PI * 2) * 88, lz + Math.sin((i / 32) * Math.PI * 2) * 54] as const);
      for (let i = 0; i < Math.round(4 * few); i++) strollPath(c, [...loop.slice(i * 8), ...loop.slice(0, i * 8 + 1)], r());
      strollPath(c, loop, r(), 'jogger');
      for (let i = 0; i < 10; i++) put(t.bench, -300 + Math.cos(i * 0.63) * 82, -20 + Math.sin(i * 0.63) * 49, -i * 0.63 - Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const gx = lx + (r() - 0.5) * 60;
        const gz = lz + (r() - 0.5) * 30;
        c.perches.push({ pts: new Float32Array([0, 1, 2, 3, 4, 5].flatMap(() => [gx + (r() - 0.5) * 9, ly + 0.2, gz + (r() - 0.5) * 9])), yaw: 0, ground: true, x: gx, z: gz, gull: true });
      }
      c.flush();
      yield;
      // ── Deux terrains de foot (parties animées).
      for (const [dx, dz] of [[285, 20], [285, 92]] as const) {
        const px = CX + dx;
        const pz = CZ + dz;
        const py = Y(px, pz) + 0.05;
        for (let i = 0; i < 8; i++) {
          const q = new THREE.Color(winter ? '#c9d6cc' : i % 2 ? '#5fae3e' : '#52a037');
          const a = px - 32 + i * 8;
          c.mesh.triUp(a, py, pz - 21, a + 8, py, pz - 21, a + 8, py, pz + 21, q);
          c.mesh.triUp(a, py, pz - 21, a + 8, py, pz + 21, a, py, pz + 21, q);
        }
        for (const s of [-1, 1]) put(goal(), dx + s * 31, dz, s > 0 ? -Math.PI / 2 : Math.PI / 2);
        c.spots.push({ kind: 'pitch', x: px, y: py, z: pz, yaw: 0, pitch: { ux: 1, uz: 0, hl: 28, hw: 18 }, seed: r() });
      }
      c.flush();
      yield;
      // ── Camping des supporters.
      for (let i = 0; i < Math.round(22 * few); i++) {
        const dx = 190 + (i % 8) * 24 + (r() - 0.5) * 6;
        const dz = -150 + Math.floor(i / 8) * 26 + (r() - 0.5) * 5;
        if (i % 3) put(t.camper, dx, dz, (r() - 0.5) * 0.5, GAY[i % GAY.length]!);
        else if (!winter) put(t.igloo, dx, dz, r() * 6, GAY[i % GAY.length]!);
        if (i % 4 === 0) spot('villager', dx + 3, dz + 4, r() * 6);
      }
      c.flush();
      yield;
      // ── Pique-niques, cerfs-volants, école de vélo.
      if (!winter)
        for (let i = 0; i < 12; i++) {
          const dx = -190 + r() * 110;
          const dz = 70 + r() * 70;
          put(t.rug, dx, dz, r() * 6, GAY[i % GAY.length]!);
          if (i % 2 === 0) spot('child', dx + 1.5, dz, r() * 6);
        }
      for (let i = 0; i < 4; i++) {
        kite(c, CX - 170 + i * 26, Y(CX - 170 + i * 26, CZ + 120), CZ + 120, i);
        spot('child', -170 + i * 26, 120, 0.8);
      }
      for (let i = 0; i < 40; i++) put(t.cone, -130 + Math.sin(i * 0.5) * 26 + (i % 2) * 3, -120 + i * 1.8, 0);
      c.flush();
      yield;
      // ── Montgolfières captives.
      balloon(c, CX - 150, Y(CX - 150, CZ - 120), CZ - 120, ['#e2604f', '#f4d35e'], 26, 1);
      yield;
      balloon(c, CX + 130, Y(CX + 130, CZ + 20), CZ + 20, ['#4fa3d9', '#f7f3e8'], 34, 2.6);
      yield;
      balloon(c, CX + 430, Y(CX + 430, CZ - 120), CZ - 120, ['#7fb069', '#ff8a3d'], 22, 4.1);
      balloon(c, CX - 430, Y(CX - 430, CZ + 120), CZ + 120, ['#5c6bc0', '#ef8fb0'], 30, 5.3);
      yield;
      // ── Bosquets.
      const leaf = c.season === 'autumn' ? C('#d98a3a', '#c9623a', '#e0b048') : winter ? C('#c9d0cb', '#b9c2bd') : C('#5f9a3a', '#4f8a34', '#6aa444');
      for (let i = 0; i < 46; i++) {
        const a = r() * 6.28;
        const dx = Math.cos(a) * (430 + r() * 70) * (r() < 0.5 ? 1 : 0.95);
        const dz = Math.sin(a) * (120 + r() * 50);
        put(t.tree, dx, dz, r() * 6, leaf[i % leaf.length]!, 0.9 + r() * 0.8);
      }
    },
  };
}

/** Chapiteau : deux mâts, toile rayée à seize pans. */
function bigTop(put: (q: Template, dx: number, dz: number, yaw?: number, colour?: THREE.Color, s?: number) => void, dx: number, dz: number): void {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = ((i + 1) / 16) * Math.PI * 2;
    const P = (q: number, r: number, h: number) => [Math.cos(q) * r, h, -Math.sin(q) * r * 0.8];
    const roof = [...P(a, 14, 4), ...P(b, 14, 4), ...P(b, 2, 12), ...P(a, 14, 4), ...P(b, 2, 12), ...P(a, 2, 12)];
    const wall = [...P(a, 13.4, 0), ...P(b, 13.4, 0), ...P(b, 13.4, 4.1), ...P(a, 13.4, 0), ...P(b, 13.4, 4.1), ...P(a, 13.4, 4.1)];
    const cap = [...P(a, 2, 12), ...P(b, 2, 12), 0, 13.5, 0];
    for (const pos of [roof, wall, cap]) pieces.push(part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), i % 2 ? '#f7f3e8' : '#d9443a'));
  }
  pieces.push(part(prism(0.1, 0.08, 13, 16, 5), '#e6c25a'), part(box(1.6, 0.7, 0.04, 0.9, 15.5), '#f4d35e'), part(box(4.4, 3.2, 0.3, 0, 1.6, 10.9), '#2b2f33'));
  put(template(pieces), dx, dz);
}

let goalTemplate: Template | null = null;
function goal(): Template {
  return (goalTemplate ??= template([part(box(0.1, 2.2, 0.1, -2.6, 1.1), '#f4f2ea'), part(box(0.1, 2.2, 0.1, 2.6, 1.1), '#f4f2ea'), part(box(5.3, 0.1, 0.1, 0, 2.2), '#f4f2ea'), part(box(5.2, 0.04, 1.4, 0, 2.15, -0.7).rotateX(0), '#dfe3e1')]));
}

function market(k: () => Kit): Site {
  const u = [Math.cos(SQUARE.angle), Math.sin(SQUARE.angle)] as const;
  const at = (a: number, b: number): [number, number] => [SQUARE.x + a * u[0] - b * u[1], SQUARE.z + a * u[1] + b * u[0]];
  return {
    id: 'saint-robert',
    x: SQUARE.x,
    z: SQUARE.z,
    reach: 480,
    needs: [at(0, 0), at(-250, -140), at(40, 40)],
    *build(c) {
      const t = k();
      yield;
      const r = rng(8123);
      // Direction locale (a, b) → cap : yaw 0 = face vers +b.
      const base = Math.atan2(-u[1], u[0]);
      const put = (q: Template, a: number, b: number, yaw = 0, colour = WHITE, s = 1, radius = 0.9): boolean => {
        const [x, z] = at(a, b);
        if (!c.probe.read(x, z) || c.probe.road > 0.35 || c.probe.buildingNear(x, z, radius)) return false;
        const y = c.probe.heightAt(x, z);
        if (!Number.isFinite(y)) return false;
        c.mesh.put(q, x, y, z, base + yaw, s, s, s, colour);
        return true;
      };
      const spot = (kind: 'villager' | 'child', a: number, b: number, yaw: number) => {
        const [x, z] = at(a, b);
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y) && !c.probe.buildingNear(x, z, 0.6)) c.spots.push({ kind, x, y, z, yaw, seed: r() });
      };
      const winter = c.season === 'winter';
      // Marché (au nord-ouest) : deux rangées d'étals face à face.
      // Marché le mercredi et le samedi ; fête du village le dimanche (fanions, kiosque, bal).
      // ?jour=0…6 (0 = dimanche) pour essayer le marché ou la fête un autre jour.
      const askDay = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('jour');
      const day = askDay !== null && /^[0-6]$/.test(askDay) ? Number(askDay) : new Date().getDay();
      const marketDay = day === 3 || day === 6;
      const feast = day === 0;
      if (marketDay)
        for (let i = 0; i < 5; i++) {
          put(t.stall, -22 + i * 3.6, -8.2, 0, GAY[i % GAY.length]!, 1, 1.6);
          put(t.stall, -22 + i * 3.6, -17.5, Math.PI, GAY[(i + 3) % GAY.length]!, 1, 1.6);
          spot(i % 3 ? 'villager' : 'child', -21 + i * 3.4, -12.6 + (i % 2), i * 2);
        }
      else for (let i = 0; i < 3; i++) spot('villager', -20 + i * 6, -12.6, i * 2);
      if (feast) {
        // Guirlandes de fanions en travers de la place, kiosque à musique, danseurs.
        const flagTri = (x: number, y: number, z: number, ux: number, uz: number, col: THREE.Color) => {
          c.mesh.tri(x, y, z, x + ux * 0.5, y, z + uz * 0.5, x + ux * 0.25, y - 0.45, z + uz * 0.25, col);
          c.mesh.tri(x + ux * 0.5, y, z + uz * 0.5, x, y, z, x + ux * 0.25, y - 0.45, z + uz * 0.25, col);
        };
        for (const [a0, b0, a1, b1] of [[-30, -20, 30, 20], [-30, 20, 30, -20], [-30, 0, 30, 0]] as const) {
          const [x0, z0] = at(a0, b0);
          const [x1, z1] = at(a1, b1);
          const L = Math.hypot(x1 - x0, z1 - z0);
          const ux = (x1 - x0) / L;
          const uz = (z1 - z0) / L;
          const y0 = c.probe.heightAt(x0, z0);
          if (!Number.isFinite(y0)) continue;
          for (let d = 0, k = 0; d + 0.5 < L; d += 0.8, k++) {
            const sag = 5.2 - 1.1 * Math.sin((Math.PI * d) / L);
            flagTri(x0 + ux * d, y0 + sag, z0 + uz * d, ux, uz, GAY[k % GAY.length]!);
          }
        }
        put(t.bandstand, -18, 0, 0, GAY[0]!, 1, 3);
        for (let i = 0; i < 10; i++) spot(i % 4 ? 'villager' : 'child', -18 + Math.cos(i * 0.63) * 7, Math.sin(i * 0.63) * 7, i * 0.63);
      }
      yield;
      // Café : terrasse (au sud-est).
      for (let i = 0; i < 9; i++) {
        const a = 9 + (i % 3) * 5;
        const b = 8 + Math.floor(i / 3) * 4.6;
        if (!put(t.round, a, b, r() * 3, GAY[i % 3]!)) continue;
        if (!winter && i % 2 === 0) put(t.parasol, a, b, 0, GAY[(i % 2) * 3]!);
      }
      for (let i = 0; i < 4; i++) spot('villager', 10 + i * 3.5, 11 + (i % 2) * 5, i * 1.7);
      yield;
      // Mairie : fontaine, bancs, tilleuls, pavillons (au sud-ouest) ; sapin l'hiver.
      put(t.fountain, -15, 14, 0, WHITE, 1, 3);
      const leaf = c.season === 'autumn' ? C('#d98a3a', '#e0b048') : winter ? C('#c9d0cb') : C('#5f9a3a', '#6aa444');
      for (const [a, b] of [[-8, 9], [-8, 20], [-22, 9], [-22, 20]] as const) put(t.tree, a, b, 0, leaf[(a + b) & 1 ? 0 : leaf.length - 1]!, 0.85, 1.2);
      for (const [a, b, yaw] of [[-15, 9.4, 0], [-15, 18.6, Math.PI], [-10.2, 14, -Math.PI / 2], [-19.8, 14, Math.PI / 2]] as const) put(t.bench, a, b, yaw);
      for (let i = 0; i < 4; i++) put(t.flag, -28 + i * 2.2, 21.5, Math.PI / 2, GAY[i * 2]!, 0.75);
      // Église : statue du cycliste, sapin de Noël l'hiver (au nord-est).
      put(t.statue, 13, -12, 0.4, WHITE, 1.15, 2);
      if (winter) put(t.fir, 20, -18, 0, WHITE, 1, 2.5);
      for (const [a, b] of [[8, -7.5], [19, -7.5], [8, -17], [6.5, 6.4], [-6.5, 6.4], [-6.5, -6.4], [6.5, -6.4]] as const) put(t.planter, a, b, a * b);
      for (const [a, b, yaw] of [[17.5, -12, Math.PI / 2], [13, -17, 0]] as const) put(t.bench, a, b, yaw);
      spot('child', 11, -9, 2);
      yield;
      // École : cour, marelle de cônes, arbres, enfants.
      for (let i = 0; i < 5; i++) spot('child', -262 + i * 7, -118 + (i % 2) * 4, i * 1.3);
      for (let i = 0; i < 6; i++) put(t.tree, -272 + i * 10, -110, 0, leaf[i % leaf.length]!, 0.8, 1.5);
      for (let i = 0; i < 12; i++) put(t.cone, -258 + i * 2.4, -122, 0);
      // Promeneurs autour de la place.
      strollPath(c, [at(-30, 5.6), at(-6, 5.6), at(6, 5.4), at(34, 5.6)], r());
      strollPath(c, [at(5, -34), at(5, -6), at(5, 6), at(5, 34)], r());
      strollPath(c, [at(-34, -5.8), at(-5, -5.8), at(-5, -34)], r());
    },
  };
}

// ───────────────────────────── Gestion

const FORGET_EXTRA_M = 150;
/** Ombres portées des morceaux à moins de cette distance (m) du coureur. */
const SHADOW_M = 70;
/** Au-delà, manèges et ballons ne sont plus animés (invisibles ou minuscules). */
const ANIMATE_M = 750;
/** Temps de construction par image (ms). */
const BUILD_MS = 2;

interface Job {
  site: Site;
  steps: Generator<void>;
  context: SiteContext;
  meshes: THREE.Mesh[];
}

export class IslandSites {
  readonly group = new THREE.Group();
  /** Change à chaque lieu construit ou oublié. */
  version = 0;
  private readonly sites: Site[];
  private readonly built = new Map<string, Built>();
  private job: Job | null = null;
  private templates?: Kit;
  private harbours?: HarbourTemplates;
  private t = 0;
  private crossScan = 1;
  private readonly crossings = new Set<string>();

  /** `mat` : matériau du décor des abords, déjà compilé. */
  constructor(private readonly probe: LandProbe, private readonly mat: THREE.Material, private season: Season = 'summer') {
    this.group.name = 'ile-lieux';
    const k = () => (this.templates ??= kit());
    const h = () => (this.harbours ??= harbourTemplates());
    this.sites = [harbourSite('port-robertville', ROBERTVILLE_HARBOUR, 750, h), harbourSite('port-kerbrou', KERBROU_HARBOUR, 700, h), anneau(k), market(k), ...outdoorSites()];
  }

  /** Personnages et oiseaux des lieux construits. */
  get chunks(): LifeChunk[] {
    return [...this.built.values()].map((b) => b.chunk);
  }

  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    this.cancel();
    for (const id of [...this.built.keys()]) this.drop(id);
  }

  update(dt: number, x: number, z: number, density: number): void {
    this.t += dt;
    // Gués et passerelles des tuiles chargées autour du coureur, cherchés toutes les 4 s.
    this.crossScan -= dt;
    if (this.crossScan <= 0) {
      this.crossScan = 4;
      this.sites.push(...crossingSites(this.probe, x, z, this.crossings));
    }
    for (const site of this.sites) {
      const d = Math.hypot(x - site.x, z - site.z);
      const b = this.built.get(site.id);
      if (b) {
        if (d > site.reach + FORGET_EXTRA_M || density <= 0) {
          this.drop(site.id);
          continue;
        }
        for (const m of b.meshes) {
          const s = m.geometry.boundingSphere;
          m.castShadow = !!s && Math.hypot(s.center.x - x, s.center.z - z) - s.radius < SHADOW_M;
        }
        for (const m of b.moving) {
          m.object.visible = d < ANIMATE_M;
          if (m.object.visible) m.step(this.t, dt);
        }
      } else if (!this.job && d < site.reach && density > 0 && this.ready(site)) this.start(site, density);
    }
    this.advance();
  }

  private ready(site: Site): boolean {
    this.probe.forget();
    return site.needs.every(([x, z]) => this.probe.tileAt(x, z)?.buildingSource?.worldId === ROBERT_ISLAND && Number.isFinite(this.probe.heightAt(x, z)));
  }

  private start(site: Site, density: number): void {
    const meshes: THREE.Mesh[] = [];
    const mesh = new MeshBuilder(8192);
    const flush = () => {
      const g = mesh.geometry();
      mesh.reset();
      if (!g) return;
      const m = new THREE.Mesh(g, this.mat);
      m.name = `lieu-${site.id}-${meshes.length}`;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      meshes.push(m);
    };
    const context: SiteContext = { mesh, probe: this.probe, season: this.season, density, spots: [], perches: [], flowers: [], moving: [], mat: this.mat, flush };
    this.job = { site, steps: site.build(context), context, meshes };
  }

  private advance(): void {
    const job = this.job;
    if (!job) return;
    this.probe.forget();
    const end = performance.now() + BUILD_MS;
    do {
      if (!job.steps.next().done) continue;
      const c = job.context;
      c.flush();
      for (const m of c.moving) {
        m.step(this.t, 0);
        this.group.add(m.object);
      }
      for (const m of job.meshes) this.group.add(m);
      this.built.set(job.site.id, { meshes: job.meshes, moving: c.moving, x: job.site.x, z: job.site.z, chunk: { spots: c.spots, flowers: new Float32Array(c.flowers), perches: c.perches } });
      this.job = null;
      this.version++;
      return;
    } while (performance.now() < end);
  }

  private cancel(): void {
    for (const m of this.job?.meshes ?? []) m.geometry.dispose();
    this.job = null;
  }

  private drop(id: string): void {
    const b = this.built.get(id);
    if (!b) return;
    for (const o of [...b.meshes, ...b.moving.map((m) => m.object)]) {
      this.group.remove(o);
      o.traverse((q) => (q as THREE.Mesh).geometry?.dispose());
    }
    this.built.delete(id);
    this.version++;
  }

  dispose(): void {
    this.cancel();
    for (const id of [...this.built.keys()]) this.drop(id);
  }
}
