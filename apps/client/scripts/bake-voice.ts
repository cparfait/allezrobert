/**
 * Génère une fois pour toutes l'audio de la voix off du tutoriel dans public/voice/ (livré avec le
 * jeu, donc aussi dans l'application Windows) : plus besoin du serveur pour entendre la voix.
 *
 * Passe par POST /api/tts du serveur local (qui garde la clé Cartesia et son cache disque) :
 *   pnpm dev:server                                  (dans un autre terminal)
 *   pnpm --filter @allezrobert/client voice          (AR_API=http://… pour un autre serveur)
 *
 * À relancer après chaque modification de src/onboarding/script.ts : seules les répliques nouvelles ou
 * modifiées sont synthétisées. Les fichiers qui ne
 * correspondent plus à aucune réplique sont supprimés.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ONBOARDING_SCRIPT, spoken } from '../src/onboarding/script.ts';
import { announcerLines } from '../src/audio/announcerLines.ts';

const api = (process.env.AR_API ?? 'http://localhost:2567').replace(/\/$/, '');
const root = resolve(import.meta.dirname, '../public/voice');
const index: Record<string, string> = {};

for (const lang of ['fr', 'en'] as const) {
  mkdirSync(resolve(root, lang), { recursive: true });
  for (const [key, lines] of Object.entries(ONBOARDING_SCRIPT)) {
    for (const line of lines) {
      const text = spoken(line[lang], lang);
      const file = `${lang}/${key}-${createHash('sha256').update(text).digest('hex').slice(0, 10)}.mp3`;
      index[`${lang}|${text}`] = file;
      // Réplique déjà générée (nom = empreinte du texte) : rien à refaire.
      if (existsSync(resolve(root, file))) continue;
      writeFileSync(resolve(root, file), await tts(text, lang));
      console.log(file);
    }
  }
}

/** Synthèse par le serveur local ; patiente quand la limite de débit (30 par minute) est atteinte. */
async function tts(text: string, lang: 'fr' | 'en'): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${api}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status !== 429) throw new Error(`${text} : ${r.status} ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 62_000));
  }
  throw new Error(`${text} : limite de débit`);
}

// Voix de course (temps, records, speaker, cris du public) : public/voice/announcer/<langue>/<clé>-<empreinte>.mp3,
// table announcer.json (langue → clé → fichier).
const annRoot = resolve(root, 'announcer');
const annIndex: Record<string, Record<string, string>> = {};
for (const lang of ['fr', 'en'] as const) {
  mkdirSync(resolve(annRoot, lang), { recursive: true });
  annIndex[lang] = {};
  for (const [key, text] of Object.entries(announcerLines(lang))) {
    const file = `${lang}/${key}-${createHash('sha256').update(text).digest('hex').slice(0, 10)}.mp3`;
    (annIndex[lang] as Record<string, string>)[key] = file;
    if (existsSync(resolve(annRoot, file))) continue;
    writeFileSync(resolve(annRoot, file), await tts(text, lang));
    console.log(`announcer/${file}`);
  }
  const keep = new Set(Object.values(annIndex[lang] as Record<string, string>));
  for (const f of readdirSync(resolve(annRoot, lang))) if (!keep.has(`${lang}/${f}`)) rmSync(resolve(annRoot, lang, f));
}
writeFileSync(resolve(annRoot, 'announcer.json'), `${JSON.stringify(annIndex, null, 1)}
`);

const kept = new Set(Object.values(index));
for (const lang of ['fr', 'en']) {
  for (const f of readdirSync(resolve(root, lang))) {
    if (!kept.has(`${lang}/${f}`)) rmSync(resolve(root, lang, f));
  }
}
writeFileSync(resolve(root, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${kept.size} répliques dans public/voice/`);
