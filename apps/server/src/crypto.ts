/**
 * Chiffrement applicatif des données sensibles au repos (FC, fichiers FIT, jetons Strava,
 * clé API intervals.icu) : AES-256-GCM, clé fournie par l'environnement (DATA_ENCRYPTION_KEY),
 * jamais stockée en base. Format : [version 1 octet][IV 12 octets][tag 16 octets][chiffré].
 *
 * Choix applicatif plutôt que pgcrypto : la clé ne transite jamais dans les requêtes SQL
 * (donc ni dans les journaux PostgreSQL ni dans les sauvegardes pg_dump), et les sauvegardes
 * restent chiffrées.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;

export class DataCipher {
  private readonly key: Buffer;
  private readonly hashKey: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('Clé de chiffrement : 32 octets attendus');
    this.key = key;
    // Clé dérivée distincte pour le hachage des e-mails (HKDF-SHA256).
    this.hashKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'allezrobert:email-hash', 32));
  }

  encrypt(plain: Uint8Array | string, aad = ''): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const data = typeof plain === 'string' ? Buffer.from(plain, 'utf8') : Buffer.from(plain);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
  }

  decrypt(blob: Uint8Array, aad = ''): Buffer {
    const b = Buffer.from(blob);
    if (b.length < 29 || b[0] !== VERSION) throw new Error('Donnée chiffrée invalide');
    const iv = b.subarray(1, 13);
    const tag = b.subarray(13, 29);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]);
  }

  encryptJson(value: unknown, aad = ''): Buffer {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T>(blob: Uint8Array, aad = ''): T {
    return JSON.parse(this.decrypt(blob, aad).toString('utf8')) as T;
  }

  /** Empreinte HMAC d'un e-mail normalisé : l'e-mail en clair n'est jamais stocké. */
  emailHash(email: string): string {
    return createHmac('sha256', this.hashKey).update(normalizeEmail(email)).digest('base64url');
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Identifiant aléatoire URL-safe. */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}
