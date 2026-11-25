import { describe, expect, it } from 'vitest';
import { GRID_HOLD_M, GRID_MAX_COLS, GRID_RELEASE_M, GRID_SIDE_M, fromCentre, gridBlend, gridColumns } from '../src/index.ts';

describe('grille de départ', () => {
  it('occupe toute la largeur, d’un bord utile à l’autre', () => {
    const c = gridColumns(-2.6, 2.6);
    expect(c[0]).toBeCloseTo(-2.6);
    expect(c.at(-1)).toBeCloseTo(2.6);
    expect(c.length).toBe(5);
  });
  it('voisins assez écartés, quelle que soit la largeur', () => {
    for (let half = 0.5; half < 8; half += 0.1) {
      const c = gridColumns(-half, half);
      expect(c.length).toBeLessThanOrEqual(GRID_MAX_COLS);
      for (let k = 1; k < c.length; k++) expect(c[k]! - c[k - 1]!).toBeGreaterThanOrEqual(GRID_SIDE_M - 1e-3);
    }
  });
  it('chemin étroit : une seule place, au milieu', () => {
    expect(gridColumns(-0.4, 0.4)).toEqual([0]);
  });
  it('premiers servis au centre', () => {
    expect(fromCentre(5)).toEqual([2, 1, 3, 0, 4]);
    expect(fromCentre(1)).toEqual([0]);
    expect([...fromCentre(4)].sort()).toEqual([0, 1, 2, 3]);
  });
  it('ligne gardée au départ, puis rejointe sans à-coup', () => {
    expect(gridBlend(-2, 1, 0)).toBe(-2);
    expect(gridBlend(-2, 1, GRID_HOLD_M)).toBe(-2);
    expect(gridBlend(-2, 1, GRID_RELEASE_M)).toBe(1);
    expect(gridBlend(-2, 1, 10_000)).toBe(1);
    let prev = -2;
    for (let d = 0; d <= GRID_RELEASE_M; d += 1) {
      const v = gridBlend(-2, 1, d);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v - prev).toBeLessThan(0.05);
      prev = v;
    }
  });
});
