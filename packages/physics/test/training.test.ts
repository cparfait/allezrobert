import { describe, expect, it } from 'vitest';
import {
  averagePower,
  fitCriticalPower,
  ftpFrom20MinTest,
  ftpFromRampTest,
  intensityFactor,
  meanMaxPower,
  normalizedPower,
  NormalizedPowerAccumulator,
  powerCurve,
  rampTestWorkout,
  SeededRng,
  trainingStressScore,
  WorkoutRunner,
  WPrimeBalance,
  wPrimeBalanceSeries,
} from '../src/index.ts';

const constant = (w: number, n: number) => new Array<number>(n).fill(w);

describe('NP, IF, TSS', () => {
  it('une heure à FTP constante = 100 TSS, IF 1', () => {
    const p = constant(250, 3600);
    const np = normalizedPower(p);
    expect(np).toBeCloseTo(250, 6);
    expect(intensityFactor(np, 250)).toBeCloseTo(1, 6);
    expect(trainingStressScore(3600, np, 250)).toBeCloseTo(100, 4);
  });
  it('NP > moyenne pour un effort fractionné', () => {
    const p: number[] = [];
    for (let i = 0; i < 1800; i++) p.push(Math.floor(i / 60) % 2 ? 100 : 350);
    expect(normalizedPower(p)).toBeGreaterThan(averagePower(p) + 20);
  });
  it('accumulateur en flux = calcul par lot', () => {
    const rng = new SeededRng(3);
    const p = Array.from({ length: 900 }, () => rng.range(100, 400));
    const acc = new NormalizedPowerAccumulator();
    for (const w of p) acc.add(w);
    expect(acc.value).toBeCloseTo(normalizedPower(p), 9);
  });
});

describe('W′ balance (Skiba)', () => {
  it('se vide au-dessus de CP et se recharge en dessous', () => {
    const w = new WPrimeBalance(250, 20000);
    for (let i = 0; i < 60; i++) w.update(450, 1);
    expect(w.balance).toBeCloseTo(20000 - 200 * 60, 6);
    const low = w.balance;
    for (let i = 0; i < 600; i++) w.update(100, 1);
    expect(w.balance).toBeGreaterThan(low);
    expect(w.balance).toBeLessThanOrEqual(20000);
    expect(w.minBalance).toBeCloseTo(low, 6);
  });
  it('indépendant du pas en récupération (solution exacte)', () => {
    const a = new WPrimeBalance(250, 20000, 5000);
    const b = new WPrimeBalance(250, 20000, 5000);
    for (let i = 0; i < 60; i++) a.update(150, 1);
    for (let i = 0; i < 3600; i++) b.update(150, 1 / 60);
    expect(a.balance).toBeCloseTo(b.balance, 6);
    expect(wPrimeBalanceSeries([300, 300], 250, 20000)[1]).toBeCloseTo(19900, 6);
  });
});

describe('courbe de puissance, CP et FTP', () => {
  it('meilleures moyennes', () => {
    const p = [...constant(200, 100), ...constant(400, 30), ...constant(200, 100)];
    expect(meanMaxPower(p, 30)).toBe(400);
    expect(meanMaxPower(p, 60)).toBeCloseTo((400 * 30 + 200 * 30) / 60, 9);
    expect(meanMaxPower(p, 1000)).toBe(0);
    const curve = powerCurve(p, [1, 30, 60, 3600]);
    expect(curve.map((c) => c.durationS)).toEqual([1, 30, 60]);
  });
  it('ajuste CP et W′ sur des efforts synthétiques', () => {
    const cp = 280;
    const wp = 18000;
    const pts = [180, 300, 600, 1200].map((t) => ({ durationS: t, watts: cp + wp / t }));
    const fit = fitCriticalPower(pts);
    expect(fit.cp).toBeCloseTo(cp, 6);
    expect(fit.wPrime).toBeCloseTo(wp, 3);
    expect(fit.r2).toBeCloseTo(1, 9);
  });
  it('FTP : 95 % des 20 min, 75 % de la meilleure minute du test rampe', () => {
    expect(ftpFrom20MinTest([...constant(150, 600), ...constant(300, 1200), ...constant(100, 300)])).toBe(285);
    // Rampe simulée : le coureur lâche au palier 13 (100 + 20·12 = 340 W).
    const ramp = new WorkoutRunner(rampTestWorkout(), { ftpWatts: 250 });
    const p: number[] = [];
    for (let t = 0; t < 300 + 13 * 60; t++) p.push(ramp.at(t).targetWatts ?? 0);
    expect(ftpFromRampTest(p)).toBe(Math.round(0.75 * 340));
  });
});
