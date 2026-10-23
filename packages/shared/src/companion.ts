/**
 * Appli compagnon appairée par QR code : salle Colyseus « pair » qui relie le jeu et un ou
 * plusieurs téléphones, indépendamment des sorties (marche en solo, sans compte).
 *
 * Le jeu tire un jeton d'appairage aléatoire (16 octets, base64url), mémorisé localement, et
 * l'affiche dans un QR code : `…/companion/?pair=<jeton>`. Les deux côtés rejoignent la salle
 * `pair` filtrée sur ce jeton (`joinOrCreate`) ; le jeton fait office de clé, personne d'autre
 * ne peut le deviner. Le serveur relaie sans rien interpréter d'autre que la forme :
 * - téléphone → jeu : `PhoneCommand` (validée) ;
 * - jeu → téléphones : `PairState` (~4 Hz), `PairEvent`, `PairRoute` (carte, profil) ;
 * - serveur → tous : `PairPresence` (jeu connecté ? combien de téléphones ?).
 * Le dernier état et la dernière route sont gardés pour un téléphone qui arrive.
 */
import type { CameraMode } from './net.ts';

export const PAIR_ROOM = 'pair';

export const PAIR_MSG = {
  /** Téléphone → serveur → jeu : `PhoneCommand`. */
  cmd: 'c',
  /** Jeu → serveur → téléphones : `PairState`. */
  state: 's',
  /** Jeu → serveur → téléphones : `PairEvent`. */
  event: 'e',
  /** Jeu → serveur → téléphones : `PairRoute`. */
  route: 'r',
  /** Serveur → tous : `PairPresence`. */
  presence: 'p',
} as const;

export type PairRole = 'game' | 'phone';

export interface PairJoinOptions {
  pair: string;
  role: PairRole;
}

/** Jeton d'appairage : base64url, 16 à 64 caractères. */
export const PAIR_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Téléphones simultanés au plus par jeu. */
export const PAIR_MAX_PHONES = 5;

/** Commandes du téléphone vers le jeu. */
export type PhoneCommand =
  | { kind: 'shift'; action: 'up' | 'down' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'camera'; camera: CameraMode }
  | { kind: 'fan'; percent: number }
  | { kind: 'rideOn'; to: string }
  | { kind: 'chat'; text: string }
  /** Carrefour : −1 plus à gauche, +1 plus à droite ; ou sortie choisie par son indice. */
  | { kind: 'turn'; delta?: -1 | 1; index?: number }
  | { kind: 'uturn' }
  | { kind: 'music'; action: 'toggle' | 'next' | 'previous' | 'volume'; volume?: number }
  | { kind: 'hud' }
  | { kind: 'photo' }
  /** Équipiers IA : « ralentissez », ou allure du groupe ±5 % FTP. */
  | { kind: 'slowDown' }
  | { kind: 'pace'; delta: -1 | 1 }
  /** Demande de l'état complet et de la route (arrivée, retour au premier plan). */
  | { kind: 'sync' };

export interface PairJunction {
  /** Distance au carrefour (m). */
  inM: number;
  selected: number;
  locked: boolean;
  choices: Array<{ dir: string; name: string; unpaved: boolean }>;
}

export interface PairRider {
  id: string;
  name: string;
  /** Écart en mètres (positif = devant). */
  gapM: number;
  wkg: number;
  color: string;
  me?: boolean;
  ai?: boolean;
  online?: boolean;
}

/** État du jeu vu par le téléphone. */
export interface PairState {
  phase: 'menu' | 'ride' | 'paused';
  /** Nom de l'itinéraire, de la route en monde ouvert. */
  routeName?: string;
  road?: string;
  multiplayer?: boolean;
  /** Monde ouvert (choix aux carrefours, demi-tour libre). */
  open?: boolean;
  /** Équipiers IA présents (allure, « ralentissez »). */
  team?: boolean;
  metrics?: {
    speedKmh: number;
    watts: number;
    watts3s: number;
    avgWatts: number;
    np: number;
    cadence: number;
    hr?: number;
    distM: number;
    elapsedS: number;
    elevationGainM: number;
    gradePercent: number;
    altitudeM: number;
    /** Position sur la route (m), pour le profil. */
    routeM: number;
    lap: number;
    draftPct: number;
    ftp: number;
    wkg: number;
    kcal: number;
    gearLabel: string;
    gearIndex: number;
    gearCount: number;
    balanceLeft?: number;
  };
  /** Position et cap dans le repère du monde (carte). */
  pos?: { x: number; z: number; heading: number };
  camera?: CameraMode;
  fanPercent?: number;
  hudVisible?: boolean;
  music?: { source: 'game' | 'spotify'; playing: boolean; title: string; volume: number };
  junction?: PairJunction | null;
  segment?: { name: string; kind: string; progress: number; elapsedS: number } | null;
  workout?: { name: string; targetWatts: number | null; stepRemainingS: number; remainingS: number; next?: string } | null;
  riders?: PairRider[];
}

export type PairEvent =
  | { kind: 'chat'; who: string; text: string }
  | { kind: 'toast'; text: string }
  | { kind: 'rideOn'; from: string };

/** Route pour la carte et le profil : points décimés, entiers (m) x, z, altitude, distance. */
export interface PairRoute {
  name: string;
  loop: boolean;
  lengthM: number;
  /** Monde ouvert : fenêtre du chemin autour du coureur, renvoyée au fil de la sortie. */
  open?: boolean;
  /** Plat : x, z, y, d (m, entiers), ≤ PAIR_ROUTE_MAX_POINTS points. */
  points: number[];
}

/** Assez peu pour tenir sous la limite de 16 Ko par message du transport. */
export const PAIR_ROUTE_MAX_POINTS = 600;

export interface PairPresence {
  game: boolean;
  phones: number;
}

/** Réduit une suite de points (x, z, y, d) à `max` points régulièrement espacés, en entiers. */
export function decimateRoute(pts: Array<{ x: number; z: number; y: number; d: number }>, max = PAIR_ROUTE_MAX_POINTS): number[] {
  const out: number[] = [];
  if (!pts.length) return out;
  const step = Math.max(1, (pts.length - 1) / (max - 1));
  for (let f = 0; ; f += step) {
    const p = pts[Math.min(Math.round(f), pts.length - 1)]!;
    out.push(Math.round(p.x), Math.round(p.z), Math.round(p.y), Math.round(p.d));
    if (Math.round(f) >= pts.length - 1) break;
  }
  return out;
}
