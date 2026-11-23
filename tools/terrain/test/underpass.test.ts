import { describe, expect, it } from 'vitest';
import type { DemStack } from '../src/dem.ts';
import type { RoadGraph } from '../src/graph.ts';
import { UNDERPASS_CLEARANCE_M, lowerRouteUnderpasses, lowerUnderpasses, overpassesOf } from '../src/roads3d.ts';

type P3 = [number, number, number];
const line = (x0: number, z0: number, x1: number, z1: number, y: (s: number) => number, step = 4): P3[] => {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(L / step);
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y((L * i) / n), z0 + ((z1 - z0) * i) / n]);
};
const edge = (id: number, a: number, b: number, prof: P3[], road: Partial<{ kind: string; width: number; bridge: boolean; tunnel: boolean }> = {}) => ({
  id,
  a,
  b,
  len: 0,
  pts: prof.map((p) => [p[0], p[2]]),
  road: { kind: 'residential', width: 5, bridge: false, tunnel: false, ...road },
});
const flatDem = (h: number) => ({ sample: () => h }) as unknown as DemStack;

describe('lowerUnderpasses : route qui passe sous un pont', () => {
  it('bosse du MNT sous un pont routier : la route passe dessous, rampes douces, voisine raccordée au nœud', () => {
    // Rue le long de x (bosse de 4 m sous le pont en x = 0), puis rue voisine plate au-delà du nœud 2 (x = 100).
    const street = line(-100, 0, 100, 0, (s) => 100 + 4 * Math.exp(-(((s - 100) / 10) ** 2)));
    const next = line(100, 0, 200, 0, () => 100);
    const deck = line(0, -50, 0, 50, () => 104);
    const g = { edges: [edge(0, 1, 2, street), edge(1, 2, 3, next), edge(2, 4, 5, deck, { bridge: true, width: 8 })] } as unknown as RoadGraph;
    const pts = new Map<number, P3[]>([[0, street], [1, next], [2, deck]]);
    const before = street.map((p) => p[1]);
    const stats = lowerUnderpasses(g, pts, new Set(), flatDem(100), []);
    expect(stats.lowered).toBe(1);
    const at = (x: number) => street.find((p) => Math.abs(p[0] - x) < 2.1)![1];
    // hauteur libre sous le tablier (104 − 0,9 de tablier)
    expect(at(0)).toBeLessThanOrEqual(104 - 0.9 - UNDERPASS_CLEARANCE_M + 1e-6);
    // jamais relevée, pente des rampes ≤ 6 %
    street.forEach((p, i) => expect(p[1]).toBeLessThanOrEqual(before[i]! + 1e-9));
    for (let i = 1; i < street.length; i++) expect(Math.abs(street[i]![1] - street[i - 1]![1]) / 4).toBeLessThanOrEqual(0.06 + 1e-6);
    // le pont n'est pas touché ; la voisine raccordée au nœud commun
    expect(deck.every((p) => p[1] === 104)).toBe(true);
    expect(next[0]![1]).toBeCloseTo(street[street.length - 1]![1], 6);
  });

  it('rampe qui déborde sur la rue voisine : abaissée aussi, sans marche au nœud', () => {
    // Pont routier à 10 m du nœud 2 : la rampe (6 %) continue dans la rue voisine.
    const street = line(0, 0, 30, 0, () => 100);
    const next = line(30, 0, 130, 0, () => 100);
    const deck = line(20, -50, 20, 50, () => 102);
    const g = { edges: [edge(0, 1, 2, street), edge(1, 2, 3, next), edge(2, 4, 5, deck, { bridge: true, width: 8 })] } as unknown as RoadGraph;
    const pts = new Map<number, P3[]>([[0, street], [1, next], [2, deck]]);
    lowerUnderpasses(g, pts, new Set(), flatDem(100), []);
    expect(next[0]![1]).toBeCloseTo(street[street.length - 1]![1], 6);
    expect(next[0]![1]).toBeLessThan(99);
    expect(next[next.length - 1]![1]).toBe(100);
  });

  it('pont ferroviaire sur remblai : dessous du tablier estimé sur le MNT de la voie', () => {
    const street = line(-100, 0, 100, 0, () => 100);
    const g = { edges: [edge(0, 1, 2, street)] } as unknown as RoadGraph;
    const pts = new Map<number, P3[]>([[0, street]]);
    // remblai à 101 m : rail à 101,55, dessous du tablier à 100,35 → route à 96,15 au plus
    const stats = lowerUnderpasses(g, pts, new Set(), flatDem(101), [{ pts: [[0, -60], [0, 60]], width: 3.5 }]);
    expect(stats.lowered).toBe(1);
    expect(street.find((p) => Math.abs(p[0]) < 2.1)![1]).toBeLessThanOrEqual(101 + 0.55 - 1.2 - UNDERPASS_CLEARANCE_M + 1e-6);
  });

  it('itinéraire gardé, tunnel, ou viaduc haut : rien ne bouge', () => {
    const street = line(-100, 0, 100, 0, () => 100);
    const deck = line(0, -50, 0, 50, () => 120);
    const g = { edges: [edge(0, 1, 2, street), edge(1, 4, 5, deck, { bridge: true })] } as unknown as RoadGraph;
    const pts = new Map<number, P3[]>([[0, street], [1, deck]]);
    expect(lowerUnderpasses(g, pts, new Set(), flatDem(100), []).lowered).toBe(0);
    const low = line(0, -50, 0, 50, () => 102);
    const g2 = { edges: [edge(0, 1, 2, street), edge(1, 4, 5, low, { bridge: true })] } as unknown as RoadGraph;
    expect(lowerUnderpasses(g2, new Map<number, P3[]>([[0, street], [1, low]]), new Set([0]), flatDem(100), []).lowered).toBe(0);
    expect(street.every((p) => p[1] === 100)).toBe(true);
  });
});

describe('lowerRouteUnderpasses : itinéraire gardé sous un pont', () => {
  it('points abaissés sous le tablier, rampes douces, jamais relevés ; fichier à réécrire', () => {
    const points = Array.from({ length: 101 }, (_, i) => ({ x: -100 + i * 2, y: 100 + 3 * Math.exp(-((((i - 50) * 2) / 10) ** 2)), z: 0, d: i * 2 }));
    const before = points.map((p) => p.y);
    const deck = line(0, -50, 0, 50, () => 103);
    const g = { edges: [edge(0, 1, 2, deck, { bridge: true, width: 8 })] } as unknown as RoadGraph;
    const ov = overpassesOf(g, new Map<number, P3[]>([[0, deck]]), flatDem(100), []);
    expect(lowerRouteUnderpasses(points, false, ov)).toBe(true);
    expect(points[50]!.y).toBeLessThanOrEqual(103 - 0.9 - UNDERPASS_CLEARANCE_M + 0.01);
    points.forEach((p, i) => expect(p.y).toBeLessThanOrEqual(before[i]! + 1e-9));
    for (let i = 1; i < points.length; i++) expect(Math.abs(points[i]!.y - points[i - 1]!.y) / 2).toBeLessThanOrEqual(0.06 + 0.01);
    // sans pont au-dessus : rien ne change
    const far = Array.from({ length: 11 }, (_, i) => ({ x: 500 + i * 2, y: 100, z: 0, d: i * 2 }));
    expect(lowerRouteUnderpasses(far, false, ov)).toBe(false);
  });
});
