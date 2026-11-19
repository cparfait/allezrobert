import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LoadedTile } from './types.ts';

// Centre et orientation des emprises IGN de la Tour Eiffel dans le repère Lambert-93 de Paris.
export const EIFFEL_SITE = { x: 238.1, z: 5744.2, angle: Math.PI / 4 };
const SITE_COMPONENTS = new Set([
  'bdtopo:BATIMENT0000000000162158',
  'bdtopo:BATIMENT0000000000162159',
  'bdtopo:BATIMENT0000000000162160',
  'bdtopo:BATIMENT0000000000162699',
]);

export function ownsEiffelTower(tile: LoadedTile): boolean {
  return (tile.buildingSource?.worldId ?? 'idf-paris') === 'idf-paris'
    && EIFFEL_SITE.x >= tile.x0 && EIFFEL_SITE.x < tile.x0 + tile.size
    && EIFFEL_SITE.z >= tile.z0 && EIFFEL_SITE.z < tile.z0 + tile.size;
}

export function isEiffelSourceBuilding(id?: string): boolean {
  return id !== undefined && SITE_COMPONENTS.has(id);
}

// Hauteurs des plateformes officielles. Les sections de charpente intermédiaires sont stylisées.
const LEG_SECTIONS = [
  [2.2, 50, 12.5], [13, 44.8, 10.8], [25, 39.5, 9.1], [38, 34.4, 7.7],
  [49, 30.5, 6.7], [57, 27.9, 6], [73, 23.3, 5.2], [92, 19.0, 4.2], [115, 15.2, 3.6],
] as const;
const SHAFT_SECTIONS = [
  [115, 16], [139, 13.1], [164, 10.1], [192, 7.9], [223, 5.85], [251, 4.35], [276, 3.45], [300, 2.7],
] as const;
type Point = [number, number, number];
type Section = [Point, Point, Point, Point];

/** Tour d'origine à l'échelle en mètres, en un maillage avec couleurs de sommets. */
export function createEiffelTower() {
  const pieces: THREE.BufferGeometry[] = [];
  const iron = '#735237';
  const darkIron = '#5d4230';
  const warmIron = '#936d45';
  const lightIron = '#a27b4f';
  const stone = '#ada397';
  const glass = '#48636a';
  const red = '#9f4c34';
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  function append(geometry: THREE.BufferGeometry, tint: string) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute('uv');
    const vertices = flat.getAttribute('position').count;
    const RGB = new Float32Array(vertices * 3);
    color.set(tint);
    for (let i = 0; i < vertices; i++) color.toArray(RGB, i * 3);
    flat.setAttribute('color', new THREE.BufferAttribute(RGB, 3));
    pieces.push(flat);
  }

  function box(x: number, y: number, z: number, w: number, h: number, d: number, tint: string) {
    append(new THREE.BoxGeometry(w, h, d).translate(x, y, z), tint);
  }

  function beam(a: Point, b: Point, thickness: number, tint: string) {
    const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const span = axis.length();
    append(new THREE.BoxGeometry(thickness, span, thickness)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.divideScalar(span)))
      .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), tint);
  }

  function section(x: number, y: number, z: number, r: number): Section {
    return [[x-r,y,z-r], [x+r,y,z-r], [x+r,y,z+r], [x-r,y,z+r]];
  }

  function truss(lower: Section, upper: Section, chord: number, brace: number) {
    for (let corner = 0; corner < 4; corner++) {
      const next = (corner + 1) % 4;
      beam(lower[corner]!, upper[corner]!, chord, warmIron);
      beam(lower[corner]!, lower[next]!, chord * .87, darkIron);
      beam(lower[corner]!, upper[next]!, brace, iron);
      beam(lower[next]!, upper[corner]!, brace, darkIron);
    }
  }

  for (const signX of [-1, 1]) for (const signZ of [-1, 1]) {
    box(signX * 50, 1.08, signZ * 50, 25, 2.15, 25, stone);
    for (let i = 1; i < LEG_SECTIONS.length; i++) {
      const [y0, r0, w0] = LEG_SECTIONS[i - 1]!;
      const [y1, r1, w1] = LEG_SECTIONS[i]!;
      const count = 2;
      function at(t: number) {
        const r = THREE.MathUtils.lerp(r0, r1, t);
        return section(signX * r, THREE.MathUtils.lerp(y0, y1, t), signZ * r, THREE.MathUtils.lerp(w0, w1, t));
      }
      for (let j = 0; j < count; j++) truss(at(j / count), at((j + 1) / count), w0 * .15, w0 * .081);
    }
  }

  for (let i = 1; i < SHAFT_SECTIONS.length; i++) {
    const [y0, r0] = SHAFT_SECTIONS[i - 1]!;
    const [y1, r1] = SHAFT_SECTIONS[i]!;
    const count = i > 4 ? 3 : 4;
    for (let j = 0; j < count; j++) {
      const a = j / count, b = (j + 1) / count;
      truss(section(0, THREE.MathUtils.lerp(y0, y1, a), 0, THREE.MathUtils.lerp(r0, r1, a)),
        section(0, THREE.MathUtils.lerp(y0, y1, b), 0, THREE.MathUtils.lerp(r0, r1, b)),
        Math.max(.32, r0 * .119), Math.max(.15, r0 * .061));
    }
  }

  // Les grandes arches cintrées relient les pieds sans épaissir le vide du premier étage.
  for (const side of [-1, 1]) for (const alongX of [true, false]) {
    const arch = (angle: number, inset: number): Point => {
      const across = (43 - inset) * Math.cos(angle);
      const depth = side * (44 - 12 * Math.sin(angle));
      const y = 8 + (41 - inset) * Math.sin(angle);
      return alongX ? [across, y, depth] : [depth, y, across];
    };
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 16, b = (i + 1) * Math.PI / 16;
      beam(arch(a, 0), arch(b, 0), 1.57, warmIron);
      beam(arch(a, 3), arch(b, 3), .92, darkIron);
      beam(arch(a, 3), arch(b, 0), .56, iron);
    }
  }

  function deckRing(y: number, outer: number, inner: number, height: number, tint: string) {
    const band = outer - inner;
    const offset = inner + band / 2;
    for (const side of [-1, 1]) {
      box(0, y, side * offset, outer * 2, height, band, tint);
      box(side * offset, y, 0, band, height, inner * 2, tint);
    }
  }

  for (const [y, half, fascia] of [[57, 35, 3.4], [115, 19.4, 3.0], [276, 7.9, 2.7]] as const) {
    const hasAtrium = y === 57;
    if (hasAtrium) {
      deckRing(y - fascia / 2, half, 15, fascia, darkIron);
      deckRing(y + .25, half + .55, 14.8, .5, lightIron);
    } else {
      box(0, y - fascia / 2, 0, half * 2, fascia, half * 2, darkIron);
      box(0, y + .25, 0, half * 2 + 1.1, .5, half * 2 + 1.1, lightIron);
    }
    const railing = section(0, y + 1.45, 0, half);
    for (let j = 0; j < 4; j++) {
      const a = railing[j]!, b = railing[(j + 1) % 4]!;
      beam(a, b, .18, warmIron);
      const windows = y === 57 ? 24 : y === 115 ? 16 : 6;
      for (let i = 0; i < windows; i++) {
        const t = (i + .5) / windows;
        const x = THREE.MathUtils.lerp(a[0], b[0], t), z = THREE.MathUtils.lerp(a[2], b[2], t);
        box(x, y + .8, z, .17, 1.34, .17, lightIron);
        const alongX = a[0] !== b[0];
        box(alongX ? x : Math.sign(x) * (half + .12), y - fascia * .52, alongX ? Math.sign(z) * (half + .12) : z,
          alongX ? half * .95 / windows : .31, fascia * .79, alongX ? .31 : half * .95 / windows, warmIron);
      }
    }
  }

  // Pavillons du premier et deuxième étages, entre garde-corps et vide central.
  for (const [level, offset, width, depth, height] of [[57, 24, 36, 5.8, 4.7], [115, 12, 22, 4.5, 3.6]] as const) {
    for (const side of [-1, 1]) {
      box(0, level + height / 2 + .48, side * offset, width, height, depth, glass);
      box(0, level + height + .76, side * offset, width + 1.0, .54, depth + .82, red);
      box(0, level + height + .31, side * (offset + depth / 2), width + .4, .45, .42, warmIron);
      for (let i = 0; i < 12; i++) {
        const x = width * ((i + .5) / 12 - .5);
        const z = side * (offset + depth / 2 + .095);
        box(x, level + height / 2 + .48, z, .16, height, .20, darkIron);
      }
    }
  }

  box(0, 283, 0, 10.3, 6, 10.3, iron);
  box(0, 284, 0, 10.5, 1.68, 10.5, glass);
  box(0, 288, 0, 10.6, 1.2, 10.6, warmIron);
  append(new THREE.CylinderGeometry(1.3, 2.7, 7, 12).translate(0, 303.5, 0), iron);
  append(new THREE.CylinderGeometry(.61, 1.25, 19, 10).translate(0, 316.5, 0), darkIron);
  append(new THREE.CylinderGeometry(.20, .47, 4, 8).translate(0, 328, 0), lightIron);

  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!geometry) throw new Error('Géométrie de la Tour Eiffel invalide');
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, flatShading: true, roughness: .88 });
  const tower = new THREE.Mesh(geometry, material);
  tower.name = 'tour-eiffel';
  tower.castShadow = true;
  tower.receiveShadow = true;
  return tower;
}
