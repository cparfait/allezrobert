import type { RoadGraphData, RouteData, WorldPlace } from '@allezrobert/shared';

/**
 * Classes d'occupation du sol rastérisées par tuile (un octet par canal). `verge` : abords de
 * l'itinéraire actif (l'orthophoto, où la chaussée apparaît floue, y est atténuée). `alpine` :
 * roche nue et éboulis ≈ 0,5, glacier = 1. `conifer` : forêts de résineux OSM (1) ou mixtes (0,5),
 * pour la végétation seulement (les huit premiers canaux vont au matériau du terrain).
 */
export const SPLAT_CHANNELS = ['forest', 'field', 'meadow', 'water', 'urban', 'road', 'verge', 'alpine', 'conifer'] as const;
export type SplatChannel = (typeof SPLAT_CHANNELS)[number];

export type ForestKind = 'deciduous' | 'conifer' | 'mixed';

/** Polygone : anneaux plats [x0,z0,x1,z1,…] ; le premier est l'extérieur, les suivants des trous. */
export type Rings = number[][];

export interface TileRoad {
  /** Identifiant du pipeline (`route:<itinéraire>:<voie OSM>` pour les routes d'un itinéraire). */
  id?: string;
  kind: string;
  width: number;
  /** Polyligne plate x,z. */
  pts: number[];
  /** Polyligne 3D x,y,z (profil de chaussée lissé), si fournie par le pipeline. */
  pts3?: number[];
  surface?: string;
  /** Itinéraire auquel appartient ce tronçon (déjà dessiné par RoadMesh s'il est actif). */
  route?: string;
  /** Numéro de la route (OSM `ref` : « D 91 », « N 10 »). */
  ref?: string;
  bridge?: boolean;
  tunnel?: boolean;
}

export interface TileBuilding {
  pts: number[];
  height: number;
  kind: string;
  roof?: string;
  roofHeight?: number;
  levels?: number;
  /** Altitude de la base (m) si connue. */
  y?: number;
  colour?: string;
  material?: string;
  /** Matériau du toit (BD TOPO) : tiles, slate, metal, concrete. */
  roofMaterial?: string;
  /** Faîtage parallèle au petit côté de l'emprise (mesuré au LiDAR). */
  ridgeShort?: boolean;
  /** Bâtiment BD TOPO (tuile enrichie) : matériaux régionaux plutôt que ceux d'Île-de-France. */
  bdtopo?: boolean;
}

export interface TileFeatures {
  roads: TileRoad[];
  buildings: TileBuilding[];
  forests: Array<{ rings: Rings; kind: ForestKind }>;
  water: Array<{ rings: Rings; kind: string; level?: number }>;
  fields: Array<{ rings: Rings; kind: string }>;
  landuse: Array<{ rings: Rings; kind: string }>;
  waterways: Array<{ width: number; pts: number[]; kind?: string; tunnel?: boolean }>;
  /** Voies ferrées OSM (morceaux découpés à la tuile ; `id` = voie OSM, pour les raccorder ; l'altitude vient du terrain). */
  railways?: Array<{ id: number; kind: string; pts: number[]; name?: string; tunnel?: boolean; bridge?: boolean }>;
  pois: Array<{ kind: string; name: string; x: number; y: number; z: number }>;
  /** Arbres réels (LiDAR HD) : [x, z, hauteur, rayon du houppier, …]. */
  trees?: number[];
  /** Haies et buissons réels (LiDAR HD) : [x, z, hauteur, …]. */
  shrubs?: number[];
  /** Végétation réelle présente : pas de semis aléatoire sur la tuile. */
  realVegetation?: boolean;
}

export function emptyFeatures(): TileFeatures {
  return { roads: [], buildings: [], forests: [], water: [], fields: [], landuse: [], waterways: [], railways: [], pois: [] };
}

/** Tuile chargée, prête pour le rendu, en coordonnées monde. */
export interface LoadedTile {
  id: string;
  tx: number;
  tz: number;
  /** Coin nord-ouest (x min, z min) de la tuile. */
  x0: number;
  z0: number;
  size: number;
  /** Grille (n+1)×(n+1) d'altitudes absolues en mètres, ligne = z croissant. */
  n: number;
  heights: Float32Array;
  features: TileFeatures;
  /** Orthophoto IGN de la tuile (JPEG encore compressé : décodé hors du fil principal à l'affichage), facultative. */
  orthoBlob?: Blob;
  /** Raster d'occupation du sol (res×res, 6 canaux entrelacés), calculé côté client. */
  splat?: { res: number; data: Uint8Array };
}

/**
 * Relief lointain (horizon des montagnes) : grille grossière autour du monde, (n+1)² altitudes
 * absolues (m), ligne j = z0 + j·resolutionM (du nord au sud), colonne i = x0 + i·resolutionM.
 */
export interface HorizonGrid {
  x0: number;
  z0: number;
  n: number;
  resolutionM: number;
  heights: Float32Array;
  /** Orthophoto grossière du même carré (ligne 0 au nord), si le monde en a une. */
  orthoBlob?: Blob;
}

export interface WorldSource {
  id: string;
  name: string;
  tileSize: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  routes: RouteData[];
  attribution: string[];
  /** Origine Lambert-93, pour reconvertir les positions en GPS (export FIT). */
  originL93?: { x: number; y: number };
  /** Monde ouvert : graphe routier roulable et départ par défaut (toutes les routes creusées). */
  open?: {
    graph: RoadGraphData;
    start: { x: number; z: number };
    places?: WorldPlace[];
    /** Graphe complet, arêtes au bord comprises (raccord des zones voisines). */
    fullGraph?: RoadGraphData;
  };
  /** Zones chargées ensemble (zone principale d'abord) ; absent : la seule zone `id`. */
  zones?: string[];
  /** Emprises roulables (repère monde, m) : une par zone chargée ; absent : `bounds`. */
  areas?: Array<{ minX: number; minZ: number; maxX: number; maxZ: number }>;
  /** Monde côtier : niveau de la mer (m), fonds marins en dessous. */
  sea?: { levelM: number };
  hasTile(tx: number, tz: number): boolean;
  loadTile(tx: number, tz: number): Promise<LoadedTile | null>;
  /** Relief lointain, s'il est fourni (world.json `horizon`). */
  loadHorizon?(): Promise<HorizonGrid | null>;
}
