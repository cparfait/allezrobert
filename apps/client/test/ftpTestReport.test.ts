import { describe, expect, it } from 'vitest';
import { bestWindow, buildFtpReport, ftpReportView, ftpTestChartSvg, ftpZones, levelIndex, type FtpReportInput } from '../src/ui/ftpTestReport.ts';
import { FtpCoach } from '../src/game/ftpCoach.ts';
import { coachLines } from '../src/audio/coachLines.ts';


/** Rampe : 5 min à 100 W, puis paliers de +20 W tenus jusqu'à 340 W (13 paliers), puis effondrement. */
function rampInput(over: Partial<FtpReportInput> = {}): FtpReportInput {
  const samples: number[] = [];
  for (let t = 0; t < 300; t++) samples.push(100);
  for (let i = 0; i < 13; i++) for (let t = 0; t < 60; t++) samples.push(100 + 20 * i);
  for (let t = 0; t < 20; t++) samples.push(150);
  const steps = [{ startS: 0, durationS: 300, target: [100, 100] as [number, number] }];
  for (let i = 0; i < 30; i++) steps.push({ startS: 300 + 60 * i, durationS: 60, target: [100 + 20 * i, 100 + 20 * i] });
  return {
    protocol: 'ramp',
    name: 'Test rampe',
    result: { oldFtp: 240, newFtp: 255, massKg: 70, end: 'failed', basis: { kind: 'bestMinute', watts: 340 } },
    decision: 'pending',
    oldFtp: 240,
    massKg: 70,
    samples,
    steps,
    effortStartS: 300,
    stepsHeld: 13,
    maxHr: 182,
    avgCadence: 88,
    history: [
      { t: Date.UTC(2026, 8, 1), ftp: 230, source: 'manual' },
      { t: Date.UTC(2026, 8, 20), ftp: 240, source: 'ramp' },
    ],
    now: Date.UTC(2026, 10, 15),
    ...over,
  };
}

describe('bilan du test FTP', () => {
  it('meilleure fenêtre glissante', () => {
    expect(bestWindow([1, 5, 5, 1, 9, 9], 2)).toEqual({ startS: 4, durationS: 2, watts: 9 });
    expect(bestWindow([1, 2], 3)).toBeNull();
  });

  it('rampe : meilleure minute en surbrillance, profil limité à la durée roulée', () => {
    const r = buildFtpReport(rampInput());
    expect(r.bestMinute).toEqual({ startS: 300 + 12 * 60, durationS: 60, watts: 340 });
    expect(r.highlight).toEqual(r.bestMinute);
    // 18 min 20 s roulées : pas de valeur sur 20 minutes.
    expect(r.profile.map((p) => p.durationS)).toEqual([5, 60, 300]);
    expect(r.maxW).toBe(340);
  });

  it('textes : titre, niveau, progression, prochain test, tuiles', () => {
    const v = ftpReportView(buildFtpReport(rampInput()), true);
    expect(v.title).toContain('255 W');
    // 255 / 70 = 3,64 W/kg : « Bon niveau ».
    expect(v.level).toMatchObject({ name: 'Bon niveau' });
    expect(v.sinceLastText).toContain('+15 W');
    expect(v.sinceLastText).toContain('8 semaines');
    expect(v.nextTestText).toContain('27 décembre 2026');
    expect(v.tiles[0]).toEqual(['Paliers tenus', '13']);
    expect(v.zonesFtp).toBe(255);
    expect(ftpReportView(buildFtpReport(rampInput({ decision: 'old' })), true).zonesFtp).toBe(240);
  });

  it('effort trop court : pas de titre de FTP, FTP inchangée', () => {
    const v = ftpReportView(buildFtpReport(rampInput({ result: null, stepsHeld: 1 })), true);
    expect(v.title).toContain('pas de résultat');
    expect(v.decisionText).toContain('240 W');
    expect(v.level).toBeNull();
  });

  it('zones et niveaux', () => {
    expect(ftpZones(200, true).map((z) => z.range)).toEqual(['< 110 W', '110–150 W', '150–180 W', '180–210 W', '210–240 W', '240–300 W', '> 300 W']);
    expect([1.5, 2.5, 3, 3.6, 4.2, 5, 6].map(levelIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('courbe du test : consigne, puissance, surbrillance et ligne de FTP', () => {
    const svg = ftpTestChartSvg(buildFtpReport(rampInput()), true);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('Ta meilleure minute : 340 W');
    expect(svg).toContain('FTP 255 W');
  });

  it('test 20 min : surbrillance des 20 minutes', () => {
    const samples = [...Array.from({ length: 600 }, () => 150), ...Array.from({ length: 1200 }, () => 260), ...Array.from({ length: 300 }, () => 120)];
    const r = buildFtpReport(rampInput({ protocol: 'ftp20', samples, effortStartS: 600, stepsHeld: null, steps: [] }));
    expect(r.highlight).toEqual({ startS: 600, durationS: 1200, watts: 260 });
    expect(ftpReportView(r, true).tiles[0]).toEqual(['Moyenne 20 min', '260 W']);
  });
});

describe('voix du bilan', () => {
  const bank = coachLines('fr');
  it('bilan FTP au lieu du bilan de sortie, clés enregistrées', () => {
    const c = new FtpCoach('ramp', 'fr');
    const [l] = c.report({ ftp: 255, massKg: 70, decision: 'pending' });
    expect(l?.keys).toEqual(['reportIntro', 'estimatedFtp', 'c2', 'n55', 'watts', 'that', 'n3', 'virgule', 'n6', 'wattsPerKilo', 'level3', 'choose20', 'nextTest']);
    for (const lang of ['fr', 'en'] as const) {
      const b = coachLines(lang);
      const keys = [...(l?.keys ?? []), ...c.report({ ftp: null, massKg: 70, decision: 'pending' })[0]!.keys, ...c.decision(true)[0]!.keys, ...c.decision(false)[0]!.keys];
      expect(keys.filter((k) => !b[k])).toEqual([]);
    }
    for (let i = 0; i < 7; i++) expect(bank[`level${i}`]).toBeTruthy();
  });

  it('sortie quittée en plein test : la voix dit aussi le résultat', () => {
    const c = new FtpCoach('ramp', 'fr');
    const lines = c.finished({ ftp: 230, end: 'quit', oldFtp: 240, massKg: 70, live: { ftp: 230, basisWatts: 307, basis: 'bestMinute' } });
    expect(lines[0]?.keys[0]).toBe('endHeld');
    expect(lines[0]?.keys).toContain('lessWatts');
  });
});
