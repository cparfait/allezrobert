import { describe, expect, it } from 'vitest';
import { addStage, currentStage, fmtTime, newTour, stagePlan, stageResult, standings, tourDone, tourLeaders } from '../src/game/stageRace.ts';

const ais = [
  { id: 'ai-0', name: 'Jean DUPONT' },
  { id: 'ai-1', name: 'Carmen FERNÁNDEZ' },
  { id: 'ai-2', name: 'Matteo MORETTI' },
  { id: 'ai-3', name: 'Emma MAES' },
];

describe('tour à étapes', () => {
  it('plan : prologue chrono, étapes en ligne, second chrono dès 5 étapes', () => {
    expect(stagePlan(3)).toEqual(['tt', 'road', 'road']);
    expect(stagePlan(5)).toEqual(['tt', 'road', 'road', 'tt', 'road']);
  });

  it('classements : temps cumulés et bonifications, points, montagne, équipes', () => {
    let t = newTour(2, ais, 'Robert');
    const tt = stageResult('tt', 'Prologue', { segs: [], finish: [{ id: 'ai-0', t: 300 }, { id: 'ai-1', t: 310 }], pending: [{ id: 'ai-2', remainingM: 100, speedMs: 10, t: 320 }, { id: 'ai-3', remainingM: 0, speedMs: 10, t: 330 }] }, 305);
    expect(tt.order).toEqual(['ai-0', 'me', 'ai-1', 'ai-2', 'ai-3']);
    t = addStage(t, tt, [{ id: 'ai-0', wPrime: 0.1 }]);
    expect(t.fatigue['ai-0']).toBeGreaterThan(0.04);
    expect(currentStage(t)).toBe(1);
    const road = stageResult(
      'road',
      'Étape 2',
      { segs: [{ kind: 'kom', name: 'Côte', avgGrade: 8, lengthM: 2000, order: ['me', 'ai-1'] }, { kind: 'sprint', name: 'Sprint', avgGrade: 0, lengthM: 200, order: ['ai-2', 'me'] }], finish: [{ id: 'ai-0', t: 1000 }, { id: 'ai-1', t: 1000 }, { id: 'ai-2', t: 1001 }, { id: 'ai-3', t: 1100 }], pending: [] },
      1000.5,
    );
    t = addStage(t, road, []);
    expect(tourDone(t)).toBe(true);
    const st = standings(t);
    // ai-0 : 300 + 1000 − 10 = 1290 ; moi : 305 + 1000,5 − 4 = 1301,5.
    expect(st.gc[0]).toMatchObject({ id: 'ai-0', value: 1290 });
    expect(st.gc.find((x) => x.me)?.value).toBeCloseTo(1301.5);
    expect(st.kom[0]?.id).toBe('me');
    expect(st.points[0]?.id).toBe('ai-0');
    expect(st.teams).toHaveLength(4);
    // Maillots : ai-0 mène général et points → jaune ; le vert passe au 2e des points (moi), qui mène aussi la
    // montagne : le vert prime, les pois passent au 2e grimpeur (ai-1).
    expect(tourLeaders(t)).toEqual({ 'ai-0': 'gc', me: 'points', 'ai-1': 'kom' });
  });

  it('format des temps', () => {
    expect(fmtTime(245)).toBe('4:05');
    expect(fmtTime(3733)).toBe('1 h 02:13');
    expect(fmtTime(12, true)).toBe('+0:12');
  });
});
