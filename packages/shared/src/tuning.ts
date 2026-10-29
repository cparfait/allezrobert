/**
 * Atelier : catalogue des 109 pièces et décors du vélo (tuning.json), ensembles (kits),
 * crédits et récompenses d'événements. Partagé client / serveur : le serveur valide les achats
 * et l'équipement avec ces mêmes fonctions (jamais avec des valeurs envoyées par le client).
 *
 * Familles : pièces techniques (34), peintures et livrées (25), roues et effets (15),
 * accessoires (15), ensembles (10), récompenses d'événements (10, non achetables).
 * Chaque pièce a un emplacement (une seule par emplacement) ; un ensemble regroupe des pièces.
 * L'effet physique (`perf`) est appliqué et plafonné par @allezrobert/physics (tuning.ts).
 */
import catalogJson from './tuning.json' with { type: 'json' };
import { BIKE_BRANDS, type BikeBuild, type BikeLivery, type FrameMark, type LiveryFinish, type WheelType } from './bikes.ts';

export type TuneFamily = 'tech' | 'paint' | 'wheelfx' | 'accessory' | 'kit' | 'event';
export type TuneRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'classic';
export type TuneSlot =
  | 'wheelset'
  | 'tyres'
  | 'cockpit'
  | 'aerobars'
  | 'groupset'
  | 'crank'
  | 'cassette'
  | 'pulleys'
  | 'rotors'
  | 'saddle'
  | 'seatpost'
  | 'finish'
  | 'paint'
  | 'sticker'
  | 'number'
  | 'rimdecal'
  | 'spokes'
  | 'rimglow'
  | 'valves'
  | 'tape'
  | 'bottles'
  | 'topcap'
  | 'spacers'
  | 'bolts'
  | 'computer'
  | 'chain';

/** Événements qui débloquent les récompenses (vérifiés par le serveur pour un compte). */
export type TuneEvent = 'route-finish' | 'routes-10' | 'kom' | 'kom-5' | 'podium' | 'win' | 'streak-3' | 'streak-7' | 'streak-30' | 'century';

export type TuneUnlock = { level: number } | { event: TuneEvent } | { kit: string };

/** Matériaux du vélo recolorables (noms des matériaux des modèles Blender). */
export type BikePart =
  | 'chain'
  | 'chainring'
  | 'crank'
  | 'cassette'
  | 'pulley'
  | 'rotor'
  | 'saddle'
  | 'seatpost'
  | 'bar_tape'
  | 'bottle'
  | 'cage'
  | 'topcap'
  | 'spacers'
  | 'bolts'
  | 'computer'
  | 'spokes'
  | 'valve';

/** Effet physique d'une pièce, relatif au vélo sans pièce de l'atelier. */
export interface TunePerf {
  /** Masse ajoutée (kg, négative si plus léger). */
  massKg?: number;
  /** Multiplicateur de CdA. */
  cdaFactor?: number;
  /** Multiplicateur de Crr. */
  crrFactor?: number;
  /** Inertie des deux roues (kg·m²), remplace celle du vélo. */
  wheelInertia?: number;
  /** Gain de rendement de transmission (ajouté, p. ex. 0,0099 ≈ +1 %). */
  drivetrain?: number;
}

/** Plaque de cadre (dossard sous la selle). */
export interface TuneNumber {
  text: string;
  bg: string;
  fg: string;
  /** Liseré de couleur en bas de la plaque. */
  stripe?: string;
  /** Épinglée à l'envers (superstition du 13). */
  flip?: boolean;
}

/**
 * Prolongateurs montés sur le cintre route : « clip » bas, repose-coudes sur les colliers (type Swiss Side
 * Hadron) ; « clip-haut » surélevés, repose-coudes sur des pieds (type FastT Xenos).
 */
export type AerobarKind = 'clip' | 'clip-haut';

/** Ce que la pièce change à l'écran. */
export interface TuneLook {
  /** Prolongateurs (vélos de route ; les vélos de chrono ont les leurs). */
  aerobars?: AerobarKind;
  wheels?: [WheelType, WheelType];
  /** Marque inscrite sur les jantes. */
  rimBrand?: string;
  /** Couleur des inscriptions des jantes ; « holo » : holographique. */
  rim?: string;
  /** Flancs des pneus ; « rainbow » : arc-en-ciel. */
  tireWall?: string;
  /** Peinture complète du cadre (remplace celle du modèle, inscriptions de marque conservées). */
  livery?: Partial<BikeLivery>;
  /** Finition seule (vernis), appliquée par-dessus la peinture. */
  finish?: LiveryFinish;
  /** Couleur imposée aux inscriptions du cadre. */
  markColor?: string;
  /** Autocollants : inscriptions ajoutées aux emplacements du cadre. */
  marks?: Partial<Record<FrameMark, { text: string; color?: string }>>;
  number?: TuneNumber;
  parts?: Partial<Record<BikePart, string>>;
  /** Pièces au rendu métallique (anodisé, doré). */
  metal?: BikePart[];
  /** Pièces en carbone apparent (tissage visible de près). */
  carbon?: BikePart[];
  /** Liseré lumineux des jantes (émissif, diffuse avec le bloom). */
  glow?: string;
}

export interface TuneItem {
  id: string;
  family: TuneFamily;
  /** Emplacement (absent pour un ensemble). */
  slot?: TuneSlot;
  name: { fr: string; en: string };
  brand?: string;
  rarity: TuneRarity;
  /** Prix en crédits (0 : non achetable seul — récompense ou ensemble au prix calculé). */
  price: number;
  unlock: TuneUnlock;
  /** Gains annoncés (%) aux conditions de référence, vérifiés par les tests de calibration. */
  bonus?: { flat?: number; climb?: number };
  perf?: TunePerf;
  look?: TuneLook;
  /** Ensemble : pièces qui le composent. */
  pieces?: string[];
  /** Ensemble complet : titre affiché (aucun bonus). */
  title?: { fr: string; en: string };
  /** Couleur du badge de l'ensemble. */
  badge?: string;
  desc: { fr: string; en: string };
  /** Effet en jeu (calculé à partir de `bonus` et `perf`). */
  effect: { fr: string; en: string };
}

type RawItem = Omit<TuneItem, 'effect'>;

export const TUNE_FAMILIES: readonly TuneFamily[] = ['tech', 'paint', 'wheelfx', 'accessory', 'kit', 'event'];
export const TUNE_RARITIES: readonly TuneRarity[] = ['common', 'rare', 'epic', 'legendary', 'classic'];
export const TUNE_EVENTS: readonly TuneEvent[] = ['route-finish', 'routes-10', 'kom', 'kom-5', 'podium', 'win', 'streak-3', 'streak-7', 'streak-30', 'century'];

/** Emplacements de chaque famille, dans l'ordre de l'atelier. */
export const TUNE_SLOTS: Record<Exclude<TuneFamily, 'kit' | 'event'>, readonly TuneSlot[]> = {
  tech: ['wheelset', 'tyres', 'cockpit', 'aerobars', 'groupset', 'crank', 'cassette', 'pulleys', 'rotors', 'saddle', 'seatpost'],
  paint: ['paint', 'finish', 'sticker', 'number'],
  wheelfx: ['rimdecal', 'spokes', 'rimglow', 'valves'],
  accessory: ['tape', 'bottles', 'chain', 'topcap', 'spacers', 'bolts', 'computer'],
};
export const ALL_TUNE_SLOTS: readonly TuneSlot[] = Object.values(TUNE_SLOTS).flat();

export const RARITY_LABEL: Record<TuneRarity, { fr: string; en: string; color: string }> = {
  common: { fr: 'Commun', en: 'Common', color: '#9aa4b2' },
  rare: { fr: 'Rare', en: 'Rare', color: '#3b82f6' },
  epic: { fr: 'Épique', en: 'Epic', color: '#a855f7' },
  legendary: { fr: 'Légendaire', en: 'Legendary', color: '#f5b301' },
  classic: { fr: 'Classique', en: 'Classic', color: '#c08a4a' },
};

export const TUNE_EVENT_LABEL: Record<TuneEvent, { fr: string; en: string }> = {
  'route-finish': { fr: 'Boucler un parcours', en: 'Finish a route' },
  'routes-10': { fr: 'Boucler 10 parcours différents', en: 'Finish 10 different routes' },
  kom: { fr: 'Boucler une montée chronométrée', en: 'Complete a timed climb' },
  'kom-5': { fr: 'Boucler 5 montées chronométrées', en: 'Complete 5 timed climbs' },
  podium: { fr: 'Monter sur un podium de course', en: 'Finish on a race podium' },
  win: { fr: 'Gagner une course', en: 'Win a race' },
  'streak-3': { fr: 'Rouler 3 jours de suite', en: 'Ride 3 days in a row' },
  'streak-7': { fr: 'Rouler 7 jours de suite', en: 'Ride 7 days in a row' },
  'streak-30': { fr: 'Rouler 30 jours de suite', en: 'Ride 30 days in a row' },
  century: { fr: 'Rouler 100 km d’une traite', en: 'Ride 100 km in one go' },
};

const num = (v: number, fr: boolean) => (Math.round(v * 10) / 10).toString().replace('.', fr ? ',' : '.');

/** Effet en jeu : gains annoncés, sinon pénalités physiques, sinon style seul. */
function effectOf(it: RawItem): { fr: string; en: string } {
  if (it.family === 'kit') return { fr: 'Ensemble : titre et badge, aucun bonus', en: 'Set: title and badge, no bonus' };
  const fr: string[] = [];
  const en: string[] = [];
  const b = it.bonus ?? {};
  if (b.flat) {
    fr.push(`+${num(b.flat, true)} % sur le plat`);
    en.push(`+${num(b.flat, false)}% on the flat`);
  }
  if (b.climb) {
    fr.push(`+${num(b.climb, true)} % en côte`);
    en.push(`+${num(b.climb, false)}% climbing`);
  }
  const p = it.perf ?? {};
  if (!fr.length) {
    if (p.cdaFactor && p.cdaFactor > 1) {
      fr.push(`+${num((p.cdaFactor - 1) * 100, true)} % de traînée`);
      en.push(`+${num((p.cdaFactor - 1) * 100, false)}% drag`);
    }
    if (p.crrFactor && p.crrFactor > 1) {
      fr.push(`+${num((p.crrFactor - 1) * 100, true)} % de résistance au roulement`);
      en.push(`+${num((p.crrFactor - 1) * 100, false)}% rolling resistance`);
    }
    if (p.massKg && p.massKg > 0) {
      fr.push(`+${num(p.massKg, true)} kg`);
      en.push(`+${num(p.massKg, false)} kg`);
    }
  } else if (p.massKg && p.massKg > 0) {
    fr.push(`mais +${num(p.massKg, true)} kg`);
    en.push(`but +${num(p.massKg, false)} kg`);
  }
  if (!fr.length) return { fr: 'Style uniquement', en: 'Style only' };
  return { fr: fr.join(', '), en: en.join(', ') };
}

export const TUNE_ITEMS: readonly TuneItem[] = (catalogJson as unknown as { items: RawItem[] }).items.map((it) => ({ ...it, effect: effectOf(it) }));
const tuneById = new Map(TUNE_ITEMS.map((t) => [t.id, t]));
export const TUNE_KITS: readonly TuneItem[] = TUNE_ITEMS.filter((t) => t.family === 'kit');

export function tuneItem(id: string | undefined): TuneItem | undefined {
  return id ? tuneById.get(id) : undefined;
}

export function isTuneSlot(s: string): s is TuneSlot {
  return (ALL_TUNE_SLOTS as readonly string[]).includes(s);
}

/** Anciennes roues du garage (emplacement « wheels ») → roues de l'atelier, offertes à la migration. */
export const LEGACY_WHEELS: Readonly<Record<string, string | null>> = {
  'wheels-alu': null,
  'wheels-carbone-40': 'tune-wh-zipp-303',
  'wheels-carbone-50': 'tune-wh-dt-arc50',
  'wheels-carbone-88': 'tune-wh-enve-67',
  'wheels-lenticulaire': 'tune-wh-zipp-super9',
};

/** Pièces de l'atelier équipées (valeurs connues des emplacements de l'atelier, dans l'ordre des emplacements). */
export function equippedTuneIds(equipped: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const slot of ALL_TUNE_SLOTS) {
    const it = tuneItem(equipped[slot]);
    if (it && it.slot === slot) out.push(it.id);
  }
  return out;
}

// ————————————————————————————————————————————— Achats et déblocages

export type TuneAvailability = 'owned' | 'buyable' | 'level' | 'event' | 'kit';

/** Ce qui empêche (ou permet) d'acheter une pièce : déjà à soi, achetable, niveau, événement, ensemble. */
export function tuneAvailability(item: TuneItem, level: number, owned: ReadonlySet<string> | readonly string[]): TuneAvailability {
  const has = owned instanceof Set ? owned.has(item.id) : (owned as readonly string[]).includes(item.id);
  if (has) return 'owned';
  const u = item.unlock;
  if ('event' in u) return 'event';
  if ('kit' in u) return 'kit';
  return level >= u.level ? 'buyable' : 'level';
}

/** Pièces achetables d'un ensemble (hors récompenses d'événement). */
function kitBuyablePieces(kit: TuneItem): TuneItem[] {
  return (kit.pieces ?? []).map((id) => tuneItem(id)).filter((p): p is TuneItem => !!p && !('event' in p.unlock));
}

/** Prix d'un ensemble : 85 % des pièces manquantes (récompenses exclues), arrondi à la dizaine. */
export function kitPrice(kit: TuneItem, owned: ReadonlySet<string> | readonly string[] = []): number {
  const set = owned instanceof Set ? owned : new Set(owned as readonly string[]);
  const missing = kitBuyablePieces(kit).filter((p) => !set.has(p.id));
  return Math.round((missing.reduce((a, p) => a + p.price, 0) * 0.85) / 10) * 10;
}

/** Avancement d'un ensemble : pièces possédées / total. */
export function kitProgress(kit: TuneItem, owned: ReadonlySet<string> | readonly string[]): { have: number; total: number; complete: boolean } {
  const set = owned instanceof Set ? owned : new Set(owned as readonly string[]);
  const pieces = kit.pieces ?? [];
  const have = pieces.filter((id) => set.has(id)).length;
  return { have, total: pieces.length, complete: pieces.length > 0 && have === pieces.length };
}

export interface PurchaseResult {
  ok: boolean;
  /** Code d'erreur : inconnu, déjà possédé, niveau, événement, ensemble seulement, crédits. */
  error?: 'unknown' | 'owned' | 'level' | 'event' | 'kit' | 'credits';
  /** Crédits manquants (erreur « credits »). */
  missing?: number;
  price: number;
  /** Pièces ajoutées. */
  granted: string[];
}

/**
 * Achat d'une pièce ou d'un ensemble (règles uniques, appliquées aussi par le serveur) :
 * niveau atteint, pas une récompense, pas une pièce réservée à un ensemble, crédits suffisants.
 */
export function purchase(id: string, state: { level: number; credits: number; owned: readonly string[] }): PurchaseResult {
  const item = tuneItem(id);
  if (!item) return { ok: false, error: 'unknown', price: 0, granted: [] };
  const owned = new Set(state.owned);
  if (item.family === 'kit') {
    const lvl = 'level' in item.unlock ? item.unlock.level : 1;
    if (state.level < lvl) return { ok: false, error: 'level', price: 0, granted: [] };
    const price = kitPrice(item, owned);
    const granted = kitBuyablePieces(item)
      .filter((p) => !owned.has(p.id))
      .map((p) => p.id);
    if (!granted.length) return { ok: false, error: 'owned', price: 0, granted: [] };
    if (state.credits < price) return { ok: false, error: 'credits', missing: price - state.credits, price, granted: [] };
    return { ok: true, price, granted };
  }
  const av = tuneAvailability(item, state.level, owned);
  if (av !== 'buyable') return { ok: false, error: av === 'owned' ? 'owned' : av, price: item.price, granted: [] };
  if (state.credits < item.price) return { ok: false, error: 'credits', missing: item.price - state.credits, price: item.price, granted: [] };
  return { ok: true, price: item.price, granted: [item.id] };
}

/**
 * Équipement valide : chaque pièce de l'atelier existe, va dans son emplacement et est possédée.
 * Renvoie le message d'erreur ou null.
 */
export function validateTuneEquipped(equipped: Readonly<Record<string, string>>, owned: readonly string[]): string | null {
  const set = new Set(owned);
  for (const [slot, id] of Object.entries(equipped)) {
    if (!isTuneSlot(slot)) continue;
    const it = tuneItem(id);
    if (!it) return `Pièce inconnue : ${id}`;
    if (it.slot !== slot) return `${id} ne va pas dans l'emplacement ${slot}`;
    if (!set.has(id)) return `${id} n'est pas dans ton atelier`;
  }
  return null;
}

/** Ensembles complets (titres et badges). */
export function completedKits(owned: readonly string[]): TuneItem[] {
  return TUNE_KITS.filter((k) => kitProgress(k, owned).complete);
}

// ————————————————————————————————————————————— Crédits et événements

export const MAX_CREDITS_PER_RIDE = 300;

/** Jour local AAAA-MM-JJ (série de jours consécutifs). */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Série de jours de sortie : même jour inchangée, lendemain +1, sinon 1. */
export function nextStreak(prev: { last: string; days: number } | undefined, today: string): { last: string; days: number; firstOfDay: boolean } {
  if (!prev?.last) return { last: today, days: 1, firstOfDay: true };
  if (prev.last === today) return { last: today, days: prev.days, firstOfDay: false };
  const a = Date.parse(`${prev.last}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  const gap = Math.round((b - a) / 86_400_000);
  return { last: today, days: gap === 1 ? prev.days + 1 : 1, firstOfDay: true };
}

/**
 * Crédits d'une sortie (avec l'XP) : 1 par km, 1 par 20 m de D+, 10 par segment bouclé (5 au plus),
 * bonus modeste de série (5 par jour consécutif, 7 jours au plus, à la première sortie du jour).
 * Plafond : 300 crédits par sortie.
 */
export function creditsForRide(r: { distanceM: number; elevationM: number; segments?: number; streakDays?: number; firstOfDay?: boolean }): number {
  const km = Math.max(0, r.distanceM) / 1000;
  const climb = Math.max(0, r.elevationM) / 20;
  const seg = 10 * Math.min(Math.max(0, Math.floor(r.segments ?? 0)), 5);
  const streak = r.firstOfDay ? 5 * Math.min(Math.max(0, r.streakDays ?? 0), 7) : 0;
  return Math.min(MAX_CREDITS_PER_RIDE, Math.round(km + climb + seg + streak));
}

/** Événements gagnés par une sortie (cumuls après la sortie). */
export function rideEvents(r: { distanceM: number; routeFinished?: boolean; routesFinished?: number; koms?: number; raceRank?: number; streakDays?: number }): TuneEvent[] {
  const ev: TuneEvent[] = [];
  if (r.routeFinished) ev.push('route-finish');
  if ((r.routesFinished ?? 0) >= 10) ev.push('routes-10');
  if ((r.koms ?? 0) >= 1) ev.push('kom');
  if ((r.koms ?? 0) >= 5) ev.push('kom-5');
  if (r.raceRank && r.raceRank <= 3) ev.push('podium');
  if (r.raceRank === 1) ev.push('win');
  const st = r.streakDays ?? 0;
  if (st >= 3) ev.push('streak-3');
  if (st >= 7) ev.push('streak-7');
  if (st >= 30) ev.push('streak-30');
  if (r.distanceM >= 100_000) ev.push('century');
  return ev;
}

/** Récompenses débloquées par une liste d'événements. */
export function eventRewards(events: readonly TuneEvent[]): TuneItem[] {
  return TUNE_ITEMS.filter((t) => 'event' in t.unlock && events.includes(t.unlock.event));
}

// ————————————————————————————————————————————— Rendu

/** Ce que l'atelier ajoute au vélo assemblé, au-delà de la livrée et des roues. */
export interface BikeExtras {
  parts?: Partial<Record<BikePart, string>>;
  metal?: BikePart[];
  carbon?: BikePart[];
  glow?: string;
  number?: TuneNumber;
  rainbowWall?: boolean;
  holoRim?: boolean;
  aerobars?: AerobarKind;
}

/** Inscriptions de jante par défaut quand ni le vélo ni les roues n'ont de marque. */
const DEFAULT_RIM_TEXT = 'allez-robert';

/**
 * Vélo assemblé avec les pièces de l'atelier : roues, peinture (inscriptions de marque
 * conservées), vernis, autocollants, jantes, flancs et couleurs des pièces. Pièces inconnues
 * ignorées. Ordre : celui des emplacements (le vernis passe après la peinture).
 */
export function applyTuneLook(build: BikeBuild, ids: readonly string[]): BikeBuild {
  const items = ALL_TUNE_SLOTS.map((slot) => ids.map((id) => tuneItem(id)).find((t) => t?.slot === slot)).filter((t): t is TuneItem => !!t);
  if (!items.length) return build;
  const brand = BIKE_BRANDS.find((b) => b.id === build.brand);
  let livery: BikeLivery = { ...build.livery };
  const params = { ...build.params };
  const extras: BikeExtras = { ...(build.extras ?? {}) };
  let marks: Partial<Record<FrameMark, { text: string; color?: string; stretch?: number }>> = { ...(build.livery.marks ?? (brand ? { dt: { text: brand.wordmark } } : {})) };
  let markColor: string | undefined;
  /** Autocollants à couleur propre : la couleur imposée par la peinture ne s'y applique pas. */
  const ownColor = new Set<FrameMark>();
  let finish: LiveryFinish | undefined;
  let rimColor: string | undefined;
  for (const it of items) {
    const l = it.look;
    if (!l) continue;
    if (l.wheels) params.wheels = [...l.wheels];
    if (l.rimBrand) params.rimBrand = l.rimBrand;
    if (l.livery) {
      // Peinture complète : motif et couleurs remplacés, accessoires de la livrée conservés.
      const { colors: _c, pattern: _p, axis: _a, at: _at, width: _w, line: _l, extra: _e, stops: _s, zones: _z, finish: _f, ...keep } = livery;
      livery = { ...keep, colors: ['#808080'], pattern: 'solid', ...l.livery };
    }
    if (l.markColor) markColor = l.markColor;
    if (l.finish) finish = l.finish;
    if (l.marks) {
      marks = { ...marks, ...l.marks };
      for (const [k, m] of Object.entries(l.marks)) if (m?.color) ownColor.add(k as FrameMark);
    }
    if (l.rim) rimColor = l.rim;
    if (l.tireWall) {
      if (l.tireWall === 'rainbow') extras.rainbowWall = true;
      else livery.tireWall = l.tireWall;
    }
    if (l.number) extras.number = l.number;
    if (l.glow) extras.glow = l.glow;
    if (l.parts) {
      extras.parts = { ...(extras.parts ?? {}), ...l.parts };
      if (l.parts.bar_tape) livery.tape = l.parts.bar_tape;
      if (l.parts.saddle) livery.saddle = l.parts.saddle;
    }
    if (l.aerobars) extras.aerobars = l.aerobars;
    if (l.metal) extras.metal = [...new Set([...(extras.metal ?? []), ...l.metal])];
    if (l.carbon) extras.carbon = [...new Set([...(extras.carbon ?? []), ...l.carbon])];
  }
  if (finish) livery.finish = finish;
  if (markColor) {
    for (const [k, m] of Object.entries(marks) as Array<[FrameMark, { text: string; color?: string; stretch?: number }]>) if (!ownColor.has(k)) marks[k] = { ...m, color: markColor };
  }
  if (Object.keys(marks).length) livery.marks = marks;
  if (rimColor === 'holo') extras.holoRim = true;
  else if (rimColor) livery.rim = rimColor;
  // Décors de jante ou jantes lumineuses sur des roues sans marque : bande décor au nom du jeu.
  if ((rimColor || extras.glow) && !params.rimBrand) params.rimBrand = DEFAULT_RIM_TEXT;
  return { ...build, params, livery, extras };
}
