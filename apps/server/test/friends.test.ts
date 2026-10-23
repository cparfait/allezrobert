/**
 * Amis sur base en mémoire (pg-mem) : code ami, demandes (envoi, doublons, refus, acceptation,
 * demande croisée, retrait), présence et « rejoindre », invitations à rouler, classements entre
 * amis, RGPD. Sécurité : aucune information sur un non-ami (présence, code de sortie, records),
 * pas d'ajout de soi-même, pas d'amis sans compte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FRIEND_INVITE_TTL_S, FRIEND_ONLINE_WINDOW_S, formatFriendCode, isFriendCode, type FriendsOverview } from '@allezrobert/shared';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext, type AppContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';

let db: Db;
let ctx: AppContext;
let server: Server;
let base: string;

class Session {
  cookie = '';
  bearer = '';
  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const h: Record<string, string> = {};
    if (this.cookie) h.cookie = this.cookie;
    if (this.bearer) h.authorization = `Bearer ${this.bearer}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv!.split('=');
      if (k === 'ar_session') this.cookie = v ? `ar_session=${v}` : '';
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
  overview(): Promise<FriendsOverview> {
    return this.json<FriendsOverview>('GET', '/api/friends').then((r) => {
      expect(r.status).toBe(200);
      return r.body;
    });
  }
}

async function login(name: string): Promise<Session & { id: string }> {
  const s = new Session();
  const r = await s.json('POST', '/api/auth/dev', { name });
  expect(r.status).toBe(200);
  return Object.assign(s, { id: r.body.user.id as string });
}

/** Rend deux comptes amis ; renvoie l'identifiant de la relation. */
async function befriend(a: Session, b: Session): Promise<string> {
  const code = (await b.overview()).code;
  const req = await a.json('POST', '/api/friends/requests', { code });
  expect(req.status).toBe(201);
  expect((await b.json('POST', `/api/friends/requests/${req.body.id}/accept`)).status).toBe(204);
  return req.body.id as string;
}

let rideSeq = 0;
/** Sortie en cours simulée dans le registre (la salle Colyseus n'est pas nécessaire ici). */
function openRide(hostId: string, opts: { name?: string; routeId?: string } = {}): { roomId: string; inviteCode: string } {
  const roomId = `salle-${++rideSeq}`;
  const inviteCode = ctx.registry.newInviteCode();
  ctx.registry.register({ roomId, inviteCode, routeId: opts.routeId ?? 'dev-boucle', mode: 'group', name: opts.name ?? 'Boucle de test', allowGuests: true, hostUserId: hostId });
  ctx.registry.join(roomId, hostId, 'rider');
  return { roomId, inviteCode };
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL ?? 'memory';
  db = await createDb(url);
  if (url !== 'memory') await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  ctx = createContext(testConfig({ DEV_LOGIN: 'true' }), db, await RouteStore.load(undefined), { log: (l, m) => { if (l === 'error') console.error(m); } });
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

describe('amis — compte requis', () => {
  it('sans session (invité sans compte) ou avec un simple jeton de jeu : refusé', async () => {
    const anon = new Session();
    expect((await anon.json('GET', '/api/friends')).status).toBe(401);
    expect((await anon.json('POST', '/api/friends/requests', { code: 'ABCD2345' })).status).toBe(401);
    expect((await anon.json('GET', '/api/segments/r/s/leaderboard?scope=friends')).status).toBe(401);
    // Le jeton de jeu (connexion à une salle) n'ouvre pas l'API.
    const game = new Session();
    game.bearer = await ctx.tokens.signGame({ userId: '00000000-0000-4000-8000-000000000000', name: 'Invité' });
    expect((await game.json('GET', '/api/friends')).status).toBe(401);
  });
});

describe('amis — code et demandes', () => {
  it('code ami : stable, lisible, régénérable (l’ancien ne marche plus)', async () => {
    const a = await login('Code-A');
    const b = await login('Code-B');
    const c1 = (await a.overview()).code;
    expect(isFriendCode(c1)).toBe(true);
    expect((await a.overview()).code).toBe(c1);
    const regen = await a.json('POST', '/api/friends/code');
    expect(regen.status).toBe(200);
    expect(regen.body.code).not.toBe(c1);
    expect((await b.json('POST', '/api/friends/requests', { code: c1 })).body.error).toBe('unknown_code');
    expect((await b.json('POST', '/api/friends/requests', { code: regen.body.code })).status).toBe(201);
  });

  it('demande, doublons, soi-même, codes invalides', async () => {
    const a = await login('Dem-A');
    const b = await login('Dem-B');
    const codeB = (await b.overview()).code;
    // Saisie tolérante : minuscules et tiret.
    const req = await a.json('POST', '/api/friends/requests', { code: formatFriendCode(codeB).toLowerCase() });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: 'pending', name: 'Dem-B' });
    expect((await a.json('POST', '/api/friends/requests', { code: codeB })).body.error).toBe('already_requested');
    expect((await a.json('POST', '/api/friends/requests', { code: (await a.overview()).code })).body.error).toBe('self');
    expect((await a.json('POST', '/api/friends/requests', { code: 'ABC' })).body.error).toBe('bad_code');
    expect((await a.json('POST', '/api/friends/requests', { code: 'X'.repeat(200) })).status).toBe(400);
    expect((await a.json('POST', '/api/friends/requests', { code: codeB, extra: 1 })).status).toBe(400);
    const oa = await a.overview();
    const ob = await b.overview();
    expect(oa.outgoing.map((x) => x.name)).toEqual(['Dem-B']);
    expect(ob.incoming.map((x) => x.name)).toEqual(['Dem-A']);
    expect(oa.friends).toEqual([]);
    expect(ob.friends).toEqual([]);
    // Pas d'identifiant de compte dans les réponses.
    expect(JSON.stringify([oa, ob])).not.toContain(a.id);
    expect(JSON.stringify([oa, ob])).not.toContain(b.id);
    // Celui qui demande ne peut pas accepter à la place de l'autre.
    expect((await a.json('POST', `/api/friends/requests/${req.body.id}/accept`)).status).toBe(404);
  });

  it('refus : la demande disparaît des deux côtés, une nouvelle demande est possible', async () => {
    const a = await login('Ref-A');
    const b = await login('Ref-B');
    const req = await a.json('POST', '/api/friends/requests', { code: (await b.overview()).code });
    expect((await b.json('DELETE', `/api/friends/requests/${req.body.id}`)).status).toBe(204);
    expect((await a.overview()).outgoing).toEqual([]);
    expect((await b.overview()).incoming).toEqual([]);
    expect((await b.json('DELETE', `/api/friends/requests/${req.body.id}`)).status).toBe(404);
    expect((await a.json('POST', '/api/friends/requests', { code: (await b.overview()).code })).status).toBe(201);
  });

  it('acceptation, déjà amis, demande croisée acceptée d’office, retrait', async () => {
    const a = await login('Acc-A');
    const b = await login('Acc-B');
    const c = await login('Acc-C');
    const id = await befriend(a, b);
    expect((await a.overview()).friends.map((f) => f.name)).toEqual(['Acc-B']);
    expect((await b.overview()).friends.map((f) => f.name)).toEqual(['Acc-A']);
    expect((await a.overview()).friends[0]).toMatchObject({ id, level: 1, presence: { state: expect.any(String) } });
    expect((await b.json('POST', '/api/friends/requests', { code: (await a.overview()).code })).body.error).toBe('already_friends');
    // C demande à A, puis A « demande » à C : amitié faite.
    await c.json('POST', '/api/friends/requests', { code: (await a.overview()).code });
    const cross = await a.json('POST', '/api/friends/requests', { code: (await c.overview()).code });
    expect(cross.status).toBe(200);
    expect(cross.body).toMatchObject({ status: 'accepted', name: 'Acc-C' });
    expect((await c.overview()).friends.map((f) => f.name)).toEqual(['Acc-A']);
    // Un tiers ne peut pas retirer une amitié qui n'est pas la sienne.
    expect((await c.json('DELETE', `/api/friends/${id}`)).status).toBe(404);
    expect((await b.json('DELETE', `/api/friends/${id}`)).status).toBe(204);
    expect((await a.overview()).friends.map((f) => f.name)).toEqual(['Acc-C']);
    expect((await b.overview()).friends).toEqual([]);
    expect((await a.json('DELETE', `/api/friends/${id}`)).status).toBe(404);
    expect((await a.json('DELETE', '/api/friends/pas-un-uuid')).status).toBe(400);
  });
});

describe('amis — présence et rejoindre', () => {
  it('hors ligne / en ligne / en sortie ; code de sortie donné aux seuls amis', async () => {
    const a = await login('Pre-A');
    const b = await login('Pre-B');
    const e = await login('Pre-Etranger');
    const id = await befriend(a, b);
    // B a ouvert son menu (interrogation) : en ligne pour A.
    await b.overview();
    expect((await a.overview()).friends[0]!.presence).toEqual({ state: 'online' });
    ctx.friends.touch(b.id, Date.now() - (FRIEND_ONLINE_WINDOW_S + 5) * 1000);
    expect((await a.overview()).friends[0]!.presence).toEqual({ state: 'offline' });
    expect((await a.json('POST', `/api/friends/${id}/join`)).body.error).toBe('not_riding');
    // B roule : itinéraire, mode et nombre de coureurs, jamais le code dans la liste.
    const ride = openRide(b.id, { name: 'Vallée de Chevreuse' });
    const ov = await a.overview();
    expect(ov.friends[0]!.presence).toEqual({ state: 'riding', ride: { routeId: 'dev-boucle', name: 'Vallée de Chevreuse', mode: 'group', riders: 1 } });
    expect(JSON.stringify(ov)).not.toContain(ride.inviteCode);
    expect(JSON.stringify(ov)).not.toContain(ride.roomId);
    const join = await a.json('POST', `/api/friends/${id}/join`);
    expect(join.status).toBe(200);
    expect(join.body).toEqual({ roomId: ride.roomId, inviteCode: ride.inviteCode, routeId: 'dev-boucle', mode: 'group' });
    // A rejoint la même sortie : B « roule avec toi » (rien à rejoindre).
    ctx.registry.join(ride.roomId, a.id, 'rider');
    expect((await a.overview()).friends[0]!.presence).toMatchObject({ state: 'riding', withYou: true, ride: { riders: 2 } });
    ctx.registry.leave(ride.roomId, a.id, 'rider');
    // Un non-ami ne voit rien : ni B dans sa liste, ni la sortie, même avec l'identifiant de la relation.
    const oe = await e.overview();
    expect(JSON.stringify(oe)).not.toContain('Pre-B');
    expect((await e.json('POST', `/api/friends/${id}/join`)).status).toBe(404);
    expect((await e.json('GET', `/api/friends/${id}/bests?routeId=dev-boucle`)).status).toBe(404);
    // Demande en attente : pas encore de présence ni de sortie.
    const req = await e.json('POST', '/api/friends/requests', { code: (await b.overview()).code });
    expect((await e.overview()).outgoing[0]).not.toHaveProperty('presence');
    expect((await e.json('POST', `/api/friends/${req.body.id}/join`)).status).toBe(404);
    ctx.registry.unregister(ride.roomId);
  });
});

describe('amis — invitations à rouler', () => {
  it('inviter, recevoir, rejoindre ou ignorer ; non-amis et non-participants écartés', async () => {
    const host = await login('Inv-Hote');
    const a = await login('Inv-A');
    const b = await login('Inv-B');
    const e = await login('Inv-Etranger');
    const idA = await befriend(host, a);
    const idB = await befriend(b, host);
    const ride = openRide(host.id, { name: 'Sortie du dimanche' });
    // Pas dans la sortie : refusé.
    expect((await a.json('POST', '/api/friends/invites', { roomId: ride.roomId, friends: [idA] })).status).toBe(403);
    // Un identifiant qui n'est pas une amitié de l'hôte est ignoré.
    const relE = await e.json('POST', '/api/friends/requests', { code: (await a.overview()).code });
    const sent = await host.json('POST', '/api/friends/invites', { roomId: ride.roomId, friends: [idA, idB, relE.body.id] });
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ sent: 2 });
    expect((await e.overview()).invites).toEqual([]);
    const ia = (await a.overview()).invites;
    expect(ia).toHaveLength(1);
    expect(ia[0]).toMatchObject({ from: 'Inv-Hote', ride: { name: 'Sortie du dimanche', mode: 'group', riders: 1 } });
    expect(JSON.stringify(ia)).not.toContain(ride.inviteCode);
    // Inviter deux fois ne double pas l'invitation.
    await host.json('POST', '/api/friends/invites', { roomId: ride.roomId, friends: [idA] });
    expect((await a.overview()).invites).toHaveLength(1);
    const invA = (await a.overview()).invites[0]!.id;
    // Un autre compte ne peut pas utiliser l'invitation de A.
    expect((await b.json('POST', `/api/friends/invites/${invA}/join`)).status).toBe(404);
    const join = await a.json('POST', `/api/friends/invites/${invA}/join`);
    expect(join.body).toMatchObject({ roomId: ride.roomId, inviteCode: ride.inviteCode });
    expect((await a.overview()).invites).toEqual([]);
    // B ignore.
    const invB = (await b.overview()).invites[0]!.id;
    expect((await b.json('DELETE', `/api/friends/invites/${invB}`)).status).toBe(204);
    expect((await b.json('DELETE', `/api/friends/invites/${invB}`)).status).toBe(404);
    // Limites de taille.
    expect((await host.json('POST', '/api/friends/invites', { roomId: ride.roomId, friends: Array.from({ length: 11 }, () => idA) })).status).toBe(400);
    ctx.registry.unregister(ride.roomId);
  });

  it('expiration : fin de la sortie ou 30 minutes', async () => {
    const host = await login('Exp-Hote');
    const a = await login('Exp-A');
    const id = await befriend(host, a);
    const r1 = openRide(host.id);
    await host.json('POST', '/api/friends/invites', { roomId: r1.roomId, friends: [id] });
    expect((await a.overview()).invites).toHaveLength(1);
    ctx.registry.unregister(r1.roomId);
    expect((await a.overview()).invites).toEqual([]);
    const r2 = openRide(host.id);
    await host.json('POST', '/api/friends/invites', { roomId: r2.roomId, friends: [id] });
    expect(ctx.friends.invitesFor(a.id, Date.now() + (FRIEND_INVITE_TTL_S - 60) * 1000)).toHaveLength(1);
    expect(ctx.friends.invitesFor(a.id, Date.now() + (FRIEND_INVITE_TTL_S + 1) * 1000)).toHaveLength(0);
    expect((await a.overview()).invites).toEqual([]);
    // Retrait de l'amitié : les invitations tombent aussi.
    await host.json('POST', '/api/friends/invites', { roomId: r2.roomId, friends: [id] });
    expect((await a.overview()).invites).toHaveLength(1);
    await a.json('DELETE', `/api/friends/${id}`);
    expect((await a.overview()).invites).toEqual([]);
    ctx.registry.unregister(r2.roomId);
  });
});

describe('amis — classements', () => {
  it('filtre « amis » sur les segments et records personnels des amis', async () => {
    const a = await login('Kom-A');
    const b = await login('Kom-B');
    const e = await login('Kom-Etranger');
    const id = await befriend(a, b);
    for (const [u, ms] of [[a.id, 300_000], [b.id, 280_000], [b.id, 290_000], [e.id, 200_000]] as const) {
      await ctx.repos.recordSegmentEffort({ userId: u, routeId: 'rf', segmentId: 'col', elapsedMs: ms });
    }
    const all = await a.json('GET', '/api/segments/rf/col/leaderboard');
    expect(all.body.map((x: any) => x.name)).toEqual(['Kom-Etranger', 'Kom-B', 'Kom-A']);
    const friends = await a.json('GET', '/api/segments/rf/col/leaderboard?scope=friends');
    expect(friends.body).toEqual([
      { rank: 1, name: 'Kom-B', bestMs: 280_000, efforts: 2, me: false },
      { rank: 2, name: 'Kom-A', bestMs: 300_000, efforts: 1, me: true },
    ]);
    // Le non-ami ne voit que lui-même entre amis.
    expect((await e.json('GET', '/api/segments/rf/col/leaderboard?scope=friends')).body.map((x: any) => x.name)).toEqual(['Kom-Etranger']);
    expect((await a.json('GET', '/api/segments/rf/col/leaderboard?scope=autre')).status).toBe(400);
    const bests = await a.json('GET', `/api/friends/${id}/bests?routeId=rf`);
    expect(bests.body).toEqual([{ segmentId: 'col', bestMs: 280_000 }]);
    expect((await a.json('GET', `/api/friends/${id}/bests`)).status).toBe(400);
  });

  it('filtre « amis » sur le temps du parcours entier', async () => {
    const a = await login('Tour-A');
    const b = await login('Tour-B');
    const e = await login('Tour-Etranger');
    await befriend(a, b);
    for (const [u, ms] of [[a.id, 3_700_000], [b.id, 3_600_000], [b.id, 3_650_000], [e.id, 3_000_000]] as const) {
      await ctx.repos.recordRouteTime({ userId: u, routeId: 'tour', elapsedMs: ms });
    }
    expect((await a.json('GET', '/api/routes/tour/leaderboard')).body.map((x: any) => x.name)).toEqual(['Tour-Etranger', 'Tour-B', 'Tour-A']);
    expect((await a.json('GET', '/api/routes/tour/leaderboard?scope=friends')).body).toEqual([
      { rank: 1, name: 'Tour-B', bestMs: 3_600_000, efforts: 2, me: false },
      { rank: 2, name: 'Tour-A', bestMs: 3_700_000, efforts: 1, me: true },
    ]);
    expect((await e.json('GET', '/api/routes/tour/leaderboard?scope=friends')).body.map((x: any) => x.name)).toEqual(['Tour-Etranger']);
  });
});

describe('amis — RGPD', () => {
  it('export puis suppression du compte : code, relations et invitations effacés', async () => {
    const a = await login('Rgpd-A');
    const b = await login('Rgpd-B');
    const c = await login('Rgpd-C');
    const id = await befriend(a, b);
    await a.json('POST', '/api/friends/requests', { code: (await c.overview()).code });
    const ride = openRide(a.id);
    await a.json('POST', '/api/friends/invites', { roomId: ride.roomId, friends: [id] });
    const codeA = (await a.overview()).code;
    const exp = await a.json('GET', '/api/me/export');
    expect(exp.body.friends.code).toBe(codeA);
    expect(exp.body.friends.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Rgpd-B', status: 'accepted', direction: 'sent' }), expect.objectContaining({ name: 'Rgpd-C', status: 'pending', direction: 'sent' })]),
    );
    expect(exp.body.rideInvites).toHaveLength(1);
    expect((await a.json('DELETE', '/api/me', { confirm: 'SUPPRIMER' })).status).toBe(204);
    for (const [table, where] of [['friend_codes', 'user_id = $1'], ['friendships', 'user_a = $1 OR user_b = $1 OR requested_by = $1']] as const) {
      const r = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, [a.id]);
      expect(Number(r.rows[0].n), table).toBe(0);
    }
    expect((await b.overview()).friends).toEqual([]);
    expect((await b.overview()).invites).toEqual([]);
    expect((await c.overview()).incoming).toEqual([]);
    ctx.registry.unregister(ride.roomId);
  });
});
