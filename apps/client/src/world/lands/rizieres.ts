/**
 * Les Rizières et la jungle (mode Poly) : données du monde pour le client (généré par tools/rizieres, voir
 * docs/RIZIERES.md). Collines de rizières en terrasses, plaine des digues, jungle très sombre, pitons calcaires en
 * pains de sucre, Grand Fleuve et son delta, plages de sable blanc, temples, pagodes et ruines envahies.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { RIZIERES_RING, rizieresSites } from './rizieresSites.ts';

/** Tuiles rouges ou vernissées vertes (« tiles »), chaume de paille (« slate » dans le générateur), tôle. */
const TILE_ROOFS = ['#a8432a', '#8e3b24', '#b5562f', '#9a3a26', '#3f6e4a'] as const;
const THATCH = ['#b8955a', '#a8844c', '#c2a468'] as const;
const TEMPLE_ROOFS = ['#c0392b', '#a8432a', '#d4a017'] as const;

/** Toits relevés à grands débords, chaume ou tuiles, temples rouge et or, stupas dorés, ruines grises. */
function rizieresBuilding(b: TileBuilding): TileBuilding {
  if (b.pts.length < 6) return b;
  const r = rng(Math.imul(Math.round(b.pts[0]! * 10), 73856093) ^ Math.imul(Math.round(b.pts[1]! * 10), 19349663));
  const pick = <T,>(l: readonly T[]) => l[Math.floor(r() * l.length)]!;
  switch (b.kind) {
    case 'temple':
      return { ...b, roof: 'hipped', roofHeight: Math.max(b.roofHeight ?? 6, 6), roofColour: pick(TEMPLE_ROOFS), roofOverhang: 1.4, colour: b.colour ?? '#f4ead2' };
    case 'tower':
      // Stupas et pagodes du générateur : toit pyramidal doré ou rouge.
      return { ...b, roof: 'pyramidal', roofColour: b.colour === '#e8c35a' || b.roofMaterial === 'metal' ? '#e0b030' : '#a8432a', roofOverhang: 0.9 };
    case 'ruins':
      return { ...b, roofColour: '#6f7a58', colour: b.colour ?? '#8f8f78' };
    default:
      break;
  }
  const thatch = b.roofMaterial === 'slate';
  const metal = b.roofMaterial === 'metal';
  const roof = b.roof === 'gabled' || b.roof === 'hipped' || b.roof === 'pyramidal' ? b.roof : b.roof === 'flat' ? 'flat' : 'hipped';
  return {
    ...b,
    roof,
    roofColour: metal ? '#8a9a94' : thatch ? pick(THATCH) : pick(TILE_ROOFS),
    roofOverhang: roof === 'flat' ? 0.3 : thatch ? 1.1 : 0.9,
    ...(roof !== 'flat' ? { roofHeight: Math.max(b.roofHeight ?? 2.8, thatch ? 3.4 : 3) } : {}),
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
      'mont-des-lanternes', 'col-par-les-jonques', 'montee-des-nuages', 'gorges-du-dragon', 'criterium-de-vat-robert', 'boucle-de-vat-robert', 'corniche-des-pitons', 'plateau-des-theiers',
      'golfe-et-terrasses', 'delta-et-mangroves', 'tour-des-rizieres', 'gravel-des-terrasses', 'gravel-des-theiers', 'grande-traversee', 'cyclo-cross-des-digues', 'chemin-des-pitons',
      'bike-park-de-la-jungle', 'descente-de-la-jungle', 'vtt-du-mont-du-tigre', 'vtt-du-dragon',
    ],
    places: [
      { x: -2600, z: 1200, label: 'Vat-Robert', labelEn: 'Vat-Robert', route: 'decouverte-des-rizieres', gravel: 'gravel-des-bambous' },
      { x: -438, z: 8891, label: 'Plage-de-Jade', labelEn: 'Jade Beach', route: 'promenade-de-plage-de-jade', gravel: 'chemin-des-sables-blancs' },
      { x: -6900, z: 3700, label: 'Le Circuit', labelEn: 'The Circuit', route: 'anneau', gravel: 'cyclo-cross-des-digues' },
      { x: -7800, z: 1000, label: 'Les Digues', labelEn: 'The Dykes', route: 'chrono-des-digues', gravel: 'grande-traversee' },
      { x: 2902, z: -6522, label: 'Col de la Jungle', labelEn: 'Jungle Pass', route: 'col-de-la-jungle', mtb: 'descente-de-la-jungle' },
      { x: 1600, z: -6900, label: 'Temple des Lanternes', labelEn: 'Lantern Temple', route: 'temple-de-nuit', mtb: 'vtt-du-mont-du-tigre' },
      { x: -483, z: -9801, label: 'Port-des-Jonques', labelEn: 'Junk Harbour', route: 'col-par-les-jonques' },
      { x: -8300, z: -5300, label: 'Village-des-Nuages', labelEn: 'Cloud Village', route: 'montee-des-nuages', gravel: 'gravel-des-nuages', mtb: 'bike-park-de-la-jungle' },
      { x: -5600, z: -2500, label: 'Lac des Lotus', labelEn: 'Lotus Lake', route: 'voie-verte-des-lotus', gravel: 'gravel-des-bambous', mtb: 'vtt-des-lotus' },
      { x: 7600, z: 3700, label: 'Gorges du Dragon', labelEn: 'Dragon Gorges', route: 'gorges-du-dragon', gravel: 'classique-de-la-jungle', mtb: 'vtt-du-dragon' },
      { x: 11800, z: -600, label: 'Les Théiers', labelEn: 'Tea Gardens', route: 'plateau-des-theiers', gravel: 'gravel-des-theiers' },
      { x: 10171, z: 9287, label: 'Les Pitons', labelEn: 'Karst Bay', route: 'corniche-des-pitons', gravel: 'chemin-des-pitons', mtb: 'vtt-des-pitons' },
      { x: 3800, z: 5600, label: 'Les Terrasses', labelEn: 'Rice Terraces', route: 'classique-des-terrasses', gravel: 'gravel-des-terrasses' },
      { x: -12300, z: 900, label: 'Les Pilotis', labelEn: 'Stilt Village', route: 'delta-et-mangroves', gravel: 'gravel-du-delta' },
      { x: -13774, z: 4897, label: 'Les Mangroves', labelEn: 'Mangroves', route: 'voie-verte-du-fleuve', gravel: 'gravel-des-mangroves' },
    ],
    discover: [
      { id: 'grand-temple', name: { fr: 'Le Grand Temple de Vat-Robert', en: 'Vat-Robert Great Temple' }, x: -3500, z: -250, r: 200 },
      { id: 'temple-lanternes', name: { fr: 'Le Temple des Lanternes', en: 'Lantern Temple' }, x: 1600, z: -6900, r: 180 },
      { id: 'col-jungle', name: { fr: 'Le Col de la Jungle', en: 'Jungle Pass' }, x: 2902, z: -6522, r: 170 },
      { id: 'stupa-tigre', name: { fr: 'Le Stupa du Mont du Tigre', en: 'Tiger Mount stupa' }, x: 4580, z: -5920, r: 260 },
      { id: 'prasat-vert', name: { fr: 'Les Ruines de Prasat-Vert', en: 'Prasat-Vert ruins' }, x: 5500, z: -3100, r: 300 },
      { id: 'temple-englouti', name: { fr: 'Le Temple englouti du Dragon', en: 'Sunken Dragon temple' }, x: 8619, z: -2055, r: 300 },
      { id: 'ruines-fleuve', name: { fr: 'Les Ruines du Fleuve', en: 'River ruins' }, x: -10094, z: -4426, r: 300 },
      { id: 'palais-theiers', name: { fr: 'Le Palais des Théiers', en: 'Tea palace ruins' }, x: 12806, z: -1926, r: 300 },
      { id: 'marche-flottant', name: { fr: 'Le Marché flottant', en: 'Floating market' }, x: -13774, z: 229, r: 400 },
      { id: 'pagode-terrasses', name: { fr: 'La Pagode des Terrasses', en: 'Terraces pagoda' }, x: 4700, z: 4800, r: 220 },
      { id: 'monastere-lotus', name: { fr: 'Le Monastère des Lotus', en: 'Lotus monastery' }, x: -5000, z: -3700, r: 300 },
      { id: 'cascade-nuages', name: { fr: 'La Cascade des Nuages', en: 'Cloud waterfall' }, x: -8050, z: -5550, r: 300 },
      { id: 'cascade-dragon', name: { fr: 'La Cascade du Dragon', en: 'Dragon waterfall' }, x: 6600, z: -1300, r: 300 },
      { id: 'pont-lianes', name: { fr: 'Le Pont suspendu des Lianes', en: 'Liana suspension bridge' }, x: 7401, z: 3117, r: 200 },
      { id: 'circuit', name: { fr: 'Le Circuit des Rizières', en: 'Rice fields circuit' }, x: -6900, z: 3700, r: 420 },
      { id: 'marche-de-nuit', name: { fr: 'Le Marché de nuit de Plage-de-Jade', en: 'Jade Beach night market' }, x: -611, z: 9355, r: 500 },
      { id: 'pitons', name: { fr: 'Le Port des Pitons', en: 'Karst Bay harbour' }, x: 10424, z: 9518, r: 400 },
      { id: 'bike-park', name: { fr: 'Le Bike park de la Jungle', en: 'Jungle bike park' }, x: -8400, z: -4200, r: 420 },
      { id: 'vat-robert', name: { fr: 'La place du marché de Vat-Robert', en: 'Vat-Robert market square' }, x: -2600, z: 1200, r: 130 },
    ],
    foundKey: 'ar.found.rizieres',
    tour: { fr: 'Tour des Rizières', en: 'Tour of the Rice Lands' },
    tags: { coast: 'promenade-de-plage-de-jade', ring: 'anneau', climb: 'col-de-la-jungle' },
  },
  theme: {
    // Mousson (printemps, été) : verts vifs et saturés ; récolte (automne) dorée ; saison sèche (hiver) plus jaune.
    ground: {
      spring: { forest: '#1f4a24', field: '#9be05a', field2: '#7fc7a0', meadow: '#6fc24a', urban: '#d9c9a8', dirt: '#b0603a' },
      summer: { forest: '#1b4421', field: '#8fdc4e', field2: '#6fc0a0', meadow: '#66bf45', urban: '#d6c6a4', dirt: '#a85a36' },
      autumn: { forest: '#22482a', field: '#d8c85a', field2: '#a8cf6a', meadow: '#8cc455', urban: '#d9c9a8', dirt: '#b0603a' },
      winter: { forest: '#2c4e2e', field: '#d9c27a', field2: '#c9b98a', meadow: '#a8b85a', urban: '#ddd0b0', dirt: '#b8754a' },
    },
    sand: ['#e6dfcc', '#fbf8ee'],
    rock: '#a9a9a2',
    snowLine: { spring: 9000, summer: 9000, autumn: 9000, winter: 9000 },
    frost: { spring: 0, summer: 0, autumn: 0, winter: 0 },
    leaves: {
      spring: ['#2e7d32', '#43a047', '#7cb342'],
      summer: ['#1b5e20', '#2e7d32', '#558b2f'],
      autumn: ['#33691e', '#689f38', '#c0ca33'],
      winter: ['#558b2f', '#9e9d24', '#827717'],
    },
    treelineM: 1700,
    water: '#2fb7a8',
  },
  ring: RIZIERES_RING,
  sites: rizieresSites,
  building: rizieresBuilding,
  // Promenade de Plage-de-Jade, marché flottant et quartier des pilotis : ni clôtures ni poteaux.
  noFence: (x, z) => Math.hypot(x + 450, z - 8900) < 1600 || Math.hypot(x + 13700, z - 200) < 700,
};
