import { loadBuildingObstacleIndex, type BuildingObstacleData } from './building-obstacles.ts';

export const COLLISION_PILOT_WORLD = 'chevreuse';
export const COLLISION_PILOT_ROUTE = 'boucle-toussus-le-noble-villiers-le-bacle';
export const COLLISION_MANIFEST_PATH = `/worlds/${COLLISION_PILOT_WORLD}/collisions/${COLLISION_PILOT_ROUTE}.json`;

const FORMAT = 1;
const GENERATOR = 'terrain-building-obstacles/1';
// Les ouvertures connues sans géométrie exploitable (trou, surélévation, voie protégée)
// retirent le bâtiment entier des solides. Le manifeste v1 contient les prismes effectifs.
const OPENINGS = 'omit-building';

export interface CollisionManifest {
  identity: {
    worldId: string;
    routeId: string;
    formatVersion: typeof FORMAT;
    generatorVersion: typeof GENERATOR;
    units: 'm';
    openingPolicy: typeof OPENINGS;
    tilesSha256: string;
    obstaclesSha256: string;
    fingerprint: string;
  };
  data: BuildingObstacleData;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const ordered = (tiles: BuildingObstacleData['source']['tiles']): Array<[string, string]> =>
  Object.entries(tiles).sort(([a], [b]) => compare(a, b));

export async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Le JSON stocke des mètres. L'empreinte utilise les mêmes valeurs en millimètres entiers. */
function millimetres(m: number): number {
  const mm = Math.round(m * 1000);
  if (!Number.isSafeInteger(mm) || m !== mm / 1000) throw new Error('Coordonnée de collision hors grille millimétrique');
  return mm || 0;
}

export async function buildCollisionManifest(input: BuildingObstacleData): Promise<CollisionManifest> {
  const normalized = (m: number) => {
    const mm = Math.round(m * 1000);
    return mm === 0 ? 0 : mm / 1000;
  };
  const data: BuildingObstacleData = {
    ...input,
    source: { ...input.source, tiles: Object.fromEntries(ordered(input.source.tiles)) },
    obstacles: [...input.obstacles].sort((a, b) => compare(a.id, b.id)).map((o) => ({
      id: o.id, tile: o.tile, polygon: o.polygon.map(normalized), baseM: normalized(o.baseM), topM: normalized(o.topM), solid: o.solid,
    })),
  };
  return { identity: await identify(data), data };
}

async function identify(data: BuildingObstacleData): Promise<CollisionManifest['identity']> {
  const { worldId, routeId, formatVersion, source, obstacles } = data;
  if (!worldId || !routeId || ![source.worldSha256, source.routeSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash)) ||
      loadBuildingObstacleIndex(data, { worldId, routeId, worldSha256: source.worldSha256, routeSha256: source.routeSha256 }).status !== 'ready') {
    throw new Error('Manifeste de collision invalide');
  }
  // Les sommets restent dans l'ordre cyclique du polygone source (x, z). Aucun tri des sommets.
  const geometry = [...obstacles].sort((a, b) => compare(a.id, b.id)).map((o) => [
    o.id, o.tile, o.solid, millimetres(o.baseM), millimetres(o.topM), o.polygon.map(millimetres),
  ]);
  const [tilesSha256, obstaclesSha256] = await Promise.all([sha256Json(ordered(source.tiles)), sha256Json(geometry)]);
  const identity = { worldId, routeId, formatVersion, generatorVersion: GENERATOR, units: 'm', openingPolicy: OPENINGS, tilesSha256, obstaclesSha256 } as const;
  const fingerprint = await sha256Json([worldId, routeId, formatVersion, GENERATOR, 'm', OPENINGS, source.worldSha256, source.routeSha256, tilesSha256, obstaclesSha256]);
  return { ...identity, fingerprint };
}

/** Recalcule l'empreinte à partir de la géométrie reçue et la rattache au tracé réellement chargé. */
export async function verifyCollisionManifest(manifest: CollisionManifest, expected: { worldId: string; routeId: string; routeSha256: string }): Promise<string> {
  const { data, identity } = manifest;
  if (data.worldId !== expected.worldId || data.routeId !== expected.routeId || data.source.routeSha256 !== expected.routeSha256) {
    throw new Error('Manifeste de collision pour un autre tracé');
  }
  const actual = await identify(data);
  if (Object.keys(actual).some((key) => actual[key as keyof typeof actual] !== identity[key as keyof typeof actual])) {
    throw new Error('Empreinte du manifeste de collision incohérente');
  }
  return actual.fingerprint;
}
