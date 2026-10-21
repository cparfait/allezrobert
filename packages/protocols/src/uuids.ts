/**
 * Identifiants GATT utilisés par le jeu (Bluetooth SIG Assigned Numbers, §3.4 Services, §3.8 Characteristics),
 * plus les services propriétaires documentés publiquement (Tacx FE-C over BLE).
 * Toutes les UUID sont normalisées en 128 bits minuscules, format « 0000xxxx-0000-1000-8000-00805f9b34fb ».
 */
import { bleUuid } from '@allezrobert/shared';
import { ProtocolError } from './bytes.ts';

export { bleUuid };

const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** Normalise « 2AD2 », « 0x2ad2 », 0x2AD2 ou une UUID 128 bits vers la forme 128 bits minuscule. */
export function normalizeUuid(uuid: string | number): string {
  if (typeof uuid === 'number') return bleUuid(uuid);
  const u = uuid.trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{4}$/.test(u)) return `0000${u}${BASE_SUFFIX}`;
  if (/^[0-9a-f]{8}$/.test(u)) return `${u}${BASE_SUFFIX}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)) return u;
  if (/^[0-9a-f]{32}$/.test(u)) return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
  throw new ProtocolError(`UUID invalide : "${uuid}"`);
}

/** Identifiant 16 bits si l'UUID est dérivée de la base Bluetooth SIG, sinon undefined. */
export function shortUuid(uuid: string): number | undefined {
  const u = normalizeUuid(uuid);
  if (!u.startsWith('0000') || !u.endsWith(BASE_SUFFIX)) return undefined;
  return parseInt(u.slice(4, 8), 16);
}

/** UUID → 16 octets dans l'ordre de la chaîne (big-endian), format utilisé par Direct Connect. */
export function uuidToBytes(uuid: string | number): Uint8Array {
  const hex = normalizeUuid(uuid).replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 16 octets (big-endian) → UUID 128 bits minuscule. */
export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new ProtocolError(`Une UUID fait 16 octets, reçu ${bytes.length}`);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return normalizeUuid(hex);
}

export function sameUuid(a: string | number, b: string | number): boolean {
  return normalizeUuid(a) === normalizeUuid(b);
}

/** Services Bluetooth SIG. */
export const SERVICE = {
  /** Fitness Machine Service (FTMS v1.0). */
  fitnessMachine: bleUuid(0x1826),
  /** Cycling Power Service (CPS v1.1). */
  cyclingPower: bleUuid(0x1818),
  /** Heart Rate Service (HRS v1.0). */
  heartRate: bleUuid(0x180d),
  /** Cycling Speed and Cadence Service (CSCS v1.0). */
  cyclingSpeedCadence: bleUuid(0x1816),
  battery: bleUuid(0x180f),
  deviceInformation: bleUuid(0x180a),
} as const;

/** Caractéristiques Bluetooth SIG. */
export const CHAR = {
  // FTMS
  fitnessMachineFeature: bleUuid(0x2acc),
  indoorBikeData: bleUuid(0x2ad2),
  trainingStatus: bleUuid(0x2ad3),
  supportedResistanceLevelRange: bleUuid(0x2ad6),
  supportedPowerRange: bleUuid(0x2ad8),
  fitnessMachineControlPoint: bleUuid(0x2ad9),
  fitnessMachineStatus: bleUuid(0x2ada),
  // CPS
  cyclingPowerMeasurement: bleUuid(0x2a63),
  cyclingPowerVector: bleUuid(0x2a64),
  cyclingPowerFeature: bleUuid(0x2a65),
  cyclingPowerControlPoint: bleUuid(0x2a66),
  sensorLocation: bleUuid(0x2a5d),
  // HRS
  heartRateMeasurement: bleUuid(0x2a37),
  bodySensorLocation: bleUuid(0x2a38),
  // CSCS
  cscMeasurement: bleUuid(0x2a5b),
  cscFeature: bleUuid(0x2a5c),
  // Batterie
  batteryLevel: bleUuid(0x2a19),
  // Device Information (DIS v1.1, §3)
  manufacturerName: bleUuid(0x2a29),
  modelNumber: bleUuid(0x2a24),
  serialNumber: bleUuid(0x2a25),
  hardwareRevision: bleUuid(0x2a27),
  firmwareRevision: bleUuid(0x2a26),
  softwareRevision: bleUuid(0x2a28),
} as const;

/**
 * FE-C over BLE (Tacx, Elite, certains Wahoo) : les pages ANT+ FE-C encapsulées dans des messages ANT
 * complets (0xA4 … somme XOR) sur un service UART-like. Documenté publiquement par Tacx
 * (« FE-C and Bluetooth Protocol for Tacx Trainers ») et utilisé par Auuki / qdomyos-zwift.
 */
export const TACX_FEC = {
  service: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  /** Notifications trainer → appli. */
  rx: '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  /** Écriture appli → trainer. */
  tx: '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e',
} as const;
