import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { QUALITY_PRESETS } from '../src/engine/quality.ts';
import { cullAfterWarmup } from '../src/world/cullWarmup.ts';
import { EZ_NEAR_M, boundsSphere } from '../src/world/ezTreeNear.ts';
import { orthoPxForRing } from '../src/world/terrain.ts';

describe('orthophotos lointaines réduites', () => {
  it('garde la taille d’origine près du coureur et réduit au loin', () => {
    expect(orthoPxForRing(0, null, true)).toBe(0);
    expect(orthoPxForRing(1, null, true)).toBe(0);
    expect(orthoPxForRing(2, null, true)).toBe(512);
    expect(orthoPxForRing(4, null, true)).toBe(512);
  });

  it('ne change pas de taille en anneau 2 (pas d’aller-retour sur une limite de tuile)', () => {
    // tuile approchée (anneau 1) puis éloignée d'un anneau : elle garde la taille d'origine
    expect(orthoPxForRing(2, 0, true)).toBe(0);
    // tuile lointaine qui se rapproche d'un anneau : elle reste réduite jusqu'à l'anneau 1
    expect(orthoPxForRing(2, 512, true)).toBe(512);
    expect(orthoPxForRing(1, 512, true)).toBe(0);
    expect(orthoPxForRing(3, 0, true)).toBe(512);
  });

  it('ne réduit rien quand la réduction est coupée (ultra, ?orthofar=0)', () => {
    for (const ring of [0, 1, 2, 3, 5]) expect(orthoPxForRing(ring, 512, false)).toBe(0);
  });
});

describe('vrais arbres : réglages par préréglage', () => {
  it('bas = imposteurs seuls, moyen = rayon réduit, haut et ultra = rayon d’origine', () => {
    expect(QUALITY_PRESETS.low.ezNearM).toBe(0);
    expect(QUALITY_PRESETS.medium.ezNearM).toBeGreaterThan(0);
    expect(QUALITY_PRESETS.medium.ezNearM).toBeLessThan(EZ_NEAR_M);
    expect(QUALITY_PRESETS.high.ezNearM).toBe(EZ_NEAR_M);
    expect(QUALITY_PRESETS.ultra.ezNearM).toBe(EZ_NEAR_M);
    expect(QUALITY_PRESETS.high.ezNearShadows).toBe(true);
    expect(QUALITY_PRESETS.ultra.ezNearShadows).toBe(true);
  });
});

describe('sphère englobante d’un lot d’arbres', () => {
  it('contient chaque arbre, de son pied à sa cime et à son envergure', () => {
    const feet = [
      [10, 80, -30],
      [55, 92, 12],
      [-20, 75, 40],
      [0, 88, 0],
    ] as const;
    const reach = 18;
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, reach };
    for (const [x, y, z] of feet) {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
    const s = boundsSphere(b, new THREE.Sphere());
    for (const [x, y, z] of feet) {
      // cime, et bout de branche dans chaque direction horizontale
      for (const [dx, dy, dz] of [
        [0, reach, 0],
        [reach, reach / 2, 0],
        [-reach, reach / 2, 0],
        [0, reach / 2, reach],
        [0, reach / 2, -reach],
      ] as const) {
        expect(s.center.distanceTo(new THREE.Vector3(x + dx, y + dy, z + dz))).toBeLessThanOrEqual(s.radius);
      }
    }
  });

  it('est vide pour un lot sans arbre', () => {
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, reach: 0 };
    expect(boundsSphere(b, new THREE.Sphere(new THREE.Vector3(5, 5, 5), 40)).radius).toBe(0);
  });
});

describe('culling différé', () => {
  it('laisse le maillage hors culling pendant les premiers dessins, puis l’active et rend la main', () => {
    const mesh = new THREE.Mesh();
    let calls = 0;
    const original = function (): void {
      calls++;
    };
    mesh.onAfterRender = original;
    cullAfterWarmup(mesh);
    expect(mesh.frustumCulled).toBe(false);
    const draw = (): void => (mesh.onAfterRender as unknown as () => void).call(mesh);
    for (let i = 0; i < 59; i++) draw();
    expect(mesh.frustumCulled).toBe(false);
    draw();
    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.onAfterRender).toBe(original);
    expect(calls).toBe(60);
  });
});
