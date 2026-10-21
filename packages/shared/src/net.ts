/**
 * Messages réseau client ↔ serveur (Colyseus). Le serveur est autoritaire à ~10 Hz :
 * le client envoie sa télémétrie (puissance mesurée), le serveur intègre la physique
 * de groupe (drafting, groupe soudé) et diffuse les positions.
 * Position = distance sur l'itinéraire + décalage latéral (m, positif = droite).
 */

export const NET_TICK_HZ = 10;
export const MAX_RIDERS_PER_ROOM = 20;

export type RideMode = 'free' | 'group' | 'race' | 'workout' | 'ftpTest';

export interface RoomOptions {
  routeId: string;
  mode: RideMode;
  /** Groupe soudé : personne ne lâche le groupe tant que l'option est active. */
  stickyGroup: boolean;
  allowGuests: boolean;
  draftingStrength: number; // 0–1, 1 = réaliste
  /** Difficulté de la pente envoyée au trainer (0–1, 0,5 par défaut). */
  trainerDifficulty: number;
  aiRiders: number;
  inviteCode?: string;
  startAt?: number; // epoch ms, départ groupé
}

/** Client → serveur, à 10 Hz. */
export interface TelemetryMsg {
  seq: number;
  t: number;
  watts: number;
  cadence: number;
  hr?: number;
  /** Rapport virtuel courant (indice 0–23). */
  gear: number;
  /** Décalage latéral souhaité (direction au clavier / manette). */
  steer: number;
  /** Puissance virtuelle bornée pour un invité sans matériel. */
  guestThrottle?: number;
}

export interface RiderSnapshot {
  id: string;
  name: string;
  distM: number;
  lateralM: number;
  speedMs: number;
  watts: number;
  cadence: number;
  hr?: number;
  draftPct: number; // économie due à l'aspiration, en %
  isAI: boolean;
  isGuest: boolean;
  lap: number;
  avatar: AvatarLook;
  pose: 'seated' | 'standing' | 'coasting';
}

export interface AvatarLook {
  skin: string;
  hair: string;
  hairStyle: number;
  jersey: string;
  jerseyAccent: string;
  helmet: string;
  bike: string;
  build: number; // 0 = fin, 1 = costaud
}

export const DEFAULT_LOOK: AvatarLook = {
  skin: '#e0b48f',
  hair: '#3b2a1e',
  hairStyle: 0,
  jersey: '#1f6feb',
  jerseyAccent: '#ffd23f',
  helmet: '#f4f4f4',
  bike: '#c0392b',
  build: 0.4,
};

/** Serveur → clients, à 10 Hz. */
export interface WorldSnapshotMsg {
  tick: number;
  t: number;
  riders: RiderSnapshot[];
}

export type GameEventMsg =
  | { kind: 'segmentStart'; riderId: string; segmentId: string }
  | { kind: 'segmentEnd'; riderId: string; segmentId: string; timeMs: number; rank: number; pr: boolean }
  | { kind: 'lap'; riderId: string; lap: number }
  | { kind: 'finish'; riderId: string; rank: number; timeMs: number }
  | { kind: 'countdown'; startsAt: number }
  | { kind: 'chat'; riderId: string; text: string }
  | { kind: 'rideOn'; from: string; to: string };

/** Commandes de l'appli compagnon vers le jeu (relayées par le serveur). */
export type CompanionCommand =
  | { kind: 'shift'; action: 'up' | 'down' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'camera'; camera: CameraMode }
  | { kind: 'fan'; percent: number }
  | { kind: 'rideOn'; to: string }
  | { kind: 'chat'; text: string };

export type CameraMode = 'chase' | 'cockpit' | 'drone' | 'tv' | 'photo';
