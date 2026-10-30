/**
 * Authentification : OAuth Google / Discord, lien magique par e-mail, session par cookie
 * HTTP-only (JWT jose + ligne `sessions` révocable), jeton de jeu pour la connexion WebSocket.
 */
import express, { type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { authorizeUrl, exchangeCode, fetchIdentity, newPkce, safeRedirect, type LoginProvider, type OAuthClient } from '../auth/oauth.ts';
import { normalizeEmail } from '../crypto.ts';
import { OAUTH_COOKIE, parseCookies, serializeCookie } from './cookies.ts';
import { clearSessionCookie, HttpError, RateLimiter, requireUser, sessionToken, setSessionCookie, type AuthedRequest } from './middleware.ts';
import type { User } from '../db/repos.ts';

export function loginClient(ctx: AppContext, provider: LoginProvider): OAuthClient | null {
  const c = ctx.config;
  const id = provider === 'google' ? c.GOOGLE_CLIENT_ID : c.DISCORD_CLIENT_ID;
  const secret = provider === 'google' ? c.GOOGLE_CLIENT_SECRET : c.DISCORD_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret, redirectUri: `${c.apiPublicUrl}/api/auth/${provider}/callback` };
}

/** Ouvre une session : ligne en base + cookie HTTP-only signé. */
export async function openSession(ctx: AppContext, res: Response, user: User): Promise<string> {
  const s = await ctx.repos.createSession(user.id, ctx.config.SESSION_TTL_DAYS);
  const token = await ctx.tokens.signSession({ userId: user.id, sessionId: s.id, name: user.displayName }, ctx.config.SESSION_TTL_DAYS * 86400);
  setSessionCookie(ctx, res, token);
  return token;
}

function redirectTo(ctx: AppContext, path: string): string {
  return `${ctx.config.PUBLIC_URL}${safeRedirect(path)}`;
}

export function authRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const magicByIp = new RateLimiter(5, 15 * 60_000);
  const magicByEmail = new RateLimiter(3, 15 * 60_000);

  r.get('/providers', (_req, res) => {
    res.json({
      google: !!loginClient(ctx, 'google'),
      discord: !!loginClient(ctx, 'discord'),
      email: ctx.mailer.enabled,
      dev: ctx.config.DEV_LOGIN && ctx.config.NODE_ENV !== 'production',
    });
  });

  for (const provider of ['google', 'discord'] as const) {
    r.get(`/${provider}/start`, async (req, res) => {
      const client = loginClient(ctx, provider);
      if (!client) throw new HttpError(404, `Connexion ${provider} non configurée`, 'not_configured');
      const pkce = newPkce();
      const state = await ctx.tokens.signOAuthState({ provider, state: pkce.state, verifier: pkce.verifier, redirect: safeRedirect(req.query.redirect) });
      res.append('Set-Cookie', serializeCookie(OAUTH_COOKIE, state, { secure: ctx.config.cookieSecure, maxAgeS: 600, path: '/api' }));
      res.redirect(302, authorizeUrl(provider, client, pkce));
    });

    r.get(`/${provider}/callback`, async (req, res) => {
      const client = loginClient(ctx, provider);
      if (!client) throw new HttpError(404, `Connexion ${provider} non configurée`, 'not_configured');
      const st = await ctx.tokens.verifyOAuthState(parseCookies(req.headers.cookie)[OAUTH_COOKIE] ?? '');
      res.append('Set-Cookie', serializeCookie(OAUTH_COOKIE, '', { secure: ctx.config.cookieSecure, maxAgeS: 0, path: '/api' }));
      if (!st || st.provider !== provider || st.state !== req.query.state || typeof req.query.code !== 'string') {
        return res.redirect(302, redirectTo(ctx, '/?login=failed'));
      }
      try {
        const tok = await exchangeCode(provider, client, req.query.code, st.verifier, ctx.fetchFn);
        const ident = await fetchIdentity(provider, String(tok.access_token), ctx.fetchFn);
        const emailHash = ident.verifiedEmail ? ctx.cipher.emailHash(ident.verifiedEmail) : undefined;
        const user = await ctx.repos.upsertIdentity(provider, ident.subject, ident.displayName, emailHash, ident.verifiedEmail ?? undefined);
        await openSession(ctx, res, user);
        res.redirect(302, redirectTo(ctx, st.redirect));
      } catch (e) {
        ctx.log('warn', `OAuth ${provider} : ${(e as Error).message}`);
        res.redirect(302, redirectTo(ctx, '/?login=failed'));
      }
    });
  }

  r.post('/magic', async (req, res) => {
    const body = z
      .object({ email: z.string().email().max(254), redirect: z.string().max(512).optional(), locale: z.enum(['fr', 'en']).optional() })
      .parse(req.body);
    if (!ctx.mailer.enabled) throw new HttpError(503, 'Connexion par e-mail indisponible', 'not_configured');
    const email = normalizeEmail(body.email);
    const hash = ctx.cipher.emailHash(email);
    if (!magicByIp.allow(req.ip ?? 'ip') || !magicByEmail.allow(hash)) throw new HttpError(429, 'Trop de demandes, réessaie dans quelques minutes', 'rate_limited');
    // Nom proposé pour un nouveau compte : partie locale de l'adresse (« christophe.parfait » → « Christophe »).
    const local = email.split('@')[0] ?? 'coureur';
    const first = local.split(/[._+-]/)[0] ?? local;
    const name = first.charAt(0).toUpperCase() + first.slice(1);
    const token = await ctx.tokens.signMagic(hash, name, safeRedirect(body.redirect), undefined, ctx.cipher.encrypt(email, 'magic-email').toString('base64url'));
    const link = `${ctx.config.apiPublicUrl}/api/auth/magic/verify?token=${encodeURIComponent(token)}`;
    await ctx.mailer.sendMagicLink(email, link, body.locale ?? 'fr');
    // Réponse identique que le compte existe ou non (pas d'énumération).
    res.status(204).end();
  });

  r.get('/magic/verify', async (req, res) => {
    const claims = await ctx.tokens.verifyMagic(String(req.query.token ?? ''));
    if (!claims) return res.redirect(302, redirectTo(ctx, '/?login=expired'));
    if (!(await ctx.repos.consumeMagicLink(claims.jti, new Date(claims.exp * 1000)))) return res.redirect(302, redirectTo(ctx, '/?login=used'));
    let email: string | undefined;
    try {
      email = claims.emailEnc ? ctx.cipher.decrypt(Buffer.from(claims.emailEnc, 'base64url'), 'magic-email').toString('utf8') : undefined;
    } catch {
      email = undefined;
    }
    const user = await ctx.repos.upsertIdentity('email', claims.emailHash, claims.name, claims.emailHash, email);
    await openSession(ctx, res, user);
    res.redirect(302, redirectTo(ctx, claims.redirect));
  });

  /** Connexion de développement (DEV_LOGIN=true, jamais en production). */
  r.post('/dev', async (req, res) => {
    if (!ctx.config.DEV_LOGIN || ctx.config.NODE_ENV === 'production') throw new HttpError(404, 'Introuvable', 'not_found');
    const body = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
    const user = await ctx.repos.upsertIdentity('dev', body.name.toLowerCase(), body.name);
    const token = await openSession(ctx, res, user);
    res.json({ user: { id: user.id, displayName: user.displayName }, sessionToken: token });
  });

  /**
   * Connexion de l'application Windows : la page de connexion s'ouvre dans le navigateur du PC
   * (redirect = /api/auth/desktop/finish?nonce=…), puis l'application, qui connaît seule le nonce,
   * vient chercher la session par `POST /desktop/poll`. Le jeton n'est remis qu'une fois.
   */
  const desktopHandoff = new Map<string, { token: string; exp: number }>();
  const NONCE = /^[A-Za-z0-9_-]{32,64}$/;
  const sweepHandoff = (now: number): void => {
    for (const [k, v] of desktopHandoff) if (v.exp < now) desktopHandoff.delete(k);
  };

  r.get('/desktop/finish', (req: AuthedRequest, res) => {
    const nonce = String(req.query.nonce ?? '');
    const token = sessionToken(req);
    const page = (ok: boolean): string =>
      `<!doctype html><meta charset="utf-8"><title>Allez Robert !</title><body style="font-family:system-ui;background:#0a0e16;color:#f5f7fa;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${ok ? 'Connexion réussie' : 'Connexion impossible'}</h1><p>${ok ? 'Tu peux fermer cet onglet et retourner dans l’application Allez Robert !.' : 'Retourne dans l’application et réessaie.'}</p></div>`;
    res.setHeader('Cache-Control', 'no-store');
    res.type('html');
    if (!NONCE.test(nonce) || !token || !req.user) return res.status(400).send(page(false));
    const now = Date.now();
    sweepHandoff(now);
    if (desktopHandoff.size > 1000) return res.status(429).send(page(false));
    desktopHandoff.set(nonce, { token, exp: now + 5 * 60_000 });
    res.send(page(true));
  });

  r.post('/desktop/poll', (req, res) => {
    const body = z.object({ nonce: z.string().regex(NONCE) }).parse(req.body);
    const hit = desktopHandoff.get(body.nonce);
    res.setHeader('Cache-Control', 'no-store');
    if (!hit || hit.exp < Date.now()) return res.status(204).end();
    desktopHandoff.delete(body.nonce);
    res.json({ sessionToken: hit.token });
  });

  r.post('/logout', async (req: AuthedRequest, res) => {
    if (req.user) {
      await ctx.repos.deleteSession(req.user.sessionId);
      ctx.forgetSession(req.user.sessionId);
    }
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  /** Jeton court pour rejoindre une salle (options `token` de la connexion Colyseus). */
  r.get('/game-token', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const ttlS = 4 * 3600;
    const token = await ctx.tokens.signGame({ userId: u.userId, name: u.name }, ttlS);
    res.json({ token, expiresAt: Date.now() + ttlS * 1000 });
  });

  return r;
}
