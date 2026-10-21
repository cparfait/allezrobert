/**
 * Vitesses virtuelles et pente envoyée au home trainer (FTMS Indoor Bike Simulation).
 *
 * Idée (même principe que Zwift Cog / QZ / IndieVelo) : le cycliste pédale sur un rapport
 * réel fixe R (ex. plateau 34 × Zwift Cog 14T, `VirtualGearing.referenceRatio`). Le jeu simule
 * un rapport virtuel G. À cadence égale, le vélo virtuel avance G/R fois plus vite que la roue
 * du trainer ; pour que le couple ressenti aux manivelles soit celui du vélo virtuel, il faut
 *
 *   τ_manivelle = F_jeu · G · r = F_trainer · R · r   ⇒   F_trainer = q · F_jeu,  q = G/R
 *
 * (la puissance est conservée : F_trainer · v_trainer = F_jeu · v_jeu). Le trainer en mode
 * simulation applique F = m_t·g·(pente + Crr_t) + cw_t·v_t² ; on lui envoie donc
 *
 *   pente_trainer = (q · F_jeu(v_jeu, pente_jeu) − cw_t · v_t²) / (m_t·g) − Crr_t,   v_t = v_jeu / q
 *
 * Avec q = 1 et un modèle trainer identique au jeu, on retrouve pente_trainer ≈ pente_jeu.
 * Un rapport plus dur (q ↑) augmente la résistance à vitesse égale (dérivée strictement > 0).
 * L'aspiration réduit F_jeu, donc se ressent aussi au trainer.
 *
 * « Difficulté du trainer » (0–1, défaut 0,5) : comme les applis grand public, seule la
 * pente de la route est atténuée pour le trainer (montées × d, descentes × d × 0,5), la
 * physique du jeu garde la pente réelle.
 */
import { DEFAULT_GEARING, type VirtualGearing } from '@allezrobert/shared';
import { DEFAULT_ENVIRONMENT, GRAVITY, type Environment, type RiderPhysicsParams } from './model.ts';

/** Un rapport virtuel. */
export interface Gear {
  /** Indice 0 = rapport le plus facile. */
  index: number;
  chainring: number;
  cog: number;
  /** Développement relatif : dents plateau / dents pignon. */
  ratio: number;
}

/**
 * Table des rapports virtuels triée par braquet croissant (indice 0 = le plus facile).
 * Avec `DEFAULT_GEARING` : 2 plateaux × 12 pignons = 24 rapports.
 * Les doublons de braquet sont conservés (ordre stable : petit plateau d'abord).
 */
export function buildGearTable(gearing: VirtualGearing = DEFAULT_GEARING): Gear[] {
  const gears: Gear[] = [];
  for (const ring of gearing.chainrings) {
    for (const cog of gearing.cassette) gears.push({ index: 0, chainring: ring, cog, ratio: ring / cog });
  }
  gears.sort((a, b) => a.ratio - b.ratio || a.chainring - b.chainring);
  for (let i = 0; i < gears.length; i++) gears[i]!.index = i;
  return gears;
}

/** Borne un indice de rapport à la table. */
export function clampGear(index: number, table: readonly Gear[]): number {
  return Math.min(Math.max(Math.round(index), 0), table.length - 1);
}

/** Change de rapport (delta > 0 = plus dur), borné. */
export function shiftGear(index: number, delta: number, table: readonly Gear[]): number {
  return clampGear(index + delta, table);
}

/** Indice du rapport dont le braquet est le plus proche de `ratio`. */
export function gearIndexForRatio(ratio: number, table: readonly Gear[]): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < table.length; i++) {
    const err = Math.abs(Math.log(table[i]!.ratio / ratio));
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/** Indice de départ conseillé : le rapport le plus proche du rapport réel de référence. */
export function neutralGearIndex(gearing: VirtualGearing = DEFAULT_GEARING, table = buildGearTable(gearing)): number {
  return gearIndexForRatio(gearing.referenceRatio, table);
}

/** Transmission réelle montée sur le trainer. */
export type RealDrivetrain =
  /** Pignon fixe (Zwift Cog, 14T par défaut) : vitesses virtuelles actives. */
  | { kind: 'cog'; chainring: number; cog?: number }
  /** Cassette réelle : le rapport engagé (Di2) sert de référence ; virtuel optionnel. */
  | { kind: 'cassette'; chainring: number; cog: number };

/** Rapport réel (plateau / pignon). */
export function realRatio(d: RealDrivetrain): number {
  return d.chainring / (d.kind === 'cog' ? (d.cog ?? 14) : d.cog);
}

/** Circonférence de roue (m) depuis le rayon. */
export function wheelCircumference(wheelRadiusM: number): number {
  return 2 * Math.PI * wheelRadiusM;
}

/** Cadence (tr/min) correspondant à une vitesse sur un braquet donné. */
export function cadenceForSpeed(speedMs: number, ratio: number, circumferenceM = 2.105): number {
  return ratio > 0 && circumferenceM > 0 ? (speedMs / (ratio * circumferenceM)) * 60 : 0;
}

/** Vitesse (m/s) atteinte à une cadence sur un braquet donné (affichage, invités, IA). */
export function speedForCadence(cadenceRpm: number, ratio: number, circumferenceM = 2.105): number {
  return (cadenceRpm / 60) * ratio * circumferenceM;
}

/** Rapport donnant la cadence la plus proche de la cible à cette vitesse. */
export function bestGearForCadence(speedMs: number, targetCadence: number, table: readonly Gear[], circumferenceM = 2.105): number {
  if (speedMs <= 0 || targetCadence <= 0) return 0;
  return gearIndexForRatio((speedMs * 60) / (targetCadence * circumferenceM), table);
}

/** Modèle physique que le trainer applique en mode simulation (FTMS). */
export interface TrainerSimModel {
  /** Masse utilisateur + vélo connue du trainer (kg). */
  massKg: number;
  /** Crr envoyé au trainer (FTMS : 0,0001 de résolution). */
  crr: number;
  /** Coefficient de résistance au vent cw = ½·ρ·CdA (kg/m), FTMS : 0,01 de résolution. */
  cwKgPerM: number;
}

/**
 * Modèle trainer cohérent avec le jeu : c'est ce qu'il faut envoyer dans la commande
 * `{ kind: 'simulation', crr, cw }` pour que q = 1 donne exactement la pente du jeu.
 */
export function trainerModelFor(params: RiderPhysicsParams, env: Readonly<Environment> = DEFAULT_ENVIRONMENT): TrainerSimModel {
  return { massKg: params.massKg, crr: params.crr, cwKgPerM: 0.5 * env.airDensity * params.cda };
}

/** Pente FTMS : bornes du protocole (%). */
export const FTMS_GRADE_MIN = -40;
export const FTMS_GRADE_MAX = 40;

/**
 * Atténuation « difficulté du trainer » : montées × d, descentes × d × descentFactor.
 * d = 1 : pente réelle ; d = 0,5 (défaut) : moitié ; d = 0 : plat.
 */
export function difficultyScaledGrade(gradePercent: number, difficulty = 0.5, descentFactor = 0.5): number {
  const d = Math.min(Math.max(difficulty, 0), 1);
  return gradePercent >= 0 ? gradePercent * d : gradePercent * d * descentFactor;
}

export interface TrainerGradeInput {
  /** Pente de la route dans le jeu (%). */
  gradePercent: number;
  /** Vitesse du jeu (m/s). */
  speedMs: number;
  /** Braquet virtuel G (plateau/pignon). Égal à `referenceRatio` si pas de vitesses virtuelles. */
  gearRatio: number;
  /** Braquet réel R sur le trainer. */
  referenceRatio: number;
  params: RiderPhysicsParams;
  env?: Readonly<Environment>;
  /** Multiplicateur de CdA dû à l'aspiration (1 = aucune). */
  cdaFactor?: number;
  /** 0–1, défaut 0,5. */
  trainerDifficulty?: number;
  /** Facteur supplémentaire en descente. Défaut 0,5. */
  descentFactor?: number;
  /** Modèle du trainer ; défaut : {@link trainerModelFor}(params, env). */
  trainer?: TrainerSimModel;
  /** Bornes pratiques (%). Défaut −20 … +20, toujours dans −40 … +40. */
  minGradePercent?: number;
  maxGradePercent?: number;
}

/** Pente (%) à envoyer au trainer pour le rapport virtuel courant. Voir l'en-tête du module. */
export function computeTrainerGrade(input: TrainerGradeInput): number {
  const p = input.params;
  const env = input.env ?? DEFAULT_ENVIRONMENT;
  const t = input.trainer ?? trainerModelFor(p, env);
  const q = input.referenceRatio > 0 && input.gearRatio > 0 ? input.gearRatio / input.referenceRatio : 1;
  const g = difficultyScaledGrade(input.gradePercent, input.trainerDifficulty ?? 0.5, input.descentFactor ?? 0.5);
  const theta = Math.atan(g / 100);
  const v = Math.max(0, input.speedMs);
  const va = v + env.windSpeedMs;
  const fGame =
    p.massKg * GRAVITY * (Math.sin(theta) + p.crr * Math.cos(theta)) +
    0.5 * env.airDensity * p.cda * (input.cdaFactor ?? 1) * va * Math.abs(va);
  const vt = v / q;
  const grade = ((q * fGame - t.cwKgPerM * vt * vt) / (t.massKg * GRAVITY) - t.crr) * 100;
  const lo = Math.max(input.minGradePercent ?? -20, FTMS_GRADE_MIN);
  const hi = Math.min(input.maxGradePercent ?? 20, FTMS_GRADE_MAX);
  return Math.min(Math.max(grade, lo), hi);
}

export interface TrainerGradeSmootherOptions {
  /** Constante de temps du filtre passe-bas (s). Défaut 1. */
  timeConstantS?: number;
  /** Vitesse de variation maximale (%/s). Défaut 2. */
  maxRatePercentPerS?: number;
  /** Écart minimal pour renvoyer une consigne (%). Défaut 0,1. */
  deadbandPercent?: number;
  /** Renvoi périodique même sans changement (s). Défaut 5. */
  keepAliveS?: number;
  /** Intervalle minimal entre deux envois (s). Défaut 0,25 (≤ 4 commandes/s en BLE). */
  minIntervalS?: number;
}

/**
 * Lissage + limitation de pente de la consigne trainer, et décision d'envoi (évite de
 * saturer le lien BLE et les à-coups du frein). Quantification FTMS : 0,01 %.
 */
export class TrainerGradeSmoother {
  value: number;
  private lastSent: number | null = null;
  private sinceSend = Infinity;
  private readonly tau: number;
  private readonly rate: number;
  private readonly deadband: number;
  private readonly keepAlive: number;
  private readonly minInterval: number;

  constructor(initialGradePercent = 0, opts: TrainerGradeSmootherOptions = {}) {
    this.value = initialGradePercent;
    this.tau = opts.timeConstantS ?? 1;
    this.rate = opts.maxRatePercentPerS ?? 2;
    this.deadband = opts.deadbandPercent ?? 0.1;
    this.keepAlive = opts.keepAliveS ?? 5;
    this.minInterval = opts.minIntervalS ?? 0.25;
  }

  /**
   * Avance le filtre. Renvoie la pente à envoyer maintenant (quantifiée à 0,01 %),
   * ou `null` s'il n'est pas utile d'envoyer.
   */
  update(targetPercent: number, dt: number): number | null {
    const alpha = this.tau > 0 ? 1 - Math.exp(-dt / this.tau) : 1;
    let step = (targetPercent - this.value) * alpha;
    const maxStep = this.rate * dt;
    if (step > maxStep) step = maxStep;
    else if (step < -maxStep) step = -maxStep;
    this.value += step;
    this.sinceSend += dt;
    const q = Math.round(this.value * 100) / 100;
    if (this.sinceSend < this.minInterval) return null;
    if (this.lastSent === null || Math.abs(q - this.lastSent) >= this.deadband || this.sinceSend >= this.keepAlive) {
      this.lastSent = q;
      this.sinceSend = 0;
      return q;
    }
    return null;
  }

  reset(gradePercent = 0): void {
    this.value = gradePercent;
    this.lastSent = null;
    this.sinceSend = Infinity;
  }
}

/**
 * « Power match » : les pédales sont la référence, la consigne ERG envoyée au trainer est
 * corrigée en boucle lente par le rapport moyen puissance trainer / puissance pédales.
 *   consigne_trainer = cible × ratio,   ratio = EMA(P_trainer / P_pédales) sur ~30 s, borné.
 */
export class PowerMatch {
  ratio = 1;
  private readonly tau: number;
  private readonly minW: number;
  private readonly lo: number;
  private readonly hi: number;

  constructor(opts: { timeConstantS?: number; minWatts?: number; minRatio?: number; maxRatio?: number } = {}) {
    this.tau = opts.timeConstantS ?? 30;
    this.minW = opts.minWatts ?? 50;
    this.lo = opts.minRatio ?? 0.8;
    this.hi = opts.maxRatio ?? 1.25;
  }

  update(pedalWatts: number, trainerWatts: number, dt: number): void {
    if (pedalWatts < this.minW || trainerWatts < this.minW) return;
    const r = Math.min(Math.max(trainerWatts / pedalWatts, this.lo), this.hi);
    this.ratio += (r - this.ratio) * (1 - Math.exp(-dt / this.tau));
  }

  /** Consigne ERG à envoyer pour obtenir `targetWatts` mesurés aux pédales. */
  correct(targetWatts: number): number {
    return Math.round(targetWatts * this.ratio);
  }
}
