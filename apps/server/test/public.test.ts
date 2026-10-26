/**
 * Monde ouvert : itinéraires de plusieurs dossiers, salles publiques par zone (sans hôte, sans code,
 * comptes seulement, 20 coureurs puis une 2ᵉ salle), IA d'ambiance, chat, demi-tour.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_CHAT_RADIUS_M, RouteTrack, reverseRoute, type PublicPick, type PublicZoneDetail, type PublicZoneInfo, type RideEventMsg } from '@allezrobert/shared';
import { Client as ColyseusClient } from '@colyseus/sdk';
import { RideNetClient } from '../../client/src/net/index.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';
import { RouteStore, proceduralLoop } from '../src/ride/routes.ts';
import { activeRooms } from '../src/ride/RideRoom.ts';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';

const WORLDS = path.resolve(import.meta.dirname, '../../client/public/worlds');
const LONGCHAMP = path.join(WORLDS, 'longchamp/routes');
const CHEVREUSE = path.join(WORLDS, 'chevreuse/routes');
const ZONE = 'anneau-de-longchamp';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RouteStore — plusieurs dossiers', () => {
  it('charge les itinéraires de chaque dossier, sans remplacer un identifiant déjà chargé', async () => {
    const logs: string[] = [];
    const store = await RouteStore.load(`${LONGCHAMP}, ${CHEVREUSE} , ${LONGCHAMP}`, (m) => logs.push(m));
    expect(store.has(ZONE)).toBe(true);
    expect(store.has('chevreuse-boucle')).toBe(true);
    expect(store.size).toBeGreaterThan(2);
    expect(logs.some((m) => m.includes('déjà chargé') && m.includes(ZONE))).toBe(true);
  });

  it('un dossier introuvable est signalé sans empêcher les autres', async () => {
    const logs: string[] = [];
    const store = await RouteStore.load(`${path.join(WORLDS, 'nulle-part')},${LONGCHAMP}`, (m) => logs.push(m));
    expect(store.has(ZONE)).toBe(true);
    expect(logs.some((m) => m.includes('introuvable'))).toBe(true);
  });
});

describe('RideSimulation — demi-tour', () => {
  const route = proceduralLoop();
  const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);
  const free = () => new RideSimulation(route, resolveRideOptions({ mode: 'free' }, route.id), T0, { seed: 'uturn' });
  const human = (s: RideSimulation, id: string) => s.addRider({ id, name: id, kind: 'human', userId: `u-${id}`, riderMassKg: 75 }, T0)!;

  it('repart du même endroit, en sens inverse, sur l’itinéraire inversé', () => {
    const s = free();
    const a = human(s, 'a');
    a.state.distM = 1234;
    a.state.speedMs = 8;
    a.lateralM = a.lateralTarget = 1.2;
    const fwd = new RouteTrack(route);
    const rev = new RouteTrack(reverseRoute(route));
    const before = fwd.sample(1234);
    expect(s.turnAround('a', T0 + 10_000)).toBe(true);
    expect(a.dir).toBe(-1);
    expect(a.state.speedMs).toBeLessThan(3);
    // Même point sur la route : (x, z) de l'itinéraire inversé à L − d = celui de l'aller à d.
    const after = rev.sample(a.state.distM);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.5);
    // Il avançait sur la voie de droite : sa droite est maintenant de l'autre côté.
    expect(a.lateralM).toBeCloseTo(-1.2);
    s.step(T0 + 10_100, 0.1);
    expect(s.rows().find((r) => r.n === a.n)?.dir).toBe(-1);
    // Second demi-tour : retour dans le sens de l'itinéraire, trop tôt = refusé.
    expect(s.turnAround('a', T0 + 11_000)).toBe(false);
    expect(s.turnAround('a', T0 + 14_000)).toBe(true);
    expect(a.dir).toBe(1);
    expect(Math.abs(a.state.distM - 1234)).toBeLessThan(5);
  });

  it('mesure la distance entre coureurs le long de la route, quel que soit leur sens', () => {
    const s = free();
    const a = human(s, 'a');
    const b = human(s, 'b');
    const L = route.lengthM;
    a.state.distM = 100;
    b.state.distM = 130;
    expect(s.separationM('a', 'b')).toBeCloseTo(30);
    // De part et d'autre de la ligne de départ d'une boucle : 20 m, pas L − 20.
    a.state.distM = 10;
    b.state.distM = L - 10;
    expect(s.separationM('a', 'b')).toBeCloseTo(20);
    // Demi-tour sur place : toujours au même endroit, donc à la même distance de l'autre.
    a.state.distM = 100;
    b.state.distM = 130;
    s.turnAround('a', T0 + 10_000);
    expect(s.separationM('a', 'b')).toBeCloseTo(30);
    expect(s.separationM('a', 'inconnu')).toBe(Infinity);
  });

  it('place un nouvel arrivant dans la roue de son ami quand son jeu est prêt, pas avant', () => {
    const s = free();
    const f = human(s, 'f');
    f.state.distM = 1000;
    f.state.speedMs = 9;
    human(s, 'n');
    s.deferPlacement('n', 'f');
    const tel = (seq: number) => ({ seq, t: 0, watts: 0, cadence: 0, gear: 12, steer: 0 });
    // Chargement : le coureur est en salle, l'ami avance ; la télémétrie (puissance nulle) ne change rien.
    f.state.distM += 500;
    s.setTelemetry('n', tel(0), T0 + 1000);
    s.setTelemetry('n', tel(1), T0 + 40_000);
    expect(s.separationM('n', 'f')).toBeGreaterThan(300);
    // Le jeu est prêt : dans la roue de l'ami, à sa vitesse, une seule fois.
    expect(s.placeNow('n')).toBe(true);
    expect(s.separationM('n', 'f')).toBeCloseTo(4);
    expect(s.get('n')!.state.speedMs).toBeCloseTo(9);
    f.state.distM += 300;
    expect(s.placeNow('n')).toBe(false);
    expect(s.separationM('n', 'f')).toBeGreaterThan(250);
    // Sans ami (ou ami parti) : à l'arrière du groupe, sans erreur ; rien en attente pour un coureur sans demande.
    const s2 = free();
    human(s2, 'a');
    human(s2, 'b');
    s2.deferPlacement('b', 'parti');
    expect(s2.placeNow('b')).toBe(true);
    expect(s2.separationM('a', 'b')).toBeLessThan(10);
    expect(s2.placeNow('a')).toBe(false);
    expect(s2.placeNow('inconnu')).toBe(false);
  });

  it('refusé hors mode libre, pour les IA et pour les invités', () => {
    const g = new RideSimulation(route, resolveRideOptions({ mode: 'group' }, route.id), T0, { seed: 'g' });
    human(g, 'a');
    expect(g.turnAround('a', T0 + 10_000)).toBe(false);
    const s = free();
    s.addAiRiders(1, T0, 200);
    s.addRider({ id: 'inv', name: 'Invité', kind: 'guest', riderMassKg: 75 }, T0);
    expect(s.turnAround('ai-1', T0 + 10_000)).toBe(false);
    expect(s.turnAround('inv', T0 + 10_000)).toBe(false);
  });

  it('pas d’aspiration entre deux coureurs qui ne vont pas dans le même sens', () => {
    const run = (turn: boolean): number => {
      const s = free();
      const lead = human(s, 'lead');
      const wheel = human(s, 'wheel');
      lead.state.distM = 500;
      wheel.state.distM = 497.5;
      lead.state.speedMs = wheel.state.speedMs = 10;
      lead.lateralM = lead.lateralTarget = wheel.lateralM = wheel.lateralTarget = 0;
      if (turn) {
        s.turnAround('wheel', T0 + 10_000);
        // Dans son propre repère (inversé), il se retrouve numériquement à 2,5 m derrière le premier : aucun abri attendu.
        wheel.state.distM = 497.5;
        wheel.lateralM = wheel.lateralTarget = 0;
        wheel.state.speedMs = 10;
      }
      let now = T0 + 20_000;
      let draft = 0;
      for (let i = 0; i < 20; i++) {
        now += 100;
        s.setTelemetry('lead', { seq: i, t: 0, watts: 250, cadence: 90, gear: 12, steer: 0 }, now);
        s.setTelemetry('wheel', { seq: i, t: 0, watts: 250, cadence: 90, gear: 12, steer: 0 }, now);
        s.step(now, 0.1);
        draft = wheel.draft;
      }
      return draft;
    };
    expect(run(false)).toBeGreaterThan(0.1);
    expect(run(true)).toBe(0);
  });

  it('les segments chronométrés peuvent être coupés (monde ouvert)', () => {
    const s = free();
    s.segmentsEnabled = false;
    const a = human(s, 'a');
    let seen = 0;
    let now = T0;
    for (let i = 0; i < 6000 && seen === 0; i++) {
      now += 100;
      s.setTelemetry('a', { seq: i, t: 0, watts: 400, cadence: 90, gear: 12, steer: 0 }, now);
      const res = s.step(now, 0.1);
      seen += res.events.filter((e) => e.kind === 'segmentStart').length + res.efforts.length;
      if (a.state.distM > route.lengthM * 0.9) break;
    }
    expect(seen).toBe(0);
  });
});

describe('salles publiques (serveur réel)', () => {
  let srv: RunningServer;
  let endpoint: string;
  const open: RideNetClient[] = [];

  async function login(name: string): Promise<string> {
    const res = await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    return ((await res.json()) as { sessionToken: string }).sessionToken;
  }
  async function rider(name: string): Promise<RideNetClient> {
    const token = await login(name);
    const c = new RideNetClient({ endpoint, token, autoRejoin: false });
    open.push(c);
    return c;
  }
  /** Appel d'API avec le jeton de session d'un compte. */
  async function api<T = any>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${endpoint}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
  async function befriend(a: string, b: string): Promise<void> {
    const code = (await api(b, 'GET', '/friends')).body.code as string;
    const req = await api(a, 'POST', '/friends/requests', { code });
    expect(req.status).toBe(201);
    expect((await api(b, 'POST', `/friends/requests/${req.body.id}/accept`)).status).toBe(204);
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

  beforeAll(async () => {
    srv = await startServer({
      config: testConfig({ DEV_LOGIN: 'true', RECONNECT_GRACE_S: '1', LOG_LEVEL: 'warn', ROUTES_DIR: `${LONGCHAMP},${CHEVREUSE}`,
        PUBLIC_ROUTES: 'anneau-de-longchamp,chevreuse-boucle,cote-de-chateaufort,cote-de-meridon,cote-de-la-madeleine,boucle-gif-sur-yvette-gometz-la-ville',
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'secret-de-test-0123456789abcdef0123456789',
      }),
      port: 0,
      noSignals: true,
    });
    endpoint = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await Promise.all(open.map((c) => c.leave().catch(() => undefined)));
    await srv.stop();
  });

  it('deux comptes se retrouvent dans la même salle, sans code ni hôte, avec des IA d’ambiance', async () => {
    const a = await rider('Alice');
    const wa = await a.joinPublic(ZONE);
    expect(wa.public).toBe(true);
    expect(wa.hostId).toBe('');
    expect(wa.options.mode).toBe('free');
    expect(wa.options.allowGuests).toBe(false);
    expect(wa.options.weather?.hour).toBeGreaterThanOrEqual(0);
    expect(wa.route.polyline.length).toBeGreaterThan(100);
    expect(a.isHost).toBe(false);
    const ai0 = wa.roster.riders.filter((r) => r.isAI).length;
    expect(ai0).toBeGreaterThanOrEqual(2);

    const b = await rider('Bob');
    const wb = await b.joinPublic(ZONE);
    expect(wb.roomId).toBe(wa.roomId);
    await sleep(150);
    expect([...a.roster.values()].filter((r) => r.isAI)).toHaveLength(ai0 - 1);
    expect([...a.roster.values()].filter((r) => !r.isAI)).toHaveLength(2);
    expect(b.isHost).toBe(false);
  });

  it('chat et Ride On circulent entre inconnus', async () => {
    const a = await rider('Chat1');
    const b = await rider('Chat2');
    await a.joinPublic(ZONE);
    // Chat1 et Chat2 peuvent atterrir dans une salle déjà occupée par d'autres : on vérifie la salle commune.
    const wb = await b.joinPublic(ZONE);
    expect(a.roomId).toBe(wb.roomId);
    const got = waitFor(b, (ev) => ev.kind === 'chat' && ev.text === 'Salut Longchamp !' && ev);
    a.chat('Salut Longchamp !');
    expect(await got).toMatchObject({ kind: 'chat' });
  });

  it('les commandes d’hôte ne font rien', async () => {
    const a = await rider('Hôte1');
    const b = await rider('Hôte2');
    await a.joinPublic(ZONE);
    await b.joinPublic(ZONE);
    await sleep(100);
    const target = [...a.roster.values()].find((r) => r.name === 'Hôte2')!;
    a.kick(target.id);
    a.startCountdown(3);
    a.setHostOptions({ allowGuests: true });
    a.transferHost(target.id);
    await sleep(400);
    expect([...a.roster.values()].some((r) => r.name === 'Hôte2')).toBe(true);
    expect(a.welcome?.phase).toBe('running');
    expect(a.isHost || b.isHost).toBe(false);
  });

  it('refuse les invités anonymes, les compagnons sans coureur et les zones inconnues', async () => {
    const anon = new RideNetClient({ endpoint, token: async () => undefined, autoRejoin: false });
    await expect(anon.joinPublic(ZONE)).rejects.toThrow();
    await expect(anon.joinPublic(ZONE, { displayName: 'Tonton' })).rejects.toThrow();
    const a = await rider('Curieux');
    await expect(a.joinPublic('zone-inventee')).rejects.toThrow();
    await expect(a.joinPublic('')).rejects.toThrow();
  });

  it('refuse une zone qui existe mais n’est pas ouverte au public', async () => {
    const a = await rider('Fermé');
    await expect(a.joinPublic('cote-des-vaux-de-cernay')).rejects.toThrow();
    const t = await login('FerméAPI');
    expect((await api(t, 'POST', '/public/pick', { routeId: 'cote-des-vaux-de-cernay' })).status).toBe(404);
  });

  it('affluence par zone et salle conseillée : priorité aux amis, puis à la plus fréquentée', async () => {
    const ROUTE = 'cote-de-meridon';
    const [tU, tF, tS, tP1, tP2] = await Promise.all(['Moi', 'Amie', 'Inconnu', 'Pop1', 'Pop2'].map(login));
    await befriend(tU!, tF!);
    const zonesOf = async (tok: string) => (await api<PublicZoneInfo[]>(tok, 'GET', '/public/zones')).body.find((z) => z.routeId === ROUTE)!;
    expect(await zonesOf(tU!)).toMatchObject({ riders: 0, rooms: 0, friends: [] });
    expect((await api<PublicPick>(tU!, 'POST', '/public/pick', { routeId: ROUTE })).body).toEqual({ friends: [] });

    // Salle A : deux inconnus (la plus fréquentée) ; salle B : l'amie, seule, ouverte à part.
    const p1 = new RideNetClient({ endpoint, token: tP1!, autoRejoin: false });
    const p2 = new RideNetClient({ endpoint, token: tP2!, autoRejoin: false });
    open.push(p1, p2);
    const wa = await p1.joinPublic(ROUTE);
    await p2.joinPublic(ROUTE);
    const sdk = new ColyseusClient(endpoint);
    const friendRoom = await sdk.create('public', { routeId: ROUTE, token: tF! });
    expect(friendRoom.roomId).not.toBe(wa.roomId);
    await sleep(150);

    const zone = await zonesOf(tU!);
    expect(zone).toMatchObject({ riders: 3, rooms: 2 });
    expect(zone.friends).toEqual(['Amie']);
    // Un inconnu n'apprend rien sur les amis des autres.
    expect((await zonesOf(tS!)).friends).toEqual([]);
    expect((await api<PublicPick>(tU!, 'POST', '/public/pick', { routeId: ROUTE })).body).toEqual({ roomId: friendRoom.roomId, friends: ['Amie'] });
    expect((await api<PublicPick>(tS!, 'POST', '/public/pick', { routeId: ROUTE })).body).toEqual({ roomId: wa.roomId, friends: [] });

    // Rejoindre la salle conseillée.
    const me = new RideNetClient({ endpoint, token: tU!, autoRejoin: false });
    open.push(me);
    const pick = await me.pickPublicRoom(ROUTE);
    const w = await me.joinPublic(ROUTE, {}, pick.roomId);
    expect(w.roomId).toBe(friendRoom.roomId);
    // Salle conseillée disparue : repli sur la première salle ouverte de la zone.
    const lost = new RideNetClient({ endpoint, token: tS!, autoRejoin: false });
    open.push(lost);
    const w2 = await lost.joinPublic(ROUTE, {}, 'salle-disparue');
    expect([wa.roomId, friendRoom.roomId]).toContain(w2.roomId);
    await friendRoom.leave();
  });

  it('carte de la zone : coureurs en ligne anonymes, amis nommés ; rejoindre un ami = apparaître dans sa roue', async () => {
    const ROUTE = 'boucle-gif-sur-yvette-gometz-la-ville';
    const [tU, tF, tS, tN] = await Promise.all(['Moi2', 'Amie2', 'Inconnu2', 'Nouveau2'].map(login));
    await befriend(tU!, tF!);
    const detail = async (tok?: string) => {
      const res = await fetch(`${endpoint}/api/public/zones/${ROUTE}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
      expect(res.status).toBe(200);
      return (await res.json()) as PublicZoneDetail;
    };
    expect(await detail(tU)).toMatchObject({ routeId: ROUTE, riders: 0, rooms: 0, dots: [], friends: [], loop: true });

    // L'amie roule déjà, loin du départ ; un inconnu la rejoint dans la même salle.
    const f = new RideNetClient({ endpoint, token: tF!, autoRejoin: false });
    const s = new RideNetClient({ endpoint, token: tS!, autoRejoin: false });
    open.push(f, s);
    const wf = await f.joinPublic(ROUTE);
    await s.joinPublic(ROUTE);
    const room = [...activeRooms].find((r) => r.roomId === wf.roomId)!;
    room.sim.get(f.selfId)!.state.distM = 12_000;
    room.sim.get(f.selfId)!.state.speedMs = 9;
    room.sim.get(s.selfId)!.state.distM = 3000;

    const mine = await detail(tU);
    expect(mine).toMatchObject({ riders: 2, rooms: 1 });
    expect(mine.lengthM).toBeGreaterThan(40_000);
    const friendDot = mine.dots.find((d) => d.friend)!;
    expect(friendDot).toMatchObject({ name: 'Amie2', dir: 1 });
    expect(friendDot.d).toBeCloseTo(12_000, -1);
    const strangerDot = mine.dots.find((d) => !d.friend)!;
    expect(strangerDot.name).toBeUndefined();
    expect(Object.keys(strangerDot).sort()).toEqual(['d', 'dir']);
    expect(mine.friends).toHaveLength(1);
    expect(mine.friends[0]).toMatchObject({ name: 'Amie2', full: false });
    expect(mine.friends[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    // Ni un inconnu ni un visiteur sans compte n'apprennent de noms.
    for (const view of [await detail(tS), await detail()]) {
      expect(view.riders).toBe(2);
      expect(view.dots.every((d) => d.name === undefined && !d.friend)).toBe(true);
      expect(view.friends).toEqual([]);
    }

    // « Rejoindre » l'amie : sa salle et son coureur.
    const rel = mine.friends[0]!.id;
    const pick = (await api<PublicPick>(tU!, 'POST', '/public/pick', { routeId: ROUTE, friendId: rel })).body;
    expect(pick).toEqual({ roomId: wf.roomId, near: f.selfId, friends: ['Amie2'] });
    const me = new RideNetClient({ endpoint, token: tU!, autoRejoin: false });
    open.push(me);
    const wm = await me.joinPublic(ROUTE, { near: pick.near }, pick.roomId);
    expect(wm.roomId).toBe(wf.roomId);
    const placed = room.sim.get(me.selfId)!;
    expect(placed.dir).toBe(1);
    expect(placed.state.distM).toBeCloseTo(12_000 - 4, 0);
    expect(placed.state.speedMs).toBeCloseTo(9, 0);
    expect(room.sim.separationM(me.selfId, f.selfId)).toBeCloseTo(4, 0);

    // Le jeu met du temps à démarrer : pendant ce temps l'amie a avancé de 300 m. Quand le jeu envoie « prêt », on est
    // replacé dans sa roue (et pas 300 m derrière) ; la télémétrie seule ne suffit pas.
    room.sim.get(f.selfId)!.state.distM += 300;
    me.sendTelemetry({ watts: 0, cadence: 0, gear: 12, steer: 0 });
    await sleep(200);
    expect(room.sim.separationM(me.selfId, f.selfId)).toBeGreaterThan(250);
    me.ready();
    await sleep(300);
    expect(Math.abs(room.sim.separationM(me.selfId, f.selfId) - 4)).toBeLessThan(3);
    expect(room.sim.get(me.selfId)!.dir).toBe(1);

    // Elle fait demi-tour : le suivant apparaît dans le même sens qu'elle (à contresens de l'itinéraire).
    expect(room.sim.turnAround(f.selfId, Date.now())).toBe(true);
    const nw = new RideNetClient({ endpoint, token: tN!, autoRejoin: false });
    open.push(nw);
    await nw.joinPublic(ROUTE, { near: f.selfId }, wf.roomId);
    const next = room.sim.get(nw.selfId)!;
    expect(next.dir).toBe(-1);
    expect(room.sim.separationM(nw.selfId, f.selfId)).toBeCloseTo(4, 0);
    expect((await detail(tU)).dots.filter((d) => d.dir === -1).length).toBeGreaterThanOrEqual(2);

    // Refus : un coureur inconnu de la salle (near invalide) apparaît comme tout le monde ; une relation qui n'est pas la sienne, 404.
    expect((await api(tS!, 'POST', '/public/pick', { routeId: ROUTE, friendId: rel })).status).toBe(404);
    expect((await api(tU!, 'POST', '/public/pick', { routeId: ROUTE, friendId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await api(tU!, 'POST', '/public/pick', { routeId: ROUTE, friendId: 'pas-un-uuid' })).status).toBe(400);
    await f.leave();
    await sleep(200);
    const gone = await api(tU!, 'POST', '/public/pick', { routeId: ROUTE, friendId: rel });
    expect(gone.status).toBe(404);
    expect((await api(tU!, 'GET', '/public/zones/zone-inventee')).status).toBe(404);
  });

  it('le chat n’est lu que par les coureurs proches', async () => {
    const [a, near, far] = await Promise.all(['Parle', 'Proche', 'Loin'].map(rider));
    const w = await a!.joinPublic('chevreuse-boucle');
    await near!.joinPublic('chevreuse-boucle');
    await far!.joinPublic('chevreuse-boucle');
    expect(w.proximity?.chatM).toBe(PUBLIC_CHAT_RADIUS_M);
    const room = [...activeRooms].find((r) => r.roomId === w.roomId)!;
    const farId = far!.selfId;
    room.sim.get(farId)!.state.distM = 5000;
    room.sim.get(a!.selfId)!.state.distM = 100;
    room.sim.get(near!.selfId)!.state.distM = 100 + PUBLIC_CHAT_RADIUS_M - 5;
    const heard = { near: [] as string[], far: [] as string[], self: [] as string[] };
    near!.on('event', (ev) => ev.kind === 'chat' && heard.near.push(ev.text));
    far!.on('event', (ev) => ev.kind === 'chat' && heard.far.push(ev.text));
    a!.on('event', (ev) => ev.kind === 'chat' && heard.self.push(ev.text));
    a!.chat('Bonjour le peloton');
    await sleep(500);
    expect(heard.near).toEqual(['Bonjour le peloton']);
    expect(heard.self).toEqual(['Bonjour le peloton']);
    expect(heard.far).toEqual([]);
    // L'autre côté de la ligne de départ compte comme proche (boucle) : 20 m, pas 10 km.
    room.sim.get(a!.selfId)!.state.distM = 10;
    room.sim.get(farId)!.state.distM = room.sim.length - 10;
    a!.chat('Et toi, de l’autre côté de la ligne ?');
    await sleep(500);
    expect(heard.far).toEqual(['Et toi, de l’autre côté de la ligne ?']);
  });

  it('la voix d’une salle publique est anonyme : identité = coureur de la salle, pas le compte', async () => {
    const t = await login('Voix');
    const c = new RideNetClient({ endpoint, token: t, autoRejoin: false });
    open.push(c);
    const w = await c.joinPublic('cote-de-la-madeleine');
    const r = await api(t, 'GET', `/rides/${w.roomId}/voice-token`);
    expect(r.status).toBe(200);
    const payload = JSON.parse(Buffer.from((r.body.token as string).split('.')[1]!, 'base64url').toString('utf8'));
    expect(payload.sub).toBe(c.selfId);
    expect(payload.video.room).toBe(`ride-${w.roomId}`);
    // Un compte qui ne roule pas dans la salle n'obtient pas de jeton.
    const other = await login('VoixAutre');
    expect((await api(other, 'GET', `/rides/${w.roomId}/voice-token`)).status).toBe(403);
  });

  it('zones distinctes = salles distinctes', async () => {
    const a = await rider('Zone1');
    const b = await rider('Zone2');
    const wa = await a.joinPublic(ZONE);
    const wb = await b.joinPublic('chevreuse-boucle');
    expect(wb.roomId).not.toBe(wa.roomId);
    expect(wb.route.name).not.toBe(wa.route.name);
  });

  it('demi-tour : le coureur apparaît en sens inverse dans l’instantané', async () => {
    const a = await rider('Retour');
    await a.joinPublic('chevreuse-boucle');
    a.startTelemetry(() => ({ watts: 200, cadence: 85, gear: 12, steer: 0 }));
    await sleep(1500);
    expect(a.getSelfSnapshot()?.dir).toBeUndefined();
    a.uturn();
    await sleep(600);
    expect(a.getSelfSnapshot()?.dir).toBe(-1);
    // Trop tôt pour un deuxième demi-tour : refusé, il reste en sens inverse.
    a.uturn();
    await sleep(400);
    expect(a.getSelfSnapshot()?.dir).toBe(-1);
    a.stopTelemetry();
  });

  it('une salle pleine (20) ferme ses portes : le 21ᵉ ouvre une 2ᵉ salle, puis la 1ʳᵉ se rouvre', async () => {
    const clients: RideNetClient[] = [];
    const first = await rider('Plein0');
    clients.push(first);
    const w0 = await first.joinPublic('cote-de-chateaufort');
    for (let i = 1; i < 20; i++) {
      const c = await rider(`Plein${i}`);
      clients.push(c);
      const w = await c.joinPublic('cote-de-chateaufort');
      expect(w.roomId).toBe(w0.roomId);
    }
    const overflow = await rider('Plein20');
    const w20 = await overflow.joinPublic('cote-de-chateaufort');
    expect(w20.roomId).not.toBe(w0.roomId);
    // Un départ libère une place dans la salle d'origine.
    await clients[5]!.leave();
    await sleep(300);
    const late = await rider('Plein21');
    const wl = await late.joinPublic('cote-de-chateaufort');
    expect(wl.roomId).toBe(w0.roomId);
  }, 30_000);
});
