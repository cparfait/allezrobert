/**
 * Mondes fictifs du mode Poly : l'île de Robert (tools/island) et le Pays de Robert (tools/massif). Ce que l'écran de
 * carte (ui/islandAtlas.ts) et les lieux à découvrir (islandDiscover.ts) savent de chacun : titre, carte, lieux
 * cliquables, parcours mis en avant, lieux à découvrir. Les deux mondes ont la même emprise (38 × 26 km).
 */
import { ISLAND_PLACES, type IslandPlace } from './islandDiscover.ts';
import { ROBERT_ISLAND, ROBERT_LAND } from './worlds.ts';

/** Lieu de la carte : parcours mis en avant selon le vélo équipé (route, gravel, VTT). */
export interface MapPlace {
  x: number;
  z: number;
  label: string;
  labelEn: string;
  route: string;
  gravel?: string;
  mtb?: string;
}

export interface PolyWorld {
  id: string;
  title: { fr: string; en: string };
  /** Accroche courte (onglet du choix du monde). */
  hint: { fr: string; en: string };
  map: { fr: string; en: string };
  /** Parcours en tête de liste, dans cet ordre. */
  priority: readonly string[];
  places: readonly MapPlace[];
  /** Lieux à découvrir et clé du navigateur où sont gardés ceux déjà trouvés. */
  discover: readonly IslandPlace[];
  foundKey: string;
  /** Nom du Tour à étapes du monde. */
  tour: { fr: string; en: string };
  /** Étiquettes particulières de la liste (front de mer, circuit, montée). */
  tags: { coast: string; ring: string; climb: string };
}

export const PAYS_PLACES: readonly IslandPlace[] = [
  { id: 'observatoire', name: { fr: "L'Observatoire du Pic de l'Aigle", en: 'Eagle Peak observatory' }, x: 1600, z: -6900, r: 180 },
  { id: 'col-aigle', name: { fr: "Le Col de l'Aigle", en: 'Eagle Pass' }, x: 2902, z: -6522, r: 170 },
  { id: 'lac-aigle', name: { fr: "Le Lac de l'Aigle", en: 'Eagle Lake' }, x: 3750, z: -5450, r: 400 },
  { id: 'grande-tete', name: { fr: 'La Chapelle de la Grande Tête', en: 'Grande Tête chapel' }, x: 4580, z: -5920, r: 260 },
  { id: 'abbaye', name: { fr: "L'Abbaye du Lac", en: 'Lake abbey' }, x: -5000, z: -3700, r: 300 },
  { id: 'lac-robert', name: { fr: 'Le Lac de Robert', en: 'Lake Robert' }, x: -5600, z: -1500, r: 700 },
  { id: 'pralong', name: { fr: 'La station de Pralong', en: 'Pralong ski resort' }, x: -8300, z: -5300, r: 250 },
  { id: 'telepherique', name: { fr: 'Le téléphérique de Pralong', en: 'Pralong cable car' }, x: -9300, z: -6300, r: 300 },
  { id: 'bike-park', name: { fr: 'Le Bike park de Pralong', en: 'Pralong bike park' }, x: -7650, z: -4750, r: 420 },
  { id: 'circuit', name: { fr: 'Le Circuit de la Plaine', en: 'Plain circuit' }, x: -6900, z: 3700, r: 420 },
  { id: 'cyclo-cross', name: { fr: 'Le Cyclo-cross de la Plaine', en: 'Plain cyclocross' }, x: -4500, z: 2700, r: 380 },
  { id: 'gorges', name: { fr: 'Les Gorges de la Robine', en: 'Robine gorges' }, x: 6900, z: -300, r: 450 },
  { id: 'moulin', name: { fr: 'Le Moulin des Olivettes', en: 'Olive hills windmill' }, x: 4700, z: 4800, r: 220 },
  { id: 'chateau', name: { fr: 'Le Château de Roche-Haute', en: 'Roche-Haute castle' }, x: 12700, z: -1700, r: 280 },
  { id: 'salins', name: { fr: "L'Étang du Sel", en: 'Salt pond' }, x: -12560, z: 7218, r: 900 },
  { id: 'promenade', name: { fr: 'La Promenade de Port-Azur', en: 'Port-Azur promenade' }, x: -438, z: 8650, r: 500 },
  { id: 'calanque', name: { fr: 'Le Port de la Calanque', en: 'Calanque harbour' }, x: 10424, z: 9518, r: 400 },
  { id: 'aber', name: { fr: "Le Port de l'Aber", en: 'Aber harbour' }, x: -499, z: -10138, r: 400 },
  { id: 'valrobert', name: { fr: 'La place de Valrobert', en: 'Valrobert square' }, x: -2600, z: 1200, r: 130 },
];

const ISLAND: PolyWorld = {
  id: ROBERT_ISLAND,
  title: { fr: 'L’Île de Robert', en: 'Robert’s Island' },
  hint: { fr: 'Mer, planches et col du Phare', en: 'Sea, boardwalk and Lighthouse pass' },
  map: { fr: 'Carte topographique de l’Île de Robert', en: 'Topographic map of Robert’s Island' },
  priority: ['decouverte-de-l-ile', 'front-de-mer', 'fleche-du-phare', 'classique-des-pierres', 'chrono-du-plateau', 'descente-du-phare', 'phare-de-nuit', 'port-de-robertville', 'anneau', 'criterium-saint-robert', 'anneau-piste-verte', 'phare', 'phare-versant-nord', 'chrono-du-plateau', 'kerbrou-et-le-port', 'tour-de-l-ile', 'gravel-des-bois', 'gravel-des-vignes', 'grande-traversee', 'chemin-des-douaniers', 'vtt-des-bois', 'vtt-du-renard', 'descente-du-phare', 'vtt-du-phare'],
  places: [
    { x: 971, z: 9601, label: 'Robertville', labelEn: 'Robertville', route: 'front-de-mer', mtb: 'vtt-des-coteaux' },
    { x: 300, z: -200, label: 'Saint-Robert', labelEn: 'Saint-Robert', route: 'boucle-de-saint-robert', gravel: 'gravel-du-grand-pre' },
    { x: -4700, z: 900, label: 'L’Anneau', labelEn: 'The Ring', route: 'anneau' },
    { x: 7579, z: -8131, label: 'Col du Phare', labelEn: 'Lighthouse Pass', route: 'phare', mtb: 'vtt-du-phare' },
    { x: -8200, z: -2600, label: 'Bois-Joli', labelEn: 'Bois-Joli', route: 'kerbrou-et-le-port', gravel: 'gravel-des-bois', mtb: 'vtt-des-bois' },
    { x: -1790, z: -9880, label: 'Kerbrou', labelEn: 'Kerbrou', route: 'kerbrou-et-le-port', gravel: 'gravel-de-kerbrou' },
    { x: 6900, z: 2500, label: 'Vallon-sur-Robe', labelEn: 'Vallon-sur-Robe', route: 'voie-verte-de-la-robe', gravel: 'gravel-de-la-vallee' },
    { x: 12300, z: 900, label: 'Les Granges', labelEn: 'Les Granges', route: 'chrono-du-plateau', gravel: 'gravel-du-plateau', mtb: 'vtt-du-plateau' },
    { x: -2300, z: 3900, label: 'Les Vignes', labelEn: 'Les Vignes', route: 'tour-des-coteaux', gravel: 'gravel-des-vignes' },
    { x: -15820, z: 2255, label: 'Saint-Pierre', labelEn: 'Saint-Pierre', route: 'piste-verte', gravel: 'gravel-de-saint-pierre' },
    { x: -7973, z: 8924, label: 'La Pointe', labelEn: 'La Pointe', route: 'velomaritime', gravel: 'gravel-de-la-lagune', mtb: 'vtt-des-buttes' },
  ],
  discover: ISLAND_PLACES,
  foundKey: 'ar.islandFound',
  tour: { fr: 'Tour de l’Île', en: 'Tour of the Island' },
  tags: { coast: 'front-de-mer', ring: 'anneau', climb: 'phare' },
};

const LAND: PolyWorld = {
  id: ROBERT_LAND,
  title: { fr: 'Le Pays de Robert', en: 'Robert’s Land' },
  hint: { fr: 'Montagne, lac, gorges et calanques', en: 'Mountains, lake, gorges and coves' },
  map: { fr: 'Carte topographique du Pays de Robert', en: 'Topographic map of Robert’s Land' },
  priority: ['promenade-de-port-azur', 'anneau', 'col-de-l-aigle', 'pic-de-l-aigle', 'col-par-l-aber', 'montee-de-pralong', 'gorges-de-la-robine', 'tour-du-lac', 'criterium-de-valrobert', 'boucle-de-valrobert', 'corniche-des-calanques', 'plateau-des-lavandes', 'chrono-de-la-plaine', 'grand-tour-des-cols', 'tour-du-pays', 'gravel-des-alpages', 'gravel-des-lavandes', 'grande-traversee', 'chemin-des-calanques', 'bike-park-de-pralong', 'descente-de-l-aigle', 'vtt-des-marmottes'],
  places: [
    { x: -438, z: 8891, label: 'Port-Azur', labelEn: 'Port-Azur', route: 'promenade-de-port-azur', gravel: 'chemin-de-la-pointe' },
    { x: -2600, z: 1200, label: 'Valrobert', labelEn: 'Valrobert', route: 'boucle-de-valrobert', gravel: 'cyclo-cross-de-la-plaine' },
    { x: -6900, z: 3700, label: 'Le Circuit', labelEn: 'The Circuit', route: 'anneau', gravel: 'grande-traversee' },
    { x: 2902, z: -6522, label: 'Col de l’Aigle', labelEn: 'Eagle Pass', route: 'col-de-l-aigle', mtb: 'descente-de-l-aigle' },
    { x: 1600, z: -6900, label: 'Pic de l’Aigle', labelEn: 'Eagle Peak', route: 'pic-de-l-aigle', mtb: 'vtt-de-la-grande-tete' },
    { x: -483, z: -9801, label: 'L’Aber', labelEn: 'L’Aber', route: 'col-par-l-aber' },
    { x: -8300, z: -5300, label: 'Pralong', labelEn: 'Pralong', route: 'montee-de-pralong', gravel: 'gravel-des-alpages', mtb: 'bike-park-de-pralong' },
    { x: -5600, z: -2500, label: 'Lac de Robert', labelEn: 'Lake Robert', route: 'tour-du-lac', gravel: 'gravel-des-vignes', mtb: 'vtt-du-lac' },
    { x: 7600, z: 3700, label: 'Les Gorges', labelEn: 'The Gorges', route: 'gorges-de-la-robine', mtb: 'vtt-des-gorges' },
    { x: 11800, z: -600, label: 'Roche-Haute', labelEn: 'Roche-Haute', route: 'plateau-des-lavandes', gravel: 'gravel-des-lavandes' },
    { x: 10171, z: 9287, label: 'La Calanque', labelEn: 'La Calanque', route: 'corniche-des-calanques', gravel: 'chemin-des-calanques', mtb: 'vtt-des-calanques' },
    { x: 3800, z: 5600, label: 'Les Olivettes', labelEn: 'Les Olivettes', route: 'golfe-et-olivettes', gravel: 'gravel-des-oliviers' },
    { x: -12300, z: 900, label: 'Sainte-Marthe', labelEn: 'Sainte-Marthe', route: 'chrono-de-la-plaine', gravel: 'gravel-du-delta' },
    { x: -13774, z: 4897, label: 'Les Salins', labelEn: 'Les Salins', route: 'delta-et-salins', gravel: 'gravel-des-salins' },
  ],
  discover: PAYS_PLACES,
  foundKey: 'ar.paysFound',
  tour: { fr: 'Tour du Pays', en: 'Tour of the Land' },
  tags: { coast: 'promenade-de-port-azur', ring: 'anneau', climb: 'col-de-l-aigle' },
};

export const POLY_WORLDS: readonly PolyWorld[] = [ISLAND, LAND];

/** Monde Poly de cet identifiant ; undefined pour une zone réelle. */
export function polyWorld(id: string): PolyWorld | undefined {
  return POLY_WORLDS.find((w) => w.id === id);
}

// ── Monde chargé : ce qui, dans le décor partagé, dépend du monde (circuit sans voitures ni clôtures, promenade) ──

let active = '';

/** Monde chargé (appelé par World au chargement). */
export function setActivePolyWorld(id: string): void {
  active = id;
}

export function activePolyWorld(): string {
  return active;
}

/** Circuits des mondes Poly (tools/island et tools/massif, ANNEAU). */
const RINGS: Record<string, { x: number; z: number; half: number; radius: number }> = {
  [ROBERT_ISLAND]: { x: -4700, z: 900, half: 560, radius: 215 },
  [ROBERT_LAND]: { x: -6900, z: 3700, half: 560, radius: 215 },
};

/** Distance à l'axe du circuit du monde chargé (m) ; Infinity hors des mondes Poly. */
export function circuitDistance(x: number, z: number): number {
  const r = RINGS[active];
  if (!r) return Infinity;
  const dx = Math.max(0, Math.abs(x - r.x) - r.half);
  const d = Math.hypot(dx, z - r.z) - r.radius;
  // Lignes droites un peu bombées vers l'extérieur (18 m au plus).
  return dx === 0 ? Math.max(0, d - 19, -d) : Math.abs(d);
}

/** Promenade en bois de Port-Azur (Pays de Robert) : ni clôtures ni poteaux de campagne. */
export function onPaysPromenade(x: number, z: number): boolean {
  return active === ROBERT_LAND && Math.hypot(x + 450, z - 8900) < 1600;
}
