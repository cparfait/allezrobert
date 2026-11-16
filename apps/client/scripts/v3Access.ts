import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Plugin } from 'vite';

const digest = (value: string) => createHash('sha256').update(value).digest();
const COOKIE = 'ar_v3_access';
const WINDOW_MS = 60_000;

/** Protection du catalogue et des fichiers servis par le plugin V3 sur le poste de développement. */
export function v3Access(code?: string): Plugin {
  return {
    name: 'ar-v3-access',
    apply: 'serve',
    configureServer(server) {
      if (!code) return;
      const expected = digest(code);
      const session = randomBytes(32).toString('hex');
      let windowEnd = 0;
      let attempts = 0;

      server.middlewares.use('/__v3', (req, res, next) => {
        const now = Date.now();
        const authorised = (req.headers.cookie ?? '').split(';').some(part => part.trim() === COOKIE + '=' + session);
        const access = req.url?.split('?')[0] === '/access';
        const reply = (status: number) => {
          res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
        };

        if (!access) return authorised ? next() : reply(403);
        if (req.method === 'GET') return reply(authorised ? 204 : 403);
        if (req.method !== 'POST') return reply(405);
        if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host && req.headers.origin !== 'https://' + req.headers.host) return reply(403);
        if (now >= windowEnd) {
          windowEnd = now + WINDOW_MS;
          attempts = 0;
        }
        if (attempts >= 5) return reply(429);
        const supplied = req.headers['x-ar-v3-code'];
        if (typeof supplied !== 'string' || !timingSafeEqual(digest(supplied), expected)) {
          attempts++;
          return reply(403);
        }
        res.setHeader('Set-Cookie', COOKIE + '=' + session + '; Path=/__v3; HttpOnly; SameSite=Strict');
        reply(204);
      });
    },
  };
}
