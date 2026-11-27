/**
 * Les Rizières et la jungle (mode Poly) : données du monde pour le client (généré par tools/rizieres, voir
 * docs/RIZIERES.md). Longue terre couchée en biais que le Grand Fleuve traverse d'un bout à l'autre jusqu'à son delta
 * à quatre bras, collines de rizières en terrasses de part et d'autre, jungle très sombre sur les reliefs, baie semée
 * de pitons calcaires, temples, pagodes et ruines envahies.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { RIZIERES_RING, rizieresSites } from './rizieresSites.ts';

/** Tuiles rouges ou vernissées vertes (« tiles »), chaume de paille (« slate » dans le générateur), tôle rouillée. */
const TILE_ROOFS = ['#a8432a', '#8e3b24', '#b5562f', '#9a3a26', '#3f6e4a'] as const;
const THATCH = ['#b8955a', '#a8844c', '#c2a468', '#9c7a44'] as const;
const TEMPLE_ROOFS = ['#c0392b', '#a8432a', '#d4a017'] as const;
/** Maisons de bois sombre (teck, bambou fumé), jamais de brique ni de crépi. */
const WOOD = ['#4a3020', '#5a3a22', '#6a4428', '#7a5032', '#3e2a1c', '#83593a'] as const;
const WOOD_LIGHT = ['#9c7a52', '#a8875c', '#8a6a44'] as const;

/** Maisons de bois sur pilotis ou sur socle, toits de chaume ou de tuiles relevés à grands débords, temples rouge et or. */
function rizieresBuilding(b: TileBuilding): TileBuilding {
  if (b.pts.length < 6) return b;
  const r = rng(Math.imul(Math.round(b.pts[0]! * 10), 73856093) ^ Math.imul(Math.round(b.pts[1]! * 10), 19349663));
  const pick = <T,>(l: readonly T[]) => l[Math.floor(r() * l.length)]!;
  switch (b.kind) {
    case 'temple':
      return { ...b, roof: 'hipped', roofHeight: Math.max(b.roofHeight ?? 6, 7), roofColour: pick(TEMPLE_ROOFS), roofOverhang: 1.8, colour: b.colour ?? '#f4ead2' };
    case 'tower':
      // Stupas et pagodes du générateur : toit pyramidal doré ou rouge.
      return { ...b, roof: 'pyramidal', roofColour: b.colour === '#e8c35a' || b.roofMaterial === 'metal' ? '#e0b030' : '#a8432a', roofOverhang: 1.1 };
    case 'ruins':
      return { ...b, roofColour: '#5f6e48', colour: b.colour ?? '#8f8f78' };
    default:
      break;
  }
  const metal = b.roofMaterial === 'metal';
  const thatch = b.roofMaterial === 'slate' || (!metal && r() < 0.45);
  const shed = b.kind === 'shed' || b.kind === 'barn' || b.kind === 'industrial';
  // Toit à deux pans ou en croupe, toujours pentu ; jamais de toit plat ni de façade claire.
  const roof = b.roof === 'gabled' ? 'gabled' : 'hipped';
  const big = b.kind === 'apartments' || b.kind === 'public' || b.kind === 'commercial';
  return {
    ...b,
    roof,
    material: 'wood',
    colour: big ? pick(WOOD_LIGHT) : pick(WOOD),
    roofColour: metal ? '#7a5a44' : thatch ? pick(THATCH) : pick(TILE_ROOFS),
    roofOverhang: shed ? 0.9 : thatch ? 1.5 : 1.3,
    roofHeight: Math.max(b.roofHeight ?? 3, thatch ? 4.2 : 3.8),
  };
}

export const RIZIERES: PolyLand = {
  world: {
    id: 'rizieres',
    title: { fr: 'Les Rizières et la jungle', en: 'Rice Terraces and Jungle' },
    hint: { fr: 'Terrasses, jungle et temples', en: 'Terraces, jungle and temples' },
    map: { fr: 'Carte topographique — Les Rizières et la jungle', en: 'Topographic map — Rice Terraces and Jungle' },
    priority: [
      'decouverte-des-rizieres', 'classique-des-terrasses', 'classique-de-la-jungle', 'chrono-des-digues', 'temple-de-nuit', 'col-de-la-jungle', 'anneau', 'promenade-de-plage-de-jade',
      'mont-des-lanternes', 'col-par-les-jonques', 'montee-des-nuages', 'gorges-du-dragon', 'plateau-des-theiers', 'criterium-de-vat-robert', 'boucle-de-vat-robert', 'corniche-des-pitons',
      'delta-et-mangroves', 'golfe-et-terrasses', 'tour-des-rizieres', 'gravel-du-delta', 'gravel-des-terrasses', 'grande-traversee', 'cyclo-cross-des-digues', 'chemin-des-pitons',
      'bike-park-de-la-jungle', 'descente-de-la-jungle', 'vtt-du-mont-du-tigre', 'vtt-du-dragon',
    ],
    places: [
      { x: -424, z: 2079, label: 'Vat-Robert', labelEn: 'Vat-Robert', route: 'decouverte-des-rizieres', gravel: 'gravel-des-bambous' },
      { x: 1386, z: 8034, label: 'Plage-de-Jade', labelEn: 'Jade Beach', route: 'promenade-de-plage-de-jade', gravel: 'chemin-des-sables-blancs' },
      { x: -5183, z: 4689, label: 'Le Circuit', labelEn: 'The Circuit', route: 'anneau', gravel: 'cyclo-cross-des-digues' },
      { x: -5137, z: 3258, label: 'Les Digues', labelEn: 'The Dykes', route: 'chrono-des-digues', gravel: 'grande-traversee' },
      { x: 10888, z: -5961, label: 'Col de la Jungle', labelEn: 'Jungle Pass', route: 'col-de-la-jungle', mtb: 'descente-de-la-jungle' },
      { x: 12619, z: -5335, label: 'Temple des Lanternes', labelEn: 'Lantern Temple', route: 'temple-de-nuit', mtb: 'vtt-du-mont-du-tigre' },
      { x: 9362, z: -9449, label: 'Port-des-Jonques', labelEn: 'Junk Harbour', route: 'col-par-les-jonques' },
      { x: -4367, z: -3908, label: 'Village-des-Nuages', labelEn: 'Cloud Village', route: 'montee-des-nuages', gravel: 'gravel-des-nuages', mtb: 'vtt-des-nuages' },
      { x: -5602, z: 360, label: 'Lac des Lotus', labelEn: 'Lotus Lake', route: 'voie-verte-des-lotus', gravel: 'gravel-des-bambous', mtb: 'vtt-des-lotus' },
      { x: 13132, z: -582, label: 'Gorges du Dragon', labelEn: 'Dragon Gorges', route: 'gorges-du-dragon', gravel: 'classique-de-la-jungle', mtb: 'vtt-du-dragon' },
      { x: 11771, z: -1177, label: 'Les Théiers', labelEn: 'Tea Gardens', route: 'plateau-des-theiers', gravel: 'gravel-des-theiers' },
      { x: 6684, z: 4098, label: 'Les Pitons', labelEn: 'Karst Bay', route: 'corniche-des-pitons', gravel: 'chemin-des-pitons', mtb: 'vtt-des-pitons' },
      { x: 80, z: 5069, label: 'Les Terrasses', labelEn: 'Rice Terraces', route: 'classique-des-terrasses', gravel: 'gravel-des-terrasses', mtb: 'bike-park-de-la-jungle' },
      { x: -8316, z: 4982, label: 'Les Pilotis', labelEn: 'Stilt Village', route: 'delta-et-mangroves', gravel: 'grande-traversee' },
      { x: -12428, z: 6557, label: 'Le Delta', labelEn: 'The Delta', route: 'voie-verte-du-fleuve', gravel: 'gravel-du-delta' },
      { x: -14655, z: 6989, label: 'Les Mangroves', labelEn: 'Mangroves', route: 'voie-verte-du-fleuve', gravel: 'gravel-des-mangroves' },
    ],
    discover: [
      { id: 'grand-temple', name: { fr: 'Le Grand Temple de Vat-Robert', en: 'Vat-Robert Great Temple' }, x: -1299, z: 3861, r: 200 },
      { id: 'temple-lanternes', name: { fr: 'Le Temple des Lanternes', en: 'Lantern Temple' }, x: 12619, z: -5335, r: 180 },
      { id: 'col-jungle', name: { fr: 'Le Col de la Jungle', en: 'Jungle Pass' }, x: 10888, z: -5961, r: 170 },
      { id: 'stupa-tigre', name: { fr: 'Le Stupa du Mont du Tigre', en: 'Tiger Mount stupa' }, x: 9024, z: -6283, r: 260 },
      { id: 'prasat-vert', name: { fr: 'Les Ruines de Prasat-Vert', en: 'Prasat-Vert ruins' }, x: 12613, z: -4938, r: 300 },
      { id: 'temple-englouti', name: { fr: 'Le Temple englouti du Dragon', en: 'Sunken Dragon temple' }, x: 13274, z: -1002, r: 300 },
      { id: 'ruines-fleuve', name: { fr: 'Les Ruines du Fleuve', en: 'River ruins' }, x: 6868, z: -190, r: 300 },
      { id: 'palais-theiers', name: { fr: 'Le Palais des Théiers', en: 'Tea palace ruins' }, x: 10045, z: -1292, r: 300 },
      { id: 'marche-flottant', name: { fr: 'Le Marché flottant', en: 'Floating market' }, x: -8803, z: 3893, r: 400 },
      { id: 'pagode-terrasses', name: { fr: 'La Pagode des Terrasses', en: 'Terraces pagoda' }, x: 826, z: 4265, r: 220 },
      { id: 'monastere-lotus', name: { fr: 'Le Monastère des Lotus', en: 'Lotus monastery' }, x: -5236, z: -614, r: 300 },
      { id: 'cascade-nuages', name: { fr: 'La Cascade des Nuages', en: 'Cloud waterfall' }, x: -4740, z: -4583, r: 300 },
      { id: 'cascade-dragon', name: { fr: 'La Cascade du Dragon', en: 'Dragon waterfall' }, x: 12671, z: -199, r: 300 },
      { id: 'pont-lianes', name: { fr: 'Le Pont suspendu des Lianes', en: 'Liana suspension bridge' }, x: 11890, z: 680, r: 200 },
      { id: 'delta', name: { fr: 'Le delta du Grand Fleuve', en: 'Great River delta' }, x: -12428, z: 6557, r: 600 },
      { id: 'fort-dragon', name: { fr: 'Les Ruines du Fort du Dragon', en: 'Dragon fort ruins' }, x: 15820, z: -316, r: 300 },
      { id: 'circuit', name: { fr: 'Le Circuit des Rizières', en: 'Rice fields circuit' }, x: -5183, z: 4689, r: 420 },
      { id: 'marche-de-nuit', name: { fr: 'Le Marché de nuit de Plage-de-Jade', en: 'Jade Beach night market' }, x: 1003, z: 8598, r: 500 },
      { id: 'pitons', name: { fr: 'Le Port des Pitons', en: 'Karst Bay harbour' }, x: 7130, z: 4371, r: 400 },
      { id: 'bike-park', name: { fr: 'Le Bike park de la Jungle', en: 'Jungle bike park' }, x: -2227, z: -3727, r: 420 },
      { id: 'vat-robert', name: { fr: 'La place du marché de Vat-Robert', en: 'Vat-Robert market square' }, x: -424, z: 2079, r: 130 },
    ],
    foundKey: 'ar.found.rizieres',
    tour: { fr: 'Tour des Rizières', en: 'Tour of the Rice Lands' },
    tags: { coast: 'promenade-de-plage-de-jade', ring: 'anneau', climb: 'col-de-la-jungle' },
  },
  theme: {
    // Rizières inondées : vert tendre et vert d'eau toute l'année (jamais de blé blond) ; jungle très sombre.
    ground: {
      spring: { forest: '#123a1c', field: '#8ee06e', field2: '#6fd2b4', meadow: '#4fae3e', urban: '#a88a62', dirt: '#a8552f' },
      summer: { forest: '#0f3419', field: '#7fdc62', field2: '#62cbb0', meadow: '#46a83a', urban: '#a4865e', dirt: '#a0502c' },
      autumn: { forest: '#14381c', field: '#a6dc6a', field2: '#7ccfa8', meadow: '#58b042', urban: '#a88a62', dirt: '#a8552f' },
      winter: { forest: '#183c20', field: '#9ad27a', field2: '#86c9b0', meadow: '#5fa848', urban: '#ac8e66', dirt: '#b0603a' },
    },
    sand: ['#e6dfcc', '#fbf8ee'],
    rock: '#a9a9a2',
    snowLine: { spring: 9000, summer: 9000, autumn: 9000, winter: 9000 },
    frost: { spring: 0, summer: 0, autumn: 0, winter: 0 },
    // Feuillage tropical très vert et profond, toute l'année.
    leaves: {
      spring: ['#145a22', '#1e6b2a', '#2e7d32'],
      summer: ['#0f4d1c', '#145a22', '#1e6b2a'],
      autumn: ['#145a22', '#1e6b2a', '#33702a'],
      winter: ['#1a5a24', '#246a2c', '#33702a'],
    },
    treelineM: 1700,
    water: '#2fb7a8',
  },
  // Jungle et bambous à la place des feuillus et des sapins, herbe haute, ni boîtes aux lettres ni vaches (buffles du décor).
  biome: { tree: 'jungle', conifer: 'bamboo', grass: 1.3, noVillageProps: true, noHerds: true, grassColours: { spring: ['#3f8f3a', '#7ccc4e'], summer: ['#3a8a36', '#74c64a'], autumn: ['#45903a', '#86c650'], winter: ['#4a8a40', '#88c05a'] } },
  ring: RIZIERES_RING,
  sites: rizieresSites,
  building: rizieresBuilding,
  // Promenade de Plage-de-Jade, marché flottant et quartier des pilotis : ni clôtures ni poteaux.
  noFence: (x, z) => Math.hypot(x - 1100, z - 8300) < 1600 || Math.hypot(x + 8800, z - 3900) < 800,
};
