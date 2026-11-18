import { describe, expect, it } from 'vitest';
import { AnimBudget, animStride } from '../src/game/animBudget.ts';

describe('budget d’animation des coureurs IA', () => {
  it('anime les proches à chaque image et espace les lointains', () => {
    expect(animStride(10, true)).toBe(1);
    expect(animStride(60, true)).toBe(2);
    expect(animStride(120, true)).toBe(3);
    expect(animStride(240, true)).toBe(4);
  });

  it('proche : rend le dt de chaque image', () => {
    const b = new AnimBudget(0);
    for (let f = 1; f <= 5; f++) expect(b.step(1 / 60, 20, f, true)).toBeCloseTo(1 / 60);
  });

  it('lointain : une mise à jour sur 4, sans perdre de temps', () => {
    const b = new AnimBudget(0);
    let total = 0;
    let updates = 0;
    for (let f = 1; f <= 400; f++) {
      const d = b.step(1 / 60, 200, f, true);
      if (d > 0) updates++;
      total += d;
    }
    expect(updates).toBe(100);
    expect(total).toBeCloseTo(400 / 60 - (400 % 4 === 0 ? 0 : 0), 5);
  });

  it('les décalages répartissent les coureurs sur les images', () => {
    const budgets = [0, 1, 2, 3].map((p) => new AnimBudget(p));
    budgets.forEach((b) => b.step(1 / 60, 200, 1, true));
    const perFrame = [2, 3, 4, 5].map((f) => budgets.filter((b) => b.step(1 / 60, 200, f, true) > 0).length);
    expect(perFrame).toEqual([1, 1, 1, 1]);
  });

  it('jamais plus de N images sans mise à jour, même quand le pas change', () => {
    const b = new AnimBudget(0);
    let gap = 0;
    let maxGap = 0;
    for (let f = 1; f <= 300; f++) {
      const dist = f % 37 < 18 ? 200 : 70;
      if (b.step(1 / 60, dist, f, true) > 0) gap = 0;
      else maxGap = Math.max(maxGap, ++gap);
    }
    expect(maxGap).toBeLessThanOrEqual(3);
  });
});
