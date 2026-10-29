/**
 * Vitesses (m/s) de changement de position du coureur, communes aux deux avatars (réaliste : gltfAvatar.ts,
 * jeu vidéo : lowPolyRider.ts). Position aéro (bas du cintre, prolongateurs, mains sur les cocottes à fond)
 * seulement à partir de 45 km/h ; en dessous, le coureur reste assis, buste relevé.
 */
export const AERO_SPEED = 12.5;
/** Retour à la position haute sous cette vitesse (hystérésis, ≈ 41 km/h). */
export const AERO_SPEED_OUT = 11.5;
/** Roue libre : l'aéro s'installe de AERO_SPEED à AERO_COAST_FULL. */
export const AERO_COAST_FULL = 14.5;
/** Avant-bras posés sur le haut du cintre (≈ 50 km/h), retour sous FOREARMS_OUT. */
export const FOREARMS_IN = 13.9;
export const FOREARMS_OUT = 12.8;
/** Effort (× FTP) qui impose la position aéro à plus de AERO_SPEED, et seuil de sortie. */
export const HARD_EFFORT = 1.05;
export const HARD_EFFORT_OUT = 0.95;
