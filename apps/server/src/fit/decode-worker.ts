/** Fil de travail du décodage FIT (voir decode-pool.ts) : une demande, une réponse, sans état. */
import { parentPort } from 'node:worker_threads';
import { decodeFit, FitImportError } from '../activities/fit-import.ts';
import type { FitWorkerReply, FitWorkerRequest } from './decode-pool.ts';

if (!parentPort) throw new Error('decode-worker : à lancer comme worker');
const port = parentPort;

port.on('message', (m: FitWorkerRequest) => {
  let reply: FitWorkerReply;
  try {
    const bytes = m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes as ArrayBufferLike);
    reply = { id: m.id, ok: true, result: m.name === undefined ? decodeFit(bytes) : decodeFit(bytes, m.name) };
  } catch (e) {
    reply = { id: m.id, ok: false, fit: e instanceof FitImportError, message: (e as Error).message ?? String(e) };
  }
  port.postMessage(reply);
});
