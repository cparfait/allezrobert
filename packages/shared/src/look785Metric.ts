/**
 * LOOK 785 Huez RS (génération disque 2019–2023) : données des tailles modélisées, indépendantes du moteur. Même format et même
 * chargeur que le Roubaix dédié (roubaixMetric.ts, rider/roubaix.ts) ; fichiers dans public/models/bikes/look785/.
 *
 * Cadre, fourche et tige procéduraux (Blender, union par champ de distance avec congés) aux cotes LOOK, tracés sur la photo libre
 * Wikimedia Commons « Look 785 Disc 2019 » n° 13 (Glory Cycles, CC BY 2.0) ; cockpit, selle, étriers et dérailleurs repris du
 * Roubaix dédié. Repère du client (BIKE_REFERENCE) : +x gauche, +y haut, +z avant, mètres, origine au sol à l'aplomb du boîtier ;
 * roues du jeu (R 335) au sol. Cadre à l'échelle 1, comme le Roubaix (étriers à 0,30 mm des disques).
 */
import type { MetricBikeDraft } from './bikeMetric.ts';
import type { RoubaixSizeBand, RoubaixSizeSpec } from './roubaixMetric.ts';

export const LOOK785_MODEL_ID = 'div-look-785-huez-rs-chameleon';

/**
 * Guide des tailles LOOK (785 Huez RS, fiche LOOK relevée le 14/11/2026), en cm ; XS commence à 142 cm comme le Roubaix 44 (la
 * fiche dit « moins de 166 »), XL est bornée à 205 cm.
 */
export const LOOK785_SIZE_GUIDE: readonly RoubaixSizeBand[] = Object.freeze([
  { size: 'XS', minCm: 142, maxCm: 166 },
  { size: 'S', minCm: 164, maxCm: 173 },
  { size: 'M', minCm: 171, maxCm: 180 },
  { size: 'L', minCm: 178, maxCm: 187 },
  { size: 'XL', minCm: 185, maxCm: 205 },
].map((b) => Object.freeze(b)));

const f = <T>(o: T): T => Object.freeze(o);

const GROUND_XS = 266.783;

/** Taille XS : stack 510 / reach 365, douille 71.8°, selle 74°, déport 50 ; cockpit du Roubaix 44 ; manivelle 170. */
export const LOOK785_XS: RoubaixSizeSpec = f({
  size: 'XS',
  dir: 'look785',
  lods: f(['look785xs_lod0.glb', 'look785xs_lod1.glb', 'look785xs_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_XS,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_XS / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 158,
  seatpost: f({
    axisPointM: f([0, 0.92649, -0.18917] as const),
    directionUp: f([0, 0.961262, -0.275637] as const),
    radiusMm: 13.6,
    maxDropMm: 120,
    minDropMm: -40,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: LOOK785_MODEL_ID, size: 'XS' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.26678, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.77678, 0.365], direction: [0, 0.949972, -0.312335] },
      frontWheel: { originM: [0, 0.335, 0.56288], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.335, -0.40935], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.09678, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.43678, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.17, handlebarWidthM: 0.3602, stemLengthM: 0.0696 },
    contacts: {
      handL: { originM: [0.1802, 0.91099, 0.5323], basis: { x: [0.9997091850358718, -0.024103352079218238, -0.0007574783549780723], y: [0.02368050120403127, 0.9871394697152103, -0.15809775834305662], z: [0.0045584227139316615, 0.15803384368203824, 0.9874231742436688] } },
      handR: { originM: [-0.17995, 0.91088, 0.53229], basis: { x: [0.9999548317421014, 0.009499755175749346, 0.00029854183349980074], y: [-0.009343105069485545, 0.9882583641599649, -0.1525061049779017], z: [-0.0017438071241050244, 0.15249642723510293, 0.9883024834620435] } },
      saddle: { originM: [0, 0.91322, -0.24129], basis: { x: [1, 0, 0], y: [0, 0.998899032215475, 0.04691186884986708], z: [0, -0.04691186884986708, 0.9988990322154752] } },
      pedalL: { originM: [0.1034, 0.10648, -0.0019], basis: { x: [0.9999656384325442, -0.008289870577679123, -4.336808689942019e-19], y: [0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [-0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
      pedalR: { originM: [-0.1034, 0.44648, -0.0019], basis: { x: [0.9999656384325442, 0.008289870577679123, 4.336808689942019e-19], y: [-0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
    },
    rotors: { front: { centerM: [0.038, 0.335, 0.56288], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.335, -0.40935], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

const GROUND_M = 267.616;

/** Taille M : stack 558 / reach 385, douille 73°, selle 73°, déport 43 ; cockpit du Roubaix 54 ; manivelle 172.5. */
export const LOOK785_M: RoubaixSizeSpec = f({
  size: 'M',
  dir: 'look785',
  lods: f(['look785m_lod0.glb', 'look785m_lod1.glb', 'look785m_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_M,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_M / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 176,
  seatpost: f({
    axisPointM: f([0, 0.99016, -0.2209] as const),
    directionUp: f([0, 0.956305, -0.292372] as const),
    radiusMm: 13.6,
    maxDropMm: 120,
    minDropMm: -40,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: LOOK785_MODEL_ID, size: 'M' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.26762, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.82562, 0.385], direction: [0, 0.956305, -0.292372] },
      frontWheel: { originM: [0, 0.335, 0.57996], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.335, -0.40949], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.09512, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.44012, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.1725, handlebarWidthM: 0.4202, stemLengthM: 0.0997 },
    contacts: {
      handL: { originM: [0.21016, 0.96914, 0.58163], basis: { x: [0.9999193508346526, -0.012699951010055806, -0.00005541434166259669], y: [0.012480033892287624, 0.9833943648358443, -0.18105184882556166], z: [0.0023538437616867493, 0.18103655557220727, 0.9834735507201486] } },
      handR: { originM: [-0.21008, 0.96904, 0.58163], basis: { x: [0.9999247885843641, 0.012264351218156154, 0.000053513666953114347], y: [-0.012063069625108312, 0.9842828635781588, -0.17618662496795728], z: [-0.002213487233897768, 0.17617272818338697, 0.9843567799932543] } },
      saddle: { originM: [0, 0.97688, -0.27302], basis: { x: [1, 0, 0], y: [0, 0.998899032215475, 0.04691186884986708], z: [0, -0.04691186884986708, 0.9988990322154752] } },
      pedalL: { originM: [0.1034, 0.10482, -0.0019], basis: { x: [0.9999656384325442, -0.008289870577679123, -4.336808689942019e-19], y: [0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [-0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
      pedalR: { originM: [-0.1034, 0.44982, -0.0019], basis: { x: [0.9999656384325442, 0.008289870577679123, 4.336808689942019e-19], y: [-0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
    },
    rotors: { front: { centerM: [0.038, 0.335, 0.57996], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.335, -0.40949], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

const GROUND_L = 266.567;

/** Taille L : stack 582 / reach 395, douille 73°, selle 73°, déport 43 ; cockpit du Roubaix 54 ; manivelle 172.5. */
export const LOOK785_L: RoubaixSizeSpec = f({
  size: 'L',
  dir: 'look785',
  lods: f(['look785l_lod0.glb', 'look785l_lod1.glb', 'look785l_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_L,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_L / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 183,
  seatpost: f({
    axisPointM: f([0, 1.02745, -0.23263] as const),
    directionUp: f([0, 0.956305, -0.292372] as const),
    radiusMm: 13.6,
    maxDropMm: 120,
    minDropMm: -60,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: LOOK785_MODEL_ID, size: 'L' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.26657, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.84857, 0.395], direction: [0, 0.956305, -0.292372] },
      frontWheel: { originM: [0, 0.335, 0.59698], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.335, -0.40932], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.09407, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.43907, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.1725, handlebarWidthM: 0.4202, stemLengthM: 0.0997 },
    contacts: {
      handL: { originM: [0.21016, 0.99209, 0.59163], basis: { x: [0.9999193508346526, -0.012699951010055806, -0.00005541434166259669], y: [0.012480033892287624, 0.9833943648358443, -0.18105184882556166], z: [0.0023538437616867493, 0.18103655557220727, 0.9834735507201486] } },
      handR: { originM: [-0.21008, 0.99199, 0.59163], basis: { x: [0.9999247885843641, 0.012264351218156154, 0.000053513666953114347], y: [-0.012063069625108312, 0.9842828635781588, -0.17618662496795728], z: [-0.002213487233897768, 0.17617272818338697, 0.9843567799932543] } },
      saddle: { originM: [0, 1.01418, -0.28475], basis: { x: [1, 0, 0], y: [0, 0.998899032215475, 0.04691186884986708], z: [0, -0.04691186884986708, 0.9988990322154752] } },
      pedalL: { originM: [0.1034, 0.10377, -0.0019], basis: { x: [0.9999656384325442, -0.008289870577679123, -4.336808689942019e-19], y: [0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [-0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
      pedalR: { originM: [-0.1034, 0.44877, -0.0019], basis: { x: [0.9999656384325442, 0.008289870577679123, 4.336808689942019e-19], y: [-0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
    },
    rotors: { front: { centerM: [0.038, 0.335, 0.59698], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.335, -0.40932], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

const GROUND_XL = 267.622;

/** Taille XL : stack 606 / reach 405, douille 73°, selle 73°, déport 43 ; cockpit du Roubaix 54 allongé (potence 120 / cocottes 440) ; manivelle 175. */
export const LOOK785_XL: RoubaixSizeSpec = f({
  size: 'XL',
  dir: 'look785',
  lods: f(['look785xl_lod0.glb', 'look785xl_lod1.glb', 'look785xl_lod2.glb'] as const),
  frontRotorPiece: 'roubaix44_disque_avant.glb',
  groundOffsetMm: GROUND_XL,
  liveryFrameOffsetM: f([0, +(0.27 - GROUND_XL / 1000).toFixed(6), 0] as const),
  referenceRiderCm: 192,
  seatpost: f({
    axisPointM: f([0, 1.05726, -0.24142] as const),
    directionUp: f([0, 0.956305, -0.292372] as const),
    radiusMm: 13.6,
    maxDropMm: 120,
    minDropMm: -60,
  }),
  rotors: f({ front: f({ planeXMm: 38, diameterMm: 160 }), rear: f({ planeXMm: 47.1, diameterMm: 160 }) }),
  metric: f({
    id: { modelId: LOOK785_MODEL_ID, size: 'XL' },
    brakes: 'disc',
    axes: {
      bottomBracket: { originM: [0, 0.26762, 0], direction: [1, 0, 0] },
      steering: { originM: [0, 0.87362, 0.405], direction: [0, 0.956305, -0.292372] },
      frontWheel: { originM: [0, 0.335, 0.61464], direction: [1, 0, 0] },
      rearWheel: { originM: [0, 0.335, -0.40949], direction: [1, 0, 0] },
      pedalL: { originM: [0.072, 0.09262, 0], direction: [1, 0, 0] },
      pedalR: { originM: [-0.072, 0.44262, 0], direction: [1, 0, 0] },
    },
    dimensions: { frontWheelRadiusM: 0.335, rearWheelRadiusM: 0.335, crankLengthM: 0.175, handlebarWidthM: 0.4402, stemLengthM: 0.1197 },
    contacts: {
      handL: { originM: [0.22016, 1.02558, 0.61976], basis: { x: [0.9999193508346526, -0.012699951010055806, -0.00005541434166259669], y: [0.012480033892287624, 0.9833943648358443, -0.18105184882556166], z: [0.0023538437616867493, 0.18103655557220727, 0.9834735507201486] } },
      handR: { originM: [-0.22008, 1.02548, 0.61976], basis: { x: [0.9999247885843641, 0.012264351218156154, 0.000053513666953114347], y: [-0.012063069625108312, 0.9842828635781588, -0.17618662496795728], z: [-0.002213487233897768, 0.17617272818338697, 0.9843567799932543] } },
      saddle: { originM: [0, 1.04398, -0.29354], basis: { x: [1, 0, 0], y: [0, 0.998899032215475, 0.04691186884986708], z: [0, -0.04691186884986708, 0.9988990322154752] } },
      pedalL: { originM: [0.1034, 0.10232, -0.0019], basis: { x: [0.9999656384325442, -0.008289870577679123, -4.336808689942019e-19], y: [0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [-0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
      pedalR: { originM: [-0.1034, 0.45232, -0.0019], basis: { x: [0.9999656384325442, 0.008289870577679123, 4.336808689942019e-19], y: [-0.008000268013467753, 0.9650323291245476, 0.2620087774410689], z: [0.0021720188552023937, -0.26199977440878874, 0.9650654902874914] } },
    },
    rotors: { front: { centerM: [0.038, 0.335, 0.61464], diameterM: 0.16 }, rear: { centerM: [0.0471, 0.335, -0.40949], diameterM: 0.16 } },
  } satisfies MetricBikeDraft),
});

/** Tailles modélisées : XS, M, L, XL (choisies par roubaixSizeFor avec LOOK785_SIZE_GUIDE). */
export const LOOK785_SIZES: readonly RoubaixSizeSpec[] = Object.freeze([LOOK785_XS, LOOK785_M, LOOK785_L, LOOK785_XL]);
