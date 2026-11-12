import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildingVisualCorrection, GableVisualCorrection, VolumesVisualCorrection } from '@allezrobert/shared/building-visual';
import { readManualCorrections, writeMergedCorrections } from '../src/building-visual.ts';

const worldId = 'zone-test';
const tileId = '0_0';
const provenance = { dataset: 'fixture', reference: 'manuel', observedOn: '2000-01-01', method: 'profil synthétique' };
const base = JSON.stringify({
  id: tileId, buildings: [
    { id: 'b1', pts: [10, 10, 18, 10, 18, 16, 10, 16], y: 100, height: 7, roof: { shape: 'gabled', height: 3 } },
    { id: 'b2', pts: [30, 10, 38, 10, 38, 16, 30, 16], y: 100, height: 7, roof: { shape: 'gabled', height: 3 } },
  ],
});
const gable = (buildingId: string, ridgeM = 106): GableVisualCorrection => ({
  buildingId, kind: 'gable', ridgeM, ridge: [0, 3, 8, 3], pitchLeftDeg: 20, pitchRightDeg: 25, confidence: 'high', provenance,
});
const volumes = (buildingId: string): VolumesVisualCorrection => ({
  buildingId, kind: 'volumes', confidence: 'medium', provenance,
  parts: [{ pts: [0, 0, 8, 0, 8, 6, 0, 6], roof: { type: 'shed', topM: 105, through: [0, 0], down: [0, 1], pitchDeg: 15 } }],
});

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function world() {
  root = await mkdtemp(join(tmpdir(), 'ar-building-visual-manual-'));
  await mkdir(join(root, 'tiles'));
  await mkdir(join(root, 'manuel'));
  await writeFile(join(root, 'tiles', `${tileId}.json`), base);
  return root;
}
const readVisual = async (dir: string) => JSON.parse(await readFile(join(dir, 'tiles', `${tileId}.buildings-visual.json`), 'utf8'));

describe('corrections manuelles relues à la construction', () => {
  it('l’emporte sur la correction automatique du même bâtiment et complète les autres', async () => {
    const dir = await world();
    const auto = new Map<string, BuildingVisualCorrection[]>([[tileId, [volumes('b1'), volumes('b2')]]]);
    const manual = new Map<string, unknown[]>([[tileId, [gable('b1')]]]);
    const r = await writeMergedCorrections(dir, worldId, auto, manual);
    expect(r).toEqual({ written: 2, manual: 1, rejected: [] });
    const visual = await readVisual(dir);
    expect(visual.schemaVersion).toBe(3);
    expect(visual.corrections.map((c: { buildingId: string; kind: string }) => [c.buildingId, c.kind])).toEqual([['b1', 'gable'], ['b2', 'volumes']]);
  });

  it('écarte une correction manuelle périmée ou invalide sans faire échouer la tuile', async () => {
    const dir = await world();
    const manual = new Map<string, unknown[]>([[tileId, [gable('b9'), { ...gable('b2'), pitchLeftDeg: 0 }, gable('b1')]], ['5_5', [gable('b1')]]]);
    const r = await writeMergedCorrections(dir, worldId, new Map(), manual);
    expect(r.written).toBe(1);
    expect(r.rejected).toEqual([
      { tileId, buildingId: 'b9', manual: true },
      { tileId, buildingId: 'b2', manual: true },
      { tileId: '5_5', buildingId: 'b1', manual: true },
    ]);
    // Un pignon seul : complément en v2, lisible par les clients v2.
    expect((await readVisual(dir)).schemaVersion).toBe(2);
  });

  it('lit le fichier d’une zone, refuse un autre monde ou une tuile mal nommée, ignore une zone sans fichier', async () => {
    const dir = await world();
    const file = join(dir, 'manuel', `${worldId}.json`);
    await writeFile(file, JSON.stringify({ worldId, tiles: { [tileId]: [gable('b1')] } }));
    expect(readManualCorrections(worldId, join(dir, 'manuel')).get(tileId)).toHaveLength(1);
    expect(readManualCorrections('autre', join(dir, 'manuel')).size).toBe(0);
    await writeFile(file, JSON.stringify({ worldId: 'autre', tiles: {} }));
    expect(() => readManualCorrections(worldId, join(dir, 'manuel'))).toThrow();
    await writeFile(file, JSON.stringify({ worldId, tiles: { '../x': [gable('b1')] } }));
    expect(() => readManualCorrections(worldId, join(dir, 'manuel'))).toThrow();
  });

  it('les corrections manuelles de Limagne (49 et 54) sont bien formées', () => {
    const m = readManualCorrections('limagne');
    const list = m.get('-1_-1') as Array<{ buildingId: string; kind: string }>;
    expect(list.map((c) => [c.buildingId, c.kind])).toEqual([
      ['bdtopo:BATIMENT0000000310275523', 'gable'],
      ['bdtopo:BATIMENT0000000310275567', 'volumes'],
    ]);
  });
});
