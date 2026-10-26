/**
 * Repères du monde ouvert. Après un demi-tour, le serveur mesure la distance d'un coureur sur
 * l'itinéraire inversé (L − d, voir `RideSimulation.turnAround`) et son décalage latéral dans son propre
 * repère (positif = à sa droite). Le jeu dessine tout dans le repère de l'itinéraire (aller) : ces fonctions
 * font la conversion.
 */
import type { InterpolatedRider } from './interpolation.ts';

/** Coureur distant exprimé dans le repère de l'itinéraire ; `refM` = position du joueur (choix du tour le plus proche). */
export function toRouteFrame(r: InterpolatedRider, lengthM: number, loop: boolean, refM: number): InterpolatedRider {
  if (r.dir !== -1) return r;
  const base = lengthM - r.distM;
  const u = loop ? base + Math.round((refM - base) / lengthM) * lengthM : base;
  const lap = loop ? Math.floor(u / lengthM) : 0;
  return { ...r, unwrappedM: u, lap, distM: loop ? u - lap * lengthM : u, lateralM: -r.lateralM };
}

/** Distance (m) le long de la route entre deux positions du repère de l'itinéraire (boucle : par le plus court côté). */
export function gapAlongRoute(aM: number, bM: number, lengthM: number, loop: boolean): number {
  let gap = Math.abs(aM - bM);
  if (loop) {
    gap %= lengthM;
    gap = Math.min(gap, lengthM - gap);
  }
  return gap;
}

/** Repère du serveur pour la prédiction locale : serveur = sens × distance locale + décalage. */
export interface PredictionFrame {
  sign: 1 | -1;
  offset: number;
}

/**
 * Nouveau repère après un changement de sens : le décalage (tours compris) est recalé sur la position
 * que le serveur vient de donner (`serverU`, dépliée) pour la distance locale actuelle.
 */
export function frameAfterTurn(dir: 1 | -1, serverU: number, localDistM: number): PredictionFrame {
  return { sign: dir, offset: serverU - dir * localDistM };
}
