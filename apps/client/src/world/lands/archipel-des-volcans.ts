/**
 * L’Archipel des volcans (mode Poly) : données du monde pour le client (généré par tools/archipel-des-volcans, voir
 * docs/ARCHIPEL_DES_VOLCANS.md). Trois îles : la Grande Île et son volcan (≈ 1 440 m, cratère et lac), l’Île des
 * Orgues (plateau de basalte, phare, reliée par le Pont des Orgues) et l’Île de Sable-Noir (plages noires, Mont
 * Cendre, reliée par la Chaussée). Décor propre : archipel-des-volcansSites.ts.
 */
import type { PolyLand } from './types.ts';
import type { TileBuilding } from '../types.ts';
import { ARCHIPEL_RING, archipelNoFence, archipelSites } from './archipel-des-volcansSites.ts';

/** Façades et toits vifs de Sainte-Iris et de Port-Lave (tôles peintes), gradins du Circuit remplacés par le décor. */
const ROOFS = ['#c8423a', '#2f8f8a', '#3c6fb0', '#e2a23a', '#5b8f3e', '#8a4fa8'];
function archipelBuilding(b: TileBuilding): TileBuilding {
  if (b.pts.length < 6) return b;
  let x = 0;
  let z = 0;
  for (let i = 0; i < b.pts.length; i += 2) {
    x += b.pts[i]!;
    z += b.pts[i + 1]!;
  }
  x /= b.pts.length / 2;
  z /= b.pts.length / 2;
  // Hangars des tribunes du Circuit : remplacés par de vrais gradins (décor).
  if (b.kind === 'industrial' && Math.abs(x - ARCHIPEL_RING.x) < 90 && Math.abs(z - (ARCHIPEL_RING.z + ARCHIPEL_RING.radius + 24)) < 12) return { ...b, pts: [] };
  const colourful = Math.hypot(x + 400, z - 8500) < 1900 || Math.hypot(x + 9300, z - 5300) < 700 || Math.hypot(x - 12900, z - 8900) < 600;
  if (!colourful || (b.kind !== 'house' && b.kind !== 'apartments' && b.kind !== 'commercial')) return b;
  const i = Math.abs(Math.round(x * 0.37 + z * 0.61));
  return { ...b, roofMaterial: 'metal', roofColour: ROOFS[i % ROOFS.length]!, roofOverhang: 0.35 };
}

export const ARCHIPEL: PolyLand = {
  world: {
    id: 'archipel-des-volcans',
    title: { fr: 'L’Archipel des volcans', en: 'The Volcano Archipelago' },
    hint: { fr: 'Volcan, coulées noires, plages sombres', en: 'Volcano, black lava flows, dark beaches' },
    map: { fr: 'Carte topographique — L’Archipel des volcans', en: 'Topographic map — The Volcano Archipelago' },
    priority: [
      'decouverte-de-l-archipel',
      'classique-des-trois-iles',
      'classique-des-cendres',
      'chrono-de-la-chaussee',
      'cratere-de-nuit',
      'montee-du-volcan',
      'route-de-l-observatoire',
      'anneau',
      'promenade-de-sainte-iris',
      'tour-de-l-ile',
      'criterium-de-la-plaine',
      'phare-des-orgues',
      'tour-des-orgues',
      'tour-de-sable-noir',
      'route-de-la-foret',
      'route-des-vignes',
      'boucle-des-terrasses',
      'boucle-de-la-plaine',
      'gravel-des-cendres',
      'gravel-de-la-foret',
      'gravel-des-fumerolles',
      'cyclo-cross-des-cendres',
      'bike-park-du-mont-cendre',
      'descente-du-volcan',
      'vtt-de-la-lande',
      'vtt-de-la-coulee',
    ],
    places: [
      { x: -395, z: 8150, label: 'Sainte-Iris', labelEn: 'Sainte-Iris', route: 'promenade-de-sainte-iris', gravel: 'chemin-du-littoral' },
      { x: -5000, z: 4700, label: 'La Plaine', labelEn: 'La Plaine', route: 'decouverte-de-l-archipel', gravel: 'gravel-de-la-coulee' },
      { x: -8200, z: 3300, label: 'Circuit des Laves', labelEn: 'Lava Circuit', route: 'anneau', gravel: 'cyclo-cross-des-cendres' },
      { x: -200, z: 2300, label: 'Aigues-Chaudes', labelEn: 'Aigues-Chaudes', route: 'montee-du-volcan', gravel: 'gravel-des-fumerolles' },
      { x: -1500, z: -2600, label: 'Le Cratère', labelEn: 'The Crater', route: 'cratere-de-nuit', mtb: 'vtt-de-la-lande' },
      { x: 527, z: -2294, label: 'Observatoire', labelEn: 'Observatory', route: 'route-de-l-observatoire', mtb: 'descente-du-volcan' },
      { x: 7600, z: -2600, label: 'Rocheverte', labelEn: 'Rocheverte', route: 'route-de-la-foret', gravel: 'gravel-de-la-foret', mtb: 'vtt-de-la-foret' },
      { x: 7400, z: -5700, label: 'La Ravine', labelEn: 'The Ravine', route: 'tour-de-l-ile', mtb: 'vtt-de-la-ravine' },
      { x: -8800, z: -3900, label: 'Vigne-Noire', labelEn: 'Vigne-Noire', route: 'route-des-vignes', gravel: 'gravel-des-vignes' },
      { x: -7200, z: -3100, label: 'Les Cendres', labelEn: 'The Ashes', route: 'route-des-vignes', gravel: 'gravel-des-cendres' },
      { x: -9296, z: 5342, label: 'Port-Lave', labelEn: 'Port-Lave', route: 'boucle-de-la-plaine', gravel: 'classique-des-cendres', mtb: 'vtt-de-la-coulee' },
      { x: 5600, z: 3900, label: 'Les Terrasses', labelEn: 'Les Terrasses', route: 'boucle-des-terrasses', gravel: 'gravel-des-terrasses' },
      { x: 13116, z: -4300, label: 'Les Orgues', labelEn: 'Les Orgues', route: 'tour-des-orgues', gravel: 'gravel-des-orgues', mtb: 'vtt-des-orgues' },
      { x: 18473, z: -4166, label: 'Phare des Orgues', labelEn: 'Organ lighthouse', route: 'phare-des-orgues' },
      { x: 9453, z: 6580, label: 'La Chaussée', labelEn: 'The Causeway', route: 'classique-des-trois-iles' },
      { x: 12900, z: 8900, label: 'Sable-Noir', labelEn: 'Sable-Noir', route: 'chrono-de-la-chaussee', gravel: 'gravel-de-sable-noir', mtb: 'bike-park-du-mont-cendre' },
    ],
    discover: [
      { id: 'cratere', name: { fr: 'La Brèche du Cratère', en: 'Crater gap' }, x: -1219, z: -2162, r: 180 },
      { id: 'lac-du-cratere', name: { fr: 'Le Lac du Cratère', en: 'Crater lake' }, x: -1500, z: -2600, r: 320 },
      { id: 'observatoire', name: { fr: 'L’Observatoire du volcan', en: 'Volcano observatory' }, x: 527, z: -2294, r: 180 },
      { id: 'thermes', name: { fr: 'Les Thermes d’Aigues-Chaudes', en: 'Aigues-Chaudes hot springs' }, x: 248, z: 2214, r: 200 },
      { id: 'fumerolles', name: { fr: 'Les Fumerolles', en: 'Fumaroles' }, x: 1700, z: 1300, r: 300 },
      { id: 'maison-du-volcan', name: { fr: 'La Maison du Volcan', en: 'Volcano house' }, x: -808, z: 3186, r: 160 },
      { id: 'pont-des-orgues', name: { fr: 'Le Pont des Orgues', en: 'Organ bridge' }, x: 12892, z: -3355, r: 350 },
      { id: 'chaussee', name: { fr: 'La Chaussée', en: 'The Causeway' }, x: 10452, z: 7328, r: 450 },
      { id: 'phare', name: { fr: 'Le Phare des Orgues', en: 'Organ lighthouse' }, x: 18473, z: -4166, r: 170 },
      { id: 'port-des-orgues', name: { fr: 'Le Port des Orgues', en: 'Organ harbour' }, x: 13372, z: -4593, r: 300 },
      { id: 'grande-coulee', name: { fr: 'La Grande Coulée', en: 'Great lava flow' }, x: -8200, z: -500, r: 500 },
      { id: 'coulee-du-nord', name: { fr: 'La Coulée du Nord', en: 'North lava flow' }, x: -2300, z: -7600, r: 450 },
      { id: 'mont-cendre', name: { fr: 'Le Bike park du Mont Cendre', en: 'Mont Cendre bike park' }, x: 15300, z: 8700, r: 420 },
      { id: 'cyclo-cross', name: { fr: 'Le Cyclo-cross des Cendres', en: 'Ash cyclocross' }, x: -10600, z: 3600, r: 380 },
      { id: 'circuit', name: { fr: 'Le Circuit des Laves', en: 'Lava circuit' }, x: -8200, z: 3300, r: 420 },
      { id: 'port-lave', name: { fr: 'Le Port de Port-Lave', en: 'Port-Lave harbour' }, x: -9427, z: 5671, r: 350 },
      { id: 'sainte-iris', name: { fr: 'La Plage des Cendres', en: 'Ash beach' }, x: -418, z: 8482, r: 450 },
      { id: 'vigne-noire', name: { fr: 'La Cave de la Vigne-Noire', en: 'Vigne-Noire winery' }, x: -8094, z: -3042, r: 200 },
      { id: 'foret', name: { fr: 'La Chapelle de la Forêt', en: 'Rainforest chapel' }, x: 8200, z: -1700, r: 220 },
      { id: 'terrasses', name: { fr: 'Le Moulin des Terrasses', en: 'Terraces windmill' }, x: 6400, z: 3500, r: 200 },
      { id: 'sable-noir', name: { fr: 'Le Chai de Sable-Noir', en: 'Sable-Noir wine cellar' }, x: 12900, z: 7900, r: 220 },
    ],
    foundKey: 'ar.found.archipel-des-volcans',
    tour: { fr: 'Tour de l’Archipel', en: 'Tour of the Archipelago' },
    tags: { coast: 'promenade-de-sainte-iris', ring: 'anneau', climb: 'montee-du-volcan' },
  },
  theme: {
    // Terre volcanique sombre, végétation très verte toute l'année (climat tropical humide : pas d'hiver marqué).
    ground: {
      spring: { forest: '#2f7a34', field: '#8fc24a', field2: '#c9b54e', meadow: '#5fb24a', urban: '#bdb6a8', dirt: '#5e4e42' },
      summer: { forest: '#2c7232', field: '#a6bf45', field2: '#c2a04a', meadow: '#5aab45', urban: '#c0b8a8', dirt: '#62503f' },
      autumn: { forest: '#327534', field: '#93bf4c', field2: '#bf9a46', meadow: '#5fae47', urban: '#bdb5a5', dirt: '#5c4b3e' },
      winter: { forest: '#2f6e36', field: '#88b552', field2: '#ae9a58', meadow: '#5ea54f', urban: '#bab4a8', dirt: '#584a40' },
    },
    // Sable noir : mouillé presque noir, sec gris anthracite.
    sand: ['#2f2c2b', '#4f4a46'],
    rock: '#3a3634',
    // Le sommet (≈ 1 440 m) ne blanchit qu'en hiver, à peine.
    snowLine: { spring: 3000, summer: 3200, autumn: 3000, winter: 1330 },
    frost: { spring: 0, summer: 0, autumn: 0, winter: 0 },
    leaves: {
      spring: ['#2f8a3a', '#45a83f', '#6cc24a'],
      summer: ['#2a7f35', '#3f9e3c', '#62b845'],
      autumn: ['#2f8436', '#4aa13d', '#7cbf48'],
      winter: ['#2c7a37', '#40973d', '#5fae47'],
    },
    treelineM: 950,
    water: '#22b3b0',
  },
  // Îles volcaniques tropicales : palmiers, peu de mobilier européen, pas de vaches dans les prés.
  biome: { tree: 'palm', trees: 0.75, noVillageProps: true, noHerds: true },
  ring: ARCHIPEL_RING,
  sites: archipelSites,
  building: archipelBuilding,
  noFence: archipelNoFence,
};
