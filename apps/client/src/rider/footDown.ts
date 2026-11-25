import * as THREE from 'three/webgpu';

/**
 * Pied à terre à l'arrêt (Réel et Poly) : pose calculée sur le squelette du jeu, sans clip d'animation. Le coureur
 * descend de selle vers l'avant, incline un peu le vélo et pose le pied gauche ; le droit reste sur sa pédale, manivelle
 * vers l'avant, prêt pour le premier coup. Dès qu'il pédale, il se rassoit et reprend sa pédale.
 * Partie pure testée (footDown.test.ts).
 */

/** Arrêté : sous cette vitesse (m/s) et cette cadence (tr/min), depuis DELAY_S ; reparti au-delà des seuils de sortie. */
const STOP_MS = 0.4;
const STOP_RPM = 5;
const GO_MS = 0.9;
const GO_RPM = 12;
const DELAY_S = 0.25;
/** Durées (s) : poser le pied, le reprendre. */
const DOWN_S = 0.75;
const UP_S = 0.55;

/** Inclinaison du vélo vers le pied posé (rad, côté gauche). */
export const FOOT_LEAN = 0.085;
/** Manivelle gauche, pied droit à deux heures (devant, un peu haut). */
export const FOOT_CRANK = Math.PI / 2 - 0.5;
/** Pied posé, repère du coureur au sol : écart de côté et avance sur le pédalier (m). */
export const FOOT_SIDE_M = 0.25;
export const FOOT_AHEAD_M = 0.06;
/** De l'axe de la pédale à la semelle (m) : le pied, calé sur la pédale, descend d'autant pour toucher le sol. */
export const FOOT_SOLE_M = 0.012;
/** Bassin : avance hors de selle, glissé vers le pied posé, descente minimale (m) ; buste redressé (rad). */
export const FOOT_HIP_AHEAD_M = 0.17;
export const FOOT_HIP_SIDE_M = 0.03;
export const FOOT_HIP_DROP_M = 0.03;
export const FOOT_UPRIGHT = 0.2;
/** Part de la longueur de jambe utilisée, pied au sol (jambe presque tendue). */
export const FOOT_REACH = 0.975;

const ease = (x: number): number => x * x * (3 - 2 * x);

export class FootDown {
  /** Autorisé (sortie) ; coupé au garage, dans les aperçus et les films. */
  enabled = false;
  private t = 0;
  private down = false;
  private stoppedS = 0;
  private fresh = true;

  /** Pied en train d'être posé ou posé (sinon repris ou en selle). */
  get isDown(): boolean {
    return this.down;
  }

  /** Avancement du mouvement, 0 en selle → 1 pied posé (adouci). */
  update(dt: number, cadence: number, speed: number): number {
    if (!this.enabled) {
      this.t = 0;
      this.down = false;
      return 0;
    }
    if (speed < STOP_MS && cadence < STOP_RPM) this.stoppedS += dt;
    else this.stoppedS = 0;
    // Déjà arrêté à la première image (grille de départ) : pied posé d'emblée, sans mouvement.
    if (this.fresh && speed < STOP_MS && cadence < STOP_RPM) {
      this.down = true;
      this.t = 1;
    }
    this.fresh = false;
    if (!this.down && this.stoppedS >= DELAY_S) this.down = true;
    else if (this.down && (speed > GO_MS || cadence > GO_RPM)) this.down = false;
    this.t = THREE.MathUtils.clamp(this.t + (this.down ? dt / DOWN_S : -dt / UP_S), 0, 1);
    return ease(this.t);
  }
}

/** Angle de manivelle rapproché de `target` par le plus court chemin. */
export function crankToward(angle: number, target: number, k: number): number {
  const d = THREE.MathUtils.euclideanModulo(target - angle + Math.PI, Math.PI * 2) - Math.PI;
  return angle + d * k;
}

/** Point du sol sous le pied posé, dans le repère incliné du vélo (`lean` : rotation autour de l'axe avant). */
export function footGround(lean: number, bbZ: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(-lean);
  const s = Math.sin(-lean);
  return out.set(FOOT_SIDE_M * c + FOOT_SOLE_M * s, FOOT_SIDE_M * s - FOOT_SOLE_M * c, bbZ + FOOT_AHEAD_M);
}

/** Trajet du pied de la pédale au sol : il sort sur le côté et se lève un peu pour passer la pédale. */
export function footPath(pedal: THREE.Vector3, ground: THREE.Vector3, e: number, out: THREE.Vector3): THREE.Vector3 {
  const arc = Math.sin(Math.PI * e);
  out.lerpVectors(pedal, ground, e);
  out.x += 0.06 * arc;
  out.y += 0.04 * arc;
  return out;
}

/** Descente du bassin (m) pour que la jambe atteigne le sol : articulation `joint`, cheville `ankle`, longueur `leg`. */
export function hipDrop(joint: THREE.Vector3, ankle: THREE.Vector3, leg: number): number {
  const dx = joint.x - ankle.x;
  const dz = joint.z - ankle.z;
  const reach = Math.sqrt(Math.max((leg * FOOT_REACH) ** 2 - dx * dx - dz * dz, 0));
  return Math.max(FOOT_HIP_DROP_M, joint.y - (ankle.y + reach));
}
