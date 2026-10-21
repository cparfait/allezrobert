/**
 * Horloge injectable : tout le paquet passe par elle (minuteries de reconnexion, détection de capteur muet,
 * simulateur…), ce qui rend les tests déterministes avec ManualClock.
 */
export type TimerHandle = unknown;

export interface Clock {
  /** Millisecondes monotones. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

type GlobalTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  performance?: { now(): number };
};

const g = globalThis as unknown as GlobalTimers;

export const systemClock: Clock = {
  now: () => (g.performance ? g.performance.now() : Date.now()),
  setTimeout: (fn, ms) => g.setTimeout(fn, ms),
  clearTimeout: (h) => g.clearTimeout(h),
  setInterval: (fn, ms) => g.setInterval(fn, ms),
  clearInterval: (h) => g.clearInterval(h),
};

interface ManualTimer {
  id: number;
  at: number;
  fn: () => void;
  interval?: number;
}

/** Laisse s'exécuter toutes les micro-tâches en attente (promesses) via une vraie macro-tâche. */
export function flushPromises(): Promise<void> {
  const gi = globalThis as unknown as { setImmediate?: (fn: () => void) => void };
  return new Promise((resolve) => {
    if (gi.setImmediate) gi.setImmediate(resolve);
    else g.setTimeout(resolve, 0);
  });
}

/** Horloge manuelle pour les tests et le simulateur hors temps réel. */
export class ManualClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers: ManualTimer[] = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    const interval = Math.max(1, ms);
    this.timers.push({ id, at: this.t + interval, fn, interval });
    return id;
  }

  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Avance le temps en exécutant les minuteries dans l'ordre, en vidant les promesses après chacune. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flushPromises();
    for (;;) {
      let next: ManualTimer | undefined;
      for (const timer of this.timers) if (timer.at <= end && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer;
      if (!next) break;
      this.t = next.at;
      if (next.interval !== undefined) next.at += next.interval;
      else this.timers = this.timers.filter((x) => x !== next);
      try {
        next.fn();
      } finally {
        await flushPromises();
      }
    }
    this.t = end;
    await flushPromises();
  }
}
