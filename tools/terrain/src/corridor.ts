/** Emprise WGS84 du corridor (téléchargements OSM) et découpage des requêtes Overpass. */
import { CORRIDOR_TILES, TILE_SIZE_M } from './config.ts';
import { rectToWgs84 } from './frame.ts';
import type { BBox } from './overpass.ts';

/** Taille des blocs de requête Overpass (degrés) : petits blocs = serveurs moins sollicités. */
export const OSM_CHUNK = { lon: 0.06, lat: 0.042 } as const;

export function corridorWgs84(): BBox {
  const r = {
    minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
    minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
    maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
    maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
  };
  const b = rectToWgs84(r, 0.004);
  return { west: +b.west.toFixed(3), south: +b.south.toFixed(3), east: +b.east.toFixed(3), north: +b.north.toFixed(3) };
}
