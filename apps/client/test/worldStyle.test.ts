import { describe, expect, it } from 'vitest';
import { ROBERT_ISLAND, worldAvailableInStyle, worldIdsForStyle } from '../src/world/worlds.ts';

describe('zones disponibles par style graphique', () => {
  it.each(['real', 'v3'] as const)('garde la France et écarte l’île en %s', (style) => {
    expect(worldAvailableInStyle('longchamp', style)).toBe(true);
    expect(worldAvailableInStyle(ROBERT_ISLAND, style)).toBe(false);
    expect(worldIdsForStyle(ROBERT_ISLAND, style)).toEqual(['longchamp']);
    expect(worldIdsForStyle(`chevreuse+${ROBERT_ISLAND}+longchamp`, style)).toEqual(['chevreuse', 'longchamp']);
  });

  it('réserve le catalogue Poly à l’île et ouvre son propre repère', () => {
    expect(worldAvailableInStyle(ROBERT_ISLAND, 'lowpoly')).toBe(true);
    expect(worldAvailableInStyle('longchamp', 'lowpoly')).toBe(false);
    expect(worldIdsForStyle(`${ROBERT_ISLAND}+longchamp`, 'lowpoly')).toEqual([ROBERT_ISLAND]);
    expect(worldIdsForStyle(`longchamp+${ROBERT_ISLAND}`, 'lowpoly')).toEqual([ROBERT_ISLAND]);
    expect(worldIdsForStyle('longchamp', 'lowpoly')).toEqual([ROBERT_ISLAND]);
    expect(worldIdsForStyle('dev', 'lowpoly')).toEqual(['dev']);
  });
});
