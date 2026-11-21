import { describe, expect, it } from 'vitest';
import { trimMenuLoops, wantedMenuLoops } from '../src/platform/desktopBoot.ts';

const file = (p: string, b = 10) => ({ p, b, h: 'a'.repeat(32) });
const manifest = {
  version: 'abc',
  bytes: 0,
  files: [
    file('menu/loop-autumn.mp4', 100),
    file('menu/loop-autumn.av1.mp4', 40),
    file('menu/loop-winter.mp4', 100),
    file('menu/loop-lowpoly-autumn.mp4', 100),
    file('menu/still-autumn.jpg', 1),
    file('models/avatar/rider.glb', 5),
  ],
};

describe('boucles vidéo du menu à la demande (application Windows)', () => {
  it('garde la boucle de la saison et du style, en H.264 et en AV1', () => {
    expect([...wantedMenuLoops(null, 'winter')].sort()).toEqual(['menu/loop-winter.av1.mp4', 'menu/loop-winter.mp4']);
    expect([...wantedMenuLoops('lowpoly', 'spring')].sort()).toEqual(['menu/loop-lowpoly-spring.av1.mp4', 'menu/loop-lowpoly-spring.mp4']);
    expect([...wantedMenuLoops('real', null)].sort()).toEqual(['menu/loop-autumn.av1.mp4', 'menu/loop-autumn.mp4']);
    expect(wantedMenuLoops('v3', 'summer').size).toBe(0);
  });

  it('retire les autres boucles, garde images fixes et modèles, recalcule taille et version', () => {
    const m = trimMenuLoops(manifest, wantedMenuLoops(null, 'autumn'));
    expect(m.files.map((f) => f.p)).toEqual(['menu/loop-autumn.mp4', 'menu/loop-autumn.av1.mp4', 'menu/still-autumn.jpg', 'models/avatar/rider.glb']);
    expect(m.bytes).toBe(146);
    expect(m.version).toBe('abc-autumn+autumn.av1');
  });

  it('la version change avec la saison : la synchronisation est refaite', () => {
    const a = trimMenuLoops(manifest, wantedMenuLoops(null, 'autumn')).version;
    const w = trimMenuLoops(manifest, wantedMenuLoops(null, 'winter')).version;
    expect(a).not.toBe(w);
  });

  it('manifeste sans boucle : inchangé', () => {
    const plain = { version: 'v', bytes: 5, files: [file('models/avatar/rider.glb', 5)] };
    expect(trimMenuLoops(plain, wantedMenuLoops(null, 'autumn'))).toBe(plain);
  });
});
