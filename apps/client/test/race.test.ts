import { describe, expect, it } from 'vitest';
import type { RideResult } from '@allezrobert/shared';
import { countdownLabel, formatGap, formatRaceTime, liveStandings, paceBand, selfRaceInfo, statusLabel, type LiveRider } from '../src/game/race.ts';

const rider = (id: string, distM: number, extra: Partial<LiveRider> = {}): LiveRider => ({ id, name: id.toUpperCase(), distM, speedMs: 10, isAI: false, isGuest: false, ...extra });
const res = (riderId: string, patch: Partial<RideResult>): RideResult => ({ riderId, name: riderId.toUpperCase(), rank: 0, timeMs: 0, isAI: false, isGuest: false, ...patch });

describe('classement en direct (jeu)', () => {
  it('arrivés par rang, puis en course par distance, puis abandons et hors classement', () => {
    const riders = [rider('a', 900), rider('b', 1200), rider('c', 1500), rider('g', 2000, { isGuest: true }), rider('late', 1800), rider('w', 3000)];
    const known = new Map<string, RideResult>([
      ['w', res('w', { rank: 1, timeMs: 600_000, status: 'finished', gapMs: 0, komPts: 5 })],
      ['x', res('x', { status: 'dnf' })],
      ['c', res('c', { status: 'racing', sprintPts: 3 })],
    ]);
    const rows = liveStandings(riders, known, new Set(['late']));
    expect(rows.map((r) => [r.id, r.pos, r.status])).toEqual([
      ['w', 1, 'finished'],
      ['c', 2, 'racing'],
      ['b', 3, 'racing'],
      ['a', 4, 'racing'],
      ['x', 0, 'dnf'],
      ['g', 0, 'unranked'],
      ['late', 0, 'unranked'],
    ]);
    expect(rows.find((r) => r.id === 'c')).toMatchObject({ behindM: 0, sprintPts: 3 });
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ behindM: 600, behindS: 60 });
    expect(rows[0]).toMatchObject({ timeMs: 600_000, gapMs: 0, komPts: 5 });
  });

  it('informations du coureur : place, reste, tour, écarts devant / derrière', () => {
    const riders = [rider('a', 900), rider('me', 1200), rider('c', 1500)];
    const rows = liveStandings(riders, new Map());
    const info = selfRaceInfo(rows, riders, 'me', 2 * 1000, 1000, 2)!;
    expect(info).toEqual({ pos: 2, total: 3, remainingM: 800, lap: 2, laps: 2, aheadM: 300, behindM: 300 });
    // Sur la grille (distance négative) : tour 1.
    const grid = [rider('me', -2.2)];
    expect(selfRaceInfo(liveStandings(grid, new Map()), grid, 'me', 1000, 1000, 1)?.lap).toBe(1);
    expect(selfRaceInfo(rows, riders, 'inconnu', 1000, 1000, 1)).toBeNull();
  });

  it('mise en forme des temps, écarts, états et compte à rebours', () => {
    expect(formatRaceTime(754_000)).toBe('12:34');
    expect(formatRaceTime(3_723_000)).toBe('1:02:03');
    expect(formatGap(400)).toBe('m.t.');
    expect(formatGap(12_400)).toBe('+ 12 s');
    expect(formatGap(65_000)).toBe('+ 1:05');
    expect(statusLabel('otl', 'fr')).toBe('hors délai');
    expect(statusLabel('dnf', 'en')).toBe('DNF');
    expect(countdownLabel(9_200, 'fr')).toBe('10');
    expect(countdownLabel(800, 'fr')).toBe('1');
    expect(countdownLabel(-200, 'fr')).toBe('Partez !');
    expect(countdownLabel(-2000, 'fr')).toBeNull();
  });

  it('bande de l’allure annoncée (±8 %)', () => {
    expect(paceBand(2.5, 2.5)).toBe('ok');
    expect(paceBand(2.8, 2.5)).toBe('high');
    expect(paceBand(2.2, 2.5)).toBe('low');
  });
});
