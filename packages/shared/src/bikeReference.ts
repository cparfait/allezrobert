/**
 * Vélo de référence : cotes génériques communes aux modèles 3D construits par les scripts Blender
 * (tools/blender/build_cyclist.py, bike_families.py) et lues aujourd'hui dans les GLB par le client.
 *
 * Ce sont des valeurs de RÉFÉRENCE, pas une géométrie imposée à tous les vélos : certaines familles
 * s'en écartent (roue avant réduite du lowpro, roues propres du VTT…), et les géométries réelles par
 * modèle et taille de cadre viendront s'y ajouter. Aucune donnée propre à une famille, aucune cible du
 * cycliste (mains, selle) ni aucun réglage ici.
 *
 * Repère du vélo (celui du client) : +x vers la gauche du coureur, +y vers le haut, +z vers l'avant,
 * mètres, origine au sol à l'aplomb du boîtier de pédalier.
 *
 * Le rayon physique (DEFAULT_BIKE.wheelRadiusM, rider.ts : vitesse, inertie) est une donnée distincte,
 * égale à ce jour au rayon visuel mais non couplée à lui.
 *
 * Audit n° 3, étape E1.2a : aucun module du moteur n'utilise encore ces valeurs.
 */

/** Point du repère du vélo (x, y, z), en mètres. */
export type BikePoint = readonly [x: number, y: number, z: number];

export interface BikeReference {
  /** Rayon extérieur de la roue de référence, pneu compris (m) : roue de route ≈ 700 × 25-28. */
  readonly wheelRadiusM: number;
  /** Centre du boîtier de pédalier (m) : 0,27 au-dessus du sol, soit une chute de boîtier de 6,5 cm sous les axes. */
  readonly bottomBracket: BikePoint;
  /** Longueur de manivelle, de l'axe du boîtier à l'axe de la pédale (m). */
  readonly crankLengthM: number;
  /** Écart latéral de l'axe de chaque pédale par rapport au plan médian du vélo (m) : pédale gauche à +x, droite à −x. */
  readonly pedalAxisOffsetXM: number;
  /** Inclinaison de repos des pédales autour de l'axe X (rad, ≈ 20°, talon levé : REST_PITCH des scripts Blender). */
  readonly pedalRestPitchRad: number;
  /** Axe de la roue avant (m) : à la hauteur du rayon, 59 cm devant le boîtier. */
  readonly frontAxle: BikePoint;
  /** Axe de la roue arrière (m) : à la hauteur du rayon, 41 cm derrière le boîtier. */
  readonly rearAxle: BikePoint;
}

const R = 0.335;

export const BIKE_REFERENCE: BikeReference = Object.freeze({
  wheelRadiusM: R,
  bottomBracket: Object.freeze([0, 0.27, 0] as const),
  crankLengthM: 0.1725,
  pedalAxisOffsetXM: 0.072,
  pedalRestPitchRad: 0.35,
  frontAxle: Object.freeze([0, R, 0.59] as const),
  rearAxle: Object.freeze([0, R, -0.41] as const),
});

/** Empattement de référence (m) : distance horizontale entre les deux axes. */
export const BIKE_REFERENCE_WHEELBASE_M = BIKE_REFERENCE.frontAxle[2] - BIKE_REFERENCE.rearAxle[2];
