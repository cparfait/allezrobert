import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RouteData, type WorldMeta, type WorldTile } from '@allezrobert/shared';
import { BUILDING_COLLISION_RADIUS_M } from '../../../packages/physics/src/building-collision.ts';
import { buildCollisionManifest } from '../../../packages/physics/src/collision-manifest.ts';
import { BuildingObstacleIndex, type BuildingObstacle, type BuildingObstacleData, type ObstaclePoint } from '../../../packages/physics/src/building-obstacles.ts';

interface Segment {
  a: ObstaclePoint;
  b: ObstaclePoint;
  radius: number;
}

const CLOSED_KINDS = new Set(['house', 'apartments', 'church', 'chapel', 'farm', 'barn', 'garage', 'garages', 'industrial', 'commercial', 'public', 'castle', 'tower']);
const MASONRY = new Set(['stone', 'brick', 'concrete']);
const NARROW_ROADS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform', 'track']);
const HEIGHT_M = 1.85;

async function read<T>(file: string): Promise<{ value: T; hash: string }> {
  const value = JSON.parse(await readFile(file, 'utf8')) as T;
  return { value, hash: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

/** Usage : node --import tsx tools/terrain/src/build-collision-obstacles.ts <monde> <routeId> <sortie.json> */
async function generate(directory: string, routeId: string): Promise<BuildingObstacleData> {
  const { value: meta, hash: worldSha256 } = await read<WorldMeta>(join(directory, 'world.json'));
  const entry = meta.routes.find((r) => r.id === routeId);
  const size = meta.tileSizeM;
  if (!entry || meta.formatVersion !== 1 || meta.tiles.length === 0 || !Number.isFinite(size) || size <= 0) {
    throw new Error(`Carte ou parcours indisponible (${routeId})`);
  }
  const { value: route, hash: routeSha256 } = await read<RouteData>(join(directory, entry.file));
  if (route.id !== routeId || route.points.length < 2 || !Number.isFinite(route.roadWidthM) || route.roadWidthM <= 0 ||
      !route.points.every(({ x, y, z }) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) {
    throw new Error(`Parcours incohérent (${routeId})`);
  }
  const tileIds = new Set(meta.tiles.map((t) => t.id));
  for (const { x, z } of route.points) {
    const id = `${Math.floor(x / size)}_${Math.floor(z / size)}`;
    if (!tileIds.has(id)) throw new Error(`Tuile de parcours absente de l'index (${id})`);
  }

  const routeSegments = new Map<string, Segment[]>();
  const radius = route.roadWidthM / 2 + 1.5;
  // Les bâtiments sont affectés à la tuile de leur centroïde, même si une façade dépasse.
  const halo = radius + 128;
  const points = route.loop ? [...route.points, route.points[0]!] : route.points;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const segment = { a, b, radius };
    for (let tx = Math.floor((Math.min(a.x, b.x) - halo) / size); tx <= Math.floor((Math.max(a.x, b.x) + halo) / size); tx++) {
      for (let tz = Math.floor((Math.min(a.z, b.z) - halo) / size); tz <= Math.floor((Math.max(a.z, b.z) + halo) / size); tz++) {
        const id = `${tx}_${tz}`;
        const segments = routeSegments.get(id);
        if (segments) segments.push(segment);
        else routeSegments.set(id, [segment]);
      }
    }
  }

  const tiles: Record<string, string> = {};
  const tileData = new Map<string, WorldTile>();
  for (const id of [...tileIds].filter((id) => routeSegments.has(id)).sort()) {
    const { value: tile, hash } = await read<WorldTile>(join(directory, 'tiles', `${id}.json`));
    if (tile.id !== id || !Array.isArray(tile.roads) || !Array.isArray(tile.buildings)) throw new Error(`Tuile incohérente (${id})`);
    tiles[id] = hash;
    tileData.set(id, tile);
  }
  if (tileData.size === 0) throw new Error(`Aucune tuile disponible (${routeId})`);

  const roadsByTile = new Map([...tileData].map(([id, tile]) => [id, roadSegments(tile)]));
  const clear = Math.max(0.65, (meta.open ? Math.min(2, route.roadWidthM / 2) : route.roadWidthM / 2) - 0.2);
  const obstacles: BuildingObstacle[] = [];
  const contact = { fraction: 0, nx: 0, nz: 0 };
  for (const [id, tile] of tileData) {
    const segments = routeSegments.get(id)!;
    for (const building of tile.buildings) {
      // Les trous et bâtiments surélevés signalent une géométrie qu'un prisme plein simplifierait à tort.
      const enclosed = CLOSED_KINDS.has(building.kind) || (building.kind === 'shed' && MASONRY.has(building.material ?? ''));
      if (!enclosed || building.holes?.length || (building.minHeight ?? 0) > 0 || building.pts.length < 6) continue;
      const obstacle: BuildingObstacle = { id: `${id}/${building.id}`, tile: id, polygon: building.pts, baseM: building.y - 0.3, topM: building.y + building.height, solid: true };
      const xs = building.pts.filter((_, i) => i % 2 === 0), zs = building.pts.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const nearby = (s: Segment) => Math.max(s.a.x, s.b.x) + s.radius >= minX && Math.min(s.a.x, s.b.x) - s.radius <= maxX &&
        Math.max(s.a.z, s.b.z) + s.radius >= minZ && Math.min(s.a.z, s.b.z) - s.radius <= maxZ;
      const reach = segments.filter(nearby);
      if (reach.length === 0) continue;
      const probe = new BuildingObstacleIndex([obstacle]);
      const hits = ({ a, b, radius: r }: Segment, width = r) => probe.sweep(a, b, width, HEIGHT_M, contact);
      if (!reach.some((s) => hits(s)) || reach.some((s) => hits(s, clear))) continue;

      // Préserver les autres chaussées, pistes et passages cartographiés, y compris aux bords de tuiles.
      let coversRoad = false;
      for (let tx = Math.floor((minX - 12) / size); tx <= Math.floor((maxX + 12) / size); tx++) {
        for (let tz = Math.floor((minZ - 12) / size); tz <= Math.floor((maxZ + 12) / size); tz++) {
          if (roadsByTile.get(`${tx}_${tz}`)?.some((s) => nearby(s) && hits(s))) coversRoad = true;
        }
      }
      if (!coversRoad) obstacles.push(obstacle);
    }
  }
  // Valide également les identifiants de l'ensemble livré.
  new BuildingObstacleIndex(obstacles);
  return { formatVersion: 1, worldId: meta.id, routeId, source: { worldSha256, routeSha256, tiles, attribution: meta.attribution }, obstacles };
}

function roadSegments(tile: WorldTile): Segment[] {
  const segments: Segment[] = [];
  for (const road of tile.roads) {
    if (road.route) continue; // Rubans de tracés, distincts des véritables voies du réseau.
    const radius = NARROW_ROADS.has(road.kind) ? BUILDING_COLLISION_RADIUS_M : Math.max(0.65, road.width / 2 - 0.3);
    const p = road.pts;
    for (let i = 3; i < p.length; i += 3) {
      segments.push({ a: { x: p[i - 3]!, y: p[i - 2]!, z: p[i - 1]! }, b: { x: p[i]!, y: p[i + 1]!, z: p[i + 2]! }, radius });
    }
  }
  return segments;
}

const [directory, routeId, output, flag] = process.argv.slice(2);
if (!directory || !routeId || !output || (flag && flag !== '--manifest')) throw new Error('Arguments : <dossier monde> <routeId> <sortie.json> [--manifest]');
const data = await generate(directory, routeId);
if (flag === '--manifest') {
  const manifest = await buildCollisionManifest(data);
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifest.identity.fingerprint);
} else {
  // Un obstacle par ligne pour relire les différences entre deux générations.
  const { obstacles, ...header } = data;
  await writeFile(output, `${JSON.stringify(header, null, 2).slice(0, -2)},\n  "obstacles": [\n${obstacles.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}\n  ]\n}\n`);
}
console.log(`${data.worldId}/${data.routeId} : ${data.obstacles.length} obstacles, ${Object.keys(data.source.tiles).length} tuiles`);
