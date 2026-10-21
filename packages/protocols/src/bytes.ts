/**
 * Outils de lecture/écriture d'octets, sans dépendance.
 * Bluetooth SIG (GATT) : entiers en little-endian (Core Spec Vol 3, Part G, §3.3.3 ; GSS §2.2).
 * ANT : little-endian également (ANT Message Protocol and Usage, §7.1).
 * Direct Connect : la longueur d'en-tête est en big-endian (voir dircon.ts).
 */

export type ByteSource = Uint8Array | ArrayBuffer | DataView | ArrayLike<number>;

/** Erreur de décodage : trame trop courte, opcode inconnu, somme de contrôle fausse… */
export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

/** Convertit n'importe quelle source d'octets en Uint8Array (sans copie si possible). */
export function toBytes(data: ByteSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Uint8Array.from(data);
}

/** Représentation hexadécimale « a4 09 4e … » (journaux, tests). */
export function toHex(data: ByteSource): string {
  return Array.from(toBytes(data), (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Lit une chaîne hexadécimale (« A4094E », « a4 09 4e », « 0xA4,0x09 »). */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) throw new ProtocolError(`Hexadécimal de longueur impaire : "${text}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Lecteur séquentiel little-endian ; lève ProtocolError si la trame est trop courte. */
export class ByteReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  offset = 0;

  constructor(data: ByteSource) {
    this.bytes = toBytes(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(n: number, what: string): void {
    if (this.remaining < n) {
      throw new ProtocolError(`Trame trop courte : ${what} attend ${n} octet(s) à l'offset ${this.offset}, il en reste ${this.remaining}`);
    }
  }

  u8(): number {
    this.need(1, 'uint8');
    return this.view.getUint8(this.offset++);
  }
  s8(): number {
    this.need(1, 'sint8');
    return this.view.getInt8(this.offset++);
  }
  u16(): number {
    this.need(2, 'uint16');
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  s16(): number {
    this.need(2, 'sint16');
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u16be(): number {
    this.need(2, 'uint16 BE');
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }
  u24(): number {
    this.need(3, 'uint24');
    const v = this.view.getUint16(this.offset, true) | (this.view.getUint8(this.offset + 2) << 16);
    this.offset += 3;
    return v;
  }
  u32(): number {
    this.need(4, 'uint32');
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  bytesN(n: number): Uint8Array {
    this.need(n, `${n} octets`);
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  rest(): Uint8Array {
    return this.bytesN(this.remaining);
  }
  /** Chaîne UTF-8 (caractéristiques Device Information, Training Status). */
  utf8(n = this.remaining): string {
    return decodeUtf8(this.bytesN(n));
  }
}

/** Écrivain séquentiel little-endian. Les valeurs sont arrondies et bornées au type. */
export class ByteWriter {
  private readonly out: number[] = [];

  u8(v: number): this {
    this.out.push(clamp(Math.round(v), 0, 0xff));
    return this;
  }
  s8(v: number): this {
    this.out.push(clamp(Math.round(v), -128, 127) & 0xff);
    return this;
  }
  u16(v: number): this {
    const x = clamp(Math.round(v), 0, 0xffff);
    this.out.push(x & 0xff, (x >> 8) & 0xff);
    return this;
  }
  s16(v: number): this {
    const x = clamp(Math.round(v), -32768, 32767) & 0xffff;
    this.out.push(x & 0xff, (x >> 8) & 0xff);
    return this;
  }
  u16be(v: number): this {
    const x = clamp(Math.round(v), 0, 0xffff);
    this.out.push((x >> 8) & 0xff, x & 0xff);
    return this;
  }
  u24(v: number): this {
    const x = clamp(Math.round(v), 0, 0xffffff);
    this.out.push(x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff);
    return this;
  }
  u32(v: number): this {
    const x = clamp(Math.round(v), 0, 0xffffffff);
    this.out.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff);
    return this;
  }
  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.out.push((bytes[i] ?? 0) & 0xff);
    return this;
  }
  get length(): number {
    return this.out.length;
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  // Les chaînes GATT peuvent être terminées par des zéros : on les retire.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder('utf-8').decode(bytes.subarray(0, end));
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function startsWith(data: ArrayLike<number>, prefix: ArrayLike<number>): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}
