import { lookSex, type AvatarLook } from '@allezrobert/shared';
import { V3_STYLE } from '../engine/style.ts';
import { inDesktop, invoke } from '../platform/desktop.ts';
import { CINEMATIC_V3 } from './cinematicRiders.ts';
import { readV3Equipment, v3RidePaths } from './visuals.ts';

/**
 * Sorties V3 sans connexion (application de bureau) : tant que le service V3 répond, l'application copie sur le disque
 * ce qu'une sortie charge (vélo, roues, coureur et tenue du joueur, coureurs IA du film d'accueil, catalogues et
 * animations, images fixes du menu). Sans réseau, `v3_access` bascule sur cette copie (apps/desktop/src-tauri/src/v3.rs) :
 * les zones déjà téléchargées se roulent en V3 comme en Réel ou en Poly.
 */
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

let running: Promise<void> | undefined;
let pending: AvatarLook | undefined;
let done = '';

/** Prépare la copie hors ligne en tâche de fond (une à la fois ; la dernière demande reçue est rejouée ensuite). */
export function syncV3Offline(look: AvatarLook): void {
  if (!V3_STYLE || !inDesktop || import.meta.env?.DEV) return;
  pending = look;
  running ??= drain().finally(() => { running = undefined; });
}

async function drain(): Promise<void> {
  while (pending) {
    const look = pending;
    pending = undefined;
    try {
      // Déjà sur la copie du disque (pas de réseau) : rien à télécharger.
      if (await invoke<boolean>('v3_offline')) return;
      const equipment = readV3Equipment();
      const riders = [{ equipment, sex: equipment.sex ?? lookSex(look) }, ...CINEMATIC_V3.map(rider => ({ equipment: rider, sex: rider.sex ?? 'male' as const }))];
      const paths = [...await v3RidePaths(riders), ...SEASONS.map(season => `/__v3/menu/still-v3-${season}.jpg`)];
      const key = paths.join('\n');
      if (key === done) continue;
      await invoke('v3_prepare_offline', { paths });
      done = key;
    } catch (error) {
      console.warn('[V3] préparation hors ligne', error);
    }
  }
}
