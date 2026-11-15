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

/** Protocoles du test FTP : rampe standard, rampe douce (débutants, coureurs légers), test de 20 minutes. */
export type FtpTestProtocol = 'ramp' | 'rampLite' | 'ftp20';
export const FTP_TEST_PROTOCOLS: readonly FtpTestProtocol[] = ['ramp', 'rampLite', 'ftp20'];

/** Cadence conseillée pendant les paliers de la rampe (assis, régulier). */
export const RAMP_CADENCE = { low: 70, high: 100 } as const;

/** Messages de l'échauffement de la rampe, répartis sur sa durée. */
function rampWarmupMessages(warmupS: number, startWatts: number, stepWatts: number): WorkoutTextEvent[] {
  const lines = [
    'Échauffement : pédale tranquillement, trouve ta position.',
    'Le test : des paliers d’une minute qui montent jusqu’à ce que tu ne puisses plus suivre.',
    `Départ à ${startWatts} W, puis +${stepWatts} W chaque minute. Le home trainer règle la puissance.`,
    'Reste assis tout le test et garde une cadence régulière, entre 80 et 95 tr/min.',
    'Ta FTP vient de ta meilleure minute : chaque coup de pédale compte à la fin.',
    'Le début est très facile, c’est voulu. Ça devient dur d’un coup : c’est là qu’il faut tenir.',
    'Le test s’arrête tout seul quand tu ne tiens plus le palier pendant 15 secondes.',
    'Ventilateur, bidon, serviette : tout est prêt ? C’est parti dans une minute.',
  ];
  const span = Math.max(60, warmupS - 60);
  return lines.map((message, i) => ({ offsetS: Math.round(10 + (i * span) / lines.length), message, durationS: 12 }));
}

/** Messages des paliers : quelques encouragements, du facile au très dur. */
function rampStepMessage(i: number, watts: number): WorkoutTextEvent[] | undefined {
  const at: Record<number, string> = {
    0: `Premier palier, ${watts} W : très facile, installe ton rythme.`,
    3: 'Toujours facile : régularité avant tout.',
    7: 'Ça commence à chauffer. Reste assis, souffle profondément.',
    11: 'Dur maintenant ? Encore une minute, puis une autre.',
    15: 'Chaque palier tenu compte. Tiens jusqu’au bout de la minute !',
    19: 'Énorme ! Tout ce que tu as, jusqu’à la dernière seconde.',
  };
  const m = at[i];
  return m ? [{ offsetS: 2, message: m, durationS: 10 }] : undefined;
}

/**
 * Test rampe (protocole usuel des applis) : échauffement puis paliers d'une minute de +`stepWatts`
 * à partir de `startWatts`, jusqu'à épuisement (au plus `maxSteps` paliers). FTP = 75 % de la
 * meilleure minute (`ftpFromRampTest`). Par défaut : 5 min à 100 W, puis 100 W + 20 W par minute.
 */
export function rampTestWorkout(
  opts: { startWatts?: number; stepWatts?: number; maxSteps?: number; warmupS?: number; warmupWatts?: [number, number]; name?: string } = {},
): Workout {
  const start = opts.startWatts ?? 100;
  const inc = opts.stepWatts ?? 20;
  const warmupS = opts.warmupS ?? 300;
  const [w0, w1] = opts.warmupWatts ?? [100, 100];
  const steps: WorkoutStep[] = [
    { kind: 'warmup', mode: 'erg', durationS: warmupS, powerStart: w0, powerEnd: w1, powerUnit: 'watts', textEvents: rampWarmupMessages(warmupS, start, inc) },
  ];
  const count = opts.maxSteps ?? 30;
  for (let i = 0; i < count; i++) {
    const w = start + inc * i;
    const msg = rampStepMessage(i, w);
    steps.push({
      kind: 'steady',
      mode: 'erg',
      durationS: 60,
      powerStart: w,
      powerEnd: w,
      powerUnit: 'watts',
      cadenceLow: RAMP_CADENCE.low,
      cadenceHigh: RAMP_CADENCE.high,
      repeatIndex: i,
      repeatCount: count,
      ...(msg ? { textEvents: msg } : {}),
    });
  }
  return { name: opts.name ?? 'Test rampe', description: 'Paliers d’une minute jusqu’à épuisement.', tags: ['ftp'], steps };
}

/** Rampe douce (débutants, coureurs légers) : 8 min d'échauffement, puis 50 W et +10 W par minute. */
export function rampLiteTestWorkout(): Workout {
  return rampTestWorkout({ startWatts: 50, stepWatts: 10, maxSteps: 45, warmupS: 480, warmupWatts: [50, 80], name: 'Test rampe douce' });
}

/**
 * Test 20 min (protocole Allen & Coggan) : 20 min d'échauffement progressif, trois fois 20 s à 80, 100 et
 * 120 % de FTP pour réveiller les jambes, 5 min faciles, 5 min à 110 %, 10 min faciles, puis 20 min
 * libres au maximum tenable (FTP = 95 % de la moyenne, `ftpFrom20MinTest`), et 10 min de retour au calme.
 */
export function ftp20MinTestWorkout(): Workout {
  const steps: WorkoutStep[] = [
    {
      kind: 'warmup',
      mode: 'erg',
      durationS: 1200,
      powerStart: 0.3,
      powerEnd: 0.7,
      powerUnit: 'ftp',
      textEvents: [
        { offsetS: 10, message: 'Test FTP 20 min : 20 minutes d’échauffement progressif pour commencer.', durationS: 12 },
        { offsetS: 60, message: 'Monte la cadence vers 90–100 tr/min, sans forcer.', durationS: 12 },
        { offsetS: 300, message: 'Ensuite : trois accélérations courtes, 5 min soutenues, puis 10 min faciles avant le test.', durationS: 12 },
        { offsetS: 900, message: 'Ventilateur, bidon, serviette : prépare-toi tranquillement.', durationS: 12 },
      ],
    },
  ];
  for (let i = 0; i < 3; i++) {
    for (const p of [0.8, 1, 1.2]) steps.push({ kind: 'intervalOn', mode: 'erg', durationS: 20, powerStart: p, powerEnd: p, powerUnit: 'ftp', cadence: 100, repeatIndex: i, repeatCount: 3 });
  }
  steps.push({ kind: 'steady', mode: 'erg', durationS: 300, powerStart: 0.5, powerEnd: 0.5, powerUnit: 'ftp' });
  steps.push({ kind: 'steady', mode: 'erg', durationS: 300, powerStart: 1.1, powerEnd: 1.1, powerUnit: 'ftp', textEvents: [{ offsetS: 0, message: '5 minutes soutenues pour ouvrir les jambes.', durationS: 10 }] });
  steps.push({
    kind: 'steady',
    mode: 'erg',
    durationS: 600,
    powerStart: 0.5,
    powerEnd: 0.5,
    powerUnit: 'ftp',
    textEvents: [
      { offsetS: 10, message: 'Récupère : le test de 20 minutes commence dans 10 minutes.', durationS: 12 },
      { offsetS: 570, message: 'Dans 30 secondes : 20 minutes au maximum que tu peux tenir. Pars prudemment.', durationS: 15 },
    ],
  });
  steps.push({
    kind: 'freeRide',
    mode: 'free',
    durationS: 1200,
    powerStart: 0,
    powerEnd: 0,
    powerUnit: 'ftp',
    textEvents: [
      { offsetS: 0, message: 'C’est parti : monte à la puissance que tu penses tenir 20 minutes.', durationS: 15 },
      { offsetS: 300, message: '5 minutes faites. Régulier !', durationS: 10 },
      { offsetS: 600, message: 'Mi-parcours. Si c’est facile, ajoute 10 W.', durationS: 10 },
      { offsetS: 900, message: '5 minutes. Tiens ton allure.', durationS: 10 },
      { offsetS: 1080, message: '2 minutes : augmente si tu peux.', durationS: 10 },
      { offsetS: 1140, message: 'Dernière minute, tout ce qui reste !', durationS: 10 },
      { offsetS: 1180, message: '20 secondes, ne lâche rien !', durationS: 10 },
    ],
  });
  steps.push({ kind: 'cooldown', mode: 'erg', durationS: 600, powerStart: 0.6, powerEnd: 0.4, powerUnit: 'ftp', textEvents: [{ offsetS: 0, message: 'Bravo ! Retour au calme.', durationS: 10 }] });
  return { name: 'Test FTP 20 min', tags: ['ftp'], steps };
}

/** Séance du protocole de test choisi. */
export function ftpTestWorkout(p: FtpTestProtocol): Workout {
  return p === 'ftp20' ? ftp20MinTestWorkout() : p === 'rampLite' ? rampLiteTestWorkout() : rampTestWorkout();
}
