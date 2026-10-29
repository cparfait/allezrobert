/**
 * Historique d'entraînement sur base en mémoire (pg-mem) : mesures calculées à l'envoi d'un FIT,
 * synchronisation idempotente avec la base locale du jeu, FIT ajouté à une sortie synchronisée,
 * charge, zones, records, FTP, séances perso, suppressions propagées, fil des amis, effacement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildActivity, encodeActivity } from '@allezrobert/fit';
import type { ActivityRecord, HistoryRide, HistorySyncRequest, HistorySyncResponse } from '@allezrobert/shared';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext, type AppContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';
import { backfillTraining } from '../src/activities/backfill.ts';

let db: Db;
let ctx: AppContext;
let server: Server;
let base: string;

class Session {
  cookie = '';
  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const h: Record<string, string> = {};
    if (this.cookie) h.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      payload = Buffer.from(body);
      h['content-type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(`${base}${path}`, { method, headers: h, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv!.split('=');
      if (k === 'ar_session') this.cookie = v ? `ar_session=${v}` : '';
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
}

async function login(name: string): Promise<Session> {
  const s = new Session();
  expect((await s.json('POST', '/api/auth/dev', { name })).status).toBe(200);
  return s;
}

/** 30 min à 200–229 W (FTP 250 : IF ≈ 0,86). */
function sampleFit(t0 = Date.UTC(2026, 9, 20, 9, 0, 0)): Uint8Array {
  const records: ActivityRecord[] = [];
  for (let i = 0; i < 1800; i++) records.push({ t: t0 + i * 1000, distanceM: (i + 1) * 9, speedMs: 9, altitudeM: 100, watts: 200 + (i % 30), cadence: 88 });
  return encodeActivity(buildActivity({ id: 'test', name: 'Test', riderMassKg: 75 }, records), { timezoneOffsetMinutes: 120 } as never);
}

function ride(clientId: string, startedAt: number, extra: Partial<HistoryRide> = {}): HistoryRide {
  return {
    clientId,
    name: 'Sortie locale',
    routeId: 'montmartre',
    kind: 'workout',
    workoutId: 'cy.sweetspot.3x12',
    workoutName: 'Sweet spot 3 × 12',
    startedAt,
    utcOffsetMin: 60,
    durationS: 3960,
    movingS: 3900,
    distanceM: 32000,
    elevationM: 120,
    avgSpeedKmh: 29.5,
    avgWatts: 190,
    maxWatts: 320,
    np: 215,
    intensity: 0.86,
    tss: 80,
    workKJ: 740,
    avgCadence: 90,
    avgHr: 140,
    maxHr: 171,
    ftpAtRide: 250,
    feedback: 'right',
    curve: [
      [5, 450],
      [60, 300],
      [1200, 230],
    ],
    zonesS: [600, 900, 300, 2100, 0, 0, 0],
    updatedAt: startedAt + 4000_000,
    ...extra,
  };
}

const emptySync = (since = 0): HistorySyncRequest => ({ since, rides: [], deletedRides: [], ftp: [], workouts: [], powerRecords: [] });

beforeAll(async () => {
  const config = testConfig({ DEV_LOGIN: 'true' });
  db = await createDb(process.env.TEST_DATABASE_URL ?? 'memory');
  if (process.env.TEST_DATABASE_URL) await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  ctx = createContext(config, db, await RouteStore.load(undefined), { log: (l, m) => { if (l === 'error') console.error(m); } });
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

describe('historique — sorties FIT', () => {
  it('calcule NP, IF, TSS, courbe et zones à l’envoi, avec la FTP donnée', async () => {
    const s = await login('Fitou');
    const up = await s.json('POST', '/api/activities?name=Test&kind=workout&workoutId=cy.threshold.2x20&workoutName=Seuil&ftp=250&clientRideId=ar-1', sampleFit());
    expect(up.status).toBe(201);
    expect(up.body.activity).toMatchObject({ hasFit: true, kind: 'workout', workoutName: 'Seuil' });
    const list = await s.json<HistoryRide[]>('GET', '/api/history/rides');
    expect(list.body).toHaveLength(1);
    const r = list.body[0]!;
    expect(r.clientId).toBe('ar-1');
    expect(r.ftpAtRide).toBe(250);
    expect(r.np).toBeGreaterThan(210);
    expect(r.intensity).toBeCloseTo(r.np! / 250, 3);
    expect(r.tss).toBeGreaterThan(30);
    expect(r.utcOffsetMin).toBe(120);
    // Séance de la bibliothèque : son type ; filtre par type.
    expect(r.trainingType).toBe('threshold');
    expect((await s.json<HistoryRide[]>('GET', '/api/history/rides?trainingType=threshold')).body).toHaveLength(1);
    expect((await s.json<HistoryRide[]>('GET', '/api/history/rides?trainingType=vo2max')).body).toHaveLength(0);
    expect(r.curve.find(([d]) => d === 60)?.[1]).toBeGreaterThan(200);
    expect(r.zonesS.reduce((a, b) => a + b, 0)).toBe(1800);
    // Même sortie renvoyée : pas de doublon ni d'XP en plus.
    const again = await s.json('POST', '/api/activities?clientRideId=ar-1', sampleFit());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, xpGained: 0 });
    expect((await s.json('GET', '/api/history/rides')).body).toHaveLength(1);
    const detail = await s.json<HistoryRide>('GET', `/api/history/rides/${r.serverId}`);
    expect(detail.body.workoutId).toBe('cy.threshold.2x20');
    expect((await s.json('PUT', `/api/history/rides/${r.serverId}/feedback`, { feedback: 'hard' })).status).toBe(204);
    expect((await s.json<HistoryRide>('GET', `/api/history/rides/${r.serverId}`)).body.feedback).toBe('hard');
  });

  it('rattrape les mesures des sorties envoyées avant la migration', async () => {
    const s = await login('Ancien');
    const up = await s.json('POST', '/api/activities', sampleFit());
    await db.query('UPDATE activities SET aggregates_at = NULL, tss = NULL, np = NULL WHERE id = $1', [up.body.activity.id]);
    await db.query('DELETE FROM activity_power_curve WHERE activity_id = $1', [up.body.activity.id]);
    expect(await backfillTraining(ctx)).toBeGreaterThanOrEqual(1);
    const r = (await s.json<HistoryRide>('GET', `/api/history/rides/${up.body.activity.id}`)).body;
    expect(r.tss).toBeGreaterThan(0);
    expect(r.curve.length).toBeGreaterThan(5);
  });
});

describe('historique — synchronisation avec la base locale', () => {
  it('envoie, renvoie, met à jour sans doublon ; FC seulement avec consentement', async () => {
    const s = await login('Synchro');
    const t0 = Date.UTC(2026, 9, 1, 7);
    const req: HistorySyncRequest = {
      ...emptySync(),
      rides: [ride('ar-100', t0), ride('ar-101', t0 + 86_400_000, { tss: 60, kind: 'free', workoutId: null, workoutName: null })],
      ftp: [
        { clientId: 'ftp-1', recordedAt: t0 - 86_400_000, ftpWatts: 240, source: 'manual' },
        { clientId: 'ftp-2', recordedAt: t0 + 2 * 86_400_000, ftpWatts: 262, source: 'ramp', rideClientId: 'ar-101' },
      ],
      workouts: [{ id: 'custom.a', name: 'Ma séance', source: 'custom', type: 'threshold', steps: [{ kind: 'steady', mode: 'erg', durationS: 600, powerStart: 1, powerEnd: 1, powerUnit: 'ftp' }], updatedAt: t0 }],
      powerRecords: [
        [5, 900, t0 - 100 * 86_400_000],
        [60, 250, t0 - 100 * 86_400_000],
      ],
    };
    const r1 = await s.json<HistorySyncResponse>('POST', '/api/history/sync', req);
    expect(r1.status).toBe(200);
    expect(r1.body.mapped).toHaveLength(2);
    expect(r1.body.rides.map((r) => r.clientId).sort()).toEqual(['ar-100', 'ar-101']);
    expect(r1.body.rides[0]!.avgHr).toBeUndefined();
    expect(r1.body.ftp.map((f) => f.ftpWatts)).toEqual([240, 262]);
    expect(r1.body.ftp[1]!.rideClientId).toBe('ar-101');
    expect(r1.body.workouts).toHaveLength(1);
    // Records : 900 W importés gardés, 300 W sur 1 min de la sortie battent les 250 W.
    expect(r1.body.powerRecords.find(([d]) => d === 5)?.[1]).toBe(900);
    expect(r1.body.powerRecords.find(([d]) => d === 60)?.[1]).toBe(300);
    // La dernière FTP devient celle du profil.
    expect((await s.json('GET', '/api/me/profile')).body.ftpWatts).toBe(262);

    // Renvoi identique : aucun doublon (FTP comprises).
    const r2 = await s.json<HistorySyncResponse>('POST', '/api/history/sync', req);
    expect(r2.body.mapped.map((m) => m.serverId).sort()).toEqual(r1.body.mapped.map((m) => m.serverId).sort());
    expect((await s.json<HistoryRide[]>('GET', '/api/history/rides')).body).toHaveLength(2);
    expect((await s.json('GET', '/api/history/ftp')).body).toHaveLength(2);

    // Rien n'a changé depuis : réponse vide.
    const r3 = await s.json<HistorySyncResponse>('POST', '/api/history/sync', emptySync(Date.now() + 1000));
    expect(r3.body.rides).toHaveLength(0);

    // Avec consentement FC, la FC de la sortie est gardée (chiffrée).
    await s.json('PUT', '/api/me/profile', { consentHr: true });
    const r4 = await s.json<HistorySyncResponse>('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-100', t0, { name: 'Renommée' })] });
    const back = r4.body.rides.find((r) => r.clientId === 'ar-100')!;
    expect(back).toMatchObject({ name: 'Renommée', avgHr: 140, maxHr: 171 });
  });

  it('un FIT envoyé après la synchronisation remplace la sortie résumée', async () => {
    const s = await login('Fit après');
    const t0 = Date.UTC(2026, 9, 20, 9, 0, 0);
    await s.json('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-200', t0)] });
    const before = (await s.json<HistoryRide[]>('GET', '/api/history/rides')).body;
    expect(before[0]).toMatchObject({ hasFit: false, tss: 80 });
    expect((await s.json('GET', `/api/activities/${before[0]!.serverId}/fit`)).status).toBe(404);
    const up = await s.json('POST', '/api/activities?clientRideId=ar-200&ftp=250', sampleFit(t0));
    expect(up.status).toBe(201);
    expect(up.body.xpGained).toBeGreaterThan(0);
    const after = (await s.json<HistoryRide[]>('GET', '/api/history/rides')).body;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ clientId: 'ar-200', hasFit: true });
    expect(after[0]!.tss).not.toBe(80);
  });

  it('les suppressions se propagent aux autres appareils', async () => {
    const s = await login('Effaceur');
    const t0 = Date.UTC(2026, 9, 5, 7);
    const r1 = await s.json<HistorySyncResponse>('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-300', t0), ride('ar-301', t0 + 3600_000)] });
    const since = r1.body.serverTime;
    // Appareil A supprime ar-300 ; suppression par l'API pour ar-301.
    await s.json('POST', '/api/history/sync', { ...emptySync(since), deletedRides: ['ar-300'] });
    const id301 = r1.body.mapped.find((m) => m.clientId === 'ar-301')!.serverId;
    expect((await s.json('DELETE', `/api/history/rides/${id301}`)).status).toBe(204);
    // Appareil B, synchronisé avant : apprend les deux suppressions.
    const b = await s.json<HistorySyncResponse>('POST', '/api/history/sync', emptySync(since));
    expect(b.body.deletedRides.sort()).toEqual(['ar-300', 'ar-301']);
    expect((await s.json<HistoryRide[]>('GET', '/api/history/rides')).body).toHaveLength(0);
    // Renvoyer une sortie supprimée la recrée (l'appareil qui l'a encore la remet).
    await s.json('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-300', t0)] });
    expect((await s.json<HistoryRide[]>('GET', '/api/history/rides')).body).toHaveLength(1);
  });

  it('séances perso : dernière écriture gagnante, suppression propagée', async () => {
    const s = await login('Séances');
    const w = { id: 'custom.b', name: 'V1', source: 'custom', steps: [], updatedAt: 1000 } as const;
    await s.json('PUT', '/api/history/workouts/custom.b', w);
    await s.json('PUT', '/api/history/workouts/custom.b', { ...w, name: 'Ancienne', updatedAt: 500 });
    expect((await s.json('GET', '/api/history/workouts')).body[0].name).toBe('V1');
    await s.json('PUT', '/api/history/workouts/custom.b', { ...w, name: 'V2', updatedAt: 2000 });
    expect((await s.json('GET', '/api/history/workouts')).body[0].name).toBe('V2');
    expect((await s.json('DELETE', '/api/history/workouts/custom.b')).status).toBe(204);
    expect((await s.json('GET', '/api/history/workouts')).body).toHaveLength(0);
    const sync = await s.json<HistorySyncResponse>('POST', '/api/history/sync', emptySync());
    expect(sync.body.workouts[0]).toMatchObject({ id: 'custom.b', deleted: true });
  });

  it('refuse les envois invalides et sans compte', async () => {
    const anon = new Session();
    expect((await anon.json('POST', '/api/history/sync', emptySync())).status).toBe(401);
    const s = await login('Invalide');
    expect((await s.json('POST', '/api/history/sync', { ...emptySync(), rides: [ride('pas bon !', 0)] })).status).toBe(400);
  });
});

describe('historique — analyses', () => {
  it('charge, zones par semaine, records, totaux, FTP', async () => {
    const s = await login('Analyste');
    const day = 86_400_000;
    const now = Date.now();
    const rides = [0, 1, 2, 3, 4, 5, 6].map((i) => ride(`ar-${400 + i}`, now - (7 - i) * day, { tss: 100, utcOffsetMin: 0 }));
    await s.json('POST', '/api/history/sync', { ...emptySync(), rides });
    const load = (await s.json('GET', '/api/history/load?days=14&tz=0')).body as Array<{ date: string; tss: number; ctl: number; atl: number; tsb: number }>;
    expect(load).toHaveLength(14);
    expect(load.reduce((a, d) => a + d.tss, 0)).toBe(700);
    const last = load.at(-1)!;
    expect(last.atl).toBeGreaterThan(last.ctl);
    expect(last.tsb).toBeLessThan(0);
    const zones = (await s.json('GET', '/api/history/zones?weeks=4')).body as Array<{ week: string; zonesS: number[] }>;
    expect(zones.reduce((a, w) => a + w.zonesS[3]!, 0)).toBe(7 * 2100);
    const curve = (await s.json('GET', '/api/history/power-curve')).body as Array<{ durationS: number; watts: number }>;
    expect(curve.find((p) => p.durationS === 5)?.watts).toBe(450);
    const sum = (await s.json('GET', '/api/history/summary')).body;
    expect(sum.all.rides).toBe(7);
    expect(sum.week.tss).toBeGreaterThanOrEqual(600);
    const ftp = await s.json('POST', '/api/history/ftp', { recordedAt: now, ftpWatts: 271, source: '20min' });
    expect(ftp.status).toBe(201);
    expect((await s.json('GET', '/api/me/profile')).body.ftpWatts).toBe(271);
  });

  it('fil des amis : leurs sorties, sans puissance ni FC', async () => {
    const a = await login('Alice');
    const b = await login('Bob');
    const code = (await b.json('GET', '/api/friends')).body.code as string;
    const request = (await a.json('POST', '/api/friends/requests', { code })).body as { id: string; status: string };
    expect(request.status).toBe('pending');
    expect((await b.json('POST', `/api/friends/requests/${request.id}/accept`)).status).toBeLessThan(300);
    await b.json('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-500', Date.UTC(2026, 9, 10, 8))] });
    const feed = (await a.json('GET', '/api/history/friends')).body as Array<Record<string, unknown>>;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ name: 'Bob', distanceM: 32000, routeId: 'montmartre' });
    expect(feed[0]).not.toHaveProperty('np');
    expect(feed[0]).not.toHaveProperty('avgHr');
  });

  it('export et effacement du compte emportent l’historique', async () => {
    const s = await login('Partant');
    await s.json('POST', '/api/history/sync', { ...emptySync(), rides: [ride('ar-600', Date.UTC(2026, 9, 11))], ftp: [{ clientId: 'f', recordedAt: Date.UTC(2026, 9, 11), ftpWatts: 230, source: 'manual' }] });
    const exp = await s.json('GET', '/api/me/export');
    expect(exp.body.training.trainingRides).toHaveLength(1);
    expect(exp.body.training.ftpHistory).toHaveLength(1);
    const me = (await s.json('GET', '/api/me')).body.id as string;
    expect((await s.json('DELETE', '/api/me', { confirm: 'SUPPRIMER' })).status).toBe(204);
    for (const table of ['activities', 'ftp_history', 'power_records', 'workouts', 'deleted_rides']) {
      expect((await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = $1`, [me])).rows[0].n, table).toBe(0);
    }
  });
});
