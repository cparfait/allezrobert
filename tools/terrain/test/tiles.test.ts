import { describe, expect, it } from 'vitest';
import { carveGrid, decodeGrid, encodeGrid, gridSample, type Grid } from '../src/tiles.ts';

function makeGrid(n: number, res: number, f: (x: number, z: number) => number): Grid {
  const N = n + 1;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = f(i * res, j * res);
  return { n, res, x0: 0, z0: 0, h };
}

describe('creusement des routes', () => {
  it('le terrain suit le profil de route sur la chaussée et raccorde en douceur', () => {
    // dévers 20 % ; route en travers à altitude constante 100 m
    const g = makeGrid(100, 2, (_x, z) => 100 + (z - 100) * 0.2);
    carveGrid(
      g,
      [
        {
          pts: [
            [0, 100, 100],
            [200, 100, 100],
          ],
          halfWidth: 3,
          priority: 2,
        },
      ],
      (hw) => 4 + hw,
      0,
    );
    for (const x of [10, 50.5, 123]) {
      expect(gridSample(g, x, 100)).toBeCloseTo(100, 3);
      expect(gridSample(g, x, 102)).toBeCloseTo(100, 3); // sur la chaussée (demi-largeur 3 + 0,5)
    }
    // au-delà du raccord : terrain d'origine
    expect(gridSample(g, 50, 120)).toBeCloseTo(104, 3);
    // raccord monotone
    let prev = gridSample(g, 50, 103.5);
    for (let z = 104; z <= 112; z += 0.5) {
      const v = gridSample(g, 50, z);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
  });

  it("priorité à l'itinéraire au carrefour", () => {
    const g = makeGrid(50, 2, () => 50);
    carveGrid(
      g,
      [
        {
          pts: [
            [0, 40, 50],
            [100, 40, 50],
          ],
          halfWidth: 3,
          priority: 0,
        },
        {
          pts: [
            [50, 45, 0],
            [50, 45, 100],
          ],
          halfWidth: 3,
          priority: 2,
        },
      ],
      (hw) => 4 + hw,
      0,
    );
    expect(gridSample(g, 50, 50)).toBeCloseTo(45, 3);
  });
});

describe('encodage des altitudes', () => {
  it('Uint16 au centimètre, aller-retour', () => {
    const g = makeGrid(10, 100, (x, z) => 80 + x * 0.013 + z * 0.0071);
    const buf = encodeGrid(g, 79);
    const back = decodeGrid(buf, 10, 79);
    for (let k = 0; k < back.length; k++) expect(Math.abs(back[k]! - g.h[k]!)).toBeLessThanOrEqual(0.005 + 1e-6);
  });
});
