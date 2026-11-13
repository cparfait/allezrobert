import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, RouteTrack, type RouteData } from '@allezrobert/shared';
import { BuildingObstacleIndex, COLLISION_MANIFEST_PATH, COLLISION_PILOT_ROUTE, RouteBuildingCollision, corridorHalfM, createPilotBuildingCollision, createRiderState, insideObstaclePolygon, roadHalfM, type BuildingObstacleData, type CollisionManifest, type RouteObstaclePose } from '@allezrobert/physics';
import { RideSession } from '../../client/src/game/ride.ts';
import { CollisionPoseFollower, CollisionPrediction } from '../../client/src/net/collision-follow.ts';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const route = read<RouteData>(`../../client/public/worlds/chevreuse/routes/${COLLISION_PILOT_ROUTE}.json`);
const { data } = read<CollisionManifest>(`../../client/public${COLLISION_MANIFEST_PATH}`);
const wall = data.obstacles.find((o) => o.id.endsWith('2491946994'))!;
const track = new RouteTrack(route);
const t0 = Date.UTC(2026, 10, 10);
const profile = { id: 'test', displayName: 'Test', massKg: 75, heightCm: 178, ftpWatts: 260, bike: DEFAULT_BIKE };
const roundCm = (n: number) => Math.round(n * 100) / 100;
const init = (speedMs: number, lateral: number): RouteObstaclePose => ({ distM: 18524, lateral, speedMs });
const solver = () => createPilotBuildingCollision(data.obstacles);

function local(start: RouteObstaclePose, collision?: RouteBuildingCollision) {
  const ride = new RideSession({ track, profile, startDistM: start.distM, trainerDifficulty: 0 });
  ride.lateral = start.lateral;
  ride.state.speedMs = start.speedMs;
  if (collision) ride.enableBuildingCollisions(collision);
  return ride;
}

function authority(start: RouteObstaclePose, collision?: RouteBuildingCollision) {
  const sim = new RideSimulation(route, resolveRideOptions({ mode: 'free', aiRiders: 0 }, route.id), t0, { seed: 'coll-murs-3b', collision });
  const rider = sim.addRider({ id: 'test', name: 'Test', kind: 'human', userId: 'test', riderMassKg: 75 }, t0)!;
  rider.state.distM = start.distM;
  rider.state.speedMs = start.speedMs;
  rider.lateralM = rider.lateralTarget = start.lateral;
  return { sim, rider };
}

const input = (steer: number) => ({ read: () => ({ watts: 190, cadence: 90, steer }), sendTrainer() {}, onShift() {}, status: () => [], dispose() {} });
function trace(hz: 60 | 10, active: boolean, speed: number, lateral = 2.6) {
  const guard = solver();
  const start = init(speed, lateral);
  const ride = hz === 60 ? local(start, active ? guard : undefined) : undefined;
  const server = hz === 10 ? authority(start, active ? guard : undefined) : undefined;
  let inside = 0;
  let offRoad = 0;
  let unsafe = 0;
  let crossedBetweenFrames = 0;
  let pose = start;
  let minSpeed = speed;
  for (let i = 1; i <= hz * 3; i++) {
    const prev = pose;
    if (ride) {
      ride.update(1 / hz, input(Math.sign(lateral)), Math.sign(lateral));
      pose = { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs };
    } else if (server) {
      const { sim, rider } = server;
      const now = t0 + i * 100;
      sim.setTelemetry(rider.id, { seq: i, t: now, watts: 190, cadence: 90, gear: 12, steer: lateral }, now);
      sim.step(now, 1 / hz);
      const row = sim.rows()[0]!;
      pose = { distM: row.lap * track.length + row.distM, lateral: row.lateralM, speedMs: row.speedMs };
      if (active) expect(guard.isClear(track, roundCm(pose.distM), roundCm(pose.lateral))).toBe(true);
    }
    const p = track.positionAt(pose.distM, pose.lateral);
    inside += Number(insideObstaclePolygon(wall.polygon, p.x, p.z));
    unsafe += Number(!guard.isClear(track, pose.distM, pose.lateral));
    crossedBetweenFrames += Number(!guard.pathIsClear(track, prev, pose));
    offRoad += Number(active && Math.abs(pose.lateral) > corridorHalfM(track.widthAt(pose.distM)) + 0.01);
    minSpeed = Math.min(minSpeed, pose.speedMs);
  }
  return { pose, inside, unsafe, crossedBetweenFrames, offRoad, minSpeed };
}

describe('pilote intégré dans RideSession et RideSimulation', () => {
  // COLL-MURS-3d : le coureur reste sur la chaussée (rue de 2,5 m ici) et contourne la façade sans s'arrêter.
  it.each([60, 10] as const)('contourne la façade historique sans quitter la chaussée à %d Hz', (hz) => {
    const before = trace(hz, false, 10);
    const after = trace(hz, true, 10);
    // Hors pilote aussi, la largeur réelle de la rue (2,5 m) tient désormais le coureur loin de cette façade.
    expect(before.inside).toBe(0);
    expect(after.inside + after.unsafe + after.crossedBetweenFrames + after.offRoad).toBe(0);
    expect(after.minSpeed).toBeGreaterThan(8);
    expect(after.pose.distM).toBeGreaterThan(18545);
    console.log(JSON.stringify({ hz, before, after }));
  });

  it.each([60, 10] as const)('contourne à 86,4 km/h et laisse la voie centrale libre à %d Hz', (hz) => {
    const after = trace(hz, true, 24);
    expect(after.inside + after.unsafe + after.crossedBetweenFrames + after.offRoad).toBe(0);
    expect(after.minSpeed).toBeGreaterThan(20);
    expect(trace(hz, true, 24, 0).pose).toEqual(trace(hz, false, 24, 0).pose);
  });

  it('garde le coureur sur la chaussée et hors des façades sur toute la boucle, collé à chaque bord', () => {
    for (const edge of [3, -3]) {
      const guard = solver();
      const { sim, rider } = authority({ distM: 100, lateral: 0, speedMs: 10 }, guard);
      let offRoad = 0, unsafe = 0, maxLateralStep = 0, minSpeed = Infinity;
      let prevLateral = rider.lateralM;
      for (let i = 1; rider.state.distM < track.length + 100; i++) {
        const now = t0 + i * 100;
        sim.setTelemetry(rider.id, { seq: i, t: now, watts: 220, cadence: 90, gear: 12, steer: edge }, now);
        sim.step(now, 0.1);
        offRoad += Number(Math.abs(rider.lateralM) > corridorHalfM(track.widthAt(rider.state.distM)) + 1e-6);
        unsafe += Number(!guard.isClear(track, rider.state.distM, rider.lateralM));
        maxLateralStep = Math.max(maxLateralStep, Math.abs(rider.lateralM - prevLateral));
        if (i > 20) minSpeed = Math.min(minSpeed, rider.state.speedMs);
        prevLateral = rider.lateralM;
      }
      expect({ edge, offRoad, unsafe }).toEqual({ edge, offRoad: 0, unsafe: 0 });
      // 1,5 m/s, plus le resserrement de l'anticipation quand la vitesse augmente.
      expect(maxLateralStep).toBeLessThanOrEqual(0.16);
      expect(minSpeed).toBeGreaterThan(2);
    }
  });

  it('converge sous 150 ms de latence et 100 ms sans nouvel instantané', () => {
    const guard = solver();
    const prediction = new CollisionPrediction(track, guard);
    const start = init(10, 2.6);
    const ride = local(start, guard);
    const { sim, rider } = authority(start, guard);
    const frames: Array<{ tick: number; pose: RouteObstaclePose }> = [];
    const display = new CollisionPoseFollower(track, guard);
    const shown = { ...start };
    const predicted = { ...start };
    let latest: typeof frames[number] | undefined;
    let maxError = 0;
    for (let i = 1; i <= 360; i++) {
      if (i % 6 === 0) {
        const now = t0 + i / 60 * 1000;
        sim.setTelemetry(rider.id, { seq: i, t: now, watts: 190, cadence: 90, gear: 12, steer: 2.6 }, now);
        sim.step(now, 0.1);
        const row = sim.rows()[0]!;
        if (i !== 78) frames.push({ tick: i, pose: { distM: roundCm(row.distM), lateral: roundCm(row.lateralM), speedMs: roundCm(row.speedMs) } });
      }
      if (frames[0] && i - frames[0].tick >= 9) latest = frames.shift();
      const before = { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs };
      ride.update(1 / 60, input(1), 1);
      if (!latest) continue;
      const from = { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs };
      prediction.reconcile(from, latest.pose, (i - latest.tick) / 60, 1 / 60, predicted);
      ride.state.distM = predicted.distM;
      ride.lateral = predicted.lateral;
      ride.state.speedMs = predicted.speedMs;
      const prevShown = { ...shown };
      const remoteGoal = { ...latest.pose, distM: latest.pose.distM + 0.25 * latest.pose.speedMs };
      display.follow(shown, remoteGoal, 1 / 60, false, shown);
      expect(guard.pathIsClear(track, before, predicted)).toBe(true);
      expect(guard.pathIsClear(track, prevShown, shown)).toBe(true);
      maxError = Math.max(maxError, Math.abs(predicted.distM - rider.state.distM));
    }
    const error = Math.hypot(predicted.distM - rider.state.distM, predicted.lateral - rider.lateralM);
    expect(error).toBeLessThan(0.15);
    console.log(JSON.stringify({ latencyMs: 150, missingSnapshots: 1, maxError, finalError: error }));
  });

  it('résorbe hors jeu l’écart enregistré à Donnemarie sans couper le coin', () => {
    const fixture = read<BuildingObstacleData>('./fixtures/building-collision/donnemarie.json');
    const ref = new RouteTrack(read<RouteData>('../../client/public/worlds/idf-donnemarie-dontilly/routes/boucle-20-km.json'));
    const guard = createPilotBuildingCollision(fixture.obstacles);
    const follow = new CollisionPrediction(ref, guard);
    const from = { distM: 13466.810473392256, lateral: -2.0489943157849715, speedMs: 0 };
    const target = { distM: 13470.016801790665, lateral: -1.8508841190524488, speedMs: 0 };
    // Le rejeu 3a contrôlait le centre. Replacer le volume au dégagement avant le premier affichage.
    const priorLaterals = [from.lateral, target.lateral];
    for (const pose of [from, target]) {
      while (pose.lateral < 0 && !guard.isClear(ref, pose.distM, pose.lateral)) pose.lateral = Math.min(0, pose.lateral + 0.01);
    }
    const out = { ...from };
    for (let i = 0; i < 300; i++) {
      const prev = { ...out };
      follow.reconcile(out, target, 0.15, 1 / 60, out);
      expect(guard.pathIsClear(ref, prev, out)).toBe(true);
    }
    const error = Math.abs(out.distM - target.distM);
    expect(error).toBeLessThan(0.04);
    console.log(JSON.stringify({ recordedError: target.distM - from.distM, initialLateralClearance: [from.lateral - priorLaterals[0]!, target.lateral - priorLaterals[1]!], finalError: error, lateralError: Math.abs(out.lateral - target.lateral) }));
  });

  it('hors pilote aussi, garde chaque coureur sur la chaussée réelle de la boucle, collé à chaque bord', () => {
    for (const edge of [3, -3]) {
      const sim = new RideSimulation(route, resolveRideOptions({ mode: 'group', aiRiders: 0 }, route.id), t0, { seed: 'coll-murs-3e' });
      const rider = sim.addRider({ id: 'test', name: 'Test', kind: 'human', userId: 'test', riderMassKg: 75 }, t0)!;
      sim.addAiRiders(4, t0, 260);
      rider.state.distM = 100;
      let offRoad = 0, maxStep = 0, prev = rider.lateralM;
      for (let i = 1; rider.state.distM < track.length + 100; i++) {
        const now = t0 + i * 100;
        sim.setTelemetry(rider.id, { seq: i, t: now, watts: 220, cadence: 90, gear: 12, steer: edge }, now);
        sim.step(now, 0.1);
        for (const r of sim.riders) offRoad += Number(Math.abs(r.lateralM) > corridorHalfM(track.widthAt(r.state.distM)) + 1e-6);
        maxStep = Math.max(maxStep, Math.abs(rider.lateralM - prev));
        prev = rider.lateralM;
      }
      expect({ edge, offRoad }).toEqual({ edge, offRoad: 0 });
      expect(maxStep).toBeLessThanOrEqual(0.16);
    }
    // Solo : même règle pour le joueur, sans pilote.
    const ride = new RideSession({ track, profile, startDistM: 100, trainerDifficulty: 0 });
    let off = 0;
    while (ride.state.distM < 6000) {
      ride.update(1 / 60, input(1), 1);
      off += Number(Math.abs(ride.lateral) > corridorHalfM(track.widthAt(ride.state.distM)) + 1e-6);
    }
    expect(off).toBe(0);
  });

  it('recale d’un coup un grand écart vers une pose libre (arrivée en cours de sortie)', () => {
    const guard = solver();
    const follow = new CollisionPoseFollower(track, guard);
    const pose = { distM: 18462, lateral: 0.5, speedMs: 7 };
    const goal = { distM: 18516, lateral: 0.5, speedMs: 7 };
    expect(guard.isClear(track, goal.distM, goal.lateral)).toBe(true);
    follow.follow(pose, goal, 1 / 60, true, pose);
    expect(pose).toEqual(goal);
    // Sous le seuil, rattrapage progressif borné.
    const near = { distM: 18500, lateral: 0.5, speedMs: 7 };
    follow.follow(near, goal, 1 / 60, true, near);
    expect(near.distM).toBeLessThan(18501);
  });

  it('contourne un angle par la voie centrale si la correction directe traverse un mur', () => {
    const straight = new RouteTrack({ ...route, roadWidths: undefined, roadWidthM: 6, loop: false, lengthM: 30, points: [{ d: 0, x: 0, y: 0, z: 0 }, { d: 30, x: 30, y: 0, z: 0 }] });
    const guard = createPilotBuildingCollision([{
      id: 'coin', tile: '0_0', polygon: [10, 1, 12, 1, 12, 3, 10, 3], baseM: 0, topM: 4, solid: true,
    }]);
    const follow = new CollisionPoseFollower(straight, guard);
    const pose = { distM: 8.5, lateral: 2, speedMs: 0 };
    const goal = { ...pose, distM: 14.1 };
    expect(guard.pathIsClear(straight, pose, goal)).toBe(false);
    let closestToCenter = pose.lateral;
    for (let i = 0; i < 360; i++) {
      const prev = { ...pose };
      follow.follow(prev, goal, 1 / 60, true, pose);
      expect(guard.pathIsClear(straight, prev, pose)).toBe(true);
      closestToCenter = Math.min(closestToCenter, pose.lateral);
    }
    expect(closestToCenter).toBeLessThan(0.02);
    expect(pose.distM).toBeCloseTo(goal.distM, 3);
    expect(pose.lateral).toBeCloseTo(goal.lateral, 3);
  });
});

it.skipIf(!process.env.AR_COLLISION_BENCH)('compare le coût du même déplacement dans le prototype et le pilote', () => {
  const prototype = new RouteBuildingCollision(new BuildingObstacleIndex(data.obstacles));
  const integrated = solver();
  const prediction = new CollisionPrediction(track, integrated);
  const from = init(10, 0), to = { ...from }, result = { ...from, hit: false };
  const state = createRiderState();
  const half = roadHalfM(route.roadWidthM);
  for (const [hz, riders] of [[60, 1], [10, 24]] as const) {
    const stages = ['prototype', 'intégré', ...(riders === 1 ? ['intégré + recalage'] : [])];
    for (const stage of stages) {
      const step = (i: number) => {
        for (let j = 0; j < riders; j++) {
          from.distM = 18532 + ((i + j * 7) % 150) / 20;
          from.lateral = (i + j) % 2 ? half : 0;
          to.distM = from.distM + 10 / hz;
          to.lateral = from.lateral;
          if (stage === 'prototype') prototype.resolve(track, from, to, half, result);
          else {
            state.distM = to.distM;
            state.speedMs = to.speedMs;
            state.accelMs2 = 0;
            const lateral = integrated.apply(track, from.distM, from.lateral, state, to.lateral, half, 1 / hz);
            if (stage === 'intégré + recalage') prediction.reconcile({ distM: state.distM, lateral, speedMs: state.speedMs }, from, 0.15, 1 / hz, result);
          }
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
      console.log(JSON.stringify({ stage, hz, riders, unit: 'µs/pas', median: times[5000], p95: times[9500] }));
    }
  }
});
