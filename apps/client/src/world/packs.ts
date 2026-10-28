import type { WorldCatalogue, WorldPackManifest } from '@allezrobert/shared';
import { DOWNLOADS_HOST, inDesktop, invoke, listen } from '../platform/desktop.ts';

/**
 * Packs de cartes : chaque zone (monde) se télécharge d'un bloc depuis le menu et reste sur
 * l'appareil, au lieu d'être embarquée dans l'application. Le jeu lit d'abord le pack installé, puis le serveur.
 *
 * - Navigateur : Cache Storage, fichiers gardés compressés, téléchargés par la page (6 à la fois).
 * - Application Windows : dossier de données sur le disque (`<données>/worlds/<id>/`), téléchargé par le
 *   Rust (apps/desktop/src-tauri/src/packs.rs : 16 fichiers à la fois, empreintes vérifiées, reprise,
 *   mise à jour par différence) et lu par le protocole `worlds://` (`http://worlds.localhost`).
 * - Catalogue `worlds/index.json` et `world.json` / itinéraires : livrés avec le jeu.
 * - Tuiles et `tiles/pack.json` : sur le serveur des mondes (même origine en web ; l'application
 *   Windows les prend sur le VPS, voir DOWNLOADS_HOST).
 */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
export const inTauri = inDesktop;
/** Préfixe des tuiles : `VITE_WORLDS_URL`, sinon le VPS dans l'application Windows, sinon la même origine. */
export const TILES_BASE = env.VITE_WORLDS_URL ?? (inTauri ? DOWNLOADS_HOST : '');
/** Application Windows : lecture des zones du disque. */
const DISK = 'http://worlds.localhost';

const KEY = 'ar.packs';
const cacheName = (id: string) => `ar-pack-${id}`;
const hasCaches = () => typeof caches !== 'undefined';
/**
 * Fichiers du pack gardés compressés (gzip) sur l'appareil : ≈ 2 × moins de place. Les images
 * (déjà compressées) restent telles quelles. Marqueur d'en-tête : décompression à la lecture.
 */
const GZ_HEADER = 'x-ar-gz';
const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
const compressible = (p: string) => !/\.(jpe?g|png|webp)$/i.test(p);

export type PackState = { kind: 'installed'; version: string; upToDate: boolean } | { kind: 'absent' } | { kind: 'unavailable' };

interface Installed {
  version: string;
  bytes: number;
  /**
   * Version annoncée par le catalogue au moment de l'installation : si le serveur n'a pas (encore)
   * cette version, la zone est quand même « à jour » pour ce catalogue (pas de mise à jour en boucle).
   */
  catalogue?: string;
}

/** Application Windows : zones présentes sur le disque (lues par `initPacks`, tenues à jour ensuite). */
let disk: Map<string, Installed> | null = null;

/**
 * Application Windows : liste des zones du dossier de données, à lire avant le menu. Les zones des versions
 * précédentes (Cache Storage de WebView2) ne sont plus lues : leur place est rendue. Sans effet dans un navigateur.
 */
export async function initPacks(): Promise<void> {
  if (!inDesktop) return;
  try {
    const list = await invoke<Array<{ id: string; version: string; bytes: number; catalogue?: string }>>('packs_list');
    disk = new Map(list.map((p) => [p.id, { version: p.version, bytes: p.bytes, ...(p.catalogue ? { catalogue: p.catalogue } : {}) }]));
  } catch (err) {
    console.warn('Zones du disque illisibles', err);
    disk = new Map();
  }
  if (localStorage.getItem(KEY) !== null) localStorage.removeItem(KEY);
  if (hasCaches()) for (const name of await caches.keys().catch(() => [] as string[])) if (name.startsWith('ar-pack-')) await caches.delete(name);
}

function installed(): Record<string, Installed> {
  if (inDesktop) return Object.fromEntries(disk ?? []);
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Installed>;
  } catch {
    return {};
  }
}

function setInstalled(id: string, v: Installed | null): void {
  const all = installed();
  if (v) all[id] = v;
  else delete all[id];
  localStorage.setItem(KEY, JSON.stringify(all));
}

let catalogue: Promise<WorldCatalogue | null> | null = null;

/** Catalogue des zones (null hors ligne ou s'il manque : le menu se contente du monde chargé). */
export function loadCatalogue(): Promise<WorldCatalogue | null> {
  catalogue ??= fetch('/worlds/index.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<WorldCatalogue>) : null))
    .catch(() => null);
  return catalogue;
}

/** État du pack d'une zone, comparé à la version du catalogue. */
export function packState(id: string, catalogueVersion: string | undefined): PackState {
  if (!inDesktop && !hasCaches()) return { kind: 'unavailable' };
  const i = installed()[id];
  if (!i) return { kind: 'absent' };
  return { kind: 'installed', version: i.version, upToDate: !catalogueVersion || catalogueVersion === i.version || catalogueVersion === i.catalogue };
}

/**
 * Télécharge le pack d'une zone dans le Cache Storage (6 fichiers à la fois), avec la progression
 * en octets. Une version précédente est remplacée une fois le téléchargement complet.
 */
export async function installPack(id: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  if (inDesktop) return installOnDisk(id, onProgress, signal);
  if (!hasCaches()) throw new Error('stockage hors ligne indisponible (page non sécurisée)');
  const res = await fetch(`${TILES_BASE}/worlds/${id}/tiles/pack.json`, { cache: 'no-store', ...(signal ? { signal } : {}) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`pack introuvable sur le serveur (HTTP ${res.status})`);
  const manifest = (await res.json()) as WorldPackManifest;
  const tmpName = `${cacheName(id)}-tmp`;
  await caches.delete(tmpName);
  const cache = await caches.open(tmpName);
  let done = 0;
  onProgress(0, manifest.bytes);
  const queue = [...manifest.files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const url = `${TILES_BASE}/worlds/${id}/${f.p}`;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(url, signal ? { signal } : {});
          if (!r.ok) throw new Error(`HTTP ${r.status} ${f.p}`);
          // clé = chemin local du fichier : le jeu le retrouve quelle que soit l'origine du téléchargement
          if (r.body && canGzip() && compressible(f.p)) {
            const type = r.headers.get('content-type') ?? 'application/octet-stream';
            const gz = r.body.pipeThrough(new CompressionStream('gzip'));
            await cache.put(`/worlds/${id}/${f.p}`, new Response(gz, { headers: { 'content-type': type, [GZ_HEADER]: '1' } }));
          } else await cache.put(`/worlds/${id}/${f.p}`, r);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (signal?.aborted) throw err;
        }
      }
      if (lastErr) throw lastErr;
      done += f.b;
      onProgress(done, manifest.bytes);
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
    await fetchGraphInto(cache, id, signal);
  } catch (err) {
    await caches.delete(tmpName);
    throw err;
  }
  // bascule : l'ancien pack n'est supprimé qu'une fois le nouveau complet
  const final = await caches.open(cacheName(id));
  for (const req of await final.keys()) await final.delete(req);
  for (const req of await cache.keys()) {
    const r = await cache.match(req);
    if (r) await final.put(req, r);
  }
  await caches.delete(tmpName);
  const announced = (await loadCatalogue())?.zones.find((z) => z.id === id)?.pack?.version;
  setInstalled(id, { version: manifest.version, bytes: manifest.bytes, ...(announced ? { catalogue: announced } : {}) });
  keepStorage();
}

/** Application Windows : téléchargement par le Rust dans le dossier de données (progression : `pack://progress`). */
async function installOnDisk(id: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const announced = (await loadCatalogue())?.zones.find((z) => z.id === id)?.pack?.version ?? null;
  const off = await listen<{ id: string; done: number; total: number }>('pack://progress', (p) => {
    if (p.id === id) onProgress(p.done, p.total);
  });
  const cancel = () => void invoke('pack_cancel', { id });
  signal?.addEventListener('abort', cancel);
  try {
    onProgress(0, 1);
    const p = await invoke<{ id: string; version: string; bytes: number; catalogue?: string }>('pack_install', { id, baseUrl: TILES_BASE, catalogue: announced });
    (disk ??= new Map()).set(id, { version: p.version, bytes: p.bytes, ...(p.catalogue ? { catalogue: p.catalogue } : {}) });
  } finally {
    off();
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Demande que le stockage de l'application ne soit pas purgé : les zones téléchargées (jusqu'à 2 Go) vivent dans le
 * Cache Storage, que le navigateur peut vider sans prévenir quand le disque se remplit (stockage « au mieux »).
 * Sans effet si c'est refusé : la zone se retélécharge alors à l'ouverture.
 */
export function keepStorage(): void {
  if (inDesktop) return;
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (storage?.persist) void storage.persisted().then((p) => (p ? true : storage.persist())).catch(() => undefined);
}

/**
 * Graphe routier de la zone dans le pack : l'installateur Windows ne l'embarque pas (≈ 330 Mo pour toutes les
 * zones), il vient avec la zone et reste utilisable hors ligne. Absent du serveur : sans conséquence (le jeu le
 * redemandera, le mode monde ouvert n'existe que s'il est là).
 */
async function fetchGraphInto(cache: Cache, id: string, signal?: AbortSignal): Promise<void> {
  const path = `/worlds/${id}/graph.json`;
  const r = await fetch(`${TILES_BASE}${path}`, signal ? { signal } : {}).catch((err) => {
    if (signal?.aborted) throw err;
    return null;
  });
  if (!r?.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
  const type = r.headers.get('content-type') ?? 'application/json';
  if (r.body && canGzip()) await cache.put(path, new Response(r.body.pipeThrough(new CompressionStream('gzip')), { headers: { 'content-type': type, [GZ_HEADER]: '1' } }));
  else await cache.put(path, r);
}

/** Zones téléchargées sur cet appareil, avec la taille de leur pack (octets non compressés annoncés par le manifeste). */
export function installedPacks(): Array<{ id: string; bytes: number }> {
  return Object.entries(installed()).map(([id, v]) => ({ id, bytes: v.bytes }));
}

/** Supprime le pack d'une zone de l'appareil. */
export async function removePack(id: string): Promise<void> {
  if (inDesktop) {
    await invoke('pack_remove', { id });
    disk?.delete(id);
    return;
  }
  if (hasCaches()) await caches.delete(cacheName(id));
  setInstalled(id, null);
}

/**
 * Lecture d'un fichier de monde (`/worlds/<id>/…`) : pack installé d'abord, puis le réseau
 * (tuiles sur TILES_BASE, le reste sur l'origine du jeu).
 */
export async function worldFetch(path: string): Promise<Response> {
  const hit = await packFile(path);
  if (hit) return hit;
  return fetch(path.includes('/tiles/') ? `${TILES_BASE}${path}` : path);
}

/** Fichier du pack installé de la zone (décompressé), ou null. */
async function packFile(path: string): Promise<Response | null> {
  const m = /^\/worlds\/([^/]+)\//.exec(path);
  if (inDesktop) {
    if (!m || !disk?.has(m[1] as string)) return null;
    const r = await fetch(`${DISK}${path}`).catch(() => null);
    return r?.ok ? r : null;
  }
  if (!m || !hasCaches() || !installed()[m[1] as string]) return null;
  const hit = await (await caches.open(cacheName(m[1] as string))).match(path);
  if (hit?.headers.get(GZ_HEADER) && hit.body) {
    const type = hit.headers.get('content-type') ?? 'application/octet-stream';
    return new Response(hit.body.pipeThrough(new DecompressionStream('gzip')), { headers: { 'content-type': type } });
  }
  return hit ?? null;
}

/**
 * Graphe routier d'une zone (`/worlds/<id>/graph.json`, de 1 à 33 Mo) : pack installé, puis les fichiers de
 * l'application ou du site, puis, dans l'application Windows qui ne l'embarque pas, le serveur des mondes.
 * Une réponse qui n'est pas du JSON (page d'accueil servie à la place d'un fichier absent) compte pour absente.
 */
export async function graphFetch(path: string): Promise<Response> {
  const pack = await packFile(path);
  if (pack) return pack;
  const isJson = (r: Response) => r.ok && (r.headers.get('content-type') ?? '').includes('json');
  const local = await fetch(path).catch(() => null);
  if (local && isJson(local)) return local;
  if (TILES_BASE) {
    const remote = await fetch(`${TILES_BASE}${path}`).catch(() => null);
    if (remote && isJson(remote)) return remote;
  }
  return local ?? new Response(null, { status: 404 });
}

/** Taille lisible (« 11 Mo », « 1,2 Go »). */
export function formatBytes(b: number, fr: boolean): string {
  const mo = b / 1e6;
  const s = mo >= 1000 ? `${(mo / 1000).toFixed(1)} ${fr ? 'Go' : 'GB'}` : `${mo < 10 ? mo.toFixed(1) : Math.round(mo)} ${fr ? 'Mo' : 'MB'}`;
  return fr ? s.replace('.', ',') : s;
}
