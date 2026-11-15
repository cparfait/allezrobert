import { describe, expect, it } from 'vitest';
import { WorkoutController, type FtpTestEnd } from '../src/game/workout.ts';
import { FtpCoach, COACH_PRELOAD, type CoachLine } from '../src/game/ftpCoach.ts';
import { coachLines, coachMessageKey, ftpTestMessages, numberFr, numberKeys, wattsKeys, wkgKeys } from '../src/audio/coachLines.ts';
import type { FtpTestProtocol } from '@allezrobert/physics';

interface Run {
  lines: CoachLine[];
  end: [number | null, FtpTestEnd] | null;
}

/** Test complet seconde par seconde, contrôleur et coach branchés comme dans le jeu. */
function run(kind: FtpTestProtocol, seconds: number, watts: (t: number, target: number | null) => number, lang: 'fr' | 'en' = 'fr', cadence = 85): Run {
  const c = new WorkoutController(kind, 250);
  const coach = new FtpCoach(kind, lang);
  const r: Run = { lines: [], end: null };
  c.onMessage = (m) => r.lines.push(...coach.message(m));
  c.onFinished = (ftp, end) => {
    r.end = [ftp, end];
    r.lines.push(...coach.finished({ ftp, end, oldFtp: 250, massKg: 70, live: c.liveEstimate() }));
  };
  let target: number | null = c.runner.at(0).targetWatts;
  for (let t = 0; t < seconds; t++) {
    const w = watts(t, target);
    const out = c.update(t, w);
    r.lines.push(...coach.update({ elapsedS: t, position: c.position, watts: w, cadence, live: () => c.liveEstimate(), ended: c.ended }));
    target = out ?? c.runner.at(t + 1).targetWatts;
  }
  return r;
}

const has = (r: Run, key: string) => r.lines.some((l) => l.keys.includes(key));
const allKeys = (r: Run) => r.lines.flatMap((l) => l.keys);

describe('banque de phrases du coach', () => {
  it('nombres et watts en morceaux', () => {
    expect(numberKeys(245)).toEqual(['c2', 'n45']);
    expect(numberKeys(200)).toEqual(['cs2']);
    expect(numberKeys(100)).toEqual(['c1']);
    expect(numberKeys(37)).toEqual(['n37']);
    expect(wattsKeys(162.4)).toEqual(['c1', 'n62', 'watts']);
    expect(wkgKeys(3.44)).toEqual(['n3', 'virgule', 'n4', 'wattsPerKilo']);
    expect([71, 80, 81, 91, 21].map(numberFr)).toEqual(['soixante et onze', 'quatre-vingts', 'quatre-vingt-un', 'quatre-vingt-onze', 'vingt et un']);
  });

  it('chaque message écrit des tests a sa phrase enregistrée (français)', () => {
    const fr = coachLines('fr');
    for (const m of ftpTestMessages()) expect(fr[coachMessageKey(m)]).toBeTruthy();
    expect(fr[coachMessageKey(ftpTestMessages()[2] as string)]).toContain('watts');
  });

  it('les alertes préchargées existent dans les deux langues', () => {
    for (const lang of ['fr', 'en'] as const) for (const k of COACH_PRELOAD) expect(coachLines(lang)[k]).toBeTruthy();
  });
});

describe('coach de la rampe', () => {
  // Suit la consigne jusqu'au 13e palier (340 W), puis s'effondre à 150 W.
  const lastOk = 300 + 13 * 60;
  const ramp = run('ramp', lastOk + 40, (t, target) => (t < lastOk ? (target ?? 100) : 150));

  it('annonce les paliers et la première estimation au 4e palier', () => {
    const step4 = ramp.lines.find((l) => l.keys[0] === 'palier' && l.keys[1] === 'n4');
    // Trois paliers tenus (100, 120, 140 W) : meilleure minute 140 W, FTP estimée 105 W.
    expect(step4?.keys).toEqual(['palier', 'n4', 'c1', 'n60', 'watts', 'firstEstimate', 'c1', 'n5', 'watts', 'risesEachStep']);
    expect(has(ramp, 'warmupTen')).toBe(true);
    expect(has(ramp, 'ten0') || has(ramp, 'ten1') || has(ramp, 'ten2')).toBe(true);
  });

  it('prévient avant l’arrêt puis dit le bilan', () => {
    const urgent = ramp.lines.filter((l) => l.urgent).map((l) => l.keys[0]);
    expect(urgent.slice(0, 2)).toEqual(['belowTarget', 'fiveSeconds']);
    expect(ramp.end).toEqual([255, 'failed']);
    const last = ramp.lines.at(-1) as CoachLine;
    expect(last.keys.slice(0, 3)).toEqual(['endHeld', 'n13', 'stepsDot']);
    expect(last.keys).toContain('bestMinute');
    // 255 W pour 70 kg : 3,6 W/kg ; 5 W de plus que l'ancienne FTP (250 W).
    expect(last.keys).toEqual(expect.arrayContaining(['that', 'n3', 'virgule', 'n6', 'wattsPerKilo', 'n5', 'moreWatts', 'chooseRamp']));
  });

  it('« tu as raccroché » après une alerte suivie d’une relance', () => {
    const r = run('ramp', 300 + 6 * 60, (t, target) => {
      const tg = target ?? 100;
      return t >= 300 + 3 * 60 + 10 && t < 300 + 3 * 60 + 17 ? tg * 0.5 : tg;
    });
    expect(has(r, 'belowTarget')).toBe(true);
    expect(has(r, 'fiveSeconds')).toBe(false);
    expect(has(r, 'backOn')).toBe(true);
    expect(r.end).toBeNull();
  });

  it('conseil de cadence quand elle reste basse', () => {
    const r = run('ramp', 300 + 3 * 60, (_t, target) => target ?? 100, 'fr', 60);
    expect(has(r, 'cadenceLow')).toBe(true);
  });

  it('toutes les clés dites existent dans la banque (français et anglais)', () => {
    for (const lang of ['fr', 'en'] as const) {
      const r = run('rampLite', 480 + 12 * 60, (t, target) => (t < 480 + 10 * 60 ? (target ?? 50) : 20), lang);
      const bank = coachLines(lang);
      expect(allKeys(r).filter((k) => !bank[k])).toEqual([]);
      if (lang === 'en') expect(allKeys(r).some((k) => k.startsWith('msg-'))).toBe(false);
    }
    const bank = coachLines('fr');
    expect(allKeys(ramp).filter((k) => !bank[k])).toEqual([]);
  });

  it('effort trop court : phrase dédiée', () => {
    const r = run('ramp', 300 + 2 * 60 + 30, (t, target) => (t < 300 + 60 ? (target ?? 100) : 0));
    expect(r.end?.[0]).toBeNull();
    expect((r.lines.at(-1) as CoachLine).keys).toEqual(['tooShortRamp']);
  });
});

describe('coach du test 20 min', () => {
  const c = new WorkoutController('ftp20', 250);
  const total = c.durationS;
  // Suit les consignes, 260 W pendant les 20 minutes libres.
  const r = run('ftp20', total + 1, (_t, target) => target ?? 260);

  it('accélérations, compte à rebours, moyenne en cours d’effort', () => {
    expect(has(r, 'int0') && has(r, 'int1') && has(r, 'int2')).toBe(true);
    expect(has(r, 'ftp20Ten')).toBe(true);
    const first = r.lines.find((l) => l.keys[0] === 'avgExplain');
    // ≈ 260 W de moyenne (la première seconde garde la consigne de la récupération) : FTP ≈ 247 W.
    expect(first?.keys).toEqual(['avgExplain', 'c2', 'n59', 'watts', 'thusFtp', 'c2', 'n46', 'watts']);
    expect(r.lines.filter((l) => l.keys[0] === 'average')).toHaveLength(3);
    expect(has(r, 'twentyDone')).toBe(true);
  });

  it('bilan à la fin et clés connues', () => {
    expect(r.end).toEqual([247, 'completed']);
    expect((r.lines.at(-1) as CoachLine).keys.slice(0, 2)).toEqual(['testDone', 'estimatedFtp']);
    const bank = coachLines('fr');
    expect(allKeys(r).filter((k) => !bank[k])).toEqual([]);
  });

  it('« tu baisses » quand la puissance chute', () => {
    const start = c.runner.stepStartS(c.workout.steps.findIndex((s) => s.kind === 'freeRide'));
    const f = run('ftp20', start + 400, (t, target) => (t < start ? (target ?? 0) : t < start + 300 ? 280 : 200));
    expect(has(f, 'fadingTo')).toBe(true);
  });
});
