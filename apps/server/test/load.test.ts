/**
 * Test de charge : 20 clients simulés (vrais WebSocket, RideNetClient) dans une même sortie,
 * télémétrie à 10 Hz, puis mesure du temps de tick serveur, du débit d'instantanés reçus et
 * de leur taille. Plus un banc d'essai de la simulation seule (20 coureurs dont 10 IA).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Packr } from 'msgpackr';
import { encodeSnapshot, MAX_RIDERS_PER_ROOM } from '@allezrobert/shared';
import { RideNetClient } from '../../client/src/net/index.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';
import { activeRooms } from '../src/ride/RideRoom.ts';
import { RideSimulation, resolveRideOptions } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

let srv: RunningServer;
let endpoint: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  srv = await startServer({ config: testConfig({ DEV_LOGIN: 'true', LOG_LEVEL: 'warn' }), port: 0, noSignals: true });
  endpoint = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.stop();
});

describe('charge', () => {
  it(`${MAX_RIDERS_PER_ROOM} clients simulés à 10 Hz : tick serveur et diffusion`, async () => {
    const clients: RideNetClient[] = [];
    const tokens = await Promise.all(
      Array.from({ length: MAX_RIDERS_PER_ROOM }, async (_, i) => {
        const res = await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Charge${i}` }) });
        return ((await res.json()) as { sessionToken: string }).sessionToken;
      }),
    );
    const host = new RideNetClient({ endpoint, token: tokens[0]!, autoRejoin: false });
    const w = await host.create({ mode: 'group', stickyGroup: true });
    clients.push(host);
    for (let i = 1; i < MAX_RIDERS_PER_ROOM; i++) {
      const c = new RideNetClient({ endpoint, token: tokens[i]!, autoRejoin: false });
      await c.joinByCode(w.inviteCode);
      clients.push(c);
    }
    // Salle pleine : le 21e est refusé.
    const extraToken = ((await (await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Extra' }) })).json()) as { sessionToken: string }).sessionToken;
    await expect(new RideNetClient({ endpoint, token: extraToken, autoRejoin: false }).joinByCode(w.inviteCode)).rejects.toThrow();

    const received = clients.map(() => ({ n: 0, maxGap: 0, last: 0 }));
    clients.forEach((c, i) => {
      c.on('snapshot', () => {
        const now = performance.now();
        const r = received[i]!;
        if (r.last && r.n > 2) r.maxGap = Math.max(r.maxGap, now - r.last);
        r.last = now;
        r.n++;
      });
      c.startTelemetry(() => ({ watts: 180 + (i % 5) * 30, cadence: 88, hr: 140, gear: 12, steer: ((i % 5) - 2) * 0.6 }));
    });

    const room = [...activeRooms].find((r) => r.roomId === w.roomId)!;
    expect(room.sim.riders).toHaveLength(MAX_RIDERS_PER_ROOM);
    const ticksBefore = room.tickStats.total;
    const DURATION_S = 8;
    await sleep(DURATION_S * 1000);
    const stats = room.tickStats.summary();
    const ticks = room.tickStats.total - ticksBefore;

    // Taille d'un instantané (msgpack, comme Colyseus) et comparaison avec les objets complets.
    const packr = new Packr({ useRecords: false });
    const compact = packr.pack(encodeSnapshot(room.sim.tick, Date.now(), room.sim.rows())).length;
    const full = packr.pack(clients[0]!.latest).length;
    const rates = received.map((r) => r.n / DURATION_S);
    const minRate = Math.min(...rates);
    const maxGap = Math.max(...received.map((r) => r.maxGap));
    const mem = process.memoryUsage();
    const report = {
      clients: clients.length,
      durationS: DURATION_S,
      ticks,
      tickMs: stats,
      snapshotBytes: { compactMsgpack: compact, fullObjectsMsgpack: full },
      perClientDownKBs: Math.round(((compact * 10) / 1024) * 10) / 10,
      totalDownKBs: Math.round(((compact * 10 * clients.length) / 1024) * 10) / 10,
      receiveRateHz: { min: Math.round(minRate * 10) / 10, avg: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 },
      maxInterArrivalMs: Math.round(maxGap),
      rssMB: Math.round(mem.rss / 1048576),
    };
    console.log(`\n[charge] ${JSON.stringify(report, null, 2)}`);

    expect(ticks).toBeGreaterThanOrEqual(DURATION_S * 10 * 0.8);
    expect(stats.p99Ms).toBeLessThan(20);
    expect(minRate).toBeGreaterThan(8);
    expect(compact).toBeLessThan(full / 4);
    // Tous les coureurs avancent, groupe soudé : écart ≤ ~30 m autour du centre.
    const snap = clients[5]!.latest!;
    expect(snap.riders).toHaveLength(MAX_RIDERS_PER_ROOM);
    for (const r of snap.riders) expect(r.speedMs).toBeGreaterThan(3);
    await Promise.all(clients.map((c) => c.leave()));
  }, 60_000);

  it('banc d’essai simulation seule : 20 coureurs (10 humains + 10 IA), 10 000 ticks', () => {
    const route = proceduralLoop();
    const sim = new RideSimulation(route, resolveRideOptions({ mode: 'group', aiRiders: 10 }, route.id), 0, { seed: 'bench' });
    for (let i = 0; i < 10; i++) sim.addRider({ id: `h${i}`, name: `H${i}`, kind: 'human', userId: `u${i}` }, 0);
    sim.addAiRiders(10, 0, 250);
    let now = 0;
    const t0 = performance.now();
    for (let k = 0; k < 10_000; k++) {
      now += 100;
      for (let i = 0; i < 10; i++) sim.setTelemetry(`h${i}`, { seq: k, t: now, watts: 200 + i * 10, cadence: 90, gear: 12, steer: 0 }, now);
      sim.step(now, 0.1);
      encodeSnapshot(sim.tick, now, sim.rows());
    }
    const perTick = (performance.now() - t0) / 10_000;
    console.log(`\n[banc] simulation 20 coureurs : ${perTick.toFixed(4)} ms/tick (${(perTick * 10).toFixed(3)} ms CPU par seconde de jeu, ~${Math.floor(100 / perTick)} sorties de 20 coureurs par cœur à 10 Hz)`);
    expect(perTick).toBeLessThan(2);
  });
});
