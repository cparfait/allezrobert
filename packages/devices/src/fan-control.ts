/**
 * Ventilateur asservi (KICKR HEADWIND ou tout `FanControl`) : le JEU calcule la vitesse du ventilateur
 * à partir de ce qu'il sait (vitesse calculée par le jeu, fréquence cardiaque, pente de la route) ou
 * d'une consigne manuelle, puis n'envoie au ventilateur qu'une consigne « manuelle » en pourcentage.
 * On n'utilise donc pas les modes internes du HEADWIND (FC / vitesse via ses propres capteurs) :
 * le ventilateur suit le monde virtuel, y compris l'aspiration et les descentes.
 *
 * Logique pure et testable ; limitation du débit d'envoi (lien Bluetooth) et hystérésis incluses.
 */

export type FanMode = 'off' | 'manual' | 'speed' | 'heartRate' | 'grade';

export interface FanContext {
  /** Vitesse calculée par le jeu (km/h). */
  speedKmh: number;
  /** Fréquence cardiaque (bpm), si une ceinture est connectée. */
  heartRateBpm?: number;
  /** Pente de la route sous la roue (%). */
  gradePercent: number;
}

export interface FanSettings {
  mode: FanMode;
  /** Consigne du mode manuel (0–100 %). */
  manualPercent: number;
  /** Mode vitesse : vitesse donnant 100 % (km/h). Défaut 48. */
  speedForFullKmh?: number;
  /** Mode FC : FC maximale (bpm). Défaut 185. */
  maxHeartRateBpm?: number;
}

export const DEFAULT_FAN_SETTINGS: Readonly<FanSettings> = Object.freeze({ mode: 'speed', manualPercent: 50, speedForFullKmh: 48, maxHeartRateBpm: 185 });

export interface FanControllerOptions {
  /** Écart minimal (points de %) pour renvoyer une consigne. Défaut 5. */
  deadbandPercent?: number;
  /** Intervalle minimal entre deux envois (ms). Défaut 2000. */
  minIntervalMs?: number;
  /** Renvoi périodique même sans changement (ms), utile après une reconnexion. Défaut 30000. */
  keepAliveMs?: number;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/**
 * Consigne (0–100 %) selon le mode :
 * - `speed` : proportionnelle à la vitesse du jeu (0 à l'arrêt, 100 % à `speedForFullKmh`) ;
 * - `heartRate` : 0 % sous 50 % de la FC max, 100 % à 90 % (zones 1 → 5), 0 sans ceinture ;
 * - `grade` : 30 % sur le plat, +10 points par % de pente (100 % dès 7 %) ; en descente, suit la vitesse
 *   (on va vite, l'air rafraîchit) ; 0 à l'arrêt ;
 * - `manual` : la consigne fixe ; `off` : 0.
 */
export function fanTargetPercent(settings: FanSettings, ctx: FanContext): number {
  const full = settings.speedForFullKmh ?? 48;
  const bySpeed = Math.round(100 * clamp01(ctx.speedKmh / Math.max(full, 1)));
  switch (settings.mode) {
    case 'off':
      return 0;
    case 'manual':
      return Math.round(100 * clamp01(settings.manualPercent / 100));
    case 'speed':
      return bySpeed;
    case 'heartRate': {
      if (!ctx.heartRateBpm) return 0;
      const max = settings.maxHeartRateBpm ?? 185;
      return Math.round(100 * clamp01((ctx.heartRateBpm / max - 0.5) / 0.4));
    }
    case 'grade': {
      if (ctx.speedKmh < 1) return 0;
      if (ctx.gradePercent < 0) return Math.max(30, bySpeed);
      return Math.round(100 * clamp01((30 + 10 * ctx.gradePercent) / 100));
    }
  }
}

/** Décide quand envoyer une nouvelle consigne au ventilateur. */
export class FanController {
  settings: FanSettings;
  private readonly deadband: number;
  private readonly minInterval: number;
  private readonly keepAlive: number;
  private lastSent: number | undefined;
  private lastSentAt = -Infinity;

  constructor(settings: FanSettings = { ...DEFAULT_FAN_SETTINGS }, options: FanControllerOptions = {}) {
    this.settings = settings;
    this.deadband = options.deadbandPercent ?? 5;
    this.minInterval = options.minIntervalMs ?? 2000;
    this.keepAlive = options.keepAliveMs ?? 30000;
  }

  /** Dernière consigne envoyée (diagnostic, HUD). */
  get lastPercent(): number | undefined {
    return this.lastSent;
  }

  /** Oublie la dernière consigne : la prochaine mise à jour l'enverra (changement de mode, reconnexion). */
  reset(): void {
    this.lastSent = undefined;
    this.lastSentAt = -Infinity;
  }

  /**
   * @param now horloge en ms
   * @returns la consigne à envoyer maintenant, ou `undefined` s'il n'est pas utile d'envoyer.
   */
  update(ctx: FanContext, now: number): number | undefined {
    const target = fanTargetPercent(this.settings, ctx);
    const prev = this.lastSent;
    // Arrêt et mise en route passent toujours (sans attendre la bande morte), mais pas plus vite que minInterval.
    const crossesZero = prev !== undefined && (prev === 0) !== (target === 0);
    const changed = prev === undefined || crossesZero || Math.abs(target - prev) >= this.deadband;
    const due = now - this.lastSentAt >= this.keepAlive;
    if (!changed && !due) return undefined;
    if (now - this.lastSentAt < this.minInterval) return undefined;
    this.lastSent = target;
    this.lastSentAt = now;
    return target;
  }
}
