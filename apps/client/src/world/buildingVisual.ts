import {
  BUILDING_VISUAL_INDEX, buildingVisualTileFile, parseBuildingVisualIndex, parseBuildingVisualTile,
  type BuildingSourceTile, type BuildingVisualIndex,
} from '@allezrobert/shared/building-visual';
import { TILES_BASE } from './packs.ts';
import type { TileBuilding } from './types.ts';

async function digest(bytes: ArrayBuffer): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Un index réseau frais par ouverture de zone. Aucun accès au cache des packs pour ces métadonnées. */
export function buildingVisualLoader(worldId: string) {
  if (typeof location === 'undefined' || new URLSearchParams(location.search).get('visualBuildings') !== '1') return;
  const base = `${TILES_BASE}/worlds/${encodeURIComponent(worldId)}/tiles/`;
  const fresh = (file: string) => fetch(base + file, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  let index: Promise<BuildingVisualIndex | undefined> | undefined;

  return async (source: BuildingSourceTile, baseTile: ArrayBuffer, buildings: readonly TileBuilding[]) => {
    try {
      index ??= fresh(BUILDING_VISUAL_INDEX)
        .then(async (r) => r.ok ? parseBuildingVisualIndex(await r.json(), worldId) : undefined)
        .catch(() => undefined);
      const sha = (await index)?.tiles[source.tileId];
      if (!sha) return;
      const res = await fresh(`${buildingVisualTileFile(source.tileId)}?sha256=${sha}`);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      if (await digest(bytes) !== sha) return;
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const tile = parseBuildingVisualTile(value, source, await digest(baseTile), buildings);
      if (tile?.corrections.length) return new Map(tile.corrections.map((c) => [c.buildingId, c]));
    } catch {
      // Hors ligne, ancienne tuile en cache, document illisible ou vérification indisponible.
    }
  };
}
