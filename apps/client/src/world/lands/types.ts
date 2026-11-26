/**
 * Mondes Poly supplémentaires (générés par tools/<id>, voir docs/MONDES_POLY.md) : ce que chaque monde fournit au
 * client, dans son module `world/lands/<id>.ts`. L'île de Robert et le Pays de Robert gardent leur code d'origine.
 */
import type { Season } from '../environment.ts';
import type { Site } from '../polySites.ts';
import type { PolyWorld } from '../polyWorlds.ts';
import type { TileBuilding } from '../types.ts';

/** Couleurs du sol Poly d'une saison (mêmes clés que LOWPOLY_GROUND de terrain.ts). */
export interface PolyGround {
  forest: string;
  field: string;
  field2: string;
  meadow: string;
  urban: string;
  dirt: string;
}

/** Ambiance d'un monde : sol, sable, roche, neige, feuillage. */
export interface PolyTheme {
  ground: Record<Season, PolyGround>;
  /** Sable des plages et dunes : bord de l'eau (mouillé) puis haut de plage. */
  sand: [string, string];
  /** Roche des parois et des sommets. */
  rock: string;
  /** Limite de la neige (m) par saison ; absente : celle de alpine.ts. */
  snowLine?: Record<Season, number>;
  /** Givre ou neige au sol en plaine (0 à 1) par saison ; absent : hiver seulement. */
  frost?: Record<Season, number>;
  /** Feuillage des arbres Poly (trois teintes) par saison. */
  leaves?: Record<Season, [string, string, string]>;
  /** Limite des arbres (m). */
  treelineM?: number;
  /** Couleur de l'eau (lacs, rivières, mer peu profonde). */
  water?: string;
}

/** Circuit du monde (pas de voitures ni de clôtures dessus), comme l'Anneau de l'île. */
export interface PolyRing {
  x: number;
  z: number;
  half: number;
  radius: number;
}

export interface PolyLand {
  world: PolyWorld;
  theme: PolyTheme;
  ring?: PolyRing;
  /** Décor propre du monde (lieux construits près du coureur), comme outdoorSites() de l'île. */
  sites: () => Site[];
  /** Restyle des bâtiments du monde (forme, toit, couleurs), comme robertvilleBuilding pour l'île. */
  building?: (b: TileBuilding) => TileBuilding;
  /** Pas de clôtures ni poteaux de campagne en (x, z) (quais, promenades). */
  noFence?: (x: number, z: number) => boolean;
}
