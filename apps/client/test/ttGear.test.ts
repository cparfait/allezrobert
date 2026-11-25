import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK } from '@allezrobert/shared';
import { ttMissing, withHeadgear } from '../src/game/headgear.ts';
import { rememberTtChoice, takeTtKeep, ttGearText } from '../src/ui/ttGear.ts';

describe('matériel proposé avant un contre-la-montre', () => {
  it('dit ce qui manque', () => {
    expect(ttGearText({ bike: true, helmet: true }, true)).toBe('Tu n’as pas de vélo de chrono (roues aéro comprises) ni de casque chrono.');
    expect(ttGearText({ bike: false, helmet: true }, true)).toBe('Tu n’as pas de casque chrono.');
    expect(ttGearText({ bike: true, helmet: false }, false)).toBe('You have no time trial bike (aero wheels included).');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('« Partir comme ça » : gardé jusqu’au départ (rechargement compris), une seule fois', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    expect(takeTtKeep()).toBe(false);
    rememberTtChoice(true);
    expect(takeTtKeep()).toBe(true);
    expect(takeTtKeep()).toBe(false);
    rememberTtChoice(true);
    rememberTtChoice(false);
    expect(takeTtKeep()).toBe(false);
  });
  it('« Partir comme ça » : vélo du joueur gardé, jamais tête nue', () => {
    const look = { ...DEFAULT_LOOK, noHelmet: true };
    expect(ttMissing(look)).not.toBeNull();
    const l = withHeadgear(look, 'race', 1, { keepCap: true, bikeIndex: 0 });
    expect(l.bikeModel).toBe(DEFAULT_LOOK.bikeModel);
    expect(l.helmetShape).toBeUndefined();
    expect(l.noHelmet).toBeUndefined();
  });
  it('matériel inconnu (Bêta) : simple rappel', () => {
    expect(ttGearText(null, true)).toContain('Pense à ton matériel aéro');
  });
});
