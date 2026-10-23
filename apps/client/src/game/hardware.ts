import { DEFAULT_FAN_SETTINGS, type FanSettings } from '@allezrobert/devices';

/**
 * Préférences matériel du poste (hors profil coureur) : ventilateur, manette, télécommande HID,
 * clé réseau ANT+ et adresses Direct Connect saisies à la main. Les appairages, les rôles et les
 * adaptateurs expérimentaux sont, eux, conservés par le DeviceManager (clé `ar.devices`).
 */
export interface HardwarePrefs {
  fan: FanSettings;
  /** Manette (API Gamepad) : RB/LB et croix haut/bas changent de vitesse. */
  gamepad: boolean;
  /** Télécommande HID apprise : KeyboardEvent.code → action. */
  hidBindings: Record<string, 'up' | 'down'>;
  /** Clé réseau ANT+ (16 caractères hexadécimaux), jamais dans le dépôt : saisie par le coureur. */
  antNetworkKey: string;
  /** Trainers Direct Connect ajoutés par adresse IP (mDNS bloqué sur certains réseaux). */
  dirconHosts: string[];
}

const KEY = 'ar.hardware';

export const DEFAULT_HARDWARE_PREFS: HardwarePrefs = {
  fan: { ...DEFAULT_FAN_SETTINGS },
  gamepad: true,
  hidBindings: {},
  antNetworkKey: '',
  dirconHosts: [],
};

let cache: HardwarePrefs | undefined;
const listeners: Array<(p: HardwarePrefs) => void> = [];

export function loadHardwarePrefs(): HardwarePrefs {
  if (cache) return cache;
  let raw: Partial<HardwarePrefs> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<HardwarePrefs>;
  } catch {
    // Préférences illisibles : valeurs par défaut.
  }
  cache = {
    ...DEFAULT_HARDWARE_PREFS,
    ...raw,
    fan: { ...DEFAULT_HARDWARE_PREFS.fan, ...(raw.fan ?? {}) },
    hidBindings: { ...(raw.hidBindings ?? {}) },
    dirconHosts: Array.isArray(raw.dirconHosts) ? raw.dirconHosts.filter((h): h is string => typeof h === 'string') : [],
  };
  return cache;
}

/** Modifie et enregistre les préférences ; prévient les abonnés (ventilateur, manette…). */
export function updateHardwarePrefs(change: (p: HardwarePrefs) => void): HardwarePrefs {
  const p = loadHardwarePrefs();
  change(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Stockage indisponible (navigation privée) : réglage gardé pour cette session.
  }
  listeners.forEach((l) => l(p));
  return p;
}

export function onHardwarePrefs(cb: (p: HardwarePrefs) => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}
