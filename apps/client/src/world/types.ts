import type { RouteData } from '@allezrobert/shared';

/** Classes d'occupation du sol rastérisées par tuile (un octet par canal). */
export const SPLAT_CHANNELS = ['forest', 'field', 'meadow', 'water', 'urban', 'road'] as const;
export type SplatChannel = (typeof SPLAT_CHANNELS)[number];

export type ForestKind = 'deciduous' | 'conifer' | 'mixed';

/** Polygone : anneaux plats [x0,z0,x1,z1,…] ; le premier est l'extérieur, les suivants des trous. */
export type Rings = number[][];

export interface TileRoad {
  kind: string;
  width: number;
  /** Polyligne plate x,z. */
  pts: number[];
  /** Polyligne 3D x,y,z (profil de chaussée lissé), si fournie par le pipeline. */
  pts3?: number[];
  surface?: string;
  /** Itinéraire auquel appartient ce tronçon (déjà dessiné par RoadMesh s'il est actif). */
  route?: string;
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
}

export interface TileFeatures {
  roads: TileRoad[];
  buildings: TileBuilding[];
  forests: Array<{ rings: Rings; kind: ForestKind }>;
  water: Array<{ rings: Rings; kind: string; level?: number }>;
  fields: Array<{ rings: Rings; kind: string }>;
  landuse: Array<{ rings: Rings; kind: string }>;
  waterways: Array<{ width: number; pts: number[]; kind?: string; tunnel?: boolean }>;
  pois: Array<{ kind: string; name: string; x: number; y: number; z: number }>;
}

export function emptyFeatures(): TileFeatures {
  return { roads: [], buildings: [], forests: [], water: [], fields: [], landuse: [], waterways: [], pois: [] };
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
  /** Orthophoto IGN de la tuile (URL), facultative. */
  orthoUrl?: string;
  /** Raster d'occupation du sol (res×res, 6 canaux entrelacés), calculé côté client. */
  splat?: { res: number; data: Uint8Array };
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
  hasTile(tx: number, tz: number): boolean;
  loadTile(tx: number, tz: number): Promise<LoadedTile | null>;
}
