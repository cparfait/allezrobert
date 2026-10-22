/** Profils expérimentaux issus de la recherche d'octobre 2026 : Click v2 / Ride v2 (Zwift), SRAM AXS. */
import { describe, expect, it } from 'vitest';
import { SRAM_AXS, ZWIFT_CONTROLLER, fromHex, normalizeUuid, toHex } from '@allezrobert/protocols';
import { ManualClock, SramAxsShifter, ZwiftControllerShifter, createProfiles, kindsFromServices, type DeviceEventMap, type GattConnection, type ProfileContext } from '../src/index.ts';

const h = (s: string) => fromHex(s.replace(/\s+/g, ''));

function ctxFor(clock: ManualClock, events: Array<[keyof DeviceEventMap, unknown]>, deviceName = 'Fake'): ProfileContext {
  return {
    deviceId: 'fake',
    deviceName,
    clock,
    now: () => clock.now(),
    emit: (e, p) => events.push([e, p]),
    log: () => undefined,
    warn: (code) => events.push(['warning', code]),
  };
}

/** Faux périphérique GATT : services → caractéristiques, lectures programmables, écritures journalisées. */
function fakeLink(services: Record<string, string[]>, reads: Record<string, () => Uint8Array> = {}) {
  const handlers = new Map<string, (d: Uint8Array) => void>();
  const writes: Array<{ characteristic: string; hex: string }> = [];
  const link: GattConnection = {
    type: 'gatt',
    deviceId: 'fake',
    services: Object.entries(services).map(([uuid, chars]) => ({ uuid, characteristics: chars.map((c) => ({ uuid: c, properties: ['read', 'write', 'notify'] })) })),
    read: async (_s, c) => {
      const r = reads[normalizeUuid(c)];
      if (!r) throw new Error(`lecture inattendue ${c}`);
      return r();
    },
    write: async (_s, c, d) => void writes.push({ characteristic: normalizeUuid(c), hex: toHex(d).replace(/ /g, '') }),
    subscribe: async (_s, c, fn) => {
      handlers.set(normalizeUuid(c), fn);
      return async () => void handlers.delete(normalizeUuid(c));
    },
    disconnect: async () => undefined,
    onDisconnect: () => () => undefined,
  };
  const notify = (c: string, d: Uint8Array) => handlers.get(normalizeUuid(c))?.(d);
  return { link, writes, notify, handlers };
}

const zwiftRide = () => ({ [ZWIFT_CONTROLLER.rideService]: [ZWIFT_CONTROLLER.async, ZWIFT_CONTROLLER.syncRx, ZWIFT_CONTROLLER.syncTx] });
const shifts = (events: Array<[keyof DeviceEventMap, unknown]>) => events.filter(([e]) => e === 'shift').map(([, p]) => (p as { action: string }).action);
const warnings = (events: Array<[keyof DeviceEventMap, unknown]>) => events.filter(([e]) => e === 'warning').map(([, p]) => p);

describe('Zwift Click v2 (profil expérimental)', () => {
  it('palet gauche : boutons relayés du droit ignorés, « − » = descendre, batterie champ 2', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link, notify } = fakeLink(zwiftRide());
    const p = new ZwiftControllerShifter({ deviceType: 'clickV2Left' });
    await p.attach(link, ctxFor(clock, events));
    notify(ZWIFT_CONTROLLER.syncTx, h('52 69 64 65 4f 6e 02 03'));
    notify(ZWIFT_CONTROLLER.async, h('23 08 ff df ff ff 0f')); // « + » du palet droit, relayé
    notify(ZWIFT_CONTROLLER.async, h('23 08 ff ff ff ff 0f'));
    notify(ZWIFT_CONTROLLER.async, h('23 08 ff fd ff ff 0f')); // « − »
    notify(ZWIFT_CONTROLLER.async, h('19 10 64'));
    expect(shifts(events)).toEqual(['down']);
    expect(events).toContainEqual(['battery', 100]);
    expect(p.lockState).toBe('unlocked');
    p.detach();
  });

  it('maintien en éveil : RideOn toutes les 3 s, arrêté au détachement', async () => {
    const clock = new ManualClock();
    const { link, writes } = fakeLink(zwiftRide());
    const p = new ZwiftControllerShifter({ deviceName: 'Zwift Click' }); // type inconnu (Web Bluetooth) : nom + 0xFC82
    await p.attach(link, ctxFor(clock, []));
    expect(writes).toHaveLength(1); // poignée de main
    await clock.advance(9000);
    expect(writes).toHaveLength(4);
    expect(writes.every((w) => w.hex === '526964654f6e')).toBe(true);
    p.detach();
    await clock.advance(9000);
    expect(writes).toHaveLength(4);
    expect(clock.pendingTimers).toBe(0);
  });

  it('verrouillée : défi ff 03 sans écho RideOn → avertissement après 2 s ; jamais de réponse au défi', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link, writes, notify } = fakeLink(zwiftRide());
    const p = new ZwiftControllerShifter({ deviceType: 'clickV2Left' });
    await p.attach(link, ctxFor(clock, events));
    notify(ZWIFT_CONTROLLER.async, h('ff 03 0a 10 01 02 03'));
    await clock.advance(2100);
    expect(warnings(events)).toContain('zwift-controller-locked');
    // Seuls RideOn (poignée de main + maintien en éveil) ont été écrits.
    expect(writes.every((w) => w.hex === '526964654f6e')).toBe(true);
    p.detach();
  });

  it('défi isolé suivi de l’écho RideOn : pas d’avertissement', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link, notify } = fakeLink(zwiftRide());
    const p = new ZwiftControllerShifter({ deviceType: 'clickV2Right' });
    await p.attach(link, ctxFor(clock, events));
    notify(ZWIFT_CONTROLLER.async, h('ff 03 0a'));
    notify(ZWIFT_CONTROLLER.syncTx, h('52 69 64 65 4f 6e 02 03'));
    await clock.advance(3000);
    expect(warnings(events)).not.toContain('zwift-controller-locked');
    p.detach();
  });

  it('Ride v2 au service masqué : profil créé depuis l’annonce, avertissement ; trainer 0x094A ignoré', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link } = fakeLink({ '0000180f-0000-1000-8000-00805f9b34fb': ['00002a19-0000-1000-8000-00805f9b34fb'] });
    const profiles = createProfiles(link, { experimental: { zwiftControllers: true }, advertisement: { name: 'Zwift Ride', manufacturerData: { '2378': [0x08, 0x01] } } });
    const zp = profiles.find((x) => x.name === 'zwift-controller')!;
    expect((zp as ZwiftControllerShifter).deviceType).toBe('rideLeft');
    await zp.attach(link, ctxFor(clock, events));
    expect(warnings(events)).toContain('zwift-controller-locked');
    const trainer = createProfiles(link, { experimental: { zwiftControllers: true }, advertisement: { name: 'KICKR CORE', manufacturerData: { '2378': [0x42] } } });
    expect(trainer.map((x) => x.name)).toEqual(['battery']);
  });
});

describe('SRAM AXS (profil expérimental)', () => {
  const svc = 'd9050001-90aa-4c7c-b036-1e01fb8eb7ee';
  const chars = [SRAM_AXS.serial, SRAM_AXS.deviceRecord, SRAM_AXS.liveState, SRAM_AXS.buttonEvent, SRAM_AXS.bondV1];
  const record = h('0200000000063702000002015401000000010106402805' + '0067333133636161306564362e64697200');
  // Trames réelles d905000b (GaborWnuk/sram-axs, RD-GX-E-B1) et leur clé.
  const deviceKey = h('1f1dd977bc1c6707e6da9b811608f456');
  const gear1 = h('597c1e0ca539c9e80c9e5f010ac5274a22419e2dcbee1f99fe1b7ce7fae2a4def1caffddbe325cbfc8');
  const gear2 = h('f1dc85b564d7e5fd5468c0464146c63c6c899039efe255ef0c8845cbe308b1ed02758efc9e20efc702');

  it('reconnaissance (désactivée par défaut)', () => {
    const { link } = fakeLink({ [svc]: chars });
    expect(createProfiles(link).map((p) => p.name)).toEqual([]);
    expect(createProfiles(link, { experimental: { sramAxs: true } }).map((p) => p.name)).toEqual(['sram-axs']);
    expect(kindsFromServices([], 'SRAM 1234567890', { sramAxs: true })).toEqual(['shifter']);
    expect(kindsFromServices([], 'SRAM 1234567890')).toEqual([]);
  });

  it('appairé : rapport engagé déchiffré, changement → shift avec realGear', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const frames = [gear1, gear2];
    const { link, writes, notify } = fakeLink({ [svc]: chars }, {
      [SRAM_AXS.serial]: () => h('d2029649'),
      [SRAM_AXS.deviceRecord]: () => record,
      [SRAM_AXS.liveState]: () => frames.shift() ?? gear2,
    });
    const keys = new Map([[1234567890, deviceKey]]);
    const p = new SramAxsShifter({ keyStore: { get: (s) => keys.get(s), set: (s, k) => void keys.set(s, k) } });
    await p.attach(link, ctxFor(clock, events));
    expect(p.serial).toBe(1234567890);
    expect(p.firmware).toBe('2.55.6');
    expect(p.gear).toEqual({ front: 1, rear: 1, rearTrim: 12 });
    notify(SRAM_AXS.liveState, h('ff'));
    await clock.advance(10);
    expect(events.filter(([e]) => e === 'shift').map(([, s]) => s)).toEqual([{ t: 0, action: 'up', realGear: { front: 1, rear: 2 } }]);
    expect(writes).toEqual([]); // lecture seule
    p.detach();
  });

  it('non appairé : avertissement, clic simple = monter, double clic = descendre', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link, notify } = fakeLink({ [svc]: chars }, { [SRAM_AXS.serial]: () => h('d2029649'), [SRAM_AXS.deviceRecord]: () => record });
    const p = new SramAxsShifter();
    await p.attach(link, ctxFor(clock, events));
    expect(warnings(events)).toContain('sram-axs-not-bonded');
    notify(SRAM_AXS.buttonEvent, h('ff'));
    await clock.advance(400);
    notify(SRAM_AXS.buttonEvent, h('ff'));
    await clock.advance(100);
    notify(SRAM_AXS.buttonEvent, h('ff'));
    notify(SRAM_AXS.buttonEvent, h('ff 12 34')); // lecture renvoyée par la pile : ignorée
    await clock.advance(1000);
    expect(shifts(events)).toEqual(['up', 'down']);
    p.detach();
    expect(clock.pendingTimers).toBe(0);
  });

  it('appairage SRAMBond v1 : séquence publiée, clé mémorisée par série', async () => {
    const clock = new ManualClock();
    const reads = [h('9ac11ad0a4f6c2b99c5559e2d210c410'), h('8d7a16ed42128ee445b9864f20324a0e0b9e1982be7a9ad3cf611f453696fa8d2f24f1878c44eb7f77ff5b4a3c616395')];
    const { link, writes } = fakeLink({ [svc]: chars }, {
      [SRAM_AXS.serial]: () => h('d2029649'),
      [SRAM_AXS.deviceRecord]: () => record,
      [SRAM_AXS.bondV1]: () => reads.shift()!,
      [SRAM_AXS.liveState]: () => gear1, // chiffrée avec une autre clé : repli sur les clics
    });
    const keys = new Map<number, Uint8Array>();
    const priv = h('6418b20cb4e1d4cf4af19b184aff1d2a').reverse();
    const p = new SramAxsShifter({ keyStore: { get: (s) => keys.get(s), set: (s, k) => void keys.set(s, k) }, random: () => priv.slice() });
    await p.attach(link, ctxFor(clock, []));
    const key = await p.createBond();
    expect(toHex(key).replace(/ /g, '')).toBe('b0690781867fde13ac1b9d30bbb4004f');
    expect(keys.get(1234567890)).toEqual(key);
    expect(writes.map((w) => w.hex)).toEqual(['000102030405060708090a0b0c0d0e0f', '297ca1db5827261af813875fd09800b0', '73']);
    expect(writes.every((w) => w.characteristic === SRAM_AXS.bondV1)).toBe(true);
    p.detach();
  });
});
