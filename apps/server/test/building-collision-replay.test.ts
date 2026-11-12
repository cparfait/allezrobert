import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, RouteTrack, type RouteData, type WorldMeta } from '@allezrobert/shared';
import { BUILDING_COLLISION_RADIUS_M, RouteBuildingCollision, insideObstaclePolygon, loadBuildingObstacleIndex, roadHalfM, type BuildingObstacleData, type RouteObstaclePose, type RouteObstacleResult } from '@allezrobert/physics';
import { RideSession } from '../../client/src/game/ride.ts';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';

const read = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(name: string) {
  const data = read<BuildingObstacleData>(new URL(`./fixtures/building-collision/${name}.json`, import.meta.url));
  const worldUrl = new URL(`../../client/public/worlds/${data.worldId}/`, import.meta.url);
  const world = read<WorldMeta>(new URL('world.json', worldUrl));
  const route = read<RouteData>(new URL(world.routes.find((r) => r.id === data.routeId)!.file, worldUrl));
  const loaded = loadBuildingObstacleIndex(data, { worldId: world.id, routeId: route.id, worldSha256: digest(world), routeSha256: digest(route) });
  if (loaded.status !== 'ready') throw new Error(`${name}: ${loaded.status}`);
  return { route, index: loaded.index, obstacles: data.obstacles };
}

const cases = [
  { map: 'chevreuse', start: 18524, lateral: 2.6, wall: '2491946994' },
  { map: 'donnemarie', start: 13466, lateral: -2.1, wall: '2202050071' },
  { map: 'donnemarie', start: 13694, lateral: 2.1, wall: '2202049929' },
];

/** Banc d'essai : rejoue une proposition des simulations existantes, puis résout avant de réutiliser la pose. */
function replay(c: typeof cases[number], hz: 60 | 10, corrected: boolean, speedMs: number, lateral = c.lateral) {
  const { route: original, index, obstacles } = fixture(c.map);
  // Banc du solveur seul (COLL-MURS-2) : largeur uniforme, pour garder le contact avec la façade.
  // Le couloir de la chaussée réelle est vérifié par collision-pilot-replay.test.ts (COLL-MURS-3d).
  const route = { ...original, roadWidths: undefined };
  const track = new RouteTrack(route);
  const wall = obstacles.find((o) => o.id.endsWith(c.wall))!;
  const solver = new RouteBuildingCollision(index);
  const out: RouteObstacleResult = { distM: 0, lateral: 0, speedMs: 0, hit: false };
  const dt = 1 / hz;
  const t0 = Date.UTC(2026, 10, 10);
  let pose: RouteObstaclePose = { distM: c.start, lateral, speedMs };
  let propose: (i: number) => RouteObstaclePose;
  let apply: () => void;

  if (hz === 60) {
    const ride = new RideSession({ track, startDistM: c.start, trainerDifficulty: 0,
      profile: { id: 'test', displayName: 'Test', massKg: 75, heightCm: 178, ftpWatts: 260, bike: DEFAULT_BIKE } });
    ride.lateral = lateral;
    ride.state.speedMs = speedMs;
    const steer = Math.sign(lateral);
    const input = { read: () => ({ watts: 190, cadence: 90, steer }), sendTrainer() {}, onShift() {}, status: () => [], dispose() {} };
    propose = () => {
      ride.update(dt, input, steer);
      return { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs };
    };
    apply = () => {
      ride.state.distM = out.distM;
      ride.state.speedMs = out.speedMs;
      ride.lateral = out.lateral;
    };
  } else {
    const sim = new RideSimulation(route, resolveRideOptions({ mode: 'free', aiRiders: 0 }, route.id), t0, { seed: 'coll-murs-2' });
    const rider = sim.addRider({ id: 'test', name: 'Test', kind: 'human', userId: 'test', riderMassKg: 75 }, t0)!;
    rider.state.distM = c.start;
    rider.state.speedMs = speedMs;
    rider.lateralM = rider.lateralTarget = lateral;
    propose = (i) => {
      const now = t0 + (i + 1) * 100;
      sim.setTelemetry(rider.id, { seq: i, t: now, watts: 190, cadence: 90, gear: 12, steer: lateral }, now);
      sim.step(now, dt);
      return { distM: rider.state.distM, lateral: rider.lateralM, speedMs: rider.state.speedMs };
    };
    apply = () => {
      rider.state.distM = out.distM;
      rider.state.speedMs = out.speedMs;
      rider.lateralM = out.lateral;
    };
  }

  let inside = 0;
  let firstContact: RouteObstaclePose | undefined;
  for (let i = 0; i < 3 * hz; i++) {
    const desired = propose(i);
    if (corrected) {
      solver.resolve(track, pose, desired, roadHalfM(route.roadWidthM), out);
      apply();
      pose = { distM: out.distM, lateral: out.lateral, speedMs: out.speedMs };
      if (out.hit && !firstContact) firstContact = pose;
    } else pose = desired;
    const p = track.positionAt(pose.distM, pose.lateral);
    if (insideObstaclePolygon(wall.polygon, p.x, p.z)) inside++;
  }
  return { inside, firstContact, final: pose };
}

describe('rejeu des traversées observées', () => {
  it.each(cases)('$map, bâtiment $wall', (c) => {
    for (const hz of [60, 10] as const) {
      const baseline = replay(c, hz, false, 10);
      const resolved = replay(c, hz, true, 10);
      expect(baseline.inside).toBeGreaterThan(0);
      expect(resolved.firstContact?.speedMs).toBeLessThan(10.1);
      expect(resolved.inside).toBe(0);
      const center = replay(c, hz, true, 10, 0);
      expect(center.firstContact).toBeUndefined();
      expect(center.final).toEqual(replay(c, hz, false, 10, 0).final);
      if (process.env.AR_COLLISION_BENCH) console.log(JSON.stringify({ map: c.map, hz, baseline: baseline.inside, resolved, center: center.final }));
    }
  });

  it('retrouve le même mur en solo et côté serveur, à 36 et 86,4 km/h', () => {
    const c = cases[0]!;
    for (const speed of [10, 24]) {
      const local = replay(c, 60, true, speed);
      const server = replay(c, 10, true, speed);
      expect(local.inside + server.inside).toBe(0);
      expect(Math.abs(local.firstContact!.distM - server.firstContact!.distM)).toBeLessThan(0.5);
      expect(local.firstContact!.speedMs).toBeLessThan(speed / 2);
      expect(server.firstContact!.speedMs).toBeLessThan(speed / 2);
    }
  });

  it('balaie aussi un déplacement de recalage qui aurait sauté toute l’emprise', () => {
    const { route, index } = fixture('chevreuse');
    const solve = new RouteBuildingCollision(index);
    const track = new RouteTrack({ ...route, roadWidths: undefined });
    const from = { distM: 18533, lateral: 2.6, speedMs: 10 };
    const to = { ...from, distM: 18543 };
    const out = { ...from, hit: false };
    solve.resolve(track, from, to, roadHalfM(route.roadWidthM), out);
    expect(out.hit).toBe(true);
    expect(out.lateral).toBeLessThan(from.lateral);
    expect(out.speedMs).toBeLessThan(from.speedMs);
  });

  it('laisse libre le sentier voisin du bâtiment de Chevreuse', () => {
    const { index } = fixture('chevreuse');
    // Deux segments du chemin OSM w1557724770 (tuile 9_-3).
    const a = { x: 9369.56, y: 156.59, z: -2042.23 };
    const b = { x: 9367.55, y: 156.66, z: -2039.48 };
    const c = { x: 9355.61, y: 156.88, z: -2038.85 };
    const hit = { fraction: 0, nx: 0, nz: 0 };
    expect(index.sweep(a, b, BUILDING_COLLISION_RADIUS_M, 1.85, hit)).toBe(false);
    expect(index.sweep(b, c, BUILDING_COLLISION_RADIUS_M, 1.85, hit)).toBe(false);

    const dB = Math.hypot(b.x - a.x, b.z - a.z);
    const lengthM = dB + Math.hypot(c.x - b.x, c.z - b.z);
    const track = new RouteTrack({
      id: 'w1557724770', name: 'Sentier', loop: false, lengthM, elevationGainM: 0, roadWidthM: 1.5,
      attribution: [], segments: [], points: [{ ...a, d: 0 }, { ...b, d: dB }, { ...c, d: lengthM }],
    });
    const solver = new RouteBuildingCollision(index);
    // Au coude, l'avant du vélo déborde de l'axe. Un décalage de 20 cm suffit pour emprunter le sentier.
    const from = { distM: 0, lateral: -0.2, speedMs: 3 };
    const to = { ...from, distM: lengthM };
    const out = { ...from, hit: false };
    solver.resolve(track, from, to, 0.75, out);
    expect(out).toEqual({ ...to, hit: false });
  });

  it.each(['chevreuse', 'donnemarie'])('laisse l’axe libre sur la boucle entière de %s', (name) => {
    const { route, index } = fixture(name);
    const track = new RouteTrack(route);
    const solve = new RouteBuildingCollision(index);
    const half = roadHalfM(route.roadWidthM);
    const from = { distM: 0, lateral: 0, speedMs: 24 };
    const to = { ...from };
    const out = { ...from, hit: false };
    while (from.distM < track.length) {
      to.distM = Math.min(track.length, from.distM + 2.4);
      solve.resolve(track, from, to, half, out);
      if (out.hit) throw new Error(`Obstacle sur l'axe au mètre ${from.distM}`);
      from.distM = to.distM;
    }
    expect(out.distM).toBe(track.length);
  });
});

it.skipIf(!process.env.AR_COLLISION_BENCH)('mesure le solveur seul sur un et vingt-quatre coureurs', () => {
  const { route, index } = fixture('chevreuse');
  const track = new RouteTrack(route);
  const solver = new RouteBuildingCollision(index);
  const half = roadHalfM(route.roadWidthM);
  const from: RouteObstaclePose = { distM: 0, lateral: 0, speedMs: 10 };
  const to = { ...from };
  const out = { ...from, hit: false };
  for (const [hz, riders] of [[60, 1], [10, 24]] as const) {
    const step = (i: number) => {
      for (let j = 0; j < riders; j++) {
        from.distM = 18532 + ((i + j * 7) % 150) / 20;
        from.lateral = (i + j) % 2 ? half : 0;
        to.distM = from.distM + 10 / hz;
        to.lateral = from.lateral;
        solver.resolve(track, from, to, half, out);
      }
    };
    for (let i = 0; i < 3000; i++) step(i);
    const times: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const t = performance.now();
      step(i);
      times.push(1000 * (performance.now() - t));
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ hz, riders, unit: 'µs/pas', median: times[5000], p95: times[9500] }));
    expect(times[9500]).toBeLessThan(10000);
  }
});
