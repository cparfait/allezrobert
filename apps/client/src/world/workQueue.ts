/**
 * File de travail étalée sur plusieurs images : chaque tâche (construire une tuile, une partie de ses
 * entités, changer son niveau de détail) passe par ordre de priorité (plus petit d'abord : le plus
 * proche du coureur), dans un budget de temps par image. Au moins une tâche par appel, pour avancer
 * même quand une tâche dépasse le budget à elle seule.
 */
import { frameStats } from '../engine/frameStats.ts';

/**
 * Tâche : `run` fait tout d'un coup, ou renvoie un itérateur (générateur) que la file fait avancer pas à pas dans le
 * budget de chaque image (construction des bâtiments d'une tuile : plus de 300 ms d'un bloc sinon).
 */
interface Task {
  run: () => unknown;
  priority: number;
  seq: number;
  label: string;
  started?: boolean;
  it?: Iterator<unknown>;
}

const isIterator = (r: unknown): r is Iterator<unknown> => !!r && typeof (r as Iterator<unknown>).next === 'function';

export class WorkQueue {
  private readonly tasks: Task[] = [];
  private seq = 0;

  get size(): number {
    return this.tasks.length;
  }

  /** `label` : nom du poste pour le panneau de performance (F3). */
  defer(run: () => unknown, priority = 0, label = 'construction'): void {
    this.tasks.push({ run, priority, seq: this.seq++, label });
  }

  /** Exécute des tâches pendant au plus `budgetMs` (horloge injectable pour les tests). Renvoie le nombre de tâches faites. */
  pump(budgetMs: number, now: () => number = () => performance.now()): number {
    if (!this.tasks.length) return 0;
    // À priorité égale, l'ordre d'arrivée (une tuile : terrain, puis bâtiments, routes, végétation…).
    this.tasks.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const start = now();
    let done = 0;
    while (this.tasks.length && (done === 0 || now() - start < budgetMs)) {
      const t = this.tasks[0] as Task;
      done++;
      const t0 = frameStats.enabled ? performance.now() : 0;
      let finished = true;
      try {
        if (!t.started) {
          t.started = true;
          const r = t.run();
          if (isIterator(r)) t.it = r;
        }
        // Tâche découpée (itérateur) : avancée pas à pas dans le budget, reprise à l'image suivante sinon.
        if (t.it) {
          let r: IteratorResult<unknown>;
          do r = t.it.next();
          while (!r.done && now() - start < budgetMs);
          finished = !!r.done;
        }
      } catch (e) {
        console.warn('Tâche de chargement du monde en échec', e);
      }
      if (frameStats.enabled) frameStats.add(t.label, performance.now() - t0);
      if (finished) this.tasks.shift();
      else break;
    }
    return done;
  }

  /** Tout exécuter tout de suite (préchargement avant le départ), y compris les tâches ajoutées en route. */
  flush(): void {
    while (this.tasks.length) this.pump(Number.POSITIVE_INFINITY);
  }

  clear(): void {
    this.tasks.length = 0;
  }
}
