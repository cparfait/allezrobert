import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Corrections manuelles d'une zone (mesures revues à la main, ZONES-BAT) : `tools/terrain/building-visual/
 * <zone>.json` = { worldId, tiles: { "<tx>_<tz>": [correction, …] } }. Relues à chaque construction, elles
 * l'emportent sur les corrections automatiques du même bâtiment. Le contenu n'est validé qu'au moment de
 * l'écriture, contre les octets définitifs de la tuile.
 */
export const MANUAL_CORRECTIONS_DIR = fileURLToPath(new URL('../building-visual/', import.meta.url));

export function readManualCorrections(worldId: string, dir = MANUAL_CORRECTIONS_DIR): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  const file = join(dir, `${worldId}.json`);
  if (!existsSync(file)) return out;
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { worldId?: unknown; tiles?: Record<string, unknown> };
  if (doc.worldId !== worldId || typeof doc.tiles !== 'object' || doc.tiles === null) throw new Error(`Corrections manuelles invalides : ${file}`);
  for (const [tileId, list] of Object.entries(doc.tiles)) {
    if (!/^-?\d+_-?\d+$/.test(tileId)) throw new Error(`Identifiant de tuile invalide dans ${file} : ${tileId}`);
    if (Array.isArray(list) && list.length) out.set(tileId, list);
  }
  return out;
}

const SCHEMA_OF_KIND: Record<string, 1 | 2 | 3> = { roof: 1, gable: 2, volumes: 3 };

/**
 * Fusionne corrections manuelles et automatiques (le manuel l'emporte pour un même bâtiment), valide chaque
 * correction seule contre la tuile écrite, puis publie le lot valide. Une correction refusée (bâtiment absent
 * ou ambigu, géométrie hors contrat) est écartée et signalée sans faire échouer la tuile.
 */
export async function writeMergedCorrections(
  worldDir: string,
  worldId: string,
  auto: ReadonlyMap<string, readonly BuildingVisualCorrection[]>,
  manual: ReadonlyMap<string, readonly unknown[]>,
): Promise<{ written: number; manual: number; rejected: Array<{ tileId: string; buildingId: string; manual: boolean }> }> {
  const valid = new Map<string, BuildingVisualCorrection[]>();
  const rejected: Array<{ tileId: string; buildingId: string; manual: boolean }> = [];
  let written = 0, kept = 0;
  for (const tileId of [...new Set([...auto.keys(), ...manual.keys()])].sort(compare)) {
    const file = join(worldDir, 'tiles', `${tileId}.json`);
    const man = manual.get(tileId) ?? [];
    if (!existsSync(file)) {
      for (const m of man) rejected.push({ tileId, buildingId: String((m as { buildingId?: unknown }).buildingId), manual: true });
      continue;
    }
    const bytes = await readFile(file);
    const tile = JSON.parse(bytes.toString('utf8')) as WorldTile;
    const sourceTileSha256 = sha256(bytes);
    const source = { worldId, tileId };
    const one = (c: unknown): BuildingVisualCorrection | undefined => {
      const kind = (c as { kind?: unknown }).kind;
      const schemaVersion = typeof kind === 'string' ? SCHEMA_OF_KIND[kind] : undefined;
      if (!schemaVersion) return;
      return parseBuildingVisualTile({ schemaVersion, ...source, sourceTileSha256, corrections: [c] }, source, sourceTileSha256, tile.buildings)?.corrections[0];
    };
    const list: BuildingVisualCorrection[] = [];
    const ids = new Set<string>();
    for (const m of man) {
      const c = one(m);
      const id = String((m as { buildingId?: unknown }).buildingId);
      if (!c || ids.has(id)) { rejected.push({ tileId, buildingId: id, manual: true }); continue; }
      list.push(c); ids.add(id); kept++;
    }
    for (const a of auto.get(tileId) ?? []) {
      if (ids.has(a.buildingId)) continue;
      const c = one(a);
      if (!c) { rejected.push({ tileId, buildingId: a.buildingId, manual: false }); continue; }
      list.push(c); ids.add(a.buildingId);
    }
    if (list.length) { valid.set(tileId, list); written += list.length; }
  }
  if (valid.size) await writeBuildingVisualCorrections(worldDir, worldId, valid);
  return { written, manual: kept, rejected };
}
