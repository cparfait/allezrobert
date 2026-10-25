import { describe, expect, it } from 'vitest';
import { FootprintIndex, insidePolygon } from '../src/world/footprints.ts';

// Maison carrée de 10 m sur 10 m (x 0–10, z 0–10), de 100 m à 108 m d'altitude.
const square = [0, 0, 10, 0, 10, 10, 0, 10];

describe('emprises des bâtiments (collision de la caméra)', () => {
  it('point dans le polygone', () => {
    expect(insidePolygon(square, 5, 5)).toBe(true);
    expect(insidePolygon(square, 15, 5)).toBe(false);
  });

  it('segment qui traverse un mur : fraction au point d’entrée', () => {
    const idx = new FootprintIndex();
    idx.add('t', square, 100, 108);
    // De x = −10 à x = 20 à 104 m : entre dans le mur x = 0 au tiers du segment.
    expect(idx.firstHit(-10, 104, 5, 20, 104, 5)).toBeCloseTo(1 / 3, 6);
  });

  it('segment dégagé : à côté, au-dessus ou trop court', () => {
    const idx = new FootprintIndex();
    idx.add('t', square, 100, 108);
    expect(idx.firstHit(-10, 104, 15, 20, 104, 15)).toBeNull();
    expect(idx.firstHit(-10, 110, 5, 20, 110, 5)).toBeNull();
    expect(idx.firstHit(-10, 104, 5, -2, 104, 5)).toBeNull();
  });

  it('entrée par le toit et départ à l’intérieur', () => {
    const idx = new FootprintIndex();
    idx.add('t', square, 100, 108);
    // Descente verticale au-dessus du centre : touche le toit à 108 m (fraction 0,2 de 110 → 100).
    expect(idx.firstHit(5, 110, 5, 5, 100, 5)).toBeCloseTo(0.2, 6);
    expect(idx.firstHit(5, 104, 5, 20, 104, 5)).toBe(0);
  });

  it('le bâtiment le plus proche l’emporte, à cheval sur plusieurs cases', () => {
    const idx = new FootprintIndex();
    idx.add('a', [30, 0, 60, 0, 60, 10, 30, 10], 100, 108);
    idx.add('b', square, 100, 108);
    expect(idx.firstHit(-10, 104, 5, 70, 104, 5)).toBeCloseTo(10 / 80, 6);
  });

  it('décharger une tuile retire ses bâtiments', () => {
    const idx = new FootprintIndex();
    idx.add('t', square, 100, 108);
    idx.removeTile('t');
    expect(idx.size).toBe(0);
    expect(idx.firstHit(-10, 104, 5, 20, 104, 5)).toBeNull();
  });
});
