/**
 * Registre des mondes Poly supplémentaires (un module par monde dans ce dossier). L'ordre est celui des onglets.
 */
import type { PolyLand } from './types.ts';
import { ARCHIPEL } from './archipel-des-volcans.ts';
import { GRAND_NORD } from './grand-nord.ts';
import { DESERT_ROUGE } from './desert-rouge.ts';
import { RIZIERES } from './rizieres.ts';

export const POLY_LANDS: readonly PolyLand[] = [ARCHIPEL, GRAND_NORD, DESERT_ROUGE, RIZIERES];

/** Monde supplémentaire de cet identifiant ; undefined pour l'île, le Pays de Robert et les zones réelles. */
export function polyLand(id: string): PolyLand | undefined {
  return POLY_LANDS.find((l) => l.world.id === id);
}
