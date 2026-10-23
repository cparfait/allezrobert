import { describe, expect, it } from 'vitest';
import type { RouteData, RoutePoint } from '@allezrobert/shared';
import { asCircuit } from '../src/circuit.ts';

/** Itinéraire de test : points tous les 2 m, distances cumulées. */
function route(xz: Array<[number, number]>): RouteData {
  let d = 0;
  const points: RoutePoint[] = xz.map(([x, z], i) => {
    if (i) d += Math.hypot(x - xz[i - 1]![0], z - xz[i - 1]![1]);
    return { x, y: 0, z, d };
  });
  return { id: 't', name: 't', loop: false, lengthM: d, elevationGainM: 0, points, segments: [], roadWidthM: 5, attribution: [], surfaces: [{ startM: 0, endM: d, surface: 'asphalt' }] };
}

/** Cercle de 2 m de pas, `turns` tours (au-delà de 1 : le tracé refait ses premiers mètres). */
function circle(turns: number): Array<[number, number]> {
  const r = 100;
  const n = Math.round((2 * Math.PI * r) / 2);
  return Array.from({ length: Math.round(n * turns) + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
}

describe('tour revenu au départ', () => {
  it('repasse sur ses premiers mètres : publié en boucle, coupé au départ', () => {
    const r = asCircuit(route(circle(1.1)));
    expect(r.loop).toBe(true);
    expect(r.lengthM).toBeCloseTo(2 * Math.PI * 100, 0);
    expect(r.surfaces).toEqual([{ startM: 0, endM: r.lengthM, surface: 'asphalt' }]);
  });

  it('aller-retour en raquette (demi-tour au départ) : reste un aller simple', () => {
    const out: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => [i * 2, 0]);
    const r = route([...out, ...out.slice(0, -1).reverse().map(([x]) => [x, 0.5] as [number, number])]);
    expect(asCircuit(r)).toBe(r);
  });

  it('arrivée loin du départ : inchangé', () => {
    const r = route(circle(0.8));
    expect(asCircuit(r)).toBe(r);
  });
});
