import { describe, expect, it } from 'vitest';
import { LaneRotator, laneOffsets, resolveFormation } from '../src/index.ts';

describe('forme du peloton', () => {
  it('auto : deux files sur route large, file indienne sur route étroite, bordure dans le vent de côté', () => {
    expect(resolveFormation('auto', { roadWidthM: 7, crossWindMs: 1, riders: 5 })).toBe('double');
    expect(resolveFormation('auto', { roadWidthM: 4, crossWindMs: 1, riders: 5 })).toBe('single');
    expect(resolveFormation('auto', { roadWidthM: 7, crossWindMs: -6, riders: 5 })).toBe('echelon');
    expect(resolveFormation('auto', { roadWidthM: 7, crossWindMs: 0, riders: 2 })).toBe('single');
  });

  it('une forme demandée mais impossible retombe sur la file indienne', () => {
    expect(resolveFormation('double', { roadWidthM: 4, crossWindMs: 0, riders: 6 })).toBe('single');
    expect(resolveFormation('double', { roadWidthM: 7, crossWindMs: 0, riders: 6 })).toBe('double');
    expect(resolveFormation('single', { roadWidthM: 9, crossWindMs: 0, riders: 6 })).toBe('single');
  });

  it('les deux files sont distantes d’au moins 1,2 m et dans la route', () => {
    const { fast, slow } = laneOffsets(2.6);
    expect(slow - fast).toBeGreaterThanOrEqual(1.2);
    expect(Math.abs(fast)).toBeLessThanOrEqual(2.6);
    expect(Math.abs(slow)).toBeLessThanOrEqual(2.6);
  });
});

describe('LaneRotator — relais tournants', () => {
  it('répartit un sur deux', () => {
    const r = new LaneRotator();
    r.assign([0, 1, 2, 3].map((i) => ({ id: `a${i}`, distM: 100 - i * 3 })));
    expect([0, 1, 2, 3].map((i) => r.laneOf(`a${i}`))).toEqual(['fast', 'slow', 'fast', 'slow']);
  });

  it('le coureur qui passe en tête de la file rapide se rabat, le dernier de la lente remonte', () => {
    const rot = new LaneRotator(14, 8);
    const riders = [0, 1, 2, 3].map((i) => ({ id: `a${i}`, distM: 100 - i * 4 }));
    rot.assign(riders);
    const swaps = new Set<string>();
    for (let t = 0; t < 1200; t++) {
      for (const r of riders) r.distM += (rot.laneOf(r.id) === 'fast' ? 9.45 : 8.55) * 0.1;
      const before = riders.map((r) => rot.laneOf(r.id));
      rot.update(riders, [], 0.1);
      riders.forEach((r, i) => {
        if (rot.laneOf(r.id) !== before[i]) swaps.add(r.id);
      });
    }
    // Les relais tournent : chacun a changé de file, et le peloton reste groupé.
    expect(swaps.size).toBe(4);
    const d = riders.map((r) => r.distM);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(60);
  });
});
