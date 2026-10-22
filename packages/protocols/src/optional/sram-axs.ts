/**
 * EXPÉRIMENTAL — désactivé par défaut. SRAM AXS en Bluetooth (dérailleur arrière = « primaire » AXS).
 *
 * Réimplémentation indépendante d'après deux descriptions publiques (aucun code copié) :
 *   - tarekrached/esphome-sram-axs, docs/protocol.md + facts.yaml (MIT) : annonces BLE (batterie) ;
 *   - GaborWnuk/sram-axs, PROTOCOL.md (MPL-2.0) : caractéristiques en clair, appairage « SRAMBond v1 »
 *     hors ligne, état chiffré AES-EAX → rapport engagé. Vecteurs de test : exemple publié et capture réelle
 *     d'un RD-GX-E-B1 (numéro de série remplacé par 1234567890 par l'auteur).
 *   - BikeControl, ticket #234 : notification 0xFF à chaque appui sur d9050054 (identité du bouton chiffrée).
 *
 * Ce qu'il faut savoir :
 *   - le passage des vitesses circule sur la radio propriétaire AIREA, jamais en BLE : on LIT l'état ;
 *   - le rapport engagé est chiffré (d905000b) avec une clé propre à chaque composant, générée par
 *     lui et transmise une fois, chiffrée par Diffie-Hellman, pendant l'appairage. L'appairage n'aboutit
 *     que si le cycliste MAINTIENT le bouton AXS du composant (possession physique). Aucune clé du
 *     constructeur, aucun serveur : c'est la même procédure que l'appli SRAM AXS ;
 *   - chaque nouvel appairage renouvelle la clé : l'appli officielle se ré-appaire seule ensuite ;
 *   - ne JAMAIS écrire sur le service Nordic DFU 0xFE59 (redémarre le composant en chargeur d'amorçage).
 *
 * NON IMPLÉMENTÉ : identité du bouton pressé (lecture chiffrée de d9050054, format non publié),
 * SRAMBond v2 (ee58–ee5b, non décrit), reconnexion « greet » (défi/réponse non décrit), écriture de réglages.
 */
import { ProtocolError, decodeUtf8, toBytes, type ByteSource } from '../bytes.ts';
import { eaxDecrypt } from './aes.ts';
import { parseProtobuf, type ProtoField } from './protobuf.ts';

const SRAM_SUFFIX = '-90aa-4c7c-b036-1e01fb8eb7ee';
/** UUID 128 bits de la famille SRAM à partir de sa forme courte (« 000b » → d905000b-…). */
export const sramAxsUuid = (short: string): string => `d905${short.toLowerCase()}${SRAM_SUFFIX}`;

export const SRAM_AXS = {
  /** Identifiant fabricant Bluetooth SIG de SRAM LLC. */
  manufacturerId: 0x0933,
  /** Service 16 bits « membre SIG » de SRAM (données de service des annonces). */
  memberService: '0000fe51-0000-1000-8000-00805f9b34fb',
  /** Service Nordic DFU : ne jamais écrire dessus. */
  dfuService: '0000fe59-0000-1000-8000-00805f9b34fb',
  /** Service qui porte la caractéristique d'appui (d'après BikeControl). */
  buttonService: sramAxsUuid('0053'),
  serial: sramAxsUuid('fe54'),
  model: sramAxsUuid('fe56'),
  deviceRecord: sramAxsUuid('fe58'),
  identity: sramAxsUuid('fff2'),
  microAdjust: sramAxsUuid('000a'),
  usageRecord: sramAxsUuid('0003'),
  /** État en direct chiffré (drivetrain_status → rapport). Notifie 0xFF « venez me lire ». */
  liveState: sramAxsUuid('000b'),
  /** drivetrain_config chiffré (nombre de pignons / plateaux). */
  drivetrainConfig: sramAxsUuid('0025'),
  /** Appui sur une commande : notification 0xFF ; identité du bouton chiffrée (non décodée). */
  buttonEvent: sramAxsUuid('0054'),
  bondV1Service: sramAxsUuid('ee51'),
  bondV1: sramAxsUuid('ee52'),
  bondV1Token: sramAxsUuid('ee53'),
} as const;

/** Notification sans contenu « l'état a changé, relisez la caractéristique » (et appui sur d9050054). */
export const SRAM_AXS_CHANGE_EDGE = 0xff;

export function isSramAxsChangeEdge(data: ByteSource): boolean {
  const b = toBytes(data);
  return b.length === 1 && b[0] === SRAM_AXS_CHANGE_EDGE;
}

/** Vrai si l'UUID appartient à la famille SRAM (d905xxxx-90aa-…). */
export function isSramAxsUuid(uuid: string): boolean {
  const u = uuid.toLowerCase();
  return u.startsWith('d905') && u.endsWith(SRAM_SUFFIX);
}

// --- Annonces BLE (sans connexion) ---------------------------------------------------------

export interface SramAxsServiceData {
  /** Numéro de série du composant (celui de l'appli et du nom « SRAM <série> »). */
  serial: number;
  /** Octet 8 : bit de poids fort à 1 observé uniquement sur les composants à batterie AXS. */
  classByte: number;
  /** Composant à batterie AXS (dérailleur, tige de selle) plutôt qu'à pile bouton (commande). */
  packPowered: boolean;
}

/** Données de service 0xFE51 (9 octets, octet 0 = 0x0d). */
export function decodeSramAxsServiceData(data: ByteSource): SramAxsServiceData | undefined {
  const b = toBytes(data);
  if (b.length < 9 || b[0] !== 0x0d) return undefined;
  const serial = (b[2]! | (b[3]! << 8) | (b[4]! << 16)) + b[5]! * 0x1000000;
  return { serial, classByte: b[8]!, packPowered: (b[8]! & 0x80) !== 0 };
}

export interface SramAxsAdvertisement {
  /** Octets 2–3 : version de firmware (codage inconnu ; ex. 01 01 → 01 02 après mise à jour). */
  firmware: [number, number];
  /** Tension de la batterie (mV), petit-boutiste. */
  batteryMv: number;
  /** % de batterie, composants à batterie AXS uniquement (0xFF = non fourni : pile bouton). */
  batteryPercent?: number;
  /** Série, si les données de service sont intégrées à la trame (forme de 25 octets). */
  serial?: number;
  packPowered?: boolean;
}

/**
 * Données fabricant 0x0933 (octets après l'identifiant). Formes acceptées : standard (12 octets),
 * standard + `01 01 09` + données de service + `01` (25 octets), standard + étiquette de build (26 octets),
 * ou l'enregistrement complémentaire seul (`01 01 09` …), selon que la pile Bluetooth les fusionne ou non.
 */
export function decodeSramAxsManufacturerData(data: ByteSource): SramAxsAdvertisement | undefined {
  const b = toBytes(data);
  if (b.length < 12) return undefined;
  const out: SramAxsAdvertisement = {
    firmware: [b[2]!, b[3]!],
    batteryMv: b[7]! | (b[8]! << 8),
  };
  if (b[11] !== 0xff) out.batteryPercent = b[11]!;
  if (b.length >= 24 && b[12] === 0x01 && b[13] === 0x01 && b[14] === 0x09) {
    const svc = decodeSramAxsServiceData(b.subarray(15, 24));
    if (svc) {
      out.serial = svc.serial;
      out.packPowered = svc.packPowered;
    }
  }
  return out;
}

/** Enregistrement complémentaire seul (`01 01 09` + 9 octets + `01`) : renvoie les données de service. */
export function decodeSramAxsSupplementalRecord(data: ByteSource): SramAxsServiceData | undefined {
  const b = toBytes(data);
  if (b.length < 12 || b[0] !== 0x01 || b[1] !== 0x01 || b[2] !== 0x09) return undefined;
  return decodeSramAxsServiceData(b.subarray(3, 12));
}

/** Série depuis le nom annoncé « SRAM <série décimale> ». */
export function sramAxsSerialFromName(name: string | undefined): number | undefined {
  const m = /^SRAM (\d{4,10})$/.exec(name ?? '');
  return m ? Number(m[1]) : undefined;
}

// --- Caractéristiques en clair -------------------------------------------------------------

/** d905fe54 : série, uint32 petit-boutiste. */
export function decodeSramAxsSerial(data: ByteSource): number {
  const b = toBytes(data);
  if (b.length < 4) throw new ProtocolError('SRAM AXS : série tronquée');
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16)) + b[3]! * 0x1000000;
}

/** d905fe56 : identifiant de modèle, uint16 petit-boutiste (1075 = RD-GX-E-B1). */
export function decodeSramAxsModelId(data: ByteSource): number {
  const b = toBytes(data);
  if (b.length < 2) throw new ProtocolError('SRAM AXS : modèle tronqué');
  return b[0]! | (b[1]! << 8);
}

export interface SramAxsDeviceRecord {
  major: number;
  minor: number;
  patch: number;
  /** « 2.55.6 », comme dans l'appli. */
  text: string;
  /** Identifiant de build ASCII en fin d'enregistrement (« g313caa0ed6.dir »). */
  buildId?: string;
}

/** d905fe58 : version de firmware à l'octet 5 (correctif d'abord : 06 37 02 → 2.55.6) + build ASCII. */
export function decodeSramAxsDeviceRecord(data: ByteSource): SramAxsDeviceRecord | undefined {
  const b = toBytes(data);
  if (b.length < 8) return undefined;
  const patch = b[5]!;
  const minor = b[6]!;
  const major = b[7]!;
  const rec: SramAxsDeviceRecord = { major, minor, patch, text: `${major}.${minor}.${patch}` };
  let end = b.length;
  while (end > 8 && b[end - 1] === 0) end--;
  let start = end;
  while (start > 8 && b[start - 1]! >= 0x20 && b[start - 1]! <= 0x7e) start--;
  if (end - start >= 4) rec.buildId = decodeUtf8(b.subarray(start, end));
  return rec;
}

function uintField(fields: ProtoField[], n: number): number | undefined {
  for (const f of fields) if (f.field === n && f.wireType === 0 && f.value !== undefined) return f.value;
  return undefined;
}

/** d905000a : MicroAdjust (protobuf 23 = min, 24 = actuel, 25 = max). */
export function decodeSramAxsMicroAdjust(data: ByteSource): { min: number; current: number; max: number } | undefined {
  const f = parseProtobuf(toBytes(data));
  const min = uintField(f, 23);
  const current = uintField(f, 24);
  const max = uintField(f, 25);
  return min === undefined || current === undefined || max === undefined ? undefined : { min, current, max };
}

/** d9050003 (~54 octets) : compteur de changements (octet de poids faible, à l'octet 50), temps de marche (u16 LE à 46). */
export function decodeSramAxsUsageRecord(data: ByteSource): { shiftCountLow: number; uptime: number } | undefined {
  const b = toBytes(data);
  if (b.length < 51) return undefined;
  return { shiftCountLow: b[50]!, uptime: b[46]! | (b[47]! << 8) };
}

// --- SRAMBond v1 : appairage hors ligne ----------------------------------------------------

/** Paramètres publics du Diffie-Hellman SRAMBond v1 (corps fini, 128 bits). */
export const SRAMBOND_V1 = {
  generator: 5n,
  /** 2^128 − 713 (premier). */
  modulus: (1n << 128n) - 713n,
  keyLength: 16,
  /** Première écriture sur d905ee52 : 00 01 02 … 0f. */
  init: Uint8Array.from({ length: 16 }, (_, i) => i),
  /** Dernière écriture : valide l'appairage. */
  finalize: Uint8Array.of(0x73),
} as const;

function toBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const x of bytes) v = (v << 8n) | BigInt(x);
  return v;
}

function fromBigInt(v: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = v;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

/** Clé publique (16 octets gros-boutistes) = g^privé mod p ; `privateKey` lu en gros-boutiste. */
export function srambondPublicKey(privateKey: ByteSource): Uint8Array {
  return fromBigInt(modPow(SRAMBOND_V1.generator, toBigInt(toBytes(privateKey)), SRAMBOND_V1.modulus), SRAMBOND_V1.keyLength);
}

/** Secret partagé (16 octets gros-boutistes) = publiqueAppareil^privé mod p : clé de transport AES-128. */
export function srambondSharedSecret(privateKey: ByteSource, devicePublicKey: ByteSource): Uint8Array {
  const pub = toBigInt(toBytes(devicePublicKey));
  if (pub <= 1n || pub >= SRAMBOND_V1.modulus - 1n) throw new ProtocolError('SRAMBond : clé publique de l’appareil invalide');
  return fromBigInt(modPow(pub, toBigInt(toBytes(privateKey)), SRAMBOND_V1.modulus), SRAMBOND_V1.keyLength);
}

/** Déchiffre le bloc de transport (48 octets : nonce ‖ chiffré ‖ étiquette) → clé du composant. */
export function srambondUnwrapDeviceKey(sharedSecret: ByteSource, blob: ByteSource): Uint8Array {
  const b = toBytes(blob);
  if (b.length !== 48) throw new ProtocolError('SRAMBond : bloc de transport de 48 octets attendu');
  return eaxDecrypt(toBytes(sharedSecret), b.subarray(0, 16), b.subarray(16));
}

/** Clé privée aléatoire valide (1 < x < p − 1). */
export function srambondRandomPrivateKey(random: (n: number) => Uint8Array): Uint8Array {
  for (;;) {
    const k = random(SRAMBOND_V1.keyLength);
    const v = toBigInt(k);
    if (v > 1n && v < SRAMBOND_V1.modulus - 1n) return k;
  }
}

/** Accès à la caractéristique d905ee52 pendant l'appairage. */
export interface SrambondChannel {
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array>;
}

/**
 * Appairage SRAMBond v1 complet (le composant doit être en mode appairage : bouton AXS maintenu
 * jusqu'au clignotement). Écrit exactement : init, notre clé publique, 0x73. Renvoie la clé du composant.
 */
export async function srambondCreateBond(channel: SrambondChannel, random: (n: number) => Uint8Array): Promise<Uint8Array> {
  const priv = srambondRandomPrivateKey(random);
  await channel.write(Uint8Array.from(SRAMBOND_V1.init));
  await channel.write(srambondPublicKey(priv));
  const devicePublic = await channel.read();
  if (devicePublic.length !== SRAMBOND_V1.keyLength) throw new ProtocolError('SRAMBond : clé publique de l’appareil absente (bouton AXS maintenu ?)');
  const shared = srambondSharedSecret(priv, devicePublic);
  const blob = await channel.read();
  const deviceKey = srambondUnwrapDeviceKey(shared, blob);
  await channel.write(Uint8Array.from(SRAMBOND_V1.finalize));
  return deviceKey;
}

// --- État en direct (après appairage) ------------------------------------------------------

/** Déchiffre une trame d905000b / d9050025 : nonce (16) ‖ chiffré ‖ étiquette (16). */
export function decryptSramAxsFrame(deviceKey: ByteSource, frame: ByteSource): Uint8Array {
  const b = toBytes(frame);
  if (b.length < 32) throw new ProtocolError('SRAM AXS : trame chiffrée trop courte');
  return eaxDecrypt(toBytes(deviceKey), b.subarray(0, 16), b.subarray(16));
}

export interface SramAxsDrivetrainStatus {
  /** Plateau (champ 20), absent en mono-plateau sur certains composants. */
  front?: number;
  /** Pignon engagé (champ 21), 1…12 comme dans l'appli. */
  rear?: number;
  /** Trim (champ 22). */
  rearTrim?: number;
}

/** drivetrain_status (clair) : champs 20 / 21 / 22. */
export function decodeSramAxsDrivetrainStatus(plaintext: ByteSource): SramAxsDrivetrainStatus {
  let f: ProtoField[];
  try {
    f = parseProtobuf(toBytes(plaintext));
  } catch {
    return {};
  }
  const out: SramAxsDrivetrainStatus = {};
  const front = uintField(f, 20);
  const rear = uintField(f, 21);
  const trim = uintField(f, 22);
  if (front !== undefined) out.front = front;
  if (rear !== undefined) out.rear = rear;
  if (trim !== undefined) out.rearTrim = trim;
  return out;
}

/** drivetrain_config (clair) : champs 23 (plateaux), 24 (pignons), 25 (positions de trim). */
export function decodeSramAxsDrivetrainConfig(plaintext: ByteSource): { frontGears?: number; rearGears?: number; trimPositions?: number } {
  let f: ProtoField[];
  try {
    f = parseProtobuf(toBytes(plaintext));
  } catch {
    return {};
  }
  const out: { frontGears?: number; rearGears?: number; trimPositions?: number } = {};
  const a = uintField(f, 23);
  const r = uintField(f, 24);
  const t = uintField(f, 25);
  if (a !== undefined) out.frontGears = a;
  if (r !== undefined) out.rearGears = r;
  if (t !== undefined) out.trimPositions = t;
  return out;
}

export type SramAxsShift = 'up' | 'down' | 'frontUp' | 'frontDown';

/**
 * Transforme les changements de rapport réel en actions de jeu. Hypothèse (à confirmer) : pignon 1 = le
 * plus grand (le plus facile), donc rear qui augmente = « up » ; plateau 2 = grand plateau.
 */
export class SramAxsGearTracker {
  private last: SramAxsDrivetrainStatus | undefined;

  update(status: SramAxsDrivetrainStatus): SramAxsShift[] {
    const prev = this.last;
    this.last = { ...prev, ...status };
    if (!prev) return [];
    const out: SramAxsShift[] = [];
    if (status.rear !== undefined && prev.rear !== undefined && status.rear !== prev.rear) {
      const n = Math.abs(status.rear - prev.rear);
      for (let i = 0; i < n; i++) out.push(status.rear > prev.rear ? 'up' : 'down');
    }
    if (status.front !== undefined && prev.front !== undefined && status.front !== prev.front) {
      out.push(status.front > prev.front ? 'frontUp' : 'frontDown');
    }
    return out;
  }

  get current(): SramAxsDrivetrainStatus | undefined {
    return this.last;
  }

  reset(): void {
    this.last = undefined;
  }
}

// --- Sans appairage : appuis anonymes (clic / double clic) ---------------------------------

/**
 * Sans clé, une commande AXS ne signale qu'un appui anonyme (0xFF sur d9050054). Contournement décrit
 * dans BikeControl #234 : distinguer clic simple et double clic au temps. Il faut régler l'action des
 * palettes sur « aucune » dans l'appli SRAM AXS si le dérailleur ne doit pas bouger.
 */
export class SramAxsClickClassifier {
  private pendingAt: number | undefined;

  constructor(readonly doubleClickMs = 350) {}

  /** Un appui à l'instant t : 'double' immédiat s'il complète un clic en attente. */
  press(t: number): 'double' | undefined {
    if (this.pendingAt !== undefined && t - this.pendingAt <= this.doubleClickMs) {
      this.pendingAt = undefined;
      return 'double';
    }
    this.pendingAt = t;
    return undefined;
  }

  /** À appeler après la fenêtre : 'single' si le clic en attente est resté seul. */
  poll(t: number): 'single' | undefined {
    if (this.pendingAt !== undefined && t - this.pendingAt >= this.doubleClickMs) {
      this.pendingAt = undefined;
      return 'single';
    }
    return undefined;
  }

  reset(): void {
    this.pendingAt = undefined;
  }
}
