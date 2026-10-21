/**
 * Profils EXPÉRIMENTAUX (désactivés par défaut) : manettes Zwift, ventilateur KICKR HEADWIND, Di2 D-Fly.
 * Protocoles non documentés par les fabricants, décodés par la communauté (BikeControl / OpenBikeControl).
 */
import type { FanCommand, ShiftAction } from '@allezrobert/shared';
import {
  DEFAULT_ZWIFT_BUTTON_ACTIONS,
  DflyDecoder,
  HEADWIND,
  PLAIN_RIDE_ON_HANDSHAKE,
  SHIMANO_DFLY,
  ZWIFT_CONTROLLER,
  ZwiftButtonEdgeDetector,
  decodeHeadwindStatus,
  decodeZwiftControllerMessage,
  encodeHeadwindMode,
  encodeHeadwindSpeed,
  type HeadwindMode,
  type ZwiftButton,
  type ZwiftUnlockStrategy,
} from '@allezrobert/protocols';
import { hasCharacteristic, hasService } from '../gatt-util.ts';
import { WARNING_MESSAGES } from '../messages.ts';
import type { DeviceLink, FanControl, GattConnection, Profile, ProfileContext } from '../types.ts';

export class ZwiftControllerShifter implements Profile {
  readonly name = 'zwift-controller';
  readonly streaming = false;
  private edges = new ZwiftButtonEdgeDetector();
  readonly actions: Partial<Record<ZwiftButton, ShiftAction>>;
  readonly unlock: ZwiftUnlockStrategy;

  constructor(options: { actions?: Partial<Record<ZwiftButton, ShiftAction>>; unlock?: ZwiftUnlockStrategy } = {}) {
    this.actions = options.actions ?? DEFAULT_ZWIFT_BUTTON_ACTIONS;
    this.unlock = options.unlock ?? PLAIN_RIDE_ON_HANDSHAKE;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('Zwift : liaison GATT attendue');
    ctx.warn('experimental-adapter', WARNING_MESSAGES['experimental-adapter'], { adapter: 'zwift-controllers' });
    const service = hasService(link.services, ZWIFT_CONTROLLER.rideService) && hasCharacteristic(link, ZWIFT_CONTROLLER.rideService, ZWIFT_CONTROLLER.async)
      ? ZWIFT_CONTROLLER.rideService
      : ZWIFT_CONTROLLER.service;
    this.edges.reset();
    const onData = (raw: Uint8Array) => {
      const data = this.unlock.decrypt ? this.unlock.decrypt(raw) : raw;
      let m;
      try {
        m = decodeZwiftControllerMessage(data);
      } catch {
        return;
      }
      if (m.type === 'battery') ctx.emit('battery', m.percent);
      else if (m.type === 'handshake') ctx.log('Zwift : poignée de main RideOn reçue');
      else if (m.type === 'buttons') {
        for (const b of this.edges.update(m.pressed)) {
          const action = this.actions[b];
          if (action) ctx.emit('shift', { t: ctx.now(), action });
        }
      }
    };
    await link.subscribe(service, ZWIFT_CONTROLLER.async, onData);
    if (hasCharacteristic(link, service, ZWIFT_CONTROLLER.syncTx)) await link.subscribe(service, ZWIFT_CONTROLLER.syncTx, onData);
    for (const frame of await this.unlock.handshake()) {
      await link.write(service, ZWIFT_CONTROLLER.syncRx, frame, false);
    }
  }

  detach(): void {}
}

export class HeadwindFan implements Profile, FanControl {
  readonly name = 'headwind';
  readonly streaming = false;
  private conn: GattConnection | undefined;
  private mode: HeadwindMode | 'unknown' = 'unknown';
  speedPercent = 0;

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('HEADWIND : liaison GATT attendue');
    ctx.warn('experimental-adapter', WARNING_MESSAGES['experimental-adapter'], { adapter: 'headwind' });
    this.conn = link;
    await link.subscribe(HEADWIND.service, HEADWIND.characteristic, (d) => {
      const s = decodeHeadwindStatus(d);
      if (!s) return;
      this.mode = s.mode;
      this.speedPercent = s.speedPercent;
    }).catch(() => undefined);
  }

  detach(): void {
    this.conn = undefined;
    this.mode = 'unknown';
  }

  async send(command: FanCommand): Promise<void> {
    const c = this.conn;
    if (!c) return;
    if (command.kind === 'mode') {
      const mode: HeadwindMode = command.mode === 'off' ? 'off' : command.mode;
      await c.write(HEADWIND.service, HEADWIND.characteristic, encodeHeadwindMode(mode), true);
      this.mode = mode;
      return;
    }
    if (this.mode !== 'manual') {
      await c.write(HEADWIND.service, HEADWIND.characteristic, encodeHeadwindMode('manual'), true);
      this.mode = 'manual';
    }
    await c.write(HEADWIND.service, HEADWIND.characteristic, encodeHeadwindSpeed(command.percent), true);
  }
}

export class DflyShifter implements Profile {
  readonly name = 'shimano-dfly';
  readonly streaming = false;
  private decoder = new DflyDecoder();
  /** Canal D-Fly (1–4) → action ; à régler selon l'affectation faite dans E-TUBE. */
  readonly channelActions: Record<number, ShiftAction>;

  constructor(channelActions: Record<number, ShiftAction> = { 1: 'up', 2: 'down', 3: 'frontUp', 4: 'frontDown' }) {
    this.channelActions = channelActions;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('D-Fly : liaison GATT attendue');
    ctx.warn('experimental-adapter', WARNING_MESSAGES['experimental-adapter'], { adapter: 'shimano-dfly' });
    this.decoder.reset();
    await link.subscribe(SHIMANO_DFLY.service, SHIMANO_DFLY.channelCharacteristic, (d) => {
      for (const ev of this.decoder.push(d)) {
        if (ev.kind !== 'short' && ev.kind !== 'long') continue;
        const action = this.channelActions[ev.channel];
        if (action) ctx.emit('shift', { t: ctx.now(), action });
      }
    });
  }

  detach(): void {}
}
