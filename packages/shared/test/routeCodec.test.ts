import { describe, expect, it } from 'vitest';
import { decodeRoute, encodeRoute, type RouteData } from '../src/index.ts';

const route = (d: (i: number) => number, stepM?: number): RouteData => ({
  id: 'essai',
  name: 'Essai',
  loop: true,
  lengthM: 10,
  elevationGainM: 1,
  points: Array.from({ length: 6 }, (_, i) => ({ x: i * 1.25, y: 30 + i * 0.01, z: i === 0 ? 0 : -i * 0.5, d: d(i) })),
  segments: [],
  roadWidthM: 6,
  attribution: ['OSM'],
  ...(stepM !== undefined ? { stepM } : {}),
});

describe('format compact des itinéraires', () => {
  it('pas régulier : trois nombres par point, distance retrouvée, aller-retour identique', () => {
    const r = route((i) => i * 2, 2);
    const c = encodeRoute(r);
    expect(c.pointsFlat).toMatchObject({ v: 1, stride: 3, step: 2 });
    expect(c.pointsFlat.data.length).toBe(18);
    expect(Object.keys(c)[0]).toBe('id'); // le serveur lit l'identifiant en tête de fichier
    expect('points' in c).toBe(false);
    expect(decodeRoute(JSON.parse(JSON.stringify(c)))).toEqual(r);
  });

  it('pas irrégulier : la distance de chaque point est gardée', () => {
    const r = route((i) => i * 1.999, 1.999);
    r.points[3]!.d += 0.01;
    const c = encodeRoute(r);
    expect(c.pointsFlat.stride).toBe(4);
    expect(decodeRoute(JSON.parse(JSON.stringify(c)))).toEqual(r);
  });

  it('même empreinte que l’ancien format : clés dans le même ordre, mêmes nombres', () => {
    const r = route((i) => i * 2, 2);
    expect(JSON.stringify(decodeRoute(JSON.parse(JSON.stringify(encodeRoute(r)))))).toBe(JSON.stringify(r));
  });

  it('ancien format : rendu tel quel', () => {
    const r = route((i) => i * 2, 2);
    expect(decodeRoute(r)).toBe(r);
    expect(decodeRoute(null)).toBeNull();
  });

  it('plus de deux fois plus petit en JSON sur un vrai pas de 2 m', () => {
    const big: RouteData = { ...route((i) => i * 2, 2), points: Array.from({ length: 2000 }, (_, i) => ({ x: -374.89 + i * 1.53, y: 29.43 - i * 0.01, z: -838.57 - i * 1.55, d: i * 2 })) };
    big.points.forEach((p) => {
      p.x = Math.round(p.x * 100) / 100;
      p.y = Math.round(p.y * 100) / 100;
      p.z = Math.round(p.z * 100) / 100;
    });
    expect(JSON.stringify(encodeRoute(big)).length).toBeLessThan(JSON.stringify(big).length / 2);
  });
});
