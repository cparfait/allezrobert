/**
 * Progression partagée client / serveur : XP, niveaux, catalogue de cosmétiques.
 *
 * XP d'une sortie (invités exclus) : 20 × km + 1 × m de D+ + 2 × minutes en mouvement,
 * plafonnée à 4 000 XP par sortie. Niveau L atteint à 250 × L × (L − 1) XP ; maximum 50.
 */
import catalogJson from './cosmetics.json' with { type: 'json' };
import { DEFAULT_BIKE, type BikeSetup } from './rider.ts';
import { BIKES, migrateBikeId, type BikeType } from './bikes.ts';
import type { AvatarLook, CapLook, HelmetShape, JerseyStyle } from './net.ts';

export const MAX_LEVEL = 50;
export const MAX_XP_PER_RIDE = 4000;

export function xpForRide(r: { distanceM: number; elevationM: number; movingS: number }): number {
  const km = Math.max(0, r.distanceM) / 1000;
  return Math.min(MAX_XP_PER_RIDE, Math.round(20 * km + Math.max(0, r.elevationM) + (2 * Math.max(0, r.movingS)) / 60));
}

export function xpForLevel(level: number): number {
  const l = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return 250 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  const l = Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 250)) / 2);
  return Math.min(Math.max(l, 1), MAX_LEVEL);
}

export function levelProgress(xp: number): { level: number; progress: number; nextLevelXp: number | null } {
  const level = levelForXp(xp);
  const cur = xpForLevel(level);
  const next = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
  return { level, progress: next === null ? 1 : (xp - cur) / (next - cur), nextLevelXp: next };
}

/** Les roues sont passées à l'atelier (tuning.ts, emplacement « wheelset »). */
export type CosmeticSlot = 'jersey' | 'helmet' | 'bike' | 'socks' | 'glasses';

/** Effet d'un équipement sur la physique (relatif au vélo route aluminium par défaut). */
export interface CosmeticPhysics {
  /** Masse ajoutée (kg, négative si plus léger). */
  massKg?: number;
  /** Multiplicateur de CdA. */
  cdaFactor?: number;
  /** Moment d'inertie des deux roues (kg·m²), remplace la valeur du vélo. */
  wheelInertia?: number;
  /** Multiplicateur de Crr sur enrobé. */
  crrFactor?: number;
  tyre?: 'road' | 'gravel' | 'mtb';
}

/** Packs de maillots du garage : ordre et noms (un maillot sans pack va dans « Maillots »). */
export const JERSEY_PACKS: ReadonlyArray<{ id: string; name: { fr: string; en: string } }> = [
  { id: 'tour', name: { fr: 'Tour de France', en: 'Tour de France' } },
  { id: 'pays', name: { fr: 'Champions nationaux', en: 'National champions' } },
  { id: 'distinctifs', name: { fr: 'Maillots distinctifs', en: 'Leaders’ jerseys' } },
  { id: 'equipes', name: { fr: 'Couleurs d’équipes', en: 'Team colours' } },
  { id: 'pro', name: { fr: 'Équipes pro', en: 'Pro teams' } },
];

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: { fr: string; en: string };
  level: number;
  color?: string;
  physics?: CosmeticPhysics;
  /** Ce que l'équipement change (affiché au garage). */
  effect?: { fr: string; en: string };
  /** Vélos : couleurs de la livrée (vignette du garage). */
  colors?: string[];
  /** Pack du garage (maillots : « pays », « distinctifs », « équipes »). */
  pack?: string;
  /** Maillots : accent, style (uni, bandes de poitrine) et bandes ; absent : dessin d'origine. */
  jersey?: { accent?: string; style?: JerseyStyle; bands?: string[]; dots?: { r: number; step: number }; logo?: { id: string; tint?: string; w?: number; y?: number } };
  /** Casquettes (emplacement « helmet ») : motif porté à la place du casque. */
  cap?: CapLook;
  /** « Sans casque » / « Sans lunettes » : retire la coiffe ou les lunettes de l'emplacement. */
  bare?: boolean;
  /** Casques chrono (emplacement « helmet ») : forme portée, à la couleur de l'article. */
  helmetShape?: HelmetShape;
  /** Lunettes (emplacement « glasses ») : couleurs de la monture et des verres. */
  glasses?: { frame: string; lens: string };
}

/**
 * Coiffe d'un équipement « casque » : sa couleur et, pour une casquette, son motif, pour un casque chrono,
 * sa forme (chaque article retire la casquette et la forme de l'article précédent) ; « Sans casque » laisse
 * la tête nue (la couleur du casque est gardée pour la suite).
 */
export function helmetLookOf(item: CosmeticItem, base: AvatarLook): AvatarLook {
  const { cap: _old, noHelmet: _bare, helmetShape: _shape, ...rest } = base;
  if (item.bare) return { ...rest, noHelmet: true };
  return { ...rest, helmet: item.color ?? base.helmet, ...(item.cap ? { cap: item.cap } : {}), ...(item.helmetShape ? { helmetShape: item.helmetShape } : {}) };
}

/**
 * Lunettes d'un équipement « lunettes » : « Sans lunettes » les retire ; toute autre paire les remet, avec
 * sa monture et ses verres (sans couleurs : les lunettes d'origine).
 */
export function glassesLookOf(item: CosmeticItem, base: AvatarLook): AvatarLook {
  const { noGlasses: _bare, glassesFrame: _f, glassesLens: _l, ...rest } = base;
  if (item.bare) return { ...rest, noGlasses: true };
  return item.glasses ? { ...rest, glassesFrame: item.glasses.frame, glassesLens: item.glasses.lens } : rest;
}

/**
 * Tenue d'un maillot du catalogue : couleur, et style et bandes remplacés (un maillot simple
 * remet le dessin d'origine) ; l'accent n'est changé que si le maillot en donne un.
 */
export function jerseyLookOf(item: CosmeticItem): Pick<AvatarLook, 'jersey' | 'jerseyStyle' | 'jerseyBands' | 'jerseyDots' | 'jerseyLogo'> & Partial<Pick<AvatarLook, 'jerseyAccent'>> {
  return {
    jersey: item.color ?? '#ffffff',
    ...(item.jersey?.accent ? { jerseyAccent: item.jersey.accent } : {}),
    jerseyStyle: item.jersey?.style,
    jerseyBands: item.jersey?.bands,
    jerseyDots: item.jersey?.dots,
    jerseyLogo: item.jersey?.logo,
  };
}

/**
 * Effet en selle des vélos du catalogue, selon leur type (aéro, grimpeur, chrono, classique, piste).
 * Les modèles qui remplacent les anciens vélos du garage gardent exactement leurs valeurs.
 */
const BIKE_TYPE_PHYSICS: Record<BikeType, CosmeticPhysics> = {
  aero: { massKg: -1.0, cdaFactor: 0.97 },
  climbing: { massKg: -1.5 },
  tt: { massKg: -0.5, cdaFactor: 0.93 },
  classic: { massKg: 1.5, cdaFactor: 1.02 },
  track: { massKg: -1.2, cdaFactor: 0.97 },
};
const LEGACY_BIKE_PHYSICS: Record<string, CosmeticPhysics | null> = {
  'bike-alu': null,
  'bike-carbone': { massKg: -1.3, cdaFactor: 0.98 },
  'bike-acier-vintage': { massKg: 1.8, cdaFactor: 1.02 },
  'bike-grimpeur': { massKg: -1.7 },
};

/** Cosmétiques de cosmetics.json, puis les vélos du catalogue (bikes.json) dans l'emplacement « bike ». */
export const COSMETICS: CosmeticItem[] = [
  ...(catalogJson as { items: CosmeticItem[] }).items,
  ...BIKES.map((b): CosmeticItem => {
    const physics = bikePhysics(b.id, b.type);
    return { id: b.id, slot: 'bike', name: { fr: b.name, en: b.name }, level: b.level, color: b.livery.colors[0], colors: b.livery.colors, ...(physics ? { physics, effect: effectText(physics) } : {}) };
  }),
];

/** Identifiant à jour d'un cosmétique équipé (anciens vélos du garage → modèles du catalogue). */
export function migrateCosmeticId(slot: string, id: string): string {
  return slot === 'bike' ? migrateBikeId(id) : id;
}

export function unlockedCosmetics(level: number): CosmeticItem[] {
  return COSMETICS.filter((c) => c.level <= level);
}

/**
 * Vélo réellement roulé selon l'équipement porté : masse, CdA, Crr et inertie des roues.
 * Les équipements sans effet physique (maillot, lunettes…) ne changent rien.
 */
function bikePhysics(id: string, type: BikeType): CosmeticPhysics | undefined {
  for (const [legacy, ph] of Object.entries(LEGACY_BIKE_PHYSICS)) if (migrateBikeId(legacy) === id) return ph ?? undefined;
  return BIKE_TYPE_PHYSICS[type];
}

/** Libellé de l'effet (garage) : masse et traînée. */
function effectText(ph: CosmeticPhysics): { fr: string; en: string } {
  const fr: string[] = [];
  const en: string[] = [];
  const sign = (v: number) => (v > 0 ? '+' : '−');
  if (ph.massKg) {
    const v = Math.abs(ph.massKg);
    fr.push(`${sign(ph.massKg)}${String(v).replace('.', ',')} kg`);
    en.push(`${sign(ph.massKg)}${v} kg`);
  }
  if (ph.cdaFactor && ph.cdaFactor !== 1) {
    const pct = Math.round(Math.abs(ph.cdaFactor - 1) * 1000) / 10;
    fr.push(`${sign(ph.cdaFactor - 1)}${String(pct).replace('.', ',')} % de traînée`);
    en.push(`${sign(ph.cdaFactor - 1)}${pct}% drag`);
  }
  return { fr: fr.join(', '), en: en.join(', ') };
}

export function bikeSetupFor(equipped: Readonly<Record<string, string | undefined>>, base: BikeSetup = DEFAULT_BIKE): BikeSetup {
  const bike: BikeSetup = { ...base };
  const names: string[] = [];
  for (const id of Object.values(equipped)) {
    if (!id) continue;
    const item = COSMETICS.find((c) => c.id === migrateBikeId(id));
    const ph = item?.physics;
    if (!item || !ph) continue;
    if (ph.massKg) bike.massKg += ph.massKg;
    if (ph.cdaFactor) bike.cda *= ph.cdaFactor;
    if (ph.crrFactor) bike.crr *= ph.crrFactor;
    if (ph.wheelInertia) bike.wheelInertia = ph.wheelInertia;
    if (ph.tyre) bike.tyre = ph.tyre;
    if (item.slot === 'bike') names.unshift(item.name.fr);
  }
  if (names.length) bike.name = names[0] as string;
  bike.massKg = Math.round(bike.massKg * 100) / 100;
  return bike;
}
