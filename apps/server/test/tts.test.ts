/**
 * Synthèse vocale (POST /api/tts) : cache disque, plafond journalier global, délai maximal de
 * l'appel sortant, borne de taille du cache.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testConfig } from '../src/config.ts';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { createContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';
import { mountApi } from '../src/http/api.ts';
import { pruneTtsCache } from '../src/http/tts.ts';

let db: Db;
let server: Server;
let base: string;
let dir: string;
const calls: Array<{ signal: boolean }> = [];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ar-tts-'));
  db = await createDb('memory');
  await migrate(db);
  const fetchFn: typeof fetch = async (_input, init) => {
    calls.push({ signal: init?.signal instanceof AbortSignal });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  };
  const config = testConfig({ CARTESIA_API_KEY: 'cle-de-test', TTS_CACHE_DIR: dir, TTS_DAILY_LIMIT: '2' });
  const ctx = createContext(config, db, await RouteStore.load(config.ROUTES_DIR), { fetchFn, log: () => undefined });
  const app = express();
  mountApi(app, ctx);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

const say = (text: string) => fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });

describe('synthèse vocale', () => {
  it('cache, délai maximal de l’appel sortant et plafond journalier global', async () => {
    const a = await say('Bonjour');
    expect(a.status).toBe(200);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBe(true);
    // Même phrase : servie du cache, sans appel ni décompte.
    expect((await say('Bonjour')).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect((await say('Deuxième phrase')).status).toBe(200);
    // Plafond du jour atteint (2) : refus sans appel au service, mais le cache répond toujours.
    const over = await say('Troisième phrase');
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('tts_daily_limit');
    expect(calls).toHaveLength(2);
    expect((await say('Bonjour')).status).toBe(200);
  });

  it('borne du cache : les fichiers les plus anciens partent d’abord', async () => {
    const d = await mkdtemp(path.join(tmpdir(), 'ar-tts-prune-'));
    try {
      for (const [i, name] of ['vieux.mp3', 'moyen.mp3', 'recent.mp3'].entries()) {
        const f = path.join(d, name);
        await writeFile(f, Buffer.alloc(1000));
        const t = new Date(Date.now() - (3 - i) * 3600_000);
        await utimes(f, t, t);
      }
      await writeFile(path.join(d, 'autre.txt'), 'x');
      expect(await pruneTtsCache(d, 5000)).toBe(0);
      expect(await pruneTtsCache(d, 1500)).toBe(2);
      expect((await readdir(d)).sort()).toEqual(['autre.txt', 'recent.mp3']);
      expect(await pruneTtsCache(path.join(d, 'absent'), 10)).toBe(0);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});
