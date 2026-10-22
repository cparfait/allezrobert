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
 */
import fs from 'node:fs';
import path from 'node:path';
import { OpenPath, RoadNet, type RoadGraphData, type RoadGraphEdge, type RouteData, type RouteSegment, type WorldMeta } from '@allezrobert/shared';
import { ATTRIBUTION, ATTRIBUTION_ORTHO, CORRIDOR_TILES, LOD_HI, LOD_LO, ORIGIN_L93, OUT_DIR, TILE_SIZE_M, WORLD, worldEnrich, type LonLat, type OpenTour, type OpenWorld } from './config.ts';
import { nearestEdgeOf, routeViaEdges } from './climb.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { Dem, DemStack } from './dem.ts';
import { tileRect, wgs84ToWorld, worldToL93, type Rect } from './frame.ts';
import { simplify3 } from './geom.ts';
import { RoadGraph, type Edge } from './graph.ts';
import { writeHorizon } from './horizon.ts';
import { setOffline } from './net.ts';
import { buildOsmWorld } from './osm.ts';
import { fetchOsm, fetchOsmApi, reachableOverpass } from './overpass.ts';
import { detectClimbs, elevationGain } from './profile.ts';
import { buildRoads3d } from './roads3d.ts';
import { ATTRIBUTION_BDTOPO } from './bdtopo.ts';
import { bdTopoRoadAttrs, prepareEnrichment, type TileEnrichment } from './enrich.ts';
import { ATTRIBUTION_LIDAR } from './lidar.ts';
import { frenchDe } from './route.ts';
import type { TileResult } from './tiles.ts';
import { writeWorldTiles } from './world-tiles.ts';
import { WORLDS_ROOT, writeCatalogue } from './packs.ts';

if (WORLD.kind !== 'open') throw new Error('build-open : monde de type « open » attendu');
const W: OpenWorld = WORLD;
/** Données fines IGN (qualité standard sauf réglage du monde). */
const ENRICH = worldEnrich(W);

const args = new Set(process.argv.slice(2));
const WITH_ORTHO = !args.has('--no-ortho');
if (args.has('--offline')) setOffline(true);

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
  const els = mirror ? await fetchOsm(bbox, OSM_CHUNK.lon, OSM_CHUNK.lat) : await fetchOsmApi(bbox);
  const osm = buildOsmWorld(els);
  log(`   ${els.length} éléments → ${osm.roads.length} voies, ${osm.buildings.length} bâtiments, ${osm.areas.length} surfaces, ${osm.lines.length} lignes, ${osm.pois.length} lieux`);
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));
  log(`   graphe OSM : ${g.edges.length} arêtes, ${g.adj.size} nœuds`);

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
  const r3 = buildRoads3d(g, dem, []);
  log(`   ${r3.roads.length} tronçons, ${r3.carve.length} couloirs creusés`);

  // 3 bis. données fines IGN sur toute l'emprise : arbres et haies (MNH LiDAR HD), bâtiments
  // BD TOPO (toits mesurés au MNS), nature et largeur des voies
  let enrichment: Map<string, TileEnrichment> | undefined;
  if (ENRICH) {
    log('3 bis. LiDAR HD (végétation, toits) et BD TOPO (bâtiments, voies)');
    const roadPts = g.edges.flatMap((e) => e.pts.filter((_, i) => i % 4 === 0));
    enrichment = await prepareEnrichment({ enrich: ENRICH, tiles, routePts: roadPts, roads: osm.roads, dem, log });
  }
  const tileOf = (x: number, z: number) => `${Math.floor(x / TILE_SIZE_M)}_${Math.floor(z / TILE_SIZE_M)}`;

  // 4. graphe roulable
  log('4. Graphe roulable');
  const inside = (pts: Array<[number, number, number]>) =>
    pts.every((p) => p[0] > rect.minX + EDGE_MARGIN_M && p[0] < rect.maxX - EDGE_MARGIN_M && p[2] > rect.minZ + EDGE_MARGIN_M && p[2] < rect.maxZ - EDGE_MARGIN_M);
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const edges: RoadGraphEdge[] = [];
  const edgeIndex = new Map<number, number>();
  const nodeOf = (osmId: number, p: [number, number, number]) => {
    let i = nodeIndex.get(osmId);
    if (i === undefined) {
      i = nodes.length / 3;
      nodeIndex.set(osmId, i);
      nodes.push(r2(p[0]), r2(p[1]), r2(p[2]));
    }
    return i;
  };
  for (const e of g.edges) {
    if (!RIDEABLE.test(e.road.kind)) continue;
    const pts3 = r3.edgePts.get(e.id);
    if (!pts3 || pts3.length < 2 || !inside(pts3)) continue;
    const simple = simplify3(pts3, 0.1, 0.02);
    // revêtement et largeur BD TOPO (chemins empierrés, de terre) : physique et son du mode ouvert
    const mid = pts3[pts3.length >> 1]!;
    const fine = enrichment?.get(tileOf(mid[0], mid[2]));
    const bd = fine ? bdTopoRoadAttrs(pts3.flat(), fine.roads) : null;
    const a = nodeOf(e.a, pts3[0]!);
    const b = nodeOf(e.b, pts3[pts3.length - 1]!);
    if (a === b) continue;
    edgeIndex.set(e.id, edges.length);
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
    });
  }
  const graph: RoadGraphData = { formatVersion: 1, nodes, edges, attribution: [...ATTRIBUTION] };
  const net = new RoadNet(graph);
  const graphFile = path.join(OUT_DIR, 'graph.json');
  fs.writeFileSync(graphFile, JSON.stringify(graph));
  const km = edges.reduce((s, e) => s + e.len, 0) / 1000;
  const paved = edges.filter((e) => /^(asphalt|paved|concrete|chipseal)/.test(e.surface)).reduce((s, e) => s + e.len, 0) / 1000;
  log(`   ${edges.length} arêtes, ${nodes.length / 3} nœuds, ${km.toFixed(0)} km roulables (dont ${paved.toFixed(0)} km revêtus) — ${(fs.statSync(graphFile).size / 1e6).toFixed(1)} Mo`);

  // 5. tours proposés
  log('5. Tours proposés');
  const routes: RouteData[] = [];
  for (const tour of W.tours) {
    const route = buildTour(tour, g, net, edgeIndex, osm.pois);
    routes.push(route);
    fs.writeFileSync(path.join(OUT_DIR, 'routes', `${route.id}.json`), JSON.stringify(route));
    log(`   ${route.name} : ${(route.lengthM / 1000).toFixed(2)} km, D+ ${route.elevationGainM.toFixed(0)} m, ${route.segments.length} montée(s), repères ${route.landmarks?.map((l) => l.name).join(', ')}`);
  }

  // 6. tuiles
  log(`6. Tuiles (${tiles.length}, toutes en haute résolution${WITH_ORTHO ? `, orthophotos ${W.orthoPx} px` : ''})`);
  const tileResults: TileResult[] = await writeWorldTiles({
    g,
    dem,
    dems: { lo, hi },
    osm,
    routes: [],
    roads3d: r3,
    tiles,
    hiTiles: hiSet,
    outDir: OUT_DIR,
    withOrtho: WITH_ORTHO,
    orthoPx: W.orthoPx,
    ...(enrichment ? { enrichment } : {}),
    log,
  });
  const horizon = await writeHorizon(W.horizon.halfSizeM, W.horizon.resM, OUT_DIR, log);
  const start = toWorld(W.start);
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
    routes: routes.map((r, i) => ({ id: r.id, file: `routes/${r.id}.json`, name: r.name, lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop, main: i === 0 })),
    mainRoute: routes[0]?.id ?? '',
    attribution: [
      ...ATTRIBUTION,
      ...(WITH_ORTHO ? [ATTRIBUTION_ORTHO] : []),
      ...(ENRICH?.lidarVegetation || ENRICH?.bdtopoBuildings ? [ATTRIBUTION_LIDAR] : []),
      ...(ENRICH?.bdtopoBuildings ? [ATTRIBUTION_BDTOPO] : []),
    ],
    horizon,
    open: { graph: 'graph.json', start: { x: r2(start[0]), z: r2(start[1]) } },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'world.json'), JSON.stringify(meta, null, 1));

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
  const usable = (e: Edge) => edgeIndex.has(e.id) && e.road.paved && /^(primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/.test(e.road.kind);
  const cost = (e: Edge) => (!usable(e) ? Infinity : /^(primary|secondary)/.test(e.road.kind) ? e.len * 1.6 : e.len);
  const place = (p: LonLat | string): [number, number] => {
    if (typeof p !== 'string') return toWorld(p);
    const poi = pois.find((q) => q.name === p && /^(village|town|hamlet|isolated_dwelling|locality)$/.test(q.kind));
    if (!poi) throw new Error(`${tour.routeId} : lieu OSM « ${p} » introuvable`);
    return [poi.x, poi.z];
  };
  const wps = [tour.start, ...tour.via, tour.start].map(place);
  const must = wps.map((p, i) => {
    const e = nearestEdgeOf(g, p[0], p[1], 300, usable);
    if (e < 0) throw new Error(`${tour.routeId} : point de passage ${i} sans route revêtue à moins de 300 m`);
    return e;
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
  let maxGrade = 0;
  const w = Math.round(10 / step);
  for (let i = 0; i + w < hs.length; i++) maxGrade = Math.max(maxGrade, Math.abs((hs[i + w]! - hs[i]!) / (w * step)) * 100);
  return {
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
  };
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
