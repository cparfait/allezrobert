/**
 * Paramètres du monde « Vallée de Chevreuse » (corridor Saclay → Chevreuse → Rambouillet).
 * Aucune coordonnée liée au domicile ici : les points sensibles sont lus à l'exécution
 * depuis data/garmin (non versionné).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache', 'terrain');
export const GARMIN_DIR = path.join(REPO_ROOT, 'data', 'garmin');
export const OUT_DIR = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds', 'chevreuse');

export const WORLD_ID = 'chevreuse';
export const WORLD_NAME = 'Vallée de Chevreuse';

/** Origine du repère monde en Lambert-93 (près de Chevreuse, multiples de 1 km). */
export const ORIGIN_L93 = { x: 629000, y: 6846000 } as const;

export const TILE_SIZE_M = 1000;

/** Résolutions des grilles d'altitude par niveau de détail. */
export const LOD_HI = { id: 'hi', resM: 2, n: 500 } as const;
export const LOD_LO = { id: 'lo', resM: 8, n: 125 } as const;

/** Corridor complet en indices de tuiles (≈ lon 1,78–2,20, lat 48,62–48,75). */
export const CORRIDOR_TILES = { txMin: -20, txMax: 12, tzMin: -6, tzMax: 10 } as const;

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

/** Pas d'échantillonnage des itinéraires (m). */
export const ROUTE_STEP_M = 2;

export const ATTRIBUTION = [
  '© IGN — RGE ALTI® / LiDAR HD (Licence Ouverte Etalab 2.0)',
  '© les contributeurs OpenStreetMap (ODbL)',
];
export const ATTRIBUTION_ORTHO = '© IGN — BD ORTHO® (Licence Ouverte Etalab 2.0)';

export const USER_AGENT = 'AllezRobert-terrain/0.1 (jeu privé, outil hors ligne ; github.com/cparfait/allezrobert)';
