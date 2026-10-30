/**
 * Relais de connexion Spotify pour les applications de bureau (Windows, macOS).
 *
 * Spotify n'accepte comme adresse de retour que des adresses déclarées chez lui (https ou boucle locale) : l'application
 * ne peut pas recevoir le retour dans sa propre fenêtre. Elle ouvre donc l'autorisation dans le navigateur du poste, avec
 * l'adresse du site (déjà déclarée pour la version web) ; la page du site, au retour, dépose ici le « code » reçu, que
 * l'application vient chercher avec son « state » (un nonce qu'elle est seule à connaître). Le code ne sert à rien sans
 * le « code_verifier » PKCE, qui ne quitte jamais l'application. Aucun secret n'est impliqué ; mémoire seulement, 5 minutes.
 */
import express from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, RateLimiter } from './middleware.ts';

const TTL_MS = 5 * 60_000;
/** « state » des connexions venues d'une application : préfixe « desk » puis un nonce aléatoire. */
const STATE = z.string().regex(/^desk[A-Za-z0-9_-]{20,80}$/);

export function spotifyRelayRoutes(_ctx: AppContext): express.Router {
  const r = express.Router();
  const codes = new Map<string, { code: string; until: number }>();
  const limiter = new RateLimiter(60, 60_000);
  const sweep = (now: number) => {
    for (const [k, v] of codes) if (v.until < now) codes.delete(k);
  };

  r.post('/put', (req, res) => {
    if (!limiter.allow(`put|${req.ip}`)) throw new HttpError(429, 'Trop de demandes', 'rate_limited');
    const body = z.object({ state: STATE, code: z.string().min(10).max(1024) }).parse(req.body);
    const now = Date.now();
    sweep(now);
    if (codes.size > 500) throw new HttpError(503, 'Relais saturé', 'busy');
    codes.set(body.state, { code: body.code, until: now + TTL_MS });
    res.status(204).end();
  });

  /** Lecture unique : le code est retiré dès qu'il est rendu. */
  r.post('/take', (req, res) => {
    if (!limiter.allow(`take|${req.ip}`)) throw new HttpError(429, 'Trop de demandes', 'rate_limited');
    const body = z.object({ state: STATE }).parse(req.body);
    const hit = codes.get(body.state);
    if (!hit || hit.until < Date.now()) return void res.status(404).json({ error: 'pending' });
    codes.delete(body.state);
    res.json({ code: hit.code });
  });

  return r;
}
