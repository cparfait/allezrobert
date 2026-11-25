import { describe, expect, it } from 'vitest';
import { hudHeldAtStart, START_HUD_DELAY_S } from '../src/hud/startHud.ts';

describe('compteurs au départ d’une course', () => {
  it('masqués sur la ligne, puis quelques secondes après le départ', () => {
    expect(hudHeldAtStart(true, 0)).toBe(true);
    expect(hudHeldAtStart(true, START_HUD_DELAY_S - 0.1)).toBe(true);
    expect(hudHeldAtStart(true, START_HUD_DELAY_S)).toBe(false);
  });
  it('hors course : toujours affichés', () => {
    expect(hudHeldAtStart(false, 0)).toBe(false);
  });
});
