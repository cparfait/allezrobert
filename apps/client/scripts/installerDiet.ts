import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Fichiers de `public/` qui n'ont rien à faire dans un build livré, retirés de `dist/` après la copie :
 * - `__pose/` : photos de référence et modèle de pose du banc de mesure (non versionnés, ≈ 30 Mo), partout ;
 * - pour l'installateur Windows (`desktop`), les boucles vidéo VP9 `.webm` (≈ 125 Mo) : H.264 (`.mp4`) joue dans
 *   WebView2, et le menu retombe sur l'AV1 (`.av1.mp4`, décodé par logiciel) si H.264 manque (Windows « N »).
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
  if (desktop && existsSync(menu)) for (const f of readdirSync(menu)) if (/^loop-.*\.webm$/.test(f)) drop(resolve(menu, f));
  return removed;
}
