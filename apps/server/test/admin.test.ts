/**
 * Administration : accès réservé au compte administrateur (empreinte de l'e-mail), mot de passe facultatif,
 * statistiques, liste et gestion des inscrits (suspension, déconnexion, suppression).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext, type AppContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';

const ADMIN_EMAIL = 'admin@example.fr';
const PASSWORD = 'phrase-de-passe-tres-longue';
let db: Db;
let ctx: AppContext;
let server: Server;
let base: string;

async function sessionFor(name: string, email?: string): Promise<{ cookie: string; userId: string }> {
  const user = await ctx.repos.upsertIdentity('dev', `sub-${name}`, name, email ? ctx.cipher.emailHash(email) : undefined);
  const s = await ctx.repos.createSession(user.id, 30);
  const token = await ctx.tokens.signSession({ userId: user.id, sessionId: s.id, name }, 3600);
  return { cookie: `ar_session=${encodeURIComponent(token)}`, userId: user.id };
}

async function call(method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; body: any; setCookie: string[] }> {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.getSetCookie() };
}

async function boot(overrides: Record<string, string>): Promise<void> {
  db = await createDb('memory');
  await migrate(db);
  ctx = createContext(testConfig({ DEV_LOGIN: 'true', ADMIN_EMAIL, ...overrides }), db, await RouteStore.load(undefined));
  const app = express();
  mountApi(app, ctx);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop(): Promise<void> {
  await new Promise((r) => server.close(r));
  await db.close();
}

describe('administration — accès par compte seul', () => {
  beforeAll(() => boot({}));
  afterAll(stop);

  it('refuse sans connexion (401) et cache la page aux autres comptes (404)', async () => {
    expect((await call('GET', '/status')).status).toBe(401);
    const other = await sessionFor('Curieux', 'curieux@example.fr');
    expect((await call('GET', '/status', other.cookie)).status).toBe(404);
    expect((await call('GET', '/stats', other.cookie)).status).toBe(404);
    const noMail = await sessionFor('SansMail');
    expect((await call('GET', '/users', noMail.cookie)).status).toBe(404);
  });

  it('introuvable depuis les applications de bureau, même pour l’administrateur', async () => {
    const admin = await sessionFor('ChefApp', ADMIN_EMAIL);
    for (const origin of ['http://tauri.localhost', 'tauri://localhost']) {
      const res = await fetch(`${base}/api/admin/status`, { headers: { cookie: admin.cookie, origin } });
      expect(res.status, origin).toBe(404);
    }
    expect((await call('GET', '/status', admin.cookie)).status).toBe(200);
  });

  it('le compte administrateur accède aux statistiques et aux inscrits', async () => {
    const admin = await sessionFor('Chef', ADMIN_EMAIL);
    const st = await call('GET', '/status', admin.cookie);
    expect(st.body).toMatchObject({ admin: true, passwordRequired: false, unlocked: true });
    const bob = await sessionFor('Bob', 'bob@example.fr');
    const stats = await call('GET', '/stats', admin.cookie);
    expect(stats.status).toBe(200);
    expect(stats.body.users.total).toBeGreaterThanOrEqual(3);
    expect(stats.body.daily).toHaveLength(30);
    expect(stats.body.daily.at(-1).signups).toBeGreaterThanOrEqual(3);
    const list = await call('GET', '/users?q=bob', admin.cookie);
    expect(list.body.users).toHaveLength(1);
    expect(list.body.users[0]).toMatchObject({ id: bob.userId, name: 'Bob', disabled: false, rides: 0 });
    expect(JSON.stringify(list.body)).not.toContain('bob@example.fr');
    const detail = await call('GET', `/users/${bob.userId}`, admin.cookie);
    expect(detail.body).toMatchObject({ id: bob.userId, name: 'Bob', identities: [{ provider: 'dev' }] });
  });

  it('suspension : sessions fermées et refusées, réactivation, déconnexion, suppression confirmée', async () => {
    const admin = await sessionFor('Chef2', ADMIN_EMAIL);
    const vic = await sessionFor('Victime', 'victime@example.fr');
    expect((await fetch(`${base}/api/me`, { headers: { cookie: vic.cookie } })).status).toBe(200);
    expect((await call('POST', `/users/${vic.userId}/disable`, admin.cookie, { disabled: true })).body).toMatchObject({ ok: true, disabled: true });
    expect((await fetch(`${base}/api/me`, { headers: { cookie: vic.cookie } })).status).toBe(401);
    // Une nouvelle session d'un compte suspendu n'est pas acceptée non plus.
    const again = await ctx.repos.createSession(vic.userId, 30);
    expect(await ctx.repos.sessionValid(again.id, vic.userId)).toBe(false);
    expect((await call('GET', '/users?q=victime', admin.cookie)).body.users[0].disabled).toBe(true);
    await call('POST', `/users/${vic.userId}/disable`, admin.cookie, { disabled: false });
    expect(await ctx.repos.sessionValid(again.id, vic.userId)).toBe(true);
    expect((await call('POST', `/users/${vic.userId}/logout`, admin.cookie)).status).toBe(200);
    expect(await ctx.repos.sessionValid(again.id, vic.userId)).toBe(false);
    expect((await call('POST', `/users/${admin.userId}/disable`, admin.cookie, { disabled: true })).status).toBe(400);
    expect((await call('DELETE', `/users/${vic.userId}`, admin.cookie, { confirm: 'mauvais' })).status).toBe(400);
    expect((await call('DELETE', `/users/${vic.userId}`, admin.cookie, { confirm: 'Victime' })).status).toBe(204);
    expect((await call('GET', `/users/${vic.userId}`, admin.cookie)).status).toBe(404);
  });
});

describe('administration — mot de passe supplémentaire', () => {
  beforeAll(() => boot({ ADMIN_PASSWORD: PASSWORD, ADMIN_EMAIL: `${ADMIN_EMAIL},autre@example.fr` }));
  afterAll(stop);

  it('verrouillé tant que le mot de passe n’est pas saisi ; cookie réservé au compte', async () => {
    const admin = await sessionFor('Chef', ADMIN_EMAIL);
    expect((await call('GET', '/status', admin.cookie)).body).toMatchObject({ passwordRequired: true, unlocked: false });
    expect((await call('GET', '/stats', admin.cookie)).status).toBe(403);
    expect((await call('POST', '/unlock', admin.cookie, { password: 'faux' })).status).toBe(403);
    const ok = await call('POST', '/unlock', admin.cookie, { password: PASSWORD });
    expect(ok.status).toBe(200);
    const adminCookie = ok.setCookie.map((c) => c.split(';')[0]).find((c) => c!.startsWith('ar_admin='))!;
    expect((await call('GET', '/stats', `${admin.cookie}; ${adminCookie}`)).status).toBe(200);
    // Le cookie de déverrouillage ne sert à personne d'autre (session d'un autre compte administrateur).
    const other = await sessionFor('Autre', 'autre@example.fr');
    expect((await call('GET', '/stats', `${other.cookie}; ${adminCookie}`)).status).toBe(403);
  });
});
