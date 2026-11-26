/**
 * Météo locale de l'Île de Robert (mode Poly), ajoutée à la météo de la sortie : vent de mer plus fort à moins de
 * 400 m de la côte, brume du matin sur la lagune (5 h 30 – 9 h 30), averses passagères quand le ciel est chargé.
 */
export const LAGOON = { x: -10400, z: 7400, r: 2600 } as const;

export interface IslandMood {
  /** Facteur du vent (1 dans les terres). */
  wind: number;
  /** Brouillard minimal (0–1). */
  fog: number;
  /** Pluie minimale (0–1). */
  rain: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** `heightAt` : altitude du sol (mer < 0 m), NaN hors des tuiles chargées. */
export function islandWeather(x: number, z: number, hour: number, elapsedS: number, clouds: number, heightAt: (x: number, z: number) => number): IslandMood {
  // Côte : part des huit directions où la mer est à 400 m.
  let sea = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const y = heightAt(x + Math.cos(a) * 400, z + Math.sin(a) * 400);
    if (Number.isFinite(y) && y < 0) sea++;
  }
  const wind = 1 + Math.min(1, sea / 3) * 0.4;
  // Brume du matin sur la lagune, plus épaisse au centre.
  const d = Math.hypot(x - LAGOON.x, z - LAGOON.z);
  const morning = smooth(5.5, 6.5, hour) * (1 - smooth(8.5, 9.5, hour));
  const fog = 0.5 * morning * (1 - smooth(LAGOON.r * 0.5, LAGOON.r, d));
  // Averses : sous un ciel couvert à plus de 65 %, trois minutes de pluie environ tous les quarts d'heure.
  const cycle = (elapsedS % 900) / 900;
  const shower = Math.max(0, Math.sin(cycle * Math.PI * 2 - 1.2)) ** 6;
  const rain = clouds > 0.65 ? 0.55 * shower * smooth(0.65, 0.85, clouds) : 0;
  return { wind, fog, rain };
}
