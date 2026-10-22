/**
 * Profils EXPÉRIMENTAUX (désactivés par défaut) : manettes Zwift, ventilateur KICKR HEADWIND, Di2 D-Fly,
 * SRAM AXS. Protocoles non documentés par les fabricants, décodés par la communauté (BikeControl /
 * OpenBikeControl, qdomyos-zwift, GaborWnuk/sram-axs…) : voir docs/PROTOCOLS.md §10.
 */
import type { FanCommand, ShiftAction } from '@allezrobert/shared';
import {
  DEFAULT_ZWIFT_BUTTON_ACTIONS,
  DEFAULT_ZWIFT_CLICK_V2_ACTIONS,
  DflyDecoder,
  HEADWIND,
  PLAIN_RIDE_ON_HANDSHAKE,
  SHIMANO_DFLY,
  SRAM_AXS,
  SramAxsClickClassifier,
  SramAxsGearTracker,
  ZWIFT_CONTROLLER,
  ZWIFT_KEEPALIVE_INTERVAL_MS,
  ZWIFT_RIDE_ON,
  ZwiftButtonEdgeDetector,
  ZwiftLockDetector,
  decodeHeadwindStatus,
  decodeSramAxsDeviceRecord,
  decodeSramAxsDrivetrainStatus,
  decodeSramAxsSerial,
  decodeZwiftControllerMessage,
  decryptSramAxsFrame,
  encodeHeadwindMode,
  encodeHeadwindSpeed,
  filterZwiftPodButtons,
  isSramAxsChangeEdge,
  sramAxsSerialFromName,
  srambondCreateBond,
  startsWith,
  type HeadwindMode,
  type SramAxsDrivetrainStatus,
  type ZwiftButton,
  type ZwiftDeviceType,
  type ZwiftUnlockStrategy,
} from '@allezrobert/protocols';
import type { TimerHandle } from '../clock.ts';
import { hasCharacteristic, hasService, serviceOf, tryRead } from '../gatt-util.ts';
import { WARNING_MESSAGES } from '../messages.ts';
import type { DeviceLink, FanControl, GattConnection, Profile, ProfileContext } from '../types.ts';

export interface ZwiftControllerOptions {
  actions?: Partial<Record<ZwiftButton, ShiftAction>>;
  /** Poignée de main : RideOn en clair par défaut ; `createZapUnlockStrategy()` pour les anciens firmwares chiffrés. */
  unlock?: ZwiftUnlockStrategy;
  /** Type lu dans les données fabricant de l'annonce (palet gauche/droit du Click v2…). */
  deviceType?: ZwiftDeviceType;
  /** Nom annoncé (repli quand le type est inconnu, p. ex. en Web Bluetooth). */
  deviceName?: string;
  /** Renvoi périodique de RideOn (ms) ; défaut : 3000 sur Click v2, désactivé ailleurs. false = jamais. */
  keepAliveMs?: number | false;
}

/** Délai avant de signaler une manette verrouillée (un défi précède parfois l'écho RideOn). */
const ZWIFT_LOCK_GRACE_MS = 2000;

export class ZwiftControllerShifter implements Profile {
  readonly name = 'zwift-controller';
  readonly streaming = false;
  private edges = new ZwiftButtonEdgeDetector();
  private lock = new ZwiftLockDetector();
  private timers: Array<{ clear: () => void }> = [];
  readonly actions: Partial<Record<ZwiftButton, ShiftAction>>;
  readonly unlock: ZwiftUnlockStrategy;
  readonly deviceType: ZwiftDeviceType | undefined;
  private readonly options: ZwiftControllerOptions;

  constructor(options: ZwiftControllerOptions = {}) {
    this.options = options;
    this.deviceType = options.deviceType;
    this.actions = options.actions ?? (this.isClickV2(true) ? DEFAULT_ZWIFT_CLICK_V2_ACTIONS : DEFAULT_ZWIFT_BUTTON_ACTIONS);
    this.unlock = options.unlock ?? PLAIN_RIDE_ON_HANDSHAKE;
  }

  /** Click v2 : par le type annoncé, sinon nom « Zwift Click » + service court 0xFC82 (le v1 n'a que 0001). */
  private isClickV2(rideService: boolean): boolean {
    if (this.deviceType === 'clickV2Left' || this.deviceType === 'clickV2Right') return true;
    return this.deviceType === undefined && rideService && /click/i.test(this.options.deviceName ?? '');
  }

  get lockState(): ZwiftLockDetector['state'] {
    return this.lock.state;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('Zwift : liaison GATT attendue');
    ctx.warn('experimental-adapter', WARNING_MESSAGES['experimental-adapter'], { adapter: 'zwift-controllers' });
    this.clearTimers();
    const ride = hasService(link.services, ZWIFT_CONTROLLER.rideService) && hasCharacteristic(link, ZWIFT_CONTROLLER.rideService, ZWIFT_CONTROLLER.async);
    if (!ride && !hasService(link.services, ZWIFT_CONTROLLER.service)) {
      // Ride v2 / Click v2 verrouillés : le service Zwift est masqué tant que Zwift ne l'a pas déverrouillé.
      ctx.warn('zwift-controller-locked', WARNING_MESSAGES['zwift-controller-locked'], { reason: 'service-hidden' });
      return;
    }
    const service = ride ? ZWIFT_CONTROLLER.rideService : ZWIFT_CONTROLLER.service;
    this.edges.reset();
    this.lock.reset();
    const onData = (raw: Uint8Array) => {
      if (this.lock.push(raw) === 'locked') {
        const h = ctx.clock.setTimeout(() => {
          if (this.lock.state === 'locked') ctx.warn('zwift-controller-locked', WARNING_MESSAGES['zwift-controller-locked'], { reason: 'challenge' });
        }, ZWIFT_LOCK_GRACE_MS);
        this.timers.push({ clear: () => ctx.clock.clearTimeout(h) });
      }
      if (startsWith(raw, ZWIFT_RIDE_ON) && this.unlock.onHandshakeResponse) {
        void Promise.resolve(this.unlock.onHandshakeResponse(raw)).catch((e: unknown) => ctx.log(`Zwift : poignée de main refusée (${(e as Error).message})`));
      }
      let m;
      try {
        m = decodeZwiftControllerMessage(this.unlock.decrypt ? this.unlock.decrypt(raw) : raw);
      } catch {
        return;
      }
      if (m.type === 'battery') ctx.emit('battery', m.percent);
      else if (m.type === 'handshake') ctx.log('Zwift : poignée de main RideOn reçue');
      else if (m.type === 'vendor' && m.subtype === 0x03) ctx.log('Zwift : défi de déverrouillage reçu (réponse réservée à l’appli Zwift)');
      else if (m.type === 'buttons') {
        for (const b of this.edges.update(filterZwiftPodButtons(this.deviceType, m.pressed))) {
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
    const keepAlive = this.options.keepAliveMs ?? (this.isClickV2(ride) ? ZWIFT_KEEPALIVE_INTERVAL_MS : false);
    if (keepAlive) {
      // RideOn en clair, comme qdomyos-zwift / Torqa : sans trafic, le Click v2 s'endort au bout d'une minute.
      const h = ctx.clock.setInterval(() => {
        link.write(service, ZWIFT_CONTROLLER.syncRx, ZWIFT_RIDE_ON, false).catch(() => undefined);
      }, keepAlive);
      this.timers.push({ clear: () => ctx.clock.clearInterval(h) });
    }
  }

  private clearTimers(): void {
    for (const t of this.timers) t.clear();
    this.timers = [];
  }

  detach(): void {
    this.clearTimers();
  }
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

// --- SRAM AXS ----------------------------------------------------------------------------

/** Stockage des clés SRAM AXS par numéro de série (une clé ne vaut que pour SON composant). */
export interface SramAxsKeyStore {
  get(serial: number): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  set(serial: number, key: Uint8Array): void | Promise<void>;
}

export interface SramAxsShifterOptions {
  /** Clé du composant déjà connue (sinon lue dans `keyStore`). */
  deviceKey?: Uint8Array;
  keyStore?: SramAxsKeyStore;
  /** Émettre un changement de vitesse à chaque changement de rapport réel. Défaut : true. */
  emitGearShifts?: boolean;
  /** Sans appairage : action du clic simple / double. Défaut : monter / descendre. */
  clickActions?: { single: ShiftAction; double: ShiftAction };
  doubleClickMs?: number;
  /** Aléa pour la clé privée Diffie-Hellman (tests). Défaut : crypto.getRandomValues. */
  random?: (n: number) => Uint8Array;
}

function defaultRandom(n: number): Uint8Array {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> } }).crypto;
  if (!c?.getRandomValues) throw new Error('SRAM AXS : générateur aléatoire indisponible');
  return c.getRandomValues(new Uint8Array(n));
}

/**
 * SRAM AXS (dérailleur arrière). Deux modes :
 *   - appairé (clé du composant connue) : lit le rapport engagé chiffré (d905000b) à chaque notification
 *     et émet `shift` avec `realGear` ;
 *   - non appairé : appuis anonymes sur d9050054 → clic simple / double (BikeControl #234).
 * L'appairage (`createBond`) n'est JAMAIS automatique : l'interface le propose et le cycliste maintient
 * le bouton AXS du dérailleur. En dehors de l'appairage, rien n'est écrit ; pendant, seulement d905ee52.
 */
export class SramAxsShifter implements Profile {
  readonly name = 'sram-axs';
  readonly streaming = false;
  private readonly options: SramAxsShifterOptions;
  private readonly tracker = new SramAxsGearTracker();
  private readonly clicks: SramAxsClickClassifier;
  private link: GattConnection | undefined;
  private ctx: ProfileContext | undefined;
  private key: Uint8Array | undefined;
  private unsubscribe: Array<() => Promise<void>> = [];
  private pending: TimerHandle | undefined;
  serial: number | undefined;
  firmware: string | undefined;

  constructor(options: SramAxsShifterOptions = {}) {
    this.options = options;
    this.key = options.deviceKey;
    this.clicks = new SramAxsClickClassifier(options.doubleClickMs);
  }

  /** Dernier état lu (pignon / plateau), si appairé. */
  get gear(): SramAxsDrivetrainStatus | undefined {
    return this.tracker.current;
  }

  get bonded(): boolean {
    return this.key !== undefined;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('SRAM AXS : liaison GATT attendue');
    ctx.warn('experimental-adapter', WARNING_MESSAGES['experimental-adapter'], { adapter: 'sram-axs' });
    this.stop();
    this.link = link;
    this.ctx = ctx;
    const serialSvc = serviceOf(link, SRAM_AXS.serial);
    const rawSerial = serialSvc ? await tryRead(link, serialSvc, SRAM_AXS.serial) : undefined;
    this.serial = rawSerial && rawSerial.length >= 4 ? decodeSramAxsSerial(rawSerial) : sramAxsSerialFromName(ctx.deviceName);
    const recSvc = serviceOf(link, SRAM_AXS.deviceRecord);
    const rec = recSvc ? await tryRead(link, recSvc, SRAM_AXS.deviceRecord) : undefined;
    this.firmware = rec ? decodeSramAxsDeviceRecord(rec)?.text : undefined;
    if (this.firmware) ctx.log(`SRAM AXS ${this.serial ?? '?'} : firmware ${this.firmware}`);
    if (!this.key && this.serial !== undefined && this.options.keyStore) this.key = await this.options.keyStore.get(this.serial);
    if (this.key && (await this.startGear())) return;
    await this.startClicks();
  }

  /**
   * Appairage SRAMBond v1. Le dérailleur doit être en mode appairage (bouton AXS maintenu jusqu'au
   * clignotement). Renouvelle la clé du composant : l'appli SRAM AXS se ré-appairera seule ensuite.
   */
  async createBond(): Promise<Uint8Array> {
    const link = this.link;
    if (!link) throw new Error('SRAM AXS : non connecté');
    const svc = serviceOf(link, SRAM_AXS.bondV1);
    if (!svc) throw new Error('SRAM AXS : service SRAMBond v1 absent (composant non pris en charge)');
    const key = await srambondCreateBond(
      { write: (d) => link.write(svc, SRAM_AXS.bondV1, d, true), read: () => link.read(svc, SRAM_AXS.bondV1) },
      this.options.random ?? defaultRandom,
    );
    this.key = key;
    if (this.serial !== undefined) await this.options.keyStore?.set(this.serial, key);
    if (this.ctx) {
      this.stop();
      if (!(await this.startGear())) await this.startClicks();
    }
    return key;
  }

  private async readGear(link: GattConnection, svc: string): Promise<boolean> {
    const ctx = this.ctx;
    const key = this.key;
    if (!ctx || !key) return false;
    let status: SramAxsDrivetrainStatus;
    try {
      status = decodeSramAxsDrivetrainStatus(decryptSramAxsFrame(key, await link.read(svc, SRAM_AXS.liveState)));
    } catch {
      return false;
    }
    const moves = this.tracker.update(status);
    const g = this.tracker.current;
    if (this.options.emitGearShifts !== false && g?.rear !== undefined) {
      for (const action of moves) ctx.emit('shift', { t: ctx.now(), action, realGear: { front: g.front ?? 1, rear: g.rear } });
    }
    return true;
  }

  private async startGear(): Promise<boolean> {
    const link = this.link;
    const ctx = this.ctx;
    if (!link || !ctx) return false;
    const svc = serviceOf(link, SRAM_AXS.liveState);
    if (!svc) return false;
    this.tracker.reset();
    if (!(await this.readGear(link, svc))) {
      // Clé périmée (l'appli officielle s'est ré-appairée) ou trame illisible : on oublie la clé.
      ctx.log('SRAM AXS : clé refusée par le composant, nouvel appairage nécessaire');
      this.key = undefined;
      return false;
    }
    this.unsubscribe.push(await link.subscribe(svc, SRAM_AXS.liveState, () => void this.readGear(link, svc)));
    return true;
  }

  private async startClicks(): Promise<void> {
    const link = this.link;
    const ctx = this.ctx;
    if (!link || !ctx) return;
    ctx.warn('sram-axs-not-bonded', WARNING_MESSAGES['sram-axs-not-bonded'], { serial: this.serial });
    const svc = serviceOf(link, SRAM_AXS.buttonEvent);
    if (!svc) return;
    const actions = this.options.clickActions ?? { single: 'up', double: 'down' };
    const windowMs = this.clicks.doubleClickMs;
    this.clicks.reset();
    this.unsubscribe.push(
      await link.subscribe(svc, SRAM_AXS.buttonEvent, (d) => {
        // Seule la notification d'un octet 0xFF est un appui (une lecture renvoyée par la pile est ignorée).
        if (!isSramAxsChangeEdge(d)) return;
        const now = ctx.now();
        if (this.pending !== undefined) ctx.clock.clearTimeout(this.pending);
        this.pending = undefined;
        if (this.clicks.press(now) === 'double') {
          ctx.emit('shift', { t: now, action: actions.double });
          return;
        }
        this.pending = ctx.clock.setTimeout(() => {
          this.pending = undefined;
          if (this.clicks.poll(ctx.now()) === 'single') ctx.emit('shift', { t: ctx.now(), action: actions.single });
        }, windowMs);
      }),
    );
  }

  private stop(): void {
    if (this.pending !== undefined) this.ctx?.clock.clearTimeout(this.pending);
    this.pending = undefined;
    for (const u of this.unsubscribe) void u().catch(() => undefined);
    this.unsubscribe = [];
  }

  detach(): void {
    this.stop();
    this.link = undefined;
  }
}
