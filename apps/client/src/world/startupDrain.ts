import type { WorkQueue } from './workQueue.ts';

function paintOpportunity(): Promise<void> {
  return new Promise((resolve) => {
    // L'onglet masqué peut suspendre requestAnimationFrame.
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame);
      resolve();
    }, 60);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timeout);
      setTimeout(resolve, 0);
    });
  });
}

/** Vide la file par lots de 6 ms et signale une progression qui ne recule pas. */
export async function drainStartupQueue(work: WorkQueue, onProgress?: (fraction: number) => void): Promise<void> {
  let completed = 0;
  let shown = 0;
  while (work.size) {
    await paintOpportunity();
    completed += work.pump(6);
    // Une tâche peut en ajouter d'autres. Ne pas afficher 100 % avant la fin.
    if (work.size) {
      const fraction = completed / (completed + work.size);
      if (fraction > shown) {
        shown = fraction;
        onProgress?.(fraction);
      }
    }
  }
  onProgress?.(1);
}
