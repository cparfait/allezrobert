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
