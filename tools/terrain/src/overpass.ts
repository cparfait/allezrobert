/**
 * Téléchargement OpenStreetMap via l'API Overpass, découpé en blocs, avec miroirs,
 * recul exponentiel et cache des réponses brutes (data/cache/terrain/osm).
 */
import fs from 'node:fs';
import { cachePath, fetchWithRetry, hashKey } from './net.ts';

export const OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry: Array<{ lat: number; lon: number } | null>;
  tags?: Record<string, string>;
}
export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: Array<{ lat: number; lon: number } | null>;
  lat?: number;
  lon?: number;
}
export interface OsmRelation {
  type: 'relation';
  id: number;
  members: OsmRelationMember[];
  tags?: Record<string, string>;
}
export type OsmElement = OsmNode | OsmWay | OsmRelation;

const LANDUSE = 'forest|farmland|meadow|grass|orchard|vineyard|allotments|residential|industrial|commercial|retail|cemetery|recreation_ground|village_green|farmyard|plant_nursery|quarry|railway';
const NATURAL = 'wood|water|grassland|heath|scrub|wetland|bare_rock|sand';
const LEISURE = 'park|golf_course|pitch|garden|nature_reserve|stadium|track';

/** Requête « tout le monde » sur une emprise. */
export function worldQuery(b: BBox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:300][maxsize:1073741824];
(
  way["highway"](${bb});
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  way["landuse"~"^(${LANDUSE})$"](${bb});
  relation["landuse"~"^(${LANDUSE})$"](${bb});
  way["natural"~"^(${NATURAL})$"](${bb});
  relation["natural"~"^(${NATURAL})$"](${bb});
  way["leisure"~"^(${LEISURE})$"](${bb});
  relation["leisure"~"^(${LEISURE})$"](${bb});
  way["waterway"](${bb});
  way["water"](${bb});
  way["railway"~"^(rail|light_rail|narrow_gauge)$"](${bb});
  way["man_made"~"^(bridge|tower|water_tower)$"](${bb});
  node["place"](${bb});
  node["natural"~"^(peak|tree)$"]["name"](${bb});
  nwr["amenity"="place_of_worship"](${bb});
  nwr["historic"~"^(castle|monument|church|manor|ruins|memorial)$"](${bb});
  node["man_made"~"^(tower|water_tower)$"](${bb});
);
out geom qt;`;
}

async function overpassOnce(query: string, label: string): Promise<Buffer> {
  let lastErr: unknown = null;
  for (let round = 0; round < 4; round++) {
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        console.log(`  · Overpass ${label} → ${new URL(mirror).host}`);
        return await fetchWithRetry(mirror, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          contentType: 'application/x-www-form-urlencoded',
          timeoutMs: 360000,
          retries: 1,
          validate: (buf) => {
            const head = buf.subarray(0, 300).toString();
            if (!head.trimStart().startsWith('{')) return `pas du JSON : ${head.slice(0, 120)}`;
            const tail = buf.subarray(Math.max(0, buf.length - 600)).toString();
            if (tail.includes('"remark"') && /runtime error|timed out|out of memory/i.test(tail)) return `remarque Overpass : ${tail.slice(-300)}`;
            return null;
          },
        });
      } catch (err) {
        lastErr = err;
      }
    }
    const wait = 30000 * 2 ** round;
    console.warn(`  ! tous les miroirs Overpass ont échoué (${label}), pause ${wait / 1000} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Découpe une emprise en blocs de `stepDeg` degrés. */
export function splitBBox(b: BBox, stepLon: number, stepLat: number): BBox[] {
  const out: BBox[] = [];
  for (let lon = b.west; lon < b.east - 1e-9; lon += stepLon) {
    for (let lat = b.south; lat < b.north - 1e-9; lat += stepLat) {
      out.push({
        west: +lon.toFixed(5),
        south: +lat.toFixed(5),
        east: +Math.min(b.east, lon + stepLon).toFixed(5),
        north: +Math.min(b.north, lat + stepLat).toFixed(5),
      });
    }
  }
  return out;
}

/** Télécharge (ou relit du cache) les éléments OSM d'une emprise, dédoublonnés. */
export async function fetchOsm(b: BBox, stepLon = 0.11, stepLat = 0.07): Promise<OsmElement[]> {
  const chunks = splitBBox(b, stepLon, stepLat);
  const byKey = new Map<string, OsmElement>();
  for (const [i, c] of chunks.entries()) {
    const q = worldQuery(c);
    const file = cachePath('osm', `world-${hashKey(q)}`, '.json');
    let buf: Buffer;
    if (fs.existsSync(file)) buf = fs.readFileSync(file);
    else {
      buf = await overpassOnce(q, `bloc ${i + 1}/${chunks.length}`);
      fs.writeFileSync(file, buf);
    }
    const json = JSON.parse(buf.toString('utf8')) as { elements: OsmElement[] };
    for (const el of json.elements) byKey.set(`${el.type}/${el.id}`, el);
  }
  return [...byKey.values()];
}
