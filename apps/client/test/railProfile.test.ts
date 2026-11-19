import { describe, expect, it } from 'vitest';
import { fillDips, pinEnd, RAIL_MAX_GRADE } from '../src/world/railProfile.ts';

const s = Array.from({ length: 51 }, (_, i) => i * 4);

describe('railProfile', () => {
  it('comble un creux de route sous un pont ferroviaire (−7 m sur 50 m)', () => {
    const y = s.map((x) => 85 - (Math.abs(x - 100) < 25 ? 7 * (1 - Math.abs(x - 100) / 25) : 0));
    fillDips(s, y);
    expect(Math.min(...y)).toBeGreaterThan(85 - 30 * RAIL_MAX_GRADE);
    for (let i = 1; i < y.length; i++) expect(Math.abs((y[i] as number) - (y[i - 1] as number)) / 4).toBeLessThanOrEqual(RAIL_MAX_GRADE + 1e-9);
  });

  it('ne touche pas une voie en pente douce ni ne l’abaisse jamais', () => {
    const y = s.map((x) => 50 + x * 0.02);
    const before = y.slice();
    fillDips(s, y);
    expect(y).toEqual(before);
    // Longue descente à 10 % (tranchée, rampe) : pas de plus haut des deux côtés, rien n'est relevé.
    // (hors des 100 m de chaque bout : railways.ts prolonge chaque tronçon d'autant, sol mesuré, avant le calcul).
    const long = Array.from({ length: 101 }, (_, i) => i * 4);
    const ramp = long.map((x) => 90 - x * 0.1);
    const filled = fillDips(long, ramp.slice());
    for (let i = 25; i <= 75; i++) expect(Math.abs((filled[i] as number) - (ramp[i] as number))).toBeLessThan(1e-9);
    const bump = s.map((x) => 50 + (x === 100 ? 3 : 0));
    const b2 = fillDips(s, bump.slice());
    b2.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(bump[i] as number));
  });

  it('raccorde une extrémité à la hauteur de la voisine', () => {
    const y = s.map(() => 80);
    pinEnd(s, y, 81, false);
    expect(y[0]).toBeCloseTo(81);
    expect(y[y.length - 1]).toBe(80);
    pinEnd(s, y, 79.5, true);
    expect(y[y.length - 1]).toBeCloseTo(79.5);
  });
});
