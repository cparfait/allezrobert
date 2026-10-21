/**
 * Progression côté serveur. Les formules (XP, niveaux) et le catalogue de cosmétiques sont
 * la source unique de packages/shared (progression.ts, cosmetics.json) ; ce module n'ajoute
 * que les aides propres au serveur (détail de niveau pour l'API, validation de l'équipement).
 */
import {
  COSMETICS as COSMETIC_ITEMS,
  MAX_LEVEL,
  levelForXp,
  unlockedCosmetics as sharedUnlocked,
  xpForLevel,
  type CosmeticItem,
} from '@allezrobert/shared';

export { MAX_LEVEL, MAX_XP_PER_RIDE, levelForXp, levelProgress, xpForLevel, xpForRide, type CosmeticItem, type CosmeticSlot } from '@allezrobert/shared';

export interface CosmeticCatalog {
  version: number;
  items: CosmeticItem[];
}

/** Catalogue tel que servi par GET /api/cosmetics. */
export const COSMETICS: CosmeticCatalog = { version: 1, items: COSMETIC_ITEMS };

export interface LevelInfo {
  xp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number | null;
  /** Avancement dans le niveau courant (0–1). */
  progress: number;
}

export function levelInfo(xp: number): LevelInfo {
  const level = levelForXp(xp);
  const levelXp = xpForLevel(level);
  const next = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
  return { xp, level, levelXp, nextLevelXp: next, progress: next === null ? 1 : (xp - levelXp) / (next - levelXp) };
}

export function unlockedCosmetics(level: number): CosmeticItem[] {
  return sharedUnlocked(level);
}

/** Vérifie que chaque objet équipé existe, correspond à l'emplacement et est débloqué. */
export function validateEquipped(equipped: Record<string, string>, level: number): string | null {
  for (const [slot, id] of Object.entries(equipped)) {
    const item = COSMETIC_ITEMS.find((i) => i.id === id);
    if (!item) return `Cosmétique inconnu : ${id}`;
    if (item.slot !== slot) return `${id} ne va pas dans l'emplacement ${slot}`;
    if (item.level > level) return `${id} se débloque au niveau ${item.level}`;
  }
  return null;
}
