/**
 * Posture de l'avatar (assis / danseuse / roue libre) avec hystérésis et temps de maintien,
 * pour éviter le scintillement d'animation. Déterministe : utilisable côté serveur
 * (`RiderSnapshot.pose`) comme côté client.
 *
 * Règles :
 * - roue libre : puissance < `coastWatts` ou cadence < `coastCadence` pendant `coastDelayS` ;
 * - danseuse : sprint (P > 1,5·FTP), ou montée (pente ≥ 6 %) avec P > 0,95·FTP, ou effort
 *   en force (cadence < 65 et P > 1,1·FTP) ; on en sort sous des seuils plus bas (hystérésis) ;
 * - sinon assis. Chaque état est tenu au moins `minHoldS`.
 */

export type Pose = 'seated' | 'standing' | 'coasting';

export interface PoseInput {
  watts: number;
  cadence: number;
  gradePercent: number;
  ftpWatts: number;
  speedMs?: number;
}

export interface PoseOptions {
  coastWatts?: number;
  coastCadence?: number;
  coastDelayS?: number;
  minHoldS?: number;
}

/** Facteurs d'entrée/sortie de la danseuse (fraction de FTP). */
const SPRINT_IN = 1.5;
const SPRINT_OUT = 1.25;
const CLIMB_GRADE_IN = 6;
const CLIMB_GRADE_OUT = 4.5;
const CLIMB_IN = 0.95;
const CLIMB_OUT = 0.8;
const GRIND_CAD_IN = 65;
const GRIND_CAD_OUT = 72;
const GRIND_IN = 1.1;
const GRIND_OUT = 0.95;

export class PoseController {
  pose: Pose = 'seated';
  private held = 0;
  private lowFor = 0;
  private readonly coastWatts: number;
  private readonly coastCadence: number;
  private readonly coastDelay: number;
  private readonly minHold: number;

  constructor(opts: PoseOptions = {}) {
    this.coastWatts = opts.coastWatts ?? 15;
    this.coastCadence = opts.coastCadence ?? 20;
    this.coastDelay = opts.coastDelayS ?? 0.6;
    this.minHold = opts.minHoldS ?? 1.2;
  }

  update(input: PoseInput, dt: number): Pose {
    this.held += dt;
    const ftp = Math.max(input.ftpWatts, 1);
    const rel = input.watts / ftp;
    const low = input.watts < this.coastWatts || input.cadence < this.coastCadence;
    this.lowFor = low ? this.lowFor + dt : 0;

    let next: Pose;
    if (this.lowFor >= this.coastDelay || (low && this.pose === 'coasting')) {
      next = 'coasting';
    } else if (low) {
      next = this.pose; // en attente de confirmation de roue libre
    } else if (this.pose === 'standing') {
      const keep =
        rel > SPRINT_OUT ||
        (input.gradePercent >= CLIMB_GRADE_OUT && rel > CLIMB_OUT) ||
        (input.cadence < GRIND_CAD_OUT && rel > GRIND_OUT);
      next = keep ? 'standing' : 'seated';
    } else {
      const stand =
        rel > SPRINT_IN ||
        (input.gradePercent >= CLIMB_GRADE_IN && rel > CLIMB_IN) ||
        (input.cadence < GRIND_CAD_IN && rel > GRIND_IN);
      next = stand ? 'standing' : 'seated';
    }
    // Sortir de la roue libre se fait immédiatement (on voit tout de suite le pédalage).
    if (next !== this.pose && (this.held >= this.minHold || this.pose === 'coasting')) {
      this.pose = next;
      this.held = 0;
    }
    return this.pose;
  }

  reset(pose: Pose = 'seated'): void {
    this.pose = pose;
    this.held = 0;
    this.lowFor = 0;
  }
}
