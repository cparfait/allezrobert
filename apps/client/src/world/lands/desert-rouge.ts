/**
 * Le Désert rouge (mode Poly) : données du monde pour le client (généré par tools/desert-rouge, voir
 * docs/DESERT_ROUGE.md). Croissant de terre rouge ouvert sur le golfe de Corail : Grand Canyon de l'Oued Rouge d'une
 * corne à l'autre (Lacets du Canyon), Grand Erg sur la corne ouest, plateaux en gradins et massif du Vautour à l'est,
 * Chott Blanc (lac salé à sec), oasis reliées en étoile au Puits de l'Étoile, villages en terre crue, Citadelle Rouge.
 */
import { rng } from '../../engine/noise.ts';
import type { TileBuilding } from '../types.ts';
import type { PolyLand } from './types.ts';
import { DESERT_RING, desertRougeNoFence, desertRougeSites } from './desert-rougeSites.ts';

/**
 * Terre crue sourde et claire (27/11/2026 : « rouge fluo ») : sable, beige rosé, ocre doux, terre claire, quelques
 * enduits blanc cassé ; chaux blanche au bord de la mer.
 */
const EARTH = ['#d8bf9a', '#cfae8c', '#c49a6c', '#b98d66', '#d3b691', '#c9a580', '#bf9672', '#e6d8c0'] as const;

function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

/** Couleurs trop vives (briques, ocres saturés, oranges) ramenées à la terre crue sourde : une teinte de EARTH. */
function earthen(hex: string, r: () => number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const R = n >> 16;
  const G = (n >> 8) & 255;
  const B = n & 255;
  const hi = Math.max(R, G, B);
  const sat = hi > 0 ? (hi - Math.min(R, G, B)) / hi : 0;
  return sat > 0.5 ? EARTH[Math.floor(r() * EARTH.length)]! : hex;
}

/**
 * Terre crue : murs ocre en façade « adobe » (buildings.ts : petites fenêtres sombres, ni volets ni encadrement
 * clair, bouts de poutres sous le toit, porte de bois côté rue), toits plats en terrasse de la couleur des murs ;
 * chaux blanche au bord de la mer (fenêtres gardées). Hangars des tribunes remplacés par de vrais gradins (décor).
 */
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
  const colour = earthen(b.colour ?? EARTH[Math.floor(r() * EARTH.length)]!, r);
  const white = Number.parseInt(colour.slice(1, 3), 16) > 231;
  // Maisons, fermes, maison commune (générées en « hut ») : murs pleins, sans volets.
  const adobe = !white && ['hut', 'house', 'apartments', 'farm', 'public', 'commercial'].includes(b.kind);
  return {
    ...b,
    ...(adobe ? { facade: 'adobe' as const } : {}),
    colour,
    material: b.material === 'stone' ? 'stone' : 'plaster',
    roofColour: shade(colour, white ? 0.97 : 0.92 + r() * 0.1),
    roofOverhang: 0,
    // Hauteurs un peu inégales d'une maison à l'autre (terrasses décalées).
    height: b.kind === 'house' ? b.height * (0.92 + r() * 0.16) : b.height,
  };
}

export const DESERT_ROUGE: PolyLand = {
  world: {
    id: 'desert-rouge',
    title: { fr: 'Le Désert rouge', en: 'The Red Desert' },
    hint: { fr: 'Buttes rouges, grand canyon et longues routes droites', en: 'Red buttes, grand canyon and long straight roads' },
    map: { fr: 'Carte topographique — Le Désert rouge', en: 'Topographic map — The Red Desert' },
    priority: [
      'decouverte-du-desert', 'classique-des-canyons', 'classique-des-dunes', 'chrono-de-la-piste-droite', 'mesa-de-nuit', 'lacets-du-canyon', 'circuit-du-chott',
      'grande-montee-du-vautour', 'pic-du-vautour', 'route-du-canyon', 'corniche-du-canyon', 'promenade-de-port-corail', 'montee-de-la-grande-mesa', 'criterium-de-rocherouge',
      'tour-du-desert', 'gravel-de-l-etoile', 'golfe-et-oasis', 'plateau-du-ksar', 'gravel-de-la-mesa', 'gravel-des-oasis', 'cyclo-cross-des-sables',
      'bike-park-des-buttes', 'descente-du-vautour', 'vtt-du-canyon', 'vtt-des-arches',
    ],
    places: [
      { x: -572, z: -2589, label: 'Rocherouge', labelEn: 'Rocherouge', route: 'decouverte-du-desert', gravel: 'gravel-des-oasis' },
      { x: 351, z: -4, label: 'Port-Corail', labelEn: 'Port-Corail', route: 'promenade-de-port-corail', gravel: 'gravel-des-oasis' },
      { x: -3625, z: -1926, label: 'Circuit du Chott', labelEn: 'Salt lake circuit', route: 'circuit-du-chott', gravel: 'gravel-des-oasis' },
      { x: -5994, z: -1722, label: 'Puits-Salé', labelEn: 'Puits-Salé', route: 'tour-du-chott', gravel: 'cyclo-cross-des-sables' },
      { x: -7060, z: -6817, label: 'Grande Mesa', labelEn: 'Great Mesa', route: 'mesa-de-nuit', gravel: 'gravel-de-la-mesa' },
      { x: -12142, z: 2065, label: 'Sablons', labelEn: 'Sablons', route: 'chrono-de-la-piste-droite', gravel: 'grande-traversee' },
      { x: -12594, z: -2659, label: 'Oasis des Dunes', labelEn: 'Dunes oasis', route: 'route-des-dunes', gravel: 'classique-des-dunes' },
      { x: -11829, z: 3419, label: 'Les Salines', labelEn: 'Les Salines', route: 'salines-et-sablons', gravel: 'chemin-de-la-pointe' },
      { x: 1942, z: -1154, label: 'Buttes Rouges', labelEn: 'Red Buttes', route: 'boucle-de-rocherouge', gravel: 'cyclo-cross-des-sables', mtb: 'bike-park-des-buttes' },
      { x: 0, z: -7600, label: "Puits de l'Étoile", labelEn: 'Star Well', route: 'classique-des-canyons', gravel: 'gravel-de-l-etoile', mtb: 'vtt-du-canyon' },
      { x: -3287, z: -10048, label: 'Port-Vent', labelEn: 'Port-Vent', route: 'corniche-des-falaises', gravel: 'gravel-de-l-etoile' },
      { x: 9086, z: -3115, label: 'Lacets du Canyon', labelEn: 'Canyon hairpins', route: 'lacets-du-canyon', mtb: 'vtt-du-canyon' },
      { x: 4469, z: -6561, label: 'Les Cairns', labelEn: 'Les Cairns', route: 'corniche-du-canyon', gravel: 'gravel-des-oasis', mtb: 'vtt-du-canyon' },
      { x: 13156, z: -2422, label: 'Pic du Vautour', labelEn: 'Vulture Peak', route: 'pic-du-vautour', mtb: 'vtt-du-vautour' },
      { x: 3680, z: -5482, label: 'Grand Canyon', labelEn: 'Grand Canyon', route: 'route-du-canyon', mtb: 'vtt-du-canyon' },
      { x: 10384, z: 328, label: 'Ksar-Rouge', labelEn: 'Ksar-Rouge', route: 'plateau-du-ksar', mtb: 'vtt-de-la-dent-rouge' },
      { x: 11551, z: 3440, label: 'Cap-Brique', labelEn: 'Cap-Brique', route: 'tour-du-desert' },
      { x: 5073, z: -1777, label: 'L’Oasis', labelEn: 'The Oasis', route: 'golfe-et-oasis', gravel: 'gravel-des-oasis', mtb: 'vtt-des-arches' },
    ],
    discover: [
      { id: 'observatoire', name: { fr: "L'Observatoire du Pic du Vautour", en: 'Vulture Peak observatory' }, x: 13156, z: -2422, r: 180 },
      { id: 'lacets', name: { fr: 'Les Lacets du Canyon', en: 'Canyon hairpins' }, x: 9086, z: -3115, r: 300 },
      { id: 'guelta', name: { fr: 'La Guelta du Vautour', en: 'Vulture rock pool' }, x: 12354, z: -4218, r: 350 },
      { id: 'tete-du-vautour', name: { fr: 'Le Cairn de la Tête du Vautour', en: "Vulture's Head cairn" }, x: 14173, z: -278, r: 260 },
      { id: 'citadelle', name: { fr: 'La Citadelle Rouge', en: 'Red Citadel' }, x: 11259, z: 544, r: 300 },
      { id: 'canyon', name: { fr: "Le Grand Canyon de l'Oued Rouge", en: 'Red Wadi grand canyon' }, x: 3680, z: -5482, r: 450 },
      { id: 'breche', name: { fr: 'La Brèche du Centre', en: 'Central breach' }, x: -347, z: -5535, r: 300 },
      { id: 'gue-des-sables', name: { fr: 'Le Gué des Sables', en: 'Sand ford' }, x: -14045, z: 984, r: 300 },
      { id: 'chott', name: { fr: 'Le Chott Blanc', en: 'White salt lake' }, x: -4925, z: -1926, r: 700 },
      { id: 'grande-mesa', name: { fr: 'Mesa-Haute, sur la Grande Mesa', en: 'Mesa-Haute on the Great Mesa' }, x: -7060, z: -6817, r: 300 },
      { id: 'buttes', name: { fr: 'Les Buttes Rouges', en: 'Red Buttes' }, x: 1942, z: -1154, r: 450 },
      { id: 'arches', name: { fr: 'Les Arches de pierre', en: 'Stone arches' }, x: 2773, z: -1308, r: 350 },
      { id: 'source', name: { fr: "La Source de l'Oasis", en: 'Oasis spring' }, x: 5277, z: -1322, r: 300 },
      { id: 'oasis-des-dunes', name: { fr: "L'Oasis des Dunes", en: 'Dunes oasis' }, x: -12594, z: -2659, r: 300 },
      { id: 'etoile', name: { fr: "Le Puits de l'Étoile", en: 'Star Well' }, x: 0, z: -7600, r: 250 },
      { id: 'grand-erg', name: { fr: 'Le Grand Erg', en: 'Great Erg' }, x: -11210, z: -1081, r: 1500 },
      { id: 'piste-droite', name: { fr: 'La Piste Droite', en: 'The Straight Road' }, x: -9023, z: -8, r: 500 },
      { id: 'caravanserail', name: { fr: 'Le Caravansérail du Chott', en: 'Salt lake caravanserai' }, x: -3593, z: -1408, r: 250 },
      { id: 'salines', name: { fr: 'Les Salines', en: 'Salt pans' }, x: -11829, z: 3419, r: 600 },
      { id: 'promenade', name: { fr: 'La Promenade de Port-Corail', en: 'Port-Corail promenade' }, x: 351, z: 260, r: 500 },
      { id: 'cap-brique', name: { fr: 'Le Port de Cap-Brique', en: 'Cap-Brique harbour' }, x: 11377, z: 3564, r: 400 },
      { id: 'port-vent', name: { fr: 'Le Port de Port-Vent', en: 'Port-Vent harbour' }, x: -3317, z: -10245, r: 400 },
      { id: 'rocherouge', name: { fr: 'La place de Rocherouge', en: 'Rocherouge square' }, x: -572, z: -2589, r: 130 },
    ],
    foundKey: 'ar.found.desert-rouge',
    tour: { fr: 'Tour du Désert rouge', en: 'Tour of the Red Desert' },
    tags: { coast: 'promenade-de-port-corail', ring: 'circuit-du-chott', climb: 'lacets-du-canyon' },
  },
  theme: {
    // Sud-Ouest américain (27/11/2026) : plaine de terre rouge-orangé, roche plus rouge en strates, sable clair des
    // dunes ; champs (seulement autour des sources) en vert de palmeraie ; abords des maisons en terre battue, un
    // peu plus foncée que les murs de terre crue (27/11/2026).
    ground: {
      spring: { forest: '#4f6a2e', field: '#557a32', field2: '#6d8a3a', meadow: '#c4703f', urban: '#b08b65', dirt: '#a8502b' },
      summer: { forest: '#4c652c', field: '#527530', field2: '#6a8438', meadow: '#c97745', urban: '#b38d67', dirt: '#ad552d' },
      autumn: { forest: '#52662e', field: '#587632', field2: '#738638', meadow: '#c16c3e', urban: '#ae8963', dirt: '#a54e2a' },
      winter: { forest: '#4d622e', field: '#537230', field2: '#687f3a', meadow: '#ba6c40', urban: '#aa8661', dirt: '#9f4e2b' },
    },
    sand: ['#d09062', '#ecc594'],
    rock: '#a8482a',
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
    // Air sec du désert : pas de brume en plus, lumière chaude, couleurs franches (ciel d'un bleu soutenu, roche
    // rouge). Pas de teinte d'horizon : environment.ts la mêle au brouillard même la nuit (voir docs/DESERT_ROUGE.md).
    light: { haze: 0, warmth: 0.45, saturation: 1.14 },
  },
  // Palmiers (oasis) à la place des feuillus, grands cactus à bras à la place des sapins, presque pas d'herbe, ni
  // bétail ni mobilier de village européen ; bas-côtés d'armoise gris-vert, fleurs roses et jaunes du désert. Les bois du générateur ne sont plus que les palmeraies des oasis : on en garde l'essentiel.
  biome: { tree: 'palm', conifer: 'cactus', grass: 0.08, trees: 0.7, noVillageProps: true, noHerds: true, grassColours: { spring: ['#9a8a4c', '#d6c37a'], summer: ['#a48a4a', '#dcc478'], autumn: ['#9c7e46', '#d2b070'], winter: ['#958a5a', '#cfc08a'] } , roadside: { flowers: ['#e86fa0', '#f2c14e'], flowerRate: 0.12, rock: '#b2643a', rockRate: 0.16, rockSize: 1.9, tufts: 0.35, tuftColour: '#a4a676', bushes: false } },
  ring: DESERT_RING,
  sites: desertRougeSites,
  building: desertBuilding,
  noFence: desertRougeNoFence,
};
