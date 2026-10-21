/**
 * Accès au pont Tauri (commandes `invoke` et événements `listen`), selon le contrat
 * packages/shared/src/native-bridge.ts. Les modules @tauri-apps/api ne sont importés dynamiquement
 * QUE si l'on tourne dans l'app desktop (détection `'__TAURI_INTERNALS__' in window`).
 * Le pont est injectable pour les tests.
 */
export interface TauriEvent<T> {
  payload: T;
}

export interface TauriBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
}

export function isTauri(): boolean {
  const w = (globalThis as unknown as { window?: object }).window;
  return typeof w === 'object' && w !== null && '__TAURI_INTERNALS__' in w;
}

let cached: Promise<TauriBridge> | undefined;

/** Charge le pont Tauri réel (import dynamique). Lève une erreur hors de l'app desktop. */
export function loadTauriBridge(): Promise<TauriBridge> {
  if (!isTauri()) return Promise.reject(new Error("Pont natif indisponible : le jeu ne tourne pas dans l'app desktop Tauri"));
  cached ??= (async () => {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    const bridge: TauriBridge = {
      invoke: <T>(command: string, args?: Record<string, unknown>) => core.invoke<T>(command, args),
      listen: async <T>(name: string, handler: (e: TauriEvent<T>) => void) => {
        const unlisten = await event.listen<T>(name, (e) => handler({ payload: e.payload }));
        return () => unlisten();
      },
    };
    return bridge;
  })();
  return cached;
}

/** Résout un pont injecté ou le pont réel. */
export function resolveBridge(bridge: TauriBridge | (() => Promise<TauriBridge>) | undefined): Promise<TauriBridge> {
  if (!bridge) return loadTauriBridge();
  if (typeof bridge === 'function') return bridge();
  return Promise.resolve(bridge);
}

export function toNumberArray(data: Uint8Array): number[] {
  return Array.from(data);
}
