import { DEFAULT_BIKE, type BikeSetup } from '@allezrobert/shared';
import { mountedWheel, type V3Bike, type V3Equipment, type V3Gear, type V3Wheel } from './visuals.ts';

/**
 * Vélo roulé du style V3, d'après les caractéristiques Zwift du vélo et des accessoires portés :
 * poids total (cadre, fourche, roues, composants) et bonus de traînée (CdABias, m²), plus le poids et le bonus
 * des accessoires (casque, lunettes, chaussures, chaussettes). Même modèle que les vélos du jeu (BikeSetup) :
 * la sortie solo en style V3 roule avec ce vélo à la place de celui du garage Réel/Poly.
 */

/** Bornes de sûreté : assemblages incomplets (vélos trop légers) ou bonus cumulés extrêmes. */
const MASS_KG: readonly [number, number] = [5.5, 20];
const CDA_DELTA: readonly [number, number] = [-0.06, 0.03];
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));

export interface V3BikeEffect {
  /** Vélo roulé (masse vélo + accessoires, traînée, pneus). */
  setup: BikeSetup;
  /** Détail pour l'affichage : poids du vélo et des accessoires (kg), écart de traînée (m² et %). */
  bikeKg: number;
  gearKg: number;
  cdaDelta: number;
  dragPct: number;
}

/** Pneus selon le type de vélo Zwift (le VTT et le gravel roulent mieux hors enrobé, moins bien sur route). */
function tyreOf(type: string | undefined): BikeSetup['tyre'] {
  return type === 'vtt' ? 'mtb' : type === 'gravel' ? 'gravel' : 'road';
}

export function v3BikeEffect(equipment: V3Equipment, bikes: readonly V3Bike[], items: readonly V3Gear[], wheels: readonly V3Wheel[] = []): V3BikeEffect {
  const bike = bikes.find(row => row.id === equipment.bike);
  // Roues choisies : celles d'origine retranchées du vélo (poids et traînée), les nouvelles ajoutées ; leurs pneus.
  const wheel = mountedWheel(equipment, bike, wheels);
  const swap = wheel && bike?.wheels ? { kg: (wheel.weightG - bike.wheels.weightG) / 1000, cda: wheel.cdaBias - bike.wheels.cdaBias } : { kg: 0, cda: 0 };
  const bikeKg = bike?.weightG ? bike.weightG / 1000 + swap.kg : DEFAULT_BIKE.massKg;
  let gearKg = 0;
  let cdaDelta = (bike?.cdaBias ?? 0) + swap.cda;
  for (const selection of Object.values(equipment.kit ?? {})) {
    const item = items.find(row => row.id === selection.id);
    if (!item) continue;
    gearKg += (item.weightG ?? 0) / 1000;
    cdaDelta += item.cdaBias ?? 0;
  }
  cdaDelta = clamp(cdaDelta, CDA_DELTA);
  const massKg = Math.round(clamp(bikeKg + gearKg, MASS_KG) * 100) / 100;
  const cda = Math.round((DEFAULT_BIKE.cda + cdaDelta) * 10000) / 10000;
  const setup: BikeSetup = { ...DEFAULT_BIKE, name: bike ? bike.name : DEFAULT_BIKE.name, massKg, cda, tyre: wheel ? (wheel.kind === 'gravel' ? 'gravel' : 'road') : tyreOf(bike?.type) };
  return { setup, bikeKg, gearKg, cdaDelta, dragPct: (cdaDelta / DEFAULT_BIKE.cda) * 100 };
}

const STORE = 'ar.v3.bikeSetup';

/** Vélo roulé V3 enregistré par le garage, lu au départ d'une sortie (lecture synchrone). */
export function readV3BikeSetup(): BikeSetup | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? 'null') as BikeSetup | null;
    return value && Number.isFinite(value.massKg) && Number.isFinite(value.cda) ? { ...DEFAULT_BIKE, ...value } : undefined;
  } catch {
    return undefined;
  }
}

export function saveV3BikeSetup(setup: BikeSetup): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(setup));
  } catch { /* stockage indisponible : la sortie garde le vélo du garage Réel/Poly */ }
}
