import { loadTauriBridge } from '@allezrobert/devices';

/**
 * Application Windows (Tauri, apps/desktop) : accès au Rust pour ce que le navigateur ne fait pas ou mal
 * (dossier de données, téléchargements, écran gardé allumé, plein écran, mises à jour, fichiers exportés).
 * Chaque fonction a un équivalent web ou ne fait rien hors de l'application : le jeu reste le même partout.
 */
export const inDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Serveur des zones, ressources et mises à jour pour l'application Windows (la version web sert tout elle-même). */
export const DOWNLOADS_HOST = 'https://allezrobert.cparfait.ovh';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
/** Serveur des téléchargements (zones, ressources du jeu) : `VITE_WORLDS_URL`, sinon le VPS. */
export const DOWNLOADS_BASE = env.VITE_WORLDS_URL || DOWNLOADS_HOST;

/** Commande Rust (`invoke`) ; rejette avec le message d'erreur en français. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<T> } }).__TAURI_INTERNALS__;
  return internals.invoke(command, args ?? {});
}

/** Événement émis par le Rust ; renvoie de quoi se désabonner. */
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const bridge = await loadTauriBridge();
  return bridge.listen<T>(event, (e) => handler(e.payload));
}

let wakeLock: { release(): Promise<void> } | null = null;

/** Écran et PC gardés éveillés pendant une sortie (Windows : `SetThreadExecutionState` ; web : Wake Lock). */
export function keepAwake(on: boolean): void {
  if (inDesktop) {
    void invoke('keep_awake', { on }).catch(() => undefined);
    return;
  }
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  if (on && !wakeLock && nav.wakeLock && document.visibilityState === 'visible') {
    void nav.wakeLock
      .request('screen')
      .then((l) => (wakeLock = l))
      .catch(() => undefined);
  } else if (!on && wakeLock) {
    void wakeLock.release().catch(() => undefined);
    wakeLock = null;
  }
}

const FULLSCREEN_KEY = 'ar.fullscreen';

/** F11 : plein écran natif de la fenêtre (retenu d'un lancement à l'autre). Sans effet dans un navigateur, qui a le sien. */
export function installFullscreenKey(): void {
  if (!inDesktop) return;
  const apply = (on: boolean) =>
    invoke<boolean>('set_fullscreen', { on })
      .then((now) => localStorage.setItem(FULLSCREEN_KEY, now ? '1' : '0'))
      .catch(() => undefined);
  if (localStorage.getItem(FULLSCREEN_KEY) === '1') void apply(true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || e.repeat) return;
    e.preventDefault();
    void apply(localStorage.getItem(FULLSCREEN_KEY) !== '1');
  });
}

const PROFILE_SKIP = new Set(['ar.packs']);

/**
 * Sauvegarde du stockage local de la page (réglages, progression, records…) dans le dossier de données,
 * à chaque changement (regroupés) : si WebView2 perd ses données, le Rust les restaure au lancement
 * suivant (storage.rs, `profile_restore_script`).
 */
export function mirrorProfile(): void {
  if (!inDesktop) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('ar.') || PROFILE_SKIP.has(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
    void invoke('profile_save', { json: JSON.stringify(data) }).catch((e) => console.warn('Sauvegarde du profil impossible', e));
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 3000);
  };
  const proto = Storage.prototype;
  const set = proto.setItem;
  const remove = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    set.call(this, key, value);
    if (this === localStorage && key.startsWith('ar.')) schedule();
  };
  proto.removeItem = function (this: Storage, key: string) {
    remove.call(this, key);
    if (this === localStorage && key.startsWith('ar.')) schedule();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      flush();
    }
  });
  flush();
}

/**
 * Fichier exporté (sortie FIT/GPX, capture) : dans l'application, enregistré directement dans
 * Documents\Allez Robert\Sorties ou Images\Allez Robert (renvoie le chemin) ; dans un navigateur, téléchargé.
 */
export async function saveExport(kind: 'ride' | 'screenshot', name: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  if (inDesktop) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return invoke<string>('save_export', { kind, name, base64: btoa(bin) });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return null;
}

/** Montre un fichier enregistré par l'application dans l'explorateur Windows. */
export function revealPath(path: string): void {
  if (inDesktop) void invoke('reveal_path', { path }).catch(() => undefined);
}
