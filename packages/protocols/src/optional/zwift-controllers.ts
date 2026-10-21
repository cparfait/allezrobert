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
 *   0x23 Ride / Click v2 (RideKeyPadStatus : 1 = masque de boutons, bit à 0 = appuyé ; 3 = palettes analogiques)
 *   0x19 batterie (champ 1 = %), 0x15 message vide (inactivité).
 *
 * TODO (non vérifiable sans matériel / non documenté publiquement) :
 *   - firmwares anciens chiffrés (ECDH + AES-CCM après « RideOn » + clé publique) : non géré ;
 *   - Click v2 et Ride ≥ 1.3 : service masqué tant que la manette n'est pas « déverrouillée » par l'appli
 *     Zwift (mécanisme « unlock ») : non géré, voir ZwiftUnlockStrategy.
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
  clickNotification: 0x37,
} as const;

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
    case ZWIFT_MESSAGE_TYPE.battery:
      return { type: 'battery', percent: field(parseProtobuf(payload), 1) ?? 0 };
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

/**
 * Point d'extension pour les variantes nécessitant une poignée de main non documentée
 * (firmwares chiffrés, « unlock » Click v2 / Ride v2). Aucune implémentation fournie.
 */
export interface ZwiftUnlockStrategy {
  readonly name: string;
  /** Octets à écrire sur SyncRx avant de recevoir des appuis. */
  handshake(): Promise<Uint8Array[]>;
  /** Déchiffre une notification si nécessaire. */
  decrypt?(data: Uint8Array): Uint8Array;
}

/** Stratégie par défaut : « RideOn » en clair (Click v1, Play et Ride ≤ 1.2 à jour). */
export const PLAIN_RIDE_ON_HANDSHAKE: ZwiftUnlockStrategy = {
  name: 'plain-ride-on',
  handshake: async () => [ZWIFT_RIDE_ON],
};
