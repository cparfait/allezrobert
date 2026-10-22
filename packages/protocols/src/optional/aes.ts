/**
 * Primitives AES minimalistes, synchrones et sans dépendance : chiffrement d'un bloc (FIPS-197),
 * CTR, CMAC (RFC 4493 / NIST SP 800-38B), EAX (Bellare-Rogaway-Wagner) et CCM (RFC 3610 / SP 800-38C).
 *
 * Pourquoi pas WebCrypto ? Il n'expose ni AES-ECB, ni CMAC, ni EAX, ni CCM, et il est asynchrone :
 * or les notifications BLE se déchiffrent au fil de l'eau. Ces modes standard n'ont besoin que du
 * chiffrement direct d'un bloc. Code écrit d'après les normes publiques, validé par leurs vecteurs de test.
 *
 * Usage : uniquement pour parler à des appareils dont l'utilisateur est propriétaire (manettes Zwift
 * à l'ancien firmware chiffré, SRAM AXS après appairage physique). Pas une bibliothèque de sécurité
 * générale : aucune protection contre les attaques temporelles côté processeur.
 */
import { ProtocolError } from '../bytes.ts';

// --- Tables -------------------------------------------------------------------------------

const SBOX = new Uint8Array(256);
(() => {
  // Génération classique : p parcourt le groupe multiplicatif (×3), q son inverse (÷3).
  let p = 1;
  let q = 1;
  const rotl = (x: number, s: number) => ((x << s) | (x >>> (8 - s))) & 0xff;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

// --- Chiffrement d'un bloc ----------------------------------------------------------------

/** Clé AES préparée (128, 192 ou 256 bits). Seul le sens « chiffrement » est fourni. */
export class AesKey {
  private readonly rounds: number;
  private readonly rk: Uint8Array;

  constructor(key: Uint8Array) {
    const nk = key.length / 4;
    if (nk !== 4 && nk !== 6 && nk !== 8) throw new ProtocolError(`Clé AES de ${key.length} octets invalide`);
    this.rounds = nk + 6;
    const words = 4 * (this.rounds + 1);
    const w = new Uint8Array(words * 4);
    w.set(key);
    const t = new Uint8Array(4);
    for (let i = nk; i < words; i++) {
      for (let j = 0; j < 4; j++) t[j] = w[(i - 1) * 4 + j]!;
      if (i % nk === 0) {
        const t0 = t[0]!;
        t[0] = SBOX[t[1]!]! ^ RCON[i / nk - 1]!;
        t[1] = SBOX[t[2]!]!;
        t[2] = SBOX[t[3]!]!;
        t[3] = SBOX[t0]!;
      } else if (nk > 6 && i % nk === 4) {
        for (let j = 0; j < 4; j++) t[j] = SBOX[t[j]!]!;
      }
      for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j]! ^ t[j]!;
    }
    this.rk = w;
  }

  /** Chiffre un bloc de 16 octets. */
  encryptBlock(input: Uint8Array): Uint8Array {
    if (input.length !== 16) throw new ProtocolError('Bloc AES de 16 octets attendu');
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = input[i]! ^ this.rk[i]!;
    const tmp = new Uint8Array(16);
    for (let round = 1; round <= this.rounds; round++) {
      // SubBytes + ShiftRows (état en colonnes : octet r + 4c).
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) tmp[r + 4 * c] = SBOX[s[r + 4 * ((c + r) % 4)]!]!;
      if (round < this.rounds) {
        for (let c = 0; c < 4; c++) {
          const a0 = tmp[4 * c]!;
          const a1 = tmp[4 * c + 1]!;
          const a2 = tmp[4 * c + 2]!;
          const a3 = tmp[4 * c + 3]!;
          const x = a0 ^ a1 ^ a2 ^ a3;
          s[4 * c] = a0 ^ x ^ xtime(a0 ^ a1);
          s[4 * c + 1] = a1 ^ x ^ xtime(a1 ^ a2);
          s[4 * c + 2] = a2 ^ x ^ xtime(a2 ^ a3);
          s[4 * c + 3] = a3 ^ x ^ xtime(a3 ^ a0);
        }
      } else {
        s.set(tmp);
      }
      const off = 16 * round;
      for (let i = 0; i < 16; i++) s[i] = s[i]! ^ this.rk[off + i]!;
    }
    return s;
  }
}

function asKey(key: Uint8Array | AesKey): AesKey {
  return key instanceof AesKey ? key : new AesKey(key);
}

function xorInto(dst: Uint8Array, src: Uint8Array, offset = 0): void {
  for (let i = 0; i < src.length && offset + i < dst.length; i++) dst[offset + i] = dst[offset + i]! ^ src[i]!;
}

/** Comparaison sans court-circuit (taille comprise). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// --- CTR ----------------------------------------------------------------------------------

/** AES-CTR, compteur de 128 bits gros-boutiste incrémenté à chaque bloc (chiffrer = déchiffrer). */
export function aesCtr(key: Uint8Array | AesKey, initialCounter: Uint8Array, data: Uint8Array): Uint8Array {
  const k = asKey(key);
  const ctr = Uint8Array.from(initialCounter);
  const out = Uint8Array.from(data);
  for (let off = 0; off < out.length; off += 16) {
    xorInto(out, k.encryptBlock(ctr).subarray(0, Math.min(16, out.length - off)), off);
    for (let i = 15; i >= 0; i--) {
      ctr[i] = (ctr[i]! + 1) & 0xff;
      if (ctr[i] !== 0) break;
    }
  }
  return out;
}

// --- CMAC ---------------------------------------------------------------------------------

function dbl(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const b = block[i]!;
    out[i] = ((b << 1) | carry) & 0xff;
    carry = b >>> 7;
  }
  if (carry) out[15] = out[15]! ^ 0x87;
  return out;
}

/** AES-CMAC (RFC 4493), étiquette de 16 octets. */
export function aesCmac(key: Uint8Array | AesKey, message: Uint8Array): Uint8Array {
  const k = asKey(key);
  const k1 = dbl(k.encryptBlock(new Uint8Array(16)));
  const k2 = dbl(k1);
  const n = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  let x: Uint8Array = new Uint8Array(16);
  for (let i = 0; i < n; i++) {
    const block = new Uint8Array(16);
    const chunk = message.subarray(i * 16, i * 16 + 16);
    block.set(chunk);
    if (i === n - 1) {
      if (complete) xorInto(block, k1);
      else {
        block[chunk.length] = 0x80;
        xorInto(block, k2);
      }
    }
    xorInto(block, x);
    x = k.encryptBlock(block);
  }
  return x;
}

// --- EAX ----------------------------------------------------------------------------------

function omac(k: AesKey, t: number, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(16 + data.length);
  buf[15] = t;
  buf.set(data, 16);
  return aesCmac(k, buf);
}

export interface EaxOptions {
  /** Données associées (en clair, authentifiées). Vide par défaut. */
  header?: Uint8Array;
  /** Longueur de l'étiquette (1 à 16 octets). 16 par défaut. */
  tagLength?: number;
}

/** AES-EAX : renvoie `chiffré ‖ étiquette`. */
export function eaxEncrypt(key: Uint8Array | AesKey, nonce: Uint8Array, plaintext: Uint8Array, options: EaxOptions = {}): Uint8Array {
  const k = asKey(key);
  const tagLength = options.tagLength ?? 16;
  const n = omac(k, 0, nonce);
  const h = omac(k, 1, options.header ?? new Uint8Array(0));
  const c = aesCtr(k, n, plaintext);
  const tag = omac(k, 2, c);
  xorInto(tag, n);
  xorInto(tag, h);
  const out = new Uint8Array(c.length + tagLength);
  out.set(c);
  out.set(tag.subarray(0, tagLength), c.length);
  return out;
}

/** AES-EAX : `sealed` = `chiffré ‖ étiquette`. Lève ProtocolError si l'étiquette est fausse. */
export function eaxDecrypt(key: Uint8Array | AesKey, nonce: Uint8Array, sealed: Uint8Array, options: EaxOptions = {}): Uint8Array {
  const k = asKey(key);
  const tagLength = options.tagLength ?? 16;
  if (sealed.length < tagLength) throw new ProtocolError('EAX : message plus court que l’étiquette');
  const c = sealed.subarray(0, sealed.length - tagLength);
  const n = omac(k, 0, nonce);
  const h = omac(k, 1, options.header ?? new Uint8Array(0));
  const tag = omac(k, 2, c);
  xorInto(tag, n);
  xorInto(tag, h);
  if (!constantTimeEqual(tag.subarray(0, tagLength), sealed.subarray(c.length))) throw new ProtocolError('EAX : étiquette invalide');
  return aesCtr(k, n, c);
}

// --- CCM ----------------------------------------------------------------------------------

export interface CcmOptions {
  /** Longueur de l'étiquette M (4, 6, 8, 10, 12, 14 ou 16). */
  tagLength: number;
  /** Données associées (en clair, authentifiées). */
  aad?: Uint8Array;
}

function ccmCheck(nonce: Uint8Array, tagLength: number): number {
  if (nonce.length < 7 || nonce.length > 13) throw new ProtocolError('CCM : nonce de 7 à 13 octets attendu');
  if (tagLength < 4 || tagLength > 16 || tagLength % 2) throw new ProtocolError('CCM : longueur d’étiquette invalide');
  return 15 - nonce.length; // L
}

function ccmCounter(nonce: Uint8Array, l: number, i: number): Uint8Array {
  const a = new Uint8Array(16);
  a[0] = l - 1;
  a.set(nonce, 1);
  let v = i;
  for (let j = 15; j > nonce.length && v > 0; j--) {
    a[j] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return a;
}

function ccmMac(k: AesKey, nonce: Uint8Array, l: number, tagLength: number, aad: Uint8Array, msg: Uint8Array): Uint8Array {
  const b0 = new Uint8Array(16);
  b0[0] = (aad.length > 0 ? 0x40 : 0) | (((tagLength - 2) / 2) << 3) | (l - 1);
  b0.set(nonce, 1);
  let len = msg.length;
  for (let j = 15; j > nonce.length; j--) {
    b0[j] = len & 0xff;
    len = Math.floor(len / 256);
  }
  if (len > 0) throw new ProtocolError('CCM : message trop long pour ce nonce');
  let x = k.encryptBlock(b0);
  const feed = (data: Uint8Array) => {
    for (let off = 0; off < data.length; off += 16) {
      const block = new Uint8Array(16);
      block.set(data.subarray(off, off + 16));
      xorInto(block, x);
      x = k.encryptBlock(block);
    }
  };
  if (aad.length > 0) {
    if (aad.length >= 0xff00) throw new ProtocolError('CCM : données associées trop longues');
    const a = new Uint8Array(2 + aad.length);
    a[0] = aad.length >>> 8;
    a[1] = aad.length & 0xff;
    a.set(aad, 2);
    feed(a);
  }
  feed(msg);
  return x.subarray(0, tagLength);
}

/** AES-CCM : renvoie `chiffré ‖ étiquette`. */
export function ccmEncrypt(key: Uint8Array | AesKey, nonce: Uint8Array, plaintext: Uint8Array, options: CcmOptions): Uint8Array {
  const k = asKey(key);
  const l = ccmCheck(nonce, options.tagLength);
  const t = ccmMac(k, nonce, l, options.tagLength, options.aad ?? new Uint8Array(0), plaintext);
  const s0 = k.encryptBlock(ccmCounter(nonce, l, 0));
  const out = new Uint8Array(plaintext.length + options.tagLength);
  out.set(aesCtr(k, ccmCounter(nonce, l, 1), plaintext));
  const tag = Uint8Array.from(t);
  xorInto(tag, s0);
  out.set(tag, plaintext.length);
  return out;
}

/** AES-CCM : `sealed` = `chiffré ‖ étiquette`. Lève ProtocolError si l'étiquette est fausse. */
export function ccmDecrypt(key: Uint8Array | AesKey, nonce: Uint8Array, sealed: Uint8Array, options: CcmOptions): Uint8Array {
  const k = asKey(key);
  const l = ccmCheck(nonce, options.tagLength);
  if (sealed.length < options.tagLength) throw new ProtocolError('CCM : message plus court que l’étiquette');
  const c = sealed.subarray(0, sealed.length - options.tagLength);
  const plaintext = aesCtr(k, ccmCounter(nonce, l, 1), c);
  const t = Uint8Array.from(ccmMac(k, nonce, l, options.tagLength, options.aad ?? new Uint8Array(0), plaintext));
  xorInto(t, k.encryptBlock(ccmCounter(nonce, l, 0)));
  if (!constantTimeEqual(t, sealed.subarray(c.length))) throw new ProtocolError('CCM : étiquette invalide');
  return plaintext;
}
