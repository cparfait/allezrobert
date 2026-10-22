import { describe, expect, it } from 'vitest';
import { recordTimeAt } from '../src/game/challenge.ts';

describe('défi KOM', () => {
  it('temps du record à une distance donnée (interpolé)', () => {
    const rec = { timeS: 4, dist: [0, 5, 10, 15, 20], date: '' };
    expect(recordTimeAt(rec, 0)).toBe(0);
    expect(recordTimeAt(rec, 7.5)).toBeCloseTo(1.5, 6);
    expect(recordTimeAt(rec, 20)).toBeCloseTo(4, 6);
    expect(recordTimeAt(rec, 21)).toBeNull();
  });
});
