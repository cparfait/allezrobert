import type { RouteData } from '@allezrobert/shared';

/** Classes d'occupation du sol rastérisées par tuile (un octet par canal). */
export const SPLAT_CHANNELS = ['forest', 'field', 'meadow', 'water', 'urban', 'road'] as const;
export type SplatChannel = (typeof SPLAT_CHANNELS)[number];

export type FieldKind = 'farmland' | 'meadow' | 'grass' | 'orchard';
export type ForestKind = 'deciduous' | 'conifer' | 'mixed';

export interface TileFeatures {
  roads: Array<{ kind: string; width: number; pts: number[] }>;
  buildings: Array<{ pts: number[]; height: number; kind: string; roof?: string; levels?: number }>;
  forests: Array<{ pts: number[]; kind: ForestKind }>;
  water: Array<{ pts: number[]; kind: string }>;
  fields: Array<{ pts: number[]; kind: FieldKind }>;
  waterways: Array<{ width: number; pts: number[] }>;
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
