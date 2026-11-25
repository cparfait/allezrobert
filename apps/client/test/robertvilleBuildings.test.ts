import { describe, expect, it } from 'vitest';
import { robertvilleBuilding } from '../src/world/robertvilleBuildings.ts';
import type { TileBuilding } from '../src/world/types.ts';

function building(x: number, z: number, kind = 'house'): TileBuilding {
  return { kind, height: 8, roof: 'gabled', pts: [x, z, x + 8, z, x + 8, z + 9, x, z + 9] };
}

describe('maisons de Robertville', () => {
  it('varie durablement les silhouettes dans les deux tissus résidentiels', () => {
    const houses = [9100, 9850].flatMap((z) => Array.from({ length: 60 }, (_, i) => building(i * 30 - 700, z)));
    const variants = houses.map(robertvilleBuilding);
    expect(new Set(variants.map((variant) => variant.roof))).toEqual(new Set(['gabled', 'hipped', 'skillion', 'flat']));
    expect(new Set(variants.map((variant) => variant.levels))).toEqual(new Set([1, 2, 3]));
    expect(new Set(variants.map((variant) => variant.colour)).size).toBeGreaterThan(15);
    expect(variants).toEqual(houses.map(robertvilleBuilding));
    for (const [i, variant] of variants.entries()) expect(variant.pts).toBe(houses[i]!.pts);
  });

  it('conserve les autres bourgs et les bâtiments remarquables', () => {
    for (const unchanged of [building(100, 320), building(100, 9500, 'apartments'), building(100, 9500, 'commercial')]) {
      expect(robertvilleBuilding(unchanged)).toBe(unchanged);
    }
  });
});
