/**
 * Cache à compteur de références des ressources V3 (modèles analysés, textures) : plusieurs coureurs qui portent la
 * même pièce partagent une seule copie (un seul fichier analysé, une seule géométrie et une seule texture sur la carte
 * graphique). La ressource n'est détruite qu'au moment où son dernier utilisateur la rend.
 *
 * Sans dépendance à three : le chargement et la destruction sont fournis par l'appelant (v3/visuals.ts).
 */

/** Ressource prise dans le cache : `release` la rend (sans effet au deuxième appel). */
export interface CacheLease<T> {
  value: T;
  release: () => void;
}

interface Entry<T> {
  job: Promise<T>;
  refs: number;
}

export class RefCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  /** `dispose` : détruit une ressource que plus personne n'utilise. */
  constructor(private readonly dispose: (value: T, key: string) => void) {}

  /**
   * Prend la ressource `key`, chargée par `load` si personne ne la tient (un seul chargement pour des demandes
   * simultanées). Un chargement en échec n'est pas gardé : la demande suivante recommence.
   */
  async acquire(key: string, load: () => Promise<T>): Promise<CacheLease<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { job: load(), refs: 0 };
      this.entries.set(key, entry);
    }
    const held = entry;
    held.refs++;
    let value: T;
    try {
      value = await held.job;
    } catch (error) {
      held.refs--;
      if (this.entries.get(key) === held) this.entries.delete(key);
      throw error;
    }
    let released = false;
    return {
      value,
      release: () => {
        if (released) return;
        released = true;
        if (--held.refs > 0) return;
        // Dernier utilisateur : la ressource quitte le cache avant d'être détruite (une demande suivante recharge).
        if (this.entries.get(key) === held) this.entries.delete(key);
        this.dispose(value, key);
      },
    };
  }

  /** Nombre d'utilisateurs de `key` (0 si absente). */
  refs(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  /** Nombre de ressources gardées. */
  get size(): number {
    return this.entries.size;
  }
}
