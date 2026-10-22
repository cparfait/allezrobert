/**
 * Conditions de route et réglages qui modulent les paramètres du modèle de Martin :
 * revêtement et pluie (Crr), morphologie et position (CdA), vent ramené à hauteur du coureur
 * et abri (villages, forêt), lissage de la puissance mesurée (volant d'inertie du home trainer).
 *
 * Ordres de grandeur :
 * - Crr : Grappe (2009), Steyn & Warnich (2014), bicyclerollingresistance.com (pneus route
 *   25–28 mm) : enrobé 0,004–0,006, pavés 0,008–0,012, stabilisé / gravier fin 0,007–0,009,
 *   gravier 0,009–0,012, terre et herbe 0,012–0,02.
 * - Aire frontale : Bassett et al. (1999), A_f = 0,0293·H^0,725·M^0,425 + 0,0604 (H en m, M en kg).
 * - Danseuse : +10 à +15 % de traînée (García-López 2008, Blocken 2018) ; position de descente
 *   groupée : −10 à −20 %.
 * - Vent : profil logarithmique u(z) = u₁₀·ln(z/z₀)/ln(10/z₀), z₀ ≈ 0,03 m en campagne ouverte,
 *   soit 60 % du vent « météo » (mesuré à 10 m) à 1 m du sol.
 */

/** Revêtements OSM regroupés pour la physique et le son. */
export type SurfaceClass = 'paved' | 'cobbles' | 'compacted' | 'gravel' | 'dirt';

const SURFACE_CLASS: Record<string, SurfaceClass> = {
  asphalt: 'paved',
  paved: 'paved',
  concrete: 'paved',
  'concrete:plates': 'paved',
  'concrete:lanes': 'paved',
  chipseal: 'paved',
  metal: 'paved',
  wood: 'paved',
  paving_stones: 'cobbles',
  sett: 'cobbles',
  cobblestone: 'cobbles',
  unhewn_cobblestone: 'cobbles',
  compacted: 'compacted',
  fine_gravel: 'compacted',
  gravel: 'gravel',
  unpaved: 'gravel',
  pebblestone: 'gravel',
  rock: 'gravel',
  dirt: 'dirt',
  earth: 'dirt',
  ground: 'dirt',
  grass: 'dirt',
  sand: 'dirt',
  mud: 'dirt',
  woodchips: 'dirt',
};

/** Classe de revêtement d'un tag OSM `surface` (enrobé si inconnu ou absent). */
export function surfaceClass(surface: string | undefined): SurfaceClass {
  return (surface && SURFACE_CLASS[surface]) || 'paved';
}

/** Crr absolu par classe, pour un pneu route ; l'enrobé garde le Crr propre au vélo. */
const SURFACE_CRR: Record<Exclude<SurfaceClass, 'paved'>, number> = {
  cobbles: 0.01,
  compacted: 0.0075,
  gravel: 0.0095,
  dirt: 0.012,
};

/**
 * Coefficient de roulement selon le revêtement. `bikeCrr` est celui du vélo sur enrobé : un pneu
 * route plus résistant sur la route l'est aussi ailleurs (même rapport, jamais en dessous de la
 * valeur tabulée). Les pneus gravel, un peu plus lents sur l'enrobé (déjà dans `bikeCrr`),
 * perdent 20 % de moins que des pneus route hors enrobé.
 */
export function surfaceCrr(surface: string | undefined, bikeCrr: number, tyre: 'road' | 'gravel' = 'road'): number {
  const c = surfaceClass(surface);
  if (c === 'paved') return bikeCrr;
  if (tyre === 'gravel') return SURFACE_CRR[c] * 0.8;
  return Math.max(SURFACE_CRR[c], SURFACE_CRR[c] * (bikeCrr / 0.0045));
}

/** Rugosité perçue (0–1) par classe, pour le son de roulement. */
export function surfaceRoughness(surface: string | undefined): number {
  switch (surfaceClass(surface)) {
    case 'cobbles':
      return 0.85;
    case 'compacted':
      return 0.45;
    case 'gravel':
      return 0.65;
    case 'dirt':
      return 0.55;
    default:
      return 0.15;
  }
}

/** Chaussée mouillée : +12 % de résistance au roulement à pluie maximale (`rain` 0–1). */
export function wetCrrFactor(rain: number): number {
  return 1 + 0.12 * Math.min(Math.max(rain, 0), 1);
}

/** Aire frontale de Bassett et al. (1999), m². */
export function frontalArea(heightCm: number, massKg: number): number {
  return 0.0293 * Math.pow(heightCm / 100, 0.725) * Math.pow(massKg, 0.425) + 0.0604;
}

/** Aire frontale de référence du CdA par défaut des vélos (coureur de 1,78 m et 75 kg). */
export const REFERENCE_FRONTAL_AREA = frontalArea(178, 75);

/** Multiplicateur de CdA selon la morphologie du coureur (1 pour 1,78 m et 75 kg). */
export function bodyCdaFactor(heightCm: number, massKg: number): number {
  if (!(heightCm > 0) || !(massKg > 0)) return 1;
  return frontalArea(heightCm, massKg) / REFERENCE_FRONTAL_AREA;
}

/** Multiplicateur de CdA selon la posture : assis aux cocottes 1, danseuse +12 %, descente groupée −15 %. */
export function poseCdaFactor(pose: 'seated' | 'standing' | 'coasting', gradePercent: number, speedMs: number): number {
  if (pose === 'standing') return 1.12;
  // En roue libre dans une descente rapide, le coureur se groupe sur le vélo.
  if (pose === 'coasting' && gradePercent < -3 && speedMs > 11) return 0.85;
  return 1;
}

/** Rapport entre le vent à `heightM` et le vent météo à 10 m (profil logarithmique). */
export function windHeightFactor(heightM = 1, roughnessM = 0.03): number {
  return Math.log(Math.max(heightM, roughnessM * 1.01) / roughnessM) / Math.log(10 / roughnessM);
}

/**
 * Vent de face ressenti par le coureur (m/s) : composante longitudinale du vent météo, ramenée à
 * 1 m du sol et atténuée par l'abri (`shelter` 0–1 : 1 = rue de village ou sous-bois dense, où il
 * ne reste qu'un tiers du vent).
 */
export function riderWind(headwind10mMs: number, shelter = 0): number {
  const s = Math.min(Math.max(shelter, 0), 1);
  return headwind10mMs * windHeightFactor() * (1 - (2 / 3) * s);
}

/**
 * Lissage de la puissance mesurée (passe-bas du premier ordre, τ = 0,5 s par défaut), comme le
 * volant d'inertie d'un home trainer : les à-coups des capteurs (1 à 4 mesures/s) ne font pas
 * sauter la vitesse du jeu. L'énergie fournie est conservée à long terme.
 */
export class PowerSmoother {
  value = 0;
  private primed = false;

  constructor(readonly tauS = 0.5) {}

  update(watts: number, dt: number): number {
    const w = Math.max(0, watts);
    if (!this.primed || this.tauS <= 0) {
      this.primed = true;
      this.value = w;
      return w;
    }
    this.value += (w - this.value) * (1 - Math.exp(-Math.max(dt, 0) / this.tauS));
    return this.value;
  }

  reset(watts = 0): void {
    this.value = Math.max(0, watts);
    this.primed = true;
  }
}
