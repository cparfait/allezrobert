/**
 * Historique en SQLite (appli de bureau : commandes `localdb_*` de localdb.rs). Le schéma est
 * versionné par `PRAGMA user_version` ; chaque migration est un script appliqué une seule fois.
 */
import type { PowerRecordTuple, RideFeedback, RideKind } from '@allezrobert/shared';
import type { HistoryStore, LocalFtp, LocalRide, LocalWorkout, PendingSync, RideFilter } from './types.ts';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/** Accès SQL minimal (Tauri dans le jeu, node:sqlite dans les tests). */
export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  query(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  /** Instructions dans une transaction (tout ou rien). */
  batch(statements: Array<{ sql: string; params?: SqlValue[] }>): Promise<void>;
}

/** Migrations, dans l'ordre : ne jamais modifier une migration publiée, en ajouter une. */
export const LOCAL_MIGRATIONS: string[] = [
  `CREATE TABLE rides (
     client_id TEXT PRIMARY KEY,
     server_id TEXT,
     account TEXT,
     name TEXT NOT NULL,
     route_id TEXT,
     kind TEXT NOT NULL DEFAULT 'free',
     workout_id TEXT,
     workout_name TEXT,
     training_type TEXT,
     started_at INTEGER NOT NULL,
     utc_offset_min INTEGER NOT NULL DEFAULT 0,
     duration_s REAL NOT NULL,
     moving_s REAL NOT NULL,
     distance_m REAL NOT NULL,
     elevation_m REAL NOT NULL,
     avg_speed_kmh REAL,
     avg_watts REAL,
     max_watts REAL,
     np REAL,
     intensity REAL,
     tss REAL,
     work_kj REAL,
     avg_cadence REAL,
     avg_hr REAL,
     max_hr REAL,
     ftp_at_ride REAL,
     feedback TEXT,
     has_fit INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     synced_at INTEGER
   );
   CREATE INDEX rides_started_at ON rides (started_at);
   CREATE INDEX rides_account ON rides (account, started_at);
   CREATE TABLE ride_power_curve (
     client_id TEXT NOT NULL REFERENCES rides (client_id) ON DELETE CASCADE,
     duration_s INTEGER NOT NULL,
     watts REAL NOT NULL,
     PRIMARY KEY (client_id, duration_s)
   ) WITHOUT ROWID;
   CREATE TABLE ride_zone_time (
     client_id TEXT NOT NULL REFERENCES rides (client_id) ON DELETE CASCADE,
     zone INTEGER NOT NULL,
     seconds REAL NOT NULL,
     PRIMARY KEY (client_id, zone)
   ) WITHOUT ROWID;
   CREATE TABLE deleted_rides (
     client_id TEXT PRIMARY KEY,
     account TEXT,
     deleted_at INTEGER NOT NULL
   );
   CREATE TABLE ftp_history (
     client_id TEXT PRIMARY KEY,
     account TEXT,
     recorded_at INTEGER NOT NULL,
     ftp_watts INTEGER NOT NULL,
     source TEXT NOT NULL,
     ride_client_id TEXT,
     synced INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX ftp_history_recorded_at ON ftp_history (recorded_at);
   CREATE TABLE power_records (
     duration_s INTEGER PRIMARY KEY,
     watts REAL NOT NULL,
     recorded_at INTEGER NOT NULL,
     dirty INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE workouts (
     id TEXT PRIMARY KEY,
     account TEXT,
     name TEXT NOT NULL,
     source TEXT NOT NULL,
     type TEXT,
     description TEXT,
     steps TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     synced_at INTEGER
   );
   CREATE TABLE meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

const num = (v: SqlValue | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));

const RIDE_COLS = `client_id, server_id, account, name, route_id, kind, workout_id, workout_name, training_type, started_at, utc_offset_min, duration_s, moving_s,
  distance_m, elevation_m, avg_speed_kmh, avg_watts, max_watts, np, intensity, tss, work_kj, avg_cadence, avg_hr, max_hr, ftp_at_ride,
  feedback, has_fit, updated_at, synced_at`;

/** `account = ? OR account IS NULL` (compte connecté) ; rien si undefined. */
function accountWhere(account: string | null | undefined, where: string[], params: SqlValue[]): void {
  if (account === undefined) return;
  if (account === null) where.push('account IS NULL');
  else {
    where.push('(account = ? OR account IS NULL)');
    params.push(account);
  }
}

export class SqliteHistoryStore implements HistoryStore {
  readonly kind = 'sqlite';

  constructor(private readonly db: SqlDriver) {}

  async init(): Promise<void> {
    const v = num((await this.db.query('PRAGMA user_version'))[0]?.user_version);
    for (let i = v; i < LOCAL_MIGRATIONS.length; i++) {
      await this.db.batch([{ sql: LOCAL_MIGRATIONS[i]! }, { sql: `PRAGMA user_version = ${i + 1}` }]);
    }
  }

  async putRide(r: LocalRide): Promise<void> {
    const stmts: Array<{ sql: string; params?: SqlValue[] }> = [
      {
        sql: `INSERT OR REPLACE INTO rides (${RIDE_COLS}) VALUES (${new Array(30).fill('?').join(', ')})`,
        params: [
          r.clientId, r.serverId ?? null, r.account, r.name, r.routeId, r.kind, r.workoutId ?? null, r.workoutName ?? null, r.trainingType ?? null, r.startedAt, r.utcOffsetMin,
          r.durationS, r.movingS, r.distanceM, r.elevationM, r.avgSpeedKmh, r.avgWatts, r.maxWatts, r.np, r.intensity, r.tss, r.workKJ, r.avgCadence,
          r.avgHr ?? null, r.maxHr ?? null, r.ftpAtRide, r.feedback ?? null, r.hasFit ? 1 : 0, r.updatedAt, r.syncedAt,
        ],
      },
      // INSERT OR REPLACE supprime l'ancienne ligne (et ses courbes en cascade) : on réécrit tout.
      { sql: 'DELETE FROM ride_power_curve WHERE client_id = ?', params: [r.clientId] },
      { sql: 'DELETE FROM ride_zone_time WHERE client_id = ?', params: [r.clientId] },
      { sql: 'DELETE FROM deleted_rides WHERE client_id = ?', params: [r.clientId] },
    ];
    for (const [d, w] of r.curve) stmts.push({ sql: 'INSERT INTO ride_power_curve (client_id, duration_s, watts) VALUES (?, ?, ?)', params: [r.clientId, d, w] });
    r.zonesS.forEach((sec, z) => {
      if (sec > 0) stmts.push({ sql: 'INSERT INTO ride_zone_time (client_id, zone, seconds) VALUES (?, ?, ?)', params: [r.clientId, z + 1, sec] });
    });
    await this.db.batch(stmts);
  }

  async getRide(clientId: string): Promise<LocalRide | null> {
    const rows = await this.db.query(`SELECT ${RIDE_COLS} FROM rides WHERE client_id = ?`, [clientId]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  private filterSql(f: RideFilter): { where: string; params: SqlValue[] } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    const add = (clause: string, value: SqlValue) => {
      where.push(clause);
      params.push(value);
    };
    if (f.from !== undefined) add('started_at >= ?', f.from);
    if (f.to !== undefined) add('started_at < ?', f.to);
    if (f.kind) add('kind = ?', f.kind);
    if (f.trainingType) add('training_type = ?', f.trainingType);
    if (f.routeId) add('route_id = ?', f.routeId);
    accountWhere(f.account, where, params);
    return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  async listRides(f: RideFilter = {}): Promise<LocalRide[]> {
    const { where, params } = this.filterSql(f);
    const rows = await this.db.query(`SELECT ${RIDE_COLS} FROM rides ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`, [...params, f.limit ?? -1, f.offset ?? 0]);
    return this.hydrate(rows);
  }

  async countRides(f: RideFilter = {}): Promise<number> {
    const { where, params } = this.filterSql(f);
    return num((await this.db.query(`SELECT COUNT(*) AS n FROM rides ${where}`, params))[0]?.n);
  }

  async deleteRide(clientId: string, tombstone: boolean): Promise<void> {
    const ride = await this.getRide(clientId);
    const stmts: Array<{ sql: string; params?: SqlValue[] }> = [{ sql: 'DELETE FROM rides WHERE client_id = ?', params: [clientId] }];
    if (tombstone && ride) stmts.push({ sql: 'INSERT OR REPLACE INTO deleted_rides (client_id, account, deleted_at) VALUES (?, ?, ?)', params: [clientId, ride.account, Date.now()] });
    await this.db.batch(stmts);
  }

  async putFtp(f: LocalFtp): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO ftp_history (client_id, account, recorded_at, ftp_watts, source, ride_client_id, synced) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      f.clientId, f.account, f.recordedAt, f.ftpWatts, f.source, f.rideClientId ?? null, f.synced ? 1 : 0,
    ]);
  }

  async listFtp(account?: string | null): Promise<LocalFtp[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    accountWhere(account, where, params);
    const rows = await this.db.query(`SELECT * FROM ftp_history ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY recorded_at`, params);
    return rows.map((x) => ({
      clientId: String(x.client_id),
      account: str(x.account),
      recordedAt: num(x.recorded_at),
      ftpWatts: num(x.ftp_watts),
      source: String(x.source) as LocalFtp['source'],
      rideClientId: str(x.ride_client_id),
      synced: num(x.synced) === 1,
    }));
  }

  async putWorkout(w: LocalWorkout): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO workouts (id, account, name, source, type, description, steps, deleted, updated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      w.id, w.account, w.name, w.source, w.type ?? null, w.description ?? null, JSON.stringify(w.steps), w.deleted ? 1 : 0, w.updatedAt, w.syncedAt,
    ]);
  }

  async listWorkouts(opts: { account?: string | null; includeDeleted?: boolean } = {}): Promise<LocalWorkout[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (!opts.includeDeleted) where.push('deleted = 0');
    accountWhere(opts.account, where, params);
    const rows = await this.db.query(`SELECT * FROM workouts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`, params);
    return rows.map((x) => ({
      id: String(x.id),
      account: str(x.account),
      name: String(x.name),
      source: String(x.source) as LocalWorkout['source'],
      type: str(x.type),
      description: str(x.description),
      steps: JSON.parse(String(x.steps)) as unknown[],
      deleted: num(x.deleted) === 1,
      updatedAt: num(x.updated_at),
      syncedAt: numOrNull(x.synced_at),
    }));
  }

  async powerRecords(): Promise<PowerRecordTuple[]> {
    const rows = await this.db.query('SELECT duration_s, watts, recorded_at FROM power_records ORDER BY duration_s');
    return rows.map((x) => [num(x.duration_s), num(x.watts), num(x.recorded_at)]);
  }

  async mergePowerRecords(list: readonly PowerRecordTuple[], dirty: boolean): Promise<void> {
    if (list.length === 0) return;
    await this.db.batch(
      list.map(([d, w, at]) => ({
        sql: `INSERT INTO power_records (duration_s, watts, recorded_at, dirty) VALUES (?, ?, ?, ?)
              ON CONFLICT (duration_s) DO UPDATE SET watts = excluded.watts, recorded_at = excluded.recorded_at, dirty = excluded.dirty
              WHERE excluded.watts > power_records.watts`,
        params: [d, w, at, dirty ? 1 : 0],
      })),
    );
  }

  async getMeta(key: string): Promise<string | null> {
    return str((await this.db.query('SELECT value FROM meta WHERE key = ?', [key]))[0]?.value);
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  async pending(account: string): Promise<PendingSync> {
    const rides = await this.hydrate(
      await this.db.query(`SELECT ${RIDE_COLS} FROM rides WHERE (account = ? OR account IS NULL) AND (synced_at IS NULL OR updated_at > synced_at) ORDER BY started_at`, [account]),
    );
    const deleted = await this.db.query('SELECT client_id FROM deleted_rides WHERE account = ? OR account IS NULL', [account]);
    const ftp = (await this.listFtp(account)).filter((f) => !f.synced);
    const workouts = (await this.listWorkouts({ account, includeDeleted: true })).filter((w) => w.syncedAt === null || w.updatedAt > w.syncedAt);
    const records = await this.db.query('SELECT duration_s, watts, recorded_at FROM power_records WHERE dirty = 1');
    return {
      rides,
      deletedRides: deleted.map((x) => String(x.client_id)),
      ftp,
      workouts,
      powerRecords: records.map((x) => [num(x.duration_s), num(x.watts), num(x.recorded_at)]),
    };
  }

  async markSynced(account: string, sent: PendingSync, mapped: ReadonlyArray<{ clientId: string; serverId: string }>, at: number): Promise<void> {
    const server = new Map(mapped.map((m) => [m.clientId, m.serverId]));
    const stmts: Array<{ sql: string; params?: SqlValue[] }> = [];
    // `synced_at` = version envoyée : une modification faite pendant l'envoi reste à envoyer.
    for (const r of sent.rides) stmts.push({ sql: 'UPDATE rides SET synced_at = ?, account = ?, server_id = COALESCE(?, server_id) WHERE client_id = ? AND updated_at = ?', params: [r.updatedAt, account, server.get(r.clientId) ?? null, r.clientId, r.updatedAt] });
    for (const id of sent.deletedRides) stmts.push({ sql: 'DELETE FROM deleted_rides WHERE client_id = ?', params: [id] });
    for (const f of sent.ftp) stmts.push({ sql: 'UPDATE ftp_history SET synced = 1, account = ? WHERE client_id = ?', params: [account, f.clientId] });
    for (const w of sent.workouts) stmts.push({ sql: 'UPDATE workouts SET synced_at = ?, account = ? WHERE id = ? AND updated_at = ?', params: [w.updatedAt, account, w.id, w.updatedAt] });
    if (sent.powerRecords.length) stmts.push({ sql: 'UPDATE power_records SET dirty = 0 WHERE recorded_at <= ?', params: [at] });
    if (stmts.length) await this.db.batch(stmts);
  }

  private async hydrate(rows: SqlRow[]): Promise<LocalRide[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.client_id));
    const curves = new Map<string, Array<[number, number]>>();
    const zones = new Map<string, number[]>();
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const ph = chunk.map(() => '?').join(', ');
      for (const x of await this.db.query(`SELECT client_id, duration_s, watts FROM ride_power_curve WHERE client_id IN (${ph}) ORDER BY duration_s`, chunk)) {
        const list = curves.get(String(x.client_id)) ?? [];
        list.push([num(x.duration_s), num(x.watts)]);
        curves.set(String(x.client_id), list);
      }
      for (const x of await this.db.query(`SELECT client_id, zone, seconds FROM ride_zone_time WHERE client_id IN (${ph})`, chunk)) {
        const list = zones.get(String(x.client_id)) ?? new Array<number>(7).fill(0);
        list[num(x.zone) - 1] = num(x.seconds);
        zones.set(String(x.client_id), list);
      }
    }
    return rows.map((x) => {
      const id = String(x.client_id);
      return {
        clientId: id,
        serverId: str(x.server_id),
        account: str(x.account),
        name: String(x.name),
        routeId: str(x.route_id),
        kind: String(x.kind) as RideKind,
        workoutId: str(x.workout_id),
        workoutName: str(x.workout_name),
        trainingType: str(x.training_type),
        startedAt: num(x.started_at),
        utcOffsetMin: num(x.utc_offset_min),
        durationS: num(x.duration_s),
        movingS: num(x.moving_s),
        distanceM: num(x.distance_m),
        elevationM: num(x.elevation_m),
        avgSpeedKmh: numOrNull(x.avg_speed_kmh),
        avgWatts: numOrNull(x.avg_watts),
        maxWatts: numOrNull(x.max_watts),
        np: numOrNull(x.np),
        intensity: numOrNull(x.intensity),
        tss: numOrNull(x.tss),
        workKJ: numOrNull(x.work_kj),
        avgCadence: numOrNull(x.avg_cadence),
        avgHr: numOrNull(x.avg_hr),
        maxHr: numOrNull(x.max_hr),
        ftpAtRide: numOrNull(x.ftp_at_ride),
        feedback: str(x.feedback) as RideFeedback | null,
        curve: curves.get(id) ?? [],
        zonesS: zones.get(id) ?? [],
        hasFit: num(x.has_fit) === 1,
        updatedAt: num(x.updated_at),
        syncedAt: numOrNull(x.synced_at),
      };
    });
  }
}
