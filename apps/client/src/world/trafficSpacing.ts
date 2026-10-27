/**
 * Espacement de la circulation : aucun véhicule n'en rattrape ni n'en traverse un autre.
 * Code pur (sans three.js), testé dans test/trafficSpacing.test.ts.
 *
 * - Même sens : chaque véhicule règle sa vitesse sur celui de devant pour pouvoir s'arrêter derrière lui
 *   s'il pilait (`followSpeed`), puis `keepApart` garantit un écart minimal quoi qu'il arrive.
 * - Sens contraires : un véhicule sorti de sa voie (dépassement d'un coureur) y est ramené avant de croiser.
 */

/** Ce que l'espacement lit et corrige d'un véhicule. */
export interface Spaced {
  /** Distance déroulée sur l'itinéraire (m), centre du véhicule. */
  d: number;
  /** +1 : sens des coureurs ; −1 : en face. */
  sens: 1 | -1;
  /** Longueur (m). */
  length: number;
  /** Vitesse (m/s, positive). */
  speed: number;
  /** Décalage latéral (m). */
  lateral: number;
}

/** Écart visé de pare-chocs à pare-chocs derrière le véhicule de devant, à l'arrêt (m). */
export const FOLLOW_GAP_M = 4;
/** Écart en dessous duquel un véhicule n'est jamais laissé, même au prix d'un recul (m). */
export const HARD_GAP_M = 1.5;
/** Décélération supposée du véhicule de devant et la nôtre pour régler la vitesse de suivi (m/s²). */
const FOLLOW_DECEL = 4;
/** En dessous de cet écart latéral, deux véhicules de sens contraires se touchent (m). */
export const LANE_CLEAR_M = 2;

/** Véhicule le plus proche devant `v` dans son sens de marche, et l'écart de pare-chocs à pare-chocs (m). */
export function leaderOf<T extends Spaced>(v: T, all: readonly T[], present: (o: T) => boolean = () => true): { leader: T; gap: number } | null {
  let best: { leader: T; gap: number } | null = null;
  for (const o of all) {
    if (o === v || o.sens !== v.sens || !present(o)) continue;
    const ahead = (o.d - v.d) * v.sens;
    if (ahead < 0) continue;
    const gap = ahead - (o.length + v.length) / 2;
    if (!best || gap < best.gap) best = { leader: o, gap };
  }
  return best;
}

/** Vitesse maximale (m/s) pour s'arrêter à FOLLOW_GAP_M derrière un véhicule qui roule à `leaderSpeed` et freinerait aussi fort que nous. */
export function followSpeed(gap: number, leaderSpeed: number): number {
  return Math.sqrt(Math.max(0, leaderSpeed * leaderSpeed + 2 * FOLLOW_DECEL * (gap - FOLLOW_GAP_M)));
}

/** Vrai si un véhicule de sens contraire, dans `range` m devant `v`, occupe la voie où se trouve `v`. */
export function oncomingInLane<T extends Spaced>(v: T, all: readonly T[], range: number, present: (o: T) => boolean = () => true): boolean {
  return all.some((o) => o.sens !== v.sens && present(o) && Math.abs(o.lateral - v.lateral) < LANE_CLEAR_M && (o.d - v.d) * v.sens > -(o.length + v.length) / 2 && (o.d - v.d) * v.sens < range);
}

/**
 * Garantit qu'aucun véhicule n'en chevauche un autre, après le pas de déplacement :
 * - même sens : de l'avant vers l'arrière, chaque véhicule trop proche de celui de devant recule à HARD_GAP_M
 *   derrière lui et ne roule pas plus vite que lui ;
 * - sens contraires qui se croisent sans place latérale : celui qui est sorti de sa voie y revient aussitôt.
 */
export function keepApart<T extends Spaced>(all: readonly T[], laneOf: (sens: 1 | -1) => number, present: (o: T) => boolean = () => true): void {
  for (const sens of [1, -1] as const) {
    const lane = all.filter((v) => v.sens === sens && present(v)).sort((a, b) => (b.d - a.d) * sens);
    for (let i = 1; i < lane.length; i++) {
      const front = lane[i - 1] as T;
      const v = lane[i] as T;
      const min = (front.length + v.length) / 2 + HARD_GAP_M;
      if ((front.d - v.d) * sens < min) {
        v.d = front.d - sens * min;
        v.speed = Math.min(v.speed, front.speed);
      }
    }
  }
  for (const a of all) {
    if (a.sens < 0 || !present(a)) continue;
    for (const b of all) {
      if (b.sens > 0 || !present(b)) continue;
      if (Math.abs(a.d - b.d) >= (a.length + b.length) / 2 + 2 || Math.abs(a.lateral - b.lateral) >= LANE_CLEAR_M) continue;
      const out = Math.abs(a.lateral - laneOf(1)) >= Math.abs(b.lateral - laneOf(-1)) ? a : b;
      out.lateral = laneOf(out.sens);
    }
  }
}
