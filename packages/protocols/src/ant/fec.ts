/**
 * ANT+ FE-C (Fitness Equipment Control) — « ANT+ Device Profile: Fitness Equipment » rev 5.0.
 * Pages de données 8 octets, little-endian. Les commandes (pages 48–51, 55, 1) s'envoient en
 * message acquitté (0x4F) ; le trainer répond par la page 71 « Command Status » si demandée.
 * Les mêmes pages servent au FE-C over BLE (Tacx) : voir uuids.ts → TACX_FEC.
 */
import { ByteReader, ByteWriter, clamp, type ByteSource } from '../bytes.ts';
import { decodeCommonPage, type CommonPage } from './profiles.ts';

export const FEC_PAGE = {
  calibrationRequest: 0x01,
  calibrationInProgress: 0x02,
  generalFeData: 0x10,
  generalSettings: 0x11,
  specificTrainerData: 0x19,
  trainerTorqueData: 0x1a,
  basicResistance: 0x30,
  targetPower: 0x31,
  windResistance: 0x32,
  trackResistance: 0x33,
  feCapabilities: 0x36,
  userConfiguration: 0x37,
  commandStatus: 0x47,
} as const;

/** §6.5.2 / tableau 8-4 : état de l'équipement (bits 4–6 du dernier octet). */
export const FE_STATE = { 1: 'asleep', 2: 'ready', 3: 'inUse', 4: 'finished' } as const;
export type FeState = (typeof FE_STATE)[keyof typeof FE_STATE] | 'reserved';

function feState(byte: number): { state: FeState; lapToggle: boolean } {
  return {
    state: (FE_STATE as Record<number, FeState>)[(byte >> 4) & 0x07] ?? 'reserved',
    lapToggle: (byte & 0x80) !== 0,
  };
}

/** Types d'équipement (page 16, octet 1, bits 0–4). */
export const FE_TYPE = { 16: 'general', 19: 'treadmill', 20: 'elliptical', 22: 'rower', 23: 'climber', 24: 'nordicSkier', 25: 'trainer' } as const;

/** Page 16 (0x10) — General FE Data (§6.5.2). */
export interface FecGeneralFeData {
  page: 0x10;
  equipmentType: string;
  /** Temps écoulé, 0,25 s, débordement à 64 s. */
  elapsedTimeRaw: number;
  /** Distance, 1 m, débordement à 256 m (si capacité « distance » active). */
  distanceRaw: number;
  /** Vitesse 0,001 m/s → km/h. */
  speedKmh: number;
  /** 0xFF = invalide → undefined. */
  heartRateBpm?: number;
  heartRateSource: 'invalid' | 'antPlusHrm' | 'emHrm' | 'handContact';
  distanceEnabled: boolean;
  virtualSpeed: boolean;
  state: FeState;
  lapToggle: boolean;
}

/** Page 25 (0x19) — Specific Trainer/Stationary Bike Data (§6.6.7). */
export interface FecSpecificTrainerData {
  page: 0x19;
  updateEventCount: number;
  /** 0xFF = invalide → undefined. */
  cadenceRpm?: number;
  /** Puissance cumulée, 1 W, débordement à 65536. */
  accumulatedPowerW: number;
  /** 12 bits, 0xFFF = invalide → undefined. */
  instantaneousPowerW?: number;
  /** Bits de statut du trainer (octet 6, bits 4–7). */
  bicyclePowerCalibrationRequired: boolean;
  resistanceCalibrationRequired: boolean;
  userConfigurationRequired: boolean;
  /** Octet 7 bits 0–1 : 0 au niveau de la cible, 1 vitesse trop basse, 2 trop haute, 3 indéterminé. */
  targetPowerLimits: 'atTarget' | 'speedTooLow' | 'speedTooHigh' | 'undetermined';
  state: FeState;
  lapToggle: boolean;
}

/** Page 71 (0x47) — Command Status (§6.8.1). */
export interface FecCommandStatus {
  page: 0x47;
  lastReceivedCommandId: number;
  sequenceNumber: number;
  status: 'pass' | 'fail' | 'notSupported' | 'rejected' | 'pending' | 'uninitialized' | 'reserved';
  data: Uint8Array;
}

/** Page 54 (0x36) — FE Capabilities. */
export interface FecCapabilities {
  page: 0x36;
  maximumResistanceN?: number;
  basicResistanceMode: boolean;
  targetPowerMode: boolean;
  simulationMode: boolean;
}

/**
 * Page 1 (0x01) — Calibration Response (FE → affichage, §6.5.1, tableau « Calibration Response ») :
 * octet 1 bit 6 = zéro réussi, bit 7 = spin-down réussi ; octet 2 réservé ; octet 3 température
 * (0,5 °C, décalage −25 °C, 0xFF = invalide) ; octets 4–5 zero offset (0xFFFF = invalide) ;
 * octets 6–7 durée du spin-down en ms (0xFFFF = invalide).
 */
export interface FecCalibrationResponse {
  page: 0x01;
  kind: 'calibrationResponse';
  zeroOffsetSuccess: boolean;
  spinDownSuccess: boolean;
  temperatureC?: number;
  zeroOffset?: number;
  spinDownTimeMs?: number;
}

/** Condition de température ou de vitesse d'une calibration en cours (2 bits). */
export type FecCalibrationCondition = 'notApplicable' | 'tooLow' | 'ok' | 'tooHigh';
const CAL_CONDITIONS: readonly FecCalibrationCondition[] = ['notApplicable', 'tooLow', 'ok', 'tooHigh'];

/**
 * Page 2 (0x02) — Calibration In Progress (§6.5.2) : octet 1 bit 6 = zéro en attente, bit 7 = spin-down
 * en attente ; octet 2 bits 4–5 condition de température, bits 6–7 condition de vitesse (1 trop basse :
 * accélérer, 2 bonne : arrêter de pédaler) ; octet 3 température ; octets 4–5 vitesse cible (0,001 m/s) ;
 * octets 6–7 durée de spin-down visée (ms).
 */
export interface FecCalibrationInProgress {
  page: 0x02;
  kind: 'calibrationInProgress';
  zeroOffsetPending: boolean;
  spinDownPending: boolean;
  temperatureCondition: FecCalibrationCondition;
  speedCondition: FecCalibrationCondition;
  temperatureC?: number;
  targetSpeedKmh?: number;
  targetSpinDownTimeMs?: number;
}

export type FecPage =
  | FecCalibrationResponse
  | FecCalibrationInProgress
  | FecGeneralFeData
  | FecSpecificTrainerData
  | FecCommandStatus
  | FecCapabilities
  | CommonPage
  | { page: number; kind: 'unknown'; data: Uint8Array };

const HR_SOURCES = ['invalid', 'antPlusHrm', 'emHrm', 'handContact'] as const;
const TARGET_LIMITS = ['atTarget', 'speedTooLow', 'speedTooHigh', 'undetermined'] as const;
const CMD_STATUS: Record<number, FecCommandStatus['status']> = {
  0: 'pass',
  1: 'fail',
  2: 'notSupported',
  3: 'rejected',
  4: 'pending',
  255: 'uninitialized',
};

/** Température FE-C : 0,5 °C, décalage −25 °C ; 0xFF = invalide. */
function feTemperature(raw: number): number | undefined {
  return raw === 0xff ? undefined : raw / 2 - 25;
}

export function decodeFecPage(data: ByteSource): FecPage {
  const r = new ByteReader(data);
  const page = r.u8();
  switch (page) {
    case 0x01: {
      const flags = r.u8();
      r.u8(); // réservé
      const temp = r.u8();
      const zero = r.u16();
      const time = r.u16();
      return {
        page,
        kind: 'calibrationResponse',
        zeroOffsetSuccess: (flags & 0x40) !== 0,
        spinDownSuccess: (flags & 0x80) !== 0,
        ...(feTemperature(temp) !== undefined ? { temperatureC: feTemperature(temp) as number } : {}),
        ...(zero !== 0xffff ? { zeroOffset: zero } : {}),
        ...(time !== 0xffff ? { spinDownTimeMs: time } : {}),
      };
    }
    case 0x02: {
      const flags = r.u8();
      const cond = r.u8();
      const temp = r.u8();
      const speed = r.u16();
      const time = r.u16();
      return {
        page,
        kind: 'calibrationInProgress',
        zeroOffsetPending: (flags & 0x40) !== 0,
        spinDownPending: (flags & 0x80) !== 0,
        temperatureCondition: CAL_CONDITIONS[(cond >> 4) & 0x03] as FecCalibrationCondition,
        speedCondition: CAL_CONDITIONS[(cond >> 6) & 0x03] as FecCalibrationCondition,
        ...(feTemperature(temp) !== undefined ? { temperatureC: feTemperature(temp) as number } : {}),
        ...(speed !== 0xffff ? { targetSpeedKmh: (speed * 3.6) / 1000 } : {}),
        ...(time !== 0xffff ? { targetSpinDownTimeMs: time } : {}),
      };
    }
    case 0x10: {
      const type = r.u8() & 0x1f;
      const elapsedTimeRaw = r.u8();
      const distanceRaw = r.u8();
      const speedRaw = r.u16();
      const hr = r.u8();
      const caps = r.u8();
      return {
        page,
        equipmentType: (FE_TYPE as Record<number, string>)[type] ?? `type${type}`,
        elapsedTimeRaw,
        distanceRaw,
        speedKmh: (speedRaw * 3.6) / 1000,
        ...(hr !== 0xff && hr !== 0 ? { heartRateBpm: hr } : {}),
        heartRateSource: HR_SOURCES[caps & 0x03] ?? 'invalid',
        distanceEnabled: (caps & 0x04) !== 0,
        virtualSpeed: (caps & 0x08) !== 0,
        ...feState(caps),
      };
    }
    case 0x19: {
      const updateEventCount = r.u8();
      const cadence = r.u8();
      const accumulatedPowerW = r.u16();
      const lsb = r.u8();
      const b6 = r.u8();
      const b7 = r.u8();
      const power = lsb | ((b6 & 0x0f) << 8);
      return {
        page,
        updateEventCount,
        ...(cadence !== 0xff ? { cadenceRpm: cadence } : {}),
        accumulatedPowerW,
        ...(power !== 0xfff ? { instantaneousPowerW: power } : {}),
        bicyclePowerCalibrationRequired: (b6 & 0x10) !== 0,
        resistanceCalibrationRequired: (b6 & 0x20) !== 0,
        userConfigurationRequired: (b6 & 0x40) !== 0,
        targetPowerLimits: TARGET_LIMITS[b7 & 0x03] ?? 'undetermined',
        ...feState(b7),
      };
    }
    case 0x36: {
      r.bytesN(4); // réservés
      const maxRes = r.u16();
      const caps = r.u8();
      return {
        page,
        ...(maxRes !== 0xffff ? { maximumResistanceN: maxRes } : {}),
        basicResistanceMode: (caps & 0x01) !== 0,
        targetPowerMode: (caps & 0x02) !== 0,
        simulationMode: (caps & 0x04) !== 0,
      };
    }
    case 0x47: {
      const lastReceivedCommandId = r.u8();
      const sequenceNumber = r.u8();
      const st = r.u8();
      return { page, lastReceivedCommandId, sequenceNumber, status: CMD_STATUS[st] ?? 'reserved', data: r.bytesN(4).slice() };
    }
    default: {
      const common = decodeCommonPage(data);
      if (common) return common;
      return { page, kind: 'unknown', data: new ByteReader(data).bytesN(8).slice() };
    }
  }
}

// --- Commandes ---------------------------------------------------------------------------

/** Page 48 (0x30) — Basic Resistance : octet 7 = résistance totale, 0,5 % (0–200 → 0–100 %). */
export function encodeFecBasicResistance(percent: number): Uint8Array {
  return Uint8Array.of(0x30, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, clamp(Math.round(percent * 2), 0, 200));
}

/** Page 49 (0x31) — Target Power : octets 6–7 = puissance cible, 0,25 W (0–4000 W). */
export function encodeFecTargetPower(watts: number): Uint8Array {
  const raw = clamp(Math.round(watts * 4), 0, 16000);
  return Uint8Array.of(0x31, 0xff, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff);
}

export interface FecWindResistance {
  /** Coefficient de résistance au vent, kg/m (résolution 0,01). Défaut profil : 0,51. */
  windResistanceCoefficient?: number;
  /** Vent en km/h, −127…+127 (positif = vent de face). Défaut 0. */
  windSpeedKmh?: number;
  /** Facteur d'aspiration 0–1 (1 = pas d'abri). Défaut 1. */
  draftingFactor?: number;
}

/** Page 50 (0x32) — Wind Resistance (octet 5 : coeff ×0,01 ; octet 6 : vent km/h + 127 ; octet 7 : drafting ×0,01). */
export function encodeFecWindResistance(p: FecWindResistance = {}): Uint8Array {
  const coeff = p.windResistanceCoefficient === undefined ? 0xff : clamp(Math.round(p.windResistanceCoefficient * 100), 0, 186);
  const wind = p.windSpeedKmh === undefined ? 0xff : clamp(Math.round(p.windSpeedKmh + 127), 0, 254);
  const draft = p.draftingFactor === undefined ? 0xff : clamp(Math.round(p.draftingFactor * 100), 0, 100);
  return Uint8Array.of(0x32, 0xff, 0xff, 0xff, 0xff, coeff, wind, draft);
}

export interface FecTrackResistance {
  /** Pente en %, −200…+200 (résolution 0,01 %). */
  gradePercent: number;
  /** Crr, résolution 5×10⁻⁵ (0xFF → défaut profil 0,004). */
  crr?: number;
}

/** Page 51 (0x33) — Track Resistance : octets 5–6 = (pente + 200 %) / 0,01 ; octet 7 = Crr / 5×10⁻⁵. */
export function encodeFecTrackResistance(p: FecTrackResistance): Uint8Array {
  const grade = clamp(Math.round((p.gradePercent + 200) * 100), 0, 40000);
  const crr = p.crr === undefined ? 0xff : clamp(Math.round(p.crr * 20000), 0, 254);
  return Uint8Array.of(0x33, 0xff, 0xff, 0xff, 0xff, grade & 0xff, (grade >> 8) & 0xff, crr);
}

export interface FecUserConfiguration {
  userWeightKg: number;
  bikeWeightKg: number;
  /** Diamètre de roue en m (0,622 + pneu ≈ 0,70). */
  wheelDiameterM?: number;
  /** Rapport de transmission (plateau/pignon), résolution 0,03. */
  gearRatio?: number;
}

/**
 * Page 55 (0x37) — User Configuration : poids utilisateur 0,01 kg (octets 1–2),
 * décalage diamètre de roue 1 mm (octet 4 bits 0–3), poids vélo 0,05 kg (12 bits, octet 4 bits 4–7 + octet 5),
 * diamètre de roue 0,01 m (octet 6), rapport 0,03 (octet 7).
 */
export function encodeFecUserConfiguration(c: FecUserConfiguration): Uint8Array {
  const user = clamp(Math.round(c.userWeightKg * 100), 0, 65534);
  const bike = clamp(Math.round(c.bikeWeightKg / 0.05), 0, 1000);
  let wheel = 0xff;
  let offset = 0xf;
  if (c.wheelDiameterM !== undefined) {
    const mm = Math.round(c.wheelDiameterM * 1000);
    wheel = clamp(Math.floor(mm / 10), 0, 254);
    offset = clamp(mm - wheel * 10, 0, 10);
  }
  const gear = c.gearRatio === undefined ? 0x00 : clamp(Math.round(c.gearRatio / 0.03), 1, 255);
  return Uint8Array.of(0x37, user & 0xff, (user >> 8) & 0xff, 0xff, (offset & 0x0f) | ((bike & 0x0f) << 4), (bike >> 4) & 0xff, wheel, gear);
}

/** Page 1 (0x01) — Calibration Request : bit 6 = zéro (offset), bit 7 = spin-down. */
export function encodeFecCalibrationRequest(p: { spinDown?: boolean; zeroOffset?: boolean }): Uint8Array {
  const flags = (p.zeroOffset ? 0x40 : 0) | (p.spinDown ? 0x80 : 0);
  return Uint8Array.of(0x01, flags, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
}

function encodeTemperature(c: number | undefined): number {
  return c === undefined ? 0xff : clamp(Math.round((c + 25) * 2), 0, 0xfe);
}

/** Page 1 (0x01) côté trainer — Calibration Response (simulateur, tests). */
export function encodeFecCalibrationResponse(p: { spinDownSuccess?: boolean; zeroOffsetSuccess?: boolean; temperatureC?: number; zeroOffset?: number; spinDownTimeMs?: number }): Uint8Array {
  return new ByteWriter()
    .u8(0x01)
    .u8((p.zeroOffsetSuccess ? 0x40 : 0) | (p.spinDownSuccess ? 0x80 : 0))
    .u8(0x00)
    .u8(encodeTemperature(p.temperatureC))
    .u16(p.zeroOffset ?? 0xffff)
    .u16(p.spinDownTimeMs ?? 0xffff)
    .toBytes();
}

/** Page 2 (0x02) — Calibration In Progress (simulateur, tests). */
export function encodeFecCalibrationInProgress(p: {
  spinDownPending?: boolean;
  zeroOffsetPending?: boolean;
  temperatureCondition?: FecCalibrationCondition;
  speedCondition?: FecCalibrationCondition;
  temperatureC?: number;
  targetSpeedKmh?: number;
  targetSpinDownTimeMs?: number;
}): Uint8Array {
  const cond = (CAL_CONDITIONS.indexOf(p.temperatureCondition ?? 'notApplicable') << 4) | (CAL_CONDITIONS.indexOf(p.speedCondition ?? 'notApplicable') << 6);
  return new ByteWriter()
    .u8(0x02)
    .u8((p.zeroOffsetPending ? 0x40 : 0) | (p.spinDownPending ? 0x80 : 0))
    .u8(cond)
    .u8(encodeTemperature(p.temperatureC))
    .u16(p.targetSpeedKmh === undefined ? 0xffff : clamp(Math.round((p.targetSpeedKmh * 1000) / 3.6), 0, 0xfffe))
    .u16(p.targetSpinDownTimeMs ?? 0xffff)
    .toBytes();
}

/** Encodeurs symétriques des pages de données (simulateur, tests). */
export function encodeFecGeneralFeData(p: { speedKmh: number; elapsedTimeS?: number; distanceM?: number; heartRateBpm?: number; state?: FeState; virtualSpeed?: boolean }): Uint8Array {
  const speed = clamp(Math.round((p.speedKmh * 1000) / 3.6), 0, 65534);
  const stateCode = { asleep: 1, ready: 2, inUse: 3, finished: 4, reserved: 0 }[p.state ?? 'inUse'];
  const caps = (p.distanceM !== undefined ? 0x04 : 0) | (p.virtualSpeed ? 0x08 : 0) | (stateCode << 4);
  return Uint8Array.of(
    0x10,
    25,
    Math.round((p.elapsedTimeS ?? 0) * 4) & 0xff,
    Math.round(p.distanceM ?? 0) & 0xff,
    speed & 0xff,
    (speed >> 8) & 0xff,
    p.heartRateBpm ?? 0xff,
    caps,
  );
}

export function encodeFecSpecificTrainerData(p: { eventCount: number; cadenceRpm?: number; accumulatedPowerW: number; powerW?: number; state?: FeState }): Uint8Array {
  const power = p.powerW === undefined ? 0xfff : clamp(Math.round(p.powerW), 0, 4094);
  const stateCode = { asleep: 1, ready: 2, inUse: 3, finished: 4, reserved: 0 }[p.state ?? 'inUse'];
  const acc = Math.round(p.accumulatedPowerW) % 65536;
  return new ByteWriter()
    .u8(0x19)
    .u8(p.eventCount & 0xff)
    .u8(p.cadenceRpm === undefined ? 0xff : p.cadenceRpm)
    .u16(acc)
    .u8(power & 0xff)
    .u8((power >> 8) & 0x0f)
    .u8(stateCode << 4)
    .toBytes();
}

/** Décode une commande (côté simulateur) : pages 48/49/50/51. */
export type FecCommand =
  | { page: 0x30; kind: 'basicResistance'; percent: number }
  | { page: 0x31; kind: 'targetPower'; watts: number }
  | { page: 0x32; kind: 'windResistance'; windResistanceCoefficient: number; windSpeedKmh: number; draftingFactor: number }
  | { page: 0x33; kind: 'trackResistance'; gradePercent: number; crr: number }
  | { page: 0x01; kind: 'calibration'; spinDown: boolean; zeroOffset: boolean }
  | { page: number; kind: 'other' };

export function decodeFecCommand(data: ByteSource): FecCommand {
  const r = new ByteReader(data);
  const page = r.u8();
  switch (page) {
    case 0x30:
      r.bytesN(6);
      return { page, kind: 'basicResistance', percent: r.u8() / 2 };
    case 0x31:
      r.bytesN(5);
      return { page, kind: 'targetPower', watts: r.u16() / 4 };
    case 0x32: {
      r.bytesN(4);
      const c = r.u8();
      const w = r.u8();
      const d = r.u8();
      return {
        page,
        kind: 'windResistance',
        windResistanceCoefficient: c === 0xff ? 0.51 : c / 100,
        windSpeedKmh: w === 0xff ? 0 : w - 127,
        draftingFactor: d === 0xff ? 1 : d / 100,
      };
    }
    case 0x33: {
      r.bytesN(4);
      const g = r.u16();
      const c = r.u8();
      return { page, kind: 'trackResistance', gradePercent: g === 0xffff ? 0 : g / 100 - 200, crr: c === 0xff ? 0.004 : c / 20000 };
    }
    case 0x01: {
      const f = r.u8();
      return { page, kind: 'calibration', spinDown: (f & 0x80) !== 0, zeroOffset: (f & 0x40) !== 0 };
    }
    default:
      return { page, kind: 'other' };
  }
}
