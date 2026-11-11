import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseBuildingVisualTile, type GableVisualCorrection, type RoofVisualCorrection, type VolumePart, type VolumesVisualCorrection,
} from '@allezrobert/shared/building-visual';
import { writeBuildingVisualCorrections } from '../src/building-visual.ts';
import { writePackManifest } from '../src/packs.ts';

const worldId = 'zone-test';
const tileId = '0_0';
const polygon = [10, 10, 18, 10, 18, 16, 10, 16];
const base = JSON.stringify({
  id: tileId, buildings: [
    { id: 'w2', pts: polygon, y: 100, height: 7, roof: { shape: 'gabled', height: 3 } },
    { id: 'w1' },
  ],
});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const correction = (buildingId = 'w2', pitchDeg = 24): RoofVisualCorrection => ({
  buildingId, kind: 'roof', eaveM: 104, ridgeM: 106, pitchDeg, confidence: 'high',
  provenance: { dataset: 'fixture', reference: 'plan-1', observedOn: '2000-01-01', method: 'profil synthétique' },
});
/** Faîtage d'ouest en est à 3 m du premier sommet (10, 10) : pan gauche au nord, pan droit au sud. */
const gable = (buildingId = 'w2', ridge: [number, number, number, number] = [0, 3, 8, 3]): GableVisualCorrection => ({
  buildingId, kind: 'gable', ridgeM: 106, ridge, pitchLeftDeg: 20, pitchRightDeg: 30, confidence: 'high',
  provenance: { dataset: 'fixture', reference: 'plan-1', observedOn: '2000-01-01', method: 'profil synthétique' },
});
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function world() {
  root = await mkdtemp(join(tmpdir(), 'ar-building-visual-'));
  const dir = join(root, 'tiles');
  await mkdir(dir);
  await writeFile(join(dir, '0_0.json'), base);
  return { root, dir };
}

describe('publication des compléments visuels', () => {
  it('est déterministe et laisse la tuile de base intacte', async () => {
    const { root, dir } = await world();
    const readVisual = () => readFile(join(dir, '0_0.buildings-visual.json'), 'utf8');
    const readIndex = () => readFile(join(dir, 'buildings-visual.json'), 'utf8');
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction(), correction('w1')]]]));
    const visual = await readVisual();
    const index = await readIndex();
    expect(JSON.parse(index).tiles).toEqual({ [tileId]: sha(visual) });
    expect(JSON.parse(visual).sourceTileSha256).toBe(sha(base));
    expect(JSON.parse(visual).corrections.map((c: RoofVisualCorrection) => c.buildingId)).toEqual(['w1', 'w2']);
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction('w1'), correction()]]]));
    expect(await readVisual()).toBe(visual);
    expect(await readIndex()).toBe(index);
    expect(await readFile(join(dir, '0_0.json'), 'utf8')).toBe(base);
  });

  it('refuse un lot avec un ID inconnu sans publier de complément', async () => {
    const { root, dir } = await world();
    await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction('w999')]]]))).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['0_0.json']);
  });

  it('écrit la version la plus basse qui suffit et garde l’index en v1', async () => {
    const { root, dir } = await world();
    const read = async (file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction()]]]));
    expect((await read('0_0.buildings-visual.json')).schemaVersion).toBe(1);
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [gable()]]]));
    const visual = await read('0_0.buildings-visual.json');
    expect(visual.schemaVersion).toBe(2);
    expect(visual.corrections).toEqual([gable()]);
    expect((await read('buildings-visual.json')).schemaVersion).toBe(1);
    expect(await readFile(join(dir, '0_0.json'), 'utf8')).toBe(base);
  });

  it('refuse un pignon hors de l’emprise ou sur un bâtiment sans emprise, sans rien publier', async () => {
    const { root, dir } = await world();
    for (const bad of [gable('w2', [0, 3, 30, 3]), gable('w2', [0, 3, 0.5, 3]), gable('w1'), { ...gable(), pitchLeftDeg: 0 }, { ...gable(), pitchRightDeg: 61 }]) {
      await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [bad]]]))).rejects.toThrow();
    }
    expect(await readdir(dir)).toEqual(['0_0.json']);
  });

  it('écrit un complément v3 pour des volumes qui couvrent l’emprise et refuse une couverture incomplète', async () => {
    const { root, dir } = await world();
    const volumes = (parts: VolumePart[]): VolumesVisualCorrection => ({
      buildingId: 'w2', kind: 'volumes', parts, confidence: 'high',
      provenance: { dataset: 'fixture', reference: 'volumes', observedOn: '2000-01-01', method: 'profil synthétique' },
    });
    // Emprise 8 × 6 m à partir de (10, 10) : moitié ouest à deux pans, moitié est plate.
    const west: VolumePart = { pts: [0, 0, 4, 0, 4, 6, 0, 6], roof: { type: 'gable', ridgeM: 106, ridge: [2, 0, 2, 6], pitchLeftDeg: 20, pitchRightDeg: 20 } };
    const east: VolumePart = { pts: [4, 0, 8, 0, 8, 6, 4, 6], roof: { type: 'flat', topM: 104 } };
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([west, east]), correction('w1')]]]));
    const visual = JSON.parse(await readFile(join(dir, '0_0.buildings-visual.json'), 'utf8'));
    expect(visual.schemaVersion).toBe(3);
    expect(visual.corrections.map((c: { kind: string }) => c.kind)).toEqual(['roof', 'volumes']);
    expect(visual.corrections[1].parts).toEqual([west, east]);
    expect(JSON.parse(await readFile(join(dir, 'buildings-visual.json'), 'utf8')).schemaVersion).toBe(1);
    await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([west])]]]))).rejects.toThrow();
    const crossed: VolumePart = { ...east, pts: [4, 0, 8, 6, 8, 0, 4, 6] };
    await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([west, crossed])]]]))).rejects.toThrow();
    const ridgeOut: VolumePart = { ...west, roof: { type: 'gable', ridgeM: 106, ridge: [7, 0, 7, 6], pitchLeftDeg: 20, pitchRightDeg: 20 } };
    await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([ridgeOut, east])]]]))).rejects.toThrow();
    // Monopente : acceptée avec une direction unitaire, refusée sinon, ou avec un appui hors du volume.
    const shed: VolumePart = { ...east, roof: { type: 'shed', topM: 105, through: [4, 0], down: [0, 1], pitchDeg: 15 } };
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([west, shed])]]]));
    expect(JSON.parse(await readFile(join(dir, '0_0.buildings-visual.json'), 'utf8')).corrections[0].parts[1]).toEqual(shed);
    for (const roof of [{ ...shed.roof, down: [1, 1] }, { ...shed.roof, pitchDeg: 0 }, { ...shed.roof, through: [30, 0] }]) {
      await expect(writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [volumes([west, { ...east, roof } as VolumePart])]]]))).rejects.toThrow();
    }
    expect(await readFile(join(dir, '0_0.json'), 'utf8')).toBe(base);
  });

  it('refuse un pignon déclaré en v1 et un complément v2 sans pignon', () => {
    const doc = (schemaVersion: number, corrections: unknown[]) => ({ schemaVersion, worldId, tileId, sourceTileSha256: sha(base), corrections });
    const buildings = JSON.parse(base).buildings;
    const parse = (value: unknown) => parseBuildingVisualTile(value, { worldId, tileId }, sha(base), buildings);
    expect(parse(doc(2, [gable(), correction('w1')]))?.corrections).toHaveLength(2);
    expect(parse(doc(1, [gable()]))).toBeUndefined();
    expect(parse(doc(2, [correction()]))).toBeUndefined();
    expect(parse(doc(3, [gable()]))).toBeUndefined();
  });

  it('conserve la version historique des packs ordinaires et détecte une correction de même taille', async () => {
    const { root } = await world();
    const legacy = writePackManifest(root, worldId);
    expect(legacy?.version).toBe(createHash('sha1').update(`tiles/0_0.json:${Buffer.byteLength(base)}\n`).digest('hex').slice(0, 12));
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction()]]]));
    const first = writePackManifest(root, worldId);
    await writeBuildingVisualCorrections(root, worldId, new Map([[tileId, [correction('w2', 25)]]]));
    const next = writePackManifest(root, worldId);
    expect(next?.files.map(({ p, b }) => [p, b])).toEqual(first?.files.map(({ p, b }) => [p, b]));
    expect(next?.version).not.toBe(first?.version);
  });
});
