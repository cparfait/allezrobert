/** Pré-téléchargement des données OSM du corridor (utile pour remplir le cache). */
import { CORRIDOR_TILES } from './config.ts';
import { rectToWgs84 } from './frame.ts';
import { fetchOsm } from './overpass.ts';
import { TILE_SIZE_M } from './config.ts';

export function corridorWgs84() {
  const r = {
    minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
    minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
    maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
    maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
  };
  const b = rectToWgs84(r, 0.004);
  return { west: +b.west.toFixed(3), south: +b.south.toFixed(3), east: +b.east.toFixed(3), north: +b.north.toFixed(3) };
}

if (process.argv[1]?.endsWith('fetch-osm.ts')) {
  const b = corridorWgs84();
  console.log('Emprise OSM', b);
  const els = await fetchOsm(b, 0.06, 0.042);
  console.log(`${els.length} éléments OSM`);
}
