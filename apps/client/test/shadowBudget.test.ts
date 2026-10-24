import { describe, expect, it } from 'vitest';
import { shadowCasters } from '../src/game/shadowBudget.ts';

describe('shadowCasters', () => {
  it('garde les plus proches, dans la limite et la portée', () => {
    expect(shadowCasters([30, 5, 12, 50, 8], 3, 40)).toEqual([false, true, true, false, true]);
    expect(shadowCasters([30, 5, 12], 5, 20)).toEqual([false, true, true]);
  });
  it('aucun ombre quand le budget est nul ; tous quand il est large', () => {
    expect(shadowCasters([1, 2, 3], 0, 40)).toEqual([false, false, false]);
    expect(shadowCasters([1, 2, 3], 99, 40)).toEqual([true, true, true]);
    expect(shadowCasters([], 3, 40)).toEqual([]);
  });
});
