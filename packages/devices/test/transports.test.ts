import { describe, expect, it } from 'vitest';
import {
  encodeFecGeneralFeData,
  encodeFecSpecificTrainerData,
  encodePwrStandardPowerOnly,
  encodePwrTePs,
  encodeAntHeartRatePage,
  decodeFecCommand,
  SERVICE,
} from '@allezrobert/protocols';
import type { PowerSample, TrainerSample } from '@allezrobert/shared';
import {
  AntTransport,
  DeviceManager,
  DirconTransport,
  FtmsTrainer,
  NativeBleTransport,
  SimulatorTransport,
  WebBluetoothTransport,
  type DiscoveredDevice,
  type ManagedPowerSample,
} from '../src/index.ts';
import { FakeBridge, dirconBridge, fakeWebBluetooth, nativeBleBridge, newClock, settle } from './helpers.ts';

describe('NativeBleTransport (contrat Tauri ble_*)', () => {
  it('adaptateurs, recherche, connexion FTMS, ERG, notifications, perte de liaison', async () => {
    const clock = newClock();
    const sim = new SimulatorTransport({ clock, devices: ['trainer', 'heartRate'] });
    const bridge = nativeBleBridge(sim);
    const ble = new NativeBleTransport({ bridge });
    const manager = new DeviceManager({ transports: [ble], clock });

    expect(await ble.isAvailable()).toBe(true);
    expect((await manager.listAdapters()).map((a) => a.id)).toEqual(['hci0', 'usb1']);
    await manager.selectAdapter('usb1');
    expect(bridge.callsOf('ble_select_adapter')).toEqual([{ adapterId: 'usb1' }]);

    await manager.scan({ kinds: ['trainer', 'heartRate'] });
    await clock.advance(10);
    expect(bridge.callsOf('ble_start_scan')[0]?.['services']).toContain(SERVICE.fitnessMachine);
    const ids = manager.discovered.map((d) => d.id).sort();
    expect(ids).toEqual(['native-ble:heartRate', 'native-ble:trainer']);
    expect(manager.discovered.find((d) => d.id === 'native-ble:trainer')?.kinds).toEqual(['trainer']);
    await manager.stopScan();
    expect(bridge.callsOf('ble_stop_scan')).toHaveLength(1);

    const trainer = await settle(clock, manager.connect('native-ble:trainer'));
    expect((trainer.trainer as FtmsTrainer).hasControl).toBe(true);
    const samples: TrainerSample[] = [];
    manager.on('trainer', (s) => samples.push(s));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 220 }));
    await clock.advance(8000);
    expect(sim.state.ergTargetW).toBe(220);
    expect(samples.at(-1)?.watts).toBeGreaterThan(200);
    expect(bridge.callsOf('ble_write').some((a) => (a['data'] as number[])[0] === 0x05 && a['withResponse'] === true)).toBe(true);

    sim.dropConnection('trainer', 500);
    expect(trainer.state).toBe('reconnecting');
    await clock.advance(1500);
    expect(trainer.state).toBe('connected');
    await manager.dispose();
  });
});

describe('DirconTransport (contrat Tauri dircon_*)', () => {
  it('découverte mDNS, GATT via DirCon (réponses découpées), FTMS en simulation', async () => {
    const clock = newClock();
    const sim = new SimulatorTransport({ clock, devices: ['trainer'] });
    const bridge = dirconBridge(sim);
    const dircon = new DirconTransport({ bridge, clock });
    const manager = new DeviceManager({ transports: [dircon], clock });
    await manager.scan();
    await clock.advance(10);
    const d = manager.discovered[0] as DiscoveredDevice;
    expect(d).toMatchObject({ id: 'dircon:SIM123', name: 'KICKR CORE 2 SIM', transport: 'dircon', address: { host: '192.168.1.50', port: 36866 } });
    expect(d.kinds).toEqual(['trainer']);

    const trainer = await settle(clock, manager.connect(d));
    expect(trainer.state).toBe('connected');
    expect(trainer.info.manufacturer).toMatch(/Wahoo/);
    const ftms = trainer.trainer as FtmsTrainer;
    expect(ftms.hasControl).toBe(true);
    expect(ftms.feature?.targetSettings.indoorBikeSimulation).toBe(true);

    await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 7.5, windSpeedMs: 2 }));
    expect(sim.state).toMatchObject({ trainerMode: 'simulation', gradePercent: 7.5, windSpeedMs: 2 });
    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await clock.advance(5000);
    expect(power.length).toBeGreaterThan(5);

    // Fermeture TCP côté trainer → reconnexion automatique.
    sim.dropConnection('trainer', 100);
    expect(trainer.state).toBe('reconnecting');
    await clock.advance(2000);
    expect(trainer.state).toBe('connected');
    await manager.dispose();
    expect(bridge.callsOf('dircon_close').length).toBeGreaterThan(0);
  });

  it('ajout manuel par adresse IP', async () => {
    const dircon = new DirconTransport({ bridge: new FakeBridge() });
    const d = dircon.addManualDevice('10.0.0.7');
    expect(d).toMatchObject({ id: 'dircon:10.0.0.7:36866', transport: 'dircon', address: { host: '10.0.0.7', port: 36866 } });
  });
});

describe('WebBluetoothTransport', () => {
  it('requestDevice avec filtres + optionalServices, GATT, notifications', async () => {
    const clock = newClock();
    const sim = new SimulatorTransport({ clock, devices: ['heartRate', 'pedals'] });
    const bt = fakeWebBluetooth(sim);
    const web = new WebBluetoothTransport({ bluetooth: bt });
    const manager = new DeviceManager({ transports: [web], clock });
    await manager.scan({ kinds: ['heartRate'] });
    expect(bt.lastOptions?.filters).toContainEqual({ services: [SERVICE.heartRate] });
    expect(bt.lastOptions?.optionalServices).toContain(SERVICE.battery);
    const d = manager.discovered[0]!;
    expect(d).toMatchObject({ id: 'web-bluetooth:bt-heartRate', kinds: ['heartRate'] });
    const hr = await settle(clock, manager.connect(d));
    const bpm: number[] = [];
    manager.on('heartRate', (h) => bpm.push(h.bpm));
    await clock.advance(4000);
    expect(bpm.length).toBeGreaterThanOrEqual(3);
    expect(hr.battery).toBe(95);
    expect(hr.info.model).toBe('TICKR');
    await manager.dispose();
  });

  it('indisponible sans navigator.bluetooth', async () => {
    const web = new WebBluetoothTransport({});
    expect(await web.isAvailable()).toBe(false);
  });
});

describe('AntTransport (contrat Tauri ant_*)', () => {
  function antBridge() {
    const b = new FakeBridge();
    b.commands.set('ant_list_sticks', () => [{ id: 'usb-0', name: 'ANT USB-m', vendorId: 0x0fcf, productId: 0x1009 }]);
    b.commands.set('ant_open', () => undefined);
    b.commands.set('ant_open_channel', () => undefined);
    b.commands.set('ant_send', () => undefined);
    b.commands.set('ant_close', () => undefined);
    b.commands.set('ant_close_channel', () => undefined);
    return b;
  }

  it('FE-C : recherche par canal joker, données page 16/25, commandes acquittées', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const ant = new AntTransport({ bridge, networkKey: '00 11 22 33 44 55 66 77' });
    const manager = new DeviceManager({ transports: [ant], clock });
    await manager.scan({ kinds: ['trainer'] });
    const open = bridge.callsOf('ant_open');
    expect(open[0]).toEqual({ stickId: 'usb-0', networkKey: [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77] });
    expect(bridge.callsOf('ant_open_channel')[0]).toEqual({ channel: 0, deviceType: 17, deviceNumber: 0, transmissionType: 0, period: 8192, rfFreq: 57 });
    expect(manager.discovered).toHaveLength(0);
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 32.4 })) });
    expect(manager.discovered[0]).toMatchObject({ id: 'ant-usb:fitnessEquipment:0', kinds: ['trainer'] });

    const trainer = await settle(clock, manager.connect(manager.discovered[0]!));
    expect(bridge.callsOf('ant_open_channel')).toHaveLength(1); // canal de recherche réutilisé
    const samples: TrainerSample[] = [];
    manager.on('trainer', (s) => samples.push(s));
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 32.4 })) });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecSpecificTrainerData({ eventCount: 1, cadenceRpm: 88, accumulatedPowerW: 240, powerW: 240 })) });
    expect(samples.at(-1)).toMatchObject({ watts: 240, cadence: 88 });
    expect(samples.at(-1)?.speedKmh).toBeCloseTo(32.4, 1);

    await settle(clock, manager.sendTrainer({ kind: 'simulation', gradePercent: 4 }));
    const sends = bridge.callsOf('ant_send');
    const pages = sends.map((s) => decodeFecCommand(Uint8Array.from(s['data'] as number[])));
    expect(pages.map((p) => p.kind)).toEqual(['windResistance', 'trackResistance']);
    expect(pages[1]).toMatchObject({ gradePercent: 4, crr: 0.004 });
    expect(sends.every((s) => s['acknowledged'] === true && s['channel'] === 0)).toBe(true);
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 210 }));
    expect(decodeFecCommand(Uint8Array.from(bridge.callsOf('ant_send').at(-1)!['data'] as number[]))).toEqual({ page: 0x31, kind: 'targetPower', watts: 210 });
    expect(trainer.state).toBe('connected');
    await manager.dispose();
  });

  it('PWR : TE/PS (page 0x13) fusionnés dans les échantillons de puissance ; HR', async () => {
    const clock = newClock();
    const bridge = antBridge();
    const ant = new AntTransport({ bridge });
    const manager = new DeviceManager({ transports: [ant], clock });
    await manager.scan({ kinds: ['power', 'heartRate'] });
    expect(bridge.callsOf('ant_open')[0]).toEqual({ stickId: 'usb-0' }); // pas de clé : l'app desktop utilise sa config
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodePwrStandardPowerOnly({ eventCount: 1, powerW: 200, accumulatedPowerW: 200, cadenceRpm: 90, rightPercent: 49 })) });
    bridge.emit('ant://message', { channel: 1, data: Array.from(encodeAntHeartRatePage({ eventTime: 1024, beatCount: 1, bpm: 120 })) });
    const pwr = await settle(clock, manager.connect('ant-usb:power:0'));
    await settle(clock, manager.connect('ant-usb:heartRate:1'));
    const power: PowerSample[] = [];
    const hr: number[] = [];
    manager.on('power', (p) => power.push(p));
    manager.on('heartRate', (h) => hr.push(h.bpm));
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodePwrTePs({ eventCount: 2, teLeft: 80, teRight: 78, psLeft: 25, psRight: 24 })) });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodePwrStandardPowerOnly({ eventCount: 2, powerW: 210, accumulatedPowerW: 410, cadenceRpm: 91, rightPercent: 49 })) });
    bridge.emit('ant://message', { channel: 1, data: Array.from(encodeAntHeartRatePage({ eventTime: 2048, beatCount: 2, bpm: 121 })) });
    expect(power.at(-1)).toMatchObject({ watts: 210, cadence: 91, balanceLeft: 51, teLeft: 80, teRight: 78, psLeft: 25, psRight: 24 });
    expect(hr).toEqual([121]);
    expect(pwr.state).toBe('connected');
    await manager.dispose();
  });
});
