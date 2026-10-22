import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, bikeSetupFor } from '@allezrobert/shared';
import {
  FOOT_DOWN_SPEED_MS,
  PowerSmoother,
  airDensity,
  bodyCdaFactor,
  createRiderState,
  paramsFromBike,
  poseCdaFactor,
  riderWind,
  steadyStateSpeed,
  stepRider,
  surfaceClass,
  surfaceCrr,
  vehicleDraftReduction,
  wetCrrFactor,
  windHeightFactor,
} from '../src/index.ts';

const kmh = (v: number) => v * 3.6;
// Coureur de 77 kg sur un vélo de 9 kg, air à 150 m d'altitude.
const params = paramsFromBike(77, { ...DEFAULT_BIKE, massKg: 9 });
const env = { airDensity: airDensity(150, 14), windSpeedMs: 0 };

describe('ordres de grandeur à 250 W (77 kg + 9 kg)', () => {
  it('plat sans vent ≈ 36–37 km/h', () => {
    expect(kmh(steadyStateSpeed(250, 0, params, env))).toBeCloseTo(36.6, 0);
  });
  it('dans la roue (−32 %) ≈ 41 km/h', () => {
    expect(kmh(steadyStateSpeed(250, 0, params, env, 0.68))).toBeCloseTo(41.3, 0);
  });
  it('chemin de terre ≈ 33 km/h', () => {
    expect(kmh(steadyStateSpeed(250, 0, { ...params, crr: surfaceCrr('dirt', params.crr) }, env))).toBeCloseTo(33.1, 0);
  });
  it('vent de face météo de 20 km/h ≈ 29–30 km/h', () => {
    expect(kmh(steadyStateSpeed(250, 0, params, { ...env, windSpeedMs: riderWind(20 / 3.6) }))).toBeCloseTo(29.5, 0);
  });
  it('côte à 7 % ≈ 13–14 km/h', () => {
    expect(kmh(steadyStateSpeed(250, 7, params, env))).toBeCloseTo(13.4, 0);
  });
});

describe('revêtement et pluie', () => {
  it('classe les tags OSM', () => {
    expect(surfaceClass('asphalt')).toBe('paved');
    expect(surfaceClass(undefined)).toBe('paved');
    expect(surfaceClass('fine_gravel')).toBe('compacted');
    expect(surfaceClass('sett')).toBe('cobbles');
    expect(surfaceClass('ground')).toBe('dirt');
  });
  it('enrobé < stabilisé < gravier < terre', () => {
    const c = (s: string) => surfaceCrr(s, 0.0045);
    expect(c('asphalt')).toBe(0.0045);
    expect(c('asphalt')).toBeLessThan(c('compacted'));
    expect(c('compacted')).toBeLessThan(c('gravel'));
    expect(c('gravel')).toBeLessThan(c('dirt'));
  });
  it('les pneus gravel roulent mieux hors enrobé', () => {
    expect(surfaceCrr('dirt', 0.0052, 'gravel')).toBeLessThan(surfaceCrr('dirt', 0.0045, 'road'));
    expect(surfaceCrr('asphalt', 0.0052, 'gravel')).toBeGreaterThan(surfaceCrr('asphalt', 0.0045, 'road'));
  });
  it('chaussée mouillée : +12 % au plus', () => {
    expect(wetCrrFactor(0)).toBe(1);
    expect(wetCrrFactor(1)).toBeCloseTo(1.12, 6);
    expect(wetCrrFactor(3)).toBeCloseTo(1.12, 6);
  });
});

describe('air', () => {
  it('le vent à 1 m vaut 60 % du vent à 10 m en campagne', () => {
    expect(windHeightFactor()).toBeCloseTo(0.6, 2);
    expect(windHeightFactor(10)).toBeCloseTo(1, 6);
  });
  it('l’abri des maisons coupe le vent', () => {
    expect(Math.abs(riderWind(5, 1))).toBeLessThan(Math.abs(riderWind(5, 0)) / 2);
    expect(riderWind(-5, 0)).toBeLessThan(0);
  });
  it('morphologie : 1 pour le coureur de référence, plus grand = plus de traînée', () => {
    expect(bodyCdaFactor(178, 75)).toBeCloseTo(1, 6);
    expect(bodyCdaFactor(192, 90)).toBeGreaterThan(1.05);
    expect(bodyCdaFactor(160, 52)).toBeLessThan(0.92);
  });
  it('posture : danseuse plus freinante, descente groupée moins', () => {
    expect(poseCdaFactor('standing', 8, 4)).toBeGreaterThan(1);
    expect(poseCdaFactor('coasting', -6, 15)).toBeLessThan(1);
    expect(poseCdaFactor('coasting', 0, 8)).toBe(1);
  });
  it('aspiration derrière un tracteur : jusqu’à −45 %, nulle à 25 m ou décalé', () => {
    expect(vehicleDraftReduction('tractor', 0.5, 0)).toBeCloseTo(0.45, 6);
    expect(vehicleDraftReduction('tractor', 25, 0)).toBe(0);
    expect(vehicleDraftReduction('tractor', 3, 3)).toBe(0);
    expect(vehicleDraftReduction('car', 2, 0)).toBeLessThan(vehicleDraftReduction('van', 2, 0));
  });
});

describe('équipement', () => {
  it('sans équipement : le vélo par défaut', () => {
    expect(bikeSetupFor({})).toEqual(DEFAULT_BIKE);
  });
  it('vélo carbone, roue lenticulaire et casque aéro : plus léger et −7 % de traînée', () => {
    const b = bikeSetupFor({ bike: 'bike-carbone', wheels: 'wheels-lenticulaire', helmet: 'helmet-aero' });
    expect(b.massKg).toBeCloseTo(DEFAULT_BIKE.massKg - 1.0, 6);
    expect(b.cda / DEFAULT_BIKE.cda).toBeCloseTo(0.98 * 0.96 * 0.985, 6);
    expect(b.wheelInertia).toBe(0.17);
  });
  it('gravel : pneus crantés', () => {
    const b = bikeSetupFor({ bike: 'bike-gravel' });
    expect(b.tyre).toBe('gravel');
    expect(b.crr).toBeGreaterThan(DEFAULT_BIKE.crr);
  });
});

describe('dynamique', () => {
  it('le lissage de puissance suit un échelon en ≈ 0,5 s', () => {
    const s = new PowerSmoother(0.5);
    s.update(0, 0.1);
    let w = 0;
    for (let t = 0; t < 0.5 - 1e-9; t += 0.05) w = s.update(400, 0.05);
    expect(w).toBeGreaterThan(400 * 0.6);
    expect(w).toBeLessThan(400 * 0.66);
    for (let t = 0; t < 5; t += 0.05) w = s.update(400, 0.05);
    expect(w).toBeCloseTo(400, 1);
  });
  it('roue libre sur le plat : le vélo ralentit', () => {
    const st = createRiderState({ speedMs: 30 / 3.6 });
    for (let i = 0; i < 600; i++) stepRider(st, { watts: 0, gradePercent: 0, params }, 1 / 60);
    expect(kmh(st.speedMs)).toBeLessThan(25);
    expect(kmh(st.speedMs)).toBeGreaterThan(10);
  });
  it('pied à terre sous 4 km/h sans pédaler', () => {
    const st = createRiderState({ speedMs: 6 / 3.6 });
    let t = 0;
    while (st.speedMs > 0 && t < 120) {
      stepRider(st, { watts: 0, gradePercent: 2, params, footDownBelowMs: FOOT_DOWN_SPEED_MS }, 1 / 60);
      t += 1 / 60;
    }
    expect(st.speedMs).toBe(0);
    expect(t).toBeLessThan(10);
    // On repart en pédalant.
    for (let i = 0; i < 60; i++) stepRider(st, { watts: 200, gradePercent: 2, params, footDownBelowMs: FOOT_DOWN_SPEED_MS }, 1 / 60);
    expect(st.speedMs).toBeGreaterThan(1);
  });
  it('inertie réduite : même vitesse d’équilibre, relance plus vive', () => {
    const run = (inertiaFactor: number, seconds: number) => {
      const st = createRiderState();
      for (let i = 0; i < seconds * 60; i++) stepRider(st, { watts: 300, gradePercent: 0, params: { ...params, inertiaFactor } }, 1 / 60);
      return st.speedMs;
    };
    expect(run(0.6, 3)).toBeGreaterThan(run(1, 3));
    expect(run(0.6, 200)).toBeCloseTo(run(1, 200), 2);
  });
  it('le Crr du moment remplace celui du vélo', () => {
    const a = createRiderState({ speedMs: 9 });
    const b = createRiderState({ speedMs: 9 });
    for (let i = 0; i < 600; i++) {
      stepRider(a, { watts: 200, gradePercent: 0, params }, 1 / 60);
      stepRider(b, { watts: 200, gradePercent: 0, params, crr: 0.012 }, 1 / 60);
    }
    expect(b.speedMs).toBeLessThan(a.speedMs);
  });
});
