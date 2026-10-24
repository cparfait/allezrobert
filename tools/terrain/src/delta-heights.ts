/**
 * Convertit les tuiles déjà construites aux altitudes codées en différences (voir
 * packages/shared/src/heights.ts), sans rien reconstruire : `.hi.u16` / `.lo.u16` réécrits,
 * `heights.delta` posé dans la tuile, puis pack.json et catalogue régénérés.
 *
 *   npx tsx tools/terrain/src/delta-heights.ts [--world <id> …]   (défaut : tous les mondes)
 *
 * Une tuile déjà marquée `delta` est laissée telle quelle : la commande peut être relancée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deltaEncodeU16, type WorldTile } from '@allezrobert/shared';
import { WORLDS_ROOT, writeCatalogue } from './packs.ts';

const only: string[] = [];
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--world' && process.argv[i + 1]) only.push(process.argv[++i]!);

let converted = 0;
let skipped = 0;
for (const id of fs.readdirSync(WORLDS_ROOT).sort()) {
  if (only.length && !only.includes(id)) continue;
  const tilesDir = path.join(WORLDS_ROOT, id, 'tiles');
  if (!fs.existsSync(tilesDir)) continue;
  let n = 0;
  for (const f of fs.readdirSync(tilesDir)) {
    if (!/^-?\d+_-?\d+\.json$/.test(f)) continue;
    const file = path.join(tilesDir, f);
    const tile = JSON.parse(fs.readFileSync(file, 'utf8')) as WorldTile;
    if (tile.heights.delta) {
      skipped++;
      continue;
    }
    for (const g of [tile.heights.lo, tile.heights.hi]) {
      if (!g) continue;
      const gf = path.join(tilesDir, g.file);
      if (!fs.existsSync(gf)) continue;
      const buf = fs.readFileSync(gf);
      const q = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      deltaEncodeU16(q, g.n);
      fs.writeFileSync(gf, Buffer.from(q.buffer));
    }
    tile.heights.delta = true;
    fs.writeFileSync(file, JSON.stringify(tile));
    n++;
  }
  converted += n;
  console.log(`   ${id} : ${n} tuiles converties`);
}
console.log(`${converted} tuiles converties, ${skipped} déjà en différences`);
writeCatalogue();
