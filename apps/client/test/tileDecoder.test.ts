import { describe, expect, it } from 'vitest';
import type { WorldTile } from '@allezrobert/shared';
import { decodeTileBytes } from '../src/world/tileDecoder.ts';

const tile = {
  id: '0_0',
  tx: 0,
  tz: 0,
  bounds: { minX: 0, minZ: 0, maxX: 500, maxZ: 500 },
  heights: { baseM: 100, stepM: 0.5, encoding: 'uint16le', lo: { n: 1, resolutionM: 500, file: '0_0.lo.u16' }, hi: { n: 1, resolutionM: 500, file: '0_0.hi.u16' } },
  roads: [{ id: 'r1', kind: 'primary', width: 6, surface: 'asphalt', pts: [0, 101, 0, 10, 102, 20] }],
  buildings: [],
  forests: [],
  water: [],
  fields: [],
  landuse: [],
  waterways: [],
  pois: [],
} as unknown as WorldTile;

const json = () => new TextEncoder().encode(JSON.stringify(tile)).buffer as ArrayBuffer;
const grid = () => new Uint16Array([0, 2, 4, 6]).buffer;

describe('decodeTileBytes (sans Worker : décodage sur place)', () => {
  it('altitudes absolues et routes à plat (x, z)', async () => {
    const t = await decodeTileBytes(json(), grid(), '0_0.hi.u16', () => Promise.reject(new Error('pas de nouvelle grille')));
    expect(t.n).toBe(1);
    expect(Array.from(t.heights)).toEqual([100, 101, 102, 103]);
    expect(t.features.roads[0]?.pts).toEqual([0, 0, 10, 20]);
    expect(t.features.roads[0]?.pts3).toEqual([0, 101, 0, 10, 102, 20]);
  });

  it('grille devinée fausse ou absente : charge celle que la tuile annonce', async () => {
    const asked: string[] = [];
    const load = (f: string) => (asked.push(f), Promise.resolve(grid()));
    await decodeTileBytes(json(), grid(), '0_0.lo.u16', load);
    await decodeTileBytes(json(), null, null, load);
    expect(asked).toEqual(['0_0.hi.u16', '0_0.hi.u16']);
  });
});
