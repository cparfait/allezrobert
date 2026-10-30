/**
 * API HTTP (montée sous /api) : profil, progression, sorties (FIT), segments, amis, intégrations
 * Strava / intervals.icu, sorties en cours (codes d'invitation, compagnon), voix LiveKit,
 * file de rendu vidéo, export et suppression RGPD, santé.
 */
import express from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { authRoutes } from './auth-routes.ts';
import { ttsRoutes } from './tts.ts';
import { friendRoutes } from './friends-routes.ts';
import { publicRoutes } from './public-routes.ts';
import { historyRoutes } from './history-routes.ts';
import { adminRoutes } from './admin-routes.ts';
import { clearSessionCookie, cors, errorHandler, HttpError, loadUser, originCheck, requireUser, type AuthedRequest } from './middleware.ts';
import { COSMETICS, levelInfo, unlockedCosmetics, validateEquipped, xpForRide } from '../progression/xp.ts';
import { decodeFit, FitImportError, stripHeartRate, trainingFromFit } from '../activities/fit-import.ts';
import { authorizeUrl, exchangeCode, newPkce, safeRedirect } from '../auth/oauth.ts';
import { OAUTH_COOKIE, parseCookies, serializeCookie } from './cookies.ts';
import { createLiveKitToken, voiceRoomName } from '../integrations/livekit.ts';
import { normalizeCode } from '../ride/registry.ts';
import { activeRooms } from '../ride/RideRoom.ts';
import { readHeartbeat } from '../render/worker.ts';
import { normalizedPower, WORKOUT_LIBRARY } from '@allezrobert/physics';
import { RIDE_KINDS, type RideKind, COUNTRY_CODE_RE, GHOST_MAX_S, FACE_CODE_RE, SHOE_MARKS, HELMET_SHAPES, type HelmetShape, completedKits, equippedTuneIds, rankRouteId, tuneItem, type ShoeMarkId } from '@allezrobert/shared';
import { buy, migrateLegacyWheels, rewardRide } from '../progression/atelier.ts';
import type { ActivitySummaryRow } from '../db/repos.ts';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const AvatarSchema = z.object({
  skin: hex,
  hair: hex,
  hairStyle: z.number().int().min(0).max(20),
  jersey: hex,
  jerseyAccent: hex,
  helmet: hex,
  cap: z.object({ style: z.enum(['uni', 'pois', 'losanges', 'panneaux']), color: hex, accent: hex.optional(), colors: z.array(hex).max(6).optional() }).optional(),
  noHelmet: z.boolean().optional(),
  noGlasses: z.boolean().optional(),
  helmetShape: z.enum(HELMET_SHAPES as [HelmetShape, ...HelmetShape[]]).optional(),
  bike: hex,
  bikeModel: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  build: z.number().min(0).max(1),
  shoes: hex.optional(),
  shoeAccent: hex.optional(),
  shoeMark: z.enum(SHOE_MARKS.map((m) => m.id) as [ShoeMarkId, ...ShoeMarkId[]]).optional(),
  socks: hex.optional(),
  sockHeight: z.enum(['low', 'high']).optional(),
  glassesFrame: hex.optional(),
  glassesLens: hex.optional(),
  legs: z.enum(['short', 'long']).optional(),
  bikeType: z.enum(['road', 'gravel', 'mtb']).optional(),
  face: z.string().regex(FACE_CODE_RE).optional(),
  beard: z.number().min(0).max(1).optional(),
  freckles: z.number().min(0).max(1).optional(),
  moustache: z.boolean().optional(),
  nationality: z.string().regex(COUNTRY_CODE_RE).optional(),
  // Pièces de l'atelier affichées sur le vélo : connues et possédées (vérifié à l'enregistrement).
  tune: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).max(32).optional(),
  heightCm: z.number().min(120).max(230).optional(),
  jerseyStyle: z.enum(['uni', 'bandes', 'pois', 'manches', 'moitie', 'degrade', 'chevrons']).optional(),
  sleeves: z.enum(['short', 'long']).optional(),
  gloves: z.enum(['none', 'mitts', 'full']).optional(),
  gloveColor: hex.optional(),
  bottles: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  bottleColor: z.enum(['black', 'white']).optional(),
  jerseyLogo: z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/), tint: hex.optional(), w: z.number().min(0.05).max(0.3).optional(), y: z.number().min(0.2).max(0.9).optional() }).optional(),
  jerseyDots: z.object({ r: z.number().min(1).max(10), step: z.number().min(4).max(40) }).optional(),
  jerseyBands: z.array(hex).max(5).optional(),
});

const ProfilePatchSchema = z
  .object({
    displayName: z.string().min(1).max(40),
    weightKg: z.number().min(30).max(200),
    heightCm: z.number().min(120).max(230),
    ftpWatts: z.number().int().min(50).max(600),
    maxHr: z.number().int().min(100).max(230).optional(),
    restHr: z.number().int().min(30).max(120).optional(),
    avatar: AvatarSchema,
    equipped: z.record(z.string(), z.string().max(64)),
    consentHr: z.boolean(),
    consentFace: z.boolean(),
    skipStrava: z.boolean(),
    locale: z.enum(['fr', 'en']),
  })
  .partial()
  .strict();

/** Séquences HyperFrames de packages/sequences (src/catalog.ts). */
const RENDER_COMPOSITIONS = ['summary', 'intro', 'kom', 'sprint', 'podium', 'tv'] as const;

/** Atelier tel que renvoyé au client : solde, pièces, événements, série, titres des ensembles complets. */
function atelierView(a: { credits: number; owned: string[]; events: string[]; streak: { last: string; days: number } }) {
  return { credits: a.credits, owned: a.owned, events: a.events, streak: a.streak, kits: completedKits(a.owned).map((k) => k.id) };
}

export function mountApi(app: express.Application, ctx: AppContext): void {
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  const api = express.Router();
  api.use(cors(ctx));
  api.use(originCheck(ctx));
  api.use(express.json({ limit: '1mb' }));
  api.use(loadUser(ctx));

  api.use('/auth', authRoutes(ctx));
  api.use('/tts', ttsRoutes(ctx));
  api.use('/friends', friendRoutes(ctx));
  api.use('/public', publicRoutes(ctx));
  api.use('/history', historyRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));

  /* ───────────── Santé ───────────── */
  api.get('/health', async (_req, res) => {
    let db = 'ok';
    try {
      await ctx.db.query('SELECT 1');
    } catch {
      db = 'down';
    }
    const rooms = [...activeRooms].map((r) => ({ riders: r.sim.riders.length, clients: r.clients.length, tick: r.tickStats.summary() }));
    res.status(db === 'ok' ? 200 : 503).json({ ok: db === 'ok', db, rides: rooms.length, rooms, routes: ctx.routes.size });
  });

  /* ───────────── Compte et profil ───────────── */
  api.get('/me', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const profile = await ctx.repos.getProfile(u.userId);
    if (!profile) throw new HttpError(401, 'Compte introuvable', 'unauthorized');
    const prog = await ctx.repos.getProgression(u.userId);
    const atelier = await ctx.repos.getAtelier(u.userId);
    res.json({ id: u.userId, profile, progression: levelInfo(prog.xp), atelier: atelierView(atelier) });
  });

  api.get('/me/profile', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json(await ctx.repos.getProfile(u.userId));
  });

  api.put('/me/profile', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const patch = ProfilePatchSchema.parse(req.body);
    // Équipement et modèle de vélo de l'avatar : existants et débloqués au niveau du compte ;
    // pièces de l'atelier (équipées ou affichées) : possédées par le compte.
    const bikeModel = patch.avatar?.bikeModel;
    if (patch.equipped || bikeModel || patch.avatar?.tune) {
      const level = levelInfo((await ctx.repos.getProgression(u.userId)).xp).level;
      const atelier = await ctx.repos.getAtelier(u.userId);
      if (patch.equipped) {
        const migrated = migrateLegacyWheels(patch.equipped, atelier);
        if (migrated) {
          patch.equipped = migrated;
          await ctx.repos.saveAtelier(ctx.db, u.userId, atelier);
        }
      }
      const tune = patch.avatar?.tune ?? [];
      const badTune = tune.find((id) => !tuneItem(id)?.slot || !atelier.owned.includes(id));
      const err =
        validateEquipped(patch.equipped ?? {}, level, atelier.owned) ??
        (bikeModel ? validateEquipped({ bike: bikeModel }, level) : null) ??
        (badTune ? `${badTune} n'est pas dans ton atelier` : null);
      if (err) throw new HttpError(400, err, 'cosmetic_locked');
      // Pièces affichées = pièces équipées (jamais d'autres que celles qui roulent).
      if (patch.avatar && patch.equipped) patch.avatar.tune = equippedTuneIds(patch.equipped);
    }
    const before = await ctx.repos.getProfile(u.userId);
    const profile = await ctx.repos.updateProfile(u.userId, patch);
    // Retrait du consentement FC : les FIT stockés sont ré-encodés sans fréquence cardiaque.
    if (before?.consentHr && !profile.consentHr) await stripHrFromStoredFits(ctx, u.userId);
    res.json(profile);
  });

  /** Droit à l'effacement : supprime le compte et toutes ses données (irréversible). */
  api.delete('/me', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    z.object({ confirm: z.literal('SUPPRIMER') }).parse(req.body);
    await ctx.uploads.unlinkStrava(u.userId).catch(() => undefined);
    const renders = await ctx.repos.listRenders(u.userId);
    await ctx.repos.deleteUser(u.userId);
    ctx.friends.forgetUser(u.userId);
    ctx.forgetSession();
    for (const job of renders) if (job.outputFile) await rm(path.join(ctx.config.RENDERS_DIR, path.basename(job.outputFile)), { force: true });
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  /** Portabilité : toutes les données du compte en JSON (FIT inclus en base64). */
  api.get('/me/export', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const data = await ctx.repos.exportUser(u.userId);
    // Invitations à rouler en cours (en mémoire, 30 min au plus).
    data.rideInvites = ctx.friends.exportFor(u.userId);
    // Historique d'entraînement : mesures, FTP, records, séances perso.
    data.training = await ctx.training.exportUser(u.userId);
    res.setHeader('Content-Disposition', `attachment; filename="allezrobert-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  });

  /* ───────────── Progression ───────────── */
  api.get('/me/progression', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const prog = await ctx.repos.getProgression(u.userId);
    const info = levelInfo(prog.xp);
    const atelier = await ctx.repos.getAtelier(u.userId);
    res.json({ ...info, rides: prog.rides, distanceM: prog.distanceM, elevationM: prog.elevationM, unlocked: unlockedCosmetics(info.level).map((i) => i.id), atelier: atelierView(atelier) });
  });

  /* ───────────── Atelier : achats (règles et prix du serveur) ───────────── */
  api.post('/shop/buy', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,48}$/) }).parse(req.body);
    const level = levelInfo((await ctx.repos.getProgression(u.userId)).xp).level;
    const r = await buy(ctx.repos, u.userId, id, level);
    if (!r.ok) {
      const status = r.error === 'unknown' ? 404 : r.error === 'credits' ? 402 : r.error === 'owned' ? 409 : 403;
      res.status(status).json({ error: r.error, missing: r.missing ?? 0, price: r.price, credits: r.balance });
      return;
    }
    res.json({ ok: true, price: r.price, granted: r.granted, credits: r.balance, owned: r.owned });
  });

  api.get('/cosmetics', (_req, res) => {
    res.json(COSMETICS);
  });

  /* ───────────── Sorties (FIT) ───────────── */
  api.post('/activities', express.raw({ type: ['application/octet-stream', 'application/vnd.ant.fit'], limit: '25mb' }), async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = z
      .object({
        name: z.string().max(100).optional(),
        rideId: z.string().max(64).optional(),
        routeId: z.string().max(80).optional(),
        skipStrava: z.enum(['0', '1', 'true', 'false']).optional(),
        guest: z.enum(['0', '1', 'true', 'false']).optional(),
        // Historique : sortie de la base locale du jeu, nature, séance et FTP du moment.
        clientRideId: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
        kind: z.enum(RIDE_KINDS as [RideKind, ...RideKind[]]).optional(),
        workoutId: z.string().max(80).optional(),
        workoutName: z.string().max(100).optional(),
        ftp: z.coerce.number().int().min(30).max(700).optional(),
      })
      .parse(req.query);
    if (q.guest === '1' || q.guest === 'true') throw new HttpError(403, 'Les sorties en invité ne sont pas enregistrées', 'guest');
    if (q.rideId && ctx.registry.byRoomId(q.rideId)?.guests.has(u.userId)) throw new HttpError(403, 'Les sorties en invité ne sont pas enregistrées', 'guest');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Fichier FIT attendu (application/octet-stream)', 'no_file');
    const profile = await ctx.repos.getProfile(u.userId);
    if (!profile) throw new HttpError(401, 'Compte introuvable', 'unauthorized');
    let imported;
    try {
      imported = decodeFit(new Uint8Array(req.body), q.name ?? 'Sortie Allez Robert !');
    } catch (e) {
      if (e instanceof FitImportError) throw new HttpError(400, e.message, 'bad_fit');
      throw e;
    }
    const s = imported.summary;
    // Même sortie déjà envoyée avec son FIT : rien de plus (pas d'XP en double). Sortie synchronisée
    // sans FIT : remplacée par celle-ci, complète.
    if (q.clientRideId) {
      const known = await ctx.training.byClientId(u.userId, q.clientRideId);
      if (known?.hasFit) {
        res.status(200).json({ activity: await ctx.repos.getActivity(u.userId, known.id), xpGained: 0, progression: levelInfo((await ctx.repos.getProgression(u.userId)).xp), newlyUnlocked: [], credits: null, duplicate: true });
        return;
      }
      if (known) await ctx.db.query('DELETE FROM activities WHERE id = $1 AND user_id = $2', [known.id, u.userId]);
    }
    // Sans consentement FC : aucune donnée cardiaque n'est conservée.
    const fit = imported.hasHr && !profile.consentHr ? stripHeartRate(imported) : new Uint8Array(req.body);
    const xp = xpForRide(s);
    const skipStrava = q.skipStrava === '1' || q.skipStrava === 'true' || profile.skipStrava;
    const before = levelInfo((await ctx.repos.getProgression(u.userId)).xp);
    const id = await ctx.repos.insertActivity({
      userId: u.userId,
      name: q.name ?? 'Sortie Allez Robert !',
      startedAt: new Date(s.startedAt),
      durationS: s.durationS,
      movingS: s.movingS,
      distanceM: s.distanceM,
      elevationM: s.elevationM,
      ...(s.avgWatts !== undefined ? { avgWatts: s.avgWatts } : {}),
      ...(s.maxWatts !== undefined ? { maxWatts: s.maxWatts } : {}),
      ...(profile.consentHr ? { hr: { avg: s.avgHr, max: s.maxHr } } : {}),
      fit,
      xp,
      ...(q.routeId ? { routeId: q.routeId } : {}),
      ...(q.rideId ? { rideId: q.rideId } : {}),
      ...(q.clientRideId ? { clientRideId: q.clientRideId } : {}),
      skipStrava,
    });
    // Mesures d'entraînement (NP, IF, TSS, courbe, zones) calculées sur le FIT avec la FTP du moment.
    await ctx.training.setTraining(
      ctx.db,
      u.userId,
      id,
      (() => {
        const t = trainingFromFit(imported, q.ftp ?? profile.ftpWatts);
        // Séance de la bibliothèque : son type ; sinon celui estimé d'après les zones.
        const libraryType = q.workoutId ? WORKOUT_LIBRARY.find((w) => w.id === q.workoutId)?.type : undefined;
        return { ...t, kind: q.kind ?? (q.rideId ? 'group' : 'free'), workoutId: q.workoutId ?? null, workoutName: q.workoutName ?? null, trainingType: libraryType ?? t.trainingType ?? null };
      })(),
      new Date(s.startedAt),
    );
    await ctx.repos.addProgression(ctx.db, u.userId, xp, s.distanceM, s.elevationM);
    // Crédits et récompenses : calculés ici à partir du FIT et des données du serveur (itinéraire connu, segments bouclés en salle).
    const route = q.routeId ? ctx.routes.get(q.routeId) : undefined;
    const reward = await rewardRide(ctx.repos, u.userId, {
      distanceM: s.distanceM,
      elevationM: s.elevationM,
      startedAt: s.startedAt,
      ...(route ? { routeId: route.data.id, routeLengthM: route.data.lengthM } : {}),
      segments: q.rideId ? await ctx.repos.countRideEfforts(u.userId, q.rideId) : 0,
    });
    const after = levelInfo((await ctx.repos.getProgression(u.userId)).xp);
    const newlyUnlocked = unlockedCosmetics(after.level).filter((i) => i.level > before.level).map((i) => i.id);
    // Envoi Strava / intervals.icu en arrière-plan (la réponse n'attend pas les services tiers).
    void ctx.uploads.autoUpload(u.userId, id, fit, q.name ?? 'Sortie Allez Robert !', skipStrava).catch((e) => ctx.log('warn', `envoi tiers : ${(e as Error).message}`));
    res.status(201).json({ activity: await ctx.repos.getActivity(u.userId, id), xpGained: xp, progression: after, newlyUnlocked, credits: reward });
  });

  api.get('/activities', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    res.json(await ctx.repos.listActivities(u.userId, q.limit, q.offset));
  });

  api.get('/activities/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const a = await ctx.repos.getActivity(u.userId, String(req.params.id));
    if (!a) throw new HttpError(404, 'Sortie introuvable', 'not_found');
    res.json(a);
  });

  api.get('/activities/:id/fit', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const fit = await ctx.repos.getActivityFit(u.userId, String(req.params.id));
    if (!fit) throw new HttpError(404, 'Sortie introuvable', 'not_found');
    res.setHeader('Content-Type', 'application/vnd.ant.fit');
    res.setHeader('Content-Disposition', `attachment; filename="allezrobert-${req.params.id}.fit"`);
    res.send(fit);
  });

  api.delete('/activities/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    // Suppression notée pour les autres appareils (historique synchronisé).
    if (!(await ctx.training.deleteRide(u.userId, String(req.params.id)))) throw new HttpError(404, 'Sortie introuvable', 'not_found');
    res.status(204).end();
  });

  api.post('/activities/:id/upload', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const body = z.object({ target: z.enum(['strava', 'intervals']) }).parse(req.body);
    const id = String(req.params.id);
    const a = await ctx.repos.getActivity(u.userId, id);
    const fit = await ctx.repos.getActivityFit(u.userId, id);
    if (!a || !fit) throw new HttpError(404, 'Sortie introuvable', 'not_found');
    const result = body.target === 'strava' ? await ctx.uploads.uploadStrava(u.userId, id, fit, a.name) : await ctx.uploads.uploadIntervals(u.userId, id, fit, a.name);
    if (result.status !== 'not_linked') await ctx.repos.setUploadStatus(id, body.target, result.status, result.ref);
    res.status(result.status === 'uploaded' ? 200 : result.status === 'not_linked' ? 409 : 502).json(result);
  });

  /* ───────────── Segments ───────────── */
  api.get('/segments/:routeId/:segmentId/leaderboard', async (req: AuthedRequest, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), scope: z.enum(['all', 'friends']).default('all') }).parse(req.query);
    const routeId = String(req.params.routeId);
    const segmentId = String(req.params.segmentId);
    if (q.scope === 'friends') {
      // Classement entre amis : soi et ses amis seulement (compte requis), sa ligne marquée.
      const u = requireUser(req);
      const board = await ctx.repos.segmentLeaderboard(routeId, segmentId, q.limit, u.userId);
      res.json(board.map((b, i) => ({ rank: i + 1, name: b.name, bestMs: b.bestMs, efforts: b.efforts, me: b.userId === u.userId })));
      return;
    }
    const board = await ctx.repos.segmentLeaderboard(routeId, segmentId, q.limit);
    // Pas d'identifiant interne exposé : rang, nom affiché, temps.
    res.json(board.map((b, i) => ({ rank: i + 1, name: b.name, bestMs: b.bestMs, efforts: b.efforts })));
  });

  api.get('/me/segments', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json(await ctx.repos.personalBests(u.userId, typeof req.query.routeId === 'string' ? req.query.routeId : undefined));
  });

  /*
   * Temps d'une sortie solo, envoyés par le client à la fin (les sorties de groupe sont déjà
   * enregistrées par la salle) : montées et sprints, parcours entier. Itinéraire connu du serveur :
   * segment existant et vitesse moyenne plausible ; sinon bornes larges. Les itinéraires dessinés
   * et le monde ouvert ne sont pas classés. Un même envoi répété (sortie reprise) ne compte qu'une fois.
   */
  api.post('/efforts', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = z.string().min(1).max(80).regex(/^[\w.-]+$/);
    const ms = z.number().int().min(5_000).max(86_400_000);
    const body = z
      .object({
        routeId: id,
        rideId: z.string().min(1).max(80).optional(),
        segments: z.array(z.object({ segmentId: id, elapsedMs: ms })).max(60).default([]),
        routeTimeMs: ms.optional(),
      })
      .parse(req.body);
    if (body.routeId === 'open' || body.routeId.startsWith('itineraire-')) throw new HttpError(400, 'Itinéraire non classé', 'unranked_route');
    // boucle partie d'un autre point : temps rangés avec ceux de la boucle (mêmes montées, même tour)
    body.routeId = rankRouteId(body.routeId);
    const known = ctx.routes.get(body.routeId)?.data;
    // Vitesse moyenne maximale admise : 90 km/h sur un segment, 60 km/h sur un parcours entier.
    const plausible = (lengthM: number, elapsedMs: number, maxMs: number) => lengthM / (elapsedMs / 1000) <= maxMs;
    let segments = 0;
    for (const e of body.segments) {
      if (known) {
        const seg = known.segments.find((g) => g.id === e.segmentId);
        if (!seg || !plausible(seg.endM - seg.startM, e.elapsedMs, 25)) continue;
      }
      if (body.rideId && (await ctx.repos.hasSegmentEffort(u.userId, body.rideId, e.segmentId, e.elapsedMs))) continue;
      await ctx.repos.recordSegmentEffort({ userId: u.userId, routeId: body.routeId, segmentId: e.segmentId, elapsedMs: e.elapsedMs, ...(body.rideId ? { rideId: body.rideId } : {}) });
      segments++;
    }
    let route = false;
    if (body.routeTimeMs !== undefined && (!known || plausible(known.lengthM, body.routeTimeMs, 16.7))) {
      route = await ctx.repos.recordRouteTime({ userId: u.userId, routeId: body.routeId, elapsedMs: body.routeTimeMs, ...(body.rideId ? { rideId: body.rideId } : {}) });
    }
    res.status(201).json({ segments, route });
  });

  /** Classement d'un parcours entier (meilleur temps par coureur) ; `scope=friends` : soi et ses amis. */
  api.get('/routes/:routeId/leaderboard', async (req: AuthedRequest, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), scope: z.enum(['all', 'friends']).default('all') }).parse(req.query);
    const routeId = String(req.params.routeId);
    if (q.scope === 'friends') {
      const u = requireUser(req);
      const board = await ctx.repos.routeLeaderboard(routeId, q.limit, u.userId);
      res.json(board.map((b, i) => ({ rank: i + 1, name: b.name, bestMs: b.bestMs, efforts: b.efforts, me: b.userId === u.userId })));
      return;
    }
    const board = await ctx.repos.routeLeaderboard(routeId, q.limit);
    res.json(board.map((b, i) => ({ rank: i + 1, name: b.name, bestMs: b.bestMs, efforts: b.efforts })));
  });

  api.get('/routes', (_req, res) => {
    res.json(ctx.routes.list());
  });

  api.get('/routes/:id/summary', (req, res) => {
    const r = ctx.routes.get(String(req.params.id));
    if (!r) throw new HttpError(404, 'Itinéraire introuvable', 'not_found');
    res.json(r.summary);
  });

  /* ───────────── Intégrations ───────────── */
  api.get('/integrations', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const list = await ctx.repos.listIntegrations(u.userId);
    const strava = list.find((i) => i.provider === 'strava');
    const intervals = list.find((i) => i.provider === 'intervals');
    res.json({
      strava: { available: ctx.uploads.stravaEnabled, connected: !!strava, athleteName: strava?.meta.athleteName ?? null },
      intervals: { available: true, connected: !!intervals },
    });
  });

  api.get('/integrations/strava/start', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const c = ctx.config;
    if (!c.STRAVA_CLIENT_ID || !c.STRAVA_CLIENT_SECRET) throw new HttpError(404, 'Strava non configuré', 'not_configured');
    const client = { clientId: c.STRAVA_CLIENT_ID, clientSecret: c.STRAVA_CLIENT_SECRET, redirectUri: `${c.apiPublicUrl}/api/integrations/strava/callback` };
    const pkce = newPkce();
    const state = await ctx.tokens.signOAuthState({ provider: 'strava', state: pkce.state, verifier: pkce.verifier, redirect: safeRedirect(req.query.redirect), userId: u.userId });
    res.append('Set-Cookie', serializeCookie(OAUTH_COOKIE, state, { secure: c.cookieSecure, maxAgeS: 600, path: '/api' }));
    res.redirect(302, authorizeUrl('strava', client, pkce));
  });

  api.get('/integrations/strava/callback', async (req: AuthedRequest, res) => {
    const c = ctx.config;
    const st = await ctx.tokens.verifyOAuthState(parseCookies(req.headers.cookie)[OAUTH_COOKIE] ?? '');
    res.append('Set-Cookie', serializeCookie(OAUTH_COOKIE, '', { secure: c.cookieSecure, maxAgeS: 0, path: '/api' }));
    const back = (q: string) => `${c.PUBLIC_URL}${st?.redirect ?? '/'}${(st?.redirect ?? '/').includes('?') ? '&' : '?'}strava=${q}`;
    if (!st || st.provider !== 'strava' || !st.userId || st.state !== req.query.state || typeof req.query.code !== 'string' || !c.STRAVA_CLIENT_ID || !c.STRAVA_CLIENT_SECRET) {
      return res.redirect(302, back('failed'));
    }
    // La personne connectée doit être celle qui a lancé la liaison.
    if (req.user && req.user.userId !== st.userId) return res.redirect(302, back('failed'));
    const scope = String(req.query.scope ?? '');
    if (!scope.includes('activity:write')) return res.redirect(302, back('scope'));
    try {
      const tok = await exchangeCode('strava', { clientId: c.STRAVA_CLIENT_ID, clientSecret: c.STRAVA_CLIENT_SECRET, redirectUri: `${c.apiPublicUrl}/api/integrations/strava/callback` }, req.query.code, st.verifier, ctx.fetchFn);
      await ctx.uploads.linkStrava(st.userId, tok);
      res.redirect(302, back('linked'));
    } catch (e) {
      ctx.log('warn', `Strava : ${(e as Error).message}`);
      res.redirect(302, back('failed'));
    }
  });

  api.delete('/integrations/strava', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    await ctx.uploads.unlinkStrava(u.userId);
    res.status(204).end();
  });

  api.put('/integrations/intervals', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const body = z.object({ apiKey: z.string().min(8).max(200), athleteId: z.string().regex(/^(0|i?\d+)$/).max(20).optional() }).parse(req.body);
    try {
      await ctx.uploads.linkIntervals(u.userId, body.apiKey, body.athleteId ?? '0');
    } catch (e) {
      throw new HttpError(400, (e as Error).message, 'intervals_refused');
    }
    res.status(204).end();
  });

  api.delete('/integrations/intervals', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    await ctx.repos.deleteIntegration(u.userId, 'intervals');
    res.status(204).end();
  });

  /* ───────────── Sorties en cours ───────────── */
  api.get('/rides/code/:code', (req, res) => {
    const e = ctx.registry.byInviteCode(normalizeCode(String(req.params.code)));
    if (!e) throw new HttpError(404, 'Aucune sortie avec ce code', 'not_found');
    res.json({ roomId: e.roomId, inviteCode: e.inviteCode, name: e.name, routeId: e.routeId, mode: e.mode, allowGuests: e.allowGuests, riders: e.participants.size });
  });

  /** Sortie en cours du compte (appli compagnon). */
  api.get('/rides/current', (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const e = ctx.registry.currentRideOf(u.userId);
    if (!e) throw new HttpError(404, 'Aucune sortie en cours', 'not_found');
    res.json({ roomId: e.roomId, inviteCode: e.inviteCode, name: e.name, routeId: e.routeId, mode: e.mode });
  });

  /** Voix disponible : LiveKit configuré, et lien du salon Discord de repli (public, sans compte). */
  api.get('/voice', (_req, res) => {
    const c = ctx.config;
    res.json({ livekit: !!(c.LIVEKIT_URL && c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET), discordInvite: c.DISCORD_VOICE_INVITE ?? null });
  });

  /** Jeton LiveKit pour la voix de la sortie (participants uniquement). */
  api.get('/rides/:roomId/voice-token', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const c = ctx.config;
    if (!c.LIVEKIT_URL || !c.LIVEKIT_API_KEY || !c.LIVEKIT_API_SECRET) throw new HttpError(404, 'Voix non configurée', 'not_configured');
    const roomId = String(req.params.roomId);
    const role = ctx.registry.roleOf(roomId, u.userId);
    if (!role) throw new HttpError(403, "Tu ne participes pas à cette sortie", 'forbidden');
    // Salle publique : identité vocale anonyme (identifiant de coureur de la salle) pour ne pas
    // révéler les comptes à des inconnus, et pour que le jeu relie une voix à un coureur proche.
    const entry = ctx.registry.byRoomId(roomId);
    const riderId = entry?.public ? entry.riderIds.get(u.userId) : undefined;
    if (entry?.public && !riderId) throw new HttpError(403, 'Aucun coureur de ce compte dans la salle', 'forbidden');
    const grant = await createLiveKitToken(
      { url: c.LIVEKIT_URL, apiKey: c.LIVEKIT_API_KEY, apiSecret: c.LIVEKIT_API_SECRET },
      { identity: `${riderId ?? u.userId}${role === 'companion' ? ':companion' : ''}`, name: u.name, room: voiceRoomName(roomId) },
    );
    res.json(grant);
  });

  /* ───────────── Fantôme : meilleur tour du coureur (vu par ses amis) ───────────── */
  api.put('/ghost/:routeId', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const routeId = z.string().min(1).max(80).parse(req.params.routeId);
    const body = z.object({ lapTimeS: z.number().finite().min(30).max(GHOST_MAX_S), dist: z.array(z.number().finite().min(0).max(1_000_000)).min(30).max(GHOST_MAX_S + 5) }).strict().parse(req.body);
    // Une valeur par seconde, croissante, de la durée du tour : sinon ce n'est pas un tour.
    const d = body.dist;
    if (d[0]! > 50 || d.some((v, i) => i > 0 && v < d[i - 1]!) || Math.abs(d.length - body.lapTimeS) > 5) throw new HttpError(400, 'Tour invalide', 'invalid');
    const known = ctx.routes.get(routeId);
    if (!known) throw new HttpError(404, 'Itinéraire inconnu', 'not_found');
    // Vitesse moyenne plausible (≤ 16,7 m/s = 60 km/h) comme pour les temps d'itinéraire.
    if ((d[d.length - 1]! - d[0]!) / body.lapTimeS > 16.7) throw new HttpError(400, 'Tour invalide', 'invalid');
    const saved = await ctx.repos.putGhostLap(u.userId, routeId, Math.round(body.lapTimeS * 1000), d.map((v) => Math.round(v * 10) / 10));
    res.json({ saved });
  });

  /* ───────────── Rendu vidéo ───────────── */
  api.post('/renders', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const body = z
      .object({
        composition: z.enum(RENDER_COMPOSITIONS),
        activityId: z.string().uuid().optional(),
        lang: z.enum(['fr', 'en']).optional(),
        variables: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
        /** Photos du sommet (vidéo résumé) : JPEG réduits côté client, 3 au plus. */
        photos: z.array(z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).max(280_000)).max(3).default([]),
      })
      .parse(req.body);
    if ((await ctx.repos.countPendingRenders(u.userId)) >= 3) throw new HttpError(429, 'Trois rendus au plus en attente', 'rate_limited');
    const profile = await ctx.repos.getProfile(u.userId);
    const lang = body.lang ?? profile?.locale ?? 'fr';
    let payload: Record<string, unknown>;
    if (body.composition === 'summary') {
      // Vidéo résumé : entrée RideSummaryInput de packages/sequences, construite depuis la sortie.
      if (!body.activityId) throw new HttpError(400, 'activityId requis pour la vidéo résumé', 'invalid');
      const a = await ctx.repos.getActivity(u.userId, body.activityId);
      const fit = await ctx.repos.getActivityFit(u.userId, body.activityId);
      if (!a || !fit) throw new HttpError(404, 'Sortie introuvable', 'not_found');
      payload = { kind: 'summary', lang, input: { ...rideSummaryInput(ctx, a, fit, profile?.displayName ?? u.name, lang, body.variables), ...(body.photos.length ? { photos: body.photos } : {}) } };
    } else {
      payload = { kind: 'sequence', lang, variables: { lang, ...body.variables } };
    }
    const id = await ctx.repos.enqueueRender(u.userId, body.composition, payload);
    ctx.renderWorker?.nudge();
    res.status(202).json({ id, status: 'queued' });
  });

  /** Rendu vidéo disponible ? (pouls du worker : conteneur renderer ou RENDER_INLINE). */
  api.get('/renders/capabilities', async (_req, res) => {
    const { available, heartbeat } = await readHeartbeat(ctx.config.RENDERS_DIR);
    res.json({ available, engine: available ? (heartbeat?.engine ?? null) : null, inline: heartbeat?.inline ?? false });
  });

  api.get('/renders', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json((await ctx.repos.listRenders(u.userId)).map(publicJob));
  });

  api.get('/renders/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const job = await ctx.repos.getRender(u.userId, String(req.params.id));
    if (!job) throw new HttpError(404, 'Rendu introuvable', 'not_found');
    res.json(publicJob(job));
  });

  api.get('/renders/:id/file', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const job = await ctx.repos.getRender(u.userId, String(req.params.id));
    if (!job || job.status !== 'done' || !job.outputFile) throw new HttpError(404, 'Vidéo indisponible', 'not_found');
    const file = path.join(ctx.config.RENDERS_DIR, path.basename(job.outputFile));
    if (!existsSync(file)) throw new HttpError(404, 'Vidéo indisponible', 'not_found');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="allezrobert-${job.id}.mp4"`);
    createReadStream(file).pipe(res);
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Introuvable', 'not_found')));
  api.use(errorHandler(ctx));
  app.use('/api', api);
}

function publicJob(j: { id: string; status: string; composition: string; error: string | null; createdAt: Date; finishedAt: Date | null }) {
  return { id: j.id, status: j.status, composition: j.composition, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt, fileUrl: j.status === 'done' ? `/api/renders/${j.id}/file` : null };
}

/** Entrée de la vidéo résumé (RideSummaryInput de packages/sequences) depuis une sortie stockée. */
function rideSummaryInput(
  ctx: AppContext,
  a: ActivitySummaryRow,
  fit: Buffer,
  riderName: string,
  lang: 'fr' | 'en',
  overrides: Record<string, string | number | boolean>,
): Record<string, unknown> {
  let records: Array<{ t: number; distanceM?: number; altitudeM?: number; lat?: number; lon?: number; watts?: number }> = [];
  let npW: number | undefined;
  try {
    const imported = decodeFit(new Uint8Array(fit));
    const watts = imported.activity.records.map((r) => r.watts ?? 0);
    if (watts.some((w) => w > 0)) npW = Math.round(normalizedPower(watts, 1));
    // Tracé et profil : ~900 points suffisent à la vidéo (jamais de FC transmise au rendu).
    const step = Math.max(1, Math.ceil(imported.activity.records.length / 900));
    records = imported.activity.records
      .filter((_, i) => i % step === 0)
      .map((r) => ({ t: r.t, distanceM: r.distanceM, altitudeM: r.altitudeM, ...(r.lat !== undefined && r.lon !== undefined ? { lat: r.lat, lon: r.lon } : {}), ...(r.watts !== undefined ? { watts: r.watts } : {}) }));
  } catch {
    records = [];
  }
  const routeName = (a.routeId && ctx.routes.get(a.routeId)?.data.name) || a.name;
  return {
    lang,
    title: typeof overrides.title === 'string' ? overrides.title : a.name,
    date: a.startedAt.toISOString(),
    routeName,
    riderName,
    stats: {
      distanceKm: Math.round(a.distanceM / 100) / 10,
      durationS: a.movingS,
      elevationM: Math.round(a.elevationM),
      ...(a.avgWatts !== null ? { avgPowerW: Math.round(a.avgWatts) } : {}),
      ...(npW !== undefined ? { npW } : {}),
    },
    records,
  };
}

/** Ré-encode sans FC tous les FIT stockés d'un compte (retrait du consentement). */
async function stripHrFromStoredFits(ctx: AppContext, userId: string): Promise<void> {
  for (const id of await ctx.repos.listActivityIds(userId)) {
    const fit = await ctx.repos.getActivityFit(userId, id);
    if (!fit) continue;
    try {
      const imported = decodeFit(new Uint8Array(fit));
      if (imported.hasHr) await ctx.repos.replaceActivityFit(id, stripHeartRate(imported));
    } catch (e) {
      ctx.log('warn', `FIT ${id} non ré-encodé : ${(e as Error).message}`);
    }
  }
}
