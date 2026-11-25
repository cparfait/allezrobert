import { describe, expect, it } from 'vitest';
import { raceReport, type RaceSample } from '../src/game/raceReport.ts';
import type { StageResult } from '../src/game/stageRace.ts';

/** Relevés à la seconde : `watts(s)` à vitesse constante `v` (m/s). */
function ride(seconds: number, v: number, watts: (s: number) => number): RaceSample[] {
  return Array.from({ length: seconds + 1 }, (_, s) => ({ t: s * 1000, distanceM: s * v, watts: watts(s) }));
}

const result: StageResult = {
  kind: 'road',
  route: 'Boucle',
  times: { 'ai-0': 600, me: 612, 'ai-1': 640 },
  order: ['ai-0', 'me', 'ai-1'],
  marks: [
    { kind: 'sprint', name: 'Sprint du village', order: ['me', 'ai-0'] },
    { kind: 'kom', name: 'Côte de la Forêt', cat: 3, order: ['ai-0', 'ai-1', 'me'] },
  ],
};

describe('raceReport', () => {
  const samples = ride(600, 10, (s) => (s >= 300 && s < 360 ? 500 : s >= 590 ? 900 : 200));
  const rep = raceReport({
    result,
    riders: { 'ai-0': { name: 'Moretti', team: 'Bocage Vélo' }, me: { name: 'Moi', team: 'Allez Robert' }, 'ai-1': { name: 'Smit' } },
    samples,
    marks: [
      { kind: 'sprint', name: 'Sprint du village', atM: 2000, lengthM: 200 },
      { kind: 'kom', name: 'Côte de la Forêt', atM: 3600, lengthM: 600, cat: 3 },
    ],
    raceLengthM: 6000,
    lapM: 2000,
    massKg: 70,
  });

  it('classe tout le monde avec l’écart au vainqueur', () => {
    expect(rep.rows.map((r) => [r.rank, r.name, r.gapS])).toEqual([
      [1, 'Moretti', 0],
      [2, 'Moi', 12],
      [3, 'Smit', 40],
    ]);
    expect(rep.myRank).toBe(2);
    expect(rep.field).toBe(3);
    expect(rep.rows[1]?.me).toBe(true);
  });

  it('compte mes points d’arrivée, de sprint et de montagne', () => {
    expect(rep.points).toEqual({ finish: 20, sprint: 10, kom: 0 });
    expect(rep.marks[0]).toMatchObject({ place: 1, of: 2, points: 10 });
    expect(rep.marks[1]).toMatchObject({ place: 3, of: 3, points: 0, cat: 3 });
  });

  it('mesure ma puissance sur chaque passage noté', () => {
    // Sprint de 1 800 à 2 000 m : secondes 180 à 200, à 200 W.
    expect(rep.marks[0]?.watts).toBeCloseTo(200);
    expect(rep.marks[0]?.durationS).toBe(20);
    // Côte de 3 000 à 3 600 m : secondes 300 à 360, dont 60 s à 500 W et la dernière à 200 W.
    expect(rep.marks[1]?.watts).toBeCloseTo((60 * 500 + 200) / 61);
  });

  it('trouve l’attaque, le sprint final et le dernier kilomètre', () => {
    const by = Object.fromEntries(rep.efforts.map((e) => [e.key, e]));
    expect(by.attack?.watts).toBeCloseTo(500);
    expect(by.attack?.wkg).toBeCloseTo(500 / 70);
    expect(by.sprint?.watts).toBeCloseTo(900);
    expect(by.lastKm?.durationS).toBe(100);
  });

  it('découpe les tours du circuit', () => {
    expect(rep.laps.map((l) => l.lap)).toEqual([1, 2, 3]);
    expect(rep.laps[0]?.timeS).toBe(200);
  });

  it('sans circuit ni puissance : pas de tours ni de moments clés', () => {
    const r = raceReport({ result, riders: {}, samples: samples.map(({ t, distanceM }) => ({ t, distanceM })), marks: [], raceLengthM: 6000, lapM: null, massKg: 70 });
    expect(r.laps).toEqual([]);
    expect(r.efforts).toEqual([]);
    expect(r.rows[0]?.name).toBe('ai-0');
  });
});
