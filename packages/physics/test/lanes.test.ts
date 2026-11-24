import { describe, expect, it } from 'vitest';
import { KEEP_RIGHT_M, aheadAlongM, clampToOwnHalf, facingWithin, oncomingLookM, ownHalf, roadHalfM } from '../src/index.ts';

describe('chacun sa moitié de chaussée', () => {
  it('ownHalf : sens de marche à droite, en face à gauche, à 0,5 m de l’axe', () => {
    expect(ownHalf(1.1, 1)).toEqual({ min: KEEP_RIGHT_M, max: 1.1 });
    expect(ownHalf(1.1, -1)).toEqual({ min: -1.1, max: -KEEP_RIGHT_M });
    // Petit chemin de 3 m : deux vélos qui se croisent gardent au moins 1 m entre axes.
    const half = roadHalfM(3);
    expect(ownHalf(half, 1).min - ownHalf(half, -1).max).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('clampToOwnHalf : ramène sur sa moitié, sans sortir de la chaussée réelle', () => {
    expect(clampToOwnHalf(-0.8, 1, -1.6, 1.6)).toBe(KEEP_RIGHT_M);
    expect(clampToOwnHalf(1.2, 1, -1.6, 1.6)).toBe(1.2);
    expect(clampToOwnHalf(0.9, -1, -1.6, 1.6)).toBe(-KEEP_RIGHT_M);
    expect(clampToOwnHalf(-1.4, -1, -1.6, 1.6)).toBe(-1.4);
    // Chaussée décalée (rétrécissement) : la chaussée prime, au plus près de sa moitié.
    expect(clampToOwnHalf(-1, 1, -1.6, 0.3)).toBe(0.3);
    expect(clampToOwnHalf(1, -1, -0.2, 1.6)).toBe(-0.2);
    // Toutes les valeurs restent dans la chaussée et du bon côté de l’axe quand c’est possible.
    for (let x = -3; x <= 3; x += 0.25) {
      const r = clampToOwnHalf(x, 1, -1.1, 1.1);
      expect(r).toBeGreaterThanOrEqual(KEEP_RIGHT_M);
      expect(r).toBeLessThanOrEqual(1.1);
      const l = clampToOwnHalf(x, -1, -1.1, 1.1);
      expect(l).toBeLessThanOrEqual(-KEEP_RIGHT_M);
      expect(l).toBeGreaterThanOrEqual(-1.1);
    }
  });

  it('oncomingLookM : au moins 40 m, 5 s de rapprochement', () => {
    expect(oncomingLookM(0)).toBe(45);
    expect(oncomingLookM(11)).toBe(100);
    expect(oncomingLookM(-5)).toBe(45);
  });

  it('aheadAlongM et facingWithin : devant dans son sens, boucle comprise', () => {
    expect(aheadAlongM(100, 150, 1)).toBe(50);
    expect(aheadAlongM(100, 150, -1)).toBe(-50);
    expect(aheadAlongM(100, 50, -1)).toBe(50);
    expect(aheadAlongM(990, 20, 1, 1000)).toBe(30);
    expect(aheadAlongM(20, 990, -1, 1000)).toBe(30);
    expect(facingWithin(30, 80)).toBe(true);
    expect(facingWithin(-5, 80)).toBe(true);
    expect(facingWithin(-10, 80)).toBe(false);
    expect(facingWithin(90, 80)).toBe(false);
  });
});
