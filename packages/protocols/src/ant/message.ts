/**
 * Trames ANT série/USB — « ANT Message Protocol and Usage » rev 5.1 (Dynastream/Garmin) :
 *   §7.1  structure : [SYNC 0xA4][LENGTH][MSG ID][PAYLOAD…][CHECKSUM]
 *         CHECKSUM = XOR de tous les octets précédents, SYNC compris.
 *   §9.5  liste des messages (configuration, contrôle, données, événements).
 *
 * CLÉ RÉSEAU ANT+ : elle n'est volontairement PAS écrite dans ce dépôt (public). La clé ANT+
 * est distribuée par ANT Wireless (thisisant.com) aux adoptants qui acceptent la licence ANT+ ;
 * sa redistribution n'est pas autorisée par cette licence. Elle est donc lue dans la configuration
 * (variable d'environnement ANT_PLUS_NETWORK_KEY, ou réglage de l'app desktop) via parseAntNetworkKey().
 */
import { ByteReader, ProtocolError, toBytes, type ByteSource } from '../bytes.ts';

export const ANT_SYNC = 0xa4;

/** Identifiants de messages (§9.5). */
export const ANT_MSG = {
  // Configuration
  unassignChannel: 0x41,
  assignChannel: 0x42,
  channelPeriod: 0x43,
  searchTimeout: 0x44,
  channelRfFrequency: 0x45,
  setNetworkKey: 0x46,
  transmitPower: 0x47,
  setChannelId: 0x51,
  libConfig: 0x6e,
  // Contrôle
  resetSystem: 0x4a,
  openChannel: 0x4b,
  closeChannel: 0x4c,
  requestMessage: 0x4d,
  // Données
  broadcastData: 0x4e,
  acknowledgedData: 0x4f,
  burstData: 0x50,
  // Événements / réponses
  channelEvent: 0x40,
  startupMessage: 0x6f,
  channelStatus: 0x52,
  antVersion: 0x3e,
  capabilities: 0x54,
  serialNumber: 0x61,
} as const;

/** Codes d'événement / de réponse du message 0x40 (§9.5.6). */
export const ANT_EVENT = {
  responseNoError: 0x00,
  eventRxSearchTimeout: 0x01,
  eventRxFail: 0x02,
  eventTx: 0x03,
  eventTransferRxFailed: 0x04,
  eventTransferTxCompleted: 0x05,
  eventTransferTxFailed: 0x06,
  eventChannelClosed: 0x07,
  eventRxFailGoToSearch: 0x08,
  eventChannelCollision: 0x09,
  eventTransferTxStart: 0x0a,
  channelInWrongState: 0x15,
  channelNotOpened: 0x16,
  channelIdNotSet: 0x18,
  closeAllChannels: 0x19,
  transferInProgress: 0x1f,
  transferSequenceNumberError: 0x20,
  transferInError: 0x21,
  invalidMessage: 0x28,
  invalidNetworkNumber: 0x29,
  invalidListId: 0x30,
  invalidScanTxChannel: 0x31,
  invalidParameterProvided: 0x33,
  eventSerialQueueOverflow: 0x34,
  eventQueueOverflow: 0x35,
} as const;

const EVENT_NAMES: Record<number, string> = Object.fromEntries(Object.entries(ANT_EVENT).map(([k, v]) => [v, k]));

/** Types de canal (§5.2.1.1) : on n'utilise que l'esclave bidirectionnel (réception + ack). */
export const ANT_CHANNEL_TYPE = {
  bidirectionalSlave: 0x00,
  bidirectionalMaster: 0x10,
  sharedBidirectionalSlave: 0x20,
  slaveReceiveOnly: 0x40,
} as const;

/** Fréquence RF ANT+ : 2457 MHz → 57 (offset par rapport à 2400 MHz). */
export const ANT_PLUS_RF_FREQUENCY = 57;

export interface AntMessage {
  id: number;
  payload: Uint8Array;
}

export function antChecksum(bytes: ArrayLike<number>, length = bytes.length): number {
  let x = 0;
  for (let i = 0; i < length; i++) x ^= bytes[i] ?? 0;
  return x;
}

/** Encode un message complet [A4][len][id][payload][xor]. */
export function encodeAntMessage(id: number, payload: ArrayLike<number> = []): Uint8Array {
  if (payload.length > 255) throw new ProtocolError('Charge utile ANT trop longue');
  const out = new Uint8Array(payload.length + 4);
  out[0] = ANT_SYNC;
  out[1] = payload.length;
  out[2] = id;
  for (let i = 0; i < payload.length; i++) out[3 + i] = (payload[i] ?? 0) & 0xff;
  out[out.length - 1] = antChecksum(out, out.length - 1);
  return out;
}

/** Décode un message complet (vérifie la synchro, la longueur et la somme de contrôle). */
export function decodeAntMessage(data: ByteSource): AntMessage {
  const b = toBytes(data);
  if (b.length < 4) throw new ProtocolError('Message ANT trop court');
  if (b[0] !== ANT_SYNC) throw new ProtocolError(`Octet de synchro ANT attendu 0xA4, reçu 0x${(b[0] ?? 0).toString(16)}`);
  const len = b[1] ?? 0;
  if (b.length < len + 4) throw new ProtocolError('Message ANT tronqué');
  const sum = antChecksum(b, len + 3);
  if (sum !== b[len + 3]) throw new ProtocolError('Somme de contrôle ANT invalide');
  return { id: b[2] ?? 0, payload: b.slice(3, 3 + len) };
}

/** Réassemble un flux d'octets USB en messages ANT ; se resynchronise sur 0xA4 en cas d'erreur. */
export class AntMessageReader {
  private buf: number[] = [];
  /** Nombre d'octets rejetés (synchro perdue, somme fausse). */
  dropped = 0;
  /** Longueur maximale plausible d'une charge utile ANT ; au-delà, l'octet 0xA4 est une fausse synchro. */
  maxPayload = 64;

  push(chunk: ByteSource): AntMessage[] {
    const bytes = toBytes(chunk);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i] ?? 0);
    const out: AntMessage[] = [];
    for (;;) {
      while (this.buf.length && this.buf[0] !== ANT_SYNC) {
        this.buf.shift();
        this.dropped++;
      }
      if (this.buf.length < 4) break;
      const len = this.buf[1] ?? 0;
      if (len > this.maxPayload) {
        this.buf.shift();
        this.dropped++;
        continue;
      }
      if (this.buf.length < len + 4) break;
      const frame = this.buf.slice(0, len + 4);
      if (antChecksum(frame, len + 3) !== frame[len + 3]) {
        this.buf.shift(); // fausse synchro : on avance d'un octet
        this.dropped++;
        continue;
      }
      this.buf.splice(0, len + 4);
      out.push({ id: frame[2] ?? 0, payload: Uint8Array.from(frame.slice(3, 3 + len)) });
    }
    return out;
  }

  reset(): void {
    this.buf = [];
  }
}

// --- Messages de configuration et de contrôle -------------------------------------------

/** 0x4A Reset System (§9.5.4.1) : un octet de remplissage 0x00. */
export function antResetSystem(): Uint8Array {
  return encodeAntMessage(ANT_MSG.resetSystem, [0x00]);
}

/** 0x46 Set Network Key (§9.5.2.7) : n° de réseau + 8 octets de clé (fournis par la configuration). */
export function antSetNetworkKey(network: number, key: ArrayLike<number>): Uint8Array {
  if (key.length !== 8) throw new ProtocolError('Une clé réseau ANT fait 8 octets');
  return encodeAntMessage(ANT_MSG.setNetworkKey, [network, ...Array.from(key)]);
}

/** 0x42 Assign Channel (§9.5.2.2). */
export function antAssignChannel(channel: number, channelType: number = ANT_CHANNEL_TYPE.bidirectionalSlave, network = 0): Uint8Array {
  return encodeAntMessage(ANT_MSG.assignChannel, [channel, channelType, network]);
}

/** 0x41 Unassign Channel. */
export function antUnassignChannel(channel: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.unassignChannel, [channel]);
}

/**
 * 0x51 Set Channel ID (§9.5.2.3) : n° d'appareil uint16 LE (0 = joker), type d'appareil
 * (bit 7 = demande d'appairage), type de transmission (0 = joker).
 */
export function antSetChannelId(channel: number, deviceNumber: number, deviceType: number, transmissionType: number, pairing = false): Uint8Array {
  return encodeAntMessage(ANT_MSG.setChannelId, [
    channel,
    deviceNumber & 0xff,
    (deviceNumber >> 8) & 0xff,
    (deviceType & 0x7f) | (pairing ? 0x80 : 0),
    transmissionType,
  ]);
}

/** 0x43 Channel Period (§9.5.2.4) : uint16 LE en 1/32768 s (8070 = 4,06 Hz pour la FC). */
export function antSetChannelPeriod(channel: number, period: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.channelPeriod, [channel, period & 0xff, (period >> 8) & 0xff]);
}

/** 0x45 Channel RF Frequency (§9.5.2.6) : 2400 MHz + n ; ANT+ = 57. */
export function antSetChannelRfFrequency(channel: number, rfFreq: number = ANT_PLUS_RF_FREQUENCY): Uint8Array {
  return encodeAntMessage(ANT_MSG.channelRfFrequency, [channel, rfFreq]);
}

/** 0x44 Search Timeout (§9.5.2.5) : unités de 2,5 s, 0xFF = infini. */
export function antSetSearchTimeout(channel: number, units: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.searchTimeout, [channel, units & 0xff]);
}

/** 0x4B Open Channel. */
export function antOpenChannel(channel: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.openChannel, [channel]);
}

/** 0x4C Close Channel. */
export function antCloseChannel(channel: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.closeChannel, [channel]);
}

/** 0x4D Request Message (ex. 0x51 pour connaître le n° d'appareil appairé). */
export function antRequestMessage(channel: number, messageId: number): Uint8Array {
  return encodeAntMessage(ANT_MSG.requestMessage, [channel, messageId]);
}

/** 0x6E Lib Config : 0x80 = ajoute l'ID de canal (n° d'appareil, type…) aux messages reçus. */
export function antEnableExtendedMessages(enable = true): Uint8Array {
  return encodeAntMessage(ANT_MSG.libConfig, [0x00, enable ? 0x80 : 0x00]);
}

function eightBytes(data: ArrayLike<number>): number[] {
  if (data.length !== 8) throw new ProtocolError(`Une page ANT fait 8 octets, reçu ${data.length}`);
  return Array.from(data);
}

/** 0x4E Broadcast Data : n° de canal + 8 octets. */
export function antBroadcastData(channel: number, page: ArrayLike<number>): Uint8Array {
  return encodeAntMessage(ANT_MSG.broadcastData, [channel, ...eightBytes(page)]);
}

/** 0x4F Acknowledged Data : n° de canal + 8 octets (commandes FE-C). */
export function antAcknowledgedData(channel: number, page: ArrayLike<number>): Uint8Array {
  return encodeAntMessage(ANT_MSG.acknowledgedData, [channel, ...eightBytes(page)]);
}

// --- Décodage des messages reçus ----------------------------------------------------------

export interface AntChannelEvent {
  channel: number;
  /** 0x01 = événement RF ; sinon identifiant du message auquel on répond. */
  messageId: number;
  code: number;
  codeName: string;
  isEvent: boolean;
}

export function parseChannelEvent(msg: AntMessage): AntChannelEvent {
  if (msg.id !== ANT_MSG.channelEvent) throw new ProtocolError('Message 0x40 attendu');
  const r = new ByteReader(msg.payload);
  const channel = r.u8();
  const messageId = r.u8();
  const code = r.u8();
  return { channel, messageId, code, codeName: EVENT_NAMES[code] ?? 'unknown', isEvent: messageId === 0x01 };
}

export interface AntChannelId {
  deviceNumber: number;
  deviceType: number;
  transmissionType: number;
  pairing: boolean;
}

export interface AntDataMessage {
  channel: number;
  acknowledged: boolean;
  /** Les 8 octets de la page. */
  data: Uint8Array;
  /** Présent si les messages étendus (0x6E/0x80) sont actifs. */
  channelId?: AntChannelId;
}

/** Décode un message 0x4E/0x4F (éventuellement étendu avec l'octet de drapeaux 0x80, §7.1.1). */
export function parseAntDataMessage(msg: AntMessage): AntDataMessage {
  if (msg.id !== ANT_MSG.broadcastData && msg.id !== ANT_MSG.acknowledgedData) {
    throw new ProtocolError(`Message de données ANT attendu, reçu 0x${msg.id.toString(16)}`);
  }
  const r = new ByteReader(msg.payload);
  const channel = r.u8();
  const data = r.bytesN(8).slice();
  const out: AntDataMessage = { channel, acknowledged: msg.id === ANT_MSG.acknowledgedData, data };
  if (r.remaining >= 5) {
    const flag = r.u8();
    if (flag & 0x80) {
      const deviceNumber = r.u16();
      const dt = r.u8();
      out.channelId = { deviceNumber, deviceType: dt & 0x7f, pairing: (dt & 0x80) !== 0, transmissionType: r.u8() };
    }
  }
  return out;
}

/** Décode la réponse 0x51 (Channel ID) : n° de canal, n° d'appareil, type, transmission. */
export function parseChannelIdResponse(msg: AntMessage): AntChannelId & { channel: number } {
  const r = new ByteReader(msg.payload);
  const channel = r.u8();
  const deviceNumber = r.u16();
  const dt = r.u8();
  return { channel, deviceNumber, deviceType: dt & 0x7f, pairing: (dt & 0x80) !== 0, transmissionType: r.u8() };
}

/**
 * Lit la clé réseau ANT+ depuis la configuration (jamais depuis le code) :
 * accepte « 0011223344556677 », « 00 11 22 … » ou « 0x00,0x11,… ». Renvoie undefined si absente.
 * (Valeurs fictives : exemples de FORMAT uniquement.)
 */
export function parseAntNetworkKey(text: string | undefined | null): Uint8Array | undefined {
  if (text === undefined || text === null || text.trim() === '') return undefined;
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length !== 16) throw new ProtocolError('La clé réseau ANT doit comporter exactement 8 octets (16 chiffres hexadécimaux)');
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Nom de la variable d'environnement attendue pour la clé ANT+. */
export const ANT_PLUS_NETWORK_KEY_ENV = 'ANT_PLUS_NETWORK_KEY';
