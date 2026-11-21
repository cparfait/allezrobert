/**
 * Décodage des FIT hors du fil principal : protocole du pool avec un faux worker (réponse, erreur FIT,
 * délai dépassé, worker réutilisé) et repli sur place quand le worker ne peut pas démarrer, cas de vitest.
 */
import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { buildActivity, encodeActivity } from '@allezrobert/fit';
import { decodeFit, FitImportError } from '../src/activities/fit-import.ts';
import { closeFitWorker, decodeFitOffThread, FitDecodePool, type FitWorkerReply, type FitWorkerRequest } from '../src/fit/decode-pool.ts';

function sampleFit(n = 120): Uint8Array {
  const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);
  const records = Array.from({ length: n }, (_, i) => ({ t: t0 + i * 1000, distanceM: i * 8, speedMs: 8, altitudeM: 100, watts: 200, cadence: 90 }));
  return encodeActivity(buildActivity({ id: 'test', name: 'Test', riderMassKg: 75 }, records));
}

/** Faux worker : `handle` décide de la réponse à chaque demande (undefined : silence). */
class FakeWorker extends EventEmitter {
  posted: FitWorkerRequest[] = [];
  terminated = false;
  constructor(private readonly handle: (m: FitWorkerRequest) => FitWorkerReply | undefined) {
    super();
  }
  postMessage(m: FitWorkerRequest): void {
    this.posted.push(m);
    const reply = this.handle(m);
    if (reply) queueMicrotask(() => this.emit('message', reply));
  }
  unref(): void {}
  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

const asWorker = (w: FakeWorker): Worker => w as unknown as Worker;
const decodeReply = (m: FitWorkerRequest): FitWorkerReply => {
  try {
    return { id: m.id, ok: true, result: m.name === undefined ? decodeFit(m.bytes) : decodeFit(m.bytes, m.name) };
  } catch (e) {
    return { id: m.id, ok: false, fit: e instanceof FitImportError, message: (e as Error).message };
  }
};

describe('FitDecodePool', () => {
  it('décode par le worker, le réutilise, et rend une FitImportError pour un fichier invalide', async () => {
    const fit = sampleFit();
    let spawned = 0;
    const w = new FakeWorker(decodeReply);
    const logs: string[] = [];
    const pool = new FitDecodePool({ spawn: () => (spawned++, asWorker(w)), log: (m) => logs.push(m) });
    const [a, b] = await Promise.all([pool.decode(fit, 'Matin'), pool.decode(fit)]);
    expect(a.activity.name).toBe('Matin');
    expect(a).toEqual(decodeFit(fit, 'Matin'));
    expect(b.activity.records.length).toBe(120);
    await expect(pool.decode(new Uint8Array(40))).rejects.toBeInstanceOf(FitImportError);
    expect(spawned).toBe(1);
    expect(w.posted.length).toBe(3);
    expect(pool.offThread).toBe(true);
    expect(logs).toEqual([]);
    await pool.close();
    expect(w.terminated).toBe(true);
  });

  it('se replie sur place, une seule ligne de journal, quand le worker ne démarre pas', async () => {
    const fit = sampleFit();
    const logs: string[] = [];
    let spawned = 0;
    const pool = new FitDecodePool({
      spawn: () => {
        spawned++;
        throw new Error('extension .ts inconnue');
      },
      log: (m) => logs.push(m),
    });
    expect((await pool.decode(fit)).activity.records.length).toBe(120);
    expect((await pool.decode(fit)).activity.records.length).toBe(120);
    await expect(pool.decode(new Uint8Array(40))).rejects.toBeInstanceOf(FitImportError);
    expect(spawned).toBe(1);
    expect(pool.offThread).toBe(false);
    expect(logs).toHaveLength(1);
  });

  it('se replie quand le worker tombe avant sa première réponse : la demande en cours n’est pas perdue', async () => {
    const fit = sampleFit();
    const logs: string[] = [];
    const w = new FakeWorker(() => undefined);
    const pool = new FitDecodePool({ spawn: () => asWorker(w), log: (m) => logs.push(m) });
    const p = pool.decode(fit, 'Soir');
    w.emit('error', new Error('Unknown file extension ".ts"'));
    w.emit('exit', 1);
    expect((await p).activity.name).toBe('Soir');
    expect(pool.offThread).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Unknown file extension');
  });

  it('un worker qui a déjà servi puis tombe est relancé à la demande suivante, sans repli définitif', async () => {
    const fit = sampleFit();
    const made: FakeWorker[] = [];
    const logs: string[] = [];
    const pool = new FitDecodePool({ spawn: () => (made.push(new FakeWorker(decodeReply)), asWorker(made.at(-1) as FakeWorker)), log: (m) => logs.push(m) });
    await pool.decode(fit);
    (made[0] as FakeWorker).emit('exit', 1);
    expect(pool.offThread).toBe(true);
    expect((await pool.decode(fit)).activity.records.length).toBe(120);
    expect(made.length).toBe(2);
    expect(logs).toEqual([]);
    await pool.close();
  });

  it('délai dépassé : le worker est arrêté et la demande échoue, les suivantes repartent', async () => {
    const fit = sampleFit();
    const made: FakeWorker[] = [];
    let mute = true;
    const pool = new FitDecodePool({
      spawn: () => (made.push(new FakeWorker((m) => (mute ? undefined : decodeReply(m)))), asWorker(made.at(-1) as FakeWorker)),
      log: () => undefined,
      timeoutMs: 30,
    });
    await expect(pool.decode(fit)).rejects.toThrow(/trop long/);
    expect((made[0] as FakeWorker).terminated).toBe(true);
    mute = false;
    expect((await pool.decode(fit)).activity.records.length).toBe(120);
    await pool.close();
  });

  it('pool partagé : même résultat que le décodage direct (worker ou repli selon le runtime)', async () => {
    const fit = sampleFit();
    expect(await decodeFitOffThread(fit, 'Partagé')).toEqual(decodeFit(fit, 'Partagé'));
    await expect(decodeFitOffThread(new Uint8Array(40))).rejects.toBeInstanceOf(FitImportError);
    await closeFitWorker();
  });
});
