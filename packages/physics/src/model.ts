/**
 * Modèle de puissance cycliste de Martin et al. (1998),
 * « Validation of a Mathematical Model for Road Cycling Power », J. Appl. Biomech. 14:276-291.
 *
 *   P_roue = η · P_pédales
 *   P_roue = v · [ F_aéro + F_roulement + F_gravité + F_roulements_roue ] + (m + I/r²) · v · dv/dt
 *
 *   F_aéro      = ½ · ρ · CdA · (v + v_vent) · |v + v_vent|      (vent de face positif)
 *   F_roulement = Crr · m · g · cos θ
 *   F_gravité   = m · g · sin θ                                  (θ = atan(pente))
 *   F_roul.roue = (91 + 8,7 · v) · 10⁻³                          (pertes des roulements, Martin éq. 9)
 *
 * Toutes les fonctions sont pures et n'allouent pas (sauf mention), afin de tourner à 60 Hz
 * dans le navigateur et à 10 Hz × 20 coureurs côté serveur.
 */
import { DEFAULT_BIKE, type BikeSetup, type RiderProfile } from '@allezrobert/shared';

/** Accélération de la pesanteur standard (m/s²). */
export const GRAVITY = 9.80665;

/** Paramètres physiques d'un ensemble coureur + vélo. */
export interface RiderPhysicsParams {
  /** Masse totale coureur + vélo (kg). */
  massKg: number;
  /** Surface frontale × coefficient de traînée (m²), hors aspiration. */
  cda: number;
  /** Coefficient de résistance au roulement. */
  crr: number;
  /** Rendement de transmission (0–1). */
  drivetrainEfficiency: number;
  /** Moment d'inertie des deux roues (kg·m²). */
  wheelInertia: number;
  /** Rayon de roue (m). */
  wheelRadiusM: number;
  /** Prise en compte des pertes de roulements de roue de Martin. Vrai par défaut. */
  bearingLoss?: boolean;
  /**
   * Fraction de l'inertie (masse + roues) appliquée aux accélérations, 1 par défaut (réaliste).
   * Plus bas, la vitesse du jeu suit plus vite les relances, comme le volant léger d'un home
   * trainer ; les vitesses d'équilibre ne changent pas.
   */
  inertiaFactor?: number;
}

/** Conditions extérieures. */
export interface Environment {
  /** Masse volumique de l'air (kg/m³), voir {@link airDensity}. */
  airDensity: number;
  /** Vent de face (m/s, positif = de face, négatif = dans le dos). */
  windSpeedMs: number;
}

/** Air standard au niveau de la mer (15 °C, 1013,25 hPa), sans vent. */
export const DEFAULT_ENVIRONMENT: Readonly<Environment> = { airDensity: 1.225, windSpeedMs: 0 };

/**
 * Masse volumique de l'air selon l'atmosphère standard internationale (ISA).
 * Pression : p = p0 · (1 − L·h/T0)^(g·M/(R·L)) ; température réelle optionnelle (sinon ISA : T0 − L·h).
 * ρ = p / (R_air · T).
 */
export function airDensity(altitudeM = 0, temperatureC?: number): number {
  const T0 = 288.15;
  const L = 0.0065;
  const p0 = 101325;
  const Rair = 287.05;
  const h = Math.min(Math.max(altitudeM, -500), 11000);
  const p = p0 * Math.pow(1 - (L * h) / T0, 5.25588);
  const T = temperatureC === undefined ? T0 - L * h : temperatureC + 273.15;
  return p / (Rair * T);
}

/** Paramètres physiques depuis un profil coureur (masse coureur + vélo). */
export function paramsFromProfile(profile: RiderProfile): RiderPhysicsParams {
  return paramsFromBike(profile.massKg, profile.bike);
}

/** Paramètres physiques depuis une masse de coureur et un vélo. */
export function paramsFromBike(riderMassKg: number, bike: BikeSetup = DEFAULT_BIKE): RiderPhysicsParams {
  return {
    massKg: riderMassKg + bike.massKg,
    cda: bike.cda,
    crr: bike.crr,
    drivetrainEfficiency: bike.drivetrainEfficiency,
    wheelInertia: bike.wheelInertia,
    wheelRadiusM: bike.wheelRadiusM,
  };
}

/** Masse effective incluant l'inertie de rotation des roues : m + I/r². */
export function effectiveMass(p: RiderPhysicsParams): number {
  return p.massKg + p.wheelInertia / (p.wheelRadiusM * p.wheelRadiusM);
}

/** Décomposition des forces résistantes (N), positives quand elles freinent. */
export interface ResistiveForces {
  aero: number;
  rolling: number;
  gravity: number;
  bearing: number;
  total: number;
}

/**
 * Forces résistantes à la vitesse donnée.
 * @param cdaFactor multiplicateur de CdA (1 − réduction d'aspiration), 1 par défaut.
 * @param out objet réutilisé pour éviter l'allocation.
 */
export function resistiveForces(
  speedMs: number,
  gradePercent: number,
  params: RiderPhysicsParams,
  env: Readonly<Environment> = DEFAULT_ENVIRONMENT,
  cdaFactor = 1,
  out: ResistiveForces = { aero: 0, rolling: 0, gravity: 0, bearing: 0, total: 0 },
): ResistiveForces {
  const theta = Math.atan(gradePercent / 100);
  const mg = params.massKg * GRAVITY;
  const va = speedMs + env.windSpeedMs;
  out.aero = 0.5 * env.airDensity * params.cda * cdaFactor * va * Math.abs(va);
  out.rolling = speedMs > 0 ? params.crr * mg * Math.cos(theta) : 0;
  out.gravity = mg * Math.sin(theta);
  out.bearing = params.bearingLoss === false || speedMs <= 0 ? 0 : (91 + 8.7 * speedMs) * 1e-3;
  out.total = out.aero + out.rolling + out.gravity + out.bearing;
  return out;
}

const scratchForces: ResistiveForces = { aero: 0, rolling: 0, gravity: 0, bearing: 0, total: 0 };

/** Puissance résistante totale à la roue (W) en régime établi. */
function wheelPowerAt(v: number, grade: number, p: RiderPhysicsParams, env: Readonly<Environment>, cdaFactor: number): number {
  // Le roulement s'applique dès que v > 0 : on l'évalue à v ≥ ε pour la continuité.
  const f = resistiveForces(Math.max(v, 1e-9), grade, p, env, cdaFactor, scratchForces);
  return v * f.total;
}

/**
 * Puissance aux pédales (W) nécessaire pour tenir `speedMs` en régime établi.
 * Peut être négative en descente (la gravité suffit) : à l'appelant de borner à 0.
 */
export function powerForSpeed(
  speedMs: number,
  gradePercent: number,
  params: RiderPhysicsParams,
  env: Readonly<Environment> = DEFAULT_ENVIRONMENT,
  cdaFactor = 1,
): number {
  return wheelPowerAt(speedMs, gradePercent, params, env, cdaFactor) / params.drivetrainEfficiency;
}

/**
 * Vitesse d'équilibre (m/s) pour une puissance aux pédales donnée.
 * La fonction f(v) = v·F(v) − η·P est croissante là où F(v) > 0 : bissection robuste
 * sur [0, vMax] puis raffinement de Newton. Renvoie 0 si la puissance ne suffit pas
 * à vaincre la pente (impossible en pratique car v·F → 0 quand v → 0).
 */
export function steadyStateSpeed(
  watts: number,
  gradePercent: number,
  params: RiderPhysicsParams,
  env: Readonly<Environment> = DEFAULT_ENVIRONMENT,
  cdaFactor = 1,
): number {
  const pw = Math.max(0, watts) * params.drivetrainEfficiency;
  const f = (v: number): number => wheelPowerAt(v, gradePercent, params, env, cdaFactor) - pw;
  let lo = 0;
  let hi = 30;
  while (f(hi) < 0 && hi < 200) hi *= 2;
  // f(0) = −pw ≤ 0 et f n'a qu'un changement de signe sur ]0, ∞[ : bissection sûre.
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  // Raffinement de Newton (différence finie), gardé dans l'intervalle.
  let v = 0.5 * (lo + hi);
  for (let i = 0; i < 3; i++) {
    const h = 1e-4;
    const d = (f(v + h) - f(v - h)) / (2 * h);
    if (d <= 0) break;
    const nv = v - f(v) / d;
    if (nv < lo || nv > hi) break;
    v = nv;
  }
  return v;
}

/** État dynamique d'un coureur (muté en place par {@link stepRider}). */
export interface RiderState {
  /** Distance parcourue sur l'itinéraire (m). */
  distM: number;
  /** Vitesse sol (m/s), toujours ≥ 0. */
  speedMs: number;
  /** Accélération lors du dernier pas (m/s²), pour le son et l'animation. */
  accelMs2: number;
  /** Travail mécanique cumulé aux pédales (J). */
  workJ: number;
  /** Temps cumulé (s). */
  timeS: number;
}

export function createRiderState(init: Partial<RiderState> = {}): RiderState {
  return { distM: 0, speedMs: 0, accelMs2: 0, workJ: 0, timeS: 0, ...init };
}

/** Entrées d'un pas d'intégration. */
export interface StepInputs {
  /** Puissance aux pédales (W). */
  watts: number;
  /** Pente de la route (%). */
  gradePercent: number;
  params: RiderPhysicsParams;
  env?: Readonly<Environment>;
  /** Multiplicateur de CdA (1 − aspiration), 1 par défaut. */
  cdaFactor?: number;
  /** Frein 0–1 (décélération maximale {@link MAX_BRAKE_DECEL}). */
  brake?: number;
  /** Coefficient de roulement du moment (revêtement, pluie) ; défaut `params.crr`. */
  crr?: number;
  /**
   * Pied à terre : sans pédaler, sous cette vitesse (m/s) et en ralentissant, le coureur freine
   * et s'arrête. Désactivé par défaut.
   */
  footDownBelowMs?: number;
}

/** Vitesse sous laquelle un coureur qui ne pédale plus pose le pied (4 km/h). */
export const FOOT_DOWN_SPEED_MS = 4 / 3.6;

/** Décélération maximale au freinage (m/s²). */
export const MAX_BRAKE_DECEL = 6;

/**
 * Un pas d'intégration (semi-implicite, séparation d'opérateurs symétrique de Strang) :
 * 1. Demi-injection d'énergie exacte de la propulsion : ½·M·v₁² = ½·M·v₀² + ½·η·P·dt
 *    (aucune singularité à v = 0, conservation exacte de l'énergie fournie).
 * 2. Forces résistantes : gravité, roulement et roulements de roue explicites ; traînée
 *    aérodynamique linéarisée implicite F ≈ k·|v₁+w|·(v₂+w), d'où
 *    v₂ = (v₁ − dt/M·(F_autres + k·|v₁+w|·w)) / (1 + dt·k·|v₁+w|/M)  — inconditionnellement stable.
 * 3. Frein, puis v ≥ 0 (pas de recul : à l'arrêt en côte sans pédaler, le vélo reste immobile),
 *    puis seconde demi-injection d'énergie.
 * 4. Pied à terre : sans pédaler, sous `footDownBelowMs` et en ralentissant, arrêt complet.
 * 5. Position intégrée avec la nouvelle vitesse (Euler symplectique).
 * Stable à dt = 1/60 s comme à 1/10 s. Mute et renvoie `state`.
 */
export function stepRider(state: RiderState, inputs: StepInputs, dt: number): RiderState {
  if (dt <= 0) return state;
  const p = inputs.params;
  const env = inputs.env ?? DEFAULT_ENVIRONMENT;
  const M = effectiveMass(p) * Math.min(Math.max(p.inertiaFactor ?? 1, 0.2), 1);
  const v0 = state.speedMs;
  const pedal = Math.max(0, inputs.watts);
  const pw = pedal * p.drivetrainEfficiency;

  // 1. Première moitié de l'énergie de propulsion (schéma de Strang, ordre 2).
  const halfE = (pw * dt) / M;
  const v1 = Math.sqrt(v0 * v0 + halfE);

  // 2. Résistances sur le pas complet.
  const theta = Math.atan(inputs.gradePercent / 100);
  const mg = p.massKg * GRAVITY;
  const gravity = mg * Math.sin(theta);
  const rolling = (inputs.crr ?? p.crr) * mg * Math.cos(theta);
  // À l'arrêt sans pédaler : le vélo ne démarre que si la descente vainc le roulement.
  if (v1 <= 0 && -gravity <= rolling) {
    state.accelMs2 = 0;
    state.speedMs = 0;
    state.timeS += dt;
    return state;
  }
  const bearing = p.bearingLoss === false || v1 <= 0 ? 0 : (91 + 8.7 * v1) * 1e-3;
  const k = 0.5 * env.airDensity * p.cda * (inputs.cdaFactor ?? 1);
  const w = env.windSpeedMs;
  const kv = k * Math.abs(v1 + w);
  let vb = (v1 - (dt / M) * (gravity + rolling + bearing + kv * w)) / (1 + (dt * kv) / M);

  // 3. Frein et non-négativité, puis seconde moitié de la propulsion.
  const brake = inputs.brake ?? 0;
  if (brake > 0) vb -= Math.min(brake, 1) * MAX_BRAKE_DECEL * dt;
  if (vb < 0) vb = 0;
  let v2 = Math.sqrt(vb * vb + halfE);

  // 4. Pied à terre.
  const foot = inputs.footDownBelowMs ?? 0;
  if (foot > 0 && pedal < 1 && v2 < foot && v2 <= v0) v2 = 0;

  // 5. Position et cumuls.
  state.accelMs2 = (v2 - v0) / dt;
  state.speedMs = v2;
  state.distM += v2 * dt;
  state.workJ += pedal * dt;
  state.timeS += dt;
  return state;
}
