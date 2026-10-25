/**
 * Régénère les orthophotos de mondes déjà construits, sans reconstruire le reste : 1 024 px partout,
 * pas d'image pour les tuiles en pleine mer, couleurs harmonisées entre tuiles voisines, mosaïque du
 * relief lointain. Met à jour `world.json` (niveaux `ortho`, tailles) ; relancer ensuite `packs`.
 *
 * Usage : pnpm --filter @allezrobert/terrain regen:orthos [<monde>…] [--all]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorldMeta } from '@allezrobert/shared';
import { REPO_ROOT } from './config.ts';
import { fetchHorizonOrtho, fetchOrtho, harmonizeOrthos, orthoCacheFile, type HarmonizeTile, type OrthoWorld } from './ortho.ts';

const PX = 1024;
const WORLDS_DIR = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');

const args = process.argv.slice(2);
const ids = args.includes('--all')
  ? (JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, 'index.json'), 'utf8')) as { zones: Array<{ id: string }> }).zones.map((z) => z.id)
  : args.filter((a) => !a.startsWith('--'));
if (!ids.length) {
  console.error('usage : regen-orthos.ts <monde>… | --all');
  process.exit(1);
}

const log = (s: string) => console.log(s);

for (const id of ids) {
  const dir = path.join(WORLDS_DIR, id);
  const metaFile = path.join(dir, 'world.json');
  if (!fs.existsSync(metaFile)) {
    log(`${id} : pas de world.json, ignoré`);
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as WorldMeta;
  const w: OrthoWorld = { id: meta.id, originL93: meta.originL93 };
  const tilesDir = path.join(dir, 'tiles');
  fs.mkdirSync(tilesDir, { recursive: true });
  log(`${meta.name} (${id}) : ${meta.tiles.length} tuiles`);
  const t0 = Date.now();

  const sizeOf = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const kept: Array<{ tile: WorldMeta['tiles'][number]; h: HarmonizeTile }> = [];
  let sea = 0;
  let errors = 0;
  const queue = [...meta.tiles];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const out = path.join(tilesDir, `${t.id}.ortho.jpg`);
      const before = t.lods.includes('ortho') ? sizeOf(out) : 0;
      const r = await fetchOrtho(t.tx, t.tz, PX, out, w);
      t.bytes -= before;
      t.lods = t.lods.filter((l) => l !== 'ortho');
      if (r === 'ok') {
        t.lods.push('ortho');
        kept.push({ tile: t, h: { id: t.id, tx: t.tx, tz: t.tz, raw: orthoCacheFile(t.tx, t.tz, PX, w), out } });
      } else if (r === 'sea') sea++;
      else errors++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await harmonizeOrthos(
    kept.map((k) => k.h),
    log,
  );
  for (const { tile, h } of kept) tile.bytes += sizeOf(h.out);

  if (meta.horizon) {
    const ortho = 'tiles/horizon.ortho.jpg';
    if (await fetchHorizonOrtho(-meta.horizon.x0, path.join(dir, ortho), w)) meta.horizon.ortho = ortho;
    else delete meta.horizon.ortho;
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  log(`   ${kept.length} orthophotos, ${sea} tuile(s) en mer, ${errors} échec(s), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
