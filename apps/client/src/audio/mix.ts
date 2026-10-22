/**
 * Mixage du son du jeu : un bus par catégorie (ambiance, vélo, souffle, public, trafic) sous un
 * volume général, réglés dans le menu Réglages et le menu pause, enregistrés localement
 * (`ar.sound`). La musique a ses propres réglages (music.ts).
 */

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
}

export const DEFAULT_MIX: SoundMix = { master: 0.8, ambience: 0.8, bike: 0.8, breath: 0.5, crowd: 0.8, traffic: 0.7, breathOn: true };

export const BUS_LABELS: Record<Bus | 'master', { fr: string; en: string }> = {
  master: { fr: 'Général', en: 'Master' },
  ambience: { fr: 'Ambiance (nature, météo, villages)', en: 'Ambience (nature, weather, villages)' },
  bike: { fr: 'Vélo (roulement, roue libre, vent)', en: 'Bike (tyres, freewheel, wind)' },
  breath: { fr: 'Souffle du coureur', en: 'Rider breathing' },
  crowd: { fr: 'Public', en: 'Crowd' },
  traffic: { fr: 'Trafic', en: 'Traffic' },
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
