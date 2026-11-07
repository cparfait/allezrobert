import { describe, expect, it } from 'vitest';
import { clampUnderRoads } from '../src/world/terrain.ts';
import type { LoadedTile } from '../src/world/types.ts';

/** Tuile de 80 m, grille de 10 m (8 mailles), sol donné par `ground`, une route `pts3`. */
function run(ground: (x: number, z: number) => number, pts3: number[] | number[][], buildings: Array<{ pts: number[] }> = []) {
  const seg = 8;
  const s = 80;
  const tile = { x0: -40, z0: -40, size: s, features: { roads: (Array.isArray(pts3[0]) ? (pts3 as number[][]) : [pts3 as number[]]).map((p, i) => ({ id: `r${i}`, kind: 'tertiary', width: 5, pts3: p })), buildings } } as unknown as LoadedTile;
  const row = seg + 1;
  const pos = new Float32Array(row * row * 3);
  for (let j = 0; j <= seg; j++)
    for (let i = 0; i <= seg; i++) {
      const k = j * row + i;
      pos[k * 3] = (i / seg - 0.5) * s;
      pos[k * 3 + 1] = ground(-40 + (i * s) / seg, -40 + (j * s) / seg);
      pos[k * 3 + 2] = (j / seg - 0.5) * s;
    }
  clampUnderRoads(pos, tile, seg, (s / seg) * Math.SQRT2 + 0.1, () => Number.NaN);
  return (x: number, z: number) => pos[(((z + 40) / 10) * row + (x + 40) / 10) * 3 + 1] as number;
}

describe('clampUnderRoads', () => {
  it('rue en pente : le sol au bord suit la route en face, pas son niveau 10 m plus bas', () => {
    // Rue à 13 % le long de x (z = 0), sol au niveau de la rue partout.
    const level = (x: number) => 100 + x * 0.13;
    const pts: number[] = [];
    for (let x = -40; x <= 40; x += 4) pts.push(x, level(x), 0);
    const h = run((x) => level(x), pts);
    // Sommet en (0, 10) : route à 100 m en face ; avant, celle de x = −10 (98,7 m) l'emportait.
    expect(h(0, 10)).toBeGreaterThan(99.85);
    expect(h(0, 10)).toBeLessThanOrEqual(100);
  });

  it('flanc de coteau : le sol en contrebas est remblayé sous toute la bande que la grille fait porter à la route', () => {
    // Route plate à 100 m le long de x, sol qui descend de 20 cm par mètre vers z positif.
    const pts = [-40, 100, 0, 40, 100, 0];
    const h = run((_x, z) => 100 - Math.max(0, z) * 0.2, pts);
    // Sommet à 10 m : il porte des triangles sous la chaussée (maille de 10 m) ; avant, il restait 2 m plus bas.
    expect(h(0, 10)).toBeGreaterThan(99.9);
    // Au-delà, talus : plus bas que la route, jamais au-dessus du sol remblayé.
    expect(h(0, 30)).toBeLessThan(h(0, 20));
  });

  it('deux rues parallèles à moins d une maille : chacune garde le sol sous sa chaussée', () => {
    // Rue du haut en z = 0 (100 m), rue du bas en z = 12 (98,4 m) ; talus entre les deux.
    const up = [-40, 100, 0, 40, 100, 0];
    const down = [-40, 98.4, 12, 40, 98.4, 12];
    const h = run((_x, z) => (z < 6 ? 100 : 98.4), [up, down]);
    // Sommet en z = 0, sous la rue du haut : à son niveau (avant : abaissé à celui de la rue du bas).
    expect(h(0, 0)).toBeGreaterThan(99.9);
    // Sommet en z = 10, plus près de la chaussée du bas : à son niveau.
    expect(h(0, 10)).toBeLessThan(98.4);
  });
});
