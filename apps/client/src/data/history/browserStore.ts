/**
 * Historique dans le stockage du navigateur (jeu ouvert dans un navigateur, sans l'appli de bureau) :
 * même interface que la base SQLite, données gardées en JSON sous une seule clé. Quelques milliers de
 * sorties tiennent largement (≈ 0,5 Ko chacune).
 */
import type { PowerRecordTuple } from '@allezrobert/shared';
import type { HistoryStore, LocalFtp, LocalRide, LocalWorkout, PendingSync, RideFilter } from './types.ts';

interface Data {
  version: 1;
  rides: Record<string, LocalRide>;
  deleted: Record<string, { account: string | null; at: number }>;
  ftp: Record<string, LocalFtp>;
  workouts: Record<string, LocalWorkout>;
  records: Record<string, { watts: number; at: number; dirty: boolean }>;
  meta: Record<string, string>;
}

export const BROWSER_HISTORY_KEY = 'ar.historyDb';

const empty = (): Data => ({ version: 1, rides: {}, deleted: {}, ftp: {}, workouts: {}, records: {}, meta: {} });

/** Stockage clé → texte (localStorage dans le jeu, objet en mémoire dans les tests). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ofAccount = (a: string | null, account: string | null | undefined): boolean => account === undefined || a === null || (account !== null && a === account);

export class BrowserHistoryStore implements HistoryStore {
  readonly kind = 'browser';
  private data: Data = empty();

  constructor(private readonly kv: KeyValue = localStorage) {}

  async init(): Promise<void> {
    try {
      const raw = this.kv.getItem(BROWSER_HISTORY_KEY);
      if (raw) this.data = { ...empty(), ...(JSON.parse(raw) as Data) };
    } catch {
      this.data = empty();
    }
  }

  private save(): void {
    try {
      this.kv.setItem(BROWSER_HISTORY_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Historique : stockage du navigateur plein ou indisponible', e);
    }
  }

  async putRide(ride: LocalRide): Promise<void> {
    this.data.rides[ride.clientId] = structuredClone(ride);
    delete this.data.deleted[ride.clientId];
    this.save();
  }

  async getRide(clientId: string): Promise<LocalRide | null> {
    const r = this.data.rides[clientId];
    return r ? structuredClone(r) : null;
  }

  private filtered(f: RideFilter): LocalRide[] {
    return Object.values(this.data.rides)
      .filter((r) => (f.from === undefined || r.startedAt >= f.from) && (f.to === undefined || r.startedAt < f.to) && (!f.kind || r.kind === f.kind) && (!f.trainingType || r.trainingType === f.trainingType) && (!f.routeId || r.routeId === f.routeId) && ofAccount(r.account, f.account))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async listRides(f: RideFilter = {}): Promise<LocalRide[]> {
    const off = f.offset ?? 0;
    return structuredClone(this.filtered(f).slice(off, f.limit !== undefined ? off + f.limit : undefined));
  }

  async countRides(f: RideFilter = {}): Promise<number> {
    return this.filtered(f).length;
  }

  async deleteRide(clientId: string, tombstone: boolean): Promise<void> {
    const r = this.data.rides[clientId];
    delete this.data.rides[clientId];
    if (tombstone && r) this.data.deleted[clientId] = { account: r.account, at: Date.now() };
    this.save();
  }

  async putFtp(f: LocalFtp): Promise<void> {
    this.data.ftp[f.clientId] = { ...f };
    this.save();
  }

  async listFtp(account?: string | null): Promise<LocalFtp[]> {
    return Object.values(this.data.ftp)
      .filter((f) => ofAccount(f.account, account))
      .sort((a, b) => a.recordedAt - b.recordedAt)
      .map((f) => ({ ...f }));
  }

  async putWorkout(w: LocalWorkout): Promise<void> {
    this.data.workouts[w.id] = structuredClone(w);
    this.save();
  }

  async listWorkouts(opts: { account?: string | null; includeDeleted?: boolean } = {}): Promise<LocalWorkout[]> {
    return structuredClone(
      Object.values(this.data.workouts)
        .filter((w) => (opts.includeDeleted || !w.deleted) && ofAccount(w.account, opts.account))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async powerRecords(): Promise<PowerRecordTuple[]> {
    return Object.entries(this.data.records)
      .map(([d, r]) => [Number(d), r.watts, r.at] as PowerRecordTuple)
      .sort((a, b) => a[0] - b[0]);
  }

  async mergePowerRecords(list: readonly PowerRecordTuple[], dirty: boolean): Promise<void> {
    let changed = false;
    for (const [d, w, at] of list) {
      const cur = this.data.records[d];
      if (!cur || w > cur.watts) {
        this.data.records[d] = { watts: w, at, dirty };
        changed = true;
      }
    }
    if (changed) this.save();
  }

  async getMeta(key: string): Promise<string | null> {
    return this.data.meta[key] ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.data.meta[key] = value;
    this.save();
  }

  async pending(account: string): Promise<PendingSync> {
    return structuredClone({
      rides: Object.values(this.data.rides)
        .filter((r) => ofAccount(r.account, account) && (r.syncedAt === null || r.updatedAt > r.syncedAt))
        .sort((a, b) => a.startedAt - b.startedAt),
      deletedRides: Object.entries(this.data.deleted)
        .filter(([, d]) => ofAccount(d.account, account))
        .map(([id]) => id),
      ftp: Object.values(this.data.ftp).filter((f) => ofAccount(f.account, account) && !f.synced),
      workouts: Object.values(this.data.workouts).filter((w) => ofAccount(w.account, account) && (w.syncedAt === null || w.updatedAt > w.syncedAt)),
      powerRecords: Object.entries(this.data.records)
        .filter(([, r]) => r.dirty)
        .map(([d, r]) => [Number(d), r.watts, r.at] as PowerRecordTuple),
    });
  }

  async markSynced(account: string, sent: PendingSync, mapped: ReadonlyArray<{ clientId: string; serverId: string }>, at: number): Promise<void> {
    const server = new Map(mapped.map((m) => [m.clientId, m.serverId]));
    for (const s of sent.rides) {
      const r = this.data.rides[s.clientId];
      if (!r || r.updatedAt !== s.updatedAt) continue;
      r.syncedAt = s.updatedAt;
      r.account = account;
      r.serverId = server.get(s.clientId) ?? r.serverId ?? null;
    }
    for (const id of sent.deletedRides) delete this.data.deleted[id];
    for (const f of sent.ftp) {
      const cur = this.data.ftp[f.clientId];
      if (cur) Object.assign(cur, { synced: true, account });
    }
    for (const w of sent.workouts) {
      const cur = this.data.workouts[w.id];
      if (cur && cur.updatedAt === w.updatedAt) Object.assign(cur, { syncedAt: w.updatedAt, account });
    }
    for (const r of Object.values(this.data.records)) if (r.at <= at) r.dirty = false;
    this.save();
  }
}
