/** Préréglages graphiques : bas → ultra (ultra calibré pour une RTX 4090, 60 fps visés). */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  /** Plafond de pixels rendus (largeur × hauteur) : au-delà, l'image est rendue plus petite puis agrandie. */
  maxPixels: number;
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
  /** Eau : pas de subdivision des plans d'eau (m, profondeur par sommet). */
  waterMeshM: number;
  /** Eau : vaguelettes détaillées (2 octaves + gouttes de pluie) plutôt qu'une seule octave. */
  waterDetail: boolean;
  /** Roseaux sur les berges (touffes par 10 m de rive). */
  reedDensity: number;
  /** Villages : murets, clôtures, haies, cheminées et faîtières (0 = aucun, 1 = complet). */
  propDensity: number;
  /** Particules de poussière sur les chemins non revêtus (0 = coupé). */
  dustParticles: number;
  /** Nombre maximal de coureurs IA affichés (le réglage du joueur est plafonné). */
  aiRidersMax: number;
  /** Circulation : facteur sur les 6 véhicules de base (0 = aucune circulation ni piéton). */
  trafficDensity: number;
  /** Les ombres en cascade sont redessinées une image sur N (1 = chaque image) ; entre deux, cartes et caméras restent figées ensemble. */
  shadowEvery: number;
  /** Nombre maximal de coureurs (hors joueur) qui projettent une ombre : chacun coûte une centaine d'appels de dessin en cascade. */
  shadowRiders: number;
  /** Côté (m) des blocs d'instanciation de la végétation réelle : plus grand = moins d'appels de dessin. */
  realChunk: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    pixelRatio: 0.75,
    maxPixels: 1280 * 720,
    shadowMapSize: 1024,
    shadowCascades: 1,
    shadowFar: 120,
    ao: false,
    aoScale: 0.5,
    bloom: false,
    taa: false,
    viewDistance: 2000,
    treeDensity: 0.2,
    grassDensity: 0,
    tileRadius: 2,
    terrainSegmentsPerTile: 96,
    waterMeshM: 12,
    waterDetail: false,
    reedDensity: 0,
    propDensity: 0.3,
    dustParticles: 0,
    aiRidersMax: 2,
    trafficDensity: 0.34,
    shadowEvery: 2,
    shadowRiders: 0,
    realChunk: 250,
  },
  medium: {
    level: 'medium',
    pixelRatio: 1,
    maxPixels: 1920 * 1080,
    shadowMapSize: 2048,
    shadowCascades: 2,
    shadowFar: 250,
    ao: false,
    aoScale: 0.5,
    bloom: true,
    taa: false,
    viewDistance: 4000,
    treeDensity: 0.5,
    grassDensity: 0.4,
    tileRadius: 3,
    terrainSegmentsPerTile: 128,
    waterMeshM: 8,
    waterDetail: false,
    reedDensity: 0.5,
    propDensity: 0.7,
    dustParticles: 384,
    aiRidersMax: 8,
    trafficDensity: 0.67,
    shadowEvery: 2,
    shadowRiders: 2,
    realChunk: 250,
  },
  high: {
    level: 'high',
    pixelRatio: 1,
    // 4K : couvre un écran 32:9 de 5120 × 1440 sans réduire (image nette) ; les GPU modestes partent en medium.
    maxPixels: 3840 * 2160,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 400,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    taa: true,
    viewDistance: 5000,
    treeDensity: 0.8,
    grassDensity: 0.8,
    tileRadius: 3,
    terrainSegmentsPerTile: 192,
    waterMeshM: 5,
    waterDetail: true,
    reedDensity: 1,
    propDensity: 1,
    dustParticles: 768,
    aiRidersMax: 19,
    trafficDensity: 1,
    shadowEvery: 2,
    shadowRiders: 3,
    realChunk: 250,
  },
  ultra: {
    level: 'ultra',
    pixelRatio: 1,
    maxPixels: Number.POSITIVE_INFINITY,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowFar: 900,
    ao: true,
    aoScale: 1,
    bloom: true,
    taa: true,
    viewDistance: 7000,
    treeDensity: 1.1,
    grassDensity: 1.4,
    tileRadius: 4,
    terrainSegmentsPerTile: 224,
    waterMeshM: 4,
    waterDetail: true,
    reedDensity: 1.5,
    propDensity: 1,
    dustParticles: 1536,
    aiRidersMax: 19,
    trafficDensity: 1,
    shadowEvery: 1,
    shadowRiders: 19,
    realChunk: 125,
  },
};

export function detectDefaultQuality(): QualityLevel {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl && fromUrl in QUALITY_PRESETS) return fromUrl as QualityLevel;
  const stored = localStorage.getItem('ar.quality');
  if (stored && stored in QUALITY_PRESETS) return stored as QualityLevel;
  return 'high';
}

/** Surcharges de débogage par l'URL : ?bloom=0&ao=0&taa=0, ?shadowevery=1 (ombres chaque image), ?shadowriders=N, ?cascades=N. */
export function withUrlOverrides(q: QualitySettings): QualitySettings {
  const p = new URLSearchParams(location.search);
  const flag = (k: 'bloom' | 'ao' | 'taa') => (p.has(k) ? p.get(k) !== '0' : q[k]);
  const num = (param: string, fallback: number, min: number, max: number) => {
    const n = Number(p.get(param));
    return p.has(param) && Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
  };
  return {
    ...q,
    bloom: flag('bloom'),
    ao: flag('ao'),
    taa: flag('taa'),
    shadowEvery: num('shadowevery', q.shadowEvery, 1, 8),
    shadowRiders: num('shadowriders', q.shadowRiders, 0, 19),
    shadowCascades: num('cascades', q.shadowCascades, 1, 4),
  };
}
