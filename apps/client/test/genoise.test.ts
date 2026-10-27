import { describe, expect, it } from 'vitest';
import { genoiseDrop, genoiseRows } from '../src/world/genoise.ts';

describe('génoise sous le pan', () => {
  for (const pitch of [15, 24, 30, 40, 55]) {
    it(`pente ${pitch}° : l'arête haute de chaque rang reste sous le pan, le rang du haut le touche presque`, () => {
      const tan = Math.tan((pitch * Math.PI) / 180);
      const rows = genoiseRows(10, genoiseDrop(pitch));
      expect(rows.map((r) => r.d)).toEqual([0.1, 0.2, 0.3].map((d) => expect.closeTo(d, 9)));
      let gap = Infinity;
      for (const r of rows) {
        const roof = 10 - r.d * tan; // pan au droit de la saillie (il passe par le haut du mur)
        expect(r.y1).toBeLessThanOrEqual(roof - 0.02 + 1e-9);
        expect(r.y1 - r.y0).toBeCloseTo(0.14);
        gap = Math.min(gap, roof - r.y1);
      }
      expect(gap).toBeCloseTo(0.02, 9); // portée par le pan, pas décollée
      // rangs empilés : chacun repose sur le précédent
      expect(rows[1]!.y0).toBeCloseTo(rows[0]!.y1);
      expect(rows[2]!.y0).toBeCloseTo(rows[1]!.y1);
    });
  }

  it('avant correction, le rang du haut traversait le pan (40° : 25 cm)', () => {
    const top = genoiseRows(10, 0)[2]!;
    expect(top.y1 - (10 - 0.3 * Math.tan((40 * Math.PI) / 180))).toBeCloseTo(0.252, 3);
  });
});
