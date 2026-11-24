import { describe, expect, it } from 'vitest';
import { aiEffortTag, energyPercent } from '../src/companion.ts';

describe('énergie des IA affichée', () => {
  it('ne signale que l’attaque, la poursuite et la défaillance', () => {
    expect(aiEffortTag('attack')).toBe('attack');
    expect(aiEffortTag('chase')).toBe('chase');
    expect(aiEffortTag('cracked')).toBe('cracked');
    for (const s of ['follow', 'pull', 'pullOff', 'recover', '']) expect(aiEffortTag(s)).toBeUndefined();
  });
  it('réserve W′ en pourcentage entier, bornée', () => {
    expect(energyPercent(0.523)).toBe(52);
    expect(energyPercent(1.2)).toBe(100);
    expect(energyPercent(-0.1)).toBe(0);
    expect(energyPercent(Number.NaN)).toBe(0);
  });
});
