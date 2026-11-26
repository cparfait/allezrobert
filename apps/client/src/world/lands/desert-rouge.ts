/**
 * Le Désert rouge (mode Poly) : données du monde pour le client (généré par tools/desert-rouge, voir
 * docs/DESERT_ROUGE.md). Plateau désertique bordé de falaises rouges, canyon de l'Oued Rouge, mesas et buttes, Grand
 * Erg, Chott Blanc (lac salé à sec), oasis et palmeraies, villages en terre crue, Citadelle Rouge, col des Vents.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { DESERT_RING, desertRougeNoFence, desertRougeSites } from './desert-rougeSites.ts';

/** Terre crue : murs ocre, terrasses à peine plus claires ou plus sombres ; chaux blanche au bord de la mer. */
const EARTH = ['#c98b55', '#d29a62', '#b97a4a', '#dcae7a', '#c4834e', '#e0b88a', '#cf9466', '#b56f45'] as const;

function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

/** Toits plats en terrasse, de la couleur des murs ; hangars des tribunes remplacés par de vrais gradins (décor). */
function desertBuilding(b: TileBuilding): TileBuilding {
  // Tribunes du Circuit du Chott (générateur) : remplacées par les gradins du décor.
  if (b.kind === 'industrial' && Math.abs(b.pts[0]! - DESERT_RING.x) < 100 && Math.abs(b.pts[1]! - (DESERT_RING.z + DESERT_RING.radius + 24)) < 12) return { ...b, pts: [] };
  if (b.roof !== 'flat' || b.pts.length < 6) return b;
  let x = 0;
  let z = 0;
  for (let i = 0; i < b.pts.length; i += 2) {
    x += b.pts[i]!;
    z += b.pts[i + 1]!;
  }
  x /= b.pts.length / 2;
  z /= b.pts.length / 2;
  const r = rng(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663));
  const colour = b.colour ?? EARTH[Math.floor(r() * EARTH.length)]!;
  const white = Number.parseInt(colour.slice(1, 3), 16) > 225;
  return {
    ...b,
    colour,
    material: b.material === 'stone' ? 'stone' : 'plaster',
    roofColour: shade(colour, white ? 0.97 : 0.9 + r() * 0.14),
    roofOverhang: 0,
    // Hauteurs un peu inégales d'une maison à l'autre (terrasses décalées).
    height: b.kind === 'house' ? b.height * (0.92 + r() * 0.16) : b.height,
  };
}

export const DESERT_ROUGE: PolyLand = {
  world: {
    id: 'desert-rouge',
    title: { fr: 'Le Désert rouge', en: 'The Red Desert' },
    hint: { fr: 'Canyons, mesas et oasis', en: 'Canyons, mesas and oases' },
    map: { fr: 'Carte topographique — Le Désert rouge', en: 'Topographic map — The Red Desert' },
    priority: [
      'decouverte-du-desert', 'classique-des-canyons', 'classique-des-dunes', 'chrono-de-la-piste-droite', 'mesa-de-nuit', 'col-des-vents', 'circuit-du-chott',
      'route-du-canyon', 'corniche-du-canyon', 'promenade-de-port-corail', 'pic-du-vautour', 'col-par-port-vent', 'montee-de-la-grande-mesa', 'criterium-de-rocherouge',
      'tour-du-desert', 'golfe-et-oasis', 'plateau-du-ksar', 'gravel-de-la-mesa', 'gravel-de-la-palmeraie', 'cyclo-cross-des-sables',
      'bike-park-des-buttes', 'descente-du-vautour', 'vtt-des-arches',
    ],
    places: [
      { x: -2600, z: 1200, label: 'Rocherouge', labelEn: 'Rocherouge', route: 'decouverte-du-desert', gravel: 'cyclo-cross-des-sables' },
      { x: -438, z: 8891, label: 'Port-Corail', labelEn: 'Port-Corail', route: 'promenade-de-port-corail', gravel: 'grande-traversee' },
      { x: -5600, z: -2500, label: 'Circuit du Chott', labelEn: 'Salt lake circuit', route: 'circuit-du-chott', gravel: 'gravel-des-buttes' },
      { x: -5600, z: -800, label: 'Puits-Salé', labelEn: 'Puits-Salé', route: 'tour-du-chott' },
      { x: -10320, z: -3380, label: 'Grande Mesa', labelEn: 'Great Mesa', route: 'mesa-de-nuit', gravel: 'gravel-de-la-mesa' },
      { x: -12300, z: 900, label: 'Sablons', labelEn: 'Sablons', route: 'chrono-de-la-piste-droite', gravel: 'classique-des-dunes' },
      { x: -9900, z: 4700, label: 'Oasis des Dunes', labelEn: 'Dunes oasis', route: 'route-des-dunes', gravel: 'classique-des-dunes' },
      { x: -13774, z: 4897, label: 'Les Salines', labelEn: 'Les Salines', route: 'lagune-et-salines', gravel: 'chemin-de-la-pointe' },
      { x: -900, z: -2900, label: 'Buttes Rouges', labelEn: 'Red Buttes', route: 'decouverte-du-desert', gravel: 'gravel-des-buttes', mtb: 'bike-park-des-buttes' },
      { x: -3200, z: -4100, label: 'Les Arches', labelEn: 'Stone arches', route: 'tour-du-chott', mtb: 'vtt-des-arches' },
      { x: 2933, z: -6513, label: 'Col des Vents', labelEn: 'Wind Pass', route: 'col-des-vents', mtb: 'descente-du-vautour' },
      { x: 1600, z: -6900, label: 'Pic du Vautour', labelEn: 'Vulture Peak', route: 'pic-du-vautour', mtb: 'vtt-de-la-dent-rouge' },
      { x: -483, z: -9801, label: 'Port-Vent', labelEn: 'Port-Vent', route: 'col-par-port-vent', mtb: 'vtt-des-monts-de-braise' },
      { x: 2700, z: -2700, label: 'Les Cairns', labelEn: 'Les Cairns', route: 'route-du-canyon', mtb: 'descente-du-vautour' },
      { x: 7000, z: 300, label: 'Le Canyon', labelEn: 'The Canyon', route: 'classique-des-canyons', mtb: 'vtt-du-canyon' },
      { x: 11800, z: -600, label: 'Ksar-Rouge', labelEn: 'Ksar-Rouge', route: 'plateau-du-ksar', gravel: 'gravel-du-plateau', mtb: 'vtt-du-canyon' },
      { x: 10171, z: 9287, label: 'Cap-Brique', labelEn: 'Cap-Brique', route: 'corniche-des-falaises', gravel: 'chemin-des-falaises', mtb: 'vtt-des-falaises' },
      { x: 3800, z: 5600, label: 'L’Oasis', labelEn: 'The Oasis', route: 'golfe-et-oasis', gravel: 'gravel-de-la-palmeraie' },
    ],
    discover: [
      { id: 'observatoire', name: { fr: "L'Observatoire du Pic du Vautour", en: 'Vulture Peak observatory' }, x: 1600, z: -6900, r: 180 },
      { id: 'col-des-vents', name: { fr: 'Le Col des Vents', en: 'Wind Pass' }, x: 2933, z: -6513, r: 170 },
      { id: 'guelta', name: { fr: 'La Guelta du Vautour', en: 'Vulture rock pool' }, x: 3750, z: -5450, r: 350 },
      { id: 'dent-rouge', name: { fr: 'Le Cairn de la Dent Rouge', en: 'Red Tooth cairn' }, x: 4580, z: -5920, r: 260 },
      { id: 'citadelle', name: { fr: 'La Citadelle Rouge', en: 'Red Citadel' }, x: 12300, z: -1300, r: 300 },
      { id: 'canyon', name: { fr: "Le Canyon de l'Oued Rouge", en: 'Red Wadi canyon' }, x: 6900, z: -300, r: 450 },
      { id: 'chott', name: { fr: 'Le Chott Blanc', en: 'White salt lake' }, x: -6900, z: -2300, r: 900 },
      { id: 'grande-mesa', name: { fr: 'Mesa-Haute, sur la Grande Mesa', en: 'Mesa-Haute on the Great Mesa' }, x: -10320, z: -3380, r: 300 },
      { id: 'buttes', name: { fr: 'Les Buttes Rouges', en: 'Red Buttes' }, x: -600, z: -3200, r: 450 },
      { id: 'arches', name: { fr: 'Les Arches de pierre', en: 'Stone arches' }, x: -3350, z: -4300, r: 350 },
      { id: 'source', name: { fr: "La Source de l'Oasis", en: 'Oasis spring' }, x: 4220, z: 6030, r: 300 },
      { id: 'oasis-des-dunes', name: { fr: "L'Oasis des Dunes", en: 'Dunes oasis' }, x: -9900, z: 4700, r: 300 },
      { id: 'grand-erg', name: { fr: 'Le Grand Erg', en: 'Great Erg' }, x: -10000, z: 4300, r: 1200 },
      { id: 'piste-droite', name: { fr: 'La Piste Droite', en: 'The Straight Road' }, x: -7650, z: 1050, r: 500 },
      { id: 'caravanserail', name: { fr: 'Le Caravansérail du Chott', en: 'Salt lake caravanserai' }, x: -3300, z: -1500, r: 250 },
      { id: 'lagune', name: { fr: 'La Lagune des Flamants', en: 'Flamingo lagoon' }, x: -12560, z: 7218, r: 900 },
      { id: 'promenade', name: { fr: 'La Promenade de Port-Corail', en: 'Port-Corail promenade' }, x: -438, z: 8650, r: 500 },
      { id: 'cap-brique', name: { fr: 'Le Port de Cap-Brique', en: 'Cap-Brique harbour' }, x: 10424, z: 9518, r: 400 },
      { id: 'port-vent', name: { fr: 'Le Port de Port-Vent', en: 'Port-Vent harbour' }, x: -499, z: -10138, r: 400 },
      { id: 'mesa-du-lion', name: { fr: 'La Mesa du Lion', en: 'Lion Mesa' }, x: 1300, z: 2700, r: 500 },
      { id: 'rocherouge', name: { fr: 'La place de Rocherouge', en: 'Rocherouge square' }, x: -2600, z: 1200, r: 130 },
    ],
    foundKey: 'ar.found.desert-rouge',
    tour: { fr: 'Tour du Désert rouge', en: 'Tour of the Red Desert' },
    tags: { coast: 'promenade-de-port-corail', ring: 'circuit-du-chott', climb: 'col-des-vents' },
  },
  theme: {
    ground: {
      spring: { forest: '#5e6b3a', field: '#3f5f2c', field2: '#71803c', meadow: '#c47a45', urban: '#ece3d2', dirt: '#a8562e' },
      summer: { forest: '#5a6436', field: '#3c5a2a', field2: '#7a7f3e', meadow: '#c8804a', urban: '#efe6d5', dirt: '#ad5a30' },
      autumn: { forest: '#5f6337', field: '#405a2c', field2: '#86803e', meadow: '#c27644', urban: '#ece2d0', dirt: '#a5532d' },
      winter: { forest: '#59603a', field: '#3e5a2e', field2: '#6f7a40', meadow: '#bb7444', urban: '#e9e0d0', dirt: '#9f522e' },
    },
    sand: ['#c46f42', '#e0955a'],
    rock: '#9c4a2c',
    snowLine: { spring: 99999, summer: 99999, autumn: 99999, winter: 99999 },
    frost: { spring: 0, summer: 0, autumn: 0, winter: 0 },
    leaves: {
      spring: ['#6f7d44', '#83904f', '#5f6e3c'],
      summer: ['#727b42', '#878f50', '#626b3a'],
      autumn: ['#7a7a42', '#8f8a4e', '#686a3a'],
      winter: ['#6b7442', '#7f874c', '#5d673a'],
    },
    treelineM: 3000,
    water: '#2fbfbd',
  },
  ring: DESERT_RING,
  sites: desertRougeSites,
  building: desertBuilding,
  noFence: desertRougeNoFence,
};
