/**
 * Battery Service (BAS v1.0) — Battery Level 0x2A19 (uint8, 0–100 %), GSS §3.27.
 * Device Information Service (DIS v1.1) — chaînes UTF-8 (GSS §3.x).
 */
import { ByteReader, ProtocolError, clamp, decodeUtf8, toBytes, type ByteSource } from '../bytes.ts';
import { CHAR, normalizeUuid } from '../uuids.ts';

export function parseBatteryLevel(data: ByteSource): number {
  const v = new ByteReader(data).u8();
  if (v > 100) throw new ProtocolError(`Niveau de batterie hors plage : ${v}`);
  return v;
}

export function encodeBatteryLevel(percent: number): Uint8Array {
  return Uint8Array.of(clamp(Math.round(percent), 0, 100));
}

/** Les caractéristiques DIS lues par le jeu et le champ DeviceInfo correspondant. */
export const DEVICE_INFORMATION_FIELDS = {
  manufacturer: CHAR.manufacturerName,
  model: CHAR.modelNumber,
  serial: CHAR.serialNumber,
  hardware: CHAR.hardwareRevision,
  firmware: CHAR.firmwareRevision,
  software: CHAR.softwareRevision,
} as const;

export type DeviceInformationField = keyof typeof DEVICE_INFORMATION_FIELDS;
export type DeviceInformation = Partial<Record<DeviceInformationField, string>>;

/** Décode une chaîne DIS (UTF-8, zéros terminaux retirés, espaces superflus supprimés). */
export function parseDeviceInformationString(data: ByteSource): string {
  return decodeUtf8(toBytes(data)).trim();
}

export function deviceInformationFieldFor(characteristic: string): DeviceInformationField | undefined {
  const u = normalizeUuid(characteristic);
  for (const [k, v] of Object.entries(DEVICE_INFORMATION_FIELDS)) if (v === u) return k as DeviceInformationField;
  return undefined;
}
