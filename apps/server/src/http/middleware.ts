/**
 * Intergiciels de l'API : CORS restreint aux origines connues, contrôle d'origine sur les
 * requêtes modifiantes (anti-CSRF, en plus de SameSite=Lax), authentification par cookie
 * de session ou en-tête Bearer, limitation de débit en mémoire, erreurs JSON.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { AppContext } from '../context.ts';
import { parseCookies, serializeCookie, SESSION_COOKIE } from './cookies.ts';

export interface AuthedRequest extends Request {
  user?: { userId: string; sessionId: string; name: string };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

export function cors(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && ctx.config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
    } else if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Requêtes modifiantes : l'en-tête Origin, s'il est présent, doit être une origine connue. */
export function originCheck(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    const apiOrigin = new URL(ctx.config.apiPublicUrl).origin;
    if (origin && origin !== apiOrigin && !ctx.config.corsOrigins.includes(origin)) {
      return next(new HttpError(403, 'Origine non autorisée', 'bad_origin'));
    }
    next();
  };
}

/** Plateforme du client d'après l'origine : application macOS (tauri://localhost), Windows (http(s)://tauri.localhost), sinon le site. */
export type Platform = 'web' | 'windows' | 'mac';
export function platformOf(req: Request): Platform {
  const origin = String(req.headers.origin ?? '');
  if (/^tauri:\/\/localhost$/i.test(origin)) return 'mac';
  if (/^https?:\/\/tauri\.localhost$/i.test(origin)) return 'windows';
  return 'web';
}

export function sessionToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function loadUser(ctx: AppContext) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> => {
    const claims = await ctx.verifySessionToken(sessionToken(req));
    if (claims) req.user = claims;
    next();
  };
}

export function requireUser(req: AuthedRequest): { userId: string; sessionId: string; name: string } {
  if (!req.user) throw new HttpError(401, 'Connexion requise', 'unauthorized');
  return req.user;
}

export function setSessionCookie(ctx: AppContext, res: Response, token: string): void {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { secure: ctx.config.cookieSecure, maxAgeS: ctx.config.SESSION_TTL_DAYS * 86400 }));
}

export function clearSessionCookie(ctx: AppContext, res: Response): void {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { secure: ctx.config.cookieSecure, maxAgeS: 0 }));
}

/** Limiteur à fenêtre glissante, en mémoire (clé = IP ou empreinte). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

export function errorHandler(ctx: AppContext) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid', message: 'Données invalides', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', message: 'Fichier trop volumineux' });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'JSON invalide' });
      return;
    }
    ctx.log('error', `API : ${(err as Error)?.stack ?? String(err)}`);
    res.status(500).json({ error: 'internal', message: 'Erreur interne' });
  };
}
