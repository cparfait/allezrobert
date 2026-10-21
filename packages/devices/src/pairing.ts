/**
 * Appairages persistés : configuration sérialisable (JSON), stockage injecté (localStorage, fichier Tauri…).
 */
import type { DeviceKind, TransportKind } from '@allezrobert/shared';
import { EXPERIMENTAL_ADAPTERS_DEFAULT, type ExperimentalAdapters } from '@allezrobert/protocols';
import type { DiscoveredDevice } from './types.ts';

export type Role = 'trainer' | 'power' | 'heartRate' | 'cadence' | 'shifter' | 'fan';

export interface RoleAssignments {
  trainer?: string;
  /** Source de puissance de référence (pédales) ; à défaut, la puissance du trainer est utilisée. */
  power?: string;
  heartRate?: string;
  cadence?: string;
  fan?: string;
  /** Plusieurs commandes de vitesses possibles en même temps. */
  shifters: string[];
}

export interface PairedDevice {
  id: string;
  name: string;
  transport: TransportKind;
  kinds: DeviceKind[];
  services: string[];
  address?: Record<string, string | number | boolean>;
  autoConnect: boolean;
}

export interface PairingConfig {
  version: 1;
  devices: PairedDevice[];
  roles: RoleAssignments;
  /** Adaptateur Bluetooth choisi dans l'app desktop. */
  adapterId?: string;
  smoothing: boolean;
  powerMatch: boolean;
  experimental: ExperimentalAdapters;
}

export interface PairingStorage {
  load(): Promise<string | null | undefined> | string | null | undefined;
  save(data: string): Promise<void> | void;
}

export function emptyPairingConfig(): PairingConfig {
  return { version: 1, devices: [], roles: { shifters: [] }, smoothing: false, powerMatch: true, experimental: { ...EXPERIMENTAL_ADAPTERS_DEFAULT } };
}

export function pairedFromDiscovered(d: DiscoveredDevice, autoConnect = true): PairedDevice {
  return {
    id: d.id,
    name: d.name,
    transport: d.transport,
    kinds: [...d.kinds],
    services: [...d.services],
    ...(d.address ? { address: { ...d.address } } : {}),
    autoConnect,
  };
}

export function discoveredFromPaired(p: PairedDevice): DiscoveredDevice {
  return {
    id: p.id,
    name: p.name,
    transport: p.transport,
    kinds: [...p.kinds],
    services: [...p.services],
    ...(p.address ? { address: { ...p.address } } : {}),
  };
}

export function serializePairingConfig(c: PairingConfig): string {
  return JSON.stringify(c, null, 2);
}

/** Lecture tolérante : champs manquants complétés, version inconnue → configuration vide. */
export function parsePairingConfig(text: string | null | undefined): PairingConfig {
  const base = emptyPairingConfig();
  if (!text) return base;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return base;
  }
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return base;
  const r = raw as Partial<PairingConfig>;
  const devices = Array.isArray(r.devices)
    ? r.devices.filter((d): d is PairedDevice => !!d && typeof d.id === 'string' && typeof d.transport === 'string').map((d) => ({
        ...d,
        name: typeof d.name === 'string' ? d.name : d.id,
        kinds: Array.isArray(d.kinds) ? d.kinds : [],
        services: Array.isArray(d.services) ? d.services : [],
        autoConnect: d.autoConnect !== false,
      }))
    : [];
  const roles: RoleAssignments = { shifters: [] };
  if (r.roles && typeof r.roles === 'object') {
    for (const k of ['trainer', 'power', 'heartRate', 'cadence', 'fan'] as const) {
      const v = r.roles[k];
      if (typeof v === 'string') roles[k] = v;
    }
    if (Array.isArray(r.roles.shifters)) roles.shifters = r.roles.shifters.filter((x): x is string => typeof x === 'string');
  }
  return {
    version: 1,
    devices,
    roles,
    ...(typeof r.adapterId === 'string' ? { adapterId: r.adapterId } : {}),
    smoothing: r.smoothing === true,
    powerMatch: r.powerMatch !== false,
    experimental: { ...EXPERIMENTAL_ADAPTERS_DEFAULT, ...(r.experimental ?? {}) },
  };
}

export class MemoryPairingStorage implements PairingStorage {
  data: string | null = null;
  load(): string | null {
    return this.data;
  }
  save(data: string): void {
    this.data = data;
  }
}

/** Stockage navigateur (localStorage). */
export function localStoragePairingStorage(key = 'allezrobert.devices'): PairingStorage {
  const ls = (globalThis as unknown as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  return {
    load: () => ls?.getItem(key) ?? null,
    save: (data) => ls?.setItem(key, data),
  };
}
