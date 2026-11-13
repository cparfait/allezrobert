import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { COLLISION_PILOT_ERROR, COLLISION_VERSION_CLOSE, COLLISION_VERSION_ERROR, RouteTrack, type RouteData } from '@allezrobert/shared';
import { buildCollisionManifest, COLLISION_MANIFEST_PATH, COLLISION_PILOT_ROUTE, COLLISION_PILOT_WORLD, corridorHalfM, createPilotBuildingCollision, type CollisionManifest } from '@allezrobert/physics';
import { RideNetClient } from '../../client/src/net/RideNetClient.ts';
import { loadRideCollisionFingerprint } from '../../client/src/net/collision-version.ts';
import { pilotCollisionAuthority } from '../src/ride/collision-authority.ts';
import { activeRooms } from '../src/ride/RideRoom.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';

const publicDir = new URL('../../client/public/', import.meta.url);
const worlds = new URL('worlds/', publicDir);
const routeDir = (id: string) => fileURLToPath(new URL(`${id}/routes/`, worlds));
const route = JSON.parse(readFileSync(new URL(`${COLLISION_PILOT_WORLD}/routes/${COLLISION_PILOT_ROUTE}.json`, worlds), 'utf8')) as RouteData;
const bytes = readFileSync(new URL(COLLISION_MANIFEST_PATH.slice(1), publicDir), 'utf8');
const artifact = JSON.parse(bytes) as CollisionManifest;
const different = '0'.repeat(64);
let server: RunningServer;
let endpoint: string;
let fingerprint: string;

beforeAll(async () => {
  const computed = await loadRideCollisionFingerprint(COLLISION_PILOT_WORLD, route, async (input) => {
    expect(input).toBe(COLLISION_MANIFEST_PATH);
    return new Response(bytes);
  });
  if (!computed) throw new Error('Empreinte client absente');
  fingerprint = computed;
  server = await startServer({ config: testConfig({ DEV_LOGIN: 'true', RECONNECT_GRACE_S: '2', LOG_LEVEL: 'warn', COLLISION_PILOT: '1',
    ROUTES_DIR: [routeDir(COLLISION_PILOT_WORLD), routeDir('longchamp')].join(',') }), port: 0, noSignals: true });
  endpoint = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => { await server?.stop(); });

async function login(name: string): Promise<RideNetClient> {
  const res = await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return new RideNetClient({ endpoint, token: ((await res.json()) as { sessionToken: string }).sessionToken, autoRejoin: false });
}

function drop(net: RideNetClient, version?: string | null, removePilot = false): void {
  const room = (net as unknown as { room: Room }).room;
  room.reconnection.minUptime = 0;
  if (version !== undefined || removePilot) {
    const url = new URL(room.connection.url!);
    if (version === null) url.searchParams.delete('collisionFingerprint');
    else if (version !== undefined) url.searchParams.set('collisionFingerprint', version);
    if (removePilot) url.searchParams.delete('collisionPilot');
    room.connection.url = url.toString();
  }
  room.connection.close(4010);
}

async function expectReconnect(net: RideNetClient): Promise<void> {
  const states: string[] = [];
  const off = net.on('connection', ({ state }) => states.push(state));
  try {
    drop(net);
    await expect.poll(() => states).toEqual(['reconnecting', 'connected']);
  } finally {
    off();
  }
}

it('calcule la même empreinte côté jeu et côté serveur et refuse un manifeste absent ou altéré', async () => {
  expect(fingerprint).toBe(artifact.identity.fingerprint);
  expect((await pilotCollisionAuthority(route)).fingerprint).toBe(fingerprint);
  expect(await loadRideCollisionFingerprint('dev', { ...route, id: 'dev-loop' }, async () => { throw new Error('fetch inattendu'); })).toBeUndefined();
  await expect(loadRideCollisionFingerprint(COLLISION_PILOT_WORLD, route, async () => new Response(null, { status: 404 }))).rejects.toThrow(COLLISION_VERSION_ERROR);
  const changed = structuredClone(artifact);
  (changed.data.obstacles[0]!.polygon as number[])[0]! += 0.1;
  await expect(loadRideCollisionFingerprint(COLLISION_PILOT_WORLD, route, async () => Response.json(changed))).rejects.toThrow(COLLISION_VERSION_ERROR);
  await expect(pilotCollisionAuthority({ ...route, roadWidthM: route.roadWidthM + 1 })).rejects.toThrow('Tracé serveur différent');
});

it('reproduit l’empreinte et la modifie quand la géométrie effective change', async () => {
  const { data } = artifact;
  expect(await buildCollisionManifest(data)).toEqual(artifact);
  expect(await buildCollisionManifest({ ...data, obstacles: [...data.obstacles].reverse(),
    source: { ...data.source, tiles: Object.fromEntries(Object.entries(data.source.tiles).reverse()) } })).toEqual(artifact);
  const [first, ...rest] = data.obstacles;
  const moved = { ...first!, polygon: first!.polygon.map((n, i) => i === 0 ? n + 0.1 : n) };
  for (const obstacles of [rest, [moved, ...rest], [{ ...first!, topM: first!.topM + 0.1 }, ...rest], [{ ...first!, solid: false }, ...rest]]) {
    expect((await buildCollisionManifest({ ...data, obstacles })).identity.fingerprint).not.toBe(fingerprint);
  }
  const tileId = Object.keys(data.source.tiles)[0]!;
  const changedTiles = await buildCollisionManifest({ ...data, source: { ...data.source, tiles: { ...data.source.tiles, [tileId]: different } } });
  expect(changedTiles.identity.tilesSha256).not.toBe(artifact.identity.tilesSha256);
  expect(changedTiles.identity.obstaclesSha256).toBe(artifact.identity.obstaclesSha256);
  expect(changedTiles.identity.fingerprint).not.toBe(fingerprint);
});

it('refuse la création et l’invitation du pilote sans preuve valide et accepte une preuve identique', async () => {
  const host = await login('Hôte collisions');
  const old = await login('Ancien jeu');
  const options = { routeId: COLLISION_PILOT_ROUTE, aiRiders: 0 };
  try {
    await expect(host.create(options)).rejects.toThrow(COLLISION_VERSION_ERROR);
    await expect(host.create(options, { collisionFingerprint: different })).rejects.toThrow(COLLISION_VERSION_ERROR);
    const w = await host.create(options, { collisionFingerprint: fingerprint });
    expect(w.collisionFingerprint).toBe(fingerprint);
    expect(w.collisionPilot).toBeUndefined();
    await expect(old.joinByCode(w.inviteCode)).rejects.toThrow(COLLISION_VERSION_ERROR);
    await expect(old.joinById(w.roomId, w.inviteCode, { role: 'companion' })).rejects.toThrow(COLLISION_VERSION_ERROR);
    await expect(old.joinByCode(w.inviteCode, { collisionFingerprint: '46f0' })).rejects.toThrow(COLLISION_VERSION_ERROR);
    await expect(old.joinByCode(w.inviteCode, { collisionFingerprint: different })).rejects.toThrow(COLLISION_VERSION_ERROR);
    const guest = await old.joinByCode(w.inviteCode, { collisionFingerprint: fingerprint });
    expect(guest.roomId).toBe(w.roomId);
  } finally {
    await Promise.all([host.leave(), old.leave()]);
  }
});

it('reprend la même place avec une preuve identique, puis refuse une preuve modifiée ou absente', async () => {
  const host = await login('Hôte reprise');
  const rider = await login('Coureur reprise');
  try {
    const w = await host.create({ routeId: COLLISION_PILOT_ROUTE, aiRiders: 0 }, { collisionFingerprint: fingerprint });
    await rider.joinByCode(w.inviteCode, { collisionFingerprint: fingerprint });
    const initialId = rider.selfId;
    await expectReconnect(rider);
    expect(rider.selfId).toBe(initialId);
    for (const version of [different, null]) {
      const id = rider.selfId;
      const received = new Promise((resolve) => rider.on('connection', (event) => {
        if (event.state === 'disconnected') resolve(event);
      }));
      drop(rider, version);
      expect(await received).toMatchObject({ code: COLLISION_VERSION_CLOSE, reason: COLLISION_VERSION_ERROR });
      await expect.poll(() => host.roster.has(id)).toBe(false);
      await rider.joinByCode(w.inviteCode, { collisionFingerprint: fingerprint });
    }
  } finally {
    await Promise.all([rider.leave(), host.leave()]);
  }
});

it('préserve les salles hors pilote pour un client sans empreinte', async () => {
  const host = await login('Hôte Longchamp');
  const rider = await login('Coureur Longchamp');
  try {
    const w = await host.create({ routeId: 'anneau-de-longchamp', aiRiders: 0 });
    expect(w.collisionFingerprint).toBeUndefined();
    expect((await rider.joinByCode(w.inviteCode)).roomId).toBe(w.roomId);
    await expectReconnect(rider);
  } finally {
    await Promise.all([rider.leave(), host.leave()]);
  }
});

it('roule à plusieurs en salle expérimentale, publie des poses sûres et exige l’accord à la reprise', async () => {
  expect(testConfig().COLLISION_PILOT).toBe(true);
  const host = await login('Hôte expérimental');
  const guest = await login('Invité expérimental');
  const join = { collisionFingerprint: fingerprint, collisionPilot: true } as const;
  const track = new RouteTrack(route);
  const guard = createPilotBuildingCollision(artifact.data.obstacles);
  try {
    const welcome = await host.create({ routeId: COLLISION_PILOT_ROUTE, aiRiders: 2 }, join);
    expect(welcome.collisionPilot).toBe(true);
    await expect(guest.joinByCode(welcome.inviteCode, { collisionFingerprint: fingerprint })).rejects.toThrow(COLLISION_PILOT_ERROR);
    expect((await guest.joinByCode(welcome.inviteCode, join)).collisionPilot).toBe(true);
    const room = [...activeRooms].find((r) => r.roomId === welcome.roomId)!;
    const a = room.sim.get(host.selfId)!;
    const b = room.sim.get(guest.selfId)!;
    a.state.distM = b.state.distM = 18524;
    a.state.speedMs = b.state.speedMs = 10;
    a.lateralM = a.lateralTarget = 2.6;
    b.lateralM = b.lateralTarget = 0;
    const seen: Array<{ distM: number; lateralM: number }> = [];
    const off = host.on('snapshot', (s) => {
      const me = s.riders.find((r) => r.id === host.selfId);
      if (me && me.distM >= 18524) seen.push(me);
    });
    server.gameServer.simulateLatency(240);
    host.startTelemetry(() => ({ watts: 190, cadence: 90, gear: 12, steer: 2.6 }));
    guest.startTelemetry(() => ({ watts: 190, cadence: 90, gear: 12, steer: 0 }));
    await expect.poll(() => guest.getSelfSnapshot()?.distM ?? 0, { timeout: 5000 }).toBeGreaterThan(18543);
    // COLL-MURS-3d : l'hôte collé au bord contourne la façade sans s'arrêter ni quitter la chaussée.
    await expect.poll(() => host.getSelfSnapshot()?.distM ?? 0, { timeout: 5000 }).toBeGreaterThan(18543);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every((p) => guard.isClear(track, p.distM, p.lateralM))).toBe(true);
    expect(seen.every((p) => Math.abs(p.lateralM) <= corridorHalfM(track.widthAt(p.distM)) + 0.01)).toBe(true);
    off();
    server.gameServer.simulateLatency(0);
    await expectReconnect(host);
    const refusals: Array<{ code?: number; reason?: string }> = [];
    const unsubscribe = host.on('connection', (e) => { if (e.state === 'disconnected') refusals.push(e); });
    drop(host, different);
    await expect.poll(() => refusals.at(-1)).toMatchObject({ code: COLLISION_VERSION_CLOSE, reason: COLLISION_VERSION_ERROR });
    await host.joinByCode(welcome.inviteCode, join);
    drop(host, undefined, true);
    await expect.poll(() => refusals.at(-1)).toMatchObject({ code: COLLISION_VERSION_CLOSE, reason: COLLISION_PILOT_ERROR });
    unsubscribe();
  } finally {
    server.gameServer.simulateLatency(0);
    await Promise.all([host.leave(), guest.leave()]);
  }
});
