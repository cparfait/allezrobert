/** Aides de test : attente sur horloge manuelle, faux pont Tauri, faux Web Bluetooth, tous adossés au simulateur. */
import {
  DIRCON_MSG,
  DirconReassembler,
  dirconCharacteristicResponse,
  dirconDiscoverCharacteristicsResponse,
  dirconDiscoverServicesResponse,
  dirconErrorResponse,
  dirconNotification,
  normalizeUuid,
  parseCharacteristicPayload,
  bytesToUuid,
} from '@allezrobert/protocols';
import type { NativeGattService } from '@allezrobert/shared';
import { ManualClock, SimGattConnection, type SimPeripheral, type SimulatorTransport, type TauriBridge, type TauriEvent } from '../src/index.ts';
import type { BtCharacteristic, BtDevice, BtRequestOptions, BtServer, BtService, WebBluetoothLike } from '../src/index.ts';

/** Avance l'horloge par pas jusqu'à ce que la promesse soit résolue (ou échoue). */
export async function settle<T>(clock: ManualClock, p: Promise<T>, stepMs = 25, maxMs = 60000): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  p.then(
    (v) => {
      done = true;
      value = v;
    },
    (e: unknown) => {
      done = true;
      failed = true;
      error = e;
    },
  );
  for (let t = 0; !done && t < maxMs; t += stepMs) await clock.advance(stepMs);
  if (!done) throw new Error('settle : délai dépassé');
  if (failed) throw error;
  return value as T;
}

type Handler = (e: TauriEvent<unknown>) => void;

export class FakeBridge implements TauriBridge {
  readonly calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  private handlers = new Map<string, Set<Handler>>();
  readonly commands = new Map<string, (args: Record<string, unknown>) => unknown>();

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ command, args });
    const h = this.commands.get(command);
    if (!h) throw new Error(`commande inconnue : ${command}`);
    return (await h(args)) as T;
  }

  async listen<T>(event: string, handler: (e: TauriEvent<T>) => void): Promise<() => void> {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
    return () => set.delete(handler as Handler);
  }

  emit(event: string, payload: unknown): void {
    for (const h of this.handlers.get(event) ?? []) h({ payload });
  }

  callsOf(command: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.command === command).map((c) => c.args);
  }
}

function nativeServices(p: SimPeripheral): NativeGattService[] {
  return p.services.map((s) => ({ uuid: s.uuid.toUpperCase(), characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, properties: c.properties })) }));
}

/** Faux btleplug : commandes ble_* servies par les périphériques du simulateur. */
export function nativeBleBridge(sim: SimulatorTransport): FakeBridge {
  const b = new FakeBridge();
  const conns = new Map<string, SimGattConnection>();
  b.commands.set('ble_list_adapters', () => [
    { id: 'hci0', name: 'Intel Wireless Bluetooth', isDefault: true },
    { id: 'usb1', name: 'Dongle ASUS BT500', isDefault: false },
  ]);
  b.commands.set('ble_select_adapter', () => undefined);
  b.commands.set('ble_start_scan', () => {
    sim.start();
    queueMicrotask(() => {
      for (const p of sim.peripherals.values()) {
        b.emit('ble://discovered', { deviceId: p.key, name: p.name, rssi: p.rssi, services: p.services.map((s) => s.uuid.slice(4, 8)) });
      }
    });
  });
  b.commands.set('ble_stop_scan', () => undefined);
  b.commands.set('ble_connect', (a) => {
    sim.start();
    const p = sim.peripheral(String(a['deviceId']) as never);
    if (!p.online) throw new Error('injoignable');
    const c = new SimGattConnection(p);
    c.onDisconnect(() => b.emit('ble://disconnected', { deviceId: p.key }));
    conns.set(p.key, c);
    return nativeServices(p);
  });
  const conn = (a: Record<string, unknown>) => {
    const c = conns.get(String(a['deviceId']));
    if (!c || c.closed) throw new Error('non connecté');
    return c;
  };
  b.commands.set('ble_read', async (a) => Array.from(await conn(a).read(String(a['service']), String(a['characteristic']))));
  b.commands.set('ble_write', async (a) => conn(a).write(String(a['service']), String(a['characteristic']), Uint8Array.from(a['data'] as number[])));
  b.commands.set('ble_subscribe', async (a) => {
    const service = String(a['service']);
    const characteristic = String(a['characteristic']);
    await conn(a).subscribe(service, characteristic, (d) => b.emit('ble://notification', { deviceId: a['deviceId'], service: service.toUpperCase(), characteristic, data: Array.from(d) }));
  });
  b.commands.set('ble_unsubscribe', () => undefined);
  b.commands.set('ble_disconnect', (a) => conns.get(String(a['deviceId']))?.lost());
  return b;
}

/** Faux serveur Direct Connect (TCP côté Rust) adossé au trainer simulé ; réponses découpées en morceaux. */
export function dirconBridge(sim: SimulatorTransport, chunkSizes: number[] = [3, 7, 1, 64, 5]): FakeBridge {
  const b = new FakeBridge();
  let conn: SimGattConnection | undefined;
  let chunkIdx = 0;
  const send = (frame: Uint8Array) => {
    // Découpe volontaire en morceaux de tailles variées pour exercer le réassembleur.
    let i = 0;
    while (i < frame.length) {
      const n = chunkSizes[chunkIdx++ % chunkSizes.length] ?? 8;
      b.emit('dircon://data', { connectionId: 'c1', data: Array.from(frame.subarray(i, i + n)) });
      i += n;
    }
  };
  const serviceOf = (p: SimPeripheral, ch: string) => p.services.find((s) => s.characteristics.some((c) => c.uuid === ch))?.uuid ?? '';
  const propBits = (props: string[]) =>
    (props.includes('read') ? 1 : 0) | (props.includes('write') || props.includes('writeWithoutResponse') ? 2 : 0) | (props.includes('notify') ? 4 : 0) | (props.includes('indicate') ? 8 : 0);
  const reassembler = new DirconReassembler();
  b.commands.set('dircon_discover', () => [{ name: 'KICKR CORE 2 SIM', host: '192.168.1.50', port: 36866, serialNumber: 'SIM123', services: ['1826', '1818'] }]);
  b.commands.set('dircon_connect', () => {
    sim.start();
    const p = sim.peripheral('trainer');
    if (!p.online) throw new Error('connexion refusée');
    conn = new SimGattConnection(p);
    conn.onDisconnect(() => b.emit('dircon://closed', { connectionId: 'c1' }));
    return 'c1';
  });
  b.commands.set('dircon_close', () => conn?.lost());
  b.commands.set('dircon_send', async (a) => {
    const p = sim.peripheral('trainer');
    for (const pkt of reassembler.push(Uint8Array.from(a['data'] as number[]))) {
      const c = conn;
      if (!c) continue;
      switch (pkt.messageId) {
        case DIRCON_MSG.discoverServices:
          send(dirconDiscoverServicesResponse(pkt.sequence, p.services.map((s) => s.uuid)));
          break;
        case DIRCON_MSG.discoverCharacteristics: {
          const svcUuid = bytesToUuid(pkt.payload.subarray(0, 16));
          const svc = p.services.find((s) => s.uuid === svcUuid);
          if (!svc) send(dirconErrorResponse(pkt.messageId, pkt.sequence, 0x03));
          else send(dirconDiscoverCharacteristicsResponse(pkt.sequence, svcUuid, svc.characteristics.map((x) => ({ uuid: x.uuid, properties: propBits(x.properties) }))));
          break;
        }
        case DIRCON_MSG.readCharacteristic: {
          const { characteristic } = parseCharacteristicPayload(pkt.payload);
          try {
            const data = await c.read(serviceOf(p, characteristic), characteristic);
            send(dirconCharacteristicResponse(pkt.messageId, pkt.sequence, characteristic, data));
          } catch {
            send(dirconCharacteristicResponse(pkt.messageId, pkt.sequence, characteristic, [], 0x05));
          }
          break;
        }
        case DIRCON_MSG.writeCharacteristic: {
          const { characteristic, data } = parseCharacteristicPayload(pkt.payload);
          send(dirconCharacteristicResponse(pkt.messageId, pkt.sequence, characteristic));
          await c.write(serviceOf(p, characteristic), characteristic, data);
          break;
        }
        case DIRCON_MSG.enableCharacteristicNotifications: {
          const { characteristic, data } = parseCharacteristicPayload(pkt.payload);
          if (data[0] === 1) await c.subscribe(serviceOf(p, characteristic), characteristic, (d) => send(dirconNotification(characteristic, d)));
          send(dirconCharacteristicResponse(pkt.messageId, pkt.sequence, characteristic));
          break;
        }
        default:
          send(dirconErrorResponse(pkt.messageId, pkt.sequence, 0x01));
      }
    }
  });
  return b;
}

/** Faux navigator.bluetooth adossé au simulateur. */
export function fakeWebBluetooth(sim: SimulatorTransport): WebBluetoothLike & { lastOptions?: BtRequestOptions } {
  const devices = new Map<string, BtDevice>();
  const makeDevice = (p: SimPeripheral): BtDevice => {
    const listeners = new Set<() => void>();
    let conn: SimGattConnection | undefined;
    const server: BtServer = {
      get connected() {
        return !!conn && !conn.closed;
      },
      async connect() {
        sim.start();
        if (!p.online) throw new Error('NetworkError');
        conn = new SimGattConnection(p);
        conn.onDisconnect(() => {
          for (const l of listeners) l();
        });
        return server;
      },
      disconnect() {
        conn?.lost();
      },
      async getPrimaryServices(): Promise<BtService[]> {
        return p.services.map((s) => ({
          uuid: s.uuid,
          getCharacteristics: async () =>
            s.characteristics.map((c) => {
              const evl = new Set<(ev: { target: unknown }) => void>();
              const ch: BtCharacteristic = {
                uuid: c.uuid,
                properties: {
                  read: c.properties.includes('read'),
                  write: c.properties.includes('write'),
                  writeWithoutResponse: c.properties.includes('writeWithoutResponse'),
                  notify: c.properties.includes('notify'),
                  indicate: c.properties.includes('indicate'),
                },
                value: null,
                readValue: async () => {
                  const d = await conn!.read(s.uuid, c.uuid);
                  return new DataView(d.buffer, d.byteOffset, d.byteLength);
                },
                writeValueWithResponse: async (data) => conn!.write(s.uuid, c.uuid, new Uint8Array(data as ArrayBuffer)),
                writeValueWithoutResponse: async (data) => conn!.write(s.uuid, c.uuid, new Uint8Array(data as ArrayBuffer)),
                startNotifications: async () => {
                  await conn!.subscribe(s.uuid, c.uuid, (d) => {
                    ch.value = new DataView(d.buffer, d.byteOffset, d.byteLength);
                    for (const l of evl) l({ target: ch });
                  });
                  return ch;
                },
                stopNotifications: async () => ch,
                addEventListener: (_t, l) => evl.add(l),
                removeEventListener: (_t, l) => evl.delete(l),
              };
              return ch;
            }),
        }));
      },
    };
    return {
      id: `bt-${p.key}`,
      name: p.name,
      gatt: server,
      addEventListener: (_t, l) => listeners.add(l),
      removeEventListener: (_t, l) => listeners.delete(l),
    };
  };
  const api: WebBluetoothLike & { lastOptions?: BtRequestOptions } = {
    async requestDevice(options) {
      api.lastOptions = options;
      const wanted = (options.filters ?? []).flatMap((f) => f.services ?? []).map((s) => normalizeUuid(s));
      for (const p of sim.peripherals.values()) {
        if (p.services.some((s) => wanted.includes(s.uuid))) {
          const d = devices.get(p.key) ?? makeDevice(p);
          devices.set(p.key, d);
          return d;
        }
      }
      throw new Error('NotFoundError');
    },
    async getDevices() {
      return [...devices.values()];
    },
    async getAvailability() {
      return true;
    },
  };
  return api;
}

export function newClock(): ManualClock {
  return new ManualClock(1000);
}
