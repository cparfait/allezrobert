/**
 * Départ d'une course (en ligne, locale, contre-la-montre) : sur la ligne ou la rampe, les compteurs restent masqués pour
 * que la carte « Lancer » et le compte à rebours se lisent bien ; ils apparaissent quelques secondes après le départ.
 * Testé (startHud.test.ts).
 */

/** Secondes roulées avant l'apparition des compteurs. */
export const START_HUD_DELAY_S = 4;

/** Compteurs masqués ? `elapsedS` : temps roulé (0 tant que le départ n'est pas donné). */
export function hudHeldAtStart(race: boolean, elapsedS: number): boolean {
  return race && elapsedS < START_HUD_DELAY_S;
}
