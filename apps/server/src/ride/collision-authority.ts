import { readFile } from 'node:fs/promises';
import type { RouteData } from '@allezrobert/shared';
import { COLLISION_MANIFEST_PATH, COLLISION_PILOT_ROUTE, COLLISION_PILOT_WORLD, sha256Json, verifyCollisionManifest, type BuildingObstacleData, type CollisionManifest } from '@allezrobert/physics';

// Même fichier que celui livré avec le jeu. L'image serveur copie public/ avec les parcours.
const manifestUrl = new URL(`../../../client/public${COLLISION_MANIFEST_PATH}`, import.meta.url);
let authority: ReturnType<typeof readAuthority> | undefined;

async function readAuthority(): Promise<{ fingerprint: string; data: BuildingObstacleData }> {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as CollisionManifest;
  const routeSha256 = manifest.data.source.routeSha256;
  const fingerprint = await verifyCollisionManifest(manifest, { worldId: COLLISION_PILOT_WORLD, routeId: COLLISION_PILOT_ROUTE, routeSha256 });
  return { fingerprint, data: manifest.data };
}

export async function pilotCollisionAuthority(route: RouteData) {
  const result = await (authority ??= readAuthority());
  if (route.id !== COLLISION_PILOT_ROUTE || await sha256Json(route) !== result.data.source.routeSha256) throw new Error('Tracé serveur différent du manifeste');
  return result;
}
