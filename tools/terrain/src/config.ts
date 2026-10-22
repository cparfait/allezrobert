/**
 * Paramètres des mondes construits par l'outil. Le monde est choisi à l'exécution :
 * `--world <id>` (ou `TERRAIN_WORLD=<id>`), « chevreuse » par défaut.
 *
 * - « chevreuse » (corridor Saclay → Chevreuse → Rambouillet) : boucles tirées des sorties
 *   Garmin de l'auteur. Aucune coordonnée liée au domicile ici : les points sensibles sont lus
 *   à l'exécution depuis data/garmin (non versionné).
 * - montées célèbres (« alpe-dhuez », « mont-ventoux ») : un itinéraire point à point construit
 *   sur OSM entre deux points publics ; aucune donnée Garmin n'est lue.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache', 'terrain');
export const GARMIN_DIR = path.join(REPO_ROOT, 'data', 'garmin');

/** Point WGS84 (degrés). */
export interface LonLat {
  lon: number;
  lat: number;
}

/** Valeurs publiées d'une montée, pour la validation (rapport de construction). */
export interface ClimbReference {
  lengthM: number;
  gainM: number;
  avgGradePct: number;
  startEleM?: number;
  finishEleM?: number;
  maxGradePct?: number;
  sources: string[];
}

/** Repère nommé le long d'une montée (village, chalet, stèle…), recalé sur le point le plus proche. */
export interface ClimbLandmark {
  name: string;
  at: LonLat;
}

export interface ClimbSpec {
  routeId: string;
  routeName: string;
  routeNameEn: string;
  /** Début de l'itinéraire (courte approche avant le pied de la montée). */
  start: LonLat;
  /** Pied de la montée : début du segment KOM. */
  climbStart: LonLat;
  /** Ligne d'arrivée : fin du segment KOM. */
  finish: LonLat;
  /** Fin de l'itinéraire (quelques dizaines de mètres après la ligne, pour décélérer). */
  end: LonLat;
  /** Points de passage imposés (dans l'ordre) entre le départ et la fin. */
  via?: LonLat[];
  /** Numéros de route privilégiés par le calcul d'itinéraire (tag `ref` OSM). */
  preferRefs: string[];
  komId: string;
  komName: string;
  /** Lacets numérotés (Alpe d'Huez : 21 → 1). Absent : lacets seulement détectés et comptés. */
  numberedHairpins?: { count: number; descending: boolean };
  landmarks?: ClimbLandmark[];
  reference: ClimbReference;
}

interface WorldBase {
  id: string;
  name: string;
  /** Origine du repère monde en Lambert-93 (multiples de 1 km). */
  originL93: { x: number; y: number };
  /** Emprise maximale en indices de tuiles (bornes incluses). */
  corridorTiles: { txMin: number; txMax: number; tzMin: number; tzMax: number };
}

export interface GarminWorld extends WorldBase {
  kind: 'garmin';
}

export interface ClimbWorld extends WorldBase {
  kind: 'climb';
  climb: ClimbSpec;
  /** Tuiles haute résolution (2 m) : à moins de cette distance de l'itinéraire. */
  hiMarginM: number;
  /** Tuiles basse résolution (8 m) : à moins de cette distance de l'itinéraire (au-delà : pas de tuile). */
  loMarginM: number;
  /** Relief lointain (ligne d'horizon) : grille unique, demi-côté et pas en mètres. */
  horizon: { halfSizeM: number; resM: number };
}

export type WorldConfig = GarminWorld | ClimbWorld;

export const WORLDS: Record<string, WorldConfig> = {
  chevreuse: {
    kind: 'garmin',
    id: 'chevreuse',
    name: 'Vallée de Chevreuse',
    // près de Chevreuse
    originL93: { x: 629000, y: 6846000 },
    // ≈ lon 1,78–2,20, lat 48,62–48,75
    corridorTiles: { txMin: -20, txMax: 12, tzMin: -6, tzMax: 10 },
  },
  'alpe-dhuez': {
    kind: 'climb',
    id: 'alpe-dhuez',
    name: "Alpe d'Huez",
    // entre La Garde et Huez (milieu de la montée)
    originL93: { x: 940000, y: 6447000 },
    // itinéraire ≈ E 938,8–942,3 km, N 6 444,4–6 449,0 km, + 5 km de montagnes autour
    corridorTiles: { txMin: -8, txMax: 7, tzMin: -8, tzMax: 8 },
    hiMarginM: 400,
    loMarginM: 5000,
    horizon: { halfSizeM: 30000, resM: 100 },
    climb: {
      routeId: 'alpe-dhuez',
      routeName: "Montée de l'Alpe d'Huez",
      routeNameEn: "Alpe d'Huez climb",
      // D1091, 300 m avant le carrefour (venant du Bourg-d'Oisans)
      start: { lon: 6.03455, lat: 45.06135 },
      // sortie du giratoire D1091 / D211 (fin de la double chaussée de la D211)
      climbStart: { lon: 6.03777, lat: 45.05985 },
      // arrivée : sommet de la D211 (≈ 1 850 m, carrefour route du Signal / avenue du Rif Nel)
      finish: { lon: 6.07003, lat: 45.09582 },
      // fin de l'itinéraire : avenue du Rif Nel, au mur des vainqueurs d'étape
      end: { lon: 6.07147, lat: 45.09412 },
      via: [
        // route d'Huez (village d'Huez), puis le haut de la route du Signal
        { lon: 6.0566, lat: 45.09135 },
        { lon: 6.0703, lat: 45.0958 },
      ],
      preferRefs: ['D 211', 'D 211F', 'D 1091'],
      komId: 'kom-alpe-dhuez',
      komName: "Montée de l'Alpe d'Huez",
      numberedHairpins: { count: 21, descending: true },
      reference: {
        lengthM: 13800,
        gainM: 1071,
        avgGradePct: 8.1,
        startEleM: 719,
        finishEleM: 1850,
        maxGradePct: 13,
        sources: [
          "fr.wikipedia.org/wiki/Alpe_d'Huez : 13,8 km, 1 090 m, 7,9 %",
          "en.wikipedia.org/wiki/Alpe_d'Huez : 13,8 km, 1 120 m, 8,1 %, max 13 %",
          'alpedhuez.com (21 virages) : 13,8 km / 14,454 km, 1 121 m, 7,9 %, max 14 % ; virage 21 à 806 m, 1 à 1 713 m',
          'climbfinder.com : 14 km, 1 122 m, 8 %, arrivée 1 841 m',
        ],
      },
    },
  },
  'mont-ventoux': {
    kind: 'climb',
    id: 'mont-ventoux',
    name: 'Mont Ventoux',
    // entre Saint-Estève et le Chalet Reynard
    originL93: { x: 880000, y: 6342000 },
    // itinéraire ≈ E 874,3–885,5 km, N 6 338,3–6 345,0 km, + 5 km autour
    corridorTiles: { txMin: -12, txMax: 11, tzMin: -9, tzMax: 10 },
    hiMarginM: 400,
    loMarginM: 5000,
    horizon: { halfSizeM: 35000, resM: 100 },
    climb: {
      routeId: 'mont-ventoux-bedoin',
      routeName: 'Mont Ventoux par Bédoin',
      routeNameEn: 'Mont Ventoux from Bédoin',
      // D974 (avenue Barral des Baux), 300 m avant le giratoire de Bédoin
      start: { lon: 5.17905, lat: 44.12305 },
      // sortie du giratoire de Bédoin vers la route du Mont-Ventoux (début de l'itinéraire cyclable
      // OSM « Ascension du Mont-Ventoux depuis Bédoin »)
      climbStart: { lon: 5.18085, lat: 44.12517 },
      // sommet (fin de l'itinéraire OSM, au pied de l'observatoire)
      finish: { lon: 5.27840, lat: 44.17350 },
      // un peu après le sommet, au début de la descente vers Malaucène
      end: { lon: 5.27971, lat: 44.1744 },
      via: [
        // Saint-Estève (entrée dans la forêt), Chalet Reynard
        { lon: 5.23620, lat: 44.11780 },
        { lon: 5.31880, lat: 44.15210 },
      ],
      preferRefs: ['D 974'],
      komId: 'kom-mont-ventoux',
      komName: 'Mont Ventoux (Bédoin)',
      landmarks: [
        { name: 'Chalet Reynard', at: { lon: 5.31899, lat: 44.15234 } },
        { name: 'Stèle Tom Simpson', at: { lon: 5.28618, lat: 44.16971 } },
        { name: 'Sommet du Ventoux', at: { lon: 5.27826, lat: 44.17347 } },
      ],
      reference: {
        lengthM: 21500,
        gainM: 1610,
        avgGradePct: 7.5,
        startEleM: 300,
        finishEleM: 1909,
        maxGradePct: 13.3,
        sources: [
          'en.wikipedia.org/wiki/Mont_Ventoux : 21,8 km, 1 617 m, 7,43 %, sommet 1 910 m ; Saint-Estève à 5,8 km',
          'fr.wikipedia.org/wiki/Mont_Ventoux : 21,6 km (D974) ; sommet 1 910 m (1 897 m mesuré en 2016)',
          'climbfinder.com : 20,8 km, 1 594 m, 7,7 %, 100 m les plus raides 13,3 %, sommet 1 909 m',
          'OSM, itinéraire « Ascension du Mont-Ventoux depuis Bédoin » (relation 12252348) : distance=21 km',
        ],
      },
    },
  },
};

function selectWorld(): WorldConfig {
  const argv = process.argv.slice(2);
  let id = process.env.TERRAIN_WORLD ?? 'chevreuse';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--world' && argv[i + 1]) id = argv[i + 1]!;
    else if (a.startsWith('--world=')) id = a.slice('--world='.length);
  }
  const w = WORLDS[id];
  if (!w) throw new Error(`Monde inconnu « ${id} » (connus : ${Object.keys(WORLDS).join(', ')})`);
  return w;
}

/** Monde en cours de construction. */
export const WORLD: WorldConfig = selectWorld();

/** Dossier du monde ; `TERRAIN_OUT_DIR` permet de construire à côté puis de basculer d'un coup. */
export const OUT_DIR = process.env.TERRAIN_OUT_DIR ? path.resolve(process.env.TERRAIN_OUT_DIR) : path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds', WORLD.id);

export const WORLD_ID = WORLD.id;
export const WORLD_NAME = WORLD.name;

/** Origine du repère monde en Lambert-93 (multiples de 1 km). */
export const ORIGIN_L93 = WORLD.originL93;

export const TILE_SIZE_M = 1000;

/** Résolutions des grilles d'altitude par niveau de détail. */
export const LOD_HI = { id: 'hi', resM: 2, n: 500 } as const;
export const LOD_LO = { id: 'lo', resM: 8, n: 125 } as const;

/** Corridor complet en indices de tuiles. */
export const CORRIDOR_TILES = WORLD.corridorTiles;

/*
 * Monde « chevreuse » (sorties Garmin) — paramètres propres à ce monde.
 */

/**
 * Zone de recherche de la boucle du jalon 1 (Chevreuse, Saint-Rémy, Dampierre, Milon, Saint-Lambert),
 * en WGS84.
 */
export const LOOP_AREA_WGS84 = { west: 1.965, south: 48.68, east: 2.095, north: 48.745 } as const;

/** Longueur visée pour la boucle du jalon 1 (m). */
export const LOOP_LENGTH = { min: 9000, max: 12000, target: 10500 } as const;

/** Tuiles haute résolution : toutes les tuiles à moins de cette distance de la boucle principale. */
export const HI_RES_MARGIN_M = 2000;
/** … et à moins de cette distance des itinéraires secondaires. */
export const HI_RES_MARGIN_SECONDARY_M = 300;

/** Rayon d'exclusion autour des départs/arrivées des sorties Garmin (vie privée). */
export const PRIVACY_RADIUS_M = 2000;

/**
 * Itinéraires tirés des sorties Garmin : on garde le plus long morceau contigu de la partie
 * publique de chaque sortie situé à plus de RIDE_RUN_MARGIN_M du bord du monde (au moins
 * RIDE_ROUTE_MIN_M), recalé sur des voies entièrement à plus de WORLD_EDGE_MARGIN_M du bord.
 */
export const RIDE_ROUTE_MIN_M = 10000;
export const RIDE_RUN_MARGIN_M = 300;
export const WORLD_EDGE_MARGIN_M = 100;

/** Pas d'échantillonnage des itinéraires (m). */
export const ROUTE_STEP_M = 2;

export const ATTRIBUTION = [
  '© IGN — RGE ALTI® / LiDAR HD (Licence Ouverte Etalab 2.0)',
  '© les contributeurs OpenStreetMap (ODbL)',
];
export const ATTRIBUTION_ORTHO = '© IGN — BD ORTHO® (Licence Ouverte Etalab 2.0)';

export const USER_AGENT = 'AllezRobert-terrain/0.1 (jeu privé, outil hors ligne ; github.com/cparfait/allezrobert)';
