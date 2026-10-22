/**
 * Repli quand aucun miroir Overpass ne répond : API principale d'OpenStreetMap
 * (`/api/0.6/map.json`, petites emprises, mise en cache) puis complétion des multipolygones
 * (`/relation/<id>/full.json`). Les éléments sont convertis au format Overpass `out geom` et
 * filtrés comme `worldQuery`, pour être consommés tels quels par `buildOsmWorld`.
 *
 * Usage modéré (politique d'utilisation de l'API OSM) : quelques dizaines de requêtes pour une
 * emprise de quelques kilomètres, une par seconde au plus, tout est conservé en cache.
 */
import fs from 'node:fs';
import { cachePath, fetchWithRetry } from './net.ts';
import type { BBox, OsmElement, OsmRelation, OsmWay } from './overpass.ts';

const API = 'https://api.openstreetmap.org/api/0.6';

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
type ApiElement = ApiNode | ApiWay | ApiRelation;

const LANDUSE = /^(forest|farmland|meadow|grass|orchard|vineyard|allotments|residential|industrial|commercial|retail|cemetery|recreation_ground|village_green|farmyard|plant_nursery|quarry|railway)$/;
const NATURAL = /^(wood|water|grassland|heath|scrub|wetland|bare_rock|sand)$/;
const LEISURE = /^(park|golf_course|pitch|garden|nature_reserve|stadium|track)$/;

/** Mêmes critères que `worldQuery` (overpass.ts) pour les voies et relations. */
export function keepWayOrRelation(t: Record<string, string>, isRelation: boolean): boolean {
  if (!isRelation && (t.highway || t['building:part'] || t.waterway || t.water)) return true;
  if (t.building) return true;
  if (t.landuse && LANDUSE.test(t.landuse)) return true;
  if (t.natural && NATURAL.test(t.natural)) return true;
  if (t.leisure && LEISURE.test(t.leisure)) return true;
  if (!isRelation && t.railway && /^(rail|light_rail|narrow_gauge)$/.test(t.railway)) return true;
  if (!isRelation && t.man_made && /^(bridge|tower|water_tower)$/.test(t.man_made)) return true;
  if (t.amenity === 'place_of_worship') return true;
  if (t.historic && /^(castle|monument|church|manor|ruins|memorial)$/.test(t.historic)) return true;
  return false;
}

/** Mêmes critères que `worldQuery` pour les nœuds isolés. */
export function keepNode(t: Record<string, string>): boolean {
  if (t.place) return true;
  if (t.natural && /^(peak|tree)$/.test(t.natural) && t.name) return true;
  if (t.amenity === 'place_of_worship') return true;
  if (t.historic && /^(castle|monument|church|manor|ruins|memorial)$/.test(t.historic)) return true;
  if (t.man_made && /^(tower|water_tower)$/.test(t.man_made)) return true;
  return false;
}

async function getJson(url: string, file: string): Promise<{ elements: ApiElement[] } | 'too-big'> {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as { elements: ApiElement[] };
  try {
    const buf = await fetchWithRetry(url, { timeoutMs: 120000, retries: 3, validate: (b) => (b.subarray(0, 1).toString() === '{' ? null : `pas du JSON : ${b.subarray(0, 120).toString()}`) });
    fs.writeFileSync(file, buf);
    return JSON.parse(buf.toString('utf8')) as { elements: ApiElement[] };
  } catch (err) {
    // Emprise trop riche (> 50 000 nœuds) : l'appelant la redécoupe.
    if (/HTTP 400/.test((err as Error).message)) return 'too-big';
    throw err;
  }
}

/** Télécharge une emprise (redécoupée en 4 si l'API la juge trop riche). */
async function fetchBox(b: BBox, out: Map<string, ApiElement>, depth = 0): Promise<void> {
  const bbox = `${b.west.toFixed(5)},${b.south.toFixed(5)},${b.east.toFixed(5)},${b.north.toFixed(5)}`;
  const res = await getJson(`${API}/map.json?bbox=${bbox}`, cachePath('osmapi', `map-${bbox.replace(/,/g, '_')}`, '.json'));
  if (res === 'too-big') {
    if (depth > 4) throw new Error(`emprise OSM trop riche même découpée : ${bbox}`);
    const mx = (b.west + b.east) / 2;
    const my = (b.south + b.north) / 2;
    for (const q of [
      { west: b.west, south: b.south, east: mx, north: my },
      { west: mx, south: b.south, east: b.east, north: my },
      { west: b.west, south: my, east: mx, north: b.north },
      { west: mx, south: my, east: b.east, north: b.north },
    ])
      await fetchBox(q, out, depth + 1);
    return;
  }
  for (const el of res.elements) out.set(`${el.type}/${el.id}`, el);
}

/**
 * Éléments OSM (format Overpass `out geom`) des blocs donnés, via l'API principale.
 * Les multipolygones retenus dont des membres manquent sont complétés un par un.
 */
export async function fetchOsmApi(chunks: BBox[], log: (s: string) => void = console.log): Promise<OsmElement[]> {
  const all = new Map<string, ApiElement>();
  for (const [i, c] of chunks.entries()) {
    await fetchBox(c, all);
    if ((i + 1) % 10 === 0 || i === chunks.length - 1) log(`   API OSM : ${i + 1}/${chunks.length} blocs, ${all.size} éléments`);
  }
  // complétion des multipolygones retenus
  const rels = [...all.values()].filter((e): e is ApiRelation => e.type === 'relation' && e.tags?.type === 'multipolygon' && keepWayOrRelation(e.tags, true));
  let completed = 0;
  for (const r of rels) {
    const missing = r.members.some((m) => m.type === 'way' && (!all.has(`way/${m.ref}`) || (all.get(`way/${m.ref}`) as ApiWay).nodes.some((n) => !all.has(`node/${n}`))));
    if (!missing) continue;
    const res = await getJson(`${API}/relation/${r.id}/full.json`, cachePath('osmapi', `rel-${r.id}`, '.json'));
    if (res === 'too-big') continue;
    for (const el of res.elements) if (!all.has(`${el.type}/${el.id}`) || el.type !== 'relation') all.set(`${el.type}/${el.id}`, el);
    completed++;
  }
  if (completed) log(`   API OSM : ${completed} multipolygone(s) complété(s)`);
  return toOverpass(all);
}

/** Conversion au format Overpass `out geom` (géométrie des voies et des membres de relation). */
export function toOverpass(all: Map<string, ApiElement>): OsmElement[] {
  const geom = (ids: number[]) =>
    ids.map((id) => {
      const n = all.get(`node/${id}`) as ApiNode | undefined;
      return n ? { lat: n.lat, lon: n.lon } : null;
    });
  const out: OsmElement[] = [];
  for (const el of all.values()) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      if (el.tags && keepNode(tags)) out.push({ type: 'node', id: el.id, lat: el.lat, lon: el.lon, tags });
    } else if (el.type === 'way') {
      if (keepWayOrRelation(tags, false)) out.push({ type: 'way', id: el.id, nodes: el.nodes, geometry: geom(el.nodes), tags } satisfies OsmWay);
    } else if (keepWayOrRelation(tags, true)) {
      const rel: OsmRelation = {
        type: 'relation',
        id: el.id,
        tags,
        members: el.members.map((m) => {
          if (m.type !== 'way') return { type: m.type, ref: m.ref, role: m.role };
          const w = all.get(`way/${m.ref}`) as ApiWay | undefined;
          return { type: 'way', ref: m.ref, role: m.role, ...(w ? { geometry: geom(w.nodes) } : {}) };
        }),
      };
      out.push(rel);
    }
  }
  return out;
}
