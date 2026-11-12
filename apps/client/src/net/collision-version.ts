import { COLLISION_VERSION_ERROR, type RouteData } from '@allezrobert/shared';
import { COLLISION_MANIFEST_PATH, COLLISION_PILOT_ROUTE, COLLISION_PILOT_WORLD, sha256Json, verifyCollisionManifest, type BuildingObstacleData, type CollisionManifest } from '@allezrobert/physics';

/** Le jeu vérifie la géométrie de l'artefact local, indépendamment du serveur de salles. */
export async function loadRideCollisionFingerprint(worldId: string, route: RouteData, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  return (await loadRideCollisionData(worldId, route, fetchFn))?.fingerprint;
}

export async function loadRideCollisionData(worldId: string, route: RouteData, fetchFn: typeof fetch = fetch): Promise<{ fingerprint: string; data: BuildingObstacleData } | undefined> {
  if (route.id !== COLLISION_PILOT_ROUTE) return undefined;
  try {
    if (worldId !== COLLISION_PILOT_WORLD) throw new Error('Monde différent du parcours pilote');
    const response = await fetchFn(COLLISION_MANIFEST_PATH, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Manifeste indisponible (${response.status})`);
    const manifest = await response.json() as CollisionManifest;
    const fingerprint = await verifyCollisionManifest(manifest, { worldId, routeId: route.id, routeSha256: await sha256Json(route) });
    return { fingerprint, data: manifest.data };
  } catch (cause) {
    throw new Error(COLLISION_VERSION_ERROR, { cause });
  }
}
