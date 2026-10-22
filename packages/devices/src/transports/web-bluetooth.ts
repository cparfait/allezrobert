/**
 * Web Bluetooth (Chrome, Edge, Opera ; pas Firefox ni Safari). `scan()` ouvre le sélecteur du navigateur :
 * il DOIT être appelé depuis un geste utilisateur (clic). Un seul appareil est renvoyé par appel.
 * Les services utilisables doivent être déclarés à l'avance (`optionalServices`).
 */
import { SERVICE, SRAM_AXS, ZWIFT_CONTROLLER, normalizeUuid, type ExperimentalAdapters } from '@allezrobert/protocols';
import { ALL_KNOWN_SERVICES, kindsFromServices, servicesForKinds } from '../gatt-util.ts';
import type { DeviceLink, DiscoveredDevice, GattConnection, GattServiceInfo, NotificationHandler, ScanHandle, ScanOptions, Transport } from '../types.ts';

// Types minimaux de l'API Web Bluetooth (absents de lib.dom).
interface BtCharacteristicProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}
export interface BtCharacteristic {
  uuid: string;
  properties: BtCharacteristicProperties;
  value?: DataView | null;
  readValue(): Promise<DataView>;
  writeValue?(data: BufferSource): Promise<void>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  startNotifications(): Promise<BtCharacteristic>;
  stopNotifications(): Promise<BtCharacteristic>;
  addEventListener(type: 'characteristicvaluechanged', l: (ev: { target: unknown }) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', l: (ev: { target: unknown }) => void): void;
}
export interface BtService {
  uuid: string;
  getCharacteristics(): Promise<BtCharacteristic[]>;
}
export interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
}
export interface BtDevice {
  id: string;
  name?: string;
  gatt?: BtServer;
  addEventListener(type: 'gattserverdisconnected', l: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', l: () => void): void;
}
export interface BtRequestOptions {
  filters?: Array<{ services?: string[]; namePrefix?: string; manufacturerData?: Array<{ companyIdentifier: number }> }>;
  optionalServices?: string[];
  optionalManufacturerData?: number[];
  acceptAllDevices?: boolean;
}
export interface WebBluetoothLike {
  requestDevice(options: BtRequestOptions): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
  getAvailability?(): Promise<boolean>;
}

export interface WebBluetoothTransportOptions {
  bluetooth?: WebBluetoothLike;
  experimental?: Partial<ExperimentalAdapters>;
}

const PREFIX = 'web-bluetooth:';

/** Préfixes de nom ajoutés aux filtres (appareils qui n'annoncent pas leurs services). */
const NAME_PREFIXES = ['KICKR', 'TICKR', 'ASSIOMA', 'Tacx', 'Elite', 'Wahoo'];

export class WebBluetoothTransport implements Transport {
  readonly kind = 'web-bluetooth' as const;
  private readonly bt: WebBluetoothLike | undefined;
  private readonly experimental: Partial<ExperimentalAdapters>;
  private devices = new Map<string, BtDevice>();

  constructor(options: WebBluetoothTransportOptions = {}) {
    this.bt = options.bluetooth ?? (globalThis as unknown as { navigator?: { bluetooth?: WebBluetoothLike } }).navigator?.bluetooth;
    this.experimental = options.experimental ?? {};
  }

  async isAvailable(): Promise<boolean> {
    if (!this.bt) return false;
    try {
      return this.bt.getAvailability ? await this.bt.getAvailability() : true;
    } catch {
      return false;
    }
  }

  buildRequestOptions(options: ScanOptions): BtRequestOptions {
    const exp = { ...this.experimental, ...(options.experimental ?? {}) };
    const services = servicesForKinds(options.kinds, exp);
    const filters: NonNullable<BtRequestOptions['filters']> = services.map((s) => ({ services: [s] }));
    if (!options.kinds || options.kinds.length === 0) for (const p of NAME_PREFIXES) filters.push({ namePrefix: p });
    if (exp.zwiftControllers) {
      filters.push({ namePrefix: 'Zwift' }, { manufacturerData: [{ companyIdentifier: ZWIFT_CONTROLLER.manufacturerId }] });
    }
    if (exp.headwind) filters.push({ namePrefix: 'HEADWIND' });
    if (exp.sramAxs) filters.push({ namePrefix: 'SRAM' }, { manufacturerData: [{ companyIdentifier: SRAM_AXS.manufacturerId }] });
    const manufacturers = [...(exp.zwiftControllers ? [ZWIFT_CONTROLLER.manufacturerId] : []), ...(exp.sramAxs ? [SRAM_AXS.manufacturerId] : [])];
    // Sans filtre exploitable (rôle sans adaptateur activé) ou à la demande : tous les appareils.
    if (options.acceptAll || filters.length === 0) {
      return { acceptAllDevices: true, optionalServices: ALL_KNOWN_SERVICES, ...(manufacturers.length ? { optionalManufacturerData: manufacturers } : {}) };
    }
    return { filters, optionalServices: ALL_KNOWN_SERVICES, ...(manufacturers.length ? { optionalManufacturerData: manufacturers } : {}) };
  }

  async scan(options: ScanOptions, onFound: (d: DiscoveredDevice) => void): Promise<ScanHandle> {
    if (!this.bt) throw new Error('Web Bluetooth indisponible : utilisez Chrome ou Edge, ou l’app desktop');
    const dev = await this.bt.requestDevice(this.buildRequestOptions(options));
    this.devices.set(dev.id, dev);
    const exp = { ...this.experimental, ...(options.experimental ?? {}) };
    // Les services réels ne sont connus qu'après connexion ; on déduit le rôle des filtres et du nom.
    const guessed = options.kinds && options.kinds.length ? servicesForKinds(options.kinds, exp) : [];
    onFound({
      id: PREFIX + dev.id,
      name: dev.name ?? 'Appareil Bluetooth',
      transport: 'web-bluetooth',
      kinds: options.kinds && options.kinds.length ? [...options.kinds] : kindsFromServices(guessed, dev.name, exp),
      services: guessed,
      address: { deviceId: dev.id },
    });
    return { stop: async () => undefined };
  }

  /** Chrome / Edge récents : les appareils déjà autorisés se reconnectent sans rouvrir le sélecteur. */
  async canRestoreWithoutGesture(): Promise<boolean> {
    return !!this.bt?.getDevices;
  }

  async connect(device: DiscoveredDevice): Promise<DeviceLink> {
    const rawId = String(device.address?.['deviceId'] ?? device.id.replace(PREFIX, ''));
    let dev = this.devices.get(rawId);
    if (!dev && this.bt?.getDevices) {
      // Chrome : appareils déjà autorisés (permission persistante), utile après rechargement.
      dev = (await this.bt.getDevices()).find((d) => d.id === rawId);
    }
    if (!dev?.gatt) throw new Error('Appareil Web Bluetooth inconnu : relancez l’appairage (geste utilisateur requis)');
    this.devices.set(rawId, dev);
    const server = await dev.gatt.connect();
    const conn = new WebGattConnection(device.id, dev, server);
    await conn.discover();
    return conn;
  }
}

function toBytes(v: DataView): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

class WebGattConnection implements GattConnection {
  readonly type = 'gatt' as const;
  readonly deviceId: string;
  services: GattServiceInfo[] = [];
  private readonly device: BtDevice;
  private readonly server: BtServer;
  private chars = new Map<string, BtCharacteristic>();
  private disconnectHandlers = new Set<() => void>();
  private closed = false;
  private readonly onGattDisconnected = () => this.lost();

  constructor(deviceId: string, device: BtDevice, server: BtServer) {
    this.deviceId = deviceId;
    this.device = device;
    this.server = server;
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
  }

  async discover(): Promise<void> {
    const out: GattServiceInfo[] = [];
    for (const svc of await this.server.getPrimaryServices()) {
      const s = normalizeUuid(svc.uuid);
      const info: GattServiceInfo = { uuid: s, characteristics: [] };
      try {
        for (const ch of await svc.getCharacteristics()) {
          const c = normalizeUuid(ch.uuid);
          this.chars.set(`${s}|${c}`, ch);
          const p = ch.properties;
          info.characteristics.push({
            uuid: c,
            properties: [p.read && 'read', p.write && 'write', p.writeWithoutResponse && 'writeWithoutResponse', p.notify && 'notify', p.indicate && 'indicate'].filter((x): x is string => !!x),
          });
        }
      } catch {
        // service inaccessible (liste de blocage Web Bluetooth)
      }
      out.push(info);
    }
    this.services = out;
  }

  private char(service: string, characteristic: string): BtCharacteristic {
    const ch = this.chars.get(`${normalizeUuid(service)}|${normalizeUuid(characteristic)}`);
    if (!ch) throw new Error(`Caractéristique absente : ${characteristic}`);
    return ch;
  }

  async read(service: string, characteristic: string): Promise<Uint8Array> {
    return toBytes(await this.char(service, characteristic).readValue());
  }

  async write(service: string, characteristic: string, data: Uint8Array, withResponse = true): Promise<void> {
    const ch = this.char(service, characteristic);
    const buf = data.slice().buffer;
    if (withResponse && ch.writeValueWithResponse) await ch.writeValueWithResponse(buf);
    else if (!withResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(buf);
    else if (ch.writeValue) await ch.writeValue(buf);
    else throw new Error('Écriture non prise en charge par ce navigateur');
  }

  async subscribe(service: string, characteristic: string, handler: NotificationHandler): Promise<() => Promise<void>> {
    const ch = this.char(service, characteristic);
    const listener = (ev: { target: unknown }) => {
      const v = (ev.target as BtCharacteristic).value;
      if (v) handler(toBytes(v));
    };
    ch.addEventListener('characteristicvaluechanged', listener);
    await ch.startNotifications();
    return async () => {
      ch.removeEventListener('characteristicvaluechanged', listener);
      if (!this.closed) await ch.stopNotifications().catch(() => undefined);
    };
  }

  private lost(): void {
    if (this.closed) return;
    this.closed = true;
    this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    for (const h of this.disconnectHandlers) h();
    this.disconnectHandlers.clear();
  }

  async disconnect(): Promise<void> {
    if (this.server.connected) this.server.disconnect();
    this.lost();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }
}

/** Services Bluetooth SIG les plus courants, exportés pour l'UI d'appairage. */
export const WEB_BLUETOOTH_PRIMARY_SERVICES = [SERVICE.fitnessMachine, SERVICE.cyclingPower, SERVICE.heartRate, SERVICE.cyclingSpeedCadence];
