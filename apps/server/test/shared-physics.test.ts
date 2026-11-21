import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, DEFAULT_LOOK, RouteTrack, weatherAt, weatherElapsedS, type RideWeather, type RouteData } from '@allezrobert/shared';
import { FOOT_DOWN_SPEED_MS, createRiderState, headwindAlong, paramsFromBike, poseCdaFactor, rideParams, rideStepConditions, stepRider, type Environment } from '@allezrobert/physics';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

/**
 * Le client (prédiction locale en salle, `Ride.serverPhysics`) et le serveur construisent les conditions de
 * chaque pas avec les mêmes fonctions de @allezrobert/physics. Ce test rejoue côté « client » chaque pas du
 * serveur et exige la même vitesse et la même distance, au bit près.
 */
const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);
const WEATHER: RideWeather = { hour: 10, clouds: 0.6, rain: 0.6, fog: 0, windMs: 6, evolving: false, seed: 42, windFromDeg: 270, at: T0 };

function raised(route: RouteData, byM: number): RouteData {
  return { ...route, id: `${route.id}-haut`, points: route.points.map((p) => ({ ...p, y: p.y + byM })) };
}

function compare(route: RouteData, startM: number, weather: RideWeather | undefined, heightCm: number | undefined, massKg: number): { serverKmh: number; steps: number } {
  const sim = new RideSimulation(route, resolveRideOptions({ mode: 'group', ...(weather ? { weather } : {}) }, route.id), T0, { seed: 'phys' });
  const r = sim.addRider({ id: 'me', name: 'Moi', kind: 'human', userId: 'u1', riderMassKg: massKg, avatar: { ...DEFAULT_LOOK, ...(heightCm ? { heightCm } : {}) } }, T0)!;
  r.state.distM = startM;
  r.state.speedMs = 6;
  // Côté client : mêmes paramètres (vélo du serveur, morphologie) et même état de départ.
  const track = new RouteTrack(route);
  const params = rideParams(paramsFromBike(massKg, DEFAULT_BIKE), heightCm, massKg);
  const env: Environment = { airDensity: 1.2, windSpeedMs: 0 };
  const mirror = createRiderState({ distM: startM });
  mirror.speedMs = 6;
  const sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  let now = T0;
  let steps = 0;
  for (let i = 0; i < 900; i++) {
    now += 100;
    sim.setTelemetry('me', { seq: i, t: 0, watts: 230, cadence: 88, gear: 12, steer: 0 }, now);
    const pose = r.pose.pose;
    sim.step(now, 0.1);
    const s = track.sample(track.wrap(mirror.distM), sample);
    const wx = weather ? weatherAt(weather, weatherElapsedS(weather, (now - T0) / 1000, now)) : null;
    const crr = rideStepConditions(env, params, {
      altitudeM: s.y,
      headwindMs: wx ? headwindAlong(wx.windMs, wx.windFrom, s.dirX, s.dirZ) : 0,
      rain: wx ? wx.rain : 0,
      surface: track.surfaceAt(mirror.distM),
      standardAtmosphere: true,
    });
    stepRider(mirror, { watts: r.watts, gradePercent: s.grade, params, env, cdaFactor: (1 - r.draft) * poseCdaFactor(pose, s.grade, mirror.speedMs), crr, footDownBelowMs: FOOT_DOWN_SPEED_MS }, 0.1);
    expect(Object.is(mirror.speedMs, r.state.speedMs), `vitesse au pas ${i} : ${mirror.speedMs} / ${r.state.speedMs}`).toBe(true);
    expect(Object.is(mirror.distM, r.state.distM), `distance au pas ${i}`).toBe(true);
    steps++;
  }
  return { serverKmh: r.state.speedMs * 3.6, steps };
}

describe('physique commune client / serveur', () => {
  const route = proceduralLoop();

  it('à plat, sans météo ni taille connue (ancien client) : même vitesse', () => {
    expect(compare(route, 200, undefined, undefined, 75).steps).toBe(900);
  });

  it('à plat, avec vent, pluie et morphologie : même vitesse', () => {
    expect(compare(route, 200, WEATHER, 165, 58).steps).toBe(900);
  });

  it('en côte (montée à 5 % de la boucle) : même vitesse', () => {
    expect(compare(route, 3050, WEATHER, 192, 88).steps).toBe(900);
  });

  it('en altitude (boucle relevée de 1 800 m) : même vitesse', () => {
    expect(compare(raised(route, 1800), 200, WEATHER, 178, 75).steps).toBe(900);
  });

  it('le serveur applique la météo de la salle et la morphologie', () => {
    const calm = compare(route, 200, undefined, undefined, 75).serverKmh;
    const small = compare(route, 200, undefined, 160, 75).serverKmh;
    const tall = compare(route, 200, undefined, 195, 75).serverKmh;
    // Même puissance, même masse : le petit gabarit va plus vite que le grand.
    expect(small).toBeGreaterThan(tall);
    // Chaussée mouillée, sans vent : plus de résistance au roulement que dans la salle sans météo.
    const wet = compare(route, 200, { ...WEATHER, windMs: 0 }, undefined, 75).serverKmh;
    expect(wet).toBeLessThan(calm);
    console.log(`230 W, 75 kg, 90 s : sans météo ${calm.toFixed(2)} km/h ; 160 cm ${small.toFixed(2)} ; 195 cm ${tall.toFixed(2)} ; pluie 0,6 ${wet.toFixed(2)}`);
  });
});
