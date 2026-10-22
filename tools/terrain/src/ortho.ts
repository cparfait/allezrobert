/**
 * Orthophotographies IGN (BD ORTHO®, Licence Ouverte Etalab 2.0) : une image JPEG basse
 * résolution par tuile, indice de couleur du sol pour le client. Téléchargée une fois (cache).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN_L93, TILE_SIZE_M, WORLD_ID } from './config.ts';
import { cachePath, fetchCached } from './net.ts';

export const ORTHO_LAYER = 'ORTHOIMAGERY.ORTHOPHOTOS';

export async function fetchOrtho(tx: number, tz: number, px: number, outFile: string): Promise<boolean> {
  const xmin = ORIGIN_L93.x + tx * TILE_SIZE_M;
  const ymax = ORIGIN_L93.y - tz * TILE_SIZE_M;
  const url =
    `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${ORTHO_LAYER}&STYLES=&CRS=EPSG:2154` +
    `&BBOX=${xmin},${ymax - TILE_SIZE_M},${xmin + TILE_SIZE_M},${ymax}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/jpeg`;
  try {
    // cache indexé par tuile : un dossier par monde (« chevreuse » garde l'emplacement historique)
    const kind = WORLD_ID === 'chevreuse' ? `ortho-${px}` : `ortho-${px}-${WORLD_ID}`;
    const buf = await fetchCached(url, cachePath(kind, `${tx}_${tz}`, '.jpg'), {
      timeoutMs: 60000,
      retries: 3,
      validate: (b) => (b[0] === 0xff && b[1] === 0xd8 ? null : `pas un JPEG : ${b.subarray(0, 100).toString()}`),
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buf);
    return true;
  } catch (err) {
    console.warn(`  ! orthophoto ${tx}_${tz} : ${(err as Error).message.slice(0, 120)}`);
    return false;
  }
}
