/**
 * API des amis (montée sous /api/friends, compte requis : pas d'amis pour les invités sans
 * compte). Code ami, demandes, liste avec présence, « rejoindre » un ami, invitations à rouler,
 * records des amis.
 *
 * Confidentialité : aucun identifiant de compte n'est exposé (les actions passent par
 * l'identifiant de la relation ou de l'invitation) ; présence, sortie en cours et code de
 * sortie ne sont donnés qu'aux amis ; une relation inconnue et celle d'un autre compte
 * reçoivent la même réponse 404.
 */
import express from 'express';
import { z } from 'zod';
import {
  FRIEND_INVITE_MAX,
  FRIENDS_POLL_S,
  isFriendCode,
  normalizeFriendCode,
  type FriendJoinInfo,
  type FriendRequestResult,
  type FriendsOverview,
  type RideMode,
} from '@allezrobert/shared';
import type { AppContext } from '../context.ts';
import type { RideEntry } from '../ride/registry.ts';
import { HttpError, RateLimiter, requireUser, type AuthedRequest } from './middleware.ts';

/** Amis au plus par compte, demandes envoyées en attente, demandes reçues en attente. */
export const FRIEND_LIMITS = { friends: 200, outgoing: 50, incoming: 100 } as const;

const IdSchema = z.string().uuid();
const RequestSchema = z.object({ code: z.string().min(1).max(32) }).strict();
const InviteSchema = z.object({ roomId: z.string().min(1).max(64), friends: z.array(IdSchema).min(1).max(FRIEND_INVITE_MAX) }).strict();
const BestsQuery = z.object({ routeId: z.string().min(1).max(80) });

function joinInfo(e: RideEntry): FriendJoinInfo {
  return { roomId: e.roomId, inviteCode: e.inviteCode, routeId: e.routeId, mode: e.mode as RideMode };
}

const notFound = () => new HttpError(404, 'Introuvable', 'not_found');

export function friendRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const hub = ctx.friends;
  const repo = hub.repo;
  // Contre l'énumération des codes et le harcèlement : demandes et régénérations limitées.
  const requestsByUser = new RateLimiter(20, 10 * 60_000);
  const codesByUser = new RateLimiter(10, 60 * 60_000);
  const invitesByUser = new RateLimiter(30, 10 * 60_000);

  /** Vue d'ensemble (interrogée toutes les 25 s par le menu) : marque aussi la présence. */
  r.get('/', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const now = Date.now();
    hub.touch(u.userId, now);
    const code = await repo.codeOf(u.userId);
    const rel = await repo.relationsOf(u.userId);
    const body: FriendsOverview = {
      code,
      friends: rel
        .filter((x) => x.status === 'accepted')
        .map((x) => ({ id: x.id, name: x.name, color: x.color, level: x.level, since: (x.acceptedAt ?? x.createdAt).toISOString(), presence: hub.presenceOf(x.otherId, now) })),
      incoming: rel.filter((x) => x.status === 'pending' && x.incoming).map((x) => ({ id: x.id, name: x.name, color: x.color, createdAt: x.createdAt.toISOString() })),
      outgoing: rel.filter((x) => x.status === 'pending' && !x.incoming).map((x) => ({ id: x.id, name: x.name, color: x.color, createdAt: x.createdAt.toISOString() })),
      invites: hub.invitesFor(u.userId, now).map((i) => ({ id: i.id, from: i.fromName, fromColor: i.fromColor, ride: i.ride, expiresAt: new Date(i.expiresAt).toISOString() })),
      pollS: FRIENDS_POLL_S,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  /** Nouveau code ami (l'ancien et les liens partagés ne marchent plus). */
  r.post('/code', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!codesByUser.allow(u.userId)) throw new HttpError(429, 'Trop de nouveaux codes, réessaie plus tard', 'rate_limited');
    res.json({ code: await repo.regenerateCode(u.userId) });
  });

  /** Demande d'ami par code (ou lien /?ami=CODE). Si l'autre avait déjà demandé : amitié faite. */
  r.post('/requests', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const code = normalizeFriendCode(RequestSchema.parse(req.body).code);
    if (!requestsByUser.allow(u.userId)) throw new HttpError(429, 'Trop de demandes, réessaie dans quelques minutes', 'rate_limited');
    if (!isFriendCode(code)) throw new HttpError(400, 'Code ami invalide (8 caractères)', 'bad_code');
    const target = await repo.userByCode(code);
    if (!target) throw new HttpError(404, 'Aucun coureur avec ce code', 'unknown_code');
    if (target.id === u.userId) throw new HttpError(400, 'C’est ton propre code ami', 'self');
    const existing = await repo.between(u.userId, target.id);
    if (existing?.status === 'accepted') throw new HttpError(409, 'Vous êtes déjà amis', 'already_friends');
    if (existing && existing.requestedBy === u.userId) throw new HttpError(409, 'Demande déjà envoyée', 'already_requested');
    const mine = await repo.counts(u.userId);
    if (mine.friends >= FRIEND_LIMITS.friends) throw new HttpError(409, `${FRIEND_LIMITS.friends} amis au plus`, 'too_many_friends');
    if (existing) {
      // Demande croisée : l'autre attendait déjà notre réponse.
      await repo.accept(existing.id, u.userId);
      const result: FriendRequestResult = { status: 'accepted', id: existing.id, name: target.name };
      return res.status(200).json(result);
    }
    if (mine.outgoing >= FRIEND_LIMITS.outgoing) throw new HttpError(409, 'Trop de demandes en attente', 'too_many_requests');
    const theirs = await repo.counts(target.id);
    if (theirs.incoming >= FRIEND_LIMITS.incoming || theirs.friends >= FRIEND_LIMITS.friends) throw new HttpError(409, 'Ce coureur ne peut plus recevoir de demande', 'target_full');
    let id: string;
    try {
      id = await repo.createRequest(u.userId, target.id);
    } catch {
      // Course avec une demande simultanée en sens inverse (contrainte d'unicité de la paire).
      throw new HttpError(409, 'Demande déjà en cours entre vous deux', 'already_requested');
    }
    const result: FriendRequestResult = { status: 'pending', id, name: target.name };
    res.status(201).json(result);
  });

  r.post('/requests/:id/accept', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = IdSchema.parse(req.params.id);
    if ((await repo.counts(u.userId)).friends >= FRIEND_LIMITS.friends) throw new HttpError(409, `${FRIEND_LIMITS.friends} amis au plus`, 'too_many_friends');
    if (!(await repo.accept(id, u.userId))) throw notFound();
    res.status(204).end();
  });

  /** Refuse une demande reçue ou annule une demande envoyée (l'autre n'est pas prévenu). */
  r.delete('/requests/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!(await repo.remove(IdSchema.parse(req.params.id), u.userId, 'pending'))) throw notFound();
    res.status(204).end();
  });

  /* ───────────── Invitations à rouler ───────────── */

  /** Invite des amis dans la sortie en cours (il faut y rouler soi-même). */
  r.post('/invites', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const body = InviteSchema.parse(req.body);
    if (!invitesByUser.allow(u.userId)) throw new HttpError(429, 'Trop d’invitations, réessaie dans quelques minutes', 'rate_limited');
    const ride = hub.rideOf(body.roomId);
    const role = ride?.participants.get(u.userId);
    if (!ride || !role || role === 'companion') throw new HttpError(403, 'Tu ne roules pas dans cette sortie', 'forbidden');
    const rel = await repo.relationsOf(u.userId);
    const targets = body.friends.map((id) => rel.find((x) => x.id === id && x.status === 'accepted')?.otherId).filter((x): x is string => !!x);
    const me = await ctx.repos.getProfile(u.userId);
    const sent = hub.invite({ userId: u.userId, name: me?.displayName ?? u.name, color: me?.avatar.jersey ?? '#ffd23f' }, targets, ride.roomId);
    res.status(201).json({ sent: sent.length });
  });

  /** Rejoindre la sortie d'une invitation reçue : seule réponse qui donne le code de la sortie. */
  r.post('/invites/:id/join', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const inv = hub.take(IdSchema.parse(req.params.id), u.userId);
    const ride = inv && hub.rideOf(inv.roomId);
    if (!inv || !ride || !(await repo.areFriends(u.userId, inv.fromUserId))) throw new HttpError(404, 'Invitation expirée ou sortie terminée', 'not_found');
    res.json(joinInfo(ride));
  });

  r.delete('/invites/:id', (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!hub.take(IdSchema.parse(req.params.id), u.userId)) throw notFound();
    res.status(204).end();
  });

  /* ───────────── Amis ───────────── */

  /** Retire un ami (dans les deux sens ; ses invitations tombent). */
  r.delete('/:id', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const id = IdSchema.parse(req.params.id);
    const rel = await repo.relation(id, u.userId);
    if (!rel || rel.status !== 'accepted' || !(await repo.remove(id, u.userId, 'accepted'))) throw notFound();
    hub.forgetPair(u.userId, rel.otherId);
    res.status(204).end();
  });

  /** « Rejoindre » un ami qui roule : le code de sa sortie n'est donné qu'à ses amis. */
  r.post('/:id/join', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const rel = await repo.relation(IdSchema.parse(req.params.id), u.userId);
    if (!rel || rel.status !== 'accepted') throw notFound();
    const ride = hub.currentRide(rel.otherId);
    if (!ride) throw new HttpError(404, `${rel.name} ne roule pas en ce moment`, 'not_riding');
    res.json(joinInfo(ride));
  });

  /** Records personnels d'un ami sur un itinéraire (segments KOM / sprint). */
  r.get('/:id/bests', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    const q = BestsQuery.parse(req.query);
    const rel = await repo.relation(IdSchema.parse(req.params.id), u.userId);
    if (!rel || rel.status !== 'accepted') throw notFound();
    const bests = await ctx.repos.personalBests(rel.otherId, q.routeId);
    res.json(bests.map((b) => ({ segmentId: b.segmentId, bestMs: b.bestMs })));
  });

  return r;
}
