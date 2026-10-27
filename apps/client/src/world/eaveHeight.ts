/**
 * Hauteur des murs (égout) d'un bâtiment, sans dépendance à Three.js (testable sous Node).
 *
 * Les hauteurs sont comptées depuis le point bas de l'emprise. BD TOPO enrichie : faîtage et égout
 * mesurés au LiDAR, à garder ; la BD TOPO compte les combles aménagés comme un étage (un « R+1 »
 * à 3,3 m d'égout est un rez-de-chaussée sous combles), le nombre d'étages n'y fixe donc pas la
 * hauteur. Seul plancher : de quoi passer une porte au-dessus du sol amont (mesures trop basses :
 * annexe ou terrasse dans l'emprise, végétation). Sans mesure (OSM), l'égout vient d'une pente de toit
 * supposée : plancher d'un étage par niveau, plafonné à trois et à 1,25 × la hauteur.
 */
export interface EaveInput {
  /** Hauteur au faîtage au-dessus du point bas (m). */
  total: number;
  /** Hauteur du toit rendu (m). */
  roofH: number;
  /** Dénivelée du sol sous l'emprise (sol amont − point bas, m). */
  rise: number;
  levels?: number;
  /** Annexe ou édifice (grange, hangar, église…) : pas d'étage habitable. */
  utility: boolean;
  /** Hauteurs mesurées (BD TOPO enrichie au LiDAR). */
  measured: boolean;
}

/** Hauteur minimale d'un rez-de-chaussée habitable au-dessus du sol amont (porte de 2,25 m et linteau). */
export const DOOR_FLOOR = 2.5;

/** Égout au-dessus du point bas de l'emprise (m). */
export function eaveHeight(o: EaveInput): number {
  const floor = o.utility ? 2.4 : o.measured ? DOOR_FLOOR : Math.max(2.7, Math.min(2.7 + (Math.min(Math.max(Math.round(o.levels ?? 1), 1), 3) - 1) * 2.6, o.total * 1.25));
  return Math.max(o.total - o.roofH, floor + o.rise);
}
