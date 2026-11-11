import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldTile } from '@allezrobert/shared';
import {
  BUILDING_VISUAL_INDEX, BUILDING_VISUAL_INDEX_SCHEMA, buildingVisualTileFile, buildingVisualTileSchema,
  parseBuildingVisualIndex, parseBuildingVisualTile, type BuildingVisualCorrection,
} from '@allezrobert/shared/building-visual';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

async function replace(file: string, text: string): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, text, { flag: 'wx' });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Point d'intégration de la construction commune, après les tuiles de base et avant les packs.
 * Les mesures viennent du futur producteur ou d'une revue locale. Aucun build ne l'appelle en 2a.
 */
export async function writeBuildingVisualCorrections(
  worldDir: string,
  worldId: string,
  byTile: ReadonlyMap<string, readonly BuildingVisualCorrection[]>,
): Promise<void> {
  const dir = join(worldDir, 'tiles');
  const files: Array<{ name: string; content: string }> = [];
  const tiles: Record<string, string> = {};
  // Valider tout le lot avant d'écrire. L'index est publié après les compléments.
  for (const [tileId, corrections] of [...byTile].sort(([a], [b]) => compare(a, b))) {
    if (!corrections.length) continue;
    const name = buildingVisualTileFile(tileId);
    const bytes = await readFile(join(dir, `${tileId}.json`));
    const tile = JSON.parse(bytes.toString('utf8')) as WorldTile;
    if (tile.id !== tileId || !Array.isArray(tile.buildings)) throw new Error(`Tuile source invalide : ${tileId}`);
    const source = { worldId, tileId };
    const sourceTileSha256 = sha256(bytes);
    // Version la plus basse qui suffit : un lot sans pignon reste lisible par les clients v1.
    const input = { schemaVersion: buildingVisualTileSchema(corrections), ...source, sourceTileSha256, corrections };
    const visual = parseBuildingVisualTile(input, source, sourceTileSha256, tile.buildings);
    if (!visual) throw new Error(`Corrections visuelles invalides : ${tileId}`);
    visual.corrections.sort((a, b) => compare(a.buildingId, b.buildingId));
    const content = `${JSON.stringify(visual, null, 2)}\n`;
    files.push({ name, content });
    tiles[tileId] = sha256(content);
  }
  const index = parseBuildingVisualIndex({ schemaVersion: BUILDING_VISUAL_INDEX_SCHEMA, worldId, tiles }, worldId);
  if (!index) throw new Error('Index des corrections visuelles invalide');
  for (const { name, content } of files) await replace(join(dir, name), content);
  await replace(join(dir, BUILDING_VISUAL_INDEX), `${JSON.stringify(index, null, 2)}\n`);
}
