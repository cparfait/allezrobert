/**
 * File de travail étalée sur plusieurs images : chaque tâche (construire une tuile, une partie de ses
 * entités, changer son niveau de détail) passe par ordre de priorité (plus petit d'abord : le plus
 * proche du coureur), dans un budget de temps par image. Au moins une tâche par appel, pour avancer
 * même quand une tâche dépasse le budget à elle seule.
 */
import { frameStats } from '../engine/frameStats.ts';

export class WorkQueue {
  private readonly tasks: Array<{ run: () => void; priority: number; seq: number; label: string }> = [];
  private seq = 0;

  get size(): number {
    return this.tasks.length;
  }

  /** `label` : nom du poste pour le panneau de performance (F3). */
  defer(run: () => void, priority = 0, label = 'construction'): void {
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
      const t = this.tasks.shift() as { run: () => void; label: string };
      done++;
      const t0 = frameStats.enabled ? performance.now() : 0;
      try {
        t.run();
      } catch (e) {
        console.warn('Tâche de chargement du monde en échec', e);
      }
      if (frameStats.enabled) frameStats.add(t.label, performance.now() - t0);
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
