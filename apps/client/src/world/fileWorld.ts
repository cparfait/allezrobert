import type { RouteData, WorldMeta, WorldTile } from '@allezrobert/shared';
import type { LoadedTile, TileFeatures, WorldSource } from './types.ts';

/**
 * Monde généré par tools/terrain (IGN + OpenStreetMap), servi depuis public/worlds/<id>/ :
 * world.json (index), routes/*.json, tiles/<tx>_<tz>.json (entités) + .hi.u16 / .lo.u16
 * (altitudes Uint16 petit-boutiste, h = baseM + q × stepM, ligne 0 = nord) + .ortho.jpg.
 */
export async function createFileWorld(id: string, meta: WorldMeta): Promise<WorldSource> {
  const base = `/worlds/${id}`;
  const routes = await Promise.all(
    meta.routes.map(async (r) => {
      const res = await fetch(`${base}/${r.file}`);
      if (!res.ok) throw new Error(`Itinéraire ${r.id} introuvable`);
      return (await res.json()) as RouteData;
    }),
  );
  // Itinéraire principal en premier (jalon 1).
  routes.sort((a, b) => (a.id === meta.mainRoute ? -1 : b.id === meta.mainRoute ? 1 : 0));
  const index = new Map(meta.tiles.map((t) => [t.id, t]));
  const T = meta.tileSizeM;
  const b = meta.bounds;
  const inBounds = (tx: number, tz: number) => tx * T >= b.minX && (tx + 1) * T <= b.maxX && tz * T >= b.minZ && (tz + 1) * T <= b.maxZ;
  const missing = new Set<string>();

  return {
    id,
    name: meta.name,
    tileSize: T,
    bounds: b,
    routes,
    attribution: meta.attribution,
    originL93: meta.originL93,
    hasTile(tx, tz) {
      const key = `${tx}_${tz}`;
      if (missing.has(key)) return false;
      // Index vide : génération en cours, on tente toutes les tuiles de l'emprise.
      return index.size ? index.has(key) : inBounds(tx, tz);
    },
    async loadTile(tx, tz) {
      const key = `${tx}_${tz}`;
      const res = await fetch(`${base}/tiles/${key}.json`);
      // 404 : tuile hors du monde, on n'y revient plus ; autre erreur (génération en cours) : on réessaiera.
      if (res.status === 404 || (res.ok && !(res.headers.get('content-type') ?? '').includes('json'))) {
        missing.add(key);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tile = (await res.json()) as WorldTile;
      const grid = tile.heights.hi ?? tile.heights.lo;
      const bin = await fetch(`${base}/tiles/${grid.file}`);
      if (!bin.ok) throw new Error(`HTTP ${bin.status}`);
      const raw = new Uint16Array(await bin.arrayBuffer());
      const heights = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) heights[i] = tile.heights.baseM + (raw[i] as number) * tile.heights.stepM;
      const idx = index.get(key);
      const hasOrtho = idx ? idx.lods.includes('ortho') : true;
      return {
        id: key,
        tx,
        tz,
        x0: tile.bounds.minX,
        z0: tile.bounds.minZ,
        size: T,
        n: grid.n,
        heights,
        features: toFeatures(tile),
        ...(hasOrtho ? { orthoUrl: `${base}/tiles/${key}.ortho.jpg` } : {}),
      } satisfies LoadedTile;
    },
  };
}

function toFeatures(t: WorldTile): TileFeatures {
  return {
    roads: t.roads.map((r) => {
      const flat: number[] = [];
      for (let i = 0; i < r.pts.length; i += 3) flat.push(r.pts[i] as number, r.pts[i + 2] as number);
      return {
        kind: r.kind,
        width: r.width,
        pts: flat,
        pts3: r.pts,
        surface: r.surface,
        ...(r.route ? { route: r.route } : {}),
        ...(r.bridge ? { bridge: true } : {}),
        ...(r.tunnel ? { tunnel: true } : {}),
      };
    }),
    buildings: t.buildings.map((bd) => ({
      pts: bd.pts,
      height: bd.height,
      kind: bd.kind,
      roof: bd.roof.shape,
      roofHeight: bd.roof.height,
      levels: bd.levels,
      y: bd.y,
      ...(bd.colour ? { colour: bd.colour } : {}),
      ...(bd.material ? { material: bd.material } : {}),
    })),
    forests: t.forests.map((f) => ({ rings: f.rings, kind: f.kind })),
    water: t.water.map((w) => ({ rings: w.rings, kind: w.kind, level: w.level })),
    fields: t.fields.map((f) => ({ rings: f.rings, kind: f.kind })),
    landuse: t.landuse.map((l) => ({ rings: l.rings, kind: l.kind })),
    waterways: t.waterways.map((w) => ({ width: w.width, pts: w.pts, kind: w.kind, ...(w.tunnel ? { tunnel: true } : {}) })),
    pois: t.pois.map((p) => ({ kind: p.kind, name: p.name, x: p.x, y: p.y, z: p.z })),
  };
}
