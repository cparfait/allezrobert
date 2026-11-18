import { describe, expect, it } from 'vitest';
import { LATERAL_CRUISE, LATERAL_PASSING, stepLateral } from '../src/game/lateralSpring.ts';

function run(target: number, seconds: number, tuning = LATERAL_PASSING) {
  const m = { v: 0 };
  let lat = 0.8;
  const trace: number[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    lat = stepLateral(m, lat, target, 1 / 60, tuning);
    trace.push(lat);
  }
  return { lat, m, trace };
}

describe('déplacement latéral des coureurs', () => {
  it('démarre en douceur : pas d’à-coup la première image', () => {
    const { trace } = run(-1.35, 0.1);
    expect(Math.abs((trace[0] ?? 0) - 0.8)).toBeLessThan(0.002);
  });

  it('vitesse plafonnée et arrivée sans dépasser la cible', () => {
    const { lat, trace } = run(-1.35, 4);
    let maxSpeed = 0;
    for (let i = 1; i < trace.length; i++) maxSpeed = Math.max(maxSpeed, Math.abs((trace[i]! - trace[i - 1]!) * 60));
    expect(maxSpeed).toBeLessThanOrEqual(LATERAL_PASSING.maxSpeed + 1e-6);
    expect(Math.min(...trace)).toBeGreaterThan(-1.35 - 0.02);
    expect(lat).toBeCloseTo(-1.35, 1);
  });

  it('même résultat à 30 ou 144 images/s', () => {
    const at = (fps: number) => {
      const m = { v: 0 };
      let lat = 0.8;
      for (let i = 0; i < 2 * fps; i++) lat = stepLateral(m, lat, 0, 1 / fps, LATERAL_CRUISE);
      return lat;
    };
    expect(at(30)).toBeCloseTo(at(144), 2);
  });
});

