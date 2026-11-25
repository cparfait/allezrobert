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
  /** Anticrénelage SMAA quand le TAA est coupé (léger, ne traite pas le scintillement). */
  smaa: boolean;
  /** Reflets du décor sur chaussée mouillée (SSR, seulement quand il pleut). */
  ssr: boolean;
  /** Lampadaires les plus proches allumés en vraies lumières la nuit (façades, trottoir, coureur éclairés). */
  lampLights: number;
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
  /** Densité du monde vivant (cyclistes croisés) : 0 = aucun. */
  trafficDensity: number;
  /** Public sur les côtes et les sprints (1 : un spectateur tous les 3,2 à 4 m de chaque côté). */
  crowdDensity: number;
  /** Les ombres en cascade sont redessinées une image sur N (1 = chaque image) ; entre deux, cartes et caméras restent figées ensemble. */
  shadowEvery: number;
  /** Nombre maximal de coureurs (hors joueur) qui projettent une ombre : chacun coûte une centaine d'appels de dessin en cascade. */
  shadowRiders: number;
  /** Côté (m) des blocs d'instanciation de la végétation réelle : plus grand = moins d'appels de dessin. */
  realChunk: number;
  /** Végétation réelle : arbres détaillés jusqu'à cette distance (m), silhouettes d'un seul bloc par tuile au-delà. */
  vegDetailM: number;
  /**
   * Vrais arbres (EZ-Tree, ezTreeNear.ts) : rayon (m) des arbres en 3D autour du coureur, 7 000 à 20 000 triangles
   * chacun ; au-delà, des imposteurs (cartes). 0 = imposteurs seuls. `?eznear=N` pour comparer.
   */
  ezNearM: number;
  /** Vrais arbres : les arbres en 3D portent une ombre (chacun est redessiné dans chaque cascade). `?ezshadows=0|1`. */
  ezNearShadows: boolean;
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
    smaa: true,
    ssr: false,
    lampLights: 0,
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
    aiRidersMax: 40,
    trafficDensity: 0.34,
    crowdDensity: 0.5,
    shadowEvery: 2,
    shadowRiders: 0,
    realChunk: 250,
    vegDetailM: 400,
    // Bas : imposteurs seuls (une carte par arbre, ombre comprise), pas de géométrie d'arbre.
    ezNearM: 0,
    ezNearShadows: false,
  },
  medium: {
    level: 'medium',
    pixelRatio: 1,
    maxPixels: 1920 * 1080,
    // 4096 : avec une seule cascade sur 250 m, une carte de 2048 donnait des texels de 18 à 25 cm ; jambes et cadre,
    // plus fins, apparaissaient et disparaissaient de la carte d'une image à l'autre et l'ombre des coureurs
    // scintillait (19/11/2026). Même nombre d'appels de dessin ; temps GPU inchangé à la mesure (écart < 0,2 ms,
    // dans le bruit), 48 Mo de mémoire vidéo en plus. ?shadowmap=2048 pour comparer.
    shadowMapSize: 4096,
    // Une cascade (au lieu de 2) : chaque cascade coûte une passe d'ombre et sa préparation à chaque image, et le
    // jeu est limité par le processeur. Mesure du 18/11/2026 (Bêta, Boulogne, 8 coureurs) : 32,1 → 34,4 images/s.
    shadowCascades: 1,
    shadowFar: 250,
    ao: false,
    aoScale: 0.5,
    bloom: true,
    taa: false,
    smaa: true,
    ssr: false,
    lampLights: 0,
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
    aiRidersMax: 40,
    trafficDensity: 0.67,
    crowdDensity: 0.75,
    // Ombres redessinées à chaque image : une image sur deux, l'ombre d'un coureur restait à sa position précédente
    // et faisait des allers-retours (~11 px à 60 images/s), très visibles depuis la carte 4096. Coût mesuré le
    // 19/11/2026 (Bêta, Boulogne) : 11,6 → 13,9 ms de processeur par image. Choix de l'utilisateur.
    shadowEvery: 1,
    shadowRiders: 2,
    realChunk: 250,
    vegDetailM: 500,
    // Moyen : rayon réduit (surface, donc nombre d'arbres en 3D et de triangles d'ombre, divisée par trois environ).
    ezNearM: 35,
    ezNearShadows: true,
  },
  high: {
    level: 'high',
    pixelRatio: 1,
    // 4K : couvre un écran 32:9 de 5120 × 1440 sans réduire (image nette) ; les GPU modestes partent en medium.
    maxPixels: 3840 * 2160,
    shadowMapSize: 2048,
    // Deux cascades (au lieu de 3), même raison qu'en medium. Mesure du 18/11/2026 (Bêta, Boulogne, 8 coureurs) :
    // 24,2 → 26,5 images/s, sans différence visible sur les ombres proches.
    shadowCascades: 2,
    shadowFar: 400,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    taa: true,
    smaa: false,
    ssr: true,
    lampLights: 6,
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
    aiRidersMax: 40,
    trafficDensity: 1,
    crowdDensity: 1,
    shadowEvery: 2,
    shadowRiders: 3,
    realChunk: 250,
    vegDetailM: 550,
    ezNearM: 60,
    ezNearShadows: true,
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
    smaa: false,
    ssr: true,
    lampLights: 8,
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
    aiRidersMax: 40,
    trafficDensity: 1,
    crowdDensity: 1,
    shadowEvery: 1,
    shadowRiders: 19,
    realChunk: 125,
    vegDetailM: 700,
    ezNearM: 60,
    ezNearShadows: true,
  },
};

export function detectDefaultQuality(): QualityLevel {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl && fromUrl in QUALITY_PRESETS) return fromUrl as QualityLevel;
  const stored = localStorage.getItem('ar.quality');
  if (stored && stored in QUALITY_PRESETS) return stored as QualityLevel;
  return 'high';
}

/** Surcharges de débogage par l'URL : ?bloom=0&ao=0&taa=0&smaa=0&ssr=0, ?shadowevery=1 (ombres chaque image), ?shadowriders=N, ?cascades=N, ?shadowmap=N (taille des cartes d'ombre). */
export function withUrlOverrides(q: QualitySettings): QualitySettings {
  const p = new URLSearchParams(location.search);
  const flag = (k: 'bloom' | 'ao' | 'taa' | 'smaa' | 'ssr') => (p.has(k) ? p.get(k) !== '0' : q[k]);
  const num = (param: string, fallback: number, min: number, max: number) => {
    const n = Number(p.get(param));
    return p.has(param) && Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
  };
  return {
    ...q,
    bloom: flag('bloom'),
    ao: flag('ao'),
    taa: flag('taa'),
    smaa: flag('smaa'),
    ssr: flag('ssr'),
    lampLights: num('lamplights', q.lampLights, 0, 16),
    shadowEvery: num('shadowevery', q.shadowEvery, 1, 8),
    shadowRiders: num('shadowriders', q.shadowRiders, 0, 19),
    shadowCascades: num('cascades', q.shadowCascades, 1, 4),
    shadowMapSize: num('shadowmap', q.shadowMapSize, 512, 8192),
    ezNearM: num('eznear', q.ezNearM, 0, 120),
    ezNearShadows: p.has('ezshadows') ? p.get('ezshadows') !== '0' : q.ezNearShadows,
  };
}
