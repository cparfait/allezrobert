/**
 * Encodeur FIT bas niveau (protocole 2.0, petit-boutiste) : en-tête de 14 octets avec CRC,
 * messages de définition / données à types locaux, CRC final.
 * Référence : « FIT Protocol » (developer.garmin.com/fit/protocol).
 */

/** Types de base FIT : identifiant, taille, valeur invalide. */
export const BaseType = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  sint8: { id: 0x01, size: 1, invalid: 0x7f },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  sint16: { id: 0x83, size: 2, invalid: 0x7fff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  string: { id: 0x07, size: 1, invalid: 0 },
  uint8z: { id: 0x0a, size: 1, invalid: 0 },
  uint16z: { id: 0x8b, size: 2, invalid: 0 },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
} as const;

export type BaseTypeName = keyof typeof BaseType;

/** Définition d'un champ : numéro, type de base, échelle/décalage (valeur = brut/échelle − décalage). */
export interface FieldDef {
  num: number;
  type: BaseTypeName;
  scale?: number;
  offset?: number;
  /** Taille en octets pour les chaînes (terminateur nul compris). */
  size?: number;
}

export interface MessageDef {
  globalNum: number;
  fields: FieldDef[];
}

/** Valeur de champ : nombre (unités physiques), chaîne, ou absente (écrite invalide). */
export type FieldValue = number | string | undefined | null;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** CRC-16 FIT (algorithme Garmin par quartets). */
export function fitCrc(data: Uint8Array, start = 0, end = data.length, crc = 0): number {
  for (let i = start; i < end; i++) {
    const byte = data[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

/** Époque FIT : 1989-12-31T00:00:00Z, en secondes Unix. */
export const FIT_EPOCH_S = 631065600;

/** Horodatage FIT (s depuis l'époque FIT) depuis un epoch ms. */
export function toFitTimestamp(epochMs: number): number {
  return Math.floor(epochMs / 1000) - FIT_EPOCH_S;
}

/** Degrés → semicercles (sint32). */
export function toSemicircles(deg: number): number {
  return Math.round(deg * (2147483648 / 180));
}

const utf8 = new TextEncoder();

class ByteWriter {
  buf = new Uint8Array(4096);
  view = new DataView(this.buf.buffer);
  length = 0;

  ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
}

function clampRaw(raw: number, type: BaseTypeName): number {
  switch (type) {
    case 'sint8':
      return Math.min(Math.max(raw, -127), 126);
    case 'sint16':
      return Math.min(Math.max(raw, -32767), 32766);
    case 'sint32':
      return Math.min(Math.max(raw, -2147483647), 2147483646);
    case 'uint8':
    case 'enum':
      return Math.min(Math.max(raw, 0), 254);
    case 'uint16':
      return Math.min(Math.max(raw, 0), 65534);
    case 'uint32':
      return Math.min(Math.max(raw, 0), 4294967294);
    case 'uint8z':
      return Math.min(Math.max(raw, 1), 255);
    case 'uint16z':
      return Math.min(Math.max(raw, 1), 65535);
    case 'uint32z':
      return Math.min(Math.max(raw, 1), 4294967295);
    default:
      return raw;
  }
}

/** Écrit des messages FIT ; `finish()` produit le fichier complet. */
export class FitWriter {
  private readonly w = new ByteWriter();
  private readonly defs: Array<MessageDef | undefined> = [];

  /** Écrit un message de définition pour le type local (0–15). */
  define(localType: number, def: MessageDef): void {
    const w = this.w;
    w.u8(0x40 | (localType & 0x0f));
    w.u8(0); // réservé
    w.u8(0); // architecture : petit-boutiste
    w.u16(def.globalNum);
    w.u8(def.fields.length);
    for (const f of def.fields) {
      const bt = BaseType[f.type];
      w.u8(f.num);
      w.u8(f.type === 'string' ? (f.size ?? 16) : bt.size);
      w.u8(bt.id);
    }
    this.defs[localType] = def;
  }

  /** Écrit un message de données (valeurs dans l'ordre des champs de la définition). */
  write(localType: number, values: readonly FieldValue[]): void {
    const def = this.defs[localType];
    if (!def) throw new Error(`FIT : type local ${localType} non défini`);
    const w = this.w;
    w.u8(localType & 0x0f);
    for (let i = 0; i < def.fields.length; i++) {
      const f = def.fields[i]!;
      const v = values[i];
      const bt = BaseType[f.type];
      if (f.type === 'string') {
        const size = f.size ?? 16;
        w.ensure(size);
        const bytes = typeof v === 'string' ? utf8.encode(v) : new Uint8Array(0);
        // Tronque sans couper un caractère UTF-8, garde le terminateur nul.
        let n = Math.min(bytes.length, size - 1);
        while (n > 0 && n < bytes.length && (bytes[n]! & 0xc0) === 0x80) n--;
        w.buf.set(bytes.subarray(0, n), w.length);
        w.buf.fill(0, w.length + n, w.length + size);
        w.length += size;
        continue;
      }
      let raw: number = bt.invalid;
      if (typeof v === 'number' && Number.isFinite(v)) {
        raw = clampRaw(Math.round((v + (f.offset ?? 0)) * (f.scale ?? 1)), f.type);
      }
      w.ensure(bt.size);
      switch (bt.size) {
        case 1:
          w.view.setUint8(w.length, raw & 0xff);
          break;
        case 2:
          if (f.type === 'sint16') w.view.setInt16(w.length, raw, true);
          else w.view.setUint16(w.length, raw, true);
          break;
        default:
          if (f.type === 'sint32') w.view.setInt32(w.length, raw, true);
          else w.view.setUint32(w.length, raw >>> 0, true);
      }
      w.length += bt.size;
    }
  }

  /** Assemble en-tête (14 octets, CRC), données et CRC final. */
  finish(profileVersion = 2132): Uint8Array {
    const dataSize = this.w.length;
    const out = new Uint8Array(14 + dataSize + 2);
    const dv = new DataView(out.buffer);
    out[0] = 14;
    out[1] = 0x20; // protocole 2.0
    dv.setUint16(2, profileVersion, true);
    dv.setUint32(4, dataSize, true);
    out[8] = 0x2e; // ".FIT"
    out[9] = 0x46;
    out[10] = 0x49;
    out[11] = 0x54;
    dv.setUint16(12, fitCrc(out, 0, 12), true);
    out.set(this.w.buf.subarray(0, dataSize), 14);
    dv.setUint16(14 + dataSize, fitCrc(out, 0, 14 + dataSize), true);
    return out;
  }
}
