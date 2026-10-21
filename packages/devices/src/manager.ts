/**
 * Gestionnaire d'appareils : recherche/appairage (liste + RSSI), rôles (trainer, puissance, FC, cadence,
 * vitesses, ventilateur), priorité des sources (pédales = puissance de référence, trainer en repli),
 * reconnexion automatique, capteur muet, lissage 3 s optionnel, power match, appairages persistés,
 * choix de l'adaptateur Bluetooth, et alerte de cohabitation (Garmin Edge qui pilote le trainer).
 */
import {
  Emitter,
  type CadenceSample,
  type ConnectionState,
  type DeviceKind,
  type FanCommand,
  type HeartRateSample,
  type NativeAdapter,
  type PowerSample,
  type ShiftEvent,
  type SpeedSample,
  type TrainerCommand,
  type TrainerSample,
  type TransportKind,
} from '@allezrobert/shared';
import { EXPERIMENTAL_ADAPTERS_DEFAULT, type ExperimentalAdapters } from '@allezrobert/protocols';
import { systemClock, type Clock } from './clock.ts';
import { Device, type DeviceOptions, type ReconnectPolicy } from './device.ts';
import { WARNING_MESSAGES } from './messages.ts';
import {
  discoveredFromPaired,
  emptyPairingConfig,
  pairedFromDiscovered,
  parsePairingConfig,
  serializePairingConfig,
  type PairingConfig,
  type PairingStorage,
  type Role,
  type RoleAssignments,
} from './pairing.ts';
import { PowerMatchController, type PowerMatchOptions } from './power-match.ts';
import type { ShifterSource } from './shifters.ts';
import { PowerSmoother } from './smoothing.ts';
import type { DeviceWarning, DiscoveredDevice, ScanHandle, Transport } from './types.ts';

export type PowerSource = 'pedals' | 'trainer' | 'none';

export interface ManagedPowerSample extends PowerSample {
  sourceDeviceId: string;
  source: PowerSource;
  /** Valeur brute avant lissage. */
  rawWatts: number;
}

export interface DeviceSummary {
  id: string;
  name: string;
  transport: TransportKind;
  kinds: DeviceKind[];
  state: ConnectionState;
  roles: Role[];
  battery?: number;
  rssi?: number;
}

export interface ManagerEvents {
  /** Liste complète des appareils trouvés (triée par RSSI décroissant). */
  discovered: DiscoveredDevice[];
  devices: DeviceSummary[];
  deviceState: { deviceId: string; state: ConnectionState };
  roles: RoleAssignments;
  power: ManagedPowerSample;
  heartRate: HeartRateSample;
  cadence: CadenceSample;
  speed: SpeedSample;
  trainer: TrainerSample & { deviceId: string };
  shift: ShiftEvent & { sourceId: string };
  battery: { deviceId: string; percent: number };
  powerSource: PowerSource;
  warning: DeviceWarning;
  log: string;
}

export interface DeviceManagerOptions {
  transports: Transport[];
  storage?: PairingStorage;
  clock?: Clock;
  silentAfterMs?: number;
  reconnect?: ReconnectPolicy | false;
  /** Fenêtre du lissage optionnel (ms). Défaut 3000. */
  smoothingWindowMs?: number;
  powerMatch?: PowerMatchOptions;
  /** Rôles assignés automatiquement à la connexion si libres. Défaut true. */
  autoAssignRoles?: boolean;
  /** Options transmises à chaque Device (profils FTMS/FE-C, circonférence de roue…). */
  deviceOptions?: Omit<DeviceOptions, 'clock' | 'silentAfterMs' | 'reconnect' | 'experimental'>;
  /** Fraîcheur maximale d'une cadence pour être utilisée (ms). Défaut 3000. */
  cadenceMaxAgeMs?: number;
  /** Intervalle minimal entre deux corrections power match envoyées au trainer (ms). Défaut 1000. */
  powerMatchSendIntervalMs?: number;
}

const SINGLE_ROLES = ['trainer', 'power', 'heartRate', 'cadence', 'fan'] as const;
type SingleRole = (typeof SINGLE_ROLES)[number];

export class DeviceManager extends Emitter<ManagerEvents> {
  readonly clock: Clock;
  private readonly options: DeviceManagerOptions;
  private readonly transports: Transport[];
  private config: PairingConfig = emptyPairingConfig();
  private readonly found = new Map<string, DiscoveredDevice>();
  private readonly devicesById = new Map<string, Device>();
  private readonly deviceUnsubs = new Map<string, Array<() => void>>();
  private scans: ScanHandle[] = [];
  private scanTimer: unknown;
  private readonly smoother: PowerSmoother;
  readonly powerMatch: PowerMatchController;
  private ergTargetW: number | undefined;
  private lastErgSentW: number | undefined;
  private lastErgSentAt = -Infinity;
  private lastPmUpdate: number | undefined;
  private lastCadence = new Map<string, { t: number; cadence: number }>();
  private shifterSources = new Map<string, { src: ShifterSource; off: () => void }>();
  private currentSource: PowerSource = 'none';

  constructor(options: DeviceManagerOptions) {
    super();
    this.options = options;
    this.transports = options.transports;
    this.clock = options.clock ?? systemClock;
    this.smoother = new PowerSmoother(options.smoothingWindowMs ?? 3000);
    this.powerMatch = new PowerMatchController(options.powerMatch);
  }

  // --- Configuration -------------------------------------------------------------------

  get roles(): RoleAssignments {
    return { ...this.config.roles, shifters: [...this.config.roles.shifters] };
  }

  get experimental(): ExperimentalAdapters {
    return { ...this.config.experimental };
  }

  setExperimental(flags: Partial<ExperimentalAdapters>): void {
    this.config.experimental = { ...EXPERIMENTAL_ADAPTERS_DEFAULT, ...this.config.experimental, ...flags };
    void this.persist();
  }

  get smoothingEnabled(): boolean {
    return this.config.smoothing;
  }

  setSmoothing(enabled: boolean): void {
    this.config.smoothing = enabled;
    this.smoother.reset();
    void this.persist();
  }

  get powerMatchEnabled(): boolean {
    return this.config.powerMatch;
  }

  setPowerMatch(enabled: boolean): void {
    this.config.powerMatch = enabled;
    this.powerMatch.reset();
    void this.persist();
  }

  /** Configuration sérialisable (copie). */
  exportConfig(): PairingConfig {
    return parsePairingConfig(serializePairingConfig(this.config));
  }

  // --- Adaptateur Bluetooth (app desktop) -----------------------------------------------

  async listAdapters(): Promise<NativeAdapter[]> {
    const t = this.transports.find((x) => x.listAdapters);
    return t?.listAdapters ? t.listAdapters() : [];
  }

  async selectAdapter(adapterId: string): Promise<void> {
    const t = this.transports.find((x) => x.selectAdapter);
    if (!t?.selectAdapter) throw new Error('Choix d’adaptateur indisponible (Bluetooth natif requis)');
    await t.selectAdapter(adapterId);
    this.config.adapterId = adapterId;
    await this.persist();
  }

  // --- Recherche --------------------------------------------------------------------------

  get discovered(): DiscoveredDevice[] {
    return [...this.found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  }

  async availableTransports(): Promise<TransportKind[]> {
    const out: TransportKind[] = [];
    for (const t of this.transports) if (await t.isAvailable().catch(() => false)) out.push(t.kind);
    return out;
  }

  /**
   * Lance la recherche sur les transports demandés (tous par défaut). Web Bluetooth ouvre le sélecteur
   * du navigateur : appeler depuis un clic. La recherche s'arrête après `timeoutMs` (défaut 15 s).
   */
  async scan(options: { kinds?: DeviceKind[]; transports?: TransportKind[]; timeoutMs?: number } = {}): Promise<void> {
    await this.stopScan();
    const targets = this.transports.filter((t) => !options.transports || options.transports.includes(t.kind));
    for (const t of targets) {
      if (!(await t.isAvailable().catch(() => false))) continue;
      try {
        const h = await t.scan({ ...(options.kinds ? { kinds: options.kinds } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), experimental: this.config.experimental }, (d) => this.onFound(d));
        this.scans.push(h);
      } catch (e) {
        this.emit('log', `Recherche ${t.kind} impossible : ${(e as Error).message}`);
      }
    }
    this.scanTimer = this.clock.setTimeout(() => void this.stopScan(), options.timeoutMs ?? 15000);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer !== undefined) this.clock.clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
    const scans = this.scans.splice(0);
    await Promise.all(scans.map((s) => s.stop().catch(() => undefined)));
  }

  private onFound(d: DiscoveredDevice): void {
    const prev = this.found.get(d.id);
    this.found.set(d.id, { ...prev, ...d, lastSeen: this.clock.now() });
    const dev = this.devicesById.get(d.id);
    if (dev && d.rssi !== undefined) dev.info.rssi = d.rssi;
    this.emit('discovered', this.discovered);
  }

  // --- Connexion -------------------------------------------------------------------------

  get devices(): Device[] {
    return [...this.devicesById.values()];
  }

  device(id: string): Device | undefined {
    return this.devicesById.get(id);
  }

  summaries(): DeviceSummary[] {
    return this.devices.map((d) => ({
      id: d.id,
      name: d.info.name,
      transport: d.info.transport,
      kinds: d.info.kinds,
      state: d.state,
      roles: this.rolesOf(d.id),
      ...(d.battery !== undefined ? { battery: d.battery } : {}),
      ...(d.info.rssi !== undefined ? { rssi: d.info.rssi } : {}),
    }));
  }

  rolesOf(deviceId: string): Role[] {
    const r: Role[] = [];
    for (const k of SINGLE_ROLES) if (this.config.roles[k] === deviceId) r.push(k);
    if (this.config.roles.shifters.includes(deviceId)) r.push('shifter');
    return r;
  }

  private transportFor(kind: TransportKind): Transport {
    const t = this.transports.find((x) => x.kind === kind);
    if (!t) throw new Error(`Transport ${kind} non configuré`);
    return t;
  }

  /** Connecte un appareil trouvé (ou appairé) ; l'ajoute aux appairages persistés. */
  async connect(target: DiscoveredDevice | string, options: { roles?: Role[]; persist?: boolean } = {}): Promise<Device> {
    const desc = typeof target === 'string' ? this.found.get(target) ?? this.pairedDescriptor(target) : target;
    if (!desc) throw new Error(`Appareil inconnu : ${String(target)}`);
    let dev = this.devicesById.get(desc.id);
    if (!dev) {
      dev = new Device(desc, this.transportFor(desc.transport), {
        ...this.options.deviceOptions,
        clock: this.clock,
        ...(this.options.silentAfterMs !== undefined ? { silentAfterMs: this.options.silentAfterMs } : {}),
        ...(this.options.reconnect !== undefined ? { reconnect: this.options.reconnect } : {}),
        experimental: this.config.experimental,
      });
      this.devicesById.set(desc.id, dev);
      this.wire(dev);
    }
    try {
      await dev.connect();
    } catch (e) {
      if (desc.kinds.includes('power')) {
        this.emitWarning(dev.id, 'single-ble-connection');
      }
      throw e;
    }
    for (const r of options.roles ?? []) this.assignRole(r, dev.id, false);
    if (this.options.autoAssignRoles !== false) this.autoAssign(dev);
    if (options.persist !== false) {
      const paired = pairedFromDiscovered(desc);
      paired.kinds = [...dev.info.kinds];
      this.config.devices = this.config.devices.filter((p) => p.id !== desc.id).concat(paired);
      await this.persist();
    }
    this.emitDevices();
    return dev;
  }

  private pairedDescriptor(id: string): DiscoveredDevice | undefined {
    const p = this.config.devices.find((x) => x.id === id);
    return p ? discoveredFromPaired(p) : undefined;
  }

  async disconnect(deviceId: string): Promise<void> {
    const dev = this.devicesById.get(deviceId);
    if (!dev) return;
    await dev.disconnect();
    for (const u of this.deviceUnsubs.get(deviceId) ?? []) u();
    this.deviceUnsubs.delete(deviceId);
    this.devicesById.delete(deviceId);
    this.lastCadence.delete(deviceId);
    this.updatePowerSource();
    this.emitDevices();
  }

  /** Oublie l'appairage (et déconnecte). */
  async forget(deviceId: string): Promise<void> {
    await this.disconnect(deviceId);
    this.config.devices = this.config.devices.filter((p) => p.id !== deviceId);
    for (const k of SINGLE_ROLES) if (this.config.roles[k] === deviceId) delete this.config.roles[k];
    this.config.roles.shifters = this.config.roles.shifters.filter((x) => x !== deviceId);
    await this.persist();
    this.emit('roles', this.roles);
  }

  assignRole(role: Role, deviceId: string | undefined, persist = true): void {
    if (role === 'shifter') {
      if (deviceId && !this.config.roles.shifters.includes(deviceId)) this.config.roles.shifters.push(deviceId);
    } else if (deviceId === undefined) delete this.config.roles[role];
    else this.config.roles[role] = deviceId;
    if (role === 'power' || role === 'trainer') {
      this.powerMatch.reset();
      this.smoother.reset();
    }
    this.updatePowerSource();
    this.emit('roles', this.roles);
    this.emitDevices();
    if (persist) void this.persist();
  }

  unassignShifter(deviceId: string): void {
    this.config.roles.shifters = this.config.roles.shifters.filter((x) => x !== deviceId);
    this.emit('roles', this.roles);
    void this.persist();
  }

  private autoAssign(dev: Device): void {
    const kinds = dev.info.kinds;
    const r = this.config.roles;
    const set = (role: SingleRole) => {
      if (!r[role] || !this.devicesById.has(r[role]!)) this.assignRole(role, dev.id, false);
    };
    if (kinds.includes('trainer') && dev.trainer) set('trainer');
    if (kinds.includes('power') && !kinds.includes('trainer')) set('power');
    if (kinds.includes('heartRate')) set('heartRate');
    if (kinds.includes('cadence') && !kinds.includes('power') && !kinds.includes('trainer')) set('cadence');
    if (kinds.includes('fan') && dev.fan) set('fan');
    if (kinds.includes('shifter') && !r.shifters.includes(dev.id)) this.assignRole('shifter', dev.id, false);
    void this.persist();
  }

  /** Reconnecte les appareils appairés (au démarrage de l'app). Les échecs passent en reconnexion différée. */
  async restore(): Promise<void> {
    const text = this.options.storage ? await this.options.storage.load() : null;
    this.config = parsePairingConfig(text ?? null);
    if (this.config.adapterId) {
      const t = this.transports.find((x) => x.selectAdapter);
      await t?.selectAdapter?.(this.config.adapterId).catch(() => undefined);
    }
    this.emit('roles', this.roles);
    for (const p of this.config.devices) {
      if (!p.autoConnect) continue;
      if (!this.transports.some((t) => t.kind === p.transport)) continue;
      if (p.transport === 'web-bluetooth') continue; // nécessite un geste utilisateur
      await this.connect(discoveredFromPaired(p), { persist: false }).catch((e: unknown) => {
        this.emit('log', `Reconnexion de ${p.name} impossible : ${(e as Error).message}`);
        this.device(p.id)?.reconnectNow();
      });
    }
  }

  private async persist(): Promise<void> {
    if (!this.options.storage) return;
    try {
      await this.options.storage.save(serializePairingConfig(this.config));
    } catch (e) {
      this.emit('log', `Sauvegarde des appairages impossible : ${(e as Error).message}`);
    }
  }

  // --- Commandes -----------------------------------------------------------------------------

  get trainerDevice(): Device | undefined {
    const id = this.config.roles.trainer;
    return id ? this.devicesById.get(id) : undefined;
  }

  /** Envoie une consigne au trainer. En ERG avec pédales et power match actif, la consigne est corrigée. */
  async sendTrainer(command: TrainerCommand): Promise<void> {
    const dev = this.trainerDevice;
    if (!dev) throw new Error('Aucun home trainer assigné');
    if (command.kind === 'erg') {
      const changed = this.ergTargetW !== command.watts;
      this.ergTargetW = command.watts;
      if (changed) this.lastPmUpdate = undefined;
      const watts = this.powerMatchActive() ? command.watts * (1 + this.powerMatch.correction) : command.watts;
      this.lastErgSentW = watts;
      this.lastErgSentAt = this.clock.now();
      await dev.sendTrainer({ kind: 'erg', watts: Math.round(watts) });
      return;
    }
    this.ergTargetW = undefined;
    await dev.sendTrainer(command);
  }

  async sendFan(command: FanCommand): Promise<void> {
    const id = this.config.roles.fan;
    const dev = id ? this.devicesById.get(id) : undefined;
    if (!dev) throw new Error('Aucun ventilateur assigné');
    await dev.sendFan(command);
  }

  /** Ajoute une source locale de vitesses (clavier, manette, appli compagnon). */
  addShifterSource(src: ShifterSource): () => void {
    this.removeShifterSource(src.id);
    const off = src.on('shift', (e) => this.emit('shift', { ...e, sourceId: src.id }));
    this.shifterSources.set(src.id, { src, off });
    src.start();
    return () => this.removeShifterSource(src.id);
  }

  removeShifterSource(id: string): void {
    const s = this.shifterSources.get(id);
    if (!s) return;
    s.off();
    s.src.stop();
    this.shifterSources.delete(id);
  }

  /** Appelé quand le trainer refuse le contrôle (Garmin Edge ou autre appli qui le pilote). */
  onTrainerControlConflict(handler: (w: DeviceWarning) => void): () => void {
    return this.on('warning', (w) => {
      if (w.code === 'trainer-control-not-permitted' || w.code === 'trainer-control-lost') handler(w);
    });
  }

  get powerSource(): PowerSource {
    return this.currentSource;
  }

  async dispose(): Promise<void> {
    await this.stopScan();
    for (const id of [...this.shifterSources.keys()]) this.removeShifterSource(id);
    for (const d of this.devices) await this.disconnect(d.id);
    this.clear();
  }

  // --- Routage des données -----------------------------------------------------------------

  private wire(dev: Device): void {
    const id = dev.id;
    const u: Array<() => void> = [];
    u.push(
      dev.on('state', (state) => {
        this.emit('deviceState', { deviceId: id, state });
        if (state !== 'connected' && (this.config.roles.power === id || this.config.roles.trainer === id)) {
          this.powerMatch.reset(true);
        }
        this.updatePowerSource();
        this.emitDevices();
      }),
      dev.on('power', (s) => this.onPower(id, s)),
      dev.on('trainer', (s) => this.onTrainer(id, s)),
      dev.on('heartRate', (s) => {
        if (this.config.roles.heartRate === id) this.emit('heartRate', s);
      }),
      dev.on('cadence', (s) => this.onCadence(id, s)),
      dev.on('speed', (s) => {
        if (this.config.roles.cadence === id || this.config.roles.trainer === id || !this.config.roles.cadence) this.emit('speed', s);
      }),
      dev.on('shift', (s) => {
        if (this.config.roles.shifters.includes(id)) this.emit('shift', { ...s, sourceId: id });
      }),
      dev.on('battery', (percent) => {
        this.emit('battery', { deviceId: id, percent });
        this.emitDevices();
      }),
      dev.on('warning', (w) => this.emit('warning', w)),
      dev.on('log', (m) => this.emit('log', m)),
      dev.on('info', () => this.emitDevices()),
    );
    this.deviceUnsubs.set(id, u);
  }

  private isLive(id: string | undefined): boolean {
    if (!id) return false;
    const d = this.devicesById.get(id);
    return !!d && d.state === 'connected';
  }

  private updatePowerSource(): void {
    const r = this.config.roles;
    const src: PowerSource = this.isLive(r.power) ? 'pedals' : this.isLive(r.trainer) ? 'trainer' : 'none';
    if (src !== this.currentSource) {
      this.currentSource = src;
      this.smoother.reset();
      this.emit('powerSource', src);
    }
  }

  private emitPower(deviceId: string, source: PowerSource, sample: PowerSample): void {
    const raw = sample.watts;
    const watts = this.config.smoothing ? this.smoother.push(sample.t, raw) : raw;
    const out: ManagedPowerSample = { ...sample, watts, rawWatts: raw, sourceDeviceId: deviceId, source };
    if (out.cadence === undefined) {
      const c = this.bestCadence(sample.t);
      if (c !== undefined) out.cadence = c;
    }
    this.emit('power', out);
  }

  private onPower(id: string, s: PowerSample): void {
    if (this.config.roles.power !== id) return;
    this.updatePowerSource();
    if (this.currentSource !== 'pedals') return;
    this.emitPower(id, 'pedals', s);
    this.runPowerMatch(s);
  }

  private onTrainer(id: string, s: TrainerSample): void {
    if (this.config.roles.trainer !== id) return;
    this.emit('trainer', { ...s, deviceId: id });
    if (s.cadence !== undefined) this.lastCadence.set(id, { t: s.t, cadence: s.cadence });
    this.updatePowerSource();
    if (this.currentSource === 'trainer' && s.watts !== undefined) {
      this.emitPower(id, 'trainer', { t: s.t, watts: s.watts, ...(s.cadence !== undefined ? { cadence: s.cadence } : {}) });
    }
  }

  private onCadence(id: string, s: CadenceSample): void {
    this.lastCadence.set(id, { t: s.t, cadence: s.cadence });
    const chosen = this.bestCadenceSource(s.t);
    if (chosen === id) this.emit('cadence', s);
  }

  /** Priorité cadence : capteur dédié → source de puissance (pédales) → trainer. */
  private bestCadenceSource(now: number): string | undefined {
    const maxAge = this.options.cadenceMaxAgeMs ?? 3000;
    const r = this.config.roles;
    for (const id of [r.cadence, r.power, r.trainer]) {
      if (!id || !this.isLive(id)) continue;
      const c = this.lastCadence.get(id);
      if (c && now - c.t <= maxAge) return id;
    }
    return undefined;
  }

  private bestCadence(now: number): number | undefined {
    const id = this.bestCadenceSource(now);
    return id ? this.lastCadence.get(id)?.cadence : undefined;
  }

  private powerMatchActive(): boolean {
    const r = this.config.roles;
    return this.config.powerMatch && this.ergTargetW !== undefined && !!r.power && r.power !== r.trainer && this.isLive(r.power) && this.isLive(r.trainer);
  }

  private runPowerMatch(s: PowerSample): void {
    if (!this.powerMatchActive() || this.ergTargetW === undefined) return;
    const dt = this.lastPmUpdate === undefined ? 0 : (s.t - this.lastPmUpdate) / 1000;
    this.lastPmUpdate = s.t;
    const corrected = this.powerMatch.update(this.ergTargetW, s.watts, dt, s.cadence ?? this.bestCadence(s.t));
    const now = this.clock.now();
    const minInterval = this.options.powerMatchSendIntervalMs ?? 1000;
    if (now - this.lastErgSentAt < minInterval) return;
    if (this.lastErgSentW !== undefined && Math.abs(corrected - this.lastErgSentW) < 1) return;
    this.lastErgSentW = corrected;
    this.lastErgSentAt = now;
    void this.trainerDevice?.sendTrainer({ kind: 'erg', watts: Math.round(corrected) }).catch(() => undefined);
  }

  private emitWarning(deviceId: string, code: DeviceWarning['code']): void {
    this.emit('warning', { t: this.clock.now(), deviceId, code, message: WARNING_MESSAGES[code] });
  }

  private emitDevices(): void {
    this.emit('devices', this.summaries());
  }
}
