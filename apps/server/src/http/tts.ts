/**
 * Voix off (POST /api/tts) : synthèse Cartesia côté serveur — la clé ne quitte jamais le
 * serveur. Réponse MP3, mise en cache sur disque par empreinte (texte, langue, voix, modèle),
 * débit limité par adresse et plafond journalier global pour protéger le quota ; cache borné en taille.
 */
import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError } from './middleware.ts';

const Body = z.object({ text: z.string().min(1).max(600), lang: z.enum(['fr', 'en']).default('fr') });

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2025-04-16';

/** Supprime les fichiers les plus anciens tant que le cache dépasse `maxBytes`. Renvoie le nombre de fichiers supprimés. */
export async function pruneTtsCache(dir: string, maxBytes: number): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.mp3'));
  } catch {
    return 0;
  }
  const files: Array<{ file: string; size: number; t: number }> = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const st = await stat(file).catch(() => null);
    if (st) files.push({ file, size: st.size, t: st.mtimeMs });
  }
  let total = files.reduce((a, f) => a + f.size, 0);
  if (total <= maxBytes) return 0;
  files.sort((a, b) => a.t - b.t);
  let removed = 0;
  for (const f of files) {
    if (total <= maxBytes) break;
    await unlink(f.file).catch(() => undefined);
    total -= f.size;
    removed++;
  }
  return removed;
}

export function ttsRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const hits = new Map<string, { n: number; t: number }>();
  /** Nouvelles synthèses du jour (UTC), tous visiteurs confondus. */
  const day = { key: '', n: 0 };
  let written = 0;
  // Purge des adresses dont la fenêtre d'une minute est passée (la table ne grossit plus sans fin).
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.t >= 60_000) hits.delete(k);
  }, 5 * 60_000);
  sweep.unref();
  const prune = (): void => {
    void pruneTtsCache(path.resolve(ctx.config.TTS_CACHE_DIR), ctx.config.TTS_CACHE_MAX_MB * 1024 * 1024)
      .then((n) => n && ctx.log('info', `cache de synthèse vocale : ${n} fichier(s) ancien(s) supprimé(s)`))
      .catch((e) => ctx.log('warn', `cache de synthèse vocale : ${(e as Error).message}`));
  };

  r.post('/', async (req, res) => {
    const cfg = ctx.config;
    if (!cfg.CARTESIA_API_KEY) throw new HttpError(503, 'Synthèse vocale non configurée', 'tts_unavailable');
    const { text, lang } = Body.parse(req.body);
    const voice = lang === 'fr' ? cfg.CARTESIA_VOICE_FR : cfg.CARTESIA_VOICE_EN;
    const key = createHash('sha256').update(`${cfg.CARTESIA_MODEL}|${voice}|${lang}|${text}`).digest('hex').slice(0, 32);
    const file = path.resolve(cfg.TTS_CACHE_DIR, `${key}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (existsSync(file)) {
      res.send(await readFile(file));
      return;
    }
    // Limite : 30 nouvelles synthèses par minute et par adresse (le cache, lui, est illimité).
    const ip = req.ip ?? 'local';
    const now = Date.now();
    const h = hits.get(ip);
    if (h && now - h.t < 60_000) {
      if (++h.n > 30) throw new HttpError(429, 'Trop de demandes de synthèse vocale', 'rate_limited');
    } else hits.set(ip, { n: 1, t: now });
    // Plafond du jour, tous visiteurs confondus : la route est ouverte (le tutoriel se joue sans compte).
    const today = new Date(now).toISOString().slice(0, 10);
    if (day.key !== today) {
      day.key = today;
      day.n = 0;
    }
    if (day.n >= cfg.TTS_DAILY_LIMIT) {
      res.removeHeader('Cache-Control');
      throw new HttpError(429, 'Synthèse vocale momentanément indisponible', 'tts_daily_limit');
    }
    day.n++;

    const upstream = await ctx.fetchFn(CARTESIA_URL, {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      headers: { 'X-API-Key': cfg.CARTESIA_API_KEY, 'Cartesia-Version': CARTESIA_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: cfg.CARTESIA_MODEL,
        transcript: text,
        voice: { mode: 'id', id: voice },
        language: lang,
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 200);
      ctx.log('warn', `Cartesia ${upstream.status} : ${detail}`);
      throw new HttpError(502, 'Synthèse vocale indisponible', 'tts_upstream');
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, audio);
    // Borne du cache : contrôlée à la première écriture puis toutes les 50.
    if (written++ % 50 === 0) prune();
    res.send(audio);
  });
  return r;
}
