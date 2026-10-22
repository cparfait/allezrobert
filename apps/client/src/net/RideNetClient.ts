/**
 * Client réseau typé de la salle « ride » (Colyseus) pour le jeu et l'appli compagnon.
 *
 * Usage type (jeu) :
 *   const net = new RideNetClient({ endpoint: 'https://allezrobert.cparfait.ovh/colyseus' });
 *   const welcome = await net.joinByCode('K7P2QX');          // ou net.create({ routeId, mode: 'group' })
 *   net.startTelemetry(() => ({ watts, cadence, hr, gear, steer }));   // envoi à 10 Hz
 *   net.on('event', (ev) => hud.onEvent(ev));
 *   net.on('companion', (cmd) => game.onCompanionCommand(cmd));
 *   // à chaque image :
 *   const other = net.getInterpolated(riderId);              // autres coureurs (retard 150 ms)
 *   localDist += net.reconcileSelf(localDist, dtS);          // son coureur : correction douce
 *
 * Voir apps/server/README.md (« Client réseau ») pour la référence complète.
 */
import { Client, type Room } from '@colyseus/sdk';
import {
  Emitter,
  NET_MSG,
  decodeSnapshot,
  type CompactSnapshotMsg,
  type CompanionCommand,
  type CompanionStateMsg,
  type HostOptions,
  type RideEventMsg,
  type RideJoinOptions,
  type RideRole,
  type RideRoomOptions,
  type RiderSnapshot,
  type RosterEntry,
  type RosterMsg,
  type TelemetryMsg,
  type WelcomeMsg,
  type WorldSnapshotMsg,
} from '@allezrobert/shared';
import { ClockSync, SelfReconciler, SnapshotBuffer, type InterpolatedRider } from './interpolation.ts';

export type { InterpolatedRider } from './interpolation.ts';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Télémétrie fournie par le jeu (numéro de séquence et horodatage ajoutés ici). */
export type TelemetryInput = Omit<TelemetryMsg, 'seq' | 't'>;

export interface RideNetClientOptions {
  /** URL Colyseus : https://allezrobert.cparfait.ovh/colyseus (prod) ou http://localhost:2567 (dev). */
  endpoint: string;
  /** URL de l'API ; défaut : endpoint sans « /colyseus » + « /api ». */
  apiBase?: string;
  /** Jeton de jeu, ou fonction qui le fournit ; défaut : GET {apiBase}/auth/game-token avec le cookie. */
  token?: string | (() => Promise<string | undefined>);
  /** Retard d'interpolation des autres coureurs (ms). Défaut 150. */
  interpolationDelayMs?: number;
  /** Extrapolation maximale si des instantanés manquent (ms). Défaut 250. */
  maxExtrapolationMs?: number;
  /** Fréquence d'envoi de la télémétrie (Hz). Défaut 10. */
  telemetryHz?: number;
  /** Rejoindre automatiquement (nouvelle place) si la reconnexion Colyseus échoue. Défaut vrai. */
  autoRejoin?: boolean;
  /** Horloge monotone locale (ms). Défaut performance.now. */
  now?: () => number;
  fetchFn?: typeof fetch;
}

export interface RideNetEvents {
  welcome: WelcomeMsg;
  roster: RosterMsg;
  snapshot: WorldSnapshotMsg;
  event: RideEventMsg;
  /** Commande de l'appli compagnon à appliquer par le jeu (vitesses, caméra, pause, ventilateur). */
  companion: CompanionCommand;
  /** État du jeu reçu par l'appli compagnon. */
  companionState: CompanionStateMsg;
  connection: { state: ConnectionState; code?: number; reason?: string };
  error: { code: string | number; message: string };
}

export class RideNetClient {
  readonly options: Required<Omit<RideNetClientOptions, 'token' | 'apiBase' | 'fetchFn'>> & Pick<RideNetClientOptions, 'token'>;
  readonly apiBase: string;
  private readonly sdk: Client;
  private readonly emitter = new Emitter<RideNetEvents>();
  private readonly buffer: SnapshotBuffer;
  private readonly clock = new ClockSync();
  private readonly reconciler = new SelfReconciler();
  private readonly fetchFn: typeof fetch;
  private room: Room | null = null;
  private seq = 0;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryProvider: (() => TelemetryInput | null) | null = null;
  private lastTelemetry: TelemetryInput | null = null;
  private rttMs = NaN;
  private joinArgs: { roomId: string; inviteCode: string; join: RideJoinOptions } | null = null;
  private leaving = false;
  private rejoinAttempts = 0;

  state: ConnectionState = 'idle';
  welcome: WelcomeMsg | null = null;
  readonly roster = new Map<string, RosterEntry>();
  private readonly rosterByN = new Map<number, RosterEntry>();
  hostId = '';
  latest: WorldSnapshotMsg | null = null;

  constructor(opts: RideNetClientOptions) {
    this.options = {
      endpoint: opts.endpoint.replace(/\/$/, ''),
      interpolationDelayMs: opts.interpolationDelayMs ?? 150,
      maxExtrapolationMs: opts.maxExtrapolationMs ?? 250,
      telemetryHz: opts.telemetryHz ?? 10,
      autoRejoin: opts.autoRejoin ?? true,
      now: opts.now ?? (() => performance.now()),
      token: opts.token,
    };
    this.apiBase = (opts.apiBase ?? `${this.options.endpoint.replace(/\/colyseus$/, '')}/api`).replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.sdk = new Client(this.options.endpoint);
    this.buffer = new SnapshotBuffer(40, this.options.interpolationDelayMs, this.options.maxExtrapolationMs);
  }

  /* ───────────── Abonnements ───────────── */

  on<K extends keyof RideNetEvents>(event: K, cb: (payload: RideNetEvents[K]) => void): () => void {
    return this.emitter.on(event, cb);
  }

  /* ───────────── Connexion ───────────── */

  get roomId(): string {
    return this.welcome?.roomId ?? '';
  }

  get inviteCode(): string {
    return this.welcome?.inviteCode ?? '';
  }

  /** Identifiant de son coureur (pour un compagnon : celui du jeu du même compte). */
  get selfId(): string {
    return this.welcome?.selfId ?? '';
  }

  get role(): RideRole | undefined {
    return this.welcome?.role;
  }

  get isHost(): boolean {
    return !!this.selfId && this.selfId === this.hostId && this.role !== 'companion';
  }

  /** Aller-retour réseau estimé (ms), NaN avant la première mesure. */
  get rtt(): number {
    return this.rttMs;
  }

  /** Heure serveur estimée (epoch ms). */
  serverNow(localMs = this.options.now()): number {
    return this.clock.ready ? this.clock.toServer(localMs) : Date.now();
  }

  /** Crée une sortie (compte requis) ; renvoie l'accueil (code d'invitation inclus). */
  async create(options: Partial<RideRoomOptions> = {}, join: Omit<RideJoinOptions, 'inviteCode' | 'token'> = {}): Promise<WelcomeMsg> {
    const token = await this.resolveToken();
    this.setState('connecting');
    const room = await this.sdk.create('ride', { ...options, ...join, ...(token ? { token } : {}) });
    return this.attach(room, { roomId: room.roomId, inviteCode: '', join: { ...join } });
  }

  /** Rejoint une sortie par son code d'invitation (résolu via l'API). */
  async joinByCode(code: string, join: Omit<RideJoinOptions, 'inviteCode' | 'token'> = {}): Promise<WelcomeMsg> {
    const res = await this.fetchFn(`${this.apiBase}/rides/code/${encodeURIComponent(code.trim())}`, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Aucune sortie avec ce code' : `Erreur ${res.status}`);
    const info = (await res.json()) as { roomId: string; inviteCode: string };
    return this.joinById(info.roomId, info.inviteCode, join);
  }

  async joinById(roomId: string, inviteCode: string, join: Omit<RideJoinOptions, 'inviteCode' | 'token'> = {}): Promise<WelcomeMsg> {
    const token = join.role === 'guest' ? await this.resolveToken().catch(() => undefined) : await this.resolveToken();
    this.setState('connecting');
    const room = await this.sdk.joinById(roomId, { ...join, inviteCode, ...(token ? { token } : {}) });
    return this.attach(room, { roomId, inviteCode, join: { ...join } });
  }

  /** Appli compagnon : rejoint la sortie en cours du compte. */
  async joinCurrent(): Promise<WelcomeMsg> {
    const res = await this.fetchFn(`${this.apiBase}/rides/current`, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Aucune sortie en cours' : res.status === 401 ? 'Connexion requise' : `Erreur ${res.status}`);
    const info = (await res.json()) as { roomId: string; inviteCode: string };
    return this.joinById(info.roomId, info.inviteCode, { role: 'companion' });
  }

  async leave(): Promise<void> {
    this.leaving = true;
    this.stopTelemetry();
    this.stopPing();
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true).catch(() => undefined);
    this.setState('disconnected');
  }

  private async resolveToken(): Promise<string | undefined> {
    const t = this.options.token;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t();
    const res = await this.fetchFn(`${this.apiBase}/auth/game-token`, { credentials: 'include' });
    if (res.status === 401) return undefined;
    if (!res.ok) throw new Error(`Jeton de jeu indisponible (${res.status})`);
    return ((await res.json()) as { token: string }).token;
  }

  private attach(room: Room, args: { roomId: string; inviteCode: string; join: RideJoinOptions }): Promise<WelcomeMsg> {
    this.room = room;
    this.leaving = false;
    this.joinArgs = args;
    this.buffer.clear();
    this.clock.reset();
    this.reconciler.reset();
    return new Promise<WelcomeMsg>((resolve, reject) => {
      let first = true;
      const timeout = setTimeout(() => first && reject(new Error("Pas d'accueil du serveur")), 10_000);
      room.onMessage(NET_MSG.welcome, (w: WelcomeMsg) => {
        this.applyWelcome(w);
        if (first) {
          first = false;
          clearTimeout(timeout);
          this.rejoinAttempts = 0;
          this.setState('connected');
          resolve(w);
        }
      });
      room.onMessage(NET_MSG.roster, (r: RosterMsg) => this.applyRoster(r));
      room.onMessage(NET_MSG.snapshot, (s: CompactSnapshotMsg) => this.applySnapshot(s));
      room.onMessage(NET_MSG.event, (ev: RideEventMsg) => {
        if (ev.kind === 'host') this.hostId = ev.riderId;
        if (ev.kind === 'phase' && this.welcome) {
          this.welcome.phase = ev.phase;
          if (ev.startsAt !== undefined) this.welcome.startsAt = ev.startsAt;
        }
        if (ev.kind === 'countdown' && this.welcome) this.welcome.startsAt = ev.startsAt;
        if (ev.kind === 'options' && this.welcome) this.welcome.hostOptions = ev.options;
        if (ev.kind === 'deadline' && this.welcome) this.welcome.deadline = ev.at;
        if (ev.kind === 'regroup' && this.welcome) this.welcome.regrouping = ev.active;
        if (ev.kind === 'error') this.emitter.emit('error', { code: ev.code, message: ev.message });
        this.emitter.emit('event', ev);
      });
      room.onMessage(NET_MSG.companion, (cmd: CompanionCommand) => this.emitter.emit('companion', cmd));
      room.onMessage(NET_MSG.companionState, (s: CompanionStateMsg) => this.emitter.emit('companionState', s));
      room.onMessage(NET_MSG.ping, (p: { t: number; serverT: number }) => {
        const rtt = this.options.now() - p.t;
        this.rttMs = Number.isFinite(this.rttMs) ? this.rttMs * 0.8 + rtt * 0.2 : rtt;
      });
      room.onDrop((code: number, reason?: string) => this.setState('reconnecting', code, reason));
      room.onReconnect(() => this.setState('connected'));
      room.onError((code: number, message?: string) => this.emitter.emit('error', { code, message: message ?? '' }));
      room.onLeave((code: number, reason?: string) => {
        clearTimeout(timeout);
        if (first) reject(new Error(reason || `Connexion refusée (${code})`));
        this.stopPing();
        if (this.room === room) this.room = null;
        this.setState('disconnected', code, reason);
        if (!this.leaving && code !== 4000 && this.options.autoRejoin) void this.rejoin();
      });
      this.startPing();
      if (this.telemetryProvider && !this.telemetryTimer) this.startTelemetry(this.telemetryProvider);
    });
  }

  /** Reconnexion Colyseus échouée (serveur redémarré, coupure longue) : nouvelle entrée. */
  private async rejoin(): Promise<void> {
    const args = this.joinArgs;
    if (!args || !args.inviteCode || this.rejoinAttempts >= 5) return;
    this.rejoinAttempts++;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (this.rejoinAttempts - 1)));
    if (this.leaving || this.room) return;
    try {
      await this.joinById(args.roomId, args.inviteCode, args.join);
    } catch {
      void this.rejoin();
    }
  }

  private setState(state: ConnectionState, code?: number, reason?: string): void {
    this.state = state;
    const ev: RideNetEvents['connection'] = { state };
    if (code !== undefined) ev.code = code;
    if (reason !== undefined) ev.reason = reason;
    this.emitter.emit('connection', ev);
  }

  private applyWelcome(w: WelcomeMsg): void {
    this.welcome = w;
    if (this.joinArgs && !this.joinArgs.inviteCode) this.joinArgs.inviteCode = w.inviteCode;
    this.buffer.routeLengthM = w.route.lengthM;
    this.buffer.loop = w.route.loop;
    this.applyRoster(w.roster, false);
    this.emitter.emit('welcome', w);
  }

  private applyRoster(r: RosterMsg, emit = true): void {
    this.hostId = r.hostId;
    this.roster.clear();
    this.rosterByN.clear();
    for (const e of r.riders) {
      this.roster.set(e.id, e);
      this.rosterByN.set(e.n, e);
    }
    if (this.welcome) this.welcome.roster = r;
    if (emit) this.emitter.emit('roster', r);
  }

  private applySnapshot(s: CompactSnapshotMsg): void {
    const local = this.options.now();
    this.clock.add(local, s.t);
    const snap = decodeSnapshot(s, this.rosterByN);
    this.latest = snap;
    this.buffer.push(snap);
    const self = this.selfId ? snap.riders.find((r) => r.id === this.selfId) : undefined;
    if (self && this.role !== 'companion') {
      const u = this.buffer.loop ? self.lap * this.buffer.routeLengthM + self.distM : self.distM;
      // Instant local auquel le serveur a calculé cette position : s.t + décalage − ½ aller-retour.
      const half = Number.isFinite(this.rttMs) ? this.rttMs / 2 : 0;
      this.reconciler.authoritative(this.clock.toLocal(s.t) - half, u);
    }
    this.emitter.emit('snapshot', snap);
  }

  /* ───────────── Télémétrie ───────────── */

  /** Envoie immédiatement une télémétrie (le compteur `seq` est géré ici). */
  sendTelemetry(t: TelemetryInput): void {
    this.lastTelemetry = t;
    if (!this.room || this.state !== 'connected' || this.role === 'companion') return;
    const msg: TelemetryMsg = { ...t, seq: this.seq++, t: Date.now() };
    this.room.send(NET_MSG.telemetry, msg);
  }

  /** Envoi périodique (10 Hz) de la télémétrie fournie par `provider` (null = rien à envoyer). */
  startTelemetry(provider: () => TelemetryInput | null): void {
    this.telemetryProvider = provider;
    this.stopTelemetry(false);
    this.telemetryTimer = setInterval(() => {
      const t = provider();
      if (t) this.sendTelemetry(t);
    }, 1000 / this.options.telemetryHz);
  }

  stopTelemetry(forget = true): void {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    if (forget) this.telemetryProvider = null;
  }

  private startPing(): void {
    this.stopPing();
    const ping = (): void => this.room?.send(NET_MSG.ping, { t: this.options.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /* ───────────── Positions ───────────── */

  /** État interpolé d'un coureur pour l'image courante (`now` = horloge locale, ms). */
  getInterpolated(riderId: string, now = this.options.now()): InterpolatedRider | null {
    if (!this.clock.ready) return null;
    return this.buffer.sample(riderId, this.clock.toServer(now));
  }

  /** Tous les coureurs connus, interpolés. */
  getAllInterpolated(now = this.options.now()): InterpolatedRider[] {
    const out: InterpolatedRider[] = [];
    const latest = this.buffer.latest;
    if (!latest || !this.clock.ready) return out;
    const serverNow = this.clock.toServer(now);
    for (const id of latest.byId.keys()) {
      const r = this.buffer.sample(id, serverNow);
      if (r) out.push(r);
    }
    return out;
  }

  /** Dernier état autoritaire de son coureur (aspiration, vitesse serveur…). */
  getSelfSnapshot(): RiderSnapshot | null {
    if (!this.latest || !this.selfId) return null;
    return this.latest.riders.find((r) => r.id === this.selfId) ?? null;
  }

  /**
   * Réconciliation de son coureur : à appeler à chaque image avec la distance DÉPLIÉE prédite
   * localement ; renvoie la correction (m) à lui ajouter (douce, ou recalage si > 25 m).
   */
  reconcileSelf(localUnwrappedM: number, dtS: number, now = this.options.now()): number {
    this.reconciler.record(now, localUnwrappedM);
    return this.reconciler.correction(dtS);
  }

  /* ───────────── Actions ───────────── */

  chat(text: string): void {
    this.room?.send(NET_MSG.chat, { text });
  }

  rideOn(toRiderId: string): void {
    this.room?.send(NET_MSG.rideOn, { to: toRiderId });
  }

  /** Hôte : lance le compte à rebours (les coureurs sont replacés sur la ligne). */
  startCountdown(countdownS = 10): void {
    this.room?.send(NET_MSG.start, { countdownS });
  }

  /** Hôte : invités autorisés, groupe soudé, intensité de l'aspiration. */
  setHostOptions(o: Partial<HostOptions>): void {
    this.room?.send(NET_MSG.options, o);
  }

  /** Hôte ou meneur (sortie de groupe) : lance / arrête un regroupement (sans argument : bascule). */
  regroup(active?: boolean): void {
    this.room?.send(NET_MSG.regroup, active === undefined ? {} : { active });
  }

  kick(riderId: string): void {
    this.room?.send(NET_MSG.kick, { riderId });
  }

  transferHost(riderId: string): void {
    this.room?.send(NET_MSG.host, { riderId });
  }

  /** Appli compagnon → jeu du même compte. */
  sendCompanionCommand(cmd: CompanionCommand): void {
    this.room?.send(NET_MSG.companion, cmd);
  }

  /** Jeu → appli compagnon du même compte (rapport, pause, caméra, ventilateur). */
  sendCompanionState(state: CompanionStateMsg): void {
    this.room?.send(NET_MSG.companionState, state);
  }

  /** Dernière télémétrie envoyée (affichage). */
  get lastSentTelemetry(): TelemetryInput | null {
    return this.lastTelemetry;
  }
}
