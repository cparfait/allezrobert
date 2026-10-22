/**
 * Voix off (POST /api/tts) : synthèse Cartesia côté serveur — la clé ne quitte jamais le
 * serveur. Réponse MP3, mise en cache sur disque par empreinte (texte, langue, voix, modèle),
 * débit limité par adresse pour protéger le quota.
 */
import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError } from './middleware.ts';

const Body = z.object({ text: z.string().min(1).max(600), lang: z.enum(['fr', 'en']).default('fr') });

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2025-04-16';

export function ttsRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const hits = new Map<string, { n: number; t: number }>();

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

    const upstream = await fetch(CARTESIA_URL, {
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
    res.send(audio);
  });
  return r;
}
