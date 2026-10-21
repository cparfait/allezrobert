/**
 * Cycling Power Service (CPS) — Bluetooth SIG, « Cycling Power Service » v1.1 et
 * GATT Specification Supplement (GSS) §3.59 (Cycling Power Measurement), §3.60 (Vector), §3.61 (Feature).
 *
 * Important (Favero Assioma, et la plupart des pédales) : le CPS standard NE transporte PAS
 * Torque Effectiveness ni Pedal Smoothness. Ces métriques n'existent qu'en ANT+ PWR, page 0x13
 * (voir ant/power.ts). En Bluetooth on obtient puissance, cadence (via les révolutions de manivelle)
 * et balance G/D (Pedal Power Balance), à condition que les Assioma soient en mode « G+D combiné ».
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';

/** GSS §3.59.2.1 : bits du champ Flags (uint16) de Cycling Power Measurement. */
export const CPS_MEASUREMENT_FLAGS = {
  pedalPowerBalancePresent: 1 << 0,
  /** 0 = référence inconnue, 1 = la balance est la part de la pédale GAUCHE. */
  pedalPowerBalanceReferenceLeft: 1 << 1,
  accumulatedTorquePresent: 1 << 2,
  /** 0 = couple mesuré à la roue, 1 = à la manivelle. */
  accumulatedTorqueSourceCrank: 1 << 3,
  wheelRevolutionDataPresent: 1 << 4,
  crankRevolutionDataPresent: 1 << 5,
  extremeForceMagnitudesPresent: 1 << 6,
  extremeTorqueMagnitudesPresent: 1 << 7,
  extremeAnglesPresent: 1 << 8,
  topDeadSpotAnglePresent: 1 << 9,
  bottomDeadSpotAnglePresent: 1 << 10,
  accumulatedEnergyPresent: 1 << 11,
  offsetCompensationIndicator: 1 << 12,
} as const;

export interface CyclingPowerMeasurement {
  flags: number;
  /** Puissance instantanée, sint16, W. */
  instantaneousPowerW: number;
  /** Balance brute (uint8, résolution 1/2 %), en % de la pédale de référence. */
  pedalPowerBalancePercent?: number;
  /** 'left' si le bit 1 des flags est à 1 ; 'unknown' sinon. Défini seulement si la balance est présente. */
  pedalPowerBalanceReference?: 'left' | 'unknown';
  /** Bit de référence brut, même si la balance est absente (utile au diagnostic Assioma). */
  balanceReferenceLeftFlag: boolean;
  /** Couple cumulé, uint16, 1/32 N·m. */
  accumulatedTorqueNm?: number;
  accumulatedTorqueSource?: 'wheel' | 'crank';
  /** Révolutions de roue cumulées (uint32) et temps du dernier événement (uint16, 1/2048 s). */
  cumulativeWheelRevolutions?: number;
  lastWheelEventTime?: number;
  /** Révolutions de manivelle cumulées (uint16) et temps du dernier événement (uint16, 1/1024 s). */
  cumulativeCrankRevolutions?: number;
  lastCrankEventTime?: number;
  /** Forces extrêmes, sint16, N. */
  maximumForceN?: number;
  minimumForceN?: number;
  /** Couples extrêmes, sint16, 1/32 N·m. */
  maximumTorqueNm?: number;
  minimumTorqueNm?: number;
  /** Angles extrêmes : uint12 + uint12 empaquetés dans 3 octets, degrés. */
  maximumAngleDeg?: number;
  minimumAngleDeg?: number;
  topDeadSpotAngleDeg?: number;
  bottomDeadSpotAngleDeg?: number;
  /** Énergie cumulée, uint16, kJ. */
  accumulatedEnergyKj?: number;
  offsetCompensationIndicator: boolean;
}

/** Décode Cycling Power Measurement (0x2A63). Ordre des champs : GSS §3.59.2. */
export function parseCyclingPowerMeasurement(data: ByteSource): CyclingPowerMeasurement {
  const r = new ByteReader(data);
  const F = CPS_MEASUREMENT_FLAGS;
  const flags = r.u16();
  const out: CyclingPowerMeasurement = {
    flags,
    instantaneousPowerW: r.s16(),
    balanceReferenceLeftFlag: (flags & F.pedalPowerBalanceReferenceLeft) !== 0,
    offsetCompensationIndicator: (flags & F.offsetCompensationIndicator) !== 0,
  };
  if (flags & F.pedalPowerBalancePresent) {
    out.pedalPowerBalancePercent = r.u8() / 2;
    out.pedalPowerBalanceReference = out.balanceReferenceLeftFlag ? 'left' : 'unknown';
  }
  if (flags & F.accumulatedTorquePresent) {
    out.accumulatedTorqueNm = r.u16() / 32;
    out.accumulatedTorqueSource = flags & F.accumulatedTorqueSourceCrank ? 'crank' : 'wheel';
  }
  if (flags & F.wheelRevolutionDataPresent) {
    out.cumulativeWheelRevolutions = r.u32();
    out.lastWheelEventTime = r.u16();
  }
  if (flags & F.crankRevolutionDataPresent) {
    out.cumulativeCrankRevolutions = r.u16();
    out.lastCrankEventTime = r.u16();
  }
  if (flags & F.extremeForceMagnitudesPresent) {
    out.maximumForceN = r.s16();
    out.minimumForceN = r.s16();
  }
  if (flags & F.extremeTorqueMagnitudesPresent) {
    out.maximumTorqueNm = r.s16() / 32;
    out.minimumTorqueNm = r.s16() / 32;
  }
  if (flags & F.extremeAnglesPresent) {
    // GSS : « Maximum Angle » sur les 12 bits de poids faible, « Minimum Angle » sur les 12 bits suivants.
    const packed = r.u24();
    out.maximumAngleDeg = packed & 0xfff;
    out.minimumAngleDeg = (packed >> 12) & 0xfff;
  }
  if (flags & F.topDeadSpotAnglePresent) out.topDeadSpotAngleDeg = r.u16();
  if (flags & F.bottomDeadSpotAnglePresent) out.bottomDeadSpotAngleDeg = r.u16();
  if (flags & F.accumulatedEnergyPresent) out.accumulatedEnergyKj = r.u16();
  return out;
}

export interface CyclingPowerMeasurementInput {
  instantaneousPowerW: number;
  pedalPowerBalancePercent?: number;
  balanceReferenceLeft?: boolean;
  accumulatedTorqueNm?: number;
  accumulatedTorqueSource?: 'wheel' | 'crank';
  cumulativeWheelRevolutions?: number;
  lastWheelEventTime?: number;
  cumulativeCrankRevolutions?: number;
  lastCrankEventTime?: number;
  maximumForceN?: number;
  minimumForceN?: number;
  maximumTorqueNm?: number;
  minimumTorqueNm?: number;
  maximumAngleDeg?: number;
  minimumAngleDeg?: number;
  topDeadSpotAngleDeg?: number;
  bottomDeadSpotAngleDeg?: number;
  accumulatedEnergyKj?: number;
  offsetCompensationIndicator?: boolean;
}

/** Encodeur symétrique (simulateur, tests). */
export function encodeCyclingPowerMeasurement(m: CyclingPowerMeasurementInput): Uint8Array {
  const F = CPS_MEASUREMENT_FLAGS;
  let flags = 0;
  const b = new ByteWriter();
  b.s16(m.instantaneousPowerW);
  if (m.pedalPowerBalancePercent !== undefined) {
    flags |= F.pedalPowerBalancePresent;
    b.u8(m.pedalPowerBalancePercent * 2);
  }
  if (m.balanceReferenceLeft) flags |= F.pedalPowerBalanceReferenceLeft;
  if (m.accumulatedTorqueNm !== undefined) {
    flags |= F.accumulatedTorquePresent;
    if (m.accumulatedTorqueSource === 'crank') flags |= F.accumulatedTorqueSourceCrank;
    b.u16((m.accumulatedTorqueNm * 32) % 65536);
  }
  if (m.cumulativeWheelRevolutions !== undefined) {
    flags |= F.wheelRevolutionDataPresent;
    b.u32(m.cumulativeWheelRevolutions >>> 0).u16((m.lastWheelEventTime ?? 0) % 65536);
  }
  if (m.cumulativeCrankRevolutions !== undefined) {
    flags |= F.crankRevolutionDataPresent;
    b.u16(m.cumulativeCrankRevolutions % 65536).u16((m.lastCrankEventTime ?? 0) % 65536);
  }
  if (m.maximumForceN !== undefined || m.minimumForceN !== undefined) {
    flags |= F.extremeForceMagnitudesPresent;
    b.s16(m.maximumForceN ?? 0).s16(m.minimumForceN ?? 0);
  }
  if (m.maximumTorqueNm !== undefined || m.minimumTorqueNm !== undefined) {
    flags |= F.extremeTorqueMagnitudesPresent;
    b.s16((m.maximumTorqueNm ?? 0) * 32).s16((m.minimumTorqueNm ?? 0) * 32);
  }
  if (m.maximumAngleDeg !== undefined || m.minimumAngleDeg !== undefined) {
    flags |= F.extremeAnglesPresent;
    b.u24(((m.maximumAngleDeg ?? 0) & 0xfff) | (((m.minimumAngleDeg ?? 0) & 0xfff) << 12));
  }
  if (m.topDeadSpotAngleDeg !== undefined) (flags |= F.topDeadSpotAnglePresent), b.u16(m.topDeadSpotAngleDeg);
  if (m.bottomDeadSpotAngleDeg !== undefined) (flags |= F.bottomDeadSpotAnglePresent), b.u16(m.bottomDeadSpotAngleDeg);
  if (m.accumulatedEnergyKj !== undefined) (flags |= F.accumulatedEnergyPresent), b.u16(m.accumulatedEnergyKj);
  if (m.offsetCompensationIndicator) flags |= F.offsetCompensationIndicator;
  return new ByteWriter().u16(flags).raw(b.toBytes()).toBytes();
}

/**
 * Part de la jambe gauche (0–100 %) déduite d'une mesure CPS.
 * Si la référence est inconnue, on ne peut pas affirmer quelle jambe est décrite : undefined.
 */
export function leftBalanceFromCps(m: CyclingPowerMeasurement): number | undefined {
  if (m.pedalPowerBalancePercent === undefined) return undefined;
  return m.pedalPowerBalanceReference === 'left' ? m.pedalPowerBalancePercent : undefined;
}

// ---------------------------------------------------------------------------
// GSS §3.61 Cycling Power Feature (0x2A65), uint32
// ---------------------------------------------------------------------------

export const CPS_FEATURES = {
  pedalPowerBalance: 1 << 0,
  accumulatedTorque: 1 << 1,
  wheelRevolutionData: 1 << 2,
  crankRevolutionData: 1 << 3,
  extremeMagnitudes: 1 << 4,
  extremeAngles: 1 << 5,
  topAndBottomDeadSpotAngles: 1 << 6,
  accumulatedEnergy: 1 << 7,
  offsetCompensationIndicator: 1 << 8,
  offsetCompensation: 1 << 9,
  measurementContentMasking: 1 << 10,
  multipleSensorLocations: 1 << 11,
  crankLengthAdjustment: 1 << 12,
  chainLengthAdjustment: 1 << 13,
  chainWeightAdjustment: 1 << 14,
  spanLengthAdjustment: 1 << 15,
  /** 0 = mesure basée sur la force, 1 = sur le couple. */
  sensorMeasurementContextTorque: 1 << 16,
  instantaneousMeasurementDirection: 1 << 17,
  factoryCalibrationDate: 1 << 18,
  enhancedOffsetCompensation: 1 << 19,
} as const;

export type CpsFeatureName = keyof typeof CPS_FEATURES;

export interface CyclingPowerFeature {
  raw: number;
  features: Record<CpsFeatureName, boolean>;
  /** Bits 20–21 : 0 = ancien capteur, 1 = non utilisable en système distribué, 2 = utilisable, 3 = réservé. */
  distributedSystemSupport: 'legacy' | 'notForDistributed' | 'distributed' | 'reserved';
}

export function parseCyclingPowerFeature(data: ByteSource): CyclingPowerFeature {
  const raw = new ByteReader(data).u32();
  const features = {} as Record<CpsFeatureName, boolean>;
  for (const k of Object.keys(CPS_FEATURES) as CpsFeatureName[]) features[k] = (raw & CPS_FEATURES[k]) !== 0;
  const ds = (raw >>> 20) & 0x3;
  return {
    raw,
    features,
    distributedSystemSupport: (['legacy', 'notForDistributed', 'distributed', 'reserved'] as const)[ds] ?? 'reserved',
  };
}

export function encodeCyclingPowerFeature(raw: number): Uint8Array {
  return new ByteWriter().u32(raw).toBytes();
}

// ---------------------------------------------------------------------------
// GSS §3.60 Cycling Power Vector (0x2A64) — optionnel
// ---------------------------------------------------------------------------

export interface CyclingPowerVector {
  flags: number;
  cumulativeCrankRevolutions?: number;
  lastCrankEventTime?: number;
  firstCrankMeasurementAngleDeg?: number;
  instantaneousForceMagnitudesN?: number[];
  instantaneousTorqueMagnitudesNm?: number[];
  measurementDirection: 'unknown' | 'tangential' | 'radial' | 'lateral';
}

/** Flags uint8 : bit0 manivelle, bit1 premier angle, bit2 tableau de forces, bit3 tableau de couples, bits4-5 direction. */
export function parseCyclingPowerVector(data: ByteSource): CyclingPowerVector {
  const r = new ByteReader(data);
  const flags = r.u8();
  const out: CyclingPowerVector = {
    flags,
    measurementDirection: (['unknown', 'tangential', 'radial', 'lateral'] as const)[(flags >> 4) & 0x3] ?? 'unknown',
  };
  if (flags & 0x01) {
    out.cumulativeCrankRevolutions = r.u16();
    out.lastCrankEventTime = r.u16();
  }
  if (flags & 0x02) out.firstCrankMeasurementAngleDeg = r.u16();
  // Les tableaux occupent le reste de la notification (sint16 chacun) ; un seul des deux est attendu.
  if (flags & 0x04) {
    const arr: number[] = [];
    while (r.remaining >= 2) arr.push(r.s16());
    out.instantaneousForceMagnitudesN = arr;
  } else if (flags & 0x08) {
    const arr: number[] = [];
    while (r.remaining >= 2) arr.push(r.s16() / 32);
    out.instantaneousTorqueMagnitudesNm = arr;
  }
  return out;
}
