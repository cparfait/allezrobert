import { describe, expect, it } from 'vitest';
import { CYCLOTRON_WORKOUTS, WORKOUT_LIBRARY, WORKOUT_TYPES, addDays, bestCurve, dailyLoad, localDate, powerZoneIndex, trainingSummary, tssByDay, weekStart, workoutDuration } from '../src/index.ts';

describe('bilan d’entraînement', () => {
  it('une heure pile à la FTP donne IF 1 et TSS 100', () => {
    const samples = Array.from({ length: 3600 }, () => ({ watts: 250, hr: 150, cadence: 90 }));
    const s = trainingSummary(samples, 250);
    expect(s.np).toBeCloseTo(250, 6);
    expect(s.intensity).toBeCloseTo(1, 6);
    expect(s.tss).toBeCloseTo(100, 6);
    expect(s.avgHr).toBe(150);
    expect(s.avgCadence).toBe(90);
    expect(s.workKJ).toBeCloseTo(900, 6);
    expect(s.zonesS[3]).toBe(3600);
    expect(s.curve.at(-1)).toEqual({ durationS: 3600, watts: 250 });
  });

  it('ignore FC et cadence absentes, borne les watts négatifs', () => {
    const s = trainingSummary([{ watts: -20 }, { watts: 100 }, {}], 200);
    expect(s.avgHr).toBeNull();
    expect(s.avgCadence).toBeNull();
    expect(s.maxWatts).toBe(100);
    expect(s.zonesS[0]).toBe(3);
  });

  it('zones de Coggan', () => {
    expect(powerZoneIndex(100, 200)).toBe(0);
    expect(powerZoneIndex(200, 200)).toBe(3);
    expect(powerZoneIndex(400, 200)).toBe(6);
  });
});

describe('charge dans le temps', () => {
  it('dates locales, semaines du lundi', () => {
    // 23 h 30 UTC le 28/10 = 00 h 30 le 29/10 à Paris (UTC+1).
    expect(localDate(Date.UTC(2026, 9, 28, 23, 30), 60)).toBe('2026-10-29');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
  });

  it('forme 42 j, fatigue 7 j, fraîcheur = forme − fatigue de la veille', () => {
    const tss = new Map([['2026-10-01', 100]]);
    const load = dailyLoad(tss, '2026-10-01', '2026-10-03');
    expect(load).toHaveLength(3);
    expect(load[0]!.ctl).toBeCloseTo(100 / 42, 6);
    expect(load[0]!.atl).toBeCloseTo(100 / 7, 6);
    expect(load[0]!.tsb).toBe(0);
    expect(load[1]!.tsb).toBeCloseTo(100 / 42 - 100 / 7, 6);
  });

  it('démarre au premier jour connu même avant `from`', () => {
    const tss = new Map([['2026-09-01', 80]]);
    const load = dailyLoad(tss, '2026-10-01', '2026-10-01');
    expect(load).toHaveLength(1);
    expect(load[0]!.ctl).toBeGreaterThan(0);
  });

  it('TSS cumulé par jour local et records de puissance', () => {
    const m = tssByDay([
      { startedAt: Date.UTC(2026, 9, 1, 8), utcOffsetMin: 120, tss: 50 },
      { startedAt: Date.UTC(2026, 9, 1, 18), utcOffsetMin: 120, tss: 30 },
      { startedAt: Date.UTC(2026, 9, 2, 8), utcOffsetMin: 120, tss: null },
    ]);
    expect([...m]).toEqual([['2026-10-01', 80]]);
    expect(bestCurve([[{ durationS: 5, watts: 600 }], [{ durationS: 5, watts: 650 }, { durationS: 60, watts: 400 }]])).toEqual([
      { durationS: 5, watts: 650 },
      { durationS: 60, watts: 400 },
    ]);
  });
});

describe('bibliothèque de séances', () => {
  it('47 séances de Cyclotron, identifiants uniques, toutes typées', () => {
    expect(CYCLOTRON_WORKOUTS).toHaveLength(47);
    const ids = WORKOUT_LIBRARY.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of WORKOUT_LIBRARY) expect(WORKOUT_TYPES).toContain(w.type);
  });

  it('mêmes durées que dans Cyclotron, échauffement et retour au calme reconnus', () => {
    const ss = CYCLOTRON_WORKOUTS.find((w) => w.id === 'cy.sweetspot.3x12')!.build();
    expect(workoutDuration(ss)).toBe((10 + 3 * 17 + 5) * 60);
    expect(ss.steps[0]!.kind).toBe('warmup');
    expect(ss.steps.at(-1)!.kind).toBe('cooldown');
    const on = ss.steps.filter((s) => s.kind === 'intervalOn');
    expect(on).toHaveLength(3);
    expect(on[1]!.repeatIndex).toBe(1);
    expect(on[0]!.cadence).toBe(90);
    const over = CYCLOTRON_WORKOUTS.find((w) => w.id === 'cy.threshold.overunders')!.build('en');
    expect(over.steps.filter((s) => s.kind === 'intervalOn' && s.powerStart === 1.05)).toHaveLength(9);
    expect(over.steps[0]!.textEvents?.[0]?.message).toBe('Progressive warm-up');
  });

  it('chaque séance construite est jouable (durées positives, cibles en % de FTP)', () => {
    for (const w of WORKOUT_LIBRARY) {
      const built = w.build();
      expect(built.steps.length).toBeGreaterThan(0);
      for (const st of built.steps) {
        expect(st.durationS).toBeGreaterThan(0);
        expect(st.powerUnit).toBe('ftp');
        expect(st.powerEnd).toBeLessThan(2);
      }
    }
  });
});

describe('séances au format JSON', () => {
  it('relit une séance gardée, refuse une étape invalide', async () => {
    const { parseWorkoutFile } = await import('../src/index.ts');
    const w = CYCLOTRON_WORKOUTS[0]!.build();
    const back = parseWorkoutFile('Ma séance.json', JSON.stringify(w));
    expect(back.steps).toEqual(w.steps);
    expect(() => parseWorkoutFile('x.json', JSON.stringify({ name: 'x', steps: [{ kind: 'nope', durationS: 1 }] }))).toThrow();
  });
});

describe('type d’entraînement estimé', () => {
  it('de la récupération à l’anaérobie', async () => {
    const { classifyRideType } = await import('../src/index.ts');
    expect(classifyRideType([], 0.5)).toBeNull();
    expect(classifyRideType([1800, 0, 0, 0, 0, 0, 0], 0.5)).toBe('recovery');
    expect(classifyRideType([600, 3000, 0, 0, 0, 0, 0], 0.68)).toBe('endurance');
    expect(classifyRideType([600, 1200, 1500, 0, 0, 0, 0], 0.78)).toBe('tempo');
    expect(classifyRideType([600, 1200, 600, 900, 0, 0, 0], 0.84)).toBe('sweetspot');
    expect(classifyRideType([600, 600, 300, 2400, 0, 0, 0], 0.95)).toBe('threshold');
    expect(classifyRideType([900, 900, 300, 300, 480, 0, 0], 0.9)).toBe('vo2max');
    expect(classifyRideType([1500, 900, 0, 0, 100, 150, 30], 0.8)).toBe('anaerobic');
  });
});
