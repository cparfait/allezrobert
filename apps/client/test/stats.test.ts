import { describe, expect, it, beforeEach } from 'vitest';
import type { ActivityRecord } from '@allezrobert/shared';
import { previousComparable, readPowerRecords, rideStats, updatePowerRecords } from '../src/game/stats.ts';

// localStorage minimal pour les tests (Node).
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

/** 20 min à 200 W avec 1 min à 400 W au milieu, 10 m/s, FC 140. */
function records(): ActivityRecord[] {
  return Array.from({ length: 1200 }, (_, i) => ({ t: i * 1000, distanceM: i * 10, speedMs: 10, altitudeM: 100 + i * 0.05, watts: i >= 600 && i < 660 ? 400 : 200, hr: 140, cadence: 90 }));
}

describe('statistiques de fin de sortie', () => {
  beforeEach(() => store.clear());
  it('chiffres clés, TSS, zones', () => {
    const s = rideStats(records(), { ftp: 250, elevationGainM: 60 });
    expect(s.distanceM).toBe(11990);
    expect(s.avgSpeedKmh).toBeCloseTo(36, 0);
    expect(s.avgWatts).toBeCloseTo(210, 6);
    expect(s.avgHr).toBe(140);
    expect(s.np).toBeGreaterThan(s.avgWatts);
    expect(s.ifactor).toBeCloseTo(s.np / 250, 6);
    expect(s.tss).toBeGreaterThan(15);
    expect(s.kcal).toBeCloseTo(210 * 1.2 * 1000 / (4184 * 0.24) / 1, 0);
    // 200 W = 80 % de FTP → Z3 ; 400 W = 160 % → Z7.
    expect(s.zonesS[2]).toBe(1140);
    expect(s.zonesS[6]).toBe(60);
    expect(s.curve.find((p) => p.durationS === 60)?.watts).toBe(400);
    expect(s.curve.find((p) => p.durationS === 1200)?.watts).toBeCloseTo(210, 6);
    expect(s.curve.some((p) => p.durationS === 1800)).toBe(false);
  });
  it('records : la première sortie fixe les records, la suivante les bat', () => {
    const s = rideStats(records(), { ftp: 250, elevationGainM: 0 });
    expect(updatePowerRecords(s.curve).beaten).toEqual([]);
    expect(readPowerRecords()[60]).toBe(400);
    const faster = records().map((r) => ({ ...r, watts: (r.watts ?? 0) + 20 }));
    const s2 = rideStats(faster, { ftp: 250, elevationGainM: 0 });
    const before = readPowerRecords();
    const r = updatePowerRecords(s2.curve, before);
    expect(r.beaten).toContain(60);
    expect(r.previous[60]).toBe(400);
    expect(readPowerRecords()[60]).toBe(420);
    // Sortie reprise puis terminée à nouveau : mêmes records d'avant, rien ne se bat soi-même.
    expect(updatePowerRecords(s2.curve, before).beaten).toContain(60);
  });
  it('« vs la dernière fois » : même itinéraire, distance comparable, pas soi-même, tout l’historique', () => {
    const e = { routeId: 'r', distanceM: 10000, movingS: 1200, avgSpeedKmh: 30, avgWatts: 200, np: 210 };
    const old = Array.from({ length: 100 }, (_, i) => ({ ...e, date: i + 1 }));
    expect(previousComparable([], { ...e, date: 1 })).toBeNull();
    expect(previousComparable(old, { ...e, routeId: 'autre', date: 200 })).toBeNull();
    expect(previousComparable(old, { ...e, date: 200 })?.date).toBe(100);
    // Même sortie terminée deux fois : elle ne se compare pas à elle-même.
    expect(previousComparable([...old, { ...e, date: 200 }], { ...e, date: 200 })?.date).toBe(100);
    expect(previousComparable(old, { ...e, date: 200, distanceM: 30000 })).toBeNull();
  });
});
