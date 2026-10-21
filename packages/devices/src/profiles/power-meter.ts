/**
 * Capteur de puissance Bluetooth (Cycling Power Service) : pédales, manivelle, moyeu.
 * Puissance, cadence (calculée à partir des révolutions de manivelle, 1/1024 s), balance G/D.
 * TE/PS ne sont pas disponibles en CPS : voir AntPowerMeter (ANT+ PWR page 0x13).
 */
import type { PowerSample } from '@allezrobert/shared';
import {
  CHAR,
  CrankCadenceCalculator,
  SERVICE,
  leftBalanceFromCps,
  parseCyclingPowerFeature,
  parseCyclingPowerMeasurement,
  type CyclingPowerFeature,
  type CyclingPowerMeasurement,
} from '@allezrobert/protocols';
import { tryRead } from '../gatt-util.ts';
import { WARNING_MESSAGES } from '../messages.ts';
import type { DeviceLink, Profile, ProfileContext } from '../types.ts';

/**
 * Détecte des Assioma DUO en mode « une seule pédale » (option « G+D combiné » désactivée dans l'appli Favero) :
 * la balance n'est jamais transmise et seule la référence « gauche » apparaît. Logique pure, testable.
 */
export class AssiomaModeDetector {
  private samples = 0;
  private balanceSeen = false;
  private leftRefOnly = true;
  private warned = false;
  readonly minSamples: number;
  readonly looksLikeAssioma: boolean;
  featureBalanceSupported: boolean | undefined;

  constructor(deviceName: string, minSamples = 10) {
    this.looksLikeAssioma = /assioma/i.test(deviceName);
    this.minSamples = minSamples;
  }

  /** Renvoie true au moment où il faut avertir l'utilisateur (une seule fois). */
  update(m: CyclingPowerMeasurement): boolean {
    this.samples++;
    if (m.pedalPowerBalancePercent !== undefined) this.balanceSeen = true;
    if (!m.balanceReferenceLeftFlag) this.leftRefOnly = false;
    if (this.warned || this.balanceSeen || this.samples < this.minSamples) return false;
    if (this.leftRefOnly || this.looksLikeAssioma) {
      this.warned = true;
      return true;
    }
    return false;
  }

  get evidence(): { samples: number; balanceSeen: boolean; leftReferenceOnly: boolean; featureBalanceSupported: boolean | undefined } {
    return { samples: this.samples, balanceSeen: this.balanceSeen, leftReferenceOnly: this.leftRefOnly, featureBalanceSupported: this.featureBalanceSupported };
  }

  reset(): void {
    this.samples = 0;
    this.balanceSeen = false;
    this.leftRefOnly = true;
    this.warned = false;
  }
}

export class PowerMeter implements Profile {
  readonly name = 'cycling-power';
  readonly streaming = true;
  feature: CyclingPowerFeature | undefined;
  private ctx: ProfileContext | undefined;
  private cadence = new CrankCadenceCalculator();
  private assioma: AssiomaModeDetector | undefined;

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('CPS : liaison GATT attendue');
    this.ctx = ctx;
    this.cadence.reset();
    this.assioma = new AssiomaModeDetector(ctx.deviceName);
    const feat = await tryRead(link, SERVICE.cyclingPower, CHAR.cyclingPowerFeature);
    if (feat) {
      this.feature = parseCyclingPowerFeature(feat);
      this.assioma.featureBalanceSupported = this.feature.features.pedalPowerBalance;
    }
    if (this.assioma.looksLikeAssioma) {
      ctx.log('Assioma : une seule connexion Bluetooth possible — fermer l’appli Favero et les autres applis.');
    }
    await link.subscribe(SERVICE.cyclingPower, CHAR.cyclingPowerMeasurement, (d) => this.onMeasurement(d));
  }

  detach(): void {
    this.ctx = undefined;
  }

  private onMeasurement(data: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let m: CyclingPowerMeasurement;
    try {
      m = parseCyclingPowerMeasurement(data);
    } catch {
      return;
    }
    const t = ctx.now();
    let cadence: number | undefined;
    if (m.cumulativeCrankRevolutions !== undefined && m.lastCrankEventTime !== undefined) {
      cadence = this.cadence.update(m.cumulativeCrankRevolutions, m.lastCrankEventTime, t);
    }
    const sample: PowerSample = { t, watts: m.instantaneousPowerW };
    if (cadence !== undefined) sample.cadence = cadence;
    const left = leftBalanceFromCps(m);
    if (left !== undefined) sample.balanceLeft = left;
    if (m.cumulativeCrankRevolutions !== undefined) sample.crankRevs = this.cadence.totalRevs;
    ctx.emit('power', sample);
    if (cadence !== undefined) ctx.emit('cadence', { t, cadence });
    if (this.assioma?.update(m)) {
      ctx.warn('assioma-single-side', WARNING_MESSAGES['assioma-single-side'], this.assioma.evidence);
    }
  }
}
