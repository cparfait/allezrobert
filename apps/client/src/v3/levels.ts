import { levelProgress } from '@allezrobert/shared';
import { loadProgress } from '../ui/garage.ts';
import { isBare, V3_DEFAULT_BIKE, V3_DEFAULT_KIT, V3_DEFAULT_SHOES, type V3Bike, type V3Gear, type V3Wheel } from './visuals.ts';

/**
 * Niveaux du style Beta (ex-V3) : chaque vélo, paire de roues et article se débloque au niveau du joueur (même XP et
 * mêmes niveaux que le Réel), puis il est libre, sans crédits. Le catalogue de Zwift n'a pas de niveau pour la plupart
 * des articles : il est calculé ici, toujours le même pour un objet donné.
 * - Vélos, roues, casques et chaussures : selon leur gain de poids et de traînée face aux objets du même type
 *   (le moins bon au niveau 1, le meilleur au niveau 40).
 * - Tenues sans effet (maillots, chaussettes, gants, lunettes) : réparties de 1 à 50, plus nombreuses en bas.
 * - Visage, coiffure, barbe, pièces retirées et équipement de départ : libres dès le niveau 1.
 */
export const V3_TOP_GEAR_LEVEL = 40;
export const V3_MAX_LEVEL = 50;
const FREE_TYPES = new Set(['HEAD_TYPE', 'HAIR', 'FACIAL_HAIR']);

/** Niveau du joueur (progression locale, synchronisée avec le compte). */
export function playerLevel(): number {
  try {
    return levelProgress(loadProgress().xp).level;
  } catch {
    return 1;
  }
}

/** Perte relative d'un objet : 1 kg pèse comme 1/80 du système, une traînée de 0,01 m² comme 1/30 du CdA. */
const loss = (weightG = 0, cdaBias = 0) => weightG / 80000 + cdaBias / 0.3;

/** Niveau selon le rang parmi ses semblables : 1 pour le moins bon, V3_TOP_GEAR_LEVEL pour le meilleur. */
function rankLevel(value: number, all: readonly number[]): number {
  if (all.length < 2) return 1;
  const worse = all.filter(other => other > value).length;
  const share = worse / (all.length - 1);
  return 1 + Math.round((V3_TOP_GEAR_LEVEL - 1) * share ** 1.5);
}

/** Valeur stable dans [0, 1[ tirée d'un identifiant (répartition des tenues sans effet). */
function unit(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const memo = new WeakMap<readonly object[], Map<string, number[]>>();
/** Pertes des objets d'un même groupe (type de vélo, famille de roues, type d'article), calculées une fois par liste. */
function lossesOf<T extends object>(list: readonly T[], group: string, inGroup: (row: T) => boolean, value: (row: T) => number | undefined): number[] {
  let byGroup = memo.get(list);
  if (!byGroup) memo.set(list, byGroup = new Map());
  let values = byGroup.get(group);
  if (!values) byGroup.set(group, values = list.filter(inGroup).map(value).filter((v): v is number => v !== undefined));
  return values;
}

export function bikeLevel(bike: V3Bike, bikes: readonly V3Bike[]): number {
  if (bike.id === V3_DEFAULT_BIKE || bike.weightG === undefined) return 1;
  const value = (row: V3Bike) => row.weightG === undefined ? undefined : loss(row.weightG, row.cdaBias);
  return rankLevel(value(bike)!, lossesOf(bikes, 'bike:' + bike.type, row => row.type === bike.type, value));
}

export function wheelLevel(wheel: V3Wheel, wheels: readonly V3Wheel[]): number {
  const value = (row: V3Wheel) => loss(row.weightG, row.cdaBias);
  return rankLevel(value(wheel), lossesOf(wheels, 'wheel:' + wheel.kind, row => row.kind === wheel.kind, value));
}

const starter = new Set(Object.values(V3_DEFAULT_KIT).map(selection => selection.id));
const hasEffect = (item: V3Gear) => !!item.weightG || !!item.cdaBias;

export function gearLevel(item: V3Gear, items: readonly V3Gear[]): number {
  if (FREE_TYPES.has(item.type) || isBare(item) || starter.has(item.id) || item.variant === V3_DEFAULT_SHOES) return 1;
  if (hasEffect(item)) {
    const value = (row: V3Gear) => hasEffect(row) ? loss(row.weightG, row.cdaBias) : undefined;
    return rankLevel(value(item)!, lossesOf(items, 'gear:' + item.type, row => row.type === item.type, value));
  }
  return 1 + Math.floor((V3_MAX_LEVEL - 1) * unit(item.id) ** 2);
}

/** Libellé d'un objet verrouillé. */
export const lockedText = (level: number) => '🔒 niv. ' + level;
