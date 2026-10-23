/**
 * Assemblage des services du serveur (configuration, base, chiffrement, jetons, e-mail,
 * intégrations, registre des sorties, amis, itinéraires) partagé par l'API HTTP et les salles.
 */
import type { Config } from './config.ts';
import { DataCipher } from './crypto.ts';
import type { Db } from './db/db.ts';
import { Repos } from './db/repos.ts';
import { TokenService } from './auth/tokens.ts';
import { createMailer, type Mailer } from './auth/mailer.ts';
import { UploadService } from './integrations/uploads.ts';
import { RideRegistry } from './ride/registry.ts';
import { FriendRepo } from './db/friends.ts';
import { FriendHub } from './friends/hub.ts';
import type { RouteStore } from './ride/routes.ts';
import type { RideServices } from './ride/services.ts';
import { parseCookies, SESSION_COOKIE } from './http/cookies.ts';
import { levelForXp } from '@allezrobert/shared';
import { rewardEvents } from './progression/atelier.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, msg: string) => void;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(min: LogLevel): Logger {
  return (level, msg) => {
    if (LEVELS[level] < LEVELS[min]) return;
    const line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
}

export interface AppContext {
  config: Config;
  db: Db;
  repos: Repos;
  cipher: DataCipher;
  tokens: TokenService;
  mailer: Mailer;
  uploads: UploadService;
  registry: RideRegistry;
  /** Amis : dépôt SQL, présence et invitations à rouler (en mémoire). */
  friends: FriendHub;
  routes: RouteStore;
  fetchFn: typeof fetch;
  log: Logger;
  /** Vérifie un cookie / jeton de session (avec cache court des sessions valides). */
  verifySessionToken(token: string | undefined): Promise<{ userId: string; sessionId: string; name: string } | null>;
  /** Invalide le cache de session (déconnexion, suppression de compte). */
  forgetSession(sessionId?: string): void;
  /** Worker vidéo intégré (RENDER_INLINE) : réveillé à chaque nouvelle tâche. */
  renderWorker?: { nudge(): void };
}

export function createContext(config: Config, db: Db, routes: RouteStore, opts: { fetchFn?: typeof fetch; log?: Logger; mailer?: Mailer } = {}): AppContext {
  const cipher = new DataCipher(config.DATA_ENCRYPTION_KEY);
  const repos = new Repos(db, cipher);
  const tokens = new TokenService(config.SESSION_SECRET);
  const log = opts.log ?? createLogger(config.LOG_LEVEL);
  const fetchFn = opts.fetchFn ?? fetch;
  const mailer = opts.mailer ?? createMailer(config.SMTP_URL, config.SMTP_FROM, config.NODE_ENV === 'production', (m) => log('info', m));
  const strava =
    config.STRAVA_CLIENT_ID && config.STRAVA_CLIENT_SECRET
      ? { clientId: config.STRAVA_CLIENT_ID, clientSecret: config.STRAVA_CLIENT_SECRET, redirectUri: `${config.apiPublicUrl}/api/integrations/strava/callback` }
      : null;
  const uploads = new UploadService(repos, strava, fetchFn);
  const cache = new Map<string, number>();
  const registry = new RideRegistry();

  return {
    config,
    db,
    repos,
    cipher,
    tokens,
    mailer,
    uploads,
    registry,
    friends: new FriendHub(new FriendRepo(db), registry),
    routes,
    fetchFn,
    log,
    async verifySessionToken(token) {
      if (!token) return null;
      const claims = await tokens.verifySession(token);
      if (!claims) return null;
      const cachedUntil = cache.get(claims.sessionId);
      if (cachedUntil !== undefined && cachedUntil > Date.now()) return claims;
      if (!(await repos.sessionValid(claims.sessionId, claims.userId))) {
        cache.delete(claims.sessionId);
        return null;
      }
      if (cache.size > 5000) cache.clear();
      cache.set(claims.sessionId, Date.now() + 30_000);
      return claims;
    },
    forgetSession(sessionId) {
      if (sessionId) cache.delete(sessionId);
      else cache.clear();
    },
  };
}

/** Services de la salle « ride » branchés sur le contexte. */
export function rideServicesFrom(ctx: AppContext): RideServices {
  return {
    registry: ctx.registry,
    routes: ctx.routes,
    guestMaxWkg: ctx.config.GUEST_MAX_WKG,
    reconnectGraceS: ctx.config.RECONNECT_GRACE_S,
    allowAnonymousGuests: ctx.config.ALLOW_ANONYMOUS_GUESTS,
    async authenticate(token, cookieHeader) {
      if (token) {
        const g = await ctx.tokens.verifyGame(token);
        if (g) return g;
        const s = await ctx.verifySessionToken(token);
        if (s) return { userId: s.userId, name: s.name };
      }
      const fromCookie = parseCookies(cookieHeader)[SESSION_COOKIE];
      const s = await ctx.verifySessionToken(fromCookie);
      return s ? { userId: s.userId, name: s.name } : null;
    },
    async loadProfile(userId) {
      const p = await ctx.repos.getProfile(userId);
      if (!p) return null;
      const [prog, atelier] = await Promise.all([ctx.repos.getProgression(userId), ctx.repos.getAtelier(userId)]);
      return { displayName: p.displayName, weightKg: p.weightKg, heightCm: p.heightCm, ftpWatts: p.ftpWatts, avatar: p.avatar, consentHr: p.consentHr, equipped: p.equipped, owned: atelier.owned, level: levelForXp(prog.xp) };
    },
    rewardEvents: (userId, events) => rewardEvents(ctx.repos, userId, events),
    async rewardKom(userId) {
      const n = await ctx.repos.addKom(userId);
      return rewardEvents(ctx.repos, userId, n >= 5 ? ['kom', 'kom-5'] : ['kom']);
    },
    async personalBests(userId, routeId) {
      return (await ctx.repos.personalBests(userId, routeId)).map((b) => [b.segmentId, b.bestMs] as [string, number]);
    },
    recordEffort: (e) => ctx.repos.recordSegmentEffort(e),
    log: ctx.log,
  };
}
