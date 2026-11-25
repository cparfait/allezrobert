import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import type { RouteSegment, RouteTrack } from '@allezrobert/shared';
import { KomChallenge, recordTimeAt, type ChallengeResult } from '../src/game/challenge.ts';

describe('défi KOM', () => {
  it('temps du record à une distance donnée (interpolé)', () => {
    const rec = { timeS: 4, dist: [0, 5, 10, 15, 20], date: '' };
    expect(recordTimeAt(rec, 0)).toBe(0);
    expect(recordTimeAt(rec, 7.5)).toBeCloseTo(1.5, 6);
    expect(recordTimeAt(rec, 20)).toBeCloseTo(4, 6);
    expect(recordTimeAt(rec, 21)).toBeNull();
  });

  const run = (simulated: boolean) => {
    const seg = { id: 'k', name: 'Côte', kind: 'kom', startM: 200, endM: 1000, avgGrade: 5 } as unknown as RouteSegment;
    const track = { length: 1000, route: { id: 'r', loop: false } } as unknown as RouteTrack;
    const c = new KomChallenge({} as THREE.Scene, track, seg, {} as never);
    c.counts = () => !simulated;
    let done: ChallengeResult | null = null;
    c.onDone = (r) => (done = r);
    c.update(0.016, 150, 20);
    // Sommet au bout de la route : la sortie se met en pause là, sans autre image (reachSummit).
    c.update(0, 1000 - c.startD, 120);
    return done as ChallengeResult | null;
  };
  it('côte qui finit au bout de la route : défi terminé à l’arrivée', () => {
    expect(run(false)).toMatchObject({ timeS: 100, isRecord: true, counted: true });
  });
  it('au simulateur : temps rendu, jamais un record', () => {
    expect(run(true)).toMatchObject({ timeS: 100, isRecord: false, counted: false });
  });
});
