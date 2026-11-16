import { v3Resource } from '../engine/v3Access.ts';
import { v3Shown } from './catalogAdmin.ts';
import { bikeLevel, gearLevel, wheelLevel } from './levels.ts';
import { needsPhoto, photoKey } from './thumbnails.ts';
import { getV3Catalog, getV3Gear, isBare, itemFits, readV3Equipment, type V3Gear } from './visuals.ts';

/**
 * Récompenses du style Beta pour la page Progression : vélos, roues et articles du catalogue V3 avec le niveau qui les
 * apporte (levels.ts) et leur vignette (photo du studio, sinon icône de Zwift). Chargées une fois, en tâche de fond.
 */
export type V3RewardCat = 'bike' | 'wheel' | 'jersey' | 'helmet' | 'glasses' | 'gloves' | 'socks' | 'shoes';

export const V3_REWARD_CATS: Array<[V3RewardCat, string, string]> = [
  ['bike', 'Vélos', 'Bikes'],
  ['wheel', 'Roues', 'Wheels'],
  ['jersey', 'Maillots', 'Jerseys'],
  ['helmet', 'Casques', 'Helmets'],
  ['glasses', 'Lunettes', 'Glasses'],
  ['gloves', 'Gants', 'Gloves'],
  ['socks', 'Chaussettes', 'Socks'],
  ['shoes', 'Chaussures', 'Shoes'],
];

const GEAR_CAT: Record<string, V3RewardCat> = {
  CYCLING_JERSEY: 'jersey', HEAD_GEAR: 'helmet', GLASSES: 'glasses', GLOVES: 'gloves', SOCKS: 'socks', CYCLING_SHOES: 'shoes',
};
const TYPE_LABEL: Record<string, string> = {
  route: 'Route', chrono: 'Chrono', gravel: 'Gravel', vtt: 'VTT', cruiser: 'Ville', concept: 'Concept', tricycle: 'Tricycle', handbike: 'Handbike',
  'couché': 'Couché',
};

export interface V3Reward {
  cat: V3RewardCat;
  level: number;
  id: string;
  name: string;
  sub: string;
  image?: string;
  /** Porté ou monté par le coureur Beta. */
  worn: boolean;
}

let rewards: V3Reward[] | undefined;
let loading: Promise<void> | undefined;
let loadedSex: string | undefined;

/** Récompenses du style Beta pour cette silhouette ; `undefined` tant qu'elles se chargent (`ready` est rappelé). */
export function v3Rewards(sex: 'male' | 'female', ready: () => void): V3Reward[] | undefined {
  if (rewards && loadedSex === sex) return markWorn(rewards);
  loading ??= load(sex).then(() => ready(), error => console.warn('[Beta] progression', error)).finally(() => { loading = undefined; });
  return undefined;
}

function markWorn(list: V3Reward[]): V3Reward[] {
  const equipment = readV3Equipment();
  const worn = new Set(['bike:' + equipment.bike, 'wheel:' + (equipment.wheels ?? ''), ...Object.values(equipment.kit ?? {}).map(row => 'gear:' + row.id)]);
  for (const reward of list) reward.worn = worn.has(reward.id);
  return list;
}

async function load(sex: 'male' | 'female'): Promise<void> {
  const studio = v3Resource('studio/v6/');
  const [catalog, gear, photos] = await Promise.all([
    getV3Catalog(),
    getV3Gear(),
    fetch(studio + 'index').then(response => (response.ok ? response.json() as Promise<string[]> : [])).catch(() => [] as string[]),
  ]);
  const shot = new Set(photos);
  const photo = (key: string) => (shot.has(key) ? studio + key + '.png' : undefined);
  const name = (brand: string, model: string) => (model.toLowerCase().startsWith(brand.toLowerCase()) ? model : brand + ' ' + model).trim();
  const gearImage = (item: V3Gear) => (item.colors[0]?.preview && !needsPhoto(item) ? v3Resource('gear/' + item.id + '/thumb.png')
    : photo(photoKey(item, sex)) ?? (item.colors[0]?.preview ? v3Resource('gear/' + item.id + '/thumb.png') : undefined));
  const wheels = catalog.wheels ?? [];
  const list: V3Reward[] = [
    ...catalog.bikes.filter(bike => v3Shown('bike', bike.id)).map(bike => ({
      cat: 'bike' as const, level: bikeLevel(bike, catalog.bikes), id: 'bike:' + bike.id, name: name(bike.brand, bike.name),
      sub: TYPE_LABEL[bike.type] ?? bike.type, image: photo('bike-' + bike.id) ?? (bike.preview ? v3Resource('bike/' + bike.id + '.png') : undefined), worn: false,
    })),
    ...wheels.filter(wheel => v3Shown('wheel', wheel.id)).map(wheel => ({
      cat: 'wheel' as const, level: wheelLevel(wheel, wheels), id: 'wheel:' + wheel.id, name: name(wheel.brand, wheel.name),
      sub: (wheel.kind === 'gravel' ? 'Gravel' : wheel.kind === 'vtt' ? 'VTT' : 'Route') + ' · ' + wheel.weightG.toLocaleString('fr-FR') + ' g',
      image: wheel.preview ? v3Resource('wheel/' + wheel.id + '.png') : photo('wheel-' + wheel.id), worn: false,
    })),
    ...gear.filter(item => GEAR_CAT[item.type] && !isBare(item) && itemFits(item, sex) && v3Shown('gear', item.id)).map(item => ({
      cat: GEAR_CAT[item.type]!, level: gearLevel(item, gear), id: 'gear:' + item.id, name: item.name || item.variant,
      sub: item.category, image: gearImage(item), worn: false,
    })),
  ];
  rewards = list;
  loadedSex = sex;
}
