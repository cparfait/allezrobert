import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, type AvatarLook } from '@allezrobert/shared';
import { CAP_SHARE, ttBike, withHeadgear } from '../src/game/headgear.ts';

const bare: AvatarLook = { ...DEFAULT_LOOK, noHelmet: true };
const capped: AvatarLook = { ...DEFAULT_LOOK, cap: { style: 'pois', color: '#fff' } };

describe('withHeadgear (Réel, Poly)', () => {
  it('jamais tête nue, quelle que soit la sortie', () => {
    for (const kind of ['ride', 'race', 'tt'] as const) for (const roll of [0, 0.5, 1]) expect(withHeadgear(bare, kind, roll).noHelmet).toBeUndefined();
  });
  it('hors course : une casquette rarement, sinon un casque', () => {
    const looks = Array.from({ length: 100 }, (_, i) => withHeadgear(DEFAULT_LOOK, 'ride', i / 100));
    const caps = looks.filter((l) => l.cap).length;
    expect(caps).toBe(Math.round(CAP_SHARE * 100));
    expect(withHeadgear(DEFAULT_LOOK, 'ride', 0.05).cap?.color).toBe(DEFAULT_LOOK.jersey);
  });
  it('en course : casque obligatoire, même pour la casquette choisie', () => {
    expect(withHeadgear(capped, 'race', 0).cap).toBeUndefined();
    expect(withHeadgear(capped, 'race', 0, { keepCap: true }).cap).toBeUndefined();
  });
  it('hors course, la casquette choisie par le joueur est gardée, sans en ajouter', () => {
    expect(withHeadgear(capped, 'ride', 1, { keepCap: true }).cap?.style).toBe('pois');
    expect(withHeadgear(DEFAULT_LOOK, 'ride', 0, { keepCap: true }).cap).toBeUndefined();
  });
  it('en chrono : casque chrono et vélo de chrono', () => {
    const l = withHeadgear(capped, 'tt', 0.3, { bikeIndex: 4 });
    expect(l.helmetShape).toBe('chrono');
    expect(l.cap).toBeUndefined();
    expect(l.bikeModel).toBe(ttBike(4));
    expect(ttBike(4)).toBeTruthy();
  });
});
