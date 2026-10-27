/**
 * API du monde ouvert (montée sous /api/public) : affluence par zone et salle conseillée.
 *
 * - `GET /zones` : zones ouvertes au public (PUBLIC_ROUTES) avec le nombre de coureurs ; connecté, on
 *   y voit aussi les noms de ses amis qui y roulent (leur présence est déjà visible de leurs amis).
 * - `GET /zones/:routeId` : carte d'une zone : coureurs en ligne (anonymes, sauf les amis) et amis présents.
 * - `POST /pick {routeId, friendId?}` : salle à rejoindre ; avec `friendId` (relation d'amitié), celle de cet ami et
 *   son coureur (`near`) pour apparaître dans sa roue.
 * - `POST /pick {routeId}` : salle à rejoindre. Priorité à celle où roule déjà le compte (reprise),
 *   puis à celle qui compte le plus d'amis, puis à la plus fréquentée qui n'est pas pleine. Aucune
 *   salle : le client en ouvre une (`joinOrCreate`). Le conseil peut être périmé (salle pleine entre-temps) :
 *   le client retombe alors sur `joinOrCreate`.
 */
import express from 'express';
import { z } from 'zod';
import { MAX_RIDERS_PER_ROOM, type PublicDot, type PublicFriendHere, type PublicPick, type PublicZoneDetail, type PublicZoneInfo } from '@allezrobert/shared';
import type { AppContext } from '../context.ts';
import { riderCountOf, type RideEntry } from '../ride/registry.ts';
import { HttpError, RateLimiter, requireUser, type AuthedRequest } from './middleware.ts';

const PickSchema = z.object({ routeId: z.string().min(1).max(80), friendId: z.string().uuid().optional() }).strict();
const RouteIdSchema = z.string().min(1).max(80);

export function publicRoutes(ctx: AppContext): express.Router {
  const r = express.Router();
  const picksByUser = new RateLimiter(30, 60_000);
  const zones = (): string[] => ctx.config.PUBLIC_ROUTES.split(',').map((x) => x.trim()).filter((id) => id && ctx.routes.has(id));

  /** Comptes amis (identifiant de compte → nom affiché). Jamais renvoyé tel quel. */
  async function friendNames(userId: string): Promise<Map<string, string>> {
    return new Map([...(await friendRelations(userId))].map(([uid, f]) => [uid, f.name]));
  }

  /** Amis acceptés : identifiant de compte → { identifiant de la relation, nom }. */
  async function friendRelations(userId: string): Promise<Map<string, { id: string; name: string }>> {
    const rel = await ctx.friends.repo.relationsOf(userId);
    return new Map(rel.filter((x) => x.status === 'accepted').map((x) => [x.otherId, { id: x.id, name: x.name }]));
  }

  /** Comptes de la salle dont le jeu charge encore (session lancée, pas encore sur la route). */
  const loadingIn = (e: RideEntry): Set<string> => new Set((e.positions?.() ?? []).filter((p) => p.loading && p.userId).map((p) => p.userId as string));

  const friendsIn = (e: RideEntry, friends: Map<string, string>): string[] => {
    const out: string[] = [];
    for (const [uid, role] of e.participants) {
      const name = friends.get(uid);
      if (name && role !== 'companion') out.push(name);
    }
    return out;
  };

  r.get('/zones', async (req: AuthedRequest, res) => {
    const friends = req.user ? await friendNames(req.user.userId) : new Map<string, string>();
    const body: PublicZoneInfo[] = zones().map((routeId) => {
      const rooms = ctx.registry.publicRooms(routeId);
      return {
        routeId,
        riders: rooms.reduce((n, e) => n + riderCountOf(e), 0),
        rooms: rooms.length,
        friends: rooms.flatMap((e) => friendsIn(e, friends)),
        arriving: rooms.flatMap((e) => {
          const loading = loadingIn(e);
          return [...loading].map((uid) => friends.get(uid)).filter((n): n is string => !!n);
        }),
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  r.get('/zones/:routeId', async (req: AuthedRequest, res) => {
    const routeId = RouteIdSchema.parse(req.params.routeId);
    const route = zones().includes(routeId) ? ctx.routes.get(routeId) : undefined;
    if (!route) throw new HttpError(404, 'Zone inconnue', 'not_found');
    const friends = req.user ? await friendRelations(req.user.userId) : new Map<string, { id: string; name: string }>();
    const rooms = ctx.registry.publicRooms(routeId);
    const dots: PublicDot[] = [];
    const here: PublicFriendHere[] = [];
    for (const e of rooms) {
      const full = riderCountOf(e) >= MAX_RIDERS_PER_ROOM;
      for (const p of e.positions?.() ?? []) {
        const f = p.userId ? friends.get(p.userId) : undefined;
        const d = Math.round(p.d * 10) / 10;
        // Jeu encore en chargement : pas encore sur la route (ni point sur la carte), mais l'ami est annoncé.
        if (!p.loading) dots.push({ d, dir: p.dir, ...(f ? { friend: true, name: f.name } : {}) });
        if (f) here.push({ id: f.id, name: f.name, d, dir: p.dir, full, ...(p.loading ? { loading: true } : {}) });
      }
    }
    const riders = rooms.reduce((n, e) => n + riderCountOf(e), 0);
    const body: PublicZoneDetail = { routeId, lengthM: route.summary.lengthM, loop: route.data.loop, riders, rooms: rooms.length, dots, friends: here };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  r.post('/pick', async (req: AuthedRequest, res) => {
    const u = requireUser(req);
    if (!picksByUser.allow(u.userId)) throw new HttpError(429, 'Trop de demandes, réessaie dans un instant', 'rate_limited');
    const { routeId, friendId } = PickSchema.parse(req.body);
    if (!zones().includes(routeId)) throw new HttpError(404, 'Zone inconnue', 'not_found');
    // Rejoindre un ami : sa salle, et son coureur pour apparaître dans sa roue.
    if (friendId) {
      const rel = await ctx.friends.repo.relation(friendId, u.userId);
      const entry = rel?.status === 'accepted' ? ctx.registry.currentRideOf(rel.otherId) : undefined;
      if (!rel || !entry?.public || entry.routeId !== routeId) throw new HttpError(404, `${rel?.name ?? 'Cet ami'} ne roule pas ici en ce moment`, 'not_riding');
      if (riderCountOf(entry) >= MAX_RIDERS_PER_ROOM && !entry.participants.has(u.userId)) throw new HttpError(409, 'Sa salle est pleine', 'room_full');
      const near = entry.riderIds.get(rel.otherId);
      const joined: PublicPick = { roomId: entry.roomId, friends: [rel.name], ...(near ? { near } : {}) };
      res.setHeader('Cache-Control', 'no-store');
      res.json(joined);
      return;
    }
    const friends = await friendNames(u.userId);
    const rooms = ctx.registry.publicRooms(routeId);
    // Déjà dans une salle de cette zone (onglet fermé, reconnexion) : on y retourne.
    const mine = rooms.find((e) => e.participants.has(u.userId) && e.participants.get(u.userId) !== 'companion');
    const open = rooms.filter((e) => riderCountOf(e) < MAX_RIDERS_PER_ROOM);
    const best = (mine ? [mine] : open)
      .map((e) => ({ e, friends: friendsIn(e, friends), riders: riderCountOf(e) }))
      .sort((a, b) => b.friends.length - a.friends.length || b.riders - a.riders || a.e.createdAt - b.e.createdAt)[0];
    const body: PublicPick = best ? { roomId: best.e.roomId, friends: best.friends } : { friends: [] };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  return r;
}
