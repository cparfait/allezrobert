import { describe, expect, it } from 'vitest';
import { CHAR, SERVICE, TACX_FEC, ZWIFT_CONTROLLER, encodeIndoorBikeData, parseCyclingPowerMeasurement, fromHex } from '@allezrobert/protocols';
import {
  AssiomaModeDetector,
  GamepadShiftMapper,
  GamepadShifter,
  KeyboardShiftMapper,
  KeyboardShifter,
  ManualClock,
  PowerMatchController,
  PowerSmoother,
  SeededRandom,
  createProfiles,
  emptyPairingConfig,
  isTauri,
  kindsFromServices,
  loadTauriBridge,
  parsePairingConfig,
  serializePairingConfig,
  servicesForKinds,
  FtmsTrainer,
  type DeviceEventMap,
  type GattConnection,
  type ProfileContext,
} from '../src/index.ts';

describe('PowerMatchController (boucle PI, logique pure)', () => {
  /** Trainer ERG idéal mais mal étalonné : il lit (1 + biais) × la puissance réelle. */
  function run(bias: number, seconds: number, ctl = new PowerMatchController(), target = 200) {
    let cmd = target;
    let truePower = cmd / (1 + bias);
    const trace: number[] = [];
    for (let t = 0; t < seconds; t += 0.5) {
      truePower += (cmd / (1 + bias) - truePower) * (1 - Math.exp(-0.5 / 1.5));
      cmd = ctl.update(target, truePower, 0.5, 90);
      trace.push(truePower);
    }
    return { ctl, trace };
  }

  it('converge avec une constante de temps de l’ordre de 15 s', () => {
    const { ctl, trace } = run(0.08, 120);
    expect(trace.at(-1)).toBeCloseTo(200, 0);
    expect(ctl.correction).toBeCloseTo(0.08, 2);
    // À ~20 s (5 s de stabilisation + 15 s), une bonne partie de l'écart est résorbée mais pas tout.
    const at20 = trace[40]!;
    expect(at20).toBeGreaterThan(190);
    expect(at20).toBeLessThan(199);
  });

  it('borné à ±15 %', () => {
    expect(run(0.3, 300).ctl.correction).toBeCloseTo(0.15, 6);
    expect(run(-0.18, 300).ctl.correction).toBeCloseTo(-0.15, 6);
    // Écart initial > 25 % : considéré comme un transitoire, jamais intégré (limite assumée).
    expect(run(0.5, 300).ctl.correction).toBe(0);
  });

  it('gèle l’intégrale à l’arrêt de pédalage et pendant les transitoires', () => {
    const ctl = new PowerMatchController({ settleS: 0 });
    ctl.update(200, 150, 0.5, 20);
    expect(ctl.correction).toBe(0);
    ctl.update(200, undefined, 0.5, 90);
    expect(ctl.correction).toBe(0);
    ctl.update(200, 100, 0.5, 90); // −50 % : sprint/relance, pas d'étalonnage
    expect(ctl.correction).toBe(0);
    expect(ctl.update(30, 10, 0.5, 90)).toBe(30); // sous la cible minimale
  });

  it('stabilisation après changement de cible', () => {
    const ctl = new PowerMatchController({ settleS: 5 });
    for (let i = 0; i < 9; i++) ctl.update(200, 190, 0.5, 90);
    expect(ctl.correction).toBe(0);
    for (let i = 0; i < 4; i++) ctl.update(200, 190, 0.5, 90);
    expect(ctl.correction).toBeGreaterThan(0);
  });
});

describe('PowerSmoother', () => {
  it('moyenne sur 3 s glissantes', () => {
    const s = new PowerSmoother(3000);
    expect(s.push(0, 100)).toBe(100);
    expect(s.push(1000, 200)).toBe(150);
    expect(s.push(2000, 300)).toBe(200);
    expect(s.push(3000, 400)).toBe(300); // l'échantillon t=0 sort de la fenêtre
  });
});

describe('détecteur Assioma', () => {
  it('avertit après 10 trames sans balance avec référence gauche seule', () => {
    const d = new AssiomaModeDetector('ASSIOMA 12345L');
    const single = parseCyclingPowerMeasurement(fromHex('22 00 C8 00 0A 00 00 10')); // réf. gauche, sans balance
    const warns = Array.from({ length: 12 }, () => d.update(single));
    expect(warns.filter(Boolean)).toHaveLength(1);
    expect(warns.indexOf(true)).toBe(9);
  });
  it('silencieux dès qu’une balance arrive', () => {
    const d = new AssiomaModeDetector('ASSIOMA');
    const withBalance = parseCyclingPowerMeasurement(fromHex('23 00 C8 00 62 0A 00 00 10'));
    for (let i = 0; i < 20; i++) expect(d.update(withBalance)).toBe(false);
  });
  it('autre capteur sans balance ni référence : pas d’alerte', () => {
    const d = new AssiomaModeDetector('4iiii');
    const plain = parseCyclingPowerMeasurement(fromHex('20 00 C8 00 0A 00 00 10'));
    for (let i = 0; i < 20; i++) expect(d.update(plain)).toBe(false);
  });
});

describe('vitesses : clavier et manette', () => {
  it('clavier : correspondances, répétition et champs de saisie ignorés', () => {
    const m = new KeyboardShiftMapper();
    expect(m.map({ code: 'ArrowUp' }, 5)).toEqual({ t: 5, action: 'up' });
    expect(m.map({ code: 'KeyQ' }, 5)?.action).toBe('frontDown');
    expect(m.map({ code: 'ArrowUp', repeat: true }, 5)).toBeUndefined();
    expect(m.map({ code: 'ArrowUp', editable: true }, 5)).toBeUndefined();
    expect(m.map({ code: 'ArrowUp', ctrlKey: true }, 5)).toBeUndefined();
    expect(m.map({ code: 'KeyZ' }, 5)).toBeUndefined();
  });

  it('clavier : branché sur une cible d’événements', () => {
    const listeners: Array<(e: never) => void> = [];
    const target = { addEventListener: (_: string, l: (e: never) => void) => listeners.push(l), removeEventListener: () => listeners.pop() };
    const k = new KeyboardShifter({ target: target as never, clock: new ManualClock(42) });
    const got: string[] = [];
    k.on('shift', (e) => got.push(e.action));
    k.start();
    let prevented = 0;
    listeners[0]!({ code: 'ArrowDown', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: { tagName: 'CANVAS' }, preventDefault: () => prevented++ } as never);
    listeners[0]!({ code: 'ArrowDown', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: { tagName: 'INPUT' }, preventDefault: () => prevented++ } as never);
    expect(got).toEqual(['down']);
    expect(prevented).toBe(1);
    k.stop();
    expect(listeners).toHaveLength(0);
  });

  it('manette : fronts montants uniquement, plusieurs manettes', () => {
    const m = new GamepadShiftMapper();
    const pad = (index: number, pressed: number[]) => ({ index, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });
    expect(m.update([pad(0, [5])], 1).map((e) => e.action)).toEqual(['up']);
    expect(m.update([pad(0, [5])], 2)).toEqual([]);
    expect(m.update([pad(0, []), pad(1, [4, 0])], 3).map((e) => e.action)).toEqual(['confirm', 'down']);
    expect(m.update([null, undefined], 4)).toEqual([]);
  });

  it('manette : interrogation périodique sur l’horloge', async () => {
    const clock = new ManualClock();
    let buttons = [false, false, false, false, false, false];
    const g = new GamepadShifter({ clock, intervalMs: 20, getGamepads: () => [{ index: 0, buttons }] });
    const got: string[] = [];
    g.on('shift', (e) => got.push(e.action));
    g.start();
    await clock.advance(50);
    buttons = [false, false, false, false, false, true];
    await clock.advance(50);
    g.stop();
    expect(got).toEqual(['up']);
  });
});

describe('appairages : sérialisation tolérante', () => {
  it('aller-retour', () => {
    const c = emptyPairingConfig();
    c.devices.push({ id: 'native-ble:AA', name: 'KICKR', transport: 'native-ble', kinds: ['trainer'], services: [SERVICE.fitnessMachine], address: { deviceId: 'AA' }, autoConnect: true });
    c.roles.trainer = 'native-ble:AA';
    c.adapterId = 'hci0';
    expect(parsePairingConfig(serializePairingConfig(c))).toEqual(c);
  });
  it('données corrompues ou incomplètes', () => {
    expect(parsePairingConfig('{oups')).toEqual(emptyPairingConfig());
    expect(parsePairingConfig(JSON.stringify({ version: 2 }))).toEqual(emptyPairingConfig());
    const p = parsePairingConfig(JSON.stringify({ version: 1, devices: [{ id: 'x', transport: 'simulator' }, { nope: 1 }], roles: { power: 'x', shifters: ['a', 3] } }));
    expect(p.devices).toEqual([{ id: 'x', transport: 'simulator', name: 'x', kinds: [], services: [], autoConnect: true }]);
    expect(p.roles).toEqual({ power: 'x', shifters: ['a'] });
    expect(p.experimental.zwiftControllers).toBe(false);
    expect(p.powerMatch).toBe(true);
  });
});

describe('reconnaissance des appareils', () => {
  it('rôles déduits des services', () => {
    expect(kindsFromServices([SERVICE.fitnessMachine, SERVICE.cyclingPower])).toEqual(['trainer']);
    expect(kindsFromServices([SERVICE.cyclingPower])).toEqual(['power', 'cadence']);
    expect(kindsFromServices(['180d'])).toEqual(['heartRate']);
    expect(kindsFromServices([TACX_FEC.service])).toEqual(['trainer']);
    expect(kindsFromServices([ZWIFT_CONTROLLER.service], 'Zwift Click')).toEqual([]);
    expect(kindsFromServices([ZWIFT_CONTROLLER.service], 'Zwift Click', { zwiftControllers: true })).toEqual(['shifter']);
  });
  it('services de recherche selon les rôles', () => {
    expect(servicesForKinds(['heartRate'])).toEqual([SERVICE.heartRate]);
    expect(servicesForKinds(['shifter'])).toEqual([]);
    expect(servicesForKinds(['shifter'], { zwiftControllers: true })).toContain(ZWIFT_CONTROLLER.service);
  });
});

describe('Tauri hors app desktop', () => {
  it('détection et chargement refusé', async () => {
    expect(isTauri()).toBe(false);
    await expect(loadTauriBridge()).rejects.toThrow(/desktop/);
  });
});

describe('SeededRandom', () => {
  it('déterministe', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(1);
    expect([a.next(), a.next(), a.gaussian()]).toEqual([b.next(), b.next(), b.gaussian()]);
  });
});

/** Fausse liaison GATT minimale pour tester FtmsTrainer en isolation. */
function fakeFtmsLink(onWrite: (data: Uint8Array, notify: (char: string, d: Uint8Array) => void) => void) {
  const subs = new Map<string, (d: Uint8Array) => void>();
  const notify = (char: string, d: Uint8Array) => subs.get(char)?.(d);
  const link: GattConnection = {
    type: 'gatt',
    deviceId: 'fake',
    services: [
      {
        uuid: SERVICE.fitnessMachine,
        characteristics: [CHAR.indoorBikeData, CHAR.fitnessMachineControlPoint, CHAR.fitnessMachineStatus].map((uuid) => ({ uuid, properties: ['notify'] })),
      },
    ],
    read: async () => {
      throw new Error('non');
    },
    write: async (_s, _c, data) => onWrite(data, notify),
    subscribe: async (_s, c, h) => {
      subs.set(c, h);
      return async () => undefined;
    },
    disconnect: async () => undefined,
    onDisconnect: () => () => undefined,
  };
  return { link, notify };
}

function ctxFor(clock: ManualClock, events: Array<[keyof DeviceEventMap, unknown]>): ProfileContext {
  return {
    deviceId: 'fake',
    deviceName: 'Fake',
    clock,
    now: () => clock.now(),
    emit: (e, p) => events.push([e, p]),
    log: () => undefined,
    warn: (code) => events.push(['warning', code]),
  };
}

describe('FtmsTrainer en isolation', () => {
  it('fusionne les notifications Indoor Bike Data « More Data »', async () => {
    const clock = new ManualClock();
    const events: Array<[keyof DeviceEventMap, unknown]> = [];
    const { link, notify } = fakeFtmsLink((d, n) => setTimeout(() => n(CHAR.fitnessMachineControlPoint, Uint8Array.of(0x80, d[0]!, 0x01)), 0));
    const t = new FtmsTrainer();
    await t.attach(link, ctxFor(clock, events));
    notify(CHAR.indoorBikeData, encodeIndoorBikeData({ moreData: true, instantaneousPowerW: 230 }));
    expect(events.filter(([e]) => e === 'trainer')).toHaveLength(0);
    notify(CHAR.indoorBikeData, encodeIndoorBikeData({ instantaneousSpeedKmh: 31, instantaneousCadenceRpm: 92 }));
    const tr = events.filter(([e]) => e === 'trainer').map(([, p]) => p);
    expect(tr).toEqual([{ t: 0, watts: 230, cadence: 92, speedKmh: 31 }]);
  });

  it('délai dépassé sans réponse : la file continue', async () => {
    const clock = new ManualClock();
    const writes: number[] = [];
    let answer = false;
    const { link } = fakeFtmsLink((d, n) => {
      writes.push(d[0]!);
      if (answer) queueMicrotask(() => n(CHAR.fitnessMachineControlPoint, Uint8Array.of(0x80, d[0]!, 0x01)));
    });
    const t = new FtmsTrainer({ responseTimeoutMs: 1000 });
    const attach = t.attach(link, ctxFor(clock, []));
    await clock.advance(1100); // Request Control sans réponse
    await attach;
    expect(t.hasControl).toBe(false);
    answer = true;
    await clock.advance(6000);
    const sent = t.send({ kind: 'erg', watts: 100 });
    await clock.advance(10);
    await sent;
    expect(t.hasControl).toBe(true);
    expect(writes).toEqual([0x00, 0x00, 0x05]);
  });
});

describe('fabrique de profils', () => {
  it('FTMS prioritaire, CPS ignoré sur un trainer ; adaptateurs expérimentaux sur option', () => {
    const svc = (uuid: string) => ({ uuid, characteristics: [] });
    const link = (uuids: string[]): GattConnection => ({ type: 'gatt', deviceId: 'x', services: uuids.map(svc), read: async () => new Uint8Array(), write: async () => undefined, subscribe: async () => async () => undefined, disconnect: async () => undefined, onDisconnect: () => () => undefined });
    expect(createProfiles(link([SERVICE.fitnessMachine, SERVICE.cyclingPower, SERVICE.battery])).map((p) => p.name)).toEqual(['ftms', 'battery']);
    expect(createProfiles(link([TACX_FEC.service])).map((p) => p.name)).toEqual(['fe-c']);
    expect(createProfiles(link([SERVICE.cyclingPower])).map((p) => p.name)).toEqual(['cycling-power']);
    expect(createProfiles(link([ZWIFT_CONTROLLER.service])).map((p) => p.name)).toEqual([]);
    expect(createProfiles(link([ZWIFT_CONTROLLER.service]), { experimental: { zwiftControllers: true } }).map((p) => p.name)).toEqual(['zwift-controller']);
  });
});
