import { describe, expect, it } from 'vitest';
import { RAMP_FAIL_S, RAMP_MIN_STEPS, WorkoutController, ftpTestProtocolOf, isFtpTestKind, type FtpTestEnd } from '../src/game/workout.ts';
import { ftpResultView } from '../src/ui/ftpResult.ts';

/** Fait rouler le contrôleur seconde par seconde ; `watts(t, cible)` donne la puissance mesurée. */
function ride(c: WorkoutController, seconds: number, watts: (t: number, target: number | null) => number): void {
  let target: number | null = c.runner.at(0).targetWatts;
  for (let t = 0; t < seconds; t++) {
    const out = c.update(t, watts(t, target));
    target = out ?? c.runner.at(t + 1).targetWatts;
  }
}

describe('test rampe : fin automatique', () => {
  it('s’arrête après 15 s sous la cible et donne 75 % de la meilleure minute', () => {
    const c = new WorkoutController('ramp', 250);
    const ends: Array<[number | null, FtpTestEnd]> = [];
    c.onFinished = (ftp, end) => ends.push([ftp, end]);
    // Suit la consigne jusqu'au palier 340 W (13e palier, fin à 300 + 13·60 s), puis s'effondre à 150 W.
    const lastOk = 300 + 13 * 60;
    ride(c, lastOk + 40, (t, target) => (t < lastOk ? (target ?? 100) : 150));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual([Math.round(0.75 * 340), 'failed']);
    expect(c.ended).toBe(true);
    // Après la fin : plus de consigne ERG.
    expect(c.update(lastOk + 41, 0)).toBeNull();
  });

  it('une baisse brève sous la cible ne termine pas le test', () => {
    const c = new WorkoutController('ramp', 250);
    let ended = false;
    c.onFinished = () => (ended = true);
    ride(c, 300 + 8 * 60, (t, target) => {
      const tg = target ?? 100;
      // 10 s à 50 % au milieu du 4e palier : moins que les 15 s du seuil.
      return t >= 300 + 3 * 60 + 20 && t < 300 + 3 * 60 + 20 + (RAMP_FAIL_S - 5) ? tg * 0.5 : tg;
    });
    expect(ended).toBe(false);
  });

  it('l’échauffement ne déclenche pas la fin, même à 0 W', () => {
    const c = new WorkoutController('ramp', 250);
    let ended = false;
    c.onFinished = () => (ended = true);
    ride(c, 290, () => 0);
    expect(ended).toBe(false);
  });

  it('trop court (moins de 3 paliers) : pas de FTP', () => {
    const c = new WorkoutController('ramp', 250);
    let res: [number | null, FtpTestEnd] | null = null;
    c.onFinished = (ftp, end) => (res = [ftp, end]);
    ride(c, 300 + (RAMP_MIN_STEPS - 1) * 60, (_t, target) => target ?? 100);
    expect(c.stop()).toBeNull();
    expect(res).toEqual([null, 'quit']);
  });

  it('sortie quittée en plein test : résultat sur l’effort réalisé, une seule fois', () => {
    const c = new WorkoutController('rampLite', 200);
    const ends: FtpTestEnd[] = [];
    c.onFinished = (_f, end) => ends.push(end);
    // Rampe douce : 480 s d'échauffement, paliers 50 + 10·i ; 10 paliers tenus (le dernier à 140 W).
    ride(c, 480 + 10 * 60, (_t, target) => target ?? 50);
    expect(c.liveEstimate()).toEqual({ ftp: Math.round(0.75 * 140), basisWatts: 140, basis: 'bestMinute' });
    expect(c.stop()).toBe(Math.round(0.75 * 140));
    expect(c.stop()).toBeNull();
    expect(ends).toEqual(['quit']);
  });

  it('test 20 min : estimation sur l’effort libre seulement', () => {
    const c = new WorkoutController('ftp20', 250);
    const freeStart = 1200 + 180 + 300 + 300 + 600;
    // Échauffement suivi, puis 20 min libres à 280 W.
    ride(c, freeStart + 600, (t, target) => (t < freeStart ? (target ?? 125) : 280));
    expect(c.liveEstimate()).toEqual({ ftp: Math.round(0.95 * 280), basisWatts: 280, basis: 'average20' });
    // Quitter à mi-effort : pas de FTP (il faut les 20 minutes).
    expect(c.stop()).toBeNull();
  });

  it('les séances ordinaires ne sont pas concernées', () => {
    const c = new WorkoutController('library', 250, undefined, 'seuil-3x10');
    expect(c.liveEstimate()).toBeNull();
    expect(c.stop()).toBeNull();
    expect(isFtpTestKind('library')).toBe(false);
    expect(isFtpTestKind('rampLite')).toBe(true);
  });

  it('réglage du protocole : valeur inconnue → rampe standard', () => {
    expect(ftpTestProtocolOf('ftp20')).toBe('ftp20');
    expect(ftpTestProtocolOf('rampLite')).toBe('rampLite');
    expect(ftpTestProtocolOf(undefined)).toBe('ramp');
    expect(ftpTestProtocolOf('autre')).toBe('ramp');
  });
});

describe('écran de résultat du test FTP', () => {
  it('hausse : écart en watts et en %, W/kg, base du calcul', () => {
    const v = ftpResultView({ fr: true, oldFtp: 250, newFtp: 263, massKg: 75, end: 'failed', basis: { kind: 'bestMinute', watts: 350 } });
    expect(v.newText).toBe('263 W');
    expect(v.deltaText).toBe('+13 W (+5,2 %)');
    expect(v.trend).toBe(1);
    expect(v.wkgText).toBe('3,51 W/kg');
    expect(v.reason).toContain('15 secondes');
    expect(v.basisText).toContain('meilleure minute (350 W)');
  });

  it('baisse et égalité', () => {
    expect(ftpResultView({ fr: true, oldFtp: 250, newFtp: 240, massKg: 70, end: 'completed' }).deltaText).toBe('−10 W (−4,0 %)');
    expect(ftpResultView({ fr: true, oldFtp: 250, newFtp: 250, massKg: 70, end: 'completed' }).trend).toBe(0);
    expect(ftpResultView({ fr: false, oldFtp: 250, newFtp: 260, massKg: 70, end: 'quit' }).keepNew).toBe('Keep the new FTP');
  });
});
