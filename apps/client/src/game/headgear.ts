import { BIKES, type AvatarLook, type CapStyle } from '@allezrobert/shared';

/**
 * Couvre-chef et vélo selon la sortie (règle de jeu, Réel et Poly) : tout le monde porte un casque ; hors course, une
 * casquette de temps en temps ; en course, casque obligatoire ; en contre-la-montre, casque chrono et vélo de chrono
 * pour tous (joueur compris). Calcul pur (testé).
 */

export type GearKind = 'ride' | 'race' | 'tt';

/** Part des coureurs en casquette hors course (rare). */
export const CAP_SHARE = 0.12;

const CAP_STYLES: readonly CapStyle[] = ['uni', 'pois', 'losanges', 'panneaux'];

/** Vélos de chrono du catalogue (saison 2026), pour les IA et le joueur en contre-la-montre. */
const TT_BIKES = BIKES.filter((b) => b.family === 'tt' && b.collection === 'saison-2026').map((b) => b.id);

/** Vélo de chrono n° i (varié, stable d'une partie à l'autre), ou undefined si le catalogue n'en a pas. */
export function ttBike(i: number): string | undefined {
  return TT_BIKES.length ? TT_BIKES[(((i * 7 + 3) % TT_BIKES.length) + TT_BIKES.length) % TT_BIKES.length] : undefined;
}

/**
 * Tenue d'un coureur (Réel, Poly) selon la sortie : jamais tête nue ; casquette seulement hors course, pour
 * `roll < CAP_SHARE` (tirage du coureur, 0–1) — sauf `keepCap` : la casquette choisie par le joueur est gardée hors course ;
 * en chrono, casque chrono et vélo de chrono (`bikeIndex` pour varier les modèles).
 */
export function withHeadgear(look: AvatarLook, kind: GearKind, roll: number, o: { keepCap?: boolean; bikeIndex?: number } = {}): AvatarLook {
  const { noHelmet: _bare, cap, helmetShape, ...rest } = look;
  if (kind === 'tt') {
    const bike = ttBike(o.bikeIndex ?? Math.floor(roll * 997));
    return { ...rest, helmetShape: 'chrono', ...(bike ? { bikeModel: bike } : {}) };
  }
  // Casque chrono hors chrono : gardé seulement si c'était le choix du joueur (keepCap vaut pour son équipement).
  const shape = o.keepCap && helmetShape ? { helmetShape } : {};
  if (kind === 'race') return { ...rest, ...shape };
  if (o.keepCap && cap) return { ...rest, cap };
  if (!o.keepCap && roll < CAP_SHARE) {
    const style = CAP_STYLES[Math.floor((roll / CAP_SHARE) * CAP_STYLES.length) % CAP_STYLES.length] as CapStyle;
    return { ...rest, cap: { style, color: look.jersey, accent: look.jerseyAccent } };
  }
  return { ...rest, ...shape };
}
