import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RouteSegment } from '@allezrobert/shared';
import { buildKomIndex, zoneClimbs, type KomSourceZone } from '../src/ui/komCatalog.ts';
import { readSources } from '../scripts/kom-index.ts';

const kom = (id: string, name: string, startM = 0, endM = 1000, avgGrade = 5): RouteSegment => ({ id, kind: 'kom', name, startM, endM, avgGrade }) as RouteSegment;

describe('index des montées du Défi KOM', () => {
  const zones: KomSourceZone[] = [
    {
      id: 'z',
      routes: [
        { id: 'a', name: 'Boucle A', nameEn: 'Loop A', segments: [kom('a-k1', 'Côte 1'), { id: 'a-s', kind: 'sprint', name: 'Sprint', startM: 0, endM: 200, avgGrade: 0 } as RouteSegment] },
        { id: 'b', name: 'Boucle B', segments: [kom('b-k1', 'Côte 1'), kom('b-k2', 'Côte 2', 100, 700.04, 6.666)] },
        { id: 'g', name: 'Gravel', bike: 'gravel', segments: [kom('g-k1', 'Côte 1'), kom('g-k3', 'Chemin')] },
      ],
    },
    { id: 'plate', routes: [{ id: 'p', name: 'Plat', segments: [] }] },
  ];
  const idx = buildKomIndex(zones);

  it('garde chaque montée une fois par type de vélo, et les zones sans montée avec une liste vide', () => {
    expect(Object.keys(idx.zones)).toEqual(['z', 'plate']);
    expect(idx.zones.plate?.climbs).toEqual([]);
    expect(idx.zones.z?.climbs.map((c) => c.segId)).toEqual(['a-k1', 'b-k2', 'g-k1', 'g-k3']);
    expect(idx.zones.z?.climbs[1]).toMatchObject({ routeId: 'b', lengthM: 600, grade: 6.67 });
    expect(idx.zones.z?.bikes).toEqual(['road', 'gravel']);
  });

  it('propose les montées des itinéraires du vélo équipé, ou toutes si la zone n’en a pas', () => {
    const z = idx.zones.z!;
    expect(zoneClimbs(z, 'road', 'fr').map((c) => c.segId)).toEqual(['a-k1', 'b-k2']);
    expect(zoneClimbs(z, 'road', 'en')[0]?.routeName).toBe('Loop A');
    expect(zoneClimbs(z, 'gravel', 'fr').map((c) => c.segId)).toEqual(['g-k1', 'g-k3']);
    // Pas d'itinéraire VTT : tous les itinéraires, chaque nom une fois.
    expect(zoneClimbs(z, 'mtb', 'fr').map((c) => c.segId)).toEqual(['a-k1', 'b-k2', 'g-k3']);
  });

  it('src/data/komIndex.json est à jour avec les itinéraires publiés (sinon : npx tsx apps/client/scripts/kom-index.ts)', () => {
    const file = readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'komIndex.json'), 'utf8');
    expect(file).toBe(`${JSON.stringify(buildKomIndex(readSources()))}\n`);
  });
});
