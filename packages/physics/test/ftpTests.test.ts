import { describe, expect, it } from 'vitest';
import { FTP_TEST_PROTOCOLS, RAMP_CADENCE, WorkoutRunner, ftp20MinTestWorkout, ftpTestWorkout, rampLiteTestWorkout, rampTestWorkout, workoutDuration } from '../src/index.ts';

describe('protocoles du test FTP', () => {
  it('rampe standard : 5 min à 100 W puis 100 W + 20 W par minute, cadence conseillée', () => {
    const w = rampTestWorkout();
    expect(w.steps[0]).toMatchObject({ kind: 'warmup', durationS: 300, powerStart: 100, powerEnd: 100, powerUnit: 'watts' });
    expect(w.steps[1]).toMatchObject({ durationS: 60, powerStart: 100, cadenceLow: RAMP_CADENCE.low, cadenceHigh: RAMP_CADENCE.high, repeatIndex: 0 });
    expect(w.steps[13]?.powerStart).toBe(340);
    expect(w.steps).toHaveLength(31);
    // Messages d'échauffement : tous pendant l'échauffement.
    const msgs = w.steps[0]?.textEvents ?? [];
    expect(msgs.length).toBeGreaterThan(4);
    expect(msgs.every((m) => m.offsetS + (m.durationS ?? 10) <= 300)).toBe(true);
  });

  it('rampe douce : 8 min de 50 à 80 W, puis 50 W + 10 W par minute', () => {
    const w = rampLiteTestWorkout();
    expect(w.steps[0]).toMatchObject({ durationS: 480, powerStart: 50, powerEnd: 80 });
    expect(w.steps[1]?.powerStart).toBe(50);
    expect(w.steps[2]?.powerStart).toBe(60);
    expect(w.name).toBe('Test rampe douce');
  });

  it('test 20 min : échauffement complet puis 20 min libres et retour au calme', () => {
    const w = ftp20MinTestWorkout();
    const free = w.steps.filter((s) => s.kind === 'freeRide');
    expect(free).toHaveLength(1);
    expect(free[0]).toMatchObject({ mode: 'free', durationS: 1200 });
    expect(w.steps[0]).toMatchObject({ kind: 'warmup', durationS: 1200, powerUnit: 'ftp' });
    expect(w.steps.filter((s) => s.durationS === 20)).toHaveLength(9);
    expect(workoutDuration(w)).toBe(1200 + 180 + 300 + 300 + 600 + 1200 + 600);
    // Le runner atteint l'effort libre après 43 minutes (1 200 + 180 + 300 + 300 + 600 s).
    const r = new WorkoutRunner(w, { ftpWatts: 250 });
    expect(r.at(2580 + 5).mode).toBe('free');
    expect(r.at(2580 - 5).mode).toBe('erg');
  });

  it('ftpTestWorkout choisit le bon protocole', () => {
    expect(FTP_TEST_PROTOCOLS).toEqual(['ramp', 'rampLite', 'ftp20']);
    expect(ftpTestWorkout('ramp').name).toBe('Test rampe');
    expect(ftpTestWorkout('rampLite').name).toBe('Test rampe douce');
    expect(ftpTestWorkout('ftp20').name).toBe('Test FTP 20 min');
  });
});
