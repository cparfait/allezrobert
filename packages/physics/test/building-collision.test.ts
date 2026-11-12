import { describe, expect, it } from 'vitest';
import { RouteTrack, type RouteData } from '@allezrobert/shared';
import { BuildingObstacleIndex, RouteBuildingCollision, corridorHalfM, loadBuildingObstacleIndex, type BuildingObstacle, type BuildingObstacleData, type RouteObstacleResult } from '../src/index.ts';

const route: RouteData = {
  id: 'ligne', name: 'Ligne', loop: false, lengthM: 60, roadWidthM: 12, elevationGainM: 0, segments: [], attribution: [],
  points: [{ d: 0, x: 0, y: 0, z: 0 }, { d: 60, x: 60, y: 0, z: 0 }],
};
const track = new RouteTrack(route);
const wall = (id: string, x: number, z: number, width = 1, depth = 4): BuildingObstacle => ({
  id, tile: '0_0', polygon: [x, z, x + width, z, x + width, z + depth, x, z + depth], baseM: 0, topM: 5, solid: true,
});
const solve = (solver: RouteBuildingCollision, d0: number, l0: number, d1: number, l1: number, speedMs = 10) => {
  const out: RouteObstacleResult = { distM: 0, lateral: 0, speedMs: 0, hit: false };
  solver.resolve(track, { distM: d0, lateral: l0, speedMs }, { distM: d1, lateral: l1, speedMs }, 6, out);
  return out;
};

describe('couloir praticable (COLL-MURS-3d)', () => {
  const narrowing = new RouteTrack({ ...route, roadWidthM: 6, roadWidths: [{ startM: 0, endM: 30, widthM: 6 }, { startM: 30, endM: 60, widthM: 2.5 }] });
  const bounds = { left: 0, right: 0 };

  it('garde les roues sur une chaussée ou une piste étroite', () => {
    expect(corridorHalfM(6)).toBeCloseTo(2.6);
    expect(corridorHalfM(2.5)).toBeCloseTo(0.9);
    expect(corridorHalfM(1.5)).toBeCloseTo(0.5);
  });

  it('resserre les bornes avant un rétrécissement, au plus à 1,5 m/s', () => {
    const solver = new RouteBuildingCollision(new BuildingObstacleIndex([]));
    expect(solver.steeringBounds(narrowing, 10, 10, 1, bounds).right).toBeCloseTo(2.6);
    // 10 m/s, 5 m avant le rétrécissement : 0,5 s pour rentrer, soit 0,75 m de mieux que 0,9 m (moins un pas prudent).
    const near = solver.steeringBounds(narrowing, 25, 10, 1, bounds).right;
    expect(near).toBeGreaterThan(0.9);
    expect(near).toBeLessThanOrEqual(0.9 + 1.5 * 0.5 + 1e-6);
    expect(solver.steeringBounds(narrowing, 31, 10, 1, bounds).right).toBeCloseTo(0.9);
    // Sens inverse : on regarde vers le début du tracé.
    expect(solver.steeringBounds(narrowing, 25, 10, -1, bounds).right).toBeCloseTo(2.6);
  });

  it('borne le solveur à la largeur du tronçon et contourne une façade sans arrêt', () => {
    const solver = new RouteBuildingCollision(new BuildingObstacleIndex([wall('facade', 20, 1.6, 6, 4)]));
    // Le long de la façade (x de 20 à 26, à 1,6 m de l'axe) : ce côté s'arrête avant le contact, l'autre va au bord.
    const along = solver.steeringBounds(track, 23, 0, 1, bounds);
    expect(Math.min(along.left, along.right)).toBeLessThan(1.6 - 0.42);
    expect(Math.min(along.left, along.right)).toBeGreaterThan(0.9);
    expect(Math.max(along.left, along.right)).toBeCloseTo(5.6);
    // 10 m avant, à 10 m/s : la borne de ce côté est déjà resserrée pour rentrer à temps.
    const before = solver.steeringBounds(track, 13, 10, 1, bounds);
    expect(Math.min(before.left, before.right)).toBeLessThan(5.6);
    const out: RouteObstacleResult = { distM: 0, lateral: 0, speedMs: 0, hit: false };
    solver.resolve(narrowing, { distM: 31, lateral: 2.6, speedMs: 5 }, { distM: 31.5, lateral: 2.6, speedMs: 5 }, 2.6, out);
    expect(out.lateral).toBeCloseTo(0.9);
  });
});

describe('balayage des bâtiments', () => {
  const solver = new RouteBuildingCollision(new BuildingObstacleIndex([wall('mur', 10, -2, 0.12)]));

  it('arrête la roue avant le mur frontal même quand un pas traverse les deux façades', () => {
    for (const [end, speed] of [[10.5, 10], [20, 32]] as const) {
      const p = solve(solver, 8, 0, end, 0, speed);
      expect(p.hit).toBe(true);
      expect(p.distM).toBeCloseTo(8.975, 3);
      expect(p.lateral).toBe(0);
      expect(p.speedMs).toBe(0);
    }
  });

  it('glisse lors d’un contact oblique, même en bord de la grille', () => {
    const parallel = new RouteBuildingCollision(new BuildingObstacleIndex([wall('latéral', 12, 2, 12, 1)]));
    const p = solve(parallel, 13, 1, 21, 3);
    expect(p.hit).toBe(true);
    expect(p.distM).toBeCloseTo(21, 4);
    expect(p.lateral).toBeCloseTo(1.58, 2);
    expect(p.speedMs).toBeCloseTo(10, 4);
  });

  it('prend un coin arrondi et peut repartir après un arrêt prolongé', () => {
    let p = solve(solver, 8, 0, 12, 0);
    const stopped = p.distM;
    for (let i = 0; i < 60; i++) p = solve(solver, p.distM, p.lateral, p.distM + 0.1, 0);
    expect(p.distM).toBeCloseTo(stopped, 5);
    expect(p.speedMs).toBe(0);
    p = solve(solver, p.distM, 0, p.distM, 2.3, 0);
    p = solve(solver, p.distM, p.lateral, 11.5, 3);
    expect(p.hit).toBe(true);
    expect(p.lateral).toBeGreaterThan(2.42);
    expect(solve(solver, p.distM, p.lateral, 15, p.lateral).distM).toBeCloseTo(15, 4);
  });

  it('laisse passer dans une ouverture et à des altitudes différentes', () => {
    const opening = new RouteBuildingCollision(new BuildingObstacleIndex([
      wall('gauche', 10, -5, 1, 4.3), wall('droite', 10, 0.7, 1, 4.3),
      { ...wall('haut', 10, -0.7, 1, 1.4), baseM: 2.2 },
      { ...wall('sous le tablier', 13, -1, 1, 2), baseM: -5, topM: -0.1 },
      { ...wall('décor', 16, -1, 1, 2), solid: false },
    ]));
    const p = solve(opening, 8, 0, 20, 0);
    expect(p).toEqual({ distM: 20, lateral: 0, speedMs: 10, hit: false });
  });

  it('autorise une sortie tangentielle ou vers l’extérieur depuis une légère superposition', () => {
    const index = new BuildingObstacleIndex([wall('mur', 10, -2)]);
    const hit = { fraction: 0, nx: 0, nz: 0 };
    const start = { x: 9.8, y: 0, z: 0 };
    expect(index.sweep(start, { ...start, x: 9.4 }, 0.42, 1.85, hit)).toBe(false);
    expect(index.sweep(start, { ...start, z: 1 }, 0.42, 1.85, hit)).toBe(false);
    expect(index.sweep(start, { ...start, x: 11.5 }, 0.42, 1.85, hit)).toBe(true);
    expect(hit.fraction).toBe(0);
  });

  it('distingue données absentes, incompatibles ou malformées', () => {
    const hash = 'b'.repeat(64);
    const expected = { worldId: 'monde', routeId: route.id, routeSha256: hash, worldSha256: hash };
    const data: BuildingObstacleData = { formatVersion: 1, worldId: 'monde', routeId: route.id,
      source: { routeSha256: hash, worldSha256: hash, tiles: { '0_0': hash }, attribution: [] }, obstacles: [wall('mur', 10, 1)] };
    expect(loadBuildingObstacleIndex(null, expected).status).toBe('unavailable');
    expect(loadBuildingObstacleIndex(data, { ...expected, worldId: 'autre' }).status).toBe('incompatible');
    expect(loadBuildingObstacleIndex({ ...data, obstacles: [wall('a', 10, 0), wall('a', 11, 0)] }, expected).status).toBe('invalid');
    expect(loadBuildingObstacleIndex({ ...data, obstacles: [{ ...wall('b', 10, 0), tile: '1_1' }] }, expected).status).toBe('invalid');
    expect(loadBuildingObstacleIndex(data, expected).status).toBe('ready');
  });
});
