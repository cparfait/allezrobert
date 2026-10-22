import { COSMETICS, levelProgress, xpForRide, type CosmeticItem, type CosmeticSlot } from '@allezrobert/shared';
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
    if (raw) return { xp: 0, equipped: {}, ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    // Progression illisible : on repart de zéro plutôt que de bloquer le jeu.
  }
  return { xp: 0, equipped: {} };
}

function saveProgress(p: Progress): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/**
 * Crédite l'XP d'une sortie ; renvoie le gain, le niveau et les nouveaux déblocages. `already` :
 * partie déjà créditée (sortie reprise puis terminée à nouveau), seul le surplus compte.
 */
export function awardRide(
  ride: { distanceM: number; elevationM: number; movingS: number },
  already?: { distanceM: number; elevationM: number; movingS: number },
): { gained: number; total: number; level: number; progress: number; levelUp: boolean; unlocked: CosmeticItem[] } {
  const p = loadProgress();
  const before = levelProgress(p.xp).level;
  const total = xpForRide(ride);
  const gained = Math.max(0, total - (already ? xpForRide(already) : 0));
  p.xp += gained;
  saveProgress(p);
  const lp = levelProgress(p.xp);
  const after = lp.level;
  return { gained, total, level: after, progress: lp.progress, levelUp: after > before, unlocked: COSMETICS.filter((c) => c.level > before && c.level <= after) };
}

/** Ajoute de l'XP (trophées) ; renvoie niveau et progression après coup. */
export function addXp(xp: number): { level: number; progress: number } {
  const p = loadProgress();
  p.xp += Math.max(0, Math.round(xp));
  saveProgress(p);
  const lp = levelProgress(p.xp);
  return { level: lp.level, progress: lp.progress };
}

export const SLOT_LABEL: Record<CosmeticSlot, { fr: string; en: string }> = {
  jersey: { fr: 'Maillot', en: 'Jersey' },
  helmet: { fr: 'Casque', en: 'Helmet' },
  bike: { fr: 'Vélo', en: 'Bike' },
  wheels: { fr: 'Roues', en: 'Wheels' },
  socks: { fr: 'Chaussettes', en: 'Socks' },
  glasses: { fr: 'Lunettes', en: 'Glasses' },
};

/** Équipe un cosmétique débloqué ; les cosmétiques à couleur s'appliquent à l'avatar. */
export function equipItem(item: CosmeticItem, s: Settings): void {
  const p = loadProgress();
  p.equipped[item.slot] = item.id;
  saveProgress(p);
  if (item.color) {
    if (item.slot === 'jersey') s.look = { ...s.look, jersey: item.color };
    if (item.slot === 'helmet') s.look = { ...s.look, helmet: item.color };
    if (item.slot === 'bike') s.look = { ...s.look, bike: item.color };
    if (item.slot === 'socks') s.look = { ...s.look, socks: item.color };
  }
  saveSettings(s);
}
