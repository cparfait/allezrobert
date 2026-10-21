/**
 * Wahoo Direct Connect (« DirCon », Wahoo Fitness TNP) : le protocole GATT transporté en TCP.
 * Réimplémentation d'après les descriptions publiques de Berg0162/DirCon, binarylogic/py-wftnp et
 * qdomyos-zwift (dirconpacket.h/.cpp) — aucun code copié.
 *
 * Découverte : mDNS « _wahoo-fitness-tnp._tcp » (port typique 36866), TXT « ble-service-uuids ».
 * Un seul client TCP à la fois par appareil (Wahoo).
 *
 * En-tête (6 octets) :
 *   0 : version du message (1)
 *   1 : identifiant (type de message)
 *   2 : n° de séquence (repris tel quel dans la réponse ; 0 pour les notifications non sollicitées)
 *   3 : code réponse (0 dans les requêtes)
 *   4–5 : longueur de la charge utile, uint16 BIG-ENDIAN
 * Charge utile : UUID 128 bits sur 16 octets (ordre de la chaîne), suivies des données.
 */
import { ByteReader, ProtocolError, toBytes, type ByteSource } from './bytes.ts';
import { bytesToUuid, uuidToBytes } from './uuids.ts';

export const DIRCON_VERSION = 1;
export const DIRCON_HEADER_LENGTH = 6;
export const DIRCON_MDNS_SERVICE = '_wahoo-fitness-tnp._tcp';
export const DIRCON_DEFAULT_PORT = 36866;

export const DIRCON_MSG = {
  discoverServices: 0x01,
  discoverCharacteristics: 0x02,
  readCharacteristic: 0x03,
  writeCharacteristic: 0x04,
  enableCharacteristicNotifications: 0x05,
  unsolicitedCharacteristicNotification: 0x06,
  /** Observé (qdomyos-zwift) : message sans charge utile, sens inconnu, répondu à vide. */
  unknown0x07: 0x07,
  error: 0xff,
} as const;

export const DIRCON_RESPONSE = {
  success: 0x00,
  unknownMessageType: 0x01,
  unexpectedError: 0x02,
  serviceNotFound: 0x03,
  characteristicNotFound: 0x04,
  characteristicOperationNotSupported: 0x05,
  characteristicWriteFailed: 0x06,
  unknownProtocol: 0x07,
} as const;

const RESPONSE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(DIRCON_RESPONSE).map(([k, v]) => [v, k]));

export function dirconResponseName(code: number): string {
  return RESPONSE_NAMES[code] ?? `code0x${code.toString(16)}`;
}

/** Propriétés de caractéristique dans la réponse « discover characteristics ». */
export const DIRCON_PROP = { read: 0x01, write: 0x02, notify: 0x04, indicate: 0x08 } as const;

export interface DirconPacket {
  version: number;
  messageId: number;
  sequence: number;
  responseCode: number;
  payload: Uint8Array;
}

export function encodeDirconPacket(p: { messageId: number; sequence: number; responseCode?: number; payload?: ArrayLike<number>; version?: number }): Uint8Array {
  const payload = p.payload ?? [];
  if (payload.length > 0xffff) throw new ProtocolError('Charge utile DirCon trop longue');
  const out = new Uint8Array(DIRCON_HEADER_LENGTH + payload.length);
  out[0] = p.version ?? DIRCON_VERSION;
  out[1] = p.messageId;
  out[2] = p.sequence & 0xff;
  out[3] = p.responseCode ?? 0;
  out[4] = (payload.length >> 8) & 0xff;
  out[5] = payload.length & 0xff;
  for (let i = 0; i < payload.length; i++) out[DIRCON_HEADER_LENGTH + i] = (payload[i] ?? 0) & 0xff;
  return out;
}

/** Décode UNE trame complète (lève une erreur si incomplète). */
export function decodeDirconPacket(data: ByteSource): DirconPacket {
  const b = toBytes(data);
  if (b.length < DIRCON_HEADER_LENGTH) throw new ProtocolError('Trame DirCon incomplète (en-tête)');
  const len = ((b[4] ?? 0) << 8) | (b[5] ?? 0);
  if (b.length < DIRCON_HEADER_LENGTH + len) throw new ProtocolError('Trame DirCon incomplète (charge utile)');
  return {
    version: b[0] ?? 0,
    messageId: b[1] ?? 0,
    sequence: b[2] ?? 0,
    responseCode: b[3] ?? 0,
    payload: b.slice(DIRCON_HEADER_LENGTH, DIRCON_HEADER_LENGTH + len),
  };
}

/**
 * Réassembleur de flux TCP : les trames peuvent arriver coupées ou collées.
 * En cas d'octet de version invalide, on avance d'un octet pour se resynchroniser.
 */
export class DirconReassembler {
  private buf: Uint8Array = new Uint8Array(0);
  /** Octets ignorés lors d'une resynchronisation. */
  dropped = 0;
  /** Taille maximale tolérée d'une charge utile (protection contre un flux corrompu). */
  maxPayload = 4096;

  push(chunk: ByteSource): DirconPacket[] {
    const c = toBytes(chunk);
    const merged = new Uint8Array(this.buf.length + c.length);
    merged.set(this.buf, 0);
    merged.set(c, this.buf.length);
    let offset = 0;
    const out: DirconPacket[] = [];
    while (merged.length - offset >= DIRCON_HEADER_LENGTH) {
      const version = merged[offset] ?? 0;
      const len = ((merged[offset + 4] ?? 0) << 8) | (merged[offset + 5] ?? 0);
      if (version !== DIRCON_VERSION || len > this.maxPayload) {
        offset++;
        this.dropped++;
        continue;
      }
      if (merged.length - offset < DIRCON_HEADER_LENGTH + len) break;
      out.push(decodeDirconPacket(merged.subarray(offset, offset + DIRCON_HEADER_LENGTH + len)));
      offset += DIRCON_HEADER_LENGTH + len;
    }
    this.buf = merged.slice(offset);
    return out;
  }

  get pending(): number {
    return this.buf.length;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
  }
}

// --- Requêtes (client → appareil) --------------------------------------------------------

export function dirconDiscoverServices(sequence: number): Uint8Array {
  return encodeDirconPacket({ messageId: DIRCON_MSG.discoverServices, sequence });
}

export function dirconDiscoverCharacteristics(sequence: number, service: string): Uint8Array {
  return encodeDirconPacket({ messageId: DIRCON_MSG.discoverCharacteristics, sequence, payload: uuidToBytes(service) });
}

export function dirconRead(sequence: number, characteristic: string): Uint8Array {
  return encodeDirconPacket({ messageId: DIRCON_MSG.readCharacteristic, sequence, payload: uuidToBytes(characteristic) });
}

export function dirconWrite(sequence: number, characteristic: string, data: ArrayLike<number>): Uint8Array {
  return encodeDirconPacket({ messageId: DIRCON_MSG.writeCharacteristic, sequence, payload: [...uuidToBytes(characteristic), ...Array.from(data)] });
}

/** Activation (1) / désactivation (0) des notifications : UUID + 1 octet. */
export function dirconEnableNotifications(sequence: number, characteristic: string, enable = true): Uint8Array {
  return encodeDirconPacket({
    messageId: DIRCON_MSG.enableCharacteristicNotifications,
    sequence,
    payload: [...uuidToBytes(characteristic), enable ? 0x01 : 0x00],
  });
}

// --- Réponses et notifications (appareil → client) ---------------------------------------

/** Réponse 0x01 : liste d'UUID de services (multiple de 16 octets). */
export function parseDiscoverServicesResponse(payload: Uint8Array): string[] {
  if (payload.length % 16 !== 0) throw new ProtocolError('Réponse « discover services » : longueur non multiple de 16');
  const out: string[] = [];
  for (let i = 0; i < payload.length; i += 16) out.push(bytesToUuid(payload.subarray(i, i + 16)));
  return out;
}

export interface DirconCharacteristic {
  uuid: string;
  properties: number;
  read: boolean;
  write: boolean;
  notify: boolean;
  indicate: boolean;
}

/** Réponse 0x02 : UUID du service puis N × (UUID caractéristique + 1 octet de propriétés). */
export function parseDiscoverCharacteristicsResponse(payload: Uint8Array): { service: string; characteristics: DirconCharacteristic[] } {
  if (payload.length < 16 || (payload.length - 16) % 17 !== 0) {
    throw new ProtocolError('Réponse « discover characteristics » : longueur invalide');
  }
  const service = bytesToUuid(payload.subarray(0, 16));
  const characteristics: DirconCharacteristic[] = [];
  for (let i = 16; i < payload.length; i += 17) {
    const properties = payload[i + 16] ?? 0;
    characteristics.push({
      uuid: bytesToUuid(payload.subarray(i, i + 16)),
      properties,
      read: (properties & DIRCON_PROP.read) !== 0,
      write: (properties & DIRCON_PROP.write) !== 0,
      notify: (properties & DIRCON_PROP.notify) !== 0,
      indicate: (properties & DIRCON_PROP.indicate) !== 0,
    });
  }
  return { service, characteristics };
}

/** Réponses 0x03/0x04/0x05 et notification 0x06 : UUID + données éventuelles. */
export function parseCharacteristicPayload(payload: Uint8Array): { characteristic: string; data: Uint8Array } {
  const r = new ByteReader(payload);
  const characteristic = bytesToUuid(r.bytesN(16));
  return { characteristic, data: r.rest().slice() };
}

// --- Côté « serveur » (simulateur, tests, passerelle) -------------------------------------

export function dirconDiscoverServicesResponse(sequence: number, services: string[]): Uint8Array {
  const payload: number[] = [];
  for (const s of services) payload.push(...uuidToBytes(s));
  return encodeDirconPacket({ messageId: DIRCON_MSG.discoverServices, sequence, payload });
}

export function dirconDiscoverCharacteristicsResponse(sequence: number, service: string, chars: Array<{ uuid: string; properties: number }>): Uint8Array {
  const payload: number[] = [...uuidToBytes(service)];
  for (const c of chars) payload.push(...uuidToBytes(c.uuid), c.properties & 0xff);
  return encodeDirconPacket({ messageId: DIRCON_MSG.discoverCharacteristics, sequence, payload });
}

export function dirconCharacteristicResponse(messageId: number, sequence: number, characteristic: string, data: ArrayLike<number> = [], responseCode = 0): Uint8Array {
  return encodeDirconPacket({ messageId, sequence, responseCode, payload: [...uuidToBytes(characteristic), ...Array.from(data)] });
}

export function dirconNotification(characteristic: string, data: ArrayLike<number>): Uint8Array {
  return encodeDirconPacket({ messageId: DIRCON_MSG.unsolicitedCharacteristicNotification, sequence: 0, payload: [...uuidToBytes(characteristic), ...Array.from(data)] });
}

export function dirconErrorResponse(messageId: number, sequence: number, responseCode: number): Uint8Array {
  return encodeDirconPacket({ messageId, sequence, responseCode });
}

/** Convertit la propriété DirCon en liste de propriétés GATT (format NativeGattService). */
export function dirconPropertiesToList(properties: number): string[] {
  const out: string[] = [];
  if (properties & DIRCON_PROP.read) out.push('read');
  if (properties & DIRCON_PROP.write) out.push('write');
  if (properties & DIRCON_PROP.notify) out.push('notify');
  if (properties & DIRCON_PROP.indicate) out.push('indicate');
  return out;
}
