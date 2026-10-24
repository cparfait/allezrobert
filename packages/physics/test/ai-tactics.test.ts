import { describe, expect, it } from 'vitest';
import { AiRider, paramsFromBike, type AiContext } from '../src/index.ts';

const params = paramsFromBike(70);
const ctx = (over: Partial<AiContext>): AiContext => ({ gradePercent: 0, speedMs: 11, groupPaceWkg: 3, gapAheadM: Infinity, speedAheadMs: 11, positionInGroup: 0, groupSize: 6, ...over });

describe('tactiques et forme des IA', () => {
  it('forme du jour : reproductible, entre −8 % et +6 %', () => {
    const a = new AiRider({ id: 'x', profile: 'rouleur', ftpWatts: 250, params, form: 'random', seed: 3 });
    const b = new AiRider({ id: 'x', profile: 'rouleur', ftpWatts: 250, params, form: 'random', seed: 3 });
    expect(a.form).toBe(b.form);
    expect(a.form).toBeGreaterThanOrEqual(0.92);
    expect(a.form).toBeLessThanOrEqual(1.06);
    expect(new AiRider({ id: 'y', profile: 'rouleur', ftpWatts: 250, params }).form).toBe(1);
  });

  it('un baroudeur part en échappée sur le plat ; repris à bout de forces, il est en défaillance', () => {
    const ai = new AiRider({ id: 'b', profile: 'diesel', ftpWatts: 260, params, tactic: 'baroudeur', aggressiveness: 2, seed: 11 });
    let t = 0;
    // Plat, début de course, dans le groupe : il finit par attaquer.
    while (ai.state !== 'attack' && t < 3600) {
      ai.update(ctx({ raceProgress: 0.1 }), 0.5);
      t += 0.5;
    }
    expect(ai.state).toBe('attack');
    // Il fait le trou (seul) et se vide.
    for (let i = 0; i < 40; i++) ai.update(ctx({ groupSize: 1, raceProgress: 0.2 }), 0.5);
    ai.wPrime.update(5000, 30);
    // Le groupe le reprend.
    const out = ai.update(ctx({ groupSize: 5, positionInGroup: 0, raceProgress: 0.3 }), 0.5);
    expect(['cracked', 'recover']).toContain(out.state);
    if (out.state === 'cracked') {
      for (let i = 0; i < 20; i++) ai.update(ctx({ groupSize: 5, positionInGroup: 3, gapAheadM: 1, raceProgress: 0.3 }), 0.5);
      const o = ai.update(ctx({ groupSize: 5, positionInGroup: 3, gapAheadM: 1, raceProgress: 0.3 }), 0.5);
      expect(o.watts).toBeLessThanOrEqual(260 * 0.73);
    }
  });

  it('un attentiste prend des relais plus courts qu’un équipier', () => {
    const pullTime = (tactic: 'attentiste' | 'equipier') => {
      const ai = new AiRider({ id: 'p', profile: 'rouleur', ftpWatts: 250, params, tactic, aggressiveness: 0, seed: 5 });
      let n = 0;
      for (let i = 0; i < 600; i++) if (ai.update(ctx({ positionInGroup: 0 }), 0.5).state === 'pull') n++;
      return n;
    };
    expect(pullTime('attentiste')).toBeLessThan(pullTime('equipier'));
  });
});
