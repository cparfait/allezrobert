/**
 * Bluetooth natif de l'app desktop (Rust btleplug) via les commandes Tauri ble_* :
 * choix de l'adaptateur (intégré ou dongle), recherche, GATT complet.
 */
import type { NativeAdapter, NativeDiscovered, NativeGattService, NativeNotification } from '@allezrobert/shared';
import { normalizeUuid, type ExperimentalAdapters } from '@allezrobert/protocols';
import { isTauri, resolveBridge, toNumberArray, type TauriBridge } from '../tauri.ts';
import { kindsFromServices, servicesForKinds } from '../gatt-util.ts';
import type { DeviceLink, DiscoveredDevice, GattConnection, GattServiceInfo, NotificationHandler, ScanHandle, ScanOptions, Transport } from '../types.ts';

const PREFIX = 'native-ble:';

export interface NativeBleTransportOptions {
  bridge?: TauriBridge | (() => Promise<TauriBridge>);
  experimental?: Partial<ExperimentalAdapters>;
}

export class NativeBleTransport implements Transport {
  readonly kind = 'native-ble' as const;
  private readonly bridgeSource: NativeBleTransportOptions['bridge'];
  private readonly experimental: Partial<ExperimentalAdapters>;
  private bridgePromise: Promise<TauriBridge> | undefined;
  private connections = new Map<string, NativeGattConnection>();
  private globalListeners: Promise<void> | undefined;

  constructor(options: NativeBleTransportOptions = {}) {
    this.bridgeSource = options.bridge;
    this.experimental = options.experimental ?? {};
  }

  private bridge(): Promise<TauriBridge> {
    this.bridgePromise ??= resolveBridge(this.bridgeSource);
    return this.bridgePromise;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.bridgeSource && !isTauri()) return false;
    try {
      const adapters = await this.listAdapters();
      return adapters.length > 0;
    } catch {
      return false;
    }
  }

  async listAdapters(): Promise<NativeAdapter[]> {
    return (await this.bridge()).invoke<NativeAdapter[]>('ble_list_adapters');
  }

  async selectAdapter(adapterId: string): Promise<void> {
    await (await this.bridge()).invoke<void>('ble_select_adapter', { adapterId });
  }

  async scan(options: ScanOptions, onFound: (d: DiscoveredDevice) => void): Promise<ScanHandle> {
    const b = await this.bridge();
    const exp = { ...this.experimental, ...(options.experimental ?? {}) };
    const services = servicesForKinds(options.kinds, exp);
    const unlisten = await b.listen<NativeDiscovered>('ble://discovered', (e) => {
      const d = e.payload;
      const svc = d.services.map((s) => safeUuid(s));
      onFound({
        id: PREFIX + d.deviceId,
        name: d.name || 'Appareil Bluetooth',
        transport: 'native-ble',
        kinds: kindsFromServices(svc, d.name, exp),
        services: svc,
        ...(d.rssi !== undefined ? { rssi: d.rssi } : {}),
        ...(d.manufacturerData ? { manufacturerData: d.manufacturerData } : {}),
        address: { deviceId: d.deviceId },
      });
    });
    await b.invoke<void>('ble_start_scan', { services });
    let stopped = false;
    return {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        unlisten();
        await b.invoke<void>('ble_stop_scan').catch(() => undefined);
      },
    };
  }

  async connect(device: DiscoveredDevice): Promise<DeviceLink> {
    const b = await this.bridge();
    await this.ensureGlobalListeners(b);
    const deviceId = String(device.address?.['deviceId'] ?? device.id.replace(PREFIX, ''));
    const services = await b.invoke<NativeGattService[]>('ble_connect', { deviceId });
    const conn = new NativeGattConnection(b, device.id, deviceId, services.map(toServiceInfo), () => this.connections.delete(deviceId));
    this.connections.set(deviceId, conn);
    return conn;
  }

  private ensureGlobalListeners(b: TauriBridge): Promise<void> {
    this.globalListeners ??= (async () => {
      await b.listen<NativeNotification>('ble://notification', (e) => {
        this.connections.get(e.payload.deviceId)?.dispatch(e.payload);
      });
      await b.listen<{ deviceId: string }>('ble://disconnected', (e) => {
        this.connections.get(e.payload.deviceId)?.lost();
      });
    })();
    return this.globalListeners;
  }
}

function safeUuid(u: string): string {
  try {
    return normalizeUuid(u);
  } catch {
    return u.toLowerCase();
  }
}

function toServiceInfo(s: NativeGattService): GattServiceInfo {
  return { uuid: safeUuid(s.uuid), characteristics: s.characteristics.map((c) => ({ uuid: safeUuid(c.uuid), properties: c.properties.map((p) => p.toLowerCase()) })) };
}

class NativeGattConnection implements GattConnection {
  readonly type = 'gatt' as const;
  readonly deviceId: string;
  readonly services: GattServiceInfo[];
  private readonly nativeId: string;
  private readonly bridge: TauriBridge;
  private readonly onClosed: () => void;
  private handlers = new Map<string, Set<NotificationHandler>>();
  private disconnectHandlers = new Set<() => void>();
  private closed = false;

  constructor(bridge: TauriBridge, deviceId: string, nativeId: string, services: GattServiceInfo[], onClosed: () => void) {
    this.bridge = bridge;
    this.deviceId = deviceId;
    this.nativeId = nativeId;
    this.services = services;
    this.onClosed = onClosed;
  }

  async read(service: string, characteristic: string): Promise<Uint8Array> {
    const data = await this.bridge.invoke<number[]>('ble_read', { deviceId: this.nativeId, service: normalizeUuid(service), characteristic: normalizeUuid(characteristic) });
    return Uint8Array.from(data);
  }

  async write(service: string, characteristic: string, data: Uint8Array, withResponse = true): Promise<void> {
    await this.bridge.invoke<void>('ble_write', {
      deviceId: this.nativeId,
      service: normalizeUuid(service),
      characteristic: normalizeUuid(characteristic),
      data: toNumberArray(data),
      withResponse,
    });
  }

  async subscribe(service: string, characteristic: string, handler: NotificationHandler): Promise<() => Promise<void>> {
    const s = normalizeUuid(service);
    const c = normalizeUuid(characteristic);
    const key = `${s}|${c}`;
    let set = this.handlers.get(key);
    const first = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    if (first) await this.bridge.invoke<void>('ble_subscribe', { deviceId: this.nativeId, service: s, characteristic: c });
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(key);
        if (!this.closed) await this.bridge.invoke<void>('ble_unsubscribe', { deviceId: this.nativeId, service: s, characteristic: c }).catch(() => undefined);
      }
    };
  }

  dispatch(n: NativeNotification): void {
    const set = this.handlers.get(`${safeUuid(n.service)}|${safeUuid(n.characteristic)}`);
    if (!set) return;
    const data = Uint8Array.from(n.data);
    for (const h of set) h(data);
  }

  lost(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
    for (const h of this.disconnectHandlers) h();
    this.disconnectHandlers.clear();
  }

  async disconnect(): Promise<void> {
    await this.bridge.invoke<void>('ble_disconnect', { deviceId: this.nativeId }).catch(() => undefined);
    this.lost();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }
}
