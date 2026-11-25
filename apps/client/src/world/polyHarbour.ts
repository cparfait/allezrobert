import * as THREE from 'three/webgpu';
import { rng } from '../engine/noise.ts';
import { box, part, prism, template, type MeshBuilder, type LandProbe, type Template } from './lowPolyKit.ts';

/**
 * Ports de l'île (mode Poly) : quais maçonnés autour du bassin, pontons reliés par passerelle, bateaux à quai, matériel
 * de quai et feux d'entrée. Mêmes cotes que tools/island/src/design.ts (bassin à −3 m, quais à 2,5 m).
 */
export interface HarbourSite {
  x: number;
  z: number;
  /** Cap du large. */
  dir: number;
  halfLen: number;
  halfWid: number;
  /** Côté des pontons et de la capitainerie : +1 ou −1 (axe w). */
  side: 1 | -1;
  /** Position des pontons le long du bassin. */
  lines: readonly number[];
  /** Recul de la capitainerie derrière le bord du quai (au-delà de la chaussée du quai). */
  officeW: number;
  officeU: number;
  /** Part de voiliers ; le reste : vedettes, ou chalutiers pour un port de pêche. */
  sail: number;
  fishing: boolean;
  hulls: readonly string[];
}

export const ROBERTVILLE_HARBOUR: HarbourSite = {
  x: 1783.2, z: 10038.6, dir: 1.395, halfLen: 230, halfWid: 90, side: 1, lines: [-165, -105, -45, 15, 75], officeW: 28, officeU: -105, sail: 0.45, fishing: false,
  hulls: ['#eb7857', '#f1c461', '#4d9eac', '#4c78a9'],
};
export const KERBROU_HARBOUR: HarbourSite = {
  x: -1849.8, z: -10211.4, dir: -1.75, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 30, officeU: -118, sail: 0.2, fishing: true,
  hulls: ['#2f6fa6', '#c9503a', '#3f8a5e', '#2d4b78', '#e0a63c'],
};

/** Quais des ports : ni clôtures de pré, ni haies, ni poteaux. */
export function onQuay(x: number, z: number): boolean {
  return [ROBERTVILLE_HARBOUR, KERBROU_HARBOUR].some((h) => {
    const dx = x - h.x;
    const dz = z - h.z;
    const u = dx * Math.cos(h.dir) + dz * Math.sin(h.dir);
    const w = -dx * Math.sin(h.dir) + dz * Math.cos(h.dir);
    return Math.abs(w) < h.halfWid + 42 && u > -h.halfLen - 40 && u < h.halfLen + 60;
  });
}

const WHITE = new THREE.Color(0xffffff);
const flagPole = () => template([part(prism(0.06, 0.045, -0.2, 7.2, 6), '#e9e6dc'), part(box(0.03, 0.95, 1.5, 0, 6.6, 0.82), '#ffffff', 1)]);

export function harbourTemplates() {
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
    /** Chalutier : étrave haute, timonerie à l'arrière, portique et filets. */
    trawler: template([
      part(prism(1.0, 1.55, -0.4, 0.95, 6).scale(1, 1, 3), '#ffffff', 1),
      part(prism(1.55, 1.62, 0.95, 1.2, 6).scale(1, 1, 3), '#f3efe4'),
      part(box(1.9, 1.9, 1.9, 0, 2.05, -1.9), '#f5f3ea'),
      part(box(1.92, 0.55, 1.5, 0, 2.5, -1.8), '#3e5a66'),
      part(box(2.2, 0.16, 2.2, 0, 3.08, -1.9), '#ffffff', 1),
      part(prism(0.07, 0.05, 1.2, 6.4, 6, 0, 0.6), '#d9a441'),
      part(box(0.07, 0.07, 3.2).rotateX(0.5).translate(0, 4.4, 1.9), '#d9a441'),
      part(box(1.8, 0.1, 0.1, 0, 3.4, -4.1), '#d9a441'),
      ...[-0.9, 0.9].map((x) => part(box(0.1, 2.3, 0.1, x, 2.25, -4.1), '#d9a441')),
      part(new THREE.IcosahedronGeometry(0.55, 0).scale(1.3, 0.6, 1).translate(0, 1.35, 2.2), '#3f7f6a'),
      part(new THREE.IcosahedronGeometry(0.22, 0).translate(0.6, 1.5, 1.3), '#e2753a'),
    ]),
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
    /** Casiers et filets en tas, bouées. */
    pots: template([
      ...[[0, 0, 0], [0.75, 0, 0.1], [0.35, 0.45, 0.05], [-0.7, 0, 0.3]].map(([x, y, z], i) => part(box(0.65, 0.42, 0.5, x!, 0.22 + y!, z!), i % 2 ? '#6b7f5a' : '#8a6f4d')),
      part(new THREE.IcosahedronGeometry(0.7, 0).scale(1.2, 0.5, 1).translate(0.2, 0.25, -1.3), '#4f8f7c'),
      ...[[1.3, -0.8], [1.5, -0.3], [-0.9, -1]].map(([x, z], i) => part(new THREE.IcosahedronGeometry(0.2, 0).translate(x!, 0.2, z!), i % 2 ? '#f2f0e6' : '#e2753a')),
    ]),
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
    /** Criée : longue halle basse ouverte sur le quai. */
    fishHall: template([
      part(box(16, 0.3, 8, 0, 0.1), '#b9b2a4'),
      ...[-7.5, -3.75, 0, 3.75, 7.5].flatMap((x) => [-3.6, 3.6].map((z) => part(box(0.3, 3.4, 0.3, x, 1.9, z), '#2f5d7c'))),
      part(box(16.8, 0.3, 9, 0, 3.7), '#e9e6dc'),
      part(new THREE.CylinderGeometry(0.01, 5, 1.6, 4, 1).rotateY(Math.PI / 4).scale(2.36, 1, 1.26).translate(0, 4.6, 0), '#4a7a9a'),
      part(box(16, 3, 0.2, 0, 1.7, -3.7), '#f2f0e6'),
      ...[-5.5, -2, 1.5, 5].map((x, i) => part(box(2.2, 0.8, 1, x, 0.65, 0.8), i % 2 ? '#8fb7c9' : '#dfe6e8')),
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
export type HarbourTemplates = ReturnType<typeof harbourTemplates>;

/** Les coins du bassin (marge comprise), à attendre avant de construire. */
export function harbourCorners(h: HarbourSite): Array<[number, number]> {
  const ux = Math.cos(h.dir);
  const uz = Math.sin(h.dir);
  return [-h.halfLen - 20, h.halfLen + 40].flatMap((u) => [-h.halfWid - 30, h.halfWid + 30].map((w) => [h.x + ux * u - uz * w, h.z + uz * u + ux * w] as [number, number]));
}

/** Par pas : un ponton à la fois. */
export function* buildHarbour(mesh: MeshBuilder, probe: LandProbe, kit: HarbourTemplates, h: HarbourSite): Generator<void> {
  const { halfLen, halfWid, side } = h;
  // u : vers le large ; w : en travers.
  const ux = Math.cos(h.dir);
  const uz = Math.sin(h.dir);
  const at = (u: number, w: number): [number, number] => [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
  const alongU = Math.atan2(ux, uz);
  const alongW = Math.atan2(-uz * side, ux * side);
  const height = (u: number, w: number) => probe.heightAt(...at(u, w));
  const put = (t: Template, u: number, w: number, y: number, yaw: number, colour = WHITE, scale = 1) => {
    const [px, pz] = at(u, w);
    mesh.put(t, px, y, pz, yaw, scale, scale, scale, colour);
  };
  const hulls = h.hulls.map((c) => new THREE.Color(c));
  const deep = (u: number, w: number) => height(u, w) < -0.6;
  const land = (u: number, w: number) => {
    const y = height(u, w);
    return Number.isFinite(y) && y > 1.2 ? y : NaN;
  };
  /** Sol libre du quai : ni chaussée, ni maison. */
  const free = (u: number, w: number, r: number) => {
    const [px, pz] = at(u, w);
    const y = land(u, w);
    return probe.read(px, pz) && probe.road < 0.2 && !probe.buildingNear(px, pz, r) ? y : NaN;
  };
  // Quais : murs le long des trois côtés, là où la terre est bien derrière.
  for (let u = -halfLen + 5; u < halfLen; u += 10)
    for (const s of [-1, 1]) {
      const y = land(u, s * (halfWid + 8));
      if (Number.isFinite(y)) put(kit.quay, u, s * (halfWid + 0.2), Math.max(2.55, Math.min(y, 3)) + 0.2, alongU);
    }
  for (let w = -halfWid + 5; w < halfWid; w += 10) {
    const y = land(-halfLen - 8, w);
    if (Number.isFinite(y)) put(kit.quay, -halfLen - 0.2, w, Math.max(2.55, Math.min(y, 3)) + 0.2, Math.atan2(-uz, ux));
  }
  yield;
  const random = rng(90817 + Math.round(h.x));
  const pier = Math.min(60, halfWid - 16);
  for (const [line, u] of h.lines.entries()) {
    yield;
    if (!deep(u, side * (halfWid - 30))) continue;
    // Passerelle du quai au ponton flottant : +z local vers le quai et vers le haut.
    const [rx, rz] = at(u, side * (halfWid - 4.6));
    const pitch = Math.atan2(2.2, 8.7);
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const wx = -uz * side;
    const wz = ux * side;
    // base directe : x local = y × z local
    mesh.putBasis(kit.ramp, rx, 1.6, rz, wz, 0, -wx, -wx * s, c, -wz * s, wx * c, s, wz * c, 1, 1, 1);
    for (let w = halfWid - 12; w > halfWid - 8 - pier; w -= 6) if (deep(u, side * w)) put(kit.dock, u, side * w, 0, alongW);
    const berths = Math.floor(pier / 6) - 1;
    for (let i = 0; i < berths; i++) {
      const w = halfWid - 15 - i * 6;
      for (const s2 of [-1, 1]) {
        if (!deep(u + s2 * 8, side * w)) continue;
        if (i % 2 === 0) put(kit.finger, u + s2 * 3.6, side * (w + 3), 0, alongU);
        if (random() < 0.2) continue;
        const sail = random() < h.sail;
        const trawler = !sail && h.fishing;
        const yaw = alongU + (s2 > 0 ? Math.PI : 0) + (random() - 0.5) * 0.06;
        const colour = random() < 0.3 ? WHITE : hulls[(i + line) % hulls.length]!;
        put(sail ? kit.sailboat : trawler ? kit.trawler : kit.boat, u + s2 * (sail || trawler ? 6.2 : 5.1), side * w, 0, yaw, colour, sail || trawler ? 1 : 0.9 + random() * 0.25);
        if (trawler) i += s2 > 0 ? 1 : 0; // un chalutier prend deux places
      }
    }
  }
  yield;
  // Quai : capitainerie ou criée, caisses, casiers, drapeaux.
  const oy = free(h.officeU, side * (halfWid + h.officeW), 5);
  if (Number.isFinite(oy)) put(h.fishing ? kit.fishHall : kit.office, h.officeU, side * (halfWid + h.officeW), oy - 0.1, Math.atan2(uz * side, -ux * side));
  for (let u = -halfLen + 20, i = 0; u < halfLen - 30; u += 26 + random() * 14, i++) {
    const w = side * (halfWid + 5 + random() * 2);
    const y = free(u, w, 1.5);
    if (!Number.isFinite(y)) continue;
    if (i % 4 === 3) put(kit.flag, u, w, y, alongU, hulls[i % hulls.length]!);
    else put(h.fishing || i % 2 ? kit.pots : kit.crates, u, w, y, alongU + random() * 3);
  }
  // Feux d'entrée, au bout des deux quais.
  for (const [s, colour] of [[-side, '#d2433b'], [side, '#2f8f5b']] as const) {
    const y = land(halfLen + 25, s * (halfWid + 10));
    if (Number.isFinite(y)) put(kit.beacon, halfLen + 25, s * (halfWid + 10), y, 0, new THREE.Color(colour));
  }
}
