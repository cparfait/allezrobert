/**
 * Modèle commun des séances (issu de .zwo, .erg, .mrc ou généré) et lecteur temporel.
 */

/** Type d'étape : `erg` = cible de puissance, `free` = libre (mode simulation), `max` = effort max. */
export type WorkoutStepMode = 'erg' | 'free' | 'max';

export type WorkoutStepKind = 'warmup' | 'cooldown' | 'steady' | 'ramp' | 'intervalOn' | 'intervalOff' | 'freeRide' | 'maxEffort';

export interface WorkoutTextEvent {
  /** Décalage depuis le début de l'étape (s). */
  offsetS: number;
  message: string;
  /** Durée d'affichage (s). Défaut 10. */
  durationS?: number;
}

export interface WorkoutStep {
  kind: WorkoutStepKind;
  mode: WorkoutStepMode;
  durationS: number;
  /** Cible en début et fin d'étape (rampe linéaire ; égales pour un palier). */
  powerStart: number;
  powerEnd: number;
  /** `ftp` : fraction de FTP (0,75 = 75 %) ; `watts` : valeur absolue. */
  powerUnit: 'ftp' | 'watts';
  /** Cadence conseillée (tr/min). */
  cadence?: number;
  cadenceLow?: number;
  cadenceHigh?: number;
  /** Pour les intervalles : numéro de répétition (0…) et total. */
  repeatIndex?: number;
  repeatCount?: number;
  textEvents?: WorkoutTextEvent[];
}

export interface Workout {
  name: string;
  author?: string;
  description?: string;
  tags?: string[];
  /** FTP indiquée par le fichier (.erg), informative. */
  fileFtpWatts?: number;
  steps: WorkoutStep[];
}

/** Durée totale (s). */
export function workoutDuration(w: Workout): number {
  let s = 0;
  for (const st of w.steps) s += st.durationS;
  return s;
}

/** Puissance cible (W) d'une étape à une fraction de sa durée (0–1), ou null (libre / max). */
export function stepTargetWatts(step: WorkoutStep, fraction: number, ftpWatts: number): number | null {
  if (step.mode !== 'erg') return null;
  const f = Math.min(Math.max(fraction, 0), 1);
  const v = step.powerStart + (step.powerEnd - step.powerStart) * f;
  return step.powerUnit === 'ftp' ? v * ftpWatts : v;
}

/** État du lecteur à un instant. */
export interface WorkoutPosition {
  /** Indice de l'étape courante (= steps.length une fois terminé). */
  stepIndex: number;
  step: WorkoutStep | undefined;
  stepElapsedS: number;
  stepRemainingS: number;
  /** Avancement de l'étape (0–1). */
  stepProgress: number;
  /** Avancement global (0–1). */
  totalProgress: number;
  elapsedS: number;
  remainingS: number;
  /** Puissance cible (W), null en libre / effort max / terminé. */
  targetWatts: number | null;
  mode: WorkoutStepMode | 'done';
  cadence?: number;
  /** Messages à afficher à cet instant. */
  messages: string[];
  finished: boolean;
}

export interface WorkoutRunnerOptions {
  ftpWatts: number;
  /** Intensité globale (1 = 100 %), modifiable en cours de séance. */
  intensity?: number;
}

/**
 * Lecteur sans état temporel interne : `at(t)` donne la position à t secondes du début.
 * Recherche dichotomique dans les débuts d'étapes (O(log n)) ; sauter une étape revient
 * à appeler `at(stepStartS(i))`.
 */
export class WorkoutRunner {
  readonly workout: Workout;
  readonly totalDurationS: number;
  ftpWatts: number;
  intensity: number;
  private readonly starts: Float64Array;

  constructor(workout: Workout, opts: WorkoutRunnerOptions) {
    this.workout = workout;
    this.ftpWatts = opts.ftpWatts;
    this.intensity = opts.intensity ?? 1;
    this.starts = new Float64Array(workout.steps.length + 1);
    let s = 0;
    for (let i = 0; i < workout.steps.length; i++) {
      this.starts[i] = s;
      s += workout.steps[i]!.durationS;
    }
    this.starts[workout.steps.length] = s;
    this.totalDurationS = s;
  }

  /** Début de l'étape i (s). */
  stepStartS(i: number): number {
    const k = Math.min(Math.max(i, 0), this.workout.steps.length);
    return this.starts[k]!;
  }

  /** Indice de l'étape contenant t. */
  stepIndexAt(tS: number): number {
    const m = this.workout.steps.length;
    if (tS >= this.totalDurationS) return m;
    if (tS <= 0) return 0;
    let lo = 0;
    let hi = m - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= tS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  at(tS: number): WorkoutPosition {
    const idx = this.stepIndexAt(tS);
    const total = this.totalDurationS;
    const elapsed = Math.min(Math.max(tS, 0), total);
    const step = this.workout.steps[idx];
    if (!step) {
      return {
        stepIndex: idx,
        step: undefined,
        stepElapsedS: 0,
        stepRemainingS: 0,
        stepProgress: 1,
        totalProgress: 1,
        elapsedS: total,
        remainingS: 0,
        targetWatts: null,
        mode: 'done',
        messages: [],
        finished: true,
      };
    }
    const se = elapsed - this.starts[idx]!;
    const frac = step.durationS > 0 ? se / step.durationS : 1;
    const target = stepTargetWatts(step, frac, this.ftpWatts);
    const messages: string[] = [];
    if (step.textEvents) {
      for (const e of step.textEvents) if (se >= e.offsetS && se < e.offsetS + (e.durationS ?? 10)) messages.push(e.message);
    }
    const pos: WorkoutPosition = {
      stepIndex: idx,
      step,
      stepElapsedS: se,
      stepRemainingS: step.durationS - se,
      stepProgress: frac,
      totalProgress: total > 0 ? elapsed / total : 1,
      elapsedS: elapsed,
      remainingS: total - elapsed,
      targetWatts: target === null ? null : Math.round(target * this.intensity),
      mode: step.mode,
      messages,
      finished: false,
    };
    if (step.cadence !== undefined) pos.cadence = step.cadence;
    return pos;
  }
}

/**
 * Test rampe (protocole usuel) : 5 min d'échauffement à 100 W puis paliers d'une minute
 * de +`stepWatts` (20 W par défaut) à partir de `startWatts`, jusqu'à épuisement
 * (durée maximale `maxSteps` paliers). FTP = 75 % de la meilleure minute
 * (`ftpFromRampTest`).
 */
export function rampTestWorkout(opts: { startWatts?: number; stepWatts?: number; maxSteps?: number } = {}): Workout {
  const start = opts.startWatts ?? 100;
  const inc = opts.stepWatts ?? 20;
  const steps: WorkoutStep[] = [
    { kind: 'warmup', mode: 'erg', durationS: 300, powerStart: 100, powerEnd: 100, powerUnit: 'watts' },
  ];
  const count = opts.maxSteps ?? 30;
  for (let i = 0; i < count; i++) {
    const w = start + inc * i;
    steps.push({ kind: 'steady', mode: 'erg', durationS: 60, powerStart: w, powerEnd: w, powerUnit: 'watts', repeatIndex: i, repeatCount: count });
  }
  return { name: 'Test rampe', description: 'Paliers d’une minute jusqu’à épuisement.', tags: ['ftp'], steps };
}

/**
 * Test 20 min (protocole Allen & Coggan simplifié) : échauffement, 3 × 1 min à 100 % FTP,
 * 5 min récupération, 5 min tout droit, 10 min récupération, 20 min effort libre, retour au calme.
 */
export function ftp20MinTestWorkout(): Workout {
  const steps: WorkoutStep[] = [
    { kind: 'warmup', mode: 'erg', durationS: 600, powerStart: 0.5, powerEnd: 0.75, powerUnit: 'ftp' },
  ];
  for (let i = 0; i < 3; i++) {
    steps.push({ kind: 'intervalOn', mode: 'erg', durationS: 60, powerStart: 1, powerEnd: 1, powerUnit: 'ftp', cadence: 100, repeatIndex: i, repeatCount: 3 });
    steps.push({ kind: 'intervalOff', mode: 'erg', durationS: 60, powerStart: 0.5, powerEnd: 0.5, powerUnit: 'ftp', repeatIndex: i, repeatCount: 3 });
  }
  steps.push({ kind: 'steady', mode: 'erg', durationS: 300, powerStart: 0.5, powerEnd: 0.5, powerUnit: 'ftp' });
  steps.push({ kind: 'maxEffort', mode: 'max', durationS: 300, powerStart: 0, powerEnd: 0, powerUnit: 'ftp' });
  steps.push({ kind: 'steady', mode: 'erg', durationS: 600, powerStart: 0.5, powerEnd: 0.5, powerUnit: 'ftp' });
  steps.push({
    kind: 'freeRide',
    mode: 'free',
    durationS: 1200,
    powerStart: 0,
    powerEnd: 0,
    powerUnit: 'ftp',
    textEvents: [{ offsetS: 0, message: '20 minutes à fond, mais régulier !' }],
  });
  steps.push({ kind: 'cooldown', mode: 'erg', durationS: 600, powerStart: 0.6, powerEnd: 0.4, powerUnit: 'ftp' });
  return { name: 'Test FTP 20 min', tags: ['ftp'], steps };
}
