import type { TileRoad } from './types.ts';

/**
 * Champ de distance au bord de chaussée dessinée, par tuile (P2.2b, expérimental) : pour chaque nœud d'une grille
 * régulière qui couvre la tuile bords compris, distance signée (m) au bord de la route dessinée la plus proche,
 * négative sur la chaussée. Sert au matériau du terrain (accotement de terre tassée, fondu vers le sol) sans
 * aucune géométrie. Même bord que le réseau dessiné (network.ts) : demi-largeur max(largeur, 2,5)/2 + 0,6 m,
 * mêmes polylignes (arrondies au décodage, tileDecode.ts).
 *
 * Encodage sur un octet : [EDGE_MIN_M, EDGE_MAX_M] sur 0–255 (≈ 3 cm par pas). Plage assez large pour qu'un nœud
 * voisin du bord (2 m à 512 × 512) ne soit jamais tronqué : la lecture bilinéaire reste juste au bord (tronquée
 * à −1 m, elle décalait le bord de 15 cm et plus). Mesuré à 512 × 512 sur des routes de Billom : erreur au bord
 * de 1 à 3 cm au 95e centile, plus de 10 cm sur 2,7 % de la bande (angles des carrefours, virages serrés).
 *
 * Grille « bords compris » : le nœud (i, j) est à (x0 + i·size/(res−1), z0 + j·size/(res−1)) ; deux tuiles voisines
 * ont les mêmes valeurs sur leur bord commun (pour les routes de chacune). Le shader lit le nœud au centre de son
 * texel (voir `edgeFieldUv`).
 */

/** Côté du champ par tuile de 1 km (≈ 2 m par nœud) : 256 Ko par tuile, 341 Ko avec les niveaux réduits. */
export const EDGE_FIELD_RES = 512;

/** Distance signée minimale et maximale encodées (m). Au-delà de EDGE_MAX_M : « loin de toute route ». */
export const EDGE_MIN_M = -3;
export const EDGE_MAX_M = 5;
/** Accotement dessiné par network.ts au-delà de la demi-largeur (m). */
const DRAWN_SHOULDER_M = 0.6;
/** Largeur minimale de chaussée dessinée (m), comme network.ts. */
const MIN_WIDTH_M = 2.5;
/** Voies que network.ts ne dessine pas (pistes cyclables dessinées en monde ouvert). */
const NOT_DRAWN = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);

export interface EdgeRoad {
  /** Polyligne plate x, z. */
  pts: readonly number[];
  /** Demi-largeur dessinée, accotement de 0,6 m compris (m). */
  half: number;
}

/**
 * Routes d'une tuile dessinées par le réseau (mêmes critères que network.ts : profil 3D d'au moins deux points,
 * hors tunnels et voies non dessinées), sans les ponts (le sol passe dessous : pas d'accotement sur le terrain).
 */
export function edgeRoads(roads: readonly TileRoad[], drawCycleways = true): EdgeRoad[] {
  const out: EdgeRoad[] = [];
  for (const r of roads) {
    if (r.tunnel || r.bridge || !r.pts3 || r.pts3.length < 6 || r.pts.length < 4) continue;
    if (NOT_DRAWN.has(r.kind) && !(drawCycleways && r.kind === 'cycleway')) continue;
    out.push({ pts: r.pts, half: Math.max(r.width, MIN_WIDTH_M) / 2 + DRAWN_SHOULDER_M });
  }
  return out;
}

export function encodeEdge(d: number): number {
  const t = (Math.min(Math.max(d, EDGE_MIN_M), EDGE_MAX_M) - EDGE_MIN_M) / (EDGE_MAX_M - EDGE_MIN_M);
  return Math.round(t * 255);
}

export function decodeEdge(q: number): number {
  return EDGE_MIN_M + (q / 255) * (EDGE_MAX_M - EDGE_MIN_M);
}

/**
 * Champ (res × res octets, ligne j = z croissant). Seuls les nœuds à moins de demi-largeur + EDGE_MAX_M d'un segment
 * sont calculés (boîte de chaque segment) : le coût suit la longueur des routes, pas l'aire de la tuile.
 */
export function roadEdgeField(x0: number, z0: number, size: number, roads: readonly EdgeRoad[], res: number): Uint8Array {
  const dist = new Float32Array(res * res).fill(EDGE_MAX_M);
  const step = size / (res - 1);
  for (const r of roads) {
    const reach = r.half + EDGE_MAX_M;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k] as number;
      const az = p[k + 1] as number;
      const bx = p[k + 2] as number;
      const bz = p[k + 3] as number;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - reach - x0) / step));
      const i1 = Math.min(res - 1, Math.floor((Math.max(ax, bx) + reach - x0) / step));
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz) - reach - z0) / step));
      const j1 = Math.min(res - 1, Math.floor((Math.max(az, bz) + reach - z0) / step));
      if (i0 > i1 || j0 > j1) continue;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const inv = len2 > 0 ? 1 / len2 : 0;
      for (let j = j0; j <= j1; j++) {
        const z = z0 + j * step;
        const rz = z - az;
        let o = j * res + i0;
        for (let i = i0; i <= i1; i++, o++) {
          const rx = x0 + i * step - ax;
          let t = (rx * dx + rz * dz) * inv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = rx - t * dx;
          const ez = rz - t * dz;
          const d2 = ex * ex + ez * ez;
          // déjà plus près d'un autre bord : pas de racine carrée
          const lim = (dist[o] as number) + r.half;
          if (lim <= 0 || d2 >= lim * lim) continue;
          dist[o] = Math.sqrt(d2) - r.half;
        }
      }
    }
  }
  const out = new Uint8Array(res * res);
  for (let o = 0; o < out.length; o++) out[o] = encodeEdge(dist[o] as number);
  return out;
}

/** Distance signée exacte au bord dessiné le plus proche (m), plafonnée à EDGE_MAX_M (référence des tests). */
export function exactEdgeDistance(roads: readonly EdgeRoad[], x: number, z: number): number {
  let best = EDGE_MAX_M;
  for (const r of roads) {
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k] as number;
      const az = p[k + 1] as number;
      const dx = (p[k + 2] as number) - ax;
      const dz = (p[k + 3] as number) - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz) - r.half);
    }
  }
  return best;
}

/**
 * Lecture bilinéaire du champ au point (x, z), comme le GPU (filtre linéaire, coordonnée `edgeFieldUv`) : sert aux
 * tests de précision.
 */
export function sampleEdgeField(field: Uint8Array, res: number, x0: number, z0: number, size: number, x: number, z: number): number {
  const fx = Math.min(Math.max(((x - x0) / size) * (res - 1), 0), res - 1);
  const fz = Math.min(Math.max(((z - z0) / size) * (res - 1), 0), res - 1);
  const i = Math.min(Math.floor(fx), res - 2);
  const j = Math.min(Math.floor(fz), res - 2);
  const a = fx - i;
  const b = fz - j;
  const q = (ii: number, jj: number) => decodeEdge(field[jj * res + ii] as number);
  return q(i, j) * (1 - a) * (1 - b) + q(i + 1, j) * a * (1 - b) + q(i, j + 1) * (1 - a) * b + q(i + 1, j + 1) * a * b;
}

/** Facteur et décalage de la coordonnée de texture (u' = u·k + c) qui place le nœud i au centre du texel i. */
export function edgeFieldUv(res: number): { k: number; c: number } {
  return { k: (res - 1) / res, c: 0.5 / res };
}
