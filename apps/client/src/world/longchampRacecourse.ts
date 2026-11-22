import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, max, positionLocal, smoothstep } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LoadedTile } from './types.ts';

/**
 * Hippodrome de Longchamp (zone « longchamp », tous les styles) : ce qu'on reconnaît en roulant sur l'anneau.
 * Tribune, moulin, poteau d'arrivée et écran géant en volumes simplifiés faits en code (aucun fichier de modèle),
 * lices blanches le long des bords des pistes en gazon. Rien n'est reconstruit dans les tuiles : les emprises
 * BD TOPO remplacées sont masquées par leur identifiant (voir buildings.ts), comme pour la tour Eiffel.
 * Un maillage de volumes pour la tuile qui porte les bâtiments, un maillage de lices par tuile traversée.
 */
export const LONGCHAMP_WORLD = 'longchamp';

/** Tribune : centre et axes de l'emprise BD TOPO (repère de la zone, mètres). +z local = vers la piste. */
export const GRANDSTAND_SITE = { x: -367.9, z: -603.0, angle: THREE.MathUtils.degToRad(68) };
/** Gabarit publié par l'agence (160 m × 35 m, 23 m de haut) ; l'emprise BD TOPO mesure 155 m × 27 m. */
export const GRANDSTAND = { lengthM: 158, backM: -21, frontM: 14, heightM: 23 };
/** Moulin de Longchamp : centre de l'emprise ronde BD TOPO (7,2 m de diamètre, 12,9 m de haut). */
export const MILL_SITE = { x: -105.1, z: -911.8 };
/** Poteau d'arrivée sur le bord intérieur de la ligne droite, écran géant 30 m derrière, face à la tribune. */
const FINISH_POST = { x: -280.6, z: -600.1 };
const SCREEN_SITE = { x: -262.2, z: -560.3 };

/** Emprises BD TOPO remplacées par les volumes de ce fichier : tribune, son socle arrière, tour du moulin. */
const SOURCE_BUILDINGS = new Set([
  'bdtopo:BATIMENT0000000356853849',
  'bdtopo:BATIMENT0000002011657909',
  'bdtopo:BATIMENT0000000245159892',
]);

export function isLongchampSourceBuilding(id?: string): boolean {
  return id !== undefined && SOURCE_BUILDINGS.has(id);
}

/**
 * Bords des pistes en gazon : anneaux de la relation OpenStreetMap 1290012 (leisure=track, sport=horse_racing),
 * © les contributeurs d'OpenStreetMap, ODbL. Coordonnées x, z à la suite dans le repère de la zone, anneaux fermés.
 */
export const TRACK_RINGS: readonly (readonly number[])[] = [
  // way 86799193 (outer)
  [-79.6, -850.9, -81.9, -874.5, -56.2, -875.5, -48.2, -873.9, -46.3, -858.5, -44.6, -839.3, -37, -834, -25.2, -825.5, -15.6, -816.6, -8.7, -811.1, 1.3, -801.4, 7.5, -794.5, 12.3, -787.3, 16.9, -780.9, 20.6, -774.2, 27.1, -761.7, 31.8, -749.4, 34.9, -738.9, 39, -726.5, 42.7, -702.8, 43, -690.1, 42.1, -681.2, 40.3, -670.5, 37.3, -658.5, 32.5, -641.4, 3.1, -541.2, -10.5, -493.4, -10.9, -484.6, -10, -464.3, -6.4, -405.1, -4, -363.9, -0.1, -332.5, 2.3, -320.6, 5.3, -306.1, 9.3, -286.9, 16, -189.6, 20.6, -117.5, 20.9, -71.3, 20.4, -29.1, 20.8, 18.3, 20.8, 58.3, 20.8, 70.9, 20.7, 86.4, 20.4, 101.8, 19.4, 121.4, 18.8, 138.1, 17.7, 150, 15.8, 164.5, 13.1, 179, 10.4, 190.8, 7.2, 203.4, 2.9, 218.1, -0.3, 227.6, -0.5, 228.1, -3.3, 236.6, -6.3, 243.1, -6.6, 243.8, -13.7, 257.9, -17.8, 265.1, -20.8, 269.4, -25, 274.1, -28.8, 278.4, -38.9, 289.6, -48.4, 299.9, -56.9, 308.9, -66, 317.5, -75.7, 325.5, -85.3, 332.2, -94.2, 338, -105.1, 343.8, -113.5, 348.1, -123.9, 352.8, -138.6, 357.6, -147.8, 360.2, -148.5, 360.4, -186.7, 365.7, -168.5, 371.8, -130.6, 383.1, -129.2, 383.5, -46.6, 408.4, -35.2, 412.3, -37.4, 419.8, -29, 422.5, -39.6, 440, -42, 441.8, -45.3, 442.5, -69, 433.9, -88.7, 427, -117.2, 417.3, -179.8, 396.2, -219.5, 382.4, -226.4, 380, -247.5, 372.8, -258.1, 369.2, -262.5, 384.5, -268, 403.9, -296.1, 396.5, -285.7, 358.2, -293.9, 352.5, -302.3, 347.7, -316.3, 340.3, -329.8, 331.8, -338.6, 325.3, -348.5, 317.4, -356.6, 310.3, -364.3, 302.2, -371.5, 294, -376.6, 286.4, -382.2, 277.6, -386, 270.2, -391.2, 258.7, -395, 249.5, -397.5, 241.3, -400.2, 231.1, -406.2, 205.4, -412.1, 181.2, -415.2, 166.1, -428.2, 103.9, -434.9, 68.2, -439.5, 42, -443.4, 17.4, -449.3, -22.9, -452.5, -47.4, -454.3, -66.4, -455.3, -89.9, -457.2, -171.6, -458.7, -171.9, -464.4, -172.9, -458.7, -192.4, -432.8, -279.4, -335.7, -601.2, -326.1, -634.3, -318.9, -656.5, -302.3, -704.6, -286.1, -747.7, -280.9, -759.5, -274.2, -773.1, -268.1, -784.8, -262.9, -792.6, -259.2, -798.4, -254.8, -803.4, -250.6, -808.1, -242.1, -815.1, -231.3, -822.7, -219.5, -831.2, -207, -837.4, -193.4, -843.2, -180.4, -847.5, -164.8, -851.5, -151.7, -854.7, -140.9, -854.9, -134.7, -855, -120.1, -854.8, -103.3, -853.4],
  // way 86799215 (inner)
  [-42.8, -482.3, -77.6, -830.2, -97.2, -835.1, -109.6, -836.8, -121.8, -836.8, -134.9, -835.8, -147.6, -832.8, -159.5, -828.8, -172.2, -823.2, -183.6, -816.6, -191.9, -810.9, -203, -800.7, -212.7, -790.4, -223.9, -775.9, -230.3, -765.9, -237.3, -753.1, -241.7, -741.9, -247.1, -724.6, -250.3, -712.2, -408.4, -123.3, -412.2, -109.7, -415.3, -96.8, -417.2, -82.8, -417.6, -70.1, -417.4, -59.8, -415.9, -46.6, -412.8, -32.3, -409.4, -20.5, -403.3, -6.1, -396.1, 5.8, -390.2, 14.7, -383.4, 22.7, -371.3, 33.9, -358.9, 42.5, -347.3, 48.5, -335.2, 53.3, -325.2, 56.2, -313.3, 58.9, -302.1, 60, -290.9, 59.9, -279.3, 58.3, -264.8, 55.1, -248.4, 49.5, -233.8, 42.2, -224.7, 36.5, -214.5, 28.8, -203.1, 17.7, -194.2, 7.5, -187.8, -1.3, -181.3, -11.6, -175.7, -22.4, -172.2, -32.8],
  // way 86801755 (inner)
  [-5.1, 77.4, -4.9, 95.8, -5.6, 125.6, -8.3, 151.6, -11.3, 172.7, -15.3, 191.3, -21.9, 212, -28.6, 231, -37, 246.9, -48.5, 264.8, -63.1, 281.8, -78.8, 296.8, -93.4, 308.4, -107, 317, -119.9, 323.9, -136.6, 331.1, -155.5, 337.4, -176.5, 340.3, -193.1, 341.6, -216.9, 341.6, -229.9, 341.2, -235.4, 340.6, -248.7, 337.5, -224.1, 251.9, -215.7, 252.8, -208.2, 252.3, -188.1, 249.9, -173.6, 245.1, -153.4, 237.3, -132.2, 226.5, -109.6, 212.4, -90.8, 197.3, -72.5, 181.6, -56.4, 163.6, -39.6, 143, -26.9, 123.6, -20.4, 111.6, -14.9, 99.6],
  // way 86801754 (inner)
  [-391.7, 155.3, -388.7, 159, -382.8, 165.6, -376.9, 172.2, -369.1, 182.1, -360.7, 191, -352.6, 198.8, -347.1, 203.3, -336.6, 211.2, -326.2, 218.1, -314.2, 225.5, -300.7, 232.8, -288.6, 237.9, -277.8, 241.9, -270.2, 244.3, -262.5, 246.1, -254, 247.7, -277.2, 329.4, -290.7, 323.7, -306.2, 314.4, -318.2, 307.2, -326.5, 300.8, -336, 292.6, -343.6, 285.2, -350.1, 277.5, -358, 267.1, -364.4, 257.1, -371.3, 244.3, -375.4, 234.9, -378.9, 224.8, -380.9, 216.2, -383.4, 203.7, -387.1, 183.2, -388.3, 175.2],
  // way 86799217 (inner)
  [-280.5, 88.7, -268, 87, -263, 86.2, -245.3, 81.4, -231.6, 76.8, -217.3, 69.3, -205.1, 61.4, -199.5, 58.8, -210.1, 96.5, -247.3, 225.1, -253.7, 223.9, -265.2, 220.9, -275.6, 217.3, -282.1, 214.6, -293.9, 209.3, -302.4, 204.4, -314.6, 196.4, -330.2, 185.4, -343.7, 174.3, -353.8, 164.1, -363.6, 152.8, -371, 143.3, -379.6, 130.8, -386.6, 119.3, -391.8, 109.6, -395.7, 100.9, -399, 90.7, -401.4, 81.7, -403.7, 71.7, -404.9, 65.8, -407.5, 51.8, -409.5, 34.4, -407.8, 34.8, -397.4, 44.2, -381.4, 58.3, -367.6, 68.1, -357.2, 73.3, -351.7, 75.8, -343.5, 79.4, -329.5, 84.1, -317.1, 87.2, -304.1, 89.4],
  // way 86749162 (inner)
  [-217.3, 228.7, -35.7, -405.1, -23.9, -280.4, -18.2, -216.9, -15.5, -175.8, -12.3, -65.3, -13.2, -44.3, -13.8, -24.3, -15.5, 3.6, -18.9, 22.1, -24.8, 45.7, -31.8, 68.9, -39.7, 88.3, -51.3, 110.4, -63.5, 129, -77.7, 147, -94.9, 163.9, -112.1, 179.6, -125.2, 189.9, -140.5, 200.2, -156.9, 209.3, -174.2, 217.9, -191.2, 223.2, -199.5, 225.1, -206.2, 226.2, -214.2, 228.3],
  // way 86801753 (inner)
  [-17.7, -567.8, 9.7, -663.8, 12.3, -672.9, 13.6, -682.8, 14.3, -695.1, 13.7, -707.2, 12.1, -722.4, 8.7, -736.1, 4.5, -748.1, 0.7, -757, -4.7, -767.6, -12, -778.9, -20.1, -788.7, -29.9, -799.6, -36.4, -805.8, -41.4, -809.6],
];

const RAIL_TOP_M = 1.15;
const RAIL_H = 0.16;
const RAIL_W = 0.1;
const POST_W = 0.09;
/** Pas des poteaux et des tronçons de lice (m). */
const RAIL_STEP_M = 5;
/** Au-delà, la lice est épaissie en proportion de la distance : elle reste un trait net au lieu de scintiller. */
const RAIL_KEEP_M = 110;
/** Les poteaux s'effacent entre ces deux distances (seule la lisse reste lisible de loin). */
const POST_FADE_M = [260, 420] as const;

function inTile(tile: LoadedTile, x: number, z: number): boolean {
  return x >= tile.x0 && x < tile.x0 + tile.size && z >= tile.z0 && z < tile.z0 + tile.size;
}

function ownsWorld(tile: LoadedTile, worldId: string): boolean {
  return (tile.buildingSource?.worldId ?? worldId) === LONGCHAMP_WORLD;
}

/** Tuile qui porte les volumes (tribune, moulin, poteau, écran). */
export function ownsLongchampBuildings(tile: LoadedTile, worldId: string): boolean {
  return ownsWorld(tile, worldId) && inTile(tile, GRANDSTAND_SITE.x, GRANDSTAND_SITE.z);
}

/** Géométries colorées par sommet, fusionnées en un seul maillage à facettes. */
class Pieces {
  readonly list: THREE.BufferGeometry[] = [];
  private readonly color = new THREE.Color();

  add(geometry: THREE.BufferGeometry, tint: string): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute('uv');
    const n = flat.getAttribute('position').count;
    const rgb = new Float32Array(n * 3);
    this.color.set(tint);
    for (let i = 0; i < n; i++) this.color.toArray(rgb, i * 3);
    flat.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    this.list.push(flat);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, tint: string): void {
    this.add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), tint);
  }

  merge(): THREE.BufferGeometry {
    const geometry = mergeGeometries(this.list);
    for (const piece of this.list) piece.dispose();
    if (!geometry) throw new Error('Géométrie de l’hippodrome de Longchamp invalide');
    return geometry;
  }
}

/**
 * Tribune en plateaux empilés, dans son repère : x le long de la piste (nord vers +x), +z vers la piste, sol à y = 0.
 * Plateaux dorés décalés vers le nord d'étage en étage (porte-à-faux), vitrages sombres en retrait, gradins côté piste.
 */
export function grandstandGeometry(): THREE.BufferGeometry {
  const p = new Pieces();
  const gold = '#b99a5f';
  const bronze = '#8c7446';
  const glass = '#33434a';
  const concrete = '#c8c3b6';
  const seats = '#7d8a78';
  const { lengthM: L, backM, frontM, heightM } = GRANDSTAND;
  const depth = frontM - backM;
  const mid = (frontM + backM) / 2;
  // Socle et gradins bas, face à la piste.
  p.box(0, 2.2, mid - 2, L - 6, 4.4, depth - 8, concrete);
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const h = 4.4 * (1 - (i + 0.5) / steps);
    p.box(0, h / 2, frontM - 4 + (i + 0.5) * (9 / steps), L - 10, h, 9 / steps, i % 2 ? seats : concrete);
  }
  // Niveaux : [altitude du plateau, décalage vers le nord, retrait du vitrage côté piste].
  const levels = [[4.4, 0, 6], [9.2, 2.5, 8], [13.8, 5, 9], [18.4, 7.5, 7]] as const;
  for (let k = 0; k < levels.length; k++) {
    const [y, shift, setback] = levels[k]!;
    const top = k + 1 < levels.length ? levels[k + 1]![0] : heightM - 0.7;
    // Plateau débordant, puis volume vitré en retrait.
    p.box(shift, y + 0.3, mid + 1.5, L, 0.6, depth + 3, gold);
    p.box(shift, (y + 0.6 + top) / 2, mid - setback / 2 + 1, L - 8, top - y - 0.6, depth - setback - 2, glass);
    // Montants de la façade arrière (côté route des Tribunes) et garde-corps des balcons côté piste.
    for (let i = 0; i <= 18; i++) {
      const x = shift + (i / 18 - 0.5) * (L - 8);
      p.box(x, (y + 0.6 + top) / 2, backM + 1.6, 0.5, top - y - 0.6, 0.9, bronze);
    }
    p.box(shift, y + 1.15, frontM + 2.8, L - 1, 1.1, 0.12, bronze);
  }
  // Toiture plate débordante et édicule technique en retrait.
  p.box(10, heightM - 0.35, mid + 1.5, L + 2, 0.7, depth + 4, gold);
  p.box(8, heightM + 1.1, mid - 3, L * 0.55, 2.2, depth * 0.4, bronze);
  return p.merge();
}

/** Moulin : tour ronde en pierre, toit conique en ardoise, quatre ailes tournées vers −z local. Sol à y = 0. */
export function millGeometry(): THREE.BufferGeometry {
  const p = new Pieces();
  const stone = '#d2c9b5';
  const slate = '#4b5059';
  const wood = '#6b5440';
  const sail = '#e6dfcf';
  p.add(new THREE.CylinderGeometry(2.9, 3.6, 9, 16).translate(0, 4.5, 0), stone);
  p.add(new THREE.CylinderGeometry(3.25, 3.25, 0.35, 16).translate(0, 9.1, 0), wood);
  p.add(new THREE.ConeGeometry(3.3, 3.9, 16).translate(0, 11.2, 0), slate);
  p.box(0, 1.1, -3.45, 1.1, 2.2, 0.3, wood);
  // Axe des ailes sous le toit, puis quatre ailes en croix inclinées de 45° : longeron et voilure à claire-voie.
  const hubY = 8.6;
  const hubZ = -4.1;
  p.add(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8).rotateX(Math.PI / 2).translate(0, hubY, hubZ + 0.6), wood);
  for (let k = 0; k < 4; k++) {
    const turn = new THREE.Matrix4().makeRotationZ(Math.PI / 4 + (k * Math.PI) / 2);
    const place = new THREE.Matrix4().makeTranslation(0, hubY, hubZ).multiply(turn);
    p.add(new THREE.BoxGeometry(0.2, 7.6, 0.2).translate(0, 3.8, 0).applyMatrix4(place), wood);
    p.add(new THREE.BoxGeometry(1.5, 5.6, 0.07).translate(0.85, 4.7, 0).applyMatrix4(place), sail);
  }
  return p.merge();
}

/** Poteau d'arrivée : mât blanc, disque rouge face à la tribune (−z local). Sol à y = 0. */
function finishPostGeometry(p: Pieces): void {
  p.add(new THREE.CylinderGeometry(0.11, 0.14, 6.2, 8).translate(0, 3.1, 0), '#f1f0ea');
  p.add(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 20).rotateX(Math.PI / 2).translate(0, 6.6, 0), '#c2231d');
  p.add(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20).rotateX(Math.PI / 2).translate(0, 6.6, 0), '#f1f0ea');
}

/** Écran géant sur deux pieds, dalle sombre tournée vers −z local. Sol à y = 0. */
function screenGeometry(p: Pieces): void {
  for (const side of [-1, 1]) p.box(side * 6.5, 2.5, 0.3, 0.7, 5, 0.7, '#5a6067');
  p.box(0, 9.2, 0.2, 19, 8.8, 1.0, '#3a4046');
  p.box(0, 9.2, -0.33, 17.8, 7.8, 0.1, '#14181d');
}

/** Volumes de l'hippodrome posés sur le sol (un maillage, couleurs par sommet). Null si le sol n'est pas chargé. */
export function createLongchampBuildings(groundAt: (x: number, z: number) => number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial> | null {
  const p = new Pieces();
  const place = (geometry: THREE.BufferGeometry, x: number, z: number, angle: number, sink = 0): boolean => {
    const y = groundAt(x, z);
    if (!Number.isFinite(y)) {
      geometry.dispose();
      return false;
    }
    geometry.rotateY(angle).translate(x, y - sink, z);
    geometry.deleteAttribute('normal');
    p.list.push(geometry);
    return true;
  };
  const { x, z, angle } = GRANDSTAND_SITE;
  if (!place(grandstandGeometry(), x, z, angle, 0.3)) return null;
  // Le moulin regarde l'anneau, au nord (−z) : pas de rotation.
  place(millGeometry(), MILL_SITE.x, MILL_SITE.z, 0, 0.3);
  const post = new Pieces();
  finishPostGeometry(post);
  // Disque et écran tournés vers la tribune : −z local vers l'ouest de la piste, comme le +z de la tribune inversé.
  place(post.merge(), FINISH_POST.x, FINISH_POST.z, angle);
  const screen = new Pieces();
  screenGeometry(screen);
  place(screen.merge(), SCREEN_SITE.x, SCREEN_SITE.z, angle);
  const geometry = p.merge();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, flatShading: true, roughness: 0.82 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hippodrome-longchamp';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Matériau des lices : blanc, épaissi avec la distance (`railOffset`), poteaux effacés au loin (`railPost`). */
export function createRailMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#f2f1ec', roughness: 0.6 });
  const distance = cameraPosition.sub(positionLocal).length();
  const grow = max(float(1), distance.div(RAIL_KEEP_M));
  const post = attribute('railPost', 'float');
  const keep = float(1).sub(post.mul(smoothstep(POST_FADE_M[0], POST_FADE_M[1], distance)));
  material.positionNode = positionLocal.add(attribute('railOffset', 'vec3').mul(grow.mul(keep)));
  return material;
}

/** Pavés sans bouts (4 faces à plat) : axe de chaque sommet, écart à l'axe et nature (lisse 0, poteau 1). */
class RailBoxes {
  readonly axis: number[] = [];
  readonly offset: number[] = [];
  readonly post: number[] = [];
  readonly normal: number[] = [];

  /** De `a` à `b` (centres de la section), demi-largeur `hw` le long de `s`, demi-hauteur `hh` le long de `up`. */
  add(a: readonly number[], b: readonly number[], s: readonly number[], up: readonly number[], hw: number, hh: number, post: number): void {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f]!;
      const c1 = corners[(f + 1) % 4]!;
      // Normale de la face : moyenne des deux coins, dans le plan de la section.
      const nu = (c0[0] + c1[0]) / 2;
      const nv = (c0[1] + c1[1]) / 2;
      for (const [end, c] of [[a, c0], [b, c0], [b, c1], [a, c0], [b, c1], [a, c1]] as const) {
        this.axis.push(end[0]!, end[1]!, end[2]!);
        this.offset.push(s[0]! * hw * c[0] + up[0]! * hh * c[1], s[1]! * hw * c[0] + up[1]! * hh * c[1], s[2]! * hw * c[0] + up[2]! * hh * c[1]);
        this.post.push(post);
        this.normal.push(s[0]! * nu + up[0]! * nv, s[1]! * nu + up[1]! * nv, s[2]! * nu + up[2]! * nv);
      }
    }
  }
}

/** Lices des bords de piste qui tombent dans la tuile (lisse + poteaux tous les 5 m), posées sur le sol. */
export function buildLongchampRails(tile: LoadedTile, groundAt: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const boxes = new RailBoxes();
  const up = [0, 1, 0] as const;
  for (const ring of TRACK_RINGS) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2]!, az = ring[i * 2 + 1]!;
      const bx = ring[((i + 1) % n) * 2]!, bz = ring[((i + 1) % n) * 2 + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const parts = Math.max(1, Math.round(L / RAIL_STEP_M));
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const side = [-uz, 0, ux] as const;
      for (let k = 0; k < parts; k++) {
        const x0 = ax + (bx - ax) * (k / parts), z0 = az + (bz - az) * (k / parts);
        const x1 = ax + (bx - ax) * ((k + 1) / parts), z1 = az + (bz - az) * ((k + 1) / parts);
        if (!inTile(tile, (x0 + x1) / 2, (z0 + z1) / 2)) continue;
        let y0 = groundAt(x0, z0);
        let y1 = groundAt(x1, z1);
        // Bout dans la tuile voisine pas encore chargée : altitude de l'autre bout.
        if (!Number.isFinite(y0)) y0 = y1;
        if (!Number.isFinite(y1)) y1 = y0;
        if (!Number.isFinite(y0)) continue;
        const top = RAIL_TOP_M - RAIL_H / 2;
        boxes.add([x0, y0 + top, z0], [x1, y1 + top, z1], side, up, RAIL_W / 2, RAIL_H / 2, 0);
        boxes.add([x0, y0 - 0.2, z0], [x0, y0 + top, z0], side, [ux, 0, uz], POST_W / 2, POST_W / 2, 1);
      }
    }
  }
  if (!boxes.axis.length) return null;
  const g = new THREE.BufferGeometry();
  // Position = axe du pavé ; le matériau ajoute `railOffset`, multiplié par la distance (voir createRailMaterial).
  g.setAttribute('position', new THREE.Float32BufferAttribute(boxes.axis, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(boxes.normal, 3));
  g.setAttribute('railOffset', new THREE.Float32BufferAttribute(boxes.offset, 3));
  g.setAttribute('railPost', new THREE.Float32BufferAttribute(boxes.post, 1));
  g.computeBoundingSphere();
  return g;
}

/** Tuiles de la zone traversées par un bord de piste. */
export function hasLongchampRails(tile: LoadedTile, worldId: string): boolean {
  if (!ownsWorld(tile, worldId)) return false;
  for (const ring of TRACK_RINGS) {
    for (let i = 0; i < ring.length; i += 2) if (inTile(tile, ring[i]!, ring[i + 1]!)) return true;
  }
  return false;
}

function insideRing(ring: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!, zi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!, zj = ring[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Revêtements durs que les données donnent aux voies de service du centre, à tort : elles sont en stabilisé clair. */
const HARD_SURFACES = new Set(['asphalt', 'concrete', 'paved']);

/**
 * Voies de service à l'intérieur de l'anneau extérieur des pistes : dessinées en stabilisé clair (comme sur
 * l'orthophoto) et non en enrobé noir. Copies des voies concernées, les données de la tuile ne sont pas modifiées.
 */
export function longchampInfieldRoads<T extends { kind: string; surface?: string; pts3?: number[] }>(tile: LoadedTile, roads: T[]): T[] {
  if (tile.buildingSource?.worldId !== LONGCHAMP_WORLD || !hasLongchampRails(tile, LONGCHAMP_WORLD)) return roads;
  const outer = TRACK_RINGS[0]!;
  return roads.map((r) => {
    if (r.kind !== 'service' || !r.pts3 || (r.surface !== undefined && !HARD_SURFACES.has(r.surface))) return r;
    const mid = Math.floor(r.pts3.length / 6) * 3;
    return insideRing(outer, r.pts3[mid]!, r.pts3[mid + 2]!) ? { ...r, surface: 'compacted' } : r;
  });
}
