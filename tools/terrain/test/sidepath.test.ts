import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/geom.ts';
import type { RoadGraph } from '../src/graph.ts';
import { bikeable, markSidepaths } from '../src/loop.ts';

const edge = (id: number, kind: string, pts: Pt[]) => ({
  id,
  a: id * 2,
  b: id * 2 + 1,
  pts,
  len: pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0),
  oneway: 0,
  rides: 0,
  passes: 0,
  road: { kind, width: 5, paved: true, bridge: false, tunnel: false, surface: 'asphalt' },
});

describe('markSidepaths : la route plutôt que la piste qui la longe', () => {
  it('piste à 6 m d une départementale : écartée des boucles ; voie verte seule : gardée', () => {
    const road = edge(0, 'tertiary', [[0, 0], [400, 0]]);
    const side = edge(1, 'cycleway', [[0, 6], [400, 6]]);
    const greenway = edge(2, 'cycleway', [[0, 300], [400, 300]]);
    const g = { edges: [road, side, greenway] } as unknown as RoadGraph;
    expect(markSidepaths(g)).toBe(1);
    expect(bikeable(side as never)).toBe(false);
    expect(bikeable(greenway as never)).toBe(true);
    expect(bikeable(road as never)).toBe(true);
  });

  it('piste le long d une voie rapide interdite aux vélos : gardée (pas de route roulable à côté)', () => {
    const trunk = edge(0, 'trunk', [[0, 0], [400, 0]]);
    const side = edge(1, 'cycleway', [[0, 6], [400, 6]]);
    const g = { edges: [trunk, side] } as unknown as RoadGraph;
    expect(markSidepaths(g)).toBe(0);
    expect(bikeable(side as never)).toBe(true);
  });
});
