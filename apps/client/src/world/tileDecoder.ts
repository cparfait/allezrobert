import type { WorldTile } from '@allezrobert/shared';
import { frameStats } from '../engine/frameStats.ts';
import { decodeTile, gridFileOf, type DecodedTile } from './tileDecode.ts';
import type { TileJob, TileReply } from './tileWorker.ts';

/**
 * Décodage des tuiles dans deux Web Workers (tileWorker.ts) : le fil principal ne fait plus que lire les
 * octets, il reçoit les entités déjà construites (copie structurée, bien moins chère qu'une lecture de JSON)
 * et les altitudes sans copie. Sans Worker (?tileworker=0, environnement de test), décodage sur place.
 */

const POOL = 2;
let workers: Worker[] | null = null;
let next = 0;
let seq = 0;
const pending = new Map<number, { resolve: (r: TileReply) => void }>();

function pool(): Worker[] | null {
  if (workers) return workers.length ? workers : null;
  workers = [];
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tileworker') === '0';
  if (off || typeof Worker === 'undefined') return null;
  try {
    for (let i = 0; i < POOL; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module', name: `tuiles-${i + 1}` });
      w.onmessage = (e: MessageEvent<TileReply>) => {
        const job = pending.get(e.data.seq);
        pending.delete(e.data.seq);
        job?.resolve(e.data);
      };
      w.onerror = (e) => console.warn('Décodage des tuiles (Worker) en échec', e.message);
      workers.push(w);
    }
  } catch (err) {
    console.warn('Workers de tuiles indisponibles : décodage sur le fil principal', err);
    workers = [];
  }
  return workers.length ? workers : null;
}

function post(w: Worker, json: ArrayBuffer, bin: ArrayBuffer | null, binFile: string | null): Promise<TileReply> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    const job: TileJob = { seq: id, json, bin, binFile };
    // `json` est copié (on le garde s'il faut renvoyer la tuile avec une autre grille), `bin` transféré.
    w.postMessage(job, bin ? [bin] : []);
  });
}

/**
 * Décode une tuile : `json` (octets du JSON) et `bin` (grille `binFile`, celle qu'on pense être la bonne).
 * Si la tuile annonce une autre grille, `loadGrid` la charge.
 */
export async function decodeTileBytes(json: ArrayBuffer, bin: ArrayBuffer | null, binFile: string | null, loadGrid: (file: string) => Promise<ArrayBuffer>): Promise<DecodedTile> {
  const ws = pool();
  if (ws) {
    const w = ws[next++ % ws.length] as Worker;
    let reply = await post(w, json, bin, binFile);
    if ('need' in reply) reply = await post(w, json, await loadGrid(reply.need), reply.need);
    if ('ok' in reply) return reply.ok;
    if ('error' in reply) throw new Error(reply.error);
    throw new Error('tuile illisible');
  }
  const t0 = frameStats.enabled ? performance.now() : 0;
  const tile = JSON.parse(new TextDecoder().decode(json)) as WorldTile;
  const file = gridFileOf(tile);
  const raw = new Uint16Array(bin && binFile === file ? bin : await loadGrid(file));
  const decoded = decodeTile(tile, raw);
  if (frameStats.enabled) frameStats.add('décodage tuile', performance.now() - t0);
  return decoded;
}
