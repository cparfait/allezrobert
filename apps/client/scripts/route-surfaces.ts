/**
 * Revêtements entendus le long d'un itinéraire (même calcul qu'en jeu : audio/soundscape.ts,
 * surfaceAt sur les voies des tuiles), pour vérifier le roulement selon le revêtement.
 *
 * Usage : npx tsx apps/client/scripts/route-surfaces.ts [dossier du monde=apps/client/public/worlds/chevreuse] [--route=<id>]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteData, WorldMeta, WorldTile } from '@allezrobert/shared';
import { surfaceAt, type Surface } from '../src/audio/soundscape.ts';
import type { TileRoad } from '../src/world/types.ts';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '..', 'public', 'worlds', 'chevreuse');
const only = args.find((a) => a.startsWith('--route='))?.slice(8);
const meta = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldMeta;
const T = meta.tileSizeM;
const cache = new Map<string, TileRoad[] | null>();
function roadsAt(x: number, z: number): TileRoad[] | null {
  const id = `${Math.floor(x / T)}_${Math.floor(z / T)}`;
  if (!cache.has(id)) {
    const f = join(dir, 'tiles', `${id}.json`);
    if (!existsSync(f)) cache.set(id, null);
    else {
      const t = JSON.parse(readFileSync(f, 'utf8')) as WorldTile;
      // Comme fileWorld.ts : polyligne plate x,z depuis les points 3D.
      cache.set(
        id,
        t.roads.map((r) => {
          const pts: number[] = [];
          for (let i = 0; i < r.pts.length; i += 3) pts.push(r.pts[i] as number, r.pts[i + 2] as number);
          return { kind: r.kind, width: r.width, surface: r.surface, pts, ...(r.route ? { route: r.route } : {}), ...(r.tunnel ? { tunnel: true } : {}) };
        }),
      );
    }
  }
  return cache.get(id) ?? null;
}

for (const f of readdirSync(join(dir, 'routes')).filter((n) => n.endsWith('.json'))) {
  const route = JSON.parse(readFileSync(join(dir, 'routes', f), 'utf8')) as RouteData;
  if (only && route.id !== only) continue;
  const len: Partial<Record<Surface | 'inconnu' | 'sans tuile', number>> = {};
  const changes: string[] = [];
  let prev: string | null = null;
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i] as RouteData['points'][number];
    const q = route.points[i - 1] as RouteData['points'][number];
    const roads = roadsAt(p.x, p.z);
    const s: Surface | 'inconnu' | 'sans tuile' = roads ? (surfaceAt(roads, p.x, p.z, route.id) ?? 'inconnu') : 'sans tuile';
    len[s] = (len[s] ?? 0) + (p.d - q.d);
    if (s !== prev) changes.push(`${(p.d / 1000).toFixed(2)} km : ${s}`);
    prev = s;
  }
  console.log(`\n${route.id} (${(route.lengthM / 1000).toFixed(1)} km)`);
  for (const [k, v] of Object.entries(len)) console.log(`  ${k.padEnd(8)} ${((v as number) / 1000).toFixed(2)} km`);
  console.log(`  ${changes.length} changements : ${changes.slice(0, 12).join(' · ')}${changes.length > 12 ? ' …' : ''}`);
}
