/// <reference lib="webworker" />
import type { WorldTile } from '@allezrobert/shared';
import { decodeTile, gridFileOf } from './tileDecode.ts';

/**
 * Web Worker de décodage des tuiles (voir tileDecoder.ts) : lecture du JSON (jusqu'à 1,5 Mo), altitudes et
 * entités, hors du fil principal. Les altitudes repartent sans copie (tampon transféré).
 */

export interface TileJob {
  seq: number;
  json: ArrayBuffer;
  /** Grille d'altitudes déjà chargée (fichier `binFile`, transférée), ou null si le fil principal ne la connaît pas encore. */
  bin: ArrayBuffer | null;
  binFile: string | null;
}

export type TileReply =
  | { seq: number; ok: import('./tileDecode.ts').DecodedTile }
  /** Il faut une autre grille que celle envoyée (ou aucune n'a été envoyée) : la redemander. */
  | { seq: number; need: string }
  | { seq: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const text = new TextDecoder();

scope.onmessage = (e: MessageEvent<TileJob>) => {
  const { seq, json, bin, binFile } = e.data;
  try {
    const tile = JSON.parse(text.decode(json)) as WorldTile;
    const file = gridFileOf(tile);
    if (!bin || binFile !== file) {
      scope.postMessage({ seq, need: file } satisfies TileReply);
      return;
    }
    const decoded = decodeTile(tile, new Uint16Array(bin));
    scope.postMessage({ seq, ok: decoded } satisfies TileReply, [decoded.heights.buffer]);
  } catch (err) {
    scope.postMessage({ seq, error: String((err as Error)?.message ?? err) } satisfies TileReply);
  }
};
