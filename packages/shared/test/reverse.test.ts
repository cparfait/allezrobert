import { describe, expect, it } from 'vitest';
import { forwardRouteId, reverseRoute, type RouteData } from '../src/index.ts';

/** Ligne droite de 2 000 m : montée de 1 000 m à 6 %, puis plat. */
function route(loop: boolean): RouteData {
  const points = Array.from({ length: 1001 }, (_, i) => ({ x: i * 2, y: i <= 500 ? i * 0.12 : 60, z: 0, d: i * 2 }));
  return {
    id: 'r',
    name: 'Route',
    loop,
    lengthM: loop ? 2010 : 2000,
    elevationGainM: 60,
    points,
    segments: [{ id: 'r-kom-1', kind: 'kom', name: 'Côte 1', startM: 0, endM: 1000, avgGrade: 6 }, { id: 'r-sprint-1', kind: 'sprint', name: 'Sprint', startM: 1500, endM: 1800, avgGrade: 0 }],
    roadWidthM: 5,
    attribution: [],
    stepM: 2,
    surfaces: [{ startM: 0, endM: 500, surface: 'gravel' }, { startM: 500, endM: 2000, surface: 'asphalt' }],
    landmarks: [{ name: 'Le Bourg', d: 1900 }],
  };
}

describe('parcours dans l’autre sens', () => {
  it('aller simple : départ à l’arrivée, montées du profil inversé, identifiant à part', () => {
    const r = reverseRoute(route(false));
    expect(r.id).toBe('r-inverse');
    expect(forwardRouteId(r.id)).toBe('r');
    expect(r.points[0]).toMatchObject({ x: 2000, d: 0 });
    expect(r.points.at(-1)).toMatchObject({ x: 0, d: 2000 });
    // la côte devient une descente : plus de montée, le sprint est retourné
    expect(r.segments.map((s) => [s.kind, s.startM, s.endM])).toEqual([['sprint', 200, 500]]);
    expect(r.elevationGainM).toBe(0);
    expect(r.surfaces).toEqual([{ startM: 0, endM: 1500, surface: 'asphalt' }, { startM: 1500, endM: 2000, surface: 'gravel' }]);
    expect(r.landmarks).toEqual([{ name: 'Le Bourg', d: 100 }]);
  });

  it('boucle : même départ, tour dans l’autre sens, montée détectée', () => {
    const fwd = route(true);
    const r = reverseRoute(fwd);
    expect(r.loop).toBe(true);
    expect(r.lengthM).toBe(2010);
    expect(r.points[0]).toEqual(fwd.points[0]);
    expect(r.points[1]).toMatchObject({ x: 2000, d: 10 });
    // retour de x = 2 000 à 0 : la descente du sens normal… et la fermeture remonte de 60 m
    expect(r.elevationGainM).toBeCloseTo(60, 0);
  });
});
