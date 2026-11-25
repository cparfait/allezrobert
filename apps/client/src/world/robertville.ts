import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import type { LoadedTile } from './types.ts';
import { box, MeshBuilder, part, prism, template, type LandProbe, type Template } from './lowPolyKit.ts';
import { POLY_SPONSOR_COLS, POLY_SPONSOR_ROWS, polySponsorAtlas, polySponsorUv } from './polySponsors.ts';
import { isBeachCabin } from './robertvilleBuildings.ts';
import { ROBERT_ISLAND } from './worlds.ts';

/**
 * Décor original en primitives, implanté dans le repère de l'île. Chaque secteur part d'un point de l'axe des Planches
 * et de la pente locale dz/dx : `t` court le long de la promenade (vers l'est), `n` va vers la mer. Bord du platelage à
 * 2,6 m, sable dès 13 m, rangées de cabines à 24 m (interrompues en quatre trouées) : ce qui doit se voir en roulant
 * reste devant elles, ou dans une trouée (`open`).
 */
interface Site {
  x: number;
  z: number;
  slope: number;
  open?: boolean;
}
const SITES: readonly Site[] = [
  { x: -369.2, z: 10400.3, slope: -0.396, open: true },
  { x: -250.3, z: 10359, slope: -0.292 },
  { x: -140.1, z: 10322.7, slope: -0.378 },
  { x: -12.6, z: 10275.5, slope: -0.329, open: true },
  { x: 115.7, z: 10245.7, slope: -0.129 },
  { x: 235.9, z: 10225.8, slope: -0.312 },
  { x: 355.3, z: 10165.8, slope: -0.608, open: true },
  { x: 479.8, z: 10102.5, slope: -0.328 },
  { x: 600.1, z: 10087.6, slope: 0.031 },
  { x: 717.4, z: 10099.8, slope: 0.222, open: true },
  { x: 850.9, z: 10134.3, slope: 0.149 },
  { x: 979.6, z: 10124.6, slope: -0.242 },
  { x: 1109.9, z: 10079.9, slope: -0.408 },
  { x: 1240.3, z: 10057.2, slope: 0.102 },
  { x: 1369.2, z: 10073.1, slope: 0.058 },
  { x: 1499.1, z: 10078.8, slope: -0.024, open: true },
];
/** Bassin du port : centre, cap du large, demi-longueur et demi-largeur (tools/island/src/design.ts). */
const HARBOUR = { x: 1783.2, z: 10038.6, dir: 1.395, halfLen: 230, halfWid: 90 } as const;
const BUILD_M = 400;
/** Les mâts du port se voient de loin. */
const HARBOUR_BUILD_M = 720;
const FORGET_EXTRA_M = 120;
const WHITE = new THREE.Color(0xffffff);
const SEA_COLOURS = ['#eb7857', '#f1c461', '#4d9eac', '#4c78a9'].map((colour) => new THREE.Color(colour));
const TOWEL_COLOURS = ['#e2604f', '#f4d35e', '#2f9c95', '#f2f0e6', '#5c6bc0', '#ef8fb0'].map((colour) => new THREE.Color(colour));
const DOOR_COLOURS = ['#7fa9bf', '#f1efe6', '#3f6f8f', '#a9c3b4', '#f1efe6', '#8fb0c4', '#d9cfae'].map((colour) => new THREE.Color(colour));
const BEACH_BY_SEASON = {
  spring: { parasols: 4, towels: 2, grasses: 16, tint: new THREE.Color(0.88, 1, 0.8) },
  summer: { parasols: 9, towels: 10, grasses: 18, tint: WHITE },
  autumn: { parasols: 2, towels: 0, grasses: 20, tint: new THREE.Color(1, 0.78, 0.6) },
  winter: { parasols: 0, towels: 0, grasses: 13, tint: new THREE.Color(0.89, 0.77, 0.65) },
} satisfies Record<Season, { parasols: number; towels: number; grasses: number; tint: THREE.Color }>;

function inRobertville(x: number, z: number): boolean {
  return x >= -1000 && x <= 2600 && z >= 9200 && z <= 11100;
}

export function isRobertville(probe: LandProbe, x: number, z: number): boolean {
  return inRobertville(x, z) && probe.tileAt(x, z)?.buildingSource?.worldId === ROBERT_ISLAND;
}

function umbrella() {
  const pieces = [part(prism(0.024, 0.024, -0.05, 2.15), '#eee1bf')];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const b = (i + 1) * Math.PI / 4;
    const fabric = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
      0, 2.22, 0, Math.cos(b) * 1.45, 1.78, Math.sin(b) * 1.45, Math.cos(a) * 1.45, 1.78, Math.sin(a) * 1.45,
      0, 2.22, 0, Math.cos(a) * 1.45, 1.78, Math.sin(a) * 1.45, Math.cos(b) * 1.45, 1.78, Math.sin(b) * 1.45,
    ], 3));
    pieces.push(part(fabric, i % 2 ? '#f7ebd2' : '#ffffff', i % 2 ? 0 : 1));
  }
  return template(pieces);
}

/** Mât et pavillon. */
const flagPole = () => template([part(prism(0.06, 0.045, -0.4, 7.2, 6), '#e9e6dc'), part(box(0.03, 0.95, 1.5, 0, 6.6, 0.82), '#ffffff', 1)]);

function beachFurniture() {
  return {
    umbrella: umbrella(),
    // Transat et banc : assise vers −z (dossier en +z).
    chair: template([
      part(box(0.63, 0.07, 0.92, 0, 0.33, -0.11), '#ffffff', 1),
      part(box(0.63, 0.06, 0.68).rotateX(-0.55).translate(0, 0.5, 0.62), '#ffffff', 1),
      part(box(0.04, 0.32, 1.22, -0.25, 0.13), '#b08660'),
      part(box(0.04, 0.32, 1.22, 0.25, 0.13), '#b08660'),
    ]),
    grasses: template([
      part(prism(0.2, 0.03, -0.06, 0.62, 3).rotateZ(0.44), '#9ca46b', 1),
      part(prism(0.18, 0.02, -0.06, 0.77, 3).rotateZ(-0.43), '#778651', 1),
      part(prism(0.15, 0.02, -0.06, 0.65, 3).rotateX(0.48), '#a8a56d', 1),
    ]),
    bench: template([
      part(box(1.85, 0.09, 0.46, 0, 0.45), '#a87850'),
      part(box(1.85, 0.32, 0.08, 0, 0.73, 0.23), '#a87850'),
      part(box(0.11, 0.79, 0.34, -0.73, 0.35, 0.12), '#43555d'),
      part(box(0.11, 0.79, 0.34, 0.73, 0.35, 0.12), '#43555d'),
    ]),
    board: template([
      part(box(2.68, 1.31, 0.1, 0, 1.46), '#3d5359'),
      part(box(0.11, 1.48, 0.08, -0.94, 0.74), '#526167'),
      part(box(0.11, 1.48, 0.08, 0.94, 0.74), '#526167'),
    ]),
    towel: template([
      part(box(0.95, 0.025, 1.85, 0, 0.02), '#ffffff', 1),
      part(box(0.95, 0.027, 0.16, 0, 0.021, 0.6), '#f8f4e8'),
      part(box(0.95, 0.027, 0.16, 0, 0.021, -0.6), '#f8f4e8'),
    ]),
    windbreak: template([
      ...[-2, -1, 0, 1, 2].map((i) => part(prism(0.03, 0.03, -0.1, 1.25, 5, i * 0.9), '#b08660')),
      ...[-1.5, -0.5, 0.5, 1.5].map((i, k) => part(box(0.88, 0.95, 0.03, i * 0.9, 0.62), k % 2 ? '#f7ebd2' : '#ffffff', k % 2 ? 0 : 1)),
    ]),
    /** Filet de volley-ball de plage. */
    net: template([
      part(prism(0.06, 0.06, -0.2, 2.5, 6, -4.5), '#8f9699'),
      part(prism(0.06, 0.06, -0.2, 2.5, 6, 4.5), '#8f9699'),
      part(box(9, 0.07, 0.03, 0, 2.4), '#f2f0e6'),
      part(box(9, 0.05, 0.03, 0, 1.55), '#f2f0e6'),
      part(box(9, 0.03, 0.02, 0, 1.97), '#dcd8cc'),
      ...Array.from({ length: 13 }, (_, i) => part(box(0.03, 0.85, 0.02, (i - 6) * 0.72, 1.97), '#dcd8cc')),
    ]),
    /** Lames de caillebotis sur 1 m de chemin de plage. */
    slat: template([-0.36, 0, 0.36].map((z, i) => part(box(1.9, 0.07, 0.3, 0, 0.02, z), ['#a98660', '#b7946c', '#9c7a56'][i]!))),
    ropePost: template([part(prism(0.07, 0.06, -0.3, 0.85, 6), '#7b5c41'), part(box(0.05, 0.05, 2, 0, 0.72, 1), '#d8c9a3')]),
    /** Porte de cabine (avant +z), planches verticales, linteau et marche. */
    cabinDoor: template([
      part(box(0.86, 1.84, 0.04, 0, 1.0, 0.02), '#ffffff', 1),
      ...[-0.21, 0, 0.21].map((x) => part(box(0.02, 1.78, 0.02, x, 1.0, 0.045), '#8d958f')),
      part(box(1, 0.08, 0.07, 0, 1.96, 0.03), '#dfe3e1'),
      part(box(0.05, 0.05, 0.06, 0.32, 0.98, 0.06), '#4a5358'),
      part(box(1.1, 0.14, 0.42, 0, 0.05, 0.22), '#b7946c'),
    ]),
    flag: flagPole(),
    lifebuoy: template([
      part(prism(0.06, 0.06, -0.3, 1.5, 6), '#7b5c41'),
      part(box(0.72, 0.9, 0.06, 0, 1.45), '#f5f3ea'),
      part(new THREE.TorusGeometry(0.25, 0.075, 5, 10).translate(0, 1.45, 0.07), '#e2553f'),
    ]),
    /** Parasols pliés, rangés hors saison. */
    rack: template([
      part(box(2.2, 0.12, 0.9, 0, 0.1), '#8b6a4a'),
      ...[-0.8, -0.4, 0, 0.4, 0.8].map((x, i) => part(prism(0.09, 0.05, 0.15, 1.7, 6, x, (i % 2) * 0.16), ['#eb7857', '#f1c461', '#4d9eac', '#f4ead3', '#4c78a9'][i]!)),
    ]),
  };
}

function harbourFurniture() {
  return {
    boat: template([
      part(prism(0.83, 1.17, -0.23, 0.57, 5).scale(0.98, 1, 2.85), '#ffffff', 1),
      part(prism(1.17, 1.19, 0.57, 0.68, 5).scale(0.98, 1, 2.85), '#f1ece2'),
      part(box(1.22, 0.73, 1.28, 0, 1.0, 0.21), '#e8e1d0'),
      part(box(1.06, 0.29, 0.035, 0, 1.08, 0.87), '#46626b'),
      part(box(1.36, 0.08, 1.44, 0, 1.41, 0.21), '#d9c7a8'),
      part(prism(0.032, 0.023, 1.43, 2.85, 5), '#435961'),
    ]),
    sailboat: template([
      part(prism(0.75, 1.2, -0.3, 0.72, 5).scale(1, 1, 3.4), '#ffffff', 1),
      part(prism(1.2, 1.2, 0.72, 0.82, 5).scale(1, 1, 3.4), '#f3efe4'),
      part(box(1.15, 0.42, 2.2, 0, 1.02, 0.3), '#efe9da'),
      part(box(1.17, 0.14, 1.5, 0, 1.06, 0.35), '#3e5a66'),
      part(prism(0.07, 0.045, 0.8, 11.5, 6, 0, 0.9), '#e9e6dc'),
      part(prism(0.1, 0.1, -1.7, 1.7, 6).rotateX(Math.PI / 2).translate(0, 1.95, -0.9), '#e4ddca'),
      part(box(0.9, 0.05, 0.05, 0, 7.6, 0.9), '#c9c6bc'),
      part(box(0.025, 0.025, 10.9).rotateX(1.32).translate(0, 6.2, 2.25), '#8f9699'),
    ]),
    /** Ponton flottant de 6 m (long : z) et ses pieux. */
    dock: template([
      part(box(2.3, 0.26, 6.05, 0, 0.18), '#735b48'),
      ...Array.from({ length: 11 }, (_, i) => part(box(2.32, 0.09, 0.5, 0, 0.35, (i - 5) * 0.54), i % 4 ? '#a88766' : '#b89974')),
      ...[-1.2, 1.2].map((x) => part(prism(0.14, 0.14, -2.5, 1.5, 6, x, 2.4), '#58483d')),
    ]),
    finger: template([part(box(0.85, 0.2, 5, 0, 0.2), '#735b48'), part(box(0.87, 0.06, 5, 0, 0.33), '#b08f6c')]),
    ramp: template([
      part(box(1.8, 0.12, 9), '#9a7a58'),
      ...[-0.9, 0.9].flatMap((x) => [part(box(0.06, 0.06, 9, x, 0.95), '#e9e6dc'), ...[-4.4, 0, 4.4].map((z) => part(box(0.06, 0.95, 0.06, x, 0.5, z), '#e9e6dc'))]),
    ]),
    /** Mur de quai (long : z, 10 m), dessus à 0, couronnement clair et bitte d'amarrage. */
    quay: template([part(box(2.4, 5.4, 10.1, 0, -2.75), '#8f887b'), part(box(2.7, 0.3, 10.1, 0, -0.1), '#c9c2b1'), part(prism(0.16, 0.2, 0.05, 0.5, 6), '#3a3f44')]),
    crates: template([
      part(box(1.1, 0.7, 0.8, 0, 0.35), '#3f7f8f'),
      part(box(1.1, 0.7, 0.8, 1.2, 0.35, 0.1), '#d9643f'),
      part(box(1.1, 0.7, 0.8, 0.5, 1.05), '#e7c25a'),
      part(box(0.9, 0.45, 0.9, -1.3, 0.22, 0.2), '#7a6a56'),
    ]),
    /** Capitainerie. */
    office: template([
      part(box(7, 3.4, 5, 0, 1.7), '#f2eee2'),
      part(box(7.6, 0.3, 5.6, 0, 3.5), '#2f5d7c'),
      part(box(3, 2.2, 3, -1.2, 4.7), '#f2eee2'),
      part(box(3.1, 0.9, 3.1, -1.2, 4.9), '#4a6f83'),
      part(box(3.5, 0.25, 3.5, -1.2, 5.9), '#2f5d7c'),
      part(box(1.1, 2.2, 0.06, 1.8, 1.1, 2.52), '#2f5d7c'),
      part(box(1.5, 1, 0.06, -0.6, 1.9, 2.52), '#4a6f83'),
      part(box(1.5, 1, 0.06, -2.4, 1.9, 2.52), '#4a6f83'),
      part(prism(0.05, 0.04, 6, 9.5, 6, -1.2), '#e9e6dc'),
    ]),
    beacon: template([
      part(prism(1.5, 1.2, -1, 1.2, 8), '#c9c2b1'),
      part(prism(0.85, 0.65, 1.2, 6.2, 8), '#ffffff', 1),
      part(prism(0.95, 0.95, 6.2, 6.45, 8), '#f2f0e6'),
      part(prism(0.5, 0.5, 6.45, 7.4, 8), '#f6e7a8'),
      part(prism(0.65, 0.05, 7.4, 8.1, 8), '#ffffff', 1),
    ]),
    flag: flagPole(),
  };
}

/** Lots fixes côté mer, indépendants du sens de passage et de l'itinéraire choisi. */
export class RobertvilleScenery {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly mesh = new MeshBuilder();
  private beach?: ReturnType<typeof beachFurniture>;
  private harbour?: ReturnType<typeof harbourFurniture>;
  private adMaterial?: THREE.MeshStandardNodeMaterial;

  constructor(private readonly probe: LandProbe, private readonly material: THREE.Material, private season: Season = 'summer') {
    this.group.name = 'robertville-seafront';
  }

  setSeason(season: Season): void {
    if (this.season === season) return;
    this.season = season;
    for (const [index, mesh] of this.meshes) if (index < SITES.length) this.drop(index, mesh);
  }

  update(x: number, z: number, density: number): void {
    if (!inRobertville(x, z) || density <= 0) {
      this.dispose();
      return;
    }
    this.probe.forget();
    for (let i = 0; i <= SITES.length; i++) {
      const site = SITES[i];
      const { x: cx, z: cz } = site ?? HARBOUR;
      const reach = site ? BUILD_M : HARBOUR_BUILD_M;
      const distance = Math.hypot(x - cx, z - cz);
      const current = this.meshes.get(i);
      if (current) {
        if (distance > reach + FORGET_EXTRA_M) this.drop(i, current);
        else current.castShadow = distance < 130;
        continue;
      }
      if (distance > reach || !(site ? isRobertville(this.probe, cx, cz) : this.harbourReady())) continue;
      this.mesh.reset();
      const advertisement = site ? this.buildBeach(site, i, density) : undefined;
      if (!site) this.buildHarbour();
      const geometry = this.mesh.geometry();
      if (!geometry) continue;
      const object = new THREE.Mesh(geometry, this.material);
      object.name = site ? `robertville-plage-${i}` : 'robertville-port';
      object.receiveShadow = true;
      object.castShadow = distance < 130;
      object.matrixAutoUpdate = false;
      if (advertisement) object.add(advertisement);
      this.group.add(object);
      this.meshes.set(i, object);
      // Un seul lot construit par mise à jour pendant le chargement initial.
      break;
    }
  }

  /** Le bassin est à cheval sur plusieurs tuiles : attendre les quatre coins. */
  private harbourReady(): boolean {
    const { x, z, halfLen, halfWid } = HARBOUR;
    for (const dx of [-halfWid - 30, halfWid + 30]) for (const dz of [-halfLen - 20, halfLen + 40]) if (!isRobertville(this.probe, x + dx, z + dz)) return false;
    return true;
  }

  private buildBeach(site: Site, index: number, density: number): THREE.Mesh | undefined {
    const kit = (this.beach ??= beachFurniture());
    const random = rng(4201 + index * 131);
    const probe = this.probe;
    const k = Math.hypot(1, site.slope);
    const tx = 1 / k;
    const tz = site.slope / k;
    const nx = -tz;
    const nz = tx;
    // x local le long des Planches, z local vers la mer.
    const yaw = Math.atan2(nx, nz);
    const at = (along: number, sea: number): [number, number] => [site.x + tx * along + nx * sea, site.z + tz * along + nz * sea];
    /** Sol libre (ni chaussée, ni eau, ni bâtiment) ; `sand` : sur le sable seulement. */
    const ground = (x: number, z: number, radius: number, sand: boolean): number => {
      if (!probe.read(x, z) || (sand && probe.sand < 0.5) || probe.road > 0.2 || probe.water > 0.2 || probe.buildingNear(x, z, radius)) return NaN;
      const y = probe.heightAt(x, z);
      return y >= 0.18 ? y : NaN;
    };
    const put = (t: Template, along: number, sea: number, turn: number, colour: THREE.Color, radius = 0.7, sand = false, scale = 1): boolean => {
      const [x, z] = at(along, sea);
      const y = ground(x, z, radius, sand);
      if (!Number.isFinite(y)) return false;
      this.mesh.put(t, x, y, z, yaw + turn, scale, scale, scale, colour);
      return true;
    };
    const profile = BEACH_BY_SEASON[this.season];
    const few = density < 0.7 ? 0.5 : 1;

    // Parasols et transats : en ligne devant les cabines, ou sur deux rangs de part et d'autre d'une descente.
    const parasols = Math.round(profile.parasols * (site.open ? 1.6 : 1) * few);
    for (let i = 0; i < parasols; i++) {
      const side = i % 2 ? 1 : -1;
      const rank = site.open ? Math.floor(i / 4) : i - (parasols - 1) / 2;
      const along = site.open ? side * (6.5 + rank * 7 + random() * 1.5) : rank * 6.4 + (random() - 0.5) * 1.4;
      const sea = site.open ? 22 + (i % 4 < 2 ? 0 : 11) + random() * 3 : 17.2 + random() * 1.6;
      const colour = SEA_COLOURS[(index + i) % SEA_COLOURS.length]!;
      if (!put(kit.umbrella, along, sea, random() * Math.PI, colour, 1.6, true)) continue;
      for (const seat of [-0.95, 0.95]) if (seat > 0 || random() < 0.6) put(kit.chair, along + seat, sea - 0.3, Math.PI + (random() - 0.5) * 0.3, colour, 0.6, true);
    }
    // Serviettes et paravents, l'été surtout.
    for (let i = 0; i < Math.round(profile.towels * few); i++) {
      const along = (random() < 0.5 ? -1 : 1) * (5 + random() * 30);
      const sea = site.open ? 18 + random() * 28 : 14.6 + random() * 1.2;
      put(kit.towel, along, sea, (random() - 0.5) * 1.2, TOWEL_COLOURS[(index * 3 + i) % TOWEL_COLOURS.length]!, 1.1, true);
      if (i % 4 === 0) put(kit.windbreak, along + 2.6, sea + 2, (random() - 0.5) * 0.4, TOWEL_COLOURS[(index + i) % TOWEL_COLOURS.length]!, 2, true);
    }
    // Hors saison, parasols pliés et rangés sur leur socle.
    if (!profile.parasols && !site.open) put(kit.rack, 9, 16.5, 0, WHITE, 1.4, true);

    // Bancs tournés vers la mer, au bord des Planches ; oyats à la lisière du sable.
    for (const along of [-14, 14]) put(kit.bench, along, 3.9, Math.PI, WHITE, 1);
    for (let i = 0; i < profile.grasses * Math.min(density, 1) * 1.6; i++) {
      const along = (random() - 0.5) * 78;
      if (site.open && Math.abs(along) < 2) continue;
      put(kit.grasses, along, 11.6 + random() * 3.4, random() * Math.PI * 2, profile.tint, 0.5, false, 0.7 + random() * 0.8);
    }

    if (site.open) {
      // Descente à la plage : caillebotis, lisses de corde, drapeaux, bouée de sauvetage.
      for (let sea = 3.1; sea < 52; sea += 1.08) put(kit.slat, 0, sea, 0, WHITE, 0.9);
      for (let sea = 12.5; sea < 30; sea += 2) for (const side of [-1.25, 1.25]) put(kit.ropePost, side, sea, 0, WHITE, 0.3);
      for (const [i, side] of [-3.2, 3.2].entries()) put(kit.flag, side, 5.4, -0.5, SEA_COLOURS[(index + i) % SEA_COLOURS.length]!, 0.5);
      put(kit.lifebuoy, 2.1, 13.6, Math.PI, WHITE, 0.5);
      if (profile.parasols > 2 && index % 2) put(kit.net, -32, 36, 0.3, WHITE, 4, true);
    }

    this.cabinDoors(site, index, kit.cabinDoor, nx, nz);

    // Affiche à deux faces, lisible dans les deux sens, au bord des Planches.
    for (const along of site.open ? [12, -12, 20] : [26, -26, 32]) {
      const [x, z] = at(along, 5.2);
      const y = ground(x, z, 1.7, false);
      if (!Number.isFinite(y)) continue;
      const facing = Math.atan2(tx * 0.94 - nx * 0.34, tz * 0.94 - nz * 0.34);
      this.mesh.put(kit.board, x, y, z, facing, 1, 1, 1, WHITE);
      return this.advertisement(index * 3, x, y, z, facing);
    }
    return undefined;
  }

  /** Portes des cabines dont ce secteur est le plus proche, côté Planches. */
  private cabinDoors(site: Site, index: number, door: Template, nx: number, nz: number): void {
    const found: Array<{ tile: LoadedTile; i: number }> = [];
    this.probe.buildingsIn(site.x - 130, site.z - 90, site.x + 130, site.z + 120, found);
    for (const { tile, i } of found) {
      const b = tile.features.buildings[i];
      if (!b || !isBeachCabin(b)) continue;
      const [ax, az, bx, bz, cx, cz, dx, dz] = b.pts as [number, number, number, number, number, number, number, number];
      const mx = (ax + bx + cx + dx) / 4;
      const mz = (az + bz + cz + dz) / 4;
      const own = Math.hypot(mx - site.x, mz - site.z);
      if (SITES.some((s, k) => k !== index && (Math.hypot(mx - s.x, mz - s.z) < own || (Math.hypot(mx - s.x, mz - s.z) === own && k < index)))) continue;
      // Façade la plus tournée vers la terre (−n).
      let best: [number, number, number, number] | null = null;
      let score = -Infinity;
      for (const [px, pz, qx, qz] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, dx, dz], [dx, dz, ax, az]] as const) {
        const ex = (px + qx) / 2;
        const ez = (pz + qz) / 2;
        const L = Math.hypot(ex - mx, ez - mz) || 1;
        const ox = (ex - mx) / L;
        const oz = (ez - mz) / L;
        const toLand = -(ox * nx + oz * nz);
        if (toLand > score) {
          score = toLand;
          best = [ex, ez, ox, oz];
        }
      }
      if (!best) continue;
      const [ex, ez, ox, oz] = best;
      const y = Math.min(b.y ?? Infinity, this.probe.heightAt(ex, ez));
      if (Number.isFinite(y)) this.mesh.put(door, ex, y, ez, Math.atan2(ox, oz), 1, 1, 1, DOOR_COLOURS[Math.abs(Math.round(mx / 2.7)) % DOOR_COLOURS.length]!);
    }
  }

  private advertisement(sponsor: number, x: number, y: number, z: number, yaw: number): THREE.Mesh | undefined {
    if (typeof document === 'undefined') return undefined;
    const faces = [0, 1].map((side) => {
      const g = new THREE.PlaneGeometry(2.5, 1.15).translate(0, 1.46, 0.056).rotateY(yaw + side * Math.PI).translate(x, y, z);
      const uv = g.getAttribute('uv');
      const [u, v] = polySponsorUv(sponsor + side);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) / POLY_SPONSOR_COLS, v + uv.getY(i) / POLY_SPONSOR_ROWS);
      return g;
    });
    const geometry = mergeGeometries(faces, false);
    for (const g of faces) g.dispose();
    const material = this.adMaterial ??= new THREE.MeshStandardNodeMaterial({ map: polySponsorAtlas(), roughness: 0.85 });
    const advertisement = new THREE.Mesh(geometry, material);
    advertisement.name = 'robertville-publicite';
    return advertisement;
  }

  /** Port : quais maçonnés, pontons reliés au quai ouest (côté ville), bateaux à quai, capitainerie, feux d'entrée. */
  private buildHarbour(): void {
    const kit = (this.harbour ??= harbourFurniture());
    const { x, z, dir, halfLen, halfWid } = HARBOUR;
    // u : vers le large ; w : vers l'ouest (la ville).
    const ux = Math.cos(dir);
    const uz = Math.sin(dir);
    const at = (u: number, w: number): [number, number] => [x + ux * u - uz * w, z + uz * u + ux * w];
    const alongU = Math.atan2(ux, uz);
    const alongW = Math.atan2(-uz, ux);
    const height = (u: number, w: number) => this.probe.heightAt(...at(u, w));
    const put = (t: Template, u: number, w: number, y: number, yaw: number, colour = WHITE, scale = 1) => {
      const [px, pz] = at(u, w);
      this.mesh.put(t, px, y, pz, yaw, scale, scale, scale, colour);
    };
    const deep = (u: number, w: number) => height(u, w) < -0.6;
    const land = (u: number, w: number) => {
      const h = height(u, w);
      return Number.isFinite(h) && h > 1.2 ? h : NaN;
    };
    // Quais : murs le long des trois côtés, là où la terre est bien derrière.
    for (let u = -halfLen + 5; u < halfLen; u += 10)
      for (const side of [-1, 1]) {
        const y = land(u, side * (halfWid + 8));
        if (Number.isFinite(y)) put(kit.quay, u, side * (halfWid + 0.2), Math.max(2.55, Math.min(y, 3)) + 0.2, alongU);
      }
    for (let w = -halfWid + 5; w < halfWid; w += 10) {
      const y = land(-halfLen - 8, w);
      if (Number.isFinite(y)) put(kit.quay, -halfLen - 0.2, w, Math.max(2.55, Math.min(y, 3)) + 0.2, alongW);
    }
    const random = rng(90817);
    for (const [line, u] of [-165, -105, -45, 15, 75].entries()) {
      if (!deep(u, 60)) continue;
      // Passerelle du quai au ponton flottant : +z local vers l'ouest et vers le haut.
      const [rx, rz] = at(u, halfWid - 4.6);
      const pitch = Math.atan2(2.2, 8.7);
      const c = Math.cos(pitch);
      const s = Math.sin(pitch);
      this.mesh.putBasis(kit.ramp, rx, 1.6, rz, ux, 0, uz, uz * s, c, -ux * s, -uz * c, s, ux * c, 1, 1, 1);
      for (let w = halfWid - 12; w > halfWid - 68; w -= 6) if (deep(u, w)) put(kit.dock, u, w, 0, alongW);
      for (let i = 0; i < 9; i++) {
        const w = halfWid - 15 - i * 6;
        for (const side of [-1, 1]) {
          if (!deep(u + side * 8, w)) continue;
          if (i % 2 === 0) put(kit.finger, u + side * 3.6, w + 3, 0, alongU);
          if (random() < 0.2) continue;
          const sail = random() < 0.45;
          const yaw = alongU + (side > 0 ? Math.PI : 0) + (random() - 0.5) * 0.06;
          put(sail ? kit.sailboat : kit.boat, u + side * (sail ? 6.2 : 5.1), w, 0, yaw, random() < 0.4 ? WHITE : SEA_COLOURS[(i + line) % SEA_COLOURS.length]!, sail ? 1 : 0.9 + random() * 0.25);
        }
      }
    }
    // Quai ouest : capitainerie, caisses, drapeaux.
    const office = land(-30, halfWid + 14);
    if (Number.isFinite(office)) put(kit.office, -30, halfWid + 14, office - 0.1, alongW);
    for (const [i, u] of [-150, -85, 40, 95].entries()) {
      const y = land(u, halfWid + 6);
      if (Number.isFinite(y)) put(kit.crates, u, halfWid + 6, y, alongU + i);
    }
    for (const [i, u] of [-130, -60, 0, 60].entries()) {
      const y = land(u, halfWid + 5);
      if (Number.isFinite(y)) put(kit.flag, u, halfWid + 5, y, alongU, SEA_COLOURS[i]!);
    }
    // Feux d'entrée, au bout des deux quais.
    for (const [side, colour] of [[-1, '#d2433b'], [1, '#2f8f5b']] as const) {
      const y = land(halfLen + 25, side * (halfWid + 10));
      if (Number.isFinite(y)) put(kit.beacon, halfLen + 25, side * (halfWid + 10), y, 0, new THREE.Color(colour));
    }
  }

  private drop(index: number, mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    for (const child of mesh.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    mesh.geometry.dispose();
    this.meshes.delete(index);
  }

  dispose(): void {
    for (const [index, mesh] of this.meshes) this.drop(index, mesh);
    this.adMaterial?.dispose();
    this.adMaterial = undefined;
  }
}
