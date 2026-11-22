/**
 * Index statique des montées chronométrées (segments `kind: 'kom'`) de toutes les zones publiées,
 * lu par le Défi KOM du menu : le tableau liste toutes les côtes, même celles des zones jamais ouvertes
 * dans ce navigateur.
 *
 * Source : le catalogue `public/worlds/index.json` (zones publiées et leurs itinéraires, dans l'ordre)
 * et les fichiers `public/worlds/<zone>/routes/<itinéraire>.json` (seuls `segments`, `name`, `nameEn` et `bike`
 * sont lus : le format compact `pointsFlat` n'importe pas ici).
 *
 * Usage : npx tsx apps/client/scripts/kom-index.ts [--check]
 *   sans option : réécrit `src/data/komIndex.json` ;
 *   --check : vérifie seulement qu'il est à jour (code de sortie 1 sinon).
 * À relancer après toute publication ou reconstruction d'itinéraires (le test komCatalog.test.ts le rappelle).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKomIndex, type KomSourceZone } from '../src/ui/komCatalog.ts';
import type { RouteBike, RouteSegment } from '@allezrobert/shared';

const root = join(import.meta.dirname, '..');
const worlds = join(root, 'public', 'worlds');
const out = join(root, 'src', 'data', 'komIndex.json');

interface Catalogue {
  zones: Array<{ id: string; routes: Array<{ id: string }> }>;
}

/** Zones du catalogue avec, pour chaque itinéraire, ce que le tableau des montées en garde. */
export function readSources(dir = worlds): KomSourceZone[] {
  const cat = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Catalogue;
  return cat.zones.map((z) => ({
    id: z.id,
    routes: z.routes.map((r) => {
      const j = JSON.parse(readFileSync(join(dir, z.id, 'routes', `${r.id}.json`), 'utf8')) as {
        id: string;
        name: string;
        nameEn?: string;
        bike?: RouteBike;
        segments?: RouteSegment[];
      };
      return { id: r.id, name: j.name, nameEn: j.nameEn, bike: j.bike, segments: j.segments ?? [] };
    }),
  }));
}

if (process.argv[1] && import.meta.filename === (await import('node:path')).resolve(process.argv[1])) {
  const text = `${JSON.stringify(buildKomIndex(readSources()))}\n`;
  if (process.argv.includes('--check')) {
    let old = '';
    try {
      old = readFileSync(out, 'utf8');
    } catch {
      // absent : pas à jour
    }
    if (old !== text) {
      console.error('komIndex.json n’est pas à jour : npx tsx apps/client/scripts/kom-index.ts');
      process.exit(1);
    }
    console.log('komIndex.json à jour');
  } else {
    writeFileSync(out, text);
    const idx = JSON.parse(text) as ReturnType<typeof buildKomIndex>;
    const n = Object.values(idx.zones).reduce((a, z) => a + z.climbs.length, 0);
    console.log(`${Object.keys(idx.zones).length} zones, ${n} montées, ${(text.length / 1024).toFixed(1)} Ko → ${out}`);
  }
}
