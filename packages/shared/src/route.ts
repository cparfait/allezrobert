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
  /** Largeur de chaussée en mètres (pour le décalage latéral). */
  roadWidthM: number;
  attribution: string[];
}

export interface WorldMeta {
  id: string;
  name: string;
  /** Origine du repère monde en Lambert-93 (EPSG:2154). */
  originL93: { x: number; y: number };
  /** Emprise en mètres dans le repère monde. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  tileSizeM: number;
  /** Résolution des grilles d'altitude, en mètres par échantillon. */
  heightResolutionM: number;
  tiles: string[]; // identifiants "tx_tz"
  routes: string[];
  attribution: string[];
}

/** Tuile de monde : altitude + entités vectorielles, en coordonnées monde. */
export interface WorldTile {
  id: string;
  tx: number;
  tz: number;
  /** Altitudes : grille (n+1)×(n+1) en centimètres, encodée base64 Int16 (relative à `baseM`). */
  heights: { n: number; baseM: number; dataB64: string };
  roads: Array<{ kind: string; width: number; pts: number[] /* x,z à plat */ }>;
  buildings: Array<{ pts: number[]; height: number; kind: string }>;
  forests: Array<{ pts: number[]; kind: 'deciduous' | 'conifer' | 'mixed' }>;
  water: Array<{ pts: number[]; kind: 'lake' | 'river' | 'pond' }>;
  fields: Array<{ pts: number[]; kind: 'farmland' | 'meadow' | 'grass' | 'orchard' }>;
  waterways: Array<{ width: number; pts: number[] }>;
}
