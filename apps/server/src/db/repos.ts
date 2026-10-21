/**
 * Dépôts SQL (pg) : comptes, sessions, profils, sorties, segments, progression,
 * intégrations, file de rendu. Les champs sensibles sont chiffrés par `DataCipher`.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_LOOK, type AvatarLook } from '@allezrobert/shared';
import type { Db, Queryable } from './db.ts';
import type { DataCipher } from '../crypto.ts';

export interface User {
  id: string;
  displayName: string;
  createdAt: Date;
}

export interface Profile {
  displayName: string;
  weightKg: number;
  heightCm: number;
  ftpWatts: number;
  /** FC max / repos : présentes seulement si consentHr. */
  maxHr?: number;
  restHr?: number;
  avatar: AvatarLook;
  equipped: Record<string, string>;
  consentHr: boolean;
  consentFace: boolean;
  skipStrava: boolean;
  locale: 'fr' | 'en';
}

export interface ActivitySummaryRow {
  id: string;
  name: string;
  startedAt: Date;
  durationS: number;
  movingS: number;
  distanceM: number;
  elevationM: number;
  avgWatts: number | null;
  maxWatts: number | null;
  avgHr?: number;
  maxHr?: number;
  xp: number;
  routeId: string | null;
  rideId: string | null;
  skipStrava: boolean;
  stravaStatus: string | null;
  intervalsStatus: string | null;
  createdAt: Date;
}

export interface RenderJob {
  id: string;
  userId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  composition: string;
  payload: Record<string, unknown>;
  outputFile: string | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  finishedAt: Date | null;
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));
const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
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

export class Repos {
  constructor(
    readonly db: Db,
    private readonly cipher: DataCipher,
  ) {}

  /* ───────────── Comptes ───────────── */

  async findUserByIdentity(provider: string, subject: string): Promise<User | null> {
    const r = await this.db.query(
      'SELECT u.id, u.display_name, u.created_at FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.subject = $2',
      [provider, subject],
    );
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }

  async findUserByEmailHash(hash: string): Promise<User | null> {
    const r = await this.db.query('SELECT id, display_name, created_at FROM users WHERE email_hash = $1', [hash]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }

  async getUser(id: string): Promise<User | null> {
    const r = await this.db.query('SELECT id, display_name, created_at FROM users WHERE id = $1', [id]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }

  private mapUser(row: any): User {
    return { id: row.id, displayName: row.display_name, createdAt: toDate(row.created_at) };
  }

  /**
   * Trouve ou crée le compte lié à une identité (OAuth ou e-mail). Si l'empreinte d'e-mail
   * correspond à un compte existant, l'identité y est rattachée (même personne, autre fournisseur).
   */
  async upsertIdentity(provider: string, subject: string, displayName: string, emailHash?: string): Promise<User> {
    const existing = await this.findUserByIdentity(provider, subject);
    if (existing) {
      await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [existing.id]);
      return existing;
    }
    return this.db.tx(async (q) => {
      let user: User | null = null;
      if (emailHash) {
        const r = await q.query('SELECT id, display_name, created_at FROM users WHERE email_hash = $1', [emailHash]);
        if (r.rows[0]) user = this.mapUser(r.rows[0]);
      }
      if (!user) {
        const id = randomUUID();
        const name = sanitizeName(displayName) || 'Coureur';
        await q.query('INSERT INTO users (id, display_name, email_hash, last_login_at) VALUES ($1, $2, $3, now())', [id, name, emailHash ?? null]);
        await q.query('INSERT INTO profiles (user_id, avatar, equipped) VALUES ($1, $2, $3)', [id, JSON.stringify(DEFAULT_LOOK), '{}']);
        await q.query('INSERT INTO progression (user_id) VALUES ($1)', [id]);
        user = { id, displayName: name, createdAt: new Date() };
      }
      await q.query('INSERT INTO auth_identities (provider, subject, user_id) VALUES ($1, $2, $3)', [provider, subject, user.id]);
      return user;
    });
  }

  /** Droit à l'effacement : supprime le compte et toutes les données liées. */
  async deleteUser(userId: string): Promise<void> {
    await this.db.tx(async (q) => {
      // Suppressions explicites (en plus des ON DELETE CASCADE) pour ne dépendre d'aucun moteur.
      for (const table of ['render_jobs', 'integrations', 'segment_efforts', 'activities', 'progression', 'profiles', 'sessions', 'auth_identities']) {
        await q.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
      }
      await q.query('DELETE FROM users WHERE id = $1', [userId]);
    });
  }

  /* ───────────── Sessions ───────────── */

  async createSession(userId: string, ttlDays: number): Promise<{ id: string; expiresAt: Date }> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
    await this.db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expiresAt]);
    return { id, expiresAt };
  }

  async sessionValid(id: string, userId: string): Promise<boolean> {
    const r = await this.db.query('SELECT expires_at FROM sessions WHERE id = $1 AND user_id = $2', [id, userId]);
    const row = r.rows[0];
    return !!row && toDate(row.expires_at).getTime() > Date.now();
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [id]);
  }

  async purgeExpired(): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.db.query('DELETE FROM magic_links WHERE expires_at < now()');
  }

  /** Marque un jeton de lien magique comme consommé ; faux s'il l'était déjà. */
  async consumeMagicLink(jti: string, expiresAt: Date): Promise<boolean> {
    return this.db.tx(async (q) => {
      const r = await q.query('SELECT consumed_at FROM magic_links WHERE jti = $1', [jti]);
      if (r.rows[0]) return false;
      await q.query('INSERT INTO magic_links (jti, expires_at, consumed_at) VALUES ($1, $2, now())', [jti, expiresAt]);
      return true;
    });
  }

  /* ───────────── Profils ───────────── */

  async getProfile(userId: string): Promise<Profile | null> {
    const r = await this.db.query(
      `SELECT u.display_name, p.weight_kg, p.height_cm, p.ftp_watts, p.hr_settings_enc, p.avatar, p.equipped,
              p.consent_hr, p.consent_face, p.skip_strava, p.locale
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const p: Profile = {
      displayName: row.display_name,
      weightKg: toNum(row.weight_kg),
      heightCm: toNum(row.height_cm),
      ftpWatts: toNum(row.ftp_watts),
      avatar: { ...DEFAULT_LOOK, ...toJson<Partial<AvatarLook>>(row.avatar, {}) },
      equipped: toJson<Record<string, string>>(row.equipped, {}),
      consentHr: !!row.consent_hr,
      consentFace: !!row.consent_face,
      skipStrava: !!row.skip_strava,
      locale: row.locale === 'en' ? 'en' : 'fr',
    };
    if (p.consentHr && row.hr_settings_enc) {
      const hr = this.cipher.decryptJson<{ maxHr?: number; restHr?: number }>(row.hr_settings_enc, `hr:${userId}`);
      if (hr.maxHr !== undefined) p.maxHr = hr.maxHr;
      if (hr.restHr !== undefined) p.restHr = hr.restHr;
    }
    return p;
  }

  async updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile> {
    const current = await this.getProfile(userId);
    if (!current) throw new Error('Profil introuvable');
    const next: Profile = { ...current, ...patch };
    const consentHrChanged = next.consentHr !== current.consentHr;
    const consentFaceChanged = next.consentFace !== current.consentFace;
    const hrSettings =
      next.consentHr && (next.maxHr !== undefined || next.restHr !== undefined)
        ? this.cipher.encryptJson({ maxHr: next.maxHr, restHr: next.restHr }, `hr:${userId}`)
        : null;
    await this.db.tx(async (q) => {
      await q.query('UPDATE users SET display_name = $2 WHERE id = $1', [userId, sanitizeName(next.displayName) || current.displayName]);
      await q.query(
        `UPDATE profiles SET weight_kg = $2, height_cm = $3, ftp_watts = $4, hr_settings_enc = $5, avatar = $6, equipped = $7,
                consent_hr = $8, consent_face = $9, skip_strava = $10, locale = $11, updated_at = now()
          WHERE user_id = $1`,
        [userId, next.weightKg, next.heightCm, next.ftpWatts, hrSettings, JSON.stringify(next.avatar), JSON.stringify(next.equipped),
          next.consentHr, next.consentFace, next.skipStrava, next.locale],
      );
      if (consentHrChanged) await q.query('UPDATE profiles SET consent_hr_at = now() WHERE user_id = $1', [userId]);
      if (consentFaceChanged) await q.query('UPDATE profiles SET consent_face_at = now() WHERE user_id = $1', [userId]);
      // Retrait du consentement FC : effacement des résumés FC stockés.
      if (consentHrChanged && !next.consentHr) await q.query('UPDATE activities SET hr_summary_enc = NULL WHERE user_id = $1', [userId]);
    });
    return (await this.getProfile(userId))!;
  }

  /* ───────────── Sorties ───────────── */

  async insertActivity(a: {
    userId: string;
    name: string;
    startedAt: Date;
    durationS: number;
    movingS: number;
    distanceM: number;
    elevationM: number;
    avgWatts?: number;
    maxWatts?: number;
    hr?: { avg?: number; max?: number };
    fit: Uint8Array;
    xp: number;
    routeId?: string;
    rideId?: string;
    skipStrava: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const hrEnc = a.hr && (a.hr.avg !== undefined || a.hr.max !== undefined) ? this.cipher.encryptJson(a.hr, `act-hr:${id}`) : null;
    const fitEnc = this.cipher.encrypt(a.fit, `fit:${id}`);
    await this.db.query(
      `INSERT INTO activities (id, user_id, name, started_at, duration_s, moving_s, distance_m, elevation_m, avg_watts, max_watts,
                               hr_summary_enc, fit_enc, fit_size, xp, route_id, ride_id, skip_strava)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, a.userId, a.name, a.startedAt, a.durationS, a.movingS, a.distanceM, a.elevationM, a.avgWatts ?? null, a.maxWatts ?? null,
        hrEnc, fitEnc, a.fit.length, a.xp, a.routeId ?? null, a.rideId ?? null, a.skipStrava],
    );
    return id;
  }

  async listActivities(userId: string, limit = 50, offset = 0): Promise<ActivitySummaryRow[]> {
    const r = await this.db.query(
      `SELECT id, name, started_at, duration_s, moving_s, distance_m, elevation_m, avg_watts, max_watts, hr_summary_enc, xp,
              route_id, ride_id, skip_strava, strava_status, intervals_status, created_at
         FROM activities WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return r.rows.map((row) => this.mapActivity(row));
  }

  async getActivity(userId: string, id: string): Promise<ActivitySummaryRow | null> {
    const r = await this.db.query(
      `SELECT id, name, started_at, duration_s, moving_s, distance_m, elevation_m, avg_watts, max_watts, hr_summary_enc, xp,
              route_id, ride_id, skip_strava, strava_status, intervals_status, created_at
         FROM activities WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return r.rows[0] ? this.mapActivity(r.rows[0]) : null;
  }

  private mapActivity(row: any): ActivitySummaryRow {
    const a: ActivitySummaryRow = {
      id: row.id,
      name: row.name,
      startedAt: toDate(row.started_at),
      durationS: toNum(row.duration_s),
      movingS: toNum(row.moving_s),
      distanceM: toNum(row.distance_m),
      elevationM: toNum(row.elevation_m),
      avgWatts: row.avg_watts === null ? null : toNum(row.avg_watts),
      maxWatts: row.max_watts === null ? null : toNum(row.max_watts),
      xp: toNum(row.xp),
      routeId: row.route_id,
      rideId: row.ride_id,
      skipStrava: !!row.skip_strava,
      stravaStatus: row.strava_status,
      intervalsStatus: row.intervals_status,
      createdAt: toDate(row.created_at),
    };
    if (row.hr_summary_enc) {
      const hr = this.cipher.decryptJson<{ avg?: number; max?: number }>(row.hr_summary_enc, `act-hr:${row.id}`);
      if (hr.avg !== undefined) a.avgHr = hr.avg;
      if (hr.max !== undefined) a.maxHr = hr.max;
    }
    return a;
  }

  async getActivityFit(userId: string, id: string): Promise<Buffer | null> {
    const r = await this.db.query('SELECT fit_enc FROM activities WHERE user_id = $1 AND id = $2', [userId, id]);
    const row = r.rows[0];
    return row ? this.cipher.decrypt(row.fit_enc, `fit:${id}`) : null;
  }

  async replaceActivityFit(id: string, fit: Uint8Array): Promise<void> {
    await this.db.query('UPDATE activities SET fit_enc = $2, fit_size = $3 WHERE id = $1', [id, this.cipher.encrypt(fit, `fit:${id}`), fit.length]);
  }

  async listActivityIds(userId: string): Promise<string[]> {
    const r = await this.db.query('SELECT id FROM activities WHERE user_id = $1', [userId]);
    return r.rows.map((x) => x.id as string);
  }

  async setUploadStatus(id: string, target: 'strava' | 'intervals', status: string, ref?: string): Promise<void> {
    const col = target === 'strava' ? 'strava' : 'intervals';
    await this.db.query(`UPDATE activities SET ${col}_status = $2, ${col}_ref = $3 WHERE id = $1`, [id, status, ref ?? null]);
  }

  async deleteActivity(userId: string, id: string): Promise<boolean> {
    const r = await this.db.query('DELETE FROM activities WHERE user_id = $1 AND id = $2', [userId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ───────────── Segments ───────────── */

  async recordSegmentEffort(e: { userId: string; routeId: string; segmentId: string; elapsedMs: number; rideId?: string }): Promise<void> {
    await this.db.query(
      'INSERT INTO segment_efforts (id, user_id, route_id, segment_id, elapsed_ms, ride_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), e.userId, e.routeId, e.segmentId, Math.round(e.elapsedMs), e.rideId ?? null],
    );
  }

  /** Meilleur temps de chaque coureur sur un segment. */
  async segmentLeaderboard(routeId: string, segmentId: string, limit = 20): Promise<Array<{ userId: string; name: string; bestMs: number; efforts: number }>> {
    const r = await this.db.query(
      `SELECT e.user_id, u.display_name, MIN(e.elapsed_ms) AS best_ms, COUNT(*) AS efforts
         FROM segment_efforts e JOIN users u ON u.id = e.user_id
        WHERE e.route_id = $1 AND e.segment_id = $2
        GROUP BY e.user_id, u.display_name
        ORDER BY best_ms ASC
        LIMIT $3`,
      [routeId, segmentId, limit],
    );
    return r.rows.map((row) => ({ userId: row.user_id, name: row.display_name, bestMs: toNum(row.best_ms), efforts: toNum(row.efforts) }));
  }

  /** Records personnels d'un coureur (par itinéraire si précisé). */
  async personalBests(userId: string, routeId?: string): Promise<Array<{ routeId: string; segmentId: string; bestMs: number }>> {
    const r = await this.db.query(
      `SELECT route_id, segment_id, MIN(elapsed_ms) AS best_ms FROM segment_efforts
        WHERE user_id = $1 ${routeId ? 'AND route_id = $2' : ''} GROUP BY route_id, segment_id`,
      routeId ? [userId, routeId] : [userId],
    );
    return r.rows.map((row) => ({ routeId: row.route_id, segmentId: row.segment_id, bestMs: toNum(row.best_ms) }));
  }

  /* ───────────── Progression ───────────── */

  async getProgression(userId: string): Promise<{ xp: number; rides: number; distanceM: number; elevationM: number }> {
    const r = await this.db.query('SELECT xp, rides, distance_m, elevation_m FROM progression WHERE user_id = $1', [userId]);
    const row = r.rows[0];
    if (!row) return { xp: 0, rides: 0, distanceM: 0, elevationM: 0 };
    return { xp: toNum(row.xp), rides: toNum(row.rides), distanceM: toNum(row.distance_m), elevationM: toNum(row.elevation_m) };
  }

  async addProgression(q: Queryable, userId: string, xp: number, distanceM: number, elevationM: number): Promise<void> {
    const r = await q.query(
      'UPDATE progression SET xp = xp + $2, rides = rides + 1, distance_m = distance_m + $3, elevation_m = elevation_m + $4, updated_at = now() WHERE user_id = $1',
      [userId, xp, distanceM, elevationM],
    );
    if ((r.rowCount ?? 0) === 0) {
      await q.query('INSERT INTO progression (user_id, xp, rides, distance_m, elevation_m) VALUES ($1, $2, 1, $3, $4)', [userId, xp, distanceM, elevationM]);
    }
  }

  /* ───────────── Intégrations ───────────── */

  async setIntegration(userId: string, provider: 'strava' | 'intervals', secret: unknown, meta: Record<string, unknown>): Promise<void> {
    const enc = this.cipher.encryptJson(secret, `int:${provider}:${userId}`);
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [userId, provider]);
      await q.query('INSERT INTO integrations (user_id, provider, secret_enc, meta) VALUES ($1, $2, $3, $4)', [userId, provider, enc, JSON.stringify(meta)]);
    });
  }

  async getIntegration<T>(userId: string, provider: 'strava' | 'intervals'): Promise<{ secret: T; meta: Record<string, unknown> } | null> {
    const r = await this.db.query('SELECT secret_enc, meta FROM integrations WHERE user_id = $1 AND provider = $2', [userId, provider]);
    const row = r.rows[0];
    if (!row) return null;
    return { secret: this.cipher.decryptJson<T>(row.secret_enc, `int:${provider}:${userId}`), meta: toJson(row.meta, {}) };
  }

  async listIntegrations(userId: string): Promise<Array<{ provider: string; meta: Record<string, unknown>; updatedAt: Date }>> {
    const r = await this.db.query('SELECT provider, meta, updated_at FROM integrations WHERE user_id = $1', [userId]);
    return r.rows.map((row) => ({ provider: row.provider, meta: toJson(row.meta, {}), updatedAt: toDate(row.updated_at) }));
  }

  async deleteIntegration(userId: string, provider: string): Promise<void> {
    await this.db.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [userId, provider]);
  }

  /* ───────────── File de rendu ───────────── */

  async enqueueRender(userId: string, composition: string, payload: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    await this.db.query('INSERT INTO render_jobs (id, user_id, composition, payload) VALUES ($1, $2, $3, $4)', [id, userId, composition, JSON.stringify(payload)]);
    return id;
  }

  async countPendingRenders(userId: string): Promise<number> {
    const r = await this.db.query("SELECT COUNT(*) AS n FROM render_jobs WHERE user_id = $1 AND status IN ('queued', 'running')", [userId]);
    return toNum(r.rows[0]?.n ?? 0);
  }

  async getRender(userId: string, id: string): Promise<RenderJob | null> {
    const r = await this.db.query('SELECT * FROM render_jobs WHERE user_id = $1 AND id = $2', [userId, id]);
    return r.rows[0] ? this.mapJob(r.rows[0]) : null;
  }

  async listRenders(userId: string): Promise<RenderJob[]> {
    const r = await this.db.query('SELECT * FROM render_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
    return r.rows.map((row) => this.mapJob(row));
  }

  /**
   * Réserve la prochaine tâche (conteneur renderer). `FOR UPDATE SKIP LOCKED` : plusieurs
   * workers peuvent tourner sans se marcher dessus (PostgreSQL uniquement).
   */
  async claimRender(): Promise<RenderJob | null> {
    return this.db.tx(async (q) => {
      const r = await q.query(
        "SELECT * FROM render_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      const row = r.rows[0];
      if (!row) return null;
      await q.query("UPDATE render_jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
      return this.mapJob({ ...row, status: 'running' });
    });
  }

  async finishRender(id: string, ok: boolean, outputFile: string | null, error: string | null): Promise<void> {
    await this.db.query('UPDATE render_jobs SET status = $2, output_file = $3, error = $4, finished_at = now() WHERE id = $1', [
      id,
      ok ? 'done' : 'failed',
      outputFile,
      error,
    ]);
  }

  /** Remet en file les tâches « running » abandonnées (worker redémarré). */
  async requeueStaleRenders(olderThanMin = 30): Promise<void> {
    await this.db.query(
      `UPDATE render_jobs SET status = 'queued' WHERE status = 'running' AND started_at < now() - ($1 || ' minutes')::interval AND attempts < 3`,
      [String(olderThanMin)],
    );
  }

  private mapJob(row: any): RenderJob {
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      composition: row.composition,
      payload: toJson(row.payload, {}),
      outputFile: row.output_file,
      error: row.error,
      attempts: toNum(row.attempts),
      createdAt: toDate(row.created_at),
      finishedAt: row.finished_at ? toDate(row.finished_at) : null,
    };
  }

  /* ───────────── Export RGPD ───────────── */

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const user = await this.getUser(userId);
    const profile = await this.getProfile(userId);
    const identities = (await this.db.query('SELECT provider, created_at FROM auth_identities WHERE user_id = $1', [userId])).rows;
    const activities = await this.listActivities(userId, 10_000);
    const fits: Record<string, string> = {};
    for (const a of activities) {
      const fit = await this.getActivityFit(userId, a.id);
      if (fit) fits[a.id] = fit.toString('base64');
    }
    const efforts = (await this.db.query('SELECT route_id, segment_id, elapsed_ms, ride_id, ridden_at FROM segment_efforts WHERE user_id = $1', [userId])).rows;
    const integrations = await this.listIntegrations(userId);
    const renders = await this.listRenders(userId);
    return {
      exportedAt: new Date().toISOString(),
      user,
      identities: identities.map((i: any) => ({ provider: i.provider, linkedAt: i.created_at })),
      profile,
      progression: await this.getProgression(userId),
      activities,
      activityFitBase64: fits,
      segmentEfforts: efforts,
      integrations: integrations.map((i) => ({ provider: i.provider, meta: i.meta, updatedAt: i.updatedAt })),
      renders,
      note: "L'adresse e-mail n'est pas stockée (seule une empreinte HMAC l'est). Les jetons des services tiers ne sont pas exportés.",
    };
  }
}

/** Nom affiché : 1–40 caractères imprimables, espaces normalisés. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}
