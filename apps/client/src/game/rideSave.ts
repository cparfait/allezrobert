import type { SaveState } from '../ui/rideOutcome.ts';

/**
 * Enregistrement d'une sortie dans l'historique : les écritures passent l'une après l'autre (fin, « Reprendre », nouvelle
 * fin), et quitter attend la dernière. Le brouillon n'est effacé que si elle a réussi : sinon la sortie est proposée au
 * prochain lancement (ui/rideRecovery.ts). Testé (rideSave.test.ts).
 */
export class RideSaver {
  private queue: Promise<SaveState> = Promise.resolve('too_short');

  /** Écrit la sortie après l'écriture précédente ; ne rejette jamais (état « failed »). */
  save(write: () => Promise<unknown>): Promise<SaveState> {
    const run = async (): Promise<SaveState> => {
      try {
        await write();
        return 'saved';
      } catch (e) {
        console.warn('Sortie non gardée dans l’historique', e);
        return 'failed';
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** État de la dernière écriture, attendu au plus `timeoutMs` (« saving » si elle n'a pas fini). */
  settled(timeoutMs: number): Promise<SaveState> {
    return withTimeout(this.queue, timeoutMs, 'saving');
  }
}

/** `p`, ou `fallback` si elle n'a pas abouti en `timeoutMs` ou si elle échoue. */
export function withTimeout<T>(p: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    void p.then(resolve, () => resolve(fallback)).finally(() => clearTimeout(timer));
  });
}
