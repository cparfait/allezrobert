/** Préréglages graphiques : bas → ultra (ultra calibré pour une RTX 4090, 60 fps visés). */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowFar: number;
  ao: boolean;
  aoScale: number;
  bloom: boolean;
  taa: boolean;
  /** Distance de vue (m). */
  viewDistance: number;
  /** Densité de végétation (arbres par 100 m² de forêt). */
  treeDensity: number;
  grassDensity: number;
  /** Rayon (en tuiles) chargé autour du coureur. */
  tileRadius: number;
  terrainSegmentsPerTile: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    pixelRatio: 0.75,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowFar: 250,
    ao: false,
    aoScale: 0.5,
    bloom: false,
    taa: false,
    viewDistance: 2500,
    treeDensity: 0.25,
    grassDensity: 0,
    tileRadius: 2,
    terrainSegmentsPerTile: 96,
  },
  medium: {
    level: 'medium',
    pixelRatio: 1,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 400,
    ao: false,
    aoScale: 0.5,
    bloom: true,
    taa: false,
    viewDistance: 4000,
    treeDensity: 0.5,
    grassDensity: 0.4,
    tileRadius: 3,
    terrainSegmentsPerTile: 128,
  },
  high: {
    level: 'high',
    pixelRatio: 1,
    shadowMapSize: 2048,
    shadowCascades: 4,
    shadowFar: 600,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    taa: true,
    viewDistance: 6000,
    treeDensity: 0.8,
    grassDensity: 0.8,
    tileRadius: 4,
    terrainSegmentsPerTile: 192,
  },
  ultra: {
    level: 'ultra',
    pixelRatio: 1,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowFar: 900,
    ao: true,
    aoScale: 1,
    bloom: true,
    taa: true,
    viewDistance: 9000,
    treeDensity: 1.2,
    grassDensity: 1.4,
    tileRadius: 5,
    terrainSegmentsPerTile: 256,
  },
};

export function detectDefaultQuality(): QualityLevel {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl && fromUrl in QUALITY_PRESETS) return fromUrl as QualityLevel;
  const stored = localStorage.getItem('ar.quality');
  if (stored && stored in QUALITY_PRESETS) return stored as QualityLevel;
  return 'high';
}

/** Surcharges de débogage par l'URL : ?bloom=0&ao=0&taa=0. */
export function withUrlOverrides(q: QualitySettings): QualitySettings {
  const p = new URLSearchParams(location.search);
  const flag = (k: 'bloom' | 'ao' | 'taa') => (p.has(k) ? p.get(k) !== '0' : q[k]);
  return { ...q, bloom: flag('bloom'), ao: flag('ao'), taa: flag('taa') };
}
