import { surfaceFromOsm, type Surface } from '../audio/soundscape.ts';

/**
 * Vibration de la caméra sur un mauvais revêtement : secousses verticales et de tangage, d'autant plus
 * fortes que le revêtement est dur et que l'on roule vite. Fonctions pures (testées sous Node).
 */

/** Niveau de vibration d'un revêtement (1 = pavés). L'enrobé de campagne ne vibre presque pas. */
export const SURFACE_BUZZ: Readonly<Record<Surface, number>> = { smooth: 0, rough: 0.12, cobbles: 1, gravel: 0.45, dirt: 0.35 };

/** Niveau de vibration d'après le tag OSM `surface` du tronçon. */
export function buzzLevel(osmSurface: string | undefined): number {
  return SURFACE_BUZZ[surfaceFromOsm(osmSurface)];
}

/** Amplitude verticale (m) et de tangage (rad) à pleine vibration, pour une caméra solidaire du coureur. */
const DY = 0.016;
const PITCH = 0.0055;
/** Fréquences (Hz) des chocs : sous la moitié de la cadence d'image, sans rapport entre elles pour ne pas battre régulièrement. */
const FREQS = [11.3, 17.9, 26.3] as const;
const WEIGHTS = [0.5, 0.33, 0.17] as const;

/** Déplacement vertical (m) et tangage (rad) de la caméra à l'instant `timeS` ; nul à l'arrêt et sur l'enrobé lisse. */
export function buzzOffset(timeS: number, speedMs: number, level: number): { dy: number; pitch: number } {
  const k = level * Math.min(Math.max(speedMs, 0) / 8, 1);
  if (k <= 0) return { dy: 0, pitch: 0 };
  let dy = 0;
  let pitch = 0;
  FREQS.forEach((f, i) => {
    const w = WEIGHTS[i] as number;
    dy += w * Math.sin(2 * Math.PI * f * timeS + i * 1.7);
    // Le tangage n'est pas en phase avec la hauteur : la roue avant et la roue arrière ne frappent pas ensemble.
    pitch += w * Math.sin(2 * Math.PI * f * timeS + i * 2.9 + 1.1);
  });
  return { dy: dy * DY * k, pitch: pitch * PITCH * k };
}
