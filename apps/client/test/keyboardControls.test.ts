import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardControls } from '../src/game/inputs.ts';
import { GuestInputSource } from '../src/game/guest.ts';

const g = globalThis as Record<string, unknown>;

class FakeDocument extends EventTarget {
  visibilityState = 'visible';
}

const key = (type: string, k: string) => Object.assign(new Event(type), { key: k });

describe('touches relâchées quand la fenêtre perd le focus', () => {
  let win: EventTarget;
  let doc: FakeDocument;
  beforeEach(() => {
    win = new EventTarget();
    doc = new FakeDocument();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('direction : plus de virage tenu après Alt+Tab', () => {
    const k = new KeyboardControls();
    win.dispatchEvent(key('keydown', 'ArrowRight'));
    expect(k.update(1)).toBe(1);
    win.dispatchEvent(new Event('blur'));
    expect(k.update(1)).toBe(0);
  });

  it('page passée en arrière-plan : relâchées aussi ; revenue au premier plan : rien', () => {
    const k = new KeyboardControls();
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(k.update(1)).toBe(-1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(k.update(1)).toBe(0);
  });

  it('invité : l’attaque (Maj) s’arrête', () => {
    const src = new GuestInputSource(70);
    win.dispatchEvent(key('keydown', 'Shift'));
    const attacking = src.read().watts;
    win.dispatchEvent(new Event('blur'));
    expect(src.read().watts).toBeLessThan(attacking);
    src.dispose();
  });

  it('écouteurs retirés à la fin', () => {
    const k = new KeyboardControls();
    win.dispatchEvent(key('keydown', 'ArrowRight'));
    k.dispose();
    win.dispatchEvent(new Event('blur'));
    expect(k.update(1)).toBe(1);
    expect(g.window).toBe(win);
  });
});
