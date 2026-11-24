import { describe, expect, it } from 'vitest';
import type { TelemetryMsg } from '@allezrobert/shared';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

/** Chacun sa moitié de chaussée : deux coureurs qui se croisent ne passent pas sur la moitié de l'autre. */
describe('RideSimulation — chacun sa moitié de chaussée', () => {
  const route = proceduralLoop();
  const T0 = Date.UTC(2026, 10, 24, 9, 0, 0);
  const free = () => new RideSimulation(route, resolveRideOptions({ mode: 'free' }, route.id), T0, { seed: 'lanes' });
  const human = (s: RideSimulation, id: string) => s.addRider({ id, name: id, kind: 'human', userId: `u-${id}`, riderMassKg: 75 }, T0)!;
  const telem = (seq: number, steer: number): TelemetryMsg => ({ seq, t: 0, watts: 200, cadence: 90, gear: 12, steer });

  /** `b` fait demi-tour `gapM` devant `a` ; tous deux braquent à gauche (vers l'axe de la route) ; renvoie les décalages relevés. */
  function cross(gapM: number, seconds: number) {
    const s = free();
    const a = human(s, 'a');
    const b = human(s, 'b');
    a.state.distM = 1000;
    b.state.distM = 1000 + gapM;
    a.state.speedMs = b.state.speedMs = 8;
    a.lateralM = a.lateralTarget = b.lateralM = b.lateralTarget = 1;
    expect(s.turnAround('b', T0 + 5_000)).toBe(true);
    b.lateralM = 1;
    let now = T0 + 5_000;
    const seen: Array<{ sep: number; a: number; b: number; facing: boolean }> = [];
    for (let i = 1; i <= seconds * 10; i++) {
      now += 100;
      s.setTelemetry('a', telem(i, -1.5), now);
      s.setTelemetry('b', telem(i, -1.5), now);
      s.step(now, 0.1);
      seen.push({ sep: s.separationM('a', 'b'), a: a.lateralM, b: b.lateralM, facing: a.facing && b.facing });
    }
    return seen;
  }

  it('deux coureurs qui se croisent restent chacun sur sa moitié (axe à 0,5 m au moins du milieu)', () => {
    const seen = cross(80, 12);
    // Ils se rapprochent, se croisent puis s'éloignent.
    const meet = seen.reduce((k, x, i) => (x.sep < seen[k]!.sep ? i : k), 0);
    expect(seen[meet]!.sep).toBeLessThan(5);
    // Jusqu'au croisement, à moins de 30 m l'un de l'autre (après, chacun repart de son côté).
    const close = seen.slice(0, meet + 1).filter((x) => x.sep < 30);
    expect(close.length).toBeGreaterThan(5);
    for (const x of close) {
      expect(x.facing).toBe(true);
      expect(x.a).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(x.b).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });

  it('sans personne en face, la direction peut aller sur la moitié de gauche (dépasser)', () => {
    const seen = cross(3000, 4);
    expect(seen.every((x) => !x.facing)).toBe(true);
    expect(seen.at(-1)!.a).toBeLessThan(0);
  });
});
