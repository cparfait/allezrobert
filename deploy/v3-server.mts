import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { v3AssetMiddleware } from '../apps/client/scripts/v3Assets.ts';

const COOKIE = 'ar_v3_access';
const PREFIX = '/__v3';
const MINUTE = 60_000;
const SESSION_TTL = 12 * 60 * MINUTE;
const code = process.env.AR_V3_ACCESS_CODE;
const origin = process.env.AR_V3_PUBLIC_ORIGIN;
const expected = code && digest(code);
const visibilityFile = process.env.AR_V3_VISIBILITY_FILE;
const key = randomBytes(32);
const limits = new Map<string, number>();
let failures = 0;
let windowEnd = 0;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function signature(value: string) {
  return createHmac('sha256', key).update(value).digest('base64url');
}

function validSession(token: string | undefined, now: number) {
  const match = /^(\d{13}\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  return !!match && Number(match[1]!.split('.')[0]) > now
    && timingSafeEqual(Buffer.from(match[2]!), Buffer.from(signature(match[1]!)));
}

const assets = v3AssetMiddleware(console, true);
createServer(async (req, res) => {
  const reply = (status: number) => res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
  const url = req.url ?? '';
  const path = url.split('?')[0];
  if (path === '/health') return reply(expected ? 204 : 503);
  // Ce chemin reste sur le réseau Docker. Seule l’API d’administration le relaie après authentification.
  if (req.method === 'GET' && (path === '/internal/gear' || path === '/internal/catalogue')) {
    if (!expected) return reply(503);
    req.url = path.slice('/internal'.length);
    return assets(req, res);
  }
  if (!path?.startsWith(PREFIX + '/')) return reply(404);
  if (!expected) return reply(503);

  const now = Date.now();
  const cookie = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (path !== PREFIX + '/access') {
    if (!validSession(cookie, now)) return reply(403);
    req.url = url.slice(PREFIX.length);
    if (visibilityFile && (path === PREFIX + '/gear' || path === PREFIX + '/catalogue')) {
      try {
        const hidden: unknown = JSON.parse(await readFile(visibilityFile, 'utf8'));
        if (!Array.isArray(hidden) || !hidden.every(item => typeof item === 'string')) throw new Error('Liste V3 invalide');
        return assets(req, res, new Set<string>(hidden));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('Lecture de la visibilité V3 impossible', error);
          return reply(503);
        }
      }
    }
    return assets(req, res);
  }

  if (req.method === 'GET') return reply(validSession(cookie, now) ? 204 : 403);
  if (req.method !== 'POST') return reply(405);
  if (req.headers.origin && req.headers.origin !== origin) return reply(403);
  if (now >= windowEnd) {
    windowEnd = now + MINUTE;
    failures = 0;
    limits.clear();
  }
  // Seul Caddy joint ce port et remplace lui-même X-Real-IP.
  const address = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '');
  const attempts = limits.get(address) ?? 0;
  if (attempts >= 5 || failures >= 40) {
    res.setHeader('Retry-After', String(Math.ceil((windowEnd - now) / 1000)));
    return reply(429);
  }

  const supplied = req.headers['x-ar-v3-code'];
  if (typeof supplied !== 'string' || !timingSafeEqual(digest(supplied), expected)) {
    limits.set(address, attempts + 1);
    failures++;
    return reply(403);
  }
  const claim = `${now + SESSION_TTL}.${randomBytes(16).toString('base64url')}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${claim}.${signature(claim)}; Path=${PREFIX}; Max-Age=${SESSION_TTL / 1000}; Secure; HttpOnly; SameSite=Strict`);
  reply(204);
}).listen(Number(process.env.PORT ?? 2570), process.env.HOST ?? '127.0.0.1');
