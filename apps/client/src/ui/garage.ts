import {
  ALL_TUNE_SLOTS,
  COSMETICS,
  LEGACY_WHEELS,
  bikeById,
  bikeSetupFor,
  creditsForRide,
  dayKey,
  equippedTuneIds,
  eventRewards,
  isTuneSlot,
  levelProgress,
  migrateCosmeticId,
  nextStreak,
  jerseyLookOf,
  helmetLookOf,
  glassesLookOf,
  purchase,
  rideEvents,
  tuneItem,
  xpForRide,
  type BikeSetup,
  type CosmeticItem,
  type CosmeticSlot,
  type PurchaseResult,
  type TuneEvent,
  type TuneItem,
  type TuneSlot,
} from '@allezrobert/shared';
import { tunedBikeSetup } from '@allezrobert/physics';
import { saveSettings, type Settings } from './settings.ts';

/**
 * Progression locale (synchronisée avec le serveur une fois connecté) : XP, équipement (cosmétiques
 * et pièces de l'atelier, une par emplacement), crédits, pièces possédées, événements débloqués,
 * série de jours de sortie, parcours bouclés, montées chronométrées.
 * Connecté : crédits, pièces et événements du compte font foi (le serveur valide les achats).
 */
interface Progress {
  xp: number;
  equipped: Partial<Record<CosmeticSlot | TuneSlot, string>>;
  credits: number;
  owned: string[];
  events: TuneEvent[];
  streak: { last: string; days: number };
  routesDone: string[];
  koms: number;
}

const KEY = 'ar.progress';

const fresh = (): Progress => ({ xp: 0, equipped: {}, credits: 0, owned: [], events: [], streak: { last: '', days: 0 }, routesDone: [], koms: 0 });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p: Progress = { ...fresh(), ...(JSON.parse(raw) as Partial<Progress>) };
      // Anciens vélos du garage (bike-alu…) → modèles du catalogue.
      for (const [slot, id] of Object.entries(p.equipped)) if (id) p.equipped[slot as CosmeticSlot] = migrateCosmeticId(slot, id);
      // Anciennes roues du garage → paire équivalente de l'atelier, offerte et montée.
      const eq = p.equipped as Record<string, string | undefined>;
      const old = eq.wheels;
      if (old !== undefined) {
        delete eq.wheels;
        const id = LEGACY_WHEELS[old];
        if (id) {
          if (!p.owned.includes(id)) p.owned.push(id);
          p.equipped.wheelset ??= id;
        }
        saveProgress(p);
      }
      return p;
    }
  } catch {
    // Progression illisible : on repart de zéro plutôt que de bloquer le jeu.
  }
  return fresh();
}

function saveProgress(p: Progress): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** Ce que la sortie apporte en plus de l'XP (crédits, récompenses de l'atelier). */
export interface RideExtras {
  /** Segments bouclés (KOM, sprints, sections). */
  segments?: number;
  /** Montées chronométrées bouclées pendant la sortie. */
  koms?: number;
  routeId?: string;
  routeFinished?: boolean;
  /** Rang d'arrivée d'une course (0 : non classé). */
  raceRank?: number;
}

/**
 * Crédite l'XP et les crédits d'une sortie ; renvoie le gain, le niveau, les nouveaux déblocages et
 * les pièces gagnées. `already` : partie déjà créditée (sortie reprise puis terminée à nouveau),
 * seul le surplus compte (et la série de jours n'est comptée qu'une fois).
 */
export function awardRide(
  ride: { distanceM: number; elevationM: number; movingS: number },
  already?: { distanceM: number; elevationM: number; movingS: number },
  extra: RideExtras = {},
): { gained: number; total: number; level: number; progress: number; levelUp: boolean; unlocked: CosmeticItem[]; credits: number; streakDays: number; won: TuneItem[] } {
  const p = loadProgress();
  const before = levelProgress(p.xp).level;
  const total = xpForRide(ride);
  const gained = Math.max(0, total - (already ? xpForRide(already) : 0));
  p.xp += gained;
  // Série de jours : comptée à la première fin de sortie seulement.
  const st = already ? { ...p.streak, firstOfDay: false } : nextStreak(p.streak.last ? p.streak : undefined, dayKey());
  p.streak = { last: st.last, days: st.days };
  const base = { distanceM: ride.distanceM, elevationM: ride.elevationM, segments: extra.segments ?? 0, streakDays: st.days, firstOfDay: st.firstOfDay };
  const credits = Math.max(0, creditsForRide(base) - (already ? creditsForRide({ distanceM: already.distanceM, elevationM: already.elevationM, segments: extra.segments ?? 0 }) : 0));
  p.credits += credits;
  if (!already && extra.koms) p.koms += extra.koms;
  if (extra.routeFinished && extra.routeId && !p.routesDone.includes(extra.routeId)) p.routesDone.push(extra.routeId);
  const events = rideEvents({ distanceM: ride.distanceM, routeFinished: !!extra.routeFinished, routesFinished: p.routesDone.length, koms: p.koms, ...(extra.raceRank ? { raceRank: extra.raceRank } : {}), streakDays: st.days });
  const won = grantEvents(p, events);
  saveProgress(p);
  const lp = levelProgress(p.xp);
  const after = lp.level;
  return { gained, total, level: after, progress: lp.progress, levelUp: after > before, unlocked: COSMETICS.filter((c) => c.level > before && c.level <= after), credits, streakDays: st.days, won };
}

/** Événements débloqués (une seule fois) et pièces qu'ils rapportent. */
function grantEvents(p: Progress, events: readonly TuneEvent[]): TuneItem[] {
  const fresh = events.filter((e) => !p.events.includes(e));
  if (!fresh.length) return [];
  p.events.push(...fresh);
  const won = eventRewards(fresh).filter((t) => !p.owned.includes(t.id));
  p.owned.push(...won.map((t) => t.id));
  return won;
}

/** Ajoute de l'XP (trophées) ; renvoie niveau et progression après coup. */
export function addXp(xp: number): { level: number; progress: number } {
  const p = loadProgress();
  p.xp += Math.max(0, Math.round(xp));
  saveProgress(p);
  const lp = levelProgress(p.xp);
  return { level: lp.level, progress: lp.progress };
}

export const SLOT_LABEL: Record<CosmeticSlot, { fr: string; en: string }> = {
  jersey: { fr: 'Maillot', en: 'Jersey' },
  helmet: { fr: 'Casque', en: 'Helmet' },
  bike: { fr: 'Vélo', en: 'Bike' },
  socks: { fr: 'Chaussettes', en: 'Socks' },
  glasses: { fr: 'Lunettes', en: 'Glasses' },
};

/** Équipe un cosmétique débloqué ; les cosmétiques à couleur et les vélos s'appliquent à l'avatar. */
export function equipItem(item: CosmeticItem, s: Settings): void {
  const p = loadProgress();
  p.equipped[item.slot] = item.id;
  saveProgress(p);
  if (item.slot === 'helmet') s.look = helmetLookOf(item, s.look);
  if (item.slot === 'glasses') s.look = glassesLookOf(item, s.look);
  if (item.color) {
    if (item.slot === 'jersey') s.look = { ...s.look, ...jerseyLookOf(item) };
    if (item.slot === 'bike') s.look = { ...s.look, bike: item.color };
    if (item.slot === 'socks') s.look = { ...s.look, socks: item.color };
  }
  // Vélo équipé : modèle du catalogue (cadre, livrée) ou VTT / gravel ; le modèle affiché suit les pneus.
  if (item.slot === 'bike') {
    const { bikeModel: _old, ...rest } = s.look;
    s.look = { ...rest, bikeType: item.physics?.tyre ?? 'road', ...(bikeById(item.id) ? { bikeModel: item.id } : {}) };
    // Nouveau vélo : il se montre avec sa propre livrée ; la peinture de l'atelier est démontée (toujours
    // possédée, elle se remonte à l'atelier).
    if (p.equipped.paint) {
      delete p.equipped.paint;
      saveProgress(p);
      syncLook(p, s);
      return;
    }
  }
  saveSettings(s);
}

/** Vélo sans marque, peint de la couleur choisie (ou de sa couleur actuelle) : plus de modèle du catalogue. */
export function equipPlainBike(s: Settings, color?: string): void {
  const p = loadProgress();
  delete p.equipped.bike;
  saveProgress(p);
  const { bikeModel: _, ...look } = s.look;
  s.look = { ...look, bike: color ?? look.bike };
  saveSettings(s);
}

// ————————————————————————————————————————————— Atelier

/** Pièces de l'atelier montées (dans l'ordre des emplacements). */
export function equippedTune(p: Progress = loadProgress()): string[] {
  return equippedTuneIds(p.equipped);
}

/** Vélo réellement roulé : cosmétiques à effet puis pièces de l'atelier (gain plafonné). */
export function tunedBike(p: Progress = loadProgress()): BikeSetup {
  return tunedBikeSetup(bikeSetupFor(p.equipped), equippedTune(p)).bike;
}

/** Pièces affichées sur le vélo de l'avatar = pièces montées. */
function syncLook(p: Progress, s: Settings): void {
  const tune = equippedTune(p);
  const { tune: _old, ...rest } = s.look;
  s.look = tune.length ? { ...rest, tune } : rest;
  saveSettings(s);
}

/** Monte une pièce possédée ; renvoie false si elle ne l'est pas. */
export function equipTune(item: TuneItem, s: Settings): boolean {
  const p = loadProgress();
  if (!item.slot || !p.owned.includes(item.id)) return false;
  p.equipped[item.slot] = item.id;
  saveProgress(p);
  syncLook(p, s);
  return true;
}

export function unequipTune(slot: TuneSlot, s: Settings): void {
  const p = loadProgress();
  delete p.equipped[slot];
  saveProgress(p);
  syncLook(p, s);
}

/** Monte toutes les pièces possédées d'un ensemble ; renvoie le nombre de pièces montées. */
export function equipKit(kit: TuneItem, s: Settings): number {
  const p = loadProgress();
  let n = 0;
  for (const id of kit.pieces ?? []) {
    const it = tuneItem(id);
    if (!it?.slot || !p.owned.includes(id)) continue;
    p.equipped[it.slot] = id;
    n++;
  }
  saveProgress(p);
  syncLook(p, s);
  return n;
}

/** Démonte toutes les pièces de l'atelier (vélo d'origine). */
export function resetTune(s: Settings): void {
  const p = loadProgress();
  for (const slot of ALL_TUNE_SLOTS) delete p.equipped[slot];
  saveProgress(p);
  syncLook(p, s);
}

/** Achat hors ligne (sans compte) : mêmes règles que le serveur, sur la progression locale. */
export function buyLocal(id: string): PurchaseResult {
  const p = loadProgress();
  const r = purchase(id, { level: levelProgress(p.xp).level, credits: p.credits, owned: p.owned });
  if (r.ok) {
    p.credits -= r.price;
    p.owned.push(...r.granted.filter((g) => !p.owned.includes(g)));
    saveProgress(p);
  }
  return r;
}

/**
 * Atelier du compte (connecté) : crédits, pièces et événements du serveur remplacent les valeurs
 * locales ; les pièces montées qui ne sont pas au compte sont démontées.
 */
export function applyServerAtelier(a: { credits: number; owned: string[]; events: string[]; streak?: { last: string; days: number } }, s: Settings): void {
  const p = loadProgress();
  p.credits = a.credits;
  p.owned = [...a.owned];
  p.events = a.events.filter((e): e is TuneEvent => typeof e === 'string') as TuneEvent[];
  if (a.streak) p.streak = { ...a.streak };
  for (const [slot, id] of Object.entries(p.equipped)) if (isTuneSlot(slot) && id && !p.owned.includes(id)) delete p.equipped[slot];
  saveProgress(p);
  syncLook(p, s);
}

/** Achat validé par le serveur : solde et pièces du compte recopiés. */
export function applyServerPurchase(credits: number, owned: readonly string[]): void {
  const p = loadProgress();
  p.credits = credits;
  p.owned = [...owned];
  saveProgress(p);
}

/** Équipement envoyé au compte : pièces de l'atelier et cosmétiques débloqués au niveau du compte. */
export function equippedForServer(level: number): Record<string, string> {
  const p = loadProgress();
  const out: Record<string, string> = {};
  for (const [slot, id] of Object.entries(p.equipped)) {
    if (!id) continue;
    if (isTuneSlot(slot)) {
      if (p.owned.includes(id)) out[slot] = id;
    } else if ((COSMETICS.find((c) => c.id === id)?.level ?? Infinity) <= level) out[slot] = id;
  }
  return out;
}
