/**
 * Calcul de cadence et de vitesse à partir de compteurs cumulés + horodatage d'événement,
 * avec gestion du débordement (rollover) des compteurs.
 *
 * - CPS §3.2.1.6/§3.2.1.7 (Cycling Power Measurement) : roue uint32 + temps 1/2048 s ; manivelle uint16 + temps 1/1024 s.
 * - CSCS §3.1.1.2/§3.1.1.3 (CSC Measurement) : roue uint32 + temps 1/1024 s ; manivelle uint16 + temps 1/1024 s.
 * - ANT+ PWR page 0x12 : période cumulée 1/2048 s, compteur 8 bits.
 */

export interface RevolutionCalculatorOptions {
  /** Nombre de bits du compteur de révolutions (16 pour la manivelle, 32 pour la roue). */
  revBits: 8 | 16 | 32;
  /** Nombre de bits de l'horodatage d'événement (16 en BLE). */
  timeBits: 16;
  /** Unités par seconde de l'horodatage : 1024 ou 2048. */
  timeResolution: 1024 | 2048;
  /** Au-delà de ce délai sans nouvel événement, le rythme retombe à 0 (ms). Défaut 3000. */
  staleAfterMs?: number;
  /** Rythme maximal plausible, en révolutions par minute ; au-delà, l'échantillon est ignoré. */
  maxRpm?: number;
}

/**
 * Calculateur générique de rythme (révolutions / minute).
 * `update()` renvoie undefined tant qu'on n'a pas deux événements distincts.
 */
export class RevolutionRateCalculator {
  private readonly revMod: number;
  private readonly timeMod: number;
  private readonly resolution: number;
  private readonly staleAfterMs: number;
  private readonly maxRpm: number;
  private lastRevs: number | undefined;
  private lastTime: number | undefined;
  private lastEventAtMs: number | undefined;
  private lastRpm: number | undefined;
  /** Révolutions cumulées depuis le premier échantillon (compteur « déroulé »). */
  totalRevs = 0;

  constructor(options: RevolutionCalculatorOptions) {
    this.revMod = 2 ** options.revBits;
    this.timeMod = 2 ** options.timeBits;
    this.resolution = options.timeResolution;
    this.staleAfterMs = options.staleAfterMs ?? 3000;
    this.maxRpm = options.maxRpm ?? 250;
  }

  reset(): void {
    this.lastRevs = undefined;
    this.lastTime = undefined;
    this.lastEventAtMs = undefined;
    this.lastRpm = undefined;
    this.totalRevs = 0;
  }

  /**
   * @param revs compteur cumulé brut
   * @param eventTime horodatage brut du dernier événement (unités 1/resolution s)
   * @param nowMs horloge locale (ms) — sert à détecter l'arrêt de pédalage
   */
  update(revs: number, eventTime: number, nowMs: number): number | undefined {
    if (this.lastRevs === undefined || this.lastTime === undefined) {
      this.lastRevs = revs;
      this.lastTime = eventTime;
      this.lastEventAtMs = nowMs;
      return undefined;
    }
    const dRevs = (revs - this.lastRevs + this.revMod) % this.revMod;
    const dTime = (eventTime - this.lastTime + this.timeMod) % this.timeMod;
    if (dRevs === 0 || dTime === 0) {
      // Pas de nouvel événement : on garde la dernière valeur, puis 0 après le délai d'inactivité.
      if (this.lastEventAtMs !== undefined && nowMs - this.lastEventAtMs > this.staleAfterMs) {
        this.lastRpm = 0;
      }
      return this.lastRpm;
    }
    this.lastRevs = revs;
    this.lastTime = eventTime;
    this.lastEventAtMs = nowMs;
    this.totalRevs += dRevs;
    const rpm = (dRevs * 60 * this.resolution) / dTime;
    if (rpm > this.maxRpm) return this.lastRpm; // échantillon aberrant (reconnexion, saut de compteur)
    this.lastRpm = rpm;
    return rpm;
  }
}

/** Cadence de manivelle CPS/CSC : uint16 révolutions, uint16 temps en 1/1024 s. */
export class CrankCadenceCalculator extends RevolutionRateCalculator {
  constructor(staleAfterMs = 3000) {
    super({ revBits: 16, timeBits: 16, timeResolution: 1024, staleAfterMs, maxRpm: 250 });
  }
}

/**
 * Vitesse de roue (km/h) : uint32 révolutions, temps 1/1024 s (CSC) ou 1/2048 s (CPS).
 * La circonférence par défaut (2105 mm) correspond à un pneu 700×25C.
 */
export class WheelSpeedCalculator {
  private readonly rate: RevolutionRateCalculator;
  circumferenceM: number;

  constructor(timeResolution: 1024 | 2048, circumferenceM = 2.105, staleAfterMs = 3000) {
    this.rate = new RevolutionRateCalculator({ revBits: 32, timeBits: 16, timeResolution, staleAfterMs, maxRpm: 2000 });
    this.circumferenceM = circumferenceM;
  }

  reset(): void {
    this.rate.reset();
  }

  /** Distance parcourue (m) depuis le premier échantillon. */
  get distanceM(): number {
    return this.rate.totalRevs * this.circumferenceM;
  }

  update(revs: number, eventTime: number, nowMs: number): number | undefined {
    const rpm = this.rate.update(revs, eventTime, nowMs);
    return rpm === undefined ? undefined : (rpm * this.circumferenceM * 60) / 1000;
  }
}
