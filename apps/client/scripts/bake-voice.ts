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
      const r = await fetch(`${api}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }) });
      if (!r.ok) throw new Error(`${file} : ${r.status} ${await r.text()}`);
      writeFileSync(resolve(root, file), Buffer.from(await r.arrayBuffer()));
      console.log(file);
    }
  }
}

const kept = new Set(Object.values(index));
for (const lang of ['fr', 'en']) {
  for (const f of readdirSync(resolve(root, lang))) {
    if (!kept.has(`${lang}/${f}`)) rmSync(resolve(root, lang, f));
  }
}
writeFileSync(resolve(root, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${kept.size} répliques dans public/voice/`);
