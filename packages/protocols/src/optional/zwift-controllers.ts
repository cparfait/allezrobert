/**
 * EXPÉRIMENTAL — désactivé par défaut. Manettes Zwift Click (v1, v2), Play et Ride.
 *
 * Protocole NON documenté par Zwift : ce décodage reprend les faits publiés par les projets open source
 * jonasbark/swiftcontrol (« BikeControl », organisation OpenBikeControl) et les analyses de la communauté
 * (Makinolo). Réimplémentation indépendante, aucun code copié. Une mise à jour de firmware peut tout casser.
 *
 * ⚠ Ce module ne lit QUE les boutons. Il n'implémente pas et n'utilise jamais le « Zwift Protocol » de
 * pilotage des home trainers (opcodes TRAINER_*, résistance, etc.) : le jeu pilote le trainer en FTMS.
 *
 * Service propriétaire 00000001-19ca-4651-86e5-fa29dcdd09d1 (ou 0xFC82 sur Ride / Click v2) :
 *   - 00000002-… « Async » (notify)  : appuis de boutons, batterie ;
 *   - 00000003-… « SyncRx » (write)  : poignée de main « RideOn » ;
 *   - 00000004-… « SyncTx » (indicate) : réponse « RideOn » + octets d'identification.
 * Notification : [type de message][message protobuf].
 *   0x37 Click (ClickKeyPadStatus : 1 = plus, 2 = moins ; enum 0 = APPUYÉ, 1 = relâché)
 *   0x07 Play  (PlayKeyPadStatus : 1 = côté (0 = droite, 1 = gauche), 2 Y/haut, 3 Z/gauche, 4 A/droite, 5 B/bas, 6 shift, 7 on, 8/9 analogiques zigzag)
 *   0x23 Ride / Click v2 / Play fw 2 (RideKeyPadStatus : 1 = masque de boutons, bit à 0 = appuyé ; 3 = palettes analogiques)
 *   0x19 batterie (champ 1 = % sur Play/Click v1, champ 2 sur Click v2 : `19 10 64` = 100 %),
 *   0x15 message vide (inactivité), 0x2A journal texte du firmware, 0xFE déconnexion,
 *   0xFF message « vendeur » : `ff 03 …` = défi cryptographique d'une manette verrouillée,
 *   `ff 05 …` = numéro de série / état renvoyé par le Click v2 après chaque RideOn.
 *
 * Click v2 (état de la recherche, 22/10/2026 — voir docs/PROTOCOLS.md §10.2) :
 *   - deux palets séparés (type 0x0A droit, 0x0B gauche), protocole « Ride » en clair sur 0xFC82,
 *     réponse `RideOn 02 03` ; le palet gauche relaie aussi les boutons du droit : on filtre par palet ;
 *   - les palets s'endorment (~1 min) sans trafic : renvoyer « RideOn » toutes les 3 s les garde éveillés ;
 *   - le palet DROIT n'est jamais verrouillé ; le GAUCHE l'est si l'appli Zwift ne l'a pas vu depuis
 *     ~24 h : il répond `ff 03 …` (défi) au lieu de « RideOn » et ne remonte plus ses boutons.
 *   Ride ≥ 1.3 (« Ride v2 ») : même verrou, service Zwift masqué tant qu'il n'est pas déverrouillé.
 *
 * NON IMPLÉMENTÉ, volontairement :
 *   - répondre au défi `ff 03 …` : la réponse exige une clé détenue par Zwift (BikeControl la garde
 *     dans un paquet privé et relaie le défi à l'appli Zwift elle-même) ;
 *   - la trame `ff 04 00` que certains projets écrivent pour qu'une manette déjà déverrouillée « le
 *     reste » au-delà de 24 h : c'est contourner la fenêtre imposée par le constructeur, on s'abstient.
 *   Le joueur déverrouille lui-même via l'appli Zwift (10–30 s connecté, gratuit), puis le jeu prend le relais.
 */
import { startsWith, toBytes, type ByteSource } from '../bytes.ts';
import { parseProtobuf, zigzagDecode, type ProtoField } from './protobuf.ts';

export const ZWIFT_CONTROLLER = {
  service: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  /** Service court utilisé par Zwift Ride / Click v2 (0xFC82). */
  rideService: '0000fc82-0000-1000-8000-00805f9b34fb',
  async: '00000002-19ca-4651-86e5-fa29dcdd09d1',
  syncRx: '00000003-19ca-4651-86e5-fa29dcdd09d1',
  syncTx: '00000004-19ca-4651-86e5-fa29dcdd09d1',
  /** Identifiant fabricant Bluetooth SIG de Zwift, Inc. */
  manufacturerId: 0x094a,
} as const;

/** « RideOn » en ASCII : poignée de main en clair (firmwares récents non chiffrés). */
export const ZWIFT_RIDE_ON = Uint8Array.of(0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e);

export const ZWIFT_MESSAGE_TYPE = {
  playNotification: 0x07,
  empty: 0x15,
  battery: 0x19,
  rideNotification: 0x23,
  log: 0x2a,
  clickNotification: 0x37,
  disconnect: 0xfe,
  vendor: 0xff,
} as const;

/** Sous-types connus du message « vendeur » 0xFF. */
export const ZWIFT_VENDOR_SUBTYPE = {
  /** Défi cryptographique : la manette est verrouillée (réponse réservée à l'appli Zwift). */
  challenge: 0x03,
  /** Numéro de série / état, envoyé par le Click v2 après chaque RideOn. */
  status: 0x05,
} as const;

/** Intervalle de renvoi de « RideOn » qui empêche le Click v2 de s'endormir (qdomyos-zwift, Torqa, ORQWA). */
export const ZWIFT_KEEPALIVE_INTERVAL_MS = 3000;

/** Octet de type d'appareil dans les données fabricant (après l'identifiant 0x094A). */
export const ZWIFT_DEVICE_TYPE = {
  0x02: 'playRight',
  0x03: 'playLeft',
  0x07: 'rideRight',
  0x08: 'rideLeft',
  0x09: 'click',
  0x0a: 'clickV2Right',
  0x0b: 'clickV2Left',
  0x0e: 'playFw2',
} as const;
export type ZwiftDeviceType = (typeof ZWIFT_DEVICE_TYPE)[keyof typeof ZWIFT_DEVICE_TYPE];

/**
 * Type d'appareil à partir des données fabricant de l'annonce BLE.
 * `data` = octets qui suivent l'identifiant fabricant (Web Bluetooth / btleplug les séparent déjà).
 */
export function zwiftDeviceTypeFromManufacturerData(data: ByteSource): ZwiftDeviceType | undefined {
  const b = toBytes(data);
  return (ZWIFT_DEVICE_TYPE as Record<number, ZwiftDeviceType>)[b[0] ?? -1];
}

export type ZwiftButton =
  | 'plus'
  | 'minus'
  | 'navUp'
  | 'navDown'
  | 'navLeft'
  | 'navRight'
  | 'a'
  | 'b'
  | 'y'
  | 'z'
  | 'shiftUpLeft'
  | 'shiftDownLeft'
  | 'shiftUpRight'
  | 'shiftDownRight'
  | 'powerUpLeft'
  | 'powerUpRight'
  | 'onOffLeft'
  | 'onOffRight'
  | 'sideLeft'
  | 'sideRight'
  | 'paddleLeft'
  | 'paddleRight';

/** Masques du champ « ButtonMap » de la Ride / Click v2 (bit à 0 = appuyé). */
export const ZWIFT_RIDE_BUTTON_MASK: Record<Exclude<ZwiftButton, 'plus' | 'minus' | 'sideLeft' | 'sideRight' | 'paddleLeft' | 'paddleRight'>, number> = {
  navLeft: 0x00001,
  navUp: 0x00002,
  navRight: 0x00004,
  navDown: 0x00008,
  a: 0x00010,
  b: 0x00020,
  y: 0x00040,
  z: 0x00080,
  shiftUpLeft: 0x00100,
  shiftDownLeft: 0x00200,
  powerUpLeft: 0x00400,
  onOffLeft: 0x00800,
  shiftUpRight: 0x01000,
  shiftDownRight: 0x02000,
  powerUpRight: 0x04000,
  onOffRight: 0x08000,
};

/** Seuil de la palette analogique (Ride) au-delà duquel on considère un appui. */
export const ZWIFT_ANALOG_THRESHOLD = 25;

export type ZwiftControllerMessage =
  | { type: 'buttons'; source: 'click' | 'play' | 'ride'; pressed: ZwiftButton[]; analog?: Array<{ location: number; value: number }> }
  | { type: 'battery'; percent: number }
  | { type: 'handshake'; variant: Uint8Array }
  | { type: 'idle' }
  | { type: 'log'; payload: Uint8Array }
  | { type: 'vendor'; subtype: number; payload: Uint8Array }
  | { type: 'disconnect' }
  | { type: 'unknown'; messageType: number; payload: Uint8Array };

function field(fields: ProtoField[], n: number): number | undefined {
  for (const f of fields) if (f.field === n && f.value !== undefined) return f.value;
  return undefined;
}

/** Enum PlayButtonStatus : 0 = ON (appuyé), 1 = OFF. Un champ absent vaut la valeur par défaut 0 (proto). */
function pressedEnum(fields: ProtoField[], n: number): boolean {
  return (field(fields, n) ?? 0) === 0;
}

/** Décode une notification (Async ou SyncTx). */
export function decodeZwiftControllerMessage(data: ByteSource): ZwiftControllerMessage {
  const b = toBytes(data);
  if (startsWith(b, ZWIFT_RIDE_ON)) return { type: 'handshake', variant: b.slice(ZWIFT_RIDE_ON.length) };
  const type = b[0] ?? 0;
  const payload = b.subarray(1);
  switch (type) {
    case ZWIFT_MESSAGE_TYPE.empty:
      return { type: 'idle' };
    case ZWIFT_MESSAGE_TYPE.battery: {
      // Play / Click v1 : champ 1 ; Click v2 (protocole Ride) : champ 2.
      const f = parseProtobuf(payload);
      return { type: 'battery', percent: field(f, 2) ?? field(f, 1) ?? 0 };
    }
    case ZWIFT_MESSAGE_TYPE.log:
      return { type: 'log', payload: payload.slice() };
    case ZWIFT_MESSAGE_TYPE.disconnect:
      return { type: 'disconnect' };
    case ZWIFT_MESSAGE_TYPE.vendor:
      return { type: 'vendor', subtype: payload[0] ?? -1, payload: payload.subarray(1).slice() };
    case ZWIFT_MESSAGE_TYPE.clickNotification: {
      const f = parseProtobuf(payload);
      const pressed: ZwiftButton[] = [];
      if (pressedEnum(f, 1)) pressed.push('plus');
      if (pressedEnum(f, 2)) pressed.push('minus');
      return { type: 'buttons', source: 'click', pressed };
    }
    case ZWIFT_MESSAGE_TYPE.playNotification: {
      const f = parseProtobuf(payload);
      // Champ 1 « RightPad » : ON (0) = manette droite, OFF (1) = manette gauche.
      const right = pressedEnum(f, 1);
      const pressed: ZwiftButton[] = [];
      if (pressedEnum(f, 2)) pressed.push(right ? 'y' : 'navUp');
      if (pressedEnum(f, 3)) pressed.push(right ? 'z' : 'navLeft');
      if (pressedEnum(f, 4)) pressed.push(right ? 'a' : 'navRight');
      if (pressedEnum(f, 5)) pressed.push(right ? 'b' : 'navDown');
      if (pressedEnum(f, 6)) pressed.push(right ? 'sideRight' : 'sideLeft');
      if (pressedEnum(f, 7)) pressed.push(right ? 'onOffRight' : 'onOffLeft');
      const lr = field(f, 8);
      const analogLR = lr === undefined ? 0 : zigzagDecode(lr);
      if (Math.abs(analogLR) >= 100) pressed.push(right ? 'paddleRight' : 'paddleLeft');
      return { type: 'buttons', source: 'play', pressed };
    }
    case ZWIFT_MESSAGE_TYPE.rideNotification: {
      const f = parseProtobuf(payload);
      const map = field(f, 1);
      const pressed: ZwiftButton[] = [];
      if (map !== undefined) {
        for (const [name, mask] of Object.entries(ZWIFT_RIDE_BUTTON_MASK)) {
          if ((map & mask) === 0) pressed.push(name as ZwiftButton);
        }
      }
      const analog: Array<{ location: number; value: number }> = [];
      for (const fld of f) {
        if (fld.field !== 3 || !fld.bytes) continue;
        const sub = parseProtobuf(fld.bytes);
        const location = field(sub, 1) ?? 0;
        const raw = field(sub, 2);
        const value = raw === undefined ? 0 : zigzagDecode(raw);
        analog.push({ location, value });
        if (Math.abs(value) >= ZWIFT_ANALOG_THRESHOLD) {
          if (location === 0) pressed.push('paddleLeft');
          else if (location === 1) pressed.push('paddleRight');
        }
      }
      return { type: 'buttons', source: 'ride', pressed, analog };
    }
    default:
      return { type: 'unknown', messageType: type, payload: payload.slice() };
  }
}

/**
 * Les manettes répètent l'état tant qu'un bouton est tenu : on ne garde que les fronts montants.
 */
export class ZwiftButtonEdgeDetector {
  private held = new Set<ZwiftButton>();

  /** Renvoie les boutons nouvellement appuyés depuis le message précédent. */
  update(pressed: readonly ZwiftButton[]): ZwiftButton[] {
    const now = new Set(pressed);
    const rising = pressed.filter((b) => !this.held.has(b));
    this.held = now;
    return rising;
  }

  reset(): void {
    this.held.clear();
  }
}

/** Correspondance par défaut bouton → action de jeu (modifiable dans les réglages). */
export const DEFAULT_ZWIFT_BUTTON_ACTIONS: Partial<Record<ZwiftButton, 'up' | 'down' | 'frontUp' | 'frontDown' | 'steerLeft' | 'steerRight' | 'confirm' | 'back' | 'menu'>> = {
  plus: 'up',
  minus: 'down',
  shiftUpRight: 'up',
  shiftDownRight: 'down',
  shiftUpLeft: 'frontUp',
  shiftDownLeft: 'frontDown',
  paddleRight: 'up',
  paddleLeft: 'down',
  sideRight: 'up',
  sideLeft: 'down',
  navLeft: 'steerLeft',
  navRight: 'steerRight',
  a: 'confirm',
  b: 'back',
  y: 'menu',
};

// --- Click v2 : deux palets ---------------------------------------------------------------

/** Boutons physiquement portés par chaque palet du Click v2 (le gauche relaie aussi ceux du droit). */
export const ZWIFT_CLICK_V2_POD_BUTTONS: Readonly<Record<'clickV2Left' | 'clickV2Right', readonly ZwiftButton[]>> = {
  // Palet gauche : croix de navigation + bouton « − » (bit shiftUpLeft 0x100).
  clickV2Left: ['navUp', 'navDown', 'navLeft', 'navRight', 'shiftUpLeft'],
  // Palet droit : Y, Z, A, B + bouton « + » (bit shiftUpRight 0x1000).
  clickV2Right: ['y', 'z', 'a', 'b', 'shiftUpRight'],
};

/** Ne garde que les boutons du palet qui a émis la trame (évite le double appui dû au relais). */
export function filterZwiftPodButtons(deviceType: ZwiftDeviceType | undefined, pressed: readonly ZwiftButton[]): ZwiftButton[] {
  if (deviceType !== 'clickV2Left' && deviceType !== 'clickV2Right') return [...pressed];
  const own = ZWIFT_CLICK_V2_POD_BUTTONS[deviceType];
  return pressed.filter((b) => own.includes(b));
}

/** Correspondance par défaut du Click v2 : « + » monte, « − » descend (et non plateau). */
export const DEFAULT_ZWIFT_CLICK_V2_ACTIONS: typeof DEFAULT_ZWIFT_BUTTON_ACTIONS = {
  ...DEFAULT_ZWIFT_BUTTON_ACTIONS,
  shiftUpRight: 'up',
  shiftUpLeft: 'down',
};

/** Variante « palet droit seul » (sans déverrouillage) : « + » monte, B descend (comme BikeControl ≥ 6.4). */
export const ZWIFT_CLICK_V2_RIGHT_ONLY_ACTIONS: typeof DEFAULT_ZWIFT_BUTTON_ACTIONS = {
  ...DEFAULT_ZWIFT_CLICK_V2_ACTIONS,
  b: 'down',
};

// --- Poignée de main et verrou ------------------------------------------------------------

export interface ZwiftHandshakeResponse {
  /** Deux octets après « RideOn » : 01 03 Click, 01 04 Play, 02 03 Click v2 (observés). */
  variant: Uint8Array;
  /** Clé publique P-256 de l'appareil (64 octets X‖Y) : présente seulement en mode chiffré « Zap ». */
  devicePublicKey?: Uint8Array;
}

/** Analyse une réponse « RideOn » reçue sur SyncTx ; undefined si ce n'en est pas une. */
export function parseZwiftHandshakeResponse(data: ByteSource): ZwiftHandshakeResponse | undefined {
  const b = toBytes(data);
  if (!startsWith(b, ZWIFT_RIDE_ON)) return undefined;
  const variant = b.slice(ZWIFT_RIDE_ON.length, ZWIFT_RIDE_ON.length + 2);
  const rest = b.subarray(ZWIFT_RIDE_ON.length + 2);
  return rest.length === 64 ? { variant, devicePublicKey: rest.slice() } : { variant };
}

export type ZwiftLockState = 'unknown' | 'unlocked' | 'locked';

/**
 * Déduit l'état de verrouillage des réponses de la manette (SyncTx et Async) :
 * écho « RideOn » = déverrouillée ; défi `ff 03 …` sans écho = verrouillée (palet gauche du Click v2,
 * Ride v2). Un défi isolé après un écho « RideOn » est ignoré (observé sur du matériel qui continue
 * pourtant d'envoyer ses boutons).
 */
export class ZwiftLockDetector {
  private _state: ZwiftLockState = 'unknown';

  get state(): ZwiftLockState {
    return this._state;
  }

  /** Renvoie le nouvel état si la trame l'a changé. */
  push(data: ByteSource): ZwiftLockState | undefined {
    const b = toBytes(data);
    const before = this._state;
    if (startsWith(b, ZWIFT_RIDE_ON)) this._state = 'unlocked';
    else if (b[0] === ZWIFT_MESSAGE_TYPE.vendor && b[1] === ZWIFT_VENDOR_SUBTYPE.challenge && this._state !== 'unlocked') this._state = 'locked';
    return this._state !== before ? this._state : undefined;
  }

  reset(): void {
    this._state = 'unknown';
  }
}

/**
 * Stratégie de poignée de main. Implémentations fournies : RideOn en clair (défaut) et « Zap »
 * chiffré des anciens firmwares (zwift-zap.ts). Le déverrouillage Click v2 / Ride v2 n'en fait PAS
 * partie : il exige une clé de Zwift (voir l'en-tête du fichier).
 */
export interface ZwiftUnlockStrategy {
  readonly name: string;
  /** Octets à écrire sur SyncRx avant de recevoir des appuis. */
  handshake(): Promise<Uint8Array[]>;
  /** Réponse « RideOn » reçue sur SyncTx (clé publique de l'appareil en mode chiffré, par exemple). */
  onHandshakeResponse?(data: Uint8Array): Promise<void> | void;
  /** Déchiffre une notification si nécessaire (sinon la renvoie telle quelle). */
  decrypt?(data: Uint8Array): Uint8Array;
}

/** Stratégie par défaut : « RideOn » en clair (Click v1, Play et Ride ≤ 1.2 à jour). */
export const PLAIN_RIDE_ON_HANDSHAKE: ZwiftUnlockStrategy = {
  name: 'plain-ride-on',
  handshake: async () => [ZWIFT_RIDE_ON],
};
