import { describe, expect, it } from 'vitest';
import { buildRoadProximity } from '../src/world/roadProximity.ts';

/** Générateur déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('buildRoadProximity', () => {
  // Itinéraire en lacets, coordonnées négatives comprises (repère local autour de l'origine du monde).
  const r = rng(7);
  const points = Array.from({ length: 400 }, (_, i) => ({ x: -1500 + i * 7.5 + (r() - 0.5) * 12, z: 300 * Math.sin(i / 25) + (r() - 0.5) * 12 }));
  const brute = (radius: number) => (x: number, z: number) => points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius);

  for (const radius of [3.3, 6.2, 11, 40]) {
    it(`donne les mêmes réponses qu'une recherche exhaustive (rayon ${radius} m)`, () => {
      const fast = buildRoadProximity({ points }, radius);
      const slow = brute(radius);
      const q = rng(99);
      let near = 0;
      for (let i = 0; i < 5000; i++) {
        // moitié près de l'itinéraire, moitié ailleurs, y compris loin au-delà de l'emprise (indices négatifs)
        const base = points[Math.floor(q() * points.length)] as { x: number; z: number };
        const x = i % 2 ? base.x + (q() - 0.5) * radius * 4 : (q() - 0.5) * 6000;
        const z = i % 2 ? base.z + (q() - 0.5) * radius * 4 : (q() - 0.5) * 6000;
        const expected = slow(x, z);
        if (expected) near++;
        expect(fast(x, z)).toBe(expected);
      }
      // le test voit bien les deux cas
      expect(near).toBeGreaterThan(200);
      expect(near).toBeLessThan(4800);
    });
  }

  it('rien à proximité d\'un itinéraire vide', () => {
    expect(buildRoadProximity({ points: [] }, 5)(0, 0)).toBe(false);
  });
});
