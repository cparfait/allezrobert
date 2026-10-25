/**
 * Construction d'un monde ouvert (aucune donnée Garmin) :
 *   pnpm --filter @allezrobert/terrain build:world -- --world limagne [--no-ortho] [--offline]
 *
 * 1. OSM : Overpass si un miroir répond, sinon l'API principale d'OpenStreetMap (blocs, cache).
 * 2. MNT IGN : LiDAR HD 1 m (repli RGE ALTI) sur toute l'emprise, 8 m autour, 100 m pour l'horizon.
 * 3. Profils 3D de toutes les routes, creusés dans le terrain (chaque tuile en haute résolution).
 * 4. Graphe routier roulable (`graph.json`) : le profil de chaque arête est exactement celui
 *    qui est creusé, les carrefours partagent une altitude unique.
 * 5. Tours proposés (boucles par des villages) construits sur ce graphe, comme le mode ouvert.
 * 6. Tuiles, orthophotos IGN (≈ 1 m/px), horizon, world.json.
 *
 * Monde `garmin` ou `climb` avec un bloc `open` (Chevreuse, Alpe d’Huez, Ventoux) : même chaîne, sans
 * tours ; les itinéraires déjà publiés (`routes/*.json`, entrées de `world.json`) sont gardés tels
 * quels, recalés sur le graphe et creusés en priorité, et le graphe suit leur profil là où ils passent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OpenPath, RoadNet, type RoadGraphData, type RoadGraphEdge, type RouteData, type RouteSegment, type WorldMeta } from '@allezrobert/shared';
import { startOnRoad } from './open-start.ts';
import { PLACES_FILE, placesOf } from './places.ts';
import { ATTRIBUTION, ATTRIBUTION_ORTHO, CORRIDOR_TILES, GARMIN_DIR, LOD_HI, LOD_LO, ORIGIN_L93, OUT_DIR, PRIVACY_RADIUS_M, QUALITY, TILE_SIZE_M, WORLD, worldEnrich, type LonLat, type OpenTour } from './config.ts';
import { asCircuit } from './circuit.ts';
import { nearestEdgeOf, routeViaEdges } from './climb.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { Dem, DemStack, setSeaMode } from './dem.ts';
import { tileRect, wgs84ToWorld, worldToL93, type Rect } from './frame.ts';
import { simplify3 } from './geom.ts';
import { RoadGraph, type Edge } from './graph.ts';
import { writeHorizon } from './horizon.ts';
import { setOffline } from './net.ts';
import { buildOsmWorld } from './osm.ts';
import { coastClauses, fetchOsm, fetchOsmApi, reachableOverpass } from './overpass.ts';
import { detectClimbs, elevationGain } from './profile.ts';
import { loadRides, sensitivePoints } from './gpx.ts';
import { matchRide } from './mapmatch.ts';
import { auditWorldDir } from './privacy.ts';
import { buildRoads3d, type RouteOnGraph } from './roads3d.ts';
import { ATTRIBUTION_BDTOPO } from './bdtopo.ts';
import { bdTopoRoadAttrs, prepareEnrichment, type TileEnrichment } from './enrich.ts';
import { ATTRIBUTION_LIDAR } from './lidar.ts';
import { frenchDe } from './route.ts';
import type { TileResult } from './tiles.ts';
import { writeWorldTiles } from './world-tiles.ts';
import { WORLDS_ROOT, writeCatalogue } from './packs.ts';

if (WORLD.kind !== 'open' && !WORLD.open) throw new Error('build-open : monde de type « open » ou avec un bloc « open » attendu');
const W = WORLD;
/** Monde garmin ou montée ouvert autour de ses itinéraires publiés : gardés, pas de tours. */
const KEEP = W.kind !== 'open';
const TOURS: OpenTour[] = W.kind === 'open' ? W.tours : [];
const START: LonLat = W.kind === 'open' ? W.start : W.open!.start;
const ORTHO_PX = W.kind === 'open' ? W.orthoPx : QUALITY.orthoPx.hi;
const HORIZON = W.kind === 'garmin' ? { halfSizeM: 30000, resM: 100 } : W.horizon;
/** Données fines IGN (qualité standard sauf réglage du monde). */
const ENRICH = worldEnrich(W);

const args = new Set(process.argv.slice(2));
const WITH_ORTHO = !args.has('--no-ortho');
/** Seulement `graph.json` (raccord des zones voisines) : ni tours, ni tuiles, ni horizon. */
const GRAPH_ONLY = args.has('--graph-only');
if (args.has('--offline')) setOffline(true);
if (W.sea) setSeaMode(true);

/** Voies roulables en mode ouvert (chemins agricoles compris, pas les sentiers piétons). */
const RIDEABLE = /^(primary|secondary|tertiary|unclassified|residential|living_street|service|track|cycleway)(_link)?$/;
/** Marge au bord du monde : une arête qui en sort n'est pas roulable (cul-de-sac au bord). */
const EDGE_MARGIN_M = 30;

const r2 = (v: number) => Math.round(v * 100) / 100;

function log(s: string): void {
  console.log(s);
}

function worldRect(): Rect {
  return {
    minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
    minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
    maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
    maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
  };
}

async function ensureRect(dem: Dem, r: Rect): Promise<void> {
  const a = worldToL93(r.minX, r.maxZ);
  const b = worldToL93(r.maxX, r.minZ);
  await dem.ensure(a.e, a.n, b.e - 1e-6, b.n - 1e-6);
}

function toWorld(p: LonLat): [number, number] {
  const w = wgs84ToWorld(p.lon, p.lat);
  return [w.x, w.z];
}

async function main(): Promise<void> {
  const t0 = Date.now();
  fs.mkdirSync(path.join(OUT_DIR, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'tiles'), { recursive: true });
  const rect = worldRect();
  const tiles: Array<[number, number]> = [];
  for (let tx = CORRIDOR_TILES.txMin; tx <= CORRIDOR_TILES.txMax; tx++) for (let tz = CORRIDOR_TILES.tzMin; tz <= CORRIDOR_TILES.tzMax; tz++) tiles.push([tx, tz]);
  const hiSet = new Set(tiles.map(([tx, tz]) => `${tx}_${tz}`));

  // 1. OSM
  log(`1. OpenStreetMap — ${W.name}`);
  const bbox = corridorWgs84();
  const mirror = await reachableOverpass();
  log(mirror ? `   Overpass : ${new URL(mirror).host}` : '   aucun miroir Overpass joignable : API OpenStreetMap');
  const els = mirror ? await fetchOsm(bbox, OSM_CHUNK.lon, OSM_CHUNK.lat, W.sea ? coastClauses : undefined) : await fetchOsmApi(bbox);
  const osm = buildOsmWorld(els);
  log(`   ${els.length} éléments → ${osm.roads.length} voies, ${osm.buildings.length} bâtiments, ${osm.areas.length} surfaces, ${osm.lines.length} lignes, ${osm.pois.length} lieux`);
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));
  log(`   graphe OSM : ${g.edges.length} arêtes, ${g.adj.size} nœuds`);

  // 1 bis. itinéraires publiés gardés (monde garmin ou montée) : recalés sur le graphe
  const prevMeta: WorldMeta | null = KEEP ? (JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as WorldMeta) : null;
  const kept: RouteOnGraph[] = [];
  for (const ref of prevMeta?.routes ?? []) {
    const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, ref.file), 'utf8')) as RouteData;
    const m = matchRide(g, data.points.map((p) => ({ lat: 0, lon: 0, ele: p.y, t: NaN, x: p.x, z: p.z })));
    if (!m.matched.length) throw new Error(`${ref.id} : itinéraire hors du réseau OSM`);
    const edgeOf: number[] = [];
    let k = 0;
    for (let i = 0; i < data.points.length; i++) {
      while (k + 1 < m.matched.length && m.matched[k + 1]!.idx <= i) k++;
      edgeOf.push(m.matched[k]!.edge);
    }
    kept.push({ route: data, edgeOf, priority: ref.main ? 2 : 1 });
    const far = m.matched.filter((p) => p.d > 8).length;
    log(`   itinéraire gardé ${data.name} : ${new Set(edgeOf).size} arêtes${far ? `, ${far} points à plus de 8 m d’une route OSM` : ''}`);
  }

  // 2. MNT
  log('2. MNT IGN (LiDAR HD sur toute l’emprise)');
  const lo = new Dem('lo', LOD_LO.resM, 8000);
  await ensureRect(lo, { minX: rect.minX - 2000, minZ: rect.minZ - 2000, maxX: rect.maxX + 2000, maxZ: rect.maxZ + 2000 });
  const hi = new Dem('hi', 1, 1000);
  for (const [tx, tz] of tiles) await ensureRect(hi, tileRect(tx, tz));
  const dem = new DemStack([hi, lo]);
  log(`   lo : ${JSON.stringify(lo.stats)} ; hi : ${JSON.stringify(hi.stats)}`);

  // 3. profils 3D
  log('3. Profils des routes');
  const r3 = buildRoads3d(g, dem, kept, { routeEdgeProfiles: true });
  log(`   ${r3.roads.length} tronçons, ${r3.carve.length} couloirs creusés`);

  // 3 bis. données fines IGN sur toute l'emprise : arbres et haies (MNH LiDAR HD), bâtiments
  // BD TOPO (toits mesurés au MNS), nature et largeur des voies
  let enrichment: Map<string, TileEnrichment> | undefined;
  if (ENRICH) {
    log('3 bis. LiDAR HD (végétation, toits) et BD TOPO (bâtiments, voies)');
    const roadPts = g.edges.flatMap((e) => e.pts.filter((_, i) => i % 4 === 0));
    // graphe seul : nature et largeur des voies BD TOPO, sans végétation ni bâtiments
    const enrich = GRAPH_ONLY ? { ...ENRICH, lidarVegetation: false, bdtopoBuildings: false } : ENRICH;
    enrichment = await prepareEnrichment({ enrich, tiles, routePts: roadPts, roads: osm.roads, dem, log });
  }
  const tileOf = (x: number, z: number) => `${Math.floor(x / TILE_SIZE_M)}_${Math.floor(z / TILE_SIZE_M)}`;

  // 4. graphe roulable
  log('4. Graphe roulable');
  const within = (p: [number, number, number], m: number) => p[0] > rect.minX + m && p[0] < rect.maxX - m && p[2] > rect.minZ + m && p[2] < rect.maxZ - m;
  const inside = (pts: Array<[number, number, number]>) => pts.every((p) => within(p, EDGE_MARGIN_M));
  // arêtes au bord : exportées marquées (zones voisines), jamais prises par les tours
  const touches = (pts: Array<[number, number, number]>) => pts.some((p) => within(p, 0));
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const osmIds: number[] = [];
  const edges: RoadGraphEdge[] = [];
  const edgeIndex = new Map<number, number>();
  const nodeOf = (osmId: number, p: [number, number, number]) => {
    let i = nodeIndex.get(osmId);
    if (i === undefined) {
      i = nodes.length / 3;
      nodeIndex.set(osmId, i);
      nodes.push(r2(p[0]), r2(p[1]), r2(p[2]));
      osmIds.push(osmId);
    }
    return i;
  };
  for (const e of g.edges) {
    if (!RIDEABLE.test(e.road.kind)) continue;
    const pts3 = r3.edgePts.get(e.id);
    if (!pts3 || pts3.length < 2 || !touches(pts3)) continue;
    const border = !inside(pts3);
    const simple = simplify3(pts3, 0.1, 0.02);
    // revêtement et largeur BD TOPO (chemins empierrés, de terre) : physique et son du mode ouvert
    const mid = pts3[pts3.length >> 1]!;
    const fine = enrichment?.get(tileOf(mid[0], mid[2]));
    const bd = fine ? bdTopoRoadAttrs(pts3.flat(), fine.roads) : null;
    const a = nodeOf(e.a, pts3[0]!);
    const b = nodeOf(e.b, pts3[pts3.length - 1]!);
    if (a === b) continue;
    if (!border) edgeIndex.set(e.id, edges.length);
    edges.push({
      a,
      b,
      kind: e.road.kind,
      ...(e.road.name ? { name: e.road.name } : {}),
      ...(e.road.ref ? { ref: e.road.ref } : {}),
      width: bd?.width ?? e.road.width,
      surface: bd?.surface ?? e.road.surface,
      oneway: e.oneway as 0 | 1 | -1,
      len: r2(e.len),
      pts: simple.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]),
      ...(border ? { border: 1 as const } : {}),
    });
  }
  const graph: RoadGraphData = { formatVersion: 1, nodes, edges, attribution: [...ATTRIBUTION], osm: osmIds };
  const net = new RoadNet(graph);
  const graphFile = path.join(OUT_DIR, 'graph.json');
  fs.writeFileSync(graphFile, JSON.stringify(graph));
  const km = edges.reduce((s, e) => s + e.len, 0) / 1000;
  const paved = edges.filter((e) => /^(asphalt|paved|concrete|chipseal)/.test(e.surface)).reduce((s, e) => s + e.len, 0) / 1000;
  log(`   ${edges.length} arêtes (${edges.filter((e) => e.border).length} au bord), ${nodes.length / 3} nœuds, ${km.toFixed(0)} km roulables (dont ${paved.toFixed(0)} km revêtus) — ${(fs.statSync(graphFile).size / 1e6).toFixed(1)} Mo`);
  if (GRAPH_ONLY) return;

  // 5. tours proposés
  log('5. Tours proposés');
  const routes: RouteData[] = [];
  for (const tour of TOURS) {
    const route = buildTour(tour, g, net, edgeIndex, osm.pois);
    routes.push(route);
    fs.writeFileSync(path.join(OUT_DIR, 'routes', `${route.id}.json`), JSON.stringify(route));
    log(`   ${route.name} : ${(route.lengthM / 1000).toFixed(2)} km, D+ ${route.elevationGainM.toFixed(0)} m, ${route.segments.length} montée(s), repères ${route.landmarks?.map((l) => l.name).join(', ')}`);
  }

  // 5 bis. villes, villages et hameaux : noms sur la carte d'itinéraire du menu
  const places = placesOf(osm.pois);
  fs.writeFileSync(path.join(OUT_DIR, PLACES_FILE), JSON.stringify(places));
  log(`   ${places.length} lieux nommés (${PLACES_FILE})`);

  // 6. tuiles
  log(`6. Tuiles (${tiles.length}, toutes en haute résolution${WITH_ORTHO ? `, orthophotos ${ORTHO_PX} px` : ''})`);
  const tileResults: TileResult[] = await writeWorldTiles({
    g,
    dem,
    dems: { lo, hi },
    osm,
    routes: kept,
    roads3d: r3,
    // lacets des montées : itinéraire creusé par passes, comme build-climb
    ...(W.kind === 'climb' ? { carveMode: 'passes' as const } : {}),
    tiles,
    hiTiles: hiSet,
    outDir: OUT_DIR,
    withOrtho: WITH_ORTHO,
    orthoPx: ORTHO_PX,
    ...(enrichment ? { enrichment } : {}),
    log,
  });
  const horizon = await writeHorizon(HORIZON.halfSizeM, HORIZON.resM, OUT_DIR, log, WITH_ORTHO);
  // départ recalé sur une vraie route proche (le jeu prend l’arête la plus proche, même une piste)
  const [sx, sz] = toWorld(START);
  const onRoad = startOnRoad(edges, sx, sz);
  const start: [number, number] = onRoad ? [onRoad.x, onRoad.z] : [sx, sz];
  log(onRoad ? `   départ libre : ${onRoad.edge.name ?? onRoad.edge.ref ?? onRoad.edge.kind} (${onRoad.edge.kind}, ${onRoad.edge.width} m), à ${onRoad.dist.toFixed(0)} m du point demandé` : '   ! départ libre : aucune route de départ correcte à moins de 300 m');
  const meta: WorldMeta = {
    formatVersion: 1,
    id: W.id,
    name: W.name,
    crs: 'EPSG:2154',
    originL93: { x: ORIGIN_L93.x, y: ORIGIN_L93.y },
    bounds: rect,
    tileSizeM: TILE_SIZE_M,
    heightResolutionM: LOD_HI.resM,
    heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
    lods: [
      { id: 'lo', resolutionM: LOD_LO.resM, n: LOD_LO.n, suffix: '.lo.u16' },
      { id: 'hi', resolutionM: LOD_HI.resM, n: LOD_HI.n, suffix: '.hi.u16' },
    ],
    tiles: tileResults.map((t) => ({ id: t.id, tx: t.tx, tz: t.tz, baseM: t.baseM, minM: t.minM, maxM: t.maxM, lods: t.lods as Array<'lo' | 'hi' | 'ortho'>, bytes: t.bytes, ...(t.stepM !== 0.01 ? { stepM: t.stepM } : {}) })),
    routes: prevMeta?.routes ?? routes.map((r, i) => ({ id: r.id, file: `routes/${r.id}.json`, name: r.name, lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop, main: i === 0 })),
    mainRoute: prevMeta?.mainRoute ?? routes[0]?.id ?? '',
    attribution: [...new Set([
      ...(prevMeta?.attribution ?? []),
      ...ATTRIBUTION,
      ...(WITH_ORTHO ? [ATTRIBUTION_ORTHO] : []),
      ...(ENRICH?.lidarVegetation || ENRICH?.bdtopoBuildings ? [ATTRIBUTION_LIDAR] : []),
      ...(ENRICH?.bdtopoBuildings ? [ATTRIBUTION_BDTOPO] : []),
    ])],
    horizon,
    open: { graph: 'graph.json', start: { x: r2(start[0]), z: r2(start[1]) }, places: PLACES_FILE },
    ...(W.sea ? { sea: { levelM: 0 } } : {}),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'world.json'), JSON.stringify(meta, null, 1));
  // monde des sorties Garmin : même garde-fou vie privée que build-world (tuiles, emprise, itinéraires)
  if (W.kind === 'garmin' && fs.existsSync(GARMIN_DIR)) {
    const violations = auditWorldDir(OUT_DIR, sensitivePoints(loadRides(GARMIN_DIR)), PRIVACY_RADIUS_M);
    if (violations.length) throw new Error(`Vie privée : ${violations.map((v) => `${v.what} (${v.distanceM} m)`).join(', ')}`);
    log('   vie privée : aucune sortie à moins de 2 km d’un départ ou d’une arrivée');
  }

  const sizes: Record<string, number> = {};
  const tilesDir = path.join(OUT_DIR, 'tiles');
  for (const f of fs.readdirSync(tilesDir)) {
    const ext = f.replace(/^[^.]+/, '');
    sizes[ext] = (sizes[ext] ?? 0) + fs.statSync(path.join(tilesDir, f)).size;
  }
  log('Bilan');
  log(`   ${meta.tiles.length} tuiles : ${Object.entries(sizes).map(([e, s]) => `*${e} ${(s / 1e6).toFixed(1)} Mo`).join(', ')}`);
  log(`   durée ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // pack de cartes et catalogue des zones (seulement pour le dossier publié du jeu)
  if (path.resolve(OUT_DIR) === path.join(WORLDS_ROOT, W.id)) writeCatalogue(log);
}

/**
 * Tour proposé : plus court chemin par les points de passage sur les routes revêtues, puis
 * chemin lissé construit exactement comme en mode ouvert (mêmes arêtes, mêmes profils).
 */
function buildTour(tour: OpenTour, g: RoadGraph, net: RoadNet, edgeIndex: Map<number, number>, pois: Array<{ kind: string; name: string; x: number; z: number }>): RouteData {
  // routes revêtues, pistes cyclables et voies de service (anneau de Longchamp, bois de Vincennes :
  // fermés aux voitures) ; les voies de service sont un peu pénalisées (parkings, cours privées)
  // pistes pavées (secteurs de Paris–Roubaix : la Trouée d'Arenberg est un « track » en pavés) comprises
  const cobbledTrack = (e: Edge) => e.road.kind === 'track' && /^(sett|cobblestone)$/.test(e.road.surface);
  const anyTrack = (e: Edge) => !!tour.allowTracks && e.road.kind === 'track' && edgeIndex.has(e.id);
  const usable = (e: Edge) => (edgeIndex.has(e.id) && e.road.paved && (/^(primary|secondary|tertiary|unclassified|residential|living_street|service|cycleway)(_link)?$/.test(e.road.kind) || cobbledTrack(e))) || anyTrack(e);
  const cost = (e: Edge) => (!usable(e) ? Infinity : e.road.kind === 'track' && !cobbledTrack(e) ? e.len * 3 : /^(primary|secondary)/.test(e.road.kind) ? e.len * 1.6 : e.road.kind === 'service' ? e.len * 1.4 : e.len);
  const place = (p: LonLat | string): [number, number] => {
    if (typeof p !== 'string') return toWorld(p);
    const poi = pois.find((q) => q.name === p && /^(village|town|hamlet|isolated_dwelling|locality)$/.test(q.kind));
    if (!poi) throw new Error(`${tour.routeId} : lieu OSM « ${p} » introuvable`);
    return [poi.x, poi.z];
  };
  const wps = [tour.start, ...tour.via, tour.start].map(place);
  // un point de passage sur un chemin (circuits balisés) : route revêtue la plus proche à 800 m,
  // sinon le point est sauté ; seul le départ est obligatoire
  const must: number[] = [];
  wps.forEach((p, i) => {
    let e = nearestEdgeOf(g, p[0], p[1], 300, usable);
    if (e < 0) e = nearestEdgeOf(g, p[0], p[1], 800, usable);
    if (e < 0) {
      if (i === 0 || i === wps.length - 1) throw new Error(`${tour.routeId} : départ sans route revêtue à moins de 800 m`);
      console.log(`   ! ${tour.routeId} : point de passage ${i} sans route revêtue à moins de 800 m, ignoré`);
      return;
    }
    must.push(e);
  });
  const via = routeViaEdges(g, must, cost);
  const path = new OpenPath(net);
  let node = via.start;
  const steps: Array<{ startD: number; endD: number; surface: string; width: number }> = [];
  for (const eid of via.edges) {
    const e = g.edges[eid]!;
    const forward = e.a === node;
    const s = path.add({ edge: edgeIndex.get(eid)!, forward });
    steps.push({ startD: s.startD, endD: s.endD, surface: e.road.surface || 'asphalt', width: e.road.width });
    node = forward ? e.b : e.a;
  }
  const points = path.pointsFrom(0);
  const hs = points.map((p) => p.y);
  const step = path.stepM;
  const lengthM = points[points.length - 1]!.d;
  const runs = <T extends string | number>(key: (s: (typeof steps)[number]) => T) => {
    const out: Array<{ startM: number; endM: number; v: T }> = [];
    for (const s of steps) {
      const v = key(s);
      const last = out[out.length - 1];
      if (last && last.v === v) last.endM = r2(Math.min(s.endD, lengthM));
      else out.push({ startM: r2(s.startD), endM: r2(Math.min(s.endD, lengthM)), v });
    }
    return out;
  };
  const surfaces = runs((s) => s.surface).map((r) => ({ startM: r.startM, endM: r.endM, surface: r.v }));
  const roadWidths = runs((s) => s.width).map((r) => ({ startM: r.startM, endM: r.endM, widthM: r.v }));
  const widths = steps.map((s) => s.width).sort((a, b) => a - b);
  // montées chronométrées : détection sur le profil (≥ 500 m à ≥ 3 %)
  const segments: RouteSegment[] = detectClimbs(hs, step, 500, 3).map((c, i) => ({
    id: `${tour.routeId}-kom-${i + 1}`,
    kind: 'kom',
    name: `Côte ${i + 1}`,
    startM: r2(c.startIdx * step),
    endM: r2(c.endIdx * step),
    avgGrade: r2(c.avgGrade),
  }));
  const landmarks: Array<{ name: string; d: number }> = [];
  for (const p of pois) {
    if (!/^(village|town|hamlet)$/.test(p.kind) || !p.name) continue;
    let bi = -1;
    let bd = /^(village|town)$/.test(p.kind) ? 400 : 200;
    for (let i = 0; i < points.length; i += 2) {
      const d = Math.hypot(points[i]!.x - p.x, points[i]!.z - p.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) landmarks.push({ name: p.name, d: r2(points[bi]!.d) });
  }
  landmarks.sort((a, b) => a.d - b.d);
  // les côtes prennent le nom du lieu le plus proche de leur sommet
  for (const s of segments) {
    const near = landmarks.slice().sort((a, b) => Math.abs(a.d - s.endM) - Math.abs(b.d - s.endM))[0];
    if (near && Math.abs(near.d - s.endM) < 1500) s.name = `Côte ${frenchDe(near.name)}`;
  }
  tour.climbNames?.forEach((name, i) => {
    if (segments[i]) segments[i]!.name = name;
  });
  let maxGrade = 0;
  const w = Math.round(10 / step);
  for (let i = 0; i + w < hs.length; i++) maxGrade = Math.max(maxGrade, Math.abs((hs[i + w]! - hs[i]!) / (w * step)) * 100);
  // revenu au départ dans le même sens : publié en boucle (tours enchaînés)
  return asCircuit({
    id: tour.routeId,
    name: tour.routeName,
    nameEn: tour.routeNameEn,
    loop: false,
    lengthM: r2(lengthM),
    elevationGainM: r2(elevationGain(hs, false)),
    points,
    segments,
    roadWidthM: widths[widths.length >> 1] ?? 5,
    attribution: [...ATTRIBUTION],
    roadWidths,
    surfaces,
    landmarks,
    stepM: step,
    minElevationM: r2(Math.min(...hs)),
    maxElevationM: r2(Math.max(...hs)),
    maxGradePct: r2(maxGrade),
  });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
