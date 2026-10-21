/**
 * Types communs du paquet `devices` : liaison GATT abstraite, canal ANT, transports, profils, avertissements.
 */
import type {
  ConnectionState,
  DeviceEvents,
  DeviceInfo,
  DeviceKind,
  FanCommand,
  NativeAdapter,
  TrainerCommand,
  TransportKind,
} from '@allezrobert/shared';
import type { AntPlusProfileName, ExperimentalAdapters } from '@allezrobert/protocols';
import type { Clock } from './clock.ts';

// --- Liaison GATT abstraite (Web Bluetooth, btleplug, Direct Connect, simulateur) ---------

export type NotificationHandler = (data: Uint8Array) => void;

export interface GattCharacteristicInfo {
  uuid: string;
  /** 'read' | 'write' | 'writeWithoutResponse' | 'notify' | 'indicate' */
  properties: string[];
}

export interface GattServiceInfo {
  uuid: string;
  characteristics: GattCharacteristicInfo[];
}

/** Connexion « façon GATT » : les profils FTMS/CPS/HRS ne voient que cette interface. UUID 128 bits minuscules. */
export interface GattConnection {
  readonly type: 'gatt';
  readonly deviceId: string;
  readonly services: readonly GattServiceInfo[];
  read(service: string, characteristic: string): Promise<Uint8Array>;
  write(service: string, characteristic: string, data: Uint8Array, withResponse?: boolean): Promise<void>;
  /** Active notifications ou indications ; renvoie la fonction de désabonnement. */
  subscribe(service: string, characteristic: string, handler: NotificationHandler): Promise<() => Promise<void>>;
  disconnect(): Promise<void>;
  /** Appelé une seule fois quand la liaison est perdue (y compris après disconnect()). */
  onDisconnect(handler: () => void): () => void;
}

/** Canal ANT+ ouvert sur la clé USB : pages de 8 octets. */
export interface AntChannelLink {
  readonly type: 'ant';
  readonly deviceId: string;
  readonly channel: number;
  readonly profile: AntPlusProfileName;
  onPage(handler: (page: Uint8Array) => void): () => void;
  send(page: Uint8Array, acknowledged?: boolean): Promise<void>;
  disconnect(): Promise<void>;
  onDisconnect(handler: () => void): () => void;
}

export type DeviceLink = GattConnection | AntChannelLink;

// --- Transports -----------------------------------------------------------------------

export interface DiscoveredDevice {
  /** Identifiant unique toutes transports confondus : « <transport>:<id natif> ». */
  id: string;
  name: string;
  transport: TransportKind;
  kinds: DeviceKind[];
  /** UUID 128 bits annoncées (ou profil ANT+ « ant+:<nom> »). */
  services: string[];
  rssi?: number;
  manufacturerData?: Record<string, number[]>;
  /** Données propres au transport, sérialisables, nécessaires pour se reconnecter (hôte DirCon, canal ANT…). */
  address?: Record<string, string | number | boolean>;
  /** Dernière fois vu pendant une recherche (ms, horloge du gestionnaire). */
  lastSeen?: number;
}

export interface ScanOptions {
  kinds?: DeviceKind[];
  timeoutMs?: number;
  experimental?: Partial<ExperimentalAdapters>;
}

export interface ScanHandle {
  stop(): Promise<void>;
}

export interface Transport {
  readonly kind: TransportKind;
  isAvailable(): Promise<boolean>;
  /** Lance une recherche ; `onFound` peut être appelé plusieurs fois pour le même appareil (mise à jour RSSI). */
  scan(options: ScanOptions, onFound: (device: DiscoveredDevice) => void): Promise<ScanHandle>;
  connect(device: DiscoveredDevice): Promise<DeviceLink>;
  /** Choix de l'adaptateur Bluetooth (Bluetooth natif uniquement). */
  listAdapters?(): Promise<NativeAdapter[]>;
  selectAdapter?(adapterId: string): Promise<void>;
}

// --- Avertissements ---------------------------------------------------------------------

export type DeviceWarningCode =
  | 'trainer-control-not-permitted'
  | 'trainer-control-lost'
  | 'assioma-single-side'
  | 'single-ble-connection'
  | 'sensor-silent'
  | 'reconnect-failed'
  | 'experimental-adapter'
  | 'ant-network-key-missing'
  | 'dircon-single-client'
  | 'command-failed';

export interface DeviceWarning {
  t: number;
  deviceId: string;
  code: DeviceWarningCode;
  /** Message prêt à afficher (français). */
  message: string;
  details?: Record<string, unknown>;
}

export interface CalibrationEvent {
  t: number;
  status: 'started' | 'requested' | 'stopPedaling' | 'success' | 'error' | 'unsupported';
  targetSpeedLowKmh?: number;
  targetSpeedHighKmh?: number;
}

/** Événements d'un appareil : ceux de @allezrobert/shared + avertissements, infos et calibration. */
export interface DeviceEventMap extends DeviceEvents {
  warning: DeviceWarning;
  info: DeviceInfo;
  calibration: CalibrationEvent;
}

// --- Profils ------------------------------------------------------------------------------

export interface ProfileContext {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly clock: Clock;
  now(): number;
  emit<K extends keyof DeviceEventMap>(event: K, payload: DeviceEventMap[K]): void;
  log(message: string): void;
  warn(code: DeviceWarningCode, message: string, details?: Record<string, unknown>): void;
}

/**
 * Un profil décode un service (FTMS, CPS…) d'une liaison. Il est conservé entre deux reconnexions :
 * `attach` est rappelé sur la nouvelle liaison (reprise du contrôle, renvoi de la dernière consigne).
 */
export interface Profile {
  readonly name: string;
  /** Produit des données en continu : soumis à la détection de capteur muet. */
  readonly streaming: boolean;
  attach(link: DeviceLink, ctx: ProfileContext): Promise<void>;
  detach(): void;
}

export interface TrainerControl {
  send(command: TrainerCommand): Promise<void>;
  readonly lastCommand: TrainerCommand | undefined;
  readonly hasControl: boolean;
}

export interface FanControl {
  send(command: FanCommand): Promise<void>;
}

export type { ConnectionState };
