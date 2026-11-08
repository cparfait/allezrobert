import { clampRoadFeel } from '@allezrobert/shared';
import type { TacxRoadSurface } from '@allezrobert/protocols';

/**
 * Ressenti route du home trainer (Tacx NEO) : revêtement du tronçon (tag OSM `surface`) → motif de
 * vibration du moteur Tacx, à l'intensité réglée par le coureur. Fonctions pures (testées sous Node).
 *
 * Seuls les vrais revêtements irréguliers vibrent : l'enrobé, le béton lisse et les tronçons sans tag
 * restent coupés (sinon presque toutes les petites routes de campagne secoueraient le vélo).
 */

const TACX_BY_OSM: Readonly<Record<string, TacxRoadSurface>> = {
  // Pavés : grès taillés (Roubaix) durs, pavés aplanis et pavés autobloquants plus doux.
  sett: 'cobblestonesHard',
  cobblestone: 'cobblestonesHard',
  unhewn_cobblestone: 'cobblestonesHard',
  'cobblestone:flattened': 'cobblestonesSoft',
  'paving_stones:sett': 'cobblestonesSoft',
  paving_stones: 'cobblestonesSoft',
  grass_paver: 'cobblestonesSoft',
  bricks: 'brickRoad',
  'concrete:plates': 'concretePlates',
  'concrete:lanes': 'concretePlates',
  wood: 'woodenBoards',
  // Gravier et cailloux.
  gravel: 'gravel',
  pebblestone: 'gravel',
  rock: 'gravel',
  shells: 'gravel',
  unpaved: 'gravel',
  // Terre et chemins compactés : motif « tout-terrain » du NEO (terre tassée).
  compacted: 'offRoad',
  fine_gravel: 'offRoad',
  dirt: 'offRoad',
  ground: 'offRoad',
  earth: 'offRoad',
  grass: 'offRoad',
  sand: 'offRoad',
  mud: 'offRoad',
  woodchips: 'offRoad',
};

/** Motif Tacx d'un tag OSM `surface` ; 'off' pour l'enrobé, le béton lisse et l'inconnu. */
export function tacxSurfaceFromOsm(osmSurface: string | undefined): TacxRoadSurface {
  return TACX_BY_OSM[(osmSurface ?? '').toLowerCase().trim()] ?? 'off';
}

/** Sous cette vitesse (m/s), le trainer ne vibre pas : à l'arrêt, le vélo reste calme. */
export const ROAD_FEEL_MIN_SPEED_MS = 1;

export interface RoadFeelInput {
  osmSurface: string | undefined;
  /** Intensité réglée (%), 0 = coupé. */
  percent: number;
  /** Sortie en cours (ni pause, ni arrivée, ni compte à rebours). */
  riding: boolean;
  speedMs: number;
}

/**
 * Part de l'intensité réglée selon le revêtement : les pavés taillés secouent à fond, la terre
 * tassée et le gravier beaucoup moins (comme la vibration de la caméra, roadBuzz.ts).
 */
export const ROAD_FEEL_SURFACE_FACTOR: Readonly<Record<Exclude<TacxRoadSurface, 'off'>, number>> = {
  cobblestonesHard: 1,
  cattleGrid: 1,
  cobblestonesSoft: 0.8,
  brickRoad: 0.75,
  woodenBoards: 0.75,
  concretePlates: 0.65,
  gravel: 0.65,
  offRoad: 0.5,
  ice: 0.5,
};

/** Intensité minimale envoyée (%) : en dessous, le NEO ne fait rien de perceptible. */
export const ROAD_FEEL_MIN_PERCENT = 5;

/** Réglage à envoyer au trainer pour l'image en cours. */
export function roadFeelFor(i: RoadFeelInput): { surface: TacxRoadSurface; intensityPercent: number } {
  const percent = clampRoadFeel(i.percent);
  const surface = i.riding && percent > 0 && i.speedMs >= ROAD_FEEL_MIN_SPEED_MS ? tacxSurfaceFromOsm(i.osmSurface) : 'off';
  if (surface === 'off') return { surface, intensityPercent: 0 };
  return { surface, intensityPercent: Math.max(ROAD_FEEL_MIN_PERCENT, Math.round(percent * ROAD_FEEL_SURFACE_FACTOR[surface])) };
}
