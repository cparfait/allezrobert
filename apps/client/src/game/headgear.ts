import { BIKES, bikeById, tuneItem, type AvatarLook, type CapStyle } from '@allezrobert/shared';
import type { V3Equipment } from '../v3/visuals.ts';

/**
 * Couvre-chef et vélo selon la sortie (règle de jeu, trois styles) : tout le monde porte un casque ; hors course, une
 * casquette de temps en temps ; en course, casque obligatoire ; en contre-la-montre, casque chrono et vélo de chrono
 * pour tous (joueur compris). Calcul pur (testé).
 */

export type GearKind = 'ride' | 'race' | 'tt';

/** Part des coureurs en casquette hors course (rare). */
export const CAP_SHARE = 0.12;

const CAP_STYLES: readonly CapStyle[] = ['uni', 'pois', 'losanges', 'panneaux'];

/** Vélos de chrono du catalogue (saison 2026), pour les IA et le joueur en contre-la-montre. */
const TT_BIKES = BIKES.filter((b) => b.family === 'tt' && b.collection === 'saison-2026').map((b) => b.id);

/** Vélo de chrono n° i (varié, stable d'une partie à l'autre), ou undefined si le catalogue n'en a pas. */
export function ttBike(i: number): string | undefined {
  return TT_BIKES.length ? TT_BIKES[(((i * 7 + 3) % TT_BIKES.length) + TT_BIKES.length) % TT_BIKES.length] : undefined;
}

/** Roues aéro de l'atelier montées sur les vélos de chrono des IA (lenticulaire, à bâtons, jantes hautes). */
const TT_WHEELS = ['tune-wh-zipp-super9', 'tune-wh-hed-tri', 'tune-wh-zipp-808', 'tune-wh-campa-bora', 'tune-wh-enve-78', 'tune-wh-dt-arc50'];

/** Roues de chrono n° i : une fois sur sept celles d'origine du vélo (undefined), sinon une paire de l'atelier. */
export function ttWheels(i: number): string | undefined {
  const n = TT_WHEELS.length + 1;
  return TT_WHEELS[((i % n) + n) % n];
}

/** Ce qui manque à une tenue pour un contre-la-montre. */
export interface TtMissing {
  bike: boolean;
  helmet: boolean;
}

/** Matériel de chrono oublié par le joueur (vélo, roues comprises, et casque), ou null s'il est équipé. */
export function ttMissing(look: AvatarLook): TtMissing | null {
  const bike = bikeById(look.bikeModel)?.family !== 'tt';
  const helmet = !look.helmetShape || !!look.noHelmet || !!look.cap;
  return bike || helmet ? { bike, helmet } : null;
}

/**
 * Tenue d'un coureur (Réel, Poly) selon la sortie : jamais tête nue ; casquette seulement hors course, pour
 * `roll < CAP_SHARE` (tirage du coureur, 0–1) — sauf `keepCap` : la casquette choisie par le joueur est gardée hors course ;
 * en chrono, casque chrono et vélo de chrono (`bikeIndex` pour varier les modèles) ; avec `keepCap`, ceux que le joueur
 * a choisis sont gardés, seul ce qui manque est complété.
 */
export function withHeadgear(look: AvatarLook, kind: GearKind, roll: number, o: { keepCap?: boolean; bikeIndex?: number } = {}): AvatarLook {
  const { noHelmet: _bare, cap, helmetShape, ...rest } = look;
  if (kind === 'tt') {
    const own = o.keepCap ? ttMissing(look) : { bike: true, helmet: true };
    const bike = own?.bike ? ttBike(o.bikeIndex ?? Math.floor(roll * 997)) : undefined;
    // IA : roues variées d'un coureur à l'autre (celles du joueur ne changent pas).
    const wheels = o.keepCap ? undefined : ttWheels(o.bikeIndex ?? Math.floor(roll * 997));
    const tune = wheels ? { tune: [...(look.tune ?? []).filter((id) => tuneItem(id)?.slot !== 'wheelset'), wheels] } : {};
    return { ...rest, ...tune, helmetShape: (!own?.helmet && helmetShape) || 'chrono', ...(bike ? { bikeModel: bike } : {}) };
  }
  // Casque chrono hors chrono : gardé seulement si c'était le choix du joueur (keepCap vaut pour son équipement).
  const shape = o.keepCap && helmetShape ? { helmetShape } : {};
  if (kind === 'race') return { ...rest, ...shape };
  if (o.keepCap && cap) return { ...rest, cap };
  if (!o.keepCap && roll < CAP_SHARE) {
    const style = CAP_STYLES[Math.floor((roll / CAP_SHARE) * CAP_STYLES.length) % CAP_STYLES.length] as CapStyle;
    return { ...rest, cap: { style, color: look.jersey, accent: look.jerseyAccent } };
  }
  return { ...rest, ...shape };
}

/** Bêta : casque chrono S-Works TT 2020 (catalogue V3). */
export const V3_TT_HELMET = 1783;
/** Bêta : casquettes de cycliste (Rapha, Specialized, INEOS, Movistar, Le Col, Alpecin). */
export const V3_CAPS: readonly number[] = [1762, 1767, 1820, 1842, 1827, 1905];
/** Bêta : vélos de chrono 2026 (Cervélo P5, Canyon Speedmax CFR, Giant Trinity, Cube Aerium, Cannondale SuperSlice, Factor Hanzo). */
export const V3_TT_BIKES: readonly string[] = ['cervelop52026', 'canyonspeedmaxcfr2026', 'gianttrinityadvancedsl2026', 'cubeaeriumc68x2026', 'cannondalesuperslicelab712026', 'factorhanzo2026'];

/** Identifiants des couvre-chefs Bêta qui ne sont pas des casques (casquettes) : retirés en course. */
const V3_NOT_HELMET = new Set<number>(V3_CAPS);
/** Bêta : article « None » (tête nue) du catalogue. */
const V3_BARE = 1738;

/**
 * Équipement Bêta selon la sortie : en chrono, casque chrono et vélo de chrono (roues d'origine du vélo) ; en course,
 * casquette ou tête nue remplacées par le casque d'origine ; hors course, une casquette pour `roll < CAP_SHARE` (coureurs
 * du décor seulement : `keepCap` garde le choix du joueur). `bare` : identifiants « tête nue » du catalogue.
 */
export function v3WithHeadgear(eq: V3Equipment, kind: GearKind, roll: number, o: { keepCap?: boolean; bikeIndex?: number; bare?: ReadonlySet<number> } = {}): V3Equipment {
  const kit = { ...(eq.kit ?? {}) };
  const head = kit.HEAD_GEAR?.id;
  const bare = head !== undefined && (head === V3_BARE || !!o.bare?.has(head));
  const notHelmet = bare || (head !== undefined && V3_NOT_HELMET.has(head));
  if (kind === 'tt') {
    kit.HEAD_GEAR = { id: V3_TT_HELMET, color: 0 };
    const bike = V3_TT_BIKES[((o.bikeIndex ?? Math.floor(roll * 997)) % V3_TT_BIKES.length + V3_TT_BIKES.length) % V3_TT_BIKES.length] as string;
    const { wheels: _w, ...rest } = eq;
    return { ...rest, bike, color: 0, kit };
  }
  if (kind === 'race') {
    if (notHelmet) delete kit.HEAD_GEAR;
    return { ...eq, kit };
  }
  if (!o.keepCap && roll < CAP_SHARE) kit.HEAD_GEAR = { id: V3_CAPS[Math.floor((roll / CAP_SHARE) * V3_CAPS.length) % V3_CAPS.length] as number, color: 0 };
  else if (bare) delete kit.HEAD_GEAR;
  return { ...eq, kit };
}
