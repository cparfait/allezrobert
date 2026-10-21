import { describe, expect, it } from 'vitest';
import {
  airDensity,
  createRiderState,
  effectiveMass,
  paramsFromBike,
  powerForSpeed,
  resistiveForces,
  steadyStateSpeed,
  stepRider,
  type RiderPhysicsParams,
} from '../src/index.ts';

const params = paramsFromBike(75); // vélo par défaut : 8,5 kg, CdA 0,32, Crr 0,0045
const kmh = (v: number) => v * 3.6;

describe('densité de l’air (ISA)', () => {
  it('vaut 1,225 au niveau de la mer à 15 °C', () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
  });
  it('diminue avec l’altitude et la température', () => {
    expect(airDensity(1000)).toBeCloseTo(1.112, 2);
    expect(airDensity(0, 30)).toBeLessThan(airDensity(0, 0));
  });
});

describe('vitesse d’équilibre (Martin 1998)', () => {
  it('250 W sur le plat ≈ 36–37 km/h', () => {
    const v = kmh(steadyStateSpeed(250, 0, params));
    expect(v).toBeGreaterThan(36);
    expect(v).toBeLessThan(37.2);
  });
  it('250 W à 6 % ≈ 15–16 km/h', () => {
    const v = kmh(steadyStateSpeed(250, 6, params));
    expect(v).toBeGreaterThan(15);
    expect(v).toBeLessThan(16.2);
  });
  it('powerForSpeed est l’inverse de steadyStateSpeed', () => {
    for (const g of [-5, 0, 3, 10]) {
      for (const w of [50, 200, 400]) {
        const v = steadyStateSpeed(w, g, params);
        expect(powerForSpeed(v, g, params)).toBeCloseTo(w, 3);
      }
    }
  });
  it('roue libre en descente : vitesse terminale positive', () => {
    const v = kmh(steadyStateSpeed(0, -6, params));
    expect(v).toBeGreaterThan(50);
    expect(v).toBeLessThan(75);
  });
  it('le vent de face et l’aspiration agissent dans le bon sens', () => {
    const base = steadyStateSpeed(250, 0, params);
    expect(steadyStateSpeed(250, 0, params, { airDensity: 1.225, windSpeedMs: 3 })).toBeLessThan(base);
    expect(steadyStateSpeed(250, 0, params, undefined, 0.6)).toBeGreaterThan(base);
  });
  it('les forces se décomposent', () => {
    const f = resistiveForces(10, 0, params);
    expect(f.gravity).toBeCloseTo(0, 6);
    expect(f.total).toBeCloseTo(f.aero + f.rolling + f.bearing, 9);
  });
});

function simulate(watts: number, grade: number, dt: number, seconds: number, p: RiderPhysicsParams = params, v0 = 0) {
  const s = createRiderState({ speedMs: v0 });
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepRider(s, { watts, gradePercent: grade, params: p }, dt);
  return s;
}

describe('intégration stepRider', () => {
  it('converge vers la vitesse d’équilibre à 60 Hz et 10 Hz', () => {
    for (const grade of [0, 6]) {
      const target = steadyStateSpeed(250, grade, params);
      for (const dt of [1 / 60, 1 / 10]) {
        const s = simulate(250, grade, dt, 240);
        expect(Math.abs(s.speedMs - target)).toBeLessThan(0.02);
      }
    }
  });
  it('60 Hz et 10 Hz donnent des distances voisines', () => {
    const a = simulate(300, 2, 1 / 60, 120);
    const b = simulate(300, 2, 1 / 10, 120);
    expect(Math.abs(a.distM - b.distM) / a.distM).toBeLessThan(0.01);
  });
  it('conserve l’énergie sans résistances : ½Mv² = η·W', () => {
    const p: RiderPhysicsParams = { ...params, cda: 0, crr: 0, bearingLoss: false };
    for (const dt of [1 / 60, 1 / 10]) {
      const s = simulate(200, 0, dt, 30, p);
      const ek = 0.5 * effectiveMass(p) * s.speedMs * s.speedMs;
      expect(ek).toBeCloseTo(s.workJ * p.drivetrainEfficiency, 6);
    }
  });
  it('bilan énergétique avec résistances : travail ≥ énergie cinétique + potentielle', () => {
    const s = simulate(250, 3, 1 / 60, 60);
    const ek = 0.5 * effectiveMass(params) * s.speedMs ** 2;
    const ep = params.massKg * 9.80665 * s.distM * Math.sin(Math.atan(0.03));
    expect(s.workJ * params.drivetrainEfficiency).toBeGreaterThan(ek + ep);
  });
  it('roue libre : décélère sans jamais passer sous 0', () => {
    const s = createRiderState({ speedMs: 10 });
    let prev = s.speedMs;
    for (let i = 0; i < 600; i++) {
      stepRider(s, { watts: 0, gradePercent: 0, params }, 1 / 10);
      expect(s.speedMs).toBeLessThanOrEqual(prev);
      expect(s.speedMs).toBeGreaterThanOrEqual(0);
      prev = s.speedMs;
    }
    expect(s.speedMs).toBeLessThan(4);
  });
  it('en côte sans pédaler : s’arrête et ne recule pas', () => {
    const s = simulate(0, 8, 1 / 10, 60, params, 5);
    expect(s.speedMs).toBe(0);
    const d = s.distM;
    stepRider(s, { watts: 0, gradePercent: 8, params }, 1 / 10);
    expect(s.distM).toBe(d);
  });
  it('à l’arrêt sur un faux plat descendant, ne démarre pas tout seul', () => {
    const s = simulate(0, -0.2, 1 / 10, 10);
    expect(s.speedMs).toBe(0);
  });
  it('freine', () => {
    const a = createRiderState({ speedMs: 12 });
    const b = createRiderState({ speedMs: 12 });
    for (let i = 0; i < 20; i++) {
      stepRider(a, { watts: 0, gradePercent: 0, params }, 0.1);
      stepRider(b, { watts: 0, gradePercent: 0, params, brake: 1 }, 0.1);
    }
    expect(b.speedMs).toBeLessThan(a.speedMs - 8);
  });
  it('reste stable avec de très grands pas', () => {
    const s = simulate(1000, -10, 1, 120);
    expect(Number.isFinite(s.speedMs)).toBe(true);
    expect(s.speedMs).toBeLessThan(40);
  });
});
