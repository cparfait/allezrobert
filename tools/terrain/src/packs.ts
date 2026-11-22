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
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import type { WorldCatalogue, WorldMeta, WorldPackManifest } from '@allezrobert/shared';
import { isBuildingVisualFile } from '@allezrobert/shared/building-visual';
import { REPO_ROOT, allWorlds } from './config.ts';
import { BUILD_OK, writeAtomic } from './safe-fs.ts';

export const WORLDS_ROOT = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');

/**
 * Empreinte et taille compressée déjà calculées d'un fichier de tuile, valables tant que sa taille et sa date de
 * modification n'ont pas changé : sans cela, chaque appel relisait et recompressait toutes les tuiles de tous les
 * mondes (plusieurs Go) pour une seule zone reconstruite.
 */
export interface PackIndexEntry {
  b: number;
  /** Date de modification (ms). */
  m: number;
  h: string;
  /** Taille servie (gzip niveau 6, ou taille brute pour une image). */
  gz: number;
}
export type PackIndex = Record<string, PackIndexEntry>;

/** Index par défaut, à côté des journaux de construction (hors du dépôt et hors des mondes). */
export const PACK_INDEX_FILE = path.join(REPO_ROOT, 'data', 'cache', 'mesh', 'pack-index.json');

export function loadPackIndex(file: string = PACK_INDEX_FILE): PackIndex {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { formatVersion?: number; files?: PackIndex };
    return v.formatVersion === 1 && v.files ? v.files : {};
  } catch {
    return {};
  }
}

export function savePackIndex(index: PackIndex, file: string = PACK_INDEX_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify({ formatVersion: 1, files: index }));
}

/** Compteurs d'un passage (journal et tests) : fichiers repris de l'index, fichiers relus. */
export interface PackIndexStats {
  reused: number;
  read: number;
}

/** Ce que le pack ne liste pas : lui-même et le témoin de fin de construction. */
const NOT_IN_PACK = new Set(['pack.json', BUILD_OK]);

/**
 * Écrit `tiles/pack.json` d'un dossier de monde ; null s'il n'a pas de tuiles. Avec `index`, un fichier inchangé
 * (même taille, même date) n'est ni relu ni recompressé ; l'index est mis à jour en place.
 */
export function writePackManifest(worldDir: string, id: string, index?: PackIndex, stats?: PackIndexStats): WorldPackManifest | null {
  const tilesDir = path.join(worldDir, 'tiles');
  if (!fs.existsSync(tilesDir)) return null;
  // h : empreinte du contenu (SHA-256, 32 caractères) : l'application Windows vérifie chaque fichier reçu et, à
  // une mise à jour, ne retélécharge que ceux qui ont changé (apps/desktop/src-tauri/src/packs.rs).
  const entries = fs
    .readdirSync(tilesDir)
    .filter((f) => !NOT_IN_PACK.has(f))
    .sort()
    .map((f) => {
      const file = path.join(tilesDir, f);
      const st = fs.statSync(file);
      const known = index?.[file];
      if (known && known.b === st.size && known.m === st.mtimeMs) {
        if (stats) stats.reused++;
        return { p: `tiles/${f}`, b: known.b, h: known.h, gz: known.gz };
      }
      const bytes = fs.readFileSync(file);
      const h = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
      // taille téléchargée : fichiers compressés comme les sert Caddy (gzip/zstd) et les garde le jeu
      const gz = /\.(jpe?g|png|webp)$/i.test(f) ? bytes.length : zlib.gzipSync(bytes, { level: 6 }).length;
      if (index) index[file] = { b: bytes.length, m: st.mtimeMs, h, gz };
      if (stats) stats.read++;
      return { p: `tiles/${f}`, b: bytes.length, h, gz };
    });
  const files = entries.map(({ p, b: size, h }) => ({ p, b: size, h }));
  if (!files.length) return null;
  // Garder la version historique des packs sans compléments. Pour les données visuelles,
  // une correction de même taille doit quand même signaler une nouvelle version.
  const h = createHash('sha1');
  for (const f of files) {
    const visualDigest = isBuildingVisualFile(path.basename(f.p)) ? `:${f.h}` : '';
    h.update(`${f.p}:${f.b}${visualDigest}\n`);
  }
  const gzBytes = entries.reduce((sum, e) => sum + e.gz, 0);
  const manifest: WorldPackManifest = { formatVersion: 1, id, version: h.digest('hex').slice(0, 12), bytes: files.reduce((s, f) => s + f.b, 0), gzBytes, files };
  writeAtomic(path.join(tilesDir, 'pack.json'), JSON.stringify(manifest));
  return manifest;
}

/** Régénère le catalogue `worlds/index.json` à partir des mondes présents (world.json + pack.json). */
export function writeCatalogue(log: (s: string) => void = console.log, indexFile: string = PACK_INDEX_FILE): WorldCatalogue {
  const zones: WorldCatalogue['zones'] = [];
  // Lus une fois, pas à chaque zone : le catalogue publié, la liste des zones et l'index des tuiles déjà empreintes.
  const published = readCatalogue();
  const worlds = allWorlds();
  const index = loadPackIndex(indexFile);
  const stats: PackIndexStats = { reused: 0, read: 0 };
  for (const id of fs.readdirSync(WORLDS_ROOT).sort()) {
    const dir = path.join(WORLDS_ROOT, id);
    const metaFile = path.join(dir, 'world.json');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaFile)) continue;
    // monde privé (data/private/worlds) : jamais dans le catalogue public
    if (fs.existsSync(path.join(dir, '.gitignore')) && /^\*$/m.test(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'))) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as WorldMeta;
    const pack = writePackManifest(dir, id, index, stats);
    // sans tuiles locales, garder la taille déjà publiée (catalogue construit sur une autre machine)
    const prev = published?.zones.find((z) => z.id === id)?.pack ?? null;
    const routes = meta.routes.map((r) => {
      let nameEn: string | undefined;
      try {
        nameEn = (JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8')) as { nameEn?: string }).nameEn;
      } catch {
        nameEn = undefined;
      }
      return { id: r.id, name: r.name, ...(nameEn ? { nameEn } : {}), lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop };
    });
    const cfg = worlds[id];
    zones.push({
      id,
      name: meta.name,
      ...(cfg?.region ? { region: cfg.region } : {}),
      routes,
      pack: pack ? { version: pack.version, bytes: pack.bytes, files: pack.files.length, gzBytes: pack.gzBytes ?? pack.bytes } : prev,
      l93: { minE: meta.originL93.x + meta.bounds.minX, minN: meta.originL93.y - meta.bounds.maxZ, maxE: meta.originL93.x + meta.bounds.maxX, maxN: meta.originL93.y - meta.bounds.minZ },
      ...(meta.open ? { open: true as const } : {}),
    });
    log(`   zone ${id} : ${routes.length} parcours, pack ${pack ? `${(pack.bytes / 1e6).toFixed(1)} Mo (${pack.files.length} fichiers)` : prev ? 'inchangé (pas de tuiles locales)' : 'absent'}`);
  }
  const cat: WorldCatalogue = { formatVersion: 1, zones };
  writeAtomic(path.join(WORLDS_ROOT, 'index.json'), `${JSON.stringify(cat, null, 1)}\n`);
  // Entrées de fichiers disparus retirées, puis index enregistré pour le prochain passage.
  for (const f of Object.keys(index)) if (!fs.existsSync(f)) delete index[f];
  try {
    savePackIndex(index, indexFile);
  } catch (err) {
    log(`   index des packs non enregistré : ${(err as Error).message}`);
  }
  log(`   tuiles : ${stats.read} relue(s), ${stats.reused} reprise(s) de l'index`);
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

