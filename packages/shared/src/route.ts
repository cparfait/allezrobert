/**
 * Format des itinéraires du monde. Coordonnées monde en mètres :
 * x = est, z = sud (repère Three.js, y vers le haut), origine = point de référence du monde
 * (Lambert-93 décalé, voir tools/terrain). `d` = distance curviligne depuis le départ.
 */
export interface RoutePoint {
  x: number;
  y: number; // altitude lissée (m)
  z: number;
  d: number; // distance cumulée (m)
}

export type SegmentKind = 'kom' | 'sprint' | 'section';

export interface RouteSegment {
  id: string;
  kind: SegmentKind;
  name: string;
  startM: number;
  endM: number;
  /** Pente moyenne en %. */
  avgGrade: number;
}

/** Catégorie d'une côte, comme dans les courses par étapes (4 = la plus facile, 0 = hors catégorie). */
export type ClimbCategory = 4 | 3 | 2 | 1 | 0;

/** Seuils de difficulté (longueur en m × pente moyenne en %) des catégories 4, 3, 2, 1 puis hors catégorie. */
const CATEGORY_THRESHOLDS = [8000, 16000, 32000, 64000, 80000] as const;

export function climbCategory(seg: Pick<RouteSegment, 'startM' | 'endM' | 'avgGrade'>): ClimbCategory {
  const score = (seg.endM - seg.startM) * Math.max(seg.avgGrade, 0);
  if (score >= CATEGORY_THRESHOLDS[4]) return 0;
  if (score >= CATEGORY_THRESHOLDS[3]) return 1;
  if (score >= CATEGORY_THRESHOLDS[2]) return 2;
  if (score >= CATEGORY_THRESHOLDS[1]) return 3;
  return 4;
}

/** Libellé court : « HC », « 1re cat. »… (`fr`) ou « HC », « Cat. 1 »… */
export function climbCategoryLabel(cat: ClimbCategory, fr = true): string {
  if (cat === 0) return fr ? 'Hors catégorie' : 'Beyond category';
  return fr ? `${cat === 1 ? '1re' : `${cat}e`} catégorie` : `Cat. ${cat}`;
}

/** Points du classement de la montagne selon la catégorie, du 1er au dernier à marquer. */
const KOM_POINTS: Record<ClimbCategory, readonly number[]> = {
  0: [20, 15, 12, 10, 8, 6, 4, 2],
  1: [10, 8, 6, 4, 2, 1],
  2: [5, 3, 2, 1],
  3: [2, 1],
  4: [1],
};

export function komPoints(cat: ClimbCategory): readonly number[] {
  return KOM_POINTS[cat];
}

export interface RouteData {
  id: string;
  name: string;
  nameEn?: string;
  /** Boucle fermée : la distance revient à zéro après `lengthM`. */
  loop: boolean;
  lengthM: number;
  elevationGainM: number;
  points: RoutePoint[];
  segments: RouteSegment[];
  /** Largeur de chaussée en mètres (pour le décalage latéral) : médiane sur l'itinéraire. */
  roadWidthM: number;
  attribution: string[];
  /** Largeur de chaussée OSM par tronçon (facultatif, produit par tools/terrain). */
  roadWidths?: Array<{ startM: number; endM: number; widthM: number }>;
  /**
   * Revêtement OSM (`surface` : asphalt, gravel, dirt…) par tronçon, facultatif ; absent :
   * enrobé partout. Sert à la résistance au roulement et au son.
   */
  surfaces?: Array<{ startM: number; endM: number; surface: string }>;
  /** Villages et lieux-dits traversés (abscisse du point le plus proche). */
  landmarks?: Array<{ name: string; d: number }>;
  /** Pas d'échantillonnage effectif des points (m). */
  stepM?: number;
  minElevationM?: number;
  maxElevationM?: number;
  /** Pente maximale sur 10 m (%). */
  maxGradePct?: number;
  /**
   * Lacets (montées) : épingles d'au moins 150° détectées sur la géométrie, dans l'ordre du
   * parcours. `number` = numéro officiel (Alpe d'Huez : 21 → 1) s'il existe ; `d` = sommet du
   * virage ; `radiusM` = rayon minimal de l'axe de la chaussée ; `altitudeM` = altitude de la route.
   */
  hairpins?: RouteHairpin[];
  /** Marquage de la chaussée : rives et axe (défaut), axe seul, ou aucun (petites départementales). */
  markings?: 'full' | 'axis' | 'none';
}

export interface RouteHairpin {
  number?: number;
  name?: string;
  d: number;
  turnDeg: number;
  radiusM: number;
  altitudeM: number;
  /** Altitude inscrite sur le panneau (OSM `ele`), si connue. */
  signAltitudeM?: number;
  /** Vainqueurs d'étape inscrits sur la plaque (OSM `inscription`), si connus. */
  inscription?: string;
}

/*
 * Monde par tuiles (produit par tools/terrain, voir tools/terrain/README.md).
 * Fichiers : apps/client/public/worlds/<id>/world.json, routes/<route>.json,
 * tiles/<tx>_<tz>.json (entités), tiles/<tx>_<tz>.lo.u16 et .hi.u16 (altitudes),
 * tiles/<tx>_<tz>.ortho.jpg (facultatif).
 * Tuile (tx, tz) : x ∈ [tx·T, (tx+1)·T], z ∈ [tz·T, (tz+1)·T] avec T = tileSizeM.
 */

export type WorldLodId = 'lo' | 'hi';

export interface WorldLod {
  id: WorldLodId;
  /** Pas de grille (m). */
  resolutionM: number;
  /** Nombre d'intervalles par côté : la grille a (n+1)×(n+1) échantillons. */
  n: number;
  /** Suffixe du fichier binaire : tiles/<tx>_<tz><suffix>. */
  suffix: string;
}

export interface WorldTileIndex {
  id: string; // "tx_tz"
  tx: number;
  tz: number;
  /** Altitude de référence des grilles (m) : h = baseM + q × heightEncoding.stepM. */
  baseM: number;
  minM: number;
  maxM: number;
  /** Fichiers disponibles : 'lo' toujours, 'hi' près des itinéraires, 'ortho' si orthophoto. */
  lods: Array<WorldLodId | 'ortho'>;
  bytes: number;
  /** Pas de quantification propre à la tuile (haute montagne, dénivelé > 655 m) ; défaut heightEncoding.stepM. */
  stepM?: number;
}

/**
 * Relief lointain (ligne d'horizon des montagnes) : une seule grille grossière autour du monde,
 * même encodage que les tuiles (Uint16 petit-boutiste, ligne 0 = nord), h = baseM + q × stepM.
 * Échantillon (i, j) au point monde (x0 + i·resolutionM, z0 + j·resolutionM), (n+1)² valeurs.
 */
export interface WorldHorizon {
  file: string;
  x0: number;
  z0: number;
  n: number;
  resolutionM: number;
  baseM: number;
  stepM: number;
  minM: number;
  maxM: number;
  /** Orthophoto grossière du même carré (ligne 0 au nord), fichier relatif au dossier du monde. */
  ortho?: string;
}

export interface WorldRouteIndex {
  id: string;
  file: string; // relatif au dossier du monde
  name: string;
  lengthM: number;
  elevationGainM: number;
  loop: boolean;
  main: boolean;
}

export interface WorldMeta {
  formatVersion: 1;
  id: string;
  name: string;
  crs: 'EPSG:2154';
  /** Origine du repère monde en Lambert-93 (EPSG:2154) : x = E − origin.x, z = −(N − origin.y). */
  originL93: { x: number; y: number };
  /** Emprise en mètres dans le repère monde. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  tileSizeM: number;
  /** Résolution la plus fine des grilles d'altitude, en mètres par échantillon. */
  heightResolutionM: number;
  /** Grilles : Uint16 petit-boutiste, ligne 0 = nord (z min), colonne 0 = ouest (x min). */
  heightEncoding: { type: 'uint16le'; stepM: number; rowOrder: 'north-to-south'; colOrder: 'west-to-east' };
  lods: WorldLod[];
  tiles: WorldTileIndex[];
  routes: WorldRouteIndex[];
  /** Identifiant de l'itinéraire du jalon 1. */
  mainRoute: string;
  attribution: string[];
  /** Relief lointain facultatif (mondes de montagne). */
  horizon?: WorldHorizon;
  /**
   * Monde ouvert : graphe routier roulable (`RoadGraphData`, fichier relatif au dossier du monde)
   * et point de départ par défaut. Toutes les routes y sont creusées et dessinées. `places` :
   * villes, villages et hameaux (`WorldPlace[]`, fichier relatif), pour la carte d'itinéraire.
   */
  open?: { graph: string; start: { x: number; z: number }; places?: string };
  /** Monde côtier : surface de la mer à cette altitude (m, NGF), fonds marins sous ce niveau. */
  sea?: { levelM: number };
}

/** Lieu habité (OSM `place` : town, village, hamlet…) d'un monde ouvert, repère monde. */
export interface WorldPlace {
  name: string;
  kind: string;
  x: number;
  z: number;
}

/** Polygone : anneaux plats [x0,z0,x1,z1,…] ; le premier est l'extérieur, les suivants des trous. */
export type WorldRings = number[][];

/** Entités d'une tuile (tiles/<tx>_<tz>.json), coordonnées monde en mètres (cm près). */
export interface WorldTile {
  id: string;
  tx: number;
  tz: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  heights: {
    baseM: number;
    stepM: number;
    encoding: 'uint16le';
    /** Valeurs codées en différences (voir heights.ts) ; absent : valeurs brutes. */
    delta?: true;
    lo: { n: number; resolutionM: number; file: string };
    hi?: { n: number; resolutionM: number; file: string };
  };
  /**
   * Routes en 3D [x,y,z,…] (y = profil de chaussée lissé). `route` : morceau d'un itinéraire
   * (géométrie lissée identique à routes/<id>.json). `flatten` : [demi-largeur plate, rayon
   * extérieur du raccord] du couloir déjà creusé dans les altitudes.
   */
  roads: Array<{
    id: string;
    kind: string;
    name?: string;
    ref?: string;
    width: number;
    surface: string;
    bridge?: boolean;
    tunnel?: boolean;
    route?: string;
    flatten?: [number, number];
    pts: number[];
  }>;
  /** Emprises au sol [x,z,…] ; `y` = altitude minimale du terrain sous l'emprise. */
  buildings: Array<{
    id: string;
    kind: string; // house, apartments, church, chapel, farm, barn, shed, garage, industrial, commercial, public, castle, greenhouse, tower, roof, ruins
    height: number; // hauteur totale au faîtage (m)
    levels: number;
    minHeight?: number;
    /**
     * `material` du toit (BD TOPO) : tiles, slate, metal, concrete ; `ridge: 'short'` = faîtage
     * parallèle au petit côté (mesuré au LiDAR). `shape` peut valoir « skillion » (monopente).
     */
    roof: { shape: string; height: number; colour?: string; material?: string; ridge?: 'short' };
    colour?: string;
    /** Murs : stone, brick, render, wood, concrete (BD TOPO) ou valeur OSM `building:material`. */
    material?: string;
    name?: string;
    y: number;
    pts: number[];
    holes?: number[][];
    /** « bdtopo » sur les tuiles enrichies. */
    source?: string;
  }>;
  forests: Array<{ id: string; kind: 'deciduous' | 'conifer' | 'mixed'; name?: string; rings: WorldRings }>;
  fields: Array<{ id: string; kind: string; name?: string; rings: WorldRings }>; // farmland, meadow, grass, orchard, vineyard, allotments, heath, scrub, wetland, bare, sand, scree, glacier
  landuse: Array<{ id: string; kind: string; name?: string; rings: WorldRings }>; // residential, industrial, commercial, cemetery, farmyard, park, golf, pitch, garden, quarry, railway
  water: Array<{ id: string; kind: 'lake' | 'river' | 'pond' | 'reservoir'; name?: string; level: number; rings: WorldRings }>;
  waterways: Array<{ id: number; kind: string; width: number; name?: string; tunnel?: boolean; pts: number[] }>;
  railways: Array<{ id: number; kind: string; width: number; name?: string; tunnel?: boolean; bridge?: boolean; pts: number[] }>;
  pois: Array<{ id: string; kind: string; name: string; x: number; y: number; z: number; ele?: number }>;
  /** Arbres détectés dans le LiDAR HD : [x, z, hauteur, rayon du houppier, …] (tuiles enrichies). */
  trees?: number[];
  /** Haies et buissons du LiDAR HD : [x, z, hauteur, …]. */
  shrubs?: number[];
  /** Données fines présentes : la végétation n'est alors plus semée au hasard. */
  enriched?: { vegetation?: boolean; buildings?: boolean };
}

/**
 * Pack de cartes d'un monde (`worlds/<id>/tiles/pack.json`) : fichiers à télécharger pour jouer
 * hors ligne, chemins relatifs au dossier du monde, tailles en octets. `version` change dès qu'un
 * fichier change (empreinte des noms et tailles).
 */
export interface WorldPackManifest {
  formatVersion: 1;
  id: string;
  version: string;
  bytes: number;
  /** Taille téléchargée (fichiers compressés gzip, comme les sert le serveur et les garde l'appareil). */
  gzBytes?: number;
  files: Array<{ p: string; b: number }>;
}

/** Catalogue des zones jouables (`worlds/index.json`), livré avec le jeu. */
export interface WorldCatalogue {
  formatVersion: 1;
  zones: Array<{
    id: string;
    name: string;
    /** Département, pays (« Puy-de-Dôme · Limagne »). */
    region?: string;
    routes: Array<{ id: string; name: string; nameEn?: string; lengthM: number; elevationGainM: number; loop: boolean }>;
    /** Pack téléchargeable ; null si les tuiles ne sont pas encore publiées. */
    pack: { version: string; bytes: number; files: number; gzBytes?: number } | null;
    /** Emprise des tuiles en Lambert-93 (m) : zones voisines (qui se touchent ou se chevauchent). */
    l93?: { minE: number; minN: number; maxE: number; maxN: number };
    /** Monde ouvert (graphe routier) : parcours libre et à dessiner, raccordable aux voisines. */
    open?: true;
  }>;
}
