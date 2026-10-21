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
  /** Villages et lieux-dits traversés (abscisse du point le plus proche). */
  landmarks?: Array<{ name: string; d: number }>;
  /** Pas d'échantillonnage effectif des points (m). */
  stepM?: number;
  minElevationM?: number;
  maxElevationM?: number;
  /** Pente maximale sur 10 m (%). */
  maxGradePct?: number;
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
  generatedAt: string;
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
    roof: { shape: string; height: number; colour?: string };
    colour?: string;
    material?: string;
    name?: string;
    y: number;
    pts: number[];
    holes?: number[][];
  }>;
  forests: Array<{ id: string; kind: 'deciduous' | 'conifer' | 'mixed'; name?: string; rings: WorldRings }>;
  fields: Array<{ id: string; kind: string; name?: string; rings: WorldRings }>; // farmland, meadow, grass, orchard, vineyard, allotments, heath, scrub, wetland, bare, sand
  landuse: Array<{ id: string; kind: string; name?: string; rings: WorldRings }>; // residential, industrial, commercial, cemetery, farmyard, park, golf, pitch, garden, quarry, railway
  water: Array<{ id: string; kind: 'lake' | 'river' | 'pond' | 'reservoir'; name?: string; level: number; rings: WorldRings }>;
  waterways: Array<{ id: number; kind: string; width: number; name?: string; tunnel?: boolean; pts: number[] }>;
  railways: Array<{ id: number; kind: string; width: number; name?: string; tunnel?: boolean; bridge?: boolean; pts: number[] }>;
  pois: Array<{ id: string; kind: string; name: string; x: number; y: number; z: number; ele?: number }>;
}
