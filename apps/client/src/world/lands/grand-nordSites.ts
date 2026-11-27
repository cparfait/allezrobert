import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, mix, mx_noise_float, positionLocal, sin, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, template, type LandProbe, type Template } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';

/**
 * Décor propre du Grand Nord robertien (mode Poly, tools/grand-nord) : ports de Port-Boréal, Skarvik et Nordvik,
 * bac animé qui traverse le fjord du Bac, cabanes de pêcheurs sur pilotis et séchoirs à poisson des villages du fond
 * des fjords,
 * cabanes de pêche au bord des lacs de la toundra, troupeaux de rennes, langue de glace du glacier de Robert, phare
 * du cap Boréal (feu tournant la nuit), cairns des cols et du belvédère, galerie paravalanche du col du Renne,
 * tribunes du Circuit, bike park de Fjellheim, cyclo-cross de la Toundra, cascades sur les parois des fjords, jalons à
 * neige orange le long des routes de montagne, et aurores boréales la nuit. Chaque lieu
 * est construit par pas près du coureur (IslandSites), avec peu de triangles.
 */
const WHITE = new THREE.Color(0xffffff);
type XZ = readonly [number, number];

// ───────────────────────────── Cotes du générateur (tools/grand-nord/src/design.ts, places.json)

const PORT_BOREAL: HarbourSite = {
  x: -7610, z: 12159.7, dir: 2.13, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.3, fishing: true,
  hulls: ['#a8322d', '#f1efe6', '#2f5f8a', '#e2b54a', '#3a4a5a'],
};
const SKARVIK: HarbourSite = {
  x: 10517.3, z: 5903.6, dir: 0.862, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.15, fishing: true,
  hulls: ['#a8322d', '#2d5d8f', '#f1efe6', '#3c7f58', '#e2b54a'],
};
const NORDVIK: HarbourSite = {
  x: 5867.1, z: -5825.2, dir: -0.512, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.1, fishing: true,
  hulls: ['#2d5d8f', '#b8432f', '#f1efe6', '#253f66', '#d79a33'],
};
/** Cales du bac, face à face sur les rives du fjord du Bac (centre du bassin, cap du large, demi-longueur). */
const CALE_A = { x: 13807.3, z: -2603.9, dir: 1.485, halfLen: 34 };
const CALE_B = { x: 13868.1, z: -1899.2, dir: -1.657, halfLen: 34 };
const RING = { x: 3000, z: 2500, half: 560, radius: 215 };
const BELVEDERE: XZ = [2000, -4300];
const DENT: XZ = [5100, -3300];
const COL: XZ = [3426, -3840];
const PHARE: XZ = [13220, 1060];
const GLACIER = { from: [-760, -4500] as XZ, to: [-640, -6050] as XZ, half: 230 };
/** Villages de pêcheurs au fond des fjords : centre, rayon, cap vers l'eau (cabanes sur pilotis le long du rivage, hors du port). */
const FISHING: ReadonlyArray<{ id: string; x: number; z: number; r: number; sea: number; harbour?: number }> = [
  { id: 'skarvik', x: 10281.1, z: 5628, r: 400, sea: 0.86, harbour: 0.86 },
  { id: 'nordvik', x: 5546.8, z: -5645.1, r: 420, sea: -0.51, harbour: -0.51 },
  { id: 'isbrevik', x: -437.4, z: -7720.3, r: 220, sea: -2.78 },
  { id: 'sorvik', x: 2442.8, z: 7167.7, r: 360, sea: 1.22 },
  { id: 'vatnby', x: -6705.3, z: -383.6, r: 380, sea: -2.73 },
  { id: 'fjellheim', x: -5193.1, z: -4909.4, r: 340, sea: -2.52 },
  { id: 'port-boreal', x: -8360.3, z: 11485.5, r: 500, sea: 2.2, harbour: 2.13 },
];
/** Lacs de la toundra et de la montagne (centre, demi-axes) : cabanes de pêche sur la rive. */
const LAKES: ReadonlyArray<{ x: number; z: number; rx: number; rz: number; rot: number }> = [
  { x: 6419, z: 2218, rx: 344, rz: 233, rot: 1.74 },
  { x: 6190, z: 31, rx: 280, rz: 139, rot: 0.19 },
  { x: 7136, z: 3098, rx: 262, rz: 146, rot: 0.52 },
  { x: 3900, z: -2500, rx: 240, rz: 150, rot: 0.5 },
  { x: -4200, z: -2900, rx: 200, rz: 120, rot: 1.2 },
];
/** Troupeaux de rennes : centre et rayon de pâture. */
const HERDS: ReadonlyArray<readonly [number, number, number]> = [
  [7400, 1300, 260],
  [4200, 3300, 240],
  [8400, 3200, 220],
  [4800, -1500, 200],
  [-11000, 6200, 250],
  [-2200, 2400, 200],
];
const BIKE_PARK: XZ = [-5900, -4300];
const CYCLO_CROSS: XZ = [6900, 4300];
/** Galerie paravalanche sur la descente nord du col du Renne (axe de la route, du haut vers le bas). */
const GALLERY: ReadonlyArray<XZ> = [[3447.4, -3863.8], [3460.7, -3878.7], [3478.5, -3886.1], [3498.4, -3888.3], [3518.3, -3890.6], [3538.2, -3892.8], [3558, -3895]];

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
      // Rouge de Falun surtout, quelques cabanes ocre ou blanches : c'est le rouge qu'on voit de loin sur l'eau sombre.
      const colours = ['#a8322d', '#b23b2c', '#9e2f2a', '#e2b54a', '#a8322d', '#b23b2c', '#f1efe6', '#9e2f2a'].map((h) => new THREE.Color(h));
      let cabins = 0;
      // Rayons depuis le centre : dernier point à terre, puis la cabane à cheval sur le rivage, tournée vers l'eau.
      for (let i = 0; i < 60 && cabins < 13; i++) {
        const a = v.sea + (i / 60 - 0.5) * 2.8;
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
                // Les unes plus longues ou plus hautes que les autres, comme une rangée de cabanes bâtie au fil du temps.
                const k = 0.9 + r() * 0.3;
                c.mesh.put(K.rorbu, px, 2.3, pz, -a + Math.PI / 2, k * (0.9 + r() * 0.35), 0.95 + r() * 0.2, k, colours[cabins % colours.length]!);
                cabins++;
                i += 2;
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
        for (const z of [zS + 12, RING.z - RING.radius - 12]) {
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

// ───────────────────────────── Roche et bois : falaises des fjords et des cols, blocs de la toundra, bosquets

/** Axes des fjords (du fond vers le large) et demi-largeurs de l'eau au fond et au large (design.ts). */
const FJORD_AXES: ReadonlyArray<{ id: string; pts: ReadonlyArray<XZ>; w0: number; w1: number }> = [
  { id: 'glacier', pts: [[-600, -6300], [-900, -7600], [-1500, -9000], [-1300, -10500], [-1600, -13400]], w0: 190, w1: 700 },
  { id: 'storfjord', pts: [[6000, -5900], [7600, -6800], [9800, -8300], [12000, -9800], [14800, -13200]], w0: 220, w1: 900 },
  { id: 'bac', pts: [[11400, -1300], [12800, -2300], [14200, -2200], [15800, -3000], [19200, -3500]], w0: 210, w1: 800 },
  { id: 'skarvik', pts: [[10600, 6000], [11800, 7400], [12400, 8800], [13900, 10300], [15800, 13200]], w0: 190, w1: 700 },
  { id: 'sorfjord', pts: [[2600, 7600], [3000, 8700], [2500, 9800], [2900, 11200], [2600, 13400]], w0: 180, w1: 620 },
  { id: 'grand-fjord', pts: [[-7200, -600], [-8800, -1300], [-10600, -800], [-12600, -1600], [-14600, -1200], [-19200, -1600]], w0: 220, w1: 900 },
  { id: 'fjellheim', pts: [[-5600, -5200], [-7000, -6200], [-8200, -7800], [-10200, -8800], [-12000, -11000], [-13600, -13400]], w0: 200, w1: 760 },
];
/** Cols aux versants raides : parois au-dessus de la route. */
const COLS: ReadonlyArray<{ id: string; x: number; z: number; half: number }> = [
  { id: 'col-du-renne', x: 3426, z: -3840, half: 1000 },
  { id: 'col-de-vatnby', x: -6700, z: -2900, half: 900 },
];
/** Fonds des vallées (design.ts, VALLEYS) et demi-largeur du fond : bosquets de sapins et de bouleaux. */
const VALLEY_FLOORS: ReadonlyArray<{ id: string; pts: ReadonlyArray<XZ>; w: number }> = [
  { id: 'sorvik', pts: [[4500, 3700], [3900, 5000], [3200, 6200], [2443, 7168]], w: 260 },
  { id: 'skarvik', pts: [[8000, 3400], [9000, 4500], [9900, 5400], [10281, 5628]], w: 260 },
  { id: 'gorges', pts: [[8900, 700], [9900, 100], [10700, -500], [11090, -1080]], w: 200 },
  { id: 'grand-fjord', pts: [[1700, 1700], [-600, 1500], [-3200, 1000], [-5600, 300], [-6705, -384]], w: 320 },
  { id: 'myra', pts: [[-2900, 1050], [-3900, 3500], [-5200, 6000], [-6600, 8300], [-7300, 9600]], w: 300 },
  { id: 'vatnby', pts: [[-6705, -384], [-7000, -1700], [-6700, -2900], [-6300, -4000], [-5193, -4909]], w: 240 },
  { id: 'lemmings', pts: [[-437, -7720], [800, -6800], [2200, -6900], [3600, -6500], [4500, -6050], [5150, -5850], [5547, -5645]], w: 300 },
  { id: 'calotte', pts: [[-5150, -4750], [-4950, -4250], [-4750, -3750], [-4600, -3350]], w: 340 },
];
/** Haut-plateau de Vidda (design.ts, PLATEAU) : toundra semée de blocs erratiques. */
const VIDDA = { x: 5200, z: 1500, rx: 3800, rz: 2500 };
const VIDDA_STEP = 1500;
/** Longueur des tronçons de fjord et de vallée construits d'un coup. */
const FJORD_STEP = 1400;
const VALLEY_STEP = 1000;

/**
 * Bloc à grandes facettes : icosaèdre dont chaque sommet est tiré vers l'intérieur ou l'extérieur (les faces restent
 * jointives), écrasé dessous pour bien se poser. 20 triangles.
 */
function rockGeo(r: number, seed: number, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, amp = 0.32): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const rr = rng(seed);
  const jit = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let f = jit.get(key);
    if (f === undefined) jit.set(key, (f = 1 - amp / 2 + rr() * amp));
    p.setXYZ(i, p.getX(i) * f * sx + x, Math.max(p.getY(i) * f, -r * 0.45) * sy + y, p.getZ(i) * f * sz + z);
  }
  return g;
}

/** Cône d'un étage de sapin : base à y0, `n` pans. */
const tier = (r: number, h: number, y0: number, n = 7) => new THREE.ConeGeometry(r, h, n).translate(0, y0 + h / 2, 0);

/** Gabarits de roche et de bois, selon la saison (mousse ou neige sur les replats, feuillage des bouleaux). */
function rockKit(season: SiteContext['season']) {
  const winter = season === 'winter';
  const moss = winter ? '#e4e9ec' : season === 'autumn' ? '#6e6a3a' : '#56703f';
  const moss2 = winter ? '#d6dde1' : season === 'autumn' ? '#7d6536' : '#4a6637';
  const leaf = season === 'autumn' ? '#c8922e' : season === 'spring' ? '#6f9a4a' : '#5a7f40';
  const leaf2 = season === 'autumn' ? '#b0682a' : season === 'spring' ? '#5f8a42' : '#4d7038';
  const snow = '#e8edf0';
  // Étages des sapins : rayon, hauteur, base.
  const tiers: ReadonlyArray<readonly [number, number, number]> = [[2.7, 3.2, 1.4], [2.2, 2.9, 3.4], [1.7, 2.6, 5.3], [1.1, 2.4, 7.1]];
  return {
    /** Paroi en strates, face vers +z : trois gradins de gros blocs gris, replats moussus (ou enneigés). ≈ 24 m × 22 m. */
    cliff: template([
      part(rockGeo(6, 11, 1.5, 1.0, 0.9, -8.5, 4.5, 0), '#7a7e83', 1),
      part(rockGeo(6, 12, 1.4, 1.1, 0.9, 0.5, 5, 0.8), '#6c7075', 1),
      part(rockGeo(6, 13, 1.5, 0.95, 0.9, 9, 4.3, -0.3), '#81858a', 1),
      part(rockGeo(5, 14, 2.6, 0.18, 0.7, 0, 10.4, -1.8, 0.2), moss),
      part(rockGeo(5.5, 15, 1.5, 1.0, 0.85, -4.5, 13, -3.8), '#74787d', 1),
      part(rockGeo(5, 16, 1.4, 1.05, 0.85, 5.5, 12.6, -3.2), '#696d72', 1),
      part(rockGeo(4.5, 17, 2.2, 0.16, 0.6, 0.5, 18.2, -5.2, 0.2), moss2),
      part(rockGeo(4.5, 18, 1.5, 0.9, 0.85, 0.5, 20, -6), '#7d8186', 1),
    ]),
    /** Pilier de roche plus étroit, avec un surplomb au sommet. ≈ 14 m × 24 m. */
    spur: template([
      part(rockGeo(5, 21, 1.4, 1.2, 1.0, 0, 5, 0), '#73777c', 1),
      part(rockGeo(4.5, 22, 1.3, 1.15, 0.95, 0.6, 12.5, -1.6), '#7e8287', 1),
      part(rockGeo(4, 23, 1.6, 0.2, 0.8, 0.2, 17.2, -2.6, 0.2), moss),
      part(rockGeo(4.2, 24, 1.55, 0.85, 1.15, -0.4, 19.5, -0.6), '#686c71', 1),
    ]),
    /** Éboulis : cinq blocs gris en tas, sur ≈ 8 m. */
    scree: template([
      part(rockGeo(1.5, 31, 1.2, 0.8, 1, 0, 0.6, 0), '#7c8085', 1),
      part(rockGeo(1.1, 32, 1, 0.8, 1.2, 2.3, 0.4, 1), '#6e7277', 1),
      part(rockGeo(0.9, 33, 1.2, 0.7, 1, -2, 0.3, 1.4), '#868a8f', 1),
      part(rockGeo(0.8, 34, 1, 0.8, 1, 1, 0.3, -2.1), '#73777c', 1),
      part(rockGeo(0.6, 35, 1, 0.7, 1, -3.4, 0.2, -0.8), '#7f8388', 1),
    ]),
    /** Rocher moussu : bloc gris, dessus vert (blanc l'hiver). */
    mossy: template([
      part(rockGeo(1.6, 41, 1.3, 0.8, 1.1, 0, 0.7, 0), '#7a7e83', 1),
      part(rockGeo(1.5, 42, 1.28, 0.32, 1.08, 0.05, 1.45, 0.02, 0.18), moss),
    ]),
    /** Bloc erratique : gros rocher pâle, seul sur la toundra, deux cailloux à son pied. */
    erratic: template([
      part(rockGeo(2.4, 51, 1.35, 1.05, 1.1, 0, 1.6, 0, 0.45), '#8d8c87', 1),
      part(rockGeo(0.5, 52, 1.2, 0.7, 1, 3.1, 0.15, 1.2), '#7e7d78', 1),
      part(rockGeo(0.4, 53, 1, 0.7, 1.2, -2.6, 0.1, -1.9), '#8a8984', 1),
    ]),
    /** Sapin à étages : tronc, quatre étages nets (neige sur le dessus l'hiver). ≈ 9,5 m. */
    fir: template([
      part(prism(0.28, 0.2, 0, 1.8, 5), '#4a3a2c'),
      ...tiers.map(([r, h, y0], i) => part(tier(r, h, y0), i % 2 ? '#2e4c34' : '#2a4630', 1)),
      ...(winter ? tiers.map(([r, h, y0]) => part(tier(r * 0.5, h * 0.46, y0 + h * 0.54), snow)) : []),
    ]),
    /** Bouleau : tronc blanc bagué de noir, houppier clair (rameaux nus l'hiver). ≈ 7 m. */
    birch: template([
      part(prism(0.16, 0.11, 0, 6, 5), '#ebe7dc'),
      part(box(0.36, 0.22, 0.36, 0, 2.2, 0), '#2e2c2a'),
      ...(winter
        ? [part(rockGeo(1.5, 61, 0.9, 1.3, 0.9, 0, 5.3, 0, 0.3), '#5e4c44')]
        : [part(rockGeo(1.9, 62, 1, 1.25, 1, 0.2, 5.6, 0, 0.25), leaf, 1), part(rockGeo(1.4, 63, 1, 1.2, 1, -0.5, 4.3, 0.4, 0.25), leaf2, 1)]),
    ]),
  };
}
type RockKit = ReturnType<typeof rockKit>;

/** Distance au tracé et position relative (0 au début, 1 à la fin). */
function nearLine(pts: ReadonlyArray<XZ>, x: number, z: number): { d: number; t: number } {
  let len = 0;
  const seg: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) seg.push((len += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])));
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const u = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
    const d = Math.hypot(x - ax - (bx - ax) * u, z - az - (bz - az) * u);
    if (d < best) {
      best = d;
      at = (i ? seg[i - 1]! : 0) + u * Math.sqrt(L2);
    }
  }
  return { d: best, t: at / (len || 1) };
}

/** Point du tracé à `s` m du début (et la direction locale). */
function alongLine(pts: ReadonlyArray<XZ>, s: number): { x: number; z: number; dx: number; dz: number } {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const L = Math.hypot(bx - ax, bz - az);
    if (s <= L || i + 2 === pts.length) {
      const u = Math.min(1, s / L);
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, dx: (bx - ax) / L, dz: (bz - az) / L };
    }
    s -= L;
  }
  const [x, z] = pts[0]!;
  return { x, z, dx: 1, dz: 0 };
}

const lineLength = (pts: ReadonlyArray<XZ>) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);
const inMap = (x: number, z: number) => Math.abs(x) < 18900 && Math.abs(z) < 12900;

/** Aucune chaussée sous le point ni à `r` m autour (quatre points). */
function offRoad(p: LandProbe, x: number, z: number, r: number): boolean {
  if (!p.read(x, z) || p.road >= 0.02) return false;
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) if (p.read(x + dx, z + dz) && p.road >= 0.02) return false;
  return true;
}

/** Ni village de pêcheurs, ni port, ni ouvrage d'un lieu voisin (galerie, belvédère, glacier). */
function keepClear(x: number, z: number): boolean {
  for (const v of FISHING) if (Math.hypot(x - v.x, z - v.z) < v.r + 120) return false;
  for (const g of GALLERY) if (Math.hypot(x - g[0], z - g[1]) < 70) return false;
  if (Math.hypot(x - BELVEDERE[0], z - BELVEDERE[1]) < 60) return false;
  return nearLine([GLACIER.from, GLACIER.to], x, z).d > GLACIER.half + 20;
}

const greyTint = (r: () => number) => {
  const v = 0.86 + r() * 0.14;
  return new THREE.Color(v, v, v * (0.99 + r() * 0.03));
};

/**
 * Parois sur les versants raides d'un carré (demi-côté `half`) : gros blocs en gradins tournés vers l'aval, à
 * moitié enfoncés dans la pente, éboulis à leur pied. `accept` borne la zone (rive d'un fjord, versant d'un col).
 */
function* cliffBand(c: SiteContext, K: RockKit, cx: number, cz: number, half: number, seed: number, max: number, accept: (x: number, z: number, h: number) => boolean): Generator<void> {
  const r = rng(seed);
  const p = c.probe;
  const step = 36;
  // Versants raides de la zone, puis tirage au hasard parmi eux (les deux rives à parts égales).
  const found: number[] = [];
  let row = 0;
  for (let gz = -half; gz <= half; gz += step) {
    for (let gx = -half; gx <= half; gx += step) {
      const x = cx + gx + (r() - 0.5) * step * 0.8;
      const z = cz + gz + (r() - 0.5) * step * 0.8;
      if (!inMap(x, z)) continue;
      const h = p.heightAt(x, z);
      if (!Number.isFinite(h) || h < 3) continue;
      const gxh = (p.heightAt(x + 6, z) - p.heightAt(x - 6, z)) / 12;
      const gzh = (p.heightAt(x, z + 6) - p.heightAt(x, z - 6)) / 12;
      if (Math.hypot(gxh, gzh) > 0.55 && accept(x, z, h) && keepClear(x, z)) found.push(x, z, h, gxh, gzh);
    }
    if (++row % 6 === 0) yield;
  }
  const order = Array.from({ length: found.length / 5 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const limit = Math.round(max * c.density);
  let n = 0;
  for (let o = 0; o < order.length && n < limit; o++) {
    const q = order[o]! * 5;
    const x = found[q]!;
    const z = found[q + 1]!;
    const h = found[q + 2]!;
    const gxh = found[q + 3]!;
    const gzh = found[q + 4]!;
    const s = Math.hypot(gxh, gzh);
    // Face vers l'aval : le +z local suit la pente descendante.
    const yaw = Math.atan2(-gxh / s, -gzh / s);
    const ox = Math.cos(yaw);
    const oz = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (!offRoad(p, x, z, 4) || !offRoad(p, x + ox * 12, z + oz * 12, 3) || !offRoad(p, x - ox * 12, z - oz * 12, 3) || !offRoad(p, x + fx * 8, z + fz * 8, 3)) continue;
    if (p.buildingNear(x, z, 22)) continue;
    const tall = r() < 0.3;
    const k = 0.65 + r() * 0.65;
    const ky = k * (0.85 + Math.min(0.35, (s - 0.55) * 0.8));
    // Le haut du bloc recule de ≈ 10 m dans la pente : pas de route derrière non plus.
    if (!offRoad(p, x - fx * 10 * k, z - fz * 10 * k, 3)) continue;
    // Pied posé sur le sol en aval (la masse s'enfonce dans la pente derrière) ; jusque dans l'eau au bord des fjords.
    const hf = p.heightAt(x + fx * 6 * k, z + fz * 6 * k);
    const y0 = Math.max(h - 12, Math.min(h, Number.isFinite(hf) ? hf : h)) - 2 * ky;
    c.mesh.put(tall ? K.spur : K.cliff, x, y0, z, yaw, k, ky, k, greyTint(r));
    n++;
    // Éboulis au pied, sur la pente descendante, s'il reste de la terre et pas de route.
    if (r() < 0.45) {
      const ex = x + fx * (9 + 6 * k);
      const ez = z + fz * (9 + 6 * k);
      const ey = p.heightAt(ex, ez);
      if (Number.isFinite(ey) && ey > 0.4 && offRoad(p, ex, ez, 5) && !p.buildingNear(ex, ez, 10)) c.mesh.put(K.scree, ex, ey - 0.3, ez, r() * 6.28, 0.8 + r() * 0.6, 0.8 + r() * 0.4, 0.8 + r() * 0.6, greyTint(r));
    }
    if (n % 6 === 0) yield;
  }
}

/** Falaises grises d'un tronçon de fjord (`s0` → `s0 + FJORD_STEP` m du fond), sur les deux rives. */
function fjordCliffs(rk: (s: SiteContext['season']) => RockKit, f: (typeof FJORD_AXES)[number], s0: number, total: number): Site {
  const a = alongLine(f.pts, s0);
  const b = alongLine(f.pts, Math.min(total, s0 + FJORD_STEP));
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const w = f.w0 + ((f.w1 - f.w0) * (s0 + FJORD_STEP / 2)) / total;
  return {
    id: `falaises-${f.id}-${Math.round(s0)}`,
    x: mx,
    z: mz,
    reach: 1900,
    needs: [[a.x, a.z], [b.x, b.z]],
    *build(c) {
      const K = rk(c.season);
      const half = FJORD_STEP / 2 + w + 400;
      yield* cliffBand(c, K, mx, mz, half, 8800 + Math.round(s0) + f.pts.length * 977, 60, (x, z, h) => {
        if (h > 420) return false;
        const q = nearLine(f.pts, x, z);
        // Le tronçon seulement (pas de doublon avec les voisins), jusqu'à ≈ 650 m de l'eau.
        const s = q.t * total;
        return s >= s0 && s < s0 + FJORD_STEP && q.d < w + 650;
      });
      c.flush();
    },
  };
}

/** Parois des versants d'un col. */
function colCliffs(rk: (s: SiteContext['season']) => RockKit, col: (typeof COLS)[number], i: number): Site {
  return {
    id: `falaises-${col.id}`,
    x: col.x,
    z: col.z,
    reach: 2000,
    needs: [[col.x - col.half * 0.7, col.z], [col.x + col.half * 0.7, col.z], [col.x, col.z - col.half * 0.7], [col.x, col.z + col.half * 0.7]],
    *build(c) {
      const K = rk(c.season);
      yield* cliffBand(c, K, col.x, col.z, col.half, 9900 + i, 70, (x, z) => Math.hypot(x - col.x, z - col.z) < col.half);
      c.flush();
    },
  };
}

/** Toundra de Vidda (carré de VIDDA_STEP m) : blocs erratiques épars, rochers moussus en petits tas. */
function tundraRocks(rk: (s: SiteContext['season']) => RockKit, cx: number, cz: number): Site {
  const half = VIDDA_STEP / 2;
  return {
    id: `toundra-${cx}-${cz}`,
    x: cx,
    z: cz,
    reach: 1400,
    needs: [[cx, cz]],
    *build(c) {
      const K = rk(c.season);
      const p = c.probe;
      const r = rng(7300 + cx * 3 + cz);
      const inside = (x: number, z: number) => ((x - VIDDA.x) / VIDDA.rx) ** 2 + ((z - VIDDA.z) / VIDDA.rz) ** 2 < 0.9;
      // Le Circuit, ses tribunes et son paddock restent dégagés.
      const nearRing = (x: number, z: number) => Math.abs(x - RING.x) < RING.half + 120 && Math.abs(z - RING.z) < RING.radius + 90;
      const ok = (x: number, z: number, margin: number) =>
        inMap(x, z) && inside(x, z) && !nearRing(x, z) && p.open(x, z, 0.1) && offRoad(p, x, z, margin) && !p.buildingNear(x, z, 12) && slope(p, x, z) < 0.25;
      let erratics = 0;
      const maxE = Math.round(9 * c.density);
      for (let t = 0; t < 60 && erratics < maxE; t++) {
        const x = cx + (r() - 0.5) * 2 * half;
        const z = cz + (r() - 0.5) * 2 * half;
        if (!ok(x, z, 6)) continue;
        const k = 0.9 + r() * 1.3;
        c.mesh.put(K.erratic, x, p.heightAt(x, z) - 0.25 * k, z, r() * 6.28, k, k * (0.8 + r() * 0.4), k, greyTint(r));
        erratics++;
        if (erratics % 3 === 0) yield;
      }
      yield;
      // Tas de deux à quatre rochers moussus.
      let heaps = 0;
      const maxH = Math.round(14 * c.density);
      for (let t = 0; t < 80 && heaps < maxH; t++) {
        const x = cx + (r() - 0.5) * 2 * half;
        const z = cz + (r() - 0.5) * 2 * half;
        if (!ok(x, z, 5)) continue;
        const m = 2 + Math.floor(r() * 3);
        for (let i = 0; i < m; i++) {
          const a = r() * 6.28;
          const d = i ? 2 + r() * 3.5 : 0;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (i && !offRoad(p, px, pz, 3)) continue;
          const k = (i ? 0.5 : 0.8) + r() * 0.7;
          c.mesh.put(K.mossy, px, p.heightAt(px, pz) - 0.15 * k, pz, r() * 6.28, k * (0.9 + r() * 0.3), k * (0.8 + r() * 0.4), k, greyTint(r));
        }
        heaps++;
        if (heaps % 4 === 0) yield;
      }
      c.flush();
    },
  };
}

/** Bosquets d'un tronçon de vallée : sapins à étages, bouleaux mêlés, sur le fond et le bas des versants. */
function valleyGroves(rk: (s: SiteContext['season']) => RockKit, v: (typeof VALLEY_FLOORS)[number], s0: number, total: number): Site {
  const mid = alongLine(v.pts, Math.min(total, s0 + VALLEY_STEP / 2));
  return {
    id: `bosquets-${v.id}-${Math.round(s0)}`,
    x: mid.x,
    z: mid.z,
    reach: 1200,
    needs: [[mid.x, mid.z]],
    *build(c) {
      const K = rk(c.season);
      const p = c.probe;
      const r = rng(5200 + Math.round(s0) + v.pts.length * 131 + Math.round(v.w));
      const spot = (x: number, z: number) =>
        inMap(x, z) && p.read(x, z) && p.water < 0.1 && p.urban < 0.15 && p.sand < 0.3 && offRoad(p, x, z, 3.5) && !p.buildingNear(x, z, 12) && !p.treeNear(x, z, 1.6) && slope(p, x, z) < 0.4 && p.heightAt(x, z) > 1.5;
      let groves = 0;
      const maxG = Math.max(1, Math.round(6 * c.density));
      for (let t = 0; t < 40 && groves < maxG; t++) {
        const a = alongLine(v.pts, Math.min(total, s0 + r() * VALLEY_STEP));
        const side = r() < 0.5 ? -1 : 1;
        const off = side * (50 + r() * v.w * 0.9);
        const gx = a.x - a.dz * off;
        const gz = a.z + a.dx * off;
        if (!spot(gx, gz) || !keepClear(gx, gz)) continue;
        const trees = 5 + Math.floor(r() * 9 * Math.min(1, c.density + 0.3));
        const birchShare = 0.2 + r() * 0.3;
        for (let i = 0; i < trees; i++) {
          const ta = r() * 6.28;
          const td = i ? 3 + Math.sqrt(r()) * 20 : 0;
          const x = gx + Math.cos(ta) * td;
          const z = gz + Math.sin(ta) * td;
          if (i && !spot(x, z)) continue;
          const y = p.heightAt(x, z);
          const k = 0.75 + r() * 0.6;
          const v2 = 0.88 + r() * 0.14;
          if (r() < birchShare) c.mesh.put(K.birch, x, y - 0.1, z, r() * 6.28, k, k * (0.9 + r() * 0.3), k, new THREE.Color(v2, v2, v2 * 0.95));
          else c.mesh.put(K.fir, x, y - 0.1, z, r() * 6.28, k, k * (0.9 + r() * 0.35), k, new THREE.Color(v2 * 0.96, v2, v2 * 0.96));
        }
        // Un rocher moussu au cœur du bosquet, de temps en temps.
        if (r() < 0.4) {
          const k = 0.7 + r() * 0.5;
          c.mesh.put(K.mossy, gx + 4, p.heightAt(gx + 4, gz + 3) - 0.15, gz + 3, r() * 6.28, k, k, k, greyTint(r));
        }
        groves++;
        yield;
      }
      c.flush();
    },
  };
}

function rockSites(): Site[] {
  const kits = new Map<SiteContext['season'], RockKit>();
  const rk = (s: SiteContext['season']) => {
    let K = kits.get(s);
    if (!K) kits.set(s, (K = rockKit(s)));
    return K;
  };
  const out: Site[] = [];
  for (const f of FJORD_AXES) {
    const total = lineLength(f.pts);
    // Le fond du fjord (village, port) reste à part : les parois commencent à 600 m.
    for (let s = 600; s < total; s += FJORD_STEP) {
      const a = alongLine(f.pts, s);
      if (inMap(a.x, a.z)) out.push(fjordCliffs(rk, f, s, total));
    }
  }
  COLS.forEach((col, i) => out.push(colCliffs(rk, col, i)));
  for (let x = VIDDA.x - VIDDA.rx + VIDDA_STEP / 2; x < VIDDA.x + VIDDA.rx; x += VIDDA_STEP) {
    for (let z = VIDDA.z - VIDDA.rz + VIDDA_STEP / 2; z < VIDDA.z + VIDDA.rz; z += VIDDA_STEP) {
      if (((x - VIDDA.x) / VIDDA.rx) ** 2 + ((z - VIDDA.z) / VIDDA.rz) ** 2 < 1.15) out.push(tundraRocks(rk, Math.round(x), Math.round(z)));
    }
  }
  for (const v of VALLEY_FLOORS) {
    const total = lineLength(v.pts);
    for (let s = 0; s < total; s += VALLEY_STEP) out.push(valleyGroves(rk, v, s, total));
  }
  return out;
}

// ───────────────────────────── Cascades des parois des fjords

/**
 * Cascades : on part d'un point haut et raide d'une rive, on suit la plus grande pente (donc les ravines) jusqu'à
 * l'eau, et l'on pose un ruban d'eau blanche drapé sur la paroi (trois voies, bandes claires et bleutées), avec de
 * l'écume au pied. Le ruban fait partie du décor fixe (visible de loin) ; de près, un voile animé fait couler l'eau
 * et les embruns respirent. L'hiver, la cascade est gelée (bleu glacier, sans voile).
 */
const FALL_STEP = 900;
let fallMaterial: THREE.MeshBasicNodeMaterial | null = null;

function fallMat(): THREE.MeshBasicNodeMaterial {
  if (fallMaterial) return fallMaterial;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u = attribute('fallU', 'float');
  const v = attribute('fallV', 'float');
  // Filets d'eau qui descendent : bruit étiré le long de la chute, qui défile vers le bas.
  const streak = mx_noise_float(vec2(u.mul(2.6), v.mul(0.07).sub(time.mul(1.5)))).mul(0.5).add(0.5);
  const alpha = smoothstep(0.48, 0.9, streak).mul(float(1).sub(u.abs().mul(0.55))).mul(0.8);
  m.colorNode = vec4(vec3(0.96, 0.99, 1.0), alpha);
  fallMaterial = m;
  return m;
}

type FallPath = { pts: Array<[number, number, number]>; water: boolean; drop: number };

/** Suit la plus grande pente depuis (x, z), par pas de 5 m, jusqu'à l'eau ou au replat ; null si une route ou une maison barre la chute. */
function traceFall(p: LandProbe, x: number, z: number): FallPath | null {
  const h0 = p.heightAt(x, z);
  const pts: Array<[number, number, number]> = [[x, z, h0]];
  let flat = 0;
  let water = false;
  for (let i = 0; i < 110; i++) {
    const [cx, cz] = pts[pts.length - 1]!;
    const gx = (p.heightAt(cx + 4, cz) - p.heightAt(cx - 4, cz)) / 8;
    const gz = (p.heightAt(cx, cz + 4) - p.heightAt(cx, cz - 4)) / 8;
    const g = Math.hypot(gx, gz);
    if (!Number.isFinite(g) || g < 0.04) break;
    const nx = cx - (gx / g) * 5;
    const nz = cz - (gz / g) * 5;
    const nh = p.heightAt(nx, nz);
    if (!Number.isFinite(nh)) break;
    if (nh < 0.6) {
      pts.push([nx, nz, 0.25]);
      water = true;
      break;
    }
    if (!offRoad(p, nx, nz, 4) || p.buildingNear(nx, nz, 8)) return null;
    pts.push([nx, nz, nh]);
    flat = g < 0.22 ? flat + 1 : 0;
    if (flat > 4) break;
  }
  const drop = h0 - pts[pts.length - 1]![2];
  return pts.length >= 8 ? { pts, water, drop } : null;
}

/** Cascades d'un tronçon de fjord (`s0` → `s0 + FALL_STEP` m du fond), sur l'une ou l'autre rive. */
function fjordFalls(f: (typeof FJORD_AXES)[number], s0: number, total: number, foam: () => Template): Site {
  const a = alongLine(f.pts, s0);
  const b = alongLine(f.pts, Math.min(total, s0 + FALL_STEP));
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const w = f.w0 + ((f.w1 - f.w0) * (s0 + FALL_STEP / 2)) / total;
  return {
    id: `cascades-${f.id}-${Math.round(s0)}`,
    x: mx,
    z: mz,
    reach: 2300,
    needs: [[a.x, a.z], [b.x, b.z]],
    *build(c) {
      const p = c.probe;
      const r = rng(12000 + Math.round(s0) * 7 + f.pts.length * 313 + Math.round(f.w1));
      // Tout le monde n'a pas sa cascade : un tronçon sur trois environ reste sec.
      if (r() < 0.3) return;
      const found: FallPath[] = [];
      for (let t = 0; t < 70; t++) {
        const at = alongLine(f.pts, Math.min(total, s0 + r() * FALL_STEP));
        const side = r() < 0.5 ? -1 : 1;
        // Parois creusées (design.ts) : le ressaut presque vertical est dans les 400 premiers mètres de la rive.
        const off = side * (w + 30 + r() * 390);
        const x = at.x - at.dz * off;
        const z = at.z + at.dx * off;
        if (!inMap(x, z) || !keepClear(x, z)) continue;
        const h = p.heightAt(x, z);
        if (!Number.isFinite(h) || h < 70 || h > 520 || slope(p, x, z) < 0.9 || !offRoad(p, x, z, 5)) continue;
        const fall = traceFall(p, x, z);
        // Chutes franches seulement : au moins 60 m, à plus de 40° en moyenne (pas de longue pente d'eau).
        if (fall && fall.drop >= 60 && fall.drop > (fall.pts.length - 1) * 5 * 0.85) found.push(fall);
        if (t % 8 === 7) yield;
      }
      // Les plus hautes d'abord, à plus de 220 m l'une de l'autre.
      found.sort((u, v) => v.drop - u.drop);
      const keep: FallPath[] = [];
      const maxF = Math.max(1, Math.round(2 * c.density));
      for (const fl of found) {
        if (keep.length >= maxF) break;
        if (keep.some((k) => Math.hypot(k.pts[0]![0] - fl.pts[0]![0], k.pts[0]![1] - fl.pts[0]![1]) < 220)) continue;
        keep.push(fl);
      }
      if (!keep.length) return;
      const winter = c.season === 'winter';
      const white = new THREE.Color(winter ? '#dfeaf0' : '#f1f6f8');
      const pale = new THREE.Color(winter ? '#bcd3e0' : '#cfdee6');
      const edge = new THREE.Color(winter ? '#a9c4d4' : '#b6cad5');
      const veil: number[] = [];
      const us: number[] = [];
      const vs: number[] = [];
      const feet: Array<[number, number, number]> = [];
      for (const fl of keep) {
        const P = fl.pts;
        const n = P.length;
        // Voies du ruban (gauche, milieu, droite) pour chaque point : largeur 1,8 m en haut, 5 m au pied.
        const rows: Array<Array<[number, number, number]>> = [];
        const lens: number[] = [];
        let len = 0;
        for (let i = 0; i < n; i++) {
          const [px, pz, ph] = P[i]!;
          const q = P[Math.min(n - 1, i + 1)]!;
          const o = P[Math.max(0, i - 1)]!;
          let dx = q[0] - o[0];
          let dz = q[1] - o[1];
          const L = Math.hypot(dx, dz) || 1;
          dx /= L;
          dz /= L;
          const half = (1.8 + (3.2 * i) / (n - 1)) / 2;
          const lx = px - dz * half;
          const lz = pz + dx * half;
          const rx = px + dz * half;
          const rz = pz - dx * half;
          const lh = p.heightAt(lx, lz);
          const rh = p.heightAt(rx, rz);
          const y = Math.max(ph, Number.isFinite(lh) ? lh : ph, Number.isFinite(rh) ? rh : ph) + 0.45;
          rows.push([[lx, y, lz], [px, y + 0.08, pz], [rx, y, rz]]);
          if (i) len += Math.hypot(px - P[i - 1]![0], pz - P[i - 1]![1], ph - P[i - 1]![2]);
          lens.push(len);
        }
        for (let i = 0; i + 1 < n; i++) {
          for (let lane = 0; lane < 2; lane++) {
            const A = rows[i]![lane]!;
            const B = rows[i]![lane + 1]!;
            const C = rows[i + 1]![lane + 1]!;
            const D = rows[i + 1]![lane]!;
            const col = (i + lane * 2) % 4 === 0 ? pale : lane === 0 && i % 3 === 1 ? edge : white;
            c.mesh.triUp(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], col);
            c.mesh.triUp(A[0], A[1], A[2], C[0], C[1], C[2], D[0], D[1], D[2], col);
            if (!winter) {
              const ua = lane - 1;
              const ub = lane;
              for (const [V, uu, vv] of [[A, ua, lens[i]!], [B, ub, lens[i]!], [C, ub, lens[i + 1]!], [A, ua, lens[i]!], [C, ub, lens[i + 1]!], [D, ua, lens[i + 1]!]] as const) {
                veil.push(V[0], V[1] + 0.12, V[2]);
                us.push(uu);
                vs.push(vv);
              }
            }
          }
        }
        // Écume au pied : trois paquets blancs, à fleur d'eau ou sur la grève.
        const [fx, fz, fh] = P[n - 1]!;
        for (let s = 0; s < 3; s++) {
          const a2 = r() * 6.28;
          const d = s ? 2 + r() * 3 : 0;
          const x = fx + Math.cos(a2) * d;
          const z = fz + Math.sin(a2) * d;
          const k = (s ? 0.7 : 1.1) + r() * 0.4;
          if (!fl.water && !offRoad(p, x, z, 2)) continue;
          c.mesh.put(foam(), x, fl.water ? 0.1 : fh - 0.2, z, r() * 6.28, k, k * 0.8, k, winter ? pale : WHITE);
        }
        feet.push([fx, fl.water ? 0.4 : fh + 0.6, fz]);
        yield;
      }
      c.flush();
      if (winter || !veil.length) return;
      const g = new THREE.Group();
      g.name = 'grand-nord-cascades';
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(veil), 3));
      geo.setAttribute('fallU', new THREE.BufferAttribute(new Float32Array(us), 1));
      geo.setAttribute('fallV', new THREE.BufferAttribute(new Float32Array(vs), 1));
      geo.computeBoundingSphere();
      const sheet = new THREE.Mesh(geo, fallMat());
      sheet.castShadow = false;
      sheet.receiveShadow = false;
      g.add(sheet);
      const sprayGeo = new THREE.IcosahedronGeometry(3, 0).scale(1.5, 0.7, 1.5);
      const sprayMat = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false });
      const sprays = feet.map(([x, y, z]) => {
        const m = new THREE.Mesh(sprayGeo, sprayMat);
        m.position.set(x, y + 0.6, z);
        m.castShadow = false;
        g.add(m);
        return m;
      });
      c.moving.push({
        object: g,
        step: (time) => {
          sprays.forEach((m, i) => m.scale.setScalar(1 + Math.sin(time * 2.6 + i * 1.7) * 0.1));
        },
      });
    },
  };
}

function fallSites(): Site[] {
  let foam: Template | undefined;
  const ft = () =>
    (foam ??= template([
      part(rockGeo(1.4, 71, 1.3, 0.5, 1.1, 0, 0.3, 0, 0.3), '#ffffff', 1),
      part(rockGeo(0.9, 72, 1.2, 0.55, 1, 1.4, 0.25, 0.6, 0.3), '#ffffff', 1),
    ]));
  const out: Site[] = [];
  for (const f of FJORD_AXES) {
    const total = lineLength(f.pts);
    for (let s = 300; s < total; s += FALL_STEP) {
      const a = alongLine(f.pts, s);
      if (inMap(a.x, a.z)) out.push(fjordFalls(f, s, total, ft));
    }
  }
  return out;
}

// ───────────────────────────── Jalons à neige des routes de montagne

/**
 * Jalons à neige : piquets orange à bande sombre, de part et d'autre des routes revêtues au-dessus de 200 m (col du
 * Renne, haut-plateau de Vidda, montée de Fjellheim…), tous les 28 m environ. Grille de carrés de 1 500 m. Une vingtaine de triangles par jalon.
 */
const POLE_STEP = 1500;
const POLE_MIN_Y = 200;
const UNPAVED = new Set(['track', 'path', 'footway', 'cycleway', 'bridleway', 'steps', 'service']);
const LOOSE = new Set(['gravel', 'dirt', 'ground', 'unpaved', 'compacted', 'fine_gravel', 'grass', 'earth', 'mud', 'sand']);
let poleTemplate: Template | undefined;
const pole = () =>
  (poleTemplate ??= template([
    part(prism(0.045, 0.04, 0, 1.55, 3), '#e2742a'),
    part(prism(0.05, 0.05, 1.55, 1.8, 3), '#26282a'),
    part(prism(0.045, 0.03, 1.8, 2.1, 3), '#e2742a'),
  ]));

function snowPoles(cx: number, cz: number): Site {
  const half = POLE_STEP / 2;
  return {
    id: `jalons-${cx}-${cz}`,
    x: cx,
    z: cz,
    reach: 1300,
    needs: [[cx, cz]],
    *build(c) {
      const p = c.probe;
      const T = pole();
      const seen = new Set<string>();
      let n = 0;
      const max = Math.round(500 * Math.max(0.5, c.density));
      // Copie : tilesIn rend un tableau partagé, que buildingNear réutilise.
      for (const t of [...p.tilesIn(cx - half, cz - half, cx + half, cz + half)]) {
        for (const road of t.features.roads) {
          if (n >= max) break;
          if (road.tunnel || road.bridge || UNPAVED.has(road.kind) || (road.surface && LOOSE.has(road.surface))) continue;
          const key = `${road.id ?? ''}:${road.pts[0]}:${road.pts[1]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const off = Math.max(road.width, 3) / 2 + 1.4;
          let carry = 14;
          let side = 1;
          for (let i = 0; i + 3 < road.pts.length && n < max; i += 2) {
            const ax = road.pts[i]!;
            const az = road.pts[i + 1]!;
            const bx = road.pts[i + 2]!;
            const bz = road.pts[i + 3]!;
            const L = Math.hypot(bx - ax, bz - az);
            if (L < 0.01) continue;
            const dx = (bx - ax) / L;
            const dz = (bz - az) / L;
            let s = carry;
            for (; s < L; s += 28) {
              const x0 = ax + dx * s;
              const z0 = az + dz * s;
              side = -side;
              if (Math.abs(x0 - cx) > half || Math.abs(z0 - cz) > half || !inMap(x0, z0)) continue;
              const x = x0 - dz * off * side;
              const z = z0 + dx * off * side;
              const y = p.heightAt(x, z);
              if (!Number.isFinite(y) || y < POLE_MIN_Y || !offRoad(p, x, z, 0.6) || p.buildingNear(x, z, 3)) continue;
              // Ni dans les rues des villages d'altitude, ni autour du Circuit.
              if (!p.read(x, z) || p.urban > 0.2 || (Math.abs(x - RING.x) < RING.half + 80 && Math.abs(z - RING.z) < RING.radius + 80)) continue;
              c.mesh.put(T, x, y - 0.05, z, 0, 1, 1, 1, WHITE);
              n++;
            }
            carry = s - L;
          }
          yield;
        }
      }
      c.flush();
    },
  };
}

function poleSites(): Site[] {
  const out: Site[] = [];
  for (let x = -19000 + POLE_STEP / 2; x < 19000; x += POLE_STEP) for (let z = -13000 + POLE_STEP / 2; z < 13000; z += POLE_STEP) out.push(snowPoles(x, z));
  return out;
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
    ...rockSites(),
    ...fallSites(),
    ...poleSites(),
    ...skies,
  ];
}

/** Quais, promenade de Port-Boréal et cales du bac : ni clôtures ni poteaux de campagne. */
export function grandNordNoFence(x: number, z: number): boolean {
  if (Math.hypot(x - PORT_BOREAL.x + 600, z - PORT_BOREAL.z + 400) < 1700) return true;
  for (const q of [SKARVIK, NORDVIK]) if (Math.hypot(x - q.x, z - q.z) < q.halfLen + 120) return true;
  return Math.hypot(x - CALE_A.x, z - CALE_A.z) < 140 || Math.hypot(x - CALE_B.x, z - CALE_B.z) < 140;
}
