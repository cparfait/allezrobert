/**
 * Catalogue des vélos (bikes.json) : familles de cadres modélisées dans Blender
 * (tools/blender/bike_families.py), roues, options et livrée de chaque modèle.
 * Le client assemble le vélo à partir de ces paramètres ; le serveur ne s'en sert que pour
 * valider l'équipement (niveau de déblocage).
 */
import catalogJson from './bikes.json' with { type: 'json' };
import type { AvatarLook } from './net.ts';
import { applyTuneLook, type BikeExtras } from './tuning.ts';

export type BikeFamily = 'aero' | 'climb' | 'tt' | 'retro' | 'retro_compact' | 'steel' | 'lowpro' | 'lotus';
export type WheelType = 'box' | 'c35' | 'c50' | 'c65' | 'disc' | 'tri';
export type BikeType = 'aero' | 'climbing' | 'tt' | 'classic' | 'track';
export type BikeCollection = 'saison-2026' | 'mythiques' | 'divers';
/** « crystal » : facettes de cristal (atelier, livrée Glacier). */
export type LiveryPattern = 'solid' | 'fade' | 'split' | 'band' | 'stripes' | 'rainbow' | 'checker' | 'blocks' | 'dots' | 'stops' | 'crystal';
/** Axe du motif : z = avant → arrière, y = bas → haut, x = gauche → droite, diag / anti = diagonales. */
export type LiveryAxis = 'z' | 'y' | 'x' | 'diag' | 'anti';
export type LiveryFinish = 'gloss' | 'matte' | 'metallic' | 'chrome' | 'pearl' | 'iridescent' | 'raw';
/** Emplacements des inscriptions : diagonal, horizontal, tube de selle, fourche, bases. */
export type FrameMark = 'dt' | 'tt' | 'st' | 'fork' | 'cs';
/** Zones du cadre repeintes d'une couleur de la livrée (attribut « zone » des modèles). */
export type FrameZone = 'rear' | 'fork' | 'head';

export interface BikeLivery {
  /** Couleurs principales (1 à 3) ; les motifs utilisent c0, c1, c2. */
  colors: string[];
  pattern: LiveryPattern;
  axis?: LiveryAxis;
  /** Position du motif le long de l'axe (0–1). */
  at?: number;
  /** Largeur de bande (0–1). */
  width?: number;
  /** Liseré (couleur c2) sur la ligne de partage ou les bords de bande. */
  line?: boolean;
  /** Couleurs supplémentaires du motif « blocks ». */
  extra?: string[];
  /** Motif « stops » : plages successives le long de l'axe, chacune jusqu'à `to` (0–1 ; la dernière jusqu'au bout). Au plus 6. */
  stops?: Array<{ to: number; color: string }>;
  zones?: Partial<Record<FrameZone, number>>;
  finish?: LiveryFinish;
  /** Bande décor des jantes. */
  rim?: string;
  /** Guidoline. */
  tape?: string;
  /** Flancs des roues lenticulaires (sinon carbone noir). */
  disc?: string;
  /**
   * Inscriptions du cadre, comme sur le vrai vélo : texte et couleur par emplacement (diagonal,
   * horizontal, tube de selle, fourche, bases). Absent : la marque sur le diagonal seulement.
   * Couleur absente : contraste automatique avec la peinture ; `stretch` élargit les lettres
   * (caractères étendus, p. ex. LOOK : 1,6).
   */
  marks?: Partial<Record<FrameMark, { text: string; color?: string; stretch?: number }>>;
  /** Flancs des pneus (sinon noirs), p. ex. « gumwall » beige. */
  tireWall?: string;
  /** Selle (sinon noire). */
  saddle?: string;
}

export interface BikeParams {
  brakes: 'disc' | 'rim' | 'none';
  /** Roue avant, roue arrière. */
  wheels: [WheelType, WheelType];
  rimBrand?: string;
  aeroHelmet?: boolean;
  toeClips?: boolean;
  /** Vélo de piste : ni dérailleur ni bidons. */
  track?: boolean;
  /** Bidons (par défaut : oui, sauf vélo de piste). */
  bottles?: boolean;
  /** Compteur GPS sur le cintre (par défaut : oui ; non pour les vélos d'avant les GPS). */
  computer?: boolean;
}

export interface BikeModel {
  id: string;
  name: string;
  brand: string;
  collection: BikeCollection;
  group: string;
  type: BikeType;
  family: BikeFamily;
  params: BikeParams;
  livery: BikeLivery;
  level: number;
  year?: number;
  desc: { fr: string; en: string };
}

export interface BikeBrand {
  id: string;
  name: string;
  wordmark: string;
  font: string;
}

export interface BikeTeam {
  id: string;
  name: string;
  colors: string[];
  wordmark: string;
  logo: string;
  rimBrand: string;
}

export interface BikeGroup {
  id: string;
  name: { fr: string; en: string };
}

interface BikeCatalog {
  version: number;
  teams: BikeTeam[];
  groups: BikeGroup[];
  brands: BikeBrand[];
  legacy: Record<string, string>;
  bikes: BikeModel[];
}

const catalog = catalogJson as unknown as BikeCatalog;

export const BIKES: readonly BikeModel[] = catalog.bikes;
export const BIKE_BRANDS: readonly BikeBrand[] = catalog.brands;
export const BIKE_TEAMS: readonly BikeTeam[] = catalog.teams;
export const BIKE_GROUPS: readonly BikeGroup[] = catalog.groups;
export const BIKE_FAMILIES: readonly BikeFamily[] = ['aero', 'climb', 'tt', 'retro', 'retro_compact', 'steel', 'lowpro', 'lotus'];

const byId = new Map(BIKES.map((b) => [b.id, b]));

/** Bidons que porte un cadre de chaque famille (porte-bidons du tube oblique, puis du tube de selle). */
const FAMILY_BOTTLES: Record<BikeFamily, number> = { aero: 2, climb: 2, retro: 2, retro_compact: 2, steel: 2, tt: 0, lowpro: 0, lotus: 0 };

/** Nombre maximal de bidons (0, 1 ou 2) d'un vélo ; sans modèle : le vélo de base. */
export function bottleCapacity(id: string | undefined): 0 | 1 | 2 {
  const m = id ? bikeById(id) : undefined;
  if (id && !m) return 0;
  const family = m?.family ?? PLAIN_BIKE_FAMILY;
  if (m && (m.params.track || m.params.bottles === false)) return 0;
  return FAMILY_BOTTLES[family] as 0 | 1 | 2;
}

/** Anciens vélos du garage (bike-alu…) → modèle du catalogue ; tout autre identifiant inchangé. */
export function migrateBikeId(id: string): string {
  return catalog.legacy[id] ?? id;
}

/** Modèle du catalogue (anciens identifiants acceptés) ; undefined si inconnu. */
export function bikeById(id: string | undefined): BikeModel | undefined {
  return id ? byId.get(migrateBikeId(id)) : undefined;
}

/** Vélo de départ (niveau 1) : celui de l'ancien « Vélo route aluminium ». */
export const DEFAULT_BIKE_MODEL = bikeById('bike-alu') as BikeModel;

/** Famille du vélo de base, peint de la couleur unie `AvatarLook.bike`, quand aucun modèle n'est choisi. */
export const PLAIN_BIKE_FAMILY: BikeFamily = 'climb';

/** Vélo à assembler : famille de cadre, options et livrée. */
export interface BikeBuild {
  family: BikeFamily;
  params: BikeParams;
  livery: BikeLivery;
  /** Marque et équipe / collection (décors du cadre) ; absentes : vélo sans marque. */
  brand?: string;
  group?: string;
  /** Pièces de l'atelier au-delà de la livrée (couleurs des pièces, jantes lumineuses, plaque). */
  extras?: BikeExtras;
}

const PLAIN_PARAMS: BikeParams = { brakes: 'disc', wheels: ['c35', 'c35'] };

/**
 * Vélo d'une tenue : modèle du catalogue s'il est choisi, sinon vélo de base peint de `look.bike` ;
 * puis les pièces de l'atelier portées (`look.tune`).
 */
export function bikeOfLook(look: Pick<AvatarLook, 'bike' | 'bikeModel' | 'tune'>): BikeBuild {
  const m = bikeById(look.bikeModel);
  const base: BikeBuild = m ?? { family: PLAIN_BIKE_FAMILY, params: PLAIN_PARAMS, livery: { colors: [look.bike], pattern: 'solid' } };
  return look.tune?.length ? applyTuneLook(base, look.tune) : base;
}
