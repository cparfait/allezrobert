/**
 * L’Archipel des volcans (mode Poly) : données du monde pour le client (généré par tools/archipel-des-volcans, voir
 * docs/ARCHIPEL_DES_VOLCANS.md). Trois îles : la Grande Île et son volcan (≈ 1 440 m, cratère et lac), l’Île des
 * Orgues (plateau de basalte, phare, reliée par le Pont des Orgues) et l’Île de Sable-Noir (plages noires, Mont
 * Cendre, reliée par la Chaussée). Identité inspirée de l’Islande (27/11/2026) : lave moussue, sable noir, cascades,
 * églises blanches à toit rouge, maisons isolées en tôle, peu d’arbres, lumière basse et nuageuse. Décor propre :
 * archipel-des-volcansSites.ts.
 */
import type { PolyLand } from './types.ts';
import type { TileBuilding } from '../types.ts';
import { ARCHIPEL_RING, archipelNoFence, archipelSites } from './archipel-des-volcansSites.ts';

/**
 * Village d'île volcanique (27/11/2026 : l'arc-en-ciel de façades n'était ni naturel ni joli) : enduits blancs et
 * crème, sable, ocres doux, quelques pierres claires ; toits de tuiles cuites et d'ardoise de basalte. Palette validée
 * par l'utilisateur : elle reste celle des villages.
 */
const WALLS = ['#f1ece2', '#ece3d1', '#e6d6b8', '#dcc39a', '#d8b48a', '#c99a72', '#e8ddcc', '#cfc6b6'];
const ROOFS = ['#a5503a', '#b4613f', '#8e4a36', '#5a5652', '#9a5b3e'];

/**
 * Hors des villages, l'identité islandaise (27/11/2026) : maisons simples en tôle ondulée peinte (blanc, crème, gris
 * clair, jaune paille, quelques rouges et noires), toits de tôle rouges, verts, bleu ardoise ou noirs ; granges et
 * remises en tôle rouge sang-de-bœuf ou goudronnée.
 */
const TIN_WALLS = ['#f3f2ed', '#ebe6d6', '#dfe3e2', '#efe1ad', '#f3f2ed', '#b5443a', '#33363a'];
const TIN_ROOFS = ['#b3332b', '#3f6b4b', '#3d5975', '#2d3033', '#b3332b', '#8a2e29'];
const TIN_BARNS = ['#a8402f', '#8f3a2c', '#33363a', '#e9e7e0'];
/** Églises : murs blancs, toit de tôle rouge vif. */
const CHURCH_WALL = '#f6f5f0';
const CHURCH_ROOF = '#b8302a';

/** Villages du générateur (places.json : centre, rayon de design.ts) : dedans, la palette crème et ocre. */
const VILLAGES: ReadonlyArray<readonly [number, number, number]> = [
  [-389, 7902, 900], [-9296, 5342, 430], [-200, 2300, 380], [7600, -2600, 380], [-8800, -3900, 360], [5600, 3900, 360],
  [-5000, 4700, 560], [11822, -3141, 260], [9453, 6580, 260], [13761, -4300, 380], [12900, 8900, 360],
];

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
  const i = Math.abs(Math.round(x * 0.37 + z * 0.61));
  const j = Math.abs(Math.round(x * 0.53 - z * 0.29));
  // Églises et chapelles (nef et clocher) : blanches à toit rouge, partout.
  if (b.kind === 'church' || b.kind === 'chapel') {
    const { material: _m, ...rest } = b;
    return { ...rest, colour: CHURCH_WALL, roofMaterial: 'metal', roofColour: CHURCH_ROOF, roofOverhang: 0.3 };
  }
  const inVillage = VILLAGES.some(([vx, vz, r]) => Math.hypot(x - vx, z - vz) < r * 1.25);
  if (!inVillage && (b.kind === 'house' || b.kind === 'farm' || b.kind === 'barn' || b.kind === 'shed')) {
    const { material: _m, ...rest } = b;
    const barn = b.kind === 'barn' || b.kind === 'shed';
    return { ...rest, colour: (barn ? TIN_BARNS : TIN_WALLS)[i % (barn ? TIN_BARNS.length : TIN_WALLS.length)]!, roofMaterial: 'metal', roofColour: TIN_ROOFS[j % TIN_ROOFS.length]!, roofOverhang: 0.25 };
  }
  const colourful = Math.hypot(x + 400, z - 8500) < 1900 || Math.hypot(x + 9300, z - 5300) < 700 || Math.hypot(x - 12900, z - 8900) < 600;
  if (b.kind !== 'house' && b.kind !== 'apartments' && b.kind !== 'commercial') return b;
  return { ...b, colour: WALLS[i % WALLS.length]!, roofMaterial: 'tiles', roofColour: ROOFS[j % ROOFS.length]!, ...(colourful ? { roofOverhang: 0.35 } : {}) };
}

export const ARCHIPEL: PolyLand = {
  world: {
    id: 'archipel-des-volcans',
    title: { fr: 'L’Archipel des volcans', en: 'The Volcano Archipelago' },
    hint: { fr: 'Volcan, lave moussue, sable noir, cascades', en: 'Volcano, mossy lava, black sand, waterfalls' },
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
      { id: 'foret', name: { fr: 'La Chapelle de la Forêt', en: 'Forest chapel' }, x: 8200, z: -1700, r: 220 },
      { id: 'terrasses', name: { fr: 'Le Moulin des Terrasses', en: 'Terraces windmill' }, x: 6400, z: 3500, r: 200 },
      { id: 'sable-noir', name: { fr: 'Le Chai de Sable-Noir', en: 'Sable-Noir wine cellar' }, x: 12900, z: 7900, r: 220 },
      { id: 'cascade-des-orgues', name: { fr: 'La Cascade des Orgues', en: 'Organ waterfall' }, x: 15860, z: -4285, r: 200 },
      { id: 'cascade-du-cap', name: { fr: 'La Cascade du Cap', en: 'Cape waterfall' }, x: 18410, z: -3655, r: 200 },
      { id: 'eglise-de-la-grande-anse', name: { fr: 'L’Église de la Grande Anse', en: 'Grande Anse church' }, x: 16015, z: 9804, r: 220 },
    ],
    foundKey: 'ar.found.archipel-des-volcans',
    tour: { fr: 'Tour de l’Archipel', en: 'Tour of the Archipelago' },
    tags: { coast: 'promenade-de-sainte-iris', ring: 'anneau', climb: 'montee-du-volcan' },
  },
  theme: {
    // Islande (27/11/2026) : mousse vert vif sur la lave, prés de fauche, lande d'altitude, terre volcanique noire ;
    // la mousse roussit à l'automne, le sol pâlit sous le givre l'hiver.
    ground: {
      spring: { forest: '#4d6f37', field: '#86ad45', field2: '#a9a25a', meadow: '#7b9e43', urban: '#aaa79f', dirt: '#3b3734' },
      summer: { forest: '#4a6c34', field: '#8fb547', field2: '#b3a65a', meadow: '#82a845', urban: '#adaaa2', dirt: '#3e3936' },
      autumn: { forest: '#7a6334', field: '#9a9f4c', field2: '#b08e50', meadow: '#8c8a46', urban: '#aaa69e', dirt: '#3a3532' },
      winter: { forest: '#55573f', field: '#8a8f63', field2: '#9a9070', meadow: '#7f8660', urban: '#b0aea8', dirt: '#3c3937' },
    },
    // Sable noir : mouillé presque noir, sec gris anthracite.
    sand: ['#1f1d1c', '#3b3836'],
    rock: '#33302e',
    // Calotte du volcan (≈ 1 460 m) : neige au sommet l'été, jusqu'à mi-pente l'hiver.
    snowLine: { spring: 1050, summer: 1320, autumn: 1150, winter: 620 },
    frost: { spring: 0.05, summer: 0, autumn: 0.05, winter: 0.35 },
    // Bouleaux nains : vert tendre, or et rouille à l'automne, brun l'hiver.
    leaves: {
      spring: ['#7aa84a', '#8fbf55', '#a6cc62'],
      summer: ['#5d8f3c', '#6fa245', '#86b351'],
      autumn: ['#c9962e', '#d8a93a', '#b5672a'],
      winter: ['#8a7a5a', '#7d6e52', '#9a8a66'],
    },
    treelineM: 380,
    // Mer froide du Nord : bleu pétrole.
    water: '#2c6c80',
    // Lumière basse et nuageuse : horizon gris bleuté, air humide, lumière froide, couleurs un peu éteintes.
    light: { horizon: '#b4bec4', horizonMix: 0.6, haze: 1.3, warmth: -0.35, saturation: 0.92 },
  },
  // Peu d'arbres (bouleaux en bosquets), herbe rase et mousse, moutons et chevaux dans les prés ; lupins bleu-violet,
  // rochers de lave moussus et touffes d'herbe sèche au bord des routes.
  biome: {
    tree: 'birch',
    trees: 0.18,
    grass: 0.9,
    grassColours: {
      spring: ['#5b7c36', '#9aba58'],
      summer: ['#587a33', '#a2c158'],
      autumn: ['#6d6837', '#b39a52'],
      winter: ['#5d5e44', '#8f8c68'],
    },
    roadside: { flowers: ['#5b4fc4', '#6c5cd6', '#7a63c9', '#4f63c8', '#8d6cc9'], flowerRate: 0.55, rock: '#2e2b29', rockRate: 0.14, rockSize: 1.4, rockMoss: '#7fa346', tufts: 0.1, tuftColour: '#b3a660', bushes: false },
  },
  ring: ARCHIPEL_RING,
  sites: archipelSites,
  building: archipelBuilding,
  noFence: archipelNoFence,
};
