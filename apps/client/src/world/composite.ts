import type { RoadGraphData, RoadGraphEdge, WorldCatalogue, WorldPlace } from '@allezrobert/shared';
import type { LoadedTile, Rings, TileFeatures, WorldSource } from './types.ts';

/**
 * Zones voisines chargées ensemble (parcours libre ou à dessiner d'une zone à l'autre).
 *
 * Toutes les zones sont sur le même quadrillage kilométrique Lambert-93 : passer du repère d'une
 * zone à celui de la zone principale est un décalage d'un nombre entier de tuiles. Là où deux
 * zones se chevauchent, chaque tuile vient d'une seule zone (la principale d'abord, puis l'ordre
 * de la liste). Les graphes routiers se raccordent par leurs nœuds OSM communs ; les arêtes au
 * bord d'une zone (`border`, exportées par tools/terrain) font la jonction avec la voisine.
 */

/** Écart minimal au bord extérieur du monde composé (m) : pas de cul-de-sac au bord des tuiles. */
const EDGE_MARGIN_M = 30;

interface Part {
  source: WorldSource;
  /** Décalage repère de la zone → repère de la zone principale (m), multiple de la tuile. */
  dx: number;
  dz: number;
}

type Rect = { minE: number; minN: number; maxE: number; maxN: number };

/**
 * Zones ouvertes qui touchent (bord commun d'au moins 1 km) ou chevauchent la zone `id`, d'après
 * les emprises du catalogue.
 */
export function neighbourZones(cat: WorldCatalogue | null, id: string): string[] {
  const zones = cat?.zones ?? [];
  const me = zones.find((z) => z.id === id);
  if (!me?.l93 || !me.open) return [];
  const a = me.l93;
  const span = (lo1: number, hi1: number, lo2: number, hi2: number) => Math.min(hi1, hi2) - Math.max(lo1, lo2);
  return zones
    .filter((z) => z.id !== id && z.open && z.l93)
    .filter((z) => {
      const b = z.l93 as Rect;
      const w = span(a.minE, a.maxE, b.minE, b.maxE);
      const h = span(a.minN, a.maxN, b.minN, b.maxN);
      // chevauchement, ou bord commun (une des deux étendues nulle, l'autre ≥ 1 km)
      return (w > 0 && h > 0) || (w === 0 && h >= 1000) || (h === 0 && w >= 1000);
    })
    .map((z) => z.id);
}

/** Identifiant de monde composé : zone principale puis voisines, séparées par « + ». */
export function compositeId(zones: string[]): string {
  return zones.join('+');
}

export function createCompositeWorld(sources: WorldSource[]): WorldSource {
  const main = sources[0]!;
  const T = main.tileSize;
  const o = main.originL93 ?? { x: 0, y: 0 };
  const parts: Part[] = sources.map((s) => {
    const so = s.originL93 ?? o;
    return { source: s, dx: so.x - o.x, dz: o.y - so.y };
  });
  // propriétaire de chaque tuile (repère principal) : première zone qui l'a, dans l'ordre
  const owner = (tx: number, tz: number): Part | null => {
    for (const p of parts) {
      const b = p.source.bounds;
      const lx = tx - p.dx / T;
      const lz = tz - p.dz / T;
      if (lx * T < b.minX || (lx + 1) * T > b.maxX || lz * T < b.minZ || (lz + 1) * T > b.maxZ) continue;
      if (p.source.hasTile(lx, lz)) return p;
    }
    return null;
  };
  const ownerAt = (x: number, z: number) => owner(Math.floor(x / T), Math.floor(z / T));

  const bounds = { ...main.bounds };
  for (const p of parts.slice(1)) {
    const b = p.source.bounds;
    bounds.minX = Math.min(bounds.minX, b.minX + p.dx);
    bounds.maxX = Math.max(bounds.maxX, b.maxX + p.dx);
    bounds.minZ = Math.min(bounds.minZ, b.minZ + p.dz);
    bounds.maxZ = Math.max(bounds.maxZ, b.maxZ + p.dz);
  }

  let open: WorldSource['open'];
  if (main.open) {
    const graph = mergeGraphs(parts, ownerAt);
    const places: WorldPlace[] = [];
    const seen = new Set<string>();
    for (const p of parts)
      for (const pl of p.source.open?.places ?? []) {
        if (seen.has(pl.name)) continue;
        seen.add(pl.name);
        places.push({ ...pl, x: pl.x + p.dx, z: pl.z + p.dz });
      }
    open = { graph, fullGraph: graph, start: main.open.start, places };
  }

  return {
    ...main,
    bounds,
    attribution: [...new Set(parts.flatMap((p) => p.source.attribution))],
    zones: parts.map((p) => p.source.id),
    ...(open ? { open } : {}),
    hasTile: (tx, tz) => owner(tx, tz) !== null,
    async loadTile(tx, tz) {
      const p = owner(tx, tz);
      if (!p) return null;
      const t = await p.source.loadTile(tx - p.dx / T, tz - p.dz / T);
      if (!t || (p.dx === 0 && p.dz === 0)) return t;
      return shiftTile(t, tx, tz, p.dx, p.dz);
    },
  };
}

/**
 * Graphe des zones réunies : chaque arête vient de la zone propriétaire de la tuile sous son
 * milieu (pas de doublon où les zones se chevauchent), nœuds fusionnés par identifiant OSM ;
 * les arêtes qui sortent des tuiles chargées (ou s'en approchent à moins de 30 m) sont écartées.
 */
function mergeGraphs(parts: Part[], ownerAt: (x: number, z: number) => Part | null): RoadGraphData {
  const nodes: number[] = [];
  const edges: RoadGraphEdge[] = [];
  const nodeOf = new Map<string, number>();
  const m = EDGE_MARGIN_M;
  const covered = (x: number, z: number) => ownerAt(x, z) && ownerAt(x - m, z - m) && ownerAt(x + m, z - m) && ownerAt(x - m, z + m) && ownerAt(x + m, z + m);
  parts.forEach((p, pi) => {
    const g = p.source.open?.fullGraph ?? p.source.open?.graph;
    if (!g) return;
    const node = (i: number) => {
      const key = g.osm ? `o${g.osm[i]}` : `${pi}:${i}`;
      let k = nodeOf.get(key);
      if (k === undefined) {
        k = nodes.length / 3;
        nodeOf.set(key, k);
        nodes.push((g.nodes[i * 3] as number) + p.dx, g.nodes[i * 3 + 1] as number, (g.nodes[i * 3 + 2] as number) + p.dz);
      }
      return k;
    };
    for (const e of g.edges) {
      const pts = e.pts.slice();
      for (let i = 0; i < pts.length; i += 3) {
        pts[i] = (pts[i] as number) + p.dx;
        pts[i + 2] = (pts[i + 2] as number) + p.dz;
      }
      const mid = Math.floor(pts.length / 6) * 3;
      if (ownerAt(pts[mid] as number, pts[mid + 2] as number) !== p) continue;
      let ok = true;
      for (let i = 0; i < pts.length && ok; i += 3) ok = !!covered(pts[i] as number, pts[i + 2] as number);
      if (!ok) continue;
      const a = node(e.a);
      const b = node(e.b);
      if (a === b) continue;
      // extrémités recollées sur le nœud partagé (altitude de la première zone qui l'a posé)
      pts[0] = nodes[a * 3] as number;
      pts[1] = nodes[a * 3 + 1] as number;
      pts[2] = nodes[a * 3 + 2] as number;
      const l = pts.length - 3;
      pts[l] = nodes[b * 3] as number;
      pts[l + 1] = nodes[b * 3 + 1] as number;
      pts[l + 2] = nodes[b * 3 + 2] as number;
      const { border: _border, ...rest } = e;
      edges.push({ ...rest, a, b, pts });
    }
  });
  return { formatVersion: 1, nodes, edges, attribution: [...new Set(parts.flatMap((p) => p.source.open?.graph.attribution ?? []))] };
}

function shiftTile(t: LoadedTile, tx: number, tz: number, dx: number, dz: number): LoadedTile {
  return { ...t, id: `${tx}_${tz}`, tx, tz, x0: t.x0 + dx, z0: t.z0 + dz, features: shiftFeatures(t.features, dx, dz) };
}

/** Décale des coordonnées plates x, z, … (pas `stride`, x en 0 et z en `zAt`). */
function shift(a: number[], dx: number, dz: number, stride = 2, zAt = 1): number[] {
  const out = a.slice();
  for (let i = 0; i < out.length; i += stride) {
    out[i] = (out[i] as number) + dx;
    out[i + zAt] = (out[i + zAt] as number) + dz;
  }
  return out;
}

function shiftFeatures(f: TileFeatures, dx: number, dz: number): TileFeatures {
  const rings = (r: Rings) => r.map((ring) => shift(ring, dx, dz));
  return {
    ...f,
    roads: f.roads.map((r) => ({ ...r, pts: shift(r.pts, dx, dz), ...(r.pts3 ? { pts3: shift(r.pts3, dx, dz, 3, 2) } : {}) })),
    buildings: f.buildings.map((b) => ({ ...b, pts: shift(b.pts, dx, dz) })),
    forests: f.forests.map((x) => ({ ...x, rings: rings(x.rings) })),
    water: f.water.map((x) => ({ ...x, rings: rings(x.rings) })),
    fields: f.fields.map((x) => ({ ...x, rings: rings(x.rings) })),
    landuse: f.landuse.map((x) => ({ ...x, rings: rings(x.rings) })),
    waterways: f.waterways.map((w) => ({ ...w, pts: shift(w.pts, dx, dz) })),
    ...(f.railways ? { railways: f.railways.map((r) => ({ ...r, pts: shift(r.pts, dx, dz) })) } : {}),
    pois: f.pois.map((p) => ({ ...p, x: p.x + dx, z: p.z + dz })),
    ...(f.trees ? { trees: shift(f.trees, dx, dz, 4) } : {}),
    ...(f.shrubs ? { shrubs: shift(f.shrubs, dx, dz, 3) } : {}),
  };
}
