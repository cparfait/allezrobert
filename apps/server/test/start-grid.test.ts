import { describe, expect, it } from 'vitest';
import { GRID_ROW_M } from '@allezrobert/physics';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);
const route = proceduralLoop();

function race(ai: number) {
  const s = new RideSimulation(route, resolveRideOptions({ mode: 'race', laps: 1, aiRiders: ai }, route.id), T0, { seed: 'grille' });
  const me = s.addRider({ id: 'moi', name: 'Moi', kind: 'human', userId: 'u1' }, T0)!;
  s.addAiRiders(ai, T0, 250);
  s.startCountdown(T0, 5);
  return { s, me };
}
const ais = (s: RideSimulation) => s.riders.filter((r) => r.kind === 'ai');

describe('grille de départ d’une course', () => {
  it('répartit les coureurs sur la largeur, l’humain au centre, des IA devant et derrière', () => {
    const { s, me } = race(14);
    expect(ais(s).length).toBe(14);
    const half = Math.max(1, (route.roadWidthM || 6) / 2 - 0.4);
    const row0 = s.riders.filter((r) => Math.abs(r.state.distM) < 0.01).map((r) => r.lateralM);
    expect(ais(s).some((r) => r.state.distM > me.state.distM + 1)).toBe(true);
    expect(ais(s).some((r) => r.state.distM < me.state.distM - 1)).toBe(true);
    expect(Math.max(...row0) - Math.min(...row0)).toBeGreaterThan(half * 1.6);
    expect(Math.abs(me.lateralM)).toBeLessThan(half * 0.5);
    for (const a of s.riders) for (const b of s.riders) if (a !== b) expect(Math.abs(a.lateralM - b.lateralM) > 1 || Math.abs(a.state.distM - b.state.distM) >= GRID_ROW_M - 0.01).toBe(true);
  });
  it('personne ne bouge pendant le compte à rebours, même si le jeu envoie une autre ligne', () => {
    const { s, me } = race(9);
    const before = s.riders.map((r) => [r.state.distM, r.lateralM]);
    let now = T0;
    for (let i = 1; i < 40; i++) {
      now += 100;
      s.setTelemetry('moi', { seq: i, t: 0, watts: 200, cadence: 90, gear: 12, steer: 2 }, now);
      s.step(now, 0.1);
    }
    s.riders.forEach((r, i) => {
      expect(r.state.distM).toBeCloseTo(before[i]![0]!, 3);
      expect(r.lateralM).toBeCloseTo(before[i]![1]!, 3);
    });
    expect(me.grid).toBeDefined();
  });
  it('après le départ, les IA gardent d’abord leur ligne et tout le monde avance', () => {
    const { s } = race(9);
    const line = new Map(ais(s).map((r) => [r, r.lateralM]));
    const from = new Map(ais(s).map((r) => [r, r.state.distM]));
    let now = T0;
    for (let i = 1; i < 110; i++) {
      now += 100;
      s.setTelemetry('moi', { seq: i, t: 0, watts: 220, cadence: 90, gear: 12, steer: 0 }, now);
      s.step(now, 0.1);
    }
    for (const r of ais(s)) {
      const d = r.state.distM - from.get(r)!;
      expect(d).toBeGreaterThan(8);
      if (d < 50) expect(Math.abs(r.lateralM - line.get(r)!)).toBeLessThan(0.8);
    }
  });
});
