import {
  WorkoutRunner,
  parseWorkoutFile,
  rampTestWorkout,
  ftp20MinTestWorkout,
  ftpFromRampTest,
  ftpFrom20MinTest,
  workoutDuration,
  stepTargetWatts,
  type Workout,
  type WorkoutPosition,
} from '@allezrobert/physics';

export type WorkoutKind = 'file' | 'ramp' | 'ftp20';

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

  constructor(kind: WorkoutKind, ftpWatts: number, file?: { name: string; content: string }) {
    this.kind = kind;
    this.workout = kind === 'ramp' ? rampTestWorkout() : kind === 'ftp20' ? ftp20MinTestWorkout() : parseWorkoutFile((file as { name: string }).name, (file as { content: string }).content);
    this.runner = new WorkoutRunner(this.workout, { ftpWatts });
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
    return this.workout.steps.map((s) => {
      const a = stepTargetWatts(s, 0, ftpWatts) ?? ftpWatts * 0.5;
      const b = stepTargetWatts(s, 1, ftpWatts) ?? a;
      const row: [number, number, number, number] = [t, s.durationS, a, b];
      t += s.durationS;
      return row;
    });
  }
}
