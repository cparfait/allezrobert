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
  /** Nom affiché de la sortie (ajout). */
  name?: string;
  /** Nombre de tours d'une course sur boucle (ajout, défaut 1). */
  laps?: number;
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
  /** Décalage latéral souhaité (m, positif = à droite dans le sens de marche ; voie de droite ≈ +1,2 m). */
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
  /** Couleur du vélo de base (sans modèle du catalogue). */
  bike: string;
  /** Modèle du catalogue de vélos (bikes.ts) ; absent : vélo de base de la couleur `bike`. */
  bikeModel?: string;
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

export type CameraMode = 'chase' | 'cockpit' | 'gopro' | 'drone' | 'tv' | 'photo';

/* ────────────────────────────────────────────────────────────────────────────
 * Extension du protocole de salle « ride » (serveur apps/server, client apps/client/src/net,
 * appli compagnon). Choix : messages Colyseus simples (msgpack) plutôt que l'état Schema :
 * - les données statiques d'un coureur (nom, avatar, badges) partent une seule fois dans
 *   la liste des coureurs (`RosterMsg`), à chaque arrivée / départ ;
 * - l'instantané à 10 Hz ne contient que les champs dynamiques, quantifiés en entiers dans
 *   un tableau plat (`CompactSnapshotMsg`) : ~25 octets par coureur, ~0,5 Ko par tick à
 *   20 coureurs, contre ~8 Ko en objets `RiderSnapshot` complets.
 * `decodeSnapshot()` reconstitue un `WorldSnapshotMsg` complet côté client.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Types de messages de la salle « ride ». */
export const NET_MSG = {
  /** Client → serveur : `TelemetryMsg` (10 Hz). */
  telemetry: 't',
  /** Serveur → clients : `CompactSnapshotMsg` (10 Hz). */
  snapshot: 's',
  /** Serveur → clients : `RosterMsg` (arrivées, départs, changement d'hôte). */
  roster: 'roster',
  /** Serveur → client : `WelcomeMsg` à l'entrée (et après reconnexion). */
  welcome: 'welcome',
  /** Serveur → clients : `RideEventMsg`. */
  event: 'ev',
  /** Client → serveur : `{ text }`. */
  chat: 'chat',
  /** Client → serveur : `{ to }` (identifiant de coureur). */
  rideOn: 'rideOn',
  /** Compagnon → serveur : `CompanionCommand` ; serveur → jeu : `CompanionCommand` relayée. */
  companion: 'cmp',
  /** Jeu → serveur → compagnons du même compte : `CompanionStateMsg`. */
  companionState: 'cmpState',
  /** Hôte → serveur : `{ countdownS? }` lance le compte à rebours. */
  start: 'start',
  /** Hôte → serveur : `Partial<HostOptions>`. */
  options: 'opts',
  /** Hôte → serveur : `{ riderId }` exclut un coureur. */
  kick: 'kick',
  /** Hôte → serveur : `{ riderId }` cède le rôle d'hôte. */
  host: 'host',
  /** Client → serveur : `{ t }` ; serveur → client : `{ t, serverT }` (estimation d'horloge). */
  ping: 'ping',
} as const;

export type RidePhase = 'lobby' | 'countdown' | 'running' | 'finished';
export type RideRole = 'rider' | 'guest' | 'companion';

/** Options de création étendues (ajouts facultatifs à `RoomOptions`). */
export interface RideRoomOptions extends RoomOptions {
  /** Allure des IA sans humain à suivre (W/kg). Défaut 2,6. */
  aiPaceWkg?: number;
}

/** Options modifiables par l'hôte en cours de sortie. */
export interface HostOptions {
  allowGuests: boolean;
  stickyGroup: boolean;
  draftingStrength: number;
}

/** Options d'entrée dans une salle (`client.joinById(roomId, options)`). */
export interface RideJoinOptions {
  /** Code d'invitation (obligatoire sauf pour le créateur). */
  inviteCode?: string;
  /** Jeton de jeu (`GET /api/auth/game-token`) ; sinon cookie de session si même origine. */
  token?: string;
  role?: RideRole;
  /** Nom d'un invité anonyme (sans compte). */
  displayName?: string;
}

/** Données statiques d'un coureur, diffusées à chaque changement de la liste. */
export interface RosterEntry {
  /** Indice compact utilisé dans les instantanés. */
  n: number;
  id: string;
  name: string;
  avatar: AvatarLook;
  isAI: boolean;
  isGuest: boolean;
  isHost: boolean;
  /** Faux pendant la fenêtre de reconnexion. */
  connected: boolean;
  ftpWatts?: number;
  massKg?: number;
}

export interface RosterMsg {
  hostId: string;
  riders: RosterEntry[];
}

/** Itinéraire résumé pour la carte (compagnon) et la vérification côté jeu. */
export interface RouteSummary {
  id: string;
  name: string;
  loop: boolean;
  lengthM: number;
  elevationGainM: number;
  roadWidthM: number;
  segments: Array<{ id: string; kind: 'kom' | 'sprint' | 'section'; name: string; startM: number; endM: number; avgGrade: number }>;
  /** Polyligne décimée : x, z, y (m) à plat, un point tous les ~25 m. */
  polyline: number[];
}

export interface WelcomeMsg {
  roomId: string;
  inviteCode: string;
  role: RideRole;
  /** Identifiant de son coureur ; pour un compagnon : celui du jeu du même compte ('' si absent). */
  selfId: string;
  hostId: string;
  options: RideRoomOptions;
  phase: RidePhase;
  startsAt?: number;
  /** Heure serveur (epoch ms) à l'envoi. */
  serverTime: number;
  tickHz: number;
  route: RouteSummary;
  roster: RosterMsg;
}

/** État du jeu affiché par l'appli compagnon (relayé tel quel). */
export interface CompanionStateMsg {
  gear?: number;
  gearLabel?: string;
  paused?: boolean;
  camera?: CameraMode;
  fanPercent?: number;
}

export interface RideResult {
  riderId: string;
  name: string;
  /** Rang au classement (0 = non classé : invité ou non arrivé). */
  rank: number;
  timeMs: number;
  isAI: boolean;
  isGuest: boolean;
}

/** Événements de la salle : `GameEventMsg` + ajouts. */
export type RideEventMsg =
  | GameEventMsg
  | { kind: 'phase'; phase: RidePhase; startsAt?: number }
  | { kind: 'host'; riderId: string }
  | { kind: 'join'; riderId: string; name: string }
  | { kind: 'leave'; riderId: string }
  | { kind: 'results'; results: RideResult[] }
  | { kind: 'options'; options: HostOptions }
  | { kind: 'error'; code: string; message: string };

/** Ligne dynamique d'un coureur (entrée de l'encodeur compact). */
export interface SnapshotRow {
  n: number;
  /** Distance dans le tour, [0, longueur). */
  distM: number;
  lateralM: number;
  speedMs: number;
  watts: number;
  cadence: number;
  hr?: number;
  draftPct: number;
  lap: number;
  pose: 'seated' | 'standing' | 'coasting';
}

/**
 * Instantané compact : `r` = tableau plat de `SNAPSHOT_STRIDE` entiers par coureur :
 * [n, distance (cm), latéral (cm), vitesse (cm/s), watts, cadence, FC (−1 = absente),
 *  aspiration (‰), tour, posture (0 assis, 1 danseuse, 2 roue libre)].
 */
export interface CompactSnapshotMsg {
  /** Numéro de tick serveur. */
  k: number;
  /** Heure serveur (epoch ms). */
  t: number;
  r: number[];
}

export const SNAPSHOT_STRIDE = 10;
const POSES = ['seated', 'standing', 'coasting'] as const;

export function encodeSnapshot(tick: number, t: number, rows: ArrayLike<SnapshotRow>, out: number[] = []): CompactSnapshotMsg {
  out.length = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as SnapshotRow;
    out.push(
      r.n,
      Math.round(r.distM * 100),
      Math.round(r.lateralM * 100),
      Math.round(r.speedMs * 100),
      Math.round(r.watts),
      Math.round(r.cadence),
      r.hr === undefined ? -1 : Math.round(r.hr),
      Math.round(r.draftPct * 10),
      r.lap,
      r.pose === 'standing' ? 1 : r.pose === 'coasting' ? 2 : 0,
    );
  }
  return { k: tick, t, r: out };
}

/** Reconstitue un `WorldSnapshotMsg` complet à partir de l'instantané compact et de la liste. */
export function decodeSnapshot(msg: CompactSnapshotMsg, roster: ReadonlyMap<number, RosterEntry>): WorldSnapshotMsg {
  const riders: RiderSnapshot[] = [];
  const r = msg.r;
  for (let i = 0; i + SNAPSHOT_STRIDE <= r.length; i += SNAPSHOT_STRIDE) {
    const entry = roster.get(r[i] as number);
    if (!entry) continue;
    const hr = r[i + 6] as number;
    const snap: RiderSnapshot = {
      id: entry.id,
      name: entry.name,
      distM: (r[i + 1] as number) / 100,
      lateralM: (r[i + 2] as number) / 100,
      speedMs: (r[i + 3] as number) / 100,
      watts: r[i + 4] as number,
      cadence: r[i + 5] as number,
      draftPct: (r[i + 7] as number) / 10,
      isAI: entry.isAI,
      isGuest: entry.isGuest,
      lap: r[i + 8] as number,
      avatar: entry.avatar,
      pose: POSES[r[i + 9] as number] ?? 'seated',
    };
    if (hr >= 0) snap.hr = hr;
    riders.push(snap);
  }
  return { tick: msg.k, t: msg.t, riders };
}

/** Distance « dépliée » (tour × longueur + distance), utile au drafting et à l'interpolation. */
export function unwrappedDistance(snap: Pick<RiderSnapshot, 'distM' | 'lap'>, lengthM: number): number {
  return snap.lap * lengthM + snap.distM;
}
