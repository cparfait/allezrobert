/**
 * Parcours matériel de bout en bout en simulation : calibration (FTMS et FE-C), ventilateur asservi,
 * Di2 D-Fly, télécommande HID, sélecteur Web Bluetooth « tous les appareils ».
 * Aucun de ces tests ne remplace l'essai sur le vrai matériel : voir docs/HARDWARE_TEST.md.
 */
import { describe, expect, it } from 'vitest';
import type { ShiftEvent } from '@allezrobert/shared';
import { encodeFecCalibrationInProgress, encodeFecCalibrationResponse, decodeFecCommand, encodeFecGeneralFeData } from '@allezrobert/protocols';
import {
  AntTransport,
  DEFAULT_HID_REMOTE_BINDINGS,
  DeviceManager,
  FanController,
  KeyboardShifter,
  ManualClock,
  SimulatorTransport,
  WebBluetoothTransport,
  fanTargetPercent,
  type CalibrationEvent,
} from '../src/index.ts';
import { FakeBridge, newClock, settle } from './helpers.ts';

async function simManager(simOptions: ConstructorParameters<typeof SimulatorTransport>[0] = {}, experimental = {}) {
  const clock = newClock();
  const sim = new SimulatorTransport({ clock, seed: 3, ...simOptions });
  const manager = new DeviceManager({ transports: [sim], clock });
  manager.setExperimental(experimental);
  await manager.scan();
  return { clock, sim, manager };
}

describe('calibration (spin-down) par le gestionnaire', () => {
  it('FTMS : déroulé complet relayé avec l’identifiant du trainer', async () => {
    const { clock, manager } = await simManager({ devices: ['trainer'] });
    await settle(clock, manager.connect('simulator:trainer'));
    expect(manager.calibrationSupport()).toBe('supported');
    const cal: Array<CalibrationEvent & { deviceId: string }> = [];
    manager.on('calibration', (c) => cal.push(c));
    await settle(clock, manager.startCalibration());
    await clock.advance(10000);
    expect(cal.map((c) => c.status)).toEqual(['started', 'requested', 'requested', 'stopPedaling', 'success']);
    expect(cal.every((c) => c.deviceId === 'simulator:trainer')).toBe(true);
    await manager.dispose();
  });

  it('FTMS : trainer sans spin-down (bit 15 absent) → « unsupported » sans rien écrire', async () => {
    const { clock, sim, manager } = await simManager({ devices: ['trainer'], trainer: { spinDown: false } });
    await settle(clock, manager.connect('simulator:trainer'));
    expect(manager.calibrationSupport()).toBe('unsupported');
    const cal: CalibrationEvent[] = [];
    manager.on('calibration', (c) => cal.push(c));
    const before = sim.state.trainerMode;
    await settle(clock, manager.startCalibration());
    expect(cal).toHaveLength(1);
    expect(cal[0]).toMatchObject({ status: 'unsupported' });
    expect(cal[0]?.reason).toMatch(/bit 15/);
    expect(sim.state.trainerMode).toBe(before);
    await manager.dispose();
  });

  it('sans trainer : erreur explicite', async () => {
    const { manager } = await simManager({ devices: ['pedals'] });
    await expect(manager.startCalibration()).rejects.toThrow(/home trainer/);
    expect(manager.calibrationSupport()).toBe('unknown');
  });

  it('FE-C (ANT+) : page 1 envoyée, pages 2 puis 1 décodées en étapes', async () => {
    const clock = newClock();
    const bridge = new FakeBridge();
    bridge.commands.set('ant_list_sticks', () => [{ id: 'usb-0', name: 'ANT USB-m', vendorId: 0x0fcf, productId: 0x1009 }]);
    for (const c of ['ant_open', 'ant_open_channel', 'ant_send', 'ant_close', 'ant_close_channel']) bridge.commands.set(c, () => undefined);
    const manager = new DeviceManager({ transports: [new AntTransport({ bridge, networkKey: '00 11 22 33 44 55 66 77' })], clock });
    await manager.scan({ kinds: ['trainer'] });
    bridge.emit('ant://message', { channel: 0, data: Array.from(encodeFecGeneralFeData({ speedKmh: 0 })) });
    await settle(clock, manager.connect(manager.discovered[0]!));
    const cal: CalibrationEvent[] = [];
    manager.on('calibration', (c) => cal.push(c));
    await settle(clock, manager.startCalibration());
    const last = bridge.callsOf('ant_send').at(-1)!;
    expect(Array.from(last['data'] as number[])).toEqual([0x01, 0x80, 0, 0, 0, 0, 0, 0]);
    expect(decodeFecCommand(Uint8Array.from(last['data'] as number[]))).toMatchObject({ kind: 'calibration', spinDown: true });
    const page = (b: Uint8Array) => bridge.emit('ant://message', { channel: 0, data: Array.from(b) });
    page(encodeFecCalibrationInProgress({ spinDownPending: true, speedCondition: 'tooLow', temperatureCondition: 'ok', temperatureC: 21, targetSpeedKmh: 32 }));
    page(encodeFecCalibrationInProgress({ spinDownPending: true, speedCondition: 'tooLow', temperatureCondition: 'ok', temperatureC: 21, targetSpeedKmh: 32 }));
    page(encodeFecCalibrationInProgress({ spinDownPending: true, speedCondition: 'ok', temperatureCondition: 'ok', temperatureC: 21, targetSpeedKmh: 32 }));
    page(encodeFecCalibrationResponse({ spinDownSuccess: true, temperatureC: 21, spinDownTimeMs: 4200 }));
    page(encodeFecCalibrationResponse({ spinDownSuccess: true, temperatureC: 21, spinDownTimeMs: 4200 })); // rediffusion ignorée
    expect(cal.map((c) => c.status)).toEqual(['started', 'requested', 'stopPedaling', 'success']);
    expect(cal[1]?.targetSpeedLowKmh).toBeCloseTo(32, 1);
    expect(cal[3]).toMatchObject({ spinDownTimeMs: 4200, temperatureC: 21 });
    await manager.dispose();
  });
});

describe('ventilateur asservi (logique pure)', () => {
  it('consignes par mode', () => {
    const ctx = { speedKmh: 24, heartRateBpm: 148, gradePercent: 4 };
    expect(fanTargetPercent({ mode: 'off', manualPercent: 80 }, ctx)).toBe(0);
    expect(fanTargetPercent({ mode: 'manual', manualPercent: 80 }, ctx)).toBe(80);
    expect(fanTargetPercent({ mode: 'manual', manualPercent: 140 }, ctx)).toBe(100);
    expect(fanTargetPercent({ mode: 'speed', manualPercent: 0 }, ctx)).toBe(50); // 24 / 48 km/h
    expect(fanTargetPercent({ mode: 'speed', manualPercent: 0 }, { ...ctx, speedKmh: 60 })).toBe(100);
    // 148 / 185 = 0,8 → (0,8 − 0,5) / 0,4 = 75 %
    expect(fanTargetPercent({ mode: 'heartRate', manualPercent: 0 }, ctx)).toBe(75);
    expect(fanTargetPercent({ mode: 'heartRate', manualPercent: 0, maxHeartRateBpm: 200 }, { ...ctx, heartRateBpm: 90 })).toBe(0);
    expect(fanTargetPercent({ mode: 'heartRate', manualPercent: 0 }, { speedKmh: 24, gradePercent: 0 })).toBe(0);
    expect(fanTargetPercent({ mode: 'grade', manualPercent: 0 }, ctx)).toBe(70); // 30 + 4 × 10
    expect(fanTargetPercent({ mode: 'grade', manualPercent: 0 }, { ...ctx, gradePercent: 9 })).toBe(100);
    expect(fanTargetPercent({ mode: 'grade', manualPercent: 0 }, { ...ctx, gradePercent: -5, speedKmh: 45 })).toBe(94);
    expect(fanTargetPercent({ mode: 'grade', manualPercent: 0 }, { ...ctx, speedKmh: 0 })).toBe(0);
  });

  it('bande morte, intervalle minimal, arrêt prioritaire, renvoi périodique', () => {
    const fan = new FanController({ mode: 'speed', manualPercent: 0 }, { deadbandPercent: 5, minIntervalMs: 2000, keepAliveMs: 30000 });
    expect(fan.update({ speedKmh: 24, gradePercent: 0 }, 0)).toBe(50);
    expect(fan.update({ speedKmh: 25, gradePercent: 0 }, 3000)).toBeUndefined(); // 52 % : sous la bande morte
    expect(fan.update({ speedKmh: 30, gradePercent: 0 }, 3500)).toBe(63);
    expect(fan.update({ speedKmh: 40, gradePercent: 0 }, 4000)).toBeUndefined(); // trop tôt
    expect(fan.update({ speedKmh: 40, gradePercent: 0 }, 5600)).toBe(83);
    expect(fan.update({ speedKmh: 0, gradePercent: 0 }, 8000)).toBe(0);
    expect(fan.update({ speedKmh: 1, gradePercent: 0 }, 10500)).toBe(2); // remise en route malgré la bande morte
    expect(fan.update({ speedKmh: 1, gradePercent: 0 }, 41000)).toBe(2); // renvoi périodique
    fan.settings = { mode: 'manual', manualPercent: 25 };
    fan.reset();
    expect(fan.update({ speedKmh: 1, gradePercent: 0 }, 41100)).toBe(25);
    expect(fan.lastPercent).toBe(25);
  });
});

describe('KICKR HEADWIND simulé piloté par le jeu', () => {
  it('mode manuel imposé puis vitesse (pas de 25 %)', async () => {
    const { clock, sim, manager } = await simManager({ devices: ['headwind'] }, { headwind: true });
    await settle(clock, manager.connect('simulator:headwind'));
    expect(manager.roles.fan).toBe('simulator:headwind');
    const fan = new FanController({ mode: 'speed', manualPercent: 0 });
    const pct = fan.update({ speedKmh: 30, gradePercent: 0 }, clock.now());
    expect(pct).toBe(63);
    await settle(clock, manager.sendFan({ kind: 'speed', percent: pct! }));
    expect(sim.state.fanMode).toBe('manual');
    expect(sim.state.fanSpeedPercent).toBe(75); // 63 % arrondi au pas de 25 % (seules valeurs observées)
    await settle(clock, manager.sendFan({ kind: 'mode', mode: 'off' }));
    expect(sim.state.fanMode).toBe('off');
    await manager.dispose();
  });

  it('adaptateur désactivé : pas de rôle ventilateur', async () => {
    const { clock, manager } = await simManager({ devices: ['headwind'] });
    await settle(clock, manager.connect('simulator:headwind'));
    expect(manager.roles.fan).toBeUndefined();
    await expect(manager.sendFan({ kind: 'speed', percent: 50 })).rejects.toThrow(/ventilateur/);
    await manager.dispose();
  });
});

describe('Shimano Di2 en D-Fly (simulé)', () => {
  it('canaux 1 et 2 → monter / descendre ; canaux non affectés ignorés', async () => {
    const { clock, sim, manager } = await simManager({ devices: ['dfly'] }, { shimanoDfly: true });
    const found = manager.discovered.find((d) => d.id === 'simulator:dfly');
    expect(found?.kinds).toContain('shifter');
    await settle(clock, manager.connect('simulator:dfly'));
    expect(manager.roles.shifters).toContain('simulator:dfly');
    const shifts: Array<ShiftEvent & { sourceId: string }> = [];
    manager.on('shift', (s) => shifts.push(s));
    sim.dflyHello(); // première trame : initialisation seulement
    sim.pressDfly(1);
    sim.pressDfly(1);
    sim.pressDfly(2);
    sim.pressDfly(2, 'long');
    expect(shifts.map((s) => s.action)).toEqual(['up', 'up', 'down', 'down']);
    expect(shifts.every((s) => s.sourceId === 'simulator:dfly')).toBe(true);
    await manager.dispose();
  });

  it('adaptateur désactivé : le Di2 n’est pas une commande', async () => {
    const clock = newClock();
    const sim = new SimulatorTransport({ clock, devices: ['dfly'] });
    const manager = new DeviceManager({ transports: [sim], clock });
    await manager.scan();
    await settle(clock, manager.connect('simulator:dfly'));
    expect(manager.roles.shifters).toEqual([]);
    const shifts: unknown[] = [];
    manager.on('shift', (s) => shifts.push(s));
    sim.dflyHello();
    sim.pressDfly(1);
    expect(shifts).toEqual([]);
    await manager.dispose();
  });
});

describe('télécommande HID (vue comme un clavier)', () => {
  it('touches apprises et touches multimédia, source distincte du clavier', () => {
    const listeners: Array<(e: never) => void> = [];
    const target = { addEventListener: (_: string, l: (e: never) => void) => listeners.push(l), removeEventListener: () => listeners.pop() };
    const hid = new KeyboardShifter({ target: target as never, clock: new ManualClock(0), id: 'hid', name: 'Télécommande HID', bindings: { ...DEFAULT_HID_REMOTE_BINDINGS, AudioVolumeUp: 'up', AudioVolumeDown: 'down' } });
    expect(hid.id).toBe('hid');
    const got: string[] = [];
    hid.on('shift', (e) => got.push(e.action));
    hid.start();
    const key = (code: string) => listeners[0]!({ code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault: () => undefined } as never);
    key('MediaTrackNext');
    key('AudioVolumeDown');
    key('ArrowUp'); // géré par le clavier du jeu, pas par la télécommande
    expect(got).toEqual(['up', 'down']);
    hid.stop();
  });
});

describe('Web Bluetooth : sélecteur « tous les appareils »', () => {
  it('acceptAllDevices avec tous les services connus en optionnel', () => {
    const web = new WebBluetoothTransport({ bluetooth: { requestDevice: () => Promise.reject(new Error('non')) } });
    const all = web.buildRequestOptions({ kinds: ['shifter'], acceptAll: true, experimental: { shimanoDfly: true } });
    expect(all.acceptAllDevices).toBe(true);
    expect(all.filters).toBeUndefined();
    expect(all.optionalServices).toContain('000018ef-5348-494d-414e-4f5f424c4500');
    // Rôle sans adaptateur activé : plutôt que des filtres vides (refusés par le navigateur), tout afficher.
    expect(web.buildRequestOptions({ kinds: ['fan'] }).acceptAllDevices).toBe(true);
    // Cas normal : filtres par service.
    const ftms = web.buildRequestOptions({ kinds: ['trainer'] });
    expect(ftms.acceptAllDevices).toBeUndefined();
    expect(ftms.filters?.[0]).toEqual({ services: ['00001826-0000-1000-8000-00805f9b34fb'] });
  });
});
