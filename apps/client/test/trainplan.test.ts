import { describe, expect, it } from 'vitest';
import { RouteTrack } from '@allezrobert/shared';
import { mergeRailPieces, planTriggers, railAt } from '../src/game/trainplan.ts';

/** Itinéraire droit de 3 km vers l'est. */
const track = new RouteTrack({
  id: 't',
  name: 't',
  loop: false,
  lengthM: 3000,
  elevationGainM: 0,
  points: Array.from({ length: 301 }, (_, i) => ({ x: i * 10, y: 0, z: 0, d: i * 10 })),
  segments: [],
  roadWidthM: 5,
  attribution: [],
});

describe('trains', () => {
  it('raccorde les morceaux d’une voie découpée aux tuiles, dans n’importe quel ordre', () => {
    const rails = mergeRailPieces([
      { id: 7, pts: [1000, 50, 2000, 50] },
      { id: 7, pts: [0, 50, 1000, 50] },
      { id: 7, pts: [3000, 50, 2000, 50] }, // à l'envers
      { id: 9, pts: [0, 900, 10, 900] },
    ]);
    const r7 = rails.find((r) => r.id === 7)!;
    expect(r7.length).toBeCloseTo(3000, 6);
    expect(r7.pts[0]).toBe(0);
    expect(r7.pts[r7.pts.length - 2]).toBe(3000);
    const p = railAt(r7, 1500);
    expect(p.x).toBeCloseTo(1500, 6);
    expect(p.dx).toBeCloseTo(1, 6);
  });
  it('déclenche là où la route passe au plus près d’une voie', () => {
    // Voie oblique qui croise la route vers x = 1500.
    const rails = mergeRailPieces([{ id: 1, pts: [1000, -800, 2000, 800] }]);
    const t = planTriggers(track, rails);
    expect(t).toHaveLength(1);
    expect(t[0]!.d).toBeCloseTo(1500, -1);
    expect(t[0]!.gapM).toBeLessThan(10);
    expect(t[0]!.railS).toBeCloseTo(Math.hypot(500, 800), -1);
    // Voie trop loin : rien.
    expect(planTriggers(track, mergeRailPieces([{ id: 2, pts: [0, 900, 3000, 900] }]))).toHaveLength(0);
  });
});
