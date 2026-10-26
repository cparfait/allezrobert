/**
 * Choix du micro et de la sortie audio (menu Réglages › Son, et menu pause).
 *
 * Mémorisé localement (`ar.audioDevices`) : '' = appareil par défaut du système. Les identifiants
 * d'appareil changent d'un navigateur à l'autre ; un appareil débranché retombe sur le défaut.
 * - Sortie : `setSinkId` (Chrome, Edge, Opera ; pas Firefox ni Safari, où le choix est masqué) sur le
 *   moteur audio, la musique, la voix off et la voix des coureurs.
 * - Micro : appliqué à la voix des coureurs (LiveKit) ; changement en direct.
 */

const KEY = 'ar.audioDevices';

export interface AudioDeviceChoice {
  micId: string;
  speakerId: string;
}

type Listener = (c: AudioDeviceChoice) => void;
const listeners = new Set<Listener>();

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getAudioDevices(): AudioDeviceChoice {
  try {
    const o = JSON.parse(storage()?.getItem(KEY) ?? '{}') as Partial<AudioDeviceChoice>;
    return { micId: typeof o.micId === 'string' ? o.micId : '', speakerId: typeof o.speakerId === 'string' ? o.speakerId : '' };
  } catch {
    return { micId: '', speakerId: '' };
  }
}

export function setAudioDevices(patch: Partial<AudioDeviceChoice>): void {
  const next = { ...getAudioDevices(), ...patch };
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Stockage plein ou interdit : le choix vaut pour la session seulement.
  }
  for (const l of listeners) l(next);
}

/** Prévenu à chaque changement de micro ou de sortie ; renvoie la désinscription. */
export function onAudioDevices(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Le navigateur sait envoyer le son vers une sortie choisie (`setSinkId`). */
export function canChooseOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

type Sinkable = { setSinkId?: (id: string) => Promise<void> };

/** Envoie le son d'un élément audio ou d'un AudioContext vers la sortie choisie (sans effet si non prise en charge). */
export function applySink(target: Sinkable | HTMLMediaElement | BaseAudioContext, speakerId = getAudioDevices().speakerId): void {
  const t = target as Sinkable;
  if (typeof t.setSinkId !== 'function') return;
  // AudioContext : la sortie par défaut s'exprime par '' (ou { type: 'none' } pour couper) ; l'identifiant d'un appareil disparu est ignoré.
  void t.setSinkId(speakerId).catch(() => undefined);
}

/** Garde un AudioContext ou un élément sur la sortie choisie, aujourd'hui et à chaque changement. */
export function followSink(target: Sinkable | HTMLMediaElement | BaseAudioContext): () => void {
  applySink(target);
  return onAudioDevices((c) => applySink(target, c.speakerId));
}

export interface ListedDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  /** Les noms sont masqués tant que le navigateur n'a pas accordé le micro. */
  labelled: boolean;
}

/** Appareils audio disponibles. Les noms n'apparaissent qu'après autorisation du micro (`askMicAccess`). */
export async function listAudioDevices(): Promise<ListedDevices> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [], labelled: false };
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  // Sans autorisation du micro, le navigateur ne donne ni nom ni identifiant : rien à choisir encore.
  const usable = (d: MediaDeviceInfo, kind: MediaDeviceKind): boolean => d.kind === kind && !!d.deviceId && d.deviceId !== 'communications';
  const inputs = all.filter((d) => usable(d, 'audioinput'));
  const outputs = all.filter((d) => usable(d, 'audiooutput'));
  return { inputs, outputs, labelled: all.some((d) => d.label) };
}

/** Demande l'accès au micro (pour que les appareils aient un nom) puis le relâche aussitôt. */
export async function askMicAccess(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return true;
  } catch {
    return false;
  }
}

/** Prévenu quand un appareil est branché ou débranché. */
export function onDevicesChanged(cb: () => void): () => void {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  md?.addEventListener?.('devicechange', cb);
  return () => md?.removeEventListener?.('devicechange', cb);
}
