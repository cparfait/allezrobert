/**
 * Synchronisation de bout en bout : deux appareils (le service d'historique du jeu, stockage en
 * mémoire) et le vrai serveur (pg-mem). Une sortie jouée sans compte sur l'un apparaît sur
 * l'autre, une suppression et un ressenti se propagent, rien n'est dupliqué.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';
import { BrowserHistoryStore, HistoryService, rideClientId } from '../../client/src/data/history/index.ts';

let db: Db;
let server: Server;
let base: string;

function memoryKv() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** Appareil connecté avec le cookie de session donné. */
function device(cookie: () => string): HistoryService {
  return new HistoryService(new BrowserHistoryStore(memoryKv()), (path, init) => fetch(`${base}/api${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: cookie() } }), null);
}

const samples = Array.from({ length: 1800 }, (_, i) => ({ watts: 200 + (i % 40), hr: 140, cadence: 90 }));

beforeAll(async () => {
  db = await createDb('memory');
  await migrate(db);
  const ctx = createContext(testConfig({ DEV_LOGIN: 'true' }), db, await RouteStore.load(undefined), { log: () => undefined });
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

describe('synchronisation de l’historique entre deux appareils', () => {
  it('jouée hors compte sur A, retrouvée sur B ; suppression et ressenti propagés', async () => {
    const login = await fetch(`${base}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Deux PC' }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0] ?? '').find((c) => c.startsWith('ar_session='))!;
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as { id: string };

    const a = device(() => cookie);
    const b = device(() => cookie);
    const t1 = Date.UTC(2026, 9, 12, 7);
    const t2 = Date.UTC(2026, 9, 13, 7);
    // A : une sortie sans compte, puis connexion et une deuxième sortie.
    await a.recordRide({ startT: t1, name: 'Hors ligne', routeId: 'montmartre', kind: 'free', durationS: 1800, movingS: 1800, distanceM: 15000, elevationM: 50, ftpWatts: 250, samples });
    a.setAccount(me.id);
    await a.recordRide({ startT: t2, name: 'Séance', routeId: null, kind: 'workout', workoutId: 'cy.vo2max.5x4', workoutName: 'VO2max 5 × 4', durationS: 1800, movingS: 1800, distanceM: 14000, elevationM: 0, ftpWatts: 250, samples });
    await a.addFtp(262, 'ramp', t2);
    expect((await a.sync()).state).toBe('ok');
    expect(a.status.pushed).toBe(2);

    // B : récupère tout.
    b.setAccount(me.id);
    const sb = await b.sync();
    expect(sb).toMatchObject({ state: 'ok', pulled: 2 });
    const onB = await b.rides();
    expect(onB.map((r) => r.name).sort()).toEqual(['Hors ligne', 'Séance']);
    expect(onB.find((r) => r.kind === 'workout')).toMatchObject({ workoutId: 'cy.vo2max.5x4', ftpAtRide: 250 });
    expect(onB[0]!.tss).toBeGreaterThan(0);
    expect((await b.ftpHistory()).map((f) => f.ftpWatts)).toContain(262);
    expect((await b.powerRecords()).length).toBeGreaterThan(5);

    // B : ressenti et suppression ; A les reçoit.
    await b.updateRide(rideClientId(t2), { feedback: 'hard' });
    await b.deleteRide(rideClientId(t1));
    await b.sync();
    await a.sync();
    const onA = await a.rides();
    expect(onA).toHaveLength(1);
    expect(onA[0]).toMatchObject({ clientId: rideClientId(t2), feedback: 'hard' });

    // Re-synchroniser ne duplique rien.
    await a.sync();
    await b.sync();
    const rows = await db.query('SELECT COUNT(*) AS n FROM activities WHERE user_id = $1', [me.id]);
    expect(Number(rows.rows[0].n)).toBe(1);
    expect(await b.countRides()).toBe(1);
  });

  it('hors ligne : la synchronisation échoue proprement et reprend plus tard', async () => {
    const offline = new HistoryService(new BrowserHistoryStore(memoryKv()), () => Promise.reject(new TypeError('fetch failed')), null);
    offline.setAccount('00000000-0000-0000-0000-000000000000');
    await offline.recordRide({ startT: Date.UTC(2026, 9, 14), name: 'Sans réseau', routeId: null, kind: 'free', durationS: 600, movingS: 600, distanceM: 5000, elevationM: 0, ftpWatts: 200, samples: samples.slice(0, 600) });
    expect((await offline.sync()).state).toBe('offline');
    expect((await offline.store.pending('00000000-0000-0000-0000-000000000000')).rides).toHaveLength(1);
  });
});
