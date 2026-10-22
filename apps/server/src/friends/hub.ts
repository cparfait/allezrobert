/**
 * Présence des amis et invitations à rouler, en mémoire (un seul processus, comme le registre
 * des sorties).
 *
 * Présence : le menu du jeu interroge GET /api/friends toutes les 25 s tant qu'il est ouvert
 * (FRIENDS_POLL_S) ; chaque appel note « vu à l'instant ». Un ami est en ligne s'il a été vu
 * depuis moins de 70 s, en train de rouler si le registre des sorties lui connaît une sortie en
 * cours. Choix assumé plutôt qu'un canal temps réel : il n'existe pas de salle Colyseus
 * « accueil » (une salle = une sortie), et une interrogation légère ne demande ni connexion
 * permanente, ni reconnexion, ni état à resynchroniser ; quelques dizaines de secondes de
 * retard sur un statut d'ami sont sans conséquence. Une seule requête rapporte aussi les
 * demandes et invitations reçues (pastille de l'onglet).
 *
 * Invitations : valables 30 min au plus et seulement tant que la sortie existe ; elles ne
 * survivent pas à un redémarrage du serveur, pas plus que les sorties elles-mêmes.
 */
import { randomUUID } from 'node:crypto';
import { FRIEND_INVITE_TTL_S, FRIEND_ONLINE_WINDOW_S, type FriendPresence, type FriendRideInfo, type RideMode } from '@allezrobert/shared';
import type { RideEntry, RideRegistry } from '../ride/registry.ts';
import type { FriendRepo } from '../db/friends.ts';

export interface RideInvite {
  id: string;
  fromUserId: string;
  fromName: string;
  fromColor: string;
  toUserId: string;
  roomId: string;
  createdAt: number;
  expiresAt: number;
}

export class FriendHub {
  private readonly lastSeen = new Map<string, number>();
  private readonly invites = new Map<string, RideInvite>();

  constructor(
    readonly repo: FriendRepo,
    private readonly registry: RideRegistry,
  ) {}

  /** Le compte vient d'interroger la liste d'amis : il est en ligne. */
  touch(userId: string, now = Date.now()): void {
    this.lastSeen.set(userId, now);
    if (this.lastSeen.size > 50_000) {
      for (const [id, t] of this.lastSeen) if (now - t > FRIEND_ONLINE_WINDOW_S * 1000) this.lastSeen.delete(id);
    }
  }

  presenceOf(userId: string, now = Date.now()): FriendPresence {
    const ride = this.registry.currentRideOf(userId);
    if (ride) return { state: 'riding', ride: rideInfo(ride) };
    const seen = this.lastSeen.get(userId);
    return seen !== undefined && now - seen < FRIEND_ONLINE_WINDOW_S * 1000 ? { state: 'online' } : { state: 'offline' };
  }

  /** Sortie en cours du compte (pour « rejoindre » un ami). */
  currentRide(userId: string): RideEntry | undefined {
    return this.registry.currentRideOf(userId);
  }

  rideOf(roomId: string): RideEntry | undefined {
    return this.registry.byRoomId(roomId);
  }

  /**
   * Invite des amis dans une sortie : une invitation par destinataire et par sortie (une
   * nouvelle invitation remplace la précédente et repart pour 30 min).
   */
  invite(from: { userId: string; name: string; color: string }, toUserIds: string[], roomId: string, now = Date.now()): RideInvite[] {
    const out: RideInvite[] = [];
    for (const to of new Set(toUserIds)) {
      if (to === from.userId) continue;
      for (const [id, inv] of this.invites) if (inv.fromUserId === from.userId && inv.toUserId === to && inv.roomId === roomId) this.invites.delete(id);
      const inv: RideInvite = { id: randomUUID(), fromUserId: from.userId, fromName: from.name, fromColor: from.color, toUserId: to, roomId, createdAt: now, expiresAt: now + FRIEND_INVITE_TTL_S * 1000 };
      this.invites.set(inv.id, inv);
      out.push(inv);
    }
    return out;
  }

  /** Invitations encore valables reçues par le compte (les périmées sont purgées au passage). */
  invitesFor(userId: string, now = Date.now()): Array<RideInvite & { ride: FriendRideInfo }> {
    this.purge(now);
    const out: Array<RideInvite & { ride: FriendRideInfo }> = [];
    for (const inv of this.invites.values()) {
      if (inv.toUserId !== userId) continue;
      const ride = this.registry.byRoomId(inv.roomId);
      // Déjà dans cette sortie : l'invitation n'a plus d'objet.
      if (!ride || (ride.participants.get(userId) ?? 'companion') !== 'companion') continue;
      out.push({ ...inv, ride: rideInfo(ride) });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Retire et renvoie une invitation adressée à ce compte (rejoindre ou ignorer). */
  take(id: string, userId: string, now = Date.now()): RideInvite | null {
    this.purge(now);
    const inv = this.invites.get(id);
    if (!inv || inv.toUserId !== userId) return null;
    this.invites.delete(id);
    return this.registry.byRoomId(inv.roomId) ? inv : null;
  }

  /** Amitié retirée : les invitations entre les deux comptes tombent. */
  forgetPair(x: string, y: string): void {
    for (const [id, inv] of this.invites) {
      if ((inv.fromUserId === x && inv.toUserId === y) || (inv.fromUserId === y && inv.toUserId === x)) this.invites.delete(id);
    }
  }

  /** Compte supprimé : plus de présence ni d'invitation le concernant. */
  forgetUser(userId: string): void {
    this.lastSeen.delete(userId);
    for (const [id, inv] of this.invites) if (inv.fromUserId === userId || inv.toUserId === userId) this.invites.delete(id);
  }

  /** Invitations reçues et envoyées encore valables (export RGPD). */
  exportFor(userId: string, now = Date.now()): Array<{ direction: 'sent' | 'received'; roomId: string; createdAt: string; expiresAt: string }> {
    this.purge(now);
    return [...this.invites.values()]
      .filter((i) => i.fromUserId === userId || i.toUserId === userId)
      .map((i) => ({ direction: i.fromUserId === userId ? 'sent' : 'received', roomId: i.roomId, createdAt: new Date(i.createdAt).toISOString(), expiresAt: new Date(i.expiresAt).toISOString() }));
  }

  private purge(now: number): void {
    for (const [id, inv] of this.invites) if (inv.expiresAt <= now || !this.registry.byRoomId(inv.roomId)) this.invites.delete(id);
  }
}

/** Ce qu'un ami voit d'une sortie : itinéraire, nom, mode, coureurs humains (jamais le code). */
export function rideInfo(e: RideEntry): FriendRideInfo {
  let riders = 0;
  for (const role of e.participants.values()) if (role !== 'companion') riders++;
  return { routeId: e.routeId, name: e.name, mode: e.mode as RideMode, riders };
}
