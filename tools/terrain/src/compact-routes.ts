/**
 * Convertit des fichiers d'itinéraire au format compact (packages/shared/src/routeCodec.ts) : `points` (objets)
 * devient `pointsFlat` (tableau plat), le reste du fichier est inchangé.
 *
 *   node --import tsx tools/terrain/src/compact-routes.ts [dossier…]           essai : tailles et contrôle, rien d'écrit
 *   node --import tsx tools/terrain/src/compact-routes.ts --write [dossier…]   écrit les fichiers convertis
 *
 * Sans dossier : apps/client/public/worlds/<toutes les zones>/routes. Chaque fichier n'est écrit que si le décodage
 * de sa version compacte redonne exactement le même JSON (mêmes clés, même ordre, mêmes nombres) : l'empreinte des
 * manifestes de collision ne change donc pas.
 *
 * À NE LANCER SUR worlds/ QU'APRÈS la publication d'une version de l'application qui lit ce format (les versions
 * installées avant ne savent lire que l'ancien) et en prévenant les autres sessions (CLAUDE.md, règle 5).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeRoute, encodeRoute, type RouteData } from '@allezrobert/shared';

const REPO = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const dirs = args.filter((a) => !a.startsWith('--'));
const roots = dirs.length
  ? dirs
  : readdirSync(join(REPO, 'apps/client/public/worlds'))
      .map((z) => join(REPO, 'apps/client/public/worlds', z, 'routes'))
      .filter((d) => {
        try {
          return statSync(d).isDirectory();
        } catch {
          return false;
        }
      });

let before = 0;
let after = 0;
let converted = 0;
let already = 0;
const refused: string[] = [];
for (const dir of roots) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const file = join(dir, f);
    const text = readFileSync(file, 'utf8');
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(raw.points)) {
      already++;
      continue;
    }
    const compact = JSON.stringify(encodeRoute(raw as unknown as RouteData));
    // Contrôle : le décodage redonne le même JSON que l'original relu (même empreinte).
    if (JSON.stringify(decodeRoute(JSON.parse(compact))) !== JSON.stringify(raw)) {
      refused.push(file);
      continue;
    }
    before += Buffer.byteLength(text);
    after += Buffer.byteLength(compact);
    converted++;
    if (write) writeFileSync(file, compact);
  }
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} Mo`;
console.log(`${write ? 'Converti' : 'Essai'} : ${converted} fichier(s), ${mb(before)} → ${mb(after)} (−${before ? Math.round((1 - after / before) * 100) : 0} %) ; déjà compacts : ${already}`);
if (refused.length) {
  console.log(`Refusés (le décodage ne redonnait pas le même contenu) : ${refused.length}`);
  for (const f of refused) console.log(`  ${f}`);
  process.exitCode = 1;
}
