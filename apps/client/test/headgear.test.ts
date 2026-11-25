import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, tuneItem, type AvatarLook } from '@allezrobert/shared';
import { CAP_SHARE, ttBike, ttMissing, ttWheels, withHeadgear } from '../src/game/headgear.ts';

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
  it('en chrono, le matériel choisi par le joueur est gardé ; seul l’oubli est complété', () => {
    const mine: AvatarLook = { ...DEFAULT_LOOK, bikeModel: ttBike(9) as string, helmetShape: 'chrono-court' };
    expect(ttMissing(mine)).toBeNull();
    expect(withHeadgear(mine, 'tt', 1, { keepCap: true, bikeIndex: 0 })).toMatchObject({ bikeModel: ttBike(9), helmetShape: 'chrono-court' });
    const noHelmet: AvatarLook = { ...DEFAULT_LOOK, bikeModel: ttBike(9) as string };
    expect(ttMissing(noHelmet)).toEqual({ bike: false, helmet: true });
    expect(withHeadgear(noHelmet, 'tt', 1, { keepCap: true, bikeIndex: 0 })).toMatchObject({ bikeModel: ttBike(9), helmetShape: 'chrono' });
    expect(ttMissing(capped)).toEqual({ bike: true, helmet: true });
  });
  it('en chrono, roues aéro différentes d’une IA à l’autre ; celles du joueur ne changent pas', () => {
    const ai = Array.from({ length: 7 }, (_, i) => withHeadgear(DEFAULT_LOOK, 'tt', 0.5, { bikeIndex: i }));
    expect(new Set(ai.map((l) => l.tune?.join() ?? 'origine')).size).toBe(7);
    expect(new Set(ai.map((l) => l.bikeModel)).size).toBe(7);
    for (let i = 0; i < 7; i++) {
      const id = ttWheels(i);
      if (id) expect(tuneItem(id)?.slot).toBe('wheelset');
    }
    const mine: AvatarLook = { ...DEFAULT_LOOK, tune: ['tune-wh-zipp-303'] };
    expect(withHeadgear(mine, 'tt', 1, { keepCap: true, bikeIndex: 1 }).tune).toEqual(['tune-wh-zipp-303']);
    expect(withHeadgear(mine, 'tt', 1, { bikeIndex: 1 }).tune).toEqual(['tune-wh-hed-tri']);
  });
  it('un casque chrono caché par une casquette compte comme oublié', () => {
    expect(ttMissing({ ...capped, helmetShape: 'chrono' })?.helmet).toBe(true);
  });
});
