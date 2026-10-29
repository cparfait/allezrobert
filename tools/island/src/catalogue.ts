/**
 * Publie l'île dans le catalogue des zones du jeu (`worlds/index.json`, menu « Zones ») et écrit son pack de
 * tuiles (`tiles/pack.json`) — les autres zones du catalogue restent inchangées.
 *
 *   npx tsx tools/island/src/catalogue.ts      (lancé aussi à la fin de build.ts)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WorldCatalogue, WorldMeta } from '../../../packages/shared/src/index.ts';
import { writePackManifest } from '../../terrain/src/packs.ts';

export const REGION = 'Monde imaginaire · Jeu vidéo';

export function publishIsland(dir: string): void {
  const meta = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldMeta;
  const pack = writePackManifest(dir, meta.id);
  const catFile = resolve(dir, '..', 'index.json');
  const cat = JSON.parse(readFileSync(catFile, 'utf8')) as WorldCatalogue;
  const prev = cat.zones.find((z) => z.id === meta.id);
  const routes = meta.routes.map((r) => {
    const file = join(dir, r.file);
    const nameEn = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { nameEn?: string }).nameEn : undefined;
    return { id: r.id, name: r.name, ...(nameEn ? { nameEn } : {}), lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop };
  });
  const zone: WorldCatalogue['zones'][number] = {
    id: meta.id,
    name: meta.name,
    region: REGION,
    routes,
    pack: pack ? { version: pack.version, bytes: pack.bytes, files: pack.files.length, gzBytes: pack.gzBytes ?? pack.bytes } : (prev?.pack ?? null),
    l93: { minE: meta.originL93.x + meta.bounds.minX, minN: meta.originL93.y - meta.bounds.maxZ, maxE: meta.originL93.x + meta.bounds.maxX, maxN: meta.originL93.y - meta.bounds.minZ },
    ...(meta.open ? { open: true as const } : {}),
  };
  const zones = cat.zones.filter((z) => z.id !== meta.id);
  zones.push(zone);
  zones.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  writeFileSync(catFile, `${JSON.stringify({ ...cat, zones }, null, 1)}\n`);
  console.log(`catalogue : ${meta.id}, ${routes.length} parcours, pack ${pack ? `${(pack.bytes / 1e6).toFixed(0)} Mo (${pack.files.length} fichiers)` : 'absent'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) publishIsland(resolve(import.meta.dirname, '../../../apps/client/public/worlds/ile-de-robert'));
