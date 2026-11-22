import { describe, expect, it } from 'vitest';
import { GroupTalk, SensorLossWatch, catchUpSteps, hardwareCommand, rideKeyAction } from '../src/game/rideControls.ts';

describe('touches de la sortie', () => {
  it('caméras 1 à 8, pause, allure et lettres', () => {
    expect(rideKeyAction({ key: '3', code: 'Digit3' })).toEqual({ kind: 'camera', mode: 'action' });
    expect(rideKeyAction({ key: '&', code: 'Digit1' })).toEqual({ kind: 'camera', mode: 'chase' }); // AZERTY sans Maj
    expect(rideKeyAction({ key: '1', code: 'Digit1', altKey: true })).toBeNull(); // Alt+1 : panneau F3
    expect(rideKeyAction({ key: ' ', code: 'Space' })).toEqual({ kind: 'pause' });
    expect(rideKeyAction({ key: 'Escape', code: 'Escape' })).toEqual({ kind: 'pause' });
    expect(rideKeyAction({ key: ']', code: 'BracketRight' })).toEqual({ kind: 'pace', delta: 1 });
    expect(rideKeyAction({ key: '-', code: 'NumpadSubtract' })).toEqual({ kind: 'pace', delta: -1 });
    expect(rideKeyAction({ key: 'U', code: 'KeyU' })).toEqual({ kind: 'uturn' });
    expect(rideKeyAction({ key: 'g', code: 'KeyG' })).toEqual({ kind: 'ghost' });
    expect(rideKeyAction({ key: 'z', code: 'KeyW' })).toBeNull();
  });
});

describe('boutons du cintre', () => {
  const riding = { paused: false, pauseOpen: false };
  const pause = { paused: true, pauseOpen: true };
  const summary = { paused: true, pauseOpen: false };
  it('en roulant : vitesses, et « menu » met en pause', () => {
    expect(hardwareCommand('up', riding)).toEqual({ kind: 'shift', action: 'up' });
    expect(hardwareCommand('menu', riding)).toEqual({ kind: 'togglePause' });
  });
  it('en pause : navigation, valider, retour reprend', () => {
    expect(hardwareCommand('down', pause)).toEqual({ kind: 'focus', dir: 'down' });
    expect(hardwareCommand('steerLeft', pause)).toEqual({ kind: 'focus', dir: 'left' });
    expect(hardwareCommand('confirm', pause)).toEqual({ kind: 'activate' });
    expect(hardwareCommand('back', pause)).toEqual({ kind: 'togglePause' });
    expect(hardwareCommand('menu', pause)).toEqual({ kind: 'togglePause' });
  });
  it('sur le bilan : ni « menu » ni « retour » ne relancent la sortie', () => {
    expect(hardwareCommand('menu', summary)).toBeNull();
    expect(hardwareCommand('back', summary)).toBeNull();
    expect(hardwareCommand('confirm', summary)).toEqual({ kind: 'activate' });
  });
});

describe('messages du groupe', () => {
  it('relais quand on passe en tête, puis le groupe reprend la tête, un message toutes les 6 s au plus', () => {
    const g = new GroupTalk();
    expect(g.update(9, 0)).toBeNull();
    expect(g.update(0.1, 2)?.fr).toMatch(/relais/);
    expect(g.update(1, -3)).toBeNull(); // trop tôt après le premier message
    const g2 = new GroupTalk();
    g2.update(9, 0);
    g2.update(0.1, 2);
    expect(g2.update(7, -3)?.fr).toMatch(/reprend la tête/);
  });
  it('échappée : le groupe revient quand l’écart fond de 8 m', () => {
    const g = new GroupTalk();
    g.update(9, 0);
    g.update(0.1, 30); // relais
    g.update(7, 40);
    expect(g.update(1, 31)?.fr).toMatch(/reviennent/);
  });
});

describe('capteurs perdus', () => {
  it('bandeau tout de suite, pause une seule fois au bout de 5 s, remise à zéro au retour du signal', () => {
    const w = new SensorLossWatch(5);
    const lost = ['NEO 2T'];
    const r = [1, 2, 3, 4, 5, 6].map(() => w.tick(lost, true));
    expect(r[0]!.alert?.fr).toContain('NEO 2T');
    expect(r.map((x) => x.pause)).toEqual([false, false, false, false, true, false]);
    expect(w.tick([], true)).toEqual({ alert: null, pause: false });
    expect([1, 2, 3, 4, 5].map(() => w.tick(lost, true).pause).at(-1)).toBe(true);
  });
  it('jamais de pause automatique en groupe', () => {
    const w = new SensorLossWatch(1);
    expect(w.tick(['NEO'], false).pause).toBe(false);
  });
});

describe('horloge d’arrière-plan', () => {
  it('rattrape le temps par pas de 0,1 s, borné à 120 s', () => {
    const s = catchUpSteps(0.35);
    expect(s.length).toBe(4);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(0.35);
    expect(catchUpSteps(1000).length).toBe(1200);
    expect(catchUpSteps(-1)).toEqual([]);
  });
});
