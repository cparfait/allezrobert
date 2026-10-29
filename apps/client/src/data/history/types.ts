/**
 * Historique local du jeu : sorties résumées, FTP, records de puissance, séances perso. Deux
 * stockages pour la même interface : SQLite dans l'appli de bureau (`profil/historique.sqlite`),
 * stockage du navigateur ailleurs. Format des données : celui de la synchronisation (@allezrobert/shared).
 */
import type { HistoryFtp, HistoryRide, HistoryWorkout, PowerRecordTuple, RideKind } from '@allezrobert/shared';

/** Sortie telle que gardée sur l'appareil. */
export interface LocalRide extends HistoryRide {
  /** Compte auquel la sortie appartient (null : jouée sans compte, rattachée au premier compte synchronisé). */
  account: string | null;
  /** Dernière synchronisation réussie de cette version (null : jamais). */
  syncedAt: number | null;
}

export interface LocalFtp extends HistoryFtp {
  account: string | null;
  synced: boolean;
}

export interface LocalWorkout extends HistoryWorkout {
  account: string | null;
  syncedAt: number | null;
}

export interface RideFilter {
  limit?: number;
  offset?: number;
  /** Début ≥ from (ms). */
  from?: number;
  /** Début < to (ms). */
  to?: number;
  kind?: RideKind;
  /** Type d'entraînement (recovery … anaerobic). */
  trainingType?: string;
  routeId?: string;
  /** Sorties de ce compte et sans compte ; undefined = toutes. */
  account?: string | null;
}

/** Ce qui reste à envoyer au serveur pour un compte. */
export interface PendingSync {
  rides: LocalRide[];
  deletedRides: string[];
  ftp: LocalFtp[];
  workouts: LocalWorkout[];
  powerRecords: PowerRecordTuple[];
}

export interface HistoryStore {
  readonly kind: 'sqlite' | 'browser';
  init(): Promise<void>;
  /** Ajoute ou remplace une sortie (clé : clientId), avec sa courbe et ses zones. */
  putRide(ride: LocalRide): Promise<void>;
  getRide(clientId: string): Promise<LocalRide | null>;
  /** Plus récentes d'abord. */
  listRides(filter?: RideFilter): Promise<LocalRide[]>;
  countRides(filter?: RideFilter): Promise<number>;
  /** Supprime ; `tombstone` : la suppression sera envoyée au serveur. */
  deleteRide(clientId: string, tombstone: boolean): Promise<void>;
  putFtp(f: LocalFtp): Promise<void>;
  listFtp(account?: string | null): Promise<LocalFtp[]>;
  putWorkout(w: LocalWorkout): Promise<void>;
  listWorkouts(opts?: { account?: string | null; includeDeleted?: boolean }): Promise<LocalWorkout[]>;
  /** Records gardés (meilleur par durée). */
  powerRecords(): Promise<PowerRecordTuple[]>;
  /** Fusionne des records (garde le meilleur) ; `dirty` : à envoyer au serveur. */
  mergePowerRecords(list: readonly PowerRecordTuple[], dirty: boolean): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  pending(account: string): Promise<PendingSync>;
  /** Après un envoi réussi : versions envoyées marquées, sorties rattachées au compte. */
  markSynced(account: string, sent: PendingSync, mapped: ReadonlyArray<{ clientId: string; serverId: string }>, at: number): Promise<void>;
}
