import { describe, expect, it } from 'vitest';
import { awardTrophies, earnedTrophies } from '../src/game/trophies.ts';

const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const base = { distanceM: 12000, elevationGainM: 150, komsDone: 1, recordsBeaten: 0, rainSeen: false, nightSeen: false, openWorld: false, draftS: 0, pulls: 0, workoutFinished: false, guest: false };

describe('trophées', () => {
  it('gagnés une seule fois, jamais pour un invité', () => {
    store.clear();
    expect(awardTrophies({ ...base, guest: true }, 'a')).toEqual([]);
    const first = awardTrophies(base, 'a').map((t) => t.id);
    expect(first).toEqual(['first-ride', 'ten-km', 'first-kom']);
    // Même sortie terminée à nouveau après reprise : rien de neuf.
    expect(awardTrophies(base, 'a')).toEqual([]);
    expect(awardTrophies({ ...base, rainSeen: true, openWorld: true, distanceM: 21000 }, 'b').map((t) => t.id)).toEqual(['rain', 'explorer']);
    expect(earnedTrophies()).toHaveLength(5);
  });
  it('cumul de 500 km sans double compte d’une sortie reprise', () => {
    store.clear();
    for (let i = 0; i < 4; i++) awardTrophies({ ...base, distanceM: 120000 }, `r${i}`);
    expect(earnedTrophies()).not.toContain('total-500');
    awardTrophies({ ...base, distanceM: 30000 }, 'r0'); // r0 terminée à nouveau : 30 km au lieu de 120
    expect(earnedTrophies()).not.toContain('total-500');
    awardTrophies({ ...base, distanceM: 150000 }, 'r4');
    expect(earnedTrophies()).toContain('total-500');
  });
});
