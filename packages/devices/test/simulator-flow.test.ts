import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '@allezrobert/shared';
import {
  DeviceManager,
  FtmsTrainer,
  MemoryPairingStorage,
  SimulatorTransport,
  type CalibrationEvent,
  type DeviceWarning,
  type ManagedPowerSample,
} from '../src/index.ts';
import { newClock, settle } from './helpers.ts';

async function setup(simOptions: ConstructorParameters<typeof SimulatorTransport>[0] = {}) {
  const clock = newClock();
  const sim = new SimulatorTransport({ clock, seed: 7, ...simOptions });
  const storage = new MemoryPairingStorage();
  const manager = new DeviceManager({ transports: [sim], clock, storage });
  await manager.scan();
  return { clock, sim, storage, manager };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

describe('flux FTMS avec le simulateur', () => {
  it('recherche, connexion, prise de contrôle, simulation de pente, ERG, résistance', async () => {
    const { clock, sim, manager } = await setup();
    await manager.scan();
    const found = manager.discovered;
    expect(found.map((d) => d.id).sort()).toEqual(['simulator:click', 'simulator:heartRate', 'simulator:pedals', 'simulator:trainer']);
    expect(found.find((d) => d.id === 'simulator:trainer')?.kinds).toContain('trainer');
    expect(typeof found[0]?.rssi).toBe('number');

    const trainer = await settle(clock, manager.connect('simulator:trainer'));
    expect(trainer.state).toBe('connected');
    expect(manager.roles.trainer).toBe('simulator:trainer');
    expect(trainer.info.model).toBe('KICKR CORE');
    const ftms = trainer.trainer as FtmsTrainer;
    expect(ftms.hasControl).toBe(true);
    expect(ftms.powerRange).toEqual({ min: 0, max: 2000, increment: 1 });
    expect(sim.state.controlOwner).toBeDefined();

    // Boucle de simulation à 4 Hz : les consignes rapprochées sont fusionnées, la dernière l'emporte.
    for (const g of [1, 2, 3, 4, 5.5]) void manager.sendTrainer({ kind: 'simulation', gradePercent: g });
    await clock.advance(1000);
    expect(sim.state.trainerMode).toBe('simulation');
    expect(sim.state.gradePercent).toBe(5.5);
    expect(ftms.pendingCommands).toBe(0);

    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 250 }));
    expect(sim.state.trainerMode).toBe('erg');
    await clock.advance(15000);
    expect(manager.powerSource).toBe('trainer');
    const last = power.slice(-10).map((p) => p.watts);
    expect(mean(last)).toBeGreaterThan(240);
    expect(mean(last)).toBeLessThan(260);
    expect(power.at(-1)?.source).toBe('trainer');

    await settle(clock, manager.sendTrainer({ kind: 'resistance', level: 50 }));
    expect(sim.state.trainerMode).toBe('resistance');
    expect(sim.state.resistanceLevel).toBeCloseTo(5, 5);
    await manager.dispose();
  });

  it('spindown : événements de calibration', async () => {
    const { clock, manager } = await setup({ devices: ['trainer'] });
    const trainer = await settle(clock, manager.connect('simulator:trainer'));
    const cal: CalibrationEvent[] = [];
    trainer.on('calibration', (c) => cal.push(c));
    await settle(clock, manager.sendTrainer({ kind: 'spindown' }));
    await clock.advance(10000);
    expect(cal.map((c) => c.status)).toEqual(['started', 'requested', 'requested', 'stopPedaling', 'success']);
    expect(cal[1]).toMatchObject({ targetSpeedLowKmh: 20, targetSpeedHighKmh: 30 });
    await manager.dispose();
  });
});

describe('reconnexion automatique', () => {
  it('le trainer décroche puis revient : contrôle repris et dernière consigne renvoyée', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer'] });
    const trainer = await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 180 }));
    const states: ConnectionState[] = [];
    trainer.on('state', (s) => states.push(s));

    sim.dropConnection('trainer', 2500);
    // Simule un trainer qui perd la consigne au redémarrage.
    sim.state.trainerMode = 'idle';
    sim.state.controlOwner = undefined;
    expect(trainer.state).toBe('reconnecting');
    await clock.advance(1100); // 1re tentative à 1 s : injoignable
    expect(trainer.state).toBe('reconnecting');
    await clock.advance(3000); // 2e tentative à +2 s : réussie
    expect(trainer.state).toBe('connected');
    expect(states[0]).toBe('reconnecting');
    expect(states.at(-1)).toBe('connected');
    expect((trainer.trainer as FtmsTrainer).hasControl).toBe(true);
    expect(sim.state.trainerMode).toBe('erg');
    expect(sim.state.ergTargetW).toBe(180);
    await manager.dispose();
  });

  it('pas de reconnexion après une déconnexion volontaire', async () => {
    const { clock, manager } = await setup({ devices: ['heartRate'] });
    const hr = await settle(clock, manager.connect('simulator:heartRate'));
    await hr.disconnect();
    await clock.advance(10000);
    expect(hr.state).toBe('disconnected');
    await manager.dispose();
  });
});

describe('capteur muet', () => {
  it('état « silent » après 5 s sans données, puis retour à « connected »', async () => {
    const { clock, sim, manager } = await setup({ devices: ['heartRate'] });
    const hr = await settle(clock, manager.connect('simulator:heartRate'));
    const warnings: DeviceWarning[] = [];
    manager.on('warning', (w) => warnings.push(w));
    const bpm: number[] = [];
    manager.on('heartRate', (h) => bpm.push(h.bpm));
    await clock.advance(3000);
    expect(bpm.length).toBeGreaterThan(1);
    expect(hr.battery).toBe(95);

    sim.silence('heartRate', 9000);
    await clock.advance(4000);
    expect(hr.state).toBe('connected');
    await clock.advance(3000);
    expect(hr.state).toBe('silent');
    expect(warnings.some((w) => w.code === 'sensor-silent')).toBe(true);
    await clock.advance(4000);
    expect(hr.state).toBe('connected');
    await manager.dispose();
  });
});

describe('power match (pédales + trainer en ERG)', () => {
  it('converge vers la cible lue par les pédales malgré un trainer mal étalonné (+8 %)', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer', 'pedals'], trainer: { powerBias: 0.08 } });
    await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.connect('simulator:pedals'));
    expect(manager.roles.power).toBe('simulator:pedals');
    expect(manager.powerSource).toBe('pedals');
    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 200 }));

    await clock.advance(6000);
    const early = mean(power.slice(-4).map((p) => p.watts));
    expect(early).toBeLessThan(195); // sans correction : ~185 W

    await clock.advance(114000);
    const late = mean(power.slice(-40).map((p) => p.watts));
    expect(late).toBeGreaterThan(196);
    expect(late).toBeLessThan(204);
    expect(manager.powerMatch.correction).toBeGreaterThan(0.06);
    expect(manager.powerMatch.correction).toBeLessThan(0.1);
    expect(power.at(-1)?.source).toBe('pedals');
    expect(power.at(-1)?.balanceLeft).toBeDefined();
    expect(sim.state.ergTargetW).toBeGreaterThan(210);
    await manager.dispose();
  });

  it('correction bornée à ±15 %', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer', 'pedals'], trainer: { powerBias: 0.3 } });
    await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.connect('simulator:pedals'));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 200 }));
    await clock.advance(150000);
    expect(manager.powerMatch.correction).toBeCloseTo(0.15, 5);
    expect(sim.state.ergTargetW).toBeLessThanOrEqual(230);
    await manager.dispose();
  });

  it('désactivable', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer', 'pedals'], trainer: { powerBias: 0.08 } });
    manager.setPowerMatch(false);
    await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.connect('simulator:pedals'));
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 200 }));
    await clock.advance(60000);
    expect(sim.state.ergTargetW).toBe(200);
    await manager.dispose();
  });
});

describe('priorité des sources de puissance', () => {
  it('pédales en référence, repli sur le trainer si elles décrochent, retour ensuite', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer', 'pedals'] });
    await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.connect('simulator:pedals'));
    const sources: string[] = [];
    manager.on('powerSource', (s) => sources.push(s));
    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await clock.advance(3000);
    expect(power.every((p) => p.source === 'pedals')).toBe(true);
    expect(power.at(-1)?.cadence).toBeGreaterThan(80);

    sim.dropConnection('pedals', 20000);
    await clock.advance(3000);
    expect(manager.powerSource).toBe('trainer');
    expect(power.at(-1)?.source).toBe('trainer');

    await clock.advance(40000);
    expect(manager.powerSource).toBe('pedals');
    expect(sources).toEqual(['trainer', 'pedals']);
    await manager.dispose();
  });
});

describe('cohabitation Garmin Edge', () => {
  it('« Control Not Permitted » déclenche l’alerte, puis le contrôle est repris quand l’Edge lâche', async () => {
    const { clock, sim, manager } = await setup({ devices: ['trainer'] });
    const conflicts: DeviceWarning[] = [];
    manager.onTrainerControlConflict((w) => conflicts.push(w));
    sim.denyControl = true;
    const trainer = await settle(clock, manager.connect('simulator:trainer'));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/Edge/);
    expect((trainer.trainer as FtmsTrainer).hasControl).toBe(false);

    sim.denyControl = false;
    await clock.advance(6000);
    await settle(clock, manager.sendTrainer({ kind: 'erg', watts: 150 }));
    expect((trainer.trainer as FtmsTrainer).hasControl).toBe(true);
    expect(sim.state.ergTargetW).toBe(150);
    await manager.dispose();
  });
});

describe('Assioma : mode G+D combiné', () => {
  it('alerte si la balance n’arrive jamais (mode une pédale)', async () => {
    const { clock, manager } = await setup({ devices: ['pedals'], pedals: { combinedMode: false } });
    const warnings: DeviceWarning[] = [];
    manager.on('warning', (w) => warnings.push(w));
    await settle(clock, manager.connect('simulator:pedals'));
    await clock.advance(8000);
    const w = warnings.filter((x) => x.code === 'assioma-single-side');
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toMatch(/G\+D combiné/);
    expect(w[0]?.details).toMatchObject({ balanceSeen: false, leftReferenceOnly: true });
    await manager.dispose();
  });

  it('pas d’alerte en mode combiné ; balance transmise', async () => {
    const { clock, manager } = await setup({ devices: ['pedals'] });
    const warnings: DeviceWarning[] = [];
    manager.on('warning', (w) => warnings.push(w));
    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await settle(clock, manager.connect('simulator:pedals'));
    await clock.advance(8000);
    expect(warnings.filter((x) => x.code === 'assioma-single-side')).toHaveLength(0);
    expect(power.at(-1)?.balanceLeft).toBeGreaterThan(48);
    expect(power.at(-1)?.balanceLeft).toBeLessThan(53);
    await manager.dispose();
  });
});

describe('lissage 3 s', () => {
  it('réduit la variance de la puissance', async () => {
    const { clock, manager } = await setup({ devices: ['pedals'], noise: { power: 0.08 } });
    await settle(clock, manager.connect('simulator:pedals'));
    manager.setSmoothing(true);
    const power: ManagedPowerSample[] = [];
    manager.on('power', (p) => power.push(p));
    await clock.advance(30000);
    const tail = power.slice(-40);
    const variance = (xs: number[]) => {
      const m = mean(xs);
      return mean(xs.map((x) => (x - m) ** 2));
    };
    expect(variance(tail.map((p) => p.watts))).toBeLessThan(variance(tail.map((p) => p.rawWatts)) / 2);
    await manager.dispose();
  });
});

describe('Zwift Click (expérimental)', () => {
  it('désactivé par défaut : aucune vitesse', async () => {
    const { clock, sim, manager } = await setup({ devices: ['click'] });
    const shifts: string[] = [];
    manager.on('shift', (s) => shifts.push(s.action));
    await settle(clock, manager.connect('simulator:click'));
    sim.pressClick('plus');
    await clock.advance(100);
    expect(shifts).toEqual([]);
    await manager.dispose();
  });

  it('activé : RideOn, batterie, plus/moins → up/down', async () => {
    const { clock, sim, manager } = await setup({ devices: ['click'] });
    manager.setExperimental({ zwiftControllers: true });
    const shifts: string[] = [];
    manager.on('shift', (s) => shifts.push(s.action));
    const click = await settle(clock, manager.connect('simulator:click'));
    await clock.advance(100);
    expect(click.battery).toBe(75);
    expect(manager.roles.shifters).toEqual(['simulator:click']);
    sim.pressClick('plus');
    sim.pressClick('plus');
    sim.pressClick('minus');
    await clock.advance(100);
    expect(shifts).toEqual(['up', 'up', 'down']);
    await manager.dispose();
  });
});

describe('HEADWIND (expérimental)', () => {
  it('vitesse manuelle', async () => {
    const { clock, sim, manager } = await setup({ devices: ['headwind'] });
    manager.setExperimental({ headwind: true });
    await settle(clock, manager.connect('simulator:headwind'));
    expect(manager.roles.fan).toBe('simulator:headwind');
    await settle(clock, manager.sendFan({ kind: 'speed', percent: 75 }));
    expect(sim.state.fanMode).toBe('manual');
    expect(sim.state.fanSpeedPercent).toBe(75);
    await manager.dispose();
  });
});

describe('appairages persistés', () => {
  it('sauvegarde puis restauration (rôles + reconnexion)', async () => {
    const { clock, storage, manager } = await setup({ devices: ['trainer', 'pedals', 'heartRate'] });
    await settle(clock, manager.connect('simulator:trainer'));
    await settle(clock, manager.connect('simulator:pedals'));
    await settle(clock, manager.connect('simulator:heartRate'));
    manager.setSmoothing(true);
    await manager.dispose();
    const saved = JSON.parse(storage.data ?? '{}');
    expect(saved.devices).toHaveLength(3);
    expect(saved.roles).toMatchObject({ trainer: 'simulator:trainer', power: 'simulator:pedals', heartRate: 'simulator:heartRate' });

    const clock2 = newClock();
    const sim2 = new SimulatorTransport({ clock: clock2, devices: ['trainer', 'pedals', 'heartRate'] });
    const m2 = new DeviceManager({ transports: [sim2], clock: clock2, storage });
    await settle(clock2, m2.restore());
    expect(m2.devices.map((d) => d.state)).toEqual(['connected', 'connected', 'connected']);
    expect(m2.roles.power).toBe('simulator:pedals');
    expect(m2.smoothingEnabled).toBe(true);
    expect(m2.summaries().find((s) => s.id === 'simulator:pedals')?.roles).toEqual(['power']);
    await m2.forget('simulator:heartRate');
    expect(JSON.parse(storage.data ?? '{}').devices).toHaveLength(2);
    await m2.dispose();
  });
});
