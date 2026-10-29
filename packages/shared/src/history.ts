/**
 * Historique d'entraînement échangé entre le jeu (base locale) et le serveur : sorties résumées,
 * historique des FTP, séances perso, records de puissance. Les dates sont en ms depuis l'époque (UTC).
 * Synchronisation : `POST /api/history/sync` envoie ce qui a changé localement et reçoit ce qui a
 * changé sur le serveur depuis `since` (autre appareil, sortie importée).
 */

/** Nature de la sortie (filtres de l'historique). */
export type RideKind = 'free' | 'workout' | 'race' | 'group' | 'ftp_test';
export const RIDE_KINDS: readonly RideKind[] = ['free', 'workout', 'race', 'group', 'ftp_test'];

/** Ressenti donné après la sortie. */
export type RideFeedback = 'easy' | 'right' | 'hard' | 'failed';
export const RIDE_FEEDBACKS: readonly RideFeedback[] = ['easy', 'right', 'hard', 'failed'];

/** Origine d'une FTP : saisie, test rampe, test 20 min, estimation, ancienne valeur importée. */
export type FtpSource = 'manual' | 'ramp' | '20min' | 'estimate' | 'import';
export const FTP_SOURCES: readonly FtpSource[] = ['manual', 'ramp', '20min', 'estimate', 'import'];

/** Une sortie résumée (sans les échantillons : ils restent dans le FIT). */
export interface HistoryRide {
  /** Identifiant stable créé par l'appareil qui a enregistré la sortie (`ar-<début ms>`). */
  clientId: string;
  /** Identifiant de l'activité sur le serveur, une fois synchronisée. */
  serverId?: string | null;
  name: string;
  routeId: string | null;
  kind: RideKind;
  workoutId?: string | null;
  workoutName?: string | null;
  /** Type d'entraînement (recovery … anaerobic) : celui de la séance, sinon estimé d'après les zones. */
  trainingType?: string | null;
  startedAt: number;
  /** Décalage UTC local au départ (min), pour ranger la sortie dans le bon jour. */
  utcOffsetMin: number;
  durationS: number;
  movingS: number;
  distanceM: number;
  elevationM: number;
  avgSpeedKmh: number | null;
  avgWatts: number | null;
  maxWatts: number | null;
  np: number | null;
  intensity: number | null;
  tss: number | null;
  workKJ: number | null;
  avgCadence: number | null;
  /** FC : gardée en local ; sur le serveur seulement avec le consentement FC du compte. */
  avgHr?: number | null;
  maxHr?: number | null;
  ftpAtRide: number | null;
  feedback?: RideFeedback | null;
  /** Courbe de puissance : [durée (s), watts]. */
  curve: Array<[number, number]>;
  /** Secondes en zones Z1 à Z7 (7 valeurs) ; vide si inconnu. */
  zonesS: number[];
  /** Le fichier FIT est sur le serveur. */
  hasFit?: boolean;
  updatedAt: number;
}

export interface HistoryFtp {
  clientId: string;
  recordedAt: number;
  ftpWatts: number;
  source: FtpSource;
  rideClientId?: string | null;
}

/** Séance perso (étapes au format `Workout` de @allezrobert/physics). */
export interface HistoryWorkout {
  id: string;
  name: string;
  source: 'custom' | 'zwo' | 'erg' | 'mrc';
  type?: string | null;
  description?: string | null;
  steps: unknown[];
  deleted?: boolean;
  updatedAt: number;
}

/** Record de puissance : [durée (s), watts, date ms]. */
export type PowerRecordTuple = [number, number, number];

export interface HistorySyncRequest {
  /** Dernière synchronisation réussie (`serverTime` reçu), 0 la première fois. */
  since: number;
  rides: HistoryRide[];
  /** Sorties supprimées sur l'appareil (clientId). */
  deletedRides: string[];
  ftp: HistoryFtp[];
  workouts: HistoryWorkout[];
  powerRecords: PowerRecordTuple[];
}

export interface HistorySyncResponse {
  serverTime: number;
  /** Sorties envoyées → identifiant serveur. */
  mapped: Array<{ clientId: string; serverId: string }>;
  /** Changements du serveur depuis `since` (y compris ceux qu'on vient d'envoyer). */
  rides: HistoryRide[];
  deletedRides: string[];
  ftp: HistoryFtp[];
  workouts: HistoryWorkout[];
  powerRecords: PowerRecordTuple[];
}

/** Limites d'un envoi (le jeu découpe au-delà). */
export const HISTORY_SYNC_MAX_RIDES = 200;
