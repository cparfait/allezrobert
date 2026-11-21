/**
 * Décodage des FIT hors du fil principal. Ce fil fait tourner la boucle à 10 Hz de toutes les salles :
 * décoder un FIT de plusieurs heures (SDK Garmin, synchrone) y retardait chaque tick.
 *
 * Un seul worker, réutilisé, lancé à la première demande et arrêté après une minute sans travail
 * (il ne retient jamais le processus à l'arrêt). Repli : si le worker ne peut pas démarrer ou charger le
 * TypeScript (vitest, runtime sans chargeur), le décodage se fait sur place comme avant, et ce repli
 * est journalisé une seule fois.
 */
import { Worker } from 'node:worker_threads';
import { decodeFit, FitImportError, type ImportedFit } from '../activities/fit-import.ts';

/** Au-delà, le fichier n'est pas confié au worker (l'API refuse déjà les corps de plus de 8 Mo). */
export const FIT_WORKER_MAX_BYTES = 16 * 1024 * 1024;
/** Délai maximal d'un décodage ; dépassé, le worker est arrêté et la demande échoue. */
export const FIT_WORKER_TIMEOUT_MS = 20_000;
const IDLE_MS = 60_000;

export interface FitWorkerRequest {
  id: number;
  bytes: Uint8Array;
  name?: string;
}
export type FitWorkerReply = { id: number; ok: true; result: ImportedFit } | { id: number; ok: false; fit: boolean; message: string };

interface Pending {
  resolve: (v: ImportedFit) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Copie gardée pour le repli sur place si le worker tombe avant d'avoir répondu une première fois. */
  bytes: Uint8Array;
  name: string | undefined;
}

export interface FitDecodePoolOptions {
  /** Fabrique du worker (remplaçable dans les tests). */
  spawn?: () => Worker;
  log?: (message: string) => void;
  timeoutMs?: number;
  /** false : toujours sur place (FIT_WORKER=0). */
  enabled?: boolean;
}

export class FitDecodePool {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  /** Le worker a déjà répondu : une panne ultérieure est une panne, pas un défaut de chargement. */
  private proven = false;
  /** Worker inutilisable dans ce runtime : tout se décode sur place. */
  private disabled: boolean;
  private warned = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly spawn: () => Worker;
  private readonly log: (message: string) => void;
  private readonly timeoutMs: number;

  constructor(opts: FitDecodePoolOptions = {}) {
    this.spawn = opts.spawn ?? (() => new Worker(new URL('./decode-worker.ts', import.meta.url)));
    this.log = opts.log ?? ((m) => console.warn(`[fit] ${m}`));
    this.timeoutMs = opts.timeoutMs ?? FIT_WORKER_TIMEOUT_MS;
    this.disabled = opts.enabled === false;
  }

  /** Vrai tant que le décodage passe (ou peut passer) par le worker. */
  get offThread(): boolean {
    return !this.disabled;
  }

  /** Décode un FIT ; rejette `FitImportError` pour un fichier invalide, comme `decodeFit`. */
  decode(bytes: Uint8Array, name?: string): Promise<ImportedFit> {
    if (this.disabled || bytes.length > FIT_WORKER_MAX_BYTES) return this.inline(bytes, name);
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (e) {
      this.fallback(`worker indisponible (${(e as Error).message})`);
      return this.inline(bytes, name);
    }
    return new Promise<ImportedFit>((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        // Décodage bloqué : seul l'arrêt du worker libère le fil ; les autres demandes en cours repartent sur place.
        this.dropWorker();
        p.reject(new Error('Décodage du FIT trop long'));
        this.redoInline();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, bytes, name });
      if (this.idle) clearTimeout(this.idle);
      // Copie envoyée au worker : `bytes` (le corps de la requête) reste lisible par l'appelant.
      worker.postMessage({ id, bytes, name } satisfies FitWorkerRequest);
    });
  }

  /** Arrête le worker (les demandes en cours sont décodées sur place). */
  async close(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null;
    this.redoInline();
    await w?.terminate().catch(() => undefined);
  }

  private inline(bytes: Uint8Array, name?: string): Promise<ImportedFit> {
    try {
      return Promise.resolve(name === undefined ? decodeFit(bytes) : decodeFit(bytes, name));
    } catch (e) {
      return Promise.reject(e as Error);
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = this.spawn();
    // Le worker ne retient pas le processus : l'arrêt du serveur n'a pas à l'attendre.
    w.unref();
    w.on('message', (m: FitWorkerReply) => this.onReply(w, m));
    w.on('error', (e: unknown) => this.onDown(w, e instanceof Error ? e.message : String(e)));
    w.on('exit', (code) => this.onDown(w, `arrêt du worker (code ${code})`));
    this.worker = w;
    return w;
  }

  private onReply(w: Worker, m: FitWorkerReply): void {
    if (w !== this.worker) return;
    this.proven = true;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(m.fit ? new FitImportError(m.message) : new Error(m.message));
    if (this.pending.size === 0) this.armIdle();
  }

  private onDown(w: Worker, reason: string): void {
    if (w !== this.worker) return;
    this.worker = null;
    // Jamais de réponse : le runtime ne sait pas lancer ce worker (TypeScript non chargé…) : repli définitif.
    if (!this.proven) this.fallback(reason);
    this.redoInline();
  }

  private fallback(reason: string): void {
    this.disabled = true;
    if (this.warned) return;
    this.warned = true;
    this.log(`décodage des FIT sur le fil principal : ${reason}`);
  }

  /** Demandes restées sans réponse : décodées sur place plutôt que perdues. */
  private redoInline(): void {
    const left = [...this.pending.values()];
    this.pending.clear();
    for (const p of left) {
      clearTimeout(p.timer);
      this.inline(p.bytes, p.name).then(p.resolve, p.reject);
    }
  }

  private dropWorker(): void {
    const w = this.worker;
    this.worker = null;
    void w?.terminate().catch(() => undefined);
  }

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.pending.size === 0) this.dropWorker();
    }, IDLE_MS);
    this.idle.unref?.();
  }
}

let shared: FitDecodePool | undefined;

/** Décodage d'un FIT hors du fil de la simulation (pool partagé du processus ; `FIT_WORKER=0` le coupe). */
export function decodeFitOffThread(bytes: Uint8Array, name?: string): Promise<ImportedFit> {
  shared ??= new FitDecodePool({ enabled: process.env.FIT_WORKER !== '0' });
  return shared.decode(bytes, name);
}

/** Arrêt du pool partagé (tests, arrêt du serveur). */
export async function closeFitWorker(): Promise<void> {
  const p = shared;
  shared = undefined;
  await p?.close();
}
