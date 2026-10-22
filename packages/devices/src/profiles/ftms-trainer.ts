/**
 * Home trainer FTMS : prise de contrôle, démarrage, mode simulation (pente), ERG, résistance, spindown.
 * Les écritures sur le Control Point sont mises en file : une seule commande en vol, on attend
 * l'indication 0x80 correspondante (FTMS §4.16.2.22) avant d'envoyer la suivante. Les consignes répétées
 * (pente à 1–4 Hz, ERG) sont fusionnées : seule la plus récente en attente est envoyée.
 */
import type { TrainerCommand } from '@allezrobert/shared';
import {
  CHAR,
  FTMS_OPCODE,
  FTMS_RESULT,
  SERVICE,
  clamp,
  encodeRequestControl,
  encodeReset,
  encodeSetIndoorBikeSimulation,
  encodeSetTargetPower,
  encodeSetTargetResistanceLevel,
  encodeSpinDownControl,
  encodeStartOrResume,
  parseControlPointResponse,
  parseFitnessMachineFeature,
  parseFitnessMachineStatus,
  parseIndoorBikeData,
  parseSupportedPowerRange,
  parseSupportedResistanceLevelRange,
  type FitnessMachineFeature,
  type FtmsControlPointResponse,
  type IndoorBikeData,
  type SupportedRange,
} from '@allezrobert/protocols';
import { hasCharacteristic, tryRead } from '../gatt-util.ts';
import { WARNING_MESSAGES } from '../messages.ts';
import type { DeviceLink, GattConnection, Profile, ProfileContext, TrainerControl } from '../types.ts';

export interface FtmsTrainerOptions {
  /** Délai d'attente de la réponse 0x80 (ms). Défaut 3000. */
  responseTimeoutMs?: number;
  /** Intervalle minimal entre deux demandes de contrôle refusées (ms). Défaut 5000. */
  controlRetryMs?: number;
}

interface QueuedCommand {
  bytes: Uint8Array;
  opCode: number;
  key: string | undefined;
  resolve: (r: FtmsControlPointResponse | undefined) => void;
  reject: (e: Error) => void;
}

export class FtmsError extends Error {
  override name = 'FtmsError';
  readonly response: FtmsControlPointResponse | undefined;
  constructor(message: string, response?: FtmsControlPointResponse) {
    super(message);
    this.response = response;
  }
}

export class FtmsTrainer implements Profile, TrainerControl {
  readonly name = 'ftms';
  readonly streaming = true;
  feature: FitnessMachineFeature | undefined;
  powerRange: SupportedRange | undefined;
  resistanceRange: SupportedRange | undefined;
  private conn: GattConnection | undefined;
  private ctx: ProfileContext | undefined;
  private queue: QueuedCommand[] = [];
  private inflight: (QueuedCommand & { timer: unknown }) | undefined;
  private controlGranted = false;
  private lastControlAttempt = -Infinity;
  private lastCmd: TrainerCommand | undefined;
  private partial: Partial<IndoorBikeData> = {};
  private readonly responseTimeoutMs: number;
  private readonly controlRetryMs: number;
  private generation = 0;

  constructor(options: FtmsTrainerOptions = {}) {
    this.responseTimeoutMs = options.responseTimeoutMs ?? 3000;
    this.controlRetryMs = options.controlRetryMs ?? 5000;
  }

  get hasControl(): boolean {
    return this.controlGranted;
  }

  /** Spin-down annoncé (Target Setting Features, bit 15) ; vrai par défaut si la caractéristique est absente. */
  get supportsSpinDown(): boolean {
    return this.feature ? this.feature.targetSettings.spinDownControl : true;
  }

  get lastCommand(): TrainerCommand | undefined {
    return this.lastCmd;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('FTMS : liaison GATT attendue');
    this.conn = link;
    this.ctx = ctx;
    this.controlGranted = false;
    this.lastControlAttempt = -Infinity;
    this.partial = {};
    const gen = ++this.generation;
    const S = SERVICE.fitnessMachine;

    const feat = await tryRead(link, S, CHAR.fitnessMachineFeature);
    if (feat) this.feature = parseFitnessMachineFeature(feat);
    const pr = await tryRead(link, S, CHAR.supportedPowerRange);
    if (pr) this.powerRange = parseSupportedPowerRange(pr);
    const rr = await tryRead(link, S, CHAR.supportedResistanceLevelRange);
    if (rr) this.resistanceRange = parseSupportedResistanceLevelRange(rr);

    await link.subscribe(S, CHAR.indoorBikeData, (d) => this.onIndoorBikeData(d));
    if (hasCharacteristic(link, S, CHAR.fitnessMachineStatus)) {
      await link.subscribe(S, CHAR.fitnessMachineStatus, (d) => this.onStatus(d));
    }
    if (!hasCharacteristic(link, S, CHAR.fitnessMachineControlPoint)) {
      ctx.log('FTMS : pas de Control Point, trainer en lecture seule');
      return;
    }
    await link.subscribe(S, CHAR.fitnessMachineControlPoint, (d) => this.onControlPoint(d));

    // Reprise du contrôle (aussi après une reconnexion), démarrage, puis renvoi de la dernière consigne.
    if (await this.requestControl()) {
      await this.enqueue(encodeStartOrResume(), FTMS_OPCODE.startOrResume).catch(() => undefined);
      if (gen === this.generation && this.lastCmd && this.lastCmd.kind !== 'spindown' && this.lastCmd.kind !== 'reset') {
        ctx.log('FTMS : renvoi de la dernière consigne après (re)connexion');
        await this.send(this.lastCmd).catch(() => undefined);
      }
    }
  }

  detach(): void {
    this.generation++;
    const err = new FtmsError('Liaison perdue');
    if (this.inflight) {
      this.ctx?.clock.clearTimeout(this.inflight.timer);
      this.inflight.reject(err);
      this.inflight = undefined;
    }
    for (const q of this.queue.splice(0)) q.reject(err);
    this.controlGranted = false;
    this.conn = undefined;
  }

  /** §4.16.2.1 Request Control. Renvoie true si accordé. */
  async requestControl(): Promise<boolean> {
    const ctx = this.ctx;
    if (!this.conn || !ctx) return false;
    this.lastControlAttempt = ctx.now();
    try {
      const r = await this.enqueue(encodeRequestControl(), FTMS_OPCODE.requestControl, undefined, false);
      this.controlGranted = r?.result === FTMS_RESULT.success;
      if (r?.result === FTMS_RESULT.controlNotPermitted) {
        ctx.warn('trainer-control-not-permitted', WARNING_MESSAGES['trainer-control-not-permitted']);
      }
      return this.controlGranted;
    } catch (e) {
      ctx.log(`FTMS : demande de contrôle sans réponse (${(e as Error).message})`);
      return false;
    }
  }

  async send(command: TrainerCommand): Promise<void> {
    if (command.kind !== 'spindown') this.lastCmd = command;
    if (!this.conn || !this.ctx) return; // sera renvoyée à la reconnexion
    if (!this.controlGranted) {
      if (this.ctx.now() - this.lastControlAttempt < this.controlRetryMs) return;
      if (!(await this.requestControl())) return;
    }
    switch (command.kind) {
      case 'simulation':
        await this.enqueue(
          encodeSetIndoorBikeSimulation({
            gradePercent: command.gradePercent,
            windSpeedMs: command.windSpeedMs ?? 0,
            crr: command.crr ?? 0.004,
            cw: command.cw ?? 0.51,
          }),
          FTMS_OPCODE.setIndoorBikeSimulation,
          'target',
        );
        return;
      case 'erg': {
        const r = this.powerRange;
        const watts = r ? clamp(command.watts, r.min, r.max) : Math.max(0, command.watts);
        await this.enqueue(encodeSetTargetPower(watts), FTMS_OPCODE.setTargetPower, 'target');
        return;
      }
      case 'resistance': {
        const r = this.resistanceRange ?? { min: 0, max: 10, increment: 0.1 };
        const level = r.min + (clamp(command.level, 0, 100) / 100) * (r.max - r.min);
        await this.enqueue(encodeSetTargetResistanceLevel(level), FTMS_OPCODE.setTargetResistanceLevel, 'target');
        return;
      }
      case 'spindown': {
        const ctx = this.ctx;
        // Fitness Machine Feature, Target Setting bit 15 : spin-down non annoncé → inutile d'essayer.
        if (this.feature && !this.supportsSpinDown) {
          ctx.emit('calibration', { t: ctx.now(), status: 'unsupported', reason: 'Spin-down non annoncé par le trainer (FTMS 0x2ACC, bit 15)' });
          return;
        }
        ctx.emit('calibration', { t: ctx.now(), status: 'started' });
        let resp: FtmsControlPointResponse | undefined;
        try {
          resp = await this.enqueue(encodeSpinDownControl('start'), FTMS_OPCODE.spinDownControl);
        } catch (e) {
          const r = (e as FtmsError).response;
          const unsupported = r?.result === FTMS_RESULT.opCodeNotSupported;
          ctx.emit('calibration', { t: ctx.now(), status: unsupported ? 'unsupported' : 'error', reason: (e as Error).message });
          return;
        }
        if (resp?.spinDown) {
          ctx.emit('calibration', { t: ctx.now(), status: 'requested', ...resp.spinDown });
        }
        return;
      }
      case 'reset':
        await this.enqueue(encodeReset(), FTMS_OPCODE.reset);
        this.controlGranted = false; // §4.16.2.2 : le reset libère le contrôle
        return;
    }
  }

  /** Commandes en attente (diagnostic, tests). */
  get pendingCommands(): number {
    return this.queue.length + (this.inflight ? 1 : 0);
  }

  private enqueue(bytes: Uint8Array, opCode: number, key?: string, throwOnFailure = true): Promise<FtmsControlPointResponse | undefined> {
    return new Promise<FtmsControlPointResponse | undefined>((resolve, reject) => {
      if (key !== undefined) {
        // Fusion : une consigne plus récente remplace celle qui attend encore.
        const idx = this.queue.findIndex((q) => q.key === key);
        if (idx >= 0) {
          const old = this.queue[idx]!;
          old.resolve(undefined);
          this.queue.splice(idx, 1);
        }
      }
      this.queue.push({
        bytes,
        opCode,
        key,
        resolve,
        reject: (e) => (throwOnFailure ? reject(e) : resolve((e as FtmsError).response)),
      });
      this.pump();
    });
  }

  private pump(): void {
    const conn = this.conn;
    const ctx = this.ctx;
    if (this.inflight || !conn || !ctx) return;
    const next = this.queue.shift();
    if (!next) return;
    const timer = ctx.clock.setTimeout(() => {
      if (this.inflight?.timer !== timer) return;
      this.inflight = undefined;
      next.reject(new FtmsError(`Pas de réponse du trainer à l'op code 0x${next.opCode.toString(16)}`));
      this.pump();
    }, this.responseTimeoutMs);
    this.inflight = { ...next, timer };
    conn.write(SERVICE.fitnessMachine, CHAR.fitnessMachineControlPoint, next.bytes, true).catch((e: unknown) => {
      if (this.inflight?.timer !== timer) return;
      ctx.clock.clearTimeout(timer);
      this.inflight = undefined;
      next.reject(e instanceof Error ? e : new Error(String(e)));
      this.pump();
    });
  }

  private onControlPoint(data: Uint8Array): void {
    let resp: FtmsControlPointResponse;
    try {
      resp = parseControlPointResponse(data);
    } catch {
      return;
    }
    const cur = this.inflight;
    if (!cur || cur.opCode !== resp.requestOpCode) return;
    this.ctx?.clock.clearTimeout(cur.timer);
    this.inflight = undefined;
    if (resp.result === FTMS_RESULT.success) cur.resolve(resp);
    else {
      if (resp.result === FTMS_RESULT.controlNotPermitted) {
        this.controlGranted = false;
        if (cur.opCode !== FTMS_OPCODE.requestControl) {
          this.ctx?.warn('trainer-control-not-permitted', WARNING_MESSAGES['trainer-control-not-permitted']);
        }
      }
      cur.reject(new FtmsError(`Le trainer a répondu « ${resp.resultName} » à l'op code 0x${resp.requestOpCode.toString(16)}`, resp));
    }
    this.pump();
  }

  private onStatus(data: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let st;
    try {
      st = parseFitnessMachineStatus(data);
    } catch {
      return;
    }
    switch (st.kind) {
      case 'controlPermissionLost':
        this.controlGranted = false;
        ctx.warn('trainer-control-lost', WARNING_MESSAGES['trainer-control-lost']);
        // Reprise : la prochaine consigne redemande le contrôle ; on tente aussi tout de suite.
        this.lastControlAttempt = -Infinity;
        void this.requestControl().then((ok) => {
          if (ok && this.lastCmd) return this.send(this.lastCmd);
          return undefined;
        }).catch(() => undefined);
        break;
      case 'spinDownStatus':
        ctx.emit('calibration', {
          t: ctx.now(),
          status: st.status === 'unknown' ? 'error' : st.status,
        });
        break;
      case 'reset':
        this.controlGranted = false;
        break;
      default:
        break;
    }
  }

  private onIndoorBikeData(data: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let d: IndoorBikeData;
    try {
      d = parseIndoorBikeData(data);
    } catch {
      return;
    }
    // FTMS §4.9.1 : « More Data » = la suite arrive dans la notification suivante ; on fusionne.
    Object.assign(this.partial, d);
    if (d.moreData) return;
    const full = this.partial;
    this.partial = {};
    const t = ctx.now();
    ctx.emit('trainer', {
      t,
      ...(full.instantaneousPowerW !== undefined ? { watts: full.instantaneousPowerW } : {}),
      ...(full.instantaneousCadenceRpm !== undefined ? { cadence: full.instantaneousCadenceRpm } : {}),
      ...(full.instantaneousSpeedKmh !== undefined ? { speedKmh: full.instantaneousSpeedKmh } : {}),
    });
    if (full.heartRateBpm) ctx.emit('heartRate', { t, bpm: full.heartRateBpm });
  }
}
