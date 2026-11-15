import {
  WorkoutRunner,
  parseWorkoutFile,
  rampTestWorkout,
  ftp20MinTestWorkout,
  ftpFromRampTest,
  ftpFrom20MinTest,
  workoutDuration,
  stepTargetWatts,
  WORKOUT_LIBRARY,
  type Workout,
  type WorkoutPosition,
} from '@allezrobert/physics';

export type WorkoutKind = 'file' | 'ramp' | 'ftp20' | 'library';

/**
 * Séance structurée pendant la sortie : consigne ERG envoyée au home trainer (corrigée par
 * le power match côté DeviceManager), messages, et, pour les tests FTP, estimation finale.
 */
export class WorkoutController {
  readonly runner: WorkoutRunner;
  readonly kind: WorkoutKind;
  readonly workout: Workout;
  position: WorkoutPosition;
  private readonly watts: number[] = [];
  private lastMessages = '';
  onMessage?: (text: string) => void;
  onFinished?: (ftpEstimate: number | null) => void;
  private finishedNotified = false;

  /**
   * `file` : séance importée ; `library` : séance intégrée dont `presetId` est l'identifiant.
   * `intensity` (0,8–1,2) multiplie toutes les cibles des séances ; les tests FTP l'ignorent.
   */
  constructor(kind: WorkoutKind, ftpWatts: number, file?: { name: string; content: string }, presetId?: string, intensity = 1) {
    this.kind = kind;
    const preset = WORKOUT_LIBRARY.find((w) => w.id === presetId);
    if (kind === 'library' && !preset) throw new Error(`Séance intégrée inconnue : ${presetId}`);
    this.workout =
      kind === 'ramp'
        ? rampTestWorkout()
        : kind === 'ftp20'
          ? ftp20MinTestWorkout()
          : kind === 'library'
            ? (preset as (typeof WORKOUT_LIBRARY)[number]).build()
            : parseWorkoutFile((file as { name: string }).name, (file as { content: string }).content);
    const isTest = kind === 'ramp' || kind === 'ftp20';
    this.runner = new WorkoutRunner(this.workout, { ftpWatts, intensity: isTest ? 1 : clampWorkoutIntensity(intensity) });
    this.position = this.runner.at(0);
  }

  get durationS(): number {
    return workoutDuration(this.workout);
  }

  /** Avance la séance ; renvoie la consigne ERG (W) ou null (pédalage libre en simulation). */
  update(elapsedS: number, measuredWatts: number): number | null {
    this.position = this.runner.at(elapsedS);
    if (Math.floor(elapsedS) > this.watts.length - 1) this.watts.push(measuredWatts);
    const msg = this.position.messages.join(' · ');
    if (msg && msg !== this.lastMessages) this.onMessage?.(msg);
    this.lastMessages = msg;
    if (this.position.finished && !this.finishedNotified) {
      this.finishedNotified = true;
      this.onFinished?.(this.ftpEstimate());
    }
    return this.position.mode === 'erg' ? this.position.targetWatts : null;
  }

  /** Estimation de FTP pour les tests (rampe : 75 % de la meilleure minute ; 20 min : 95 %). */
  ftpEstimate(): number | null {
    if (this.kind === 'ramp') return Math.round(ftpFromRampTest(this.watts));
    if (this.kind === 'ftp20') return Math.round(ftpFrom20MinTest(this.watts));
    return null;
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
