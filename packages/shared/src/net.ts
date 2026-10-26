/**
 * Messages réseau client ↔ serveur (Colyseus). Le serveur est autoritaire à ~10 Hz :
 * le client envoie sa télémétrie (puissance mesurée), le serveur intègre la physique
 * de groupe (drafting, groupe soudé) et diffuse les positions.
 * Position = distance sur l'itinéraire + décalage latéral (m, positif = droite).
 */

import type { RideWeather } from './weather.ts';

export const NET_TICK_HZ = 10;
export const MAX_RIDERS_PER_ROOM = 20;

/** `open` : monde ouvert, carrefours au choix (solo) ; `challenge` : battre son record sur une montée. */
export type RideMode = 'free' | 'group' | 'race' | 'workout' | 'ftpTest' | 'open' | 'challenge';

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
  /**
   * Équipement égalisé : même vélo pour tous (les pièces de l'atelier restent visibles mais ne
   * changent rien). Défaut : actif en course, inactif ailleurs.
   */
  equalEquipment?: boolean;
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

/** Marquages latéraux des chaussures (marques utilisées avec l'accord déclaré par le porteur du projet). */
export const SHOE_MARKS = [
  { id: 'vanrysel', text: 'VAN RYSEL' },
  { id: 'sphyre', text: 'S-PHYRE' },
] as const;
export type ShoeMarkId = (typeof SHOE_MARKS)[number]['id'];

export type JerseyStyle = 'uni' | 'bandes' | 'pois' | 'manches' | 'moitie' | 'degrade' | 'chevrons';

/** Nombre de coiffures (`AvatarLook.hairStyle`) ; 3 = rasé (les noms sont dans l'éditeur de visage). */
export const HAIR_STYLE_COUNT = 10;

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
  /** Couleur des chaussures (facultative pour les profils enregistrés avant). */
  shoes?: string;
  /** Couleur d'accent des chaussures (marquage latéral) ; absente : gris ou blanc selon la chaussure. */
  shoeAccent?: string;
  /** Marquage latéral des chaussures (SHOE_MARKS) ; absent : chaussure unie. */
  shoeMark?: ShoeMarkId;
  /** Couleur des chaussettes. */
  socks?: string;
  /** Hauteur des chaussettes : basses (défaut, au-dessus de la cheville) ou hautes (mi-mollet). */
  sockHeight?: 'low' | 'high';
  /** Cuissard : court (défaut) ou long, jusqu'à la cheville. */
  legs?: 'short' | 'long';
  /** Gants : aucun (défaut), mitaines (doigts nus, jusqu'aux articulations) ou gants longs (toute la main). */
  gloves?: 'none' | 'mitts' | 'full';
  /** Couleur des gants ; absente : noir. */
  gloveColor?: string;
  /** Vélo affiché : route (défaut), gravel ou VTT (selon le vélo équipé au garage). */
  bikeType?: 'road' | 'gravel' | 'mtb';
  /** Curseurs de forme du visage et du corps (face.ts, encodeFace) ; absent : tête de base. */
  face?: string;
  /** Barbe (0 = rasé → 1 = barbe courte), de la couleur des cheveux. */
  beard?: number;
  /** Taches de rousseur (0 → 1). */
  freckles?: number;
  /** Moustache (de la couleur des cheveux). */
  moustache?: boolean;
  /** Nationalité (code ISO 3166-1 alpha-2, countries.ts) : drapeau montré aux autres coureurs. */
  nationality?: string;
  /** Pièces de l'atelier portées (tuning.ts), pour les voir sur le vélo ; validées par le serveur. */
  tune?: string[];
  /**
   * Taille du coureur (cm), reprise du profil (heightCm) : coureur et taille de cadre affichés
   * (de 160 à 195 cm) ; absente : taille du modèle.
   */
  heightCm?: number;
  /**
   * Style du maillot (modèle acheté) : absent, dessin d'origine aux couleurs jersey / jerseyAccent ;
   * « uni » : couleur jersey partout ; « bandes » : uni, plus les bandes de poitrine jerseyBands
   * (maillots de champion) ; « pois » (jerseyDots, de la couleur jerseyAccent), « manches »,
   * « moitie » (bas du maillot), « degrade » (vers l'ourlet) et « chevrons » : la seconde couleur
   * est jerseyAccent.
   */
  jerseyStyle?: JerseyStyle;
  /** Pois du style « pois » : rayon et pas du treillis, en cm ; absent : 3,5 et 12. */
  jerseyDots?: { r: number; step: number };
  /** Bidons sur le vélo : 0, 1 (tube oblique) ou 2 (et tube de selle), dans la limite du cadre ; absent : ceux du modèle. */
  bottles?: 0 | 1 | 2;
  /** Manches du maillot : courtes (défaut) ou longues jusqu'au poignet, pour tous les maillots. */
  sleeves?: 'short' | 'long';
  /** Logo sur la poitrine et le dos (image logos/<id>.png), teinte facultative, largeur en m (0,16). */
  jerseyLogo?: { id: string; tint?: string; w?: number; y?: number };
  /** Bandes de poitrine, de haut en bas (5 au plus), avec jerseyStyle « bandes ». */
  jerseyBands?: string[];
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
  shoes: '#f2f2f2',
  socks: '#f2f2f2',
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
  /** Hôte ou meneur → serveur : `{ active }` lance / arrête un regroupement (sortie de groupe). */
  regroup: 'regroup',
  /** Client → serveur : `{ t }` ; serveur → client : `{ t, serverT }` (estimation d'horloge). */
  ping: 'ping',
} as const;

export type RidePhase = 'lobby' | 'countdown' | 'running' | 'finished';
export type RideRole = 'rider' | 'guest' | 'companion';

/** Options de création étendues (ajouts facultatifs à `RoomOptions`). */
export interface RideRoomOptions extends RoomOptions {
  /** Allure des IA sans humain à suivre (W/kg). Défaut 2,6. */
  aiPaceWkg?: number;
  /** Heure de départ et météo choisies par l'hôte, appliquées à tout le groupe. */
  weather?: RideWeather;
  /** Niveau des IA en fraction de la FTP du créateur (0,6–1,3). Défaut 1. */
  aiLevel?: number;
  /** Sortie de groupe : allure annoncée (W/kg) ; absente = libre. */
  paceWkg?: number;
  /** Sortie de groupe avec IA : vitesse moyenne visée (km/h) ; absente = libre. */
  targetKmh?: number;
}

/** Options modifiables par l'hôte en cours de sortie. */
export interface HostOptions {
  allowGuests: boolean;
  stickyGroup: boolean;
  draftingStrength: number;
  /** Sortie de groupe : allure annoncée par le meneur (W/kg), null = libre. Les IA la tiennent. */
  paceWkg: number | null;
  /** Sortie de groupe : vitesse moyenne visée par les IA (km/h), null = libre. */
  targetKmh: number | null;
  /** Sortie de groupe : meneur (identifiant de coureur) ; '' = l'hôte. */
  leaderId: string;
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
  /** Course en cours ou terminée : classement à l'instant de l'accueil (arrivées, abandons). */
  results?: RideResult[];
  /** Course : heure limite d'arrivée (epoch ms) une fois le premier arrivé. */
  deadline?: number;
  /** Options d'hôte courantes (allure annoncée, meneur…). */
  hostOptions?: HostOptions;
  /** Sortie de groupe : regroupement en cours. */
  regrouping?: boolean;
}

/** État du jeu affiché par l'appli compagnon (relayé tel quel). */
export interface CompanionStateMsg {
  gear?: number;
  gearLabel?: string;
  paused?: boolean;
  camera?: CameraMode;
  fanPercent?: number;
}

/**
 * État d'un coureur au classement d'une course :
 * `finished` arrivé et classé, `racing` encore en course, `dnf` abandon (a quitté la course),
 * `otl` hors délai, `dq` mis hors course (puissance invraisemblable), `unranked` hors
 * classement (invité, arrivé après le départ).
 */
export type RaceStatus = 'finished' | 'racing' | 'dnf' | 'otl' | 'dq' | 'unranked';

export interface RideResult {
  riderId: string;
  name: string;
  /** Rang au classement (0 = non classé : invité ou non arrivé). */
  rank: number;
  timeMs: number;
  isAI: boolean;
  isGuest: boolean;
  /** Ajouts (facultatifs pour la compatibilité) : état, écart au vainqueur, primes. */
  status?: RaceStatus;
  /** Écart au vainqueur (ms), arrivés seulement. */
  gapMs?: number;
  /** Points du classement de la montagne et du sprint (primes KOM / sprint). */
  komPts?: number;
  sprintPts?: number;
  /** Distance de course parcourue (m) — utile pour les non-arrivés. */
  distM?: number;
}

/** Points attribués aux trois premiers au sommet d'un KOM / sur la ligne d'un sprint. */
export const PRIME_POINTS: readonly number[] = [5, 3, 1];

/** Événements de la salle : `GameEventMsg` + ajouts. */
export type RideEventMsg =
  | GameEventMsg
  | { kind: 'phase'; phase: RidePhase; startsAt?: number }
  | { kind: 'host'; riderId: string }
  | { kind: 'join'; riderId: string; name: string }
  | { kind: 'leave'; riderId: string }
  | { kind: 'results'; results: RideResult[] }
  | { kind: 'options'; options: HostOptions }
  | { kind: 'error'; code: string; message: string }
  /** Course : prime d'un segment KOM / sprint (ordre de passage, 3 premiers). */
  | { kind: 'prime'; segmentId: string; segmentKind: 'kom' | 'sprint'; riderId: string; place: number; points: number; lap: number }
  /** Course : heure limite d'arrivée après le premier arrivé. */
  | { kind: 'deadline'; at: number }
  /** Course : abandon (coureur parti) ; il apparaît « DNF » au classement. */
  | { kind: 'abandon'; riderId: string; name: string }
  /** Contrôle de puissance : avertissement (puissance plafonnée) ou mise hors course. */
  | { kind: 'flag'; riderId: string; action: 'warn' | 'dq'; reason: string }
  /** Sortie de groupe : regroupement en cours ou terminé (écart tête – queue). */
  | { kind: 'regroup'; active: boolean; spreadM: number }
  /** Sortie de groupe : le groupe s'est scindé (écart tête – queue des humains, m). */
  | { kind: 'split'; gapM: number };

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
