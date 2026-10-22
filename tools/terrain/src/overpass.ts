/**
 * Téléchargement OpenStreetMap via l'API Overpass, découpé en blocs, avec miroirs,
 * recul exponentiel et cache des réponses brutes (data/cache/terrain/osm).
 */
import fs from 'node:fs';
import { USER_AGENT } from './config.ts';
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

/**
 * Clauses supplémentaires des mondes de montagne : éboulis, glaciers, cols, et les
 * panneaux / stèles le long des routes (lacets numérotés de l'Alpe d'Huez, stèle Simpson…).
 */
export function mountainClauses(b: BBox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `  way["natural"~"^(scree|shingle|glacier)$"](${bb});
  relation["natural"~"^(scree|shingle|glacier)$"](${bb});
  node["natural"~"^(saddle|volcano)$"]["name"](${bb});
  node["mountain_pass"="yes"](${bb});
  node["tourism"="information"]["name"~"^[Vv]irage"](${bb});
  node["historic"~"^(memorial|monument|wayside_cross|wayside_shrine)$"](${bb});
  nwr["tourism"~"^(viewpoint|alpine_hut)$"]["name"](${bb});
  nwr["amenity"="restaurant"]["name"~"[Cc]halet"](${bb});
`;
}

/** Requête « tout le monde » sur une emprise (`extra` : clauses propres au monde). */
export function worldQuery(b: BBox, extra?: (b: BBox) => string): string {
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
${extra ? extra(b) : ''});
out geom qt;`;
}

export async function overpassOnce(query: string, label: string): Promise<Buffer> {
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
export async function fetchOsm(b: BBox, stepLon = 0.11, stepLat = 0.07, extra?: (b: BBox) => string): Promise<OsmElement[]> {
  const chunks = splitBBox(b, stepLon, stepLat);
  const byKey = new Map<string, OsmElement>();
  for (const [i, c] of chunks.entries()) {
    const q = worldQuery(c, extra);
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

/** Miroir Overpass joignable (petite requête, 20 s au plus par miroir), sinon null. */
export async function reachableOverpass(): Promise<string | null> {
  const q = '[out:json][timeout:10];node(45.0,3.0,45.0001,3.0001);out;';
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: `data=${encodeURIComponent(q)}`,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok && (await res.text()).trimStart().startsWith('{')) return mirror;
    } catch {
      // miroir injoignable : suivant
    }
  }
  return null;
}

interface ApiNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface ApiWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
interface ApiRelation {
  type: 'relation';
  id: number;
  members: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string }>;
  tags?: Record<string, string>;
}

/**
 * Repli quand aucun miroir Overpass ne répond : API principale d'OpenStreetMap (`/api/0.6/map`),
 * par blocs de `stepLon` × `stepLat` degrés (limite de 50 000 nœuds par appel), réponses brutes
 * en cache. Les éléments sont convertis au format Overpass `out geom` : géométrie des voies
 * reconstituée depuis les nœuds, membres des relations depuis les voies téléchargées (un membre
 * hors emprise reste sans géométrie et l'anneau est ignoré, comme avec Overpass sur un bord).
 */
export async function fetchOsmApi(b: BBox, stepLon = 0.02, stepLat = 0.015): Promise<OsmElement[]> {
  const chunks = splitBBox(b, stepLon, stepLat);
  const nodes = new Map<number, ApiNode>();
  const ways = new Map<number, ApiWay>();
  const rels = new Map<number, ApiRelation>();
  for (const [i, c] of chunks.entries()) {
    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${c.west},${c.south},${c.east},${c.north}`;
    const file = cachePath('osm-api', `map-${hashKey(url)}`, '.json');
    let buf: Buffer;
    if (fs.existsSync(file)) buf = fs.readFileSync(file);
    else {
      console.log(`  · API OSM bloc ${i + 1}/${chunks.length}`);
      buf = await fetchWithRetry(url, { timeoutMs: 180000, validate: (x) => (x.subarray(0, 50).toString().trimStart().startsWith('{') ? null : x.subarray(0, 160).toString()) });
      fs.writeFileSync(file, buf);
    }
    const json = JSON.parse(buf.toString('utf8')) as { elements: Array<ApiNode | ApiWay | ApiRelation> };
    for (const el of json.elements) {
      if (el.type === 'node') nodes.set(el.id, el);
      else if (el.type === 'way') ways.set(el.id, el);
      else rels.set(el.id, el);
    }
  }
  const geomOf = (w: ApiWay) =>
    w.nodes.map((id) => {
      const n = nodes.get(id);
      return n ? { lat: n.lat, lon: n.lon } : null;
    });
  const out: OsmElement[] = [];
  for (const n of nodes.values()) if (n.tags && Object.keys(n.tags).length) out.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon, tags: n.tags });
  for (const w of ways.values()) out.push({ type: 'way', id: w.id, nodes: w.nodes, geometry: geomOf(w), ...(w.tags ? { tags: w.tags } : {}) });
  for (const r of rels.values()) {
    if (r.tags?.type === 'boundary' || r.tags?.type === 'route') continue;
    out.push({
      type: 'relation',
      id: r.id,
      members: r.members.map((m) => {
        if (m.type === 'way') {
          const w = ways.get(m.ref);
          return { ...m, ...(w ? { geometry: geomOf(w) } : {}) };
        }
        if (m.type === 'node') {
          const n = nodes.get(m.ref);
          return { ...m, ...(n ? { lat: n.lat, lon: n.lon } : {}) };
        }
        return { ...m };
      }),
      ...(r.tags ? { tags: r.tags } : {}),
    });
  }
  console.log(`  API OSM : ${nodes.size} nœuds, ${ways.size} voies, ${rels.size} relations`);
  return out;
}
