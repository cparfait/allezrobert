import { describe, expect, it } from 'vitest';
import { OpenPath, RoadNet, RouteTrack, type RoadGraphData, type RoadGraphEdge } from '../src/index.ts';

/**
 * Carrefour en T : nœud 0 au sud (0, 0, 200), carrefour 1 à l'origine, 2 à l'ouest (−200, 0),
 * 3 à l'est (200, 0), 4 au nord (0, −200) par un sens unique 1 → 4. Montée de 10 m vers l'est.
 * Rappel : x = est, z = sud.
 */
function line(a: number, b: number, from: [number, number, number], to: [number, number, number], extra: Partial<RoadGraphEdge> = {}): RoadGraphEdge {
  const pts: number[] = [];
  const n = 20;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  }
  return { a, b, kind: 'tertiary', width: 5, surface: 'asphalt', oneway: 0, len: Math.hypot(to[0] - from[0], to[2] - from[2]), pts, ...extra };
}

const data: RoadGraphData = {
  formatVersion: 1,
  nodes: [0, 0, 200, 0, 0, 0, -200, 0, 0, 200, 10, 0, 0, 0, -200],
  edges: [
    line(0, 1, [0, 0, 200], [0, 0, 0], { name: 'Rue du Bourg' }),
    line(1, 2, [0, 0, 0], [-200, 0, 0], { name: 'Route de Glaine' }),
    line(1, 3, [0, 0, 0], [200, 10, 0], { name: 'Rue du Bourg', surface: 'gravel' }),
    line(1, 4, [0, 0, 0], [0, 0, -200], { oneway: -1 }),
  ],
  attribution: [],
};

describe('RoadNet', () => {
  const net = new RoadNet(data);
  it('liste les sorties d’un carrefour de gauche à droite, sans sens interdit', () => {
    const c = net.choices({ edge: 0, forward: true }); // on monte vers le nord
    expect(c.map((x) => x.dir)).toEqual(['left', 'right']);
    expect(c[0]!.name).toBe('Route de Glaine');
    expect(c[1]!.surface).toBe('gravel');
    expect(c[0]!.turnDeg).toBeCloseTo(-90, 0);
  });
  it('demi-tour seulement au bout d’un cul-de-sac', () => {
    const c = net.choices({ edge: 1, forward: true }); // vers l'ouest, nœud 2 sans issue
    expect(c).toHaveLength(1);
    expect(c[0]!.dir).toBe('back');
  });
  it('« tout droit » suit la même route', () => {
    expect(net.straightest({ edge: 0, forward: true }).step.edge).toBe(2);
  });
  it('trouve l’arête la plus proche', () => {
    const r = net.nearest(-50, 3)!;
    expect(r.edge).toBe(1);
    expect(r.along).toBeCloseTo(50, 0);
    expect(r.dist).toBeCloseTo(3, 1);
  });
});

describe('OpenPath', () => {
  const net = new RoadNet(data);
  it('enchaîne les arêtes au mètre près et garde les altitudes', () => {
    const p = new OpenPath(net);
    p.add({ edge: 0, forward: true }, 50);
    p.add({ edge: 2, forward: true });
    expect(p.length).toBeCloseTo(150 + 200, 1);
    const pts = p.pointsFrom(0);
    expect(pts[0]!.z).toBeCloseTo(150, 6);
    const last = pts[pts.length - 1]!;
    expect(last.x).toBeGreaterThan(198);
    expect(last.y).toBeGreaterThan(9.8);
    // Coin arrondi : le point lissé au carrefour passe à l'intérieur du virage.
    const corner = pts.find((q) => q.d === 150)!;
    expect(corner.x).toBeGreaterThan(0.3);
    expect(corner.z).toBeGreaterThan(0.3);
  });
  it('replanifie un carrefour sans toucher au début', () => {
    const p = new OpenPath(net);
    p.add({ edge: 0, forward: true });
    p.add({ edge: 2, forward: true });
    const before = p.pointsFrom(0).slice(0, 50);
    p.truncateSteps(1);
    expect(p.length).toBeCloseTo(200, 6);
    p.add({ edge: 1, forward: true });
    expect(p.pointsFrom(0).slice(0, 50)).toEqual(before);
    expect(p.last!.edge).toBe(1);
  });
  it('demi-tour au milieu d’une arête', () => {
    const p = new OpenPath(net);
    p.add({ edge: 0, forward: true });
    const cut = p.cutAt(80.5)!;
    expect(cut.along).toBeCloseTo(80.5, 6);
    expect(p.length).toBeCloseTo(80.5, 6);
    const e = net.edge(cut.step.edge);
    p.add({ edge: cut.step.edge, forward: !cut.step.forward }, e.len - cut.along);
    expect(p.length).toBeCloseTo(80.5 + 80.5, 1);
    const pts = p.pointsFrom(0);
    expect(pts[pts.length - 1]!.z).toBeGreaterThan(197);
  });
  it('alimente un RouteTrack qui s’allonge', () => {
    const p = new OpenPath(net);
    p.add({ edge: 0, forward: true });
    const track = new RouteTrack({ id: 'open', name: 'open', loop: false, lengthM: 0, elevationGainM: 0, points: p.pointsFrom(0), segments: [], roadWidthM: 5, attribution: [] });
    expect(track.length).toBe(200);
    const from = Math.max(0, p.length - 10);
    p.add({ edge: 2, forward: true });
    track.extend(p.pointsFrom(from), from);
    expect(track.length).toBeGreaterThan(398);
    expect(track.sample(300).grade).toBeCloseTo(5, 0);
    expect(track.sample(100).grade).toBeCloseTo(0, 6);
  });
});
