import { describe, expect, it } from 'vitest';
import { frenchOf, itineraryRoute, joinItineraries, planItinerary, RoadNet, snapToRoad, type RoadGraphData, type RoadGraphEdge } from '../src/index.ts';

/** Arête droite échantillonnée tous les 10 m (x = est, z = sud). */
function line(a: number, b: number, from: [number, number, number], to: [number, number, number], extra: Partial<RoadGraphEdge> = {}): RoadGraphEdge {
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const n = Math.max(1, Math.round(len / 10));
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  }
  return { a, b, kind: 'tertiary', width: 5, surface: 'asphalt', oneway: 0, len, pts, ...extra };
}

/**
 * Carré de 1 km : 0 (0,0) — 1 (1000,0) — 2 (1000,1000) — 3 (0,1000) — 0, plus une diagonale
 * en chemin de terre 0 → 2 (1414 m, plus courte que les 2000 m revêtus) et une montée de 60 m
 * de 1 vers 2.
 */
const data: RoadGraphData = {
  formatVersion: 1,
  nodes: [0, 100, 0, 1000, 100, 0, 1000, 160, 1000, 0, 100, 1000],
  edges: [
    line(0, 1, [0, 100, 0], [1000, 100, 0]),
    line(1, 2, [1000, 100, 0], [1000, 160, 1000]),
    line(2, 3, [1000, 160, 1000], [0, 100, 1000]),
    line(3, 0, [0, 100, 1000], [0, 100, 0]),
    line(0, 2, [0, 100, 0], [1000, 160, 1000], { kind: 'track', surface: 'dirt' }),
  ],
  attribution: ['test'],
};
const net = new RoadNet(data);

describe('itinéraire départ → arrivée', () => {
  it('rattache un clic à la route la plus proche, au carrefour s’il est tout près', () => {
    const s = snapToRoad(net, 500, -30);
    expect(s?.edge).toBe(0);
    expect(s?.along).toBeCloseTo(500, 0);
    expect(s?.z).toBeCloseTo(0, 5);
    const n = snapToRoad(net, 1008, 5);
    expect(n?.x).toBeCloseTo(1000, 5);
    expect(n?.z).toBeCloseTo(0, 5);
    expect(snapToRoad(net, 5000, 5000)).toBeNull();
  });

  it('préfère les routes revêtues au chemin de terre plus court', () => {
    const from = snapToRoad(net, 0, 0)!;
    const to = snapToRoad(net, 1000, 1000)!;
    const it = planItinerary(net, from, to)!;
    expect(it.steps.map((s) => s.edge)).not.toContain(4);
    const route = itineraryRoute(net, it, { id: 'test', name: 'Test' })!;
    expect(route.lengthM).toBeGreaterThan(1990);
    expect(route.lengthM).toBeLessThan(2010);
    expect(route.loop).toBe(false);
    // points tous les 2 m, profil continu
    expect(route.points[1]!.d - route.points[0]!.d).toBe(2);
    expect(route.elevationGainM).toBeCloseTo(60, 0);
    // la montée de 1 km à 6 % est détectée
    expect(route.segments.length).toBe(1);
    expect(route.segments[0]!.avgGrade).toBeGreaterThan(5);
  });

  it('part et arrive au milieu des arêtes, dans les deux sens', () => {
    const from = snapToRoad(net, 300, 0)!;
    const to = snapToRoad(net, 0, 700)!;
    const it = planItinerary(net, from, to)!;
    const route = itineraryRoute(net, it, { id: 'test', name: 'Test' })!;
    // 300 m vers l'ouest jusqu'au coin 0, puis 700 m vers le sud
    expect(route.lengthM).toBeCloseTo(1000, -1);
    expect(route.points[0]!.x).toBeCloseTo(300, 0);
    const end = route.points[route.points.length - 1]!;
    expect(end.x).toBeCloseTo(0, 0);
    expect(end.z).toBeCloseTo(700, -1);
  });

  it('même arête : tout droit, sans détour', () => {
    const it = planItinerary(net, snapToRoad(net, 800, 0)!, snapToRoad(net, 200, 0)!)!;
    expect(it.steps.map((s) => [s.edge, s.forward])).toEqual([[0, false]]);
    expect(it.steps[0]!.from).toBeCloseTo(200, 0);
    expect(it.steps[0]!.to).toBeCloseTo(800, 0);
    expect(itineraryRoute(net, it, { id: 't', name: 'T' })!.lengthM).toBeCloseTo(600, -1);
  });

  it('plusieurs points de passage, et boucle revenant au départ', () => {
    const pts = [snapToRoad(net, 300, 0)!, snapToRoad(net, 1000, 500)!, snapToRoad(net, 500, 1000)!, snapToRoad(net, 300, 0)!];
    const legs = pts.slice(1).map((p, i) => planItinerary(net, pts[i]!, p)!);
    const it = joinItineraries(legs);
    // 700 + 500 (étape 1), 500 + 500 (étape 2), 500 + 1000 + 300 (retour par l'ouest)
    const route = itineraryRoute(net, it, { id: 'b', name: 'Boucle', places: [{ name: 'Le Roussel', kind: 'hamlet', x: 1050, z: 500 }, { name: 'Loin', kind: 'village', x: 5000, z: 5000 }] })!;
    expect(route.lengthM).toBeCloseTo(4000, -1);
    const a = route.points[0]!;
    const b = route.points[route.points.length - 1]!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(3);
    // l'arête 0 continuée au point de passage n'est pas coupée en deux
    expect(it.steps.filter((s) => s.edge === 0).length).toBe(2);
    expect(route.landmarks).toEqual([{ name: 'Le Roussel', d: expect.closeTo(1200, -1) }]);
    expect(route.segments[0]?.name).toBe('Côte du Roussel');
  });

  it('« de » devant les noms de lieux', () => {
    expect(['Le Roussel', 'Les Vigiers', 'La Pireyre', 'Égliseneuve-près-Billom', 'Glaine', "L'Arbre"].map(frenchOf)).toEqual(['du Roussel', 'des Vigiers', 'de la Pireyre', 'd’Égliseneuve-près-Billom', 'de Glaine', 'de l’Arbre']);
  });

  it('respecte les sens uniques', () => {
    const one: RoadGraphData = { ...data, edges: data.edges.map((e, i) => (i === 0 ? { ...e, oneway: 1 as const } : e)) };
    const n1 = new RoadNet(one);
    // de 1 vers 0 : l'arête 0 est interdite dans ce sens, on fait le tour
    const it = planItinerary(n1, snapToRoad(n1, 1000, 0)!, snapToRoad(n1, 0, 0)!)!;
    expect(it.steps.map((s) => s.edge)).toEqual([1, 2, 3]);
  });
});
