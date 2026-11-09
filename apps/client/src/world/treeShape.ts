/**
 * Arbres LiDAR plus crédibles (P2.3b-1, expérimental, `?trees=1`) : fonctions pures, sans three.js, utilisées par
 * vegetation.ts au chargement d'une tuile. Tout est déterministe (position de l'arbre et données de la tuile) : un
 * arbre garde la même allure à chaque rechargement, quel que soit l'ordre de chargement des tuiles voisines.
 *
 * Le modèle de feuillu (vegetation.ts, `deciduousGeometry`) a son houppier entre ≈ 4,4 et 11,5 m pour un arbre « de
 * 10 m » : couronne sur 62 % de la hauteur, fût nu sur 38 %. Les paramètres ci-dessous corrigent, arbre par arbre, la
 * profondeur du houppier (descendue par le shader, sommet fixe) et sa largeur, sans toucher à l'implantation ni à la
 * hauteur mesurées.
 */

/** Haut du houppier du modèle de feuillu (m, échelle 1), mesuré sur la géométrie LOD0. */
export const DECID_TOP = 11.5;
/** Bas du houppier du modèle de feuillu (m, échelle 1). */
export const DECID_CROWN_BASE = 4.4;
/** Profondeur relative du houppier du modèle (part de la hauteur). */
export const DECID_FRAC = (DECID_TOP - DECID_CROWN_BASE) / DECID_TOP;
/** Conifère normalisé (mode arbres) : sommet, bas du houppier et rayon à la base (m, échelle 1). */
export const CONIF_TOP = 12;
export const CONIF_CROWN_BASE = 3.6;
export const CONIF_RADIUS = 2.8;

/** Rayon de voisinage (m) pour estimer la densité du peuplement autour d'un arbre. */
export const NEIGHBOUR_R = 9;
/** Densité (arbres / m²) au-delà de laquelle un arbre est « à l'intérieur » du peuplement (147 / ha mesurés à Billom). */
const INTERIOR_DENSITY = 0.014;

/**
 * Ouverture du voisinage d'un arbre : 0 au cœur d'un bois, 1 pour un arbre isolé. `count` voisins dans le disque de
 * rayon NEIGHBOUR_R, `inside` = part de ce disque comprise dans la tuile (les arbres des tuiles voisines ne sont pas
 * connus : la densité est rapportée à la surface vue, pour ne pas créer de « lisière » le long des bords de tuile).
 */
export function openness(count: number, inside: number): number {
  const area = Math.PI * NEIGHBOUR_R * NEIGHBOUR_R * Math.max(inside, 0.25);
  return clamp01(1 - count / area / INTERIOR_DENSITY);
}

/** Part (0–1) du disque de rayon r centré en (x, z) comprise dans le carré [x0, x0 + size] × [z0, z0 + size] (approchée). */
export function insideShare(x: number, z: number, x0: number, z0: number, size: number, r = NEIGHBOUR_R): number {
  const span = (c: number, a: number) => (Math.min(c + r, a + size) - Math.max(c - r, a)) / (2 * r);
  return clamp01(span(x, x0)) * clamp01(span(z, z0));
}

export interface CrownFit {
  /** Profondeur voulue du houppier (part de la hauteur). */
  frac: number;
  /** Rayon dessiné du houppier (m), égal au rayon recalé sauf pour les galettes. */
  radius: number;
}

/**
 * Houppier d'un feuillu LiDAR de hauteur `h` (m) et de rayon recalé `room` (m) :
 * - plus profond quand l'arbre est dégagé (lisière, haie, arbre isolé : les branches basses reçoivent la lumière) ;
 * - au moins 0,55 × sa largeur (une couronne de 14 m de large sur un arbre de 8 m descend vers le sol au lieu de faire
 *   une galette perchée) ;
 * - bas du houppier à 1 m du sol au moins, profondeur au plus 85 % ;
 * - léger écart propre à l'arbre (`jitter` 0–1) pour éviter des couronnes toutes au même niveau.
 * Compromis documenté : si la couronne reste plus de 2 fois plus large que profonde (segmentations LiDAR qui fusionnent
 * plusieurs houppiers), son rayon est réduit, de 30 % au plus.
 */
export function crownFit(h: number, room: number, open: number, jitter: number): CrownFit {
  let frac = 0.56 + 0.24 * open + (jitter - 0.5) * 0.08;
  frac = Math.max(frac, Math.min(0.85, (0.55 * 2 * room) / h));
  frac = Math.min(frac, 0.85, 1 - 1 / h);
  frac = Math.max(frac, 0.3);
  let radius = room;
  const depth = frac * h;
  if (depth < room) radius = Math.max(room * 0.7, depth);
  return { frac, radius };
}

/**
 * Part de conifères attendue au pied d'un arbre LiDAR, d'après le canal « résineux » du raster (1 = forêt de conifères
 * OSM, 0,5 = forêt mixte, 0 = feuillus) : ≈ 90 % en forêt de conifères ; en forêt mixte, ≈ 45 % en moyenne, regroupés en
 * bouquets (`cluster` : bruit lent −1…1) et un peu plus pour les arbres élancés (`slender` = hauteur / rayon) ; aucun
 * ailleurs.
 */
export function coniferShare(resinous: number, cluster: number, slender: number): number {
  if (resinous >= 0.75) return 0.9;
  if (resinous < 0.3) return 0;
  return clamp01(0.45 + cluster * 0.4 + (slender > 2.8 ? 0.1 : 0));
}

/** Rayon dessiné (m) d'un conifère LiDAR : le rayon mesuré (souvent fusionné) borné à la silhouette d'un résineux. */
export function coniferRadius(h: number, room: number): number {
  return Math.min(room, Math.max(1.2, h * 0.22));
}

/** Pseudo-aléa stable 0–1 tiré d'une position (même formule que vegetation.ts). */
export function seedAt(x: number, z: number): number {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

/**
 * Compte, pour chaque arbre d'une liste plate [x, z, h, r, …], ses voisins à moins de NEIGHBOUR_R (grille de hachage).
 */
export function neighbourCounts(trees: ArrayLike<number>, stride = 4): Uint16Array {
  const n = Math.floor(trees.length / stride);
  const cell = NEIGHBOUR_R;
  const grid = new Map<number, number[]>();
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  for (let k = 0; k < n; k++) {
    const i = Math.floor((trees[k * stride] as number) / cell);
    const j = Math.floor((trees[k * stride + 1] as number) / cell);
    const kk = key(i, j);
    let b = grid.get(kk);
    if (!b) grid.set(kk, (b = []));
    b.push(k);
  }
  const out = new Uint16Array(n);
  const r2 = NEIGHBOUR_R * NEIGHBOUR_R;
  for (let k = 0; k < n; k++) {
    const x = trees[k * stride] as number;
    const z = trees[k * stride + 1] as number;
    const i = Math.floor(x / cell);
    const j = Math.floor(z / cell);
    let c = 0;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const b = grid.get(key(i + di, j + dj));
        if (!b) continue;
        for (const o of b) {
          if (o === k) continue;
          const dx = (trees[o * stride] as number) - x;
          const dz = (trees[o * stride + 1] as number) - z;
          if (dx * dx + dz * dz < r2) c++;
        }
      }
    out[k] = Math.min(c, 65535);
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
