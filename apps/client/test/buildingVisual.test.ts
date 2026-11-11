import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldMeta, WorldTile } from '@allezrobert/shared';
import {
  parseBuildingVisualTile, type BuildingVisualCorrection, type BuildingVisualTile, type GableVisualCorrection, type RoofVisualCorrection,
  type VolumesVisualCorrection,
} from '@allezrobert/shared/building-visual';
import { createCompositeWorld } from '../src/world/composite.ts';
import { createFileWorld } from '../src/world/fileWorld.ts';
import { toFeatures } from '../src/world/tileDecode.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/building-visual/${name}`, import.meta.url), 'utf8');
const base = fixture('0_0.json');
const visual = fixture('0_0.buildings-visual.json');
const sha = (body: string) => createHash('sha256').update(body).digest('hex');
const buildingId = 'bdtopo:BATIMENT-SYNTHETIQUE';
const pitchOf = (c?: BuildingVisualCorrection) => (c?.kind === 'roof' ? c.pitchDeg : undefined);
const metadata = (id: string, east = 0): WorldMeta => ({
  formatVersion: 1, id, name: id, crs: 'EPSG:2154', originL93: { x: east, y: 0 },
  tileSizeM: 1000, heightResolutionM: 1000, bounds: { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
  heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
  tiles: [{ id: '0_0', tx: 0, tz: 0, baseM: 100, minM: 100, maxM: 100, lods: ['lo'], bytes: 0 }],
  routes: [], mainRoute: '', lods: [], attribution: [],
});

function network() {
  const state = {
    tile: base, document: visual, response: undefined as string | undefined,
    missing: false, missingPayload: false, indexWorld: undefined as string | undefined,
  };
  const fetchMock = vi.fn(async (path: string, _options?: RequestInit) => {
    const url = new URL(path, 'https://tiles.test');
    const [, , worldId, , file] = url.pathname.split('/');
    const body = worldId === 'zone-b' ? state.document.replace('zone-a', 'zone-b') : state.document;
    if (file === '0_0.json') return new Response(state.tile, { headers: { 'content-type': 'application/json' } });
    if (file === '0_0.lo.u16') return new Response(new ArrayBuffer(8));
    if (state.missing) return new Response(null, { status: 404 });
    if (file === 'buildings-visual.json') return Response.json({
      schemaVersion: 1, worldId: state.indexWorld ?? worldId, tiles: { '0_0': sha(body) },
    });
    if (file === '0_0.buildings-visual.json') {
      return state.missingPayload ? new Response(null, { status: 404 }) : new Response(state.response ?? body);
    }
    throw new Error(`Requête inattendue : ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

const enable = () => vi.stubGlobal('location', { search: '?visualBuildings=1' });
const load = async () => (await createFileWorld('zone-a', metadata('zone-a'))).loadTile(0, 0);
const sourceBuildings = () => toFeatures(JSON.parse(base) as WorldTile).buildings;
afterEach(() => vi.unstubAllGlobals());

describe('corrections visuelles des bâtiments', () => {
  it('préserve les identifiants de source, les anciens objets et leur ordre sans requête visuelle par défaut', async () => {
    vi.stubGlobal('location', { search: '' });
    const { fetchMock } = network();
    const tile = await load();
    expect(tile?.buildingSource).toEqual({ worldId: 'zone-a', tileId: '0_0' });
    expect(tile?.features.buildings).toEqual(sourceBuildings());
    expect(tile?.features.buildings.map((b) => b.id)).toEqual([buildingId, 'w220', undefined]);
    expect(tile?.features.buildings[2]).not.toHaveProperty('id');
    expect(tile?.buildingVisualCorrections).toBeUndefined();
    expect(fetchMock.mock.calls.map(([path]) => path).sort()).toEqual([
      '/worlds/zone-a/tiles/0_0.json', '/worlds/zone-a/tiles/0_0.lo.u16',
    ]);
  });

  it('expose la mesure validée sans remplacer les champs géométriques de la tuile', async () => {
    enable();
    const { state, fetchMock } = network();
    const payload: BuildingVisualTile = JSON.parse(visual);
    // Des champs étrangers au contrat ne doivent jamais traverser le décodeur.
    Object.assign(payload.corrections[0]!, { pts: [0, 0], height: 999, solid: false });
    state.document = JSON.stringify(payload);
    const tile = await load();
    expect(tile?.buildingVisualCorrections?.get(buildingId)).toEqual(JSON.parse(visual).corrections[0]);
    expect(tile?.features.buildings).toEqual(sourceBuildings());
    expect(fetchMock).toHaveBeenCalledWith(
      `/worlds/zone-a/tiles/0_0.buildings-visual.json?sha256=${sha(state.document)}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenCalledWith('/worlds/zone-a/tiles/buildings-visual.json', expect.objectContaining({ cache: 'no-store' }));
  });

  it.each([
    ['bâtiment inconnu', (x: BuildingVisualTile) => { x.corrections[0]!.buildingId = 'w999'; }],
    ['tuile différente', (x: BuildingVisualTile) => { x.tileId = '1_0'; }],
    ['zone différente', (x: BuildingVisualTile) => { x.worldId = 'zone-b'; }],
    ['version différente', (x: BuildingVisualTile) => { Object.assign(x, { schemaVersion: 2 }); }],
    ['mesure impossible', (x: BuildingVisualTile) => { (x.corrections[0] as RoofVisualCorrection).pitchDeg = 90; }],
    ['doublon de correction', (x: BuildingVisualTile) => { x.corrections.push(x.corrections[0]!); }],
  ] as const)('se replie en cas de %s', async (_reason, mutate) => {
    enable();
    const { state } = network();
    const payload = JSON.parse(visual) as BuildingVisualTile;
    mutate(payload);
    state.document = JSON.stringify(payload);
    const tile = await load();
    expect(tile?.buildingVisualCorrections).toBeUndefined();
    expect(tile?.features.buildings).toEqual(sourceBuildings());
  });

  it('tolère les fichiers manquants et refuse l’index d’une autre zone', async () => {
    enable();
    const { state } = network();
    state.missing = true;
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
    state.missing = false;
    state.indexWorld = 'zone-b';
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
    state.indexWorld = undefined;
    state.missingPayload = true;
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
  });

  it('refuse une identité ambiguë sans supprimer ni renuméroter les bâtiments', async () => {
    enable();
    const { state } = network();
    state.tile = base.replace('w220', buildingId);
    const payload: BuildingVisualTile = JSON.parse(visual);
    payload.sourceTileSha256 = sha(state.tile);
    state.document = JSON.stringify(payload);
    const tile = await load();
    expect(tile?.features.buildings.map((b) => b.id)).toEqual([buildingId, buildingId, undefined]);
    expect(tile?.buildingVisualCorrections).toBeUndefined();
  });

  it('refuse un fichier périmé de même taille, puis charge le nouvel identifiant de contenu', async () => {
    enable();
    const { state, fetchMock } = network();
    expect(pitchOf((await load())?.buildingVisualCorrections?.get(buildingId))).toBe(24);
    state.document = visual.replace('"pitchDeg": 24', '"pitchDeg": 25');
    expect(Buffer.byteLength(state.document)).toBe(Buffer.byteLength(visual));
    expect(sha(state.document)).not.toBe(sha(visual));
    state.response = visual;
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
    state.response = undefined;
    expect(pitchOf((await load())?.buildingVisualCorrections?.get(buildingId))).toBe(25);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain(`/worlds/zone-a/tiles/0_0.buildings-visual.json?sha256=${sha(visual)}`);
    expect(urls).toContain(`/worlds/zone-a/tiles/0_0.buildings-visual.json?sha256=${sha(state.document)}`);
    state.tile = base.replace('w220', 'w221');
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
  });

  it('garde le namespace de la zone propriétaire après translation et ne mélange pas les mêmes IDs source', async () => {
    enable();
    network();
    const a = await createFileWorld('zone-a', metadata('zone-a'));
    const b = await createFileWorld('zone-b', metadata('zone-b', 1000));
    const composed = createCompositeWorld([a, b]);
    const ta = await composed.loadTile(0, 0);
    const tb = await composed.loadTile(1, 0);
    expect(ta?.buildingSource).toEqual({ worldId: 'zone-a', tileId: '0_0' });
    expect(tb?.buildingSource).toEqual({ worldId: 'zone-b', tileId: '0_0' });
    expect(tb?.id).toBe('1_0');
    expect(tb?.features.buildings[0]).toMatchObject({ id: buildingId, pts: [1010,10,1020,10,1020,16,1010,16] });
    expect(pitchOf(tb?.buildingVisualCorrections?.get(buildingId))).toBe(24);
  });

  it('expose un pignon v2 relatif à l’emprise, qui suit le bâtiment translaté par un monde composite', async () => {
    enable();
    const { state } = network();
    const gable: GableVisualCorrection = {
      buildingId, kind: 'gable', ridgeM: 106, ridge: [0, 2, 10, 2], pitchLeftDeg: 18, pitchRightDeg: 25, confidence: 'high',
      provenance: { dataset: 'fixture', reference: 'pignon', observedOn: '2000-01-01', method: 'profil synthétique' },
    };
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 2, corrections: [gable] });
    expect((await load())?.buildingVisualCorrections?.get(buildingId)).toEqual(gable);
    const composed = createCompositeWorld([
      await createFileWorld('zone-a', metadata('zone-a')), await createFileWorld('zone-b', metadata('zone-b', 1000)),
    ]);
    const tb = await composed.loadTile(1, 0);
    const pts = tb!.features.buildings[0]!.pts;
    expect(tb?.buildingVisualCorrections?.get(buildingId)).toEqual(gable);
    // Faîtage ramené dans le repère translaté : sur la ligne z = 12, de x = 1010 à 1020, dans l'emprise.
    expect([pts[0]! + gable.ridge[0], pts[1]! + gable.ridge[1], pts[0]! + gable.ridge[2], pts[1]! + gable.ridge[3]]).toEqual([1010, 12, 1020, 12]);
  });

  it('expose des volumes v3, qui suivent le bâtiment translaté, et se replie sur une couverture incomplète', async () => {
    enable();
    const { state } = network();
    const volumes: VolumesVisualCorrection = {
      buildingId, kind: 'volumes', confidence: 'high',
      provenance: { dataset: 'fixture', reference: 'volumes', observedOn: '2000-01-01', method: 'profil synthétique' },
      parts: [
        { pts: [0, 0, 5, 0, 5, 6, 0, 6], roof: { type: 'gable', ridgeM: 106, ridge: [0, 3, 5, 3], pitchLeftDeg: 20, pitchRightDeg: 25 } },
        { pts: [5, 0, 10, 0, 10, 6, 5, 6], roof: { type: 'flat', topM: 104 } },
      ],
    };
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 3, corrections: [volumes] });
    expect((await load())?.buildingVisualCorrections?.get(buildingId)).toEqual(volumes);
    const composed = createCompositeWorld([
      await createFileWorld('zone-a', metadata('zone-a')), await createFileWorld('zone-b', metadata('zone-b', 1000)),
    ]);
    const tb = await composed.loadTile(1, 0);
    const pts = tb!.features.buildings[0]!.pts;
    expect(tb?.buildingVisualCorrections?.get(buildingId)).toEqual(volumes);
    expect([pts[0]! + volumes.parts[1]!.pts[2]!, pts[1]! + volumes.parts[1]!.pts[3]!]).toEqual([1020, 10]);
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 3, corrections: [{ ...volumes, parts: [volumes.parts[0]] }] });
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 2, corrections: [volumes] });
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
  });

  it('expose une monopente v3 et se replie sur une direction non unitaire', async () => {
    enable();
    const { state } = network();
    const volumes: VolumesVisualCorrection = {
      buildingId, kind: 'volumes', confidence: 'high',
      provenance: { dataset: 'fixture', reference: 'monopente', observedOn: '2000-01-01', method: 'profil synthétique' },
      parts: [{ pts: [0, 0, 10, 0, 10, 6, 0, 6], roof: { type: 'shed', topM: 106, through: [0, 0], down: [0, 1], pitchDeg: 15 } }],
    };
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 3, corrections: [volumes] });
    expect((await load())?.buildingVisualCorrections?.get(buildingId)).toEqual(volumes);
    const bad = { ...volumes, parts: [{ ...volumes.parts[0]!, roof: { type: 'shed', topM: 106, through: [0, 0], down: [1, 1], pitchDeg: 15 } }] };
    state.document = JSON.stringify({ ...JSON.parse(visual), schemaVersion: 3, corrections: [bad] });
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
  });

  it.each([
    ['pignon dans un complément v1', (x: Record<string, unknown>) => { x.schemaVersion = 1; }],
    ['faîtage hors emprise', (x: { corrections: GableVisualCorrection[] }) => { x.corrections[0]!.ridge = [40, 2, 50, 2]; }],
    ['pente nulle', (x: { corrections: GableVisualCorrection[] }) => { x.corrections[0]!.pitchLeftDeg = 0; }],
  ] as const)('se replie pour un %s', async (_reason, mutate) => {
    enable();
    const { state } = network();
    const payload = {
      ...JSON.parse(visual), schemaVersion: 2,
      corrections: [{ ...JSON.parse(visual).corrections[0], kind: 'gable', ridge: [0, 2, 10, 2], pitchLeftDeg: 18, pitchRightDeg: 25 }],
    };
    delete payload.corrections[0].eaveM;
    delete payload.corrections[0].pitchDeg;
    expect(parseBuildingVisualTile(payload, { worldId: 'zone-a', tileId: '0_0' }, sha(base), sourceBuildings())).toBeDefined();
    (mutate as (x: typeof payload) => void)(payload);
    state.document = JSON.stringify(payload);
    expect((await load())?.buildingVisualCorrections).toBeUndefined();
  });
});
