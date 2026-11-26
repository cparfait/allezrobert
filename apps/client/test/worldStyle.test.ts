import { describe, expect, it } from 'vitest';
import { POLY_LAND_IDS, ROBERT_ISLAND, ROBERT_LAND, worldAvailableInStyle, worldIdsForStyle } from '../src/world/worlds.ts';
import { POLY_WORLDS, polyWorld } from '../src/world/polyWorlds.ts';

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

  it('propose aussi le Pays de Robert en Poly, seul, et jamais en Réel ni en Bêta', () => {
    expect(worldAvailableInStyle(ROBERT_LAND, 'lowpoly')).toBe(true);
    expect(worldAvailableInStyle(ROBERT_LAND, 'real')).toBe(false);
    expect(worldAvailableInStyle(ROBERT_LAND, 'v3')).toBe(false);
    expect(worldIdsForStyle(ROBERT_LAND, 'lowpoly')).toEqual([ROBERT_LAND]);
    expect(worldIdsForStyle(`${ROBERT_LAND}+${ROBERT_ISLAND}`, 'lowpoly')).toEqual([ROBERT_LAND]);
    expect(worldIdsForStyle(ROBERT_LAND, 'real')).toEqual(['longchamp']);
    expect(worldIdsForStyle(`chevreuse+${ROBERT_LAND}`, 'v3')).toEqual(['chevreuse']);
  });

  it('décrit chaque monde Poly (carte, lieux, découvertes séparées)', () => {
    expect(POLY_WORLDS.map((w) => w.id)).toEqual([ROBERT_ISLAND, ROBERT_LAND, ...POLY_LAND_IDS]);
    expect(polyWorld('longchamp')).toBeUndefined();
    // Clés de découvertes toutes différentes ; lieux dans l'emprise commune (38 × 26 km).
    expect(new Set(POLY_WORLDS.map((w) => w.foundKey)).size).toBe(POLY_WORLDS.length);
    for (const land of POLY_WORLDS.slice(1)) {
      expect(new Set(land.discover.map((p) => p.id)).size).toBe(land.discover.length);
      for (const p of [...land.places, ...land.discover]) {
        expect(Math.abs(p.x)).toBeLessThan(19000);
        expect(Math.abs(p.z)).toBeLessThan(13000);
      }
    }
  });
});
