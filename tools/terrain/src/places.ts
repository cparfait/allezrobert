/**
 * Lieux habités d'un monde ouvert (`places.json`) : noms des villes, villages et hameaux pour
 * la carte d'itinéraire du menu. Écrit par build-open ; pour un monde déjà construit, extrait
 * des tuiles sans rien reconstruire :
 *   pnpm --filter @allezrobert/terrain places -- --world limagne        (public/worlds/<id> de ce dépôt)
 *   pnpm --filter @allezrobert/terrain places -- --dir <dossier du monde>  (monde construit ailleurs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldMeta, WorldPlace } from '@allezrobert/shared';

export const PLACES_FILE = 'places.json';

const KINDS = /^(city|town|village|hamlet)$/;

/** Lieux habités nommés, un par nom (le premier rencontré), au décimètre. */
export function placesOf(pois: Array<{ kind: string; name?: string; x: number; z: number }>): WorldPlace[] {
  const seen = new Set<string>();
  const out: WorldPlace[] = [];
  for (const p of pois) {
    if (!p.name || !KINDS.test(p.kind) || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ name: p.name, kind: p.kind, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  }
  return out;
}

/** Extrait places.json des tuiles d'un monde déjà construit et le déclare dans world.json. */
export function extractPlaces(worldDir: string): number {
  const metaFile = path.join(worldDir, 'world.json');
  if (!fs.existsSync(metaFile)) throw new Error(`${worldDir} : pas de world.json — monde pas encore construit ici (build:world), ou ailleurs (--dir <dossier>)`);
  if (!fs.existsSync(path.join(worldDir, 'tiles'))) throw new Error(`${worldDir} : pas de tuiles (tiles/) d'où tirer les noms`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as WorldMeta;
  if (!meta.open) throw new Error(`${worldDir} : pas un monde ouvert`);
  const tilesDir = path.join(worldDir, 'tiles');
  const pois: Array<{ kind: string; name?: string; x: number; z: number }> = [];
  for (const f of fs.readdirSync(tilesDir).filter((n) => n.endsWith('.json')).sort()) {
    const tile = JSON.parse(fs.readFileSync(path.join(tilesDir, f), 'utf8')) as { pois?: typeof pois };
    pois.push(...(tile.pois ?? []));
  }
  const places = placesOf(pois);
  fs.writeFileSync(path.join(worldDir, PLACES_FILE), JSON.stringify(places));
  if (meta.open.places !== PLACES_FILE) {
    meta.open.places = PLACES_FILE;
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  return places.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const id = arg('--world');
  const dirArg = arg('--dir');
  if (!id && !dirArg) throw new Error('--world <id> ou --dir <dossier du monde> attendu');
  const dir = dirArg ? path.resolve(dirArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public/worlds', id as string);
  try {
    console.log(`${path.basename(dir)} : ${extractPlaces(dir)} lieux nommés → ${PLACES_FILE}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
