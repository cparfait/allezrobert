import { describe, expect, it } from 'vitest';
import { PAIR_PLACE_MAX_ITEMS, type RoadGraphData, type WorldPlace } from '@allezrobert/shared';
import { buildPlaceIndex, normalizePlaceText, searchPlaces } from '../src/game/placeSearch.ts';

const places: WorldPlace[] = [
  { name: 'Chevreuse', kind: 'town', x: 0, z: 0 },
  { name: 'Saint-Rémy-lès-Chevreuse', kind: 'town', x: 2500, z: 0 },
  { name: 'Choisel', kind: 'village', x: -1200, z: 900 },
  { name: 'Les Molières', kind: 'village', x: 6000, z: 4000 },
  { name: 'Méridon', kind: 'hamlet', x: 300, z: -400 },
];

const edge = (name: string | undefined, pts: number[], ref?: string): RoadGraphData['edges'][number] => ({ a: 0, b: 1, kind: 'tertiary', ...(name ? { name } : {}), ...(ref ? { ref } : {}), width: 5, surface: 'asphalt', oneway: 0, len: 100, pts });

const graph: RoadGraphData = {
  formatVersion: 1,
  nodes: [],
  attribution: [],
  edges: [
    edge('Rue de la Division Leclerc', [0, 80, 0, 100, 80, 0]),
    edge('Rue de la Division Leclerc', [100, 80, 0, 900, 80, 50]),
    edge('Route de Choisel', [-600, 90, 400, -1000, 95, 800]),
    edge(undefined, [10, 80, 10, 20, 80, 20]),
    edge(undefined, [4000, 80, 0, 4100, 80, 0], 'D 906'),
    edge('Chemin de Chevreuse', [3000, 80, 3000, 3100, 80, 3000]),
  ],
};

const index = buildPlaceIndex(places, graph);
const me = { x: 50, z: 0 };

describe('recherche de destination du compagnon', () => {
  it('normalise la casse, les accents et la ponctuation', () => {
    expect(normalizePlaceText('  Saint-Rémy-lès-Chevreuse ')).toBe('saint remy les chevreuse');
    expect(normalizePlaceText('Cœur d’Orsay')).toBe('coeur d orsay');
  });

  it('requête vide : les lieux les plus proches, sans les routes', () => {
    const r = searchPlaces(index, '', me, 'fr');
    expect(r.map((i) => i.name)).toEqual(['Chevreuse', 'Méridon', 'Choisel', 'Saint-Rémy-lès-Chevreuse', 'Les Molières']);
    expect(r[0]?.sub).toBe('ville · 50 m');
    expect(r[4]?.sub).toMatch(/^village · 7,\d km$/);
  });

  it('début du nom, puis début de mot, puis le reste ; lieux avant routes ; puis distance', () => {
    const r = searchPlaces(index, 'chev', me, 'fr');
    // « Chevreuse » commence par la requête ; les deux autres n'ont qu'un mot qui commence par elle :
    // le lieu passe devant la route.
    expect(r.map((i) => i.name)).toEqual(['Chevreuse', 'Saint-Rémy-lès-Chevreuse', 'Chemin de Chevreuse']);
    expect(r[2]?.sub.startsWith('route · ')).toBe(true);
  });

  it('insensible aux accents et à la casse', () => {
    expect(searchPlaces(index, 'MERIDON', me, 'fr').map((i) => i.name)).toEqual(['Méridon']);
    expect(searchPlaces(index, 'saint remy', me, 'en')[0]).toMatchObject({ name: 'Saint-Rémy-lès-Chevreuse', sub: 'town · 2.5 km' });
  });

  it('une route nommée : un seul résultat, au point le plus proche du coureur', () => {
    const r = searchPlaces(index, 'division', me, 'fr');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Rue de la Division Leclerc', x: 0, z: 0 });
    expect(r[0]?.sub).toBe('route · 50 m');
  });

  it('une route sans nom se trouve par son numéro ; les arêtes anonymes sont ignorées', () => {
    expect(searchPlaces(index, 'd 906', me, 'fr').map((i) => i.name)).toEqual(['D 906']);
    expect(index.roads.map((r) => r.name).sort()).toEqual(['Chemin de Chevreuse', 'D 906', 'Route de Choisel', 'Rue de la Division Leclerc']);
  });

  it('une seule lettre ne ramène pas les routes', () => {
    expect(searchPlaces(index, 'c', me, 'fr').every((i) => !i.sub.startsWith('route'))).toBe(true);
  });

  it('rien de trouvé : liste vide ; nombre de résultats et longueur des noms bornés', () => {
    expect(searchPlaces(index, 'zzz', me, 'fr')).toEqual([]);
    const many: WorldPlace[] = Array.from({ length: 60 }, (_, i) => ({ name: `Hameau ${'x'.repeat(100)} ${i}`, kind: 'hamlet', x: i * 10, z: 0 }));
    const r = searchPlaces(buildPlaceIndex(many, undefined), 'hameau', me, 'fr');
    expect(r).toHaveLength(PAIR_PLACE_MAX_ITEMS);
    expect(r.every((i) => i.name.length <= 80)).toBe(true);
  });

  it('sans lieux ni graphe : index vide', () => {
    const empty = buildPlaceIndex(undefined, undefined);
    expect(empty.places).toEqual([]);
    expect(searchPlaces(empty, 'chevreuse', me, 'fr')).toEqual([]);
  });
});
