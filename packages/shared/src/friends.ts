/**
 * Amis : contrat de l'API /api/friends partagé client / serveur, et code ami.
 *
 * Code ami : 8 caractères tirés d'un alphabet sans caractères ambigus (0/O, 1/I/L), affiché
 * en deux groupes (« K7QM-2XRA »). Saisie tolérante : minuscules, espaces et tirets ignorés.
 * Aucun identifiant interne de compte n'est exposé : les actions passent par l'identifiant
 * de la relation (demande ou amitié) ou de l'invitation.
 */
import type { RideMode } from './net.ts';

export const FRIEND_CODE_LENGTH = 8;
/** Même alphabet que les codes d'invitation des sorties. */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Paramètre d'URL du lien d'ajout (`/?ami=K7QM2XRA`). */
export const FRIEND_LINK_PARAM = 'ami';
/** Intervalle d'interrogation conseillé de GET /api/friends pendant que le menu est ouvert. */
export const FRIENDS_POLL_S = 25;
/** Un ami est « en ligne » s'il a interrogé la liste depuis moins de ce délai. */
export const FRIEND_ONLINE_WINDOW_S = 70;
/** Durée de vie d'une invitation à rouler (elle tombe aussi à la fin de la sortie). */
export const FRIEND_INVITE_TTL_S = 30 * 60;
/** Nombre maximal d'amis invités en une fois. */
export const FRIEND_INVITE_MAX = 10;

/** « k7qm-2xra » → « K7QM2XRA » (rien n'est validé ici, voir isFriendCode). */
export function normalizeFriendCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isFriendCode(code: string): boolean {
  return code.length === FRIEND_CODE_LENGTH && [...code].every((c) => FRIEND_CODE_ALPHABET.includes(c));
}

/** « K7QM2XRA » → « K7QM-2XRA » (lecture et dictée plus faciles). */
export function formatFriendCode(code: string): string {
  const c = normalizeFriendCode(code);
  return c.length === FRIEND_CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Sortie en cours d'un ami (seulement visible de ses amis). */
export interface FriendRideInfo {
  routeId: string;
  /** Nom de la sortie (par défaut le nom de l'itinéraire). */
  name: string;
  mode: RideMode;
  /** Coureurs humains connectés (les compagnons ne comptent pas). */
  riders: number;
}

export type FriendPresence = { state: 'offline' } | { state: 'online' } | { state: 'riding'; ride: FriendRideInfo };

export interface FriendEntry {
  /** Identifiant de la relation d'amitié (pas celui du compte). */
  id: string;
  name: string;
  /** Couleur du maillot (pastille). */
  color: string;
  level: number;
  /** Amis depuis (ISO 8601). */
  since: string;
  presence: FriendPresence;
}

export interface FriendRequestEntry {
  /** Identifiant de la demande. */
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface FriendInviteEntry {
  id: string;
  /** Nom de l'ami qui invite. */
  from: string;
  fromColor: string;
  ride: FriendRideInfo;
  /** Fin de validité (ISO 8601). */
  expiresAt: string;
}

/** Réponse de GET /api/friends : tout ce qu'affiche l'onglet Amis, en une requête. */
export interface FriendsOverview {
  code: string;
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  invites: FriendInviteEntry[];
  /** Intervalle d'interrogation conseillé (s). */
  pollS: number;
}

/** Réponse des routes « rejoindre » : de quoi se connecter à la salle. */
export interface FriendJoinInfo {
  roomId: string;
  inviteCode: string;
  routeId: string;
  mode: RideMode;
}

/** Réponse de POST /api/friends/requests. */
export interface FriendRequestResult {
  /** `accepted` : l'autre avait déjà demandé, l'amitié est faite. */
  status: 'pending' | 'accepted';
  id: string;
  name: string;
}
