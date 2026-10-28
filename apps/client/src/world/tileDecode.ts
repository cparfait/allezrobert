import { deltaDecodeU16, type WorldTile } from '@allezrobert/shared';
import type { TileFeatures } from './types.ts';

/**
 * Décodage d'une tuile (JSON des entités + grille d'altitudes Uint16), sans DOM ni three.js : exécuté dans
 * les Web Workers de tileDecoder.ts (hors du fil principal), ou sur place s'ils sont indisponibles.
 */

export interface DecodedTile {
  x0: number;
  z0: number;
  /** Grille (n+1)×(n+1). */
  n: number;
  heights: Float32Array;
  features: TileFeatures;
}

/** Fichier de la grille d'altitudes à charger avec la tuile (la plus fine disponible). */
export const gridFileOf = (tile: WorldTile): string => (tile.heights.hi ?? tile.heights.lo).file;

/** Altitudes absolues (m) depuis la grille quantifiée (`raw` est modifié si elle est codée en différences). */
export function decodeHeights(tile: WorldTile, raw: Uint16Array): { n: number; heights: Float32Array } {
  const grid = tile.heights.hi ?? tile.heights.lo;
  if (tile.heights.delta) deltaDecodeU16(raw, grid.n);
  const heights = new Float32Array(raw.length);
  const { baseM, stepM } = tile.heights;
  for (let i = 0; i < raw.length; i++) heights[i] = baseM + (raw[i] as number) * stepM;
  return { n: grid.n, heights };
}

export function decodeTile(tile: WorldTile, raw: Uint16Array): DecodedTile {
  const { n, heights } = decodeHeights(tile, raw);
  return { x0: tile.bounds.minX, z0: tile.bounds.minZ, n, heights, features: toFeatures(tile) };
}

export function toFeatures(t: WorldTile): TileFeatures {
  return {
    roads: t.roads.map((r) => {
      const flat: number[] = [];
      for (let i = 0; i < r.pts.length; i += 3) flat.push(r.pts[i] as number, r.pts[i + 2] as number);
      return {
        ...(r.id ? { id: r.id } : {}),
        kind: r.kind,
        width: r.width,
        pts: flat,
        pts3: r.pts,
        surface: r.surface,
        ...(r.route ? { route: r.route } : {}),
        ...(r.bridge ? { bridge: true } : {}),
        ...(r.tunnel ? { tunnel: true } : {}),
      };
    }),
    buildings: t.buildings.map((bd) => ({
      pts: bd.pts,
      height: bd.height,
      kind: bd.kind,
      roof: bd.roof.shape,
      roofHeight: bd.roof.height,
      levels: bd.levels,
      y: bd.y,
      ...(bd.colour ? { colour: bd.colour } : {}),
      ...(bd.material ? { material: bd.material } : {}),
      ...(bd.roof.material ? { roofMaterial: bd.roof.material } : {}),
      ...(bd.roof.ridge === 'short' ? { ridgeShort: true } : {}),
      ...(bd.source === 'bdtopo' ? { bdtopo: true } : {}),
    })),
    forests: t.forests.map((f) => ({ rings: f.rings, kind: f.kind })),
    water: t.water.map((w) => ({ rings: w.rings, kind: w.kind, level: w.level })),
    fields: t.fields.map((f) => ({ rings: f.rings, kind: f.kind })),
    landuse: t.landuse.map((l) => ({ rings: l.rings, kind: l.kind })),
    waterways: t.waterways.map((w) => ({ width: w.width, pts: w.pts, kind: w.kind, ...(w.tunnel ? { tunnel: true } : {}) })),
    railways: (t.railways ?? []).map((r) => ({ id: r.id, kind: r.kind, pts: r.pts, ...(r.name ? { name: r.name } : {}), ...(r.tunnel ? { tunnel: true } : {}), ...(r.bridge ? { bridge: true } : {}) })),
    pois: t.pois.map((p) => ({ kind: p.kind, name: p.name, x: p.x, y: p.y, z: p.z })),
    ...(t.enriched?.vegetation ? { trees: t.trees ?? [], shrubs: t.shrubs ?? [], realVegetation: true } : {}),
  };
}
