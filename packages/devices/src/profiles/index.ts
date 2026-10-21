/** Choix des profils à brancher selon les services de la liaison. */
import { SERVICE, TACX_FEC, ZWIFT_CONTROLLER, HEADWIND, SHIMANO_DFLY, type ExperimentalAdapters } from '@allezrobert/protocols';
import { hasService } from '../gatt-util.ts';
import type { DeviceLink, Profile } from '../types.ts';
import { AntControlsShifter, AntHeartRateMonitor, AntPowerMeter, FecTrainer, type FecTrainerOptions } from './ant-profiles.ts';
import { DflyShifter, HeadwindFan, ZwiftControllerShifter } from './experimental.ts';
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
  if (exp.zwiftControllers && (hasService(s, ZWIFT_CONTROLLER.service) || hasService(s, ZWIFT_CONTROLLER.rideService))) out.push(new ZwiftControllerShifter());
  if (exp.headwind && hasService(s, HEADWIND.service)) out.push(new HeadwindFan());
  if (exp.shimanoDfly && hasService(s, SHIMANO_DFLY.service)) out.push(new DflyShifter());
  if (hasService(s, SERVICE.battery)) out.push(new BatteryProfile());
  return out;
}
