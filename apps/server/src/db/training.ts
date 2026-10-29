/**
 * Dépôt SQL de l'historique d'entraînement (migrations/006_training_history.sql) : mesures des
 * sorties, courbes de puissance, temps par zone, historique des FTP, records, séances perso, et
 * synchronisation avec la base locale du jeu. La FC d'une sortie n'est gardée (chiffrée) qu'avec
 * le consentement FC du compte, comme pour les FIT.
 */
import { randomUUID } from 'node:crypto';
import type { FtpSource, HistoryFtp, HistoryRide, HistoryWorkout, PowerRecordTuple, RideFeedback, RideKind } from '@allezrobert/shared';
import type { Db, Queryable } from './db.ts';
import type { DataCipher } from '../crypto.ts';

/** Mesures d'entraînement d'une sortie, calculées depuis le FIT ou envoyées par le jeu. */
export interface TrainingFields {
  kind?: RideKind;
  workoutId?: string | null;
  workoutName?: string | null;
  trainingType?: string | null;
  utcOffsetMin?: number;
  ftpAtRide: number | null;
  np: number | null;
  intensity: number | null;
  tss: number | null;
  workKJ: number | null;
  avgCadence: number | null;
  avgSpeedKmh: number | null;
  feedback?: RideFeedback | null;
  curve: ReadonlyArray<readonly [number, number]>;
  zonesS: readonly number[];
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));
const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : toNum(v));
const toJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

/** `($2, $3, …)` pour une liste de paramètres commençant à `first`. */
const placeholders = (n: number, first = 1): string => Array.from({ length: n }, (_, i) => `$${i + first}`).join(', ');

const RIDE_COLUMNS = `id, client_ride_id, name, route_id, kind, workout_id, workout_name, training_type, started_at, utc_offset_min, duration_s, moving_s,
  distance_m, elevation_m, avg_speed_kmh, avg_watts, max_watts, np, intensity, tss, work_kj, avg_cadence, hr_summary_enc,
  ftp_at_ride, feedback, fit_size, updated_at`;

export class TrainingRepo {
  constructor(
    readonly db: Db,
    private readonly cipher: DataCipher,
  ) {}

  /** Même codec bytea que `Repos` (pg-mem : base64). */
  private bin(b: Buffer | null): Buffer | string | null {
    if (b === null) return null;
    return this.db.kind === 'memory' ? b.toString('base64') : b;
  }

  private unbin(v: unknown): Buffer {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v));
    return this.db.kind === 'memory' ? Buffer.from(b.toString('utf8'), 'base64') : b;
  }

  /* ───────────── Mesures d'une sortie ───────────── */

  /** Enregistre les mesures d'une sortie (remplace courbe et zones) et met à jour les records. */
  async setTraining(q: Queryable, userId: string, activityId: string, t: TrainingFields, startedAt: Date): Promise<void> {
    await q.query(
      `UPDATE activities SET kind = COALESCE($3, kind), workout_id = COALESCE($4, workout_id), workout_name = COALESCE($5, workout_name),
              utc_offset_min = COALESCE($6, utc_offset_min), ftp_at_ride = $7, np = $8, intensity = $9, tss = $10, work_kj = $11,
              avg_cadence = $12, avg_speed_kmh = $13, feedback = COALESCE($14, feedback), training_type = COALESCE($15, training_type),
              aggregates_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [activityId, userId, t.kind ?? null, t.workoutId ?? null, t.workoutName ?? null, t.utcOffsetMin ?? null, t.ftpAtRide, t.np, t.intensity, t.tss, t.workKJ, t.avgCadence, t.avgSpeedKmh, t.feedback ?? null, t.trainingType ?? null],
    );
    await q.query('DELETE FROM activity_power_curve WHERE activity_id = $1', [activityId]);
    await q.query('DELETE FROM activity_zone_time WHERE activity_id = $1', [activityId]);
    for (const [d, w] of t.curve) {
      if (!(d > 0 && w > 0)) continue;
      await q.query('INSERT INTO activity_power_curve (activity_id, duration_s, watts) VALUES ($1, $2, $3)', [activityId, Math.round(d), w]);
      await this.mergePowerRecord(q, userId, d, w, startedAt, activityId);
    }
    for (let z = 0; z < Math.min(7, t.zonesS.length); z++) {
      const sec = Math.round(t.zonesS[z]!);
      if (sec > 0) await q.query('INSERT INTO activity_zone_time (activity_id, zone, seconds) VALUES ($1, $2, $3)', [activityId, z + 1, sec]);
    }
  }

  /** Garde le meilleur watt par durée. */
  async mergePowerRecord(q: Queryable, userId: string, durationS: number, watts: number, at: Date, activityId: string | null = null): Promise<void> {
    await q.query(
      `INSERT INTO power_records (user_id, duration_s, watts, recorded_at, activity_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, duration_s) DO UPDATE SET watts = EXCLUDED.watts, recorded_at = EXCLUDED.recorded_at, activity_id = EXCLUDED.activity_id
       WHERE power_records.watts < EXCLUDED.watts`,
      [userId, Math.round(durationS), watts, at, activityId],
    );
  }

  /** Activité correspondant à une sortie de la base locale du jeu. */
  async byClientId(userId: string, clientId: string, q: Queryable = this.db): Promise<{ id: string; hasFit: boolean } | null> {
    const r = await q.query('SELECT id, fit_size FROM activities WHERE user_id = $1 AND client_ride_id = $2', [userId, clientId]);
    const row = r.rows[0];
    return row ? { id: row.id, hasFit: row.fit_size !== null } : null;
  }

  /**
   * Sortie envoyée par le jeu sans FIT (ou avant lui) : création, ou mise à jour des champs
   * résumés si elle existe déjà. Renvoie l'identifiant serveur.
   */
  async upsertSyncedRide(userId: string, ride: HistoryRide, consentHr: boolean): Promise<string> {
    return this.db.tx(async (q) => {
      const existing = await this.byClientId(userId, ride.clientId, q);
      const id = existing?.id ?? randomUUID();
      const hr = consentHr && (ride.avgHr != null || ride.maxHr != null) ? { avg: ride.avgHr ?? undefined, max: ride.maxHr ?? undefined } : null;
      const hrEnc = hr ? this.bin(this.cipher.encryptJson(hr, `act-hr:${id}`)) : null;
      const startedAt = new Date(ride.startedAt);
      if (existing) {
        // Une sortie avec FIT garde son résumé calculé sur le serveur ; seuls nom, séance et ressenti suivent le jeu.
        if (existing.hasFit) {
          await q.query('UPDATE activities SET name = $2, feedback = COALESCE($3, feedback), kind = $4, workout_id = $5, workout_name = $6, updated_at = now() WHERE id = $1', [
            id, ride.name.slice(0, 100), ride.feedback ?? null, ride.kind, ride.workoutId ?? null, ride.workoutName ?? null,
          ]);
          return id;
        }
        await q.query(
          `UPDATE activities SET name = $2, started_at = $3, duration_s = $4, moving_s = $5, distance_m = $6, elevation_m = $7,
                  avg_watts = $8, max_watts = $9, hr_summary_enc = $10, route_id = $11 WHERE id = $1`,
          [id, ride.name.slice(0, 100), startedAt, Math.round(ride.durationS), Math.round(ride.movingS), ride.distanceM, ride.elevationM, ride.avgWatts, ride.maxWatts, hrEnc, ride.routeId],
        );
      } else {
        await q.query(
          `INSERT INTO activities (id, user_id, name, started_at, duration_s, moving_s, distance_m, elevation_m, avg_watts, max_watts,
                                   hr_summary_enc, xp, route_id, skip_strava, client_ride_id, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,true,$13,'sync')`,
          [id, userId, ride.name.slice(0, 100), startedAt, Math.round(ride.durationS), Math.round(ride.movingS), ride.distanceM, ride.elevationM, ride.avgWatts, ride.maxWatts, hrEnc, ride.routeId, ride.clientId],
        );
      }
      await this.setTraining(q, userId, id, rideTraining(ride), startedAt);
      await q.query('DELETE FROM deleted_rides WHERE user_id = $1 AND client_ride_id = $2', [userId, ride.clientId]);
      return id;
    });
  }

  /** Supprime une sortie ; la suppression est notée pour les autres appareils. */
  async deleteRide(userId: string, id: string): Promise<boolean> {
    return this.db.tx(async (q) => {
      const r = await q.query('SELECT client_ride_id FROM activities WHERE user_id = $1 AND id = $2', [userId, id]);
      if (!r.rows[0]) return false;
      const clientId = r.rows[0].client_ride_id as string | null;
      await q.query('DELETE FROM activities WHERE user_id = $1 AND id = $2', [userId, id]);
      if (clientId) await this.noteDeleted(q, userId, clientId);
      return true;
    });
  }

  async deleteByClientId(userId: string, clientId: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM activities WHERE user_id = $1 AND client_ride_id = $2', [userId, clientId]);
      await this.noteDeleted(q, userId, clientId);
    });
  }

  private async noteDeleted(q: Queryable, userId: string, clientId: string): Promise<void> {
    await q.query(
      `INSERT INTO deleted_rides (user_id, client_ride_id, deleted_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id, client_ride_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
      [userId, clientId],
    );
  }

  /* ───────────── Lecture ───────────── */

  async listRides(userId: string, f: { limit: number; offset: number; from?: Date; to?: Date; kind?: RideKind; trainingType?: string; routeId?: string } = { limit: 50, offset: 0 }): Promise<HistoryRide[]> {
    const where = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (f.from) where.push(`started_at >= $${params.push(f.from)}`);
    if (f.to) where.push(`started_at < $${params.push(f.to)}`);
    if (f.kind) where.push(`kind = $${params.push(f.kind)}`);
    if (f.trainingType) where.push(`training_type = $${params.push(f.trainingType)}`);
    if (f.routeId) where.push(`route_id = $${params.push(f.routeId)}`);
    const r = await this.db.query(
      `SELECT ${RIDE_COLUMNS} FROM activities WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT $${params.push(f.limit)} OFFSET $${params.push(f.offset)}`,
      params,
    );
    return this.mapRides(r.rows);
  }

  async getRide(userId: string, id: string): Promise<HistoryRide | null> {
    const r = await this.db.query(`SELECT ${RIDE_COLUMNS} FROM activities WHERE user_id = $1 AND id = $2`, [userId, id]);
    return (await this.mapRides(r.rows))[0] ?? null;
  }

  /** Totaux de l'historique (nombre, distance, temps, dénivelé, TSS). */
  async totals(userId: string, from?: Date): Promise<{ rides: number; distanceM: number; movingS: number; elevationM: number; tss: number }> {
    const r = await this.db.query(
      `SELECT COUNT(*) AS n, SUM(distance_m) AS d, SUM(moving_s) AS m, SUM(elevation_m) AS e, SUM(tss) AS t
         FROM activities WHERE user_id = $1${from ? ' AND started_at >= $2' : ''}`,
      from ? [userId, from] : [userId],
    );
    const row = r.rows[0] ?? {};
    return { rides: toNum(row.n ?? 0), distanceM: toNum(row.d ?? 0), movingS: toNum(row.m ?? 0), elevationM: toNum(row.e ?? 0), tss: toNum(row.t ?? 0) };
  }

  /** TSS des sorties (pour la charge), depuis une date. */
  async tssRows(userId: string, from: Date): Promise<Array<{ startedAt: number; utcOffsetMin: number; tss: number | null }>> {
    const r = await this.db.query('SELECT started_at, utc_offset_min, tss FROM activities WHERE user_id = $1 AND started_at >= $2 AND tss IS NOT NULL', [userId, from]);
    return r.rows.map((x: any) => ({ startedAt: toDate(x.started_at).getTime(), utcOffsetMin: toNum(x.utc_offset_min), tss: numOrNull(x.tss) }));
  }

  /** Secondes par zone et par sortie depuis une date (regroupées par semaine dans l'API). */
  async zoneRows(userId: string, from: Date): Promise<Array<{ startedAt: number; utcOffsetMin: number; zone: number; seconds: number }>> {
    const r = await this.db.query(
      `SELECT a.started_at, a.utc_offset_min, z.zone, z.seconds FROM activity_zone_time z JOIN activities a ON a.id = z.activity_id
        WHERE a.user_id = $1 AND a.started_at >= $2`,
      [userId, from],
    );
    return r.rows.map((x: any) => ({ startedAt: toDate(x.started_at).getTime(), utcOffsetMin: toNum(x.utc_offset_min), zone: toNum(x.zone), seconds: toNum(x.seconds) }));
  }

  /** Meilleures moyennes sur une période (courbes des sorties) ; sans période : records gardés. */
  async powerCurve(userId: string, from?: Date): Promise<Array<{ durationS: number; watts: number; at: number }>> {
    if (!from) {
      const r = await this.db.query('SELECT duration_s, watts, recorded_at FROM power_records WHERE user_id = $1 ORDER BY duration_s', [userId]);
      return r.rows.map((x: any) => ({ durationS: toNum(x.duration_s), watts: toNum(x.watts), at: toDate(x.recorded_at).getTime() }));
    }
    const r = await this.db.query(
      `SELECT c.duration_s, c.watts, a.started_at FROM activity_power_curve c JOIN activities a ON a.id = c.activity_id
        WHERE a.user_id = $1 AND a.started_at >= $2`,
      [userId, from],
    );
    const best = new Map<number, { watts: number; at: number }>();
    for (const x of r.rows as any[]) {
      const d = toNum(x.duration_s);
      const w = toNum(x.watts);
      if (w > (best.get(d)?.watts ?? 0)) best.set(d, { watts: w, at: toDate(x.started_at).getTime() });
    }
    return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([durationS, v]) => ({ durationS, ...v }));
  }

  /* ───────────── FTP ───────────── */

  async addFtp(userId: string, f: { recordedAt: Date; ftpWatts: number; source: FtpSource; clientId?: string; activityId?: string | null }): Promise<string> {
    if (f.clientId) {
      const r = await this.db.query('SELECT id FROM ftp_history WHERE user_id = $1 AND client_id = $2', [userId, f.clientId]);
      if (r.rows[0]) return r.rows[0].id as string;
    }
    const id = randomUUID();
    await this.db.query('INSERT INTO ftp_history (id, user_id, client_id, recorded_at, ftp_watts, source, activity_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      id, userId, f.clientId ?? id, f.recordedAt, Math.round(f.ftpWatts), f.source, f.activityId ?? null,
    ]);
    return id;
  }

  async listFtp(userId: string): Promise<HistoryFtp[]> {
    const r = await this.db.query(
      `SELECT f.client_id, f.recorded_at, f.ftp_watts, f.source, a.client_ride_id FROM ftp_history f
         LEFT JOIN activities a ON a.id = f.activity_id WHERE f.user_id = $1 ORDER BY f.recorded_at`,
      [userId],
    );
    return r.rows.map((x: any) => ({ clientId: x.client_id, recordedAt: toDate(x.recorded_at).getTime(), ftpWatts: toNum(x.ftp_watts), source: x.source as FtpSource, rideClientId: x.client_ride_id ?? null }));
  }

  /* ───────────── Séances perso ───────────── */

  /** Dernière écriture gagnante (date de modification de l'appareil). */
  async upsertWorkout(userId: string, w: HistoryWorkout): Promise<void> {
    const at = new Date(w.updatedAt);
    const r = await this.db.query('SELECT updated_at FROM workouts WHERE user_id = $1 AND id = $2', [userId, w.id]);
    if (r.rows[0]) {
      if (toDate(r.rows[0].updated_at).getTime() >= w.updatedAt) return;
      await this.db.query('UPDATE workouts SET name = $3, source = $4, type = $5, description = $6, steps = $7, deleted = $8, updated_at = $9 WHERE user_id = $1 AND id = $2', [
        userId, w.id, w.name.slice(0, 100), w.source, w.type ?? null, w.description ?? null, JSON.stringify(w.steps), !!w.deleted, at,
      ]);
      return;
    }
    await this.db.query('INSERT INTO workouts (user_id, id, name, source, type, description, steps, deleted, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      userId, w.id, w.name.slice(0, 100), w.source, w.type ?? null, w.description ?? null, JSON.stringify(w.steps), !!w.deleted, at,
    ]);
  }

  async listWorkouts(userId: string, since?: Date, includeDeleted = false): Promise<HistoryWorkout[]> {
    const where = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (since) where.push(`updated_at > $${params.push(since)}`);
    if (!includeDeleted) where.push('deleted = false');
    const r = await this.db.query(`SELECT id, name, source, type, description, steps, deleted, updated_at FROM workouts WHERE ${where.join(' AND ')} ORDER BY name`, params);
    return r.rows.map((x: any) => ({
      id: x.id,
      name: x.name,
      source: x.source,
      type: x.type,
      description: x.description,
      steps: toJson<unknown[]>(x.steps, []),
      deleted: !!x.deleted,
      updatedAt: toDate(x.updated_at).getTime(),
    }));
  }

  /* ───────────── Synchronisation ───────────── */

  async changesSince(userId: string, since: Date): Promise<{ rides: HistoryRide[]; deletedRides: string[]; ftp: HistoryFtp[]; workouts: HistoryWorkout[]; powerRecords: PowerRecordTuple[] }> {
    const rides = await this.db.query(`SELECT ${RIDE_COLUMNS} FROM activities WHERE user_id = $1 AND updated_at > $2 ORDER BY started_at`, [userId, since]);
    const deleted = await this.db.query('SELECT client_ride_id FROM deleted_rides WHERE user_id = $1 AND deleted_at > $2', [userId, since]);
    return {
      rides: await this.mapRides(rides.rows),
      deletedRides: deleted.rows.map((x: any) => x.client_ride_id as string),
      // Peu de lignes : toujours en entier (pas de date de modification).
      ftp: await this.listFtp(userId),
      workouts: await this.listWorkouts(userId, since, true),
      powerRecords: (await this.powerCurve(userId)).map((p) => [p.durationS, p.watts, p.at] as PowerRecordTuple),
    };
  }

  /* ───────────── Amis ───────────── */

  /** Dernières sorties des amis : distance, temps, dénivelé, parcours (ni puissance ni FC). */
  async friendsFeed(friendIds: readonly string[], limit = 30): Promise<Array<{ name: string; startedAt: number; routeId: string | null; kind: RideKind; distanceM: number; movingS: number; elevationM: number; workoutName: string | null }>> {
    if (friendIds.length === 0) return [];
    const r = await this.db.query(
      `SELECT u.display_name, a.started_at, a.route_id, a.kind, a.distance_m, a.moving_s, a.elevation_m, a.workout_name
         FROM activities a JOIN users u ON u.id = a.user_id
        WHERE a.user_id IN (${placeholders(friendIds.length)})
        ORDER BY a.started_at DESC LIMIT $${friendIds.length + 1}`,
      [...friendIds, limit],
    );
    return r.rows.map((x: any) => ({
      name: x.display_name,
      startedAt: toDate(x.started_at).getTime(),
      routeId: x.route_id,
      kind: x.kind as RideKind,
      distanceM: toNum(x.distance_m),
      movingS: toNum(x.moving_s),
      elevationM: toNum(x.elevation_m),
      workoutName: x.workout_name,
    }));
  }

  /* ───────────── Rattrapage ───────────── */

  /** Sorties avec FIT dont les mesures n'ont jamais été calculées. */
  async pendingAggregates(limit = 20): Promise<Array<{ id: string; userId: string; ftpWatts: number; startedAt: Date }>> {
    const r = await this.db.query(
      `SELECT a.id, a.user_id, a.started_at, p.ftp_watts FROM activities a JOIN profiles p ON p.user_id = a.user_id
        WHERE a.aggregates_at IS NULL AND a.fit_size IS NOT NULL ORDER BY a.started_at LIMIT $1`,
      [limit],
    );
    return r.rows.map((x: any) => ({ id: x.id, userId: x.user_id, ftpWatts: toNum(x.ftp_watts), startedAt: toDate(x.started_at) }));
  }

  /** Marque une sortie comme traitée même si son FIT est illisible (pas de nouvel essai). */
  async markAggregated(id: string): Promise<void> {
    await this.db.query('UPDATE activities SET aggregates_at = now() WHERE id = $1', [id]);
  }

  /* ───────────── Export RGPD ───────────── */

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    return {
      trainingRides: await this.listRides(userId, { limit: 100_000, offset: 0 }),
      ftpHistory: await this.listFtp(userId),
      powerRecords: await this.powerCurve(userId),
      workouts: await this.listWorkouts(userId),
    };
  }

  private async mapRides(rows: any[]): Promise<HistoryRide[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    const curves = new Map<string, Array<[number, number]>>();
    const zones = new Map<string, number[]>();
    // Par paquets (limite de paramètres).
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const c = await this.db.query(`SELECT activity_id, duration_s, watts FROM activity_power_curve WHERE activity_id IN (${placeholders(chunk.length)}) ORDER BY duration_s`, chunk);
      for (const x of c.rows as any[]) {
        const list = curves.get(x.activity_id) ?? [];
        list.push([toNum(x.duration_s), toNum(x.watts)]);
        curves.set(x.activity_id, list);
      }
      const z = await this.db.query(`SELECT activity_id, zone, seconds FROM activity_zone_time WHERE activity_id IN (${placeholders(chunk.length)})`, chunk);
      for (const x of z.rows as any[]) {
        const list = zones.get(x.activity_id) ?? new Array<number>(7).fill(0);
        list[toNum(x.zone) - 1] = toNum(x.seconds);
        zones.set(x.activity_id, list);
      }
    }
    return rows.map((row) => {
      const ride: HistoryRide = {
        clientId: row.client_ride_id ?? `srv-${row.id}`,
        serverId: row.id,
        name: row.name,
        routeId: row.route_id,
        kind: (row.kind ?? 'free') as RideKind,
        workoutId: row.workout_id,
        workoutName: row.workout_name,
        trainingType: row.training_type ?? null,
        startedAt: toDate(row.started_at).getTime(),
        utcOffsetMin: toNum(row.utc_offset_min ?? 0),
        durationS: toNum(row.duration_s),
        movingS: toNum(row.moving_s),
        distanceM: toNum(row.distance_m),
        elevationM: toNum(row.elevation_m),
        avgSpeedKmh: numOrNull(row.avg_speed_kmh),
        avgWatts: numOrNull(row.avg_watts),
        maxWatts: numOrNull(row.max_watts),
        np: numOrNull(row.np),
        intensity: numOrNull(row.intensity),
        tss: numOrNull(row.tss),
        workKJ: numOrNull(row.work_kj),
        avgCadence: numOrNull(row.avg_cadence),
        ftpAtRide: numOrNull(row.ftp_at_ride),
        feedback: row.feedback ?? null,
        curve: curves.get(row.id) ?? [],
        zonesS: zones.get(row.id) ?? [],
        hasFit: row.fit_size !== null && row.fit_size !== undefined,
        updatedAt: toDate(row.updated_at).getTime(),
      };
      if (row.hr_summary_enc) {
        const hr = this.cipher.decryptJson<{ avg?: number; max?: number }>(this.unbin(row.hr_summary_enc), `act-hr:${row.id}`);
        ride.avgHr = hr.avg ?? null;
        ride.maxHr = hr.max ?? null;
      }
      return ride;
    });
  }
}

/** Champs d'entraînement d'une sortie reçue du jeu. */
export function rideTraining(ride: HistoryRide): TrainingFields {
  return {
    kind: ride.kind,
    workoutId: ride.workoutId ?? null,
    workoutName: ride.workoutName ?? null,
    trainingType: ride.trainingType ?? null,
    utcOffsetMin: ride.utcOffsetMin,
    ftpAtRide: ride.ftpAtRide,
    np: ride.np,
    intensity: ride.intensity,
    tss: ride.tss,
    workKJ: ride.workKJ,
    avgCadence: ride.avgCadence,
    avgSpeedKmh: ride.avgSpeedKmh,
    feedback: ride.feedback ?? null,
    curve: ride.curve,
    zonesS: ride.zonesS,
  };
}
