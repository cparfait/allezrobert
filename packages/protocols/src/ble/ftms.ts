/**
 * Fitness Machine Service (FTMS) — Bluetooth SIG, « Fitness Machine Service Specification » v1.0 (2017).
 * Les références « §4.x » renvoient à cette spécification. Entiers little-endian.
 */
import { ByteReader, ByteWriter, ProtocolError, clamp, type ByteSource } from '../bytes.ts';

// ---------------------------------------------------------------------------
// §4.9 Indoor Bike Data (0x2AD2)
// ---------------------------------------------------------------------------

/** Bits du champ Flags (uint16) de l'Indoor Bike Data, §4.9.1.1. */
export const INDOOR_BIKE_DATA_FLAGS = {
  /** ATTENTION logique inversée : 0 = « Instantaneous Speed » présent, 1 = « More Data » (suite dans une autre notification). */
  moreData: 1 << 0,
  averageSpeed: 1 << 1,
  instantaneousCadence: 1 << 2,
  averageCadence: 1 << 3,
  totalDistance: 1 << 4,
  resistanceLevel: 1 << 5,
  instantaneousPower: 1 << 6,
  averagePower: 1 << 7,
  expendedEnergy: 1 << 8,
  heartRate: 1 << 9,
  metabolicEquivalent: 1 << 10,
  elapsedTime: 1 << 11,
  remainingTime: 1 << 12,
} as const;

export interface IndoorBikeData {
  flags: number;
  /** true : la vitesse instantanée est absente et la suite des champs arrive dans d'autres notifications. */
  moreData: boolean;
  instantaneousSpeedKmh?: number; // uint16, 0,01 km/h
  averageSpeedKmh?: number; // uint16, 0,01 km/h
  instantaneousCadenceRpm?: number; // uint16, 0,5 tr/min
  averageCadenceRpm?: number; // uint16, 0,5 tr/min
  totalDistanceM?: number; // uint24, 1 m
  resistanceLevel?: number; // sint16, sans unité, résolution 1
  instantaneousPowerW?: number; // sint16, 1 W
  averagePowerW?: number; // sint16, 1 W
  totalEnergyKcal?: number; // uint16 (0xFFFF = non disponible)
  energyPerHourKcal?: number; // uint16 (0xFFFF = non disponible)
  energyPerMinuteKcal?: number; // uint8 (0xFF = non disponible)
  heartRateBpm?: number; // uint8
  metabolicEquivalent?: number; // uint8, 0,1
  elapsedTimeS?: number; // uint16
  remainingTimeS?: number; // uint16
}

/** Décode une notification Indoor Bike Data (§4.9.1). Les champs apparaissent dans l'ordre des bits. */
export function parseIndoorBikeData(data: ByteSource): IndoorBikeData {
  const r = new ByteReader(data);
  const flags = r.u16();
  const F = INDOOR_BIKE_DATA_FLAGS;
  const out: IndoorBikeData = { flags, moreData: (flags & F.moreData) !== 0 };
  if (!out.moreData) out.instantaneousSpeedKmh = r.u16() / 100;
  if (flags & F.averageSpeed) out.averageSpeedKmh = r.u16() / 100;
  if (flags & F.instantaneousCadence) out.instantaneousCadenceRpm = r.u16() / 2;
  if (flags & F.averageCadence) out.averageCadenceRpm = r.u16() / 2;
  if (flags & F.totalDistance) out.totalDistanceM = r.u24();
  if (flags & F.resistanceLevel) out.resistanceLevel = r.s16();
  if (flags & F.instantaneousPower) out.instantaneousPowerW = r.s16();
  if (flags & F.averagePower) out.averagePowerW = r.s16();
  if (flags & F.expendedEnergy) {
    const total = r.u16();
    const perHour = r.u16();
    const perMinute = r.u8();
    if (total !== 0xffff) out.totalEnergyKcal = total;
    if (perHour !== 0xffff) out.energyPerHourKcal = perHour;
    if (perMinute !== 0xff) out.energyPerMinuteKcal = perMinute;
  }
  if (flags & F.heartRate) out.heartRateBpm = r.u8();
  if (flags & F.metabolicEquivalent) out.metabolicEquivalent = r.u8() / 10;
  if (flags & F.elapsedTime) out.elapsedTimeS = r.u16();
  if (flags & F.remainingTime) out.remainingTimeS = r.u16();
  return out;
}

/** Encodeur symétrique (utilisé par le simulateur et les tests). Les champs absents ne sont pas émis. */
export function encodeIndoorBikeData(d: Omit<IndoorBikeData, 'flags' | 'moreData'> & { moreData?: boolean }): Uint8Array {
  const F = INDOOR_BIKE_DATA_FLAGS;
  let flags = 0;
  const w = new ByteWriter();
  const body = new ByteWriter();
  const moreData = d.moreData ?? d.instantaneousSpeedKmh === undefined;
  if (moreData) flags |= F.moreData;
  else body.u16((d.instantaneousSpeedKmh ?? 0) * 100);
  if (d.averageSpeedKmh !== undefined) (flags |= F.averageSpeed), body.u16(d.averageSpeedKmh * 100);
  if (d.instantaneousCadenceRpm !== undefined) (flags |= F.instantaneousCadence), body.u16(d.instantaneousCadenceRpm * 2);
  if (d.averageCadenceRpm !== undefined) (flags |= F.averageCadence), body.u16(d.averageCadenceRpm * 2);
  if (d.totalDistanceM !== undefined) (flags |= F.totalDistance), body.u24(d.totalDistanceM);
  if (d.resistanceLevel !== undefined) (flags |= F.resistanceLevel), body.s16(d.resistanceLevel);
  if (d.instantaneousPowerW !== undefined) (flags |= F.instantaneousPower), body.s16(d.instantaneousPowerW);
  if (d.averagePowerW !== undefined) (flags |= F.averagePower), body.s16(d.averagePowerW);
  if (d.totalEnergyKcal !== undefined || d.energyPerHourKcal !== undefined || d.energyPerMinuteKcal !== undefined) {
    flags |= F.expendedEnergy;
    body.u16(d.totalEnergyKcal ?? 0xffff).u16(d.energyPerHourKcal ?? 0xffff).u8(d.energyPerMinuteKcal ?? 0xff);
  }
  if (d.heartRateBpm !== undefined) (flags |= F.heartRate), body.u8(d.heartRateBpm);
  if (d.metabolicEquivalent !== undefined) (flags |= F.metabolicEquivalent), body.u8(d.metabolicEquivalent * 10);
  if (d.elapsedTimeS !== undefined) (flags |= F.elapsedTime), body.u16(d.elapsedTimeS);
  if (d.remainingTimeS !== undefined) (flags |= F.remainingTime), body.u16(d.remainingTimeS);
  return w.u16(flags).raw(body.toBytes()).toBytes();
}

// ---------------------------------------------------------------------------
// §4.3 Fitness Machine Feature (0x2ACC)
// ---------------------------------------------------------------------------

/** §4.3.1.1 Fitness Machine Features (uint32). */
export const FITNESS_MACHINE_FEATURES = {
  averageSpeed: 1 << 0,
  cadence: 1 << 1,
  totalDistance: 1 << 2,
  inclination: 1 << 3,
  elevationGain: 1 << 4,
  pace: 1 << 5,
  stepCount: 1 << 6,
  resistanceLevel: 1 << 7,
  strideCount: 1 << 8,
  expendedEnergy: 1 << 9,
  heartRateMeasurement: 1 << 10,
  metabolicEquivalent: 1 << 11,
  elapsedTime: 1 << 12,
  remainingTime: 1 << 13,
  powerMeasurement: 1 << 14,
  forceOnBeltAndPowerOutput: 1 << 15,
  userDataRetention: 1 << 16,
} as const;

/** §4.3.1.2 Target Setting Features (uint32). */
export const TARGET_SETTING_FEATURES = {
  speedTarget: 1 << 0,
  inclinationTarget: 1 << 1,
  resistanceTarget: 1 << 2,
  powerTarget: 1 << 3,
  heartRateTarget: 1 << 4,
  targetedExpendedEnergy: 1 << 5,
  targetedStepNumber: 1 << 6,
  targetedStrideNumber: 1 << 7,
  targetedDistance: 1 << 8,
  targetedTrainingTime: 1 << 9,
  targetedTimeInTwoHrZones: 1 << 10,
  targetedTimeInThreeHrZones: 1 << 11,
  targetedTimeInFiveHrZones: 1 << 12,
  indoorBikeSimulation: 1 << 13,
  wheelCircumference: 1 << 14,
  spinDownControl: 1 << 15,
  targetedCadence: 1 << 16,
} as const;

export type FitnessMachineFeatureName = keyof typeof FITNESS_MACHINE_FEATURES;
export type TargetSettingFeatureName = keyof typeof TARGET_SETTING_FEATURES;

export interface FitnessMachineFeature {
  featuresRaw: number;
  targetSettingsRaw: number;
  features: Record<FitnessMachineFeatureName, boolean>;
  targetSettings: Record<TargetSettingFeatureName, boolean>;
}

function bitsToRecord<K extends string>(table: Record<K, number>, raw: number): Record<K, boolean> {
  const out = {} as Record<K, boolean>;
  for (const k of Object.keys(table) as K[]) out[k] = (raw & table[k]) >>> 0 !== 0;
  return out;
}

export function parseFitnessMachineFeature(data: ByteSource): FitnessMachineFeature {
  const r = new ByteReader(data);
  const featuresRaw = r.u32();
  const targetSettingsRaw = r.u32();
  return {
    featuresRaw,
    targetSettingsRaw,
    features: bitsToRecord(FITNESS_MACHINE_FEATURES, featuresRaw),
    targetSettings: bitsToRecord(TARGET_SETTING_FEATURES, targetSettingsRaw),
  };
}

export function encodeFitnessMachineFeature(features: number, targetSettings: number): Uint8Array {
  return new ByteWriter().u32(features).u32(targetSettings).toBytes();
}

// ---------------------------------------------------------------------------
// §4.18 Supported Resistance Level Range (0x2AD6) / §4.20 Supported Power Range (0x2AD8)
// ---------------------------------------------------------------------------

export interface SupportedRange {
  min: number;
  max: number;
  increment: number;
}

/** §4.18 : sint16 min, sint16 max, uint16 incrément — sans unité, résolution 0,1. */
export function parseSupportedResistanceLevelRange(data: ByteSource): SupportedRange {
  const r = new ByteReader(data);
  return { min: r.s16() / 10, max: r.s16() / 10, increment: r.u16() / 10 };
}

/** §4.20 : sint16 min (W), sint16 max (W), uint16 incrément (W). */
export function parseSupportedPowerRange(data: ByteSource): SupportedRange {
  const r = new ByteReader(data);
  return { min: r.s16(), max: r.s16(), increment: r.u16() };
}

export function encodeSupportedPowerRange(range: SupportedRange): Uint8Array {
  return new ByteWriter().s16(range.min).s16(range.max).u16(range.increment).toBytes();
}

export function encodeSupportedResistanceLevelRange(range: SupportedRange): Uint8Array {
  return new ByteWriter().s16(range.min * 10).s16(range.max * 10).u16(range.increment * 10).toBytes();
}

// ---------------------------------------------------------------------------
// §4.10 Training Status (0x2AD3)
// ---------------------------------------------------------------------------

/** §4.10.1.2 Training Status (uint8). */
export const TRAINING_STATUS = {
  0x00: 'other',
  0x01: 'idle',
  0x02: 'warmingUp',
  0x03: 'lowIntensityInterval',
  0x04: 'highIntensityInterval',
  0x05: 'recoveryInterval',
  0x06: 'isometric',
  0x07: 'heartRateControl',
  0x08: 'fitnessTest',
  0x09: 'speedOutsideControlRegionLow',
  0x0a: 'speedOutsideControlRegionHigh',
  0x0b: 'coolDown',
  0x0c: 'wattControl',
  0x0d: 'manualMode',
  0x0e: 'preWorkout',
  0x0f: 'postWorkout',
} as const;

export interface TrainingStatus {
  status: number;
  statusName: string;
  /** Présent si le bit 0 des flags est à 1. */
  statusString?: string;
  /** Bit 1 : la chaîne continue dans une lecture longue (Extended String). */
  extendedString: boolean;
}

export function parseTrainingStatus(data: ByteSource): TrainingStatus {
  const r = new ByteReader(data);
  const flags = r.u8();
  const status = r.u8();
  const out: TrainingStatus = {
    status,
    statusName: (TRAINING_STATUS as Record<number, string>)[status] ?? 'reserved',
    extendedString: (flags & 0x02) !== 0,
  };
  if (flags & 0x01) out.statusString = r.utf8();
  return out;
}

// ---------------------------------------------------------------------------
// §4.16 Fitness Machine Control Point (0x2AD9)
// ---------------------------------------------------------------------------

/** §4.16.1, tableau 4.15 : op codes. */
export const FTMS_OPCODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  setTargetHeartRate: 0x06,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  setWheelCircumference: 0x12,
  spinDownControl: 0x13,
  setTargetedCadence: 0x14,
  responseCode: 0x80,
} as const;

/** §4.16.2.22, tableau 4.24 : codes résultat. */
export const FTMS_RESULT = {
  success: 0x01,
  opCodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

const RESULT_NAMES: Record<number, FtmsResultName> = {
  0x01: 'success',
  0x02: 'opCodeNotSupported',
  0x03: 'invalidParameter',
  0x04: 'operationFailed',
  0x05: 'controlNotPermitted',
};
export type FtmsResultName = keyof typeof FTMS_RESULT | 'reserved';

/** §4.16.2.1 Request Control — à envoyer avant toute autre commande. */
export function encodeRequestControl(): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.requestControl);
}

/** §4.16.2.2 Reset. */
export function encodeReset(): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.reset);
}

/**
 * §4.16.2.5 Set Target Resistance Level : paramètre UINT8, sans unité, résolution 0,1.
 * Le niveau doit rester dans la plage lue sur 0x2AD6 ; on borne au type (0–25,5).
 */
export function encodeSetTargetResistanceLevel(level: number): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.setTargetResistanceLevel).u8(clamp(level * 10, 0, 255)).toBytes();
}

/** §4.16.2.6 Set Target Power : SINT16 en watts (mode ERG). */
export function encodeSetTargetPower(watts: number): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.setTargetPower).s16(watts).toBytes();
}

/** §4.16.2.4 Set Target Inclination : SINT16, 0,1 %. */
export function encodeSetTargetInclination(percent: number): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.setTargetInclination).s16(percent * 10).toBytes();
}

/** §4.16.2.8 Start or Resume. */
export function encodeStartOrResume(): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.startOrResume);
}

/** §4.16.2.9 Stop or Pause : paramètre 0x01 = stop, 0x02 = pause. */
export function encodeStopOrPause(kind: 'stop' | 'pause'): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.stopOrPause, kind === 'stop' ? 0x01 : 0x02);
}

export interface IndoorBikeSimulationParameters {
  /** Vitesse du vent en m/s (positive = vent de face). Défaut 0. */
  windSpeedMs?: number;
  /** Pente en %. */
  gradePercent: number;
  /** Coefficient de résistance au roulement (sans unité). Défaut 0,004. */
  crr?: number;
  /** Coefficient de résistance au vent en kg/m (½·ρ·CdA). Défaut 0,51. */
  cw?: number;
}

/**
 * §4.16.2.18 Set Indoor Bike Simulation Parameters (0x11) :
 *   wind speed SINT16 0,001 m/s · grade SINT16 0,01 % · crr UINT8 0,0001 · cw UINT8 0,01 kg/m.
 */
export function encodeSetIndoorBikeSimulation(p: IndoorBikeSimulationParameters): Uint8Array {
  return new ByteWriter()
    .u8(FTMS_OPCODE.setIndoorBikeSimulation)
    .s16((p.windSpeedMs ?? 0) * 1000)
    .s16(p.gradePercent * 100)
    .u8((p.crr ?? 0.004) * 10000)
    .u8((p.cw ?? 0.51) * 100)
    .toBytes();
}

/** §4.16.2.19 Set Wheel Circumference (0x12) : UINT16, 0,1 mm. */
export function encodeSetWheelCircumference(mm: number): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.setWheelCircumference).u16(mm * 10).toBytes();
}

/** §4.16.2.20 Spin Down Control (0x13) : 0x01 = start, 0x02 = ignore. */
export function encodeSpinDownControl(action: 'start' | 'ignore'): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.spinDownControl, action === 'start' ? 0x01 : 0x02);
}

/** §4.16.2.21 Set Targeted Cadence (0x14) : UINT16, 0,5 tr/min. */
export function encodeSetTargetedCadence(rpm: number): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.setTargetedCadence).u16(rpm * 2).toBytes();
}

export interface FtmsControlPointResponse {
  requestOpCode: number;
  result: number;
  resultName: FtmsResultName;
  /** §4.16.2.20 : réponse « Success » à un Spin Down start → plage de vitesse cible. */
  spinDown?: { targetSpeedLowKmh: number; targetSpeedHighKmh: number };
  /** Paramètres de réponse non interprétés. */
  parameters: Uint8Array;
}

/** §4.16.2.22 Response Code (0x80) : [0x80, op code de la requête, résultat, paramètres…]. */
export function parseControlPointResponse(data: ByteSource): FtmsControlPointResponse {
  const r = new ByteReader(data);
  const code = r.u8();
  if (code !== FTMS_OPCODE.responseCode) {
    throw new ProtocolError(`Réponse FTMS attendue (0x80), reçu 0x${code.toString(16)}`);
  }
  const requestOpCode = r.u8();
  const result = r.u8();
  const parameters = r.rest();
  const out: FtmsControlPointResponse = {
    requestOpCode,
    result,
    resultName: RESULT_NAMES[result] ?? 'reserved',
    parameters,
  };
  if (requestOpCode === FTMS_OPCODE.spinDownControl && result === FTMS_RESULT.success && parameters.length >= 4) {
    const p = new ByteReader(parameters);
    out.spinDown = { targetSpeedLowKmh: p.u16() / 100, targetSpeedHighKmh: p.u16() / 100 };
  }
  return out;
}

export function encodeControlPointResponse(requestOpCode: number, result: number, parameters: ArrayLike<number> = []): Uint8Array {
  return new ByteWriter().u8(FTMS_OPCODE.responseCode).u8(requestOpCode).u8(result).raw(parameters).toBytes();
}

/** Décodage d'une requête Control Point (côté simulateur / serveur). */
export type FtmsControlPointRequest =
  | { opCode: 0x00; kind: 'requestControl' }
  | { opCode: 0x01; kind: 'reset' }
  | { opCode: 0x03; kind: 'setTargetInclination'; percent: number }
  | { opCode: 0x04; kind: 'setTargetResistanceLevel'; level: number }
  | { opCode: 0x05; kind: 'setTargetPower'; watts: number }
  | { opCode: 0x07; kind: 'startOrResume' }
  | { opCode: 0x08; kind: 'stopOrPause'; stop: boolean }
  | ({ opCode: 0x11; kind: 'setIndoorBikeSimulation' } & Required<IndoorBikeSimulationParameters>)
  | { opCode: 0x12; kind: 'setWheelCircumference'; mm: number }
  | { opCode: 0x13; kind: 'spinDownControl'; start: boolean }
  | { opCode: 0x14; kind: 'setTargetedCadence'; rpm: number }
  | { opCode: number; kind: 'unknown'; parameters: Uint8Array };

export function parseControlPointRequest(data: ByteSource): FtmsControlPointRequest {
  const r = new ByteReader(data);
  const opCode = r.u8();
  switch (opCode) {
    case 0x00:
      return { opCode, kind: 'requestControl' };
    case 0x01:
      return { opCode, kind: 'reset' };
    case 0x03:
      return { opCode, kind: 'setTargetInclination', percent: r.s16() / 10 };
    case 0x04:
      return { opCode, kind: 'setTargetResistanceLevel', level: r.u8() / 10 };
    case 0x05:
      return { opCode, kind: 'setTargetPower', watts: r.s16() };
    case 0x07:
      return { opCode, kind: 'startOrResume' };
    case 0x08:
      return { opCode, kind: 'stopOrPause', stop: r.u8() === 0x01 };
    case 0x11:
      return {
        opCode,
        kind: 'setIndoorBikeSimulation',
        windSpeedMs: r.s16() / 1000,
        gradePercent: r.s16() / 100,
        crr: r.u8() / 10000,
        cw: r.u8() / 100,
      };
    case 0x12:
      return { opCode, kind: 'setWheelCircumference', mm: r.u16() / 10 };
    case 0x13:
      return { opCode, kind: 'spinDownControl', start: r.u8() === 0x01 };
    case 0x14:
      return { opCode, kind: 'setTargetedCadence', rpm: r.u16() / 2 };
    default:
      return { opCode, kind: 'unknown', parameters: r.rest() };
  }
}

// ---------------------------------------------------------------------------
// §4.17 Fitness Machine Status (0x2ADA)
// ---------------------------------------------------------------------------

/** §4.17.1, tableau 4.26 : op codes de statut. */
export const FTMS_STATUS = {
  reset: 0x01,
  stoppedOrPausedByUser: 0x02,
  stoppedBySafetyKey: 0x03,
  startedOrResumedByUser: 0x04,
  targetSpeedChanged: 0x05,
  targetInclineChanged: 0x06,
  targetResistanceLevelChanged: 0x07,
  targetPowerChanged: 0x08,
  targetHeartRateChanged: 0x09,
  targetedExpendedEnergyChanged: 0x0a,
  targetedNumberOfStepsChanged: 0x0b,
  targetedNumberOfStridesChanged: 0x0c,
  targetedDistanceChanged: 0x0d,
  targetedTrainingTimeChanged: 0x0e,
  targetedTimeInTwoHrZonesChanged: 0x0f,
  targetedTimeInThreeHrZonesChanged: 0x10,
  targetedTimeInFiveHrZonesChanged: 0x11,
  indoorBikeSimulationParametersChanged: 0x12,
  wheelCircumferenceChanged: 0x13,
  spinDownStatus: 0x14,
  targetedCadenceChanged: 0x15,
  controlPermissionLost: 0xff,
} as const;

export type FitnessMachineStatus =
  | { opCode: 0x01; kind: 'reset' }
  | { opCode: 0x02; kind: 'stoppedOrPausedByUser'; stopped: boolean }
  | { opCode: 0x03; kind: 'stoppedBySafetyKey' }
  | { opCode: 0x04; kind: 'startedOrResumedByUser' }
  | { opCode: 0x05; kind: 'targetSpeedChanged'; speedKmh: number }
  | { opCode: 0x06; kind: 'targetInclineChanged'; percent: number }
  | { opCode: 0x07; kind: 'targetResistanceLevelChanged'; level: number }
  | { opCode: 0x08; kind: 'targetPowerChanged'; watts: number }
  | { opCode: 0x09; kind: 'targetHeartRateChanged'; bpm: number }
  | ({ opCode: 0x12; kind: 'indoorBikeSimulationParametersChanged' } & Required<IndoorBikeSimulationParameters>)
  | { opCode: 0x13; kind: 'wheelCircumferenceChanged'; mm: number }
  | { opCode: 0x14; kind: 'spinDownStatus'; status: 'requested' | 'success' | 'error' | 'stopPedaling' | 'unknown' }
  | { opCode: 0x15; kind: 'targetedCadenceChanged'; rpm: number }
  | { opCode: 0xff; kind: 'controlPermissionLost' }
  | { opCode: number; kind: 'other'; parameters: Uint8Array };

const SPIN_DOWN_STATUS = { 0x01: 'requested', 0x02: 'success', 0x03: 'error', 0x04: 'stopPedaling' } as const;

export function parseFitnessMachineStatus(data: ByteSource): FitnessMachineStatus {
  const r = new ByteReader(data);
  const opCode = r.u8();
  switch (opCode) {
    case 0x01:
      return { opCode, kind: 'reset' };
    case 0x02:
      // §4.17.2.2 : 0x01 = stop, 0x02 = pause.
      return { opCode, kind: 'stoppedOrPausedByUser', stopped: r.u8() === 0x01 };
    case 0x03:
      return { opCode, kind: 'stoppedBySafetyKey' };
    case 0x04:
      return { opCode, kind: 'startedOrResumedByUser' };
    case 0x05:
      return { opCode, kind: 'targetSpeedChanged', speedKmh: r.u16() / 100 };
    case 0x06:
      return { opCode, kind: 'targetInclineChanged', percent: r.s16() / 10 };
    case 0x07:
      return { opCode, kind: 'targetResistanceLevelChanged', level: r.u8() / 10 };
    case 0x08:
      return { opCode, kind: 'targetPowerChanged', watts: r.s16() };
    case 0x09:
      return { opCode, kind: 'targetHeartRateChanged', bpm: r.u8() };
    case 0x12:
      return {
        opCode,
        kind: 'indoorBikeSimulationParametersChanged',
        windSpeedMs: r.s16() / 1000,
        gradePercent: r.s16() / 100,
        crr: r.u8() / 10000,
        cw: r.u8() / 100,
      };
    case 0x13:
      return { opCode, kind: 'wheelCircumferenceChanged', mm: r.u16() / 10 };
    case 0x14: {
      const s = r.u8();
      return { opCode, kind: 'spinDownStatus', status: (SPIN_DOWN_STATUS as Record<number, 'requested' | 'success' | 'error' | 'stopPedaling'>)[s] ?? 'unknown' };
    }
    case 0x15:
      return { opCode, kind: 'targetedCadenceChanged', rpm: r.u16() / 2 };
    case 0xff:
      return { opCode, kind: 'controlPermissionLost' };
    default:
      return { opCode, kind: 'other', parameters: r.rest() };
  }
}
