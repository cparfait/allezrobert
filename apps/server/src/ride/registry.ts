/**
 * Registre en mémoire des sorties ouvertes (un seul processus serveur) : code d'invitation
 * → salle, participants (pour le jeton de voix, l'appli compagnon et le refus des FIT
 * d'invités). Les sorties ne survivent pas à un redémarrage du serveur (choix assumé :
 * les coureurs se reconnectent à une nouvelle sortie).
 */
import { randomInt } from 'node:crypto';
import type { RideRole } from '@allezrobert/shared';

/** Alphabet sans caractères ambigus (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface RideEntry {
  roomId: string;
  inviteCode: string;
  routeId: string;
  mode: string;
  name: string;
  allowGuests: boolean;
  hostUserId: string | undefined;
  createdAt: number;
  /** userId → rôle tenu dans la sortie (le plus « fort » si plusieurs connexions). */
  participants: Map<string, RideRole>;
  /** Comptes ayant roulé en invité (conservé après leur départ : FIT/XP refusés). */
  guests: Set<string>;
}

export class RideRegistry {
  private readonly byCode = new Map<string, RideEntry>();
  private readonly byRoom = new Map<string, RideEntry>();
  /** userId → roomId de la sortie en cours (dernière rejointe en tant que coureur/invité). */
  private readonly currentRide = new Map<string, string>();

  newInviteCode(length = 6): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (!this.byCode.has(code)) return code;
    }
    throw new Error("Impossible de générer un code d'invitation");
  }

  register(e: Omit<RideEntry, 'participants' | 'createdAt' | 'guests'>): RideEntry {
    const entry: RideEntry = { ...e, createdAt: Date.now(), participants: new Map(), guests: new Set() };
    this.byCode.set(e.inviteCode, entry);
    this.byRoom.set(e.roomId, entry);
    return entry;
  }

  unregister(roomId: string): void {
    const e = this.byRoom.get(roomId);
    if (!e) return;
    this.byRoom.delete(roomId);
    this.byCode.delete(e.inviteCode);
    for (const [user, room] of this.currentRide) if (room === roomId) this.currentRide.delete(user);
  }

  byInviteCode(code: string): RideEntry | undefined {
    return this.byCode.get(normalizeCode(code));
  }

  byRoomId(roomId: string): RideEntry | undefined {
    return this.byRoom.get(roomId);
  }

  join(roomId: string, userId: string, role: RideRole): void {
    const e = this.byRoom.get(roomId);
    if (!e) return;
    const prev = e.participants.get(userId);
    if (role !== 'companion' || !prev) e.participants.set(userId, role === 'companion' ? 'companion' : role);
    if (role !== 'companion') this.currentRide.set(userId, roomId);
    if (role === 'guest') e.guests.add(userId);
  }

  leave(roomId: string, userId: string, role: RideRole): void {
    const e = this.byRoom.get(roomId);
    if (!e) return;
    if (role !== 'companion' && this.currentRide.get(userId) === roomId) this.currentRide.delete(userId);
    if (e.participants.get(userId) === role) e.participants.delete(userId);
  }

  currentRideOf(userId: string): RideEntry | undefined {
    const roomId = this.currentRide.get(userId);
    return roomId ? this.byRoom.get(roomId) : undefined;
  }

  roleOf(roomId: string, userId: string): RideRole | undefined {
    return this.byRoom.get(roomId)?.participants.get(userId);
  }

  get size(): number {
    return this.byRoom.size;
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
