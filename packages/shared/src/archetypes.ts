/**
 * Archétypes de bâti (styles/archetypes.json) et profils de style par monde (styles/worlds/*.json).
 *
 * Un archétype décrit une famille de bâtiments reconnaissable (immeuble haussmannien, maison en
 * meulière…) : matériau et palette des murs, volets, toit, rythme de façade (travées, étages,
 * rez-de-chaussée, fenêtres, balcons). Un profil de monde dit quel archétype donner à chaque
 * bâtiment d'après ses attributs réels (BD TOPO, OSM) : la première règle qui s'applique gagne,
 * puis un tirage pondéré entre ses archétypes. Sans profil, le client garde son style historique.
 */
import archetypesJson from './styles/archetypes.json' with { type: 'json' };
import montmartre from './styles/worlds/montmartre.json' with { type: 'json' };

/** Matériau de façade : enduit, meulière, brique, moellons, pierre de taille, béton. */
export type WallMaterial = 'render' | 'meuliere' | 'brick' | 'rubble' | 'ashlar' | 'concrete';
export type RoofType = 'mansard_zinc' | 'zinc' | 'flat_tile' | 'mechanical_tile' | 'canal_tile' | 'slate' | 'stone_slab' | 'terrace';
/** Garde-corps : aucun, un par porte-fenêtre, filants (2e et 5e étages, haussmannien). */
export type Balconies = 'none' | 'balconettes' | 'continuous';

export interface ArchetypeFacade {
  /** Largeur d'une travée (m) : le nombre de fenêtres d'un mur est sa longueur divisée par ce pas. */
  bayM: number;
  /** Hauteur d'étage par défaut (m), remplacée par hauteur ÷ nombre de niveaux quand ils sont connus. */
  floorM: number;
  /** Hauteur du rez-de-chaussée (m) ; 0 = traité comme les étages. */
  groundFloorM: number;
  /** Fenêtre (largeur, hauteur) en mètres. */
  window: [number, number];
  /** Allège : hauteur du bas de la fenêtre au-dessus du plancher (m). */
  sillM: number;
  /** Encadrement de pierre ou de plâtre autour des baies (m), 0 = aucun. */
  frameM: number;
  balconies: Balconies;
  /** Bandeaux moulurés à chaque plancher. */
  stringCourses: boolean;
  /** Corniche sous l'égout. */
  cornice: boolean;
  /** Petits-bois (croisillons) dans les vitrages. */
  glazingBars: boolean;
  /** Part des bâtiments dont le rez-de-chaussée côté rue est une vitrine (0–1). */
  shopfronts: number;
}

export interface Archetype {
  label: string;
  wall: WallMaterial;
  walls: string[];
  /** Couleurs des volets ; vide = pas de volets. */
  shutters: string[];
  roof: { type: RoofType; colours: string[] };
  facade: ArchetypeFacade;
  ornaments?: { genoise?: boolean; quoins?: boolean };
  chimneys: number;
  dormers: boolean;
}

/** Conditions d'une règle (toutes doivent être vraies ; une condition absente est toujours vraie). */
export interface StyleCondition {
  kind?: string[];
  /** Matériau des murs (`stone`, `brick`, `concrete`, `render`, `wood`, `unknown` si absent). */
  material?: string[];
  roofMaterial?: string[];
  minLevels?: number;
  maxLevels?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface StyleRule {
  when: StyleCondition;
  /** Archétypes et poids (normalisés au tirage). */
  pick: Record<string, number>;
}

export interface WorldStyle {
  world: string;
  label?: string;
  /** Origine du profil (auto-profilage, relecture). */
  notes?: string;
  /** Natures de bâtiment hors archétype (annexes, édifices) : rendu historique. */
  skipKinds?: string[];
  rules: StyleRule[];
}

/** Attributs d'un bâtiment utiles au choix de l'archétype. */
export interface BuildingTraits {
  kind: string;
  height: number;
  levels?: number;
  material?: string;
  roofMaterial?: string;
}

export const ARCHETYPES: Record<string, Archetype> = (archetypesJson as unknown as { archetypes: Record<string, Archetype> }).archetypes;

const STYLES: Record<string, WorldStyle> = {
  montmartre: montmartre as unknown as WorldStyle,
};

/** Profil de style d'un monde, ou null (rendu historique). */
export function worldStyle(worldId: string): WorldStyle | null {
  return STYLES[worldId] ?? null;
}

export function worldStyleIds(): string[] {
  return Object.keys(STYLES);
}

/** Nombre de niveaux : donnée si plausible, sinon estimé depuis la hauteur (3 m par niveau). */
export function estimatedLevels(t: BuildingTraits): number {
  if (t.levels && t.levels >= 1 && t.levels <= 60) return Math.round(t.levels);
  return Math.max(1, Math.round((t.height || 3) / 3));
}

function matches(c: StyleCondition, t: BuildingTraits, levels: number): boolean {
  if (c.kind && !c.kind.includes(t.kind)) return false;
  if (c.material && !c.material.includes(t.material ?? 'unknown')) return false;
  if (c.roofMaterial && !c.roofMaterial.includes(t.roofMaterial ?? 'unknown')) return false;
  if (c.minLevels !== undefined && levels < c.minLevels) return false;
  if (c.maxLevels !== undefined && levels > c.maxLevels) return false;
  if (c.minHeight !== undefined && t.height < c.minHeight) return false;
  if (c.maxHeight !== undefined && t.height > c.maxHeight) return false;
  return true;
}

/**
 * Archétype d'un bâtiment (`rnd` ∈ [0, 1[ : tirage propre au bâtiment), ou null si aucune règle ne
 * s'applique ou si sa nature est exclue.
 */
export function pickArchetype(style: WorldStyle, t: BuildingTraits, rnd: number): string | null {
  if (style.skipKinds?.includes(t.kind)) return null;
  const levels = estimatedLevels(t);
  for (const rule of style.rules) {
    if (!matches(rule.when, t, levels)) continue;
    const entries = Object.entries(rule.pick).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (!total) return null;
    let x = rnd * total;
    for (const [id, w] of entries) {
      x -= w;
      if (x < 0) return id;
    }
    return entries[entries.length - 1]![0];
  }
  return null;
}

/** Incohérences d'un profil (archétype inconnu, poids négatif, règle vide) : liste vide si valide. */
export function validateStyle(style: WorldStyle): string[] {
  const errors: string[] = [];
  style.rules.forEach((r, i) => {
    const ids = Object.keys(r.pick);
    if (!ids.length) errors.push(`${style.world} règle ${i} : aucun archétype`);
    for (const id of ids) {
      if (!ARCHETYPES[id]) errors.push(`${style.world} règle ${i} : archétype inconnu « ${id} »`);
      if (!(r.pick[id]! >= 0)) errors.push(`${style.world} règle ${i} : poids invalide pour « ${id} »`);
    }
  });
  return errors;
}
