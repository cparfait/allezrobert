/**
 * Enregistre une fois pour toutes la voix du coach du test FTP dans public/voice/coach/ (livrée avec le jeu :
 * aucun appel d'API pendant le test). Banque : src/audio/coachLines.ts.
 *
 *   pnpm --filter @allezrobert/client exec tsx scripts/bake-coach-voice.ts
 *
 * Appelle Cartesia directement avec la clé, le modèle et les voix de apps/server/.env (mêmes réglages que
 * POST /api/tts, donc même voix que le speaker et le tutoriel) ; le serveur n'a pas besoin de tourner.
 * À relancer après chaque modification de coachLines.ts ou des messages des tests FTP : seules les phrases
 * nouvelles ou modifiées sont synthétisées (nom de fichier = empreinte du texte), les fichiers orphelins
 * sont supprimés.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coachLines } from '../src/audio/coachLines.ts';

const envFile = resolve(import.meta.dirname, '../../server/.env');
const env: Record<string, string> = {};
if (existsSync(envFile))
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1] as string] = (m[2] as string).replace(/^["']|["']$/g, '');
  }
const get = (k: string, d = '') => process.env[k] ?? env[k] ?? d;
const key = get('CARTESIA_API_KEY');
if (!key) throw new Error('CARTESIA_API_KEY absente (apps/server/.env)');
// Valeurs par défaut identiques à apps/server/src/config.ts.
const model = get('CARTESIA_MODEL', 'sonic-3.6');
const voices = { fr: get('CARTESIA_VOICE_FR', '8f1e9d27-96ff-405e-9213-7432a784ac0b'), en: get('CARTESIA_VOICE_EN', 'a5136bf9-224c-4d76-b823-52bd5efcffcc') };

async function tts(text: string, lang: 'fr' | 'en'): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: model,
        transcript: text,
        voice: { mode: 'id', id: voices[lang] },
        language: lang,
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status !== 429 && r.status < 500) throw new Error(`${text} : ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
  }
  throw new Error(`${text} : Cartesia indisponible`);
}

const root = resolve(import.meta.dirname, '../public/voice/coach');
const index: Record<string, Record<string, string>> = {};
let made = 0;
for (const lang of ['fr', 'en'] as const) {
  mkdirSync(resolve(root, lang), { recursive: true });
  const table: Record<string, string> = (index[lang] = {});
  for (const [k, text] of Object.entries(coachLines(lang))) {
    const file = `${lang}/${k}-${createHash('sha256').update(`${model}|${voices[lang]}|${text}`).digest('hex').slice(0, 10)}.mp3`;
    table[k] = file;
    if (existsSync(resolve(root, file))) continue;
    writeFileSync(resolve(root, file), await tts(text, lang));
    made++;
    console.log(`coach/${file}  ${text}`);
  }
  const keep = new Set(Object.values(table));
  for (const f of readdirSync(resolve(root, lang))) if (!keep.has(`${lang}/${f}`)) rmSync(resolve(root, lang, f));
}
writeFileSync(resolve(root, 'coach.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${made} phrase(s) synthétisée(s), ${Object.values(index).reduce((n, t) => n + Object.keys(t).length, 0)} dans public/voice/coach/`);
