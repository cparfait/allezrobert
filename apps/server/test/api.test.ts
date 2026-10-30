/**
 * API HTTP sur base en mémoire (pg-mem) : connexion (dev, lien magique, OAuth Google simulé),
 * profil et consentements, téléversement FIT (XP, FC chiffrée ou retirée), classements de
 * segments, intégrations simulées, rendu, export et suppression RGPD, contrôle d'origine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Decoder, Stream } from '@garmin/fitsdk';
import { buildActivity, encodeActivity } from '@allezrobert/fit';
import type { ActivityRecord } from '@allezrobert/shared';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext, type AppContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';
import type { Mailer } from '../src/auth/mailer.ts';

let db: Db;
let ctx: AppContext;
let server: Server;
let base: string;
const sentLinks: string[] = [];
const fetchLog: Array<{ url: string; method: string }> = [];

/** Faux services tiers (Google, Strava, intervals.icu). */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  fetchLog.push({ url, method: init?.method ?? 'GET' });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'g-access' });
  if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return json({ sub: 'g-123', given_name: 'Gégé', email: 'gege@example.fr', email_verified: true });
  if (url.startsWith('https://www.strava.com/oauth/token')) return json({ access_token: 's-access', refresh_token: 's-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { firstname: 'Gégé' } });
  if (url.startsWith('https://www.strava.com/api/v3/uploads')) return json({ id: 42, id_str: '42', status: 'Your activity is still being processed.' }, 201);
  if (url.startsWith('https://intervals.icu/api/v1/athlete/0/activities')) return json({ id: 'i77' });
  if (url.startsWith('https://intervals.icu/api/v1/athlete/0')) return json({ id: 'i1' });
  return json({ error: 'inconnu' }, 404);
};

const mailer: Mailer = {
  enabled: true,
  async sendMagicLink(_to, link) {
    sentLinks.push(link);
  },
};

class Session {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      payload = Buffer.from(body);
      h['content-type'] ??= 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv!.split('=');
      if (k === 'ar_session') this.cookie = v ? `ar_session=${v}` : '';
      if (k === 'ar_oauth' && v) this.cookie = [this.cookie, `ar_oauth=${v}`].filter(Boolean).join('; ');
    }
    return res;
  }
  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await this.req(method, path, body);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
}

async function devLogin(name: string): Promise<Session> {
  const s = new Session();
  const r = await s.json('POST', '/api/auth/dev', { name });
  expect(r.status).toBe(200);
  return s;
}

function sampleFit(withHr: boolean): Uint8Array {
  const t0 = Date.UTC(2026, 9, 20, 9, 0, 0);
  const records: ActivityRecord[] = [];
  let dist = 0;
  let alt = 100;
  for (let i = 0; i < 1800; i++) {
    dist += 9;
    alt += i < 900 ? 0.2 : -0.1;
    const r: ActivityRecord = { t: t0 + i * 1000, distanceM: dist, speedMs: 9, altitudeM: alt, watts: 200 + (i % 30), cadence: 88, balanceLeft: 49 };
    if (withHr) r.hr = 130 + (i % 20);
    records.push(r);
  }
  return encodeActivity(buildActivity({ id: 'test', name: 'Test', riderMassKg: 75 }, records));
}

function fitHasHr(bytes: Uint8Array): boolean {
  const d = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const { messages } = d.read() as unknown as { messages: { recordMesgs: Array<Record<string, unknown>> } };
  return messages.recordMesgs.some((m) => typeof m.heartRate === 'number');
}

beforeAll(async () => {
  const config = testConfig({ DEV_LOGIN: 'true', STRAVA_CLIENT_ID: 'sid', STRAVA_CLIENT_SECRET: 'ssecret', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', LIVEKIT_URL: 'wss://lk.test', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'livekit-secret-livekit-secret', DISCORD_VOICE_INVITE: 'https://discord.gg/AllezRobert' });
  // TEST_DATABASE_URL=postgres://… : mêmes tests sur un vrai PostgreSQL (CI, Docker), base remise à zéro.
  const url = process.env.TEST_DATABASE_URL ?? 'memory';
  db = await createDb(url);
  if (url !== 'memory') await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const routes = await RouteStore.load(undefined);
  ctx = createContext(config, db, routes, { fetchFn: fakeFetch, mailer, log: (l, m) => { if (l === 'error') console.error(m); } });
  const app = express();
  mountApi(app, ctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});

describe('API — comptes et profil', () => {
  it('santé, fournisseurs, accès refusé sans session', async () => {
    const s = new Session();
    expect((await s.json('GET', '/api/health')).body).toMatchObject({ ok: true, db: 'ok' });
    expect((await s.json('GET', '/api/auth/providers')).body).toEqual({ google: true, discord: false, email: true, dev: true });
    expect((await s.json('GET', '/api/me')).status).toBe(401);
  });

  it('migrations idempotentes', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('profil : mise à jour, validation, cosmétiques verrouillés, FC chiffrée', async () => {
    const s = await devLogin('Robert');
    const me = await s.json('GET', '/api/me');
    expect(me.body.profile).toMatchObject({ displayName: 'Robert', ftpWatts: 200, consentHr: false });
    const up = await s.json('PUT', '/api/me/profile', { weightKg: 72, ftpWatts: 265, consentHr: true, maxHr: 186, equipped: { jersey: 'jersey-club-bleu' } });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ weightKg: 72, ftpWatts: 265, consentHr: true, maxHr: 186 });
    // FC max chiffrée en base (pas lisible en clair).
    const raw = await db.query('SELECT hr_settings_enc FROM profiles');
    const enc = raw.rows.map((r) => r.hr_settings_enc).find(Boolean) as Buffer;
    expect(enc.includes(Buffer.from('186'))).toBe(false);
    expect((await s.json('PUT', '/api/me/profile', { ftpWatts: 5000 })).status).toBe(400);
    expect((await s.json('PUT', '/api/me/profile', { equipped: { jersey: 'jersey-robert' } })).status).toBe(400);
    expect((await s.json('PUT', '/api/me/profile', { unknownField: 1 })).status).toBe(400);
  });

  it('contrôle d’origine anti-CSRF', async () => {
    const s = await devLogin('Csrf');
    const bad = await s.req('PUT', '/api/me/profile', { ftpWatts: 250 }, { origin: 'https://evil.example' });
    expect(bad.status).toBe(403);
    const ok = await s.req('PUT', '/api/me/profile', { ftpWatts: 250 }, { origin: 'http://localhost:5173' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('lien magique : envoi, usage unique, compte sans e-mail en clair', async () => {
    const s = new Session();
    const r = await s.req('POST', '/api/auth/magic', { email: 'Christophe.Test@Example.fr', redirect: '/garage' });
    expect(r.status).toBe(204);
    const link = new URL(sentLinks.at(-1)!);
    const verify = await s.req('GET', `${link.pathname}${link.search}`);
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe('http://localhost:5173/garage');
    expect((await s.json('GET', '/api/me')).body.profile.displayName).toBe('Christophe');
    const again = await new Session().req('GET', `${link.pathname}${link.search}`);
    expect(again.headers.get('location')).toContain('login=used');
    const users = await db.query('SELECT * FROM users');
    expect(JSON.stringify(users.rows)).not.toMatch(/example\.fr/i);
  });

  it('OAuth Google (simulé) : état signé, compte créé, rattachement par e-mail vérifié', async () => {
    const s = new Session();
    const start = await s.req('GET', '/api/auth/google/start?redirect=/accueil');
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const bad = await s.req('GET', `/api/auth/google/callback?state=autre&code=c`);
    expect(bad.headers.get('location')).toContain('login=failed');
    // Le cookie d'état a été effacé : on recommence proprement.
    const start2 = await s.req('GET', '/api/auth/google/start?redirect=/accueil');
    const state2 = new URL(start2.headers.get('location')!).searchParams.get('state')!;
    expect(state2).not.toBe(state);
    const cb = await s.req('GET', `/api/auth/google/callback?state=${state2}&code=c`);
    expect(cb.headers.get('location')).toBe('http://localhost:5173/accueil');
    const me = await s.json('GET', '/api/me');
    expect(me.body.profile.displayName).toBe('Gégé');
  });

  it('connexion de l’application Windows : session remise une seule fois au bon nonce', async () => {
    const nonce = 'n'.repeat(40);
    const app = new Session();
    expect((await app.req('POST', '/api/auth/desktop/poll', { nonce })).status).toBe(204);
    const browser = await devLogin('Desktop');
    // Sans session dans le navigateur : refusé.
    expect((await new Session().req('GET', `/api/auth/desktop/finish?nonce=${nonce}`)).status).toBe(400);
    // Nonce trop court : refusé.
    expect((await browser.req('GET', '/api/auth/desktop/finish?nonce=court')).status).toBe(400);
    expect((await browser.req('GET', `/api/auth/desktop/finish?nonce=${nonce}`)).status).toBe(200);
    // Un autre nonce ne donne rien.
    expect((await app.req('POST', '/api/auth/desktop/poll', { nonce: 'x'.repeat(40) })).status).toBe(204);
    const got = await app.json<{ sessionToken: string }>('POST', '/api/auth/desktop/poll', { nonce });
    expect(got.status).toBe(200);
    // Le jeton remis ouvre bien le compte, en Bearer et sans cookie.
    const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${got.body.sessionToken}` } });
    expect(me.status).toBe(200);
    // Remis une seule fois.
    expect((await app.req('POST', '/api/auth/desktop/poll', { nonce })).status).toBe(204);
  });

  it('déconnexion : la session est révoquée', async () => {
    const s = await devLogin('Partant');
    const cookie = s.cookie;
    expect((await s.req('POST', '/api/auth/logout')).status).toBe(204);
    const replay = new Session();
    replay.cookie = cookie;
    expect((await replay.json('GET', '/api/me')).status).toBe(401);
  });

  it('jeton de jeu', async () => {
    const s = await devLogin('Joueur');
    const t = await s.json('GET', '/api/auth/game-token');
    expect(t.status).toBe(200);
    expect(await ctx.tokens.verifyGame(t.body.token)).toMatchObject({ name: 'Joueur' });
  });
});

describe('API — sorties, segments, progression', () => {
  it('téléversement FIT : résumé, XP, FC retirée sans consentement, envoi Strava/intervals', async () => {
    const s = await devLogin('Fitter');
    // Liaisons simulées.
    const link = await s.req('GET', '/api/integrations/strava/start');
    const state = new URL(link.headers.get('location')!).searchParams.get('state')!;
    const cb = await s.req('GET', `/api/integrations/strava/callback?state=${state}&code=c&scope=read,activity:write`);
    expect(cb.headers.get('location')).toContain('strava=linked');
    expect((await s.req('PUT', '/api/integrations/intervals', { apiKey: 'cle-intervals-123' })).status).toBe(204);
    expect((await s.json('GET', '/api/integrations')).body).toMatchObject({ strava: { connected: true, athleteName: 'Gégé' }, intervals: { connected: true } });
    // Les secrets tiers sont chiffrés.
    const integ = await db.query('SELECT secret_enc FROM integrations');
    for (const row of integ.rows) expect(Buffer.from(row.secret_enc).includes(Buffer.from('cle-intervals'))).toBe(false);

    const up = await s.json('POST', '/api/activities?name=Boucle%20test', sampleFit(true));
    expect(up.status).toBe(201);
    expect(up.body.activity.distanceM).toBeCloseTo(16_200, -1);
    expect(up.body.activity.avgHr).toBeUndefined();
    expect(up.body.xpGained).toBe(Math.round(20 * 16.2 + up.body.activity.elevationM + 2 * (up.body.activity.movingS / 60)));
    expect(up.body.progression.level).toBe(2);
    expect(up.body.newlyUnlocked).toContain('jersey-chevreuse');
    const fit = await s.req('GET', `/api/activities/${up.body.activity.id}/fit`);
    expect(fitHasHr(new Uint8Array(await fit.arrayBuffer()))).toBe(false);
    // Envoi tiers en arrière-plan.
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchLog.some((f) => f.url.includes('strava.com/api/v3/uploads'))).toBe(true);
    expect(fetchLog.some((f) => f.url.includes('intervals.icu/api/v1/athlete/0/activities'))).toBe(true);
    const list = await s.json('GET', '/api/activities');
    expect(list.body[0]).toMatchObject({ stravaStatus: 'uploaded', intervalsStatus: 'uploaded' });
  });

  it('option « ne pas envoyer à Strava » et FC conservée (chiffrée) avec consentement', async () => {
    const s = await devLogin('Garmin');
    await s.req('PUT', '/api/me/profile', { consentHr: true, skipStrava: true });
    const before = fetchLog.length;
    const up = await s.json('POST', '/api/activities', sampleFit(true));
    expect(up.status).toBe(201);
    expect(up.body.activity.avgHr).toBeGreaterThan(130);
    expect(up.body.activity.skipStrava).toBe(true);
    const fit = await s.req('GET', `/api/activities/${up.body.activity.id}/fit`);
    expect(fitHasHr(new Uint8Array(await fit.arrayBuffer()))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchLog.slice(before).some((f) => f.url.includes('strava'))).toBe(false);
    // Retrait du consentement : résumé FC effacé et FIT ré-encodé sans FC.
    await s.req('PUT', '/api/me/profile', { consentHr: false });
    const a = await s.json('GET', `/api/activities/${up.body.activity.id}`);
    expect(a.body.avgHr).toBeUndefined();
    const fit2 = await s.req('GET', `/api/activities/${up.body.activity.id}/fit`);
    expect(fitHasHr(new Uint8Array(await fit2.arrayBuffer()))).toBe(false);
  });

  it('FIT invalide ou sortie en invité refusés', async () => {
    const s = await devLogin('Invité');
    expect((await s.json('POST', '/api/activities', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]))).status).toBe(400);
    expect((await s.json('POST', '/api/activities?guest=1', sampleFit(false))).status).toBe(403);
  });

  it('classement de segment : meilleur temps par coureur', async () => {
    const a = await devLogin('Alice');
    const b = await devLogin('Bob');
    const ida = (await a.json('GET', '/api/me')).body.id;
    const idb = (await b.json('GET', '/api/me')).body.id;
    for (const [u, ms] of [[ida, 300_000], [ida, 280_000], [idb, 290_000]] as const) {
      await ctx.repos.recordSegmentEffort({ userId: u, routeId: 'r1', segmentId: 'kom', elapsedMs: ms });
    }
    const board = await a.json('GET', '/api/segments/r1/kom/leaderboard');
    expect(board.body).toEqual([
      { rank: 1, name: 'Alice', bestMs: 280_000, efforts: 2 },
      { rank: 2, name: 'Bob', bestMs: 290_000, efforts: 1 },
    ]);
    expect((await a.json('GET', '/api/me/segments')).body).toEqual([{ routeId: 'r1', segmentId: 'kom', bestMs: 280_000 }]);
  });

  it('temps d’une sortie solo : segments et parcours entier, contrôlés et sans doublon', async () => {
    expect((await new Session().json('POST', '/api/efforts', { routeId: 'dev-boucle', segments: [] })).status).toBe(401);
    const s = await devLogin('Solo');
    // dev-boucle est connue du serveur : côte de 1 200 m, sprint de 300 m, boucle de ~10 km.
    const post = (body: unknown) => s.json('POST', '/api/efforts', body);
    const ok = await post({
      routeId: 'dev-boucle',
      rideId: 'sortie-1',
      segments: [
        { segmentId: 'dev-kom', elapsedMs: 240_000 },
        { segmentId: 'dev-sprint', elapsedMs: 5_000 }, // 300 m en 5 s : 216 km/h, refusé
        { segmentId: 'inconnu', elapsedMs: 60_000 }, // pas sur cet itinéraire, ignoré
      ],
      routeTimeMs: 1_500_000,
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ segments: 1, route: true });
    // Même envoi après une reprise de la sortie : rien de compté deux fois.
    expect((await post({ routeId: 'dev-boucle', rideId: 'sortie-1', segments: [{ segmentId: 'dev-kom', elapsedMs: 240_000 }], routeTimeMs: 1_500_000 })).body).toEqual({ segments: 0, route: false });
    // Parcours entier trop rapide (plus de 60 km/h de moyenne) : refusé.
    expect((await post({ routeId: 'dev-boucle', routeTimeMs: 60_000 })).body.route).toBe(false);
    // Itinéraire inconnu du serveur (autre zone) : accepté dans les bornes ; dessiné ou monde ouvert : non classé.
    expect((await post({ routeId: 'zone-ailleurs', segments: [{ segmentId: 'cote-1', elapsedMs: 300_000 }], routeTimeMs: 3_600_000 })).body).toEqual({ segments: 1, route: true });
    expect((await post({ routeId: 'itineraire-abc', routeTimeMs: 3_600_000 })).status).toBe(400);
    expect((await post({ routeId: 'open', routeTimeMs: 3_600_000 })).status).toBe(400);
    expect((await post({ routeId: 'dev-boucle', routeTimeMs: 1 })).status).toBe(400);
    expect((await post({ routeId: '../x', routeTimeMs: 3_600_000 })).status).toBe(400);
    expect((await s.json('GET', '/api/segments/dev-boucle/dev-kom/leaderboard')).body).toEqual([{ rank: 1, name: 'Solo', bestMs: 240_000, efforts: 1 }]);
    expect((await s.json('GET', '/api/routes/dev-boucle/leaderboard')).body).toEqual([{ rank: 1, name: 'Solo', bestMs: 1_500_000, efforts: 1 }]);
    expect((await s.json('GET', '/api/routes/dev-boucle/leaderboard?scope=friends')).body).toEqual([{ rank: 1, name: 'Solo', bestMs: 1_500_000, efforts: 1, me: true }]);
    expect((await new Session().json('GET', '/api/routes/dev-boucle/leaderboard?scope=friends')).status).toBe(401);
  });

  it('rendu vidéo : mise en file et suivi', async () => {
    const s = await devLogin('Monteur');
    expect((await s.json('POST', '/api/renders', { composition: 'summary' })).status).toBe(400);
    const act = await s.json('POST', '/api/activities?name=Vid%C3%A9o', sampleFit(true));
    const r = await s.json('POST', '/api/renders', { composition: 'summary', activityId: act.body.activity.id, variables: { title: 'Ma sortie' } });
    expect(r.status).toBe(202);
    const job = await s.json('GET', `/api/renders/${r.body.id}`);
    expect(job.body).toMatchObject({ status: 'queued', composition: 'summary', fileUrl: null });
    const row = (await db.query('SELECT payload FROM render_jobs WHERE id = $1', [r.body.id])).rows[0];
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    expect(payload.kind).toBe('summary');
    expect(payload.input).toMatchObject({ title: 'Ma sortie', routeName: 'Vidéo', stats: { distanceKm: 16.2 } });
    expect(payload.input.records.length).toBeGreaterThan(100);
    expect(payload.input.records.length).toBeLessThanOrEqual(900);
    expect(JSON.stringify(payload)).not.toContain('"hr"');
    const seq = await s.json('POST', '/api/renders', { composition: 'podium', variables: { title: 'Podium' } });
    expect(seq.status).toBe(202);
    expect((await s.json('POST', '/api/renders', { composition: 'inconnue' })).status).toBe(400);
  });

  it.runIf(!!process.env.TEST_DATABASE_URL)('file de rendu (PostgreSQL) : réservation SKIP LOCKED, fin, remise en file', async () => {
    const s = await devLogin('Worker');
    // Les rendus mis en file par les tests précédents passeraient avant celui-ci (réservation par ordre d'arrivée).
    await db.query("DELETE FROM render_jobs WHERE status = 'queued'");
    const id = (await s.json('POST', '/api/renders', { composition: 'kom' })).body.id as string;
    const [j1, j2] = await Promise.all([ctx.repos.claimRender(), ctx.repos.claimRender()]);
    const claimed = [j1, j2].filter(Boolean);
    expect(claimed.map((j) => j!.id)).toContain(id);
    expect(new Set(claimed.map((j) => j!.id)).size).toBe(claimed.length);
    await ctx.repos.requeueStaleRenders(0);
    await ctx.repos.finishRender(id, true, `${id}.mp4`, null);
    expect((await s.json('GET', `/api/renders/${id}`)).body).toMatchObject({ status: 'done', fileUrl: `/api/renders/${id}/file` });
  });

  it('voix : jeton réservé aux participants', async () => {
    const s = await devLogin('Bavard');
    const id = (await s.json('GET', '/api/me')).body.id;
    expect((await s.json('GET', '/api/rides/abc/voice-token')).status).toBe(403);
    ctx.registry.register({ roomId: 'abc', inviteCode: 'ZZZZZZ', routeId: 'r', mode: 'group', name: 'n', allowGuests: true, hostUserId: id });
    ctx.registry.join('abc', id, 'rider');
    const t = await s.json('GET', '/api/rides/abc/voice-token');
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ url: 'wss://lk.test', room: 'ride-abc' });
    expect((await s.json('GET', '/api/rides/current')).body).toMatchObject({ roomId: 'abc', inviteCode: 'ZZZZZZ' });
    expect((await s.json('GET', '/api/rides/code/zzz-zzz')).body).toMatchObject({ roomId: 'abc' });
  });

  it('voix : configuration publique (LiveKit, repli Discord) et lien Discord validé', async () => {
    const s = new Session();
    expect((await s.json('GET', '/api/voice')).body).toEqual({ livekit: true, discordInvite: 'https://discord.gg/AllezRobert' });
    expect(() => testConfig({ DISCORD_VOICE_INVITE: 'https://example.com/piege' })).toThrow(/DISCORD_VOICE_INVITE/);
    expect(testConfig({ DISCORD_VOICE_INVITE: 'https://discord.com/invite/abc-123' }).DISCORD_VOICE_INVITE).toBe('https://discord.com/invite/abc-123');
    expect(testConfig({ DISCORD_VOICE_INVITE: '' }).DISCORD_VOICE_INVITE).toBeUndefined();
  });
});

describe('API — atelier (crédits, achats, équipement)', () => {
  it('crédits gagnés avec la sortie, achat validé par le serveur, montant manquant', async () => {
    const s = await devLogin('Mécano');
    const id = (await s.json('GET', '/api/me')).body.id as string;
    const up = await s.json('POST', '/api/activities', sampleFit(false));
    expect(up.status).toBe(201);
    // 16,2 km, 180 m de D+, première sortie du jour (série d'un jour) : 16 + 9 + 5.
    expect(up.body.credits.credits).toBe(30);
    expect(up.body.credits.balance).toBe(30);
    let prog = await s.json('GET', '/api/me/progression');
    expect(prog.body.atelier.credits).toBe(30);
    // Trop cher : refusé avec le montant manquant, rien n'est débité.
    const poor = await s.json('POST', '/api/shop/buy', { id: 'tune-st-robert' });
    expect(poor.status).toBe(402);
    expect(poor.body).toMatchObject({ error: 'credits', missing: 120, credits: 30 });
    // Récompense d'événement et pièce réservée à un ensemble : jamais à vendre.
    expect((await s.json('POST', '/api/shop/buy', { id: 'tune-ev-win' })).status).toBe(403);
    expect((await s.json('POST', '/api/shop/buy', { id: 'tune-pa-shadow' })).status).toBe(403);
    expect((await s.json('POST', '/api/shop/buy', { id: 'tune-inconnue' })).status).toBe(404);
    // Niveau insuffisant pour des roues de niveau 20.
    const a = await ctx.repos.getAtelier(id);
    await ctx.repos.saveAtelier(ctx.db, id, { ...a, credits: 5000 });
    expect((await s.json('POST', '/api/shop/buy', { id: 'tune-wh-enve-34' })).body.error).toBe('level');
    const ok = await s.json('POST', '/api/shop/buy', { id: 'tune-st-robert' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, price: 150, credits: 4850 });
    expect(ok.body.owned).toContain('tune-st-robert');
    expect((await s.json('POST', '/api/shop/buy', { id: 'tune-st-robert' })).status).toBe(409);
    prog = await s.json('GET', '/api/me/progression');
    expect(prog.body.atelier).toMatchObject({ credits: 4850, owned: ['tune-st-robert'] });
  });

  it('équipement : pièces possédées seulement, avatar.tune recalculé, anciennes roues migrées', async () => {
    const s = await devLogin('Monteur');
    const me = (await s.json('GET', '/api/me')).body;
    const id = me.id as string;
    const avatar = me.profile.avatar;
    // Pièce non possédée : refusée, à l'équipement comme à l'affichage.
    expect((await s.json('PUT', '/api/me/profile', { equipped: { valves: 'tune-va-rouge' } })).status).toBe(400);
    expect((await s.json('PUT', '/api/me/profile', { avatar: { ...avatar, tune: ['tune-va-rouge'] } })).status).toBe(400);
    const a = await ctx.repos.getAtelier(id);
    await ctx.repos.saveAtelier(ctx.db, id, { ...a, owned: ['tune-va-rouge'] });
    const put = await s.json('PUT', '/api/me/profile', { equipped: { valves: 'tune-va-rouge' }, avatar: { ...avatar, tune: [] } });
    expect(put.status).toBe(200);
    expect(put.body.avatar.tune).toEqual(['tune-va-rouge']);
    // Mauvais emplacement.
    expect((await s.json('PUT', '/api/me/profile', { equipped: { tape: 'tune-va-rouge' } })).status).toBe(400);
    // Anciennes roues du garage : la paire de l'atelier est offerte et équipée.
    const mig = await s.json('PUT', '/api/me/profile', { equipped: { wheels: 'wheels-carbone-88', valves: 'tune-va-rouge' } });
    expect(mig.status).toBe(200);
    expect(mig.body.equipped).toEqual({ wheelset: 'tune-wh-enve-67', valves: 'tune-va-rouge' });
    expect((await ctx.repos.getAtelier(id)).owned).toContain('tune-wh-enve-67');
  });
});

describe('API — RGPD', () => {
  it('export complet puis suppression de toutes les données', async () => {
    const s = await devLogin('Effacé');
    const id = (await s.json('GET', '/api/me')).body.id;
    await s.json('POST', '/api/activities', sampleFit(false));
    await ctx.repos.recordSegmentEffort({ userId: id, routeId: 'r1', segmentId: 'kom', elapsedMs: 1 });
    await ctx.repos.recordRouteTime({ userId: id, routeId: 'r1', elapsedMs: 3_600_000 });
    await s.json('POST', '/api/renders', { composition: 'podium' });
    const exp = await s.json('GET', '/api/me/export');
    expect(exp.status).toBe(200);
    expect(exp.body.activities).toHaveLength(1);
    expect(Object.keys(exp.body.activityFitBase64)).toHaveLength(1);
    expect(exp.body.segmentEfforts).toHaveLength(1);
    expect(exp.body.routeTimes).toHaveLength(1);
    expect(exp.body.atelier.credits).toBeGreaterThan(0);
    expect((await s.json('DELETE', '/api/me', {})).status).toBe(400);
    expect((await s.json('DELETE', '/api/me', { confirm: 'SUPPRIMER' })).status).toBe(204);
    for (const table of ['users', 'profiles', 'activities', 'segment_efforts', 'route_times', 'progression', 'sessions', 'auth_identities', 'render_jobs', 'integrations']) {
      const col = table === 'users' ? 'id' : 'user_id';
      const r = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = $1`, [id]);
      expect(Number(r.rows[0].n), table).toBe(0);
    }
    expect((await s.json('GET', '/api/me')).status).toBe(401);
  });
});
