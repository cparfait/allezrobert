/**
 * Salle « ride » de bout en bout : vrai serveur Colyseus (port aléatoire, base pg-mem) et
 * le client réseau du jeu (`RideNetClient`, apps/client/src/net) : création, code
 * d'invitation, invité anonyme, télémétrie et instantanés, chat, Ride On, compagnon,
 * options d'hôte, exclusion, migration d'hôte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RideEventMsg } from '@allezrobert/shared';
import { RideNetClient } from '../../client/src/net/index.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';

let srv: RunningServer;
let endpoint: string;

async function login(name: string): Promise<string> {
  const res = await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return ((await res.json()) as { sessionToken: string }).sessionToken;
}

async function client(name?: string): Promise<RideNetClient> {
  const token = name ? await login(name) : undefined;
  return new RideNetClient({ endpoint, ...(token ? { token } : { token: async () => undefined }), autoRejoin: false });
}

function waitFor<T>(c: RideNetClient, pred: (ev: RideEventMsg) => T | undefined | false, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('délai dépassé'));
    }, ms);
    const off = c.on('event', (ev) => {
      const v = pred(ev);
      if (v) {
        clearTimeout(timer);
        off();
        resolve(v);
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  srv = await startServer({ config: testConfig({ DEV_LOGIN: 'true', RECONNECT_GRACE_S: '1', LOG_LEVEL: 'warn' }), port: 0, noSignals: true });
  endpoint = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.stop();
});

describe('salle ride', () => {
  it('création, code, invité anonyme, télémétrie, instantanés interpolés', async () => {
    const host = await client('Hôte');
    const w = await host.create({ mode: 'group', aiRiders: 2, allowGuests: true });
    expect(w.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(w.role).toBe('rider');
    expect(host.isHost).toBe(true);
    expect(w.route.polyline.length).toBeGreaterThan(300);
    expect(w.roster.riders.filter((r) => r.isAI)).toHaveLength(2);

    const friend = await client('Ami');
    const wf = await friend.joinByCode(w.inviteCode.toLowerCase());
    expect(wf.roomId).toBe(w.roomId);
    const guest = await client();
    const wg = await guest.joinByCode(w.inviteCode, { role: 'guest', displayName: 'Tonton' });
    expect(wg.role).toBe('guest');
    await sleep(100);
    expect([...host.roster.values()].find((r) => r.isGuest)?.name).toBe('Tonton');

    // Mauvais code : refusé.
    const intruder = await client('Intrus');
    await expect(intruder.joinById(w.roomId, 'XXXXXX')).rejects.toThrow();

    host.startTelemetry(() => ({ watts: 250, cadence: 90, gear: 12, steer: 0 }));
    friend.startTelemetry(() => ({ watts: 250, cadence: 90, gear: 12, steer: 0.5 }));
    guest.startTelemetry(() => ({ watts: 0, cadence: 0, gear: 0, steer: 0 }));
    await sleep(2500);
    const self = host.getSelfSnapshot()!;
    expect(self.speedMs).toBeGreaterThan(3);
    expect(self.watts).toBe(250);
    const other = host.getInterpolated(friend.selfId)!;
    expect(other).toBeTruthy();
    expect(other.speedMs).toBeGreaterThan(3);
    expect(other.lateralM).toBeGreaterThan(0.1);
    const g = host.getInterpolated(guest.selfId)!;
    expect(g.isGuest).toBe(true);
    expect(g.speedMs).toBeGreaterThan(1); // pilote automatique
    expect(host.getAllInterpolated().length).toBe(5);
    expect(host.rtt).toBeGreaterThanOrEqual(0);
    // Réconciliation : prédiction locale décalée de 3 m → correction douce vers le serveur.
    const u = self.lap * w.route.lengthM + self.distM;
    let local = u - 3;
    for (let i = 0; i < 15; i++) {
      local += host.reconcileSelf(local, 1 / 60);
      await sleep(20);
    }
    const before = local;
    for (let i = 0; i < 60; i++) local += host.reconcileSelf(local, 1 / 60);
    expect(local - before).toBeGreaterThan(0.5);

    // Chat et Ride On.
    const chat = waitFor(friend, (ev) => ev.kind === 'chat' && ev);
    host.chat('  Allez   Robert !  ');
    expect(await chat).toMatchObject({ riderId: host.selfId, text: 'Allez Robert !' });
    const ro = waitFor(host, (ev) => ev.kind === 'rideOn' && ev);
    friend.rideOn(host.selfId);
    expect(await ro).toMatchObject({ from: friend.selfId, to: host.selfId });

    // Options d'hôte : invités refusés pour les suivants ; un non-hôte ne peut rien changer.
    friend.setHostOptions({ allowGuests: false });
    const opt = waitFor(friend, (ev) => ev.kind === 'options' && ev);
    host.setHostOptions({ allowGuests: false, stickyGroup: true });
    expect(await opt).toMatchObject({ options: { allowGuests: false, stickyGroup: true } });
    const late = await client();
    await expect(late.joinByCode(w.inviteCode, { role: 'guest' })).rejects.toThrow();

    for (const c of [host, friend, guest]) await c.leave();
  });

  it('appli compagnon : même compte, commandes relayées au jeu, état relayé', async () => {
    const token = await login('Christophe');
    const game = new RideNetClient({ endpoint, token, autoRejoin: false });
    const w = await game.create({ mode: 'free' });
    const companion = new RideNetClient({ endpoint, token, autoRejoin: false, fetchFn: (input, init) => fetch(input, { ...init, headers: { authorization: `Bearer ${token}` } }) });
    const wc = await companion.joinCurrent();
    expect(wc.role).toBe('companion');
    expect(wc.selfId).toBe(game.selfId);
    expect(wc.roomId).toBe(w.roomId);

    const got = new Promise((resolve) => game.on('companion', resolve));
    companion.sendCompanionCommand({ kind: 'shift', action: 'up' });
    expect(await got).toEqual({ kind: 'shift', action: 'up' });
    const fan = new Promise((resolve) => game.on('companion', (c) => c.kind === 'fan' && resolve(c)));
    companion.sendCompanionCommand({ kind: 'fan', percent: 140 });
    expect(await fan).toEqual({ kind: 'fan', percent: 100 });

    const state = new Promise((resolve) => companion.on('companionState', resolve));
    game.sendCompanionState({ gear: 14, gearLabel: '50×15', paused: false, camera: 'chase', fanPercent: 60 });
    expect(await state).toMatchObject({ gear: 14, gearLabel: '50×15' });

    // Chat depuis le compagnon : au nom du coureur du compte.
    const chat = waitFor(game, (ev) => ev.kind === 'chat' && ev);
    companion.sendCompanionCommand({ kind: 'chat', text: 'Depuis le téléphone' });
    expect(await chat).toMatchObject({ riderId: game.selfId });
    // Le compagnon reçoit aussi les instantanés (carte).
    await sleep(300);
    expect(companion.latest?.riders.length).toBe(1);
    await companion.leave();
    await game.leave();
  });

  it("hôte : exclusion, puis migration de l'hôte quand il part", async () => {
    const a = await client('Alpha');
    const w = await a.create({ mode: 'group' });
    const b = await client('Bravo');
    await b.joinByCode(w.inviteCode);
    const c = await client('Charlie');
    await c.joinByCode(w.inviteCode);
    // Exclusion de Charlie.
    const left = new Promise<number | undefined>((resolve) => c.on('connection', (e) => e.state === 'disconnected' && resolve(e.code)));
    a.kick(c.selfId);
    expect(await left).toBe(4000);
    await expect(c.joinByCode(w.inviteCode)).rejects.toThrow();
    // Départ de l'hôte : Bravo devient hôte.
    const hostEv = waitFor(b, (ev) => ev.kind === 'host' && ev);
    await a.leave();
    expect(await hostEv).toMatchObject({ riderId: b.selfId });
    expect(b.isHost).toBe(true);
    await b.leave();
  });

  it('course : compte à rebours lancé par l’hôte', async () => {
    const a = await client('Coureur');
    const w = await a.create({ mode: 'race', laps: 1 });
    expect(w.phase).toBe('lobby');
    const cd = waitFor(a, (ev) => ev.kind === 'countdown' && ev);
    a.startCountdown(3);
    const ev = await cd;
    expect(ev.startsAt).toBeGreaterThan(Date.now());
    await waitFor(a, (e) => e.kind === 'phase' && e.phase === 'running' && e, 6000);
    expect(a.welcome?.phase).toBe('running');
    await a.leave();
  });

  it("course : l'IA cède sa place au salon, abandon diffusé, classement à l'accueil", async () => {
    const a = await client('Hôte course');
    const w = await a.create({ mode: 'race', laps: 1, aiRiders: 2, aiLevel: 0.8 });
    expect(w.roster.riders.filter((r) => r.isAI)).toHaveLength(2);
    expect(w.hostOptions).toMatchObject({ paceWkg: null, leaderId: '' });
    const b = await client('Second');
    const leaveEv = waitFor(a, (ev) => ev.kind === 'leave' && ev);
    await b.joinByCode(w.inviteCode);
    // Taille du peloton conservée : une IA est partie.
    expect((await leaveEv).riderId).toMatch(/^ai-/);
    await sleep(100);
    expect([...a.roster.values()].filter((r) => r.isAI)).toHaveLength(1);
    a.startCountdown(3);
    await waitFor(a, (e) => e.kind === 'phase' && e.phase === 'running' && e, 6000);
    const bId = b.selfId;
    const abandon = waitFor(a, (ev) => ev.kind === 'abandon' && ev);
    await b.leave();
    expect(await abandon).toMatchObject({ riderId: bId, name: 'Second' });
    // Un nouveau venu reçoit le classement courant (avec l'abandon) dans l'accueil.
    const c = await client('Retardataire');
    const wc = await c.joinByCode(w.inviteCode);
    expect(wc.results?.find((r) => r.riderId === bId)?.status).toBe('dnf');
    expect(wc.results?.find((r) => r.riderId === c.selfId)?.status).toBe('unranked');
    await c.leave();
    await a.leave();
  });

  it('sortie de groupe : allure annoncée, meneur et regroupement (hôte ou meneur seulement)', async () => {
    const a = await client('Meneuse');
    const w = await a.create({ mode: 'group', paceWkg: 2.6 });
    expect(w.hostOptions?.paceWkg).toBe(2.6);
    const b = await client('Suiveur');
    await b.joinByCode(w.inviteCode);
    const opt = waitFor(b, (ev) => ev.kind === 'options' && ev);
    a.setHostOptions({ paceWkg: 3.1, leaderId: b.selfId });
    expect(await opt).toMatchObject({ options: { paceWkg: 3.1, leaderId: b.selfId } });
    expect(b.welcome?.hostOptions?.leaderId).toBe(b.selfId);
    // Le meneur peut demander le regroupement.
    const rg = waitFor(a, (ev) => ev.kind === 'regroup' && ev);
    b.regroup(true);
    expect(await rg).toMatchObject({ active: true });
    expect(a.welcome?.regrouping).toBe(true);
    // Le meneur parti, l'hôte redevient la référence.
    const back = waitFor(a, (ev) => ev.kind === 'options' && ev);
    await b.leave();
    expect(await back).toMatchObject({ options: { leaderId: '' } });
    await a.leave();
  });

  it('reconnexion après coupure : même coureur, état resynchronisé', async () => {
    const a = await client('Coupé');
    const w = await a.create({ mode: 'group' });
    const id = a.selfId;
    a.startTelemetry(() => ({ watts: 200, cadence: 85, gear: 10, steer: 0 }));
    await sleep(5300); // le SDK n'essaie de se reconnecter qu'après 5 s de connexion
    const states: string[] = [];
    const back = new Promise<void>((resolve) =>
      a.on('connection', (e) => {
        states.push(e.state);
        if (e.state === 'connected') resolve();
      }),
    );
    // Coupure brutale côté client (code 4010 « peut retenter »).
    (a as unknown as { room: { connection: { close(code: number): void } } }).room.connection.close(4010);
    await back;
    expect(states).toEqual(['reconnecting', 'connected']);
    expect(a.selfId).toBe(id);
    expect(a.roomId).toBe(w.roomId);
    await sleep(300);
    expect(a.roster.get(id)?.connected).toBe(true);
    expect(a.getSelfSnapshot()?.watts).toBe(200);
    await a.leave();
  }, 15_000);

  it('création refusée sans compte', async () => {
    const anon = await client();
    await expect(anon.create({ mode: 'group' })).rejects.toThrow();
  });
});
