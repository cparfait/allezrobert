import { describe, expect, it } from 'vitest';
import {
  computeDraftFactors,
  DraftCalculator,
  draftReductionSingle,
  StickyGroupRegulator,
  type DraftRider,
  type StickyRider,
} from '../src/index.ts';

const L = 1.75;

describe('aspiration', () => {
  it('−30 à −40 % juste derrière, ~0 au-delà de 15 m', () => {
    expect(draftReductionSingle(0.5, 0)).toBeGreaterThan(0.3);
    expect(draftReductionSingle(0.5, 0)).toBeLessThanOrEqual(0.4);
    expect(draftReductionSingle(1, 0)).toBeGreaterThan(0.3);
    expect(draftReductionSingle(10, 0)).toBeLessThan(0.08);
    expect(draftReductionSingle(15, 0)).toBe(0);
    expect(draftReductionSingle(30, 0)).toBe(0);
  });
  it('décroît avec l’écart longitudinal', () => {
    let prev = Infinity;
    for (let g = 0; g <= 16; g += 0.25) {
      const r = draftReductionSingle(g, 0);
      expect(r).toBeLessThanOrEqual(prev + 1e-12);
      prev = r;
    }
  });
  it('décroît avec le décalage latéral et s’annule au-delà de ~0,8 m', () => {
    let prev = Infinity;
    for (let lat = 0; lat <= 1.5; lat += 0.05) {
      const r = draftReductionSingle(1, lat);
      expect(r).toBeLessThanOrEqual(prev + 1e-12);
      prev = r;
    }
    expect(draftReductionSingle(1, 0.9)).toBe(0);
    expect(draftReductionSingle(1, -0.9)).toBe(0);
  });
  it('le coureur seul en tête n’a (presque) rien, le suiveur beaucoup', () => {
    const r = computeDraftFactors([
      { distM: 100, lateralM: 0, speedMs: 10 },
      { distM: 100 - L - 0.5, lateralM: 0, speedMs: 10 },
    ]);
    expect(r[0]).toBeLessThan(0.05);
    expect(r[1]).toBeGreaterThan(0.3);
  });
  it('les coureurs plus profonds dans le groupe gagnent davantage (≤ 60 %)', () => {
    const line: DraftRider[] = [];
    for (let i = 0; i < 8; i++) line.push({ distM: 200 - i * (L + 0.5), lateralM: 0, speedMs: 11 });
    const r = computeDraftFactors(line);
    for (let i = 2; i < 8; i++) expect(r[i]!).toBeGreaterThanOrEqual(r[i - 1]! - 1e-12);
    expect(r[7]).toBeGreaterThan(0.45);
    expect(r[7]).toBeLessThanOrEqual(0.6);
    // Peloton compact : 4 de front sur 6 rangs.
    const bunch: DraftRider[] = [];
    for (let row = 0; row < 6; row++) for (let c = 0; c < 4; c++) bunch.push({ distM: 300 - row * (L + 0.4), lateralM: (c - 1.5) * 0.6, speedMs: 11 });
    const rb = computeDraftFactors(bunch);
    expect(Math.max(...rb)).toBeGreaterThan(0.5);
    expect(Math.max(...rb)).toBeLessThanOrEqual(0.58 + 1e-9);
  });
  it('l’ordre d’entrée n’importe pas et draftingStrength met à l’échelle', () => {
    const riders: DraftRider[] = [
      { distM: 50, lateralM: 0.2, speedMs: 10 },
      { distM: 55, lateralM: 0, speedMs: 10 },
      { distM: 52.5, lateralM: 0.1, speedMs: 10 },
    ];
    const a = computeDraftFactors(riders);
    const b = computeDraftFactors([riders[2]!, riders[0]!, riders[1]!]);
    expect(b[1]).toBeCloseTo(a[0]!, 12);
    expect(b[2]).toBeCloseTo(a[1]!, 12);
    expect(b[0]).toBeCloseTo(a[2]!, 12);
    const half = computeDraftFactors(riders, { strength: 0.5 });
    for (let i = 0; i < 3; i++) expect(half[i]).toBeCloseTo(a[i]! * 0.5, 12);
    const none = computeDraftFactors(riders, { strength: 0 });
    expect([...none]).toEqual([0, 0, 0]);
  });
  it('un coureur arrêté n’abrite personne', () => {
    const r = computeDraftFactors([
      { distM: 10, lateralM: 0, speedMs: 0 },
      { distM: 10 - L - 0.5, lateralM: 0, speedMs: 8 },
    ]);
    expect(r[1]).toBe(0);
  });
  it('le calculateur réutilisable tient 20 coureurs en régime', () => {
    const calc = new DraftCalculator();
    const riders: DraftRider[] = Array.from({ length: 20 }, (_, i) => ({ distM: i * 1.3, lateralM: (i % 3) * 0.4, speedMs: 10 }));
    const t0 = performance.now();
    for (let k = 0; k < 2000; k++) calc.compute(riders);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('groupe soudé', () => {
  it('borne l’écart au centre et laisse libre dans la zone morte', () => {
    const reg = new StickyGroupRegulator({ deadbandM: 8, maxGapM: 30 });
    const riders: StickyRider[] = [
      { distM: 0, speedMs: 10 },
      { distM: 2, speedMs: 10 },
      { distM: 4, speedMs: 10 },
      { distM: 6, speedMs: 10 },
    ];
    const before = riders.map((r) => ({ ...r }));
    reg.apply(riders, 0.1);
    expect(riders).toEqual(before);
    // Un coureur fort s'échappe à 14 m/s pendant 2 min : il reste dans les 30 m.
    for (let t = 0; t < 1200; t++) {
      riders[3]!.speedMs = Math.max(riders[3]!.speedMs, 14);
      for (const r of riders) r.distM += r.speedMs * 0.1;
      const res = reg.apply(riders, 0.1);
      for (const r of riders) expect(Math.abs(r.distM - res.centerDistM)).toBeLessThanOrEqual(30 + 1e-9);
    }
    expect(reg.assist(4)[3]!).toBeLessThan(0);
  });
  it('aide un coureur décroché à revenir', () => {
    const reg = new StickyGroupRegulator();
    const riders: StickyRider[] = [
      { distM: 100, speedMs: 10 },
      { distM: 101, speedMs: 10 },
      { distM: 102, speedMs: 10 },
      { distM: 80, speedMs: 8 },
    ];
    for (let t = 0; t < 300; t++) {
      for (const r of riders) r.distM += r.speedMs * 0.1;
      riders[3]!.speedMs = Math.min(riders[3]!.speedMs, 9.5); // « puissance » plus faible
      reg.apply(riders, 0.1);
    }
    expect(riders[0]!.distM - riders[3]!.distM).toBeLessThan(30);
  });
  it('ignore les coureurs hors groupe', () => {
    const reg = new StickyGroupRegulator();
    const riders: StickyRider[] = [
      { distM: 0, speedMs: 10 },
      { distM: 1, speedMs: 10 },
      { distM: 500, speedMs: 10, inGroup: false },
    ];
    const res = reg.apply(riders, 0.1);
    expect(res.count).toBe(2);
    expect(riders[2]!.distM).toBe(500);
  });
});
