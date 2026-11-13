import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import { snowCoverAt } from './alpine.ts';
import { splatCell } from './splat.ts';
import type { LoadedTile } from './types.ts';
import { drawnRoads, roadClearance } from './roadAvoid.ts';

/** Rayon (m) de l'herbe autour du coureur. */
export const GRASS_RADIUS = 60;
/** Côté (m) des blocs du monde où l'herbe est semée : mêmes touffes aux mêmes endroits à chaque regénération. */
export const GRASS_BLOCK = 12;

/** Ce que le placement lit du monde. */
export interface GrassEnv {
  tileAt: (x: number, z: number) => LoadedTile | undefined;
  heightAt: (x: number, z: number) => number;
  /** Vrai sur la chaussée : pas d'herbe. */
  avoid: (x: number, z: number) => boolean;
  season: Season;
  /** Herbe des champs cultivés éclaircie (P2.1c, voir fieldGrassDensity) ; absent : `?grassfields=1`. */
  grassFields?: boolean;
}

/**
 * P2.1c : dans les champs cultivés, l'herbe n'est plus semée comme sur une pelouse. Repli quand l'environnement
 * ne le dit pas (tests) : `?grassfields=1`. En jeu, voir grassFieldsFor.
 */
const GRASS_FIELDS_REQUESTED = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('grassfields') === '1';
  } catch {
    return false;
  }
})();
/**
 * Herbe des champs active dans tous les mondes (`?grassfields=0` la coupe). Sans champ cultivé dans la carte
 * d'occupation du sol, la densité reste celle d'avant : l'option ne joue que là où il y a des champs.
 */
export function grassFieldsFor(_worldId: string): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('grassfields') === '0') return false;
  } catch {
    /* pas d'URL : valeur par défaut */
  }
  return true;
}
/** Densité plancher dans un champ (quelques touffes isolées, jamais une surface vide). */
export const FIELD_GRASS_MIN = 0.02;
/** Supplément dans les taches enherbées (bruit de 25 m et de 7 m). */
export const FIELD_GRASS_PATCH = 0.3;
/** Supplément en tournière et en lisière de parcelle (cellule voisine hors champ). */
export const FIELD_GRASS_EDGE = 0.25;
/** Bas-côtés : densité d'origine gardée jusqu'à VERGE_KEEP_M du bord de chaussée, fondue sur VERGE_FADE_M. */
export const VERGE_KEEP_M = 3;
export const VERGE_FADE_M = 2;

/** Hachage entier d'une maille (0–1), le même sur toutes les machines. */
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bruit de valeur (0–1), interpolation lissée entre les nœuds d'une grille unité. */
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Taches enherbées d'un champ (0–1) : bruit de 25 m (65 %) et de 7 m (35 %), seuillé (≈ un cinquième de la surface). */
export function fieldGrassPatch(x: number, z: number): number {
  return smoothstep(0.55, 0.85, valueNoise(x / 25, z / 25) * 0.65 + valueNoise(x / 7, z / 7) * 0.35);
}

/**
 * Densité de l'herbe là où il y a du champ (P2.1c). `old` : densité d'origine du point ; `field` : part de champ
 * du pixel ; `edge` : lisière (0–1, cellule voisine hors champ) ; `roadEdgeM` : distance au bord de la chaussée
 * dessinée la plus proche (m, Infinity si aucune). Dans un champ pur : de FIELD_GRASS_MIN à environ 0,57 selon
 * taches et lisière, jamais plus que `old` ; la part non champ du pixel et les bas-côtés gardent `old`.
 */
export function fieldGrassDensity(old: number, field: number, patch: number, edge: number, roadEdgeM: number): number {
  if (old <= 0 || field < 0.05) return old;
  const inField = Math.min(old, FIELD_GRASS_MIN + FIELD_GRASS_PATCH * patch + FIELD_GRASS_EDGE * edge);
  const fieldPart = old + (inField - old) * Math.min(field, 1);
  const verge = 1 - smoothstep(VERGE_KEEP_M, VERGE_KEEP_M + VERGE_FADE_M, roadEdgeM);
  return fieldPart + (old - fieldPart) * verge;
}

/** Distance (m) au bord de la chaussée dessinée la plus proche, Infinity au-delà de 12 m ; index par tuile en cache. */
const roadEdges = new WeakMap<LoadedTile, (x: number, z: number) => { d: number } | null>();
function roadEdgeDistance(tile: LoadedTile, x: number, z: number): number {
  let f = roadEdges.get(tile);
  if (!f) {
    // Mêmes routes que le réseau dessiné d'un monde ouvert (pistes cyclables comprises), bord = demi-largeur + accotement.
    f = roadClearance(drawnRoads(tile.features.roads ?? [], true));
    roadEdges.set(tile, f);
  }
  return f(x, z)?.d ?? Number.POSITIVE_INFINITY;
}

/** Lisière d'un champ (0–1) : une des quatre cellules voisines du raster (≈ 4 m) n'est pas du champ. */
function fieldEdge(tile: LoadedTile, data: Uint8Array, x: number, z: number): number {
  const step = tile.size / (tile.splat as { res: number }).res;
  let e = 0;
  for (const [dx, dz] of [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
  ] as const) {
    const c = splatCell(tile, x + dx, z + dz);
    if (c >= 0) e = Math.max(e, 1 - (data[c + 1] as number) / 255);
  }
  return e;
}

/** Touffes d'un bloc du monde, dans l'ordre des tirages. */
export interface GrassBlock {
  bx: number;
  bz: number;
  count: number;
  /** Position (x, z) de chaque touffe, en double précision : le test du rayon se fait dessus. */
  xz: Float64Array;
  /** Matrice 4×4 de chaque touffe (16 flottants). */
  mats: Float32Array;
  /**
   * Faux si une touffe a été écartée faute de tuile ou d'altitude (tuile pas encore là) : le bloc sera à
   * refaire, il ne doit pas être gardé.
   */
  complete: boolean;
}

/** Essais par bloc : 2 × le plafond réparti sur l'aire du disque (comme avant, où les essais étaient tirés au hasard). */
export function grassTriesPerBlock(max: number): number {
  return Math.ceil((2 * max * GRASS_BLOCK * GRASS_BLOCK) / (Math.PI * GRASS_RADIUS * GRASS_RADIUS));
}

/** Blocs du disque d'herbe autour de `focus`, du plus proche au plus loin. */
export function grassBlocksAround(fx: number, fz: number): Array<{ bx: number; bz: number; d: number }> {
  const blocks: Array<{ bx: number; bz: number; d: number }> = [];
  const bx0 = Math.floor((fx - GRASS_RADIUS) / GRASS_BLOCK);
  const bx1 = Math.floor((fx + GRASS_RADIUS) / GRASS_BLOCK);
  const bz0 = Math.floor((fz - GRASS_RADIUS) / GRASS_BLOCK);
  const bz1 = Math.floor((fz + GRASS_RADIUS) / GRASS_BLOCK);
  for (let bx = bx0; bx <= bx1; bx++)
    for (let bz = bz0; bz <= bz1; bz++) {
      const d = Math.hypot((bx + 0.5) * GRASS_BLOCK - fx, (bz + 0.5) * GRASS_BLOCK - fz);
      if (d <= GRASS_RADIUS + GRASS_BLOCK * 0.71) blocks.push({ bx, bz, d });
    }
  return blocks.sort((a, b) => a.d - b.d);
}

/** Matrice d'une touffe tournée autour de l'axe vertical (équivalent de Matrix4.compose avec une rotation d'axe Y). */
function composeYaw(out: Float32Array, o: number, px: number, py: number, pz: number, angle: number, sx: number, sy: number, sz: number): void {
  const half = angle / 2;
  const y = Math.sin(half);
  const w = Math.cos(half);
  const y2 = y + y;
  const yy = y * y2;
  const wy = w * y2;
  out[o] = (1 - yy) * sx;
  out[o + 1] = 0;
  out[o + 2] = (0 - wy) * sx;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = (0 + wy) * sz;
  out[o + 9] = 0;
  out[o + 10] = (1 - yy) * sz;
  out[o + 11] = 0;
  out[o + 12] = px;
  out[o + 13] = py;
  out[o + 14] = pz;
  out[o + 15] = 1;
}

let scratchMats = new Float32Array(0);
let scratchXz = new Float64Array(0);

/**
 * Touffes d'un bloc du monde. Ne dépend ni du coureur ni du rayon : tous les tirages sont faits à chaque essai,
 * acceptés ou non, donc le bloc est identique d'une regénération à l'autre et peut être gardé. Le rayon et le
 * plafond s'appliquent ensuite, à l'assemblage (`appendGrassBlock`).
 */
export function generateGrassBlock(bx: number, bz: number, tries: number, env: GrassEnv): GrassBlock {
  if (scratchMats.length < tries * 16) {
    scratchMats = new Float32Array(tries * 16);
    scratchXz = new Float64Array(tries * 2);
  }
  const r = rng(((bx * 73856093) ^ (bz * 19349663)) | 0);
  const fields = env.grassFields ?? GRASS_FIELDS_REQUESTED;
  let n = 0;
  let complete = true;
  // La tuile change rarement d'un essai à l'autre (un bloc fait 12 m, une tuile 1 km).
  let tile: LoadedTile | undefined;
  let tx = Number.NaN;
  let tz = Number.NaN;
  for (let t = 0; t < tries; t++) {
    // Tous les tirages à chaque essai, acceptés ou non : la suite du bloc ne dépend pas du foyer ni du terrain.
    const ux = r();
    const uz = r();
    const uDensity = r();
    const uSnow = r();
    const uSize = r();
    const uTurn = r();
    const uHeight = r();
    const x = (bx + ux) * GRASS_BLOCK;
    const z = (bz + uz) * GRASS_BLOCK;
    if (tile === undefined || Math.floor(x / tile.size) !== tx || Math.floor(z / tile.size) !== tz) {
      tile = env.tileAt(x, z);
      if (!tile) {
        complete = false;
        continue;
      }
      tx = Math.floor(x / tile.size);
      tz = Math.floor(z / tile.size);
    }
    // Position dans le raster calculée une fois pour tous les canaux.
    const cell = splatCell(tile, x, z);
    const d = cell >= 0 ? (tile.splat as { data: Uint8Array }).data : null;
    const meadow = d ? (d[cell + 2] as number) / 255 : 0;
    const field = d ? (d[cell + 1] as number) / 255 : 0;
    const forest = d ? (d[cell] as number) / 255 : 0;
    const road = d ? (d[cell + 5] as number) / 255 : 0;
    const water = d ? (d[cell + 3] as number) / 255 : 0;
    // abords de l'itinéraire actif : bas-côté herbeux dense et plus haut
    const verge = d ? (d[cell + 6] as number) / 255 : 0;
    // ni sur la roche, les éboulis et les glaciers
    const rock = d ? (d[cell + 7] as number) / 255 : 0;
    // ni sur le sable des plages
    const sand = d ? (d[cell + 9] as number) / 255 : 0;
    // Herbe partout sauf chaussée et eau, plus dense dans les prés et sur les bas-côtés.
    // Style jeu vidéo : marge plus large autour des routes OSM (rien ne dépasse sur l'enrobé).
    const density = road > 0.12 || water > 0.3 || rock > 0.2 || sand > 0.3 ? 0 : 0.35 + meadow * 0.65 - forest * 0.25 + field * 0.1 + verge * 0.8;
    if (uDensity > density) continue;
    // Champs cultivés (P2.1c) : densité réduite, calculée seulement pour les essais que l'ancienne règle accepte
    // (même tirage, aucun nombre aléatoire de plus : le bloc reste identique d'une regénération à l'autre).
    if (fields && d && field >= 0.05 && uDensity > fieldGrassDensity(density, field, fieldGrassPatch(x, z), fieldEdge(tile, d, x, z), roadEdgeDistance(tile, x, z))) continue;
    if (env.avoid(x, z)) continue;
    const y = env.heightAt(x, z);
    if (!Number.isFinite(y)) {
      complete = false;
      continue;
    }
    // au-dessus de la limite d'enneigement : sous la neige
    const snow = snowCoverAt(y, env.season);
    if (snow > 0 && uSnow < snow) continue;
    const k = (0.6 + uSize * 0.7) * (1 + verge * 0.6);
    composeYaw(scratchMats, n * 16, x, y - 0.02, z, uTurn * Math.PI, k, k * (0.8 + uHeight * 0.6), k);
    scratchXz[n * 2] = x;
    scratchXz[n * 2 + 1] = z;
    n++;
  }
  return { bx, bz, count: n, xz: scratchXz.slice(0, n * 2), mats: scratchMats.slice(0, n * 16), complete };
}

/**
 * Ajoute à `out` (à partir de la touffe `n`) les touffes du bloc qui sont dans le rayon autour de `focus`, sans
 * dépasser `max` au total. Renvoie le nouveau nombre de touffes.
 */
export function appendGrassBlock(block: GrassBlock, fx: number, fz: number, out: Float32Array, n: number, max: number): number {
  for (let i = 0; i < block.count && n < max; i++) {
    if (Math.hypot((block.xz[i * 2] as number) - fx, (block.xz[i * 2 + 1] as number) - fz) > GRASS_RADIUS) continue;
    out.set(block.mats.subarray(i * 16, i * 16 + 16), n * 16);
    n++;
  }
  return n;
}
