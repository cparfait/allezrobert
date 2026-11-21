/** Robustesse des liaisons : page vent FE-C, écouteurs Direct Connect et ANT, délai et reprise de connexion. */
import { describe, expect, it } from 'vitest';
import { decodeFecCommand, encodeFecGeneralFeData } from '@allezrobert/protocols';
import {
  AntTransport,
  Device,
  DeviceManager,
  DirconTransport,
  SimulatorTransport,
  type DeviceLink,
  type DiscoveredDevice,
  type GattConnection,
  type Profile,
  type Transport,
} from '../src/index.ts';
import { FakeBridge, dirconBridge, newClock, settle } from './helpers.ts';

function antBridge(): FakeBridge {
  const b = new FakeBridge();
  b.commands.set('ant_list_sticks', () => [{ id: 'usb-0', name: 'ANT USB-m', vendorId: 0x0fcf, productId: 0x1009 }]);
  for (const c of ['ant_open', 'ant_open_channel', 'ant_send', 'ant_close', 'ant_close_channel']) b.commands.set(c, () => undefined);
  return b;
}

/** Compte les écouteurs encore posés sur le pont. */
function countListeners(b: FakeBridge): () => number {
  let live = 0;
  const listen = b.listen.bind(b);
  b.listen = async (event, handler) => {
    const off = await listen(event, handler);
    live++;
    let done = false;
    return () => {
      if (!done) live--;
      done = true;
      off();
    };
  };
  return () => live;
}

describe('FE-C : page vent (50)', () => {
  it('ne repart que si la valeur encodée change (coefficient 0,01 kg/m, vent 1 km/h)', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const manager = new DeviceManager({ transports: [new AntTransport({ bridge })], clock });
    await manager.scan({ kinds: ['trainer'] });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 30 })) });
    await settle(clock, manager.connect(manager.discovered[0]!));
    const kinds = () => bridge.callsOf('ant_send').map((s) => decodeFecCommand(Uint8Array.from(s['data'] as number[])).kind);

    // La densité de l'air fait varier cw de moins d'un pas du protocole d'une consigne à l'autre.
    for (const cw of [0.3, 0.3004, 0.3012, 0.2996, 0.3049]) await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 2, windSpeedMs: 0, cw }));
    expect(kinds().filter((k) => k === 'windResistance')).toHaveLength(1);
    expect(kinds().filter((k) => k === 'trackResistance')).toHaveLength(5);

    // Un pas franchi (0,30 → 0,31) : la page repart.
    await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 2, windSpeedMs: 0, cw: 0.3051 }));
    expect(kinds().filter((k) => k === 'windResistance')).toHaveLength(2);
    // Vent : 1 km/h de résolution.
    await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 2, windSpeedMs: 0.1, cw: 0.3051 }));
    expect(kinds().filter((k) => k === 'windResistance')).toHaveLength(2);
    await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 2, windSpeedMs: 1, cw: 0.3051 }));
    expect(kinds().filter((k) => k === 'windResistance')).toHaveLength(3);
    await manager.dispose();
  });
});

describe('Direct Connect : écouteurs', () => {
  it('retirés quand la connexion TCP échoue', async () => {
    const clock = newClock();
    const sim = new SimulatorTransport({ clock, devices: ['trainer'] });
    const bridge = dirconBridge(sim);
    const live = countListeners(bridge);
    bridge.commands.set('dircon_connect', () => {
      throw new Error('connexion refusée');
    });
    const dircon = new DirconTransport({ bridge, clock });
    const d = dircon.addManualDevice('10.0.0.7');
    for (let i = 0; i < 5; i++) await expect(dircon.connect(d)).rejects.toThrow(/refusée/);
    expect(live()).toBe(0);
  });
});

describe('ANT+ : écouteur des messages', () => {
  it('un seul après fermeture puis réouverture de la clé', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const live = countListeners(bridge);
    const ant = new AntTransport({ bridge });
    const manager = new DeviceManager({ transports: [ant], clock });
    await manager.scan({ kinds: ['trainer'] });
    // Trois écouteurs : pages, événements de canal, clé retirée.
    expect(live()).toBe(3);
    await ant.close();
    expect(live()).toBe(0);
    await manager.scan({ kinds: ['trainer'] });
    expect(live()).toBe(3);
    await manager.dispose();
  });

  it('canal fermé par la clé : lien perdu et canal libéré ; capteur perdu : le lien reste', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const ant = new AntTransport({ bridge });
    const manager = new DeviceManager({ transports: [ant], clock });
    await manager.scan({ kinds: ['trainer'] });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 30 })) });
    const found = manager.discovered[0]!;
    const link = await ant.connect(found);
    let lost = 0;
    link.onDisconnect(() => lost++);

    // Capteur perdu : le canal repart en recherche de lui-même, rien n'est fermé.
    bridge.emit('ant://channel-event', { channel: 0, kind: 'lost' });
    expect(lost).toBe(0);
    expect(bridge.callsOf('ant_close_channel')).toHaveLength(0);

    bridge.emit('ant://channel-event', { channel: 0, kind: 'closed' });
    await Promise.resolve();
    expect(lost).toBe(1);
    expect(bridge.callsOf('ant_close_channel')).toHaveLength(1);
    // Un événement pour un canal que l'on ne connaît plus est ignoré.
    bridge.emit('ant://channel-event', { channel: 0, kind: 'closed' });
    expect(lost).toBe(1);
    await manager.dispose();
  });

  it('clé retirée : liens perdus, écouteurs retirés, réouverture possible', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const live = countListeners(bridge);
    const ant = new AntTransport({ bridge });
    const manager = new DeviceManager({ transports: [ant], clock });
    await manager.scan({ kinds: ['trainer'] });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 30 })) });
    const link = await ant.connect(manager.discovered[0]!);
    let lost = 0;
    link.onDisconnect(() => lost++);
    const opens = () => bridge.callsOf('ant_open').length;
    expect(opens()).toBe(1);

    bridge.emit('ant://closed', null);
    expect(lost).toBe(1);
    expect(live()).toBe(0);
    // La clé rebranchée est rouverte à la prochaine recherche, avec un seul jeu d'écouteurs.
    await manager.scan({ kinds: ['trainer'] });
    expect(opens()).toBe(2);
    expect(live()).toBe(3);
    await manager.dispose();
  });

  it('retiré si la clé refuse de s’ouvrir', async () => {
    const bridge = antBridge();
    const live = countListeners(bridge);
    bridge.commands.set('ant_open', () => {
      throw new Error('clé occupée');
    });
    const ant = new AntTransport({ bridge });
    await expect(ant.scan({ kinds: ['trainer'] }, () => undefined)).rejects.toThrow();
    expect(live()).toBe(0);
  });
});

class FakeLink implements GattConnection {
  readonly type = 'gatt' as const;
  readonly services = [];
  closed = 0;
  private handlers = new Set<() => void>();
  constructor(readonly deviceId: string) {}
  read(): Promise<Uint8Array> {
    return Promise.reject(new Error('sans objet'));
  }
  write(): Promise<void> {
    return Promise.resolve();
  }
  subscribe(): Promise<() => Promise<void>> {
    return Promise.resolve(() => Promise.resolve());
  }
  async disconnect(): Promise<void> {
    this.closed++;
    this.lose();
  }
  lose(): void {
    for (const h of [...this.handlers]) h();
    this.handlers.clear();
  }
  onDisconnect(handler: () => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

const DESCRIPTOR: DiscoveredDevice = { id: 'faux:1', name: 'Faux capteur', kinds: ['power'], transport: 'simulator', services: [] };

function fakeTransport(connect: () => Promise<DeviceLink>): Transport {
  return { kind: 'simulator', isAvailable: () => Promise.resolve(true), scan: () => Promise.resolve({ stop: () => Promise.resolve() }), connect };
}

describe('Device : délai de connexion et reprise', () => {
  it('referme le lien qui arrive après le délai', async () => {
    const clock = newClock();
    const link = new FakeLink('faux:1');
    const transport = fakeTransport(() => new Promise<DeviceLink>((resolve) => clock.setTimeout(() => resolve(link), 5000)));
    const device = new Device(DESCRIPTOR, transport, { clock, profiles: [], connectTimeoutMs: 1000, reconnect: false });
    const attempt = device.connect();
    attempt.catch(() => undefined);
    await clock.advance(1500);
    await expect(attempt).rejects.toThrow(/Délai/);
    expect(link.closed).toBe(0);
    await clock.advance(5000);
    expect(link.closed).toBe(1);
    expect(device.state).toBe('error');
  });

  it('lien perdu pendant une attache lente : la reconnexion est relancée à la fin de la connexion en cours', async () => {
    const clock = newClock();
    const links: FakeLink[] = [];
    const transport = fakeTransport(() => {
      const l = new FakeLink('faux:1');
      links.push(l);
      return Promise.resolve(l);
    });
    let release: (() => void) | undefined;
    let attaches = 0;
    const slow: Profile = {
      name: 'lent',
      streaming: false,
      attach: () => {
        attaches++;
        // Première attache : bloquée jusqu'à `release` ; les suivantes sont immédiates.
        return attaches === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
      },
      detach: () => undefined,
    };
    const device = new Device(DESCRIPTOR, transport, { clock, profiles: [slow] });
    const first = device.connect();
    await clock.advance(10);
    expect(device.state).toBe('connected');
    links[0]!.lose();
    expect(device.state).toBe('reconnecting');
    // Le premier essai de reconnexion (1 s) tombe pendant l'attache encore en cours.
    await clock.advance(1500);
    expect(links).toHaveLength(1);
    release!();
    await first;
    await clock.advance(10);
    expect(links).toHaveLength(2);
    expect(device.state).toBe('connected');
    expect(attaches).toBe(2);
    // Pas de double connexion ensuite.
    await clock.advance(60000);
    expect(links).toHaveLength(2);
    await device.disconnect();
  });
});
