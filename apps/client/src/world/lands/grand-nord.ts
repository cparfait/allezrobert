/**
 * Le Grand Nord robertien (mode Poly) : données du monde pour le client (généré par tools/grand-nord, voir
 * docs/GRAND_NORD.md). Pays de montagnes en étoile, fjords qui rayonnent depuis la calotte de Robert, massif du
 * Storfjell, toundra rousse du haut-plateau de Vidda semée de lacs, strandflat et îlots au sud-ouest, villages de bois
 * rouges, jaunes et blancs au fond des fjords ; bouleaux, lande et mousses, peu d'herbe, aucun champ cultivé.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { grandNordNoFence, grandNordSites } from './grand-nordSites.ts';

/**
 * Maisons de bois peintes : rouge de Falun d'abord (une maison sur deux), ocre jaune, blanc, rares gris-bleu ; toits
 * sombres d'ardoise ou de tôle, un sur trois en tourbe herbue.
 */
const WOOD_WALLS = ['#a8322d', '#b23b2c', '#9e2f2a', '#a8322d', '#b8402f', '#e2b54a', '#d9a73f', '#f1efe6', '#ece9df', '#7f98a6'] as const;
const ROOFS = ['#3b3d3f', '#2f3236', '#4a3b33', '#5d6b3a', '#56663a', '#3b3d3f', '#6b2f2a', '#5d6b3a'] as const;

/** Tout en bois peint (jamais de brique ni de crépi) ; toits très pentus, sombres et débordants pour les maisons. */
function grandNordBuilding(b: TileBuilding): TileBuilding {
  if (b.pts.length < 6) return b;
  // Églises et chapelles de bois blanches ou brunes ; tours, hangars, tribunes : bois peint, toit inchangé.
  if (b.kind === 'church' || b.kind === 'chapel') return { ...b, material: 'wood', colour: b.colour === '#5b3a26' ? b.colour : '#f1efe6' };
  if (!['house', 'farm', 'barn', 'apartments', 'commercial', 'public', 'retail', 'detached', 'terrace', 'residential', 'school', 'hotel', 'cabin'].includes(b.kind)) {
    return { ...b, material: 'wood', colour: b.colour && WOOD_WALLS.includes(b.colour as (typeof WOOD_WALLS)[number]) ? b.colour : '#a8322d' };
  }
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
  const roofHeight = Math.max(b.roofHeight ?? 0, span * (0.55 + r() * 0.15));
  const roofColour = ROOFS[Math.floor(r() * ROOFS.length)]!;
  return {
    ...b,
    roof: b.kind === 'apartments' && span > 14 ? b.roof : 'gabled',
    roofHeight,
    roofColour,
    roofOverhang: 0.45,
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
      'route-de-la-myra', 'rive-du-grand-fjord', 'col-de-vatnby', 'haut-plateau-de-vidda', 'gravel-de-vidda', 'gravel-des-skerries', 'cyclo-cross-de-la-toundra', 'bike-park-de-fjellheim', 'descente-du-renne', 'vtt-des-lemmings',
    ],
    places: [
      { x: -8360, z: 11485, label: 'Port-Boréal', labelEn: 'Port-Boréal', route: 'promenade-de-port-boreal', gravel: 'gravel-des-skerries' },
      { x: 5000, z: 1000, label: 'Nordrobert', labelEn: 'Nordrobert', route: 'decouverte-du-grand-nord', gravel: 'gravel-de-vidda', mtb: 'vtt-de-la-dent-du-renne' },
      { x: 3000, z: 2500, label: 'Le Circuit', labelEn: 'The Circuit', route: 'anneau', gravel: 'classique-de-la-toundra' },
      { x: 3426, z: -3840, label: 'Col du Renne', labelEn: 'Reindeer Pass', route: 'col-du-renne', mtb: 'descente-du-renne' },
      { x: 2000, z: -4300, label: 'Belvédère des Aurores', labelEn: 'Northern Lights lookout', route: 'aurores-de-nuit', mtb: 'vtt-de-la-dent-du-renne' },
      { x: 5547, z: -5645, label: 'Nordvik', labelEn: 'Nordvik', route: 'col-du-renne-par-nordvik', mtb: 'vtt-des-lemmings' },
      { x: -437, z: -7719, label: 'Isbrevik et le glacier', labelEn: 'Isbrevik and the glacier', route: 'chrono-du-fjord', gravel: 'chemin-du-glacier', mtb: 'vtt-des-lemmings' },
      { x: -5193, z: -4909, label: 'Fjellheim', labelEn: 'Fjellheim', route: 'montee-de-fjellheim', mtb: 'bike-park-de-fjellheim' },
      { x: -6705, z: -384, label: 'Vatnby', labelEn: 'Vatnby', route: 'col-de-vatnby', gravel: 'gravel-des-marais', mtb: 'vtt-du-grand-fjord' },
      { x: 11001, z: -1015, label: 'Les Gorges', labelEn: 'The Gorges', route: 'gorges-de-la-renne', mtb: 'vtt-des-gorges' },
      { x: 8100, z: 1300, label: 'Vidda', labelEn: 'Vidda', route: 'haut-plateau-de-vidda', gravel: 'gravel-de-vidda', mtb: 'vtt-des-gorges' },
      { x: 13838, z: -2250, label: 'Le Bac', labelEn: 'The Ferry', route: 'route-du-bac' },
      { x: 10281, z: 5628, label: 'Skarvik', labelEn: 'Skarvik', route: 'route-de-skarvik', mtb: 'vtt-de-skarvik' },
      { x: 5900, z: 3300, label: 'Les Mille-Lacs', labelEn: 'Thousand Lakes', route: 'boucle-de-nordrobert', gravel: 'gravel-des-mille-lacs' },
      { x: 2443, z: 7168, label: 'Sørvik', labelEn: 'Sørvik', route: 'route-de-sorvik', mtb: 'vtt-des-bouleaux' },
      { x: -11605, z: 2493, label: 'Granlia', labelEn: 'Granlia', route: 'rive-du-grand-fjord', gravel: 'gravel-des-marais' },
      { x: -12392, z: 7455, label: 'Myrbu', labelEn: 'Myrbu', route: 'route-des-pecheurs', gravel: 'chemin-des-pecheurs' },
      { x: -5200, z: 6000, label: 'Vallée de la Myra', labelEn: 'Myra valley', route: 'route-de-la-myra', gravel: 'gravel-des-tourbieres' },
    ],
    discover: [
      { id: 'belvedere', name: { fr: 'Le Belvédère des Aurores', en: 'Northern Lights lookout' }, x: 2000, z: -4300, r: 180 },
      { id: 'col-du-renne', name: { fr: 'Le Col du Renne', en: 'Reindeer Pass' }, x: 3426, z: -3840, r: 170 },
      { id: 'lac-du-renne', name: { fr: 'Le Lac du Renne', en: 'Reindeer Lake' }, x: 3900, z: -2500, r: 380 },
      { id: 'glacier', name: { fr: 'Le Front du glacier de Robert', en: 'Robert Glacier snout' }, x: -620, z: -6175, r: 450 },
      { id: 'refuge', name: { fr: 'Le Refuge de la Calotte', en: 'Ice cap hut' }, x: -4600, z: -3300, r: 300 },
      { id: 'galerie', name: { fr: 'La Galerie paravalanche', en: 'Avalanche gallery' }, x: 3475, z: -3924, r: 160 },
      { id: 'bac', name: { fr: 'Le Bac du fjord', en: 'Fjord ferry' }, x: 13838, z: -2250, r: 450 },
      { id: 'phare', name: { fr: 'Le Phare du Cap Boréal', en: 'Cape Boréal lighthouse' }, x: 13220, z: 1060, r: 250 },
      { id: 'station-meteo', name: { fr: 'La Station météo de Vidda', en: 'Vidda weather station' }, x: 8900, z: 2400, r: 280 },
      { id: 'eglise-de-vatnby', name: { fr: "L'Église en bois de Vatnby", en: 'Vatnby stave church' }, x: -5900, z: 450, r: 300 },
      { id: 'bike-park', name: { fr: 'Le Bike park de Fjellheim', en: 'Fjellheim bike park' }, x: -5900, z: -4300, r: 420 },
      { id: 'circuit', name: { fr: 'Le Circuit du Grand Nord', en: 'Far North circuit' }, x: 3000, z: 2500, r: 420 },
      { id: 'cyclo-cross', name: { fr: 'Le Cyclo-cross de la Toundra', en: 'Tundra cyclocross' }, x: 6900, z: 4300, r: 380 },
      { id: 'gorges', name: { fr: 'Les Gorges de la Renne', en: 'Renne gorges' }, x: 9900, z: 100, r: 450 },
      { id: 'lac-de-vidda', name: { fr: 'Le Lac de Vidda et ses rennes', en: 'Vidda lake and its reindeer' }, x: 6419, z: 2218, r: 500 },
      { id: 'fumoir', name: { fr: 'Le Fumoir à saumon', en: 'Salmon smokehouse' }, x: -6700, z: 750, r: 260 },
      { id: 'skerries', name: { fr: 'La Tourbière des Skerries', en: 'Skerries peat bog' }, x: -11327, z: 9379, r: 700 },
      { id: 'promenade', name: { fr: 'La Promenade de Port-Boréal', en: 'Port-Boréal boardwalk' }, x: -8592, z: 11804, r: 500 },
      { id: 'skarvik', name: { fr: 'Les Cabanes sur pilotis de Skarvik', en: 'Skarvik stilt cabins' }, x: 10400, z: 5800, r: 450 },
      { id: 'nordvik', name: { fr: 'Le Port de Nordvik, au fond du Storfjord', en: 'Nordvik harbour, head of the Storfjord' }, x: 5867, z: -5825, r: 400 },
      { id: 'grand-fjord', name: { fr: 'Le fond du Grand Fjord', en: 'Head of the Great Fjord' }, x: -7300, z: -650, r: 500 },
      { id: 'nordrobert', name: { fr: 'La place de Nordrobert', en: 'Nordrobert square' }, x: 5000, z: 1000, r: 130 },
    ],
    foundKey: 'ar.found.grand-nord',
    tour: { fr: 'Tour du Grand Nord', en: 'Tour of the Far North' },
    tags: { coast: 'promenade-de-port-boreal', ring: 'anneau', climb: 'col-du-renne' },
  },
  theme: {
    // Pas de champs cultivés : lande brun-vert, toundra rousse, mousses ; neige tôt sur les hauteurs.
    ground: {
      spring: { forest: '#2d4a37', field: '#6e7048', field2: '#7a6a46', meadow: '#5f6e47', urban: '#9e9a90', dirt: '#6b5a48' },
      summer: { forest: '#2b4732', field: '#6a7246', field2: '#7f6c44', meadow: '#5c6c44', urban: '#a29d92', dirt: '#6e5a46' },
      autumn: { forest: '#2a4430', field: '#8a6a3c', field2: '#94512f', meadow: '#7a5a34', urban: '#a09a8e', dirt: '#6e5440' },
      winter: { forest: '#2f4536', field: '#d6dcdf', field2: '#e1e5e7', meadow: '#d2d8db', urban: '#c8c8c4', dirt: '#9a9590' },
    },
    sand: ['#7f7d76', '#9d998e'],
    rock: '#5a5d62',
    snowLine: { spring: 360, summer: 560, autumn: 420, winter: 0 },
    frost: { spring: 0.35, summer: 0.05, autumn: 0.12, winter: 0.95 },
    leaves: {
      spring: ['#355536', '#46683e', '#5a7a44'],
      summer: ['#2e4a30', '#3a5a36', '#45663c'],
      autumn: ['#2e4a30', '#b8862e', '#8a3f25'],
      winter: ['#2b4030', '#33493a', '#e8ecef'],
    },
    treelineM: 420,
    // Eau des fjords : sombre, presque ardoise, à peine verte.
    water: '#2c4552',
    // Ciel bas et lumière froide : horizon gris-bleu, un peu de brume d'air marin, couleurs retenues.
    light: { horizon: '#8d9ba6', horizonMix: 0.55, haze: 1.1, warmth: -0.55, saturation: 0.9 },
  },
  biome: { tree: 'birch', grass: 0.3, trees: 0.6, noVillageProps: true, noHerds: true, grassColours: { spring: ['#6f7a45', '#a7a46a'], summer: ['#76804a', '#b0aa6c'], autumn: ['#8a6a3c', '#c0874a'], winter: ['#8c8a78', '#c9c6b4'] } , roadside: { flowers: ['#9a6bd8', '#b77cc4', '#f2efe8'], flowerRate: 0.5, rock: '#8b8f93', rockRate: 0.14, rockSize: 1.6, rockMoss: '#6f8a4a', bushes: false } },
  ring: { x: 3000, z: 2500, half: 560, radius: 215 },
  sites: grandNordSites,
  building: grandNordBuilding,
  noFence: grandNordNoFence,
};
