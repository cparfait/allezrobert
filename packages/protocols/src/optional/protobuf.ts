/**
 * Lecteur protobuf minimal (varint, longueur délimitée, zigzag) — suffisant pour les messages
 * des manettes Zwift, sans dépendance. EXPÉRIMENTAL (voir optional/index.ts).
 */
import { ProtocolError } from '../bytes.ts';

export interface ProtoField {
  field: number;
  wireType: number;
  /** Valeur varint (wireType 0) ou fixe 32/64 bits (approx. number). */
  value?: number;
  /** Octets bruts (wireType 2). */
  bytes?: Uint8Array;
}

export function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let mul = 1;
  let i = offset;
  for (let n = 0; n < 10; n++) {
    if (i >= buf.length) throw new ProtocolError('Varint protobuf tronqué');
    const b = buf[i++] ?? 0;
    value += (b & 0x7f) * mul;
    if ((b & 0x80) === 0) return { value, next: i };
    mul *= 128;
  }
  throw new ProtocolError('Varint protobuf trop long');
}

export function zigzagDecode(n: number): number {
  // Valable jusqu'à 2^53 : (n >>> 1) ^ -(n & 1) en arithmétique flottante.
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

export function zigzagEncode(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

export function writeVarint(value: number, out: number[] = []): number[] {
  let v = Math.floor(value);
  if (v < 0) throw new ProtocolError('Varint négatif non géré');
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

export function parseProtobuf(buf: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let i = 0;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    i = key.next;
    const field = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    switch (wireType) {
      case 0: {
        const v = readVarint(buf, i);
        i = v.next;
        out.push({ field, wireType, value: v.value });
        break;
      }
      case 1:
        if (i + 8 > buf.length) throw new ProtocolError('Champ 64 bits tronqué');
        out.push({ field, wireType, bytes: buf.subarray(i, i + 8) });
        i += 8;
        break;
      case 2: {
        const len = readVarint(buf, i);
        i = len.next;
        if (i + len.value > buf.length) throw new ProtocolError('Champ protobuf délimité tronqué');
        out.push({ field, wireType, bytes: buf.subarray(i, i + len.value) });
        i += len.value;
        break;
      }
      case 5:
        if (i + 4 > buf.length) throw new ProtocolError('Champ 32 bits tronqué');
        out.push({ field, wireType, bytes: buf.subarray(i, i + 4) });
        i += 4;
        break;
      default:
        throw new ProtocolError(`Type de fil protobuf non géré : ${wireType}`);
    }
  }
  return out;
}
