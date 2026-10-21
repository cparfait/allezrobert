/**
 * Services dont la salle « ride » a besoin (authentification, profils, records de segments),
 * injectés au démarrage : la salle reste testable avec des services en mémoire.
 */
import type { AvatarLook } from '@allezrobert/shared';
import type { RideRegistry } from './registry.ts';
import type { RouteStore } from './routes.ts';

export interface AuthedUser {
  userId: string;
  name: string;
}

export interface RiderProfileInfo {
  displayName: string;
  weightKg: number;
  ftpWatts: number;
  avatar: AvatarLook;
  consentHr: boolean;
}

export interface RideServices {
  registry: RideRegistry;
  routes: RouteStore;
  guestMaxWkg: number;
  reconnectGraceS: number;
  allowAnonymousGuests: boolean;
  /** Jeton de jeu (options de connexion) ou cookie de session (même origine). */
  authenticate(token: string | undefined, cookieHeader: string | undefined): Promise<AuthedUser | null>;
  loadProfile(userId: string): Promise<RiderProfileInfo | null>;
  personalBests(userId: string, routeId: string): Promise<Array<[string, number]>>;
  recordEffort(e: { userId: string; routeId: string; segmentId: string; elapsedMs: number; rideId: string }): Promise<void>;
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
