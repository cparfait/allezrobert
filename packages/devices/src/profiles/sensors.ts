/** Profils capteurs simples : fréquence cardiaque, vitesse/cadence, batterie. */
import {
  CHAR,
  CrankCadenceCalculator,
  SERVICE,
  WheelSpeedCalculator,
  parseBatteryLevel,
  parseCscMeasurement,
  parseHeartRateMeasurement,
} from '@allezrobert/protocols';
import { hasCharacteristic, tryRead } from '../gatt-util.ts';
import type { DeviceLink, Profile, ProfileContext } from '../types.ts';

/** Heart Rate Service (TICKR, ceintures, montres en diffusion). Le TICKR accepte 3 connexions BLE. */
export class HeartRateMonitor implements Profile {
  readonly name = 'heart-rate';
  readonly streaming = true;
  private ctx: ProfileContext | undefined;

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('HRS : liaison GATT attendue');
    this.ctx = ctx;
    await link.subscribe(SERVICE.heartRate, CHAR.heartRateMeasurement, (d) => {
      const c = this.ctx;
      if (!c) return;
      try {
        const m = parseHeartRateMeasurement(d);
        if (m.bpm <= 0) return; // ceinture sans contact
        c.emit('heartRate', { t: c.now(), bpm: m.bpm, ...(m.rrMs.length ? { rr: m.rrMs } : {}) });
      } catch {
        // trame invalide ignorée
      }
    });
  }

  detach(): void {
    this.ctx = undefined;
  }
}

/** Cycling Speed and Cadence Service. */
export class CscSensor implements Profile {
  readonly name = 'csc';
  readonly streaming = true;
  private ctx: ProfileContext | undefined;
  private crank = new CrankCadenceCalculator();
  readonly wheel: WheelSpeedCalculator;

  constructor(wheelCircumferenceM = 2.105) {
    this.wheel = new WheelSpeedCalculator(1024, wheelCircumferenceM);
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('CSC : liaison GATT attendue');
    this.ctx = ctx;
    this.crank.reset();
    this.wheel.reset();
    await link.subscribe(SERVICE.cyclingSpeedCadence, CHAR.cscMeasurement, (d) => {
      const c = this.ctx;
      if (!c) return;
      try {
        const m = parseCscMeasurement(d);
        const t = c.now();
        if (m.cumulativeWheelRevolutions !== undefined && m.lastWheelEventTime !== undefined) {
          const v = this.wheel.update(m.cumulativeWheelRevolutions, m.lastWheelEventTime, t);
          if (v !== undefined) c.emit('speed', { t, speedKmh: v, wheelRevs: m.cumulativeWheelRevolutions });
        }
        if (m.cumulativeCrankRevolutions !== undefined && m.lastCrankEventTime !== undefined) {
          const cad = this.crank.update(m.cumulativeCrankRevolutions, m.lastCrankEventTime, t);
          if (cad !== undefined) c.emit('cadence', { t, cadence: cad });
        }
      } catch {
        // ignorée
      }
    });
  }

  detach(): void {
    this.ctx = undefined;
  }
}

/** Battery Service : lecture initiale + notifications si disponibles. */
export class BatteryProfile implements Profile {
  readonly name = 'battery';
  readonly streaming = false;

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') return;
    const first = await tryRead(link, SERVICE.battery, CHAR.batteryLevel);
    const emit = (d: Uint8Array) => {
      try {
        ctx.emit('battery', parseBatteryLevel(d));
      } catch {
        // ignorée
      }
    };
    if (first) emit(first);
    const svc = link.services.find((s) => s.uuid === SERVICE.battery);
    const ch = svc?.characteristics.find((c) => c.uuid === CHAR.batteryLevel);
    if (ch && hasCharacteristic(link, SERVICE.battery, CHAR.batteryLevel) && ch.properties.includes('notify')) {
      await link.subscribe(SERVICE.battery, CHAR.batteryLevel, emit).catch(() => undefined);
    }
  }

  detach(): void {}
}
