/**
 * Administration : inscrits, gestion des comptes et statistiques d'usage.
 *
 * Accès réservé au compte dont l'adresse e-mail est ADMIN_EMAIL (comparaison d'empreinte : le serveur ne garde
 * aucune adresse en clair) ; si ADMIN_PASSWORD est défini, un mot de passe est demandé en plus (jeton de 30 minutes
 * dans un cookie HTTP-only). Un compte connecté qui n'est pas l'administrateur reçoit 404, comme si la page n'existait pas.
 * L'adresse e-mail (chiffrée en base, enregistrée à chaque connexion) n'est lue que ici ; ni fichier FIT ni fréquence cardiaque ne sont exposés.
 */
import express from 'express';
import { createHash, createHmac } from 'node:crypto';
import { levelForXp } from '@allezrobert/shared';
import type { AppContext } from '../context.ts';
import { safeEqual } from '../crypto.ts';
import { activeRooms } from '../ride/RideRoom.ts';
import { parseCookies, serializeCookie } from './cookies.ts';
import { HttpError, RateLimiter, requireUser, type AuthedRequest } from './middleware.ts';

const ADMIN_COOKIE = 'ar_admin';
const UNLOCK_TTL_S = 30 * 60;
const DAY_MS = 86_400_000;

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : toDate(v).toISOString());
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Jeton de déverrouillage : identifiant du compte, expiration, signature. */
function unlockToken(ctx: AppContext, userId: string, exp: number): string {
  const body = `${userId}.${exp}`;
  const sig = createHmac('sha256', `${ctx.config.SESSION_SECRET}:admin`).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function unlocked(ctx: AppContext, req: AuthedRequest, userId: string): boolean {
  if (!ctx.config.ADMIN_PASSWORD) return true;
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  if (!token) return false;
  const [uid, expS, sig] = token.split('.');
  const exp = Number(expS);
  if (uid !== userId || !Number.isFinite(exp) || exp < Date.now() / 1000 || !sig) return false;
  return safeEqual(token, unlockToken(ctx, userId, exp));
}

/** Le compte connecté est-il l'administrateur ? (empreinte de l'e-mail du compte contre celle d'ADMIN_EMAIL) */
async function isAdminAccount(ctx: AppContext, userId: string): Promise<boolean> {
  const r = await ctx.db.query<{ email_hash: string | null }>('SELECT email_hash FROM users WHERE id = $1', [userId]);
  const hash = r.rows[0]?.email_hash;
  if (!hash) return false;
  return ctx.config.ADMIN_EMAIL.split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .some((e) => safeEqual(hash, ctx.cipher.emailHash(e)));
}

export function adminRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const attempts = new RateLimiter(5, 15 * 60_000);

  // Réservée au site : une requête venue d'une application de bureau (Windows : http://tauri.localhost, macOS : tauri://localhost) reçoit 404.
  r.use((req, _res, next) => {
    const origin = req.headers.origin;
    if (origin && /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)$/i.test(origin)) return next(new HttpError(404, 'Introuvable', 'not_found'));
    next();
  });

  // Connexion obligatoire, puis compte administrateur (sinon 404).
  r.use(async (req: AuthedRequest, _res, next) => {
    try {
      const u = requireUser(req);
      if (!(await isAdminAccount(ctx, u.userId))) throw new HttpError(404, 'Introuvable', 'not_found');
      next();
    } catch (e) {
      next(e);
    }
  });

  r.get('/status', (req: AuthedRequest, res) => {
    const u = requireUser(req);
    res.json({ admin: true, name: u.name, passwordRequired: !!ctx.config.ADMIN_PASSWORD, unlocked: unlocked(ctx, req, u.userId) });
  });

  r.post('/unlock', (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!ctx.config.ADMIN_PASSWORD) return void res.json({ ok: true });
    if (!attempts.allow(`${u.userId}|${req.ip}`)) throw new HttpError(429, 'Trop d’essais : réessaie dans quelques minutes', 'rate_limited');
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    // Empreintes de même longueur : comparaison à temps constant.
    const h = (s: string) => createHash('sha256').update(s).digest('hex');
    if (!safeEqual(h(given), h(ctx.config.ADMIN_PASSWORD))) {
      ctx.log('warn', `admin : mot de passe refusé (${u.userId})`);
      throw new HttpError(403, 'Mot de passe incorrect', 'bad_password');
    }
    const exp = Math.floor(Date.now() / 1000) + UNLOCK_TTL_S;
    res.append('Set-Cookie', serializeCookie(ADMIN_COOKIE, unlockToken(ctx, u.userId, exp), { secure: ctx.config.cookieSecure, maxAgeS: UNLOCK_TTL_S, path: '/api/admin', sameSite: 'Strict' }));
    ctx.log('info', `admin : déverrouillé (${u.userId})`);
    res.json({ ok: true });
  });

  r.post('/lock', (_req, res) => {
    res.append('Set-Cookie', serializeCookie(ADMIN_COOKIE, '', { secure: ctx.config.cookieSecure, maxAgeS: 0, path: '/api/admin', sameSite: 'Strict' }));
    res.json({ ok: true });
  });

  // Tout ce qui suit demande le mot de passe (s'il est défini).
  r.use((req: AuthedRequest, _res, next) => {
    const u = requireUser(req);
    if (!unlocked(ctx, req, u.userId)) return next(new HttpError(403, 'Mot de passe administrateur requis', 'locked'));
    next();
  });

  /* ───────────── Statistiques ───────────── */
  r.get('/stats', async (_req, res) => {
    const now = Date.now();
    const users = (await ctx.db.query('SELECT id, created_at, last_login_at, disabled_at FROM users')).rows;
    const providers = (await ctx.db.query('SELECT provider, COUNT(*) AS n FROM auth_identities GROUP BY provider')).rows;
    const totals = (await ctx.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(distance_m), 0) AS dist, COALESCE(SUM(elevation_m), 0) AS elev, COALESCE(SUM(moving_s), 0) AS mv FROM activities')).rows[0] ?? {};
    const since = new Date(now - 30 * DAY_MS);
    const recent = (await ctx.db.query('SELECT user_id, started_at, distance_m, moving_s FROM activities WHERE started_at >= $1', [since])).rows;
    const topRoutes = (await ctx.db.query('SELECT route_id, COUNT(*) AS n FROM activities WHERE route_id IS NOT NULL GROUP BY route_id ORDER BY n DESC LIMIT 10')).rows;
    const friendships = (await ctx.db.query('SELECT COUNT(*) AS n FROM friendships')).rows[0];
    const plat = (await ctx.db.query('SELECT user_id, platform, last_seen_at FROM user_platforms')).rows;

    const created = users.map((u) => toDate(u.created_at).getTime());
    const seen = users.map((u) => (u.last_login_at ? toDate(u.last_login_at).getTime() : 0));
    const within = (arr: number[], days: number) => arr.filter((t) => t >= now - days * DAY_MS).length;

    // Séries des 30 derniers jours (jour UTC), complétées par des zéros.
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) days.push(dayKey(new Date(now - i * DAY_MS)));
    const signups = new Map<string, number>(days.map((d) => [d, 0]));
    for (const t of created) {
      const k = dayKey(new Date(t));
      if (signups.has(k)) signups.set(k, (signups.get(k) ?? 0) + 1);
    }
    const rides = new Map<string, { n: number; km: number; users: Set<string> }>(days.map((d) => [d, { n: 0, km: 0, users: new Set<string>() }]));
    for (const a of recent) {
      const slot = rides.get(dayKey(toDate(a.started_at)));
      if (!slot) continue;
      slot.n++;
      slot.km += Number(a.distance_m) / 1000;
      slot.users.add(String(a.user_id));
    }
    const activeRiders = (d: number) => new Set(recent.filter((a) => toDate(a.started_at).getTime() >= now - d * DAY_MS).map((a) => String(a.user_id))).size;

    const rooms = [...activeRooms];
    res.json({
      generatedAt: new Date(now).toISOString(),
      users: {
        total: users.length,
        disabled: users.filter((u) => u.disabled_at).length,
        new7d: within(created, 7),
        new30d: within(created, 30),
        seen24h: within(seen, 1),
        seen7d: within(seen, 7),
        seen30d: within(seen, 30),
        riding7d: activeRiders(7),
        riding30d: activeRiders(30),
      },
      providers: providers.map((p) => ({ provider: String(p.provider), n: Number(p.n) })),
      platforms: ['web', 'windows', 'mac'].map((name) => {
        const rows = plat.filter((x) => String(x.platform) === name);
        const recent = (d: number) => rows.filter((x) => toDate(x.last_seen_at).getTime() >= now - d * DAY_MS).length;
        return { platform: name, users: rows.length, active7d: recent(7), active30d: recent(30) };
      }),
      activities: { total: Number(totals.n ?? 0), distanceKm: Math.round(Number(totals.dist ?? 0) / 1000), elevationM: Math.round(Number(totals.elev ?? 0)), movingH: Math.round(Number(totals.mv ?? 0) / 3600) },
      friendships: Number(friendships?.n ?? 0),
      topRoutes: topRoutes.map((t) => ({ routeId: String(t.route_id), n: Number(t.n) })),
      daily: days.map((d) => ({ day: d, signups: signups.get(d) ?? 0, rides: rides.get(d)?.n ?? 0, km: Math.round((rides.get(d)?.km ?? 0) * 10) / 10, riders: rides.get(d)?.users.size ?? 0 })),
      live: { rooms: rooms.length, riders: rooms.reduce((a, x) => a + x.sim.riders.length, 0), clients: rooms.reduce((a, x) => a + x.clients.length, 0) },
      server: { uptimeS: Math.round(process.uptime()), node: process.version },
    });
  });

  /* ───────────── Inscrits ───────────── */
  r.get('/users', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'created';
    const rows = (
      await ctx.db.query(
        `SELECT u.id, u.display_name, u.created_at, u.last_login_at, u.disabled_at, u.email_enc,
                COALESCE(p.xp, 0) AS xp, COALESCE(p.rides, 0) AS rides, COALESCE(p.distance_m, 0) AS distance_m
           FROM users u LEFT JOIN progression p ON p.user_id = u.id`,
      )
    ).rows;
    const ids = (await ctx.db.query('SELECT user_id, provider FROM auth_identities')).rows;
    const acts = (await ctx.db.query('SELECT user_id, COUNT(*) AS n, MAX(started_at) AS last FROM activities GROUP BY user_id')).rows;
    const platRows = (await ctx.db.query('SELECT user_id, platform FROM user_platforms')).rows;
    const platOf = new Map<string, string[]>();
    for (const x of platRows) platOf.set(String(x.user_id), [...(platOf.get(String(x.user_id)) ?? []), String(x.platform)]);
    const provOf = new Map<string, string[]>();
    for (const i of ids) provOf.set(String(i.user_id), [...(provOf.get(String(i.user_id)) ?? []), String(i.provider)]);
    const actOf = new Map(acts.map((a) => [String(a.user_id), { n: Number(a.n), last: iso(a.last) }]));

    let list = rows.map((u) => ({
      id: String(u.id),
      name: String(u.display_name),
      email: ctx.repos.readEmail(u.email_enc as Uint8Array | null),
      providers: provOf.get(String(u.id)) ?? [],
      platforms: platOf.get(String(u.id)) ?? [],
      createdAt: iso(u.created_at),
      lastLoginAt: iso(u.last_login_at),
      lastRideAt: actOf.get(String(u.id))?.last ?? null,
      rides: actOf.get(String(u.id))?.n ?? 0,
      distanceKm: Math.round(Number(u.distance_m) / 100) / 10,
      level: levelForXp(Number(u.xp)),
      disabled: !!u.disabled_at,
    }));
    if (q) list = list.filter((u) => u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || u.id.startsWith(q) || u.providers.some((p) => p.includes(q)));
    const cmp: Record<string, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      login: (a, b) => String(b.lastLoginAt ?? '').localeCompare(String(a.lastLoginAt ?? '')),
      rides: (a, b) => b.rides - a.rides,
      distance: (a, b) => b.distanceKm - a.distanceKm,
      name: (a, b) => a.name.localeCompare(b.name, 'fr'),
    };
    list.sort(cmp[sort] ?? cmp.created!);
    res.json({ total: list.length, users: list.slice(0, 500) });
  });

  r.get('/users/:id', async (req, res) => {
    const id = String(req.params.id);
    const u = (await ctx.db.query('SELECT id, display_name, created_at, last_login_at, disabled_at, email_enc FROM users WHERE id = $1', [id])).rows[0];
    if (!u) throw new HttpError(404, 'Compte introuvable', 'not_found');
    const idents = (await ctx.db.query('SELECT provider, created_at FROM auth_identities WHERE user_id = $1', [id])).rows;
    const prog = (await ctx.db.query('SELECT xp, rides, distance_m, elevation_m FROM progression WHERE user_id = $1', [id])).rows[0];
    const sessions = (await ctx.db.query('SELECT COUNT(*) AS n FROM sessions WHERE user_id = $1', [id])).rows[0];
    const plats = (await ctx.db.query('SELECT platform, first_seen_at, last_seen_at FROM user_platforms WHERE user_id = $1', [id])).rows;
    const acts = (
      await ctx.db.query('SELECT id, name, started_at, duration_s, distance_m, elevation_m, avg_watts, route_id, strava_status FROM activities WHERE user_id = $1 ORDER BY started_at DESC LIMIT 20', [id])
    ).rows;
    res.json({
      id: String(u.id),
      name: String(u.display_name),
      email: ctx.repos.readEmail(u.email_enc as Uint8Array | null),
      createdAt: iso(u.created_at),
      lastLoginAt: iso(u.last_login_at),
      disabled: !!u.disabled_at,
      disabledAt: iso(u.disabled_at),
      platforms: plats.map((x) => ({ platform: String(x.platform), since: iso(x.first_seen_at), last: iso(x.last_seen_at) })),
      identities: idents.map((i) => ({ provider: String(i.provider), since: iso(i.created_at) })),
      progression: prog ? { level: levelForXp(Number(prog.xp)), xp: Number(prog.xp), rides: Number(prog.rides), distanceKm: Math.round(Number(prog.distance_m) / 100) / 10, elevationM: Math.round(Number(prog.elevation_m)) } : null,
      sessions: Number(sessions?.n ?? 0),
      activities: acts.map((a) => ({ id: String(a.id), name: String(a.name), startedAt: iso(a.started_at), durationS: Number(a.duration_s), distanceKm: Math.round(Number(a.distance_m) / 100) / 10, elevationM: Math.round(Number(a.elevation_m)), avgWatts: a.avg_watts === null ? null : Math.round(Number(a.avg_watts)), routeId: a.route_id ? String(a.route_id) : null, strava: a.strava_status ? String(a.strava_status) : null })),
    });
  });

  /* ───────────── Gestion ───────────── */
  /** Suspend (ou réactive) un compte : ses sessions sont fermées et aucune nouvelle ne sera acceptée. */
  r.post('/users/:id/disable', async (req: AuthedRequest, res) => {
    const me = requireUser(req);
    const id = String(req.params.id);
    if (id === me.userId) throw new HttpError(400, 'Tu ne peux pas suspendre ton propre compte', 'self');
    const disabled = req.body?.disabled !== false;
    const exists = (await ctx.db.query('SELECT 1 AS x FROM users WHERE id = $1', [id])).rows[0];
    if (!exists) throw new HttpError(404, 'Compte introuvable', 'not_found');
    await ctx.db.query(disabled ? 'UPDATE users SET disabled_at = now() WHERE id = $1' : 'UPDATE users SET disabled_at = NULL WHERE id = $1', [id]);
    if (disabled) {
      await ctx.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      ctx.forgetSession();
    }
    ctx.log('info', `admin : compte ${id} ${disabled ? 'suspendu' : 'réactivé'} par ${me.userId}`);
    res.json({ ok: true, disabled });
  });

  /** Déconnecte un compte partout (sans le suspendre). */
  r.post('/users/:id/logout', async (req, res) => {
    const id = String(req.params.id);
    await ctx.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    ctx.forgetSession();
    ctx.log('info', `admin : sessions du compte ${id} fermées`);
    res.json({ ok: true });
  });

  /** Suppression définitive (même effacement que « supprimer mon compte »). La confirmation est le nom exact du compte. */
  r.delete('/users/:id', async (req: AuthedRequest, res) => {
    const me = requireUser(req);
    const id = String(req.params.id);
    if (id === me.userId) throw new HttpError(400, 'Tu ne peux pas supprimer ton propre compte ici', 'self');
    const u = (await ctx.db.query('SELECT display_name FROM users WHERE id = $1', [id])).rows[0];
    if (!u) throw new HttpError(404, 'Compte introuvable', 'not_found');
    if (req.body?.confirm !== String(u.display_name)) throw new HttpError(400, 'Confirmation : saisis le nom exact du compte', 'confirm');
    await ctx.repos.deleteUser(id);
    ctx.forgetSession();
    ctx.log('warn', `admin : compte ${id} supprimé par ${me.userId}`);
    res.status(204).end();
  });

  return r;
}
