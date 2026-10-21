/**
 * ANT+ par clé USB, via les commandes natives ant_* (le framing USB est côté Rust ; ici on manipule
 * des pages de 8 octets par canal). Profils : FE-C (trainer), PWR (pédales : seul chemin pour TE/PS
 * des Assioma), HR, et Controls (expérimental).
 *
 * Clé réseau ANT+ : non fournie dans le dépôt (licence ANT+). Elle est passée à `ant_open` via
 * l'option `networkKey` (lue dans la configuration / ANT_PLUS_NETWORK_KEY) ; sans elle, l'app desktop
 * doit la connaître par sa propre configuration.
 *
 * Limites du contrat natif actuel : les messages reçus ne portent pas le n° d'appareil ; la recherche
 * ouvre donc un canal « joker » par profil, qui s'appaire au premier capteur entendu (suffisant à la maison).
 * Aucune commande de fermeture d'un canal seul : `ant_close_channel` est tentée si l'app la propose.
 */
import type { DeviceKind, NativeAntStick } from '@allezrobert/shared';
import { ANT_PLUS_PROFILES, parseAntNetworkKey, type AntPlusProfileName, type ExperimentalAdapters } from '@allezrobert/protocols';
import { isTauri, resolveBridge, toNumberArray, type TauriBridge } from '../tauri.ts';
import type { AntChannelLink, DeviceLink, DiscoveredDevice, ScanHandle, ScanOptions, Transport } from '../types.ts';

export interface AntTransportOptions {
  bridge?: TauriBridge | (() => Promise<TauriBridge>);
  /** Clé réseau ANT+ (8 octets ou chaîne hexadécimale) issue de la configuration. */
  networkKey?: Uint8Array | string;
  /** Clé USB à utiliser (sinon la première). */
  stickId?: string;
  experimental?: Partial<ExperimentalAdapters>;
  /** Nombre de canaux de la clé (8 pour une clé ANT USB-m). */
  maxChannels?: number;
}

const PROFILE_KINDS: Partial<Record<AntPlusProfileName, DeviceKind[]>> = {
  fitnessEquipment: ['trainer'],
  power: ['power', 'cadence'],
  heartRate: ['heartRate'],
  controls: ['shifter'],
};

const PROFILE_NAMES: Partial<Record<AntPlusProfileName, string>> = {
  fitnessEquipment: 'Home trainer ANT+ FE-C',
  power: 'Capteur de puissance ANT+',
  heartRate: 'Ceinture cardio ANT+',
  controls: 'Télécommande ANT+',
};

function profilesFor(kinds: readonly DeviceKind[] | undefined, exp: Partial<ExperimentalAdapters>): AntPlusProfileName[] {
  const want = kinds && kinds.length ? kinds : (['trainer', 'power', 'heartRate', 'shifter'] as DeviceKind[]);
  const out: AntPlusProfileName[] = [];
  if (want.includes('trainer')) out.push('fitnessEquipment');
  if (want.includes('power') || want.includes('cadence')) out.push('power');
  if (want.includes('heartRate')) out.push('heartRate');
  if (want.includes('shifter') && exp.antControls) out.push('controls');
  return out;
}

class AntChannel implements AntChannelLink {
  readonly type = 'ant' as const;
  readonly deviceId: string;
  readonly channel: number;
  readonly profile: AntPlusProfileName;
  private readonly transport: AntTransport;
  pageHandlers = new Set<(p: Uint8Array) => void>();
  private disconnectHandlers = new Set<() => void>();
  closed = false;

  constructor(transport: AntTransport, deviceId: string, channel: number, profile: AntPlusProfileName) {
    this.transport = transport;
    this.deviceId = deviceId;
    this.channel = channel;
    this.profile = profile;
  }

  onPage(handler: (page: Uint8Array) => void): () => void {
    this.pageHandlers.add(handler);
    return () => this.pageHandlers.delete(handler);
  }

  send(page: Uint8Array, acknowledged = true): Promise<void> {
    return this.transport.sendPage(this.channel, page, acknowledged);
  }

  async disconnect(): Promise<void> {
    await this.transport.releaseChannel(this.channel);
    this.lost();
  }

  lost(): void {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.disconnectHandlers) h();
    this.disconnectHandlers.clear();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }
}

export class AntTransport implements Transport {
  readonly kind = 'ant-usb' as const;
  private readonly options: AntTransportOptions;
  private bridgePromise: Promise<TauriBridge> | undefined;
  private opened: Promise<void> | undefined;
  /** canal → profil ouvert (canal de recherche ou d'appareil). */
  private channels = new Map<number, { profile: AntPlusProfileName; link?: AntChannel; seen: boolean }>();
  private readonly networkKey: Uint8Array | undefined;

  constructor(options: AntTransportOptions = {}) {
    this.options = options;
    this.networkKey = typeof options.networkKey === 'string' ? parseAntNetworkKey(options.networkKey) : options.networkKey;
  }

  private bridge(): Promise<TauriBridge> {
    this.bridgePromise ??= resolveBridge(this.options.bridge);
    return this.bridgePromise;
  }

  get hasNetworkKey(): boolean {
    return this.networkKey !== undefined;
  }

  async listSticks(): Promise<NativeAntStick[]> {
    return (await this.bridge()).invoke<NativeAntStick[]>('ant_list_sticks');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.options.bridge && !isTauri()) return false;
    try {
      return (await this.listSticks()).length > 0;
    } catch {
      return false;
    }
  }

  private open(): Promise<void> {
    this.opened ??= (async () => {
      const b = await this.bridge();
      const stickId = this.options.stickId ?? (await this.listSticks())[0]?.id;
      if (!stickId) throw new Error('Aucune clé ANT+ USB détectée');
      await b.listen<{ channel: number; data: number[] }>('ant://message', (e) => this.onMessage(e.payload.channel, Uint8Array.from(e.payload.data)));
      await b.invoke<void>('ant_open', { stickId, ...(this.networkKey ? { networkKey: Array.from(this.networkKey) } : {}) });
    })();
    this.opened.catch(() => {
      this.opened = undefined;
    });
    return this.opened;
  }

  private allocateChannel(): number {
    const max = this.options.maxChannels ?? 8;
    for (let c = 0; c < max; c++) if (!this.channels.has(c)) return c;
    throw new Error('Plus de canal ANT+ libre sur la clé USB');
  }

  private async openChannel(profile: AntPlusProfileName, deviceNumber = 0): Promise<number> {
    await this.open();
    const b = await this.bridge();
    const channel = this.allocateChannel();
    const p = ANT_PLUS_PROFILES[profile];
    this.channels.set(channel, { profile, seen: false });
    try {
      await b.invoke<void>('ant_open_channel', {
        channel,
        deviceType: p.deviceType,
        deviceNumber,
        transmissionType: p.transmissionType,
        period: p.period,
        rfFreq: p.rfFreq,
      });
    } catch (e) {
      this.channels.delete(channel);
      throw e;
    }
    return channel;
  }

  async releaseChannel(channel: number): Promise<void> {
    this.channels.delete(channel);
    const b = await this.bridge();
    // Commande optionnelle (non présente dans le contrat initial) : ignorée si absente.
    await b.invoke<void>('ant_close_channel', { channel }).catch(() => undefined);
  }

  async sendPage(channel: number, page: Uint8Array, acknowledged: boolean): Promise<void> {
    const b = await this.bridge();
    await b.invoke<void>('ant_send', { channel, data: toNumberArray(page), acknowledged });
  }

  private onMessage(channel: number, data: Uint8Array): void {
    const ch = this.channels.get(channel);
    if (!ch) return;
    ch.seen = true;
    this.foundHandlers.get(channel)?.();
    if (ch.link) for (const h of ch.link.pageHandlers) h(data);
  }

  private foundHandlers = new Map<number, () => void>();

  async scan(options: ScanOptions, onFound: (d: DiscoveredDevice) => void): Promise<ScanHandle> {
    const exp = { ...this.options.experimental, ...(options.experimental ?? {}) };
    const opened: number[] = [];
    for (const profile of profilesFor(options.kinds, exp)) {
      // Un canal de ce profil est déjà actif (appareil connecté) : inutile d'en rouvrir un.
      if ([...this.channels.values()].some((c) => c.profile === profile)) continue;
      const channel = await this.openChannel(profile);
      opened.push(channel);
      this.foundHandlers.set(channel, () => {
        this.foundHandlers.delete(channel);
        onFound({
          id: `ant-usb:${profile}:${channel}`,
          name: PROFILE_NAMES[profile] ?? `ANT+ ${profile}`,
          transport: 'ant-usb',
          kinds: PROFILE_KINDS[profile] ?? [],
          services: [`ant+:${profile}`],
          address: { profile, channel, deviceNumber: 0 },
        });
      });
    }
    return {
      stop: async () => {
        // Les canaux de recherche qui ont trouvé un capteur restent ouverts (réutilisés à la connexion).
        for (const c of opened) {
          this.foundHandlers.delete(c);
          const ch = this.channels.get(c);
          if (ch && !ch.seen && !ch.link) await this.releaseChannel(c);
        }
      },
    };
  }

  async connect(device: DiscoveredDevice): Promise<DeviceLink> {
    const profile = String(device.address?.['profile'] ?? '') as AntPlusProfileName;
    if (!(profile in ANT_PLUS_PROFILES)) throw new Error(`Profil ANT+ inconnu : ${profile}`);
    const wanted = device.address?.['channel'];
    let channel: number | undefined;
    if (typeof wanted === 'number') {
      const ch = this.channels.get(wanted);
      if (ch && ch.profile === profile && !ch.link) channel = wanted;
    }
    channel ??= await this.openChannel(profile, Number(device.address?.['deviceNumber'] ?? 0));
    const entry = this.channels.get(channel)!;
    const link = new AntChannel(this, device.id, channel, profile);
    entry.link = link;
    return link;
  }

  /** Ferme la clé USB (tous les canaux). */
  async close(): Promise<void> {
    const b = await this.bridge();
    for (const ch of this.channels.values()) ch.link?.lost();
    this.channels.clear();
    this.opened = undefined;
    await b.invoke<void>('ant_close').catch(() => undefined);
  }
}
