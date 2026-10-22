import { COSMETICS, levelProgress, migrateCosmeticId, xpForRide, type CosmeticItem, type CosmeticSlot } from '@allezrobert/shared';
import { saveSettings, type Settings } from './settings.ts';

/** Progression locale (synchronisée avec le serveur une fois connecté). */
interface Progress {
  xp: number;
  equipped: Partial<Record<CosmeticSlot, string>>;
}

const KEY = 'ar.progress';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p: Progress = { xp: 0, equipped: {}, ...(JSON.parse(raw) as Partial<Progress>) };
      // Anciens vélos du garage (bike-alu…) → modèles du catalogue.
      for (const [slot, id] of Object.entries(p.equipped)) p.equipped[slot as CosmeticSlot] = migrateCosmeticId(slot, id);
      return p;
    }
  } catch {
    // Progression illisible : on repart de zéro plutôt que de bloquer le jeu.
  }
  return { xp: 0, equipped: {} };
}

function saveProgress(p: Progress): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** Crédite l'XP d'une sortie ; renvoie le gain, le niveau et les nouveaux déblocages. */
export function awardRide(ride: { distanceM: number; elevationM: number; movingS: number }): { gained: number; level: number; levelUp: boolean; unlocked: CosmeticItem[] } {
  const p = loadProgress();
  const before = levelProgress(p.xp).level;
  const gained = xpForRide(ride);
  p.xp += gained;
  saveProgress(p);
  const after = levelProgress(p.xp).level;
  return { gained, level: after, levelUp: after > before, unlocked: COSMETICS.filter((c) => c.level > before && c.level <= after) };
}

export const SLOT_LABEL: Record<CosmeticSlot, { fr: string; en: string }> = {
  jersey: { fr: 'Maillot', en: 'Jersey' },
  helmet: { fr: 'Casque', en: 'Helmet' },
  bike: { fr: 'Vélo', en: 'Bike' },
  wheels: { fr: 'Roues', en: 'Wheels' },
  socks: { fr: 'Chaussettes', en: 'Socks' },
  glasses: { fr: 'Lunettes', en: 'Glasses' },
};

/** Équipe un cosmétique débloqué ; les cosmétiques à couleur et les vélos s'appliquent à l'avatar. */
export function equipItem(item: CosmeticItem, s: Settings): void {
  const p = loadProgress();
  p.equipped[item.slot] = item.id;
  saveProgress(p);
  if (item.color) {
    if (item.slot === 'jersey') s.look = { ...s.look, jersey: item.color };
    if (item.slot === 'helmet') s.look = { ...s.look, helmet: item.color };
  }
  if (item.slot === 'bike') s.look = { ...s.look, bikeModel: item.id };
  saveSettings(s);
}
