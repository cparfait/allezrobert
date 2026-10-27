/**
 * Services dont la salle « ride » a besoin (authentification, profils, records de segments),
 * injectés au démarrage : la salle reste testable avec des services en mémoire.
 */
import type { AvatarLook, TuneEvent } from '@allezrobert/shared';
import type { RideRegistry } from './registry.ts';
import type { RouteStore } from './routes.ts';

export interface AuthedUser {
  userId: string;
  name: string;
}

export interface RiderProfileInfo {
  displayName: string;
  weightKg: number;
  /** Taille (cm) : coureur et taille de cadre affichés aux autres. */
  heightCm?: number;
  ftpWatts: number;
  avatar: AvatarLook;
  consentHr: boolean;
  /** Équipement du profil (cosmétiques et pièces de l'atelier), revalidé par la salle. */
  equipped?: Record<string, string>;
  /** Pièces de l'atelier possédées et niveau du compte (validation de l'équipement). */
  owned?: string[];
  level?: number;
}

export interface RideServices {
  registry: RideRegistry;
  routes: RouteStore;
  guestMaxWkg: number;
  reconnectGraceS: number;
  allowAnonymousGuests: boolean;
  /** Itinéraires ouverts au public (salles `public`). */
  publicRoutes: readonly string[];
  /** Jeton de jeu (options de connexion) ou cookie de session (même origine). */
  authenticate(token: string | undefined, cookieHeader: string | undefined): Promise<AuthedUser | null>;
  loadProfile(userId: string): Promise<RiderProfileInfo | null>;
  personalBests(userId: string, routeId: string): Promise<Array<[string, number]>>;
  recordEffort(e: { userId: string; routeId: string; segmentId: string; elapsedMs: number; rideId: string }): Promise<void>;
  /** Récompenses de l'atelier gagnées en salle (podium, victoire). */
  rewardEvents?(userId: string, events: TuneEvent[]): Promise<unknown>;
  /** Montée chronométrée bouclée en salle (cumul, récompenses « kom » et « kom-5 »). */
  rewardKom?(userId: string): Promise<unknown>;
  /** Comptes amis (amitiés acceptées) : annonces d'arrivée / de départ et repères des amis en salle. */
  friendsOf?(userId: string): Promise<string[]>;
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void;
}

let current: RideServices | null = null;

export function setRideServices(s: RideServices): void {
  current = s;
}

export function rideServices(): RideServices {
  if (!current) throw new Error('Services de salle non initialisés (setRideServices)');
  return current;
}
