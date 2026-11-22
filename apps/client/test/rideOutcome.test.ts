import { describe, expect, it } from 'vitest';
import { accountView, exportView, rideEndOf, rideEndView, saveView, type RideEndInput } from '../src/ui/rideOutcome.ts';

const base: RideEndInput = { ftpTest: false, ftpHasResult: false, racingAtEnd: false, raceRank: 0, challengeDone: false, workout: false, workoutFinished: false, routeFinished: false };

describe('fin de sortie : chaque fin a son bilan', () => {
  it('distingue arrivée, arrêt volontaire, abandon, course classée, séance et test FTP', () => {
    expect(rideEndOf(base)).toBe('stopped');
    expect(rideEndOf({ ...base, routeFinished: true })).toBe('arrived');
    expect(rideEndOf({ ...base, racingAtEnd: true })).toBe('abandoned');
    expect(rideEndOf({ ...base, raceRank: 3, routeFinished: true })).toBe('race_finished');
    expect(rideEndOf({ ...base, workout: true })).toBe('workout_stopped');
    expect(rideEndOf({ ...base, workout: true, workoutFinished: true })).toBe('workout_done');
    expect(rideEndOf({ ...base, challengeDone: true })).toBe('challenge_done');
    expect(rideEndOf({ ...base, ftpTest: true, workout: true })).toBe('ftp_none');
    expect(rideEndOf({ ...base, ftpTest: true, ftpHasResult: true })).toBe('ftp_done');
  });

  it('un abandon en course prime sur l’arrivée de l’itinéraire, et un test FTP sur tout', () => {
    expect(rideEndOf({ ...base, racingAtEnd: true, routeFinished: true })).toBe('abandoned');
    expect(rideEndOf({ ...base, ftpTest: true, racingAtEnd: true, routeFinished: true })).toBe('ftp_none');
  });

  it('dit le résultat en un mot, sans féliciter un abandon ni un test sans résultat', () => {
    const stopped = rideEndView('stopped', { fr: true, canResume: true });
    expect(stopped.word).toBe('Arrêt volontaire');
    expect(stopped.detail).toContain('Reprendre');
    expect(rideEndView('stopped', { fr: true }).detail).not.toContain('Reprendre');
    const dnf = rideEndView('abandoned', { fr: true });
    expect(dnf.tone).toBe('warn');
    expect(dnf.title).not.toContain('Bravo');
    expect(dnf.detail).toContain('Non classé');
    expect(rideEndView('race_finished', { fr: true, raceRank: 1 }).title).toContain('1re place');
    expect(rideEndView('race_finished', { fr: false, raceRank: 22 }).title).toContain('22nd place');
    const none = rideEndView('ftp_none', { fr: true, oldFtp: 249.6 });
    expect(none.tone).toBe('warn');
    expect(none.detail).toContain('250 W');
    expect(rideEndView('arrived', { fr: true }).tone).toBe('ok');
  });
});

describe('fin de sortie : sauvegarde, FIT et envois', () => {
  it('la sauvegarde dit si la sortie est gardée et pourquoi elle ne l’est pas', () => {
    expect(saveView('saved', true).tone).toBe('ok');
    expect(saveView('too_short', true).detail).toContain('une minute');
    expect(saveView('failed', true).tone).toBe('bad');
    expect(saveView('failed', true).detail).toContain('FIT');
    expect(saveView('guest', true).detail).toContain('invité');
  });

  it('le compte prévient tant que le FIT n’est pas envoyé', () => {
    expect(accountView('to_send', true).tone).toBe('warn');
    expect(accountView('sent', true).tone).toBe('ok');
    expect(accountView('failed', true).tone).toBe('bad');
    expect(accountView('signed_out', true).detail).toContain('télécharge');
  });

  it('un export tiers échoué reste réessayable, un export réussi ne l’est plus', () => {
    expect(exportView('failed', true, true)).toMatchObject({ tone: 'bad', retry: true, retryLabel: 'Réessayer' });
    expect(exportView('uploaded', true, true)).toMatchObject({ tone: 'ok', retry: false });
    // Service délié depuis l'échec : rien à réessayer tant qu'il n'est pas relié.
    expect(exportView('failed', false, true).retry).toBe(false);
    expect(exportView(null, false, true)).toMatchObject({ word: 'Non relié', retry: false });
    // Envoi désactivé (Garmin) ou service relié après coup : envoi possible à la demande.
    expect(exportView('skipped', true, true)).toMatchObject({ retry: true, retryLabel: 'Envoyer' });
    expect(exportView(null, true, true).retry).toBe(true);
  });
});
