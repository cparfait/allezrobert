/**
 * Simulateur de capteurs : home trainer FTMS, pédales CPS (type Assioma), ceinture HRS, Zwift Click
 * et ventilateur HEADWIND, exposés comme de VRAIS serveurs GATT (les octets passent par les encodeurs et
 * décodeurs de @allezrobert/protocols). Bruit réaliste, déterministe (graine), horloge injectable.
 * Sert à coder sans rouler et aux tests d'intégration (ERG, simulation, reconnexion, capteur muet, power match).
 */
import {
  CHAR,
  CPS_FEATURES,
  FITNESS_MACHINE_FEATURES,
  FTMS_OPCODE,
  FTMS_RESULT,
  HEADWIND,
  HEADWIND_MODE,
  SERVICE,
  TARGET_SETTING_FEATURES,
  ZWIFT_CONTROLLER,
  ZWIFT_RIDE_ON,
  bytesEqual,
  clamp,
  encodeBatteryLevel,
  encodeControlPointResponse,
  encodeCyclingPowerFeature,
  encodeCyclingPowerMeasurement,
  encodeFitnessMachineFeature,
  encodeHeartRateMeasurement,
  encodeIndoorBikeData,
  encodeSupportedPowerRange,
  encodeSupportedResistanceLevelRange,
  encodeUtf8,
  parseControlPointRequest,
  type HeadwindMode,
} from '@allezrobert/protocols';
import { systemClock, type Clock, type TimerHandle } from '../clock.ts';
import { SeededRandom } from '../random.ts';
import { kindsFromServices } from '../gatt-util.ts';
import type { DeviceLink, DiscoveredDevice, GattConnection, GattServiceInfo, NotificationHandler, ScanHandle, ScanOptions, Transport } from '../types.ts';

export type SimDeviceKey = 'trainer' | 'pedals' | 'heartRate' | 'click' | 'headwind';

export interface SimulatorOptions {
  clock?: Clock;
  seed?: number;
  /** Pas de simulation (ms). Défaut 250. */
  tickMs?: number;
  devices?: SimDeviceKey[];
  /** Latence simulée de connexion (ms). Défaut 50. */
  connectLatencyMs?: number;
  rider?: { powerW?: number; cadenceRpm?: number; massKg?: number; restHr?: number; maxHr?: number; ftpW?: number };
  trainer?: {
    name?: string;
    /** Écart d'étalonnage du trainer : il lit (1 + bias) × la puissance réelle. */
    powerBias?: number;
    /** Constante de temps de la régulation ERG (s). Défaut 1,5. */
    ergResponseS?: number;
    notifyHz?: number;
    maxPowerW?: number;
  };
  pedals?: {
    name?: string;
    powerBias?: number;
    /** Part gauche réelle (%). */
    balanceLeft?: number;
    /** false = Assioma en mode « une pédale » : pas de balance, puissance gauche doublée. */
    combinedMode?: boolean;
    notifyHz?: number;
  };
  heartRate?: { name?: string; notifyHz?: number };
  /** Bruit de mesure : écart-type relatif de la puissance, en tr/min pour la cadence, en bpm pour la FC. */
  noise?: { power?: number; cadence?: number; hr?: number };
}

type ReadFn = () => Uint8Array;
type WriteFn = (data: Uint8Array, conn: SimGattConnection) => void;

/** Petit serveur GATT en mémoire. */
export class SimPeripheral {
  readonly key: SimDeviceKey;
  readonly id: string;
  readonly name: string;
  readonly services: GattServiceInfo[] = [];
  private readers = new Map<string, ReadFn>();
  private writers = new Map<string, WriteFn>();
  readonly connections = new Set<SimGattConnection>();
  offlineUntil = -Infinity;
  silentUntil = -Infinity;
  readonly clock: Clock;
  rssi: number;

  constructor(key: SimDeviceKey, name: string, clock: Clock, rssi: number) {
    this.key = key;
    this.id = `simulator:${key}`;
    this.name = name;
    this.clock = clock;
    this.rssi = rssi;
  }

  addCharacteristic(service: string, uuid: string, properties: string[], handlers: { read?: ReadFn; write?: WriteFn } = {}): void {
    let svc = this.services.find((s) => s.uuid === service);
    if (!svc) {
      svc = { uuid: service, characteristics: [] };
      this.services.push(svc);
    }
    svc.characteristics.push({ uuid, properties });
    if (handlers.read) this.readers.set(`${service}|${uuid}`, handlers.read);
    if (handlers.write) this.writers.set(`${service}|${uuid}`, handlers.write);
  }

  get online(): boolean {
    return this.clock.now() >= this.offlineUntil;
  }

  read(service: string, uuid: string): Uint8Array {
    const r = this.readers.get(`${service}|${uuid}`);
    if (!r) throw new Error(`Simulateur : lecture impossible ${uuid}`);
    return r();
  }

  write(service: string, uuid: string, data: Uint8Array, conn: SimGattConnection): void {
    const w = this.writers.get(`${service}|${uuid}`);
    if (!w) throw new Error(`Simulateur : écriture impossible ${uuid}`);
    w(data, conn);
  }

  /** Notifie tous les abonnés (sauf si le capteur est rendu muet). */
  notify(service: string, uuid: string, data: Uint8Array, only?: SimGattConnection): void {
    if (this.clock.now() < this.silentUntil) return;
    for (const c of this.connections) if (!only || c === only) c.deliver(service, uuid, data);
  }

  dropAll(): void {
    for (const c of [...this.connections]) c.lost();
  }
}

export class SimGattConnection implements GattConnection {
  readonly type = 'gatt' as const;
  readonly deviceId: string;
  readonly services: GattServiceInfo[];
  private readonly peripheral: SimPeripheral;
  private subs = new Map<string, Set<NotificationHandler>>();
  private disconnectHandlers = new Set<() => void>();
  closed = false;

  constructor(peripheral: SimPeripheral) {
    this.peripheral = peripheral;
    this.deviceId = peripheral.id;
    this.services = peripheral.services.map((s) => ({ uuid: s.uuid, characteristics: s.characteristics.map((c) => ({ ...c, properties: [...c.properties] })) }));
    peripheral.connections.add(this);
  }

  private check(): void {
    if (this.closed) throw new Error('Simulateur : connexion fermée');
  }

  async read(service: string, characteristic: string): Promise<Uint8Array> {
    this.check();
    return this.peripheral.read(service, characteristic);
  }

  async write(service: string, characteristic: string, data: Uint8Array): Promise<void> {
    this.check();
    this.peripheral.write(service, characteristic, Uint8Array.from(data), this);
  }

  async subscribe(service: string, characteristic: string, handler: NotificationHandler): Promise<() => Promise<void>> {
    this.check();
    const key = `${service}|${characteristic}`;
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
    };
  }

  deliver(service: string, characteristic: string, data: Uint8Array): void {
    if (this.closed) return;
    for (const h of this.subs.get(`${service}|${characteristic}`) ?? []) h(Uint8Array.from(data));
  }

  lost(): void {
    if (this.closed) return;
    this.closed = true;
    this.peripheral.connections.delete(this);
    for (const h of this.disconnectHandlers) h();
    this.disconnectHandlers.clear();
  }

  async disconnect(): Promise<void> {
    this.lost();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }
}

export type TrainerMode = 'idle' | 'erg' | 'simulation' | 'resistance';

/** État physique simulé, lisible par les tests. */
export interface SimState {
  t: number;
  /** Puissance réellement produite par le coureur (W). */
  truePowerW: number;
  cadenceRpm: number;
  speedKmh: number;
  heartRate: number;
  trainerMode: TrainerMode;
  ergTargetW: number;
  gradePercent: number;
  windSpeedMs: number;
  resistanceLevel: number;
  crankRevs: number;
  lastCrankEventTime: number;
  controlOwner: SimGattConnection | undefined;
  fanSpeedPercent: number;
  fanMode: HeadwindMode;
}

export class SimulatorTransport implements Transport {
  readonly kind = 'simulator' as const;
  readonly clock: Clock;
  readonly rng: SeededRandom;
  readonly peripherals = new Map<SimDeviceKey, SimPeripheral>();
  readonly state: SimState;
  /** Puissance que le coureur « veut » produire hors ERG (W). */
  riderPowerW: number;
  /** Cadence du coureur (tr/min) ; 0 = arrêt de pédalage. */
  riderCadenceRpm: number;
  /** Refuse la prise de contrôle FTMS (simule un Garmin Edge qui pilote déjà le trainer). */
  denyControl = false;
  readonly trainerBias: number;
  readonly pedalBias: number;
  private readonly options: SimulatorOptions;
  private timer: TimerHandle | undefined;
  private elapsed = 0;
  private lastNotify = new Map<SimDeviceKey, number>();
  private energyKj = 0;
  private hrRrPhase = 0;

  constructor(options: SimulatorOptions = {}) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.rng = new SeededRandom(options.seed ?? 42);
    this.riderPowerW = options.rider?.powerW ?? 200;
    this.riderCadenceRpm = options.rider?.cadenceRpm ?? 90;
    this.trainerBias = options.trainer?.powerBias ?? 0;
    this.pedalBias = options.pedals?.powerBias ?? 0;
    this.state = {
      t: this.clock.now(),
      truePowerW: 0,
      cadenceRpm: 0,
      speedKmh: 0,
      heartRate: options.rider?.restHr ?? 60,
      trainerMode: 'idle',
      ergTargetW: 0,
      gradePercent: 0,
      windSpeedMs: 0,
      resistanceLevel: 0,
      crankRevs: 0,
      lastCrankEventTime: 0,
      controlOwner: undefined,
      fanSpeedPercent: 0,
      fanMode: 'off',
    };
    const keys = options.devices ?? ['trainer', 'pedals', 'heartRate', 'click'];
    for (const k of keys) this.peripherals.set(k, this.build(k));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  /** Démarre la boucle de simulation (automatique à la première recherche/connexion). */
  start(): void {
    if (this.timer !== undefined) return;
    const tick = this.options.tickMs ?? 250;
    this.timer = this.clock.setInterval(() => this.step(tick / 1000), tick);
  }

  stop(): void {
    if (this.timer !== undefined) this.clock.clearInterval(this.timer);
    this.timer = undefined;
  }

  peripheral(key: SimDeviceKey): SimPeripheral {
    const p = this.peripherals.get(key);
    if (!p) throw new Error(`Simulateur : pas d'appareil « ${key} »`);
    return p;
  }

  /** Coupe la liaison et rend l'appareil injoignable pendant `downForMs`. */
  dropConnection(key: SimDeviceKey, downForMs = 3000): void {
    const p = this.peripheral(key);
    p.offlineUntil = this.clock.now() + downForMs;
    p.dropAll();
  }

  /** Capteur toujours connecté mais muet pendant `ms`. */
  silence(key: SimDeviceKey, ms: number): void {
    this.peripheral(key).silentUntil = this.clock.now() + ms;
  }

  /** Appui sur un bouton du Zwift Click simulé. */
  pressClick(button: 'plus' | 'minus'): void {
    const p = this.peripheral('click');
    const pressed = button === 'plus' ? Uint8Array.of(0x37, 0x08, 0x00, 0x10, 0x01) : Uint8Array.of(0x37, 0x08, 0x01, 0x10, 0x00);
    p.notify(ZWIFT_CONTROLLER.service, ZWIFT_CONTROLLER.async, pressed);
    p.notify(ZWIFT_CONTROLLER.service, ZWIFT_CONTROLLER.async, Uint8Array.of(0x37, 0x08, 0x01, 0x10, 0x01));
  }

  async scan(_options: ScanOptions, onFound: (d: DiscoveredDevice) => void): Promise<ScanHandle> {
    this.start();
    for (const p of this.peripherals.values()) {
      if (!p.online) continue;
      onFound(this.describe(p));
    }
    return { stop: async () => undefined };
  }

  describe(p: SimPeripheral): DiscoveredDevice {
    const services = p.services.map((s) => s.uuid);
    return {
      id: p.id,
      name: p.name,
      transport: 'simulator',
      kinds: kindsFromServices(services, p.name, { zwiftControllers: true, headwind: true }),
      services,
      rssi: Math.round(p.rssi + this.rng.normal(0, 2)),
      address: { key: p.key },
    };
  }

  /** Tous les appareils simulés, prêts à être connectés sans recherche. */
  get discovered(): DiscoveredDevice[] {
    return [...this.peripherals.values()].map((p) => this.describe(p));
  }

  connect(device: DiscoveredDevice): Promise<DeviceLink> {
    this.start();
    const key = (device.address?.['key'] ?? device.id.replace('simulator:', '')) as SimDeviceKey;
    const p = this.peripherals.get(key);
    const latency = this.options.connectLatencyMs ?? 50;
    return new Promise<DeviceLink>((resolve, reject) => {
      this.clock.setTimeout(() => {
        if (!p) reject(new Error(`Simulateur : appareil inconnu ${device.id}`));
        else if (!p.online) reject(new Error(`Simulateur : ${p.name} injoignable`));
        else resolve(new SimGattConnection(p));
      }, latency);
    });
  }

  // --- Modèle physique ----------------------------------------------------------------

  private step(dt: number): void {
    const s = this.state;
    s.t = this.clock.now();
    this.elapsed += dt;
    const nz = this.options.noise ?? {};
    const cadenceTarget = this.riderCadenceRpm;
    s.cadenceRpm = cadenceTarget <= 0 ? 0 : Math.max(0, cadenceTarget + this.rng.normal(0, nz.cadence ?? 1));
    let target: number;
    let tau: number;
    if (cadenceTarget <= 0) {
      target = 0;
      tau = 0.5;
    } else if (s.trainerMode === 'erg') {
      // L'ERG asservit la puissance MESURÉE PAR LE TRAINER : la puissance réelle vaut cible / (1 + biais).
      target = s.ergTargetW / (1 + this.trainerBias);
      tau = this.options.trainer?.ergResponseS ?? 1.5;
    } else {
      target = this.riderPowerW;
      tau = 1;
    }
    s.truePowerW += (target - s.truePowerW) * (1 - Math.exp(-dt / tau));
    s.speedKmh = this.speedFromPower(s.truePowerW, s.trainerMode === 'simulation' ? s.gradePercent : 0, s.windSpeedMs);
    this.energyKj += (s.truePowerW * dt) / 1000;
    // Révolutions de manivelle et horodatage du dernier passage (1/1024 s).
    const before = Math.floor(s.crankRevs);
    s.crankRevs += (s.cadenceRpm / 60) * dt;
    const after = Math.floor(s.crankRevs);
    if (after > before && s.cadenceRpm > 0) {
      const frac = (s.crankRevs - after) / ((s.cadenceRpm / 60) * dt);
      const eventT = this.elapsed - frac * dt;
      s.lastCrankEventTime = Math.round(eventT * 1024) % 65536;
    }
    // Fréquence cardiaque : premier ordre (30 s) vers une cible fonction de la puissance.
    const rest = this.options.rider?.restHr ?? 60;
    const max = this.options.rider?.maxHr ?? 185;
    const ftp = this.options.rider?.ftpW ?? 250;
    const hrTarget = rest + (max - rest) * clamp(s.truePowerW / (ftp * 1.15), 0, 1);
    s.heartRate += (hrTarget - s.heartRate) * (1 - Math.exp(-dt / 30));
    this.emitNotifications();
  }

  /** Vitesse d'équilibre (km/h) sur route : P = v·(m·g·(Crr·cosθ + sinθ) + ½ρ·CdA·(v + vent)²). */
  private speedFromPower(powerW: number, gradePercent: number, windMs: number): number {
    const m = (this.options.rider?.massKg ?? 75) + 8.5;
    const theta = Math.atan(gradePercent / 100);
    const k = m * 9.81 * (0.004 * Math.cos(theta) + Math.sin(theta));
    const a = 0.5 * 1.2 * 0.32;
    let v = 8;
    for (let i = 0; i < 30; i++) {
      const f = v * (k + a * (v + windMs) ** 2) - powerW;
      const df = k + a * (v + windMs) ** 2 + 2 * a * v * (v + windMs);
      if (Math.abs(df) < 1e-6) break;
      v = clamp(v - f / df, 0, 30);
    }
    return powerW <= 0 ? 0 : v * 3.6;
  }

  private due(key: SimDeviceKey, hz: number): boolean {
    if (!this.peripherals.has(key)) return false;
    const last = this.lastNotify.get(key) ?? -Infinity;
    if (this.clock.now() - last < 1000 / hz - 1) return false;
    this.lastNotify.set(key, this.clock.now());
    return true;
  }

  private noisy(v: number, rel: number): number {
    return v <= 0 ? 0 : Math.max(0, v * (1 + this.rng.normal(0, rel)));
  }

  private emitNotifications(): void {
    const s = this.state;
    const nz = this.options.noise ?? {};
    if (this.due('trainer', this.options.trainer?.notifyHz ?? 2)) {
      const watts = this.noisy(s.truePowerW * (1 + this.trainerBias), nz.power ?? 0.02);
      this.peripheral('trainer').notify(
        SERVICE.fitnessMachine,
        CHAR.indoorBikeData,
        encodeIndoorBikeData({
          instantaneousSpeedKmh: s.speedKmh,
          instantaneousCadenceRpm: Math.round(s.cadenceRpm * 2) / 2,
          instantaneousPowerW: Math.round(watts),
          ...(s.trainerMode === 'resistance' ? { resistanceLevel: Math.round(s.resistanceLevel) } : {}),
        }),
      );
    }
    if (this.due('pedals', this.options.pedals?.notifyHz ?? 2)) {
      const combined = this.options.pedals?.combinedMode !== false;
      const left = this.options.pedals?.balanceLeft ?? 50.5;
      const measured = this.noisy(s.truePowerW * (1 + this.pedalBias), nz.power ?? 0.02);
      const watts = combined ? measured : measured * (left / 50); // une seule pédale lue, valeur doublée
      this.peripheral('pedals').notify(
        SERVICE.cyclingPower,
        CHAR.cyclingPowerMeasurement,
        encodeCyclingPowerMeasurement({
          instantaneousPowerW: Math.round(watts),
          ...(combined ? { pedalPowerBalancePercent: Math.round(clamp(left + this.rng.normal(0, 0.5), 0, 100) * 2) / 2 } : {}),
          balanceReferenceLeft: true,
          cumulativeCrankRevolutions: Math.floor(s.crankRevs) % 65536,
          lastCrankEventTime: s.lastCrankEventTime,
        }),
      );
    }
    if (this.due('heartRate', this.options.heartRate?.notifyHz ?? 1)) {
      const bpm = Math.round(s.heartRate + this.rng.normal(0, nz.hr ?? 0.5));
      this.hrRrPhase++;
      const rr = Math.round(60000 / Math.max(30, bpm) + this.rng.normal(0, 15));
      this.peripheral('heartRate').notify(SERVICE.heartRate, CHAR.heartRateMeasurement, encodeHeartRateMeasurement({ bpm, sensorContact: true, rrMs: [rr] }));
    }
  }

  // --- Construction des appareils -----------------------------------------------------------

  private build(key: SimDeviceKey): SimPeripheral {
    switch (key) {
      case 'trainer':
        return this.buildTrainer();
      case 'pedals':
        return this.buildPedals();
      case 'heartRate':
        return this.buildHeartRate();
      case 'click':
        return this.buildClick();
      case 'headwind':
        return this.buildHeadwind();
    }
  }

  private addDeviceInformation(p: SimPeripheral, manufacturer: string, model: string): void {
    const S = SERVICE.deviceInformation;
    p.addCharacteristic(S, CHAR.manufacturerName, ['read'], { read: () => encodeUtf8(manufacturer) });
    p.addCharacteristic(S, CHAR.modelNumber, ['read'], { read: () => encodeUtf8(model) });
    p.addCharacteristic(S, CHAR.firmwareRevision, ['read'], { read: () => encodeUtf8('sim-1.0') });
  }

  private addBattery(p: SimPeripheral, percent: number): void {
    p.addCharacteristic(SERVICE.battery, CHAR.batteryLevel, ['read', 'notify'], { read: () => encodeBatteryLevel(percent) });
  }

  private buildTrainer(): SimPeripheral {
    const p = new SimPeripheral('trainer', this.options.trainer?.name ?? 'KICKR CORE SIM', this.clock, -55);
    const S = SERVICE.fitnessMachine;
    const F = FITNESS_MACHINE_FEATURES;
    const T = TARGET_SETTING_FEATURES;
    const maxPower = this.options.trainer?.maxPowerW ?? 2000;
    p.addCharacteristic(S, CHAR.fitnessMachineFeature, ['read'], {
      read: () => encodeFitnessMachineFeature(F.cadence | F.resistanceLevel | F.powerMeasurement, T.resistanceTarget | T.powerTarget | T.indoorBikeSimulation | T.wheelCircumference | T.spinDownControl),
    });
    p.addCharacteristic(S, CHAR.supportedPowerRange, ['read'], { read: () => encodeSupportedPowerRange({ min: 0, max: maxPower, increment: 1 }) });
    p.addCharacteristic(S, CHAR.supportedResistanceLevelRange, ['read'], { read: () => encodeSupportedResistanceLevelRange({ min: 0, max: 10, increment: 0.1 }) });
    p.addCharacteristic(S, CHAR.indoorBikeData, ['notify']);
    p.addCharacteristic(S, CHAR.fitnessMachineStatus, ['notify']);
    p.addCharacteristic(S, CHAR.fitnessMachineControlPoint, ['write', 'indicate'], { write: (d, conn) => this.onControlPoint(p, d, conn) });
    p.addCharacteristic(S, CHAR.trainingStatus, ['read'], { read: () => Uint8Array.of(0x00, 0x01) });
    this.addDeviceInformation(p, 'Wahoo Fitness (simulateur)', 'KICKR CORE');
    // Libère le contrôle si le propriétaire se déconnecte.
    return p;
  }

  private onControlPoint(p: SimPeripheral, data: Uint8Array, conn: SimGattConnection): void {
    const s = this.state;
    const req = parseControlPointRequest(data);
    const respond = (result: number, params: number[] = []) =>
      // L'indication arrive après l'acquittement de l'écriture.
      this.clock.setTimeout(() => p.notify(SERVICE.fitnessMachine, CHAR.fitnessMachineControlPoint, encodeControlPointResponse(req.opCode, result, params), conn), 20);
    const status = (bytes: number[]) => this.clock.setTimeout(() => p.notify(SERVICE.fitnessMachine, CHAR.fitnessMachineStatus, Uint8Array.from(bytes)), 30);
    if (s.controlOwner && s.controlOwner.closed) s.controlOwner = undefined;
    if (req.kind === 'requestControl') {
      if (this.denyControl || (s.controlOwner && s.controlOwner !== conn)) return void respond(FTMS_RESULT.controlNotPermitted);
      s.controlOwner = conn;
      return void respond(FTMS_RESULT.success);
    }
    if (s.controlOwner !== conn) return void respond(FTMS_RESULT.controlNotPermitted);
    switch (req.kind) {
      case 'reset':
        s.trainerMode = 'idle';
        s.controlOwner = undefined;
        respond(FTMS_RESULT.success);
        status([0x01]);
        return;
      case 'startOrResume':
        respond(FTMS_RESULT.success);
        status([0x04]);
        return;
      case 'stopOrPause':
        respond(FTMS_RESULT.success);
        return;
      case 'setTargetPower':
        s.trainerMode = 'erg';
        s.ergTargetW = req.watts;
        respond(FTMS_RESULT.success);
        status([0x08, req.watts & 0xff, (req.watts >> 8) & 0xff]);
        return;
      case 'setIndoorBikeSimulation':
        s.trainerMode = 'simulation';
        s.gradePercent = req.gradePercent;
        s.windSpeedMs = req.windSpeedMs;
        respond(FTMS_RESULT.success);
        status([0x12, ...Array.from(data.subarray(1))]);
        return;
      case 'setTargetResistanceLevel':
        s.trainerMode = 'resistance';
        s.resistanceLevel = req.level;
        respond(FTMS_RESULT.success);
        return;
      case 'setWheelCircumference':
        respond(FTMS_RESULT.success);
        return;
      case 'spinDownControl':
        if (req.start) {
          respond(FTMS_RESULT.success, [0xd0, 0x07, 0xb8, 0x0b]); // 20–30 km/h
          status([0x14, 0x01]);
          this.clock.setTimeout(() => p.notify(SERVICE.fitnessMachine, CHAR.fitnessMachineStatus, Uint8Array.of(0x14, 0x04)), 4000);
          this.clock.setTimeout(() => p.notify(SERVICE.fitnessMachine, CHAR.fitnessMachineStatus, Uint8Array.of(0x14, 0x02)), 9000);
        } else respond(FTMS_RESULT.success);
        return;
      default:
        respond(FTMS_RESULT.opCodeNotSupported);
        return;
    }
  }

  private buildPedals(): SimPeripheral {
    const p = new SimPeripheral('pedals', this.options.pedals?.name ?? 'ASSIOMA SIM', this.clock, -60);
    const combined = this.options.pedals?.combinedMode !== false;
    const feature = CPS_FEATURES.crankRevolutionData | (combined ? CPS_FEATURES.pedalPowerBalance : 0);
    p.addCharacteristic(SERVICE.cyclingPower, CHAR.cyclingPowerFeature, ['read'], { read: () => encodeCyclingPowerFeature(feature) });
    p.addCharacteristic(SERVICE.cyclingPower, CHAR.cyclingPowerMeasurement, ['notify']);
    p.addCharacteristic(SERVICE.cyclingPower, CHAR.sensorLocation, ['read'], { read: () => Uint8Array.of(0x05) }); // pédale gauche
    this.addDeviceInformation(p, 'Favero Electronics (simulateur)', 'ASSIOMA DUO');
    this.addBattery(p, 80);
    return p;
  }

  private buildHeartRate(): SimPeripheral {
    const p = new SimPeripheral('heartRate', this.options.heartRate?.name ?? 'TICKR SIM', this.clock, -65);
    p.addCharacteristic(SERVICE.heartRate, CHAR.heartRateMeasurement, ['notify']);
    p.addCharacteristic(SERVICE.heartRate, CHAR.bodySensorLocation, ['read'], { read: () => Uint8Array.of(0x01) });
    this.addDeviceInformation(p, 'Wahoo Fitness (simulateur)', 'TICKR');
    this.addBattery(p, 95);
    return p;
  }

  private buildClick(): SimPeripheral {
    const p = new SimPeripheral('click', 'Zwift Click SIM', this.clock, -70);
    const S = ZWIFT_CONTROLLER.service;
    p.addCharacteristic(S, ZWIFT_CONTROLLER.async, ['notify']);
    p.addCharacteristic(S, ZWIFT_CONTROLLER.syncTx, ['indicate']);
    p.addCharacteristic(S, ZWIFT_CONTROLLER.syncRx, ['writeWithoutResponse'], {
      write: (d, conn) => {
        if (bytesEqual(d.subarray(0, ZWIFT_RIDE_ON.length), ZWIFT_RIDE_ON)) {
          this.clock.setTimeout(() => {
            p.notify(S, ZWIFT_CONTROLLER.syncTx, Uint8Array.from([...ZWIFT_RIDE_ON, 0x01, 0x03]), conn);
            p.notify(S, ZWIFT_CONTROLLER.async, Uint8Array.of(0x19, 0x08, 0x4b), conn); // batterie 75 %
          }, 20);
        }
      },
    });
    return p;
  }

  private buildHeadwind(): SimPeripheral {
    const p = new SimPeripheral('headwind', 'HEADWIND SIM', this.clock, -62);
    const s = this.state;
    p.addCharacteristic(HEADWIND.service, HEADWIND.characteristic, ['write', 'notify'], {
      write: (d) => {
        if (d[0] === 0x04) {
          const entry = Object.entries(HEADWIND_MODE).find(([, v]) => v === d[1]);
          if (entry) s.fanMode = entry[0] as HeadwindMode;
        } else if (d[0] === 0x02 && s.fanMode === 'manual') {
          s.fanSpeedPercent = d[1] ?? 0;
        }
        p.notify(HEADWIND.service, HEADWIND.characteristic, Uint8Array.of(0xfd, 0x01, s.fanSpeedPercent, HEADWIND_MODE[s.fanMode]));
      },
    });
    return p;
  }

  /** Arrête la simulation et coupe toutes les liaisons. */
  dispose(): void {
    this.stop();
    for (const p of this.peripherals.values()) p.dropAll();
  }
}

/** Raccourci : op codes FTMS, pour les tests qui inspectent l'état du simulateur. */
export { FTMS_OPCODE as SIM_FTMS_OPCODE };
