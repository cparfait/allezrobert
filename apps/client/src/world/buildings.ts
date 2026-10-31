import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { attribute, frontFacing, uv, fract, floor, step, mix, vec2, vec3, float, int, uniform, uniformArray, mx_noise_float, positionWorld, smoothstep, max, min, abs, hash, normalWorld, normalMap, fwidth } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { setFlatNormals } from './flatNormals.ts';
import { ARCHETYPES, pickArchetype, worldStyle, type Archetype, type WallMaterial, type WorldStyle } from '@allezrobert/shared';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile, TileRoad } from './types.ts';
import { orientedBox, planRoof, roofBuffers, flatRoof, ridgeLine, roofEdge } from './roofs.ts';
import { meuliere } from './meuliere.ts';
import { FootprintIndex } from './footprints.ts';
import { wallGroundOffset } from './facadeGround.ts';
import { flatRoofKind, leanSide, LEAN_PITCH } from './flatRoofs.ts';
import { eaveHeight } from './eaveHeight.ts';
import { genoiseDrop, genoiseRows } from './genoise.ts';
import { LazyTexture } from '../engine/textures.ts';
import { createLowPolyBuildingMaterial } from './buildingsLowPoly.ts';

/** Textures photo CC0 (Poly Haven) des façades et toits, chargées une fois et partagées. */
function loadTex(dir: string, file: string, srgb: boolean): LazyTexture {
  return new LazyTexture(`/assets/textures/${dir}/${file}`, {
    wrap: THREE.RepeatWrapping,
    anisotropy: 8,
    ...(srgb ? { colorSpace: THREE.SRGBColorSpace } : {}),
  });
}
const pbr = (dir: string) => ({ map: loadTex(dir, 'diffuse.jpg', true), normal: loadTex(dir, 'nor_gl.jpg', false) });
const BUILDING_TEXTURES = {
  render: pbr('painted_plaster_wall'),
  stone: pbr('plaster_stone_wall_01'),
  brick: pbr('brick_wall_09'),
  tiles: pbr('clay_roof_tiles'),
  slate: pbr('grey_roof_tiles_02'),
};

/**
 * Bâti d'Île-de-France rurale (voir ART_DIRECTION.md) : enduits clairs et meulière ocre,
 * soubassement plus sombre, fenêtres à encadrement clair et volets colorés, tuile plate
 * brun-rouge en rangs serrés, ardoise pour les églises et les toits à la Mansart.
 */
const RENDERS = LOW_POLY ? ['#f6e7c1', '#f3cfa6', '#f2d9d0', '#faf4e6', '#f4dc8e', '#dcebc8', '#cfe1ee'] : ['#e8dfcf', '#e2d6c0', '#d9ccb2', '#efe7d8', '#d6c3a0'];
const MEULIERE = LOW_POLY ? ['#dfae74', '#d49f66', '#e7bd86'] : ['#b8936a', '#a98660', '#c29f74'];
/** Pierre locale des bâtiments BD TOPO hors Île-de-France (arkose, granite) : gris-beige. */
const STONE_LOCAL = LOW_POLY ? ['#ddd0b2', '#d3c4a3', '#e6dabe', '#cbbd9f'] : ['#b3a68f', '#a89a84', '#bcae95', '#9f937f'];
const BRICK = LOW_POLY ? '#c65a3e' : '#a8624a';
const ROOFS = LOW_POLY ? ['#c4432e', '#b53d2b', '#cf5636', '#a83f2e', '#9c4a33', '#d4663e'] : ['#8a4a35', '#7d4331', '#94553d', '#6f3f30', '#86513c', '#7a4a3a'];
const SLATE = LOW_POLY ? '#4d5f7a' : '#4f565f';
/** Tuiles mécaniques et canal (BD TOPO « tuiles », hors Île-de-France) : orangé à rouge brique. */
const TERRACOTTA = LOW_POLY ? ['#d4683e', '#c95c36', '#dc7646', '#c2553a', '#d86e44', '#e0804e'] : ['#a87a6a', '#9d7062', '#b18574', '#94695c', '#a67d6e', '#b38a78'];
/** Tuile mécanique des villes (archétype à toit de zinc mais BD TOPO « tuiles ») : rouge brique. */
const MECHANICAL_TILES = LOW_POLY ? ['#c4482f', '#b8402c', '#cc5536', '#b04a32'] : ['#9a5a40', '#8c5038', '#a0614a', '#94553d'];
/** Bac acier et fibrociment : gris clair à gris-vert, parfois vert ou brun. */
const METAL_ROOFS = LOW_POLY ? ['#a3adb3', '#b4bab9', '#8fa49c', '#6f9a7c', '#b0684c'] : ['#8d9294', '#9da1a0', '#7f8784', '#6f7a72', '#84776a'];
/** Toits-terrasses : gravillons gris-beige, étanchéité bitumée par endroits. */
const TERRACES = LOW_POLY ? ['#b9b4a8', '#c4beb0', '#aeaa9f', '#cbc5b6'] : ['#8e8a82', '#9a948a', '#85817a', '#a09a8e'];
const SHUTTERS = LOW_POLY ? ['#3f86c8', '#4aa05e', '#f4f2ea', '#c9503a', '#2f6fa6', '#8cc7a4', '#e5a532'] : ['#7d8f9b', '#5f7d66', '#e8e4da', '#8a5a3c', '#4b6a8a', '#a7b8a0'];
/**
 * Style local des bâtiments BD TOPO (Limagne, Livradois) : enduits à la chaux ocrés, rosés ou grège,
 * volets bois brun, vert de gris, bleu charrette, lie-de-vin.
 */
const RENDERS_LOCAL = LOW_POLY ? ['#f2d9a6', '#efc795', '#ecd6bc', '#f6e2c0', '#eebf8e', '#f2cbb6', '#f7ecd8'] : ['#d9c4a0', '#d2b48c', '#cdb79e', '#e0cdb0', '#c9a882', '#d9b8a0', '#e3d6c2'];
const SHUTTERS_LOCAL = LOW_POLY ? ['#9a6038', '#6fa58c', '#4f8cb4', '#b8443a', '#f0ebdc', '#3f8a5e', '#d08a3a'] : ['#6b4a35', '#7d8a7a', '#5d7380', '#7e3a33', '#d9d2c2', '#4f6b5a', '#8c6a4a'];

/** Portes des immeubles sans volets (porte cochère) : vert wagon, brun, bleu nuit, noir. */
const DOORS = LOW_POLY ? ['#2f8a5a', '#a8402e', '#2f5aa8', '#c9802a', '#8a3a72'] : ['#3b4a3f', '#4a3a2e', '#2f3a4a', '#2b2a28', '#5a2f2c'];

/**
 * Style jeu vidéo : les palettes des archétypes (packages/shared) et les couleurs OSM sont pensées pour le
 * rendu réaliste ; on les ravive (plus saturées, un peu plus claires) pour rester dans les aplats pastel.
 */
function vivid(c: THREE.Color, sat = 0.18, light = 0.05): THREE.Color {
  if (!LOW_POLY) return c;
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s + sat * (1 - hsl.s)), Math.min(0.92, hsl.l + light));
}

/**
 * Archétypes (packages/shared/src/styles) : indice 1…N dans le shader (0 = style historique), codé
 * dans `binfo.z` (fenêtres + 4 × indice) pour ne pas alourdir les sommets. Paramètres de façade en
 * tableaux d'uniformes : A = (demi-largeur, hauteur des fenêtres, allège, rez-de-chaussée),
 * B = (volets, balcons, bandeaux, petits-bois), C = (encadrement, corniche, 0, 0).
 */
const ARCH_IDS = Object.keys(ARCHETYPES);
const WALL_CODE: Record<WallMaterial, number> = { render: 0, meuliere: 1, brick: 2, rubble: 3, ashlar: 4, concrete: 5 };
const BALCONY_CODE = { none: 0, balconettes: 1, continuous: 2 } as const;
function archParams(): { a: THREE.Vector4[]; b: THREE.Vector4[]; c: THREE.Vector4[] } {
  const a = [new THREE.Vector4()];
  const b = [new THREE.Vector4()];
  const c = [new THREE.Vector4()];
  for (const id of ARCH_IDS) {
    const f = (ARCHETYPES[id] as Archetype).facade;
    a.push(new THREE.Vector4(f.window[0] / 2, f.window[1], f.sillM, f.groundFloorM));
    b.push(new THREE.Vector4((ARCHETYPES[id] as Archetype).shutters.length ? 1 : 0, BALCONY_CODE[f.balconies], f.stringCourses ? 1 : 0, f.glazingBars ? 1 : 0));
    c.push(new THREE.Vector4(f.frameM, f.cornice ? 1 : 0, 0, 0));
  }
  return { a, b, c };
}

/** Façade d'un mur : style local, génoise sous l'égout, porte d'entrée dans une travée. */
interface WallStyle {
  /** Bâtiment BD TOPO : génoise, chaînes d'angle, encadrements de pierre, travées irrégulières. */
  local: boolean;
  /** Mur d'égout (parallèle au faîtage) d'après sa direction : génoise. */
  eave?: (dx: number, dz: number) => boolean;
  /** Abaissement de la génoise sous le haut du mur, pour qu'elle passe sous le pan (voir genoise.ts). */
  genoiseDrop?: number;
  /** Milieu du mur qui reçoit la porte d'entrée (côté rue). */
  door?: [number, number];
  /** Tirage de la travée de la porte (0–1). */
  doorPick?: number;
  /** Pas des travées (m), 3,1 m par défaut. */
  bayM?: number;
  /** Hauteur d'étage d'un archétype (m), codée dans la partie décimale de `facade.y`. */
  floorM?: number;
  /** Mur côté rue (d'après son milieu) : vitrine possible au rez-de-chaussée. */
  street?: (x: number, z: number) => boolean;
  /** Rez-de-chaussée commerçant sur les murs côté rue. */
  shop?: boolean;
}

/** Couleur OSM (« brick », « #c0a080 »…) avec repli si elle n'est pas reconnue. */
function osmColour(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const named: Record<string, string> = { brick: BRICK, stone: MEULIERE[0] as string, white: '#efe7d8', beige: '#d9ccb2', yellow: '#dccb92', grey: '#a3a39e', gray: '#a3a39e', red: BRICK, brown: '#8a6a4a' };
  if (named[value]) return named[value] as string;
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/**
 * Attributs par sommet : couleur de base, type (0 mur, 1 tuile, 2 ardoise, 3 métal), couleur des
 * volets, ornements ; `binfo.z` = fenêtres (0 aveugle, 1 fenêtres, 2 annexe) + 4 × indice d'archétype.
 */
function paint(geo: THREE.BufferGeometry, base: THREE.Color, kind: number, accent: THREE.Color, stones: number, windows: number, arch = 0): void {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const acc = new Float32Array(n * 3);
  const info = new Float32Array(n * 3);
  const z = windows + 4 * arch;
  // Écritures directes : un tableau littéral par sommet (et par attribut) coûtait ≈ 0,6 s de chargement.
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    col[o] = base.r;
    col[o + 1] = base.g;
    col[o + 2] = base.b;
    acc[o] = accent.r;
    acc[o + 1] = accent.g;
    acc[o + 2] = accent.b;
    info[o] = kind;
    info[o + 1] = stones;
    info[o + 2] = z;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('accent', new THREE.BufferAttribute(acc, 3));
  geo.setAttribute('binfo', new THREE.BufferAttribute(info, 3));
  if (!geo.getAttribute('facade')) geo.setAttribute('facade', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.getAttribute('bstyle')) geo.setAttribute('bstyle', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
}

/**
 * Murs extrudés depuis l'emprise réelle. uv = (mètres le long du mur, hauteur au-dessus de la base) ;
 * attribut `facade` = (longueur du mur, nombre de travées de fenêtres + hauteur d'étage ÷ 10 pour
 * un archétype) ; `bstyle` = (style local, hauteur du mur, drapeaux : 1 génoise + 2 côté rue +
 * 4 vitrine, travée de la porte d'entrée + 1 ou 0). Avec `groundAt`, la façade part du sol le plus haut
 * le long de chaque mur (voir facadeGround.ts) : uv.y et la hauteur du mur sont comptés depuis ce sol,
 * uv.y est négatif sur le soubassement découvert. Avec `topAt` (monopentes), le haut de chaque mur suit
 * la hauteur donnée à ses extrémités (au-dessus de la base) au lieu de `height`.
 */
function walls(pts: number[], base: number, height: number, style?: WallStyle, groundAt?: (x: number, z: number) => number, topAt?: (x: number, z: number) => number): THREE.BufferGeometry {
  const bayM = style?.bayM ?? 3.1;
  const floorCode = style?.floorM ? Math.min(style.floorM, 9.99) / 10 : 0;
  const n = pts.length / 2;
  const ccw = polygonArea(pts) > 0;
  const pos: number[] = [];
  const uvs: number[] = [];
  const fac: number[] = [];
  const sty: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ccw ? i : n - 1 - i;
    const b = ccw ? (i + 1) % n : (n - 2 - i + n) % n;
    const ax = pts[a * 2] as number;
    const az = pts[a * 2 + 1] as number;
    const bx = pts[b * 2] as number;
    const bz = pts[b * 2 + 1] as number;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const hA = topAt ? topAt(ax, az) : height;
    const hB = topAt ? topAt(bx, bz) : height;
    const top = base + Math.min(hA, hB);
    const off = groundAt ? wallGroundOffset(ax, az, bx, bz, base, Math.min(hA, hB), groundAt) : 0;
    const h = top - base - off;
    const bays = len >= 2.6 ? Math.max(1, Math.floor((len - 0.6) / bayM)) : 0;
    pos.push(ax, base, az, ax, base + hA, az, bx, base, bz, bx, base, bz, ax, base + hA, az, bx, base + hB, bz);
    uvs.push(0, -off, 0, hA - off, len, -off, len, -off, 0, hA - off, len, hB - off);
    const genoise = style?.local && style.eave?.(bx - ax, bz - az) ? 1 : 0;
    const street = bays > 0 && style?.street?.((ax + bx) / 2, (az + bz) / 2) ? 1 : 0;
    const flags = genoise + 2 * street + (street && style?.shop ? 4 : 0);
    const isDoor = style?.door && bays > 0 && Math.hypot((ax + bx) / 2 - style.door[0], (az + bz) / 2 - style.door[1]) < 0.01;
    const doorBay = isDoor ? 1 + Math.min(bays - 1, Math.floor((style?.doorPick ?? 0.5) * bays)) : 0;
    // Génoise abaissée sous le pan : le shader la peint sous la hauteur du mur `bstyle.y`, ramenée à son haut.
    const drop = genoise ? (style?.genoiseDrop ?? 0) : 0;
    for (let k = 0; k < 6; k++) {
      fac.push(len, bays + floorCode);
      sty.push(style?.local ? 1 : 0, h - drop, flags, doorBay);
    }
    if (genoise) {
      // Génoise : trois rangs en encorbellement (10, 20, 30 cm du bas vers le haut), 14 cm chacun, sous
      // le pan ; face avant (même uv que le mur : le shader y peint les bouts de tuiles) et sous-face.
      // Contour orienté dans le sens positif : l'extérieur est à droite du mur, normale (dz, −dx).
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (const { d, y0, y1 } of genoiseRows(top, drop)) {
        // les rangs dépassent un peu aux extrémités pour se rejoindre aux angles
        const x0 = ax - ux * d + nx * d;
        const z0 = az - uz * d + nz * d;
        const x1 = bx + ux * d + nx * d;
        const z1 = bz + uz * d + nz * d;
        const L = len + 2 * d;
        const v0 = y0 - base - off;
        const v1 = y1 - base - off;
        // face avant
        pos.push(x0, y0, z0, x1, y0, z1, x0, y1, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
        uvs.push(-d, v0, L - d, v0, -d, v1, L - d, v0, L - d, v1, -d, v1);
        // sous-face (du mur à la face avant)
        const wx0 = ax - ux * d;
        const wz0 = az - uz * d;
        const wx1 = bx + ux * d;
        const wz1 = bz + uz * d;
        pos.push(wx0, y0, wz0, x1, y0, z1, x0, y0, z0, wx0, y0, wz0, wx1, y0, wz1, x1, y0, z1);
        uvs.push(-d, v0, L - d, v0, -d, v0, -d, v0, L - d, v0, L - d, v0);
        for (let k = 0; k < 12; k++) {
          fac.push(len, 0);
          sty.push(1, h - drop, 1, 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  g.setAttribute('bstyle', new THREE.Float32BufferAttribute(sty, 4));
  setFlatNormals(g);
  return g;
}

/** Distance (m) d'un point aux voies carrossables proches de l'emprise, ou null s'il n'y en a aucune. */
function roadDistance(pts: number[], roads: TileRoad[]): ((x: number, z: number) => number) | null {
  let cx = 0;
  let cz = 0;
  const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) {
    cx += pts[i] as number;
    cz += pts[i + 1] as number;
  }
  cx /= n;
  cz /= n;
  const near: number[][] = [];
  for (const r of roads) {
    if (r.kind === 'footway' || r.kind === 'path' || r.kind === 'steps') continue;
    for (let i = 0; i < r.pts.length; i += 2)
      if (Math.abs((r.pts[i] as number) - cx) < 60 && Math.abs((r.pts[i + 1] as number) - cz) < 60) {
        near.push(r.pts);
        break;
      }
  }
  if (!near.length) return null;
  return (x: number, z: number) => {
    let best = Infinity;
    for (const l of near)
      for (let i = 0; i + 3 < l.length; i += 2) {
        const ax = l[i] as number;
        const az = l[i + 1] as number;
        const dx = (l[i + 2] as number) - ax;
        const dz = (l[i + 3] as number) - az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
    return best;
  };
}

/**
 * Milieu du mur d'au moins 3 m le plus proche d'une voie (porte d'entrée côté rue), ou null si
 * aucune voie à moins de 40 m.
 */
function streetWall(pts: number[], roads: TileRoad[], dist = roadDistance(pts, roads)): [number, number] | null {
  if (!dist) return null;
  const n = pts.length / 2;
  let best: [number, number] | null = null;
  let bestD = 40;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2] as number;
    const az = pts[i * 2 + 1] as number;
    const bx = pts[((i + 1) % n) * 2] as number;
    const bz = pts[((i + 1) % n) * 2 + 1] as number;
    if (Math.hypot(bx - ax, bz - az) < 3) continue;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const d = dist(mx, mz);
    if (d < bestD) {
      bestD = d;
      best = [mx, mz];
    }
  }
  return best;
}

/** Géométrie Three.js depuis des tableaux position/uv (triangles non indexés). */
function toGeometry(pos: number[], uvs: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  setFlatNormals(g);
  return g;
}

/**
 * Détails de toit d'une maison : faîtage en tuiles rondes (toit à deux pans) et souche de cheminée
 * en meulière ou brique avec son chapeau, posée sur le faîtage. Seulement sur les emprises
 * presque rectangulaires (le faîtage suit alors un axe du rectangle orienté).
 */
function houseDetails(pts: number[], box: ReturnType<typeof orientedBox>, plan: NonNullable<ReturnType<typeof planRoof>>, wallTop: number, pitch: number, roofColour: string, slate: boolean, ridgeShort: boolean, r: () => number, density: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rectangular = Math.abs(polygonArea(pts)) / (4 * box.hl * box.hw) > 0.88;
  if (!rectangular || box.hw < 2) return out;
  const tan = Math.tan((pitch * Math.PI) / 180);
  const ridgeY = wallTop + (plan.tEnd - plan.overhang) * tan;
  const gabled = plan.gables.length > 0;
  // Faîtage : selon la longueur, ou la largeur (faîtage court, pignons sur les grands côtés) ; (vx, vz) le travers.
  const ridge = ridgeLine(box, plan, ridgeShort);
  if (!ridge) return out;
  const ux = ridge.dx;
  const uz = ridge.dz;
  const vx = -uz;
  const vz = ux;
  const ridgeHalf = ridge.half;
  const c = new THREE.Color();
  const acc = new THREE.Color('#000000');
  if (gabled && ridgeHalf > 0.5 && !slate) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const a = [ridge.cx - ux * ridgeHalf, ridge.cz - uz * ridgeHalf];
    const b = [ridge.cx + ux * ridgeHalf, ridge.cz + uz * ridgeHalf];
    // Style jeu vidéo : faîtière plus large et plus haute, lisible de loin.
    const top = ridgeY + (LOW_POLY ? 0.24 : 0.13);
    const low = ridgeY - 0.04;
    const ridgeW = LOW_POLY ? 0.3 : 0.19;
    for (const side of [1, -1]) {
      const ox = vx * ridgeW * side;
      const oz = vz * ridgeW * side;
      const q = [
        [a[0]! + ox, low, a[1]! + oz, 0, 0],
        [b[0]! + ox, low, b[1]! + oz, ridgeHalf * 2, 0],
        [b[0]!, top, b[1]!, ridgeHalf * 2, 0.25],
        [a[0]!, top, a[1]!, 0, 0.25],
      ];
      for (const k of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
        const v = q[k]!;
        pos.push(v[0]!, v[1]!, v[2]!);
        uvs.push(v[3]!, v[4]!);
      }
    }
    const g = toGeometry(pos, uvs);
    paint(g, c.set(roofColour).multiplyScalar(LOW_POLY ? 0.72 : 0.82), 1, acc, 0, 0);
    out.push(g);
  }
  if (r() < 0.8 * density) {
    // Souche de cheminée sur le faîtage (au tiers ou au pignon), 0,8 × 0,55 m, 0,9 m au-dessus.
    const t = (r() < 0.5 ? -1 : 1) * Math.min(ridgeHalf * (0.35 + r() * 0.4), Math.max(ridgeHalf - 0.6, 0));
    const cx = ridge.cx + ux * t;
    const cz = ridge.cz + uz * t;
    // Style jeu vidéo : souche trapue (lisible au loin), plus haute.
    const hw = LOW_POLY ? 0.5 : 0.4;
    const hd = LOW_POLY ? 0.4 : 0.28;
    const ring = (e: number) => [
      cx - ux * (hw + e) - vx * (hd + e), cz - uz * (hw + e) - vz * (hd + e),
      cx + ux * (hw + e) - vx * (hd + e), cz + uz * (hw + e) - vz * (hd + e),
      cx + ux * (hw + e) + vx * (hd + e), cz + uz * (hw + e) + vz * (hd + e),
      cx - ux * (hw + e) + vx * (hd + e), cz - uz * (hw + e) + vz * (hd + e),
    ];
    const topY = ridgeY + (LOW_POLY ? 1.1 : 0.9);
    const stack = walls(ring(0), wallTop - 0.2, topY - (wallTop - 0.2));
    const brick = r() < 0.4;
    paint(stack, c.set(brick ? BRICK : (MEULIERE[Math.floor(r() * MEULIERE.length)] as string)), 0, acc, brick ? 2 : 1, 0);
    out.push(stack);
    // Chapeau : bandeau clair et dessus sombre (jeu vidéo : plus débordant et plus épais).
    const capRing = ring(LOW_POLY ? 0.1 : 0.06);
    const capH = LOW_POLY ? 0.2 : 0.12;
    const cap = walls(capRing, topY, capH);
    paint(cap, c.set(LOW_POLY ? '#ece6da' : '#8d8a82'), 0, acc, 0, 0);
    out.push(cap);
    const lid = flatRoof(capRing, topY + capH);
    const lidG = toGeometry(lid.pos, lid.uv);
    paint(lidG, c.set(LOW_POLY ? '#3e3d40' : '#5d5a55'), 2, acc, 0, 0);
    out.push(lidG);
  }
  return out;
}

/** Style jeu vidéo : débords de toit marqués (égout, rive), comme les maisons des jeux. */
const ROOF_OVERHANG_LP = 0.65;
const GABLE_OVERHANG_LP = 0.45;

/** Formes OSM traitées en croupes (les autres, hors terrasse, en deux pans si l'emprise s'y prête). */
const HIPPED = new Set(['hipped', 'pyramidal', 'half-hipped', 'mansard', 'dome', 'round', 'onion', 'cone']);

/**
 * Bâtiments d'une tuile fusionnés en un seul maillage, matériau procédural unique (TSL).
 */
export class Buildings {
  readonly group = new THREE.Group();
  /** 0 = jour, 1 = nuit (fenêtres allumées). */
  readonly night = uniform(0);
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly tiles = new Map<string, THREE.Mesh>();
  /** Emprises des bâtiments chargés (collision de la caméra, sans lancer de rayon sur les triangles). */
  readonly footprints = new FootprintIndex();
  private readonly groundAt: (x: number, z: number) => number;
  /** Détails des maisons (cheminées, faîtières) : 0 = aucun, 1 = toutes les maisons qui s'y prêtent. */
  props = 1;
  /** Profil de style du monde (archétypes) ; null = style historique. */
  private style: WorldStyle | null = null;
  private readonly arch = archParams();
  private readonly archA = uniformArray(this.arch.a, 'vec4');
  private readonly archB = uniformArray(this.arch.b, 'vec4');
  private readonly archC = uniformArray(this.arch.c, 'vec4');

  constructor(groundAt: (x: number, z: number) => number, props = 1) {
    this.groundAt = groundAt;
    this.props = props;
    this.group.name = 'buildings';
    this.material = this.createMaterial();
  }

  /** Monde courant : son profil de style s'applique aux tuiles ajoutées ensuite. */
  setWorld(id: string): void {
    this.style = worldStyle(id);
  }

  private createMaterial(): THREE.MeshStandardNodeMaterial {
    // Style jeu vidéo : matériau en aplats à part (aucune texture photo demandée, voir buildingsLowPoly.ts).
    if (LOW_POLY) return createLowPolyBuildingMaterial(this.night, this.archA, this.archB, this.archC);
    const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
    const info = attribute<'vec3'>('binfo'); // type, pierres apparentes, fenêtres
    const kind = info.x;
    const base = attribute<'vec3'>('color');
    const accent = attribute<'vec3'>('accent');
    const facade = attribute<'vec2'>('facade'); // longueur du mur, travées
    const bstyle = attribute<'vec4'>('bstyle'); // style local, hauteur du mur, génoise, travée de la porte + 1
    const isLocal = bstyle.x;
    const wallH = bstyle.y;
    const u = uv().x;
    const v = uv().y;
    // Taille d'un pixel sur la façade ou le pan (m). Les motifs procéduraux (nuance de chaque tuile, ondes du
    // bac acier, lames des volets, génoise) ne sont pas filtrés comme une texture : plus fins que le pixel (au
    // loin, en vue rasante), ils tirent une valeur au hasard par pixel et scintillent. On les fond vers leur
    // moyenne avant.
    const pix = max(fwidth(u), fwidth(v));
    const isWall = step(kind, float(0.5));
    const isTile = step(float(0.5), kind).mul(step(kind, float(1.5)));
    const isSlate = step(float(1.5), kind).mul(step(kind, float(2.5)));
    // 3 : bac acier / fibrociment (hangars, BD TOPO « zinc, aluminium » et « béton »)
    const isMetal = step(float(2.5), kind).mul(step(kind, float(3.5)));
    // 4 : toit-terrasse (gravillons, étanchéité bitumée)
    const isTerrace = step(float(3.5), kind);
    // binfo.z = fenêtres (0 aveugle, 1 fenêtres, 2 annexe) + 4 × indice d'archétype (0 = style historique).
    // Codes entiers lus avec une marge : interpolés entre sommets, ils valent tantôt n − ε, tantôt n + ε, et un
    // floor() brut changeait d'avis d'un pixel à l'autre (fenêtres mouchetées, archétype qui saute).
    const archIdx = floor(info.z.add(0.01).div(4));
    const winCode = info.z.sub(archIdx.mul(4));
    const isArch = step(float(0.5), archIdx);
    const aI = int(archIdx);
    const archA = this.archA.element(aI) as unknown as THREE.Node<'vec4'>; // demi-largeur, hauteur des fenêtres, allège, rez-de-chaussée
    const archB = this.archB.element(aI) as unknown as THREE.Node<'vec4'>; // volets, balcons (0, 1 balconnets, 2 filants), bandeaux, petits-bois
    const archC = this.archC.element(aI) as unknown as THREE.Node<'vec4'>; // encadrement, corniche
    // bstyle.z : 1 génoise + 2 mur côté rue + 4 vitrine
    const genoiseOn = floor(bstyle.z.add(0.01)).mod(2);
    const shopOn = step(float(3.5), bstyle.z);
    const windowed = step(float(0.5), winCode).mul(step(winCode, float(1.5)));

    // ── Murs : textures photo CC0 (Poly Haven), à l'échelle réelle (uv en mètres) ──
    // Type de mur (binfo.y) : 0 enduit, 1 meulière (procédurale), 2 brique, 3 enduit à pierres vues,
    // 4 pierre de taille (haussmannien), 5 béton.
    const wallType = info.y;
    const isStone = step(float(0.5), wallType).mul(step(wallType, float(1.5)));
    const isBrick = step(float(1.5), wallType).mul(step(wallType, float(2.5)));
    const isRubble = step(float(2.5), wallType).mul(step(wallType, float(3.5)));
    const isAshlar = step(float(3.5), wallType).mul(step(wallType, float(4.5)));
    const isConcrete = step(float(4.5), wallType);
    const isRender = float(1).sub(isStone).sub(isBrick).sub(isRubble).sub(isAshlar).sub(isConcrete);
    const T = BUILDING_TEXTURES;
    const wallUv = (size: number) => vec2(u, v).div(size);
    const render = T.render.map.sample(wallUv(2.0)).rgb;
    const rubble = T.stone.map.sample(wallUv(2.3)).rgb;
    const brick = T.brick.map.sample(wallUv(2.0)).rgb;
    // Meulière : moellons procéduraux, teinte de la maison (ocre plus ou moins rouge) en multiplicateur.
    const meul = meuliere(vec2(u, v));
    const stone = meul.color.mul(base.div(vec3(0.68, 0.53, 0.37)).clamp(0.8, 1.2));
    // L'enduit (photo grise tachée) prend la teinte de chaque maison : couleur de base × variations de la photo.
    const renderTinted = render.mul(base.div(vec3(0.31, 0.29, 0.28))).clamp(0, 1.5);
    // Pierre de taille : assises de 50 cm, blocs de 1,40 m décalés d'un rang à l'autre, chaque bloc
    // sa nuance, joints fins à peine plus clairs que la pierre (calcaire lutétien).
    const ashCourse = floor(v.div(0.5));
    const ashU = u.add(fract(ashCourse.mul(0.5)).mul(1.4));
    // Tirages par mur : clé entière tirée de la longueur du mur. Interpolée entre sommets, la longueur brute
    // varie d'un pixel à l'autre au dernier chiffre près, et le hachage en faisait un moucheté (fenêtres « murées »
    // un pixel sur deux, pierres de taille bruitées).
    const wallKey = floor(facade.x.mul(8).add(0.5));
    const ashVar = hash(floor(ashU.div(1.4)).add(ashCourse.mul(37.1)).add(wallKey.mul(0.41))).mul(0.07).add(0.965);
    const ashJoint = max(step(fract(v.div(0.5)), float(0.025)), step(fract(ashU.div(1.4)), float(0.012)));
    const ashlar = renderTinted.mul(0.55).add(base.mul(0.45)).mul(ashVar).mul(float(1).sub(ashJoint.mul(0.16)));
    // Béton : panneaux de 3 m, joints creux.
    const panelJoint = max(step(fract(u.div(3.0)), float(0.006)), step(fract(v.div(2.75)), float(0.008)));
    const concrete = renderTinted.mul(0.7).add(base.mul(0.3)).mul(float(1).sub(panelJoint.mul(0.3)));
    let wall = renderTinted.mul(isRender).add(stone.mul(isStone)).add(brick.mul(isBrick)).add(rubble.mul(isRubble)).add(ashlar.mul(isAshlar)).add(concrete.mul(isConcrete));
    const nBig = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
    wall = wall.mul(nBig.mul(0.1).add(0.95));
    // Soubassement plus sombre (0,6 m) et salissures en pied de mur.
    wall = wall.mul(mix(float(0.72), float(1), smoothstep(0.55, 0.65, v))).mul(mix(float(0.85), float(1), smoothstep(0.0, 2.0, v)));
    // Pierre claire du pays (arkose) : chaînes d'angle, encadrements, claveaux.
    const stoneLum = stone.dot(vec3(0.3, 0.59, 0.11)).div(0.3);
    const lightStone = vec3(0.6, 0.55, 0.46).mul(stoneLum.mul(0.35).add(0.7));
    // Chaînes d'angle (style local, murs enduits à fenêtres) : blocs alternés longs / courts aux extrémités.
    const course = floor(v.div(0.32));
    const qw = mix(float(0.45), float(0.27), fract(course.mul(0.5)).mul(2));
    const inQuoin = max(step(u, qw), step(facade.x.sub(qw), u)).mul(isLocal).mul(isRender).mul(isWall).mul(step(float(0.5), winCode));
    const quoinJoint = smoothstep(0.035, 0.0, fract(v.div(0.32))).add(smoothstep(0.04, 0.0, abs(u.sub(qw)))).add(smoothstep(0.04, 0.0, abs(u.sub(facade.x.sub(qw))))).min(1);
    wall = mix(wall, lightStone.mul(float(1).sub(quoinJoint.mul(0.35))), inQuoin);
    // Fenêtres : travées réparties sur la longueur. Style historique : une par étage de 2,8 m au-dessus
    // d'une allège de 0,9 m. Archétype : rez-de-chaussée (hauteur propre) puis étages de hauteur `fhA`
    // (hauteur du mur ÷ nombre d'étages entiers), allège et fenêtres de l'archétype.
    // facade.y = travées + hauteur d'étage ÷ 10 (≤ 0,999) : marge de 0,0004 (voir archIdx).
    const bays = max(floor(facade.y.add(0.0004)), float(0.0001));
    const local = fract(u.div(facade.x).mul(bays));
    const bayW = facade.x.div(bays);
    const bayIdx = floor(u.div(facade.x).mul(bays));
    const wx = local.sub(0.5).mul(bayW); // mètres depuis l'axe de la travée
    const fhA = max(facade.y.sub(floor(facade.y.add(0.0004))).mul(10), float(2.4));
    const rdc = archA.w.mul(isArch);
    const hasRdc = step(float(0.01), rdc);
    const flA = floor(v.sub(rdc).div(fhA));
    const floorBase = rdc.add(flA.mul(fhA)); // plancher de l'étage (archétype)
    const zF = v.sub(floorBase); // hauteur au-dessus du plancher
    const floorNo = flA.add(hasRdc); // 0 = rez-de-chaussée, 1 = premier étage…
    const floorIdx = mix(floor(v.sub(0.9).div(2.8)), floorNo, isArch);
    const fy = mix(fract(v.sub(0.9).div(2.8)).mul(2.8), zF.sub(archA.z), isArch); // mètres au-dessus de l'allège
    const winH = mix(float(1.35), archA.y, isArch);
    // Porte d'entrée (style local) : dans la travée tirée du mur côté rue, au rez-de-chaussée.
    const doorBay = bstyle.w;
    const isDoorBay = step(float(0.5), doorBay).mul(step(abs(bayIdx.add(1).sub(doorBay)), float(0.5)));
    // Style local : travées irrégulières (environ une baie sur cinq murée), fenêtres plus étroites sur la pierre.
    const skip = step(hash(bayIdx.mul(3.7).add(floorIdx.mul(11.3)).add(wallKey.mul(0.171))), float(0.2)).mul(isLocal);
    const halfW = mix(mix(float(0.5), float(0.4), isLocal.mul(isStone)), archA.x, isArch);
    // Archétype : au-dessus du rez-de-chaussée, la fenêtre et son encadrement sous la corniche.
    const archRow = step(rdc, v).mul(step(floorBase.add(archA.z).add(archA.y), wallH.sub(archC.y.mul(0.45)).sub(0.08)));
    // Colonnes de baies (sans condition de hauteur dans l'étage) ; binfo.z : 0 mur aveugle, 1 fenêtres,
    // 2 annexe (grande porte en bois sur un mur sur deux).
    const winCol = step(float(0.5), facade.y)
      .mul(windowed)
      .mul(mix(step(0.9, v), archRow, isArch))
      .mul(float(1).sub(skip))
      .mul(float(1).sub(isDoorBay.mul(step(floorIdx, float(0.5)))))
      // pas de fenêtre dans la génoise
      .mul(max(step(v, wallH.sub(genoiseOn.mul(0.5))), step(isLocal, float(0.5))));
    const hasWin = winCol.mul(step(float(0), fy));
    const inWin = step(abs(wx), halfW).mul(step(fy, winH)).mul(hasWin);
    // Encadrements : 8 cm (Île-de-France), 16 cm de pierre claire (style local) ou ceux de l'archétype ;
    // appui saillant ombré dessous.
    const fm = mix(mix(float(0.08), float(0.16), isLocal), archC.x, isArch);
    const inFrame = step(abs(wx), halfW.add(fm)).mul(step(fy, winH.add(fm))).mul(step(fm.negate(), fy)).mul(winCol);
    const underSill = step(abs(wx), halfW.add(fm)).mul(step(fm.negate().sub(0.07), fy)).mul(step(fy, fm.negate())).mul(winCol).mul(max(isLocal, isArch));
    const shutterX = abs(wx);
    const inShutter = step(halfW.add(fm).add(0.02), shutterX)
      .mul(step(shutterX, halfW.mul(2).add(fm).add(0.02)))
      .mul(step(fy, winH.add(0.03)))
      .mul(hasWin)
      .mul(mix(float(1), archB.x, isArch));
    // Lames des volets.
    const slats = mix(fract(fy.mul(9)).mul(0.25).add(0.8), float(0.925), smoothstep(0.03, 0.08, pix));
    // Environ une fenêtre sur deux allumée la nuit (bruit par pièce).
    const lit = step(0.0, mx_noise_float(floor(positionWorld.mul(0.3)).add(0.37))).mul(this.night);
    const glass = mix(vec3(0.1, 0.12, 0.14).add(normalWorld.y.mul(0)), vec3(1.0, 0.74, 0.42), lit);
    // Reflet du ciel dans les vitres (haut plus clair).
    const glassSky = glass.add(vec3(0.12, 0.15, 0.18).mul(fy.div(winH)).mul(float(1).sub(lit)));

    // ── Archétype : modénature (avant les baies, qui passent par-dessus) ──
    // v < 0 : soubassement découvert sous le sol le plus haut du mur (terrain en pente), sans modénature ni baie.
    const aboveGround = step(float(0), v);
    const orn = isArch.mul(isWall).mul(windowed).mul(step(float(0.5), wallH)).mul(step(float(0.5), facade.y)).mul(aboveGround);
    const wallLight = wall.mul(1.12).min(1);
    // Bandeau mouluré sous chaque plancher (et au-dessus du rez-de-chaussée), ombre portée dessous.
    const zNext = floorBase.add(fhA).sub(v); // distance sous le plancher suivant
    const nextNo = floorNo.add(1);
    const filantNext = step(float(1.5), archB.y).mul(max(step(abs(nextNo.sub(2)), float(0.5)), step(abs(nextNo.sub(5)), float(0.5))));
    const strCourse = orn.mul(archB.z).mul(step(rdc.sub(0.3), v)).mul(step(v, wallH.sub(0.6)));
    wall = mix(wall, wallLight, strCourse.mul(step(zNext, float(0.14))).mul(float(1).sub(filantNext)));
    wall = mix(wall, wall.mul(0.84), strCourse.mul(step(float(0.14), zNext)).mul(step(zNext, float(0.22))).mul(float(1).sub(filantNext)));
    // Balcon filant (2e et 5e étages) : dalle de pierre saillante et son ombre sur le mur.
    const slab = orn.mul(filantNext).mul(step(v, wallH.sub(1.2)));
    wall = mix(wall, wallLight.mul(1.04).min(1), slab.mul(step(zNext, float(0.2))));
    wall = mix(wall, wall.mul(mix(float(0.55), float(0.9), smoothstep(0.2, 0.55, zNext))), slab.mul(step(float(0.2), zNext)).mul(step(zNext, float(0.55))));
    // Corniche sous l'égout : bandeau clair, ombre franche dessous.
    const top = wallH.sub(v);
    const cornice = orn.mul(archC.y);
    wall = mix(wall, wallLight, cornice.mul(step(top, float(0.38))));
    wall = mix(wall, wall.mul(0.55), cornice.mul(step(float(0.38), top)).mul(step(top, float(0.5))));
    // Rez-de-chaussée en pierre de taille : refends (joints horizontaux profonds tous les 45 cm).
    const inRdc = isArch.mul(isWall).mul(hasRdc).mul(step(v, rdc.sub(0.3))).mul(step(float(0.5), wallH)).mul(aboveGround);
    wall = mix(wall, wall.mul(0.62), inRdc.mul(isAshlar).mul(step(fract(v.div(0.45)), float(0.07))));

    wall = mix(wall, accent.mul(slats), inShutter.mul(float(1).sub(inWin)));
    const frameCol = mix(mix(vec3(0.93, 0.92, 0.88), lightStone, isLocal), mix(vec3(0.9, 0.88, 0.83), wallLight, isAshlar.add(isRender.mul(0.5))), isArch);
    wall = mix(wall, frameCol, inFrame.mul(float(1).sub(inWin)));
    wall = mix(wall, wall.mul(0.55), underSill);
    wall = mix(wall, glassSky, inWin);
    // Embrasure : la vitre est en retrait de 15 cm ; le linteau et un tableau portent leur ombre sur
    // le haut et le côté de la baie, l'appui est éclairé.
    const reveal = max(step(winH.sub(0.12), fy), step(wx, halfW.negate().add(0.09))).mul(inWin);
    wall = mix(wall, wall.mul(0.45), reveal.mul(isLocal.mul(0.6).add(0.4)));
    const outline = step(abs(wx), halfW.add(fm)).mul(step(halfW.add(fm).sub(0.025), abs(wx))).max(step(winH.add(fm).sub(0.025), fy).mul(step(fy, winH.add(fm))).mul(step(abs(wx), halfW.add(fm))));
    wall = mix(wall, wall.mul(0.7), outline.mul(inFrame).mul(isLocal));
    // Petits-bois et dormant peints en blanc (fenêtres à la française : deux vantaux, trois carreaux).
    const paneY = fract(fy.div(winH).mul(3));
    const bars = max(max(step(abs(wx), float(0.022)), step(paneY, float(0.035))), max(step(halfW.sub(0.05), abs(wx)), step(winH.sub(0.05), fy)));
    wall = mix(wall, vec3(0.86, 0.85, 0.8), bars.mul(inWin).mul(isArch).mul(archB.w).mul(float(1).sub(reveal.mul(0.5))));
    // Garde-corps en fonte : filants aux 2e et 5e étages, balconnets devant les autres portes-fenêtres.
    const thisFilant = step(float(1.5), archB.y).mul(max(step(abs(floorNo.sub(2)), float(0.5)), step(abs(floorNo.sub(5)), float(0.5))));
    const railZone = orn.mul(step(float(0.5), archB.y)).mul(step(float(0), zF)).mul(step(zF, float(0.95))).mul(step(rdc.add(0.5), v)).mul(step(v, wallH.sub(1)));
    const rail = railZone.mul(max(thisFilant.mul(step(float(0.25), u)).mul(step(u, facade.x.sub(0.25))), winCol.mul(step(abs(wx), halfW.add(0.06)))));
    const iron = max(step(fract(u.div(0.12)), float(0.16)), max(step(float(0.88), zF), step(abs(zF.sub(0.1)), float(0.03))));
    wall = mix(wall, vec3(0.05, 0.055, 0.06), rail.mul(iron));

    // ── Rez-de-chaussée commerçant (archétype, mur côté rue) : vitrines entre trumeaux, bandeau d'enseigne ──
    // Devanture en bois peint (une couleur par bâtiment, tirée de sa teinte) : bandeau d'enseigne,
    // encadrement des vitrines et imposte ; vitrine sombre avec le reflet de la rue et du ciel.
    const shop = inRdc.mul(shopOn).mul(float(1).sub(isDoorBay)).mul(step(float(0.5), facade.y));
    const glassHW = bayW.mul(0.5).sub(0.3);
    const glassTop = rdc.sub(1.05);
    const shopFront = shop.mul(step(abs(wx), bayW.mul(0.5).sub(0.04))).mul(step(v, rdc.sub(0.35)));
    const shopGlass = shop.mul(step(abs(wx), glassHW)).mul(step(float(0.45), v)).mul(step(v, glassTop)).mul(step(float(0.06), abs(v.sub(glassTop.sub(0.55)))));
    const signBand = shopFront.mul(step(rdc.sub(0.95), v));
    // Couleur du bâtiment ramenée à 8 bits : même tirage sur toute la façade (voir wallKey).
    const shopSeed = hash(floor(base.r.mul(255).add(0.5)).mul(3.573).add(floor(base.g.mul(255).add(0.5)).mul(2.265)).add(floor(base.b.mul(255).add(0.5)).mul(1.031)));
    const signCol = mix(mix(vec3(0.07, 0.16, 0.11), vec3(0.26, 0.06, 0.07), step(0.3, shopSeed)), mix(vec3(0.06, 0.09, 0.18), mix(vec3(0.05, 0.05, 0.05), vec3(0.42, 0.33, 0.2), step(0.9, shopSeed)), step(0.78, shopSeed)), step(0.55, shopSeed));
    const shopLit = this.night.mul(step(0.3, hash(shopSeed.add(bayIdx))));
    const streak = smoothstep(0.42, 0.5, fract(u.add(v.mul(0.7)).div(2.3))).mul(smoothstep(0.58, 0.5, fract(u.add(v.mul(0.7)).div(2.3))));
    const shopInterior = mix(
      vec3(0.045, 0.05, 0.055).add(vec3(0.16, 0.19, 0.22).mul(smoothstep(0.4, glassTop, v))).add(vec3(0.12).mul(streak)),
      vec3(1.0, 0.82, 0.6),
      shopLit,
    );
    wall = mix(wall, signCol.mul(mix(float(1.25), float(1), signBand)), shopFront);
    wall = mix(wall, shopInterior, shopGlass);
    // Rez-de-chaussée sans commerce : hautes fenêtres sous le bandeau, encadrées, à petits-bois.
    const rdcCol = inRdc.mul(float(1).sub(shopOn)).mul(windowed).mul(float(1).sub(isDoorBay)).mul(step(float(0.5), facade.y));
    const rdcTop = rdc.sub(0.8);
    const rdcWin = rdcCol.mul(step(abs(wx), halfW)).mul(step(float(1.0), v)).mul(step(v, rdcTop));
    const rdcFrame = rdcCol.mul(step(abs(wx), halfW.add(fm))).mul(step(float(1.0).sub(fm), v)).mul(step(v, rdcTop.add(fm))).mul(float(1).sub(rdcWin));
    wall = mix(wall, frameCol, rdcFrame);
    wall = mix(wall, vec3(0.1, 0.12, 0.14).add(vec3(0.12, 0.15, 0.18).mul(smoothstep(1.0, rdcTop, v))), rdcWin);
    const rdcBars = max(step(abs(wx), float(0.022)), step(fract(v.sub(1.0).div(rdcTop.sub(1.0)).mul(3)), float(0.03)));
    wall = mix(wall, vec3(0.86, 0.85, 0.8), rdcBars.mul(rdcWin).mul(archB.w));

    // Porte d'entrée : bois à panneaux (couleur des volets, plus sombre), imposte vitrée, encadrement de pierre ;
    // porte cochère (1,5 m, plus haute) au rez-de-chaussée des archétypes.
    const cochere = isArch.mul(hasRdc);
    const fdW = mix(float(0.55), float(0.75), cochere);
    const fdH = mix(float(2.25), rdc.sub(0.55).min(3.6), cochere);
    const frontOk = isDoorBay.mul(isWall).mul(step(float(0.5), facade.y)).mul(aboveGround);
    const inFront = step(abs(wx), fdW).mul(step(v, fdH)).mul(frontOk);
    const inFrontFrame = step(abs(wx), fdW.add(0.16)).mul(step(v, fdH.add(0.16))).mul(frontOk).mul(float(1).sub(inFront));
    const panel = step(0.06, abs(fract(v.div(0.55)).sub(0.5))).mul(step(abs(abs(wx).sub(fdW.mul(0.5))), fdW.mul(0.38)));
    const transom = step(fdH.sub(0.3), v);
    const frontWood = accent.mul(0.6).mul(mix(float(0.8), float(1), panel));
    wall = mix(wall, mix(lightStone, wallLight, isArch), inFrontFrame);
    wall = mix(wall, mix(frontWood, glassSky, transom), inFront);
    // Porte de grange / garage : planches verticales, encadrement sombre, position tirée par mur.
    const wallSeed = hash(floor(facade.x.mul(7.31)));
    const hasDoor = step(float(1.5), winCode).mul(step(float(3.2), facade.x)).mul(step(float(0.45), wallSeed)).mul(aboveGround);
    const doorW = mix(float(1.1), float(2.8), step(float(6), facade.x));
    const doorC = facade.x.mul(wallSeed.mul(0.4).add(0.3));
    const doorH = min(float(2.7), facade.x.mul(0.6));
    const dx = abs(u.sub(doorC));
    // Style local, pierre : porte charretière en anse de panier, claveaux de pierre claire.
    const arch = isLocal.mul(isStone);
    const rr = dx.div(doorW.mul(0.5)).min(1);
    const archTop = doorH.sub(arch.mul(0.55).mul(float(1).sub(float(1).sub(rr.mul(rr)).max(0).sqrt())));
    const inDoor = step(dx, doorW.mul(0.5)).mul(step(v, archTop)).mul(hasDoor);
    const inDoorFrame = step(dx, doorW.mul(0.5).add(mix(float(0.1), float(0.28), arch))).mul(step(v, archTop.add(mix(float(0.1), float(0.3), arch)))).mul(hasDoor);
    const planks = fract(u.div(0.16)).mul(0.25).add(0.75).mul(mx_noise_float(vec2(u.mul(3), v.mul(0.2))).mul(0.15).add(0.9));
    wall = mix(wall, mix(vec3(0.12, 0.09, 0.07), lightStone, arch), inDoorFrame);
    wall = mix(wall, accent.mul(0.55).add(vec3(0.12, 0.08, 0.04)).mul(planks), inDoor);
    // Génoise (style local, murs d'égout) : trois rangs de tuiles canal en encorbellement sous le toit,
    // bouts arrondis en terre cuite, mortier de chaux entre les rangs.
    const gz = genoiseOn.mul(isWall).mul(step(wallH.sub(0.45), v)).mul(step(v, wallH.add(0.05)));
    const gd = wallH.sub(v);
    const row = floor(gd.div(0.14));
    const gx = fract(u.div(0.2).add(row.mul(0.5)));
    const tileEnd = float(1).sub(gx.sub(0.5).mul(2).pow(2)).max(0).sqrt();
    const rowY = fract(gd.div(0.14));
    const inTileEnd = step(rowY, tileEnd.mul(0.75).add(0.12));
    const terracotta = vec3(0.5, 0.22, 0.11).mul(tileEnd.mul(0.4).add(0.65)).mul(rowY.mul(0.3).add(0.75));
    const genoiseFine = mix(vec3(0.62, 0.58, 0.5).mul(0.7), terracotta, inTileEnd).mul(mix(float(0.55), float(1), smoothstep(0.0, 0.05, rowY)));
    // au loin : teinte moyenne (trois quarts de bouts de tuiles, un quart de mortier)
    const genoise = mix(genoiseFine, vec3(0.3, 0.17, 0.11), smoothstep(0.03, 0.08, pix));
    wall = mix(wall, genoise, gz);

    // ── Toits : tuiles en terre cuite et ardoise (textures photo), mousse par endroits ──
    const roofUv = (size: number) => vec2(u, v).div(size);
    const moss = smoothstep(0.6, 0.9, mx_noise_float(positionWorld.mul(0.5))).mul(0.3);
    const tileTex = T.tiles.map.sample(roofUv(3.2)).rgb;
    // Tuile plate : chaque tuile (≈ 17 × 10,5 cm visibles, rangs décalés) a sa propre cuisson,
    // plus quelques plaques de tuiles de remplacement plus claires et des lichens jaunes.
    const tileRow = floor(v.div(0.105));
    const tcell = floor(vec2(u.div(0.17).add(tileRow.mul(0.5)), tileRow));
    const th = hash(tcell.x.add(5000).mul(1000).add(tcell.y.add(500)));
    const patch = smoothstep(0.55, 0.75, mx_noise_float(positionWorld.mul(0.22)));
    const lichenY = smoothstep(0.7, 0.85, mx_noise_float(positionWorld.mul(1.7))).mul(0.35);
    const tileVar = mix(th.mul(0.24).add(0.88), float(1), smoothstep(0.03, 0.1, pix)).mul(mix(float(1), float(1.12), patch));
    const tilesIdf = mix(tileTex.mul(base.div(vec3(0.33, 0.13, 0.08)).clamp(0.7, 1.3)).mul(tileVar), vec3(0.62, 0.58, 0.3), lichenY);
    // Tuiles vieillies (BD TOPO, binfo.y = 1 sur le toit) : seule la luminance de la photo (relief des
    // tuiles, moyenne 0,048 en linéaire) est gardée, teintée par une terre cuite passée mesurée sur
    // l'orthophoto (rose saumon peu saturé), avec lichens gris par plaques.
    const tileLum = tileTex.dot(vec3(0.2126, 0.7152, 0.0722)).div(0.048).clamp(0.45, 1.5);
    const lichen = smoothstep(0.45, 0.8, mx_noise_float(positionWorld.mul(0.9).add(3))).mul(0.25);
    const weathered = mix(base.mul(tileLum).mul(tileVar), vec3(0.32, 0.31, 0.28).mul(tileLum), lichen);
    const tiles = mix(mix(tilesIdf, weathered, step(float(0.5), info.y)), vec3(0.3, 0.33, 0.18), moss);
    const slate = T.slate.map.sample(roofUv(1.5)).rgb;
    // Bac acier : ondes de 25 cm dans la pente, coulures et rouille légère par plaques.
    const rib = abs(fract(u.div(0.25)).sub(0.5)).mul(2);
    const rust = smoothstep(0.55, 0.85, mx_noise_float(positionWorld.mul(0.25))).mul(0.35);
    const ribShade = mix(rib.mul(0.25).add(0.8), float(0.925), smoothstep(0.05, 0.15, pix));
    const steel = mix(base.mul(ribShade), vec3(0.42, 0.27, 0.17), rust).mul(nBig.mul(0.15).add(0.9));
    // Zinc (toits parisiens, binfo.y = 1 sur un toit métallique) : bandes de 55 cm à joints debout,
    // patine gris bleuté par plaques, sans rouille.
    const isZinc = isMetal.mul(step(float(0.5), info.y));
    const seam = smoothstep(0.93, 0.97, fract(u.div(0.55)));
    const patina = mx_noise_float(positionWorld.mul(0.18)).mul(0.08).add(1);
    const zinc = base.mul(mix(seam.mul(0.3).add(0.94), float(0.955), smoothstep(0.02, 0.06, pix))).mul(patina).mul(nBig.mul(0.1).add(0.95));
    const metal = mix(steel, zinc, isZinc);
    let col = mix(wall, tiles, isTile);
    col = mix(col, slate, isSlate);
    col = mix(col, metal, isMetal);
    // Toit-terrasse : gravillons (grain de 4 cm, fondu au loin), plaques d'étanchéité bitumée, salissures.
    const grain = mix(hash(floor(positionWorld.xz.mul(25)).dot(vec2(1, 157))).mul(0.3).add(0.85), float(1), smoothstep(0.015, 0.05, pix));
    const bitumen = smoothstep(0.2, 0.45, mx_noise_float(positionWorld.mul(0.15).add(7)));
    const gravel = base.mul(grain).mul(nBig.mul(0.2).add(0.88));
    col = mix(col, mix(gravel, vec3(0.11, 0.11, 0.12), bitumen.mul(0.85)), isTerrace);
    // Sous-face du débord : face arrière des pans (tournés vers le haut), enduit à la teinte du mur (accent).
    const isRoof = isTile.add(isSlate).add(isMetal).add(isTerrace).min(1);
    const underside = isRoof.mul(float(1).sub(float(frontFacing)));
    col = mix(col, accent.mul(nBig.mul(0.1).add(0.95)), underside);
    m.colorNode = col;
    m.emissiveNode = vec3(1.0, 0.62, 0.3)
      .mul(inWin.mul(lit).mul(isWall).mul(1.0))
      .add(vec3(1.0, 0.8, 0.55).mul(shopGlass.mul(shopLit).mul(isWall).mul(0.75)));
    const glazed = inWin.max(shopGlass).max(rdcWin).mul(isWall);
    m.roughnessNode = mix(mix(mix(mix(float(0.93), float(0.15), glazed), float(0.75), isTile.add(isSlate).min(1)).sub(isSlate.mul(0.2)), mix(float(0.55), float(0.42), isZinc), isMetal), float(0.95), isTerrace.max(underside));
    // Relief : cartes de normales de la texture correspondante (sauf sur les vitres).
    const nrm = (t: LazyTexture, size: number) => t.sample(vec2(u, v).div(size)).rgb;
    const wallN = nrm(T.render.normal, 2.0)
      .mul(isRender.add(isAshlar.mul(0.6)).add(isConcrete))
      .add(vec3(0.5, 0.5, 1).mul(isAshlar.mul(0.4)))
      .add(meul.normalTS.mul(0.5).add(0.5).mul(isStone))
      .add(nrm(T.brick.normal, 2.0).mul(isBrick))
      .add(nrm(T.stone.normal, 2.3).mul(isRubble));
    const roofN = nrm(T.tiles.normal, 3.2).mul(isTile).add(nrm(T.slate.normal, 1.5).mul(isSlate)).add(vec3(0.5, 0.5, 1).mul(isMetal.add(isTerrace)));
    const flatN = vec3(0.5, 0.5, 1);
    const nCol = mix(mix(wallN, flatN, inWin.max(inFrame).max(inShutter).max(shopFront).max(rdcWin)), roofN, isRoof);
    m.normalNode = normalMap(mix(nCol, flatN, underside), vec2(0.8, 0.8));
    m.metalnessNode = isMetal.mul(mix(float(0.25), float(0.35), isZinc)).mul(float(1).sub(underside));
    // Les emprises OSM n'ont pas d'orientation garantie : on rend les deux faces.
    m.side = THREE.DoubleSide;
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id) || !tile.features.buildings.length) return;
    const r = rng(tile.tx * 92821 + tile.tz * 68917);
    const parts: THREE.BufferGeometry[] = [];
    const c = new THREE.Color();
    const wc = new THREE.Color();
    const acc = new THREE.Color();
    const soffit = new THREE.Color();
    // Centres et surfaces des bâtiments de la tuile : un appentis s'adosse au plus proche plus grand que lui.
    const centres = new Float64Array(tile.features.buildings.length * 3);
    tile.features.buildings.forEach((b, k) => {
      const n = b.pts.length / 2;
      let x = 0;
      let z = 0;
      for (let i = 0; i < b.pts.length; i += 2) {
        x += (b.pts[i] as number) / n;
        z += (b.pts[i + 1] as number) / n;
      }
      centres.set([x, z, Math.abs(polygonArea(b.pts))], k * 3);
    });
    const drivable = drivableRoads(tile);
    for (const bld of tile.features.buildings) {
      if (bld.pts.length < 6) continue;
      // Bâtiment posé sur une route carrossable (emprise OSM/BD TOPO qui mord sur la chaussée) : pas dessiné,
      // sinon le coureur le traverse.
      if (coversRoad(bld.pts, drivable)) continue;
      // Sol affiché sous l'emprise : la hauteur des données part du point bas (`y`), mais en pente le
      // côté amont est plus haut et y enterrait les murs.
      let groundLo = Infinity;
      let groundHi = -Infinity;
      for (let i = 0; i < bld.pts.length; i += 2) {
        const g = this.groundAt(bld.pts[i] as number, bld.pts[i + 1] as number);
        if (!Number.isFinite(g)) continue;
        groundLo = Math.min(groundLo, g);
        groundHi = Math.max(groundHi, g);
      }
      let base = Math.min(bld.y ?? Infinity, groundLo);
      if (!Number.isFinite(base)) continue;
      const rise = Number.isFinite(groundHi) ? Math.min(groundHi - base, 8) : 0;
      base -= 0.3;
      const isChurch = bld.kind === 'church' || bld.kind === 'chapel';
      const isUtility = ['shed', 'garage', 'garages', 'barn', 'greenhouse', 'roof', 'industrial', 'ruins'].includes(bld.kind);
      const box = orientedBox(bld.pts);
      const shape = bld.roof ?? 'gabled';
      const total = isChurch ? Math.max(bld.height, 14) : Math.max(bld.height || (bld.levels ?? 1.6) * 2.9 + 3, 3.5);
      // Archétype du profil de style du monde (habitations et commerces ; annexes et édifices : style historique).
      const archId =
        this.style && !isChurch && !isUtility
          ? pickArchetype(
              this.style,
              {
                kind: bld.kind,
                height: bld.height,
                ...(bld.levels !== undefined ? { levels: bld.levels } : {}),
                ...(bld.material ? { material: bld.material } : {}),
                ...(bld.roofMaterial ? { roofMaterial: bld.roofMaterial } : {}),
              },
              r(),
            )
          : null;
      const arch = archId ? ARCHETYPES[archId] : undefined;
      const archRoof = arch?.roof.type;
      const archZinc = archRoof === 'zinc' || archRoof === 'mansard_zinc';
      // BD TOPO : matériau du toit connu (le bac acier a une pente plus faible que la tuile) ; sinon celui de l'archétype.
      const roofMat =
        bld.roofMaterial ??
        (bld.material === 'slate' || shape === 'mansard' || isChurch ? 'slate' : arch ? (archZinc ? 'metal' : archRoof === 'slate' ? 'slate' : archRoof === 'terrace' ? 'concrete' : 'tiles') : undefined);
      const metal = roofMat === 'metal' || roofMat === 'concrete';
      // Zinc : toit métallique d'un archétype parisien (BD TOPO « zinc, aluminium »), pente de toit en tuile.
      const zinc = !!arch && archZinc && roofMat === 'metal';
      const minPitch = metal && !zinc ? 6 : 15;
      const footArea = Math.abs(polygonArea(bld.pts));
      // Sans pente mesurée : appentis de tuiles, bac acier presque plat ou toit-terrasse (voir flatRoofs.ts).
      const measuredSkillion = shape === 'skillion' && box.hw <= 20 && (bld.roofHeight ?? 0) > 0.3;
      // (une monopente non mesurée ou trop large est traitée comme un toit plat ; les grands bâtiments en pente
      // ont leur toit, le squelette droit allant jusqu'au faîtage)
      const flatKind = !measuredSkillion && (shape === 'flat' || shape === 'skillion' || bld.roofHeight === 0) ? flatRoofKind(roofMat, bld.kind, footArea) : null;
      const lean = flatKind === 'lean' && box.hw <= 20;
      // Monopente (annexes, hangars, appentis) : un seul pan sur le rectangle orienté, murs montés jusqu'au pan.
      const skillion = measuredSkillion || lean;
      // Toit sur l'emprise réelle (squelette droit) : deux pans si elle est presque rectangulaire, croupes sinon.
      const plan =
        skillion || flatKind
          ? null
          : planRoof(bld.pts, { overhang: LOW_POLY ? ROOF_OVERHANG_LP : 0.4, gableOverhang: LOW_POLY ? GABLE_OVERHANG_LP : 0.25, gabled: !HIPPED.has(shape), maxInset: Math.max(15, box.hw + 1), ...(bld.ridgeShort ? { ridgeShort: true } : {}) });
      // Pente : hauteur de toit (OSM, ou mesurée au LiDAR) sur la demi-largeur effective (là où les pans se rejoignent), bornée.
      const halfW = plan ? Math.max(plan.tEnd - plan.overhang, 0.5) : 0;
      const wantH = Math.min(bld.roofHeight ?? Math.tan((42 * Math.PI) / 180) * halfW, total * 0.6);
      const pitch = plan ? Math.min(Math.max((Math.atan(wantH / halfW) * 180) / Math.PI, minPitch), 55) : 0;
      // Appentis : pente de 12° sur toute la largeur.
      const roofH = plan ? Math.tan((pitch * Math.PI) / 180) * halfW : lean ? Math.tan((LEAN_PITCH * Math.PI) / 180) * 2 * box.hw : skillion ? Math.min(bld.roofHeight as number, total * 0.5) : 0;
      // Égout : mesuré (BD TOPO enrichie au LiDAR) ou déduit des étages (OSM), voir eaveHeight.ts.
      const wallH = eaveHeight({ total, roofH, rise, ...(bld.levels !== undefined ? { levels: bld.levels } : {}), utility: isUtility || isChurch, measured: !!bld.bdtopo });
      const wallTop = base + wallH + 0.3;
      // Emprise pour la collision de la caméra (prisme toit compris ; le clocher dépasse, sans gêne).
      this.footprints.add(tile.id, bld.pts, base, wallTop + roofH);
      // Matériau de façade : celui de l'archétype ; sinon connu (BD TOPO, OSM) ou tiré au sort (meulière ≈ 45 %
      // hors annexes), ou couleur OSM.
      const pick = (list: string[]) => list[Math.floor(r() * list.length)] as string;
      const stones = arch ? arch.wall === 'meuliere' : !bld.colour && (bld.material === 'stone' || (!bld.material && !isUtility && r() < 0.45));
      const brick = arch ? arch.wall === 'brick' : bld.material === 'brick';
      const wallColour = arch
        ? osmColour(bld.colour, pick(arch.walls))
        : osmColour(
            bld.colour,
            stones ? pick(bld.bdtopo ? STONE_LOCAL : MEULIERE) : brick ? BRICK : bld.material === 'concrete' ? '#cfcac0' : bld.material === 'wood' ? '#7a5a3e' : pick(bld.bdtopo ? RENDERS_LOCAL : RENDERS),
          );
      wc.set(wallColour);
      // Archétype : nuance propre à chaque bâtiment (±4 % de luminosité, ±5 % de saturation), deux voisins
      // tirés dans la même palette ne sont pas identiques.
      if (arch) wc.offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.1, (r() - 0.5) * 0.08);
      acc.set(arch ? pick(arch.shutters.length ? arch.shutters : DOORS) : pick(bld.bdtopo ? SHUTTERS_LOCAL : SHUTTERS));
      // Style jeu vidéo : palettes des archétypes et couleurs OSM ravivées (les palettes locales le sont déjà).
      if (LOW_POLY && (arch || bld.colour)) vivid(wc, 0.15, 0.05);
      if (LOW_POLY && arch) vivid(acc, 0.35, 0.04);
      // Monopente : haut des murs sur le plan du toit (pente selon la largeur, ou la longueur si faîtage court).
      const slopeU = !!bld.ridgeShort && !lean;
      // Appentis : côté haut adossé au bâtiment voisin.
      const side = lean ? leanSide(box.cx, box.cz, slopeU ? box.ux : -box.uz, slopeU ? box.uz : box.ux, footArea, centres) : 1;
      const sx = (slopeU ? box.ux : -box.uz) * side;
      const sz = (slopeU ? box.uz : box.ux) * side;
      const half = slopeU ? box.hl : box.hw;
      const roofAt = (x: number, z: number) => wallTop + ((((x - box.cx) * sx + (z - box.cz) * sz) / half + 1) / 2) * roofH;
      // Style local (BD TOPO) : génoise sous les égouts des toits de tuiles, porte d'entrée côté rue.
      let style: WallStyle | undefined;
      if (arch) {
        // Archétype : rythme de façade, étages entiers entre le rez-de-chaussée et la corniche, vitrines
        // côté rue (milieu du mur à moins de 9 m d'une voie), porte d'entrée ou cochère côté rue.
        const f = arch.facade;
        const span = wallH - (f.cornice ? 0.5 : 0.2) - f.groundFloorM;
        const floors = Math.max(1, Math.round(span / f.floorM));
        const dist = roadDistance(bld.pts, tile.features.roads);
        style = {
          local: !!arch.ornaments?.quoins,
          doorPick: r(),
          bayM: f.bayM,
          floorM: Math.min(Math.max(span / floors, 2.5), 3.8),
          shop: r() < f.shopfronts,
          ...(dist ? { street: (x: number, z: number) => dist(x, z) < 9 } : {}),
        };
        const door = streetWall(bld.pts, tile.features.roads, dist);
        if (door) style.door = door;
        if (arch.ornaments?.genoise && plan && !metal && roofMat !== 'slate') {
          const rx = bld.ridgeShort ? -box.uz : box.ux;
          const rz = bld.ridgeShort ? box.ux : box.uz;
          const hipped = HIPPED.has(shape);
          style.eave = (dx, dz) => hipped || Math.abs(dx * rx + dz * rz) / Math.hypot(dx, dz) > 0.7;
          style.genoiseDrop = genoiseDrop(pitch);
        }
      } else if (bld.bdtopo) {
        style = { local: true, doorPick: r() };
        const housing = !isUtility && !isChurch;
        if (housing && plan && !metal && roofMat !== 'slate') {
          // croupes : tous les murs sont des égouts ; deux pans : seulement les murs parallèles au faîtage
          const rx = bld.ridgeShort ? -box.uz : box.ux;
          const rz = bld.ridgeShort ? box.ux : box.uz;
          const hipped = HIPPED.has(shape);
          style.eave = (dx, dz) => hipped || Math.abs(dx * rx + dz * rz) / Math.hypot(dx, dz) > 0.7;
          style.genoiseDrop = genoiseDrop(pitch);
        }
        if (housing) {
          const door = streetWall(bld.pts, tile.features.roads);
          if (door) style.door = door;
        }
      }
      // Monopente : haut des murs sur le pan ; même façade que les autres murs (porte côté rue, sol amont).
      const w = walls(bld.pts, base, wallH + 0.3, style, this.groundAt, skillion ? (x, z) => roofAt(x, z) - base : undefined);
      // Granges, fermes et églises : enduit à pierres vues plutôt que meulière ou enduit lisse.
      const rubble = !arch && !stones && !brick && !bld.colour && (bld.kind === 'barn' || bld.kind === 'farm' || isChurch) && r() < 0.7;
      const wallType = arch ? WALL_CODE[arch.wall] : stones ? 1 : rubble ? 3 : brick ? 2 : 0;
      paint(w, wc, 0, acc, wallType, isUtility ? 2 : 1, archId ? ARCH_IDS.indexOf(archId) + 1 : 0);
      parts.push(w);
      // Toit-terrasse : sans pente, hors bac acier (le béton est compté avec le métal ci-dessus).
      const terrace = !plan && !skillion && flatKind !== 'steel';
      const slate = roofMat === 'slate' && !terrace;
      // Tuiles : brun-rouge (tuile plate d'Île-de-France) ou orangé (tuile mécanique / canal, BD TOPO) ;
      // archétype : sa palette pour le zinc et la tuile.
      const archTile = !!arch && (archRoof === 'flat_tile' || archRoof === 'mechanical_tile' || archRoof === 'canal_tile');
      const roofColour = terrace
        ? pick(TERRACES)
        : zinc
          ? pick(arch!.roof.colours)
          : metal
            ? pick(METAL_ROOFS)
            : slate
              ? SLATE
              : archTile
                ? pick(arch!.roof.colours)
                : pick(arch && roofMat === 'tiles' ? MECHANICAL_TILES : roofMat === 'tiles' ? TERRACOTTA : ROOFS);
      const roofKind = terrace ? 4 : metal ? 3 : slate ? 2 : 1;
      const buf = plan ? roofBuffers(plan, wallTop, pitch) : null;
      const roofPart = buf ? buf.roof : flatRoof(bld.pts, wallTop);
      if (skillion) for (let i = 0; i < roofPart.pos.length; i += 3) roofPart.pos[i + 1] = roofAt(roofPart.pos[i] as number, roofPart.pos[i + 2] as number);
      else if (!plan) {
        // Toit plat : abaissé d'un rien propre au bâtiment (0 à 6 cm, tiré de son emprise ; le mur dépasse à peine). Deux bâtiments mitoyens
        // ou parties d'un même bâtiment (BD TOPO) à la même hauteur superposaient leurs toits : ils scintillaient.
        const lift = (Math.abs(Math.sin((bld.pts[0] as number) * 12.9898 + (bld.pts[1] as number) * 78.233)) * 43758.5453) % 1 * 0.06;
        for (let i = 1; i < roofPart.pos.length; i += 3) roofPart.pos[i] = (roofPart.pos[i] as number) - lift;
      }
      if (roofPart.pos.length) {
        const roof = toGeometry(roofPart.pos, roofPart.uv);
        // binfo.y : tuiles vieillies (BD TOPO) ou zinc (toit métallique d'un archétype parisien) ; accent :
        // sous-face du débord (face arrière des pans), enduit du mur à l'ombre.
        paint(roof, LOW_POLY && (zinc || archTile) ? vivid(c.set(roofColour), 0.25, 0.02) : c.set(roofColour), roofKind, soffit.copy(wc).multiplyScalar(0.8), zinc || (bld.bdtopo && roofKind === 1) ? 1 : 0, 0);
        parts.push(roof);
        if (plan || skillion) {
          // Chant : tuiles et liteaux 16 cm, ardoise 10 cm, bac acier 6 cm ; couleur du toit assombrie (bouts de tuiles, rive).
          // Style jeu vidéo : dalle de toit épaisse (rive sombre bien lisible de loin).
          const edge = roofEdge(roofPart, LOW_POLY ? (metal ? 0.16 : slate ? 0.26 : 0.34) : metal ? 0.06 : slate ? 0.1 : 0.16);
          if (edge.pos.length) {
            const g = toGeometry(edge.pos, edge.uv);
            paint(g, c.set(roofColour).multiplyScalar(LOW_POLY ? 0.52 : 0.7), 0, acc, 0, 0);
            parts.push(g);
          }
        }
      }
      if (terrace) {
        // Acrotère : muret de 45 cm dans le prolongement des murs, même enduit, sans baie (uv décalés hors
        // soubassement) ; vu de la terrasse, sa face arrière.
        const parapet = walls(bld.pts, wallTop, 0.45);
        const pu = parapet.getAttribute('uv');
        for (let i = 0; i < pu.count; i++) pu.setY(i, pu.getY(i) + 20);
        paint(parapet, wc, 0, acc, wallType, 0);
        parts.push(parapet);
      }
      if (buf && buf.gables.pos.length) {
        // Pignons (murs triangulaires) : même enduit que les murs.
        const gables = toGeometry(buf.gables.pos, buf.gables.uv);
        paint(gables, wc, 0, acc, wallType, 0);
        parts.push(gables);
      }
      if (plan && buf && !isChurch && !isUtility && this.props > 0) parts.push(...houseDetails(bld.pts, box, plan, wallTop, pitch, roofColour, slate, !!bld.ridgeShort, r, this.props));
      if (isChurch) {
        // Clocher : tour carrée en pierre et flèche d'ardoise à une extrémité.
        const tx = box.cx + box.ux * (box.hl - 2.5);
        const tz = box.cz + box.uz * (box.hl - 2.5);
        const th = wallH + 9;
        const tower = walls([tx - 2.25, tz - 2.25, tx + 2.25, tz - 2.25, tx + 2.25, tz + 2.25, tx - 2.25, tz + 2.25], base, th);
        paint(tower, c.set(MEULIERE[1] as string), 0, acc.set('#5b5f66'), 3, 0);
        parts.push(tower);
        const spire = new THREE.ConeGeometry(3.4, 11, 8).translate(tx, base + th + 5.5, tz).toNonIndexed();
        spire.deleteAttribute('uv');
        spire.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(spire.getAttribute('position').count * 2), 2));
        paint(spire, c.set(SLATE), 2, acc, 0, 0);
        parts.push(spire);
      }
    }
    if (!parts.length) return;
    const merged = mergeGeometries(
      parts.map((p) => (p.index ? p.toNonIndexed() : p)),
      false,
    );
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `buildings_${tile.id}`;
    this.group.add(mesh);
    this.tiles.set(tile.id, mesh);
  }

  removeTile(tile: LoadedTile): void {
    this.footprints.removeTile(tile.id);
    const m = this.tiles.get(tile.id);
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    this.tiles.delete(tile.id);
  }
}

/** Voies carrossables d'une tuile (sans chemins, sentiers ni passages couverts) : axe 2D et demi-largeur. */
const NON_DRIVABLE = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform', 'track']);
function drivableRoads(tile: LoadedTile): Array<{ pts: number[]; half: number; minX: number; maxX: number; minZ: number; maxZ: number }> {
  const out: Array<{ pts: number[]; half: number; minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  for (const r of tile.features.roads) {
    if (NON_DRIVABLE.has(r.kind) || r.tunnel || r.bridge) continue;
    const p = r.pts;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i] as number);
      maxX = Math.max(maxX, p[i] as number);
      minZ = Math.min(minZ, p[i + 1] as number);
      maxZ = Math.max(maxZ, p[i + 1] as number);
    }
    out.push({ pts: p, half: Math.max(r.width, 2.5) / 2, minX, maxX, minZ, maxZ });
  }
  return out;
}

/** L'emprise couvre la chaussée : un point de l'axe dedans, ou un coin du bâtiment à moins de la demi-largeur − 0,5 m. */
function coversRoad(poly: number[], roads: ReturnType<typeof drivableRoads>): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i] as number);
    maxX = Math.max(maxX, poly[i] as number);
    minZ = Math.min(minZ, poly[i + 1] as number);
    maxZ = Math.max(maxZ, poly[i + 1] as number);
  }
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i] as number, zi = poly[i + 1] as number, xj = poly[j] as number, zj = poly[j + 1] as number;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const r of roads) {
    if (r.maxX < minX - r.half || r.minX > maxX + r.half || r.maxZ < minZ - r.half || r.minZ > maxZ + r.half) continue;
    const p = r.pts;
    const clear = Math.max(0.5, r.half - 0.5);
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k] as number, az = p[k + 1] as number, bx = p[k + 2] as number, bz = p[k + 3] as number;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      // axe échantillonné tous les 1,5 m
      for (let t = 0; t <= len; t += 1.5) {
        const x = ax + (dx * t) / (len || 1), z = az + (dz * t) / (len || 1);
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        if (inside(x, z)) return true;
      }
      // coins du bâtiment trop près de l'axe
      const l2 = dx * dx + dz * dz || 1;
      for (let i = 0; i < poly.length; i += 2) {
        const px = poly[i] as number, pz = poly[i + 1] as number;
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
        if (Math.hypot(ax + dx * u - px, az + dz * u - pz) < clear) return true;
      }
    }
  }
  return false;
}
