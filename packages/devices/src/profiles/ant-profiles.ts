/**
 * Profils ANT+ : home trainer FE-C (en ANT+ USB ou en « FE-C over BLE » Tacx), puissance PWR
 * (Assioma : seul chemin pour TE/PS), fréquence cardiaque HR, télécommandes Controls (expérimental).
 */
import type { PowerSample, ShiftAction, TrainerCommand } from '@allezrobert/shared';
import {
  ANT_MSG,
  AntGenericCommandDeduplicator,
  AntHeartRateRrCalculator,
  AntMessageReader,
  DEFAULT_ANT_COMMAND_ACTIONS,
  PwrCrankTorqueCalculator,
  TACX_FEC,
  antAcknowledgedData,
  decodeAntGenericCommand,
  decodeAntHeartRatePage,
  decodeFecPage,
  decodePwrPage,
  encodeFecBasicResistance,
  encodeFecCalibrationRequest,
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeFecUserConfiguration,
  encodeFecWindResistance,
  leftBalanceFromPwr,
  parseAntDataMessage,
  type FecUserConfiguration,
} from '@allezrobert/protocols';
import type { DeviceLink, Profile, ProfileContext, TrainerControl } from '../types.ts';

/** Canal de pages FE-C, quel que soit le transport. */
export interface FecPageChannel {
  onPage(handler: (page: Uint8Array) => void): () => void;
  sendPage(page: Uint8Array): Promise<void>;
}

/** FE-C over BLE (Tacx) : messages ANT complets sur 6e40fec2 (notify) / 6e40fec3 (write). */
async function bleFecChannel(link: DeviceLink): Promise<FecPageChannel> {
  if (link.type !== 'gatt') throw new Error('FE-C BLE : liaison GATT attendue');
  const reader = new AntMessageReader();
  const handlers = new Set<(p: Uint8Array) => void>();
  await link.subscribe(TACX_FEC.service, TACX_FEC.rx, (chunk) => {
    for (const msg of reader.push(chunk)) {
      if (msg.id !== ANT_MSG.broadcastData && msg.id !== ANT_MSG.acknowledgedData) continue;
      const d = parseAntDataMessage(msg);
      for (const h of handlers) h(d.data);
    }
  });
  return {
    onPage(h) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    // Canal 5 par convention Tacx ; message acquitté pour les commandes.
    sendPage: (page) => link.write(TACX_FEC.service, TACX_FEC.tx, antAcknowledgedData(5, page), false),
  };
}

function antFecChannel(link: DeviceLink): FecPageChannel {
  if (link.type !== 'ant') throw new Error('FE-C ANT : canal ANT attendu');
  return { onPage: (h) => link.onPage(h), sendPage: (page) => link.send(page, true) };
}

export interface FecTrainerOptions {
  /** Envoyée à la connexion (page 55) : améliore la simulation de pente côté trainer. */
  userConfiguration?: FecUserConfiguration;
}

export class FecTrainer implements Profile, TrainerControl {
  readonly name = 'fe-c';
  readonly streaming = true;
  private ctx: ProfileContext | undefined;
  private channel: FecPageChannel | undefined;
  private unsub: (() => void) | undefined;
  private lastCmd: TrainerCommand | undefined;
  private lastWind: string | undefined;
  private speedKmh: number | undefined;
  /** Étape de la calibration en cours (pages 1, 2 et 71), pour n'émettre que les changements. */
  private calibrationStage: 'started' | 'requested' | 'stopPedaling' | undefined;
  private readonly options: FecTrainerOptions;

  constructor(options: FecTrainerOptions = {}) {
    this.options = options;
  }

  get lastCommand(): TrainerCommand | undefined {
    return this.lastCmd;
  }

  /** FE-C n'a pas de notion de prise de contrôle exclusive : le dernier qui parle gagne. */
  get hasControl(): boolean {
    return this.channel !== undefined;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    this.ctx = ctx;
    this.lastWind = undefined;
    this.channel = link.type === 'ant' ? antFecChannel(link) : await bleFecChannel(link);
    this.unsub = this.channel.onPage((p) => this.onPage(p));
    if (this.options.userConfiguration) {
      await this.channel.sendPage(encodeFecUserConfiguration(this.options.userConfiguration)).catch(() => undefined);
    }
    if (this.lastCmd) await this.send(this.lastCmd).catch(() => undefined);
  }

  detach(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.channel = undefined;
  }

  async send(command: TrainerCommand): Promise<void> {
    if (command.kind !== 'spindown') this.lastCmd = command;
    const ch = this.channel;
    if (!ch) return;
    switch (command.kind) {
      case 'simulation': {
        // Page 50 seulement si le vent / coefficient change, puis page 51 (pente + Crr).
        const windKey = `${command.windSpeedMs ?? 0}|${command.cw ?? 0.51}`;
        if (windKey !== this.lastWind) {
          this.lastWind = windKey;
          await ch.sendPage(encodeFecWindResistance({ windResistanceCoefficient: command.cw ?? 0.51, windSpeedKmh: (command.windSpeedMs ?? 0) * 3.6, draftingFactor: 1 }));
        }
        await ch.sendPage(encodeFecTrackResistance({ gradePercent: command.gradePercent, crr: command.crr ?? 0.004 }));
        return;
      }
      case 'erg':
        await ch.sendPage(encodeFecTargetPower(command.watts));
        return;
      case 'resistance':
        await ch.sendPage(encodeFecBasicResistance(command.level));
        return;
      case 'spindown':
        this.calibrationStage = 'started';
        this.ctx?.emit('calibration', { t: this.ctx.now(), status: 'started' });
        await ch.sendPage(encodeFecCalibrationRequest({ spinDown: true }));
        return;
      case 'reset':
        this.ctx?.log('FE-C : pas de commande de remise à zéro, ignorée');
        return;
    }
  }

  private onPage(page: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let p;
    try {
      p = decodeFecPage(page);
    } catch {
      return;
    }
    if (p.page === 0x10 && 'speedKmh' in p) {
      this.speedKmh = p.speedKmh;
    } else if (p.page === 0x19 && 'updateEventCount' in p && 'accumulatedPowerW' in p) {
      ctx.emit('trainer', {
        t: ctx.now(),
        ...(p.instantaneousPowerW !== undefined ? { watts: p.instantaneousPowerW } : {}),
        ...(p.cadenceRpm !== undefined ? { cadence: p.cadenceRpm } : {}),
        ...(this.speedKmh !== undefined ? { speedKmh: this.speedKmh } : {}),
      });
    } else if ('kind' in p && p.kind === 'calibrationInProgress') {
      // Page 2 : vitesse trop basse → accélérer jusqu'à la cible ; vitesse atteinte → roue libre.
      if (!p.spinDownPending) return;
      const status = p.speedCondition === 'ok' ? 'stopPedaling' : 'requested';
      if (status === this.calibrationStage) return;
      this.calibrationStage = status;
      ctx.emit('calibration', {
        t: ctx.now(),
        status,
        ...(p.targetSpeedKmh !== undefined ? { targetSpeedLowKmh: p.targetSpeedKmh, targetSpeedHighKmh: p.targetSpeedKmh } : {}),
        ...(p.temperatureC !== undefined ? { temperatureC: p.temperatureC } : {}),
      });
    } else if ('kind' in p && p.kind === 'calibrationResponse') {
      // Page 1 : résultat. Ignorée si aucune calibration n'est en cours (rediffusion éventuelle).
      if (this.calibrationStage === undefined) return;
      this.calibrationStage = undefined;
      ctx.emit('calibration', {
        t: ctx.now(),
        status: p.spinDownSuccess ? 'success' : 'error',
        ...(p.spinDownTimeMs !== undefined ? { spinDownTimeMs: p.spinDownTimeMs } : {}),
        ...(p.temperatureC !== undefined ? { temperatureC: p.temperatureC } : {}),
        ...(p.spinDownSuccess ? {} : { reason: 'Spin-down FE-C échoué (page 1 sans le bit de réussite)' }),
      });
    } else if (p.page === 0x47 && 'lastReceivedCommandId' in p && p.status !== 'pass' && p.status !== 'pending' && p.status !== 'uninitialized') {
      if (p.lastReceivedCommandId === 0x01 && this.calibrationStage !== undefined) {
        this.calibrationStage = undefined;
        ctx.emit('calibration', { t: ctx.now(), status: p.status === 'notSupported' ? 'unsupported' : 'error', reason: `FE-C : demande de calibration ${p.status}` });
        return;
      }
      ctx.warn('command-failed', `FE-C : commande 0x${p.lastReceivedCommandId.toString(16)} refusée (${p.status})`);
    }
  }
}

/** ANT+ PWR : puissance, cadence, balance, et TE/PS (page 0x13) fusionnés dans PowerSample. */
export class AntPowerMeter implements Profile {
  readonly name = 'ant-power';
  readonly streaming = true;
  private ctx: ProfileContext | undefined;
  private unsub: (() => void) | undefined;
  private lastEvent: number | undefined;
  private teps: Pick<PowerSample, 'teLeft' | 'teRight' | 'psLeft' | 'psRight'> = {};
  private torque = new PwrCrankTorqueCalculator();

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'ant') throw new Error('ANT+ PWR : canal ANT attendu');
    this.ctx = ctx;
    this.lastEvent = undefined;
    this.torque.reset();
    this.unsub = link.onPage((p) => this.onPage(p));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  private onPage(data: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = decodePwrPage(data);
    const t = ctx.now();
    if (p.page === 0x13 && 'psCombined' in p) {
      this.teps = {};
      if (p.teLeft !== undefined) this.teps.teLeft = p.teLeft;
      if (p.teRight !== undefined) this.teps.teRight = p.teRight;
      if (p.psLeft !== undefined) {
        this.teps.psLeft = p.psLeft;
        if (p.psCombined) this.teps.psRight = p.psLeft;
      }
      if (p.psRight !== undefined) this.teps.psRight = p.psRight;
      return;
    }
    if (p.page === 0x10 && 'instantaneousPowerW' in p) {
      if (p.updateEventCount === this.lastEvent) return; // page répétée
      this.lastEvent = p.updateEventCount;
      const s: PowerSample = { t, watts: p.instantaneousPowerW, ...this.teps };
      if (p.cadenceRpm !== undefined) s.cadence = p.cadenceRpm;
      const left = leftBalanceFromPwr(p);
      if (left !== undefined) s.balanceLeft = left;
      ctx.emit('power', s);
      if (s.cadence !== undefined) ctx.emit('cadence', { t, cadence: s.cadence });
      return;
    }
    if (p.page === 0x12 && 'accumulatedTorque' in p) {
      const r = this.torque.update(p);
      if (r) ctx.emit('cadence', { t, cadence: r.cadenceRpm });
    }
  }
}

/** ANT+ HR. */
export class AntHeartRateMonitor implements Profile {
  readonly name = 'ant-heart-rate';
  readonly streaming = true;
  private unsub: (() => void) | undefined;
  private rr = new AntHeartRateRrCalculator();

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'ant') throw new Error('ANT+ HR : canal ANT attendu');
    this.rr = new AntHeartRateRrCalculator();
    this.unsub = link.onPage((data) => {
      const p = decodeAntHeartRatePage(data);
      const rr = this.rr.update(p);
      if (p.page === 7 && p.batteryPercent !== undefined) ctx.emit('battery', p.batteryPercent);
      if (p.computedHeartRate > 0) ctx.emit('heartRate', { t: ctx.now(), bpm: p.computedHeartRate, ...(rr.length ? { rr } : {}) });
    });
  }

  detach(): void {
    this.unsub?.();
    this.unsub = undefined;
  }
}

/** EXPÉRIMENTAL : télécommandes ANT+ Controls, page 73. */
export class AntControlsShifter implements Profile {
  readonly name = 'ant-controls';
  readonly streaming = false;
  private unsub: (() => void) | undefined;
  private dedup = new AntGenericCommandDeduplicator();
  readonly actions: Record<number, ShiftAction>;

  constructor(actions: Record<number, ShiftAction> = DEFAULT_ANT_COMMAND_ACTIONS) {
    this.actions = actions;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'ant') throw new Error('ANT+ Controls : canal ANT attendu');
    ctx.warn('experimental-adapter', 'ANT+ Controls : adaptateur expérimental.');
    this.unsub = link.onPage((data) => {
      const c = decodeAntGenericCommand(data);
      if (!c || !this.dedup.accept(c)) return;
      const action = this.actions[c.command];
      if (action) ctx.emit('shift', { t: ctx.now(), action });
    });
  }

  detach(): void {
    this.unsub?.();
    this.unsub = undefined;
  }
}
