import { levelProgress } from '@allezrobert/shared';
import { loadProgress } from '../ui/garage.ts';
import { isBare, V3_DEFAULT_BIKE, V3_DEFAULT_KIT, V3_DEFAULT_SHOES, type V3Bike, type V3Gear, type V3Wheel } from './visuals.ts';

/**
 * Progression du style Beta (ex-V3) : vélos, roues et articles se gagnent au niveau du joueur (même XP et mêmes niveaux
 * que le Réel), sans crédits. Au garage, seuls les objets gagnés apparaissent ; la page Progression montre ce que chaque
 * niveau apporte (v3/progression.ts). La plupart des objets n'ont pas de niveau dans le catalogue : il est
 * calculé ici, toujours le même pour un objet donné.
 * - Vélos, roues, casques et chaussures : selon leur gain de poids et de traînée face aux objets du même type
 *   (le moins bon au niveau 1, le meilleur au niveau 50), à parts égales sur les 50 niveaux.
 * - Tenues sans effet, ou au même effet pour tous (maillots, chaussettes, gants, lunettes) : réparties à parts égales
 *   de 1 à 50 (environ 2 % du catalogue par niveau).
 * - Visage, coiffure, barbe, pièces retirées et équipement de départ : gagnés dès le niveau 1.
 */
export const V3_MAX_LEVEL = 50;
/** Niveau du meilleur objet d'un type (vélos, roues, casques) : le dernier. */
export const V3_TOP_GEAR_LEVEL = V3_MAX_LEVEL;
/** Personnage : jamais lié au niveau. */
export const V3_FREE_TYPES = new Set(['HEAD_TYPE', 'HAIR', 'FACIAL_HAIR']);

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

/** Rang d'un objet : sa perte (poids et traînée), puis une valeur stable qui départage les ex aequo. */
type Rank = { loss: number; tie: number };

/**
 * Niveau selon le rang parmi ses semblables, à parts égales : 1 pour le moins bon, V3_TOP_GEAR_LEVEL pour le meilleur.
 * Les ex aequo (77 casques du catalogue ont le même effet) sont départagés par leur identifiant, pour ne pas tomber tous
 * au même niveau.
 */
function rankLevel(own: Rank, all: readonly Rank[]): number {
  if (all.length < 2) return 1;
  const worse = all.filter(other => other.loss > own.loss || (other.loss === own.loss && other.tie < own.tie)).length;
  const share = worse / (all.length - 1);
  return Math.min(V3_TOP_GEAR_LEVEL, 1 + Math.floor(share * V3_TOP_GEAR_LEVEL));
}

/** Valeur stable dans [0, 1[ tirée d'un identifiant (répartition des tenues sans effet, ex aequo). */
function unit(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Même valeur stable pour un identifiant texte (vélos, roues). */
function textUnit(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return unit(h);
}

const memo = new WeakMap<readonly object[], Map<string, Rank[]>>();
/** Rangs des objets d'un même groupe (type de vélo, famille de roues, type d'article), calculés une fois par liste. */
function ranksOf<T extends object>(list: readonly T[], group: string, inGroup: (row: T) => boolean, rank: (row: T) => Rank | undefined): Rank[] {
  let byGroup = memo.get(list);
  if (!byGroup) memo.set(list, byGroup = new Map());
  let values = byGroup.get(group);
  if (!values) byGroup.set(group, values = list.filter(inGroup).map(rank).filter((v): v is Rank => v !== undefined));
  return values;
}

export function bikeLevel(bike: V3Bike, bikes: readonly V3Bike[]): number {
  if (bike.id === V3_DEFAULT_BIKE || bike.weightG === undefined) return 1;
  const rank = (row: V3Bike) => row.weightG === undefined ? undefined : { loss: loss(row.weightG, row.cdaBias), tie: textUnit(row.id) };
  return rankLevel(rank(bike)!, ranksOf(bikes, 'bike:' + bike.type, row => row.type === bike.type, rank));
}

export function wheelLevel(wheel: V3Wheel, wheels: readonly V3Wheel[]): number {
  const rank = (row: V3Wheel) => ({ loss: loss(row.weightG, row.cdaBias), tie: textUnit(row.id) });
  return rankLevel(rank(wheel), ranksOf(wheels, 'wheel:' + wheel.kind, row => row.kind === wheel.kind, rank));
}

const starter = new Set(Object.values(V3_DEFAULT_KIT).map(selection => selection.id));
const hasEffect = (item: V3Gear) => !!item.weightG || !!item.cdaBias;

export function gearLevel(item: V3Gear, items: readonly V3Gear[]): number {
  if (V3_FREE_TYPES.has(item.type) || isBare(item) || starter.has(item.id) || item.variant === V3_DEFAULT_SHOES) return 1;
  if (hasEffect(item)) {
    const rank = (row: V3Gear) => hasEffect(row) ? { loss: loss(row.weightG, row.cdaBias), tie: unit(row.id) } : undefined;
    const all = ranksOf(items, 'gear:' + item.type, row => row.type === item.type, rank);
    // Effets tous égaux (lunettes, chaussures) : rien à classer, réparties comme les tenues.
    const losses = all.map(row => row.loss);
    if (Math.min(...losses) < Math.max(...losses)) return rankLevel(rank(item)!, all);
  }
  return 1 + Math.floor(V3_MAX_LEVEL * unit(item.id));
}
