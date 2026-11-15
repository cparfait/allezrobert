import { describe, expect, it } from 'vitest';
import { NETWORK_ROAD_LIFT, RoadHeightField, roadPose } from '../src/world/roadHeight.ts';
import type { LoadedTile, TileRoad } from '../src/world/types.ts';

const tile = (id: string, roads: Partial<TileRoad>[]): LoadedTile => ({ id, features: { roads: roads.map((r) => ({ kind: 'residential', width: 4, pts: [], surface: 'asphalt', ...r })) } }) as unknown as LoadedTile;

describe('RoadHeightField', () => {
  it('interpole la polyligne de la route, avec la levée du ruban du réseau', () => {
    const f = new RoadHeightField();
    f.addTile(tile('a', [{ pts3: [0, 100, 0, 100, 110, 0] }]));
    expect(f.surfaceAt(50, 1, 105)).toBeCloseTo(105 + NETWORK_ROAD_LIFT, 6);
    // hors de la chaussée + bas-côté (2 + 0,6 m)
    expect(f.surfaceAt(50, 3, 105)).toBeNaN();
  });

  it('ignore un pont au-dessus et garde la plus haute des routes qui se croisent au même niveau', () => {
    const f = new RoadHeightField();
    f.addTile(tile('a', [{ pts3: [0, 100, 0, 100, 100, 0] }, { pts3: [50, 107, -50, 50, 107, 50] }, { pts3: [0, 100.2, 1, 100, 100.2, 1] }]));
    expect(f.surfaceAt(50, 0.5, 100)).toBeCloseTo(100.2 + NETWORK_ROAD_LIFT, 6);
    expect(f.surfaceAt(50, 0.5, 107)).toBeCloseTo(107 + NETWORK_ROAD_LIFT, 6);
  });

  it('ne compte ni les tunnels ni les chemins, et oublie une tuile déchargée', () => {
    const f = new RoadHeightField();
    const t = tile('a', [{ pts3: [0, 100, 0, 100, 100, 0], tunnel: true }, { kind: 'footway', pts3: [0, 100, 0, 100, 100, 0] }]);
    f.addTile(t);
    expect(f.surfaceAt(50, 0, 100)).toBeNaN();
    const u = tile('b', [{ pts3: [0, 100, 0, 100, 100, 0] }]);
    f.addTile(u);
    expect(f.surfaceAt(50, 0, 100)).toBeCloseTo(100 + NETWORK_ROAD_LIFT, 6);
    f.removeTile(u);
    expect(f.surfaceAt(50, 0, 100)).toBeNaN();
  });
});

describe('RoadHeightField, épingle', () => {
  it("garde la branche la plus proche quand l'autre, plus haute, est à portée", () => {
    const f = new RoadHeightField();
    f.addTile(tile('a', [{ pts3: [0, 100, 0, 100, 100, 0] }, { pts3: [0, 101, 3.5, 100, 101, 3.5] }]));
    expect(f.surfaceAt(50, 1, 100.5)).toBeCloseTo(100 + NETWORK_ROAD_LIFT, 6);
    expect(f.surfaceAt(50, 2.6, 100.5)).toBeCloseTo(101 + NETWORK_ROAD_LIFT, 6);
  });
});

describe('roadPose', () => {
  it('pose les deux roues sur la chaussée, tangage compris ; garde le profil hors des routes', () => {
    const f = new RoadHeightField();
    // route en pente de 10 % vers +x
    f.addTile(tile('a', [{ pts3: [0, 100, 0, 100, 110, 0] }]));
    const out = { y: 0, pitch: 0 };
    expect(roadPose(50, 0, 1, 0, 105.3, 0, 0.6, 0.4, out, f)).toBe(true);
    expect(out.y).toBeCloseTo(105 + NETWORK_ROAD_LIFT, 6);
    expect(out.pitch).toBeCloseTo(Math.atan(0.1), 6);
    // hors route : profil donné gardé
    expect(roadPose(50, 30, 1, 0, 105.3, 0.02, 0.6, 0.4, out, f)).toBe(false);
    expect(out.y).toBe(105.3);
    expect(out.pitch).toBe(0.02);
    // sans surface (monde à itinéraire) : rien ne change
    expect(roadPose(50, 0, 1, 0, 105.3, 0.02, 0.6, 0.4, out, null)).toBe(false);
  });
});
