/**
 * Wahoo Direct Connect (WiFi / Ethernet) au-dessus des commandes natives dircon_* :
 * le TCP et le mDNS sont côté Rust ; ici on code/décode les trames DirCon et on expose
 * la même interface GATT que le Bluetooth, pour réutiliser les profils FTMS/CPS/HRS.
 * Un seul client TCP à la fois par trainer (KICKR CORE 2, KICKR v5/v6 + adaptateur Direct Connect).
 */
import type { NativeDirconDevice } from '@allezrobert/shared';
import {
  DIRCON_DEFAULT_PORT,
  DIRCON_MSG,
  DirconReassembler,
  dirconDiscoverCharacteristics,
  dirconDiscoverServices,
  dirconEnableNotifications,
  dirconPropertiesToList,
  dirconRead,
  dirconResponseName,
  dirconWrite,
  normalizeUuid,
  parseCharacteristicPayload,
  parseDiscoverCharacteristicsResponse,
  parseDiscoverServicesResponse,
  type DirconPacket,
  type ExperimentalAdapters,
} from '@allezrobert/protocols';
import { systemClock, type Clock, type TimerHandle } from '../clock.ts';
import { kindsFromServices } from '../gatt-util.ts';
import { isTauri, resolveBridge, toNumberArray, type TauriBridge } from '../tauri.ts';
import type { DeviceLink, DiscoveredDevice, GattConnection, GattServiceInfo, NotificationHandler, ScanHandle, ScanOptions, Transport } from '../types.ts';

export interface DirconTransportOptions {
  bridge?: TauriBridge | (() => Promise<TauriBridge>);
  clock?: Clock;
  /** Délai d'attente d'une réponse DirCon (ms). Défaut 3000. */
  requestTimeoutMs?: number;
  /** Durée de la découverte mDNS (ms). Défaut 3000. */
  discoverTimeoutMs?: number;
  experimental?: Partial<ExperimentalAdapters>;
}

export class DirconError extends Error {
  override name = 'DirconError';
  readonly responseCode: number;
  constructor(message: string, responseCode: number) {
    super(message);
    this.responseCode = responseCode;
  }
}

export class DirconTransport implements Transport {
  readonly kind = 'dircon' as const;
  private readonly options: DirconTransportOptions;
  private bridgePromise: Promise<TauriBridge> | undefined;
  private manual: DiscoveredDevice[] = [];

  constructor(options: DirconTransportOptions = {}) {
    this.options = options;
  }

  private bridge(): Promise<TauriBridge> {
    this.bridgePromise ??= resolveBridge(this.options.bridge);
    return this.bridgePromise;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.options.bridge || isTauri();
  }

  /** Ajout manuel d'un trainer par adresse IP (si le mDNS est filtré par le réseau). */
  addManualDevice(host: string, port = DIRCON_DEFAULT_PORT, name = `Direct Connect ${host}`): DiscoveredDevice {
    const d: DiscoveredDevice = { id: `dircon:${host}:${port}`, name, transport: 'dircon', kinds: ['trainer'], services: [], address: { host, port } };
    this.manual = this.manual.filter((x) => x.id !== d.id).concat(d);
    return d;
  }

  async scan(options: ScanOptions, onFound: (d: DiscoveredDevice) => void): Promise<ScanHandle> {
    for (const m of this.manual) onFound(m);
    const b = await this.bridge();
    const exp = { ...this.options.experimental, ...(options.experimental ?? {}) };
    let stopped = false;
    void b
      .invoke<NativeDirconDevice[]>('dircon_discover', { timeoutMs: options.timeoutMs ?? this.options.discoverTimeoutMs ?? 3000 })
      .then((list) => {
        if (stopped) return;
        for (const d of list) {
          const services = d.services.map((s) => {
            try {
              return normalizeUuid(s);
            } catch {
              return s.toLowerCase();
            }
          });
          const kinds = kindsFromServices(services, d.name, exp);
          onFound({
            id: `dircon:${d.serialNumber ?? d.macAddress ?? `${d.host}:${d.port}`}`,
            name: d.name,
            transport: 'dircon',
            kinds: kinds.length ? kinds : ['trainer'],
            services,
            address: { host: d.host, port: d.port, ...(d.serialNumber ? { serialNumber: d.serialNumber } : {}) },
          });
        }
      })
      .catch(() => undefined);
    return {
      stop: async () => {
        stopped = true;
      },
    };
  }

  async connect(device: DiscoveredDevice): Promise<DeviceLink> {
    const b = await this.bridge();
    const host = String(device.address?.['host'] ?? '');
    const port = Number(device.address?.['port'] ?? DIRCON_DEFAULT_PORT);
    if (!host) throw new Error('Direct Connect : adresse inconnue');
    const conn = new DirconGattConnection(b, device.id, this.options.clock ?? systemClock, this.options.requestTimeoutMs ?? 3000);
    await conn.open(host, port);
    return conn;
  }
}

interface PendingRequest {
  messageId: number;
  sequence: number;
  resolve: (p: DirconPacket) => void;
  reject: (e: Error) => void;
  timer: TimerHandle;
}

/** Liaison GATT au-dessus d'une connexion DirCon (requêtes sérialisées, une à la fois). */
export class DirconGattConnection implements GattConnection {
  readonly type = 'gatt' as const;
  readonly deviceId: string;
  services: GattServiceInfo[] = [];
  private readonly bridge: TauriBridge;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private connectionId: string | undefined;
  private readonly reassembler = new DirconReassembler();
  private seq = 0;
  private pending: PendingRequest | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private handlers = new Map<string, Set<NotificationHandler>>();
  private disconnectHandlers = new Set<() => void>();
  private unlisteners: Array<() => void> = [];
  private closed = false;

  constructor(bridge: TauriBridge, deviceId: string, clock: Clock, timeoutMs: number) {
    this.bridge = bridge;
    this.deviceId = deviceId;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async open(host: string, port: number): Promise<void> {
    this.unlisteners.push(
      await this.bridge.listen<{ connectionId: string; data: number[] }>('dircon://data', (e) => {
        if (e.payload.connectionId === this.connectionId) this.onData(Uint8Array.from(e.payload.data));
      }),
      await this.bridge.listen<{ connectionId: string }>('dircon://closed', (e) => {
        if (e.payload.connectionId === this.connectionId) this.lost();
      }),
    );
    this.connectionId = await this.bridge.invoke<string>('dircon_connect', { host, port });
    try {
      await this.discover();
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  private async discover(): Promise<void> {
    const sp = await this.request((s) => dirconDiscoverServices(s), DIRCON_MSG.discoverServices);
    const services = parseDiscoverServicesResponse(sp.payload);
    const out: GattServiceInfo[] = [];
    for (const svc of services) {
      try {
        const cp = await this.request((s) => dirconDiscoverCharacteristics(s, svc), DIRCON_MSG.discoverCharacteristics);
        const r = parseDiscoverCharacteristicsResponse(cp.payload);
        out.push({ uuid: r.service, characteristics: r.characteristics.map((c) => ({ uuid: c.uuid, properties: dirconPropertiesToList(c.properties) })) });
      } catch {
        out.push({ uuid: svc, characteristics: [] });
      }
    }
    this.services = out;
  }

  private nextSeq(): number {
    // 0 est réservé aux notifications non sollicitées.
    this.seq = (this.seq % 255) + 1;
    return this.seq;
  }

  private request(build: (seq: number) => Uint8Array, messageId: number): Promise<DirconPacket> {
    const run = () =>
      new Promise<DirconPacket>((resolve, reject) => {
        if (this.closed || !this.connectionId) {
          reject(new Error('Direct Connect : connexion fermée'));
          return;
        }
        const sequence = this.nextSeq();
        const timer = this.clock.setTimeout(() => {
          if (this.pending?.timer !== timer) return;
          this.pending = undefined;
          reject(new Error(`Direct Connect : pas de réponse (message 0x${messageId.toString(16)})`));
        }, this.timeoutMs);
        this.pending = { messageId, sequence, resolve, reject, timer };
        this.bridge.invoke<void>('dircon_send', { connectionId: this.connectionId, data: toNumberArray(build(sequence)) }).catch((e: unknown) => {
          if (this.pending?.timer !== timer) return;
          this.clock.clearTimeout(timer);
          this.pending = undefined;
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private onData(chunk: Uint8Array): void {
    for (const pkt of this.reassembler.push(chunk)) {
      if (pkt.messageId === DIRCON_MSG.unsolicitedCharacteristicNotification) {
        try {
          const { characteristic, data } = parseCharacteristicPayload(pkt.payload);
          for (const h of this.handlers.get(characteristic) ?? []) h(data);
        } catch {
          // notification invalide
        }
        continue;
      }
      const p = this.pending;
      if (!p || p.sequence !== pkt.sequence || (p.messageId !== pkt.messageId && pkt.messageId !== DIRCON_MSG.error)) continue;
      this.clock.clearTimeout(p.timer);
      this.pending = undefined;
      if (pkt.responseCode !== 0 || pkt.messageId === DIRCON_MSG.error) {
        p.reject(new DirconError(`Direct Connect : ${dirconResponseName(pkt.responseCode)}`, pkt.responseCode));
      } else p.resolve(pkt);
    }
  }

  async read(_service: string, characteristic: string): Promise<Uint8Array> {
    const c = normalizeUuid(characteristic);
    const pkt = await this.request((s) => dirconRead(s, c), DIRCON_MSG.readCharacteristic);
    return parseCharacteristicPayload(pkt.payload).data;
  }

  async write(_service: string, characteristic: string, data: Uint8Array): Promise<void> {
    const c = normalizeUuid(characteristic);
    await this.request((s) => dirconWrite(s, c, data), DIRCON_MSG.writeCharacteristic);
  }

  async subscribe(_service: string, characteristic: string, handler: NotificationHandler): Promise<() => Promise<void>> {
    const c = normalizeUuid(characteristic);
    let set = this.handlers.get(c);
    const first = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(c, set);
    }
    set.add(handler);
    if (first) await this.request((s) => dirconEnableNotifications(s, c, true), DIRCON_MSG.enableCharacteristicNotifications);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(c);
        if (!this.closed) await this.request((s) => dirconEnableNotifications(s, c, false), DIRCON_MSG.enableCharacteristicNotifications).catch(() => undefined);
      }
    };
  }

  private lost(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) {
      this.clock.clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Direct Connect : connexion fermée'));
      this.pending = undefined;
    }
    for (const u of this.unlisteners) u();
    this.unlisteners = [];
    for (const h of this.disconnectHandlers) h();
    this.disconnectHandlers.clear();
  }

  async disconnect(): Promise<void> {
    if (this.connectionId && !this.closed) await this.bridge.invoke<void>('dircon_close', { connectionId: this.connectionId }).catch(() => undefined);
    this.lost();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }
}
