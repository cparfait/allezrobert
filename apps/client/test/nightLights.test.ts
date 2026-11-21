import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NightLights, nightWithin } from '../src/world/streetLamps.ts';
import { sunDirection } from '../src/world/environment.ts';
import { Dust } from '../src/world/dust.ts';
import { QUALITY_PRESETS } from '../src/engine/quality.ts';
import { NightSky } from '../src/world/nightsky.ts';
import { overcast, overcastDome } from '../src/world/overcast.ts';

const sunY = (season: 'summer' | 'winter') => (h: number) => sunDirection(h, season).y;
/** Même formule que World.nightFactor. */
const nightFactor = (y: number): number => Math.min(1, Math.max(0, (0.06 - y) / 0.16));

describe('lumières de nuit (phare, lampadaires)', () => {
  it('une sortie du matin en été ne voit pas la nuit dans les huit heures', () => {
    expect(nightWithin(sunY('summer'), 9)).toBe(false);
    expect(nightWithin(sunY('summer'), 11)).toBe(false);
  });

  it('la nuit proche ou en cours garde les lumières', () => {
    expect(nightWithin(sunY('winter'), 10)).toBe(true); // nuit avant 18 h en hiver
    expect(nightWithin(sunY('summer'), 16)).toBe(true);
    expect(nightWithin(sunY('summer'), 23)).toBe(true);
    expect(nightWithin(sunY('summer'), 3)).toBe(true);
  });

  it('ne dit jamais « pas de nuit » quand le facteur de nuit devient positif dans la fenêtre', () => {
    for (const season of ['summer', 'winter'] as const) {
      for (let h = 0; h < 24; h += 0.25) {
        if (nightWithin(sunY(season), h)) continue;
        for (let t = 0; t <= 8; t += 1 / 60) expect(nightFactor(sunY(season)((h + t) % 24))).toBe(0);
      }
    }
  });

  it('masque les lumières au départ et ne les rétablit qu’une fois', () => {
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    const lights = new NightLights([a, b]);
    expect(lights.active).toBe(true);
    lights.start(false);
    expect([a.visible, b.visible]).toEqual([false, false]);
    expect(lights.update(0)).toBe(false);
    expect(a.visible).toBe(false);
    expect(lights.update(0.1)).toBe(true);
    expect([a.visible, b.visible]).toEqual([true, true]);
    expect(lights.update(0.5)).toBe(false);
    expect(lights.update(0)).toBe(false);
    expect(a.visible).toBe(true);
  });

  it('garde les lumières quand la nuit est possible', () => {
    const a = new THREE.Object3D();
    const lights = new NightLights([a]);
    lights.start(true);
    expect(a.visible).toBe(true);
    expect(lights.update(1)).toBe(false);
  });
});

describe('objets invisibles non dessinés', () => {
  it('la poussière n’est dessinée que tant qu’une particule vit', () => {
    const dust = new Dust(QUALITY_PRESETS.high);
    expect(dust.sprite.visible).toBe(true);
    expect(dust.sprite.count).toBe(0);
    dust.update(0.016);
    expect(dust.sprite.count).toBe(0);
    dust.emit('me', 0, 0, 0, 1, 0, 8, 0.5);
    expect(dust.emitted).toBeGreaterThan(0);
    dust.update(0.016);
    expect(dust.sprite.count).toBe(QUALITY_PRESETS.high.dustParticles);
    dust.update(2);
    expect(dust.sprite.count).toBe(QUALITY_PRESETS.high.dustParticles);
    dust.update(1);
    expect(dust.sprite.count).toBe(0);
  });

  it('sans poussière au préréglage, rien n’est émis ni dessiné', () => {
    const dust = new Dust({ ...QUALITY_PRESETS.high, dustParticles: 0 });
    dust.emit('me', 0, 0, 0, 1, 0, 8, 0.5);
    dust.update(0.016);
    expect(dust.emitted).toBe(0);
    expect(dust.sprite.count).toBe(0);
  });

  it('les dômes du ciel restent visibles (compilés) mais ne dessinent rien à opacité nulle', () => {
    const before = (m: THREE.Mesh): void => (m.onBeforeRender as unknown as () => void)();
    const sky = new NightSky();
    sky.night.value = 0;
    before(sky.mesh);
    expect(sky.mesh.visible).toBe(true);
    expect(sky.mesh.geometry.drawRange.count).toBe(0);
    sky.night.value = 0.3;
    before(sky.mesh);
    expect(sky.mesh.geometry.drawRange.count).toBe(Infinity);

    const dome = overcastDome();
    const saved = overcast.amount.value;
    overcast.amount.value = 0;
    before(dome);
    expect(dome.geometry.drawRange.count).toBe(0);
    overcast.amount.value = 0.5;
    before(dome);
    expect(dome.geometry.drawRange.count).toBe(Infinity);
    overcast.amount.value = saved;
  });
});
