import * as THREE from 'three/webgpu';
import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import { box, MeshBuilder, part, prism, template, type LandProbe } from './lowPolyKit.ts';
import { POLY_SPONSOR_COLS, POLY_SPONSOR_ROWS, polySponsorAtlas, polySponsorUv } from './polySponsors.ts';
import { ROBERT_ISLAND } from './worlds.ts';

/** Décor original en primitives, implanté dans le repère de l'île. +Z donne vers la mer. */
const BEACH = [
  [-270, 10394, -0.32], [-110, 10341, -0.3], [135, 10273, -0.12],
  [370, 10190, -0.5], [600, 10118, -0.07], [815, 10159, 0.28],
  [1075, 10127, -0.43], [1255, 10089, 0.12], [1460, 10109, -0.08],
] as const;
const HARBOUR = [1783, 10083] as const;
const PANELS = [[24, -4], [-24, -4], [24, 9], [-24, 9], [25, 19], [-25, 19]] as const;
const BUILD_M = 380;
const FORGET_M = 500;
const WHITE = new THREE.Color(0xffffff);
const SEA_COLOURS = ['#eb7857', '#f1c461', '#4d9eac', '#4c78a9'].map((colour) => new THREE.Color(colour));
const BEACH_BY_SEASON = {
  spring: { chairs: 2, grasses: 12, tint: new THREE.Color(0.88, 1, 0.8) },
  summer: { chairs: 5, grasses: 14, tint: WHITE },
  autumn: { chairs: 1, grasses: 16, tint: new THREE.Color(1, 0.78, 0.6) },
  winter: { chairs: 0, grasses: 10, tint: new THREE.Color(0.89, 0.77, 0.65) },
} satisfies Record<Season, { chairs: number; grasses: number; tint: THREE.Color }>;

function inRobertville(x: number, z: number): boolean {
  return x >= -850 && x <= 2400 && z >= 9400 && z <= 11100;
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

function beachFurniture() {
  return {
    umbrella: umbrella(),
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
      part(box(0.11, 1.48, 0.13, -0.94, 0.74), '#526167'),
      part(box(0.11, 1.48, 0.13, 0.94, 0.74), '#526167'),
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
    dock: template([
      part(box(1.9, 0.26, 13.1, 0, 0.18), '#735b48'),
      ...Array.from({ length: 24 }, (_, i) => part(box(1.92, 0.09, 0.5, 0, 0.35, (i - 11.5) * 0.54), i % 4 ? '#a88766' : '#b89974')),
      ...[-0.82, 0.82].flatMap((x) => [-6, 0, 6].map((z) => part(prism(0.11, 0.11, -0.7, 0.96, 5, x, z), '#58483d'))),
    ]),
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
    for (const [index, mesh] of this.meshes) if (index < BEACH.length) this.drop(index, mesh);
  }

  update(x: number, z: number, density: number): void {
    if (!inRobertville(x, z) || density <= 0) {
      this.dispose();
      return;
    }
    this.probe.forget();
    for (let i = 0; i <= BEACH.length; i++) {
      const [cx, cz] = BEACH[i] ?? HARBOUR;
      const distance = Math.hypot(x - cx, z - cz);
      const current = this.meshes.get(i);
      if (current) {
        if (distance > FORGET_M) this.drop(i, current);
        else current.castShadow = distance < 110;
        continue;
      }
      if (distance > BUILD_M || !isRobertville(this.probe, cx, cz)) continue;
      this.mesh.reset();
      const site = BEACH[i];
      const advertisement = site ? this.buildBeach(site, i, density) : undefined;
      if (!site) this.buildHarbour();
      const geometry = this.mesh.geometry();
      if (!geometry) continue;
      const object = new THREE.Mesh(geometry, this.material);
      object.name = site ? `robertville-plage-${i}` : 'robertville-port';
      object.receiveShadow = true;
      object.castShadow = distance < 110;
      object.matrixAutoUpdate = false;
      if (advertisement) object.add(advertisement);
      this.group.add(object);
      this.meshes.set(i, object);
      // Un seul lot construit par mise à jour pendant le chargement initial.
      break;
    }
  }

  private buildBeach([cx, cz, slope]: (typeof BEACH)[number], index: number, density: number): THREE.Mesh | undefined {
    const { umbrella, chair, grasses, bench, board } = this.beach ??= beachFurniture();
    const random = rng(4201 + index * 131);
    const probe = this.probe;
    const beachY = (x: number, z: number, radius: number): number => {
      if (!probe.read(x, z) || probe.sand < 0.5 || probe.road > 0.2 || probe.water > 0.2 || probe.buildingNear(x, z, radius)) return NaN;
      const y = probe.heightAt(x, z);
      return y >= 0.18 ? y : NaN;
    };
    const profile = BEACH_BY_SEASON[this.season];
    const umbrellas = density < 0.7 ? Math.min(profile.chairs, 3) : profile.chairs;
    for (let i = 0; i < umbrellas; i++) {
      const dx = (i - (umbrellas - 1) / 2) * 5.9;
      const x = cx + dx;
      const z = cz + dx * slope + 6 + random() * 5;
      const y = beachY(x, z, 2);
      if (!Number.isFinite(y)) continue;
      const colour = SEA_COLOURS[(index + i) % SEA_COLOURS.length]!;
      this.mesh.put(umbrella, x, y, z, random() * Math.PI, 1, 1, 1, colour);
      const seatZ = z - 0.45;
      const seatX = x + 0.68;
      const seatY = beachY(seatX, seatZ, 0.65);
      if (Number.isFinite(seatY)) this.mesh.put(chair, seatX, seatY, seatZ, 0.1, 1, 1, 1, colour);
    }
    const benchY = beachY(cx, cz - 6, 1.2);
    if (Number.isFinite(benchY)) this.mesh.put(bench, cx, benchY, cz - 6, -Math.atan(slope), 1, 1, 1, WHITE);
    for (let i = 0; i < profile.grasses * Math.min(density, 1); i++) {
      const dx = (random() - 0.5) * 62;
      const x = cx + dx;
      const z = cz + dx * slope - 5 + random() * 7;
      const y = beachY(x, z, 0.7);
      if (!Number.isFinite(y)) continue;
      const scale = 0.65 + random() * 0.8;
      this.mesh.put(grasses, x, y, z, random() * Math.PI * 2, scale, scale, scale, profile.tint);
    }
    // Un panneau orienté vers les Planches, à côté de chaque groupe et hors de la chaussée.
    for (const [dx, dz] of PANELS) {
      const x = cx + dx;
      const z = cz + dx * slope + dz;
      const y = beachY(x, z, 1.8);
      if (!Number.isFinite(y)) continue;
      const yaw = Math.PI - Math.atan(slope) + (index % 2 ? 0.32 : -0.32);
      this.mesh.put(board, x, y, z, yaw, 1, 1, 1, WHITE);
      return this.advertisement(index * 3, x, y, z, yaw);
    }
    return undefined;
  }

  private advertisement(sponsor: number, x: number, y: number, z: number, yaw: number): THREE.Mesh | undefined {
    if (typeof document === 'undefined') return undefined;
    const geometry = new THREE.PlaneGeometry(2.5, 1.15).translate(0, 1.46, 0.052).rotateY(yaw).translate(x, y, z);
    const uv = geometry.getAttribute('uv');
    const [u, v] = polySponsorUv(sponsor);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) / POLY_SPONSOR_COLS, v + uv.getY(i) / POLY_SPONSOR_ROWS);
    const material = this.adMaterial ??= new THREE.MeshStandardNodeMaterial({ map: polySponsorAtlas(), roughness: 0.85 });
    const advertisement = new THREE.Mesh(geometry, material);
    advertisement.name = 'robertville-publicite';
    return advertisement;
  }

  private buildHarbour(): void {
    const { dock, boat } = this.harbour ??= harbourFurniture();
    for (const [i, x] of [1738, 1780, 1822, 1864].entries()) {
      const z = 10077 + (i % 2) * 10;
      if (this.probe.heightAt(x, z - 7) > -0.4 || this.probe.heightAt(x, z + 7) > -0.4) continue;
      this.mesh.put(dock, x, 0, z, 0.1, 1, 1, 1, WHITE);
      for (const side of [-1, 1]) {
        const berth = x + side * 2.9;
        if (!(this.probe.heightAt(berth, z) < -0.4)) continue;
        this.mesh.put(boat, berth, 0, z + side * 2.5, side === -1 ? 0.1 : Math.PI + 0.1, 1, 1, 1, SEA_COLOURS[i]!);
      }
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
