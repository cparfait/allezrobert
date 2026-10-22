/**
 * Packs de cartes : chaque monde se télécharge d'un bloc depuis le menu du jeu (« Zones »), au
 * lieu d'être embarqué dans l'application.
 *
 * - `worlds/<id>/tiles/pack.json` : liste des fichiers de tuiles et leur taille, version (empreinte
 *   des noms et tailles). Déployé avec les tuiles (non versionné, comme elles).
 * - `worlds/index.json` : catalogue des zones (nom, région, parcours, taille du pack), versionné
 *   et livré avec le jeu.
 *
 *   pnpm --filter @allezrobert/terrain packs     # régénère pack.json et le catalogue de tous les mondes
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WorldCatalogue, WorldMeta, WorldPackManifest } from '@allezrobert/shared';
import { REPO_ROOT, WORLDS } from './config.ts';

export const WORLDS_ROOT = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');

/** Écrit `tiles/pack.json` d'un dossier de monde ; null s'il n'a pas de tuiles. */
export function writePackManifest(worldDir: string, id: string): WorldPackManifest | null {
  const tilesDir = path.join(worldDir, 'tiles');
  if (!fs.existsSync(tilesDir)) return null;
  const files = fs
    .readdirSync(tilesDir)
    .filter((f) => f !== 'pack.json')
    .sort()
    .map((f) => ({ p: `tiles/${f}`, b: fs.statSync(path.join(tilesDir, f)).size }));
  if (!files.length) return null;
  const h = createHash('sha1');
  for (const f of files) h.update(`${f.p}:${f.b}\n`);
  const manifest: WorldPackManifest = { formatVersion: 1, id, version: h.digest('hex').slice(0, 12), bytes: files.reduce((s, f) => s + f.b, 0), files };
  fs.writeFileSync(path.join(tilesDir, 'pack.json'), JSON.stringify(manifest));
  return manifest;
}

/** Régénère le catalogue `worlds/index.json` à partir des mondes présents (world.json + pack.json). */
export function writeCatalogue(log: (s: string) => void = console.log): WorldCatalogue {
  const zones: WorldCatalogue['zones'] = [];
  for (const id of fs.readdirSync(WORLDS_ROOT).sort()) {
    const dir = path.join(WORLDS_ROOT, id);
    const metaFile = path.join(dir, 'world.json');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaFile)) continue;
    // monde privé (data/private/worlds) : jamais dans le catalogue public
    if (fs.existsSync(path.join(dir, '.gitignore')) && /^\*$/m.test(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'))) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as WorldMeta;
    const pack = writePackManifest(dir, id);
    // sans tuiles locales, garder la taille déjà publiée (catalogue construit sur une autre machine)
    const prev = readCatalogue()?.zones.find((z) => z.id === id)?.pack ?? null;
    const routes = meta.routes.map((r) => {
      let nameEn: string | undefined;
      try {
        nameEn = (JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8')) as { nameEn?: string }).nameEn;
      } catch {
        nameEn = undefined;
      }
      return { id: r.id, name: r.name, ...(nameEn ? { nameEn } : {}), lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop };
    });
    const cfg = WORLDS[id];
    zones.push({
      id,
      name: meta.name,
      ...(cfg?.region ? { region: cfg.region } : {}),
      routes,
      pack: pack ? { version: pack.version, bytes: pack.bytes, files: pack.files.length } : prev,
    });
    log(`   zone ${id} : ${routes.length} parcours, pack ${pack ? `${(pack.bytes / 1e6).toFixed(1)} Mo (${pack.files.length} fichiers)` : prev ? 'inchangé (pas de tuiles locales)' : 'absent'}`);
  }
  const cat: WorldCatalogue = { formatVersion: 1, zones };
  fs.writeFileSync(path.join(WORLDS_ROOT, 'index.json'), `${JSON.stringify(cat, null, 1)}\n`);
  return cat;
}

function readCatalogue(): WorldCatalogue | null {
  const f = path.join(WORLDS_ROOT, 'index.json');
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as WorldCatalogue;
  } catch {
    return null;
  }
}

