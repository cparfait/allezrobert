/**
 * Atelier côté serveur : crédits et récompenses d'une sortie, achats, vélo réellement roulé en
 * salle. Toutes les règles viennent de packages/shared (tuning.ts) et packages/physics
 * (tuning.ts) ; le serveur ne fait jamais confiance aux valeurs physiques envoyées par le client :
 * il part des identifiants de pièces équipées, vérifie qu'elles sont possédées, puis recalcule.
 */
import { EQUALIZED_BIKE, tunedBikeSetup } from '@allezrobert/physics';
import {
  LEGACY_WHEELS,
  TUNE_EVENTS,
  bikeSetupFor,
  creditsForRide,
  dayKey,
  equippedTuneIds,
  eventRewards,
  nextStreak,
  purchase,
  rideEvents,
  type BikeSetup,
  type PurchaseResult,
  type TuneEvent,
} from '@allezrobert/shared';
import type { AtelierState, Repos } from '../db/repos.ts';
import { sanitizeEquipped } from './xp.ts';

/** Ajoute des événements et les pièces qu'ils débloquent ; renvoie les pièces nouvellement gagnées. */
export function grantEvents(a: AtelierState, events: readonly TuneEvent[]): string[] {
  const fresh = events.filter((e) => !a.events.includes(e));
  if (!fresh.length) return [];
  a.events = [...a.events, ...fresh];
  const won = eventRewards(fresh)
    .map((t) => t.id)
    .filter((id) => !a.owned.includes(id));
  a.owned = [...a.owned, ...won];
  return won;
}

export interface RideReward {
  credits: number;
  /** Solde après la sortie. */
  balance: number;
  streakDays: number;
  events: TuneEvent[];
  /** Pièces gagnées (récompenses d'événements). */
  items: string[];
}

/**
 * Récompense d'une sortie téléversée (FIT vérifié par le serveur) : crédits (distance, D+,
 * segments bouclés en salle, série), parcours bouclé (distance ≥ 98 % de l'itinéraire connu),
 * série de jours, 100 km.
 */
export async function rewardRide(
  repos: Repos,
  userId: string,
  r: { distanceM: number; elevationM: number; startedAt: number; routeId?: string; routeLengthM?: number; segments: number },
): Promise<RideReward> {
  const a = await repos.getAtelier(userId);
  const st = nextStreak(a.streak.last ? a.streak : undefined, dayKey(new Date(r.startedAt)));
  a.streak = { last: st.last, days: st.days };
  const credits = creditsForRide({ distanceM: r.distanceM, elevationM: r.elevationM, segments: r.segments, streakDays: st.days, firstOfDay: st.firstOfDay });
  a.credits += credits;
  const finished = !!(r.routeId && r.routeLengthM && r.distanceM >= r.routeLengthM * 0.98);
  if (finished && r.routeId && !a.routesDone.includes(r.routeId)) a.routesDone = [...a.routesDone, r.routeId];
  const events = rideEvents({ distanceM: r.distanceM, routeFinished: finished, routesFinished: a.routesDone.length, koms: a.koms, streakDays: st.days });
  const items = grantEvents(a, events);
  await repos.saveAtelier(repos.db, userId, a);
  return { credits, balance: a.credits, streakDays: st.days, events: events.filter((e) => TUNE_EVENTS.includes(e)), items };
}

/** Récompenses de course (classement autoritaire de la salle) ou de montée chronométrée. */
export async function rewardEvents(repos: Repos, userId: string, events: readonly TuneEvent[]): Promise<string[]> {
  const a = await repos.getAtelier(userId);
  const items = grantEvents(a, events);
  if (items.length || events.some((e) => !a.events.includes(e))) await repos.saveAtelier(repos.db, userId, a);
  return items;
}

/** Achat validé par le serveur (niveau, crédits, pièce achetable), débit atomique. */
export async function buy(repos: Repos, userId: string, id: string, level: number): Promise<PurchaseResult & { balance: number; owned: string[] }> {
  const a = await repos.getAtelier(userId);
  const res = purchase(id, { level, credits: a.credits, owned: a.owned });
  if (!res.ok) return { ...res, balance: a.credits, owned: a.owned };
  const done = await repos.spendCredits(userId, res.price, res.granted);
  const after = await repos.getAtelier(userId);
  if (!done) return { ok: false, error: 'credits', missing: Math.max(0, res.price - after.credits), price: res.price, granted: [], balance: after.credits, owned: after.owned };
  return { ...res, balance: after.credits, owned: after.owned };
}

/**
 * Anciennes roues du garage (emplacement « wheels ») : la paire équivalente de l'atelier est
 * offerte et équipée. Renvoie l'équipement migré (inchangé s'il n'y avait rien à migrer).
 */
export function migrateLegacyWheels(equipped: Record<string, string>, a: AtelierState): Record<string, string> | null {
  const old = equipped.wheels;
  if (!old || !(old in LEGACY_WHEELS)) return null;
  const { wheels: _, ...rest } = equipped;
  const id = LEGACY_WHEELS[old];
  if (id) {
    if (!a.owned.includes(id)) a.owned = [...a.owned, id];
    rest.wheelset ??= id;
  }
  return rest;
}

/**
 * Vélo d'un coureur en salle : équipement du profil nettoyé (objets possédés et débloqués
 * seulement), cosmétiques à effet puis pièces de l'atelier (plafonnées). « Équipement égalisé » :
 * le même vélo pour tous. Renvoie aussi les pièces à afficher (avatar.tune autoritaire).
 */
export function serverBike(equipped: Record<string, string>, level: number, owned: readonly string[], equalized: boolean): { bike: BikeSetup; tune: string[] } {
  const clean = sanitizeEquipped(equipped, level, owned);
  const tune = equippedTuneIds(clean);
  if (equalized) return { bike: { ...EQUALIZED_BIKE }, tune };
  return { bike: tunedBikeSetup(bikeSetupFor(clean), tune).bike, tune };
}
