import { describe, expect, it } from 'vitest';
import { plausibleLap } from '../src/game/ghost.ts';

describe('fantôme : tour vraisemblable', () => {
  it('refuse un tour téléporté (3,6 km en 38 s)', () => {
    expect(plausibleLap(37.7, 3582)).toBe(false);
  });
  it('accepte un vrai tour, même rapide (3,6 km en 4 min 30)', () => {
    expect(plausibleLap(270, 3582)).toBe(true);
  });
});
