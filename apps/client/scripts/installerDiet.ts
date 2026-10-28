import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Fichiers de `public/` qui n'ont rien à faire dans un build livré, retirés de `dist/` après la copie :
 * - `__pose/` : photos de référence et modèle de pose du banc de mesure (non versionnés, ≈ 30 Mo), partout ;
 * - pour l'installateur Windows (`desktop`), les boucles vidéo VP9 `.webm` (≈ 125 Mo) : H.264 (`.mp4`) joue dans
 *   WebView2, et le menu retombe sur l'AV1 (`.av1.mp4`, décodé par logiciel) si H.264 manque (Windows « N »).
 * - toujours pour l'installateur : les graphes routiers `worlds/<zone>/graph.json` (≈ 330 Mo pour 45 zones), que le jeu télécharge
 *   avec le pack de chaque zone (world/packs.ts, graphFetch).
 * Renvoie les chemins retirés.
 */
export function pruneDist(dist: string, desktop: boolean): string[] {
  const removed: string[] = [];
  const drop = (path: string) => {
    if (!existsSync(path)) return;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  };
  drop(resolve(dist, '__pose'));
  const menu = resolve(dist, 'menu');
  const worlds = resolve(dist, 'worlds');
  if (desktop && existsSync(worlds)) for (const w of readdirSync(worlds, { withFileTypes: true })) if (w.isDirectory()) drop(resolve(worlds, w.name, 'graph.json'));
  if (desktop && existsSync(menu)) for (const f of readdirSync(menu)) if (/^loop-.*\.webm$/.test(f)) drop(resolve(menu, f));
  return removed;
}

/**
 * Ressources lourdes de l'application Windows, hors de l'exe (voir `extractMedia`). Le catalogue des zones
 * (`worlds/index.json`), les polices, les images de l'écran de chargement et le code restent embarqués.
 */
export const MEDIA_DIRS = ['menu', 'models', 'music', 'voice', 'audio', 'bike-thumbs', 'assets/textures', 'assets/logos', 'worlds'];
const EMBEDDED = new Set(['worlds/index.json']);

export interface MediaManifest {
  formatVersion: 1;
  /** Empreinte de la liste (chemins et empreintes des fichiers). */
  version: string;
  bytes: number;
  /** Chemin dans le jeu, taille, SHA-256 (32 premiers caractères hexadécimaux, nom de l'objet publié). */
  files: Array<{ p: string; b: number; h: string }>;
}

/**
 * Installateur Windows : sort de `dist/` les ressources lourdes (`MEDIA_DIRS`) vers `out` (dossier qui n'est
 * pas embarqué dans l'exe) et écrit `dist/media-manifest.json`, embarqué, lui. L'application les télécharge
 * au premier lancement, puis seulement celles qui changent (platform/desktopBoot.ts, packs.rs `media_sync`) ;
 * deploy/publish-desktop.sh les publie par empreinte (`/telechargement/media/<h>`). Retire aussi les cartes de
 * sources (`*.map`), inutiles dans l'exe. Renvoie le manifeste.
 */
export function extractMedia(dist: string, out: string): MediaManifest {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files: MediaManifest['files'] = [];
  const walk = (rel: string) => {
    const abs = resolve(dist, rel);
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        walk(p);
        if (!readdirSync(resolve(dist, p)).length) rmdirSync(resolve(dist, p));
        continue;
      }
      if (EMBEDDED.has(p)) continue;
      const from = resolve(dist, p);
      const h = createHash('sha256').update(readFileSync(from)).digest('hex').slice(0, 32);
      files.push({ p, b: statSync(from).size, h });
      const to = resolve(out, p);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
  };
  for (const d of MEDIA_DIRS) if (existsSync(resolve(dist, d))) walk(d);
  for (const d of MEDIA_DIRS) {
    const abs = resolve(dist, d);
    if (existsSync(abs) && !readdirSync(abs).length) rmdirSync(abs);
  }
  const dropMaps = (abs: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) dropMaps(resolve(abs, e.name));
      else if (e.name.endsWith('.map')) rmSync(resolve(abs, e.name));
    }
  };
  dropMaps(dist);
  files.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const version = createHash('sha256')
    .update(files.map((f) => `${f.p}:${f.h}`).join('\n'))
    .digest('hex')
    .slice(0, 12);
  const manifest: MediaManifest = { formatVersion: 1, version, bytes: files.reduce((s, f) => s + f.b, 0), files };
  writeFileSync(resolve(dist, 'media-manifest.json'), JSON.stringify(manifest));
  return manifest;
}
