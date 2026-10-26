import type { WorldCatalogue, WorldPackManifest } from '@allezrobert/shared';

/**
 * Packs de cartes : chaque zone (monde) se télécharge d'un bloc depuis le menu et reste sur
 * l'appareil (Cache Storage du navigateur ou de WebView2), au lieu d'être embarquée dans
 * l'application. Le jeu lit d'abord le pack installé, puis le serveur.
 *
 * - Catalogue `worlds/index.json` et `world.json` / itinéraires : livrés avec le jeu.
 * - Tuiles et `tiles/pack.json` : sur le serveur des mondes (même origine en web ; l'application
 *   Windows les prend sur le VPS, voir WORLDS_HOST).
 */

/** Serveur des tuiles pour l'application Windows (la version web les sert elle-même). */
const WORLDS_HOST = 'https://allezrobert.cparfait.ovh';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Préfixe des tuiles : `VITE_WORLDS_URL`, sinon le VPS dans l'application Windows, sinon la même origine. */
export const TILES_BASE = env.VITE_WORLDS_URL ?? (inTauri ? WORLDS_HOST : '');

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

function installed(): Record<string, Installed> {
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
  if (!hasCaches()) return { kind: 'unavailable' };
  const i = installed()[id];
  if (!i) return { kind: 'absent' };
  return { kind: 'installed', version: i.version, upToDate: !catalogueVersion || catalogueVersion === i.version || catalogueVersion === i.catalogue };
}

/**
 * Télécharge le pack d'une zone dans le Cache Storage (6 fichiers à la fois), avec la progression
 * en octets. Une version précédente est remplacée une fois le téléchargement complet.
 */
export async function installPack(id: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
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
}

/** Zones téléchargées sur cet appareil, avec la taille de leur pack (octets non compressés annoncés par le manifeste). */
export function installedPacks(): Array<{ id: string; bytes: number }> {
  return Object.entries(installed()).map(([id, v]) => ({ id, bytes: v.bytes }));
}

/** Supprime le pack d'une zone de l'appareil. */
export async function removePack(id: string): Promise<void> {
  if (hasCaches()) await caches.delete(cacheName(id));
  setInstalled(id, null);
}

/**
 * Lecture d'un fichier de monde (`/worlds/<id>/…`) : pack installé d'abord, puis le réseau
 * (tuiles sur TILES_BASE, le reste sur l'origine du jeu).
 */
export async function worldFetch(path: string): Promise<Response> {
  const m = /^\/worlds\/([^/]+)\//.exec(path);
  if (m && hasCaches() && installed()[m[1] as string]) {
    const hit = await (await caches.open(cacheName(m[1] as string))).match(path);
    if (hit?.headers.get(GZ_HEADER) && hit.body) {
      const type = hit.headers.get('content-type') ?? 'application/octet-stream';
      return new Response(hit.body.pipeThrough(new DecompressionStream('gzip')), { headers: { 'content-type': type } });
    }
    if (hit) return hit;
  }
  return fetch(path.includes('/tiles/') ? `${TILES_BASE}${path}` : path);
}

/** Taille lisible (« 11 Mo », « 1,2 Go »). */
export function formatBytes(b: number, fr: boolean): string {
  const mo = b / 1e6;
  const s = mo >= 1000 ? `${(mo / 1000).toFixed(1)} ${fr ? 'Go' : 'GB'}` : `${mo < 10 ? mo.toFixed(1) : Math.round(mo)} ${fr ? 'Mo' : 'MB'}`;
  return fr ? s.replace('.', ',') : s;
}
