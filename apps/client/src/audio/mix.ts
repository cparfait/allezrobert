/**
 * Mixage du son du jeu : un bus par catégorie (ambiance, vélo, souffle, public, trafic) sous un
 * volume général, réglés dans le menu Réglages et le menu pause, enregistrés localement
 * (`ar.sound`). La musique a ses propres réglages (music.ts).
 */

import { DEFAULT_FREEWHEEL, isFreewheelId } from './freewheels.ts';

export const BUSES = ['ambience', 'bike', 'breath', 'crowd', 'traffic'] as const;
export type Bus = (typeof BUSES)[number];

export interface SoundMix {
  master: number;
  ambience: number;
  bike: number;
  breath: number;
  crowd: number;
  traffic: number;
  /** Souffle du coureur activé (discret, coupable). */
  breathOn: boolean;
  /** Son de la roue libre (freewheels.ts). */
  freewheel: string;
}

export const DEFAULT_MIX: SoundMix = { master: 0.8, ambience: 0.8, bike: 0.8, breath: 0.5, crowd: 0.8, traffic: 0.7, breathOn: true, freewheel: DEFAULT_FREEWHEEL };

export const BUS_LABELS: Record<Bus | 'master', { fr: string; en: string; hint: { fr: string; en: string } }> = {
  master: { fr: 'Général', en: 'Master', hint: { fr: 'Tous les sons du jeu (hors musique)', en: 'All game sounds (not music)' } },
  ambience: { fr: 'Ambiance', en: 'Ambience', hint: { fr: 'Nature, météo, villages, cloches', en: 'Nature, weather, villages, bells' } },
  bike: { fr: 'Vélo', en: 'Bike', hint: { fr: 'Roulement, roue libre, dérailleur, vent', en: 'Tyres, freewheel, shifting, wind' } },
  breath: { fr: 'Souffle', en: 'Breathing', hint: { fr: 'Respiration du coureur à l’effort', en: 'Rider breathing when pushing' } },
  crowd: { fr: 'Public', en: 'Crowd', hint: { fr: 'Spectateurs des côtes et des sprints', en: 'Spectators on climbs and sprints' } },
  traffic: { fr: 'Trafic', en: 'Traffic', hint: { fr: 'Voitures, camionnettes, tracteurs', en: 'Cars, vans, tractors' } },
};

const KEY = 'ar.sound';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const vol = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);

/** Réglages enregistrés, bornés ; l'ancien volume unique (`ar.volume`) devient le volume général. */
export function loadMix(store: Store | null = storage()): SoundMix {
  const m = { ...DEFAULT_MIX };
  if (!store) return m;
  try {
    const legacy = store.getItem('ar.volume');
    if (legacy !== null) m.master = vol(Number(legacy), m.master);
    const raw = store.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Record<keyof SoundMix, unknown>>;
      m.master = vol(o.master, m.master);
      for (const b of BUSES) m[b] = vol(o[b], m[b]);
      if (typeof o.breathOn === 'boolean') m.breathOn = o.breathOn;
      if (isFreewheelId(o.freewheel)) m.freewheel = o.freewheel;
    }
  } catch {
    // Réglages illisibles : valeurs par défaut.
  }
  return m;
}

export function saveMix(m: SoundMix, store: Store | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(m));
  } catch {
    // Stockage plein ou interdit : réglage valable pour la session seulement.
  }
}

/** Contexte d'écoute : pause (menu pause, intro), son coupé (touche M). */
export interface MixContext {
  paused: boolean;
  muted: boolean;
}

/**
 * Gains des bus. En pause, le vélo, le souffle, le public et le trafic se taisent (la scène est
 * figée) ; l'ambiance reste, atténuée, pour que le menu pause ne tombe pas dans le silence.
 */
export function busGains(m: SoundMix, c: MixContext): Record<Bus | 'master', number> {
  const p = c.paused;
  return {
    master: c.muted ? 0 : m.master,
    ambience: m.ambience * (p ? 0.5 : 1),
    bike: p ? 0 : m.bike,
    breath: p || !m.breathOn ? 0 : m.breath,
    crowd: p ? 0 : m.crowd,
    traffic: p ? 0 : m.traffic,
  };
}

// Réglage partagé, modifiable en direct (menu pause) : le moteur audio s'y abonne.
let current: SoundMix | null = null;
const listeners = new Set<(m: SoundMix) => void>();

export function getMix(): SoundMix {
  current ??= loadMix();
  return current;
}

export function setMix(patch: Partial<SoundMix>): SoundMix {
  current = { ...getMix(), ...patch };
  saveMix(current);
  for (const l of listeners) l(current);
  return current;
}

export function onMixChange(cb: (m: SoundMix) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
