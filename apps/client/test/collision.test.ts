import { describe, expect, it } from 'vitest';
import { BIKE_LENGTH_M, BIKE_WIDTH_M, separateRiders, type Body } from '../src/game/collision.ts';

describe('collisions entre coureurs', () => {
  it('ne laisse pas un coureur traverser celui de devant', () => {
    const front: Body = { distM: 10, lateral: 1, speedMs: 8 };
    const rear: Body = { distM: 9.5, lateral: 1, speedMs: 12 };
    for (let i = 0; i < 60; i++) {
      rear.distM += rear.speedMs / 60;
      front.distM += front.speedMs / 60;
      separateRiders([front, rear], 3, 1 / 60);
      const apart = Math.abs(front.lateral - rear.lateral) >= BIKE_WIDTH_M - 0.06 || front.distM - rear.distM >= BIKE_LENGTH_M - 0.01;
      expect(apart).toBe(true);
    }
  });

  it('écarte latéralement deux coureurs superposés', () => {
    const a: Body = { distM: 5, lateral: 0, speedMs: 8 };
    const b: Body = { distM: 5, lateral: 0.1, speedMs: 8 };
    for (let i = 0; i < 30; i++) separateRiders([a, b], 3, 1 / 60);
    expect(Math.abs(a.lateral - b.lateral)).toBeGreaterThanOrEqual(BIKE_WIDTH_M - 0.05);
  });

  it('ne déplace pas un coureur imposé', () => {
    const fixed: Body = { distM: 5, lateral: 0, speedMs: 8, fixed: true };
    const b: Body = { distM: 5, lateral: 0.1, speedMs: 8 };
    for (let i = 0; i < 60; i++) separateRiders([fixed, b], 3, 1 / 60);
    expect(fixed.lateral).toBe(0);
    expect(Math.abs(b.lateral - fixed.lateral)).toBeGreaterThanOrEqual(BIKE_WIDTH_M - 0.05);
  });
});
