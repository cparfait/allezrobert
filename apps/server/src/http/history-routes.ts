/**
 * API de l'historique d'entraînement (montée sous /api/history, compte requis) : sorties avec leurs
 * mesures, charge (forme / fatigue / fraîcheur), temps par zone, records de puissance, historique
 * des FTP, séances perso, fil des amis, et synchronisation avec la base locale du jeu.
 */
import express from 'express';
import { z } from 'zod';
import { addDays, dailyLoad, localDate, tssByDay, weekStart } from '@allezrobert/physics';
import {
  FTP_SOURCES,
  HISTORY_SYNC_MAX_RIDES,
  RIDE_FEEDBACKS,
  RIDE_KINDS,
  type FtpSource,
  type HistorySyncResponse,
  type RideFeedback,
  type RideKind,
} from '@allezrobert/shared';
import type { AppContext } from '../context.ts';
import { HttpError, RateLimiter, requireUser, type AuthedRequest } from './middleware.ts';

const DAY_MS = 86_400_000;
const num = z.number().finite();
const numOrNull = num.nullable();
const ClientId = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
const When = z.number().int().min(Date.UTC(2000, 0, 1)).max(Date.UTC(2100, 0, 1));
const TrainingType = z.enum(['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic']);

const RideSchema = z.object({
  clientId: ClientId,
  serverId: z.string().nullable().optional(),
  name: z.string().min(1).max(100),
  routeId: z.string().max(80).nullable(),
  kind: z.enum(RIDE_KINDS as [RideKind, ...RideKind[]]),
  workoutId: z.string().max(80).nullable().optional(),
  workoutName: z.string().max(100).nullable().optional(),
  trainingType: TrainingType.nullable().optional(),
  startedAt: When,
  utcOffsetMin: z.number().int().min(-14 * 60).max(14 * 60),
  durationS: num.min(0).max(7 * 86400),
  movingS: num.min(0).max(7 * 86400),
  distanceM: num.min(0).max(2_000_000),
  elevationM: num.min(0).max(100_000),
  avgSpeedKmh: numOrNull,
  avgWatts: numOrNull,
  maxWatts: numOrNull,
  np: numOrNull,
  intensity: numOrNull,
  tss: numOrNull,
  workKJ: numOrNull,
  avgCadence: numOrNull,
  avgHr: numOrNull.optional(),
  maxHr: numOrNull.optional(),
  ftpAtRide: numOrNull,
  feedback: z.enum(RIDE_FEEDBACKS as [RideFeedback, ...RideFeedback[]]).nullable().optional(),
  curve: z.array(z.tuple([z.number().int().min(1).max(86400), num.min(0).max(3000)])).max(64),
  zonesS: z.array(num.min(0)).max(7),
  hasFit: z.boolean().optional(),
  updatedAt: z.number().int(),
});

const FtpSchema = z.object({
  clientId: ClientId,
  recordedAt: When,
  ftpWatts: z.number().int().min(30).max(700),
  source: z.enum(FTP_SOURCES as [FtpSource, ...FtpSource[]]),
  rideClientId: ClientId.nullable().optional(),
});

const WorkoutSchema = z.object({
  id: ClientId,
  name: z.string().min(1).max(100),
  source: z.enum(['custom', 'zwo', 'erg', 'mrc']),
  type: z.string().max(20).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  steps: z.array(z.unknown()).max(2000),
  deleted: z.boolean().optional(),
  updatedAt: z.number().int(),
});

const SyncSchema = z.object({
  since: z.number().int().min(0),
  rides: z.array(RideSchema).max(HISTORY_SYNC_MAX_RIDES),
  deletedRides: z.array(ClientId).max(1000),
  ftp: z.array(FtpSchema).max(1000),
  workouts: z.array(WorkoutSchema).max(500),
  powerRecords: z.array(z.tuple([z.number().int().min(1).max(86400), num.min(0).max(3000), When])).max(64),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  kind: z.enum(RIDE_KINDS as [RideKind, ...RideKind[]]).optional(),
  trainingType: TrainingType.optional(),
  routeId: z.string().max(80).optional(),
});

const notFound = () => new HttpError(404, 'Sortie introuvable', 'not_found');

export function historyRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const repo = ctx.training;
  const syncByUser = new RateLimiter(60, 10 * 60_000);

  /** Sorties, plus récentes d'abord, avec leurs mesures (filtres : période, nature, parcours). */
  r.get('/rides', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = ListQuery.parse(req.query);
    res.json(
      await repo.listRides(u.userId, {
        limit: q.limit,
        offset: q.offset,
        ...(q.from !== undefined ? { from: new Date(q.from) } : {}),
        ...(q.to !== undefined ? { to: new Date(q.to) } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.trainingType ? { trainingType: q.trainingType } : {}),
        ...(q.routeId ? { routeId: q.routeId } : {}),
      }),
    );
  });

  r.get('/rides/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound();
    const ride = await repo.getRide(u.userId, id.data);
    if (!ride) throw notFound();
    res.json(ride);
  });

  /** Ressenti après la sortie (facile, juste, dur, échec). */
  r.put('/rides/:id/feedback', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = z.string().uuid().safeParse(req.params.id);
    const { feedback } = z.object({ feedback: z.enum(RIDE_FEEDBACKS as [RideFeedback, ...RideFeedback[]]).nullable() }).parse(req.body);
    if (!id.success) throw notFound();
    const r2 = await ctx.db.query('UPDATE activities SET feedback = $3, updated_at = now() WHERE user_id = $1 AND id = $2', [u.userId, id.data, feedback]);
    if (!r2.rowCount) throw notFound();
    res.status(204).end();
  });

  r.delete('/rides/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || !(await repo.deleteRide(u.userId, id.data))) throw notFound();
    res.status(204).end();
  });

  /** Totaux : tout l'historique, les 7 et 28 derniers jours. */
  r.get('/summary', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const now = Date.now();
    res.json({
      all: await repo.totals(u.userId),
      week: await repo.totals(u.userId, new Date(now - 7 * DAY_MS)),
      month: await repo.totals(u.userId, new Date(now - 28 * DAY_MS)),
    });
  });

  /** Charge jour par jour (TSS, forme, fatigue, fraîcheur) sur `days` jours, jusqu'à aujourd'hui (fuseau `tz`). */
  r.get('/load', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = z.object({ days: z.coerce.number().int().min(7).max(730).default(90), tz: z.coerce.number().int().min(-840).max(840).default(0) }).parse(req.query);
    const today = localDate(Date.now(), q.tz);
    const from = addDays(today, -(q.days - 1));
    // Toute l'année précédente compte pour la forme (constante de 42 jours).
    const rows = await repo.tssRows(u.userId, new Date(Date.parse(`${from}T00:00:00Z`) - 365 * DAY_MS));
    res.json(dailyLoad(tssByDay(rows), from, today));
  });

  /** Temps par zone de puissance, semaine par semaine (lundi). */
  r.get('/zones', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = z.object({ weeks: z.coerce.number().int().min(1).max(104).default(12) }).parse(req.query);
    const rows = await repo.zoneRows(u.userId, new Date(Date.now() - (q.weeks * 7 + 7) * DAY_MS));
    const weeks = new Map<string, number[]>();
    for (const x of rows) {
      const w = weekStart(localDate(x.startedAt, x.utcOffsetMin));
      const z7 = weeks.get(w) ?? new Array<number>(7).fill(0);
      z7[x.zone - 1]! += x.seconds;
      weeks.set(w, z7);
    }
    res.json([...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-q.weeks).map(([week, zonesS]) => ({ week, zonesS })));
  });

  /** Records de puissance (tous les temps) ou meilleures moyennes des `days` derniers jours. */
  r.get('/power-curve', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = z.object({ days: z.coerce.number().int().min(1).max(3650).optional() }).parse(req.query);
    res.json(await repo.powerCurve(u.userId, q.days ? new Date(Date.now() - q.days * DAY_MS) : undefined));
  });

  /** Historique des FTP ; un ajout met aussi à jour la FTP du profil. */
  r.get('/ftp', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json(await repo.listFtp(u.userId));
  });

  r.post('/ftp', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const f = FtpSchema.omit({ clientId: true }).extend({ clientId: ClientId.optional() }).parse(req.body);
    const activity = f.rideClientId ? await repo.byClientId(u.userId, f.rideClientId) : null;
    await repo.addFtp(u.userId, { recordedAt: new Date(f.recordedAt), ftpWatts: f.ftpWatts, source: f.source, ...(f.clientId ? { clientId: f.clientId } : {}), activityId: activity?.id ?? null });
    await ctx.repos.updateProfile(u.userId, { ftpWatts: f.ftpWatts });
    res.status(201).json(await repo.listFtp(u.userId));
  });

  /** Séances perso. */
  r.get('/workouts', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json(await repo.listWorkouts(u.userId));
  });

  r.put('/workouts/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const w = WorkoutSchema.parse({ ...req.body, id: req.params.id });
    await repo.upsertWorkout(u.userId, w);
    res.status(204).end();
  });

  r.delete('/workouts/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = ClientId.parse(req.params.id);
    const cur = (await repo.listWorkouts(u.userId, undefined, true)).find((w) => w.id === id);
    if (!cur) throw new HttpError(404, 'Séance introuvable', 'not_found');
    await repo.upsertWorkout(u.userId, { ...cur, deleted: true, updatedAt: Math.max(Date.now(), cur.updatedAt + 1) });
    res.status(204).end();
  });

  /** Dernières sorties des amis (distance, temps, dénivelé, parcours). */
  r.get('/friends', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const friends = (await ctx.friends.repo.relationsOf(u.userId)).filter((x) => x.status === 'accepted').map((x) => x.otherId);
    res.json(await repo.friendsFeed(friends, 30));
  });

  /**
   * Synchronisation avec la base locale : applique ce que l'appareil envoie (sorties, suppressions,
   * FTP, séances, records), puis renvoie tout ce qui a changé depuis `since`.
   */
  r.post('/sync', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!syncByUser.allow(u.userId)) throw new HttpError(429, 'Trop de synchronisations, réessaie plus tard', 'rate_limited');
    const body = SyncSchema.parse(req.body);
    const serverTime = Date.now();
    const profile = await ctx.repos.getProfile(u.userId);
    if (!profile) throw new HttpError(401, 'Compte introuvable', 'unauthorized');
    const mapped: HistorySyncResponse['mapped'] = [];
    for (const ride of body.rides) mapped.push({ clientId: ride.clientId, serverId: await repo.upsertSyncedRide(u.userId, ride, profile.consentHr) });
    for (const clientId of body.deletedRides) await repo.deleteByClientId(u.userId, clientId);
    let latestFtp: { at: number; watts: number } | null = null;
    for (const f of body.ftp) {
      const activity = f.rideClientId ? await repo.byClientId(u.userId, f.rideClientId) : null;
      await repo.addFtp(u.userId, { clientId: f.clientId, recordedAt: new Date(f.recordedAt), ftpWatts: f.ftpWatts, source: f.source, activityId: activity?.id ?? null });
      if (!latestFtp || f.recordedAt > latestFtp.at) latestFtp = { at: f.recordedAt, watts: f.ftpWatts };
    }
    // La FTP la plus récente de l'historique devient celle du profil.
    if (latestFtp) {
      const all = await repo.listFtp(u.userId);
      const last = all.at(-1);
      if (last && last.ftpWatts !== profile.ftpWatts) await ctx.repos.updateProfile(u.userId, { ftpWatts: last.ftpWatts });
    }
    for (const w of body.workouts) await repo.upsertWorkout(u.userId, w);
    await ctx.db.tx(async (q) => {
      for (const [d, w, at] of body.powerRecords) await repo.mergePowerRecord(q, u.userId, d, w, new Date(at));
    });
    const changes = await repo.changesSince(u.userId, new Date(body.since));
    const out: HistorySyncResponse = { serverTime, mapped, ...changes };
    res.json(out);
  });

  return r;
}
