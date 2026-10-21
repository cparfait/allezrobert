/**
 * EXPÉRIMENTAL — NON IMPLÉMENTÉ. SRAM AXS (manettes/dérailleur) en Bluetooth.
 *
 * Le protocole AXS n'est pas public : BikeControl publie uniquement un « stub » dont toutes les
 * constantes (UUID, paramètres Diffie-Hellman d'appairage, champs protobuf) sont factices, les vraies
 * valeurs restant dans un paquet privé. Rien n'est donc vérifiable ici : on fournit seulement
 * l'interface attendue par le paquet `devices`, pour brancher plus tard une implémentation documentée.
 *
 * TODO : implémenter dès qu'une description publique et sous licence compatible existe
 *        (ou passer par le profil ANT+ Controls / HID si la manette l'expose).
 */
import type { ShiftAction } from '@allezrobert/shared';

export const SRAM_AXS_SUPPORTED = false;

export interface SramAxsAdapter {
  readonly supported: boolean;
  /** Services à demander à la découverte (inconnus pour l'instant). */
  readonly services: readonly string[];
  /** Appairage / liaison sécurisée (non documenté). */
  bond(write: (characteristic: string, data: Uint8Array) => Promise<void>): Promise<void>;
  /** Décode une notification en actions de jeu. */
  decode(characteristic: string, data: Uint8Array): ShiftAction[];
}

export const SRAM_AXS_STUB: SramAxsAdapter = {
  supported: false,
  services: [],
  bond: async () => {
    throw new Error('SRAM AXS : protocole non documenté publiquement, non implémenté');
  },
  decode: () => [],
};
