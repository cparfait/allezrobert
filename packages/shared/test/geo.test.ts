import { describe, expect, it } from 'vitest';
import { l93ToWgs84, wgs84ToL93 } from '../src/index.ts';

describe('Lambert-93', () => {
  it("projette l'origine de la projection (3° E, 46,5° N) sur (700 000 ; 6 600 000)", () => {
    const p = wgs84ToL93(3, 46.5);
    expect(p.x).toBeCloseTo(700000, 3);
    expect(p.y).toBeCloseTo(6600000, 3);
  });

  it("concorde au centimètre avec l'implémentation du pipeline terrain", async () => {
    const ref = await import('../../../tools/terrain/src/lambert93.ts');
    for (const [lon, lat] of [
      [2.05, 48.7],
      [1.83, 48.64],
      [2.35, 48.85],
    ] as const) {
      const a = wgs84ToL93(lon, lat);
      const b = ref.toL93(lon, lat) as unknown as { x?: number; y?: number; e?: number; n?: number };
      expect(Math.abs(a.x - (b.x ?? b.e ?? NaN))).toBeLessThan(0.01);
      expect(Math.abs(a.y - (b.y ?? b.n ?? NaN))).toBeLessThan(0.01);
    }
  });

  it('aller-retour au millimètre près', () => {
    for (const [lon, lat] of [
      [2.05, 48.7],
      [1.83, 48.64],
      [-4.4, 48.4],
      [7.7, 43.7],
    ] as const) {
      const p = wgs84ToL93(lon, lat);
      const back = l93ToWgs84(p.x, p.y);
      expect(back.lon).toBeCloseTo(lon, 8);
      expect(back.lat).toBeCloseTo(lat, 8);
    }
  });
});
