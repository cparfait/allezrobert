/** Choix des profils à brancher selon les services de la liaison. */
import { SERVICE, TACX_FEC, ZWIFT_CONTROLLER, HEADWIND, SHIMANO_DFLY, zwiftDeviceTypeFromManufacturerData, type ExperimentalAdapters } from '@allezrobert/protocols';
import { hasService, isSramAxs } from '../gatt-util.ts';
import type { DeviceLink, Profile } from '../types.ts';
import { AntControlsShifter, AntHeartRateMonitor, AntPowerMeter, FecTrainer, type FecTrainerOptions } from './ant-profiles.ts';
import { DflyShifter, HeadwindFan, SramAxsShifter, ZwiftControllerShifter, type SramAxsShifterOptions, type ZwiftControllerOptions } from './experimental.ts';
import { FtmsTrainer, type FtmsTrainerOptions } from './ftms-trainer.ts';
import { PowerMeter } from './power-meter.ts';
import { BatteryProfile, CscSensor, HeartRateMonitor } from './sensors.ts';

export * from './ftms-trainer.ts';
export * from './power-meter.ts';
export * from './sensors.ts';
export * from './ant-profiles.ts';
export * from './experimental.ts';

export interface ProfileFactoryOptions {
  experimental?: Partial<ExperimentalAdapters>;
  ftms?: FtmsTrainerOptions;
  fec?: FecTrainerOptions;
  wheelCircumferenceM?: number;
  /** Données de l'annonce BLE (nom, données fabricant) : type de manette Zwift, série SRAM… */
  advertisement?: { name?: string; manufacturerData?: Record<string, number[]> };
  /** Manettes Zwift : poignée de main, actions, maintien en éveil. */
  zwift?: Omit<ZwiftControllerOptions, 'deviceType' | 'deviceName'>;
  /** SRAM AXS : stockage des clés, actions des clics. */
  sramAxs?: SramAxsShifterOptions;
}

/** Données fabricant d'un identifiant SIG (clé décimale côté natif, hexadécimale tolérée). */
export function manufacturerBytes(data: Record<string, number[]> | undefined, companyId: number): number[] | undefined {
  if (!data) return undefined;
  return data[String(companyId)] ?? data[`0x${companyId.toString(16).padStart(4, '0')}`];
}

export function createProfiles(link: DeviceLink, options: ProfileFactoryOptions = {}): Profile[] {
  const exp = options.experimental ?? {};
  if (link.type === 'ant') {
    switch (link.profile) {
      case 'fitnessEquipment':
        return [new FecTrainer(options.fec)];
      case 'power':
        return [new AntPowerMeter()];
      case 'heartRate':
        return [new AntHeartRateMonitor()];
      case 'controls':
        return exp.antControls ? [new AntControlsShifter()] : [];
      default:
        return [];
    }
  }
  const s = link.services;
  const out: Profile[] = [];
  const ftms = hasService(s, SERVICE.fitnessMachine);
  const fec = !ftms && hasService(s, TACX_FEC.service);
  if (ftms) out.push(new FtmsTrainer(options.ftms));
  else if (fec) out.push(new FecTrainer(options.fec));
  // Sur un trainer, le CPS/CSC éventuel duplique les données FTMS : on l'ignore.
  if (!ftms && !fec && hasService(s, SERVICE.cyclingPower)) out.push(new PowerMeter());
  if (!ftms && !fec && hasService(s, SERVICE.cyclingSpeedCadence)) out.push(new CscSensor(options.wheelCircumferenceM));
  if (hasService(s, SERVICE.heartRate)) out.push(new HeartRateMonitor());
  const adv = options.advertisement;
  const zwiftData = manufacturerBytes(adv?.manufacturerData, ZWIFT_CONTROLLER.manufacturerId);
  const zwiftService = hasService(s, ZWIFT_CONTROLLER.service) || hasService(s, ZWIFT_CONTROLLER.rideService);
  const deviceType = zwiftData ? zwiftDeviceTypeFromManufacturerData(zwiftData) : undefined;
  // Annoncée comme manette Zwift mais service masqué : Ride v2 / Click v2 verrouillés (le profil le signale).
  // (Le type doit être celui d'une manette : certains trainers « Zwift Ready » portent aussi l'identifiant 0x094A.)
  const zwiftAdvertised = deviceType !== undefined || /^zwift (click|play|ride)/i.test(adv?.name ?? '');
  if (exp.zwiftControllers && (zwiftService || zwiftAdvertised)) {
    out.push(new ZwiftControllerShifter({ ...options.zwift, ...(deviceType ? { deviceType } : {}), ...(adv?.name ? { deviceName: adv.name } : {}) }));
  }
  if (exp.headwind && hasService(s, HEADWIND.service)) out.push(new HeadwindFan());
  if (exp.shimanoDfly && hasService(s, SHIMANO_DFLY.service)) out.push(new DflyShifter());
  if (exp.sramAxs && isSramAxs(s)) out.push(new SramAxsShifter(options.sramAxs));
  if (hasService(s, SERVICE.battery)) out.push(new BatteryProfile());
  return out;
}
