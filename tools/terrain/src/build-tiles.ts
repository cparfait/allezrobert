/**
 * Tuiles d'un monde reconstruites à partir des itinéraires **versionnés** (sans traces Garmin) :
 * utile sur un clone du dépôt public, où `world.json` et `routes/*.json` sont présents mais pas
 * les tuiles (non versionnées).
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx tools/terrain/src/build-tiles.ts [--near <routeId>|--all] [--radius <m>] [--no-ortho] [--offline] [--osm-api]
 *
 * - `--near <routeId>` (défaut : itinéraire principal) et `--radius` (défaut 1500 m) : seules les
 *   tuiles à moins de `radius` de l'itinéraire sont écrites ; `--all` : toutes les tuiles de world.json.
 * - Haute résolution (2 m) pour les tuiles marquées `hi` dans world.json, comme la construction complète.
 * - Mêmes caches (data/cache/terrain) que `build-world.ts`, blocs OSM 3 fois plus petits (`--chunk-div`).
 * - `world.json` et les itinéraires ne sont **pas** réécrits : le client ignore les tuiles absentes.
 *
 * Les itinéraires sont recalés sur le graphe OSM (arête la plus proche, filtre majoritaire) pour
 * creuser leur couloir en priorité et retirer leurs tronçons du réseau secondaire.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RouteData, WorldMeta } from '@allezrobert/shared';
import { LOD_LO, OUT_DIR, TILE_SIZE_M } from './config.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { Dem, DemStack } from './dem.ts';
import { distPointRect, rectToWgs84, tileRect, worldToL93, type Rect } from './frame.ts';
import { RoadGraph } from './graph.ts';
import { setOffline } from './net.ts';
import { buildOsmWorld } from './osm.ts';
import { fetchOsmApi } from './osmapi.ts';
import { fetchOsm, splitBBox, type BBox } from './overpass.ts';
import type { RouteOnGraph } from './roads3d.ts';
import { writeWorldTiles } from './world-tiles.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (argv.includes('--offline')) setOffline(true);
const ALL = argv.includes('--all');
const RADIUS = Number(arg('--radius') ?? 1500);
const WITH_ORTHO = !argv.includes('--no-ortho');
/** Blocs Overpass plus petits que ceux de build-world (÷ `--chunk-div`, défaut 3) : miroirs chargés moins sujets aux 504. */
const CHUNK_DIV = Number(arg('--chunk-div') ?? 3);
/** `--osm-api` : API principale d'OSM au lieu d'Overpass (miroirs indisponibles), voir osmapi.ts. */
const OSM_API = argv.includes('--osm-api');

/** Recalage simple point → arête la plus proche (≤ 30 m), lissé par un filtre majoritaire. */
export function snapRouteToGraph(g: RoadGraph, route: RouteData): number[] {
  const raw = route.points.map((p) => {
    let best = -1;
    let bd = 30;
    for (const eid of g.index.query(p.x, p.z, 30)) {
      const e = g.edges[eid]!;
      for (let i = 1; i < e.pts.length; i++) {
        const a = e.pts[i - 1]!;
        const b = e.pts[i]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / l2));
        const d = Math.hypot(p.x - a[0] - dx * t, p.z - a[1] - dz * t);
        if (d < bd) {
          bd = d;
          best = eid;
        }
      }
    }
    return best;
  });
  // trous : arête précédente (ou suivante en tête)
  let last = raw.find((e) => e >= 0) ?? 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]! < 0) raw[i] = last;
    else last = raw[i]!;
  }
  // filtre majoritaire sur ±5 points (carrefours : évite les sauts d'une arête à l'autre)
  const out = raw.slice();
  for (let i = 0; i < raw.length; i++) {
    const count = new Map<number, number>();
    for (let k = Math.max(0, i - 5); k <= Math.min(raw.length - 1, i + 5); k++) count.set(raw[k]!, (count.get(raw[k]!) ?? 0) + 1);
    let bestE = raw[i]!;
    let bestC = 0;
    for (const [e, c] of count) if (c > bestC) [bestE, bestC] = [e, c];
    out[i] = bestE;
  }
  return out;
}

function intersects(a: BBox, b: BBox): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as WorldMeta;
  const routes = meta.routes.map((r) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, r.file), 'utf8')) as RouteData);
  const nearId = arg('--near') ?? meta.mainRoute;
  const near = routes.find((r) => r.id === nearId);
  if (!near && !ALL) throw new Error(`itinéraire inconnu : ${nearId}`);

  // 1. tuiles retenues
  const tiles: Array<[number, number]> = [];
  for (const t of meta.tiles) {
    if (!ALL) {
      const r = tileRect(t.tx, t.tz);
      let ok = false;
      for (let i = 0; i < near!.points.length && !ok; i += 5) ok = distPointRect(near!.points[i]!.x, near!.points[i]!.z, r) <= RADIUS;
      if (!ok) continue;
    }
    tiles.push([t.tx, t.tz]);
  }
  const hiTiles = new Set(meta.tiles.filter((t) => t.lods.includes('hi')).map((t) => t.id));
  const rect: Rect = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [tx, tz] of tiles) {
    const r = tileRect(tx, tz);
    rect.minX = Math.min(rect.minX, r.minX);
    rect.minZ = Math.min(rect.minZ, r.minZ);
    rect.maxX = Math.max(rect.maxX, r.maxX);
    rect.maxZ = Math.max(rect.maxZ, r.maxZ);
  }
  console.log(`1. ${tiles.length} tuiles (${tiles.filter(([x, z]) => hiTiles.has(`${x}_${z}`)).length} en haute résolution) autour de ${ALL ? 'tout le monde' : nearId}`);

  // 2. OSM : blocs (découpage de build-world ÷ CHUNK_DIV) qui recoupent l'emprise (+ 600 m pour les entités à cheval)
  const want = rectToWgs84({ minX: rect.minX - 600, minZ: rect.minZ - 600, maxX: rect.maxX + 600, maxZ: rect.maxZ + 600 });
  const els = OSM_API
    ? await fetchOsmApi(splitBBox(want, 0.02, 0.014))
    : await fetchOsm(corridorWgs84(), OSM_CHUNK.lon / CHUNK_DIV, OSM_CHUNK.lat / CHUNK_DIV, undefined, (c) => intersects(c, want));
  const osm = buildOsmWorld(els);
  console.log(`2. OSM : ${osm.roads.length} voies, ${osm.buildings.length} bâtiments, ${osm.areas.length} surfaces, ${osm.lines.length} lignes`);
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));

  // 3. MNT (8 m sur l'emprise, 1 m sur les tuiles hi)
  const lo = new Dem('lo', LOD_LO.resM, 8000);
  const a = worldToL93(rect.minX - 200, rect.maxZ + 200);
  const b = worldToL93(rect.maxX + 200, rect.minZ - 200);
  await lo.ensure(a.e, a.n, b.e - 1, b.n - 1);
  const hi = new Dem('hi', 1, 1000);
  for (const [tx, tz] of tiles) {
    if (!hiTiles.has(`${tx}_${tz}`)) continue;
    const r = tileRect(tx, tz);
    const p = worldToL93(r.minX, r.maxZ);
    const q = worldToL93(r.maxX, r.minZ);
    await hi.ensure(p.e, p.n, q.e - 1e-6, q.n - 1e-6);
  }
  const dem = new DemStack([hi, lo]);
  console.log(`3. MNT lo ${JSON.stringify(lo.stats)} ; hi ${JSON.stringify(hi.stats)}`);

  // 4. itinéraires recalés (ceux qui traversent l'emprise)
  const onGraph: RouteOnGraph[] = routes
    .filter((r) => r.points.some((p) => p.x >= rect.minX - 500 && p.x <= rect.maxX + 500 && p.z >= rect.minZ - 500 && p.z <= rect.maxZ + 500))
    .map((r) => ({ route: r, edgeOf: snapRouteToGraph(g, r), priority: r.id === meta.mainRoute ? 2 : 1 }));
  console.log(`4. ${onGraph.length} itinéraire(s) recalé(s) : ${onGraph.map((r) => r.route.id).join(', ')}`);

  // 5. tuiles
  fs.mkdirSync(path.join(OUT_DIR, 'tiles'), { recursive: true });
  const res = await writeWorldTiles({ g, dem, dems: { lo, hi }, osm, routes: onGraph, tiles, hiTiles, outDir: OUT_DIR, withOrtho: WITH_ORTHO, log: (s) => console.log(s) });
  const bytes = res.reduce((s, t) => s + t.bytes, 0);
  console.log(`5. ${res.length} tuiles écrites, ${(bytes / 1e6).toFixed(1)} Mo, ${((Date.now() - t0) / 1000).toFixed(0)} s (taille ${TILE_SIZE_M} m)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
