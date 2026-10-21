/** Pré-téléchargement des données OSM du corridor (remplit le cache data/cache/terrain/osm). */
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { fetchOsm } from './overpass.ts';

const b = corridorWgs84();
console.log('Emprise OSM', b);
const els = await fetchOsm(b, OSM_CHUNK.lon, OSM_CHUNK.lat);
console.log(`${els.length} éléments OSM`);
