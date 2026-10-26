/**
 * Roues libres : sons de moyeu enregistrés (boucles) en plus du cliquet synthétisé. Chaque boucle
 * est lue à une vitesse proportionnelle à la vitesse de la roue (le grain monte avec elle, comme
 * sur un vrai moyeu). Fichiers dans public/audio/freewheel/, crédits dans CREDITS.md du dossier.
 */
export interface FreewheelDef {
  id: string;
  label: { fr: string; en: string };
  /** Fichier sous /audio/freewheel/ ; absent = cliquet synthétisé. */
  file?: string;
  /** Cliquets par seconde dans l'enregistrement (lecture à vitesse 1). */
  baseRate?: number;
  /** Niveau relatif (les fichiers sont normalisés à −24 LUFS). */
  gain?: number;
}

export const FREEWHEELS: readonly FreewheelDef[] = [
  { id: 'synth', label: { fr: 'Discret (synthétisé)', en: 'Quiet (synthesised)' } },
  { id: 'campagnolo', label: { fr: 'Campagnolo', en: 'Campagnolo' }, file: 'hub-campagnolo.ogg', baseRate: 40, gain: 1 },
  { id: 'coasting', label: { fr: 'Moyeu route, nerveux', en: 'Road hub, snappy' }, file: 'hub-coasting.ogg', baseRate: 33, gain: 1 },
  { id: 'loud', label: { fr: 'Moyeu bruyant', en: 'Loud hub' }, file: 'hub-loop.ogg', baseRate: 41, gain: 1.6 },
];

export const DEFAULT_FREEWHEEL = 'campagnolo';

export function isFreewheelId(x: unknown): x is string {
  return typeof x === 'string' && FREEWHEELS.some((f) => f.id === x);
}

export function freewheelDef(id: string): FreewheelDef {
  return FREEWHEELS.find((f) => f.id === id) ?? (FREEWHEELS[0] as FreewheelDef);
}

/** Écart de hauteur toléré par rapport à l'enregistrement (au-delà, le son devient celui d'un 33 tours accéléré). */
const MAX_PITCH = 1.3;
const MAX_VOICES = 6;

/**
 * Copies de la boucle à superposer et vitesse de lecture de chacune pour atteindre la cadence de
 * cliquets voulue : on ajoute des copies avant de transposer.
 */
export function loopVoices(def: FreewheelDef, clicksPerSecond: number): { voices: number; rate: number } {
  const base = def.baseRate ?? 1;
  const ratio = Math.max(0.01, clicksPerSecond / base);
  const voices = Math.min(MAX_VOICES, Math.max(1, Math.ceil(ratio / MAX_PITCH)));
  return { voices, rate: Math.min(MAX_PITCH + 0.2, Math.max(0.7, ratio / voices)) };
}
