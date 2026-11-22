/**
 * Brouillon de sortie : les mesures à 1 Hz et ce qu'il faut pour enregistrer la sortie sont écrits dans
 * IndexedDB toutes les 30 s, et aussi quand la page se ferme ou passe en arrière-plan. Une sortie
 * interrompue (onglet fermé, plantage, perte du GPU, coupure de courant) peut ainsi être récupérée au
 * lancement suivant (ui/rideRecovery.ts) : historique, XP, FIT.
 *
 * Chaque écriture n'ajoute que les secondes nouvelles, par morceaux : le coût reste le même après 3 h.
 * Un brouillon est rangé sous l'heure de départ de la sortie (même identifiant que l'historique,
 * `ar-<départ>`) : récupérer une sortie déjà terminée la remplace, sans doublon.
 */

import type { ActivityRecord, RideKind } from '@allezrobert/shared';

/** Part de la sortie déjà créditée (fin de sortie puis « Reprendre ») : seule la suite compte à la récupération. */
export interface DraftCredit {
  distanceM: number;
  elevationM: number;
  movingS: number;
  workKJ?: number;
}

/** Ce que le jeu fournit à chaque écriture. */
export interface DraftSnapshot {
  startT: number;
  name: string;
  routeId: string | null;
  kind: RideKind;
  workoutId?: string | null;
  workoutName?: string | null;
  ftpWatts: number;
  massKg: number;
  skipStrava: boolean;
  originL93?: { x: number; y: number };
  /** Temps de roulage (s). */
  elapsedS: number;
  distanceM: number;
  elevationM: number;
  lapTimes: readonly number[];
  /** Sortie pédalée au simulateur (touches +/−) : ni classement, ni records. */
  simulated: boolean;
  credited?: DraftCredit;
  /** Mesures déjà enregistrées dans l'historique (fin de sortie) : rien à récupérer tant qu'il n'y en a pas d'autres. */
  recordedCount?: number;
  records: readonly ActivityRecord[];
}

/** En-tête enregistré (sans les mesures). */
export interface DraftMeta extends Omit<DraftSnapshot, 'records' | 'lapTimes'> {
  v: 1;
  savedAt: number;
  lapTimes: number[];
  /** Nombre de morceaux de mesures écrits. */
  chunks: number;
  /** Nombre de mesures écrites. */
  count: number;
}

/** Brouillon relu : en-tête et mesures. */
export interface RideDraft extends DraftMeta {
  records: ActivityRecord[];
}

/** Stockage des brouillons (IndexedDB en jeu, mémoire dans les tests). */
export interface DraftStore {
  metas(): Promise<DraftMeta[]>;
  putMeta(m: DraftMeta): Promise<void>;
  putChunk(startT: number, index: number, records: readonly ActivityRecord[]): Promise<void>;
  chunks(startT: number, count: number): Promise<ActivityRecord[][]>;
  remove(startT: number): Promise<void>;
}

/** Une minute de mesures au moins (comme l'historique), et pas plus vieux que 14 jours. */
export const DRAFT_MIN_RECORDS = 60;
export const DRAFT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
export const DRAFT_INTERVAL_MS = 30_000;

/** Le brouillon vaut-il d'être proposé ? */
export function draftWorth(m: Pick<DraftMeta, 'count' | 'savedAt' | 'recordedCount'>, now = Date.now()): boolean {
  if (m.count < DRAFT_MIN_RECORDS) return false;
  if (now - m.savedAt > DRAFT_MAX_AGE_MS) return false;
  // Sortie terminée et enregistrée, sans rien de roulé après : il n'y a rien à récupérer.
  if (m.recordedCount !== undefined && m.count <= m.recordedCount) return false;
  return true;
}

/** Écrit le brouillon d'une sortie, par morceaux, à intervalle régulier et quand la page se ferme. */
export class DraftWriter {
  private written = 0;
  private chunks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly onHide = (): void => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') void this.flush();
  };

  constructor(
    private readonly store: DraftStore,
    private readonly snapshot: () => DraftSnapshot,
    private readonly intervalMs = DRAFT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onHide);
      document.addEventListener('visibilitychange', this.onHide);
    }
  }

  /** Écrit les mesures nouvelles puis l'en-tête ; les écritures se suivent (jamais deux à la fois). */
  flush(): Promise<void> {
    this.queue = this.queue.then(() => this.write()).catch((e) => console.warn('Brouillon de sortie non écrit', e));
    return this.queue;
  }

  private async write(): Promise<void> {
    if (this.stopped) return;
    const s = this.snapshot();
    if (s.records.length < this.written) {
      // Mesures remises à zéro (ne devrait pas arriver) : on réécrit tout.
      this.written = 0;
      this.chunks = 0;
    }
    const fresh = s.records.slice(this.written);
    if (fresh.length) {
      await this.store.putChunk(s.startT, this.chunks, fresh);
      this.chunks++;
      this.written += fresh.length;
    }
    if (this.written === 0) return;
    const { records: _records, lapTimes, ...rest } = s;
    await this.store.putMeta({ ...rest, v: 1, savedAt: Date.now(), lapTimes: [...lapTimes], chunks: this.chunks, count: this.written });
  }

  /** Arrête les écritures (le brouillon reste). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onHide);
      document.removeEventListener('visibilitychange', this.onHide);
    }
  }

  /** Arrête et efface le brouillon (sortie quittée normalement). */
  async discard(startT: number): Promise<void> {
    this.stop();
    this.stopped = true;
    await this.queue;
    await this.store.remove(startT);
  }
}

/** Brouillons à proposer, le plus récent d'abord ; les brouillons sans intérêt sont effacés au passage. */
export async function pendingDrafts(store: DraftStore, now = Date.now()): Promise<DraftMeta[]> {
  const metas = await store.metas();
  const keep: DraftMeta[] = [];
  for (const m of metas) {
    if (draftWorth(m, now)) keep.push(m);
    else await store.remove(m.startT);
  }
  return keep.sort((a, b) => b.startT - a.startT);
}

/** Relit un brouillon complet. */
export async function loadDraft(store: DraftStore, meta: DraftMeta): Promise<RideDraft> {
  const parts = await store.chunks(meta.startT, meta.chunks);
  return { ...meta, records: parts.flat() };
}

/** Stockage en mémoire (tests, navigateur sans IndexedDB). */
export class MemoryDraftStore implements DraftStore {
  readonly meta = new Map<number, DraftMeta>();
  readonly parts = new Map<string, ActivityRecord[]>();
  async metas(): Promise<DraftMeta[]> {
    return [...this.meta.values()].map((m) => ({ ...m }));
  }
  async putMeta(m: DraftMeta): Promise<void> {
    this.meta.set(m.startT, { ...m });
  }
  async putChunk(startT: number, index: number, records: readonly ActivityRecord[]): Promise<void> {
    this.parts.set(`${startT}:${index}`, records.map((r) => ({ ...r })));
  }
  async chunks(startT: number, count: number): Promise<ActivityRecord[][]> {
    const out: ActivityRecord[][] = [];
    for (let i = 0; i < count; i++) out.push(this.parts.get(`${startT}:${i}`) ?? []);
    return out;
  }
  async remove(startT: number): Promise<void> {
    this.meta.delete(startT);
    for (const k of [...this.parts.keys()]) if (k.startsWith(`${startT}:`)) this.parts.delete(k);
  }
}

const DB_NAME = 'ar-ride-draft';
const META = 'meta';
const CHUNKS = 'chunks';

/** Stockage IndexedDB : en-têtes rangés par départ, morceaux rangés par [départ, n°]. */
export class IdbDraftStore implements DraftStore {
  private dbP: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbP ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'startT' });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    }).catch((e) => {
      this.dbP = null;
      throw e;
    });
    return this.dbP;
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const req = body(tx);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
    });
  }

  async metas(): Promise<DraftMeta[]> {
    return ((await this.run<DraftMeta[]>([META], 'readonly', (tx) => tx.objectStore(META).getAll() as IDBRequest<DraftMeta[]>)) ?? []).filter((m) => m && m.v === 1);
  }
  async putMeta(m: DraftMeta): Promise<void> {
    await this.run([META], 'readwrite', (tx) => void tx.objectStore(META).put(m));
  }
  async putChunk(startT: number, index: number, records: readonly ActivityRecord[]): Promise<void> {
    await this.run([CHUNKS], 'readwrite', (tx) => void tx.objectStore(CHUNKS).put(records, [startT, index]));
  }
  async chunks(startT: number, count: number): Promise<ActivityRecord[][]> {
    const all = await this.run<ActivityRecord[][]>([CHUNKS], 'readonly', (tx) => tx.objectStore(CHUNKS).getAll(IDBKeyRange.bound([startT, 0], [startT, count])) as IDBRequest<ActivityRecord[][]>);
    return (all ?? []).slice(0, count);
  }
  async remove(startT: number): Promise<void> {
    await this.run([META, CHUNKS], 'readwrite', (tx) => {
      tx.objectStore(META).delete(startT);
      tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([startT, 0], [startT, Number.MAX_SAFE_INTEGER]));
    });
  }
}

/** Stockage du jeu : IndexedDB si disponible, sinon mémoire (rien ne survit, mais rien ne casse). */
export function defaultDraftStore(): DraftStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IdbDraftStore();
  } catch {
    // IndexedDB interdite (navigation privée stricte).
  }
  return new MemoryDraftStore();
}
