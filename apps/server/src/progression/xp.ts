/**
 * Progression : XP, niveaux et déblocages cosmétiques.
 *
 * XP d'une sortie (invités exclus) :
 *   xp = 20 × km + 1 × m de dénivelé positif + 2 × minutes en mouvement
 * plafonné à 4 000 XP par sortie (anti-abus), arrondi à l'entier.
 * Exemple : 30 km, 300 m D+, 60 min → 600 + 300 + 120 = 1 020 XP.
 *
 * Niveaux : XP cumulée pour atteindre le niveau L (L ≥ 1) = 250 × L × (L − 1).
 *   niveau 2 = 500 XP, niveau 5 = 5 000 XP, niveau 10 = 22 500 XP, niveau 30 = 217 500 XP.
 * Niveau maximal : 50.
 */
import catalogJson from './cosmetics.json' with { type: 'json' };

export const MAX_LEVEL = 50;
export const MAX_XP_PER_RIDE = 4000;

export interface RideXpInput {
  distanceM: number;
  elevationM: number;
  movingS: number;
}

export function xpForRide(r: RideXpInput): number {
  const km = Math.max(0, r.distanceM) / 1000;
  const elev = Math.max(0, r.elevationM);
  const min = Math.max(0, r.movingS) / 60;
  return Math.min(MAX_XP_PER_RIDE, Math.round(20 * km + elev + 2 * min));
}

export function xpForLevel(level: number): number {
  const l = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return 250 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  // Inverse de 250·L·(L−1) = xp : L = (1 + √(1 + 4·xp/250)) / 2
  const l = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 250)) / 2);
  return Math.min(Math.max(l, 1), MAX_LEVEL);
}

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
  return {
    xp,
    level,
    levelXp,
    nextLevelXp: next,
    progress: next === null ? 1 : (xp - levelXp) / (next - levelXp),
  };
}

export type CosmeticSlot = 'jersey' | 'helmet' | 'bike' | 'socks' | 'glasses' | 'wheels';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: { fr: string; en: string };
  /** Niveau requis. */
  level: number;
  /** Couleur principale proposée (le jeu reste maître du rendu). */
  color?: string;
}

export interface CosmeticCatalog {
  version: number;
  items: CosmeticItem[];
}

export const COSMETICS: CosmeticCatalog = catalogJson as CosmeticCatalog;

export function unlockedCosmetics(level: number, catalog: CosmeticCatalog = COSMETICS): CosmeticItem[] {
  return catalog.items.filter((i) => i.level <= level);
}

/** Vérifie que chaque objet équipé existe, correspond à l'emplacement et est débloqué. */
export function validateEquipped(equipped: Record<string, string>, level: number, catalog: CosmeticCatalog = COSMETICS): string | null {
  for (const [slot, id] of Object.entries(equipped)) {
    const item = catalog.items.find((i) => i.id === id);
    if (!item) return `Cosmétique inconnu : ${id}`;
    if (item.slot !== slot) return `${id} ne va pas dans l'emplacement ${slot}`;
    if (item.level > level) return `${id} se débloque au niveau ${item.level}`;
  }
  return null;
}
