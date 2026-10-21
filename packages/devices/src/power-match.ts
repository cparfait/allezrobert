/**
 * Power match : avec pédales + home trainer en ERG, la puissance de référence vient des pédales et la
 * consigne envoyée au trainer est corrigée lentement pour que les PÉDALES affichent la cible.
 *
 * Boucle PI sur un facteur multiplicatif c : consigne_trainer = cible × (1 + c).
 *   erreur relative e = (cible − pédales_filtrées) / cible
 *   intégrale : c ← c + e · dt / T   (T ≈ 10–20 s, défaut 15 s)
 *   sortie    : (1 + clamp(c + Kp·e, ±15 %))
 * Le facteur c représente l'écart d'étalonnage trainer/pédales : il est conservé quand la cible change.
 * La correction est gelée (pas d'intégration) si la cadence est trop basse, la mesure absente, pendant
 * la stabilisation qui suit un changement de cible (défaut 5 s) ou si l'écart dépasse 25 % (sprint,
 * relance : ce n'est pas un défaut d'étalonnage) — anti-emballement de l'intégrale.
 */
import { clamp } from '@allezrobert/protocols';

export interface PowerMatchOptions {
  /** Constante de temps de l'intégrale (s). Défaut 15. */
  timeConstantS?: number;
  /** Correction maximale en valeur relative. Défaut 0,15 (±15 %). */
  maxCorrection?: number;
  /** Gain proportionnel (sans unité). Défaut 0,1. */
  proportionalGain?: number;
  /** Lissage de la mesure pédales (s). Défaut 3. */
  filterTimeConstantS?: number;
  /** En dessous, on gèle la correction (tr/min). Défaut 40. */
  minCadenceRpm?: number;
  /** Cible minimale pour corriger (W). Défaut 50. */
  minTargetW?: number;
  /** Durée de stabilisation après un changement de cible, sans intégration (s). Défaut 5. */
  settleS?: number;
  /** Écart relatif au-delà duquel on n'intègre pas (transitoire). Défaut 0,25. */
  maxIntegrationError?: number;
}

export class PowerMatchController {
  readonly timeConstantS: number;
  readonly maxCorrection: number;
  readonly proportionalGain: number;
  readonly filterTimeConstantS: number;
  readonly minCadenceRpm: number;
  readonly minTargetW: number;
  readonly settleS: number;
  readonly maxIntegrationError: number;
  /** Facteur de correction intégré courant (−max…+max). */
  correction = 0;
  private filtered: number | undefined;
  private lastError = 0;
  private holdS = 0;
  private lastTarget: number | undefined;

  constructor(options: PowerMatchOptions = {}) {
    this.timeConstantS = options.timeConstantS ?? 15;
    this.maxCorrection = options.maxCorrection ?? 0.15;
    this.proportionalGain = options.proportionalGain ?? 0.1;
    this.filterTimeConstantS = options.filterTimeConstantS ?? 3;
    this.minCadenceRpm = options.minCadenceRpm ?? 40;
    this.minTargetW = options.minTargetW ?? 50;
    this.settleS = options.settleS ?? 5;
    this.maxIntegrationError = options.maxIntegrationError ?? 0.25;
  }

  reset(keepCorrection = false): void {
    if (!keepCorrection) this.correction = 0;
    this.filtered = undefined;
    this.lastError = 0;
    this.holdS = 0;
    this.lastTarget = undefined;
  }

  /** Mesure pédales filtrée (diagnostic). */
  get filteredPowerW(): number | undefined {
    return this.filtered;
  }

  /**
   * @param targetW consigne ERG voulue (ce que les pédales doivent lire)
   * @param measuredW puissance pédales (undefined si absente)
   * @param dtS temps écoulé depuis la mise à jour précédente (s)
   * @param cadenceRpm cadence courante, pour geler la boucle à l'arrêt
   * @returns consigne corrigée à envoyer au trainer (W)
   */
  update(targetW: number, measuredW: number | undefined, dtS: number, cadenceRpm?: number): number {
    if (targetW < this.minTargetW) return targetW;
    const dt = clamp(dtS, 0, 5);
    if (this.lastTarget !== targetW) {
      // Nouvelle cible : le trainer doit d'abord s'y stabiliser.
      this.holdS = this.settleS;
      this.lastTarget = targetW;
    }
    const frozen = measuredW === undefined || (cadenceRpm !== undefined && cadenceRpm < this.minCadenceRpm);
    let integrating = false;
    if (!frozen) {
      const alpha = this.filterTimeConstantS > 0 ? 1 - Math.exp(-dt / this.filterTimeConstantS) : 1;
      this.filtered = this.filtered === undefined ? measuredW : this.filtered + alpha * (measuredW - this.filtered);
      const e = (targetW - this.filtered) / targetW;
      this.lastError = e;
      if (this.holdS > 0) this.holdS = Math.max(0, this.holdS - dt);
      else if (Math.abs(e) <= this.maxIntegrationError) {
        integrating = true;
        this.correction = clamp(this.correction + (e * dt) / this.timeConstantS, -this.maxCorrection, this.maxCorrection);
      }
    }
    const p = integrating ? this.proportionalGain * this.lastError : 0;
    return targetW * (1 + clamp(this.correction + p, -this.maxCorrection, this.maxCorrection));
  }
}
