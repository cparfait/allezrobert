/**
 * Accès réseau avec cache disque (data/cache/terrain), limitation de débit par hôte
 * et reprises avec recul exponentiel. Tout ce qui est téléchargé est conservé : une
 * reconstruction ne retouche pas le réseau.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, USER_AGENT } from './config.ts';

const lastCall = new Map<string, number>();
const MIN_INTERVAL_MS: Record<string, number> = {
  'data.geopf.fr': 120,
  default: 1000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(host: string): Promise<void> {
  const min = MIN_INTERVAL_MS[host] ?? MIN_INTERVAL_MS.default ?? 1000;
  const last = lastCall.get(host) ?? 0;
  const wait = last + min - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
}

export function cachePath(kind: string, key: string, ext: string): string {
  const dir = path.join(CACHE_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}${ext}`);
}

export function hashKey(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 20);
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
  timeoutMs?: number;
  retries?: number;
  /** Validation du contenu ; une réponse invalide n'est pas mise en cache. */
  validate?: (buf: Buffer, contentType: string) => string | null;
}

let offline = process.env.TERRAIN_OFFLINE === '1';
export function setOffline(v: boolean): void {
  offline = v;
}

/** Télécharge `url` (avec cache dans `file`). Renvoie le contenu. */
export async function fetchCached(url: string, file: string, opts: FetchOptions = {}): Promise<Buffer> {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const buf = await fetchWithRetry(url, opts);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return buf;
}

export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  if (offline) throw new Error(`mode hors ligne (TERRAIN_OFFLINE=1) : ${url.slice(0, 120)}`);
  const host = new URL(url).host;
  const retries = opts.retries ?? 6;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
    try {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        signal: ctrl.signal,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} : ${buf.subarray(0, 200).toString()}`);
      const ct = res.headers.get('content-type') ?? '';
      const invalid = opts.validate?.(buf, ct) ?? null;
      if (invalid) throw new Error(`réponse invalide : ${invalid}`);
      return buf;
    } catch (err) {
      lastErr = err;
      const delay = Math.min(60000, 2000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      console.warn(`  ! ${host} tentative ${attempt + 1}/${retries + 1} : ${(err as Error).message.slice(0, 160)} — nouvel essai dans ${Math.round(delay / 1000)} s`);
      if (attempt < retries) await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
