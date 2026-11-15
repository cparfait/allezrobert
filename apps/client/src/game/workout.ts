import {
  WorkoutRunner,
  parseWorkoutFile,
  ftpTestWorkout,
  ftpFromRampTest,
  ftpFrom20MinTest,
  meanMaxPower,
  workoutDuration,
  stepTargetWatts,
  WORKOUT_LIBRARY,
  type FtpTestProtocol,
  type Workout,
  type WorkoutPosition,
} from '@allezrobert/physics';

export type WorkoutKind = 'file' | 'library' | FtpTestProtocol;

/** Test FTP (rampe, rampe douce, 20 min) ? */
export const isFtpTestKind = (k: WorkoutKind): k is FtpTestProtocol => k === 'ramp' || k === 'rampLite' || k === 'ftp20';
const isRampKind = (k: WorkoutKind) => k === 'ramp' || k === 'rampLite';

/** Rampe : fin automatique quand la puissance reste sous `RAMP_FAIL_RATIO` × la cible pendant `RAMP_FAIL_S` secondes. */
export const RAMP_FAIL_S = 15;
export const RAMP_FAIL_RATIO = 0.85;
/** Rampe : paliers complets minimum pour un résultat (en dessous, l'effort est trop court pour estimer une FTP). */
export const RAMP_MIN_STEPS = 3;

/** Comment le test s'est terminé : fin des étapes, palier non tenu, sortie quittée en plein test. */
export type FtpTestEnd = 'completed' | 'failed' | 'quit';

/** Estimation affichée pendant le test : FTP estimée et sur quoi elle repose. */
export interface LiveFtpEstimate {
  ftp: number;
  /** Rampe : meilleure minute (W) ; 20 min : moyenne de l'effort en cours (W). */
  basisWatts: number;
  basis: 'bestMinute' | 'average20';
}

/**
 * Séance structurée pendant la sortie : consigne ERG envoyée au home trainer (corrigée par
 * le power match côté DeviceManager), messages, et, pour les tests FTP, fin automatique de la
 * rampe, estimation en direct et estimation finale.
 */
export class WorkoutController {
  readonly runner: WorkoutRunner;
  readonly kind: WorkoutKind;
  readonly workout: Workout;
  position: WorkoutPosition;
  /** Puissance mesurée, un échantillon par seconde de séance. */
  private readonly watts: number[] = [];
  private lastMessages = '';
  onMessage?: (text: string) => void;
  /** Fin de la séance ; pour un test FTP, `ftpEstimate` est null si l'effort ne permet pas d'estimer. */
  onFinished?: (ftpEstimate: number | null, end: FtpTestEnd) => void;
  private finishedNotified = false;
  /** Test terminé avant la fin des étapes (palier non tenu ou sortie quittée). */
  private endedEarly = false;
  /** Rampe : instant (s) où la puissance est passée sous le seuil de fin, null au-dessus. */
  private belowSince: number | null = null;
  /** Début (s) des paliers de la rampe, ou de l'effort libre du test 20 min. */
  private readonly effortStartS: number;
  private readonly effortDurationS: number;

  /**
   * `file` : séance importée ; `library` : séance intégrée dont `presetId` est l'identifiant ;
   * `ramp`, `rampLite`, `ftp20` : tests FTP. `intensity` (0,8–1,2) multiplie toutes les cibles des
   * séances ; les tests FTP l'ignorent.
   */
  constructor(kind: WorkoutKind, ftpWatts: number, file?: { name: string; content: string }, presetId?: string, intensity = 1) {
    this.kind = kind;
    const preset = WORKOUT_LIBRARY.find((w) => w.id === presetId);
    if (kind === 'library' && !preset) throw new Error(`Séance intégrée inconnue : ${presetId}`);
    this.workout = isFtpTestKind(kind)
      ? ftpTestWorkout(kind)
      : kind === 'library'
        ? (preset as (typeof WORKOUT_LIBRARY)[number]).build()
        : parseWorkoutFile((file as { name: string }).name, (file as { content: string }).content);
    this.runner = new WorkoutRunner(this.workout, { ftpWatts, intensity: isFtpTestKind(kind) ? 1 : clampWorkoutIntensity(intensity) });
    this.position = this.runner.at(0);
    // Rampe : les paliers suivent l'échauffement ; 20 min : l'étape d'effort libre.
    const effortIdx = isRampKind(kind) ? 1 : kind === 'ftp20' ? this.workout.steps.findIndex((s) => s.kind === 'freeRide') : -1;
    this.effortStartS = effortIdx >= 0 ? this.runner.stepStartS(effortIdx) : 0;
    this.effortDurationS = effortIdx >= 0 ? (isRampKind(kind) ? this.runner.totalDurationS - this.effortStartS : (this.workout.steps[effortIdx]?.durationS ?? 0)) : 0;
  }

  get durationS(): number {
    return workoutDuration(this.workout);
  }

  /** Test FTP terminé (fin des étapes, palier non tenu ou sortie quittée). */
  get ended(): boolean {
    return this.finishedNotified;
  }

  /** Avance la séance ; renvoie la consigne ERG (W) ou null (pédalage libre en simulation). */
  update(elapsedS: number, measuredWatts: number): number | null {
    if (this.endedEarly) return null;
    this.position = this.runner.at(elapsedS);
    if (Math.floor(elapsedS) > this.watts.length - 1) this.watts.push(measuredWatts);
    const msg = this.position.messages.join(' · ');
    if (msg && msg !== this.lastMessages) this.onMessage?.(msg);
    this.lastMessages = msg;
    // Rampe : palier non tenu pendant 15 s (le coureur ne suit plus la consigne) → fin du test.
    if (isRampKind(this.kind) && !this.position.finished && elapsedS >= this.effortStartS && this.position.targetWatts) {
      if (measuredWatts < RAMP_FAIL_RATIO * this.position.targetWatts) {
        this.belowSince ??= elapsedS;
        if (elapsedS - this.belowSince >= RAMP_FAIL_S) {
          this.endEarly('failed');
          return null;
        }
      } else this.belowSince = null;
    }
    if (this.position.finished && !this.finishedNotified) {
      this.finishedNotified = true;
      this.onFinished?.(this.ftpEstimate(), 'completed');
    }
    return this.position.mode === 'erg' ? this.position.targetWatts : null;
  }

  /**
   * Sortie quittée en plein test : termine le test et rend son résultat (null si l'effort est trop court).
   * Sans effet sur une séance ordinaire ou un test déjà terminé.
   */
  stop(): number | null {
    if (!isFtpTestKind(this.kind) || this.finishedNotified) return null;
    return this.endEarly('quit');
  }

  private endEarly(end: Exclude<FtpTestEnd, 'completed'>): number | null {
    this.endedEarly = true;
    this.finishedNotified = true;
    this.belowSince = null;
    const ftp = this.ftpEstimate();
    this.onFinished?.(ftp, end);
    return ftp;
  }

  /** Secondes d'effort mesurées depuis le début des paliers (rampe) ou de l'effort libre (20 min). */
  private effortSamples(): number[] {
    return this.watts.slice(Math.ceil(this.effortStartS), Math.ceil(this.effortStartS + this.effortDurationS));
  }

  /**
   * Estimation de FTP pour les tests, ou null si l'effort ne suffit pas :
   * rampe : 75 % de la meilleure minute, au moins `RAMP_MIN_STEPS` paliers complets ;
   * 20 min : 95 % de la moyenne des 20 minutes, effort libre complet.
   */
  ftpEstimate(): number | null {
    if (isRampKind(this.kind)) {
      const effort = this.effortSamples();
      if (effort.length < RAMP_MIN_STEPS * 60) return null;
      const ftp = Math.round(ftpFromRampTest(effort));
      return ftp > 0 ? ftp : null;
    }
    if (this.kind === 'ftp20') {
      const effort = this.effortSamples();
      if (effort.length < 1200) return null;
      const ftp = Math.round(ftpFrom20MinTest(effort));
      return ftp > 0 ? ftp : null;
    }
    return null;
  }

  /** Estimation en direct pendant l'effort du test (null avant une minute d'effort, ou hors test). */
  liveEstimate(): LiveFtpEstimate | null {
    if (!isFtpTestKind(this.kind)) return null;
    const effort = this.effortSamples();
    if (effort.length < 60) return null;
    if (isRampKind(this.kind)) {
      const best = meanMaxPower(effort, 60);
      return { ftp: Math.round(0.75 * best), basisWatts: Math.round(best), basis: 'bestMinute' };
    }
    const avg = effort.reduce((a, w) => a + w, 0) / effort.length;
    return { ftp: Math.round(0.95 * avg), basisWatts: Math.round(avg), basis: 'average20' };
  }

  /** Profil de la séance pour le HUD : [début (s), durée (s), cible début (W), cible fin (W)]. */
  profile(ftpWatts: number): Array<[number, number, number, number]> {
    let t = 0;
    const k = this.runner.intensity;
    return this.workout.steps.map((s) => {
      const a0 = stepTargetWatts(s, 0, ftpWatts);
      const a = a0 === null ? ftpWatts * 0.5 : a0 * k;
      const b1 = stepTargetWatts(s, 1, ftpWatts);
      const b = b1 === null ? a : b1 * k;
      const row: [number, number, number, number] = [t, s.durationS, a, b];
      t += s.durationS;
      return row;
    });
  }
}

/** Bornes de l'intensité réglable des séances (80–120 %, pas de 5 %). */
export const WORKOUT_INTENSITY_MIN = 0.8;
export const WORKOUT_INTENSITY_MAX = 1.2;

/** Intensité ramenée dans les bornes et au pas de 5 % ; 1 si la valeur est absente ou invalide. */
export function clampWorkoutIntensity(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  const r = Math.round(n * 20) / 20;
  return Math.min(WORKOUT_INTENSITY_MAX, Math.max(WORKOUT_INTENSITY_MIN, r));
}

/** Protocole de test FTP valide (réglage absent ou inconnu : rampe standard). */
export function ftpTestProtocolOf(v: unknown): FtpTestProtocol {
  return v === 'rampLite' || v === 'ftp20' ? v : 'ramp';
}
