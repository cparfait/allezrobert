import { describe, expect, it } from 'vitest';
import { DraftCalculator, wakeShiftM } from '../src/index.ts';

describe('aspiration par vent de côté', () => {
  it('décale le sillage sous le vent, proportionnellement à l’écart', () => {
    expect(wakeShiftM(1, 0, 10)).toBe(0);
    expect(wakeShiftM(1, 3, 10)).toBeCloseTo(0.3);
    expect(wakeShiftM(2, -3, 10)).toBeCloseTo(-0.6);
    expect(wakeShiftM(10, 10, 5)).toBe(1.5);
  });

  it('pile dans la roue : moins abrité par vent de côté, mieux abrité en se décalant sous le vent', () => {
    const calc = new DraftCalculator();
    const lead = { distM: 10, lateralM: 0, speedMs: 10 };
    const behind = (lateralM: number) => [lead, { distM: 10 - 1.75 - 1, lateralM, speedMs: 10 }];
    const calm = calc.compute(behind(0))[1] as number;
    calc.setCrosswind(6);
    const inLine = calc.compute(behind(0))[1] as number;
    const echelon = calc.compute(behind(0.6))[1] as number;
    expect(inLine).toBeLessThan(calm);
    expect(echelon).toBeGreaterThan(inLine);
    expect(echelon).toBeCloseTo(calm, 2);
  });
});
