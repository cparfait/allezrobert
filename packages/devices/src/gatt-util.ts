/** Aides autour de la liaison GATT et de la reconnaissance des appareils. */
import type { DeviceKind } from '@allezrobert/shared';
import {
  HEADWIND,
  SERVICE,
  SHIMANO_DFLY,
  TACX_FEC,
  ZWIFT_CONTROLLER,
  normalizeUuid,
  type ExperimentalAdapters,
} from '@allezrobert/protocols';
import type { GattConnection, GattServiceInfo } from './types.ts';

export function hasService(services: readonly GattServiceInfo[] | readonly string[], uuid: string): boolean {
  const u = normalizeUuid(uuid);
  for (const s of services) {
    const id = typeof s === 'string' ? s : s.uuid;
    try {
      if (normalizeUuid(id) === u) return true;
    } catch {
      // UUID illisible : ignorée
    }
  }
  return false;
}

export function hasCharacteristic(conn: GattConnection, service: string, characteristic: string): boolean {
  const s = normalizeUuid(service);
  const c = normalizeUuid(characteristic);
  const svc = conn.services.find((x) => normalizeUuid(x.uuid) === s);
  return !!svc && svc.characteristics.some((x) => normalizeUuid(x.uuid) === c);
}

/** Tente une lecture, renvoie undefined en cas d'échec (caractéristique optionnelle). */
export async function tryRead(conn: GattConnection, service: string, characteristic: string): Promise<Uint8Array | undefined> {
  if (!hasCharacteristic(conn, service, characteristic)) return undefined;
  try {
    return await conn.read(service, characteristic);
  } catch {
    return undefined;
  }
}

/** Déduit les rôles possibles d'un appareil à partir de ses services annoncés et de son nom. */
export function kindsFromServices(services: readonly string[], name = '', experimental: Partial<ExperimentalAdapters> = {}): DeviceKind[] {
  const kinds = new Set<DeviceKind>();
  const isTrainer = hasService(services, SERVICE.fitnessMachine) || hasService(services, TACX_FEC.service);
  if (isTrainer) kinds.add('trainer');
  else if (hasService(services, SERVICE.cyclingPower)) kinds.add('power');
  if (hasService(services, SERVICE.heartRate)) kinds.add('heartRate');
  if (!isTrainer && hasService(services, SERVICE.cyclingSpeedCadence)) {
    kinds.add('cadence');
    kinds.add('speed');
  }
  if (!isTrainer && kinds.has('power')) kinds.add('cadence');
  if (experimental.zwiftControllers && (hasService(services, ZWIFT_CONTROLLER.service) || hasService(services, ZWIFT_CONTROLLER.rideService) || /^zwift (click|play|ride)/i.test(name))) {
    kinds.add('shifter');
  }
  if (experimental.shimanoDfly && hasService(services, SHIMANO_DFLY.service)) kinds.add('shifter');
  if (experimental.headwind && (hasService(services, HEADWIND.service) || /headwind/i.test(name))) kinds.add('fan');
  return [...kinds];
}

/** Services à demander pour une famille d'appareils (filtres de recherche). */
export function servicesForKinds(kinds: readonly DeviceKind[] | undefined, experimental: Partial<ExperimentalAdapters> = {}): string[] {
  const all: DeviceKind[] = kinds && kinds.length ? [...kinds] : ['trainer', 'power', 'heartRate', 'cadence', 'speed', 'shifter', 'fan'];
  const out = new Set<string>();
  for (const k of all) {
    if (k === 'trainer') {
      out.add(SERVICE.fitnessMachine);
      out.add(TACX_FEC.service);
    }
    if (k === 'power') out.add(SERVICE.cyclingPower);
    if (k === 'heartRate') out.add(SERVICE.heartRate);
    if (k === 'cadence' || k === 'speed') {
      out.add(SERVICE.cyclingSpeedCadence);
      if (k === 'cadence') out.add(SERVICE.cyclingPower);
    }
    if (k === 'shifter') {
      if (experimental.zwiftControllers) {
        out.add(ZWIFT_CONTROLLER.service);
        out.add(ZWIFT_CONTROLLER.rideService);
      }
      if (experimental.shimanoDfly) out.add(SHIMANO_DFLY.service);
    }
    if (k === 'fan' && experimental.headwind) out.add(HEADWIND.service);
  }
  return [...out];
}

/** Tous les services que le jeu peut utiliser (Web Bluetooth : `optionalServices`). */
export const ALL_KNOWN_SERVICES: string[] = [
  SERVICE.fitnessMachine,
  SERVICE.cyclingPower,
  SERVICE.heartRate,
  SERVICE.cyclingSpeedCadence,
  SERVICE.battery,
  SERVICE.deviceInformation,
  TACX_FEC.service,
  ZWIFT_CONTROLLER.service,
  ZWIFT_CONTROLLER.rideService,
  HEADWIND.service,
  SHIMANO_DFLY.service,
];
