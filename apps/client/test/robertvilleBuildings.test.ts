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

  it('peint en blanc les cabines de la plage, et elles seules', () => {
    const cabin = { ...building(1484, 10104, 'shed'), colour: '#d6403a', pts: [1484.5, 10104.9, 1482.8, 10104.9, 1482.8, 10103.1, 1484.5, 10103.1] };
    expect(robertvilleBuilding(cabin)).toMatchObject({ colour: '#fdfcf8', roof: 'gabled', pts: cabin.pts });
    const barn = building(1484, 10104, 'shed');
    expect(robertvilleBuilding(barn)).toBe(barn);
  });

  it('conserve les autres bourgs et les bâtiments remarquables', () => {
    for (const unchanged of [building(100, 320), building(100, 9500, 'apartments'), building(100, 9500, 'commercial')]) {
      expect(robertvilleBuilding(unchanged)).toBe(unchanged);
    }
  });
});
