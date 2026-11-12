import { readFile } from 'node:fs/promises';
import { BIKE_REFERENCE, DEFAULT_LOOK } from '@allezrobert/shared';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GltfRiderAvatar } from '../src/rider/gltfAvatar.ts';

// Les GLB du MPFB et du vélo générique sont lus sur disque. Seuls le transport
// HTTP, les textures externes et les matériaux qui demandent un canevas
// sont isolés pour l'exécution dans Node.
vi.mock(import('../src/rider/skin.ts'), async (original) => ({
  ...await original(),
  loadSkinTextures: async () => null,
}));
vi.mock(import('../src/rider/cloth.ts'), async (original) => ({
  ...await original(),
  loadClothTextures: async () => null,
}));
vi.mock(import('../src/rider/cap.ts'), async (original) => ({
  ...await original(),
  capMaterials: () => [],
}));
vi.mock('../src/rider/computerScreen.ts', async () => {
  const { Texture } = await import('three/webgpu');
  return { ComputerScreen: class { readonly texture = new Texture(); } };
});

const look = (heightCm: number) => ({ ...DEFAULT_LOOK, heightCm });
const avatarAt = (heightCm: number) => new GltfRiderAvatar(look(heightCm), 'mpfb');
const crankLength = BIKE_REFERENCE.crankLengthM;
const camera = new PerspectiveCamera();
const distances = [5, 20, 40, 5];
const expectedLods = [0, 1, 2, 0];
const sides = ['L', 'R'] as const;

beforeAll(async () => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function (this: GLTFLoader, url) {
    if (!url.startsWith('/models/')) throw new Error(`URL GLB inattendue : ${url}`);
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return this.parseAsync(buffer, '');
  });
  try {
    expect(await GltfRiderAvatar.load([], '/models/', ['mpfb'])).toBe(true);
  } finally {
    loader.mockRestore();
  }
  GltfRiderAvatar.camera = camera;
});

afterAll(() => {
  GltfRiderAvatar.camera = null;
});

function sampleCycle(avatar: GltfRiderAvatar) {
  const mounted = avatar['mounted']!;
  const lod = avatar['lod'];
  const pelvis = avatar.root.getObjectByName('pelvis')!;
  const ankles = new Map<string, Vector3>();
  const solveChain = avatar['solveChain'];
  avatar['time'] = 0;
  avatar['solveChain'] = function (chain, target, pole) {
    if (chain.end.startsWith('foot_')) ankles.set(chain.end, target.clone());
    solveChain.call(this, chain, target, pole);
  };

  try {
    return Array.from({ length: 72 }, (_, step) => {
      ankles.clear();
      avatar.setGesture({ hands: 'hoods', crank: step * Math.PI / 36 });
      avatar.update(0, 90, 8, 'seated');
      expect(ankles.size).toBe(2);

      return distances.map((distance, i) => {
        camera.position.set(0, 0, distance);
        camera.updateMatrixWorld(true);
        avatar.root.updateMatrixWorld(true);
        const level = lod.getCurrentLevel();
        expect(level).toBe(expectedLods[i]);
        const bike = mounted.levels[level]!;
        const saddle = bike.group.getObjectByName('saddle')!;
        const crank = bike.crank!;
        const scale = crank.getWorldScale(new Vector3());

        const contacts = sides.map((side) => {
          const pedal = bike.pedals[side]!.getWorldPosition(new Vector3());
          const local = crank.worldToLocal(pedal.clone());
          const target = lod.localToWorld(ankles.get(`foot_${side}`)!.clone());
          const ankle = avatar.root.getObjectByName(`foot_${side.toLowerCase()}`)!.getWorldPosition(new Vector3());
          return {
            pedal: pedal.toArray(),
            target: target.toArray(),
            ankle: ankle.toArray(),
            // Coordonnées dans le plan de la manivelle. Son mesh garde sa cote métrique.
            orbit: [local.y * scale.y, local.z * scale.z],
            expectedY: (side === 'L' ? -1 : 1) * crankLength * scale.y,
            nominal: crankLength * scale.y,
          };
        });

        return {
          body: pelvis.matrixWorld.toArray(),
          bike: bike.group.matrixWorld.toArray(),
          saddle: saddle.matrixWorld.toArray(),
          saddleTop: [new Box3().setFromObject(saddle).max.y],
          crank: crank.matrixWorld.toArray(),
          contacts,
        };
      });
    });
  } finally {
    avatar['solveChain'] = solveChain;
  }
}

type Cycle = ReturnType<typeof sampleCycle>;

function expectAligned(cycle: Cycle) {
  for (const phase of cycle) {
    for (const level of phase) {
      for (const contact of level.contacts) {
        expect(contact.nominal).toBeCloseTo(crankLength, 7);
        expect(contact.orbit[0]).toBeCloseTo(contact.expectedY, 7);
        expect(contact.orbit[1]).toBeCloseTo(0, 7);
        expect(new Vector3().fromArray(contact.target).distanceTo(new Vector3().fromArray(contact.ankle)))
          .toBeLessThan(1e-6);
      }
    }
  }
}

function expectSameCycle(actual: Cycle, expected: Cycle) {
  const compare = (a: number[], b: number[]) => {
    expect(a).toHaveLength(b.length);
    expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))).toBeLessThan(1e-7);
  };
  actual.forEach((phase, i) => phase.forEach((level, j) => {
    const cold = expected[i]![j]!;
    for (const part of ['body', 'bike', 'saddle', 'saddleTop', 'crank'] as const) compare(level[part], cold[part]);
    level.contacts.forEach((contact, side) => {
      for (const part of ['pedal', 'target', 'ankle'] as const) compare(contact[part], cold.contacts[side]![part]);
    });
  }));
}

function watchSize(avatar: GltfRiderAvatar) {
  return vi.spyOn(avatar as unknown as { applySize(): void }, 'applySize');
}

describe('GltfRiderAvatar.setLook — taille du MPFB et vélo route générique', () => {
  it('reproduit les constructions à froid pour 175 → 195 → 175 en gardant le montage', () => {
    const cold175 = sampleCycle(avatarAt(175));
    const cold195 = sampleCycle(avatarAt(195));
    expectAligned(cold175);
    expectAligned(cold195);
    // Les deux constructions de référence doivent réellement représenter des tailles distinctes.
    expect(cold175[0]![0]!.bike[0]).toBeCloseTo(1, 7);
    expect(cold195[0]![0]!.bike[0]).toBeCloseTo(195 / 175, 7);
    expect(cold195[0]![0]!.saddleTop[0]).toBeGreaterThan(cold175[0]![0]!.saddleTop[0]!);

    const hot = avatarAt(175);
    const mount = hot['mounted'];
    const applySize = watchSize(hot);
    hot.setLook(look(195));
    expect(hot['mounted']).toBe(mount);
    const at195 = sampleCycle(hot);
    expectAligned(at195);
    expectSameCycle(at195, cold195);
    expect(applySize).toHaveBeenCalledTimes(1);

    hot.setLook(look(175));
    expect(hot['mounted']).toBe(mount);
    const at175 = sampleCycle(hot);
    expectAligned(at175);
    expectSameCycle(at175, cold175);
    expect(applySize).toHaveBeenCalledTimes(2);
  });

  it('recalcule la taille en passant de 195 froid à 175 sans remonter le vélo', () => {
    const hot = avatarAt(195);
    const mount = hot['mounted'];
    const applySize = watchSize(hot);
    hot.setLook(look(175));
    expect(hot['mounted']).toBe(mount);
    const actual = sampleCycle(hot);
    expectAligned(actual);
    expectSameCycle(actual, sampleCycle(avatarAt(175)));
    expect(applySize).toHaveBeenCalledTimes(1);
  });

  it('laisse le montage et les transformations stables à taille identique', () => {
    const avatar = avatarAt(195);
    const mount = avatar['mounted'];
    const before = sampleCycle(avatar);
    const applySize = watchSize(avatar);
    avatar.setLook(look(195));
    expect(avatar['mounted']).toBe(mount);
    expect(applySize).not.toHaveBeenCalled();
    expectSameCycle(sampleCycle(avatar), before);
  });

  it('applique la nouvelle taille une seule fois si la clé de montage change aussi', () => {
    const avatar = avatarAt(175);
    const mount = avatar['mounted'];
    const applySize = watchSize(avatar);
    const updated = { ...look(195), bottles: 0 as const };
    avatar.setLook(updated);
    expect(avatar['mounted']).not.toBe(mount);
    expect(applySize).toHaveBeenCalledTimes(1);
    const actual = sampleCycle(avatar);
    expectAligned(actual);
    expectSameCycle(actual, sampleCycle(new GltfRiderAvatar(updated, 'mpfb')));
  });
});
