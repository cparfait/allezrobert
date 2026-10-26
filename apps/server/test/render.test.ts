/**
 * Vidéo résumé : repli FFmpeg (fond, textes, graphe de filtres), worker (moteurs, repli,
 * échec clair sans FFmpeg, pouls) et chaîne complète par l'API avec le worker intégré
 * (RENDER_INLINE, base pg-mem). Les rendus réels ne tournent que si FFmpeg est installé.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildActivity, encodeActivity } from '@allezrobert/fit';
import type { ActivityRecord } from '@allezrobert/shared';
import type { RenderJob } from '../src/db/repos.ts';
import { detectCapabilities, type RenderCapabilities } from '../src/render/capabilities.ts';
import { backgroundPpm, filterGraph, profileOf, summaryTexts, FALLBACK_H, FALLBACK_W } from '../src/render/ffmpeg-summary.ts';
import { readHeartbeat, RenderWorker, type RenderQueue } from '../src/render/worker.ts';
import { startServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ar-render-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function probe(file: string): { duration: number; width: number; height: number; codec: string } {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout) as { format: { duration: string }; streams: Array<{ width: number; height: number; codec_name: string }> };
  return { duration: Number(j.format.duration), width: j.streams[0]!.width, height: j.streams[0]!.height, codec: j.streams[0]!.codec_name };
}

const input = {
  lang: 'fr' as const,
  title: 'Sortie du dimanche',
  date: '2026-10-25T09:00:00Z',
  routeName: 'Boucle de Chevreuse',
  riderName: 'Robert',
  stats: { distanceKm: 42.3, durationS: 5520, elevationM: 612, avgPowerW: 205, npW: 221 },
  records: Array.from({ length: 2000 }, (_, i) => ({ altitudeM: 100 + 60 * Math.sin(i / 300) })),
};

class FakeQueue implements RenderQueue {
  jobs: RenderJob[] = [];
  done = new Map<string, { ok: boolean; out: string | null; error: string | null }>();
  add(composition: string, payload: Record<string, unknown>): RenderJob {
    const j: RenderJob = { id: `job-${this.jobs.length + 1}`, userId: 'u', status: 'queued', composition, payload, outputFile: null, error: null, attempts: 0, createdAt: new Date(), finishedAt: null };
    this.jobs.push(j);
    return j;
  }
  async claimRender() {
    return this.jobs.find((j) => j.status === 'queued' && (j.status = 'running')) ?? null;
  }
  async finishRender(id: string, ok: boolean, out: string | null, error: string | null) {
    this.done.set(id, { ok, out, error });
  }
  async requeueStaleRenders() {}
}

const caps = (over: Partial<RenderCapabilities>): RenderCapabilities => ({ ffmpeg: 'ffmpeg', ffmpegVersion: 'x', drawtext: true, libx264: true, hyperframesCli: false, chrome: false, engine: 'ffmpeg', ...over });

describe('vidéo résumé de repli (FFmpeg seul)', () => {
  it('fond PPM aux bonnes dimensions, profil tiré des enregistrements', () => {
    const prof = profileOf(input);
    expect(prof.length).toBe(1100);
    const ppm = backgroundPpm(prof);
    const header = `P6\n${FALLBACK_W} ${FALLBACK_H}\n255\n`;
    expect(ppm.subarray(0, header.length).toString('ascii')).toBe(header);
    expect(ppm.length).toBe(header.length + FALLBACK_W * FALLBACK_H * 3);
    expect(profileOf({ records: [] })).toEqual([]);
  });

  it('textes en français, statistiques échelonnées, graphe de filtres', () => {
    const texts = summaryTexts(input);
    const all = texts.map((t) => t.text);
    expect(all).toContain('Sortie du dimanche');
    expect(all).toContain('42,3 km');
    expect(all).toContain('1 h 32');
    expect(all).toContain('612 m');
    expect(all.some((t) => t.includes('Boucle de Chevreuse · 25 octobre 2026'))).toBe(true);
    const at = texts.filter((t) => t.size === 44).map((t) => t.at);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const g = filterGraph(texts, texts.map((_, i) => `/tmp/t${i}.txt`), { drawtext: true });
    expect(g.startsWith('color=c=0x0e1424')).toBe(true);
    expect(g).toContain("[0:v][cache]overlay=x='90+1104*min(max((t-2.5)/5\\,0)\\,1)'");
    expect(g.match(/drawtext=/g)?.length).toBe(texts.length);
    expect(g.endsWith('format=yuv420p[v]')).toBe(true);
    // Sans drawtext : la vidéo garde le profil animé, sans texte.
    expect(filterGraph(texts, [], { drawtext: false })).not.toContain('drawtext');
  });

  it('photos du sommet : une diapositive par photo, enchaînées après le résumé', () => {
    const g = filterGraph([], [], { drawtext: false }, 2);
    expect(g).toContain('[1:v]scale=');
    expect(g).toContain('[2:v]scale=');
    expect(g).toContain('[m][p0][p1]concat=n=3:v=1:a=0[v]');
    expect(filterGraph([], [], { drawtext: false }, 0).endsWith('[v]')).toBe(true);
  });
});

describe('worker de rendu', () => {
  it('sans FFmpeg : échec clair, pouls « aucun moteur »', async () => {
    const q = new FakeQueue();
    const dir = path.join(tmp, 'none');
    const w = new RenderWorker({ queue: q, rendersDir: dir, projectDir: tmp, capabilities: caps({ ffmpeg: null, engine: null }), log: () => {} });
    await w.init();
    const j = q.add('summary', { input });
    expect(await w.tick()).toBe(true);
    expect(q.done.get(j.id)).toMatchObject({ ok: false });
    expect(q.done.get(j.id)!.error).toMatch(/ffmpeg absent/);
    expect(await w.tick()).toBe(false);
    const hb = await readHeartbeat(dir);
    expect(hb.available).toBe(false);
    expect(hb.heartbeat?.engine).toBeNull();
    expect((await readHeartbeat(path.join(tmp, 'absent'))).available).toBe(false);
  });

  it('séquence autre que le résumé sans HyperFrames : refusée avec explication', async () => {
    const q = new FakeQueue();
    const w = new RenderWorker({ queue: q, rendersDir: path.join(tmp, 'seq'), projectDir: tmp, capabilities: caps({}), log: () => {} });
    const j = q.add('podium', { variables: {} });
    await w.tick();
    expect(q.done.get(j.id)!.error).toMatch(/nécessite HyperFrames/);
  });

  it.runIf(hasFfmpeg)('HyperFrames en échec → repli FFmpeg : MP4 H.264 de 12 s en 1280×720', async () => {
    const q = new FakeQueue();
    const dir = path.join(tmp, 'fallback');
    const real = await detectCapabilities(tmp);
    const w = new RenderWorker({
      queue: q,
      rendersDir: dir,
      projectDir: tmp,
      capabilities: { ...real, engine: 'hyperframes' },
      hyperframes: async () => {
        throw new Error('Chromium introuvable');
      },
      log: () => {},
    });
    await w.init();
    const j = q.add('summary', { lang: 'fr', input });
    await w.tick();
    expect(q.done.get(j.id)).toEqual({ ok: true, out: `${j.id}.mp4`, error: null });
    const info = probe(path.join(dir, `${j.id}.mp4`));
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
    expect(info.duration).toBeGreaterThan(11.5);
    expect(info.duration).toBeLessThan(12.5);
    expect(info.codec).toBe(real.libx264 ? 'h264' : 'mpeg4');
    expect((await readHeartbeat(dir)).available).toBe(true);
  }, 120_000);
});

describe('chaîne complète : API + worker intégré (RENDER_INLINE)', () => {
  it.runIf(hasFfmpeg)('sortie enregistrée → POST /renders → MP4 servi', async () => {
    // Projet de séquences absent : moteur « ffmpeg » (repli), rapide et sans Chromium.
    const prev = process.env.RENDER_PROJECT_DIR;
    process.env.RENDER_PROJECT_DIR = path.join(tmp, 'pas-de-sequences');
    const srv = await startServer({
      config: testConfig({ DEV_LOGIN: 'true', RENDER_INLINE: 'true', RENDERS_DIR: path.join(tmp, 'api'), LOG_LEVEL: 'warn' }),
      port: 0,
      noSignals: true,
    });
    if (prev === undefined) delete process.env.RENDER_PROJECT_DIR;
    else process.env.RENDER_PROJECT_DIR = prev;
    try {
      const base = `http://127.0.0.1:${srv.port}/api`;
      const login = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Robert' }) });
      const token = ((await login.json()) as { sessionToken: string }).sessionToken;
      const auth = { authorization: `Bearer ${token}` };
      const t0 = Date.UTC(2026, 9, 25, 9);
      const records: ActivityRecord[] = Array.from({ length: 900 }, (_, i) => ({ t: t0 + i * 1000, distanceM: i * 9, speedMs: 9, altitudeM: 100 + i * 0.1, watts: 210, cadence: 90 }));
      const fit = encodeActivity(buildActivity({ id: 'r', name: 'Sortie', riderMassKg: 75 }, records));
      const up = await fetch(`${base}/activities?name=Sortie%20test`, { method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: Buffer.from(fit) });
      expect(up.status).toBe(201);
      const activityId = ((await up.json()) as { activity: { id: string } }).activity.id;
      // Pouls du worker : disponible, moteur de repli.
      let capsRes = { available: false, engine: null as string | null };
      for (let i = 0; i < 50 && !capsRes.available; i++) {
        capsRes = (await (await fetch(`${base}/renders/capabilities`)).json()) as typeof capsRes;
        if (!capsRes.available) await new Promise((r) => setTimeout(r, 100));
      }
      expect(capsRes).toMatchObject({ available: true, engine: 'ffmpeg', inline: true });
      const post = await fetch(`${base}/renders`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ composition: 'summary', activityId }) });
      expect(post.status).toBe(202);
      const { id } = (await post.json()) as { id: string };
      let job = { status: 'queued', fileUrl: null as string | null, error: null as string | null };
      for (let i = 0; i < 300 && (job.status === 'queued' || job.status === 'running'); i++) {
        await new Promise((r) => setTimeout(r, 200));
        job = (await (await fetch(`${base}/renders/${id}`, { headers: auth })).json()) as typeof job;
      }
      expect(job).toMatchObject({ status: 'done', error: null, fileUrl: `/api/renders/${id}/file` });
      const file = await fetch(`${base}/renders/${id}/file`, { headers: auth });
      expect(file.headers.get('content-type')).toBe('video/mp4');
      const bytes = Buffer.from(await file.arrayBuffer());
      expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
      expect(readFileSync(path.join(tmp, 'api', `${id}.mp4`)).length).toBe(bytes.length);
      // Fichier d'un autre compte : introuvable.
      expect((await fetch(`${base}/renders/${id}/file`)).status).toBe(401);
    } finally {
      await srv.stop();
    }
  }, 120_000);
});
