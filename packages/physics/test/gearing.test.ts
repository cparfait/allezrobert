import { describe, expect, it } from 'vitest';
import { DEFAULT_GEARING } from '@allezrobert/shared';
import {
  bestGearForCadence,
  buildGearTable,
  cadenceForSpeed,
  computeTrainerGrade,
  difficultyScaledGrade,
  neutralGearIndex,
  paramsFromBike,
  PoseController,
  PowerMatch,
  realRatio,
  shiftGear,
  speedForCadence,
  steadyStateSpeed,
  TrainerGradeSmoother,
} from '../src/index.ts';

const params = paramsFromBike(75);
const table = buildGearTable(DEFAULT_GEARING);
const R = DEFAULT_GEARING.referenceRatio;

describe('table des rapports', () => {
  it('24 rapports triés par braquet croissant', () => {
    expect(table).toHaveLength(24);
    for (let i = 1; i < table.length; i++) expect(table[i]!.ratio).toBeGreaterThanOrEqual(table[i - 1]!.ratio);
    expect(table[0]!.ratio).toBeCloseTo(1, 6); // 34×34
    expect(table[23]!.ratio).toBeCloseTo(50 / 11, 6);
    table.forEach((g, i) => expect(g.index).toBe(i));
  });
  it('rapport neutre = 34×14, passages bornés', () => {
    const n = neutralGearIndex();
    expect(table[n]!.ratio).toBeCloseTo(34 / 14, 6);
    expect(shiftGear(0, -1, table)).toBe(0);
    expect(shiftGear(23, 1, table)).toBe(23);
    expect(shiftGear(5, 2, table)).toBe(7);
    expect(realRatio({ kind: 'cog', chainring: 34 })).toBeCloseTo(R, 9);
    expect(realRatio({ kind: 'cassette', chainring: 50, cog: 17 })).toBeCloseTo(50 / 17, 9);
  });
  it('cadence ↔ vitesse', () => {
    const v = speedForCadence(90, 50 / 17, 2.105);
    expect(v * 3.6).toBeCloseTo(33.4, 0);
    expect(cadenceForSpeed(v, 50 / 17, 2.105)).toBeCloseTo(90, 9);
    const g = bestGearForCadence(v, 90, table, 2.105);
    expect(table[g]!.ratio).toBeCloseTo(50 / 17, 1);
  });
});

describe('pente envoyée au trainer', () => {
  it('rapport de référence, difficulté 100 %, modèle identique : pente du jeu', () => {
    for (const grade of [-4, 0, 3, 8]) {
      const v = steadyStateSpeed(250, grade, params);
      const g = computeTrainerGrade({ gradePercent: grade, speedMs: v, gearRatio: R, referenceRatio: R, params, trainerDifficulty: 1, descentFactor: 1 });
      expect(g).toBeCloseTo(grade, 1);
    }
  });
  it('monotone : rapport plus dur ⇒ plus de résistance à vitesse égale', () => {
    for (const grade of [-3, 0, 6]) {
      let prev = -Infinity;
      for (const gear of table) {
        const g = computeTrainerGrade({ gradePercent: grade, speedMs: 8, gearRatio: gear.ratio, referenceRatio: R, params, minGradePercent: -40, maxGradePercent: 40 });
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
    }
  });
  it('difficulté : montées × d, descentes × d/2, bornes FTMS', () => {
    expect(difficultyScaledGrade(10, 0.5)).toBe(5);
    expect(difficultyScaledGrade(-10, 0.5)).toBe(-2.5);
    expect(difficultyScaledGrade(10, 0)).toBe(0);
    const hi = computeTrainerGrade({ gradePercent: 30, speedMs: 3, gearRatio: 50 / 11, referenceRatio: R, params, trainerDifficulty: 1 });
    expect(hi).toBe(20);
    const lo = computeTrainerGrade({ gradePercent: -30, speedMs: 20, gearRatio: 1, referenceRatio: R, params, trainerDifficulty: 1, minGradePercent: -60 });
    expect(lo).toBeGreaterThanOrEqual(-40);
  });
  it('l’aspiration allège la résistance au trainer', () => {
    const a = computeTrainerGrade({ gradePercent: 0, speedMs: 11, gearRatio: R, referenceRatio: R, params });
    const b = computeTrainerGrade({ gradePercent: 0, speedMs: 11, gearRatio: R, referenceRatio: R, params, cdaFactor: 0.65 });
    expect(b).toBeLessThan(a);
  });
  it('lissage : vitesse de variation bornée et envois espacés', () => {
    const s = new TrainerGradeSmoother(0, { maxRatePercentPerS: 2, timeConstantS: 0.5 });
    let sent = 0;
    let prev = 0;
    for (let i = 0; i < 60; i++) {
      const out = s.update(10, 1 / 60);
      expect(s.value - prev).toBeLessThanOrEqual(2 / 60 + 1e-9);
      prev = s.value;
      if (out !== null) sent++;
    }
    expect(s.value).toBeLessThanOrEqual(2 + 1e-9);
    expect(sent).toBeLessThanOrEqual(5);
    for (let i = 0; i < 600; i++) s.update(10, 1 / 60);
    expect(s.value).toBeCloseTo(10, 1);
  });
  it('power match : corrige la consigne ERG', () => {
    const pm = new PowerMatch({ timeConstantS: 5 });
    for (let i = 0; i < 100; i++) pm.update(200, 210, 1);
    expect(pm.correct(200)).toBe(210);
  });
});

describe('posture', () => {
  it('assis → danseuse en côte forte, hystérésis, roue libre', () => {
    const p = new PoseController();
    const ftp = 250;
    expect(p.update({ watts: 200, cadence: 90, gradePercent: 0, ftpWatts: ftp }, 0.1)).toBe('seated');
    for (let i = 0; i < 20; i++) p.update({ watts: 260, cadence: 70, gradePercent: 8, ftpWatts: ftp }, 0.1);
    expect(p.pose).toBe('standing');
    // Léger relâchement : reste en danseuse (hystérésis).
    for (let i = 0; i < 20; i++) p.update({ watts: 220, cadence: 75, gradePercent: 7, ftpWatts: ftp }, 0.1);
    expect(p.pose).toBe('standing');
    for (let i = 0; i < 20; i++) p.update({ watts: 150, cadence: 80, gradePercent: 3, ftpWatts: ftp }, 0.1);
    expect(p.pose).toBe('seated');
    for (let i = 0; i < 20; i++) p.update({ watts: 0, cadence: 0, gradePercent: -5, ftpWatts: ftp }, 0.1);
    expect(p.pose).toBe('coasting');
    expect(p.update({ watts: 200, cadence: 90, gradePercent: 0, ftpWatts: ftp }, 0.1)).toBe('seated');
    for (let i = 0; i < 20; i++) p.update({ watts: 600, cadence: 110, gradePercent: 0, ftpWatts: ftp }, 0.1);
    expect(p.pose).toBe('standing');
  });
  it('pas de scintillement autour du seuil', () => {
    const p = new PoseController();
    let changes = 0;
    let last = p.pose;
    for (let i = 0; i < 200; i++) {
      p.update({ watts: i % 2 ? 245 : 235, cadence: 80, gradePercent: 6, ftpWatts: 250 }, 0.1);
      if (p.pose !== last) changes++;
      last = p.pose;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });
  it('seuil de danseuse choisi et position mesurée par les pédales', () => {
    const p = new PoseController();
    const flat = { cadence: 95, gradePercent: 0, ftpWatts: 250 };
    // 320 W sur le plat : assis par les règles seules, debout avec un seuil à 300 W.
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 320 }, 0.1);
    expect(p.pose).toBe('seated');
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 320, standWatts: 300 }, 0.1);
    expect(p.pose).toBe('standing');
    // Sortie sous 85 % du seuil seulement.
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 270, standWatts: 300 }, 0.1);
    expect(p.pose).toBe('standing');
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 240, standWatts: 300 }, 0.1);
    expect(p.pose).toBe('seated');
    // Les pédales qui détectent la position l'emportent sur l'effort.
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 180, sensorPose: 'standing' }, 0.1);
    expect(p.pose).toBe('standing');
    for (let i = 0; i < 20; i++) p.update({ ...flat, watts: 700, sensorPose: 'seated' }, 0.1);
    expect(p.pose).toBe('seated');
  });
});
