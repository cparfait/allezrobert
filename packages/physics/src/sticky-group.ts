/**
 * « Groupe soudé » : régulateur côté serveur qui empêche le groupe de se disloquer.
 *
 * Principe (élastique) : après le pas physique de chaque coureur, on calcule le centre du
 * groupe (médiane des distances, robuste à un coureur isolé) et sa vitesse moyenne. Chaque
 * coureur reste libre dans une zone morte de ±`deadbandM` autour du centre (on peut remonter
 * en tête, sprinter, se laisser glisser). Au-delà, une accélération de rappel
 *   a = −k · e_excès − c · (v − v_centre)      (ressort amorti, bornée à ±maxAccel)
 * est appliquée à la vitesse : un coureur devant est freiné, un coureur décroché est aidé.
 * Enfin une borne dure garantit |distM − centre| ≤ maxGapM (repositionnement + vitesse du
 * groupe si l'écart continuait de croître). La puissance mesurée n'est jamais modifiée :
 * seule la vitesse virtuelle l'est, et l'aide appliquée est renvoyée pour l'affichage
 * (« assisté »). Utilisé aussi pour l'invité « accroché » au peloton.
 */

export interface StickyRider {
  distM: number;
  speedMs: number;
  /** Faux = coureur hors du groupe soudé (ignoré, non régulé). Vrai par défaut. */
  inGroup?: boolean;
}

export interface StickyGroupOptions {
  /** Demi-largeur de la zone libre autour du centre (m). Défaut 8. */
  deadbandM?: number;
  /** Écart maximal au centre (m). Défaut 30. */
  maxGapM?: number;
  /** Raideur du rappel (1/s²). Défaut 0,04. */
  stiffness?: number;
  /** Amortissement (1/s). Défaut 0,8. */
  damping?: number;
  /** Accélération de rappel maximale (m/s²). Défaut 1,5. */
  maxAccelMs2?: number;
}

export interface StickyGroupResult {
  centerDistM: number;
  centerSpeedMs: number;
  /** Nombre de coureurs régulés. */
  count: number;
}

export class StickyGroupRegulator {
  readonly deadbandM: number;
  readonly maxGapM: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly maxAccelMs2: number;
  private scratch: Float64Array = new Float64Array(32);
  private assistBuf: Float64Array = new Float64Array(32);

  constructor(opts: StickyGroupOptions = {}) {
    this.deadbandM = opts.deadbandM ?? 8;
    this.maxGapM = Math.max(opts.maxGapM ?? 30, this.deadbandM);
    this.stiffness = opts.stiffness ?? 0.04;
    this.damping = opts.damping ?? 0.8;
    this.maxAccelMs2 = opts.maxAccelMs2 ?? 1.5;
  }

  /**
   * Applique la régulation (mute `distM`/`speedMs`). `assist()` donne ensuite l'accélération
   * appliquée à chaque coureur (m/s², positive = aidé, négative = retenu).
   */
  apply(riders: ArrayLike<StickyRider>, dt: number): StickyGroupResult {
    const n = riders.length;
    if (this.scratch.length < n) {
      this.scratch = new Float64Array(2 * n);
      this.assistBuf = new Float64Array(2 * n);
    }
    const assist = this.assistBuf;
    assist.fill(0, 0, n);
    let m = 0;
    let vSum = 0;
    for (let i = 0; i < n; i++) {
      const r = riders[i]!;
      if (r.inGroup === false) continue;
      this.scratch[m++] = r.distM;
      vSum += r.speedMs;
    }
    if (m === 0) return { centerDistM: 0, centerSpeedMs: 0, count: 0 };
    const sorted = this.scratch.subarray(0, m).sort();
    const center = m % 2 === 1 ? sorted[(m - 1) >> 1]! : 0.5 * (sorted[m / 2 - 1]! + sorted[m / 2]!);
    const vc = vSum / m;
    if (m < 2 || dt <= 0) return { centerDistM: center, centerSpeedMs: vc, count: m };

    for (let i = 0; i < n; i++) {
      const r = riders[i]!;
      if (r.inGroup === false) continue;
      const e = r.distM - center;
      const ae = Math.abs(e);
      if (ae <= this.deadbandM) continue;
      const sign = e > 0 ? 1 : -1;
      const excess = sign * (ae - this.deadbandM);
      const dv = r.speedMs - vc;
      let a = -this.stiffness * excess;
      // Amortissement seulement s'il éloigne encore du groupe (n'empêche pas de revenir).
      if (dv * sign > 0) a -= this.damping * dv;
      if (a > this.maxAccelMs2) a = this.maxAccelMs2;
      else if (a < -this.maxAccelMs2) a = -this.maxAccelMs2;
      let v = r.speedMs + a * dt;
      if (v < 0) v = 0;
      r.distM += (v - r.speedMs) * dt;
      r.speedMs = v;
      // Borne dure.
      const e2 = r.distM - center;
      if (Math.abs(e2) > this.maxGapM) {
        r.distM = center + sign * this.maxGapM;
        if ((r.speedMs - vc) * sign > 0) r.speedMs = vc;
      }
      assist[i] = a;
    }
    return { centerDistM: center, centerSpeedMs: vc, count: m };
  }

  /** Accélérations appliquées lors du dernier `apply` (vue, ordre d'entrée). */
  assist(count: number): Float64Array {
    return this.assistBuf.subarray(0, count);
  }
}
