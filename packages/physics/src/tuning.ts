/**
 * Pièces de l'atelier (catalogue @allezrobert/shared, tuning.json) appliquées à la physique :
 * masse, CdA, Crr, inertie des roues et rendement de transmission, avec un plafond de gain.
 *
 * Gain = puissance économisée à vitesse égale, aux deux conditions de référence (coureur de
 * 75 kg, vélo sans pièce de l'atelier) :
 *  - plat : 40 km/h, sans vent ;
 *  - côte : 8 %, à la vitesse que donne 3,5 W/kg avec le vélo de départ.
 * Si l'un des deux dépasse TUNE_BONUS_CAP (5 %), toutes les modifications sont ramenées
 * proportionnellement vers le vélo de départ jusqu'à ce que le plus grand gain vaille le plafond.
 * Calcul déterministe : client et serveur trouvent exactement le même vélo.
 */
import { DEFAULT_BIKE, tuneItem, type BikeSetup } from '@allezrobert/shared';
import { DEFAULT_ENVIRONMENT, paramsFromBike, powerForSpeed, steadyStateSpeed } from './model.ts';

/** Gain maximal des pièces de l'atelier, toutes ensemble (fraction de puissance économisée). */
export const TUNE_BONUS_CAP = 0.05;

/** Conditions de référence des gains annoncés au catalogue. */
export const TUNE_REFERENCE = { riderKg: 75, flatKmh: 40, climbGrade: 8, climbWkg: 3.5 } as const;

/** Vélo de tout le monde quand l'option « Équipement égalisé » est active. */
export const EQUALIZED_BIKE: Readonly<BikeSetup> = DEFAULT_BIKE;

/** Somme des modifications des pièces (masse, rendement additifs ; CdA, Crr multiplicatifs). */
export interface TuneDelta {
  massKg: number;
  cdaFactor: number;
  crrFactor: number;
  drivetrain: number;
  /** Inertie des roues de la paire montée (sinon celle du vélo). */
  wheelInertia: number | null;
}

export function tuneDelta(ids: readonly string[]): TuneDelta {
  const d: TuneDelta = { massKg: 0, cdaFactor: 1, crrFactor: 1, drivetrain: 0, wheelInertia: null };
  const slots = new Set<string>();
  for (const id of ids) {
    const it = tuneItem(id);
    // Une seule pièce par emplacement (la première), ensembles ignorés.
    if (!it?.slot || slots.has(it.slot)) continue;
    slots.add(it.slot);
    const p = it.perf;
    if (!p) continue;
    if (p.massKg) d.massKg += p.massKg;
    if (p.cdaFactor) d.cdaFactor *= p.cdaFactor;
    if (p.crrFactor) d.crrFactor *= p.crrFactor;
    if (p.drivetrain) d.drivetrain += p.drivetrain;
    if (p.wheelInertia) d.wheelInertia = p.wheelInertia;
  }
  return d;
}

/** Vélo de départ modifié par une fraction k (0–1) des pièces. */
function withDelta(base: BikeSetup, d: TuneDelta, k: number): BikeSetup {
  return {
    ...base,
    massKg: base.massKg + k * d.massKg,
    cda: base.cda * (1 + k * (d.cdaFactor - 1)),
    crr: base.crr * (1 + k * (d.crrFactor - 1)),
    drivetrainEfficiency: Math.min(0.995, base.drivetrainEfficiency + k * d.drivetrain),
    wheelInertia: d.wheelInertia === null ? base.wheelInertia : base.wheelInertia + k * (d.wheelInertia - base.wheelInertia),
  };
}

export interface TuneGains {
  /** Puissance économisée sur le plat (fraction). */
  flat: number;
  /** Puissance économisée en côte (fraction). */
  climb: number;
}

/** Gains d'un vélo sur un autre aux conditions de référence (négatifs : pénalité). */
export function tuneGains(base: BikeSetup, tuned: BikeSetup, riderKg: number = TUNE_REFERENCE.riderKg): TuneGains {
  const env = DEFAULT_ENVIRONMENT;
  const pb = paramsFromBike(riderKg, base);
  const pt = paramsFromBike(riderKg, tuned);
  const vFlat = TUNE_REFERENCE.flatKmh / 3.6;
  const flat = 1 - powerForSpeed(vFlat, 0, pt, env) / powerForSpeed(vFlat, 0, pb, env);
  const g = TUNE_REFERENCE.climbGrade;
  const vClimb = steadyStateSpeed(TUNE_REFERENCE.climbWkg * riderKg, g, pb, env);
  const climb = 1 - powerForSpeed(vClimb, g, pt, env) / powerForSpeed(vClimb, g, pb, env);
  return { flat, climb };
}

export interface TunedBike {
  bike: BikeSetup;
  /** Gains réellement appliqués (après plafond). */
  gains: TuneGains;
  /** Gains sans plafond. */
  raw: TuneGains;
  /** Fraction des modifications appliquée (1 sans plafond). */
  scale: number;
}

/**
 * Vélo réellement roulé avec les pièces de l'atelier `ids` (identifiants inconnus ignorés),
 * gain plafonné à TUNE_BONUS_CAP sur le plat comme en côte.
 */
export function tunedBikeSetup(base: BikeSetup, ids: readonly string[]): TunedBike {
  const d = tuneDelta(ids);
  const full = withDelta(base, d, 1);
  const raw = tuneGains(base, full);
  const worst = (g: TuneGains) => Math.max(g.flat, g.climb);
  let k = 1;
  if (worst(raw) > TUNE_BONUS_CAP) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (worst(tuneGains(base, withDelta(base, d, mid))) > TUNE_BONUS_CAP) hi = mid;
      else lo = mid;
    }
    k = lo;
  }
  const bike = k === 1 ? full : withDelta(base, d, k);
  return { bike, gains: k === 1 ? raw : tuneGains(base, bike), raw, scale: k };
}

/** Chiffres de l'atelier pour un vélo : vitesses à plat (FTP, 75 % FTP) et montée de référence (5 km à 7 %). */
export interface BikeStats {
  massKg: number;
  cda: number;
  crr: number;
  drivetrainEfficiency: number;
  flatFtpKmh: number;
  flat75Kmh: number;
  /** Temps de la montée de référence (5 km à 7 %) à la FTP (s). */
  climbS: number;
}

export const REFERENCE_CLIMB = { lengthM: 5000, grade: 7 } as const;

export function bikeStats(bike: BikeSetup, riderKg: number, ftpWatts: number): BikeStats {
  const p = paramsFromBike(riderKg, bike);
  const env = DEFAULT_ENVIRONMENT;
  return {
    massKg: bike.massKg,
    cda: bike.cda,
    crr: bike.crr,
    drivetrainEfficiency: bike.drivetrainEfficiency,
    flatFtpKmh: steadyStateSpeed(ftpWatts, 0, p, env) * 3.6,
    flat75Kmh: steadyStateSpeed(ftpWatts * 0.75, 0, p, env) * 3.6,
    climbS: REFERENCE_CLIMB.lengthM / steadyStateSpeed(ftpWatts, REFERENCE_CLIMB.grade, p, env),
  };
}
