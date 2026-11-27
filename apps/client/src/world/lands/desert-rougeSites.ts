import * as THREE from 'three/webgpu';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, template, type Template } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';

/**
 * Décor propre du Désert rouge (mode Poly, tools/desert-rouge), d'après le Sud-Ouest américain (identité du
 * 27/11/2026) : palmiers des oasis, ranchs (éoliennes de pompage qui tournent, réservoirs, abreuvoirs, chevaux),
 * troupeaux menés par des cavaliers, virevoltants qui roulent au vent, yuccas, armoises, grands cactus à bras,
 * arches de pierre, croûte de sel du Chott Blanc,
 * tribunes du Circuit du Chott, montgolfières au-dessus du Grand Canyon au lever du jour, bike park des Buttes,
 * cyclo-cross des Sables, dôme de l'observatoire et cairns de la Tête du Vautour, guelta, ports ; parois en strates du
 * canyon et des mesas, éboulis, touffes et fleurs des fissures, bosquets d'arbres à pompons. Même mécanique que les lieux de l'île (polySites.ts) :
 * chaque lieu est construit par pas quand le coureur approche, puis oublié. Cotes : celles du générateur
 * (tools/desert-rouge/src/design.ts, places.json).
 */
const WHITE = new THREE.Color(0xffffff);
const C = (c: string) => new THREE.Color(c);
type P2 = readonly [number, number];

// ── Cotes du générateur ──

/** Croissant (ARC et halfWidth de design.ts) : centre de l'arc, rayon, cornes. */
const ARC = { cx: 0, cz: 11700, R: 17000, t0: -1.05, t1: 1.12 } as const;
function halfWidth(t: number): number {
  const u = Math.min(1, Math.max(0, (t - ARC.t0) / (ARC.t1 - ARC.t0)));
  const tip = 2900 + (2100 - 2900) * u;
  return tip + (5800 - tip) * Math.sin(Math.PI * u) ** 0.8;
}
/** Sur la terre du croissant, à peu près (sans le rivage dentelé), avec une marge (m) vers l'intérieur. */
function onLand(x: number, z: number, margin = 0): boolean {
  const t = Math.atan2(x - ARC.cx, ARC.cz - z);
  const r = Math.hypot(x - ARC.cx, z - ARC.cz);
  const tc = Math.min(ARC.t1, Math.max(ARC.t0, t));
  const d = t === tc ? Math.abs(r - ARC.R) : Math.hypot(x - ARC.cx - ARC.R * Math.sin(tc), z - ARC.cz + ARC.R * Math.cos(tc));
  return d < halfWidth(tc) - margin;
}

/** Circuit du Chott (ANNEAU) et Chott Blanc (CHOTT). */
export const DESERT_RING = { x: -3625, z: -1926, half: 560, radius: 215 } as const;
const CHOTT = { x: -3625, z: -1926, rx: 1500, rz: 650, rot: 0 };
/** Sources d'oasis (LAKES) : palmeraies, puits et tentes autour. */
const OASIS = { x: 5277, z: -1322, rx: 150, rz: 95, rot: 0.4 };
const OASES: ReadonlyArray<{ id: string; o: typeof OASIS; grove: number }> = [
  { id: 'oasis', o: OASIS, grove: 950 },
  { id: 'oasis-des-dunes', o: { x: -12594, z: -2659, rx: 120, rz: 80, rot: 0.8 }, grove: 420 },
  { id: 'oasis-de-sablons', o: { x: -12866, z: 2105, rx: 110, rz: 75, rot: 0.2 }, grove: 520 },
  { id: 'oasis-de-l-etoile', o: { x: 589, z: -7941, rx: 100, rz: 70, rot: 0.5 }, grove: 380 },
  { id: 'oasis-des-cairns', o: { x: 5949, z: -6871, rx: 110, rz: 70, rot: 1.1 }, grove: 380 },
  { id: 'source-de-port-vent', o: { x: -2272, z: -8875, rx: 90, rz: 60, rot: 0.3 }, grove: 320 },
];
/** Guelta du Vautour (petit lac de montagne) : quelques palmiers au bord. */
const GUELTA = { x: 12354, z: -4218, rx: 220, rz: 150, rot: 0.5 };
/** Petites boucles dessinées (CROSS, BIKEPARK et la forme de build.ts). */
const CROSS: P2 = [-7960, 550];
const BIKEPARK: P2 = [2143, -2154];
/** Pic du Vautour (observatoire) et Tête du Vautour (cairns). */
const PEAK: P2 = [13156, -2422];
const COL: P2 = [14293, -358];
/** Grand Canyon de l'Oued Rouge : points du fond, d'est en ouest, au-dessus des Cairns (riverBeds, oued-rouge). */
const CANYON: readonly P2[] = [[7616, -4079], [6682, -4578], [5730, -5028], [4702, -5299], [3680, -5482], [2620, -5593], [1575, -5682]];
/** Villages : place (centre du plan) et direction de la rue principale. */
const VILLAGES: ReadonlyArray<{ x: number; z: number; angle: number; r: number; palms: number }> = [
  { x: -572, z: -2589, angle: 0, r: 620, palms: 8 },
  { x: -5994, z: -1722, angle: -0.42, r: 380, palms: 5 },
  { x: -12142, z: 2065, angle: -0.9, r: 480, palms: 8 },
  { x: -7060, z: -6817, angle: -0.36, r: 300, palms: 3 },
  { x: 5073, z: -1777, angle: 0.36, r: 360, palms: 12 },
  { x: 10384, z: 328, angle: 0.74 + Math.PI / 2, r: 400, palms: 5 },
  { x: 4469, z: -6561, angle: 0.24, r: 280, palms: 4 },
  { x: 0, z: -7600, angle: 0, r: 300, palms: 6 },
];
/** Arches de pierre : position souhaitée, portée (m), cap. */
const ARCHES: ReadonlyArray<readonly [number, number, number, number]> = [
  [2773, -1308, 26, 0.4],
  [986, -2365, 17, 1.6],
  [5800, -5234, 34, 0.9],
  [-11621, -4578, 22, 2.3],
  [8074, -102, 20, 0.2],
];
/** Troupeaux menés par des cavaliers : boucle suivie sur la plaine (centre, demi-axes, cap) et nombre de bêtes. */
const CARAVANS: ReadonlyArray<{ id: string; x: number; z: number; rx: number; rz: number; rot: number; n: number; speed: number }> = [
  { id: 'troupeau-du-plateau', x: -3500, z: -7400, rx: 480, rz: 280, rot: -0.5, n: 9, speed: 1.2 },
  { id: 'troupeau-de-l-etoile', x: 2700, z: -8000, rx: 420, rz: 240, rot: 0.1, n: 7, speed: 1.1 },
];

const PORT_CORAIL: HarbourSite = {
  x: 1358, z: 437.3, dir: 1.691, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.55, fishing: false,
  hulls: ['#2f8fb5', '#f4efe6', '#e2593f', '#f2c230', '#3aa39b'],
};
const CAP_BRIQUE: HarbourSite = {
  x: 11377, z: 3564.1, dir: 2.521, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.3, fishing: true,
  hulls: ['#2f6fa6', '#e2593f', '#f2f0e8', '#3aa39b', '#e7b23c'],
};
const PORT_VENT: HarbourSite = {
  x: -3316.7, z: -10245.2, dir: -1.721, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.25, fishing: true,
  hulls: ['#2d5d8f', '#b8432f', '#3c7f58', '#f2f0e8', '#d79a33'],
};

// ── Gabarits ──

/** Cavalier assis (repère : selle en y = 0) : chemise teintée, jean, chapeau à large bord. */
const horseman = () => [
  part(box(0.36, 0.55, 0.22, 0, 0.42), '#ffffff', 1),
  ...[-0.13, 0.13].map((x) => part(box(0.12, 0.62, 0.14, x, -0.12, 0.1).rotateX(0.5), '#3b4f6e')),
  part(new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.86, 0), '#c99a72'),
  part(prism(0.34, 0.34, 0.94, 0.97, 8), '#6b4a2c'),
  part(prism(0.14, 0.12, 0.96, 1.12, 6), '#6b4a2c'),
];

function kit() {
  // Palme : feuille longue pliée, retombant vers l'extérieur (repère : tige vers +z).
  const leaf = (a: number, droop: number, L: number) => part(box(0.55, 0.05, L, 0, 0, L / 2).rotateX(droop).rotateY(a), '#ffffff', 1);
  return {
    palm: template([
      part(prism(0.24, 0.2, 0, 2.6, 5), '#8a6a45'),
      part(prism(0.2, 0.17, 2.5, 5.0, 5, 0.12, 0), '#7f6040'),
      part(prism(0.17, 0.15, 4.9, 7.2, 5, 0.32, 0), '#8a6a45'),
      ...Array.from({ length: 6 }, (_, i) => leaf((i / 6) * Math.PI * 2 + 0.3, 0.35 + (i % 3) * 0.12, 3.1 + (i % 2) * 0.5).translate(0.36, 7.15, 0)),
      part(new THREE.IcosahedronGeometry(0.32, 0).translate(0.36, 6.85, 0), '#a8632a'),
    ]),
    /** Cheval (robe teintée, crins et sabots sombres), ≈ 1,6 m au garrot (156 triangles). */
    horse: template([
      part(box(0.62, 0.62, 1.55, 0, 1.25), '#ffffff', 1),
      part(box(0.3, 0.75, 0.36, 0, 1.68, 0.78).rotateX(-0.55), '#ffffff', 1, 1),
      part(box(0.24, 0.26, 0.62, 0, 2.02, 1.18).rotateX(0.35), '#ffffff', 1, 1),
      part(box(0.08, 0.5, 0.42, 0, 1.92, 0.72).rotateX(-0.55), '#2b2119', 0, 1),
      ...[-0.2, 0.2].flatMap((x) => [-0.58, 0.58].map((z) => part(box(0.13, 1.0, 0.14, x, 0.5, z), '#ffffff', 1))),
      ...[-0.2, 0.2].flatMap((x) => [-0.58, 0.58].map((z) => part(box(0.15, 0.12, 0.16, x, 0.06, z), '#2b2119'))),
      part(box(0.12, 0.7, 0.12, 0, 1.15, -0.86).rotateX(0.25), '#2b2119'),
    ]),
    /** Vache à longues cornes (robe teintée), ≈ 1,4 m (120 triangles). */
    cow: template([
      part(box(0.68, 0.62, 1.45, 0, 1.0), '#ffffff', 1),
      part(box(0.34, 0.36, 0.5, 0, 1.08, 0.88), '#ffffff', 1, 1),
      part(box(1.1, 0.07, 0.07, 0, 1.28, 0.8), '#e9e0cc', 0, 1),
      ...[-0.5, 0.5].map((x) => part(box(0.07, 0.22, 0.07, x, 1.36, 0.8), '#e9e0cc', 0, 1)),
      ...[-0.2, 0.2].flatMap((x) => [-0.52, 0.52].map((z) => part(box(0.13, 0.75, 0.14, x, 0.37, z), '#ffffff', 1))),
      part(box(0.06, 0.6, 0.06, 0, 0.95, -0.75).rotateX(0.2), '#3a2a1e'),
    ]),
    rider: template(horseman()),
    /** Tour d'éolienne de pompage en treillis, ≈ 9 m (le rotor tourne à part, voir `rotor`) (192 triangles). */
    windTower: template([
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(limbBox([sx * 1.1, 0, sz * 1.1], [sx * 0.25, 9, sz * 0.25], 0.09), '#d9d6cc'))),
      ...[2.5, 5.5].flatMap((y) => {
        const w = 1.1 - (y / 9) * 0.85;
        return [part(box(w * 2, 0.07, 0.07, 0, y, w), '#bdb9ae'), part(box(w * 2, 0.07, 0.07, 0, y, -w), '#bdb9ae'), part(box(0.07, 0.07, w * 2, w, y, 0), '#bdb9ae'), part(box(0.07, 0.07, w * 2, -w, y, 0), '#bdb9ae')];
      }),
      part(box(0.9, 0.12, 0.9, 0, 9.0), '#8f8a80'),
      part(box(0.26, 0.3, 1.1, 0, 9.3, 0.1), '#6f6a62'),
      part(box(0.05, 1.3, 2.0, 0, 9.4, -1.5), '#e9e6dc'),
      part(box(0.06, 9, 0.06, 0, 4.5, 0), '#6f6a62'),
    ]),
    /** Rotor de l'éolienne : 12 pales autour du moyeu, dans le plan xy, centré (144 triangles). */
    rotor: template(Array.from({ length: 12 }, (_, i) => part(box(0.32, 1.35, 0.03, 0, 1.0, 0).rotateY(0.35).rotateZ((i / 12) * Math.PI * 2), '#f2efe6'))),
    /** Réservoir rond en tôle sur son muret (120 triangles). */
    tank: template([part(prism(2.6, 2.6, 0, 1.5, 10), '#a9aeb0'), part(prism(2.62, 2.62, 1.5, 1.6, 10), '#7f8588'), part(prism(2.0, 2.0, 1.55, 1.58, 10), '#3a6b7a')]),
    /** Barre d'attache des chevaux (36 triangles). */
    rail: template([...[-1.6, 1.6].map((x) => part(box(0.14, 1.1, 0.14, x, 0.55), '#6f5236')), part(box(3.5, 0.12, 0.12, 0, 1.0), '#7f6040')]),
    /** Yucca : rosette de feuilles en épées, hampe fleurie (130 triangles). */
    yucca: template([
      ...Array.from({ length: 9 }, (_, i) => part(box(0.08, 0.95, 0.03, 0, 0.45, 0).rotateX(0.35 + (i % 3) * 0.25).rotateY((i / 9) * Math.PI * 2), '#ffffff', 1)),
      part(box(0.04, 1.3, 0.04, 0, 1.2), '#8a7a4a'),
      part(new THREE.ConeGeometry(0.16, 0.6, 5).translate(0, 1.75, 0), '#f1ead0'),
    ]),
    /** Armoise : buisson gris-vert en boule écrasée (40 triangles). */
    sage: template([
      part(new THREE.IcosahedronGeometry(0.55, 0).scale(1.2, 0.7, 1.1).translate(0, 0.35, 0), '#ffffff', 1),
      part(new THREE.IcosahedronGeometry(0.38, 0).scale(1.1, 0.75, 1).translate(0.45, 0.25, 0.2), '#ffffff', 1),
    ]),
    /** Barnum d'assistance (toile teintée sur quatre pieds), 3 × 3 m (68 triangles). */
    canopy: template([
      ...[-1.45, 1.45].flatMap((x) => [-1.45, 1.45].map((z) => part(box(0.06, 2.3, 0.06, x, 1.15, z), '#d9d6cc'))),
      part(new THREE.ConeGeometry(2.15, 0.6, 4).rotateY(Math.PI / 4).translate(0, 2.6, 0), '#ffffff', 1),
      part(box(3, 0.25, 3, 0, 2.2), '#ffffff', 1),
    ]),
    /** Virevoltant (boule d'herbes sèches), 0,8 m (40 triangles). */
    tumbleweed: template([part(new THREE.IcosahedronGeometry(0.42, 0), '#b59a63'), part(new THREE.IcosahedronGeometry(0.38, 0).rotateX(0.6).rotateY(0.4), '#9c8150')]),
    well: template([
      part(prism(1.25, 1.2, 0, 0.85, 10), '#b58a5e'),
      part(prism(1.0, 1.0, 0.7, 0.86, 10), '#2a3d44'),
      ...[-1.05, 1.05].map((x) => part(box(0.16, 2.4, 0.16, x, 1.2, 0), '#6f5236')),
      part(box(2.4, 0.16, 0.16, 0, 2.4, 0), '#6f5236'),
      part(box(0.03, 1.1, 0.03, 0, 1.85, 0), '#3a3f44'),
      part(prism(0.17, 0.2, 1.05, 1.35, 6), '#7a5a3a'),
      part(box(0.9, 0.5, 0.4, 1.9, 0.25, 0.4), '#9c4a2c'),
    ]),
    trough: template([part(box(3, 0.5, 0.8, 0, 0.25), '#a88a64'), part(box(2.7, 0.06, 0.55, 0, 0.47), '#3a6b7a')]),
    cactus: template([
      part(prism(0.32, 0.28, 0, 3.6, 6), '#ffffff', 1),
      part(new THREE.IcosahedronGeometry(0.3, 0).translate(0, 3.6, 0), '#ffffff', 1),
      part(box(0.7, 0.42, 0.42, 0.5, 1.6), '#ffffff', 1),
      part(prism(0.2, 0.18, 1.6, 2.9, 6, 0.85, 0), '#ffffff', 1),
      part(box(0.55, 0.36, 0.36, -0.42, 2.1), '#ffffff', 1),
      part(prism(0.17, 0.15, 2.1, 3.0, 6, -0.7, 0), '#ffffff', 1),
    ]),
    barrel: template([part(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 1.25, 1).translate(0, 0.45, 0), '#ffffff', 1), part(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.98, 0), '#e2604f')]),
    tuft: template([part(new THREE.ConeGeometry(0.55, 0.7, 5).translate(0, 0.35, 0), '#ffffff', 1), part(new THREE.ConeGeometry(0.35, 0.5, 4).translate(0.45, 0.25, 0.2), '#ffffff', 1)]),
    deadBush: template([
      ...Array.from({ length: 5 }, (_, i) => part(box(0.05, 1.1, 0.05, 0, 0.5, 0).rotateZ(0.5 * Math.cos(i * 1.3)).rotateX(0.5 * Math.sin(i * 1.3)), '#8a6a45')),
      part(new THREE.IcosahedronGeometry(0.4, 0).scale(1.2, 0.6, 1.2).translate(0, 0.9, 0), '#9a8a5a'),
    ]),
    rock: template([part(new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.7, 1), '#ffffff', 1)]),
    /** Arche de pierre de 1 m de portée (mise à l'échelle) : deux piliers, voûte en sept blocs. */
    arch: template([
      part(prism(0.32, 0.2, 0, 0.9, 6, -0.6, 0).scale(1, 1, 0.8), '#ffffff', 1),
      part(prism(0.3, 0.22, 0, 0.85, 6, 0.6, 0).scale(1, 1, 0.75), '#ffffff', 1),
      ...Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * (i / 6);
        return part(box(0.42, 0.24, 0.32, -Math.cos(a) * 0.6, 0.85 + Math.sin(a) * 0.42, 0).rotateZ(0), '#ffffff', 1);
      }),
      part(box(1.6, 0.2, 0.36, 0, 1.33, 0), '#ffffff', 1),
    ]),
    cairn: template([part(new THREE.DodecahedronGeometry(0.6, 0), '#a45a36'), part(new THREE.DodecahedronGeometry(0.45, 0).translate(0, 0.7, 0), '#b56b44'), part(new THREE.DodecahedronGeometry(0.32, 0).translate(0, 1.2, 0), '#9c4a2c'), part(new THREE.DodecahedronGeometry(0.2, 0).translate(0, 1.55, 0), '#c98b55')]),
    dome: template([
      part(new THREE.SphereGeometry(5.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f4f4f0'),
      part(box(1.2, 4.6, 0.12, 0, 2.6, 4.6).rotateX(-0.5), '#2b2f33'),
      part(prism(5.4, 5.4, -0.6, 0.2, 12), '#d9d6cc'),
    ]),
    stand: template([
      ...Array.from({ length: 6 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -2.8 + i * 0.95), i % 2 ? '#d9c7a8' : '#e6d6bb')),
      ...Array.from({ length: 6 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -2.8 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12.4, 0.22, 7.6, 0, 5.4, -0.4).rotateX(-0.06), '#f4efe6'),
      ...[-5.8, 5.8].map((x) => part(prism(0.12, 0.1, 0, 5.4, 6, x, 2.8), '#8f9699')),
    ]),
    gantry: template([
      ...[-6, 6].map((x) => part(box(0.7, 6, 0.7, x, 3), '#7a3a22')),
      part(box(13, 1.4, 0.5, 0, 6.2), '#ffffff', 1),
      ...Array.from({ length: 8 }, (_, i) => part(box(1.5, 0.7, 0.52, -5.25 + i * 1.5, 6.2 + (i % 2 ? 0.35 : -0.35)), i % 2 ? '#1b1b1b' : '#f5f5f5')),
    ]),
    flag: template([part(prism(0.05, 0.04, 0, 6, 5), '#e9e6dc'), part(box(0.03, 1, 1.6, 0, 5.4, 0.85), '#ffffff', 1)]),
    stake: template([part(box(0.06, 1.1, 0.06, 0, 0.55), '#f4efe6'), part(box(0.07, 0.18, 0.07, 0, 1.05), '#e2593f')]),
    tape: template([part(box(0.02, 0.06, 1, 0, 0.95, 0.5), '#ffffff', 1)]),
    berm: template([part(new THREE.CylinderGeometry(2.2, 2.6, 1.0, 6, 1, false, 0, Math.PI).scale(1, 1, 0.5).translate(0, 0.35, 0), '#a8562e')]),
    kicker: template([part(box(1.8, 0.9, 2.6, 0, 0.3).rotateX(0.35), '#b56b44'), part(box(1.8, 0.6, 1.2, 0, 0.3, -1.4), '#a8562e')]),
    tower: template([
      ...[-1.2, 1.2].flatMap((x) => [-1.2, 1.2].map((z) => part(box(0.15, 4, 0.15, x, 2, z), '#6f5236'))),
      part(box(3, 0.2, 3, 0, 4), '#8a6a45'),
      part(box(3.2, 0.12, 3.2, 0, 6.3), '#e2593f'),
      part(box(1.4, 0.15, 5, 0, 2.2, 3.2).rotateX(0.42), '#8a6a45'),
    ]),
    board: template([...[-0.9, 0.9].map((x) => part(box(0.1, 1.6, 0.1, x, 0.8), '#6f5236')), part(box(2.2, 1.0, 0.08, 0, 1.6), '#f4efe6'), part(box(2.0, 0.25, 0.09, 0, 1.85), '#e2593f')]),
    bale: template([part(box(1.2, 0.5, 0.6, 0, 0.25), '#e0c27a')]),
    banner: template([...[-1.4, 1.4].map((x) => part(prism(0.04, 0.03, 0, 2.6, 5, x, 0), '#e9e6dc')), part(box(2.8, 0.8, 0.03, 0, 2.1), '#ffffff', 1)]),
    fire: template([...Array.from({ length: 6 }, (_, i) => part(new THREE.DodecahedronGeometry(0.18, 0).translate(Math.cos(i) * 0.5, 0.08, Math.sin(i) * 0.5), '#6f6a62')), part(new THREE.ConeGeometry(0.3, 0.6, 5).translate(0, 0.3, 0), '#f08a24')]),
  };
}
type Kit = ReturnType<typeof kit>;

/** Poutre carrée de `a` à `b` (section `w`). */
function limbBox(a: readonly [number, number, number], b: readonly [number, number, number], w: number): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = d.length();
  const g = new THREE.BoxGeometry(w, L, w).translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate(a[0], a[1], a[2]);
}

const PALM_LEAVES = [C('#4f7a32'), C('#5b8638'), C('#46702e'), C('#6a8a3e')];
/** Chemises des cavaliers. */
const SHIRTS = [C('#f4efe6'), C('#2f6fa6'), C('#b8432f'), C('#e7d8b8'), C('#5f7d4a')];
/** Robes des chevaux (bai, alezan, isabelle, noir, blanc cassé) et des vaches. */
const COATS = [C('#7a4a2a'), C('#9a5a2e'), C('#c9a06a'), C('#3a2c22'), C('#e8dfd0')];
const CATTLE = [C('#8a4a2a'), C('#b0763f'), C('#e6dccb'), C('#5a3a26'), C('#c48a52')];
const YUCCA = [C('#7f8f4a'), C('#8a9a52'), C('#6f8044')];
const SAGE = [C('#9aa27a'), C('#a7ad86'), C('#8c9670')];

/** Pose un gabarit sur le sol (yaw : l'avant +z regarde (sin yaw, cos yaw)). */
function putOn(c: SiteContext, t: Template, x: number, z: number, yaw = 0, colour = WHITE, s = 1, dy = 0): boolean {
  const y = c.probe.heightAt(x, z);
  if (!Number.isFinite(y) || c.probe.buildingNear(x, z, 1)) return false;
  c.mesh.put(t, x, y + dy, z, yaw, s, s, s, colour);
  return true;
}

/** Point libre (ni route, ni eau, ni bâtiment) près de (x, z) : cherché en spirale sur `R` m ; null sinon. */
function freeNear(c: SiteContext, x: number, z: number, R: number, clear: number): [number, number] | null {
  for (let k = 0; k < 60; k++) {
    const d = (k / 60) * R;
    const px = x + Math.cos(k * 2.4) * d;
    const pz = z + Math.sin(k * 2.4) * d;
    let ok = true;
    for (const [dx, dz] of [[0, 0], [clear, 0], [-clear, 0], [0, clear], [0, -clear]] as const) {
      if (!c.probe.read(px + dx, pz + dz) || c.probe.road > 0.02 || c.probe.water > 0.1) {
        ok = false;
        break;
      }
    }
    if (ok && !c.probe.buildingNear(px, pz, clear)) return [px, pz];
  }
  return null;
}

const ell = (o: { x: number; z: number; rx: number; rz: number; rot: number }, e: number, a: number): [number, number] => {
  const ex = Math.cos(a) * o.rx * e;
  const ez = Math.sin(a) * o.rz * e;
  return [o.x + ex * Math.cos(o.rot) - ez * Math.sin(o.rot), o.z + ex * Math.sin(o.rot) + ez * Math.cos(o.rot)];
};

// ── Ports ──

const harbourSite = (id: string, h: HarbourSite, reach: number, templates: () => HarbourTemplates): Site => ({
  id,
  x: h.x,
  z: h.z,
  reach,
  needs: harbourCorners(h),
  *build(c) {
    yield* buildHarbour(c.mesh, c.probe, templates(), h);
    const ux = Math.cos(h.dir);
    const uz = Math.sin(h.dir);
    const w = -h.side * (h.halfWid + 6);
    const at = (u: number): [number, number] => [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
    strollPath(c, [at(-h.halfLen * 0.8), at(h.halfLen * 0.6), at(-h.halfLen * 0.8)], 31 + Math.round(h.x));
  },
});

// ── Chott Blanc et Circuit du Chott ──

/** Croûte de sel en polygones (fentes entre eux), jamais sur la chaussée : de loin, le sol clair du chott. */
function saltCrust(): Site {
  return {
    id: 'chott-sel',
    x: CHOTT.x,
    z: CHOTT.z,
    reach: 3300,
    needs: [[CHOTT.x, CHOTT.z], ell(CHOTT, 0.9, 0), ell(CHOTT, 0.9, Math.PI)],
    *build(c) {
      const r = rng(7771);
      const cell = 70;
      const salt = [C('#fbfaf6'), C('#f4f2ec'), C('#eeebe2'), C('#f8f6f0')];
      let n = 0;
      for (let u = -CHOTT.rx; u <= CHOTT.rx; u += cell) {
        for (let w = -CHOTT.rz; w <= CHOTT.rz; w += cell * 0.87) {
          const uo = u + ((Math.round(w / (cell * 0.87)) & 1) * cell) / 2 + (r() - 0.5) * 16;
          const wo = w + (r() - 0.5) * 14;
          if ((uo / CHOTT.rx) ** 2 + (wo / CHOTT.rz) ** 2 > 0.9) continue;
          const x = CHOTT.x + uo * Math.cos(CHOTT.rot) - wo * Math.sin(CHOTT.rot);
          const z = CHOTT.z + uo * Math.sin(CHOTT.rot) + wo * Math.cos(CHOTT.rot);
          // Hors des routes et du Circuit (6 points du polygone et le centre).
          const R = cell * 0.46;
          let ok = c.probe.read(x, z) && c.probe.road < 0.02;
          for (let k = 0; ok && k < 6; k++) if (!c.probe.read(x + Math.cos(k * 1.047) * R, z + Math.sin(k * 1.047) * R) || c.probe.road > 0.02) ok = false;
          if (!ok || c.probe.buildingNear(x, z, R)) continue;
          const y = c.probe.heightAt(x, z);
          if (!Number.isFinite(y)) continue;
          const col = salt[Math.floor(r() * salt.length)]!;
          const yy = y + 0.07;
          const a0 = r() * 1.0;
          const pts = Array.from({ length: 6 }, (_, k) => {
            const a = a0 + (k / 6) * Math.PI * 2;
            const rr = R * (0.82 + r() * 0.16);
            return [x + Math.cos(a) * rr, z + Math.sin(a) * rr] as const;
          });
          for (let k = 0; k < 6; k++) {
            const p = pts[k]!;
            const q = pts[(k + 1) % 6]!;
            c.mesh.triUp(x, yy, z, p[0], yy, p[1], q[0], yy, q[1], col);
          }
          if (++n % 150 === 0) {
            c.flush();
            yield;
          }
        }
      }
      c.flush();
    },
  };
}

/** Tribunes, portique et drapeaux du Circuit du Chott (ligne droite sud), promeneurs sur le sel. */
function circuit(k: () => Kit): Site {
  const R = DESERT_RING;
  const zS = R.z + R.radius;
  return {
    id: 'circuit-du-chott',
    x: R.x,
    z: R.z,
    reach: 950,
    needs: [[R.x - R.half, zS], [R.x + R.half, zS], [R.x, R.z - R.radius]],
    *build(c) {
      const K = k();
      for (let i = -2; i <= 2; i++) {
        const x = R.x + i * 13;
        const z = zS + 26;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(K.stand, x, y, z, Math.PI, 1, 1, 1, WHITE);
        for (let s = 0; s < 8; s++) c.spots.push({ kind: 'villager', x: x - 5 + s * 1.4, y: y + 1.6, z: z - 1.2, yaw: Math.PI, seed: ((i + 2) * 0.137 + s * 0.071) % 1 });
      }
      yield;
      const ay = c.probe.heightAt(R.x + 120, zS);
      if (Number.isFinite(ay)) c.mesh.put(K.gantry, R.x + 120, ay, zS, Math.PI / 2, 1, 1, 1, C('#e2593f'));
      const flags = [C('#e2593f'), C('#f2c230'), C('#2f8fb5'), C('#f4efe6')];
      for (let i = 0; i < 24; i++) {
        const x = R.x - R.half + (i * 2 * R.half) / 23;
        for (const z of [zS + 12, R.z - R.radius - 12]) {
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.flag, x, y, z, 0, 1, 1, 1, flags[i % flags.length]!);
        }
      }
      yield;
      strollPath(c, [[R.x - 300, R.z], [R.x + 300, R.z - 60], [R.x + 300, R.z + 60], [R.x - 300, R.z]], 404, 'jogger');
    },
  };
}

// ── Oasis : palmeraie, source, puits, tentes, dromadaires ──

function palm(c: SiteContext, K: Kit, x: number, z: number, r: () => number, s = 1): boolean {
  return putOn(c, K.palm, x, z, r() * 6.28, PALM_LEAVES[Math.floor(r() * PALM_LEAVES.length)]!, s * (0.8 + r() * 0.45));
}

function oasis(k: () => Kit, id: string, o: typeof OASIS, grove: number, seed: number): Site {
  return {
    id,
    x: o.x,
    z: o.z,
    reach: 1250,
    needs: [[o.x, o.z], [o.x + grove, o.z], [o.x - grove, o.z], [o.x, o.z + grove * 0.7], [o.x, o.z - grove * 0.7]],
    *build(c) {
      const K = k();
      const r = rng(seed);
      // Couronne de palmiers au bord de la source (eau turquoise : thème du monde).
      for (let i = 0; i < 34; i++) {
        const [x, z] = ell(o, 1.25 + r() * 0.6, (i / 34) * Math.PI * 2 + r() * 0.1);
        c.probe.read(x, z);
        if (c.probe.road < 0.02 && c.probe.water < 0.2) palm(c, K, x, z, r, 1.1);
      }
      c.flush();
      yield;
      // Palmeraie irriguée : rangs de palmiers dans les jardins (champs du générateur), plus serrés près de la source.
      const step = 10;
      let n = 0;
      const want = Math.round(Math.min(280, grove * 0.3) * Math.max(0.4, Math.min(1, c.density)));
      for (let gx = -grove; gx <= grove && n < want; gx += step) {
        for (let gz = -grove * 0.75; gz <= grove * 0.75 && n < want; gz += step) {
          const x = o.x + gx + (r() - 0.5) * 4;
          const z = o.z + gz + (r() - 0.5) * 4;
          if (!c.probe.read(x, z) || c.probe.field < 0.5 || c.probe.road > 0.02 || c.probe.water > 0.05 || c.probe.urban > 0.3) continue;
          if (r() > 0.55) continue;
          if (palm(c, K, x, z, r)) n++;
        }
        if (Math.round(gx / step) % 12 === 0) {
          c.flush();
          yield;
        }
      }
      c.flush();
      yield;
      // Ranch : éolienne de pompage, réservoir, abreuvoir, chevaux à l'attache, feu de camp, gens.
      const camp = freeNear(c, o.x + o.rx * 2.2, o.z - o.rz * 1.6, 160, 7);
      if (camp) {
        const [cx, cz] = camp;
        windmill(c, K, cx, cz, r() * 6.28);
        const tk = freeNear(c, cx + 9, cz + 3, 12, 3.5);
        if (tk) putOn(c, K.tank, tk[0], tk[1], 0);
        putOn(c, K.trough, cx + 4, cz - 3, 0.3);
        const rl = freeNear(c, cx - 14, cz + 8, 14, 3);
        if (rl) {
          putOn(c, K.rail, rl[0], rl[1], 0.2);
          for (let i = 0; i < 3; i++) putOn(c, K.horse, rl[0] - 1.2 + i * 1.2, rl[1] + 1.6, Math.PI + 0.2 + (r() - 0.5) * 0.3, COATS[Math.floor(r() * COATS.length)]!);
        }
        putOn(c, K.fire, cx + 22, cz + 2);
        for (let i = 0; i < 4; i++) {
          const x = cx + 8 + r() * 14;
          const z = cz - 4 + r() * 10;
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.spots.push({ kind: 'villager', x, y, z, yaw: r() * 6.28, seed: r() });
        }
      }
      strollPath(c, [ell(o, 1.6, 0), ell(o, 1.7, 1.6), ell(o, 1.6, 3.1), ell(o, 1.7, 4.7), ell(o, 1.6, 6.2)], seed + 7);
    },
  };
}

/** Guelta du Vautour : vasque d'eau dans la roche, quelques palmiers et des rochers autour. */
function guelta(k: () => Kit): Site {
  const o = GUELTA;
  return {
    id: 'guelta-du-vautour',
    x: o.x,
    z: o.z,
    reach: 900,
    needs: [[o.x, o.z], ell(o, 1.5, 0), ell(o, 1.5, Math.PI)],
    *build(c) {
      const K = k();
      const r = rng(5150);
      for (let i = 0; i < 14; i++) {
        const [x, z] = ell(o, 1.2 + r() * 0.5, (i / 14) * Math.PI * 2 + r() * 0.2);
        c.probe.read(x, z);
        if (c.probe.road < 0.02 && c.probe.water < 0.2) palm(c, K, x, z, r, 0.9);
      }
      for (let i = 0; i < 18; i++) {
        const [x, z] = ell(o, 1.15 + r() * 0.9, r() * Math.PI * 2);
        putOn(c, K.rock, x, z, r() * 6, C('#9c4a2c'), 0.8 + r() * 1.8, -0.3);
      }
    },
  };
}

/** Villages en terre crue : un puits sur la place, quelques palmiers dans les rues. */
function village(k: () => Kit, v: (typeof VILLAGES)[number], i: number): Site {
  return {
    id: `village-${i}`,
    x: v.x,
    z: v.z,
    reach: 700,
    needs: [[v.x, v.z], [v.x + v.r, v.z], [v.x - v.r, v.z]],
    *build(c) {
      const K = k();
      const r = rng(9100 + i);
      const u = [Math.cos(v.angle), Math.sin(v.angle)] as const;
      const w = [-u[1], u[0]] as const;
      const well = freeNear(c, v.x + u[0] * 14 + w[0] * 14, v.z + u[1] * 14 + w[1] * 14, 30, 2.5);
      if (well) {
        putOn(c, K.well, well[0], well[1], v.angle);
        const y = c.probe.heightAt(well[0] + 2, well[1]);
        if (Number.isFinite(y)) c.spots.push({ kind: 'villager', x: well[0] + 2.2, y, z: well[1] + 0.5, yaw: -1.2, seed: r() });
      }
      for (let p = 0; p < v.palms; p++) {
        const a = r() * Math.PI * 2;
        const d = 25 + r() * v.r * 0.8;
        const q = freeNear(c, v.x + Math.cos(a) * d, v.z + Math.sin(a) * d, 25, 3);
        if (q) palm(c, K, q[0], q[1], r);
      }
      // Éolienne de pompage et réservoir au bord du village.
      const a = r() * Math.PI * 2;
      const m = freeNear(c, v.x + Math.cos(a) * v.r * 0.9, v.z + Math.sin(a) * v.r * 0.9, 80, 4);
      if (m) {
        windmill(c, K, m[0], m[1], r() * 6.28);
        const tk = freeNear(c, m[0] + 7, m[1], 10, 3.5);
        if (tk) putOn(c, K.tank, tk[0], tk[1], 0);
      }
    },
  };
}

// ── Éoliennes de pompage (rotor qui tourne au vent) ──

function windmill(c: SiteContext, K: Kit, x: number, z: number, yaw: number): void {
  const y = c.probe.heightAt(x, z);
  if (!Number.isFinite(y) || c.probe.buildingNear(x, z, 2)) return;
  c.mesh.put(K.windTower, x, y, z, yaw, 1, 1, 1, WHITE);
  const g = new THREE.Group();
  g.name = 'eolienne';
  const rot = meshOf([{ t: K.rotor, x: 0, y: 0, z: 0 }], c.mat);
  g.add(rot);
  // Moyeu devant la tête (axe +z du gabarit, tourné de yaw).
  g.position.set(x + Math.sin(yaw) * 0.75, y + 9.3, z + Math.cos(yaw) * 0.75);
  g.rotation.y = yaw;
  const speed = 1.4 + Math.abs(Math.sin(x * 0.37 + z * 0.11)) * 0.8;
  c.moving.push({ object: g, step: (time) => { rot.rotation.z = time * speed; } });
}

// ── Troupeaux menés par des cavaliers (animés) ──

function caravan(k: () => Kit, cv: (typeof CARAVANS)[number], seed: number): Site {
  return {
    id: cv.id,
    x: cv.x,
    z: cv.z,
    reach: 1100,
    needs: [[cv.x, cv.z], ell(cv, 1, 0), ell(cv, 1, Math.PI)],
    *build(c) {
      const K = k();
      yield;
      const r = rng(seed);
      // Longueur de la boucle (périmètre de Ramanujan) : la caravane avance à `speed` m/s.
      const a = cv.rx;
      const b = cv.rz;
      const L = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const at = (s: number) => {
        const t = ((((s / L) % 1) + 1) % 1) * Math.PI * 2;
        return { p: ell(cv, 1 + 0.06 * Math.sin(t * 3 + seed), t), t };
      };
      // En tête et en queue, un cavalier ; entre les deux, les vaches en file un peu lâche.
      for (let i = 0; i < cv.n + 2; i++) {
        const mounted = i === 0 || i === cv.n + 1;
        const g = new THREE.Group();
        g.name = mounted ? 'cavalier' : 'vache';
        const coat = mounted ? COATS[(i + seed) % COATS.length]! : CATTLE[Math.floor(r() * CATTLE.length)]!;
        g.add(meshOf([{ t: mounted ? K.horse : K.cow, x: 0, y: 0, z: 0, c: coat }], c.mat));
        if (mounted) g.add(meshOf([{ t: K.rider, x: 0, y: 1.6, z: -0.05, c: SHIRTS[(i + seed) % SHIRTS.length]! }], c.mat));
        const gap = i * 3.6 + (mounted ? 0 : (r() - 0.5) * 1.5);
        const phase = r() * 6.28;
        c.moving.push({
          object: g,
          step: (time) => {
            const s = time * cv.speed - gap;
            const { p } = at(s);
            const { p: q } = at(s + 1.5);
            const y = c.probe.heightAt(p[0], p[1]);
            const bob = Math.abs(Math.sin(time * 2.6 + phase)) * 0.08;
            g.position.set(p[0], (Number.isFinite(y) ? y : 0) + bob, p[1]);
            g.rotation.y = Math.atan2(q[0] - p[0], q[1] - p[1]);
            g.rotation.z = Math.sin(time * 1.3 + phase) * 0.03;
          },
        });
      }
    },
  };
}

// ── Arches de pierre ──

function stoneArch(k: () => Kit, i: number): Site {
  const [x0, z0, span, yaw] = ARCHES[i]!;
  return {
    id: `arche-${i}`,
    x: x0,
    z: z0,
    reach: 1600,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const q = freeNear(c, x0, z0, 160, span * 0.7);
      if (!q) return;
      const [x, z] = q;
      const y = c.probe.heightAt(x, z);
      if (!Number.isFinite(y)) return;
      const tone = [C('#9c4a2c'), C('#a8562e'), C('#8f4428')][i % 3]!;
      // Pieds enfoncés de 1 m (sol en pente).
      c.mesh.put(K.arch, x, y - 1, z, yaw, span, span * 0.8, span * 0.55, tone);
      const r = rng(330 + i);
      for (let n = 0; n < 7; n++) putOn(c, K.rock, x + (r() - 0.5) * span * 1.6, z + (r() - 0.5) * span * 1.2, r() * 6, tone, 0.8 + r() * 1.6, -0.3);
    },
  };
}

// ── Cactus, touffes sèches, cailloux : semis par carrés de 2 km autour du coureur ──

function scrub(k: () => Kit, cx: number, cz: number): Site {
  return {
    id: `semis-${cx}_${cz}`,
    x: cx,
    z: cz,
    reach: 1500,
    needs: [[cx, cz]],
    *build(c) {
      const K = k();
      const r = rng(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663));
      // Plaine du Sud-Ouest : armoises, yuccas, touffes sèches, grands cactus à bras, cailloux.
      const n = Math.round(190 * Math.max(0.35, c.density));
      const dry = [C('#c2a25e'), C('#b08f52'), C('#d1b06a'), C('#a3884e')];
      const green = [C('#5d7a3a'), C('#6b8742'), C('#567036')];
      const stone = [C('#9c4a2c'), C('#b56b44'), C('#8a5038')];
      for (let i = 0; i < n; i++) {
        const x = cx + (r() - 0.5) * 2000;
        const z = cz + (r() - 0.5) * 2000;
        // Terre nue seulement (sable : peu de touffes ; ni route, ni bourg, ni eau, ni sel).
        if (!c.probe.read(x, z) || c.probe.road > 0.01 || c.probe.urban > 0.1 || c.probe.water > 0.05 || c.probe.field > 0.3 || c.probe.forest > 0.4) continue;
        const sandy = c.probe.sand > 0.5;
        const roll = r();
        if (sandy && roll > 0.25) continue;
        const yaw = r() * 6.28;
        if (roll < 0.2) putOn(c, K.tuft, x, z, yaw, dry[Math.floor(r() * dry.length)]!, 0.8 + r() * 0.7);
        else if (roll < 0.4) putOn(c, K.sage, x, z, yaw, SAGE[Math.floor(r() * SAGE.length)]!, 0.7 + r() * 0.8);
        else if (roll < 0.52) putOn(c, K.yucca, x, z, yaw, YUCCA[Math.floor(r() * YUCCA.length)]!, 0.8 + r() * 0.6);
        else if (roll < 0.56) putOn(c, K.deadBush, x, z, yaw, WHITE, 0.8 + r() * 0.6);
        else if (roll < 0.62) putOn(c, K.cactus, x, z, yaw, green[Math.floor(r() * green.length)]!, 1.1 + r() * 0.9);
        else if (roll < 0.65) putOn(c, K.barrel, x, z, yaw, green[Math.floor(r() * green.length)]!, 0.8 + r() * 0.6);
        else putOn(c, K.rock, x, z, yaw, stone[Math.floor(r() * stone.length)]!, 0.4 + r() * 1.1, -0.2);
        if (i % 90 === 89) yield;
      }
    },
  };
}

// ── Virevoltants : boules d'herbes sèches qui roulent au vent près des routes (carrés de 1 km) ──

/** Vent dominant d'ouest-sud-ouest (direction vers laquelle roulent les virevoltants). */
const WIND: P2 = [0.94, -0.34];

function tumbleweeds(k: () => Kit, cx: number, cz: number): Site {
  return {
    id: `virevoltants-${cx}_${cz}`,
    x: cx,
    z: cz,
    reach: 900,
    needs: [[cx, cz]],
    *build(c) {
      const K = k();
      const r = rng(Math.imul(cx, 2246822519) ^ Math.imul(cz, 3266489917) ^ 0x7b1);
      const want = c.density < 0.6 ? 2 : 4;
      let made = 0;
      for (let t = 0; t < 24 && made < want; t++) {
        const x = cx + (r() - 0.5) * 900;
        const z = cz + (r() - 0.5) * 900;
        // Sol nu au départ (ni route, ni eau, ni bourg, ni sable de l'erg), une route à moins de 60 m.
        if (!c.probe.read(x, z) || c.probe.road > 0.02 || c.probe.water > 0.05 || c.probe.urban > 0.1 || c.probe.sand > 0.5) continue;
        let near = false;
        for (let a = 0; a < 8 && !near; a++) for (const d of [20, 40, 60]) if (c.probe.read(x + Math.cos(a * 0.785) * d, z + Math.sin(a * 0.785) * d) && c.probe.road > 0.3) near = true;
        if (!near) continue;
        made++;
        const g = new THREE.Group();
        g.name = 'virevoltant';
        const ball = meshOf([{ t: K.tumbleweed, x: 0, y: 0, z: 0 }], c.mat);
        g.add(ball);
        const size = 0.8 + r() * 0.7;
        const L = 110 + r() * 80;
        const speed = 2.2 + r() * 2.2;
        const phase = r() * L;
        const wob = r() * 6.28;
        const sx = x - WIND[0] * L * 0.5;
        const sz = z - WIND[1] * L * 0.5;
        g.rotation.y = Math.atan2(WIND[0], WIND[1]);
        c.moving.push({
          object: g,
          step: (time) => {
            const s = (time * speed + phase) % L;
            const side = Math.sin(s * 0.05 + wob) * 6;
            const px = sx + WIND[0] * s - WIND[1] * side;
            const pz = sz + WIND[1] * s + WIND[0] * side;
            const y = c.probe.heightAt(px, pz);
            // Rebonds, roulé, et apparition / disparition en douceur aux deux bouts du trajet.
            const hop = Math.abs(Math.sin(s * 0.35 + wob)) * 0.6 * size;
            const fade = Math.min(1, s / 10, (L - s) / 10);
            g.position.set(px, (Number.isFinite(y) ? y : 0) + 0.4 * size + hop, pz);
            g.scale.setScalar(size * Math.max(0.01, fade));
            ball.rotation.x = s / (0.42 * size);
          },
        });
      }
    },
  };
}

// ── Montgolfières au-dessus du canyon, au lever du jour ──

function balloons(i: number): Site {
  const [x0, z0] = CANYON[i * 2]!;
  return {
    id: `montgolfieres-${i}`,
    x: x0,
    z: z0,
    reach: 1400,
    needs: [[x0, z0]],
    *build(c) {
      yield;
      const y0 = c.probe.heightAt(x0 + 300, z0);
      const base = Number.isFinite(y0) ? y0 : 450;
      const palettes: Array<[string, string]> = [['#e2593f', '#f2c230'], ['#2f8fb5', '#f4efe6'], ['#7a4fb5', '#f08a24'], ['#3aa39b', '#e2604f'], ['#f2c230', '#2f6fa6'], ['#e2604f', '#f4efe6']];
      for (let b = 0; b < 2; b++) {
        const [ca, cb] = palettes[(i * 2 + b) % palettes.length]!;
        const pieces: THREE.BufferGeometry[] = [];
        for (let g = 0; g < 8; g++) pieces.push(part(new THREE.SphereGeometry(9, 2, 7, (g / 8) * Math.PI * 2, Math.PI / 4, 0, Math.PI * 0.62).scale(1, 1.18, 1), g % 2 ? ca : cb));
        pieces.push(part(new THREE.CylinderGeometry(6.5, 1.3, 7, 8, 1, true).translate(0, -7.6, 0), cb));
        pieces.push(part(box(1.5, 1.1, 1.5, 0, -13, 0), '#8a6a45'));
        for (const [dx, dz] of [[0.65, 0.65], [-0.65, 0.65], [0.65, -0.65], [-0.65, -0.65]] as const) pieces.push(part(box(0.05, 2.6, 0.05, dx, -11.3, dz), '#3a3f44'));
        pieces.push(part(new THREE.ConeGeometry(0.35, 0.9, 5).translate(0, -11.6, 0), '#f6c34a'));
        const m = meshOf([{ t: template(pieces), x: 0, y: 0, z: 0 }], c.mat);
        m.name = 'montgolfiere';
        const seed = i * 3.1 + b * 1.7;
        c.moving.push({
          object: m,
          step: (time) => {
            const { hour } = islandClock();
            // Vols du matin seulement : décollage vers 5 h 30, posé vers 10 h 30.
            const up = Math.min(1, Math.max(0, (hour - 5.4) / 1.2)) * Math.min(1, Math.max(0, (10.6 - hour) / 0.8));
            m.visible = up > 0.02;
            if (!m.visible) return;
            const drift = ((hour - 5.4) / 5) * 900;
            const x = x0 + 220 + b * 260 + Math.sin(time * 0.01 + seed) * 60;
            const z = z0 - 300 + drift * (0.5 + b * 0.3) + Math.cos(time * 0.012 + seed) * 50;
            m.position.set(x, base + 25 + up * (140 + b * 70) + Math.sin(time * 0.05 + seed) * 6, z);
            m.rotation.y = time * 0.02 + seed;
          },
        });
      }
    },
  };
}

// ── Bike park des Buttes et cyclo-cross des Sables (boucles dessinées du générateur) ──

/** Points de la boucle dessinée (même forme que build.ts) : position, direction, courbure. */
function loopPoints(c0: P2, R: number): Array<{ x: number; z: number; dx: number; dz: number; curve: number }> {
  const n = 90;
  const shape = (a: number) => R * (1 + 0.22 * Math.sin(3 * a + 0.7) + 0.09 * Math.sin(7 * a + 1.3));
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [c0[0] + Math.cos(a) * shape(a) * 1.25, c0[1] + Math.sin(a) * shape(a)] as const;
  });
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    const o = pts[(i + n - 1) % n]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    let curve = Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.atan2(p[1] - o[1], p[0] - o[0]);
    if (curve > Math.PI) curve -= 2 * Math.PI;
    if (curve < -Math.PI) curve += 2 * Math.PI;
    return { x: p[0], z: p[1], dx: (q[0] - p[0]) / L, dz: (q[1] - p[1]) / L, curve };
  });
}

const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

function bikePark(k: () => Kit): Site {
  const [x, z] = BIKEPARK;
  return {
    id: 'bike-park-des-buttes',
    x,
    z,
    reach: 700,
    needs: [[x, z], [x + 250, z], [x - 250, z]],
    *build(c) {
      const K = k();
      const pts = loopPoints(BIKEPARK, 165);
      const r = rng(9091);
      const half = 1.5;
      pts.forEach((p, i) => {
        if (Math.abs(p.curve) > 0.09) {
          const s = p.curve > 0 ? -1 : 1;
          putOn(c, K.berm, p.x - p.dz * (half + 0.5) * s, p.z + p.dx * (half + 0.5) * s, yawOf(-p.dz * s, p.dx * s) + Math.PI, WHITE, 1, -0.15);
        } else if (i % 4 === 2) {
          const s = i % 8 < 4 ? 1 : -1;
          putOn(c, K.kicker, p.x - p.dz * (half + 2.4) * s, p.z + p.dx * (half + 2.4) * s, yawOf(p.dx, p.dz), WHITE);
        }
        if (i % 3 === 0) putOn(c, K.stake, p.x - p.dz * (half + 0.8), p.z + p.dx * (half + 0.8));
        if (i % 9 === 4 && r() < 0.7) {
          const kx = p.x + p.dz * (half + 5);
          const kz = p.z - p.dx * (half + 5);
          const ky = c.probe.heightAt(kx, kz);
          if (Number.isFinite(ky)) c.spots.push({ kind: 'villager', x: kx, y: ky, z: kz, yaw: yawOf(-p.dz, p.dx), seed: r() });
        }
      });
      const p0 = pts[22]!;
      putOn(c, K.tower, p0.x - p0.dz * 7, p0.z + p0.dx * 7, yawOf(p0.dx, p0.dz));
      putOn(c, K.board, p0.x + p0.dz * 4, p0.z - p0.dx * 4, yawOf(-p0.dx, -p0.dz));
      putOn(c, K.banner, p0.x + p0.dx * 6 + p0.dz * 3.5, p0.z + p0.dz * 6 - p0.dx * 3.5, yawOf(p0.dz, -p0.dx), C('#e2593f'));
    },
  };
}

function cycloCross(k: () => Kit): Site {
  const [x, z] = CROSS;
  return {
    id: 'cyclo-cross-des-sables',
    x,
    z,
    reach: 700,
    needs: [[x, z], [x + 230, z], [x - 230, z]],
    *build(c) {
      const K = k();
      const pts = loopPoints(CROSS, 150);
      const r = rng(4411);
      const half = 1.8;
      pts.forEach((p, i) => {
        for (const s of [-1, 1]) {
          const ax = p.x - p.dz * (half + 1.1) * s;
          const az = p.z + p.dx * (half + 1.1) * s;
          if (!putOn(c, K.stake, ax, az)) continue;
          const q = pts[(i + 1) % pts.length]!;
          const bx = q.x - q.dz * (half + 1.1) * s;
          const bz = q.z + q.dx * (half + 1.1) * s;
          const y = c.probe.heightAt(ax, az);
          c.mesh.put(K.tape, ax, y, az, Math.atan2(bx - ax, bz - az), 1, 1, Math.hypot(bx - ax, bz - az), i % 2 ? C('#e2593f') : WHITE);
        }
        if (Math.abs(p.curve) > 0.1 && i % 2 === 0) {
          const s = p.curve > 0 ? -1 : 1;
          putOn(c, K.bale, p.x - p.dz * (half + 2.4) * s, p.z + p.dx * (half + 2.4) * s, yawOf(p.dx, p.dz) + Math.PI / 2);
        }
        if (i % 6 === 0 && r() < 0.6) {
          const s = r() < 0.5 ? -1 : 1;
          const kx = p.x - p.dz * (half + 4) * s;
          const kz = p.z + p.dx * (half + 4) * s;
          const ky = c.probe.heightAt(kx, kz);
          if (Number.isFinite(ky)) c.spots.push({ kind: r() < 0.3 ? 'child' : 'villager', x: kx, y: ky, z: kz, yaw: yawOf(p.dz * s, -p.dx * s), seed: r() });
        }
      });
      yield;
      const p0 = pts[67]!;
      putOn(c, K.gantry, p0.x, p0.z, yawOf(p0.dz, -p0.dx), C('#7a4fb5'), 0.45);
      for (let i = 0; i < 4; i++) putOn(c, K.canopy, p0.x - p0.dz * 14 + p0.dx * (i * 8 - 12), p0.z + p0.dx * 14 + p0.dz * (i * 8 - 12), yawOf(p0.dx, p0.dz), SHIRTS[(i + 1) % SHIRTS.length]!);
      putOn(c, K.board, p0.x + p0.dz * 4, p0.z - p0.dx * 4, yawOf(-p0.dx, -p0.dz));
    },
  };
}

// ── Sommets : dôme de l'observatoire, cairns de la Tête du Vautour ──

function summits(k: () => Kit): Site {
  return {
    id: 'vautour',
    x: (PEAK[0] + COL[0]) / 2,
    z: (PEAK[1] + COL[1]) / 2,
    reach: 2200,
    needs: [PEAK, COL],
    *build(c) {
      const K = k();
      const py = c.probe.heightAt(PEAK[0], PEAK[1]);
      if (Number.isFinite(py)) c.mesh.put(K.dome, PEAK[0], py + 14, PEAK[1], 0.4, 1, 1, 1, WHITE);
      yield;
      const r = rng(707);
      for (let i = 0; i < 14; i++) {
        const q = freeNear(c, COL[0] + (r() - 0.5) * 120, COL[1] + (r() - 0.5) * 120, 30, 2);
        if (q) putOn(c, K.cairn, q[0], q[1], r() * 6, WHITE, 0.8 + r() * 0.9);
      }
      const sign = freeNear(c, COL[0] + 12, COL[1] + 6, 30, 2);
      if (sign) putOn(c, K.board, sign[0], sign[1], 0.6);
    },
  };
}

// ── Parois en strates, éboulis, plantes des fissures, arbres à pompons ──
//
// Les parois du Grand Canyon et des mesas sont lues dans le relief des tuiles (le générateur y creuse des gradins) :
// chaque contremarche raide est habillée de gros blocs taillés posés en gradins, une strate par tranche de
// STRATE m d'altitude (couleur par tranche : les strates se suivent le long de la paroi), avec quelques surplombs à
// la corniche, des éboulis au pied et des touffes ou des fleurs sur les replats.

/** Épaisseur d'une strate (m) : les blocs sont coupés aux mêmes altitudes d'une station à l'autre. */
const STRATE = 18;
/** Strates du grès : rouges et orangés, de temps en temps une bande crème (comme les grès du Sud-Ouest). */
const STRATES = ['#a9482a', '#c8683a', '#b5552f', '#e0b07a', '#9a3f26', '#cf7a46', '#b04e2c', '#d9925a', '#a3442a', '#c2603a'].map(C);
const CORNICHE = C('#e4bf8c');
const EBOULIS = [C('#9c4a2c'), C('#b2643a'), C('#8a4430'), C('#a85a36'), C('#c0703f')];
const POMPONS = [C('#5f8a3a'), C('#6f9a40'), C('#4f7a34'), C('#7aa346')];
const TOUFFES = [C('#6b8f3c'), C('#7d9a44'), C('#5d8236')];
const ROSES = [C('#e86fa0'), C('#f08cb8'), C('#d95a8f')];

/**
 * Bloc à six faces (12 triangles) : `v` = 8 coins, bas avant gauche, bas avant droit, bas arrière droit, bas arrière
 * gauche, puis les quatre du haut dans le même ordre. Faces tournées vers l'extérieur.
 */
function hexa(v: ReadonlyArray<readonly [number, number, number]>): THREE.BufferGeometry {
  const quads = [[0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]];
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) pos.push(...v[i!]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Sommets bousculés (même décalage pour un même coin : la forme reste fermée). */
function jitter(g: THREE.BufferGeometry, amt: number, seed: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = rng(Math.imul(Math.round(x * 1000), 73856093) ^ Math.imul(Math.round(y * 1000), 19349663) ^ Math.imul(Math.round(z * 1000), 83492791) ^ seed);
    p.setXYZ(i, x * (1 + (r() - 0.5) * amt), y * (1 + (r() - 0.5) * amt), z * (1 + (r() - 0.5) * amt));
  }
  return g;
}

/** Branche de `a` à `b` (tube ouvert à `sides` pans). */
function limb(a: readonly [number, number, number], b: readonly [number, number, number], r0: number, r1: number, sides = 4): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, sides, 1, true).translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate(a[0], a[1], a[2]);
}

/** Pompon de feuillage (20 triangles), teinté. */
const pompon = (x: number, y: number, z: number, r: number, seed: number) => part(jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, seed).scale(r * 1.25, r * 0.8, r * 1.25).translate(x, y, z), '#ffffff', 1);

function stoneKit() {
  const BARK = '#6e4a30';
  return {
    /** Bloc taillé d'une strate : 1 m de large (x, centré), 1 m de haut, face avant en z = 0, dos en z = −1. */
    blocA: template([part(hexa([[-0.5, 0, 0], [0.5, 0, 0], [0.5, 0, -1], [-0.5, 0, -1], [-0.47, 1, -0.05], [0.48, 1, -0.03], [0.5, 1, -1], [-0.5, 1, -1]]), '#ffffff', 1)]),
    blocB: template([part(hexa([[-0.5, 0, 0.02], [0.5, 0, 0], [0.5, 0, -1], [-0.5, 0, -1], [-0.5, 0.96, -0.02], [0.44, 1, -0.07], [0.46, 1, -1], [-0.5, 0.97, -1]]), '#ffffff', 1)]),
    /** Gros rocher taillé d'éboulis (12 triangles), posé sur sa base. */
    boulder: template([part(jitter(hexa([[-0.55, 0, 0.45], [0.5, 0, 0.5], [0.55, 0, -0.5], [-0.5, 0, -0.45], [-0.4, 0.85, 0.3], [0.42, 0.8, 0.38], [0.38, 0.9, -0.36], [-0.36, 0.78, -0.4]]), 0.3, 11), '#ffffff', 1)]),
    /** Caillou d'éboulis (20 triangles). */
    stone: template([part(jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.35, 23).scale(1.15, 0.75, 1).translate(0, 0.3, 0), '#ffffff', 1)]),
    /** Touffe verte des fissures (15 triangles). */
    tuft: template([
      part(new THREE.ConeGeometry(0.42, 0.75, 5, 1, true).translate(0, 0.37, 0), '#ffffff', 1),
      part(new THREE.ConeGeometry(0.3, 0.55, 5, 1, true).translate(0.32, 0.27, 0.12), '#ffffff', 1),
      part(new THREE.ConeGeometry(0.28, 0.5, 5, 1, true).translate(-0.22, 0.25, -0.24), '#ffffff', 1),
    ]),
    /** Petites fleurs roses sur une touffe (26 triangles). */
    bloom: template([
      part(new THREE.ConeGeometry(0.38, 0.5, 5, 1, true).translate(0, 0.25, 0), '#5e8a3c'),
      part(new THREE.ConeGeometry(0.26, 0.4, 5, 1, true).translate(0.28, 0.2, -0.1), '#5e8a3c'),
      ...([[0, 0.56, 0], [0.24, 0.5, 0.18], [-0.2, 0.48, 0.14], [0.3, 0.44, -0.2]] as const).map(([x, y, z], i) => part(new THREE.TetrahedronGeometry(0.11 + (i % 2) * 0.03, 0).translate(x, y, z), '#ffffff', 1)),
    ]),
    /** Arbre à pompons sur branches tordues, ≈ 5,5 m (148 triangles). */
    treeA: template([
      part(limb([0, -0.3, 0], [0.5, 1.8, 0.2], 0.34, 0.25, 5), BARK),
      part(limb([0.5, 1.8, 0.2], [-0.1, 3.2, 0.1], 0.25, 0.18, 5), BARK),
      part(limb([-0.1, 3.2, 0.1], [0.9, 3.6, 0.3], 0.15, 0.11), BARK),
      part(limb([0.9, 3.6, 0.3], [1.8, 4.4, 0.6], 0.11, 0.08), BARK),
      part(limb([-0.1, 3.2, 0.1], [-1.0, 3.9, -0.4], 0.15, 0.1), BARK),
      part(limb([-1.0, 3.9, -0.4], [-1.6, 4.7, -0.7], 0.1, 0.07), BARK),
      part(limb([-0.1, 3.2, 0.1], [0.2, 5.3, -0.1], 0.14, 0.08), BARK),
      part(limb([0.5, 1.8, 0.2], [1.9, 2.6, -0.8], 0.12, 0.07), BARK),
      pompon(1.9, 4.65, 0.6, 1.25, 1),
      pompon(-1.7, 4.95, -0.75, 1.35, 2),
      pompon(0.15, 5.6, -0.1, 1.5, 3),
      pompon(2.05, 2.85, -0.9, 0.9, 4),
    ]),
    /** Variante basse et plus tordue, ≈ 4 m (132 triangles). */
    treeB: template([
      part(limb([0, -0.3, 0], [-0.6, 1.2, 0.3], 0.3, 0.22, 5), BARK),
      part(limb([-0.6, 1.2, 0.3], [0.3, 2.3, 0.0], 0.22, 0.16, 5), BARK),
      part(limb([0.3, 2.3, 0.0], [1.6, 3.0, 0.5], 0.13, 0.08), BARK),
      part(limb([0.3, 2.3, 0.0], [-0.9, 3.3, -0.6], 0.13, 0.08), BARK),
      part(limb([-0.6, 1.2, 0.3], [-1.9, 1.9, 0.9], 0.11, 0.07), BARK),
      part(limb([0.3, 2.3, 0.0], [0.5, 3.8, 0.2], 0.12, 0.07), BARK),
      pompon(1.75, 3.25, 0.55, 1.15, 5),
      pompon(-1.05, 3.55, -0.65, 1.1, 6),
      pompon(0.5, 4.15, 0.2, 1.2, 7),
      pompon(-2.0, 2.15, 0.95, 0.8, 8),
    ]),
  };
}
type StoneKit = ReturnType<typeof stoneKit>;

/** Point libre pour une pièce posée : sur terre, ni route (< 0,02), ni eau, ni bâtiment. */
function clearAt(c: SiteContext, x: number, z: number, water = 0.2): boolean {
  return c.probe.read(x, z) && c.probe.road < 0.02 && c.probe.water < water;
}

/** Réglages d'une paroi : pas entre stations (m), pente mini d'une contremarche, hauteur mini, éboulis, surplombs. */
interface WallStyle {
  step: number;
  slope: number;
  rise: number;
  /** Éboulis au pied des contremarches dont le bas est à moins de `footBand` m du point le plus bas du profil. */
  footBand: number;
  scree: number;
  overhang: number;
  /** Portée des éboulis (m) à partir du pied. */
  spread: number;
}

/** Mémoire d'un chantier de paroi : contremarches déjà habillées (x, z, altitude du milieu). */
type Placed = number[];

/**
 * Habille la contremarche qui passe près de (mx, mz) : direction de la pente lue sur le relief, bornes de la
 * contremarche, blocs d'une strate chacun, puis surplomb, plantes et éboulis. Rend le nombre de pièces posées.
 */
function dressRiser(c: SiteContext, K: StoneKit, S: WallStyle, mx: number, mz: number, lowest: number, placed: Placed, r: () => number): number {
  const H = c.probe.heightAt;
  const gx = (H(mx + 3, mz) - H(mx - 3, mz)) / 6;
  const gz = (H(mx, mz + 3) - H(mx, mz - 3)) / 6;
  const g = Math.hypot(gx, gz);
  if (!Number.isFinite(g) || g < S.slope * 0.7) return 0;
  // u : vers le haut de la pente ; w : le long de la paroi.
  const ux = gx / g;
  const uz = gz / g;
  const wx = -uz;
  const wz = ux;
  const ds = 2;
  const N = 40;
  const hs = new Float64Array(2 * N + 1);
  for (let i = -N; i <= N; i++) hs[i + N] = H(mx + ux * i * ds, mz + uz * i * ds);
  const sl = (i: number) => (hs[i + 1]! - hs[i]!) / ds;
  let ia = N;
  let ib = N;
  while (ia > 0 && Number.isFinite(hs[ia - 1]) && sl(ia - 1) > S.slope * 0.8) ia--;
  while (ib < 2 * N && Number.isFinite(hs[ib + 1]) && sl(ib) > S.slope * 0.8) ib++;
  const ha = hs[ia]!;
  const hb = hs[ib]!;
  if (!(hb - ha >= S.rise)) return 0;
  const hm = (ha + hb) / 2;
  for (let k = 0; k < placed.length; k += 3) if (Math.hypot(placed[k]! - mx, placed[k + 1]! - mz) < S.step * 0.6 && Math.abs(placed[k + 2]! - hm) < (hb - ha) / 2) return 0;
  placed.push(mx, mz, hm);
  /** Position (m, le long de u depuis le milieu) où le profil atteint l'altitude h. */
  const sAt = (h: number) => {
    for (let i = ia; i < ib; i++) if (hs[i + 1]! >= h) return (i - N + (h - hs[i]!) / Math.max(1e-3, hs[i + 1]! - hs[i]!)) * ds;
    return (ib - N) * ds;
  };
  // Coupes des strates : altitudes multiples de STRATE, sans tranche plus mince que 3 m.
  const cuts = [ha];
  for (let h = Math.ceil((ha + 3) / STRATE) * STRATE; h < hb - 3; h += STRATE) cuts.push(h);
  cuts.push(hb);
  const W = S.step * (1.15 + r() * 0.3);
  const yaw = Math.atan2(-ux, -uz);
  const free = (s0: number, s1: number, half: number) => {
    for (const s of [s0, s1])
      for (const e of [-half, 0, half]) if (!clearAt(c, mx + ux * s + wx * e, mz + uz * s + wz * e, 0.3)) return false;
    return !c.probe.buildingNear(mx + ux * (s0 + s1) * 0.5, mz + uz * (s0 + s1) * 0.5, half);
  };
  let n = 0;
  let top: { sb: number; st: number; ht: number } | null = null;
  for (let j = 0; j + 1 < cuts.length; j++) {
    const h0 = cuts[j]!;
    const h1 = cuts[j + 1]!;
    const sb = sAt(h0);
    const st = sAt(h1);
    const front = sb - 1.2;
    const D = st - sb + 5.2;
    if (!free(front, front + D, W / 2)) {
      top = null;
      continue;
    }
    const y0 = h0 - (j === 0 ? 3 : 1.5);
    const band = Math.floor((h0 + h1) / 2 / STRATE + 1000);
    const col = STRATES[band % STRATES.length]!.clone().multiplyScalar(0.93 + r() * 0.12);
    c.mesh.put(j % 2 ? K.blocB : K.blocA, mx + ux * front, y0, mz + uz * front, yaw, W, h1 + 0.3 - y0, D, col);
    n++;
    top = { sb, st, ht: h1 };
    // Replat de la strate : touffe ou fleurs dans la fissure.
    if (st - sb > 3 && r() < 0.16) {
      const s = sb - 0.6 + r() * (st - sb - 1.2);
      const e = (r() - 0.5) * W * 0.8;
      const px = mx + ux * s + wx * e;
      const pz = mz + uz * s + wz * e;
      if (clearAt(c, px, pz)) {
        if (r() < 0.35) c.mesh.put(K.bloom, px, h1 + 0.3, pz, r() * 6.28, 1, 1, 1, ROSES[Math.floor(r() * ROSES.length)]!);
        else c.mesh.put(K.tuft, px, h1 + 0.3, pz, r() * 6.28, 0.8 + r() * 0.5, 0.8 + r() * 0.5, 0.8 + r() * 0.5, TOUFFES[Math.floor(r() * TOUFFES.length)]!);
        n++;
      }
    }
  }
  // Surplomb à la corniche : dalle claire qui dépasse de la dernière strate (seulement s'il n'y a rien au-dessus).
  if (top && r() < S.overhang) {
    const h1 = H(mx + ux * (top.st + 25), mz + uz * (top.st + 25));
    const h2 = H(mx + ux * (top.st + 60), mz + uz * (top.st + 60));
    if (h1 < top.ht + 5 && h2 < top.ht + 5) {
      const front = top.sb - 4.5;
      const D = top.st - top.sb + 7;
      const w = W * (0.55 + r() * 0.35);
      if (free(front, front + D, w / 2)) {
        c.mesh.put(K.blocA, mx + ux * front + wx * (r() - 0.5) * (W - w), top.ht - 2.2, mz + uz * front + wz * (r() - 0.5) * (W - w), yaw + (r() - 0.5) * 0.12, w, 2.7, D, CORNICHE);
        n++;
      }
    }
  }
  // Éboulis au pied : gros blocs contre la paroi, cailloux plus loin.
  if (ha - lowest < S.footBand && r() < S.scree) {
    const s0 = sAt(ha) - 2;
    const count = 3 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const d = r() ** 1.6 * S.spread;
      const e = (r() - 0.5) * W;
      const px = mx + ux * (s0 - d) + wx * e;
      const pz = mz + uz * (s0 - d) + wz * e;
      if (!clearAt(c, px, pz) || c.probe.buildingNear(px, pz, 2)) continue;
      const y = H(px, pz);
      if (!Number.isFinite(y)) continue;
      const size = Math.max(0.5, (3.4 - (d / S.spread) * 2.6) * (0.55 + r() * 0.6));
      const col = EBOULIS[Math.floor(r() * EBOULIS.length)]!;
      if (size > 1.6) c.mesh.put(K.boulder, px, y - size * 0.2, pz, r() * 6.28, size * (0.9 + r() * 0.4), size * (0.7 + r() * 0.4), size, col);
      else c.mesh.put(K.stone, px, y - size * 0.1, pz, r() * 6.28, size, size, size, col);
      n++;
    }
    if (r() < 0.4) {
      const px = mx + ux * (s0 - 2 - r() * 6) + wx * (r() - 0.5) * W;
      const pz = mz + uz * (s0 - 2 - r() * 6) + wz * (r() - 0.5) * W;
      const y = H(px, pz);
      if (Number.isFinite(y) && clearAt(c, px, pz)) {
        if (r() < 0.4) c.mesh.put(K.bloom, px, y, pz, r() * 6.28, 1.1, 1.1, 1.1, ROSES[Math.floor(r() * ROSES.length)]!);
        else c.mesh.put(K.tuft, px, y, pz, r() * 6.28, 1, 1, 1, TOUFFES[Math.floor(r() * TOUFFES.length)]!);
      }
    }
  }
  return n;
}

/**
 * Profil le long de (dx, dz) de s0 à s1 : chaque contremarche raide (pente > `S.slope` et dénivelé ≥ `S.rise`) est
 * habillée par dressRiser, depuis son milieu.
 */
function dressLine(c: SiteContext, K: StoneKit, S: WallStyle, x: number, z: number, dx: number, dz: number, s0: number, s1: number, placed: Placed, r: () => number): number {
  const step = 6;
  const n = Math.floor((s1 - s0) / step) + 1;
  const hs = new Float64Array(n);
  let lowest = Infinity;
  for (let i = 0; i < n; i++) {
    hs[i] = c.probe.heightAt(x + dx * (s0 + i * step), z + dz * (s0 + i * step));
    if (hs[i]! < lowest) lowest = hs[i]!;
  }
  let put = 0;
  let i = 0;
  while (i < n - 1) {
    const a = hs[i]!;
    const b = hs[i + 1]!;
    const sign = Math.sign(b - a);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) / step <= S.slope) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n - 1 && Number.isFinite(hs[j + 1]) && (hs[j + 1]! - hs[j]!) * sign / step > S.slope) j++;
    const rise = Math.abs(hs[j]! - hs[i]!);
    if (rise >= S.rise) {
      // Milieu de la contremarche : là où la moitié du dénivelé est faite.
      const half = (hs[i]! + hs[j]!) / 2;
      let k = i;
      while (k < j && (hs[k + 1]! - half) * sign < 0) k++;
      const s = s0 + (k + 0.5) * step;
      put += dressRiser(c, K, S, x + dx * s, z + dz * s, lowest, placed, r);
    }
    i = j;
  }
  return put;
}

const CANYON_WALL: WallStyle = { step: 36, slope: 0.5, rise: 4, footBand: 6, scree: 0.35, overhang: 0.2, spread: 16 };
const MESA_WALL: WallStyle = { step: 32, slope: 0.6, rise: 6, footBand: Infinity, scree: 0.55, overhang: 0.12, spread: 26 };

/** Tracé dessiné du canyon (design.ts : canyonR) ; méandres : ± 180 m au plus, retrouvés dans le relief. */
const canyonR = (t: number) => 17300 + 350 * Math.sin(t * 5.3);
const arcPoint = (t: number, r: number): [number, number] => [ARC.cx + r * Math.sin(t), ARC.cz - r * Math.cos(t)];
const CANYON_T: readonly [number, number] = [0.98, -1.25];
/** Tronçon de canyon (m le long du tracé). */
const CANYON_SEG = 700;

/** Parois du Grand Canyon sur un tronçon : stations tous les `step` m, coupe perpendiculaire au tracé dessiné. */
function canyonWalls(sk: () => StoneKit, i: number, ta: number, tb: number): Site {
  const tm = (ta + tb) / 2;
  const [x, z] = arcPoint(tm, canyonR(tm));
  return {
    id: `canyon-parois-${i}`,
    x,
    z,
    reach: 1350,
    needs: [[x, z]],
    *build(c) {
      const K = sk();
      const r = rng(4200 + i * 31);
      const S = c.density < 0.6 ? { ...CANYON_WALL, step: 48, scree: 0.25 } : CANYON_WALL;
      const placed: Placed = [];
      const R = canyonR(tm);
      const n = Math.max(2, Math.round((Math.abs(tb - ta) * R) / S.step));
      let put = 0;
      for (let k = 0; k < n; k++) {
        const t = ta + ((k + 0.5) / n) * (tb - ta);
        const [px, pz] = arcPoint(t, canyonR(t));
        const nx = Math.sin(t);
        const nz = -Math.cos(t);
        // Fond du canyon : point le plus bas de la coupe (méandres compris).
        let best = 0;
        let low = Infinity;
        for (let s = -320; s <= 320; s += 10) {
          const h = c.probe.heightAt(px + nx * s, pz + nz * s);
          if (h < low) {
            low = h;
            best = s;
          }
        }
        if (!Number.isFinite(low)) continue;
        put += dressLine(c, K, S, px, pz, nx, nz, best - 420, best + 420, placed, r);
        if (put > 260) {
          c.flush();
          put = 0;
        }
        yield;
      }
      c.flush();
    },
  };
}

/** Buttes témoins de la plaine (SENTINEL_SPOTS de design.ts, mêmes valeurs) : x, z, rayon, hauteur. */
const SENTINEL_SPOTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [5750, -7750, 150, 135], [9750, -1000, 52, 95], [-4500, -6000, 175, 120], [7250, -2750, 135, 115], [7480, -2560, 42, 100],
  [1500, -8750, 160, 140], [2500, -3250, 48, 88], [-5500, -8750, 185, 110], [7750, -6750, 58, 110], [-1250, -6500, 140, 120],
  [0, -9750, 165, 100], [-2750, -4000, 48, 85], [1750, -6750, 42, 78], [9500, -5000, 200, 150], [-4750, -3250, 38, 70],
  [5500, -3500, 95, 80], [-5000, -750, 220, 115],
];

/** Mesas et buttes (MESAS de design.ts) : centre, demi-axes, cap, hauteur, paroi, éboulis. */
interface MesaShape {
  id: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  h: number;
  wall: number;
  apron: number;
}
const MESA_SHAPES: MesaShape[] = (() => {
  const mesa = (id: string, p: [number, number], rx: number, rz: number, rot: number, h: number, wall?: number, apron?: number): MesaShape => ({
    id, x: Math.round(p[0]), z: Math.round(p[1]), rx, rz, rot, h, wall: wall ?? Math.max(18, Math.min(60, Math.min(rx, rz) * 0.08)), apron: apron ?? Math.min(260, h * 1.4),
  });
  const R = ARC.R;
  const B = arcPoint(0.15, R - 4000);
  return [
    mesa('grande-mesa', arcPoint(-0.36, R + 2700), 1500, 1100, -0.36, 260),
    mesa('mesa-du-lion', arcPoint(0.3, R - 4700), 600, 430, 0.3, 110),
    mesa('table-des-vents', arcPoint(0.14, R + 3900), 480, 320, 0.14, 90),
    mesa('dent-rouge', arcPoint(0.6, R - 2300), 220, 180, 0.6, 140, 20, 120),
    ...([[-600, -350, 110, 60], [-200, -550, 80, 45], [300, -250, 150, 75], [800, -450, 90, 50], [-500, 350, 130, 65], [100, 650, 70, 40], [600, 250, 120, 55], [1100, 650, 95, 50], [-900, 750, 85, 45], [1000, -50, 75, 40]] as const).map(([dx, dz, r, h], i) =>
      mesa(`butte-${i}`, [B[0] + dx * 0.8, B[1] + dz * 0.8], r, r * 0.8, i * 0.7, h, 14, 70)),
    mesa('temoin-1', arcPoint(-0.62, R - 900), 170, 130, 0.5, 70, 14, 90),
    mesa('temoin-2', arcPoint(-0.5, R + 3800), 210, 150, 1.1, 80, 16, 100),
    mesa('temoin-3', arcPoint(0.45, R + 2600), 160, 120, 0.2, 60, 14, 80),
    // Buttes témoins et aiguilles de la plaine (SENTINEL_SPOTS de design.ts) : [x, z, rayon, hauteur].
    ...SENTINEL_SPOTS.map(([x, z, r, h], i) => {
      const spire = r < 70;
      return mesa(`sentinelle-${i}`, [x, z], r, r * (spire ? 0.85 : 0.72), i * 1.3, h, spire ? Math.max(8, r * 0.18) : Math.max(12, r * 0.09), spire ? Math.min(150, h * 1.3) : Math.min(230, h * 1.5));
    }),
  ];
})();

/** Paroi d'une mesa sur un secteur d'angle [a0, a1] : coupes radiales autour du pied (bord dentelé de ± 7 %). */
function mesaWalls(sk: () => StoneKit, m: MesaShape, part0: number, a0: number, a1: number): Site {
  const am = (a0 + a1) / 2;
  const [x, z] = ell(m, 1, am);
  return {
    id: `mesa-parois-${m.id}-${part0}`,
    x,
    z,
    reach: 1300,
    needs: [[x, z], [m.x, m.z]],
    *build(c) {
      const K = sk();
      const r = rng(5300 + m.x * 7 + part0 * 131);
      const S = c.density < 0.6 ? { ...MESA_WALL, step: 44, scree: 0.4 } : MESA_WALL;
      const placed: Placed = [];
      const rm = Math.sqrt(m.rx * m.rz);
      const slack = 0.09 * Math.max(m.rx, m.rz) + m.wall + 30;
      const len = (a1 - a0) * rm;
      const n = Math.max(2, Math.round(len / S.step));
      let put = 0;
      for (let k = 0; k < n; k++) {
        const a = a0 + ((k + 0.5) / n) * (a1 - a0);
        const [px, pz] = ell(m, 1, a);
        const d = Math.hypot(px - m.x, pz - m.z) || 1;
        put += dressLine(c, K, S, px, pz, (px - m.x) / d, (pz - m.z) / d, -slack, slack + m.apron * 0.3, placed, r);
        if (put > 260) {
          c.flush();
          put = 0;
        }
        yield;
      }
      c.flush();
    },
  };
}

/** Bosquets d'arbres à pompons sur un carré de 2 km : sur le plateau (hors de l'erg) et au bord des pistes. */
function groves(sk: () => StoneKit, cx: number, cz: number): Site {
  return {
    id: `bosquets-${cx}_${cz}`,
    x: cx,
    z: cz,
    reach: 1400,
    needs: [[cx, cz]],
    *build(c) {
      const K = sk();
      const r = rng(Math.imul(cx, 2654435761) ^ Math.imul(cz, 40503) ^ 0x51ed);
      const H = c.probe.heightAt;
      const tries = Math.round(9 * Math.max(0.35, Math.min(1, c.density)));
      const bare = (x: number, z: number) => c.probe.read(x, z) && c.probe.road < 0.02 && c.probe.water < 0.05 && c.probe.urban < 0.1 && c.probe.field < 0.3 && c.probe.sand < 0.4;
      for (let g = 0; g < tries; g++) {
        const x = cx + (r() - 0.5) * 2000;
        const z = cz + (r() - 0.5) * 2000;
        if (!bare(x, z) || c.probe.buildingNear(x, z, 12)) continue;
        const y = H(x, z);
        if (!Number.isFinite(y) || Math.abs(H(x + 8, z) - H(x - 8, z)) > 4 || Math.abs(H(x, z + 8) - H(x, z - 8)) > 4) continue;
        // Près d'une piste (route à 14–34 m) ou sur le haut plateau.
        let track = false;
        for (let k = 0; k < 8 && !track; k++) for (const d of [14, 24, 34]) if (c.probe.read(x + Math.cos(k * 0.785) * d, z + Math.sin(k * 0.785) * d) && c.probe.road > 0.3) track = true;
        if (!track && y < 140) continue;
        const count = 2 + Math.floor(r() * 4);
        for (let i = 0; i < count; i++) {
          const a = r() * 6.28;
          const d = i === 0 ? 0 : 4 + r() * 10;
          const tx = x + Math.cos(a) * d;
          const tz = z + Math.sin(a) * d;
          let ok = bare(tx, tz) && !c.probe.buildingNear(tx, tz, 3);
          for (let k = 0; ok && k < 4; k++) if (!clearAt(c, tx + Math.cos(k * 1.57) * 2.5, tz + Math.sin(k * 1.57) * 2.5, 0.05)) ok = false;
          const ty = H(tx, tz);
          if (!ok || !Number.isFinite(ty)) continue;
          const s = 0.75 + r() * 0.55;
          c.mesh.put(r() < 0.55 ? K.treeA : K.treeB, tx, ty, tz, r() * 6.28, s, s * (0.9 + r() * 0.2), s, POMPONS[Math.floor(r() * POMPONS.length)]!);
          // Une touffe ou deux au pied.
          if (r() < 0.5) {
            const fx = tx + (r() - 0.5) * 5;
            const fz = tz + (r() - 0.5) * 5;
            const fy = H(fx, fz);
            if (Number.isFinite(fy) && clearAt(c, fx, fz)) c.mesh.put(r() < 0.3 ? K.bloom : K.tuft, fx, fy, fz, r() * 6.28, 1, 1, 1, r() < 0.3 ? ROSES[0]! : TOUFFES[Math.floor(r() * TOUFFES.length)]!);
          }
        }
        yield;
      }
      c.flush();
    },
  };
}

/** Tronçons du canyon, secteurs des mesas et bosquets. */
function stoneSites(sk: () => StoneKit): Site[] {
  const out: Site[] = [];
  const [t0, t1] = CANYON_T;
  const n = Math.ceil((Math.abs(t1 - t0) * 17300) / CANYON_SEG);
  for (let i = 0; i < n; i++) out.push(canyonWalls(sk, i, t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n));
  for (const m of MESA_SHAPES) {
    const rm = Math.sqrt(m.rx * m.rz);
    const parts = Math.max(1, Math.ceil((2 * Math.PI * rm) / 900));
    for (let p = 0; p < parts; p++) out.push(mesaWalls(sk, m, p, (p / parts) * Math.PI * 2, ((p + 1) / parts) * Math.PI * 2));
  }
  for (let x = -18000; x <= 18000; x += 2000)
    for (let z = -12000; z <= 8000; z += 2000) {
      if (!onLand(x, z, -400)) continue;
      if (((x - CHOTT.x) / CHOTT.rx) ** 2 + ((z - CHOTT.z) / CHOTT.rz) ** 2 < 0.6) continue;
      out.push(groves(sk, x, z));
    }
  return out;
}

// ── Liste ──

/** Lieux du Désert rouge (IslandSites, monde `desert-rouge`). */
export function desertRougeSites(): Site[] {
  let templates: Kit | undefined;
  let harbours: HarbourTemplates | undefined;
  let stones: StoneKit | undefined;
  const k = () => (templates ??= kit());
  const sk = () => (stones ??= stoneKit());
  const h = () => (harbours ??= harbourTemplates());
  const grid: Site[] = [];
  for (let x = -18000; x <= 18000; x += 2000)
    for (let z = -12000; z <= 8000; z += 2000) {
      // Ni en mer (croissant, à peu près), ni sur le Chott Blanc.
      if (!onLand(x, z, -600)) continue;
      if (((x - CHOTT.x) / CHOTT.rx) ** 2 + ((z - CHOTT.z) / CHOTT.rz) ** 2 < 0.6) continue;
      grid.push(scrub(k, x, z));
    }
  for (let x = -18500; x <= 18500; x += 1000)
    for (let z = -12500; z <= 8500; z += 1000) if (onLand(x, z, 300)) grid.push(tumbleweeds(k, x, z));
  return [
    harbourSite('port-corail', PORT_CORAIL, 750, h),
    harbourSite('port-cap-brique', CAP_BRIQUE, 700, h),
    harbourSite('port-vent', PORT_VENT, 700, h),
    saltCrust(),
    circuit(k),
    ...OASES.map((o, i) => oasis(k, o.id, o.o, o.grove, 8080 + 101 * i)),
    guelta(k),
    ...VILLAGES.map((v, i) => village(k, v, i)),
    ...CARAVANS.map((cv, i) => caravan(k, cv, 600 + i)),
    ...ARCHES.map((_, i) => stoneArch(k, i)),
    ...[0, 1, 2, 3].map((i) => balloons(i)),
    bikePark(k),
    cycloCross(k),
    summits(k),
    ...stoneSites(sk),
    ...grid,
  ];
}

/** Ni clôtures ni poteaux nulle part, sauf autour des oasis (jardins clos de la palmeraie). */
export function desertRougeNoFence(x: number, z: number): boolean {
  for (const { o, grove } of OASES) if (Math.hypot(x - o.x, z - o.z) < grove + 250) return false;
  return true;
}
