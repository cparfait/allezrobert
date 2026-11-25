/**
 * Grille de départ d'une course, commune au jeu et au serveur : les coureurs sont répartis sur toute la largeur de la
 * chaussée (fermée à la circulation), en rangées régulières, puis le peloton se resserre peu à peu une fois lancé.
 */

/** Écart voulu entre deux voisins d'une même rangée (m) : guidons côte à côte sans se toucher. */
export const GRID_SIDE_M = 1.15;
/** Écart entre deux rangées (m) : un vélo et un peu d'air. */
export const GRID_ROW_M = 2.4;
/** Coureurs par rangée au plus. */
export const GRID_MAX_COLS = 8;
/** Chacun garde sa ligne de départ sur cette distance (m)… */
export const GRID_HOLD_M = 60;
/** … puis rejoint sa place dans le peloton jusqu'à cette distance (m). */
export const GRID_RELEASE_M = 220;
/** Tant qu'on garde sa ligne, seul un coureur à moins de cet écart latéral (m) est « devant » (pas les voisins de rangée). */
export const GRID_SAME_LINE_M = 0.8;

/**
 * Décalages (m, positif à droite) des places d'une rangée entre les bords utiles `lo` et `hi` de la chaussée, de gauche
 * à droite, répartis sur toute la largeur. Une seule place, au milieu, sur un chemin trop étroit.
 */
export function gridColumns(lo: number, hi: number): number[] {
  const width = Math.max(0, hi - lo);
  const n = Math.max(1, Math.min(GRID_MAX_COLS, Math.floor(width / GRID_SIDE_M + 1e-6) + 1));
  if (n === 1) return [(lo + hi) / 2];
  return Array.from({ length: n }, (_, k) => lo + (width * k) / (n - 1));
}

/** Numéros des places d'une rangée du centre vers les bords (les premiers servis sont au milieu). */
export function fromCentre(n: number): number[] {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, k) => k).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

/** Consigne latérale : ligne de départ au début, puis passage progressif à la place voulue dans le peloton. */
export function gridBlend(gridLateralM: number, targetM: number, travelledM: number): number {
  const t = Math.min(1, Math.max(0, (travelledM - GRID_HOLD_M) / (GRID_RELEASE_M - GRID_HOLD_M)));
  const k = t * t * (3 - 2 * t);
  return gridLateralM + (targetM - gridLateralM) * k;
}
