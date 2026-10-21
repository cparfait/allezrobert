/**
 * Contrats des capteurs : ce que tout transport (Web Bluetooth, Bluetooth natif,
 * Direct Connect, ANT+, simulateur) doit produire, une fois les trames décodées.
 * Les horodatages `t` sont en millisecondes (performance.now() ou Date.now() côté serveur).
 */

export type DeviceKind =
  | 'trainer' // home trainer pilotable (FTMS, FE-C)
  | 'power' // capteur de puissance seul (pédales, manivelle)
  | 'heartRate'
  | 'cadence'
  | 'speed'
  | 'shifter' // commandes de vitesses (Click, Di2 D-Fly, AXS, HID, clavier…)
  | 'fan'; // ventilateur asservi (HEADWIND)

export type TransportKind = 'web-bluetooth' | 'native-ble' | 'dircon' | 'ant-usb' | 'simulator' | 'keyboard' | 'gamepad' | 'companion';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'silent' | 'error';

/** Puissance, issue des pédales, d'une manivelle ou du home trainer. */
export interface PowerSample {
  t: number;
  watts: number;
  cadence?: number; // tr/min
  /** Part de la jambe gauche en % (0–100), si le capteur la fournit. */
  balanceLeft?: number;
  /** Efficacité du couple (Torque Effectiveness) en %, par jambe. */
  teLeft?: number;
  teRight?: number;
  /** Régularité du pédalage (Pedal Smoothness) en %, par jambe. */
  psLeft?: number;
  psRight?: number;
  /** Compteur cumulé de révolutions de manivelle, quand disponible. */
  crankRevs?: number;
}

export interface HeartRateSample {
  t: number;
  bpm: number;
  /** Intervalles R-R en millisecondes. */
  rr?: number[];
}

export interface TrainerSample {
  t: number;
  watts?: number;
  cadence?: number;
  /** Vitesse rapportée par le trainer, informative uniquement (le jeu calcule la sienne). */
  speedKmh?: number;
}

export interface CadenceSample {
  t: number;
  cadence: number;
}

export interface SpeedSample {
  t: number;
  speedKmh: number;
  wheelRevs?: number;
}

export type ShiftAction = 'up' | 'down' | 'frontUp' | 'frontDown' | 'steerLeft' | 'steerRight' | 'confirm' | 'back' | 'menu';

export interface ShiftEvent {
  t: number;
  action: ShiftAction;
  /** Rapport réel engagé (cassette réelle + Di2), quand la commande le fournit. */
  realGear?: { front: number; rear: number };
}

/** Commandes envoyées à un home trainer. */
export type TrainerCommand =
  | { kind: 'simulation'; gradePercent: number; windSpeedMs?: number; crr?: number; cw?: number }
  | { kind: 'erg'; watts: number }
  | { kind: 'resistance'; level: number } // 0–100 %
  | { kind: 'spindown' }
  | { kind: 'reset' };

export type FanCommand = { kind: 'speed'; percent: number } | { kind: 'mode'; mode: 'manual' | 'speed' | 'heartRate' | 'off' };

export interface DeviceInfo {
  id: string;
  name: string;
  kinds: DeviceKind[];
  transport: TransportKind;
  manufacturer?: string;
  model?: string;
  firmware?: string;
  /** RSSI en dBm pour l'écran d'appairage. */
  rssi?: number;
}

/** Événements émis par un appareil connecté. */
export interface DeviceEvents {
  power: PowerSample;
  heartRate: HeartRateSample;
  trainer: TrainerSample;
  cadence: CadenceSample;
  speed: SpeedSample;
  shift: ShiftEvent;
  state: ConnectionState;
  battery: number;
  log: string;
}
