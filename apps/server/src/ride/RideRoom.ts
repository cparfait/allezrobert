/**
 * Salle Colyseus « ride » : sortie privée sur invitation, boucle autoritaire à 10 Hz.
 *
 * Rôles : `rider` (avec matériel), `guest` (invité sans matériel), `companion` (appli
 * compagnon du même compte : ne roule pas, relaie ses commandes vers le jeu).
 * Diffusion : messages simples msgpack (voir `NET_MSG` dans packages/shared/src/net.ts) —
 * liste des coureurs à chaque changement, instantané compact à chaque tick.
 * Reconnexion : `allowReconnection` pendant RECONNECT_GRACE_S (le coureur reste sur la
 * route, en roue libre) ; un nouvel onglet du même compte reprend le même coureur.
 * Hôte : le créateur ; s'il part, le rôle passe au plus ancien humain connecté.
 */
import { CloseCode, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { z } from 'zod';
import {
  MAX_RIDERS_PER_ROOM,
  NET_MSG,
  NET_TICK_HZ,
  encodeSnapshot,
  type CompanionCommand,
  type RideEventMsg,
  type RideRole,
  type RosterMsg,
  type WelcomeMsg,
} from '@allezrobert/shared';
import { RideSimulation, resolveRideOptions, type SimRider } from './simulation.ts';
import { normalizeCode } from './registry.ts';
import { rideServices, type RideServices } from './services.ts';
import { TickStats } from './tick-stats.ts';
import { sanitizeName } from '../db/repos.ts';

const finite = z.number().refine(Number.isFinite, 'nombre fini attendu');

const CreateOptionsSchema = z
  .object({
    routeId: z.string().max(80).optional(),
    mode: z.enum(['free', 'group', 'race', 'workout', 'ftpTest', 'open', 'challenge']).optional(),
    stickyGroup: z.boolean().optional(),
    allowGuests: z.boolean().optional(),
    draftingStrength: finite.optional(),
    trainerDifficulty: finite.optional(),
    aiRiders: finite.optional(),
    startAt: finite.optional(),
    name: z.string().max(60).optional(),
    laps: finite.optional(),
    aiPaceWkg: finite.optional(),
  })
  .passthrough();

const JoinOptionsSchema = z
  .object({
    inviteCode: z.string().max(16).optional(),
    token: z.string().max(4096).optional(),
    role: z.enum(['rider', 'guest', 'companion']).optional(),
    displayName: z.string().max(60).optional(),
  })
  .passthrough();

const TelemetrySchema = z.object({
  seq: z.number().int().min(0),
  t: finite,
  watts: finite.transform((v) => Math.min(Math.max(v, 0), 2500)),
  cadence: finite.transform((v) => Math.min(Math.max(v, 0), 250)),
  hr: finite.transform((v) => Math.min(Math.max(v, 0), 250)).optional(),
  gear: finite.transform((v) => Math.min(Math.max(Math.round(v), 0), 47)),
  steer: finite.transform((v) => Math.min(Math.max(v, -10), 10)),
  guestThrottle: finite.optional(),
});

const ChatSchema = z.object({ text: z.string().min(1).max(500) });
const RideOnSchema = z.object({ to: z.string().min(1).max(40) });
const StartSchema = z.object({ countdownS: finite.optional() }).optional();
const HostOptionsSchema = z.object({ allowGuests: z.boolean().optional(), stickyGroup: z.boolean().optional(), draftingStrength: finite.optional() });
const TargetSchema = z.object({ riderId: z.string().min(1).max(40) });
const PingSchema = z.object({ t: finite });
const CompanionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shift'), action: z.enum(['up', 'down']) }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('camera'), camera: z.enum(['chase', 'cockpit', 'gopro', 'drone', 'tv', 'photo']) }),
  z.object({ kind: z.literal('fan'), percent: finite.transform((v) => Math.min(Math.max(Math.round(v), 0), 100)) }),
  z.object({ kind: z.literal('rideOn'), to: z.string().min(1).max(40) }),
  z.object({ kind: z.literal('chat'), text: z.string().min(1).max(500) }),
]);
const CompanionStateSchema = z
  .object({
    gear: finite.optional(),
    gearLabel: z.string().max(16).optional(),
    paused: z.boolean().optional(),
    camera: z.enum(['chase', 'cockpit', 'gopro', 'drone', 'tv', 'photo']).optional(),
    fanPercent: finite.optional(),
  })
  .strip();

interface AuthData {
  role: RideRole;
  userId?: string;
  name: string;
}

interface ClientData {
  role: RideRole;
  userId?: string;
  riderId?: string;
  /** Connexion remplacée par une autre du même compte : son départ n'affecte pas le coureur. */
  replaced?: boolean;
}

/** Salles actives (statistiques de tick pour /api/health). */
export const activeRooms = new Set<RideRoom>();

export class RideRoom extends Room {
  override maxClients = 2 * MAX_RIDERS_PER_ROOM;
  sim!: RideSimulation;
  inviteCode = '';
  hostId = '';
  readonly tickStats = new TickStats(600);
  private svc!: RideServices;
  private routeId = '';
  private creatorAuthorized = false;
  private aiAdded = false;
  private riderSeq = 0;
  private readonly clientByRider = new Map<string, Client>();
  private readonly riderByUser = new Map<string, string>();
  private readonly kickedUsers = new Set<string>();
  private readonly chatTimes = new Map<string, number[]>();
  private readonly rideOnTimes = new Map<string, number>();
  private readonly snapBuf: number[] = [];

  override onCreate(options: unknown): void {
    this.svc = rideServices();
    const parsed = CreateOptionsSchema.safeParse(options ?? {});
    const o = parsed.success ? parsed.data : {};
    const route = this.svc.routes.resolve(o.routeId);
    this.routeId = route.data.id;
    const opts = resolveRideOptions(o as Parameters<typeof resolveRideOptions>[0], route.data.id);
    this.inviteCode = this.svc.registry.newInviteCode();
    opts.inviteCode = this.inviteCode;
    this.sim = new RideSimulation(route.data, opts, Date.now(), { guestMaxWkg: this.svc.guestMaxWkg, seed: this.roomId });
    this.svc.registry.register({
      roomId: this.roomId,
      inviteCode: this.inviteCode,
      routeId: this.routeId,
      mode: opts.mode,
      name: opts.name ?? route.data.name,
      allowGuests: opts.allowGuests,
      hostUserId: undefined,
    });
    void this.setPrivate(true);
    this.maxMessagesPerSecond = 60;
    this.registerHandlers();
    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 1000 / NET_TICK_HZ);
    activeRooms.add(this);
    this.svc.log('info', `sortie créée ${this.roomId} (${this.routeId}, ${opts.mode})`);
  }

  override async onAuth(_client: Client, options: unknown, context: AuthContext): Promise<AuthData> {
    const parsed = JoinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, 'Options de connexion invalides');
    const o = parsed.data;
    const role: RideRole = o.role ?? 'rider';
    const isCreator = !this.creatorAuthorized;
    if (!isCreator && normalizeCode(o.inviteCode ?? '') !== this.inviteCode) throw new ServerError(403, "Code d'invitation invalide");
    const cookie = context.headers?.get?.('cookie') ?? undefined;
    const user = await this.svc.authenticate(o.token ?? context.token, cookie);
    if (isCreator) {
      if (!user || role === 'companion') throw new ServerError(401, 'Connexion requise pour créer une sortie');
      this.creatorAuthorized = true;
    }
    if (user && this.kickedUsers.has(user.userId)) throw new ServerError(403, "Tu as été retiré de cette sortie par l'organisateur");
    if (role === 'guest' && !this.sim.options.allowGuests && !isCreator) throw new ServerError(403, "L'organisateur n'accepte pas d'invités");
    if (role !== 'companion' && this.sim.isFull && !(user && this.riderByUser.has(user.userId))) throw new ServerError(409, 'Sortie complète');
    if (!user) {
      if (role === 'guest' && this.svc.allowAnonymousGuests) return { role, name: sanitizeName(o.displayName ?? '') || 'Invité' };
      throw new ServerError(401, 'Connexion requise');
    }
    return { role, userId: user.userId, name: user.name };
  }

  override async onJoin(client: Client, _options?: unknown): Promise<void> {
    const auth = client.auth as AuthData;
    const now = Date.now();
    if (auth.role === 'companion') {
      client.userData = { role: 'companion', userId: auth.userId } satisfies ClientData;
      this.svc.registry.join(this.roomId, auth.userId!, 'companion');
      client.send(NET_MSG.welcome, this.welcome('companion', this.riderByUser.get(auth.userId!) ?? ''));
      return;
    }

    let rider: SimRider | undefined;
    const existingId = auth.userId ? this.riderByUser.get(auth.userId) : undefined;
    if (existingId) {
      // Même compte depuis un autre onglet / appareil : reprise du coureur existant.
      rider = this.sim.get(existingId);
      const old = this.clientByRider.get(existingId);
      if (old && old !== client) {
        (old.userData as ClientData).replaced = true;
        old.leave(CloseCode.CONSENTED, 'replaced');
      }
    }
    if (!rider) {
      const profile = auth.userId ? await this.svc.loadProfile(auth.userId).catch(() => null) : null;
      const kind = auth.role === 'guest' ? 'guest' : 'human';
      const added = this.sim.addRider(
        {
          id: `r${++this.riderSeq}`,
          name: profile?.displayName ?? auth.name,
          kind,
          ...(auth.userId ? { userId: auth.userId } : {}),
          ...(profile ? { avatar: profile.avatar, riderMassKg: profile.weightKg, ftpWatts: profile.ftpWatts } : {}),
          shareHr: kind === 'human' && !!profile?.consentHr,
        },
        now,
      );
      if (!added) throw new ServerError(409, 'Sortie complète');
      rider = added;
      if (auth.userId) {
        this.riderByUser.set(auth.userId, rider.id);
        if (kind === 'human') {
          const pbs = await this.svc.personalBests(auth.userId, this.routeId).catch(() => []);
          this.sim.setPersonalBests(auth.userId, pbs);
        }
      }
    }
    this.sim.setConnected(rider.id, true);
    client.userData = { role: auth.role, riderId: rider.id, ...(auth.userId ? { userId: auth.userId } : {}) } satisfies ClientData;
    this.clientByRider.set(rider.id, client);
    if (auth.userId) this.svc.registry.join(this.roomId, auth.userId, auth.role);

    if (!this.hostId && auth.userId) this.setHost(rider.id, false);
    if (!this.aiAdded) {
      this.aiAdded = true;
      if (this.sim.options.aiRiders > 0) this.sim.addAiRiders(this.sim.options.aiRiders, now, rider.ftpWatts);
    }
    client.send(NET_MSG.welcome, this.welcome(auth.role, rider.id));
    this.broadcastRoster();
    this.broadcastEvent({ kind: 'join', riderId: rider.id, name: rider.name }, client);
    this.notifyCompanions(auth.userId);
  }

  override onDrop(client: Client): void {
    const ud = client.userData as ClientData | undefined;
    if (!ud || ud.replaced) return;
    if (ud.riderId) {
      this.sim.setConnected(ud.riderId, false);
      this.broadcastRoster();
    }
    try {
      this.allowReconnection(client, this.svc.reconnectGraceS);
    } catch {
      // Salle en cours de fermeture (arrêt du serveur) : pas de reconnexion possible.
    }
  }

  override onReconnect(client: Client): void {
    const ud = client.userData as ClientData | undefined;
    if (!ud) return;
    if (ud.riderId) {
      this.sim.setConnected(ud.riderId, true);
      this.clientByRider.set(ud.riderId, client);
      this.broadcastRoster();
    }
    // Resynchronisation complète (phase, hôte, liste) après la coupure.
    client.send(NET_MSG.welcome, this.welcome(ud.role, ud.riderId ?? (ud.userId ? this.riderByUser.get(ud.userId) ?? '' : '')));
  }

  override onLeave(client: Client): void {
    const ud = client.userData as ClientData | undefined;
    if (!ud || ud.replaced) return;
    if (ud.role === 'companion') {
      if (ud.userId) this.svc.registry.leave(this.roomId, ud.userId, 'companion');
      return;
    }
    const riderId = ud.riderId;
    if (!riderId || this.clientByRider.get(riderId) !== client) return;
    this.clientByRider.delete(riderId);
    this.sim.removeRider(riderId);
    if (ud.userId) {
      this.riderByUser.delete(ud.userId);
      this.svc.registry.leave(this.roomId, ud.userId, ud.role);
    }
    this.broadcastEvent({ kind: 'leave', riderId });
    if (this.hostId === riderId) this.migrateHost();
    this.broadcastRoster();
    this.notifyCompanions(ud.userId);
  }

  override onDispose(): void {
    activeRooms.delete(this);
    this.svc.registry.unregister(this.roomId);
    this.svc.log('info', `sortie fermée ${this.roomId}`);
  }

  /* ───────────── Boucle ───────────── */

  private update(deltaMs: number): void {
    const t0 = performance.now();
    const now = Date.now();
    const dt = Math.min(Math.max(deltaMs / 1000, 0.02), 0.25);
    const res = this.sim.step(now, dt);
    for (const ev of res.events) this.broadcastEvent(ev);
    for (const e of res.efforts) {
      this.svc
        .recordEffort({ userId: e.userId, routeId: this.routeId, segmentId: e.segmentId, elapsedMs: e.elapsedMs, rideId: this.roomId })
        .catch((err) => this.svc.log('warn', `effort non enregistré : ${(err as Error).message}`));
    }
    const snap = encodeSnapshot(this.sim.tick, now, this.sim.rows(), this.snapBuf);
    this.broadcast(NET_MSG.snapshot, snap);
    this.tickStats.add(performance.now() - t0);
  }

  /** Un tick manuel (tests) sans attendre l'horloge. */
  stepForTest(deltaMs = 100): void {
    this.update(deltaMs);
  }

  /* ───────────── Messages ───────────── */

  private registerHandlers(): void {
    this.onMessage(NET_MSG.telemetry, (client: Client, raw: unknown) => {
      const ud = client.userData as ClientData | undefined;
      if (!ud?.riderId) return;
      const p = TelemetrySchema.safeParse(raw);
      if (p.success) this.sim.setTelemetry(ud.riderId, p.data as never, Date.now());
    });

    this.onMessage(NET_MSG.chat, (client: Client, raw: unknown) => {
      const p = ChatSchema.safeParse(raw);
      if (p.success) this.doChat(client, p.data.text);
    });

    this.onMessage(NET_MSG.rideOn, (client: Client, raw: unknown) => {
      const p = RideOnSchema.safeParse(raw);
      if (p.success) this.doRideOn(client, p.data.to);
    });

    this.onMessage(NET_MSG.companion, (client: Client, raw: unknown) => {
      const ud = client.userData as ClientData | undefined;
      if (!ud?.userId || ud.role !== 'companion') return;
      const p = CompanionSchema.safeParse(raw);
      if (!p.success) return;
      const cmd = p.data as CompanionCommand;
      if (cmd.kind === 'chat') return this.doChat(client, cmd.text);
      if (cmd.kind === 'rideOn') return this.doRideOn(client, cmd.to);
      const riderId = this.riderByUser.get(ud.userId);
      const game = riderId ? this.clientByRider.get(riderId) : undefined;
      if (!game) {
        client.send(NET_MSG.event, { kind: 'error', code: 'no_game', message: "Le jeu n'est pas connecté à cette sortie" } satisfies RideEventMsg);
        return;
      }
      game.send(NET_MSG.companion, cmd);
    });

    this.onMessage(NET_MSG.companionState, (client: Client, raw: unknown) => {
      const ud = client.userData as ClientData | undefined;
      if (!ud?.userId || ud.role === 'companion') return;
      const p = CompanionStateSchema.safeParse(raw);
      if (!p.success) return;
      for (const c of this.clients) {
        const cd = c.userData as ClientData | undefined;
        if (cd?.role === 'companion' && cd.userId === ud.userId) c.send(NET_MSG.companionState, p.data);
      }
    });

    this.onMessage(NET_MSG.start, (client: Client, raw: unknown) => {
      if (!this.isHost(client)) return;
      const p = StartSchema.safeParse(raw);
      const ev = this.sim.startCountdown(Date.now(), (p.success ? p.data?.countdownS : undefined) ?? 10);
      if (ev) {
        this.broadcastEvent(ev);
        this.broadcastEvent({ kind: 'phase', phase: 'countdown', ...(this.sim.startsAt !== undefined ? { startsAt: this.sim.startsAt } : {}) });
      }
    });

    this.onMessage(NET_MSG.options, (client: Client, raw: unknown) => {
      if (!this.isHost(client)) return;
      const p = HostOptionsSchema.safeParse(raw);
      if (!p.success) return;
      const options = this.sim.updateHostOptions(p.data as never);
      const entry = this.svc.registry.byRoomId(this.roomId);
      if (entry) entry.allowGuests = options.allowGuests;
      this.broadcastEvent({ kind: 'options', options });
    });

    this.onMessage(NET_MSG.kick, (client: Client, raw: unknown) => {
      if (!this.isHost(client)) return;
      const p = TargetSchema.safeParse(raw);
      if (!p.success || p.data.riderId === this.hostId) return;
      const target = this.sim.get(p.data.riderId);
      if (!target) return;
      if (target.kind === 'ai') {
        this.sim.removeRider(target.id);
        this.broadcastEvent({ kind: 'leave', riderId: target.id });
        this.broadcastRoster();
        return;
      }
      if (target.userId) this.kickedUsers.add(target.userId);
      const c = this.clientByRider.get(target.id);
      if (c) c.leave(CloseCode.CONSENTED, 'kicked');
      else {
        // Coureur en attente de reconnexion : retiré tout de suite.
        this.sim.removeRider(target.id);
        if (target.userId) this.riderByUser.delete(target.userId);
        this.broadcastEvent({ kind: 'leave', riderId: target.id });
        this.broadcastRoster();
      }
    });

    this.onMessage(NET_MSG.host, (client: Client, raw: unknown) => {
      if (!this.isHost(client)) return;
      const p = TargetSchema.safeParse(raw);
      if (!p.success) return;
      const target = this.sim.get(p.data.riderId);
      if (!target || target.kind === 'ai' || !target.userId) return;
      this.setHost(target.id, true);
    });

    this.onMessage(NET_MSG.ping, (client: Client, raw: unknown) => {
      const p = PingSchema.safeParse(raw);
      if (p.success) client.send(NET_MSG.ping, { t: p.data.t, serverT: Date.now() });
    });
  }

  private isHost(client: Client): boolean {
    const ud = client.userData as ClientData | undefined;
    return !!ud?.riderId && ud.riderId === this.hostId;
  }

  /** Coureur au nom duquel parle ce client (le compagnon parle au nom du jeu du compte). */
  private speakerOf(client: Client): string | undefined {
    const ud = client.userData as ClientData | undefined;
    if (!ud) return undefined;
    if (ud.riderId) return ud.riderId;
    return ud.userId ? this.riderByUser.get(ud.userId) : undefined;
  }

  private doChat(client: Client, text: string): void {
    const riderId = this.speakerOf(client);
    if (!riderId) return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!clean) return;
    // Anti-flood : 5 messages par tranche de 10 s et par coureur.
    const now = Date.now();
    const times = (this.chatTimes.get(riderId) ?? []).filter((t) => now - t < 10_000);
    if (times.length >= 5) {
      client.send(NET_MSG.event, { kind: 'error', code: 'chat_rate', message: 'Doucement sur le chat !' } satisfies RideEventMsg);
      return;
    }
    times.push(now);
    this.chatTimes.set(riderId, times);
    this.broadcastEvent({ kind: 'chat', riderId, text: clean });
  }

  private doRideOn(client: Client, to: string): void {
    const from = this.speakerOf(client);
    if (!from || from === to || !this.sim.get(to)) return;
    const key = `${from}>${to}`;
    const now = Date.now();
    if (now - (this.rideOnTimes.get(key) ?? 0) < 3000) return;
    this.rideOnTimes.set(key, now);
    this.broadcastEvent({ kind: 'rideOn', from, to });
  }

  private setHost(riderId: string, announce: boolean): void {
    this.hostId = riderId;
    const entry = this.svc.registry.byRoomId(this.roomId);
    if (entry) entry.hostUserId = this.sim.get(riderId)?.userId;
    if (announce) {
      this.broadcastEvent({ kind: 'host', riderId });
      this.broadcastRoster();
    }
  }

  /** Migration d'hôte : plus ancien humain connecté avec compte, sinon invité avec compte. */
  private migrateHost(): void {
    const candidates = this.sim.riders
      .filter((r) => r.kind !== 'ai' && r.userId && r.id !== this.hostId)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(a.kind === 'guest') - Number(b.kind === 'guest') || a.joinedAt - b.joinedAt);
    const next = candidates[0];
    this.hostId = '';
    if (next) this.setHost(next.id, true);
    else {
      const entry = this.svc.registry.byRoomId(this.roomId);
      if (entry) entry.hostUserId = undefined;
    }
  }

  private notifyCompanions(userId: string | undefined): void {
    if (!userId) return;
    for (const c of this.clients) {
      const cd = c.userData as ClientData | undefined;
      if (cd?.role === 'companion' && cd.userId === userId) c.send(NET_MSG.welcome, this.welcome('companion', this.riderByUser.get(userId) ?? ''));
    }
  }

  private broadcastEvent(ev: RideEventMsg, except?: Client): void {
    if (except) this.broadcast(NET_MSG.event, ev, { except });
    else this.broadcast(NET_MSG.event, ev);
  }

  rosterMsg(): RosterMsg {
    return { hostId: this.hostId, riders: this.sim.roster(this.hostId) };
  }

  private broadcastRoster(): void {
    this.broadcast(NET_MSG.roster, this.rosterMsg());
  }

  private welcome(role: RideRole, selfId: string): WelcomeMsg {
    const route = this.svc.routes.resolve(this.routeId);
    const w: WelcomeMsg = {
      roomId: this.roomId,
      inviteCode: this.inviteCode,
      role,
      selfId,
      hostId: this.hostId,
      options: { ...this.sim.options },
      phase: this.sim.phase,
      serverTime: Date.now(),
      tickHz: NET_TICK_HZ,
      route: route.summary,
      roster: this.rosterMsg(),
    };
    if (this.sim.startsAt !== undefined) w.startsAt = this.sim.startsAt;
    return w;
  }
}
