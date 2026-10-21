/**
 * Heart Rate Service (HRS v1.0) — Heart Rate Measurement 0x2A37, GSS §3.113.
 * Flags uint8 : bit0 format (0 = uint8, 1 = uint16), bits1-2 contact capteur,
 * bit3 énergie dépensée (uint16 kJ), bit4 intervalles R-R (uint16, 1/1024 s chacun).
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';

export const HR_FLAGS = {
  valueFormatUint16: 1 << 0,
  sensorContactDetected: 1 << 1,
  sensorContactSupported: 1 << 2,
  energyExpendedPresent: 1 << 3,
  rrIntervalPresent: 1 << 4,
} as const;

export interface HeartRateMeasurement {
  flags: number;
  bpm: number;
  /** undefined si le capteur ne gère pas la détection de contact. */
  sensorContact?: boolean;
  energyExpendedKj?: number;
  /** Intervalles R-R bruts en 1/1024 s. */
  rrRaw: number[];
  /** Intervalles R-R convertis en millisecondes (arrondis à 0,1 ms). */
  rrMs: number[];
}

export function rrRawToMs(raw: number): number {
  return Math.round((raw * 1000 * 10) / 1024) / 10;
}

export function parseHeartRateMeasurement(data: ByteSource): HeartRateMeasurement {
  const r = new ByteReader(data);
  const flags = r.u8();
  const bpm = flags & HR_FLAGS.valueFormatUint16 ? r.u16() : r.u8();
  const out: HeartRateMeasurement = { flags, bpm, rrRaw: [], rrMs: [] };
  if (flags & HR_FLAGS.sensorContactSupported) out.sensorContact = (flags & HR_FLAGS.sensorContactDetected) !== 0;
  if (flags & HR_FLAGS.energyExpendedPresent) out.energyExpendedKj = r.u16();
  if (flags & HR_FLAGS.rrIntervalPresent) {
    while (r.remaining >= 2) {
      const raw = r.u16();
      out.rrRaw.push(raw);
      out.rrMs.push(rrRawToMs(raw));
    }
  }
  return out;
}

export function encodeHeartRateMeasurement(m: { bpm: number; sensorContact?: boolean; energyExpendedKj?: number; rrMs?: number[] }): Uint8Array {
  let flags = 0;
  const b = new ByteWriter();
  if (m.bpm > 255) {
    flags |= HR_FLAGS.valueFormatUint16;
    b.u16(m.bpm);
  } else b.u8(m.bpm);
  if (m.sensorContact !== undefined) {
    flags |= HR_FLAGS.sensorContactSupported;
    if (m.sensorContact) flags |= HR_FLAGS.sensorContactDetected;
  }
  if (m.energyExpendedKj !== undefined) (flags |= HR_FLAGS.energyExpendedPresent), b.u16(m.energyExpendedKj);
  if (m.rrMs && m.rrMs.length) {
    flags |= HR_FLAGS.rrIntervalPresent;
    for (const ms of m.rrMs) b.u16((ms * 1024) / 1000);
  }
  return new ByteWriter().u8(flags).raw(b.toBytes()).toBytes();
}
