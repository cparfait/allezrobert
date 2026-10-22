/**
 * EXPÉRIMENTAL — désactivé par défaut. Mode chiffré « Zap » des anciens firmwares Zwift Play / Click.
 *
 * Réimplémentation d'après la description publique de Makinolo (« Connecting to Zwift Play controllers »,
 * 2023) et les notes d'ajchellew/zwiftplay ; aucun code copié. Aucune clé du constructeur n'intervient :
 * c'est un échange Diffie-Hellman éphémère que la manette accepte de n'importe quel hôte ; le jeu y est
 * simplement l'une des deux extrémités. Les firmwares récents (mis à jour par Zwift Companion) répondent
 * en clair et n'en ont plus besoin : la stratégie détecte ce cas et laisse passer les trames.
 *
 *   1. hôte → SyncRx : « RideOn » + 01 02 + clé publique P-256 de l'hôte (64 octets X‖Y, sans le 0x04) ;
 *   2. SyncTx → hôte : « RideOn » + 2 octets + clé publique de la manette (64 octets) ;
 *   3. secret = ECDH(P-256) ; HKDF-SHA-256(ikm = secret, sel = cléManette ‖ cléHôte, info vide, 36 octets) :
 *      octets 0–31 = clé AES-256, octets 32–35 = début du nonce ;
 *   4. chaque trame : compteur (4 octets, tels que reçus) ‖ chiffré ‖ étiquette (4 octets),
 *      AES-256-CCM, nonce (8 octets) = nonce HKDF ‖ compteur ; le clair est [type][protobuf] comme en mode clair.
 *
 * Non vérifié sur matériel (aucune capture publique avec ses clés) : seule la cohérence des deux côtés et
 * l'implémentation CCM (vecteurs RFC 3610) sont testées. Le secret ECDH est pris sur 32 octets (forme
 * standard) ; une implémentation de référence le tronquait s'il commençait par 0x00 (1 cas sur 256).
 */
import { startsWith, toBytes, type ByteSource } from '../bytes.ts';
import { ccmDecrypt, ccmEncrypt } from './aes.ts';
import { ZWIFT_RIDE_ON, parseZwiftHandshakeResponse, type ZwiftUnlockStrategy } from './zwift-controllers.ts';

export const ZWIFT_ZAP = {
  /** Octets après « RideOn » dans la requête de l'hôte. */
  requestStart: Uint8Array.of(0x01, 0x02),
  keyLength: 32,
  hkdfLength: 36,
  tagLength: 4,
  counterLength: 4,
} as const;

export interface ZapSession {
  /** Clé AES-256. */
  key: Uint8Array;
  /** 4 octets de tête du nonce. */
  iv: Uint8Array;
}

function owned(data: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  out.set(Array.from(data));
  return out;
}

/** Trame de poignée de main de l'hôte. */
export function buildZapHandshake(localPublicKey: ByteSource): Uint8Array {
  const k = toBytes(localPublicKey);
  if (k.length !== 64) throw new Error('Zap : clé publique de 64 octets attendue (X‖Y)');
  const out = new Uint8Array(ZWIFT_RIDE_ON.length + 2 + 64);
  out.set(ZWIFT_RIDE_ON);
  out.set(ZWIFT_ZAP.requestStart, ZWIFT_RIDE_ON.length);
  out.set(k, ZWIFT_RIDE_ON.length + 2);
  return out;
}

/** Découpe la sortie HKDF (36 octets) en clé + début de nonce. */
export function zapSessionFromHkdf(okm: ByteSource): ZapSession {
  const b = toBytes(okm);
  if (b.length !== ZWIFT_ZAP.hkdfLength) throw new Error('Zap : 36 octets HKDF attendus');
  return { key: b.slice(0, ZWIFT_ZAP.keyLength), iv: b.slice(ZWIFT_ZAP.keyLength) };
}

function nonceFor(session: ZapSession, counter: Uint8Array): Uint8Array {
  const n = new Uint8Array(8);
  n.set(session.iv);
  n.set(counter, 4);
  return n;
}

/** Déchiffre une trame `compteur ‖ chiffré ‖ étiquette`. Lève une erreur si l'étiquette est fausse. */
export function decryptZapFrame(session: ZapSession, frame: ByteSource): { counter: number; plaintext: Uint8Array } {
  const b = toBytes(frame);
  if (b.length < ZWIFT_ZAP.counterLength + ZWIFT_ZAP.tagLength) throw new Error('Zap : trame trop courte');
  const counterBytes = b.subarray(0, ZWIFT_ZAP.counterLength);
  const plaintext = ccmDecrypt(session.key, nonceFor(session, counterBytes), b.subarray(ZWIFT_ZAP.counterLength), { tagLength: ZWIFT_ZAP.tagLength });
  const counter = (counterBytes[0]! | (counterBytes[1]! << 8) | (counterBytes[2]! << 16)) + counterBytes[3]! * 0x1000000;
  return { counter, plaintext };
}

/** Chiffre une trame (côté appareil : simulateur et tests). Compteur petit-boutiste sur le fil. */
export function encryptZapFrame(session: ZapSession, counter: number, plaintext: ByteSource): Uint8Array {
  const c = Uint8Array.of(counter & 0xff, (counter >>> 8) & 0xff, (counter >>> 16) & 0xff, (counter >>> 24) & 0xff);
  const sealed = ccmEncrypt(session.key, nonceFor(session, c), toBytes(plaintext), { tagLength: ZWIFT_ZAP.tagLength });
  const out = new Uint8Array(4 + sealed.length);
  out.set(c);
  out.set(sealed, 4);
  return out;
}

/** HKDF de la session à partir du secret ECDH brut (32 octets). */
export async function deriveZapSessionFromSecret(subtle: SubtleCrypto, sharedSecret: ByteSource, devicePublicKey: ByteSource, localPublicKey: ByteSource): Promise<ZapSession> {
  const salt = new Uint8Array(128);
  salt.set(toBytes(devicePublicKey));
  salt.set(toBytes(localPublicKey), 64);
  const ikm = await subtle.importKey('raw', owned(toBytes(sharedSecret)), 'HKDF', false, ['deriveBits']);
  const okm = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new Uint8Array(0) }, ikm, ZWIFT_ZAP.hkdfLength * 8);
  return zapSessionFromHkdf(new Uint8Array(okm));
}

/** Paire de clés P-256 éphémère et sa clé publique au format Zap (64 octets). */
export async function generateZapKeyPair(subtle: SubtleCrypto): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: raw.slice(1) };
}

/** Secret ECDH (32 octets) entre notre clé privée et une clé publique Zap (64 octets). */
export async function zapSharedSecret(subtle: SubtleCrypto, privateKey: CryptoKey, peerPublicKey: ByteSource): Promise<Uint8Array> {
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(toBytes(peerPublicKey), 1);
  const peer = await subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
}

export interface ZapUnlockStrategy extends ZwiftUnlockStrategy {
  /** 'pending' avant la réponse, 'encrypted' si la manette a envoyé sa clé, 'plain' sinon (firmware récent). */
  readonly mode: 'pending' | 'encrypted' | 'plain';
}

/**
 * Stratégie « Zap » : envoie notre clé publique ; si la manette répond avec la sienne, déchiffre les
 * notifications suivantes ; sinon (firmware récent) les laisse passer en clair.
 */
export function createZapUnlockStrategy(options: { subtle?: SubtleCrypto } = {}): ZapUnlockStrategy {
  const subtle = options.subtle ?? (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  let pair: { privateKey: CryptoKey; publicKey: Uint8Array } | undefined;
  let session: ZapSession | undefined;
  let mode: ZapUnlockStrategy['mode'] = 'pending';
  return {
    name: 'zap-ecdh',
    get mode() {
      return mode;
    },
    async handshake() {
      if (!subtle) throw new Error('Zap : WebCrypto (crypto.subtle) indisponible');
      pair = await generateZapKeyPair(subtle);
      session = undefined;
      mode = 'pending';
      return [buildZapHandshake(pair.publicKey)];
    },
    async onHandshakeResponse(data) {
      const r = parseZwiftHandshakeResponse(data);
      if (!r) return;
      if (!r.devicePublicKey || !pair || !subtle) {
        mode = 'plain';
        return;
      }
      const secret = await zapSharedSecret(subtle, pair.privateKey, r.devicePublicKey);
      session = await deriveZapSessionFromSecret(subtle, secret, r.devicePublicKey, pair.publicKey);
      mode = 'encrypted';
    },
    decrypt(data) {
      if (!session || startsWith(data, ZWIFT_RIDE_ON)) return data;
      return decryptZapFrame(session, data).plaintext;
    },
  };
}
