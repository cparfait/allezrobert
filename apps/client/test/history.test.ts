/**
 * Historique local : mêmes tests pour la base SQLite (node:sqlite à la place de Tauri) et le
 * stockage du navigateur — sorties, courbes, filtres, records, FTP, séances, import des anciennes
 * données, et ce qui reste à synchroniser.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { BrowserHistoryStore, HistoryService, SqliteHistoryStore, loadSeries, periodCurve, weeklyZones, rideClientId } from '../src/data/history/index.ts';
import type { SqlDriver, SqlValue } from '../src/data/history/sqliteStore.ts';
import type { HistoryStore } from '../src/data/history/types.ts';

/** Pilote SQL sur node:sqlite, même contrat que les commandes localdb.rs. */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const run = (sql: string, params: SqlValue[] = []) => {
    if (params.length === 0 && sql.includes(';')) {
      db.exec(sql);
      return { changes: 0 };
    }
    const r = db.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  };
  return {
    execute: async (sql, params) => run(sql, params),
    query: async (sql, params = []) => db.prepare(sql).all(...params) as Array<Record<string, SqlValue>>,
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        for (const s of statements) run(s.sql, s.params);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function memoryKv(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const backends: Array<[string, () => HistoryStore]> = [
  ['SQLite', () => new SqliteHistoryStore(nodeDriver())],
  ['navigateur', () => new BrowserHistoryStore(memoryKv())],
];

/** 20 min à 250 W puis 10 min à 150 W. */
const samples = [...Array.from({ length: 1200 }, () => ({ watts: 250, hr: 150, cadence: 92 })), ...Array.from({ length: 600 }, () => ({ watts: 150, hr: 125, cadence: 85 }))];

function input(startT: number, extra: Partial<Parameters<HistoryService['recordRide']>[0]> = {}) {
  return { startT, name: 'Boucle', routeId: 'montmartre', kind: 'workout' as const, workoutId: 'cy.threshold.2x20', workoutName: 'Seuil', durationS: 1850, movingS: 1800, distanceM: 15000, elevationM: 80, ftpWatts: 250, samples, ...extra };
}

describe.each(backends)('historique local (%s)', (_name, make) => {
  it('enregistre une sortie avec ses mesures, la relit, la remplace si reprise', async () => {
    const h = new HistoryService(make(), null, null);
    const t0 = Date.UTC(2026, 9, 20, 8);
    const r = await h.recordRide(input(t0));
    expect(r.clientId).toBe(rideClientId(t0));
    expect(r.np).toBeGreaterThan(220);
    expect(r.tss).toBeGreaterThan(30);
    expect(r.zonesS[3]).toBe(1200);
    expect(r.avgHr).toBeCloseTo((1200 * 150 + 600 * 125) / 1800, 6);
    expect(r.curve.find(([d]) => d === 1200)?.[1]).toBe(250);
    const back = (await h.rides())[0]!;
    expect(back).toMatchObject({ clientId: r.clientId, kind: 'workout', workoutName: 'Seuil', distanceM: 15000 });
    expect(back.curve).toEqual(r.curve);
    expect(back.zonesS).toEqual(r.zonesS);
    // Sortie reprise puis terminée : même identifiant, une seule ligne.
    await h.recordRide(input(t0, { distanceM: 20000 }));
    expect(await h.countRides()).toBe(1);
    expect((await h.rides())[0]!.distanceM).toBe(20000);
  });

  it('filtres, pagination, ressenti, suppression', async () => {
    const h = new HistoryService(make(), null, null);
    const day = 86_400_000;
    for (let i = 0; i < 5; i++) await h.recordRide(input(Date.UTC(2026, 9, 1) + i * day, { kind: i % 2 ? 'free' : 'workout', routeId: i < 2 ? 'a' : 'b' }));
    expect((await h.rides({ limit: 2 })).map((r) => r.startedAt)).toEqual([Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 4)]);
    expect(await h.countRides({ kind: 'free' })).toBe(2);
    expect(await h.countRides({ routeId: 'a' })).toBe(2);
    expect(await h.countRides({ from: Date.UTC(2026, 9, 3) })).toBe(3);
    const id = rideClientId(Date.UTC(2026, 9, 2));
    await h.updateRide(id, { feedback: 'hard' });
    expect((await h.store.getRide(id))!.feedback).toBe('hard');
    await h.deleteRide(id);
    expect(await h.countRides()).toBe(4);
  });

  it('records de puissance, FTP, séances perso', async () => {
    const h = new HistoryService(make(), null, null);
    await h.recordRide(input(Date.UTC(2026, 9, 1)));
    await h.recordRide(input(Date.UTC(2026, 9, 2), { samples: Array.from({ length: 300 }, () => ({ watts: 400 })) }));
    const rec = new Map((await h.powerRecords()).map(([d, w]) => [d, w]));
    expect(rec.get(60)).toBe(400);
    expect(rec.get(1200)).toBe(250);
    await h.addFtp(260, 'ramp', Date.UTC(2026, 9, 2));
    await h.addFtp(260, 'manual');
    await h.addFtp(270, 'manual');
    expect((await h.ftpHistory()).map((f) => [f.ftpWatts, f.source])).toEqual([
      [260, 'ramp'],
      [270, 'manual'],
    ]);
    await h.saveWorkout({ id: 'zwo.a', name: 'Importée', source: 'zwo', type: null, description: null, steps: [{ kind: 'steady' }], deleted: false });
    expect(await h.workouts()).toHaveLength(1);
    await h.deleteWorkout('zwo.a');
    expect(await h.workouts()).toHaveLength(0);
  });

  it('importe une fois les 20 dernières sorties et les records de l’ancien stockage', async () => {
    const legacy = memoryKv({
      'ar.history': JSON.stringify([{ routeId: 'montmartre', date: Date.UTC(2026, 8, 1, 9), distanceM: 20000, movingS: 2400, avgSpeedKmh: 30, avgWatts: 180, np: 200 }]),
      'ar.powerRecords': JSON.stringify({ 5: 800, 60: 380 }),
    });
    const store = make();
    const h = new HistoryService(store, null, legacy);
    await h.ready(250);
    const rides = await h.rides();
    expect(rides).toHaveLength(1);
    expect(rides[0]!.intensity).toBeCloseTo(0.8, 6);
    expect(rides[0]!.tss).toBeCloseTo((2400 * 200 * 0.8) / (250 * 3600) * 100, 6);
    expect(new Map((await h.powerRecords()).map(([d, w]) => [d, w])).get(5)).toBe(800);
    expect((await h.ftpHistory())[0]).toMatchObject({ ftpWatts: 250, source: 'import' });
    // Deuxième ouverture : pas de second import.
    const again = new HistoryService(store, null, legacy);
    await again.ready(250);
    expect(await again.countRides()).toBe(1);
  });

  it('ce qui reste à synchroniser, par compte', async () => {
    const store = make();
    const h = new HistoryService(store, null, null);
    await h.recordRide(input(Date.UTC(2026, 9, 1))); // sans compte
    h.setAccount('u1');
    await h.recordRide(input(Date.UTC(2026, 9, 2)));
    h.setAccount('u2');
    await h.recordRide(input(Date.UTC(2026, 9, 3)));
    const p1 = await store.pending('u1');
    expect(p1.rides.map((r) => r.startedAt)).toEqual([Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)]);
    expect(p1.powerRecords.length).toBeGreaterThan(0);
    await store.markSynced('u1', p1, [{ clientId: rideClientId(Date.UTC(2026, 9, 1)), serverId: 's1' }], Date.now());
    expect((await store.pending('u1')).rides).toHaveLength(0);
    // La sortie jouée sans compte appartient maintenant à u1 : u2 ne la reprend pas.
    expect((await store.pending('u2')).rides.map((r) => r.startedAt)).toEqual([Date.UTC(2026, 9, 3)]);
    expect((await store.getRide(rideClientId(Date.UTC(2026, 9, 1))))!).toMatchObject({ account: 'u1', serverId: 's1' });
    // Une modification après l'envoi est à renvoyer.
    h.setAccount('u1');
    await h.updateRide(rideClientId(Date.UTC(2026, 9, 2)), { name: 'Renommée' });
    expect((await store.pending('u1')).rides.map((r) => r.name)).toEqual(['Renommée']);
  });
});

describe('analyses locales', () => {
  it('charge, zones par semaine, meilleures moyennes', async () => {
    const h = new HistoryService(new BrowserHistoryStore(memoryKv()), null, null);
    const now = Date.now();
    for (let i = 1; i <= 3; i++) await h.recordRide(input(now - i * 86_400_000));
    const rides = await h.rides();
    const load = loadSeries(rides, 7, now);
    expect(load).toHaveLength(7);
    expect(load.reduce((a, d) => a + d.tss, 0)).toBeCloseTo(rides.reduce((a, r) => a + r.tss!, 0), 6);
    const zones = weeklyZones(rides, 2, now);
    expect(zones).toHaveLength(2);
    expect(zones.reduce((a, w) => a + w.zonesS[3]!, 0)).toBe(3 * 1200);
    expect(periodCurve(rides).find(([d]) => d === 1200)?.[1]).toBe(250);
  });
});

describe('résumé en mémoire (compteur de km, fiche des parcours)', () => {
  it('tout l’historique, sans limite, mis à jour à chaque sortie et suppression', async () => {
    const h = new HistoryService(new BrowserHistoryStore(memoryKv()), null, null);
    await h.ready();
    let calls = 0;
    const off = h.subscribe(() => calls++);
    for (let i = 0; i < 30; i++) await h.recordRide(input(Date.UTC(2026, 8, 1) + i * 86_400_000, { routeId: i % 3 ? 'a' : 'b', distanceM: 10000, samples: samples.slice(0, 120) }));
    await h.ready();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.summary!.totals.rides).toBe(30);
    expect(h.summary!.totals.distanceM).toBe(300000);
    expect(h.summary!.byRoute.get('b')!.count).toBe(10);
    expect(h.summary!.byRoute.get('a')!.last.startedAt).toBe(Date.UTC(2026, 8, 1) + 29 * 86_400_000);
    await h.deleteRide(rideClientId(Date.UTC(2026, 8, 1)));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.summary!.totals.rides).toBe(29);
    expect(calls).toBeGreaterThan(0);
    off();
  });
});

describe('type d’entraînement', () => {
  it('celui de la séance, sinon estimé ; filtre ; rattrapage des anciennes sorties', async () => {
    const store = new BrowserHistoryStore(memoryKv());
    const h = new HistoryService(store, null, null);
    await h.recordRide(input(Date.UTC(2026, 9, 1), { workoutId: 'cy.vo2max.5x4' }));
    await h.recordRide(input(Date.UTC(2026, 9, 2), { kind: 'free', workoutId: null, samples: Array.from({ length: 3600 }, () => ({ watts: 160 })) }));
    const [free, vo2] = await h.rides();
    expect(vo2!.trainingType).toBe('vo2max');
    expect(free!.trainingType).toBe('endurance');
    expect(await h.countRides({ trainingType: 'vo2max' })).toBe(1);
    // Sortie gardée avant l'apparition du type : complétée à l'ouverture suivante.
    await store.putRide({ ...free!, clientId: 'ar-old', trainingType: null, startedAt: 1 });
    await store.setMeta('trainingTypesFilled', '');
    const again = new HistoryService(store, null, null);
    await again.ready();
    expect((await store.getRide('ar-old'))!.trainingType).toBe('endurance');
  });
});
