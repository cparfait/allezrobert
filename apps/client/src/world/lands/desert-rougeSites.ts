import * as THREE from 'three/webgpu';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, template, type Template } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';

/**
 * Décor propre du Désert rouge (mode Poly, tools/desert-rouge) : palmiers et palmeraies des oasis, puits, tentes,
 * caravanes de dromadaires qui marchent, arches de pierre, cactus et touffes sèches, croûte de sel du Chott Blanc,
 * tribunes du Circuit du Chott, montgolfières au-dessus du canyon au lever du jour, bike park des Buttes, cyclo-cross
 * des Sables, dôme de l'observatoire et cairns du col, ports. Même mécanique que les lieux de l'île (polySites.ts) :
 * chaque lieu est construit par pas quand le coureur approche, puis oublié. Cotes : celles du générateur
 * (tools/desert-rouge/src/design.ts, places.json).
 */
const WHITE = new THREE.Color(0xffffff);
const C = (c: string) => new THREE.Color(c);
type P2 = readonly [number, number];

// ── Cotes du générateur ──

/** Circuit du Chott (ANNEAU) et Chott Blanc (CHOTT). */
export const DESERT_RING = { x: -5600, z: -2500, half: 560, radius: 215 } as const;
const CHOTT = { x: -5600, z: -2500, rx: 2100, rz: 820, rot: 0.12 };
/** Sources d'oasis (LAKES) : L'Oasis et l'Oasis des Dunes. */
const OASIS = { x: 4220, z: 6030, rx: 150, rz: 95, rot: 0.4 };
const DUNES_OASIS = { x: -9900, z: 4700, rx: 120, rz: 80, rot: 0.8 };
/** Grand Erg (ERG) : centre et demi-axes du masque des dunes. */
const ERG = { x: -10000, z: 4300, sx: 4300, sz: 2700 };
/** Petites boucles dessinées (CROSS, BIKEPARK et la forme de build.ts). */
const CROSS: P2 = [-6300, 2900];
const BIKEPARK: P2 = [-1100, -2950];
/** Pic du Vautour (observatoire) et col des Vents. */
const PEAK: P2 = [1600, -6900];
const COL: P2 = [2933, -6513];
/** Canyon de l'Oued Rouge : points du fond, du nord au sud (riverBeds, oued-rouge). */
const CANYON: readonly P2[] = [[6316, -2245], [6494, -1673], [6699, -1108], [6832, -522], [7004, 53], [7162, 632], [7318, 1210], [7355, 1807]];
/** Villages : place (centre du plan) et direction de la rue principale. */
const VILLAGES: ReadonlyArray<{ x: number; z: number; angle: number; r: number; palms: number }> = [
  { x: -2600, z: 1200, angle: 0.15, r: 620, palms: 10 },
  { x: -5600, z: -800, angle: 0.12, r: 380, palms: 6 },
  { x: -12300, z: 900, angle: 1.3, r: 480, palms: 8 },
  { x: -10320, z: -3380, angle: 0.6, r: 300, palms: 4 },
  { x: 3800, z: 5600, angle: 0.25, r: 360, palms: 12 },
  { x: 11800, z: -600, angle: 1.2, r: 400, palms: 6 },
  { x: 7600, z: 3700, angle: 1.4, r: 300, palms: 8 },
  { x: 2700, z: -2700, angle: 0.9, r: 280, palms: 3 },
];
/** Arches de pierre : position souhaitée, portée (m), cap. */
const ARCHES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-3350, -4300, 26, 0.4],
  [-2700, -3700, 17, 1.6],
  [8350, -1150, 34, 0.9],
  [1900, 3250, 22, 2.3],
  [-8700, 5300, 20, 0.2],
];
/** Caravanes : boucle suivie (centre, demi-axes, cap) et nombre de bêtes. */
const CARAVANS: ReadonlyArray<{ id: string; x: number; z: number; rx: number; rz: number; rot: number; n: number; speed: number }> = [
  { id: 'caravane-des-dunes', x: -9450, z: 4350, rx: 520, rz: 300, rot: 0.45, n: 8, speed: 1.15 },
  { id: 'caravane-du-lion', x: 2300, z: 3900, rx: 420, rz: 260, rot: -0.3, n: 6, speed: 1.05 },
];

const PORT_CORAIL: HarbourSite = {
  x: 375.8, z: 9206.3, dir: 1.53, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.55, fishing: false,
  hulls: ['#2f8fb5', '#f4efe6', '#e2593f', '#f2c230', '#3aa39b'],
};
const CAP_BRIQUE: HarbourSite = {
  x: 10424.3, z: 9518.3, dir: 0.74, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.3, fishing: true,
  hulls: ['#2f6fa6', '#e2593f', '#f2f0e8', '#3aa39b', '#e7b23c'],
};
const PORT_VENT: HarbourSite = {
  x: -499.2, z: -10138, dir: -1.62, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.25, fishing: true,
  hulls: ['#2d5d8f', '#b8432f', '#3c7f58', '#f2f0e8', '#d79a33'],
};

// ── Gabarits ──

const person = (robe: string, head: string) => [
  part(prism(0.22, 0.17, 0, 1.25, 6), robe, 1),
  part(new THREE.IcosahedronGeometry(0.13, 0).translate(0, 1.42, 0), '#b98a62'),
  part(prism(0.15, 0.12, 1.47, 1.62, 6), head),
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
    dromedary: template([
      part(box(0.7, 0.62, 1.7, 0, 1.6), '#ffffff', 1),
      part(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.9, 1.2).translate(0, 2.05, -0.05), '#ffffff', 1),
      part(box(0.26, 0.9, 0.3, 0, 1.85, 1.0).rotateX(-0.5), '#ffffff', 1),
      part(box(0.28, 0.26, 0.6, 0, 2.3, 1.42), '#ffffff', 1),
      ...[-0.25, 0.25].flatMap((x) => [-0.6, 0.6].map((z) => part(box(0.14, 1.3, 0.16, x, 0.65, z), '#d9b985'))),
      part(box(0.9, 0.42, 0.5, 0, 1.95, -0.55), '#b8432f'),
      part(box(0.92, 0.18, 0.52, 0, 2.2, -0.55), '#e9c25a'),
    ]),
    resting: template([
      part(box(0.7, 0.55, 1.6, 0, 0.45), '#ffffff', 1),
      part(new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.9, 1.2).translate(0, 0.9, -0.05), '#ffffff', 1),
      part(box(0.24, 0.7, 0.28, 0, 0.85, 0.95).rotateX(-0.9), '#ffffff', 1),
      part(box(0.26, 0.24, 0.55, 0, 1.15, 1.35), '#ffffff', 1),
    ]),
    rider: template(person('#ffffff', '#f4efe6')),
    walker: template([...person('#ffffff', '#e9e1cf'), part(box(0.04, 1.7, 0.04, 0.3, 0.85, 0.1), '#6f5a40')]),
    tent: template([
      part(new THREE.CylinderGeometry(2.6, 2.6, 6, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).scale(1, 0.55, 1.3).translate(0, 0.85, 0), '#ffffff', 1),
      part(box(6.2, 0.12, 0.12, 0, 2.2, 0), '#5d4630'),
      part(box(1.4, 1.2, 0.05, 0, 0.6, 2.1), '#2b2218'),
      ...[-2.6, 2.6].map((x) => part(box(0.08, 2.3, 0.08, x, 1.15, 0), '#5d4630')),
      part(box(3, 0.03, 2.2, 0, 0.02, 3.4), '#b8432f'),
    ]),
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
    rug: template([part(box(2.2, 0.03, 1.5, 0, 0.02), '#ffffff', 1), part(box(1.9, 0.035, 0.12, 0, 0.025, 0.55), '#f2c230'), part(box(1.9, 0.035, 0.12, 0, 0.025, -0.55), '#f2c230')]),
  };
}
type Kit = ReturnType<typeof kit>;

const PALM_LEAVES = [C('#4f7a32'), C('#5b8638'), C('#46702e'), C('#6a8a3e')];
const ROBES = [C('#f4efe6'), C('#2f6fa6'), C('#b8432f'), C('#e7d8b8'), C('#3a3f44')];
const HIDES = [C('#c9a06a'), C('#d6b07a'), C('#b88a55'), C('#e0c08a')];
const TENTS = [C('#4a3a2e'), C('#5e4634'), C('#3d332b'), C('#e9dcc2')];

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
        for (const z of [zS + 9, R.z - R.radius - 9]) {
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
      // Puits, abreuvoir, tentes, dromadaires couchés, gens.
      const camp = freeNear(c, o.x + o.rx * 2.2, o.z - o.rz * 1.6, 160, 7);
      if (camp) {
        const [cx, cz] = camp;
        putOn(c, K.well, cx, cz, r() * 6.28);
        putOn(c, K.trough, cx + 4, cz + 1.5, 0.3);
        for (let i = 0; i < 4; i++) {
          const [tx, tz] = [cx + 16 + i * 9, cz + (i % 2) * 6 - 10];
          if (freeNear(c, tx, tz, 2, 4)) putOn(c, K.tent, tx, tz, 0.4 + i * 0.3, TENTS[i % TENTS.length]!);
        }
        for (let i = 0; i < 5; i++) putOn(c, K.resting, cx - 10 - i * 3.2, cz + 6 + (i % 2) * 2.5, 1.2 + r() * 1.5, HIDES[i % HIDES.length]!);
        putOn(c, K.fire, cx + 22, cz + 2);
        putOn(c, K.rug, cx + 25, cz + 4, 0.4, ROBES[1]!);
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
    },
  };
}

// ── Caravanes de dromadaires (animées) ──

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
      for (let i = 0; i < cv.n + 1; i++) {
        const lead = i === 0;
        const g = new THREE.Group();
        g.name = 'dromadaire';
        const hide = HIDES[i % HIDES.length]!;
        const body = meshOf([{ t: lead ? K.walker : K.dromedary, x: 0, y: 0, z: 0, c: lead ? ROBES[1] : hide }], c.mat);
        g.add(body);
        if (!lead && i % 3 === 1) {
          const rider = meshOf([{ t: K.rider, x: 0, y: 1.95, z: -0.1, c: ROBES[(i + 2) % ROBES.length] }], c.mat);
          g.add(rider);
        }
        const gap = lead ? 0 : 4.5 + i * 4.2;
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
      const n = Math.round(260 * Math.max(0.35, c.density));
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
        if (roll < 0.45) putOn(c, K.tuft, x, z, yaw, dry[Math.floor(r() * dry.length)]!, 0.8 + r() * 0.7);
        else if (roll < 0.6) putOn(c, K.deadBush, x, z, yaw, WHITE, 0.8 + r() * 0.6);
        else if (roll < 0.75) putOn(c, K.cactus, x, z, yaw, green[Math.floor(r() * green.length)]!, 0.7 + r() * 0.7);
        else if (roll < 0.85) putOn(c, K.barrel, x, z, yaw, green[Math.floor(r() * green.length)]!, 0.8 + r() * 0.6);
        else putOn(c, K.rock, x, z, yaw, stone[Math.floor(r() * stone.length)]!, 0.4 + r() * 1.1, -0.2);
        if (i % 90 === 89) yield;
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
      for (let i = 0; i < 4; i++) putOn(c, K.tent, p0.x - p0.dz * 14 + p0.dx * (i * 8 - 12), p0.z + p0.dx * 14 + p0.dz * (i * 8 - 12), yawOf(p0.dx, p0.dz), TENTS[(i + 3) % TENTS.length]!, 0.7);
      putOn(c, K.board, p0.x + p0.dz * 4, p0.z - p0.dx * 4, yawOf(-p0.dx, -p0.dz));
    },
  };
}

// ── Sommets : dôme de l'observatoire, cairns du col des Vents ──

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

// ── Liste ──

/** Lieux du Désert rouge (IslandSites, monde `desert-rouge`). */
export function desertRougeSites(): Site[] {
  let templates: Kit | undefined;
  let harbours: HarbourTemplates | undefined;
  const k = () => (templates ??= kit());
  const h = () => (harbours ??= harbourTemplates());
  const grid: Site[] = [];
  for (let x = -17000; x <= 17000; x += 2000)
    for (let z = -11000; z <= 11000; z += 2000) {
      // Ni en mer (ellipse de la côte, à peu près), ni sur le Chott Blanc.
      if ((x / 17200) ** 2 + (z / 11300) ** 2 > 1.02) continue;
      if (((x - CHOTT.x) / CHOTT.rx) ** 2 + ((z - CHOTT.z) / CHOTT.rz) ** 2 < 0.6) continue;
      grid.push(scrub(k, x, z));
    }
  return [
    harbourSite('port-corail', PORT_CORAIL, 750, h),
    harbourSite('port-cap-brique', CAP_BRIQUE, 700, h),
    harbourSite('port-vent', PORT_VENT, 700, h),
    saltCrust(),
    circuit(k),
    oasis(k, 'oasis', OASIS, 950, 8080),
    oasis(k, 'oasis-des-dunes', DUNES_OASIS, 420, 8181),
    ...VILLAGES.map((v, i) => village(k, v, i)),
    ...CARAVANS.map((cv, i) => caravan(k, cv, 600 + i)),
    ...ARCHES.map((_, i) => stoneArch(k, i)),
    ...[0, 1, 2, 3].map((i) => balloons(i)),
    bikePark(k),
    cycloCross(k),
    summits(k),
    ...grid,
  ];
}

/** Ni clôtures ni poteaux : promenade de Port-Corail, Chott Blanc, Grand Erg. */
export function desertRougeNoFence(x: number, z: number): boolean {
  if (Math.hypot(x + 450, z - 8900) < 1600) return true;
  if (((x - CHOTT.x) / (CHOTT.rx * 1.2)) ** 2 + ((z - CHOTT.z) / (CHOTT.rz * 1.3)) ** 2 < 1) return true;
  return Math.exp(-(((x - ERG.x) / ERG.sx) ** 2 + ((z - ERG.z) / ERG.sz) ** 2)) > 0.3;
}
