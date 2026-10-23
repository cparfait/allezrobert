/**
 * Dépôt SQL des amis : code ami de chaque compte et relations (demande en attente ou amitié).
 * Une seule ligne par paire de comptes, rangée (user_a < user_b) : voir migrations/002_friends.sql.
 * Les identifiants de relation servent de poignée côté client : aucun identifiant de compte
 * ne sort de ce module vers l'API.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { DEFAULT_LOOK, FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH, levelForXp } from '@allezrobert/shared';
import type { Db } from './db.ts';

export type FriendStatus = 'pending' | 'accepted';

/** Relation vue depuis un compte : l'autre personne, l'état, le sens de la demande. */
export interface FriendRelation {
  id: string;
  otherId: string;
  name: string;
  color: string;
  level: number;
  status: FriendStatus;
  /** Vrai si la demande vient de l'autre personne (demande reçue). */
  incoming: boolean;
  createdAt: Date;
  acceptedAt: Date | null;
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));

/** Paire rangée : la contrainte friendships_order_chk impose user_a < user_b. */
export function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function newFriendCode(): string {
  let code = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  return code;
}

export class FriendRepo {
  constructor(private readonly db: Db) {}

  /* ───────────── Code ami ───────────── */

  /** Code ami du compte, créé au premier appel. */
  async codeOf(userId: string): Promise<string> {
    const r = await this.db.query('SELECT code FROM friend_codes WHERE user_id = $1', [userId]);
    if (r.rows[0]) return r.rows[0].code as string;
    return this.writeCode(userId, false);
  }

  /** Nouveau code : l'ancien cesse aussitôt de fonctionner (les liens partagés aussi). */
  regenerateCode(userId: string): Promise<string> {
    return this.writeCode(userId, true);
  }

  private async writeCode(userId: string, replace: boolean): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newFriendCode();
      try {
        if (replace) {
          const u = await this.db.query('UPDATE friend_codes SET code = $2, created_at = now() WHERE user_id = $1', [userId, code]);
          if ((u.rowCount ?? 0) > 0) return code;
        }
        await this.db.query('INSERT INTO friend_codes (user_id, code) VALUES ($1, $2)', [userId, code]);
        return code;
      } catch (e) {
        // Collision de code (contrainte UNIQUE) ou course entre deux premières lectures.
        const existing = await this.db.query('SELECT code FROM friend_codes WHERE user_id = $1', [userId]);
        if (existing.rows[0] && !replace) return existing.rows[0].code as string;
        if (attempt === 7) throw e;
      }
    }
    throw new Error('Impossible de générer un code ami');
  }

  async userByCode(code: string): Promise<{ id: string; name: string } | null> {
    const r = await this.db.query('SELECT u.id, u.display_name FROM friend_codes c JOIN users u ON u.id = c.user_id WHERE c.code = $1', [code]);
    return r.rows[0] ? { id: r.rows[0].id as string, name: r.rows[0].display_name as string } : null;
  }

  /* ───────────── Relations ───────────── */

  /** Toutes les relations d'un compte (amis, demandes reçues et envoyées), par nom. */
  async relationsOf(userId: string): Promise<FriendRelation[]> {
    const r = await this.db.query(
      `SELECT f.id, f.status, f.requested_by, f.created_at, f.accepted_at, u.id AS other_id, u.display_name, p.avatar, g.xp
         FROM friendships f
         JOIN users u ON u.id = (CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END)
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN progression g ON g.user_id = u.id
        WHERE f.user_a = $1 OR f.user_b = $1
        ORDER BY u.display_name`,
      [userId],
    );
    return r.rows.map((row) => this.mapRelation(row, userId));
  }

  /** Relation désignée par son identifiant, seulement si le compte en fait partie. */
  async relation(id: string, userId: string): Promise<FriendRelation | null> {
    const r = await this.db.query(
      `SELECT f.id, f.status, f.requested_by, f.created_at, f.accepted_at, u.id AS other_id, u.display_name, p.avatar, g.xp
         FROM friendships f
         JOIN users u ON u.id = (CASE WHEN f.user_a = $2 THEN f.user_b ELSE f.user_a END)
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN progression g ON g.user_id = u.id
        WHERE f.id = $1 AND (f.user_a = $2 OR f.user_b = $2)`,
      [id, userId],
    );
    return r.rows[0] ? this.mapRelation(r.rows[0], userId) : null;
  }

  /** Relation entre deux comptes (quel que soit le sens), ou null. */
  async between(x: string, y: string): Promise<{ id: string; status: FriendStatus; requestedBy: string } | null> {
    const [a, b] = orderedPair(x, y);
    const r = await this.db.query('SELECT id, status, requested_by FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
    const row = r.rows[0];
    return row ? { id: row.id as string, status: row.status as FriendStatus, requestedBy: row.requested_by as string } : null;
  }

  async areFriends(x: string, y: string): Promise<boolean> {
    return (await this.between(x, y))?.status === 'accepted';
  }

  /** Comptes amis (demandes acceptées). */
  async friendIdsOf(userId: string): Promise<string[]> {
    const r = await this.db.query(
      `SELECT user_b AS other FROM friendships WHERE user_a = $1 AND status = 'accepted'
       UNION ALL
       SELECT user_a AS other FROM friendships WHERE user_b = $1 AND status = 'accepted'`,
      [userId],
    );
    return r.rows.map((row) => row.other as string);
  }

  async counts(userId: string): Promise<{ friends: number; outgoing: number; incoming: number }> {
    const rel = await this.db.query('SELECT status, requested_by FROM friendships WHERE user_a = $1 OR user_b = $1', [userId]);
    let friends = 0;
    let outgoing = 0;
    let incoming = 0;
    for (const row of rel.rows) {
      if (row.status === 'accepted') friends++;
      else if (row.requested_by === userId) outgoing++;
      else incoming++;
    }
    return { friends, outgoing, incoming };
  }

  /** Nouvelle demande de `from` vers `to` (l'appelant a vérifié qu'aucune relation n'existe). */
  async createRequest(from: string, to: string): Promise<string> {
    const [a, b] = orderedPair(from, to);
    const id = randomUUID();
    await this.db.query('INSERT INTO friendships (id, user_a, user_b, requested_by) VALUES ($1, $2, $3, $4)', [id, a, b, from]);
    return id;
  }

  /** Accepte une demande reçue ; faux si elle n'existe pas, n'est pas adressée à ce compte ou l'est déjà. */
  async accept(id: string, userId: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE friendships SET status = 'accepted', accepted_at = now()
        WHERE id = $1 AND status = 'pending' AND requested_by <> $2 AND (user_a = $2 OR user_b = $2)`,
      [id, userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Supprime une relation de ce compte, dans l'état attendu (refus, annulation ou retrait). */
  async remove(id: string, userId: string, status: FriendStatus): Promise<boolean> {
    const r = await this.db.query('DELETE FROM friendships WHERE id = $1 AND status = $3 AND (user_a = $2 OR user_b = $2)', [id, userId, status]);
    return (r.rowCount ?? 0) > 0;
  }

  private mapRelation(row: any, userId: string): FriendRelation {
    let avatar: { jersey?: unknown } = {};
    try {
      avatar = (typeof row.avatar === 'string' ? JSON.parse(row.avatar) : row.avatar) ?? {};
    } catch {
      avatar = {};
    }
    return {
      id: row.id,
      otherId: row.other_id,
      name: row.display_name,
      color: typeof avatar.jersey === 'string' ? avatar.jersey : DEFAULT_LOOK.jersey,
      level: levelForXp(Number(row.xp ?? 0)),
      status: row.status === 'accepted' ? 'accepted' : 'pending',
      incoming: row.requested_by !== userId,
      createdAt: toDate(row.created_at),
      acceptedAt: row.accepted_at ? toDate(row.accepted_at) : null,
    };
  }
}
