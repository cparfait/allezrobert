/**
 * Progression partagée client / serveur : XP, niveaux, catalogue de cosmétiques.
 *
 * XP d'une sortie (invités exclus) : 20 × km + 1 × m de D+ + 2 × minutes en mouvement,
 * plafonnée à 4 000 XP par sortie. Niveau L atteint à 250 × L × (L − 1) XP ; maximum 50.
 */
import catalogJson from './cosmetics.json' with { type: 'json' };
import { DEFAULT_BIKE, type BikeSetup } from './rider.ts';

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

/** Effet d'un équipement sur la physique (relatif au vélo route aluminium par défaut). */
export interface CosmeticPhysics {
  /** Masse ajoutée (kg, négative si plus léger). */
  massKg?: number;
  /** Multiplicateur de CdA. */
  cdaFactor?: number;
  /** Moment d'inertie des deux roues (kg·m²), remplace la valeur du vélo. */
  wheelInertia?: number;
  /** Multiplicateur de Crr sur enrobé. */
  crrFactor?: number;
  tyre?: 'road' | 'gravel';
}

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: { fr: string; en: string };
  level: number;
  color?: string;
  physics?: CosmeticPhysics;
  /** Ce que l'équipement change (affiché au garage). */
  effect?: { fr: string; en: string };
}

export const COSMETICS: CosmeticItem[] = (catalogJson as { items: CosmeticItem[] }).items;

export function unlockedCosmetics(level: number): CosmeticItem[] {
  return COSMETICS.filter((c) => c.level <= level);
}

/**
 * Vélo réellement roulé selon l'équipement porté : masse, CdA, Crr et inertie des roues.
 * Les équipements sans effet physique (maillot, lunettes…) ne changent rien.
 */
export function bikeSetupFor(equipped: Partial<Record<CosmeticSlot, string>>, base: BikeSetup = DEFAULT_BIKE): BikeSetup {
  const bike: BikeSetup = { ...base };
  const names: string[] = [];
  for (const id of Object.values(equipped)) {
    const item = COSMETICS.find((c) => c.id === id);
    const ph = item?.physics;
    if (!item || !ph) continue;
    if (ph.massKg) bike.massKg += ph.massKg;
    if (ph.cdaFactor) bike.cda *= ph.cdaFactor;
    if (ph.crrFactor) bike.crr *= ph.crrFactor;
    if (ph.wheelInertia) bike.wheelInertia = ph.wheelInertia;
    if (ph.tyre) bike.tyre = ph.tyre;
    if (item.slot === 'bike') names.unshift(item.name.fr);
  }
  if (names.length) bike.name = names[0] as string;
  bike.massKg = Math.round(bike.massKg * 100) / 100;
  return bike;
}
