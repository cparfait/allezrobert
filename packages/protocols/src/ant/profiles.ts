/**
 * Paramètres de canal des profils ANT+ utilisés (ANT+ Device Profiles, thisisant.com) :
 * type d'appareil, période de message (1/32768 s), fréquence RF 57.
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';
import { ANT_PLUS_RF_FREQUENCY } from './message.ts';

export interface AntProfileChannel {
  deviceType: number;
  period: number;
  rfFreq: number;
  /** 0 = joker en recherche ; le profil impose parfois une valeur (FE-C : 5). */
  transmissionType: number;
}

export const ANT_PLUS_PROFILES = {
  /** ANT+ Heart Rate Monitor Device Profile, §5.1 : type 120, 8070 (4,06 Hz). */
  heartRate: { deviceType: 120, period: 8070, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  /** ANT+ Bicycle Power Device Profile, §5.1 : type 11, 8182 (4,005 Hz). */
  power: { deviceType: 11, period: 8182, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  /** ANT+ Fitness Equipment Device Profile (FE-C), §5.1 : type 17, 8192 (4 Hz). */
  fitnessEquipment: { deviceType: 17, period: 8192, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  /** ANT+ Bike Speed and Cadence : vitesse+cadence 121 / 8086, vitesse 123 / 8118, cadence 122 / 8102. */
  speedCadence: { deviceType: 121, period: 8086, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  speed: { deviceType: 123, period: 8118, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  cadence: { deviceType: 122, period: 8102, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
  /** ANT+ Controls Device Profile : type 16, 8192 (télécommandes génériques). */
  controls: { deviceType: 16, period: 8192, rfFreq: ANT_PLUS_RF_FREQUENCY, transmissionType: 0 },
} as const satisfies Record<string, AntProfileChannel>;

export type AntPlusProfileName = keyof typeof ANT_PLUS_PROFILES;

export function antProfileForDeviceType(deviceType: number): AntPlusProfileName | undefined {
  for (const [k, v] of Object.entries(ANT_PLUS_PROFILES)) if (v.deviceType === deviceType) return k as AntPlusProfileName;
  return undefined;
}

// --- Pages communes (ANT+ Common Data Pages, rev 3.x) -------------------------------------

export interface ManufacturerInfoPage {
  page: 0x50;
  hardwareRevision: number;
  manufacturerId: number;
  modelNumber: number;
}

export interface ProductInfoPage {
  page: 0x51;
  softwareRevision: string;
  /** 0xFFFFFFFF = pas de numéro de série. */
  serialNumber?: number;
}

export interface BatteryStatusPage {
  page: 0x52;
  batteryIdentifier: number;
  voltage?: number;
  status: 'new' | 'good' | 'ok' | 'low' | 'critical' | 'invalid' | 'reserved';
}

export type CommonPage = ManufacturerInfoPage | ProductInfoPage | BatteryStatusPage;

const BATTERY_STATUS = ['reserved', 'new', 'good', 'ok', 'low', 'critical', 'reserved', 'invalid'] as const;

/** Pages communes 80 (0x50), 81 (0x51), 82 (0x52). */
export function decodeCommonPage(data: ByteSource): CommonPage | undefined {
  const r = new ByteReader(data);
  const page = r.u8();
  if (page === 0x50) {
    r.u8();
    r.u8(); // réservés 0xFF
    return { page, hardwareRevision: r.u8(), manufacturerId: r.u16(), modelNumber: r.u16() };
  }
  if (page === 0x51) {
    r.u8(); // réservé
    const supplemental = r.u8();
    const main = r.u8();
    const serial = r.u32();
    const softwareRevision = supplemental === 0xff ? `${main / 10}` : `${(main * 100 + supplemental) / 1000}`;
    const out: ProductInfoPage = { page, softwareRevision };
    if (serial !== 0xffffffff) out.serialNumber = serial;
    return out;
  }
  if (page === 0x52) {
    r.u8(); // réservé
    const batteryIdentifier = r.u8();
    r.u24(); // temps de fonctionnement cumulé
    const fractional = r.u8();
    const desc = r.u8();
    const coarse = desc & 0x0f;
    const status = BATTERY_STATUS[(desc >> 4) & 0x07] ?? 'reserved';
    const out: BatteryStatusPage = { page, batteryIdentifier, status };
    if (coarse !== 0x0f) out.voltage = coarse + fractional / 256;
    return out;
  }
  return undefined;
}

/**
 * Page commune 70 (0x46) « Request Data Page » : demande au capteur d'émettre une page
 * (ex. 0x50 pour lire le fabricant). Octet 5 : nombre d'émissions (bits 0–6), bit 7 = répondre en ack.
 */
export function encodeRequestDataPage(requestedPage: number, times = 4, replyAcknowledged = false): Uint8Array {
  return new ByteWriter()
    .u8(0x46)
    .u16(0xffff) // n° de série esclave : non utilisé
    .u8(0xff) // descripteur 1
    .u8(0xff) // descripteur 2
    .u8((times & 0x7f) | (replyAcknowledged ? 0x80 : 0))
    .u8(requestedPage)
    .u8(0x01) // type de commande : demande de page de données
    .toBytes();
}
