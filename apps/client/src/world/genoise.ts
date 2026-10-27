/**
 * Génoise (rangs de tuiles canal en encorbellement sous l'égout), sans dépendance à Three.js.
 *
 * Trois rangs de 14 cm, en saillie de 10, 20 et 30 cm du bas vers le haut. Le pan du toit passe par
 * le haut du mur et descend vers l'extérieur ; la génoise le porte : elle est abaissée pour que l'arête
 * haute de chaque rang reste sous le pan (2 cm de jeu), sinon le rang du haut traverse la couverture.
 */
export interface GenoiseRow {
  /** Saillie depuis le nu du mur (m). */
  d: number;
  /** Bas et haut du rang (m, même repère que `top`). */
  y0: number;
  y1: number;
}

const ROW_H = 0.14;
const GAP = 0.02;

/** Abaissement de la génoise sous le haut du mur pour un pan de pente `pitchDeg` (m). */
export function genoiseDrop(pitchDeg: number): number {
  const tan = Math.tan((Math.max(pitchDeg, 0) * Math.PI) / 180);
  // le rang k (saillie 0,1·(k+1)) a son haut à top − drop − 0,14·(2 − k) ; le plus contraint est le dernier
  let drop = 0;
  for (let k = 0; k < 3; k++) drop = Math.max(drop, 0.1 * (k + 1) * tan + GAP - ROW_H * (2 - k));
  return drop;
}

/** Rangs de la génoise sous un mur dont le haut est à `top`, abaissés de `drop`. */
export function genoiseRows(top: number, drop: number): GenoiseRow[] {
  const rows: GenoiseRow[] = [];
  for (let k = 0; k < 3; k++) {
    const y1 = top - drop - ROW_H * (2 - k);
    rows.push({ d: 0.1 * (k + 1), y0: y1 - ROW_H, y1 });
  }
  return rows;
}
