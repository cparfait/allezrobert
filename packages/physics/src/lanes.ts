/**
 * Circulation à droite sur la chaussée : repères communs au joueur, aux IA, aux cyclistes d'ambiance et aux
 * coureurs qui reviennent à contresens (demi-tour). Décalage latéral : positif = à droite dans le sens de marche.
 *
 * Sur un petit chemin de 3 m, ceux qui vont dans le sens de marche roulent à droite (axe entre 0,5 m et 1,1 m),
 * ceux d'en face à gauche (axe entre −0,5 m et −1,1 m) : deux vélos qui se croisent gardent plus de 1,5 m entre axes.
 */

/** Distance minimale entre l'axe du vélo et le bord de la chaussée (m). */
export const EDGE_MARGIN_M = 0.4;
/** Ceux qui vont dans le sens de marche gardent leur axe au moins à cette distance de l'axe de la route (m), sauf pour doubler. */
export const KEEP_RIGHT_M = 0.5;

/** Demi-largeur utile (m) : où peut aller l'axe d'un vélo sur une chaussée de `roadWidthM`. */
export function roadHalfM(roadWidthM: number): number {
  return Math.max(0.9, roadWidthM / 2 - EDGE_MARGIN_M);
}

/** Voie de droite de ceux qui vont dans le sens de marche : au bord, sans y coller (m, positif). */
export function rightLaneM(roadWidthM: number): number {
  return Math.max(KEEP_RIGHT_M + 0.1, roadHalfM(roadWidthM));
}

/** Plus petit décalage permis à qui roule dans le sens de marche pour une demi-largeur utile donnée. */
export function keepRightM(halfM: number): number {
  return Math.min(KEEP_RIGHT_M, halfM);
}

/** On guette ceux qui arrivent en face pendant ce temps de rapprochement (s)… */
export const ONCOMING_LOOK_S = 5;
/** … et au moins sur cette distance devant soi (m). */
export const ONCOMING_LOOK_MIN_M = 40;
/** Vitesse supposée de celui qui arrive en face, pour estimer le rapprochement (m/s). */
export const ONCOMING_SPEED_MS = 9;

/** Portée (m) devant soi où guetter ceux qui arrivent en face, à la vitesse `speedMs`. */
export function oncomingLookM(speedMs: number): number {
  return Math.max(ONCOMING_LOOK_MIN_M, (Math.max(0, speedMs) + ONCOMING_SPEED_MS) * ONCOMING_LOOK_S);
}

/**
 * Moitié de chaussée de qui roule dans le sens `sens` (repère de l'itinéraire : +1 sens de marche, à droite ;
 * −1 en face, à gauche), à `KEEP_RIGHT_M` de l'axe de la route : deux vélos qui se croisent gardent au moins 1 m entre axes.
 */
export function ownHalf(halfM: number, sens: 1 | -1): { min: number; max: number } {
  const m = keepRightM(halfM);
  return sens > 0 ? { min: m, max: halfM } : { min: -halfM, max: -m };
}

/**
 * Borne `lateral` (repère de l'itinéraire) à la moitié de chaussée du sens `sens`, sans sortir de la chaussée réelle
 * `[lo, hi]` : si celle-ci ne laisse pas la marge, on va au plus près de son bord (la chaussée prime).
 */
export function clampToOwnHalf(lateral: number, sens: 1 | -1, lo: number, hi: number): number {
  const m = KEEP_RIGHT_M;
  const a = sens > 0 ? Math.max(lo, Math.min(m, hi)) : lo;
  const b = sens > 0 ? hi : Math.min(hi, Math.max(-m, lo));
  return Math.max(a, Math.min(b, lateral));
}

/** Écart le long de la route de `otherM` devant `selfM` dans le sens `dir` (boucle : chemin le plus court). */
export function aheadAlongM(selfM: number, otherM: number, dir: 1 | -1, loopLengthM?: number): number {
  let d = (otherM - selfM) * dir;
  if (loopLengthM && loopLengthM > 0) d = ((((d + loopLengthM / 2) % loopLengthM) + loopLengthM) % loopLengthM) - loopLengthM / 2;
  return d;
}

/** Quelqu'un qui arrive en face est entre 8 m derrière et `rangeM` devant (écart donné par `aheadAlongM`). */
export function facingWithin(aheadM: number, rangeM: number): boolean {
  return aheadM > -8 && aheadM < rangeM;
}
