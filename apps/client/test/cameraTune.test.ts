import { beforeEach, describe, expect, it } from 'vitest';
import { CAMERA_TUNE, clampCameraTune, stepCameraTune } from '@allezrobert/shared';
import { cameraTuneOffsets, loadCameraTune, saveCameraTune } from '../src/game/cameraTune.ts';

// localStorage minimal pour les tests (Node).
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe('réglage de la caméra de poursuite', () => {
  beforeEach(() => localStorage.clear());

  it('avance d’un cran, reste dans les bornes, revient à l’origine', () => {
    let t = { height: 0, tilt: 0 };
    t = stepCameraTune(t, { height: 1 });
    t = stepCameraTune(t, { tilt: -1 });
    expect(t).toEqual({ height: 1, tilt: -1 });
    for (let i = 0; i < 30; i++) t = stepCameraTune(t, { height: 1, tilt: 1 });
    expect(t).toEqual({ height: CAMERA_TUNE.heightMax, tilt: CAMERA_TUNE.tiltMax });
    expect(stepCameraTune(t, { reset: true })).toEqual({ height: 0, tilt: 0 });
  });

  it('ignore les valeurs invalides', () => {
    expect(clampCameraTune({ height: Number.NaN, tilt: -99 })).toEqual({ height: 0, tilt: CAMERA_TUNE.tiltMin });
    expect(clampCameraTune(null)).toEqual({ height: 0, tilt: 0 });
  });

  it('est gardé d’une sortie à l’autre', () => {
    expect(loadCameraTune()).toEqual({ height: 0, tilt: 0 });
    saveCameraTune({ height: 3, tilt: 2 });
    expect(loadCameraTune()).toEqual({ height: 3, tilt: 2 });
    localStorage.setItem('ar-camera-tune', '{pas du json');
    expect(loadCameraTune()).toEqual({ height: 0, tilt: 0 });
  });

  it('donne des décalages en mètres et en radians', () => {
    const o = cameraTuneOffsets({ height: 2, tilt: -3 });
    expect(o.upM).toBeCloseTo(2 * CAMERA_TUNE.heightStepM);
    expect(o.tiltRad).toBeCloseTo((-3 * CAMERA_TUNE.tiltStepDeg * Math.PI) / 180);
  });
});
