/**
 * Specialized Roubaix Sport 2020 : données des tailles modélisées (asset Tripo retravaillé, fil T2c), indépendantes du moteur.
 *
 * Lues par rider/roubaix.ts (chargeur, montage sur le coureur et dans l'atelier) et par le banc roubaix-test.html.
 *
 * Repère du vélo : celui du client (BIKE_REFERENCE) : +x gauche du coureur, +y haut, +z avant, mètres, origine au sol à
 * l'aplomb du boîtier. Les axes des roues sont à y ≈ 0,335 (roues du jeu, rayon 335 mm) : le boîtier est à
 * `groundOffsetMm` au-dessus du sol (décision du 14/11/2026 : roues posées au sol).
 *
 * Décisions (14/11/2026) : roues du jeu avec un disque par taille ; cadre affiché à l'échelle 1 (pas de mise à l'échelle k :
 * les plaquettes ne sont qu'à 0,30 mm du disque) ; la taille de cadre se choisit d'après la taille du coureur.
 */
import type { MetricBikeDraft } from './bikeMetric.ts';

export const ROUBAIX_MODEL_ID = 'div-specialized-roubaix-sport-2020';

/** Guide des tailles Specialized (gamme Roubaix, image « sizeChartRoubaix » de la fiche, relevée le 14/11/2026), en cm. */
export interface RoubaixSizeBand {
  readonly size: string;
  readonly minCm: number;
  readonly maxCm: number;
}
export const ROUBAIX_SIZE_GUIDE: readonly RoubaixSizeBand[] = Object.freeze([
  { size: '44', minCm: 142, maxCm: 152 },
  { size: '49', minCm: 155, maxCm: 163 },
  { size: '52', minCm: 163, maxCm: 170 },
  { size: '54', minCm: 170, maxCm: 178 },
  { size: '56', minCm: 175, maxCm: 180 },
  { size: '58', minCm: 180, maxCm: 188 },
  { size: '61', minCm: 188, maxCm: 196 },
  { size: '64', minCm: 196, maxCm: 205 },
].map((b) => Object.freeze(b)));

/**
 * Taille de cadre pour une taille de coureur, parmi les tailles disponibles : la tranche du guide qui contient la taille
 * (au milieu de tranche le plus proche si deux tranches se chevauchent), sinon la tranche la plus proche (trous du guide,
 * p. ex. 152–155 cm). À égalité, la plus petite taille. Null si aucune taille disponible n'est dans le guide.
 * `guide` : guide des tailles du modèle (Specialized par défaut ; LOOK 785 : LOOK785_SIZE_GUIDE).
 */
export function roubaixSizeFor(
  heightCm: number,
  available: readonly string[] = ROUBAIX_SIZES.map((s) => s.size),
  guide: readonly RoubaixSizeBand[] = ROUBAIX_SIZE_GUIDE,
): string | null {
  let best: RoubaixSizeBand | null = null;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (const b of guide) {
    if (!available.includes(b.size)) continue;
    const outside = heightCm < b.minCm ? b.minCm - heightCm : heightCm > b.maxCm ? heightCm - b.maxCm : 0;
    const key: [number, number] = [outside, Math.abs(heightCm - (b.minCm + b.maxCm) / 2)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = b;
      bestKey = key;
    }
  }
  return best?.size ?? null;
}

/** Une taille modélisée : fichiers, origine, contrat métrique, réglage de selle, disques. */
export interface RoubaixSizeSpec {
  readonly size: string;
  /** Dossier des fichiers dans public/models/bikes/ (« roubaix » si absent ; LOOK 785 : « look785 »). */
  readonly dir?: string;
  /** Fichiers (dans public/models/bikes/<dir>/) : niveaux de détail 0, 1, 2. */
  readonly lods: readonly [string, string, string];
  /** Pièce de roue avant (disque et araignée propres à la taille), repère de la roue (axe à l'origine), dans le dossier roubaix/. */
  readonly frontRotorPiece: string;
  /** Hauteur du centre du boîtier au-dessus du sol (mm) : roues du jeu (R 335) posées au sol. */
  readonly groundOffsetMm: number;
  /** Décalage (m) du maillage vers le repère des familles (boîtier à y 0,27) pour les motifs de la livrée (LiveryMaterial.setFrameOffset). */
  readonly liveryFrameOffsetM: readonly [number, number, number];
  /** Taille du coureur de référence pour cette taille de cadre (cm, milieu de la tranche du guide). */
  readonly referenceRiderCm: number;
  /** Selle et tige (nœuds « saddle » et « seatpost ») : abaissement le long de l'axe de la tige, en mètres dans le repère du vélo. */
  readonly seatpost: {
    readonly axisPointM: readonly [number, number, number];
    /** Direction montante de la tige (unitaire). Abaisser = se déplacer dans le sens opposé. */
    readonly directionUp: readonly [number, number, number];
    readonly radiusMm: number;
    /** Abaissement contrôlé sans contact avec le cadre (jeu ≥ 0,66 mm à 120 mm). */
    readonly maxDropMm: number;
    /** Rehausse permise (abaissement négatif, mm) pour les coureurs plus grands que la selle d'origine ; 0 si absent. */
    readonly minDropMm?: number;
  };
  /** Disques : plan (x, mm, dans le repère de la roue) et diamètre. Avant : pièce dédiée ; arrière : disque 160 du jeu décalé. */
  readonly rotors: {
    readonly front: { readonly planeXMm: number; readonly diameterMm: number };
    readonly rear: { readonly planeXMm: number; readonly diameterMm: number };
  };
  readonly metric: MetricBikeDraft;
}

const GROUND_44 = 258.288;
const f = <T>(o: T): T => Object.freeze(o);

/** Taille 44 (asset I-2b validé le 14/11/2026 : cockpit potence 69,6 / cocottes 360,2 ; contrat mesuré selon V1e-11). */
export const ROUBAIX_44: RoubaixSizeSpec = f({
  size: '44',
  lods: f(['roubaix44_lod0.glb', 'roubaix44_lod1.glb', 'roubaix44_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_44,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_44 / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 147,
  seatpost: f({
    axisPointM: f([0.0004, +((452.35 + GROUND_44) / 1000).toFixed(5), -0.13163] as const),
    directionUp: f([0, 0.969062, -0.246816] as const),
    radiusMm: 18.19,
    maxDropMm: 120,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: ROUBAIX_MODEL_ID, size: '44' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.25829, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.79829, 0.353], direction: [0, 0.9396926207859083, -0.3420201433256688] },
      frontWheel: { originM: [0, 0.33511, 0.57503], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.33489, -0.4078], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.09329, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.42329, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.165, handlebarWidthM: 0.3602, stemLengthM: 0.0696 },
    contacts: {
      handL: { originM: [0.1802, 0.93769, 0.516], basis: { x: [0.9997091850358718, -0.024115251500098737, 0], y: [0.02368050120403127, 0.9816864053781961, -0.1890265467027369], z: [0.0045584227139316615, 0.18897157495433828, 0.9819719775236146] } },
      handR: { originM: [-0.17995, 0.93758, 0.516], basis: { x: [0.9999548317421014, 0.009504445045636589, 0], y: [-0.009343105069485545, 0.9829803857927865, -0.1834727978048115], z: [-0.0017438071241050244, 0.18346451065816285, 0.9830247873099003] } },
      saddle: { originM: [0, 0.89801, -0.2375], basis: { x: [1, 0, 0], y: [0, 0.9989691436670224, 0.045394382925373095], z: [0, -0.04539438292537308, 0.9989691436670226] } },
      pedalL: { originM: [0.1034, 0.10299, -0.0019], basis: { x: [0.9999656384325443, -0.008289870577679123, 0], y: [0.00800026801346775, 0.9650323291245475, 0.2620087774410689], z: [-0.0021720188552023932, -0.26199977440878874, 0.9650654902874914] } },
      pedalR: { originM: [-0.1034, 0.43299, -0.0019], basis: { x: [0.9999656384325443, 0.008289870577679123, 0], y: [-0.00800026801346775, 0.9650323291245475, 0.2620087774410689], z: [0.0021720188552023932, -0.26199977440878874, 0.9650654902874914] } },
    },
    rotors: { front: { centerM: [0.038, 0.33511, 0.57503], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.33489, -0.4078], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

const GROUND_54 = 258.45;

/**
 * Taille 54 (14/11/2026) : cadre du 44-3c (54 + méplat d'étrier), fourche sans bosse d'étrier (déport 44,2 mesuré), cockpit
 * aux cotes (potence 99,7 / cocottes 420,2), étriers compacts du 44 (avant : bossage 5,6°), logo effacé, tige sortie (axe V1e-11) ;
 * même pièce de disque avant que le 44 (plan 38). La selle d'origine convient à un coureur d'environ 1,87 m : rehausse jusqu'à 60 mm.
 */
export const ROUBAIX_54: RoubaixSizeSpec = f({
  size: '54',
  lods: f(['roubaix54_lod0.glb', 'roubaix54_lod1.glb', 'roubaix54_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_54,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_54 / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 174,
  seatpost: f({
    axisPointM: f([0.0004, +((548.48 + GROUND_54) / 1000).toFixed(5), -0.15919] as const),
    directionUp: f([0, 0.969062, -0.246816] as const),
    radiusMm: 18.19,
    maxDropMm: 120,
    minDropMm: -60,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: ROUBAIX_MODEL_ID, size: '54' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.25845, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.84345, 0.376], direction: [0, 0.9550199444571865, -0.29654157497557115] },
      frontWheel: { originM: [0, 0.33495, 0.5802], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.33505, -0.4078], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.08595, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.43095, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.1725, handlebarWidthM: 0.4202, stemLengthM: 0.0997 },
    contacts: {
      handL: {
        originM: [0.21016, 0.98783, 0.572],
        basis: { x: [0.9999193508346526, -0.012700071905586967, 0], y: [0.012480033892287624, 0.9825950184172562, -0.18534097910510686], z: [0.0023538437616867493, 0.1853260315098374, 0.9826742702769624] },
      },
      handR: {
        originM: [-0.21008, 0.98773, 0.572],
        basis: { x: [0.9999247885843641, 0.012264467967051775, 0], y: [-0.012063069625108312, 0.9835047371781332, -0.1804796783557389], z: [-0.002213487233897768, 0.18046610422363624, 0.9835787135255669] },
      },
      saddle: {
        originM: [0, 0.99464, -0.2625],
        basis: { x: [1, 0, 0], y: [0, 0.998899032215475, 0.04691186884986708], z: [0, -0.04691186884986708, 0.9988990322154752] },
      },
      pedalL: {
        originM: [0.1034, 0.09565, -0.0019],
        basis: { x: [0.9999656384325443, -0.008289870577679123, 0], y: [0.00800026801346775, 0.9650323291245475, 0.2620087774410689], z: [-0.0021720188552023932, -0.26199977440878874, 0.9650654902874914] },
      },
      pedalR: {
        originM: [-0.1034, 0.44065, -0.0019],
        basis: { x: [0.9999656384325443, 0.008289870577679123, 0], y: [-0.00800026801346775, 0.9650323291245475, 0.2620087774410689], z: [0.0021720188552023932, -0.26199977440878874, 0.9650654902874914] },
      },
    },
    rotors: { front: { centerM: [0.038, 0.33495, 0.5802], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.33505, -0.4078], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

/** Tailles modélisées : 44 (coureurs jusqu'à 160 cm) et 54 (au-delà), choisies par roubaixSizeFor. */
export const ROUBAIX_SIZES: readonly RoubaixSizeSpec[] = Object.freeze([ROUBAIX_44, ROUBAIX_54]);
