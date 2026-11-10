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

/** Distance (m) à laquelle on sonde le raster autour d'un arbre pour reconnaître une lisière (P2.3b-2b). */
export const EDGE_PROBE_M = 12;
/** Un arbre hors du polygone de forêt mais à moins de cette distance (m) en fait partie (premier rang de la lisière). */
export const EDGE_NEAR_M = 6;
const EDGE_DIRS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);

/**
 * Lisière d'un arbre LiDAR (P2.3b-2b) : l'arbre est dans une forêt OSM (`forestAt` ≥ 0,5 à son pied, ou à moins de
 * EDGE_NEAR_M : le premier rang d'arbres déborde souvent du polygone) et, à
 * EDGE_PROBE_M, au moins une des huit directions sort de la forêt (`forestAt` < 0,25) ou tombe sur une voie dessinée
 * (`roadAt` > 0,5 : chemin forestier, route qui traverse le bois). Déterministe (lecture des rasters de la tuile).
 */
export function edgeAt(forestAt: (x: number, z: number) => number, roadAt: (x: number, z: number) => number, x: number, z: number): number {
  if (forestAt(x, z) < 0.5 && !EDGE_DIRS.some(([dx, dz]) => forestAt(x + dx * EDGE_NEAR_M, z + dz * EDGE_NEAR_M) >= 0.5)) return 0;
  let open = 0;
  for (const [dx, dz] of EDGE_DIRS) {
    const px = x + dx * EDGE_PROBE_M;
    const pz = z + dz * EDGE_PROBE_M;
    if (forestAt(px, pz) < 0.25 || roadAt(px, pz) > 0.5) open++;
    if (open === 2) return 1;
  }
  return open / 2;
}

/**
 * Approfondit les houppiers de lisière vers 82 % de la hauteur, avec un dégagement minimal de 0,4 m
 * au pied nominal. Les houppiers déjà plus profonds gardent leur forme.
 */
export function skirtFrac(frac: number, h: number, strength: number): number {
  const target = Math.max(frac, Math.min(0.82, 1 - 0.4 / h));
  return frac + (target - frac) * clamp01(strength);
}

/**
 * Jupe partielle selon le voisinage LiDAR (P2.3b-2b) : arbres à demi dégagés (lisière hors polygone OSM, haie,
 * bosquet), 0 au cœur d'un bois comme pour un arbre isolé (houppier gardé à sa hauteur), au plus 0,6.
 */
export function openSkirt(open: number): number {
  const s = (a: number, b: number, v: number) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  return s(0.4, 0.7, open) * (1 - s(0.85, 1, open)) * 0.6;
}
