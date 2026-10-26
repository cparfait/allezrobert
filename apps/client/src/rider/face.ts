/**
 * Visage en sortie (docs/AVATARS.md § 5) : poids des formes ARKit de l'avatar MPFB d'après
 * l'effort, la respiration, la posture et des clignements. Logique pure (aucun THREE) : l'avatar
 * appelle update() à chaque image et applique les poids rendus.
 *
 * Chaque poids suit sa cible par une poursuite exponentielle (aucune transition brusque) ;
 * les clignements ont une fermeture rapide et une ouverture plus lente.
 */

export interface FaceInputs {
  /** Puissance sur ~10 s rapportée à la FTP (1 = seuil). */
  ftpFrac: number;
  /** Fréquence cardiaque rapportée à la FC max (0–1) ; absente : déduite de l'effort. */
  hrFrac?: number;
  cadence: number;
  /** Vitesse (m/s). */
  speed: number;
  standing: boolean;
}

/** Formes pilotées (toutes présentes dans le modèle MPFB). */
export const FACE_SHAPES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'eyeSquintLeft', 'eyeSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'noseSneerLeft', 'noseSneerRight', 'jawOpen', 'mouthFunnel', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthPressLeft', 'mouthPressRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'tongueOut',
] as const;
export type FaceShapeName = (typeof FACE_SHAPES)[number];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class FaceAnimator {
  readonly weights: Record<FaceShapeName, number> = Object.fromEntries(FACE_SHAPES.map((n) => [n, 0])) as Record<FaceShapeName, number>;
  private breath = 0;
  private blinkIn: number;
  private blinkT = -1;
  private effort = 0;

  /** Effort lissé (puissance / FTP), pour la peau (rougeur, sueur). */
  get effortLevel(): number {
    return this.effort;
  }

  /** `random` : source pseudo-aléatoire (tests). */
  constructor(private readonly random: () => number = Math.random) {
    this.blinkIn = 1 + this.random() * 3;
  }

  update(dt: number, inp: FaceInputs): Readonly<Record<FaceShapeName, number>> {
    // Effort lissé (le visage réagit en quelques secondes, pas à chaque coup de pédale).
    const ftp = Math.max(0, inp.ftpFrac);
    this.effort += (ftp - this.effort) * (1 - Math.exp(-dt / 2));
    const e = this.effort;
    const hr = inp.hrFrac ?? Math.min(1, 0.55 + 0.4 * e);
    const coasting = inp.cadence < 5;
    const hard = smoothstep(0.85, 1.3, e); // grimace d'effort
    const sprint = inp.standing ? smoothstep(1.2, 1.6, e) : 0;
    const descent = coasting && inp.speed > 12 ? 1 : 0;

    // Respiration : 12 → 50 cycles par minute selon la FC ; bouche plus ouverte dans l'effort.
    const rate = 12 + 38 * smoothstep(0.5, 1, hr);
    this.breath = (this.breath + (dt * rate) / 60) % 1;
    const inhale = 0.5 - 0.5 * Math.cos(this.breath * Math.PI * 2);
    const amp = coasting ? 0.04 : 0.05 + 0.3 * smoothstep(0.6, 1.2, e);

    // Clignements : toutes les 3 à 6 s, plus rares dans l'effort ; 60 ms pour fermer, 120 pour rouvrir.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkIn = (3 + this.random() * 3) * (1 + 0.5 * hard);
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = this.blinkT < 0.06 ? this.blinkT / 0.06 : Math.max(0, 1 - (this.blinkT - 0.06) / 0.12);
      if (this.blinkT > 0.18) this.blinkT = -1;
    }

    const target: Record<FaceShapeName, number> = {
      browDownLeft: 0.7 * hard,
      browDownRight: 0.7 * hard,
      browInnerUp: 0.25 * smoothstep(0.7, 1, e) * (1 - hard),
      eyeSquintLeft: 0.6 * hard,
      eyeSquintRight: 0.6 * hard,
      eyeBlinkLeft: blink,
      eyeBlinkRight: blink,
      noseSneerLeft: 0.5 * hard,
      noseSneerRight: 0.5 * hard,
      jawOpen: amp * inhale + 0.15 * sprint,
      mouthFunnel: 0.25 * smoothstep(0.7, 1.1, e) * (1 - inhale) * (1 - sprint),
      mouthLowerDownLeft: 0.4 * hard * inhale,
      mouthLowerDownRight: 0.4 * hard * inhale,
      mouthStretchLeft: 0.55 * hard + 0.4 * sprint,
      mouthStretchRight: 0.55 * hard + 0.4 * sprint,
      mouthSmileLeft: 0.3 * descent,
      mouthSmileRight: 0.3 * descent,
      mouthPressLeft: 0.3 * smoothstep(0.9, 1.1, e) * (1 - hard),
      mouthPressRight: 0.3 * smoothstep(0.9, 1.1, e) * (1 - hard),
      // Sprint : joues gonflées à l'expiration.
      cheekPuff: 0.6 * sprint * (1 - inhale),
      cheekSquintLeft: 0.5 * hard,
      cheekSquintRight: 0.5 * hard,
      // Effort extrême : la langue sort à l'inspiration.
      tongueOut: 0.45 * smoothstep(1.25, 1.5, e) * inhale,
    };
    // Poursuite : rapide pour la respiration et les clignements, lente pour la grimace.
    for (const n of FACE_SHAPES) {
      const fast = n.startsWith('eyeBlink') || n === 'jawOpen' || n === 'cheekPuff' || n === 'mouthFunnel' || n.startsWith('mouthLowerDown');
      const tau = n.startsWith('eyeBlink') ? 0.01 : fast ? 0.12 : 0.6;
      const k = 1 - Math.exp(-dt / tau);
      this.weights[n] += (Math.min(1, target[n]) - this.weights[n]) * k;
    }
    return this.weights;
  }
}
