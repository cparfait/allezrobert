/**
 * Un appareil connecté, quel que soit le transport : cycle de vie, profils, reconnexion automatique avec
 * temporisation croissante, détection de capteur muet (aucune donnée depuis 5 s alors que connecté → 'silent').
 */
import { Emitter, type ConnectionState, type DeviceInfo, type FanCommand, type TrainerCommand } from '@allezrobert/shared';
import { CHAR, SERVICE, deviceInformationFieldFor, parseDeviceInformationString } from '@allezrobert/protocols';
import { systemClock, type Clock, type TimerHandle } from './clock.ts';
import { tryRead } from './gatt-util.ts';
import { WARNING_MESSAGES } from './messages.ts';
import { createProfiles, type ProfileFactoryOptions } from './profiles/index.ts';
import type {
  DeviceEventMap,
  DeviceLink,
  DeviceWarningCode,
  DiscoveredDevice,
  FanControl,
  Profile,
  ProfileContext,
  TrainerControl,
  Transport,
} from './types.ts';

export interface ReconnectPolicy {
  /** Délais successifs entre les tentatives (ms) ; le dernier est répété. */
  delaysMs: number[];
  /** Nombre maximal de tentatives (défaut : illimité). */
  maxAttempts?: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = { delaysMs: [1000, 2000, 4000, 8000, 15000, 30000] };

export interface DeviceOptions extends ProfileFactoryOptions {
  clock?: Clock;
  /** Délai sans données avant l'état 'silent' (ms). Défaut 5000. */
  silentAfterMs?: number;
  /** false = pas de reconnexion automatique. */
  reconnect?: ReconnectPolicy | false;
  /** Profils imposés (sinon déduits des services de la liaison). */
  profiles?: Profile[];
  /** Délai maximal d'une tentative de connexion (ms). Défaut 20000. */
  connectTimeoutMs?: number;
}

const DATA_EVENTS = new Set<keyof DeviceEventMap>(['power', 'heartRate', 'trainer', 'cadence', 'speed']);

export class Device extends Emitter<DeviceEventMap> {
  readonly descriptor: DiscoveredDevice;
  readonly info: DeviceInfo;
  readonly transport: Transport;
  private readonly clock: Clock;
  private readonly options: DeviceOptions;
  private readonly silentAfterMs: number;
  private _state: ConnectionState = 'disconnected';
  private link: DeviceLink | undefined;
  private profiles: Profile[] | undefined;
  private linkUnsub: (() => void) | undefined;
  private userDisconnect = false;
  private attempt = 0;
  private reconnectTimer: TimerHandle | undefined;
  private watchdog: TimerHandle | undefined;
  private _lastDataAt = -Infinity;
  private _battery: number | undefined;
  private connecting: Promise<void> | undefined;

  constructor(descriptor: DiscoveredDevice, transport: Transport, options: DeviceOptions = {}) {
    super();
    this.descriptor = descriptor;
    this.transport = transport;
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.silentAfterMs = options.silentAfterMs ?? 5000;
    this.info = {
      id: descriptor.id,
      name: descriptor.name,
      kinds: [...descriptor.kinds],
      transport: descriptor.transport,
      ...(descriptor.rssi !== undefined ? { rssi: descriptor.rssi } : {}),
    };
  }

  get id(): string {
    return this.descriptor.id;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get lastDataAt(): number {
    return this._lastDataAt;
  }

  get battery(): number | undefined {
    return this._battery;
  }

  get activeProfiles(): readonly Profile[] {
    return this.profiles ?? [];
  }

  /** Pilotage du trainer si l'appareil en est un (FTMS ou FE-C). */
  get trainer(): TrainerControl | undefined {
    return this.profiles?.find((p): p is Profile & TrainerControl => 'send' in p && 'hasControl' in p);
  }

  get fan(): FanControl | undefined {
    return this.profiles?.find((p): p is Profile & FanControl => p.name === 'headwind');
  }

  get isStreaming(): boolean {
    return !!this.profiles?.some((p) => p.streaming);
  }

  async sendTrainer(command: TrainerCommand): Promise<void> {
    const t = this.trainer;
    if (!t) throw new Error(`${this.info.name} n'est pas un home trainer pilotable`);
    await t.send(command);
  }

  async sendFan(command: FanCommand): Promise<void> {
    const f = this.fan;
    if (!f) throw new Error(`${this.info.name} n'est pas un ventilateur pilotable`);
    await f.send(command);
  }

  /** Connexion initiale (lève une erreur en cas d'échec ; pas de reconnexion automatique tant qu'elle n'a pas réussi). */
  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'silent') return;
    if (this.connecting) return this.connecting;
    this.userDisconnect = false;
    this.setState('connecting');
    this.connecting = this.openLink()
      .then(() => {
        this.attempt = 0;
      })
      .catch((e: unknown) => {
        this.setState('error');
        throw e;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.cancelReconnect();
    this.stopWatchdog();
    const link = this.link;
    this.teardownLink();
    if (link) await link.disconnect().catch(() => undefined);
    this.setState('disconnected');
  }

  /** Relance immédiatement une reconnexion (bouton « reconnecter » de l'UI). */
  reconnectNow(): void {
    if (this.userDisconnect) this.userDisconnect = false;
    this.cancelReconnect();
    this.attempt = 0;
    void this.tryReconnect();
  }

  private async openLink(): Promise<void> {
    const link = await this.withTimeout(this.transport.connect(this.descriptor), this.options.connectTimeoutMs ?? 20000);
    if (this.userDisconnect) {
      await link.disconnect().catch(() => undefined);
      return;
    }
    this.link = link;
    this.linkUnsub = link.onDisconnect(() => this.onLinkLost(link));
    if (!this.profiles) {
      const advertisement = { name: this.descriptor.name, ...(this.descriptor.manufacturerData ? { manufacturerData: this.descriptor.manufacturerData } : {}) };
      this.profiles = this.options.profiles ?? createProfiles(link, { ...this.options, advertisement: this.options.advertisement ?? advertisement });
    }
    const ctx = this.makeContext();
    if (link.type === 'gatt') await this.readDeviceInformation(link);
    // État « connecté » avant d'attacher les profils : ils peuvent émettre pendant leur initialisation.
    this._lastDataAt = this.clock.now();
    this.setState('connected');
    for (const p of this.profiles) {
      try {
        await p.attach(link, ctx);
      } catch (e) {
        this.emit('log', `${this.info.name} : profil ${p.name} indisponible (${(e as Error).message})`);
      }
    }
    this.startWatchdog();
  }

  private makeContext(): ProfileContext {
    const self = this;
    return {
      deviceId: this.id,
      deviceName: this.info.name,
      clock: this.clock,
      now: () => this.clock.now(),
      emit(event, payload) {
        if (DATA_EVENTS.has(event)) self.markData();
        if (event === 'battery') self._battery = payload as number;
        self.emit(event, payload);
      },
      log: (message) => this.emit('log', `${this.info.name} : ${message}`),
      warn: (code: DeviceWarningCode, message: string, details?: Record<string, unknown>) =>
        this.emit('warning', { t: this.clock.now(), deviceId: this.id, code, message, ...(details ? { details } : {}) }),
    };
  }

  private async readDeviceInformation(link: DeviceLink): Promise<void> {
    if (link.type !== 'gatt') return;
    if (!link.services.some((s) => s.uuid === SERVICE.deviceInformation)) return;
    for (const ch of [CHAR.manufacturerName, CHAR.modelNumber, CHAR.firmwareRevision]) {
      const raw = await tryRead(link, SERVICE.deviceInformation, ch);
      if (!raw) continue;
      const field = deviceInformationFieldFor(ch);
      const value = parseDeviceInformationString(raw);
      if (field === 'manufacturer') this.info.manufacturer = value;
      else if (field === 'model') this.info.model = value;
      else if (field === 'firmware') this.info.firmware = value;
    }
    this.emit('info', this.info);
  }

  private markData(): void {
    this._lastDataAt = this.clock.now();
    if (this._state === 'silent') this.setState('connected');
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = this.clock.setInterval(() => {
      if (this._state !== 'connected' || !this.isStreaming) return;
      if (this.clock.now() - this._lastDataAt > this.silentAfterMs) {
        this.setState('silent');
        this.emit('warning', { t: this.clock.now(), deviceId: this.id, code: 'sensor-silent', message: WARNING_MESSAGES['sensor-silent'] });
      }
    }, 1000);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== undefined) this.clock.clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private teardownLink(): void {
    this.linkUnsub?.();
    this.linkUnsub = undefined;
    for (const p of this.profiles ?? []) {
      try {
        p.detach();
      } catch {
        // ignoré
      }
    }
    this.link = undefined;
  }

  private onLinkLost(link: DeviceLink): void {
    if (link !== this.link) return;
    this.teardownLink();
    this.stopWatchdog();
    if (this.userDisconnect) {
      this.setState('disconnected');
      return;
    }
    if (this.options.reconnect === false) {
      this.setState('disconnected');
      return;
    }
    this.setState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const policy = this.options.reconnect || DEFAULT_RECONNECT;
    if (policy.maxAttempts !== undefined && this.attempt >= policy.maxAttempts) {
      this.setState('error');
      this.emit('warning', { t: this.clock.now(), deviceId: this.id, code: 'reconnect-failed', message: WARNING_MESSAGES['reconnect-failed'] });
      return;
    }
    const delays = policy.delaysMs.length ? policy.delaysMs : [5000];
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 5000;
    this.attempt++;
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.tryReconnect();
    }, delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.userDisconnect || this.link) return;
    this.setState('reconnecting');
    try {
      await this.openLink();
      this.attempt = 0;
      this.emit('log', `${this.info.name} : reconnecté`);
    } catch (e) {
      this.emit('log', `${this.info.name} : reconnexion échouée (${(e as Error).message})`);
      if (!this.userDisconnect) this.scheduleReconnect();
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== undefined) this.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.clock.setTimeout(() => reject(new Error('Délai de connexion dépassé')), ms);
      p.then(
        (v) => {
          this.clock.clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          this.clock.clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private setState(s: ConnectionState): void {
    if (s === this._state) return;
    this._state = s;
    this.emit('state', s);
  }
}
