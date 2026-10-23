/**
 * Conversion des éléments OSM bruts en entités du monde (coordonnées monde x/z).
 */
import { wgs84ToWorld } from './frame.ts';
import { bboxOf, pointInRing, signedArea, type Box, type Pt } from './geom.ts';
import type { OsmElement, OsmRelation, OsmWay } from './overpass.ts';

export interface RoadWay {
  id: number;
  kind: string; // valeur highway=*
  name: string;
  ref: string;
  width: number;
  surface: string;
  paved: boolean;
  lanes: number;
  /** 1 : sens unique dans le sens des nœuds, −1 : sens inverse, 0 : double sens (pour les vélos). */
  oneway: number;
  bridge: boolean;
  tunnel: boolean;
  /** Anneau de giratoire (`junction=roundabout|circular`). */
  roundabout: boolean;
  layer: number;
  nodes: number[];
  pts: Pt[];
}

export interface Polygon {
  outer: Pt[];
  holes: Pt[][];
}

export interface AreaFeature {
  id: string; // "w123" / "r456"
  cat: 'forest' | 'field' | 'landuse' | 'water';
  kind: string;
  name?: string;
  polygons: Polygon[];
  box: Box;
}

export interface BuildingFeature {
  id: string;
  kind: string;
  height: number;
  levels: number;
  minHeight: number;
  roofShape: string;
  roofHeight: number;
  roofColour?: string;
  colour?: string;
  material?: string;
  name?: string;
  polygons: Polygon[];
  centroid: Pt;
}

export interface LineFeature {
  id: number;
  cat: 'waterway' | 'railway';
  kind: string;
  name?: string;
  width: number;
  tunnel: boolean;
  bridge: boolean;
  pts: Pt[];
}

export interface Poi {
  id: string;
  kind: string; // village, hamlet, town, peak, church, castle…
  name: string;
  x: number;
  z: number;
  ele?: number;
  population?: number;
}

export interface OsmWorld {
  roads: RoadWay[];
  buildings: BuildingFeature[];
  areas: AreaFeature[];
  lines: LineFeature[];
  pois: Poi[];
}

function toPt(g: { lat: number; lon: number }): Pt {
  const p = wgs84ToWorld(g.lon, g.lat);
  return [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100];
}

function wayPts(w: OsmWay | { geometry?: Array<{ lat: number; lon: number } | null> }): Pt[] | null {
  const g = w.geometry;
  if (!g || g.length < 2 || g.some((p) => p === null)) return null;
  return (g as Array<{ lat: number; lon: number }>).map(toPt);
}

export function parseNumber(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?/i.exec(v);
  if (!m) return null;
  let n = parseFloat(m[1]!.replace(',', '.'));
  if (m[2] && /ft|'/i.test(m[2])) n *= 0.3048;
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_WIDTH: Record<string, number> = {
  motorway: 11,
  trunk: 9,
  primary: 7,
  secondary: 6.5,
  tertiary: 6,
  unclassified: 5,
  residential: 5,
  living_street: 4.5,
  service: 3.5,
  motorway_link: 5,
  trunk_link: 5,
  primary_link: 5,
  secondary_link: 5,
  tertiary_link: 4.5,
  track: 3,
  cycleway: 2.5,
  path: 1.5,
  footway: 1.5,
  bridleway: 2,
  pedestrian: 4,
  steps: 1.5,
};

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'paving_stones', 'sett', 'chipseal', 'cobblestone', 'metal', 'wood']);
const UNPAVED_DEFAULT = new Set(['track', 'path', 'footway', 'bridleway', 'steps']);

export function roadWidth(tags: Record<string, string>): number {
  const kind = tags.highway ?? '';
  const w = parseNumber(tags.width ?? tags['est_width']);
  if (w && w > 1 && w < 30) return w;
  const lanes = parseNumber(tags.lanes);
  if (lanes && lanes >= 1 && lanes <= 8 && kind !== 'service') return Math.max(DEFAULT_WIDTH[kind] ?? 4, lanes * 3);
  return DEFAULT_WIDTH[kind] ?? 4;
}

/** Assemble des morceaux de lignes en anneaux fermés (multipolygones). */
export function assembleRings(parts: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const open: Pt[][] = [];
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  for (const p of parts) {
    if (p.length < 2) continue;
    if (key(p[0]!) === key(p[p.length - 1]!)) rings.push(p.slice(0, -1));
    else open.push(p.slice());
  }
  while (open.length) {
    let cur = open.pop()!;
    let progress = true;
    while (progress && key(cur[0]!) !== key(cur[cur.length - 1]!)) {
      progress = false;
      const end = key(cur[cur.length - 1]!);
      for (let i = 0; i < open.length; i++) {
        const o = open[i]!;
        if (key(o[0]!) === end) {
          cur = cur.concat(o.slice(1));
        } else if (key(o[o.length - 1]!) === end) {
          cur = cur.concat(o.slice().reverse().slice(1));
        } else continue;
        open.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (key(cur[0]!) === key(cur[cur.length - 1]!) && cur.length >= 4) rings.push(cur.slice(0, -1));
  }
  return rings.filter((r) => r.length >= 3);
}

/** Anneau orienté : extérieur dans le sens trigonométrique (x/z), trous dans le sens horaire. */
function orient(r: Pt[], ccw: boolean): Pt[] {
  const a = signedArea(r);
  return (a > 0) === ccw ? r : r.slice().reverse();
}

function relationPolygons(rel: OsmRelation): Polygon[] {
  const outers: Pt[][] = [];
  const inners: Pt[][] = [];
  const outerParts: Pt[][] = [];
  const innerParts: Pt[][] = [];
  for (const m of rel.members) {
    if (m.type !== 'way') continue;
    const pts = wayPts(m);
    if (!pts) continue;
    (m.role === 'inner' ? innerParts : outerParts).push(pts);
  }
  outers.push(...assembleRings(outerParts));
  inners.push(...assembleRings(innerParts));
  const polys: Polygon[] = outers.map((o) => ({ outer: orient(o, true), holes: [] }));
  for (const h of inners) {
    const p0 = h[0]!;
    const host = polys.find((p) => pointInRing(p0[0], p0[1], p.outer));
    if (host) host.holes.push(orient(h, false));
  }
  return polys;
}

function closedWayPolygon(w: OsmWay): Polygon[] {
  const pts = wayPts(w);
  if (!pts || pts.length < 4) return [];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) return [];
  return [{ outer: orient(pts.slice(0, -1), true), holes: [] }];
}

function forestKind(tags: Record<string, string>): string {
  const lt = tags.leaf_type ?? '';
  if (lt === 'needleleaved') return 'conifer';
  if (lt === 'mixed') return 'mixed';
  if (lt === 'broadleaved') return 'deciduous';
  return tags.wood === 'coniferous' ? 'conifer' : tags.wood === 'mixed' ? 'mixed' : 'deciduous';
}

function areaClass(tags: Record<string, string>): { cat: AreaFeature['cat']; kind: string } | null {
  const lu = tags.landuse;
  const nat = tags.natural;
  const le = tags.leisure;
  if (lu === 'forest' || nat === 'wood') return { cat: 'forest', kind: forestKind(tags) };
  if (nat === 'water' || lu === 'reservoir' || lu === 'basin') {
    const w = tags.water ?? lu ?? '';
    const kind = w === 'river' || w === 'canal' || w === 'stream' ? 'river' : w === 'pond' ? 'pond' : w === 'reservoir' || w === 'basin' ? 'reservoir' : w === 'lake' ? 'lake' : 'pond';
    return { cat: 'water', kind };
  }
  if (tags.water && !lu && !nat) return { cat: 'water', kind: tags.water === 'river' ? 'river' : 'pond' };
  const fieldKinds: Record<string, string> = {
    farmland: 'farmland',
    meadow: 'meadow',
    grass: 'grass',
    orchard: 'orchard',
    vineyard: 'vineyard',
    allotments: 'allotments',
    village_green: 'grass',
    plant_nursery: 'orchard',
  };
  if (lu && fieldKinds[lu]) return { cat: 'field', kind: fieldKinds[lu]! };
  const natKinds: Record<string, string> = { grassland: 'meadow', heath: 'heath', scrub: 'scrub', wetland: 'wetland', bare_rock: 'bare', sand: 'sand', beach: 'sand', scree: 'scree', shingle: 'scree', glacier: 'glacier' };
  if (nat && natKinds[nat]) return { cat: 'field', kind: natKinds[nat]! };
  const luKinds: Record<string, string> = {
    residential: 'residential',
    industrial: 'industrial',
    commercial: 'commercial',
    retail: 'commercial',
    cemetery: 'cemetery',
    recreation_ground: 'park',
    farmyard: 'farmyard',
    quarry: 'quarry',
    railway: 'railway',
  };
  if (lu && luKinds[lu]) return { cat: 'landuse', kind: luKinds[lu]! };
  const leKinds: Record<string, string> = { park: 'park', golf_course: 'golf', pitch: 'pitch', garden: 'garden', stadium: 'pitch', track: 'pitch', nature_reserve: '' };
  if (le && leKinds[le]) return { cat: 'landuse', kind: leKinds[le]! };
  return null;
}

const BUILDING_KIND: Record<string, string> = {
  house: 'house',
  detached: 'house',
  semidetached_house: 'house',
  terrace: 'house',
  bungalow: 'house',
  residential: 'house',
  yes: 'house',
  apartments: 'apartments',
  dormitory: 'apartments',
  church: 'church',
  cathedral: 'church',
  chapel: 'chapel',
  religious: 'chapel',
  farm: 'farm',
  farm_auxiliary: 'barn',
  barn: 'barn',
  stable: 'barn',
  cowshed: 'barn',
  shed: 'shed',
  hut: 'shed',
  cabin: 'shed',
  garage: 'garage',
  garages: 'garage',
  carport: 'garage',
  industrial: 'industrial',
  warehouse: 'industrial',
  manufacture: 'industrial',
  commercial: 'commercial',
  retail: 'commercial',
  supermarket: 'commercial',
  office: 'commercial',
  school: 'public',
  university: 'public',
  college: 'public',
  public: 'public',
  civic: 'public',
  townhall: 'public',
  government: 'public',
  hospital: 'public',
  train_station: 'public',
  sports_hall: 'public',
  castle: 'castle',
  palace: 'castle',
  manor: 'castle',
  greenhouse: 'greenhouse',
  roof: 'roof',
  ruins: 'ruins',
  tower: 'tower',
  water_tower: 'tower',
};

const DEFAULT_LEVELS: Record<string, number> = {
  house: 2,
  apartments: 4,
  farm: 2,
  barn: 1,
  shed: 1,
  garage: 1,
  industrial: 1,
  commercial: 2,
  public: 2,
  castle: 3,
  greenhouse: 1,
  roof: 1,
  ruins: 1,
};

const DEFAULT_ROOF: Record<string, string> = {
  house: 'gabled',
  apartments: 'hipped',
  church: 'gabled',
  chapel: 'gabled',
  farm: 'gabled',
  barn: 'gabled',
  shed: 'gabled',
  garage: 'flat',
  industrial: 'flat',
  commercial: 'flat',
  public: 'hipped',
  castle: 'hipped',
  greenhouse: 'gabled',
  roof: 'flat',
  ruins: 'flat',
  tower: 'flat',
};

function buildingFromTags(id: string, tags: Record<string, string>, polygons: Polygon[]): BuildingFeature | null {
  if (!polygons.length) return null;
  let kind = BUILDING_KIND[tags.building ?? 'yes'] ?? 'house';
  if (tags.amenity === 'place_of_worship' && (kind === 'house' || kind === 'public')) kind = 'church';
  if (tags.historic === 'castle' && kind === 'house') kind = 'castle';
  const areaM2 = Math.abs(signedArea(polygons[0]!.outer));
  if (kind === 'house' && tags.building === 'yes' && areaM2 > 600) kind = 'commercial';
  if (kind === 'house' && areaM2 < 18) kind = 'shed';
  const levelsTag = parseNumber(tags['building:levels']);
  const roofLevels = parseNumber(tags['roof:levels']) ?? 0;
  let levels = levelsTag ?? DEFAULT_LEVELS[kind] ?? 2;
  if (kind === 'church' && levelsTag === null) levels = 4;
  if (kind === 'chapel' && levelsTag === null) levels = 2;
  const roofShape = tags['roof:shape'] ?? DEFAULT_ROOF[kind] ?? 'gabled';
  const roofHeightTag = parseNumber(tags['roof:height']);
  const minHeight = parseNumber(tags.min_height) ?? (parseNumber(tags['building:min_level']) ?? 0) * 3;
  const levelH = kind === 'industrial' ? 5 : kind === 'barn' ? 4.5 : kind === 'church' ? 4 : 3;
  let height = parseNumber(tags.height ?? tags['building:height']);
  let roofHeight: number;
  if (height !== null) {
    roofHeight = roofHeightTag ?? (roofShape === 'flat' ? 0 : Math.min(height * 0.35, 6));
  } else {
    const wall = levels * levelH;
    roofHeight = roofHeightTag ?? (roofShape === 'flat' ? 0 : roofLevels > 0 ? roofLevels * 2.5 : Math.min(2.5 + Math.sqrt(areaM2) * 0.12, 6));
    height = wall + roofHeight;
  }
  if (height < 2) height = 2;
  // centroïde de l'anneau extérieur principal
  const o = polygons[0]!.outer;
  let cx = 0;
  let cz = 0;
  for (const p of o) {
    cx += p[0];
    cz += p[1];
  }
  const b: BuildingFeature = {
    id,
    kind,
    height: Math.round(height * 10) / 10,
    levels,
    minHeight,
    roofShape,
    roofHeight: Math.round(roofHeight * 10) / 10,
    polygons,
    centroid: [cx / o.length, cz / o.length],
  };
  if (tags['roof:colour']) b.roofColour = tags['roof:colour'];
  if (tags['building:colour']) b.colour = tags['building:colour'];
  if (tags['building:material']) b.material = tags['building:material'];
  if (tags.name) b.name = tags.name;
  return b;
}

const SKIP_HIGHWAY = new Set(['proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'corridor', 'raceway', 'abandoned', 'razed', 'disused', 'services', 'rest_area']);

export function buildOsmWorld(elements: OsmElement[]): OsmWorld {
  const world: OsmWorld = { roads: [], buildings: [], areas: [], lines: [], pois: [] };
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      const p = wgs84ToWorld(el.lon, el.lat);
      const name = tags.name ?? '';
      let kind = '';
      if (tags.place) kind = tags.place;
      else if (tags.natural === 'peak') kind = 'peak';
      else if (tags.amenity === 'place_of_worship') kind = tags.building === 'chapel' ? 'chapel' : 'church';
      else if (tags.historic) kind = tags.historic;
      else if (tags.man_made) kind = tags.man_made;
      else if (tags.natural === 'tree') kind = 'tree';
      else if (tags.natural === 'saddle' || tags.mountain_pass === 'yes') kind = 'saddle';
      if (!kind || (!name && kind !== 'church')) continue;
      const poi: Poi = { id: `n${el.id}`, kind, name, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
      const ele = parseNumber(tags.ele);
      if (ele !== null) poi.ele = ele;
      const pop = parseNumber(tags.population);
      if (pop !== null) poi.population = pop;
      world.pois.push(poi);
      continue;
    }
    if (el.type === 'way') {
      if (tags.highway && !SKIP_HIGHWAY.has(tags.highway) && tags.area !== 'yes') {
        const pts = wayPts(el);
        if (!pts) continue;
        const surface = tags.surface ?? '';
        const paved = surface ? PAVED.has(surface) : !UNPAVED_DEFAULT.has(tags.highway) || tags.tracktype === 'grade1';
        let oneway = tags.oneway === 'yes' || tags.oneway === '1' ? 1 : tags.oneway === '-1' ? -1 : 0;
        if (tags.junction === 'roundabout' && tags.oneway !== 'no') oneway = 1;
        if (tags.highway === 'motorway' && tags.oneway !== 'no') oneway = 1;
        if (tags['oneway:bicycle'] === 'no' || tags['cycleway'] === 'opposite' || tags['cycleway'] === 'opposite_lane') oneway = 0;
        world.roads.push({
          id: el.id,
          kind: tags.highway,
          name: tags.name ?? '',
          ref: tags.ref ?? '',
          width: roadWidth(tags),
          surface: surface || (paved ? 'asphalt' : 'unpaved'),
          paved,
          lanes: parseNumber(tags.lanes) ?? 0,
          oneway,
          bridge: !!tags.bridge && tags.bridge !== 'no',
          tunnel: !!tags.tunnel && tags.tunnel !== 'no',
          roundabout: tags.junction === 'roundabout' || tags.junction === 'circular',
          layer: parseNumber(tags.layer) ?? 0,
          nodes: el.nodes,
          pts,
        });
        continue;
      }
      if (tags.building && tags.building !== 'no') {
        const b = buildingFromTags(`w${el.id}`, tags, closedWayPolygon(el));
        if (b) world.buildings.push(b);
        continue;
      }
      if (tags.waterway || (tags.railway && /^(rail|light_rail|narrow_gauge)$/.test(tags.railway))) {
        const pts = wayPts(el);
        if (!pts) continue;
        if (tags.waterway) {
          const ww = tags.waterway;
          if (ww === 'riverbank' || ww === 'dam' || ww === 'weir' || ww === 'lock_gate') continue;
          const width = parseNumber(tags.width) ?? (ww === 'river' ? 8 : ww === 'canal' ? 6 : ww === 'stream' ? 2 : 1);
          const lf: LineFeature = { id: el.id, cat: 'waterway', kind: ww, width, tunnel: !!tags.tunnel && tags.tunnel !== 'no', bridge: false, pts };
          if (tags.name) lf.name = tags.name;
          world.lines.push(lf);
        } else {
          world.lines.push({
            id: el.id,
            cat: 'railway',
            kind: tags.railway!,
            width: tags.railway === 'rail' ? 3.5 : 3,
            tunnel: !!tags.tunnel && tags.tunnel !== 'no',
            bridge: !!tags.bridge && tags.bridge !== 'no',
            pts,
            ...(tags.name ? { name: tags.name } : {}),
          });
        }
        continue;
      }
      const ac = areaClass(tags);
      if (ac && ac.kind) {
        const polys = closedWayPolygon(el);
        if (!polys.length) continue;
        const a: AreaFeature = { id: `w${el.id}`, cat: ac.cat, kind: ac.kind, polygons: polys, box: bboxOf(polys[0]!.outer) };
        if (tags.name) a.name = tags.name;
        world.areas.push(a);
      }
      // églises cartographiées comme surfaces sans bâtiment : point d'intérêt
      if (tags.amenity === 'place_of_worship' || tags.historic === 'castle') {
        const pts = wayPts(el);
        if (pts) {
          const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length] as Pt, [0, 0] as Pt);
          world.pois.push({ id: `w${el.id}`, kind: tags.amenity === 'place_of_worship' ? 'church' : 'castle', name: tags.name ?? '', x: Math.round(c[0] * 10) / 10, z: Math.round(c[1] * 10) / 10 });
        }
      }
      continue;
    }
    if (el.type === 'relation') {
      if (tags.type !== 'multipolygon') continue;
      if (tags.building && tags.building !== 'no') {
        const b = buildingFromTags(`r${el.id}`, tags, relationPolygons(el));
        if (b) world.buildings.push(b);
        continue;
      }
      const ac = areaClass(tags);
      if (!ac || !ac.kind) continue;
      const polys = relationPolygons(el);
      if (!polys.length) continue;
      const all = polys.flatMap((p) => p.outer);
      const a: AreaFeature = { id: `r${el.id}`, cat: ac.cat, kind: ac.kind, polygons: polys, box: bboxOf(all) };
      if (tags.name) a.name = tags.name;
      world.areas.push(a);
    }
  }
  return world;
}
