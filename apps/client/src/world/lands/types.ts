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
  /** Lumière et air du monde (environment.ts) : l'ambiance d'un vrai paysage (désert sec, fjord froid, jungle humide…). */
  light?: PolyLight;
}

/** Lumière d'un monde Poly, appliquée par-dessus l'heure, la saison et la météo (27/11/2026). */
export interface PolyLight {
  /** Teinte de l'horizon et du brouillard (hex), et part de mélange (0 à 1, par défaut 0,6). */
  horizon?: string;
  horizonMix?: number;
  /** Brume en plus (0 : aucune ; 1 : air humide ; 3 : brume marquée). */
  haze?: number;
  /** Chaleur de la lumière (−1 froide et bleutée, 0 neutre, +1 chaude et dorée). */
  warmth?: number;
  /** Saturation des couleurs (facteur, 1 : inchangée). */
  saturation?: number;
}

/**
 * Biome d'un monde : ce qui pousse et ce qui traîne au bord des routes. Sans biome : la campagne de l'île
 * (feuillus, sapins, herbe, boîtes aux lettres, poules, vaches).
 */
export interface PolyBiome {
  /** Les feuillus deviennent : palmiers, arbres de jungle, bouleaux ou acacias. */
  tree?: 'palm' | 'jungle' | 'birch' | 'acacia';
  /** Les conifères deviennent : cactus ou touffes de bambous (absent : sapins). */
  conifer?: 'cactus' | 'bamboo';
  /** Quantité d'herbe (0 : sol nu, 1 : comme l'île, plus : plus touffu). */
  grass?: number;
  /** Teintes de l'herbe (pied, pointe) par saison : toundra brune, herbe sèche, vert profond… */
  grassColours?: Record<Season, [string, string]>;
  /** Quantité d'arbres (0 à 1 : éclaircit les bois et les arbres isolés). */
  trees?: number;
  /** Pas de boîtes aux lettres, poubelles ni poules devant les maisons. */
  noVillageProps?: boolean;
  /** Pas de vaches, moutons ni chevaux dans les prés. */
  noHerds?: boolean;
  /** Bas-côtés propres au monde (roadsideLife.ts) ; absent : ceux de l'île (fleurs variées, petits cailloux, buissons). */
  roadside?: PolyRoadside;
}

/** Ce qui pousse et traîne au bord des routes d'un monde : chaque monde a les siens (27/11/2026). */
export interface PolyRoadside {
  /** Couleurs des touffes de fleurs (vide : pas de fleurs) et part des touffes gardées (0 à 1). */
  flowers?: string[];
  flowerRate?: number;
  /** Rochers : couleur, fréquence (part des pas de 3 m, l'île : 0,06), taille (facteur, l'île : 1), dessus moussu. */
  rock?: string;
  rockRate?: number;
  rockSize?: number;
  rockMoss?: string;
  /** Fougères (part des pas de 3 m) et couleur. */
  ferns?: number;
  fernColour?: string;
  /** Touffes d'herbe sèche (part des pas de 3 m) et couleur. */
  tufts?: number;
  tuftColour?: string;
  /** Buissons de l'île (faux : aucun). */
  bushes?: boolean;
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
  /** Végétation et mobilier propres au monde (voir PolyBiome). */
  biome?: PolyBiome;
  ring?: PolyRing;
  /** Décor propre du monde (lieux construits près du coureur), comme outdoorSites() de l'île. */
  sites: () => Site[];
  /** Restyle des bâtiments du monde (forme, toit, couleurs), comme robertvilleBuilding pour l'île. */
  building?: (b: TileBuilding) => TileBuilding;
  /** Pas de clôtures ni poteaux de campagne en (x, z) (quais, promenades). */
  noFence?: (x: number, z: number) => boolean;
}
