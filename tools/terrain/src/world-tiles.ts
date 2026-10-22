/**
 * Écriture des tuiles d'un monde (commune aux mondes « sorties Garmin » et « montées ») :
 * profils 3D des routes, index par tuile des entités OSM, grilles creusées, orthophotos.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Dem, DemStack } from './dem.ts';
import { decorateTile, type TileEnrichment } from './enrich.ts';
import { worldToL93 } from './frame.ts';
import type { Box } from './geom.ts';
import type { RoadGraph } from './graph.ts';
import { fetchOrtho } from './ortho.ts';
import type { OsmWorld, Poi } from './osm.ts';
import { buildRoads3d, type RouteOnGraph } from './roads3d.ts';
import { buildTile, TileBuckets, type CarveLine, type TileInputs, type TileResult, type TileRoad } from './tiles.ts';

export interface WriteTilesOptions {
  g: RoadGraph;
  dem: DemStack;
  dems: { lo: Dem; hi: Dem };
  osm: OsmWorld;
  routes: RouteOnGraph[];
  /** Tuiles à écrire, dans l'ordre. */
  tiles: Array<[number, number]>;
  hiTiles: Set<string>;
  outDir: string;
  withOrtho: boolean;
  carveMode?: 'max' | 'passes';
  /** Données fines par tuile (voir enrich.ts). */
  enrichment?: Map<string, TileEnrichment>;
  log: (s: string) => void;
}

export async function writeWorldTiles(o: WriteTilesOptions): Promise<TileResult[]> {
  const { g, dem, osm, log } = o;
  const tileResults: TileResult[] = [];
  const r3 = buildRoads3d(g, dem, o.routes);
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

  const tilesDir = path.join(o.outDir, 'tiles');
  for (const f of fs.readdirSync(tilesDir)) fs.unlinkSync(path.join(tilesDir, f));
  const total = o.tiles.length;
  let k = 0;
  for (const [tx, tz] of o.tiles) {
    const id = `${tx}_${tz}`;
    const fine = o.enrichment?.get(id);
    const res = buildTile(tx, tz, o.hiTiles.has(id), o.dems, inputs, o.outDir, o.carveMode ?? 'max', fine ? (json, groundAt) => decorateTile(json, fine, groundAt) : undefined);
    tileResults.push(res);
    if (o.withOrtho) {
      const ok = await fetchOrtho(tx, tz, o.hiTiles.has(id) ? 512 : 256, path.join(tilesDir, `${id}.ortho.jpg`));
      if (ok) {
        res.lods.push('ortho');
        res.bytes += fs.statSync(path.join(tilesDir, `${id}.ortho.jpg`)).size;
      }
    }
    if (++k % 25 === 0) log(`   ${k}/${total} tuiles`);
  }
  return tileResults;
}
