/**
 * Historique d'entraînement du jeu : chaque sortie terminée est gardée sur l'appareil (SQLite dans
 * l'appli de bureau, stockage du navigateur sinon), avec ses mesures (NP, IF, TSS, courbe, zones),
 * l'historique des FTP, les records et les séances perso. Connecté à un compte, tout est
 * synchronisé avec le serveur (`POST /api/history/sync`), dans les deux sens.
 */
import { WORKOUT_LIBRARY, classifyRideType, trainingSummary, type TrainingSample } from '@allezrobert/physics';
import {
  HISTORY_SYNC_MAX_RIDES,
  type FtpSource,
  type HistorySyncRequest,
  type HistorySyncResponse,
  type PowerRecordTuple,
  type RideFeedback,
  type RideKind,
} from '@allezrobert/shared';
import { BrowserHistoryStore } from './browserStore.ts';
import { SqliteHistoryStore, type SqlDriver, type SqlValue } from './sqliteStore.ts';
import type { HistoryStore, LocalRide, LocalWorkout, PendingSync, RideFilter } from './types.ts';
import { totals, type HistoryTotals } from './analytics.ts';

export type { LocalRide, LocalWorkout, LocalFtp, RideFilter } from './types.ts';
export * from './analytics.ts';

/** Ce qu'il faut pour enregistrer une sortie terminée. */
export interface RideInput {
  /** Début de la sortie (ms) : sert aussi d'identifiant (`ar-<début>`), une sortie reprise remplace la précédente. */
  startT: number;
  name: string;
  routeId: string | null;
  kind: RideKind;
  workoutId?: string | null;
  workoutName?: string | null;
  durationS: number;
  movingS: number;
  distanceM: number;
  elevationM: number;
  ftpWatts: number;
  /** Échantillons à 1 Hz (puissance, FC, cadence). */
  samples: readonly TrainingSample[];
}

/** Statut de la dernière synchronisation (affiché dans l'historique). */
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'ok' | 'offline' | 'error';
  at: number | null;
  pushed: number;
  pulled: number;
  error?: string;
}

/** Résumé gardé en mémoire (lu sans attendre par le menu : compteur de km, fiche des parcours). */
export interface HistorySummary {
  /** Depuis la première sortie. */
  totals: HistoryTotals;
  /** Par parcours : nombre de sorties et dernière sortie. */
  byRoute: Map<string, { count: number; last: LocalRide }>;
}

/** Envoi HTTP vers l'API (remplaçable dans les tests). */
export type HistoryFetch = (path: string, init: RequestInit) => Promise<Response>;

const CHUNK = Math.min(50, HISTORY_SYNC_MAX_RIDES);
const LEGACY_DONE = 'legacyImported';
const TYPES_FILLED = 'trainingTypesFilled';

export const rideClientId = (startT: number): string => `ar-${Math.round(startT)}`;

export class HistoryService {
  private account: string | null = null;
  private readyP: Promise<void> | null = null;
  private syncing: Promise<SyncStatus> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  status: SyncStatus = { state: 'idle', at: null, pushed: 0, pulled: 0 };
  /** Résumé à jour (null avant la première lecture de la base). */
  summary: HistorySummary | null = null;
  private readonly listeners = new Set<() => void>();
  private summaryP: Promise<void> | null = null;

  constructor(
    readonly store: HistoryStore,
    private readonly fetchApi: HistoryFetch | null,
    private readonly legacy: { getItem(key: string): string | null } | null = typeof localStorage !== 'undefined' ? localStorage : null,
  ) {}

  /** Ouvre la base (migrations) et importe une fois les anciennes données du stockage local. */
  ready(currentFtp?: number): Promise<void> {
    this.readyP ??= (async () => {
      await this.store.init();
      if (!(await this.store.getMeta(LEGACY_DONE))) {
        await this.importLegacy(currentFtp);
        await this.store.setMeta(LEGACY_DONE, String(Date.now()));
      }
      if (!(await this.store.getMeta(TYPES_FILLED))) {
        await this.fillTrainingTypes();
        await this.store.setMeta(TYPES_FILLED, String(Date.now()));
      }
      await this.refreshSummary();
    })();
    return this.readyP;
  }

  /** Prévenu à chaque changement (nouvelle sortie, suppression, synchronisation) ; renvoie de quoi se désabonner. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Recalcule le résumé en mémoire (toutes les sorties visibles), puis prévient les abonnés. */
  private refreshSummary(): Promise<void> {
    // À la suite du calcul en cours (un changement arrivé pendant celui-ci est toujours pris en compte).
    const run = async () => {
      const all = await this.store.listRides({ account: this.visibleAccount() });
      const byRoute = new Map<string, { count: number; last: LocalRide }>();
      for (const r of all) {
        if (!r.routeId) continue;
        const cur = byRoute.get(r.routeId);
        // Liste du plus récent au plus ancien : la première vue est la dernière roulée.
        if (cur) cur.count++;
        else byRoute.set(r.routeId, { count: 1, last: r });
      }
      this.summary = { totals: totals(all), byRoute };
      this.notify();
    };
    const next = (this.summaryP ?? Promise.resolve()).then(run, run);
    this.summaryP = next;
    return next;
  }

  get currentAccount(): string | null {
    return this.account;
  }

  /** Compte connecté (null : déconnecté) ; à la connexion, synchronisation en arrière-plan. */
  setAccount(id: string | null): void {
    const changed = id !== this.account;
    this.account = id;
    if (changed && this.readyP) void this.readyP.then(() => this.refreshSummary());
    if (id && changed) this.scheduleSync(500);
  }

  /** Enregistre une sortie terminée ; renvoie la sortie gardée. */
  async recordRide(input: RideInput): Promise<LocalRide> {
    await this.ready();
    const t = trainingSummary(input.samples, input.ftpWatts);
    const hasPower = input.samples.some((s) => (s.watts ?? 0) > 0);
    const clientId = rideClientId(input.startT);
    const prev = await this.store.getRide(clientId);
    const libraryType = input.workoutId ? WORKOUT_LIBRARY.find((w) => w.id === input.workoutId)?.type : undefined;
    const ride: LocalRide = {
      clientId,
      serverId: prev?.serverId ?? null,
      account: prev?.account ?? this.account,
      name: input.name.slice(0, 100),
      routeId: input.routeId,
      kind: input.kind,
      workoutId: input.workoutId ?? null,
      workoutName: input.workoutName ?? null,
      trainingType: libraryType ?? (hasPower ? classifyRideType(t.zonesS, t.intensity) : null),
      startedAt: input.startT,
      utcOffsetMin: -new Date(input.startT).getTimezoneOffset(),
      durationS: Math.round(input.durationS),
      movingS: Math.round(input.movingS),
      distanceM: input.distanceM,
      elevationM: input.elevationM,
      avgSpeedKmh: input.movingS > 0 ? (input.distanceM / input.movingS) * 3.6 : null,
      avgWatts: hasPower ? t.avgWatts : null,
      maxWatts: hasPower ? t.maxWatts : null,
      np: hasPower ? t.np : null,
      intensity: hasPower ? t.intensity : null,
      tss: hasPower ? t.tss : null,
      workKJ: hasPower ? t.workKJ : null,
      avgCadence: t.avgCadence,
      avgHr: t.avgHr,
      maxHr: t.maxHr,
      ftpAtRide: input.ftpWatts,
      feedback: prev?.feedback ?? null,
      curve: t.curve.map((p) => [p.durationS, Math.round(p.watts * 10) / 10]),
      zonesS: hasPower ? t.zonesS : [],
      hasFit: prev?.hasFit ?? false,
      updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1),
      syncedAt: prev?.syncedAt ?? null,
    };
    await this.store.putRide(ride);
    await this.store.mergePowerRecords(
      ride.curve.map(([d, w]) => [d, w, input.startT] as PowerRecordTuple),
      true,
    );
    this.changed();
    return ride;
  }

  /** Change un champ modifiable d'une sortie (nom, ressenti) ; la nouvelle version sera synchronisée. */
  async updateRide(clientId: string, patch: { name?: string; feedback?: RideFeedback | null; hasFit?: boolean }): Promise<void> {
    const r = await this.store.getRide(clientId);
    if (!r) return;
    await this.store.putRide({ ...r, ...patch, updatedAt: Math.max(Date.now(), r.updatedAt + 1) });
    this.changed();
  }

  async deleteRide(clientId: string): Promise<void> {
    const r = await this.store.getRide(clientId);
    if (!r) return;
    // Jamais synchronisée : rien à dire au serveur.
    await this.store.deleteRide(clientId, r.syncedAt !== null || !!r.serverId);
    this.changed();
  }

  rides(filter: RideFilter = {}): Promise<LocalRide[]> {
    return this.ready().then(() => this.store.listRides({ account: this.visibleAccount(), ...filter }));
  }

  countRides(filter: RideFilter = {}): Promise<number> {
    return this.ready().then(() => this.store.countRides({ account: this.visibleAccount(), ...filter }));
  }

  /** Connecté : ses sorties et celles jouées sans compte ; déconnecté : tout ce qui est sur l'appareil. */
  private visibleAccount(): string | null | undefined {
    return this.account ?? undefined;
  }

  /** Nouvelle FTP (test, saisie) : gardée dans l'historique si elle change. */
  async addFtp(ftpWatts: number, source: FtpSource, rideStartT?: number): Promise<void> {
    await this.ready();
    const w = Math.round(ftpWatts);
    if (!(w >= 30 && w <= 700)) return;
    const list = await this.store.listFtp(this.visibleAccount());
    if (list.at(-1)?.ftpWatts === w && source === 'manual') return;
    const now = Date.now();
    await this.store.putFtp({ clientId: `ftp-${now}-${Math.random().toString(36).slice(2, 8)}`, account: this.account, recordedAt: now, ftpWatts: w, source, rideClientId: rideStartT ? rideClientId(rideStartT) : null, synced: false });
    this.changed();
  }

  async ftpHistory() {
    await this.ready();
    return this.store.listFtp(this.visibleAccount());
  }

  async powerRecords(): Promise<PowerRecordTuple[]> {
    await this.ready();
    return this.store.powerRecords();
  }

  /** Séances perso (importées ou créées). */
  async workouts(): Promise<LocalWorkout[]> {
    await this.ready();
    return this.store.listWorkouts({ account: this.visibleAccount() });
  }

  async saveWorkout(w: Omit<LocalWorkout, 'account' | 'syncedAt' | 'updatedAt'> & { updatedAt?: number }): Promise<void> {
    await this.ready();
    const prev = (await this.store.listWorkouts({ includeDeleted: true })).find((x) => x.id === w.id);
    await this.store.putWorkout({ ...w, account: prev?.account ?? this.account, syncedAt: prev?.syncedAt ?? null, updatedAt: Math.max(w.updatedAt ?? Date.now(), (prev?.updatedAt ?? 0) + 1) });
    this.changed();
  }

  async deleteWorkout(id: string): Promise<void> {
    const prev = (await this.store.listWorkouts({ includeDeleted: true })).find((x) => x.id === id);
    if (prev) await this.store.putWorkout({ ...prev, deleted: true, updatedAt: Math.max(Date.now(), prev.updatedAt + 1) });
    this.changed();
  }

  private changed(): void {
    void this.refreshSummary();
    if (this.account) this.scheduleSync(3000);
  }

  /** Synchronisation regroupée (plusieurs changements rapprochés = un seul envoi). */
  scheduleSync(delayMs = 3000): void {
    if (!this.fetchApi || !this.account) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.sync();
    }, delayMs);
  }

  /** Envoie ce qui a changé ici, reçoit ce qui a changé ailleurs. */
  sync(): Promise<SyncStatus> {
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(): Promise<SyncStatus> {
    const account = this.account;
    if (!account || !this.fetchApi) return this.status;
    await this.ready();
    this.status = { ...this.status, state: 'syncing' };
    this.notify();
    let pushed = 0;
    let pulled = 0;
    try {
      const sinceKey = `since:${account}`;
      const since = Number((await this.store.getMeta(sinceKey)) ?? 0);
      const pending = await this.store.pending(account);
      // Par paquets ; le dernier envoi (éventuellement vide) rapporte les changements du serveur.
      const chunks: PendingSync[] = [];
      for (let i = 0; i === 0 || i < pending.rides.length; i += CHUNK) {
        chunks.push({
          rides: pending.rides.slice(i, i + CHUNK),
          ...(i === 0 ? { deletedRides: pending.deletedRides, ftp: pending.ftp, workouts: pending.workouts, powerRecords: pending.powerRecords } : { deletedRides: [], ftp: [], workouts: [], powerRecords: [] }),
        });
      }
      let last: HistorySyncResponse | null = null;
      for (const chunk of chunks) {
        const body: HistorySyncRequest = {
          since,
          rides: chunk.rides.map(({ account: _a, syncedAt: _s, ...r }) => r),
          deletedRides: chunk.deletedRides,
          ftp: chunk.ftp.map(({ account: _a, synced: _s, ...f }) => f),
          workouts: chunk.workouts.map(({ account: _a, syncedAt: _s, ...w }) => w),
          powerRecords: chunk.powerRecords,
        };
        const res = await this.fetchApi('/history/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`serveur ${res.status}`);
        last = (await res.json()) as HistorySyncResponse;
        await this.store.markSynced(account, chunk, last.mapped, last.serverTime);
        pushed += chunk.rides.length;
      }
      if (last) {
        pulled = await this.applyRemote(account, last);
        await this.store.setMeta(sinceKey, String(last.serverTime));
      }
      this.status = { state: 'ok', at: Date.now(), pushed, pulled };
    } catch (e) {
      const offline = e instanceof TypeError;
      this.status = { state: offline ? 'offline' : 'error', at: this.status.at, pushed, pulled, ...(offline ? {} : { error: (e as Error).message }) };
    }
    await this.refreshSummary();
    return this.status;
  }

  /** Applique les changements du serveur sans écraser ce qui a été modifié ici depuis. */
  private async applyRemote(account: string, r: HistorySyncResponse): Promise<number> {
    let n = 0;
    for (const remote of r.rides) {
      const local = await this.store.getRide(remote.clientId);
      const dirty = local && (local.syncedAt === null || local.updatedAt > local.syncedAt);
      if (dirty) continue;
      await this.store.putRide({
        ...remote,
        // Sans consentement FC, le serveur ne la garde pas : on garde celle de l'appareil.
        avgHr: remote.avgHr ?? local?.avgHr ?? null,
        maxHr: remote.maxHr ?? local?.maxHr ?? null,
        account,
        updatedAt: remote.updatedAt,
        syncedAt: remote.updatedAt,
      });
      if (!local) n++;
    }
    for (const id of r.deletedRides) await this.store.deleteRide(id, false);
    const knownFtp = new Set((await this.store.listFtp()).map((f) => f.clientId));
    for (const f of r.ftp) if (!knownFtp.has(f.clientId)) await this.store.putFtp({ ...f, account, synced: true });
    const localWorkouts = new Map((await this.store.listWorkouts({ includeDeleted: true })).map((w) => [w.id, w]));
    for (const w of r.workouts) {
      const cur = localWorkouts.get(w.id);
      if (!cur || (w.updatedAt > cur.updatedAt && !(cur.syncedAt === null || cur.updatedAt > cur.syncedAt))) {
        await this.store.putWorkout({ ...w, account, syncedAt: w.updatedAt });
      }
    }
    await this.store.mergePowerRecords(r.powerRecords, false);
    return n;
  }

  /** Type d'entraînement des sorties gardées avant qu'il existe (séance, sinon zones) ; renvoyé au serveur. */
  private async fillTrainingTypes(): Promise<void> {
    for (const r of await this.store.listRides()) {
      if (r.trainingType) continue;
      const type = (r.workoutId ? WORKOUT_LIBRARY.find((w) => w.id === r.workoutId)?.type : undefined) ?? classifyRideType(r.zonesS, r.intensity);
      if (type) await this.store.putRide({ ...r, trainingType: type, updatedAt: Math.max(Date.now(), r.updatedAt + 1) });
    }
  }

  /** Anciennes données du stockage local : 20 dernières sorties et records de puissance. */
  private async importLegacy(currentFtp?: number): Promise<void> {
    if (!this.legacy) return;
    const read = <T>(k: string): T | null => {
      try {
        const raw = this.legacy!.getItem(k);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    };
    const old = read<Array<{ routeId: string; date: number; distanceM: number; movingS: number; avgSpeedKmh: number; avgWatts: number; np: number }>>('ar.history') ?? [];
    const ftp = currentFtp && currentFtp > 0 ? currentFtp : null;
    for (const h of old) {
      if (!h || typeof h.date !== 'number') continue;
      const clientId = rideClientId(h.date);
      if (await this.store.getRide(clientId)) continue;
      // TSS estimé avec la FTP actuelle (celle du jour de la sortie n'était pas gardée).
      const intensity = ftp && h.np ? h.np / ftp : null;
      await this.store.putRide({
        clientId,
        serverId: null,
        account: null,
        name: 'Sortie Allez Robert !',
        routeId: h.routeId ?? null,
        kind: 'free',
        startedAt: h.date,
        utcOffsetMin: -new Date(h.date).getTimezoneOffset(),
        durationS: h.movingS,
        movingS: h.movingS,
        distanceM: h.distanceM,
        elevationM: 0,
        avgSpeedKmh: h.avgSpeedKmh ?? null,
        avgWatts: h.avgWatts ?? null,
        maxWatts: null,
        np: h.np ?? null,
        intensity,
        tss: intensity && ftp ? ((h.movingS * h.np * intensity) / (ftp * 3600)) * 100 : null,
        workKJ: h.avgWatts ? (h.avgWatts * h.movingS) / 1000 : null,
        avgCadence: null,
        ftpAtRide: ftp,
        curve: [],
        zonesS: [],
        updatedAt: Date.now(),
        syncedAt: null,
      });
    }
    const records = read<Record<string, number>>('ar.powerRecords');
    if (records) {
      const now = Date.now();
      await this.store.mergePowerRecords(
        Object.entries(records)
          .map(([d, w]) => [Number(d), Number(w), now] as PowerRecordTuple)
          .filter(([d, w]) => d > 0 && w > 0),
        true,
      );
    }
    if (ftp && (await this.store.listFtp()).length === 0) {
      await this.store.putFtp({ clientId: `ftp-import-${Date.now()}`, account: null, recordedAt: Date.now(), ftpWatts: Math.round(ftp), source: 'import', rideClientId: null, synced: false });
    }
  }
}

/** Accès SQLite de l'appli de bureau (commandes localdb.rs). */
export function tauriSqlDriver(invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>): SqlDriver {
  return {
    execute: (sql: string, params: SqlValue[] = []) => invoke<{ changes: number }>('localdb_execute', { sql, params }),
    query: (sql: string, params: SqlValue[] = []) => invoke<Array<Record<string, SqlValue>>>('localdb_query', { sql, params }),
    batch: async (statements) => {
      await invoke('localdb_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    },
  };
}

export { SqliteHistoryStore, BrowserHistoryStore };
