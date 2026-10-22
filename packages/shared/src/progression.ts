/**
 * Progression partagée client / serveur : XP, niveaux, catalogue de cosmétiques.
 *
 * XP d'une sortie (invités exclus) : 20 × km + 1 × m de D+ + 2 × minutes en mouvement,
 * plafonnée à 4 000 XP par sortie. Niveau L atteint à 250 × L × (L − 1) XP ; maximum 50.
 */
import catalogJson from './cosmetics.json' with { type: 'json' };
import { BIKES, migrateBikeId } from './bikes.ts';

export const MAX_LEVEL = 50;
export const MAX_XP_PER_RIDE = 4000;

export function xpForRide(r: { distanceM: number; elevationM: number; movingS: number }): number {
  const km = Math.max(0, r.distanceM) / 1000;
  return Math.min(MAX_XP_PER_RIDE, Math.round(20 * km + Math.max(0, r.elevationM) + (2 * Math.max(0, r.movingS)) / 60));
}

export function xpForLevel(level: number): number {
  const l = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return 250 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  const l = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 250)) / 2);
  return Math.min(Math.max(l, 1), MAX_LEVEL);
}

export function levelProgress(xp: number): { level: number; progress: number; nextLevelXp: number | null } {
  const level = levelForXp(xp);
  const cur = xpForLevel(level);
  const next = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
  return { level, progress: next === null ? 1 : (xp - cur) / (next - cur), nextLevelXp: next };
}

export type CosmeticSlot = 'jersey' | 'helmet' | 'bike' | 'socks' | 'glasses' | 'wheels';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: { fr: string; en: string };
  level: number;
  color?: string;
  /** Vélos : couleurs de la livrée (vignette du garage). */
  colors?: string[];
}

/** Cosmétiques de cosmetics.json, puis les vélos du catalogue (bikes.json) dans l'emplacement « bike ». */
export const COSMETICS: CosmeticItem[] = [
  ...(catalogJson as { items: CosmeticItem[] }).items,
  ...BIKES.map((b): CosmeticItem => ({ id: b.id, slot: 'bike', name: { fr: b.name, en: b.name }, level: b.level, color: b.livery.colors[0], colors: b.livery.colors })),
];

/** Identifiant à jour d'un cosmétique équipé (anciens vélos du garage → modèles du catalogue). */
export function migrateCosmeticId(slot: string, id: string): string {
  return slot === 'bike' ? migrateBikeId(id) : id;
}

export function unlockedCosmetics(level: number): CosmeticItem[] {
  return COSMETICS.filter((c) => c.level <= level);
}
