/**
 * Mesures par image pour le panneau de performance (F3) : le temps passé dans chaque poste (construction
 * des tuiles, décodage, mise à jour du monde…), pour dire ce qui a pris le temps d'une image lente.
 * Inactif (aucune mesure) tant que le panneau n'est pas affiché.
 */
let enabled = false;
const current = new Map<string, number>();

export const frameStats = {
  get enabled(): boolean {
    return enabled;
  },
  setEnabled(on: boolean): void {
    enabled = on;
    current.clear();
  },
  add(label: string, ms: number): void {
    if (enabled) current.set(label, (current.get(label) ?? 0) + ms);
  },
  /** Mesures de l'image qui s'achève (et remise à zéro pour la suivante). */
  take(): Array<[string, number]> {
    const out = [...current.entries()];
    current.clear();
    return out;
  },
};
