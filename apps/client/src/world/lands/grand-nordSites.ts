import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, mix, mx_noise_float, positionLocal, sin, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, template, type LandProbe, type Template } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';

/**
 * Décor propre du Grand Nord robertien (mode Poly, tools/grand-nord) : ports de Port-Boréal, Skarvik et Nordvik,
 * bac animé qui traverse le fjord du Bac, cabanes de pêcheurs sur pilotis et séchoirs à poisson des villages,
 * cabanes de pêche au bord des lacs de la toundra, troupeaux de rennes, langue de glace du glacier de Robert, phare
 * du cap Boréal (feu tournant la nuit), cairns des cols et du belvédère, galerie paravalanche du col du Renne,
 * tribunes du Circuit, bike park de Fjellheim, cyclo-cross de la Toundra, et aurores boréales la nuit. Chaque lieu
 * est construit par pas près du coureur (IslandSites), avec peu de triangles.
 */
const WHITE = new THREE.Color(0xffffff);
type XZ = readonly [number, number];

// ───────────────────────────── Cotes du générateur (tools/grand-nord/src/design.ts, places.json)

const PORT_BOREAL: HarbourSite = {
  x: 375.7, z: 9204, dir: 1.53, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.3, fishing: true,
  hulls: ['#a8322d', '#f1efe6', '#2f5f8a', '#e2b54a', '#3a4a5a'],
};
const SKARVIK: HarbourSite = {
  x: 10394.5, z: 9491.1, dir: 0.74, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.15, fishing: true,
  hulls: ['#a8322d', '#2d5d8f', '#f1efe6', '#3c7f58', '#e2b54a'],
};
const NORDVIK: HarbourSite = {
  x: -494.8, z: -10047.5, dir: -1.62, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.1, fishing: true,
  hulls: ['#2d5d8f', '#b8432f', '#f1efe6', '#253f66', '#d79a33'],
};
/** Cales du bac, face à face sur les rives du fjord du Bac (centre du bassin, cap du large, demi-longueur). */
const CALE_A = { x: 14122.3, z: -4035.6, dir: 1.234, halfLen: 34 };
const CALE_B = { x: 14269.8, z: -3614.1, dir: -1.907, halfLen: 34 };
const RING = { x: -6900, z: 3700, half: 560, radius: 215 };
const BELVEDERE: XZ = [1600, -6900];
const DENT: XZ = [4700, -6000];
const COL: XZ = [2964, -6504];
const PHARE: XZ = [18019, 1445];
const GLACIER = { from: [4650, -6400] as XZ, to: [5130, -7330] as XZ, half: 230 };
/** Villages de pêcheurs : centre, rayon, cap du large (cabanes sur pilotis le long du rivage, hors du port). */
const FISHING: ReadonlyArray<{ id: string; x: number; z: number; r: number; sea: number; harbour?: number }> = [
  { id: 'skarvik', x: 10141.2, z: 9259.8, r: 400, sea: 0.74, harbour: 0.74 },
  { id: 'nordvik', x: -478.2, z: -9710.4, r: 420, sea: -1.62, harbour: -1.62 },
  { id: 'isbrevik', x: 5636.6, z: -8989, r: 220, sea: -2.43 },
  { id: 'port-boreal', x: -900, z: 9100, r: 500, sea: 1.6, harbour: 1.53 },
];
/** Lacs de la toundra (centre, demi-axes) : cabanes de pêche sur la rive. */
const LAKES: ReadonlyArray<{ x: number; z: number; rx: number; rz: number; rot: number }> = [
  { x: 9500, z: 0, rx: 260, rz: 150, rot: 0.4 },
  { x: 11000, z: 1900, rx: 300, rz: 90, rot: 0.15 },
  { x: 1800, z: 5300, rx: 220, rz: 120, rot: 0.6 },
  { x: 2600, z: 6700, rx: 180, rz: 100, rot: -0.4 },
  { x: -5600, z: -2500, rx: 2100, rz: 800, rot: 0.12 },
];
/** Troupeaux de rennes : centre et rayon de pâture. */
const HERDS: ReadonlyArray<readonly [number, number, number]> = [
  [10600, 800, 260],
  [12600, -400, 220],
  [4300, 6400, 240],
  [-9800, -6100, 200],
  [6400, -3400, 200],
];
const BIKE_PARK: XZ = [-7650, -4750];
const CYCLO_CROSS: XZ = [5000, 4300];
/** Galerie paravalanche sur la descente nord du col du Renne (axe de la route, du haut vers le bas). */
const GALLERY: ReadonlyArray<XZ> = [[2815.3, -6934.9], [2810, -6954.2], [2804.6, -6973.5], [2799.2, -6992.7], [2793.8, -7012], [2788.4, -7031.2], [2783, -7050.5]];

// ───────────────────────────── Gabarits

/** Toit à deux pans (faîtage le long de x) : base w × d à y0, faîtage à y0 + h. */
function ridge(w: number, d: number, h: number, y0: number, x = 0, z = 0): THREE.BufferGeometry {
  const a = w / 2;
  const b = d / 2;
  const v = (px: number, py: number, pz: number) => [px + x, py, pz + z];
  const P = [
    [v(-a, y0, -b), v(a, y0, -b), v(a, y0 + h, 0)], [v(-a, y0, -b), v(a, y0 + h, 0), v(-a, y0 + h, 0)],
    [v(-a, y0, b), v(a, y0 + h, 0), v(a, y0, b)], [v(-a, y0, b), v(-a, y0 + h, 0), v(a, y0 + h, 0)],
    [v(-a, y0, -b), v(-a, y0 + h, 0), v(-a, y0, b)], [v(a, y0, -b), v(a, y0, b), v(a, y0 + h, 0)],
  ].flat(2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  return g;
}

function kit() {
  const fish = (x: number, z: number) => part(box(0.12, 0.7, 0.22, x, 1.55, z), '#8d8577');
  return {
    /** Cabane de pêcheur sur pilotis (rorbu) : pilotis jusqu'au fond, plancher, murs teintés, toit sombre. */
    rorbu: template([
      ...[[-2.4, -2], [2.4, -2], [-2.4, 2], [2.4, 2], [0, -2], [0, 2]].map(([x, z]) => part(prism(0.16, 0.16, -9, 0.2, 5, x, z), '#4a3b2e')),
      part(box(5.6, 0.25, 5, 0, 0.3, 0), '#6b5a44'),
      part(box(4.8, 2.6, 4.2, 0, 1.75, 0), '#ffffff', 1),
      part(ridge(5.4, 4.8, 2.3, 3.05), '#33363a'),
      part(box(0.9, 1.6, 0.06, 0.6, 1.3, 2.12), '#f1efe6'),
      part(box(0.7, 0.6, 0.06, -1.3, 2.1, 2.12), '#f1efe6'),
    ]),
    /** Séchoir à poisson (hjell) : chevalets de bois, perches, morues pendues. */
    rack: template([
      ...[-3, 3].flatMap((x) => [part(box(0.14, 3, 0.14, x, 1.35, -0.6).rotateX(0.32), '#6b5640'), part(box(0.14, 3, 0.14, x, 1.35, 0.6).rotateX(-0.32), '#6b5640')]),
      part(box(6.6, 0.1, 0.1, 0, 2.15, -0.22), '#7a6248'),
      part(box(6.6, 0.1, 0.1, 0, 2.15, 0.22), '#7a6248'),
      ...Array.from({ length: 11 }, (_, i) => fish(-2.5 + i * 0.5, -0.22)),
      ...Array.from({ length: 11 }, (_, i) => fish(-2.25 + i * 0.5, 0.22)),
    ]),
    /** Cabane de pêche au bord d'un lac, avec son ponton. */
    hut: template([
      part(box(2.6, 2, 2.2, 0, 1, 0), '#ffffff', 1),
      part(ridge(3, 2.6, 1.3, 2), '#33363a'),
      part(box(0.7, 1.4, 0.05, 0, 0.7, 1.12), '#f1efe6'),
      part(box(1.2, 0.15, 6, 0, 0.35, 4.2), '#7a6248'),
      ...[[-0.5, 6.8], [0.5, 6.8]].map(([x, z]) => part(prism(0.08, 0.08, -1.5, 0.35, 4, x, z), '#4a3b2e')),
    ]),
    /** Renne : corps gris-brun, croupe et cou clairs, bois. */
    reindeer: template([
      part(box(1.3, 0.62, 0.52, 0, 1.05, 0), '#7d6c5a'),
      part(box(0.3, 0.5, 0.48, -0.62, 1.05, 0), '#d8d2c4'),
      part(box(0.34, 0.55, 0.34, 0.66, 1.38, 0).rotateZ(-0.5), '#d8d2c4'),
      part(box(0.42, 0.24, 0.24, 0.95, 1.62, 0), '#6b5c4c'),
      ...[[-0.45, -0.16], [-0.45, 0.16], [0.45, -0.16], [0.45, 0.16]].map(([x, z]) => part(box(0.1, 0.78, 0.1, x, 0.39, z), '#5b4d40')),
      ...[-0.1, 0.1].flatMap((z) => [part(box(0.05, 0.5, 0.05, 0.82, 1.95, z * 2.2).rotateX(z * 2), '#c9b893'), part(box(0.32, 0.05, 0.05, 0.7, 2.15, z * 3.2), '#c9b893')]),
    ]),
    /** Cairn : pierres empilées. */
    cairn: template([
      part(new THREE.IcosahedronGeometry(0.9, 0).scale(1.1, 0.6, 1).translate(0, 0.45, 0), '#8b8a86'),
      part(new THREE.IcosahedronGeometry(0.65, 0).scale(1, 0.6, 1).translate(0.05, 1.1, 0), '#9a9893'),
      part(new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.7, 1).translate(-0.04, 1.6, 0.03), '#7f7e7a'),
      part(new THREE.IcosahedronGeometry(0.28, 0).translate(0, 2, 0), '#a3a19b'),
    ]),
    /** Bac : coque blanche à bande rouge, pont-garage, passerelle, voitures. */
    ferry: template([
      part(box(26, 2.2, 8.4, 0, 0, 0), '#f1efe6'),
      part(box(26.1, 0.6, 8.5, 0, -0.7, 0), '#a8322d'),
      part(box(24, 0.2, 7.6, 0, 1.2, 0), '#55595c'),
      part(box(4.5, 3.2, 8.2, -4, 2.9, 0), '#f1efe6'),
      part(box(4.6, 0.9, 8.3, -4, 3.9, 0), '#2f3a44'),
      part(prism(0.55, 0.5, 4.5, 6.8, 6, -4.8, 0), '#e2b54a'),
      part(box(0.3, 1.2, 8, 12.9, 1.8, 0).rotateZ(0.25), '#6c7074'),
      part(box(0.3, 1.2, 8, -12.9, 1.8, 0).rotateZ(-0.25), '#6c7074'),
      ...[[3, -2, '#2d5d8f'], [7.5, -2, '#a8322d'], [3, 2, '#e2b54a'], [7.5, 2, '#f1efe6']].map(([x, z, c]) => part(box(3.8, 1.3, 1.8, x as number, 1.95, z as number), c as string)),
    ]),
    /** Rampe d'une cale du bac. */
    ramp: template([part(box(10, 0.6, 9, 0, 0, 0), '#6c7074'), ...[-4.8, 4.8].map((z) => part(box(10, 0.9, 0.3, 0, 0.6, z), '#e2b54a'))]),
    /** Bandes rouges, galerie et lanterne posées sur la tour blanche du phare (bâtiment du générateur). */
    lighthouse: template([
      part(prism(3.3, 3.25, 5, 8, 8), '#b8322d'),
      part(prism(3.25, 3.2, 12, 15, 8), '#b8322d'),
      part(prism(3.9, 3.9, 18, 18.4, 8), '#3a3d40'),
      part(prism(1.9, 1.9, 18.4, 21, 8), '#f6e7a6'),
      part(prism(2.2, 0.3, 21, 22.6, 8), '#b8322d'),
    ]),
    stand: template([
      ...Array.from({ length: 6 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -2.8 + i * 0.95), i % 2 ? '#c9c4b8' : '#d6d1c4')),
      ...Array.from({ length: 6 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -2.8 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12.4, 0.22, 7.6, 0, 5.4, -0.4).rotateX(-0.06), '#f2efe6'),
      ...[-5.8, 5.8].map((x) => part(prism(0.12, 0.1, 0, 5.4, 6, x, 2.8), '#8f9699')),
    ]),
    arch: template([
      ...[-6, 6].map((x) => part(box(0.7, 6, 0.7, x, 3), '#2b2f33')),
      part(box(13, 1.4, 0.5, 0, 6.2), '#ffffff', 1),
      ...Array.from({ length: 8 }, (_, i) => part(box(1.5, 0.7, 0.52, -5.25 + i * 1.5, 6.2 + (i % 2 ? 0.35 : -0.35)), i % 2 ? '#1b1b1b' : '#f5f5f5')),
    ]),
    flag: template([part(prism(0.05, 0.04, 0, 4, 5), '#e9e6dc'), part(box(0.03, 0.8, 1.2, 0, 3.5, 0.65), '#ffffff', 1)]),
    /** Piquet de balisage et rubalise (cyclo-cross). */
    stake: template([part(box(0.08, 1, 0.08, 0, 0.5, 0), '#e9e6dc'), part(box(0.04, 0.08, 3, 0, 0.85, 1.5), '#ffffff', 1)]),
    /** Tremplin de bois (bike park). */
    kicker: template([part(box(1.8, 0.2, 3.4, 0, 0.55, 0).rotateX(-0.32), '#a37a4c'), part(box(1.8, 0.9, 0.2, 0, 0.45, -1.6), '#7a5a3a'), ...[-0.8, 0.8].map((x) => part(box(0.12, 1, 3, x, 0.4, -0.1), '#6b5640'))]),
    /** Tente des stands (cyclo-cross). */
    tent: template([...[[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([x, z]) => part(box(0.08, 2.2, 0.08, x, 1.1, z), '#cfd3d6')), part(new THREE.ConeGeometry(3, 1.2, 4).rotateY(Math.PI / 4).translate(0, 2.8, 0), '#ffffff', 1)]),
    /** Belvédère : plateforme, garde-corps, longue-vue, table d'orientation. */
    lookout: template([
      part(box(9, 0.4, 6, 0, 0.2, 0), '#7a6248'),
      ...[-4.4, 4.4].map((x) => part(box(0.1, 1, 6, x, 0.9, 0), '#4a3b2e')),
      part(box(9, 0.1, 0.1, 0, 1.35, -2.95), '#4a3b2e'),
      part(prism(0.08, 0.08, 0.4, 1.4, 5, 1.5, -2.2), '#3a3d40'),
      part(box(0.18, 0.18, 0.8, 1.5, 1.55, -2.4).rotateX(0.3), '#3a3d40'),
      part(prism(0.5, 0.45, 0.4, 1.3, 6, -1.6, -1.5), '#8b8a86'),
      part(box(1.1, 0.06, 1.1, -1.6, 1.33, -1.5).rotateX(0.25), '#c9b893'),
    ]),
    /** Pilier, poutre et toit d'une galerie paravalanche (tronçon de 6 m, l'axe de la route le long de z). */
    gallery: template([
      part(box(0.7, 6.2, 0.7, 4.6, 3.1, 0), '#a4a29c'),
      part(box(0.8, 6.6, 6, -4.8, 3.3, 0), '#8f8d87'),
      part(box(10.6, 0.7, 6.1, 0, 6.55, 0).rotateZ(-0.08), '#9a9893'),
      part(box(10.8, 0.25, 6.1, 0, 7.05, 0).rotateZ(-0.08), '#e8ecef'),
    ]),
  };
}
type Kit = ReturnType<typeof kit>;

// ───────────────────────────── Lieux

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

/** Pente du terrain (m/m) autour d'un point. */
function slope(p: LandProbe, x: number, z: number): number {
  const h = p.heightAt(x, z);
  let s = 0;
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) s = Math.max(s, Math.abs(p.heightAt(x + dx, z + dz) - h) / 3);
  return s;
}

/** Village de pêcheurs : cabanes sur pilotis au bord de l'eau (hors du port), séchoirs à poisson sur la grève. */
function fishingVillage(k: () => Kit, v: (typeof FISHING)[number]): Site {
  return {
    id: `pecheurs-${v.id}`,
    x: v.x,
    z: v.z,
    reach: 900,
    needs: [[v.x, v.z], [v.x + Math.cos(v.sea) * v.r, v.z + Math.sin(v.sea) * v.r]],
    *build(c) {
      const K = k();
      const r = rng(4400 + Math.round(v.x));
      const colours = [new THREE.Color('#a8322d'), new THREE.Color('#b23b2c'), new THREE.Color('#e2b54a'), new THREE.Color('#f1efe6')];
      let cabins = 0;
      // Rayons depuis le centre : dernier point à terre, puis la cabane à cheval sur le rivage, tournée vers l'eau.
      for (let i = 0; i < 46 && cabins < 9; i++) {
        const a = v.sea + (i / 46 - 0.5) * 2.6;
        if (v.harbour !== undefined && Math.abs(Math.atan2(Math.sin(a - v.harbour), Math.cos(a - v.harbour))) < 0.3) continue;
        let last: [number, number] | null = null;
        for (let d = 60; d < v.r * 2.4; d += 6) {
          const x = v.x + Math.cos(a) * d;
          const z = v.z + Math.sin(a) * d;
          const y = c.probe.heightAt(x, z);
          if (!Number.isFinite(y)) break;
          if (y < -0.2) {
            if (last && c.probe.heightAt(last[0], last[1]) < 4) {
              const px = last[0] + Math.cos(a) * 3;
              const pz = last[1] + Math.sin(a) * 3;
              if (!c.probe.buildingNear(px, pz, 9)) {
                c.mesh.put(K.rorbu, px, 2.3, pz, -a + Math.PI / 2, 1, 1, 1, colours[cabins % colours.length]!);
                cabins++;
                i += 3;
              }
            }
            break;
          }
          last = [x, z];
        }
        if (i % 6 === 0) yield;
      }
      // Séchoirs à poisson : sur la terre ferme, près de l'eau, hors des routes et des maisons.
      let racks = 0;
      for (let t = 0; t < 160 && racks < 7; t++) {
        const a = v.sea + (r() - 0.5) * 2.4;
        const d = v.r * (0.5 + r() * 1.1);
        const x = v.x + Math.cos(a) * d;
        const z = v.z + Math.sin(a) * d;
        const y = c.probe.heightAt(x, z);
        if (!Number.isFinite(y) || y < 1 || y > 14 || !c.probe.open(x, z, 0.6) || c.probe.buildingNear(x, z, 7) || slope(c.probe, x, z) > 0.2) continue;
        c.mesh.put(K.rack, x, y, z, a + Math.PI / 2, 1, 1, 1, WHITE);
        racks++;
        if (racks % 3 === 0) yield;
      }
      for (let s = 0; s < 3; s++) {
        const a = v.sea + (s - 1) * 0.5;
        c.spots.push({ kind: 'fisher', x: v.x + Math.cos(a) * v.r * 0.9, y: c.probe.heightAt(v.x + Math.cos(a) * v.r * 0.9, v.z + Math.sin(a) * v.r * 0.9), z: v.z + Math.sin(a) * v.r * 0.9, yaw: Math.atan2(Math.cos(a), Math.sin(a)), seed: (s * 0.31 + v.x * 0.001) % 1 });
      }
    },
  };
}

/** Bac du fjord : rampes sur les deux cales, bateau qui traverse (quatre minutes l'aller-retour). */
function ferry(k: () => Kit): Site {
  const end = (q: typeof CALE_A, u: number): [number, number] => [q.x + Math.cos(q.dir) * u, q.z + Math.sin(q.dir) * u];
  const mx = (CALE_A.x + CALE_B.x) / 2;
  const mz = (CALE_A.z + CALE_B.z) / 2;
  return {
    id: 'bac',
    x: mx,
    z: mz,
    reach: 1400,
    needs: [[CALE_A.x, CALE_A.z], [CALE_B.x, CALE_B.z]],
    *build(c) {
      const K = k();
      for (const q of [CALE_A, CALE_B]) {
        const [rx, rz] = end(q, -q.halfLen * 0.2);
        c.mesh.put(K.ramp, rx, 2.1, rz, -q.dir, 1, 1, 1, WHITE);
      }
      yield;
      const m = meshOf([{ t: K.ferry, x: 0, y: 0, z: 0 }], c.mat);
      m.name = 'grand-nord-bac';
      // Trajet : à quai dans la cale A, sortie, traversée, entrée dans la cale B, et retour.
      const a0 = end(CALE_A, 4);
      const a1 = end(CALE_A, CALE_A.halfLen + 30);
      const b1 = end(CALE_B, CALE_B.halfLen + 30);
      const b0 = end(CALE_B, 4);
      const legs: Array<[[number, number], [number, number]]> = [[a0, a1], [a1, b1], [b1, b0]];
      const along = (s: number): { x: number; z: number; yaw: number } => {
        // s : 0 → 1 de A vers B, en trois tronçons de durées 0,2 / 0,6 / 0,2.
        const cuts = [0, 0.2, 0.8, 1];
        let i = 0;
        while (i < 2 && s > cuts[i + 1]!) i++;
        const t = Math.min(1, Math.max(0, (s - cuts[i]!) / (cuts[i + 1]! - cuts[i]!)));
        const e = t * t * (3 - 2 * t);
        const [p, q] = legs[i]!;
        return { x: p[0] + (q[0] - p[0]) * e, z: p[1] + (q[1] - p[1]) * e, yaw: -Math.atan2(q[1] - p[1], q[0] - p[0]) };
      };
      c.moving.push({
        object: m,
        step: (t) => {
          // 240 s : 50 s à quai en A, 70 s de traversée, 50 s à quai en B, 70 s de retour.
          const q = t % 240;
          const s = q < 50 ? 0 : q < 120 ? (q - 50) / 70 : q < 170 ? 1 : 1 - (q - 170) / 70;
          const back = q >= 170;
          const p = along(s);
          m.position.set(p.x, 0.9 + Math.sin(t * 0.9) * 0.08, p.z);
          m.rotation.set(0, back ? p.yaw + Math.PI : p.yaw, Math.sin(t * 0.7) * 0.015);
        },
      });
      strollPath(c, [end(CALE_A, -60), end(CALE_A, -5)], 77, 'walker');
      strollPath(c, [end(CALE_B, -60), end(CALE_B, -5)], 78, 'walker');
    },
  };
}

/** Cabanes de pêche sur les rives des lacs de la toundra. */
function lakeHuts(k: () => Kit, i: number): Site {
  const L = LAKES[i]!;
  const at = (a: number, s: number): [number, number] => {
    const ex = Math.cos(a) * L.rx * s;
    const ez = Math.sin(a) * L.rz * s;
    return [L.x + ex * Math.cos(L.rot) - ez * Math.sin(L.rot), L.z + ex * Math.sin(L.rot) + ez * Math.cos(L.rot)];
  };
  return {
    id: `cabanes-lac-${i}`,
    x: L.x,
    z: L.z,
    reach: Math.max(700, L.rx + 500),
    needs: [at(0, 1.1), at(Math.PI, 1.1)],
    *build(c) {
      const K = k();
      const r = rng(6100 + i);
      const n = L.rx > 1000 ? 4 : 2;
      let made = 0;
      for (let t = 0; t < 40 && made < n; t++) {
        const a = r() * Math.PI * 2;
        const [x, z] = at(a, 1.0 + 12 / Math.min(L.rx, L.rz) + r() * 0.06);
        const y = c.probe.heightAt(x, z);
        if (!Number.isFinite(y) || !c.probe.read(x, z) || c.probe.road > 0.05 || c.probe.buildingNear(x, z, 10) || slope(c.probe, x, z) > 0.25) continue;
        // Ponton vers le centre du lac.
        const [cx, cz] = at(a, 0);
        const yaw = Math.atan2(cx - x, cz - z);
        c.mesh.put(K.hut, x, y, z, yaw, 1, 1, 1, [new THREE.Color('#a8322d'), new THREE.Color('#e2b54a')][made % 2]!);
        c.spots.push({ kind: 'fisher', x: x + Math.sin(yaw) * 6.4, y: y + 0.45, z: z + Math.cos(yaw) * 6.4, yaw, seed: r() });
        made++;
        yield;
      }
    },
  };
}

/** Troupeau de rennes : bêtes qui paissent, et un groupe qui chemine lentement. */
function herd(k: () => Kit, i: number): Site {
  const [hx, hz, R] = HERDS[i]!;
  return {
    id: `rennes-${i}`,
    x: hx,
    z: hz,
    reach: 1000,
    needs: [[hx, hz]],
    *build(c) {
      const K = k();
      const r = rng(9100 + i);
      const tint = WHITE;
      let n = 0;
      for (let t = 0; t < 80 && n < 14; t++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * R;
        const x = hx + Math.cos(a) * d;
        const z = hz + Math.sin(a) * d;
        if (!c.probe.open(x, z) || slope(c.probe, x, z) > 0.3) continue;
        const y = c.probe.heightAt(x, z);
        const s = 0.85 + r() * 0.3;
        c.mesh.put(K.reindeer, x, y, z, r() * 6.28, s, s, s, tint);
        n++;
      }
      yield;
      // Groupe en marche : six bêtes à la queue leu leu sur une boucle lente (dix minutes).
      const members = Array.from({ length: 6 }, (_, j) => ({ t: K.reindeer, x: -j * 2.6 + (r() - 0.5), y: 0, z: (r() - 0.5) * 2.2, s: 0.9 + r() * 0.2 }));
      const m = meshOf(members, c.mat);
      m.name = 'grand-nord-rennes';
      const probe = c.probe;
      let lastY = probe.heightAt(hx, hz);
      c.moving.push({
        object: m,
        step: (time) => {
          const a = (time / 600) * Math.PI * 2 + i;
          const x = hx + Math.cos(a) * R * 0.7;
          const z = hz + Math.sin(a) * R * 0.45;
          const y = probe.heightAt(x, z);
          if (Number.isFinite(y)) lastY = y;
          m.position.set(x, lastY, z);
          m.rotation.y = -Math.atan2(Math.cos(a) * R * 0.45, -Math.sin(a) * R * 0.7);
        },
      });
    },
  };
}

/** Langue de glace du glacier de Robert : nappe blanche posée sur l'auge, crevasses bleutées, séracs au front. */
function glacier(): Site {
  const [ax, az] = GLACIER.from;
  const [bx, bz] = GLACIER.to;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L;
  const uz = (bz - az) / L;
  return {
    id: 'glacier',
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    reach: 3200,
    needs: [GLACIER.from, GLACIER.to],
    *build(c) {
      const ice = new THREE.Color('#e9f1f6');
      const blue = new THREE.Color('#a8c8db');
      const N = 40;
      const M = 10;
      const P = (i: number, j: number): [number, number, number] => {
        const t = i / N;
        const w = GLACIER.half * (1 - 0.35 * t) * (1 - 0.25 * t * t);
        const v = (j / M) * 2 - 1;
        const x = ax + ux * L * t - uz * w * v;
        const z = az + uz * L * t + ux * w * v;
        // Bombé au milieu, mince sur les bords et au front.
        const thick = 0.8 + 5 * (1 - v * v) * (1 - t * 0.6) * Math.min(1, (1 - t) * 12);
        return [x, c.probe.heightAt(x, z) + thick, z];
      };
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const p = P(i, j);
          const q = P(i + 1, j);
          const s = P(i + 1, j + 1);
          const o = P(i, j + 1);
          if (![p, q, s, o].every((v) => Number.isFinite(v[1]))) continue;
          // Crevasses : rangées bleutées en travers, plus serrées vers le bas.
          const col = (i % 4 === 2 && j > 1 && j < M - 2) || (i > N * 0.7 && (i + j) % 3 === 0) ? blue : ice;
          c.mesh.triUp(p[0], p[1], p[2], q[0], q[1], q[2], s[0], s[1], s[2], col);
          c.mesh.triUp(p[0], p[1], p[2], s[0], s[1], s[2], o[0], o[1], o[2], col);
        }
        if (i % 8 === 0) yield;
      }
      // Séracs au front de la glace.
      const r = rng(7777);
      const serac = template([part(new THREE.IcosahedronGeometry(2.4, 0).scale(1, 1.4, 1), '#dcebf3')]);
      for (let s = 0; s < 14; s++) {
        const v = (r() - 0.5) * 1.6;
        const t = 0.93 + r() * 0.06;
        const w = GLACIER.half * (1 - 0.35 * t) * (1 - 0.25 * t * t);
        const x = ax + ux * L * t - uz * w * v;
        const z = az + uz * L * t + ux * w * v;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(serac, x, y + 1, z, r() * 6, 0.7 + r() * 0.8, 0.7 + r(), 0.7 + r() * 0.8, WHITE);
      }
    },
  };
}

/** Phare du cap Boréal : bandes rouges, lanterne ; feu tournant la nuit. */
function lighthouse(k: () => Kit): Site {
  const [px, pz] = PHARE;
  return {
    id: 'phare-du-cap',
    x: px,
    z: pz,
    reach: 1500,
    needs: [PHARE],
    *build(c) {
      const K = k();
      const y = c.probe.heightAt(px, pz);
      if (!Number.isFinite(y)) return;
      c.mesh.put(K.lighthouse, px, y, pz, 0, 1, 1, 1, WHITE);
      yield;
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#fff3c4', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beamGeo = new THREE.ConeGeometry(16, 380, 12, 1, true).rotateZ(Math.PI / 2).translate(-190, 0, 0);
      const g = new THREE.Group();
      g.name = 'grand-nord-phare';
      g.position.set(px, y + 19.7, pz);
      const beams = [0, Math.PI].map((a) => {
        const m = new THREE.Mesh(beamGeo, mat);
        m.rotation.y = a;
        m.castShadow = false;
        g.add(m);
        return m;
      });
      c.moving.push({
        object: g,
        step: (time) => {
          const on = islandClock().night > 0.3;
          for (const b of beams) b.visible = on;
          g.rotation.y = time * 0.8;
        },
      });
    },
  };
}

/** Cairns des cols et des sommets ; belvédère des Aurores (plateforme, longue-vue). */
function summits(k: () => Kit): Site {
  return {
    id: 'sommets',
    x: (BELVEDERE[0] + DENT[0]) / 2,
    z: (BELVEDERE[1] + DENT[1]) / 2,
    reach: 2600,
    needs: [BELVEDERE, COL, DENT],
    *build(c) {
      const K = k();
      const r = rng(3131);
      const pile = (x: number, z: number, n: number) => {
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2;
          const d = i ? 4 + r() * 10 : 0;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (c.probe.read(px, pz) && c.probe.road > 0.05) continue;
          const y = c.probe.heightAt(px, pz);
          if (Number.isFinite(y)) c.mesh.put(K.cairn, px, y - 0.1, pz, r() * 6, 0.7 + r() * 0.6, 0.7 + r() * 0.6, 0.7 + r() * 0.6, WHITE);
        }
      };
      // Col du Renne : cairns de part et d'autre de la route.
      pile(COL[0] + 14, COL[1] - 10, 3);
      pile(COL[0] - 16, COL[1] + 12, 2);
      pile(DENT[0], DENT[1], 2);
      yield;
      const by = c.probe.heightAt(BELVEDERE[0] + 12, BELVEDERE[1] - 6);
      if (Number.isFinite(by)) c.mesh.put(K.lookout, BELVEDERE[0] + 12, by, BELVEDERE[1] - 6, 0.4, 1, 1, 1, WHITE);
      pile(BELVEDERE[0] - 12, BELVEDERE[1] + 8, 2);
      for (let s = 0; s < 4; s++) c.spots.push({ kind: 'walker', x: BELVEDERE[0] + 10 + s, y: (by || 0) + 0.4, z: BELVEDERE[1] - 6, yaw: Math.PI, seed: s * 0.23 });
    },
  };
}

/** Galerie paravalanche sur la descente nord du col du Renne. */
function gallery(k: () => Kit): Site {
  const mid = GALLERY[Math.floor(GALLERY.length / 2)] ?? COL;
  return {
    id: 'galerie',
    x: mid[0],
    z: mid[1],
    reach: 1400,
    needs: GALLERY.length ? [GALLERY[0]!, GALLERY[GALLERY.length - 1]!] : [COL],
    *build(c) {
      const K = k();
      for (let i = 0; i + 1 < GALLERY.length; i++) {
        const [x0, z0] = GALLERY[i]!;
        const [x1, z1] = GALLERY[i + 1]!;
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 6));
        for (let s = 0; s < n; s++) {
          const x = x0 + ((x1 - x0) * (s + 0.5)) / n;
          const z = z0 + ((z1 - z0) * (s + 0.5)) / n;
          const y = c.probe.heightAt(x, z);
          // Mur plein côté amont (x local négatif), piliers côté aval.
          let yaw = Math.atan2(x1 - x0, z1 - z0);
          const px = Math.cos(yaw);
          const pz = -Math.sin(yaw);
          if (c.probe.heightAt(x + px * 12, z + pz * 12) > c.probe.heightAt(x - px * 12, z - pz * 12)) yaw += Math.PI;
          if (Number.isFinite(y)) c.mesh.put(K.gallery, x, y, z, yaw, 1, 1, 1, WHITE);
        }
        yield;
      }
    },
  };
}

/** Tribunes, portique et drapeaux du Circuit du Grand Nord. */
function circuit(k: () => Kit): Site {
  const zS = RING.z + RING.radius;
  return {
    id: 'circuit',
    x: RING.x,
    z: RING.z,
    reach: 900,
    needs: [[RING.x - RING.half, zS], [RING.x + RING.half, zS], [RING.x, RING.z - RING.radius]],
    *build(c) {
      const K = k();
      const flags = [new THREE.Color('#a8322d'), new THREE.Color('#e2b54a'), new THREE.Color('#2f5f8a'), new THREE.Color('#f1efe6')];
      for (let i = -2; i <= 2; i++) {
        const x = RING.x + i * 13;
        const z = zS + 26;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(K.stand, x, y, z, Math.PI, 1, 1, 1, WHITE);
        for (let s = 0; s < 8; s++) c.spots.push({ kind: 'villager', x: x - 5 + s * 1.4, y: y + 1.6, z: z - 1.2, yaw: Math.PI, seed: ((i + 2) * 0.137 + s * 0.071) % 1 });
      }
      yield;
      const ay = c.probe.heightAt(RING.x + 120, zS);
      if (Number.isFinite(ay)) c.mesh.put(K.arch, RING.x + 120, ay, zS, Math.PI / 2, 1, 1, 1, WHITE);
      for (let i = 0; i < 24; i++) {
        const x = RING.x - RING.half + (i * 2 * RING.half) / 23;
        for (const z of [zS + 9, RING.z - RING.radius - 9]) {
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.flag, x, y, z, 0, 1, 1, 1, flags[i % flags.length]!);
        }
      }
    },
  };
}

/**
 * Balisage d'un parcours fermé (bike park, cyclo-cross) : fanions ou piquets au bord du chemin, là où le sol passe
 * de la chaussée à la lande ; quelques équipements à l'écart.
 */
function* edgeMarks(c: SiteContext, cx: number, cz: number, R: number, t: Template, colours: THREE.Color[], max: number): Generator<void> {
  let n = 0;
  for (let gz = -R; gz <= R && n < max; gz += 11) {
    for (let gx = -R; gx <= R && n < max; gx += 11) {
      const x = cx + gx;
      const z = cz + gz;
      if (gx * gx + gz * gz > R * R || !c.probe.read(x, z) || c.probe.road > 0.02) continue;
      let dir: [number, number] | null = null;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) if (c.probe.read(x + dx, z + dz) && c.probe.road > 0.4) dir = [dx, dz];
      if (!dir || c.probe.buildingNear(x, z, 3)) continue;
      const y = c.probe.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      c.mesh.put(t, x, y, z, Math.atan2(dir[1], dir[0]), 1, 1, 1, colours[n % colours.length]!);
      n++;
    }
    yield;
  }
}

function bikePark(k: () => Kit): Site {
  const [x0, z0] = BIKE_PARK;
  return {
    id: 'bike-park',
    x: x0,
    z: z0,
    reach: 1000,
    needs: [[x0 - 300, z0 - 300], [x0 + 300, z0 + 300]],
    *build(c) {
      const K = k();
      yield* edgeMarks(c, x0, z0, 520, K.flag, [new THREE.Color('#ff7a1a'), new THREE.Color('#2f5f8a')], 70);
      const r = rng(5511);
      let n = 0;
      for (let t = 0; t < 120 && n < 7; t++) {
        const x = x0 + (r() - 0.5) * 700;
        const z = z0 + (r() - 0.5) * 700;
        if (!c.probe.open(x, z) || c.probe.buildingNear(x, z, 8) || slope(c.probe, x, z) > 0.35) continue;
        c.mesh.put(K.kicker, x, c.probe.heightAt(x, z), z, r() * 6.28, 1, 1, 1, WHITE);
        n++;
      }
      const ay = c.probe.heightAt(x0, z0);
      if (Number.isFinite(ay) && !c.probe.buildingNear(x0, z0, 8)) c.mesh.put(K.arch, x0, ay, z0, 0.6, 0.8, 0.8, 0.8, new THREE.Color('#ff7a1a'));
    },
  };
}

function cycloCross(k: () => Kit): Site {
  const [x0, z0] = CYCLO_CROSS;
  return {
    id: 'cyclo-cross',
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0 - 250, z0 - 250], [x0 + 250, z0 + 250]],
    *build(c) {
      const K = k();
      yield* edgeMarks(c, x0, z0, 480, K.stake, [new THREE.Color('#e2302a'), new THREE.Color('#ffffff')], 110);
      const r = rng(6620);
      let tents = 0;
      for (let t = 0; t < 80 && tents < 3; t++) {
        const x = x0 + (r() - 0.5) * 400;
        const z = z0 + (r() - 0.5) * 400;
        if (!c.probe.open(x, z) || c.probe.buildingNear(x, z, 8) || slope(c.probe, x, z) > 0.2) continue;
        const y = c.probe.heightAt(x, z);
        c.mesh.put(K.tent, x, y, z, r() * 6, 1, 1, 1, [new THREE.Color('#a8322d'), new THREE.Color('#2f5f8a'), new THREE.Color('#e2b54a')][tents]!);
        for (let s = 0; s < 5; s++) c.spots.push({ kind: 'villager', x: x + 3 + s * 0.9, y, z: z + 3.5, yaw: r() * 6, seed: r() });
        tents++;
      }
    },
  };
}

// ───────────────────────────── Aurores boréales

/**
 * Rubans verts et violets, en arc au nord du coureur, à quelques centaines de mètres au-dessus de lui : ils suivent la
 * caméra comme un élément du ciel et ondulent (nœuds TSL). Visibles quand la nuit dépasse 0,3. Le ciel est couvert par
 * une grille de petits lieux (le décor animé n'est actif qu'à moins de 750 m de son lieu) ; un seul les dessine à la fois.
 */
const AURORA_STEP = 1050;
const auroraLevel = uniform(0);
let auroraMaterial: THREE.MeshBasicNodeMaterial | null = null;
let auroraOwner: THREE.Object3D | null = null;
let auroraSeen = 0;

function auroraMat(): THREE.MeshBasicNodeMaterial {
  if (auroraMaterial) return auroraMaterial;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.fog = false;
  const h = attribute('auroraH', 'float');
  const s = attribute('auroraS', 'float');
  const wave = sin(time.mul(0.23).add(s.mul(0.0042))).mul(60).add(sin(time.mul(0.71).add(s.mul(0.013))).mul(18));
  m.positionNode = positionLocal.add(vec3(cameraPosition.x, cameraPosition.y, cameraPosition.z)).add(vec3(wave.mul(0.4), 0, wave.mul(h.add(0.4))));
  // Rideaux plissés : bandes verticales qui vivent lentement ; vert au pied, violet au sommet.
  const folds = mx_noise_float(vec2(s.mul(0.006).add(time.mul(0.04)), time.mul(0.02))).mul(0.5).add(0.5);
  const green = vec3(0.24, 1.0, 0.55);
  const violet = vec3(0.6, 0.3, 1.0);
  const col = mix(green, violet, smoothstep(0.45, 1.0, h));
  const alpha = smoothstep(0.0, 0.18, h).mul(float(1).sub(smoothstep(0.55, 1.0, h))).mul(folds.mul(0.8).add(0.2)).mul(auroraLevel).mul(0.55);
  m.colorNode = vec4(col, alpha);
  auroraMaterial = m;
  return m;
}

function auroraGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const hs: number[] = [];
  const ss: number[] = [];
  const r = rng(424242);
  // Trois rubans en arc au nord (−z), entre 1 100 et 1 450 m du coureur.
  for (let k = 0; k < 3; k++) {
    const R = 1100 + k * 170;
    const a0 = -Math.PI / 2 - 1.1 + r() * 0.3;
    const a1 = -Math.PI / 2 + 1.0 - r() * 0.3;
    const base = 330 + k * 60;
    const top = base + 420 + k * 90;
    const N = 56;
    const ph = r() * 6;
    const P = (i: number, up: number): [number, number, number] => {
      const a = a0 + ((a1 - a0) * i) / N;
      const rr = R + 140 * Math.sin(i * 0.21 + ph);
      const y = (up ? top : base) + 50 * Math.sin(i * 0.13 + ph * 2);
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    };
    for (let i = 0; i < N; i++) {
      const p = P(i, 0);
      const q = P(i + 1, 0);
      const pu = P(i, 1);
      const qu = P(i + 1, 1);
      const sa = i * 60 + k * 5000;
      const sb = (i + 1) * 60 + k * 5000;
      pos.push(...p, ...q, ...qu, ...p, ...qu, ...pu);
      hs.push(0, 0, 1, 0, 1, 1);
      ss.push(sa, sb, sb, sa, sb, sa);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('auroraH', new THREE.BufferAttribute(new Float32Array(hs), 1));
  g.setAttribute('auroraS', new THREE.BufferAttribute(new Float32Array(ss), 1));
  return g;
}

function aurora(i: number, j: number): Site {
  const x = -18500 + i * AURORA_STEP;
  const z = -12500 + j * AURORA_STEP;
  return {
    id: `aurore-${i}-${j}`,
    x,
    z,
    reach: 800,
    needs: [[x, z]],
    *build(c) {
      const m = new THREE.Mesh(auroraGeometry(), auroraMat());
      m.name = 'grand-nord-aurore';
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = -1;
      c.moving.push({
        object: m,
        step: () => {
          const now = performance.now();
          // Un seul lieu dessine les aurores : celui qui les tient, ou un autre s'il ne se montre plus.
          if (auroraOwner !== m && (!auroraOwner || !auroraOwner.parent || !auroraOwner.visible || now - auroraSeen > 250)) auroraOwner = m;
          if (auroraOwner !== m) {
            m.visible = false;
            return;
          }
          auroraSeen = now;
          const n = islandClock().night;
          auroraLevel.value = Math.min(1, Math.max(0, (n - 0.3) / 0.35));
          m.visible = n > 0.3;
        },
      });
    },
  };
}

// ───────────────────────────── Liste des lieux

export function grandNordSites(): Site[] {
  let templates: Kit | undefined;
  let harbours: HarbourTemplates | undefined;
  const k = () => (templates ??= kit());
  const h = () => (harbours ??= harbourTemplates());
  const skies: Site[] = [];
  for (let i = 0; i <= Math.ceil(37000 / AURORA_STEP); i++) for (let j = 0; j <= Math.ceil(25000 / AURORA_STEP); j++) skies.push(aurora(i, j));
  return [
    harbourSite('port-boreal', PORT_BOREAL, 750, h),
    harbourSite('port-skarvik', SKARVIK, 700, h),
    harbourSite('port-nordvik', NORDVIK, 700, h),
    ...FISHING.map((v) => fishingVillage(k, v)),
    ferry(k),
    ...LAKES.map((_, i) => lakeHuts(k, i)),
    ...HERDS.map((_, i) => herd(k, i)),
    glacier(),
    lighthouse(k),
    summits(k),
    ...(GALLERY.length ? [gallery(k)] : []),
    circuit(k),
    bikePark(k),
    cycloCross(k),
    ...skies,
  ];
}

/** Quais, promenade de Port-Boréal et cales du bac : ni clôtures ni poteaux de campagne. */
export function grandNordNoFence(x: number, z: number): boolean {
  if (Math.hypot(x + 450, z - 8900) < 1600) return true;
  for (const q of [SKARVIK, NORDVIK]) if (Math.hypot(x - q.x, z - q.z) < q.halfLen + 120) return true;
  return Math.hypot(x - CALE_A.x, z - CALE_A.z) < 140 || Math.hypot(x - CALE_B.x, z - CALE_B.z) < 140;
}
