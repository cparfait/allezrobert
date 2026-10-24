import { describe, expect, it } from 'vitest';
import { drawnRoads, roadAvoidance } from '../src/world/roadAvoid.ts';
import type { TileRoad } from '../src/world/types.ts';

const road = (pts: number[], over: Partial<TileRoad> = {}): TileRoad => ({ kind: 'residential', width: 6, pts, ...over });

describe('roadAvoidance', () => {
  it('refuse la chaussée, bas-côté compris, mais pas au-delà', () => {
    const avoid = roadAvoidance(drawnRoads([road([0, 0, 100, 0])])); // demi-largeur 3 + 0,6
    expect(avoid(50, 0)).toBe(true);
    expect(avoid(50, 3.5)).toBe(true);
    expect(avoid(50, 3.7)).toBe(false);
    expect(avoid(50, 3.7, 0.6)).toBe(true); // marge demandée par l'appelant
    expect(avoid(50, 8)).toBe(false);
  });
  it('un long segment est couvert sur toute sa longueur, pas seulement à ses sommets', () => {
    const avoid = roadAvoidance(drawnRoads([road([0, 0, 400, 0])]));
    for (const x of [0, 37, 120, 200, 313, 400]) expect(avoid(x, 1), `x=${x}`).toBe(true);
    expect(avoid(-5, 0)).toBe(false);
    expect(avoid(405, 0)).toBe(false);
  });
  it('segments obliques et coudes', () => {
    const avoid = roadAvoidance(drawnRoads([road([0, 0, 100, 100, 200, 100])]));
    expect(avoid(50, 50)).toBe(true);
    expect(avoid(50, 56)).toBe(false);
    expect(avoid(150, 101)).toBe(true);
    expect(avoid(150, 110)).toBe(false);
  });
  it('sentiers, tunnels et routes sans point sont ignorés ; une piste cyclable compte en monde ouvert', () => {
    const roads = [road([0, 0, 100, 0], { kind: 'footway' }), road([0, 20, 100, 20], { tunnel: true }), road([5, 5], { kind: 'residential' }), road([0, 40, 100, 40], { kind: 'track', width: 3 })];
    const avoid = roadAvoidance(drawnRoads(roads));
    expect(avoid(50, 0)).toBe(false);
    expect(avoid(50, 20)).toBe(false);
    expect(avoid(50, 40)).toBe(true); // piste (kind track) dessinée : demi-largeur 1,25 + 0,6
    expect(avoid(50, 42.5)).toBe(false);
    const cyc = [road([0, 0, 100, 0], { kind: 'cycleway', width: 2 })];
    expect(roadAvoidance(drawnRoads(cyc))(50, 0)).toBe(false);
    expect(roadAvoidance(drawnRoads(cyc, true))(50, 0)).toBe(true);
  });
  it('aucune route : rien n’est refusé', () => {
    expect(roadAvoidance([])(10, 10)).toBe(false);
  });
});
