/**
 * Publie en boucle les tours déjà construits qui reviennent à leur départ (voir circuit.ts), sans
 * reconstruire les mondes : fichiers de parcours, world.json et catalogue des zones.
 *
 *   pnpm --filter @allezrobert/terrain close-loops
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RouteData, WorldCatalogue, WorldMeta } from '@allezrobert/shared';
import { asCircuit } from './circuit.ts';
import { WORLDS_ROOT } from './packs.ts';

const catFile = path.join(WORLDS_ROOT, 'index.json');
const cat = JSON.parse(fs.readFileSync(catFile, 'utf8')) as WorldCatalogue;
let changed = 0;
for (const id of fs.readdirSync(WORLDS_ROOT).sort()) {
  const dir = path.join(WORLDS_ROOT, id);
  const metaFile = path.join(dir, 'world.json');
  if (!fs.existsSync(metaFile)) continue;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as WorldMeta;
  let metaChanged = false;
  for (const entry of meta.routes) {
    const file = path.join(dir, entry.file);
    const route = JSON.parse(fs.readFileSync(file, 'utf8')) as RouteData;
    const loop = asCircuit(route);
    if (loop === route) continue;
    fs.writeFileSync(file, JSON.stringify(loop));
    Object.assign(entry, { lengthM: loop.lengthM, elevationGainM: loop.elevationGainM, loop: true });
    const z = cat.zones.find((x) => x.id === id)?.routes.find((r) => r.id === entry.id);
    if (z) Object.assign(z, { lengthM: loop.lengthM, elevationGainM: loop.elevationGainM, loop: true });
    metaChanged = true;
    changed++;
    console.log(`   ${id}/${entry.id} : boucle de ${(loop.lengthM / 1000).toFixed(2)} km (au lieu de ${(route.lengthM / 1000).toFixed(2)}), ${loop.segments.length}/${route.segments.length} montée(s)`);
  }
  if (metaChanged) fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
}
fs.writeFileSync(catFile, `${JSON.stringify(cat, null, 1)}\n`);
console.log(`${changed} parcours publié(s) en boucle`);
