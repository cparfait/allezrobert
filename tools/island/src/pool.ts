/** Petit groupe de fils de calcul (worker_threads) pour les calculs longs : relief des grilles, tuiles. */
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';

export interface Job {
  type: string;
  [k: string]: unknown;
}

/**
 * Lance `n` fils sur `worker.ts`, leur envoie `init` (données partagées), puis distribue les tâches ;
 * renvoie les résultats dans l'ordre des tâches.
 */
export async function runPool<R>(init: Job | null, jobs: Job[], onDone?: (done: number, total: number) => void, n = Math.max(1, cpus().length - 1)): Promise<R[]> {
  const url = new URL('./worker.ts', import.meta.url);
  const results = new Array<R>(jobs.length);
  let next = 0;
  let done = 0;
  const count = Math.min(n, jobs.length);
  await Promise.all(
    Array.from({ length: count }, () => {
      const w = new Worker(url, { execArgv: process.execArgv });
      return new Promise<void>((resolve, reject) => {
        const feed = () => {
          if (next >= jobs.length) {
            void w.terminate().then(() => resolve());
            return;
          }
          const k = next++;
          w.once('message', (r: R) => {
            results[k] = r;
            done++;
            onDone?.(done, jobs.length);
            feed();
          });
          w.postMessage(jobs[k]);
        };
        w.on('error', reject);
        if (init) {
          w.once('message', () => feed());
          w.postMessage(init);
        } else feed();
      });
    }),
  );
  return results;
}
