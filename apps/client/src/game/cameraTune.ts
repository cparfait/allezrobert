/**
 * Réglage de la caméra de poursuite (hauteur, inclinaison) fait depuis l'appli compagnon : gardé sur ce poste
 * d'une sortie à l'autre. Les crans et leurs bornes sont dans `CAMERA_TUNE` (@allezrobert/shared).
 */
import { CAMERA_TUNE, clampCameraTune, type PairCameraTune } from '@allezrobert/shared';

const KEY = 'ar-camera-tune';

export function loadCameraTune(): PairCameraTune {
  try {
    return clampCameraTune(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PairCameraTune> | null);
  } catch {
    return { height: 0, tilt: 0 };
  }
}

export function saveCameraTune(t: PairCameraTune): void {
  try {
    if (t.height === 0 && t.tilt === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* stockage indisponible : réglage gardé pour cette sortie seulement */
  }
}

/** Décalages correspondants : hauteur en plus (m) et inclinaison vers le bas (rad, négatif = vers le haut). */
export function cameraTuneOffsets(t: PairCameraTune): { upM: number; tiltRad: number } {
  return { upM: t.height * CAMERA_TUNE.heightStepM, tiltRad: (t.tilt * CAMERA_TUNE.tiltStepDeg * Math.PI) / 180 };
}
