/**
 * Déplacement latéral d'un coureur (déboîter pour doubler, se rabattre, s'écarter) : ressort amorti avec vitesse
 * et accélération plafonnées, au lieu d'un lissage exponentiel. Le lissage exponentiel part à pleine vitesse dès
 * que la cible change (à-coup visible au début de chaque écart) puis traîne ; ici le coureur prend de la vitesse
 * de côté progressivement, plafonne (≈ 1,3 m/s, comme un vrai écart à vélo) et ralentit en arrivant.
 */
export interface LateralMotion {
  /** Vitesse latérale (m/s), gardée d'une image à l'autre. */
  v: number;
}

export interface LateralTuning {
  /** Raideur (rad/s) : plus grand = rejoint la cible plus vite. */
  omega: number;
  /** Vitesse latérale maximale (m/s). */
  maxSpeed: number;
  /** Accélération latérale maximale (m/s²). */
  maxAccel: number;
}

/**
 * Essai du 17/11/2026, coupé par défaut (?lateralspring=1 pour l'activer) : mesure en V3 sur 20 s, pas de gain net
 * (images au-delà de 1,6 m/s : 0,56 % → 0,35 % ; variation moyenne de vitesse d'une image à l'autre : 0,069 →
 * 0,094). Les à-coups viennent surtout de la séparation des coureurs (separateRiders, poussée de 2,5 à 4 m/s).
 */
export const LATERAL_SPRING = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lateralspring') === '1';

export const LATERAL_CRUISE: LateralTuning = { omega: 1.6, maxSpeed: 1.0, maxAccel: 1.6 };
export const LATERAL_PASSING: LateralTuning = { omega: 2.2, maxSpeed: 1.4, maxAccel: 2.4 };
export const LATERAL_URGENT: LateralTuning = { omega: 4, maxSpeed: 2.5, maxAccel: 6 };

/** Nouveau décalage latéral après `dt` s vers `target` (amortissement critique, sous-pas de 1/60 s au plus). */
export function stepLateral(m: LateralMotion, lat: number, target: number, dt: number, t: LateralTuning): number {
  let left = Math.min(dt, 0.25);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 60);
    let a = t.omega * t.omega * (target - lat) - 2 * t.omega * m.v;
    a = Math.max(-t.maxAccel, Math.min(t.maxAccel, a));
    m.v = Math.max(-t.maxSpeed, Math.min(t.maxSpeed, m.v + a * h));
    lat += m.v * h;
    left -= h;
  }
  return lat;
}

/** Après un recadrage extérieur (bords de chaussée, façades) : la vitesse suit le déplacement réellement fait. */
export function syncLateral(m: LateralMotion, before: number, after: number, dt: number, t: LateralTuning): void {
  if (dt <= 0) return;
  m.v = Math.max(-t.maxSpeed, Math.min(t.maxSpeed, (after - before) / dt));
}
