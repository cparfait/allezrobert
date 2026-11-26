/**
 * Le Grand Nord robertien (mode Poly) : données du monde pour le client (généré par tools/grand-nord, voir
 * docs/GRAND_NORD.md). Fjords, massif enneigé du Storfjell et glacier de Robert, toundra rousse du haut-plateau de
 * Vidda et des Mille-Lacs, forêts d'épicéas dans les vallées, villages de bois rouges, jaunes et blancs.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { grandNordNoFence, grandNordSites } from './grand-nordSites.ts';

/** Maisons de bois peintes : rouge de Falun, ocre jaune, blanc ; toits sombres, parfois de tourbe. */
const WOOD_WALLS = ['#a8322d', '#b23b2c', '#9e2f2a', '#e2b54a', '#d9a73f', '#f1efe6', '#ece9df', '#7f98a6'] as const;
const ROOFS = ['#3b3d3f', '#2f3236', '#4a3b33', '#5d6b3a', '#3b3d3f', '#6b2f2a'] as const;

/** Toits pentus et débordants, bois peint (sans toucher aux églises, tours, tribunes ni hangars du port). */
function grandNordBuilding(b: TileBuilding): TileBuilding {
  if (!['house', 'farm', 'barn', 'apartments', 'commercial', 'public'].includes(b.kind) || b.pts.length < 6) return b;
  let x = 0;
  let z = 0;
  for (let i = 0; i < b.pts.length; i += 2) {
    x += b.pts[i]!;
    z += b.pts[i + 1]!;
  }
  x /= b.pts.length / 2;
  z /= b.pts.length / 2;
  const r = rng(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663));
  // Petit côté de l'emprise : le toit pentu (≈ 45°) en dépend.
  const ex = Math.hypot(b.pts[2]! - b.pts[0]!, b.pts[3]! - b.pts[1]!);
  const ez = Math.hypot(b.pts[4]! - b.pts[2]!, b.pts[5]! - b.pts[3]!);
  const span = Math.min(ex, ez);
  const roofHeight = Math.max(b.roofHeight ?? 0, span * (0.42 + r() * 0.12));
  const roofColour = ROOFS[Math.floor(r() * ROOFS.length)]!;
  return {
    ...b,
    roof: b.kind === 'apartments' && span > 14 ? b.roof : 'gabled',
    roofHeight,
    roofColour,
    roofOverhang: 0.35,
    material: 'wood',
    colour: b.colour && WOOD_WALLS.includes(b.colour as (typeof WOOD_WALLS)[number]) ? b.colour : WOOD_WALLS[Math.floor(r() * WOOD_WALLS.length)]!,
  };
}

export const GRAND_NORD: PolyLand = {
  world: {
    id: 'grand-nord',
    title: { fr: 'Le Grand Nord robertien', en: 'Robert’s Far North' },
    hint: { fr: 'Fjords, toundra et aurores', en: 'Fjords, tundra and northern lights' },
    map: { fr: 'Carte topographique — Le Grand Nord robertien', en: 'Topographic map — Robert’s Far North' },
    priority: [
      'decouverte-du-grand-nord', 'classique-des-fjords', 'classique-de-la-toundra', 'chrono-du-fjord', 'chrono-de-la-saumonee', 'aurores-de-nuit', 'col-du-renne', 'col-du-renne-par-nordvik',
      'anneau', 'criterium-de-nordrobert', 'promenade-de-port-boreal', 'route-du-bac', 'montee-de-fjellheim', 'gorges-de-la-renne', 'tour-du-grand-nord', 'grand-tour-du-col',
      'haut-plateau-de-vidda', 'route-des-pecheurs', 'gravel-de-vidda', 'gravel-des-mille-lacs', 'cyclo-cross-de-la-toundra', 'bike-park-de-fjellheim', 'descente-du-renne', 'vtt-des-lemmings',
    ],
    places: [
      { x: -438, z: 8891, label: 'Port-Boréal', labelEn: 'Port-Boréal', route: 'promenade-de-port-boreal', gravel: 'classique-de-la-toundra' },
      { x: -2600, z: 1200, label: 'Nordrobert', labelEn: 'Nordrobert', route: 'decouverte-du-grand-nord', gravel: 'gravel-de-la-saumonee', mtb: 'vtt-des-bouleaux' },
      { x: -6900, z: 3700, label: 'Le Circuit', labelEn: 'The Circuit', route: 'anneau', gravel: 'classique-de-la-toundra' },
      { x: 2933, z: -6513, label: 'Col du Renne', labelEn: 'Reindeer Pass', route: 'col-du-renne', mtb: 'descente-du-renne' },
      { x: 1600, z: -6900, label: 'Belvédère des Aurores', labelEn: 'Northern Lights lookout', route: 'aurores-de-nuit', mtb: 'vtt-de-la-dent-du-renne' },
      { x: -478, z: -9710, label: 'Nordvik', labelEn: 'Nordvik', route: 'col-du-renne-par-nordvik' },
      { x: 5637, z: -8989, label: 'Isbrevik et le glacier', labelEn: 'Isbrevik and the glacier', route: 'chrono-du-fjord' },
      { x: -8300, z: -5300, label: 'Fjellheim', labelEn: 'Fjellheim', route: 'montee-de-fjellheim', mtb: 'bike-park-de-fjellheim' },
      { x: -5600, z: -2500, label: 'Le Grand Lac', labelEn: 'The Great Lake', route: 'voie-verte-du-grand-lac', mtb: 'vtt-du-grand-lac' },
      { x: 7600, z: 3700, label: 'Les Gorges', labelEn: 'The Gorges', route: 'gorges-de-la-renne', mtb: 'vtt-des-gorges' },
      { x: 11800, z: -600, label: 'Vidda', labelEn: 'Vidda', route: 'haut-plateau-de-vidda', gravel: 'gravel-de-vidda' },
      { x: 14200, z: -3820, label: 'Le Bac', labelEn: 'The Ferry', route: 'route-du-bac' },
      { x: 10141, z: 9260, label: 'Skarvik', labelEn: 'Skarvik', route: 'route-des-pecheurs', gravel: 'chemin-des-pecheurs', mtb: 'vtt-de-skarvik' },
      { x: 3800, z: 5600, label: 'Les Mille-Lacs', labelEn: 'Thousand Lakes', route: 'baie-et-mille-lacs', gravel: 'gravel-des-mille-lacs', mtb: 'cyclo-cross-de-la-toundra' },
      { x: -12300, z: 900, label: 'Granlia', labelEn: 'Granlia', route: 'chrono-de-la-saumonee', gravel: 'gravel-de-la-saumonee' },
      { x: -13741, z: 4885, label: 'Myrbu', labelEn: 'Myrbu', route: 'marais-de-myrbu', gravel: 'gravel-des-marais' },
    ],
    discover: [
      { id: 'belvedere', name: { fr: 'Le Belvédère des Aurores', en: 'Northern Lights lookout' }, x: 1600, z: -6900, r: 180 },
      { id: 'col-du-renne', name: { fr: 'Le Col du Renne', en: 'Reindeer Pass' }, x: 2933, z: -6513, r: 170 },
      { id: 'lac-du-renne', name: { fr: 'Le Lac du Renne', en: 'Reindeer Lake' }, x: 3750, z: -5450, r: 380 },
      { id: 'glacier', name: { fr: 'Le Front du glacier de Robert', en: 'Robert Glacier snout' }, x: 5130, z: -7330, r: 450 },
      { id: 'galerie', name: { fr: 'La Galerie paravalanche', en: 'Avalanche gallery' }, x: 2799, z: -6994, r: 160 },
      { id: 'grand-fjord', name: { fr: 'Le fond du Grand Fjord', en: 'Head of the Great Fjord' }, x: -5900, z: -5900, r: 700 },
      { id: 'bac', name: { fr: 'Le Bac du fjord', en: 'Fjord ferry' }, x: 14196, z: -3825, r: 450 },
      { id: 'phare', name: { fr: 'Le Phare du Cap Boréal', en: 'Cape Boréal lighthouse' }, x: 18019, z: 1445, r: 250 },
      { id: 'station-meteo', name: { fr: 'La Station météo de Vidda', en: 'Vidda weather station' }, x: 12700, z: -1700, r: 280 },
      { id: 'eglise-du-lac', name: { fr: "L'Église en bois du Lac", en: 'Lake stave church' }, x: -5000, z: -3700, r: 300 },
      { id: 'grand-lac', name: { fr: 'Le Grand Lac', en: 'The Great Lake' }, x: -5600, z: -1600, r: 700 },
      { id: 'bike-park', name: { fr: 'Le Bike park de Fjellheim', en: 'Fjellheim bike park' }, x: -7650, z: -4750, r: 420 },
      { id: 'circuit', name: { fr: 'Le Circuit du Grand Nord', en: 'Far North circuit' }, x: -6900, z: 3700, r: 420 },
      { id: 'cyclo-cross', name: { fr: 'Le Cyclo-cross de la Toundra', en: 'Tundra cyclocross' }, x: 5000, z: 4300, r: 380 },
      { id: 'gorges', name: { fr: 'Les Gorges de la Renne', en: 'Renne gorges' }, x: 6900, z: -300, r: 450 },
      { id: 'lac-de-vidda', name: { fr: 'Le Lac de Vidda et ses rennes', en: 'Vidda lake and its reindeer' }, x: 9500, z: 0, r: 500 },
      { id: 'fumoir', name: { fr: 'Le Fumoir à saumon', en: 'Salmon smokehouse' }, x: -12800, z: 4600, r: 260 },
      { id: 'lagune', name: { fr: 'La Lagune des Cygnes', en: 'Swan lagoon' }, x: -12620, z: 7252, r: 900 },
      { id: 'promenade', name: { fr: 'La Promenade de Port-Boréal', en: 'Port-Boréal boardwalk' }, x: -438, z: 8650, r: 500 },
      { id: 'skarvik', name: { fr: 'Les Cabanes sur pilotis de Skarvik', en: 'Skarvik stilt cabins' }, x: 10300, z: 9400, r: 450 },
      { id: 'nordvik', name: { fr: 'Le Port de Nordvik', en: 'Nordvik harbour' }, x: -495, z: -10047, r: 400 },
      { id: 'nordrobert', name: { fr: 'La place de Nordrobert', en: 'Nordrobert square' }, x: -2600, z: 1200, r: 130 },
    ],
    foundKey: 'ar.found.grand-nord',
    tour: { fr: 'Tour du Grand Nord', en: 'Tour of the Far North' },
    tags: { coast: 'promenade-de-port-boreal', ring: 'anneau', climb: 'col-du-renne' },
  },
  theme: {
    ground: {
      spring: { forest: '#30503a', field: '#7c9650', field2: '#93a05c', meadow: '#867c52', urban: '#bab6aa', dirt: '#76604a' },
      summer: { forest: '#2f4d33', field: '#6f8f4a', field2: '#8a9a55', meadow: '#8f8150', urban: '#b9b4a6', dirt: '#7a6248' },
      autumn: { forest: '#2c4a30', field: '#8d8a4a', field2: '#a37a3c', meadow: '#a8653a', urban: '#b5afa1', dirt: '#7a5a40' },
      winter: { forest: '#2f4536', field: '#c9cfd2', field2: '#d4d8da', meadow: '#cfd5d8', urban: '#c8c8c4', dirt: '#9a9590' },
    },
    sand: ['#8f8d84', '#b3ae9f'],
    rock: '#5f6266',
    snowLine: { spring: 450, summer: 650, autumn: 500, winter: 0 },
    frost: { spring: 0.3, summer: 0, autumn: 0.05, winter: 0.9 },
    leaves: {
      spring: ['#355536', '#46683e', '#5a7a44'],
      summer: ['#2e4a30', '#3a5a36', '#45663c'],
      autumn: ['#2e4a30', '#b8862e', '#8a3f25'],
      winter: ['#2b4030', '#33493a', '#e8ecef'],
    },
    treelineM: 450,
    water: '#4a6878',
  },
  ring: { x: -6900, z: 3700, half: 560, radius: 215 },
  sites: grandNordSites,
  building: grandNordBuilding,
  noFence: grandNordNoFence,
};
