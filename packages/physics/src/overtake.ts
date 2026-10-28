/**
 * Dépassement propre d'un coureur plus lent par un coureur IA : la circulation se fait à droite, on double par la
 * gauche, assez tôt et avec un mètre d'écart, puis on se rabat seulement une fois la roue arrière dégagée. Sans
 * place pour passer (route étroite, voie de gauche occupée par ceux d'en face, bord de chaussée), l'IA reste dans la
 * roue au lieu de foncer sur celui de devant.
 *
 * Module pur et déterministe (aucun aléa) : partagé par le jeu (équipiers IA) et par le serveur (IA des sorties).
 */
import { BIKE_LENGTH_M, BIKE_WIDTH_M } from './collision.ts';

/** Un coureur vu par le doubleur. */
export interface LaneBody {
  id: string;
  distM: number;
  /** Décalage latéral (m, + = à droite dans le sens de marche). */
  lateralM: number;
  speedMs: number;
}

/** Écart latéral (centre à centre, m) laissé à celui qu'on double : le vélo, plus un demi-mètre. */
export const PASS_GAP_M = BIKE_WIDTH_M + 0.5;
/** Avance (m) sur le doublé, centre à centre, à partir de laquelle on peut se rabattre (la roue arrière est dégagée). */
export const PASS_CLEAR_M = BIKE_LENGTH_M + 1.5;
/** Distance (m) à laquelle on regarde devant soi. */
const LOOK_M = 45;
/** Vitesse relative (m/s) en dessous de laquelle on ne double pas (on roule « avec » lui). */
const MIN_CLOSING_MS = 0.4;
/** Les deux vélos se chevauchent si leurs axes sont plus proches que ceci (m) : il faut déboîter. */
const CONFLICT_M = PASS_GAP_M - 0.1;

/** Distance (m) à laquelle déboîter pour une vitesse d'approche donnée : la manœuvre dure environ trois secondes. */
export function reactionDistanceM(closingMs: number): number {
  return Math.min(LOOK_M - 5, 8 + 3 * Math.max(0, closingMs));
}

export interface OvertakePlan {
  /** Voie à tenir pour doubler (m) ; null : rester dans sa voie. */
  lateralM: number | null;
  /** Dépassement en cours : la roue de devant n'est plus à suivre. */
  passing: boolean;
  /** Coureur devant qu'on ne peut pas doubler : on reste dans sa roue à sa vitesse. */
  blocker: LaneBody | null;
}

export class Overtaker {
  /** Coureur en train d'être doublé et côté choisi (−1 : par la gauche, +1 : par la droite). */
  private target: { id: string; side: -1 | 1 } | null = null;
  private readonly plan: OvertakePlan = { lateralM: null, passing: false, blocker: null };

  get passing(): boolean {
    return this.target !== null;
  }

  reset(): void {
    this.target = null;
  }

  /**
   * @param self le coureur qui double
   * @param others les coureurs qui vont dans le même sens (lui-même exclu)
   * @param halfRoadM demi-largeur utile de la chaussée (m) : on ne sort pas de la route
   * @param leftFree la voie de gauche est libre devant (personne en face) ; faux : on double par la droite ou pas du tout
   */
  update(self: LaneBody, others: readonly LaneBody[], halfRoadM: number, leftFree = true): OvertakePlan {
    const plan = this.plan;
    plan.lateralM = null;
    plan.passing = false;
    plan.blocker = null;

    if (this.target) {
      const t = this.target;
      const o = others.find((x) => x.id === t.id);
      const gap = o ? o.distM - self.distM : Number.NaN;
      // Doublé et dégagé, disparu, ou qui a accéléré (l'écart se creuse) : fin de la manœuvre, retour dans sa voie.
      if (!o || gap < -PASS_CLEAR_M || gap > reactionDistanceM(0) + 12) this.target = null;
      else {
        const lane = o.lateralM + t.side * PASS_GAP_M;
        // La voie de dépassement n'existe plus (le doublé a changé de ligne, bord de chaussée) : on abandonne si on est encore derrière.
        if (Math.abs(lane) > halfRoadM + 1e-6 && gap > 0) this.target = null;
        else {
          plan.lateralM = Math.max(-halfRoadM, Math.min(halfRoadM, lane));
          plan.passing = true;
          return plan;
        }
      }
    }

    // Le plus proche devant, dans notre couloir.
    let blocker: LaneBody | null = null;
    for (const o of others) {
      const gap = o.distM - self.distM;
      if (gap <= 0 || gap > LOOK_M || Math.abs(o.lateralM - self.lateralM) >= CONFLICT_M) continue;
      if (!blocker || o.distM < blocker.distM) blocker = o;
    }
    if (!blocker) return plan;
    const closing = self.speedMs - blocker.speedMs;
    const gap = blocker.distM - self.distM;
    // Pas plus rapide que lui : on roule dans sa roue sans déboîter (le suiveur s'en charge).
    if (closing < MIN_CLOSING_MS) {
      plan.blocker = blocker;
      return plan;
    }
    // Trop tôt pour déboîter : on continue, la manœuvre commencera à distance de réaction.
    if (gap > reactionDistanceM(closing)) {
      plan.blocker = blocker;
      return plan;
    }
    // Côté : la gauche d'abord (circulation à droite), si elle est libre et dans la chaussée ; sinon la droite.
    const left = blocker.lateralM - PASS_GAP_M;
    const right = blocker.lateralM + PASS_GAP_M;
    let side: -1 | 1 | 0 = 0;
    if (leftFree && left >= -halfRoadM) side = -1;
    else if (right <= halfRoadM) side = 1;
    if (side === 0) {
      plan.blocker = blocker;
      return plan;
    }
    this.target = { id: blocker.id, side };
    plan.lateralM = side === -1 ? left : right;
    plan.passing = true;
    return plan;
  }
}
