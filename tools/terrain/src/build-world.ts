/**
 * Construction complète du monde « chevreuse » :
 *   pnpm --filter @allezrobert/terrain build:world [-- --no-ortho] [-- --offline] [-- --routes-only]
 *
 * 1. Traces Garmin (privées) → points sensibles, recalage, fréquentation des routes.
 * 2. OSM (Overpass, cache) + MNT IGN (WMS-R, cache).
 * 3. Boucle du jalon 1 (~10 km) + itinéraires plus longs.
 * 4. Tuiles d'altitude creusées + entités, world.json.
 * 5. Audit vie privée des sorties.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RouteData, WorldMeta } from '@allezrobert/shared';
import {
  ATTRIBUTION,
  ATTRIBUTION_ORTHO,
  CACHE_DIR,
  CORRIDOR_TILES,
  GARMIN_DIR,
  HI_RES_MARGIN_M,
  HI_RES_MARGIN_SECONDARY_M,
  LOD_HI,
  LOD_LO,
  LOOP_AREA_WGS84,
  LOOP_LENGTH,
  ORIGIN_L93,
  OUT_DIR,
  PRIVACY_RADIUS_M,
  TILE_SIZE_M,
  WORLD_ID,
  WORLD_NAME,
} from './config.ts';
import { Dem, DemStack } from './dem.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { distPointRect, tileId, tileRect, wgs84BoxToRect, worldToL93, type Rect } from './frame.ts';
import { resampleOpen, smooth1d, type Box, type Pt } from './geom.ts';
import { loadRides, sensitivePoints, trimPrivate, type GpxPoint } from './gpx.ts';
import { RoadGraph } from './graph.ts';
import { enumerateCycles, scoreCycle, segmentBonus, type CycleScore, type LoopSearchOptions } from './loop.ts';
import { matchRide } from './mapmatch.ts';
import { setOffline } from './net.ts';
import { fetchOrtho } from './ortho.ts';
import { buildOsmWorld, type Poi } from './osm.ts';
import { fetchOsm } from './overpass.ts';
import { assertCorridorSafe, auditWorldDir } from './privacy.ts';
import { detectClimbs, detectSprints } from './profile.ts';
import { buildRoads3d, type RouteOnGraph } from './roads3d.ts';
import { buildRoute, climbName, slug, sprintName, type BuiltRoute } from './route.ts';
import { buildTile, TileBuckets, type CarveLine, type TileInputs, type TileResult, type TileRoad } from './tiles.ts';

const args = new Set(process.argv.slice(2));
const WITH_ORTHO = !args.has('--no-ortho');
const ROUTES_ONLY = args.has('--routes-only');
if (args.has('--offline')) setOffline(true);

const KEY_PLACES = ['Chevreuse', 'Saint-Rémy-lès-Chevreuse', 'Dampierre-en-Yvelines', 'Milon-la-Chapelle', 'Saint-Lambert', 'Senlisse', 'Saint-Forget', 'Choisel'];

interface ExtraRouteSpec {
  id: string;
  name: string;
  nameEn: string;
  area: { west: number; south: number; east: number; north: number };
  minLen: number;
  maxLen: number;
  targetLen: number;
  keyPlaces: string[];
}

const EXTRA_ROUTES: ExtraRouteSpec[] = [
  {
    id: 'grande-boucle-chevreuse',
    name: 'Grande boucle de la vallée de Chevreuse',
    nameEn: 'Chevreuse valley grand loop',
    area: { west: 1.93, south: 48.65, east: 2.16, north: 48.755 },
    minLen: 20000,
    maxLen: 30000,
    targetLen: 25000,
    keyPlaces: ['Chevreuse', 'Saint-Rémy-lès-Chevreuse', 'Dampierre-en-Yvelines', 'Cernay-la-Ville', 'Senlisse', 'Gif-sur-Yvette', 'Saint-Lambert', 'Magny-les-Hameaux'],
  },
  {
    id: 'boucle-rambouillet',
    name: 'Boucle de la forêt de Rambouillet',
    nameEn: 'Rambouillet forest loop',
    area: { west: 1.775, south: 48.615, east: 2.02, north: 48.73 },
    minLen: 26000,
    maxLen: 40000,
    targetLen: 32000,
    keyPlaces: ['Rambouillet', 'Les Essarts-le-Roi', 'Auffargis', 'Cernay-la-Ville', 'Le Perray-en-Yvelines', 'Vieille-Église-en-Yvelines', 'Saint-Léger-en-Yvelines', 'Poigny-la-Forêt', 'Dampierre-en-Yvelines'],
  },
  {
    id: 'boucle-saclay',
    name: 'Boucle du plateau de Saclay',
    nameEn: 'Saclay plateau loop',
    area: { west: 2.02, south: 48.665, east: 2.205, north: 48.755 },
    minLen: 22000,
    maxLen: 36000,
    targetLen: 28000,
    keyPlaces: ['Saclay', 'Saint-Aubin', 'Villiers-le-Bâcle', 'Gif-sur-Yvette', 'Châteaufort', 'Toussus-le-Noble', 'Magny-les-Hameaux', 'Saint-Rémy-lès-Chevreuse'],
  },
];

function log(s: string): void {
  console.log(s);
}

function corridorRect(): Rect {
  return {
    minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
    minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
    maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
    maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
  };
}

function inRect(x: number, z: number, r: Rect): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

async function ensureHiForRect(hi: Dem, r: Rect): Promise<void> {
  const a = worldToL93(r.minX, r.maxZ);
  const b = worldToL93(r.maxX, r.minZ);
  await hi.ensure(a.e, a.n, b.e - 1e-6, b.n - 1e-6);
}

/** Tuiles (indices) à moins de `margin` d'une liste de points. */
function tilesNear(pts: Array<{ x: number; z: number }>, margin: number): Set<string> {
  const out = new Set<string>();
  const c = CORRIDOR_TILES;
  for (let tx = c.txMin; tx <= c.txMax; tx++)
    for (let tz = c.tzMin; tz <= c.tzMax; tz++) {
      const r = tileRect(tx, tz);
      for (let i = 0; i < pts.length; i += 5) {
        if (distPointRect(pts[i]!.x, pts[i]!.z, r) <= margin) {
          out.add(tileId(tx, tz));
          break;
        }
      }
    }
  return out;
}

function nearestEdge(g: RoadGraph, x: number, z: number, maxD: number): number {
  let best = -1;
  let bd = maxD;
  for (const eid of g.index.query(x, z, maxD)) {
    const e = g.edges[eid]!;
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1]!;
      const b = e.pts[i]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < bd) {
        bd = d;
        best = eid;
      }
    }
  }
  return best;
}

/** Morceaux contigus d'une trace (coupure si saut > 50 m entre points conservés). */
function contiguousRuns(pts: GpxPoint[]): GpxPoint[][] {
  const runs: GpxPoint[][] = [];
  let cur: GpxPoint[] = [];
  for (const p of pts) {
    const last = cur[cur.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 50) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

interface Candidate {
  kind: 'kom' | 'sprint';
  name: string;
  lengthM: number;
  avgGrade: number;
  gainM?: number;
  rides: Set<string>;
  top: Pt;
}

/** Analyse des sorties : côtes et sprints candidats (rapport privé dans data/cache). */
function analyseRides(g: RoadGraph, dem: DemStack, pois: Poi[], publicTracks: Array<{ ride: string; pts: GpxPoint[] }>): Candidate[] {
  const cands: Candidate[] = [];
  const used = new Set<string>();
  for (const t of publicTracks) {
    for (const run of contiguousRuns(t.pts)) {
      const pl: Pt[] = run.map((p) => [p.x, p.z]);
      const rs = resampleOpen(pl, 10);
      if (rs.length < 60) continue;
      const raw = rs.map((p) => {
        const l = worldToL93(p[0], p[1]);
        return dem.sample(l.e, l.n);
      });
      if (raw.some((v) => !Number.isFinite(v))) continue;
      const hs = smooth1d(raw, 2, false);
      const xs = rs.map((p) => p[0]);
      const zs = rs.map((p) => p[1]);
      const climbs = detectClimbs(hs, 10);
      for (const c of climbs) {
        const top: Pt = [xs[c.endIdx]!, zs[c.endIdx]!];
        const existing = cands.find((k) => k.kind === 'kom' && Math.hypot(k.top[0] - top[0], k.top[1] - top[1]) < 200);
        if (existing) {
          existing.rides.add(t.ride);
          continue;
        }
        const edges: number[] = [];
        for (let i = c.startIdx; i <= c.endIdx; i += 5) {
          const e = nearestEdge(g, xs[i]!, zs[i]!, 25);
          if (e >= 0) edges.push(e);
        }
        const name = climbName(g, edges, pois, top, used);
        used.add(name);
        cands.push({ kind: 'kom', name, lengthM: c.lengthM, avgGrade: c.avgGrade, gainM: c.gainM, rides: new Set([t.ride]), top });
      }
      for (const s of detectSprints(xs, zs, hs, 10, false, climbs.map((c) => [c.startIdx, c.endIdx]))) {
        let freq = 0;
        let cnt = 0;
        for (let i = s.startIdx; i <= s.endIdx; i += 3) {
          const e = nearestEdge(g, xs[i]!, zs[i]!, 25);
          cnt++;
          if (e >= 0 && g.edges[e]!.rides >= 2) freq++;
        }
        if (freq / Math.max(1, cnt) < 0.7) continue;
        const mid = Math.floor((s.startIdx + s.endIdx) / 2);
        const top: Pt = [xs[mid]!, zs[mid]!];
        const existing = cands.find((k) => k.kind === 'sprint' && Math.hypot(k.top[0] - top[0], k.top[1] - top[1]) < 250);
        if (existing) {
          existing.rides.add(t.ride);
          continue;
        }
        const name = sprintName(pois, top, used);
        used.add(name);
        cands.push({ kind: 'sprint', name, lengthM: s.lengthM, avgGrade: s.avgGrade, rides: new Set([t.ride]), top });
      }
    }
  }
  return cands;
}

interface PickedRoute {
  built: BuiltRoute;
  score: CycleScore;
  final: number;
}

/** Recherche + notation fine d'une boucle. */
function searchLoop(g: RoadGraph, dem: DemStack, pois: Poi[], o: LoopSearchOptions, id: string, name: string, nameEn: string, topK: number): PickedRoute | null {
  const t0 = Date.now();
  const cycles = enumerateCycles(g, o);
  const scored = cycles.map((c) => scoreCycle(g, c, dem, pois, o)).sort((a, b) => b.score - a.score);
  log(`    ${cycles.length} cycles candidats (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  // dédoublonnage des cycles quasi identiques (Jaccard > 0,8 sur les arêtes, même sens)
  const kept: CycleScore[] = [];
  for (const s of scored) {
    const set = new Set(s.cycle.edges);
    const dup = kept.some((k) => {
      let inter = 0;
      for (const e of k.cycle.edges) if (set.has(e)) inter++;
      return inter / (set.size + k.cycle.edges.length - inter) > 0.8 && k.cycle.edges[0] !== undefined && sameDirection(k.cycle.edges, s.cycle.edges);
    });
    if (!dup) kept.push(s);
    if (kept.length >= topK) break;
  }
  let best: PickedRoute | null = null;
  for (const s of kept) {
    const built = buildRoute(g, s.cycle, dem, pois, { id, name, nameEn });
    const best1 = built.climbs.reduce((m, c) => Math.max(m, c.gainM), 0);
    const final = s.base + segmentBonus(built.climbs.length, best1, built.sprints.length);
    const ok = built.climbs.length > 0 && built.sprints.length > 0;
    const cur = { built, score: s, final: final + (ok ? 5 : 0) };
    if (!best || cur.final > best.final) best = cur;
  }
  return best;
}

function sameDirection(a: number[], b: number[]): boolean {
  // compare l'ordre relatif de deux arêtes communes
  const pos = new Map<number, number>();
  a.forEach((e, i) => pos.set(e, i));
  const common = b.filter((e) => pos.has(e));
  if (common.length < 2) return true;
  let inc = 0;
  for (let i = 1; i < common.length; i++) if (pos.get(common[i]!)! > pos.get(common[i - 1]!)!) inc++;
  return inc >= (common.length - 1) / 2;
}

/** Enchaînement des routes (nom/numéro, type, longueur) d'un itinéraire. */
function roadRuns(g: RoadGraph, edgeOf: number[], step: number): string {
  const runs: Array<{ label: string; m: number }> = [];
  for (const eid of edgeOf) {
    const r = g.edges[eid]!.road;
    const label = `${r.ref || r.name || '(sans nom)'} [${r.kind}]`;
    const last = runs[runs.length - 1];
    if (last && last.label === label) last.m += step;
    else runs.push({ label, m: step });
  }
  return runs.filter((r) => r.m >= 60).map((r) => `${r.label} ${Math.round(r.m)} m`).join(' → ');
}

function describeRoute(r: RouteData): string {
  const segs = r.segments.map((s) => `${s.kind.toUpperCase()} « ${s.name} » ${(s.endM - s.startM).toFixed(0)} m à ${s.avgGrade.toFixed(1)} %`).join(' ; ');
  return `${r.name} : ${(r.lengthM / 1000).toFixed(2)} km, D+ ${r.elevationGainM.toFixed(0)} m, ${r.points.length} points — ${segs}`;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  fs.mkdirSync(path.join(OUT_DIR, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'tiles'), { recursive: true });
  const analysisDir = path.join(CACHE_DIR, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  // 1. traces privées
  log('1. Sorties Garmin');
  const rides = loadRides(GARMIN_DIR);
  const sensitive = sensitivePoints(rides);
  log(`   ${rides.length} sorties, ${rides.reduce((s, r) => s + r.points.length, 0)} points (non exportés)`);
  const corridor = corridorRect();
  assertCorridorSafe(corridor, sensitive, PRIVACY_RADIUS_M);

  // 2. OSM
  log('2. OpenStreetMap (Overpass, cache)');
  const els = await fetchOsm(corridorWgs84(), OSM_CHUNK.lon, OSM_CHUNK.lat);
  const osm = buildOsmWorld(els);
  log(`   ${els.length} éléments → ${osm.roads.length} voies, ${osm.buildings.length} bâtiments, ${osm.areas.length} surfaces, ${osm.lines.length} lignes, ${osm.pois.length} lieux`);
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));
  log(`   graphe : ${g.edges.length} arêtes, ${g.adj.size} nœuds`);

  // 3. MNT
  log('3. MNT IGN');
  const lo = new Dem('lo', LOD_LO.resM, 8000);
  const cl = { a: worldToL93(corridor.minX, corridor.maxZ), b: worldToL93(corridor.maxX, corridor.minZ) };
  await lo.ensure(cl.a.e, cl.a.n, cl.b.e - 1, cl.b.n - 1);
  const hi = new Dem('hi', 1, 1000);
  const loopRect = wgs84BoxToRect(LOOP_AREA_WGS84);
  await ensureHiForRect(hi, { minX: loopRect.minX - HI_RES_MARGIN_M, minZ: loopRect.minZ - HI_RES_MARGIN_M, maxX: loopRect.maxX + HI_RES_MARGIN_M, maxZ: loopRect.maxZ + HI_RES_MARGIN_M });
  const dem = new DemStack([hi, lo]);
  log(`   lo : ${JSON.stringify(lo.stats)} ; hi : ${JSON.stringify(hi.stats)}`);

  // 4. recalage des sorties
  log('4. Recalage des sorties sur le graphe');
  const publicTracks: Array<{ ride: string; pts: GpxPoint[] }> = [];
  for (const [i, r] of rides.entries()) {
    const pts = trimPrivate(r.points, sensitive, PRIVACY_RADIUS_M).filter((p) => inRect(p.x, p.z, corridor));
    if (pts.length < 20) continue;
    const m = matchRide(g, pts);
    for (const eid of m.edges) {
      const e = g.edges[eid]!;
      e.rides++;
    }
    for (const mp of m.matched) g.edges[mp.edge]!.passes++;
    publicTracks.push({ ride: `sortie-${i + 1}`, pts });
    log(`   sortie ${i + 1} : ${pts.length} points dans le corridor, ${(m.matchRate * 100).toFixed(0)} % recalés, ${m.edges.size} arêtes`);
  }
  let riddenLen = 0;
  for (const e of g.edges) if (e.rides > 0) riddenLen += e.len;
  log(`   ${(riddenLen / 1000).toFixed(1)} km de routes parcourues au moins une fois`);
  const cands = analyseRides(g, dem, osm.pois, publicTracks);
  const koms = cands.filter((c) => c.kind === 'kom').sort((a, b) => b.rides.size - a.rides.size || (b.gainM ?? 0) - (a.gainM ?? 0));
  const sprintsC = cands.filter((c) => c.kind === 'sprint').sort((a, b) => b.rides.size - a.rides.size);
  log(`   côtes candidates (${koms.length}) : ${koms.slice(0, 12).map((k) => `${k.name} ${(k.lengthM / 1000).toFixed(1)} km ${k.avgGrade.toFixed(1)} % ×${k.rides.size}`).join(' | ')}`);
  log(`   sprints candidats (${sprintsC.length}) : ${sprintsC.slice(0, 8).map((k) => `${k.name} ${k.lengthM} m ×${k.rides.size}`).join(' | ')}`);
  fs.writeFileSync(
    path.join(analysisDir, 'candidates.json'),
    JSON.stringify(cands.map((c) => ({ ...c, rides: [...c.rides] })), null, 1),
  );

  // 5. boucle du jalon 1
  log('5. Boucle du jalon 1');
  const loopOpts: LoopSearchOptions = {
    area: loopRect,
    minLen: LOOP_LENGTH.min,
    maxLen: LOOP_LENGTH.max,
    targetLen: LOOP_LENGTH.target,
    keyPlaces: KEY_PLACES,
    maxHubs: 220,
    pairsPerHub: 18,
  };
  const mainLoop = searchLoop(g, dem, osm.pois, loopOpts, 'chevreuse-boucle', 'Boucle de Chevreuse', 'Chevreuse loop', 40);
  if (!mainLoop) throw new Error('aucune boucle trouvée');
  // nom selon les villages traversés
  const villages = mainLoop.score.villages;
  const mainName = villages.length >= 2 ? `Boucle de Chevreuse par ${villages.filter((v) => v !== 'Chevreuse').slice(0, 2).join(' et ')}` : 'Boucle de Chevreuse';
  mainLoop.built.data.name = mainName;
  log(`   ${describeRoute(mainLoop.built.data)}`);
  log(`   routes : ${roadRuns(g, mainLoop.built.edgeOf, mainLoop.built.data.stepM ?? 2)}`);
  log(`   fréquentation : ${(mainLoop.score.ridden * 100).toFixed(0)} % de la boucle déjà roulée ; trafic ${mainLoop.score.busy.toFixed(2)} ; pente max ${mainLoop.built.maxGradePct.toFixed(1)} % ; Δpente max ${(mainLoop.built.maxGradeChangePer20m * 100).toFixed(1)} %/20 m`);
  const picked: Array<{ built: BuiltRoute; main: boolean }> = [{ built: mainLoop.built, main: true }];

  // 6. itinéraires plus longs
  log('6. Itinéraires secondaires');
  const avoid = new Set(mainLoop.built.edgeOf);
  for (const spec of EXTRA_ROUTES) {
    try {
      const area = wgs84BoxToRect(spec.area);
      const r = searchLoop(
        g,
        dem,
        osm.pois,
        { area, minLen: spec.minLen, maxLen: spec.maxLen, targetLen: spec.targetLen, keyPlaces: spec.keyPlaces, maxHubs: 110, pairsPerHub: 8, avoidEdges: avoid, seed: 7 },
        spec.id,
        spec.name,
        spec.nameEn,
        12,
      );
      if (!r) {
        log(`   ${spec.id} : aucune boucle`);
        continue;
      }
      // MNT fin le long de l'itinéraire puis reconstruction
      for (const t of tilesNear(r.built.data.points, HI_RES_MARGIN_SECONDARY_M)) {
        const [tx, tz] = t.split('_').map(Number) as [number, number];
        await ensureHiForRect(hi, tileRect(tx, tz));
      }
      const rebuilt = buildRoute(g, r.score.cycle, dem, osm.pois, { id: spec.id, name: spec.name, nameEn: spec.nameEn, maxKoms: 4, maxSprints: 2 });
      picked.push({ built: rebuilt, main: false });
      log(`   ${describeRoute(rebuilt.data)}`);
      log(`   routes : ${roadRuns(g, rebuilt.edgeOf, rebuilt.data.stepM ?? 2)}`);
    } catch (err) {
      log(`   ! ${spec.id} : ${(err as Error).message}`);
    }
  }

  // contrôle vie privée des itinéraires avant écriture
  for (const p of picked) {
    for (const pt of p.built.data.points) {
      for (const s of sensitive) {
        if (Math.hypot(pt.x - s.x, pt.z - s.z) < PRIVACY_RADIUS_M) throw new Error(`Vie privée : l'itinéraire ${p.built.data.id} passe trop près d'un point sensible`);
      }
    }
  }
  // écriture des itinéraires
  const routesDir = path.join(OUT_DIR, 'routes');
  for (const f of fs.readdirSync(routesDir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(routesDir, f));
  for (const p of picked) fs.writeFileSync(path.join(routesDir, `${p.built.data.id}.json`), JSON.stringify(p.built.data));

  // 7. tuiles
  const tileResults: TileResult[] = [];
  const hiTiles = new Set<string>([...tilesNear(mainLoop.built.data.points, HI_RES_MARGIN_M)]);
  for (const p of picked) if (!p.main) for (const t of tilesNear(p.built.data.points, HI_RES_MARGIN_SECONDARY_M)) hiTiles.add(t);
  if (!ROUTES_ONLY) {
    log(`7. Tuiles (${hiTiles.size} en haute résolution)`);
    for (const t of hiTiles) {
      const [tx, tz] = t.split('_').map(Number) as [number, number];
      await ensureHiForRect(hi, tileRect(tx, tz));
    }
    const onGraph: RouteOnGraph[] = picked.map((p, i) => ({ route: p.built.data, edgeOf: p.built.edgeOf, priority: p.main ? 2 : 1 + 0 * i }));
    const r3 = buildRoads3d(g, dem, onGraph);
    log(`   ${r3.roads.length} tronçons de route 3D, ${r3.carve.length} couloirs creusés`);
    const inputs: TileInputs = {
      roads: new TileBuckets<TileRoad>(),
      carve: new TileBuckets<CarveLine>(),
      buildings: new TileBuckets(),
      areas: new TileBuckets(),
      lines: new TileBuckets(),
      pois: new TileBuckets<Poi>(),
    };
    const box3 = (pts: Array<[number, number, number]>): Box => {
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
      }
      return { minX, minZ, maxX, maxZ };
    };
    for (const r of r3.roads) inputs.roads.add(box3(r.pts), r);
    for (const c of r3.carve) {
      // découpage des longs couloirs (itinéraires) en morceaux pour l'index par tuile
      const chunk = 200;
      const pts = c.closed ? [...c.pts, c.pts[0]!] : c.pts;
      for (let i = 0; i < pts.length - 1; i += chunk) {
        const part = pts.slice(i, Math.min(pts.length, i + chunk + 1));
        inputs.carve.add(box3(part), { pts: part, halfWidth: c.halfWidth, priority: c.priority }, 30);
      }
    }
    for (const b of osm.buildings) inputs.buildings.add({ minX: b.centroid[0], maxX: b.centroid[0], minZ: b.centroid[1], maxZ: b.centroid[1] }, b);
    for (const a of osm.areas) {
      const ext = a as typeof a & { level?: number };
      if (a.cat === 'water') {
        const ring = a.polygons[0]!.outer;
        const stepI = Math.max(1, Math.floor(ring.length / 200));
        const hs: number[] = [];
        for (let i = 0; i < ring.length; i += stepI) {
          const l = worldToL93(ring[i]![0], ring[i]![1]);
          const v = dem.sample(l.e, l.n);
          if (Number.isFinite(v)) hs.push(v);
        }
        hs.sort((x, y) => x - y);
        ext.level = hs[Math.floor(hs.length * 0.1)] ?? 0;
      }
      inputs.areas.add(a.box, ext);
    }
    for (const l of osm.lines) {
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const p of l.pts) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[1]);
        maxZ = Math.max(maxZ, p[1]);
      }
      inputs.lines.add({ minX, minZ, maxX, maxZ }, l);
    }
    for (const p of osm.pois) inputs.pois.add({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, p);

    const tilesDir = path.join(OUT_DIR, 'tiles');
    for (const f of fs.readdirSync(tilesDir)) fs.unlinkSync(path.join(tilesDir, f));
    const c = CORRIDOR_TILES;
    const total = (c.txMax - c.txMin + 1) * (c.tzMax - c.tzMin + 1);
    let k = 0;
    for (let tx = c.txMin; tx <= c.txMax; tx++) {
      for (let tz = c.tzMin; tz <= c.tzMax; tz++) {
        const id = tileId(tx, tz);
        const res = buildTile(tx, tz, hiTiles.has(id), { lo, hi }, inputs, OUT_DIR);
        tileResults.push(res);
        if (WITH_ORTHO) {
          const ok = await fetchOrtho(tx, tz, hiTiles.has(id) ? 512 : 256, path.join(tilesDir, `${id}.ortho.jpg`));
          if (ok) {
            res.lods.push('ortho');
            res.bytes += fs.statSync(path.join(tilesDir, `${id}.ortho.jpg`)).size;
          }
        }
        if (++k % 25 === 0) log(`   ${k}/${total} tuiles`);
      }
    }
  }

  // 8. world.json
  const worldFile = path.join(OUT_DIR, 'world.json');
  const prevTiles: WorldMeta['tiles'] = ROUTES_ONLY && fs.existsSync(worldFile) ? (JSON.parse(fs.readFileSync(worldFile, 'utf8')) as WorldMeta).tiles : [];
  const meta: WorldMeta = {
    formatVersion: 1,
    id: WORLD_ID,
    name: WORLD_NAME,
    crs: 'EPSG:2154',
    originL93: { x: ORIGIN_L93.x, y: ORIGIN_L93.y },
    bounds: corridor,
    tileSizeM: TILE_SIZE_M,
    heightResolutionM: LOD_HI.resM,
    heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
    lods: [
      { id: 'lo', resolutionM: LOD_LO.resM, n: LOD_LO.n, suffix: '.lo.u16' },
      { id: 'hi', resolutionM: LOD_HI.resM, n: LOD_HI.n, suffix: '.hi.u16' },
    ],
    tiles: ROUTES_ONLY
      ? prevTiles
      : tileResults.map((t) => ({ id: t.id, tx: t.tx, tz: t.tz, baseM: t.baseM, minM: t.minM, maxM: t.maxM, lods: t.lods as Array<'lo' | 'hi' | 'ortho'>, bytes: t.bytes })),
    routes: picked.map((p) => ({
      id: p.built.data.id,
      file: `routes/${p.built.data.id}.json`,
      name: p.built.data.name,
      lengthM: p.built.data.lengthM,
      elevationGainM: p.built.data.elevationGainM,
      loop: p.built.data.loop,
      main: p.main,
    })),
    mainRoute: mainLoop.built.data.id,
    attribution: [...ATTRIBUTION, ...(WITH_ORTHO ? [ATTRIBUTION_ORTHO] : [])],
  };
  fs.writeFileSync(worldFile, JSON.stringify(meta, null, 1));

  // 9. audit vie privée
  const violations = auditWorldDir(OUT_DIR, sensitive, PRIVACY_RADIUS_M);
  if (violations.length) {
    throw new Error(`Vie privée : ${violations.length} violation(s) : ${violations.slice(0, 5).map((v) => v.what).join(', ')}`);
  }

  // bilan
  let size = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else size += fs.statSync(p).size;
    }
  };
  walk(OUT_DIR);
  log('Bilan');
  for (const p of picked) log(`   ${p.main ? '★' : '·'} ${describeRoute(p.built.data)}`);
  log(`   ${meta.tiles.length} tuiles (${meta.tiles.filter((t) => t.lods.includes('hi')).length} hi), ${(size / 1e6).toFixed(1)} Mo au total dans ${path.relative(process.cwd(), OUT_DIR)}`);
  log(`   audit vie privée : OK (aucun point à moins de ${PRIVACY_RADIUS_M} m d'un départ/arrivée)`);
  log(`   durée ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
