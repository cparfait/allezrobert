/**
 * Sources de changement de vitesse locales : clavier et manette (API navigateur Gamepad).
 * La logique (correspondances, fronts montants) est pure et testable ; l'accrochage au navigateur est mince.
 */
import { Emitter, type ShiftAction, type ShiftEvent } from '@allezrobert/shared';
import { systemClock, type Clock, type TimerHandle } from './clock.ts';

export interface ShifterSource extends Emitter<{ shift: ShiftEvent }> {
  readonly id: string;
  readonly name: string;
  start(): void;
  stop(): void;
}

// --- Clavier ------------------------------------------------------------------------------

/** Correspondances par défaut (KeyboardEvent.code → action). */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, ShiftAction>> = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyE: 'frontUp',
  KeyQ: 'frontDown',
  ArrowLeft: 'steerLeft',
  ArrowRight: 'steerRight',
  Enter: 'confirm',
  Escape: 'back',
  KeyM: 'menu',
});

export interface KeyInput {
  code: string;
  repeat?: boolean;
  /** La touche vient d'un champ de saisie (chat…) : ignorée. */
  editable?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export class KeyboardShiftMapper {
  bindings: Record<string, ShiftAction>;
  allowRepeat: boolean;

  constructor(bindings: Record<string, ShiftAction> = { ...DEFAULT_KEY_BINDINGS }, allowRepeat = false) {
    this.bindings = bindings;
    this.allowRepeat = allowRepeat;
  }

  map(key: KeyInput, t: number): ShiftEvent | undefined {
    if (key.editable || key.ctrlKey || key.altKey || key.metaKey) return undefined;
    if (key.repeat && !this.allowRepeat) return undefined;
    const action = this.bindings[key.code];
    return action ? { t, action } : undefined;
  }
}

interface KeyboardEventLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  target: unknown;
  preventDefault(): void;
}

interface KeyTarget {
  addEventListener(type: 'keydown', l: (e: KeyboardEventLike) => void): void;
  removeEventListener(type: 'keydown', l: (e: KeyboardEventLike) => void): void;
}

function isEditable(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return el.isContentEditable === true || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/**
 * Télécommandes HID (Bluetooth ou USB) : l'OS les voit comme des claviers (Web Bluetooth bloque le
 * service HID 0x1812, et c'est très bien ainsi). Les télécommandes « multimédia » envoient en général
 * piste suivante / précédente ; les « présentateurs » Page suivante / précédente ou les flèches.
 * Correspondances par défaut ; les touches réelles d'une télécommande s'apprennent dans l'interface.
 */
export const DEFAULT_HID_REMOTE_BINDINGS: Readonly<Record<string, ShiftAction>> = Object.freeze({
  MediaTrackNext: 'up',
  MediaTrackPrevious: 'down',
});

export class KeyboardShifter extends Emitter<{ shift: ShiftEvent }> implements ShifterSource {
  readonly id: string;
  readonly name: string;
  readonly mapper: KeyboardShiftMapper;
  private readonly target: KeyTarget | undefined;
  private readonly clock: Clock;
  private readonly listener = (e: KeyboardEventLike) => {
    const ev = this.mapper.map({ code: e.code, repeat: e.repeat, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, editable: isEditable(e.target) }, this.clock.now());
    if (ev) {
      e.preventDefault();
      this.emit('shift', ev);
    }
  };

  constructor(options: { target?: KeyTarget; bindings?: Record<string, ShiftAction>; clock?: Clock; id?: string; name?: string } = {}) {
    super();
    this.id = options.id ?? 'keyboard';
    this.name = options.name ?? 'Clavier';
    this.mapper = new KeyboardShiftMapper(options.bindings);
    this.target = options.target ?? (globalThis as unknown as { window?: KeyTarget }).window;
    this.clock = options.clock ?? systemClock;
  }

  start(): void {
    this.target?.addEventListener('keydown', this.listener);
  }

  stop(): void {
    this.target?.removeEventListener('keydown', this.listener);
  }
}

// --- Manette (Gamepad API, « standard mapping » W3C) ---------------------------------------

export const DEFAULT_GAMEPAD_BINDINGS: Readonly<Record<number, ShiftAction>> = Object.freeze({
  5: 'up', // RB
  4: 'down', // LB
  7: 'frontUp', // RT
  6: 'frontDown', // LT
  12: 'up', // croix haut
  13: 'down', // croix bas
  14: 'steerLeft',
  15: 'steerRight',
  0: 'confirm', // A
  1: 'back', // B
  9: 'menu', // Start
});

export interface GamepadSnapshot {
  index: number;
  buttons: ReadonlyArray<boolean | { pressed: boolean }>;
}

export class GamepadShiftMapper {
  bindings: Record<number, ShiftAction>;
  private held = new Map<number, boolean[]>();

  constructor(bindings: Record<number, ShiftAction> = { ...DEFAULT_GAMEPAD_BINDINGS }) {
    this.bindings = bindings;
  }

  /** Renvoie les actions des boutons nouvellement enfoncés (fronts montants). */
  update(pads: ReadonlyArray<GamepadSnapshot | null | undefined>, t: number): ShiftEvent[] {
    const out: ShiftEvent[] = [];
    for (const pad of pads) {
      if (!pad) continue;
      const prev = this.held.get(pad.index) ?? [];
      const now = pad.buttons.map((b) => (typeof b === 'boolean' ? b : b.pressed));
      now.forEach((pressed, i) => {
        if (pressed && !prev[i]) {
          const action = this.bindings[i];
          if (action) out.push({ t, action });
        }
      });
      this.held.set(pad.index, now);
    }
    return out;
  }
}

export class GamepadShifter extends Emitter<{ shift: ShiftEvent }> implements ShifterSource {
  readonly id = 'gamepad';
  readonly name = 'Manette';
  readonly mapper: GamepadShiftMapper;
  private readonly clock: Clock;
  private readonly poll: () => ReadonlyArray<GamepadSnapshot | null>;
  private readonly intervalMs: number;
  private timer: TimerHandle | undefined;

  constructor(options: { bindings?: Record<number, ShiftAction>; clock?: Clock; intervalMs?: number; getGamepads?: () => ReadonlyArray<GamepadSnapshot | null> } = {}) {
    super();
    this.mapper = new GamepadShiftMapper(options.bindings);
    this.clock = options.clock ?? systemClock;
    this.intervalMs = options.intervalMs ?? 30;
    const nav = (globalThis as unknown as { navigator?: { getGamepads?: () => ReadonlyArray<GamepadSnapshot | null> } }).navigator;
    this.poll = options.getGamepads ?? (() => nav?.getGamepads?.() ?? []);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = this.clock.setInterval(() => {
      for (const ev of this.mapper.update(this.poll(), this.clock.now())) this.emit('shift', ev);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) this.clock.clearInterval(this.timer);
    this.timer = undefined;
  }
}
