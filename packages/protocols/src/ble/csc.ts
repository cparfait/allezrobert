/**
 * Cycling Speed and Cadence Service (CSCS v1.0) — CSC Measurement 0x2A5B (GSS §3.55), CSC Feature 0x2A5C.
 * Flags uint8 : bit0 données roue (uint32 révolutions + uint16 temps 1/1024 s),
 * bit1 données manivelle (uint16 révolutions + uint16 temps 1/1024 s).
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';

export interface CscMeasurement {
  flags: number;
  cumulativeWheelRevolutions?: number;
  lastWheelEventTime?: number;
  cumulativeCrankRevolutions?: number;
  lastCrankEventTime?: number;
}

export function parseCscMeasurement(data: ByteSource): CscMeasurement {
  const r = new ByteReader(data);
  const flags = r.u8();
  const out: CscMeasurement = { flags };
  if (flags & 0x01) {
    out.cumulativeWheelRevolutions = r.u32();
    out.lastWheelEventTime = r.u16();
  }
  if (flags & 0x02) {
    out.cumulativeCrankRevolutions = r.u16();
    out.lastCrankEventTime = r.u16();
  }
  return out;
}

export function encodeCscMeasurement(m: Omit<CscMeasurement, 'flags'>): Uint8Array {
  let flags = 0;
  const b = new ByteWriter();
  if (m.cumulativeWheelRevolutions !== undefined) {
    flags |= 0x01;
    b.u32(m.cumulativeWheelRevolutions >>> 0).u16((m.lastWheelEventTime ?? 0) % 65536);
  }
  if (m.cumulativeCrankRevolutions !== undefined) {
    flags |= 0x02;
    b.u16(m.cumulativeCrankRevolutions % 65536).u16((m.lastCrankEventTime ?? 0) % 65536);
  }
  return new ByteWriter().u8(flags).raw(b.toBytes()).toBytes();
}

export interface CscFeature {
  raw: number;
  wheelRevolutionData: boolean;
  crankRevolutionData: boolean;
  multipleSensorLocations: boolean;
}

export function parseCscFeature(data: ByteSource): CscFeature {
  const raw = new ByteReader(data).u16();
  return {
    raw,
    wheelRevolutionData: (raw & 0x01) !== 0,
    crankRevolutionData: (raw & 0x02) !== 0,
    multipleSensorLocations: (raw & 0x04) !== 0,
  };
}
