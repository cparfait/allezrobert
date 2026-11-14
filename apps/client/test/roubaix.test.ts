/**
 * Roubaix dédié par taille (rider/roubaix.ts, étape I-3) : fichiers livrés et calculs du chargeur, sans navigateur.
 *
 * 1. Les trois niveaux de détail ont les mêmes nœuds, les mêmes ancres et les mêmes matériaux ; les ancres concordent avec
 *    le contrat de roubaixMetric.ts (axes des roues, mains).
 * 2. Le GLB porte le contrat et le réglage de selle (asset.extras) identiques aux données partagées.
 * 3. Réglage de selle : abaissement borné le long de l'axe de la tige.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUBAIX_44, ROUBAIX_SIZES } from '../../../packages/shared/src/roubaixMetric.ts';
import * as THREE from 'three/webgpu';
import { fitRoubaixWheels, roubaixSeat, roubaixSizeForRider, roubaixSpec, seatpostOffset, sitPointOf, solveSeatDrop } from '../src/rider/roubaix.ts';

interface GltfJson {
  asset: { extras?: { solMm?: number; contrat?: unknown; reglageSelle?: { axe?: { direction?: number[] } } } };
  nodes: { name?: string; mesh?: number; translation?: [number, number, number] }[];
  materials: { name?: string }[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
}
const dir = fileURLToPath(new URL('../public/models/bikes/roubaix/', import.meta.url));
function readJson(file: string): GltfJson {
  const b = readFileSync(dir + file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as GltfJson;
}
const PIECES = ['frame', 'fork', 'cockpit', 'saddle', 'seatpost', 'etrier_arriere', 'etrier_avant'];
const ANCHORS = ['axle_front', 'axle_rear', 'hand_L', 'hand_R', 'decal_dt', 'decal_ss', 'decal_ttf', 'decal_fork'];

describe('Roubaix : fichiers livrés', () => {
  for (const spec of ROUBAIX_SIZES) {
    const files = [...spec.lods, spec.frontRotorPiece];
    it(`${spec.size} : fichiers présents`, () => {
      for (const f of files) expect(existsSync(dir + f), f).toBe(true);
    });
    it(`${spec.size} : mêmes nœuds, ancres et matériaux aux trois niveaux de détail`, () => {
      const lods = spec.lods.map(readJson);
      const names = (g: GltfJson) => g.nodes.map((n) => n.name).sort();
      for (const g of lods) {
        expect(names(g)).toEqual([...PIECES, ...ANCHORS].sort());
        expect(g.materials.map((m) => m.name)).toEqual(lods[0]?.materials.map((m) => m.name));
      }
      for (const a of ANCHORS) {
        const t0 = lods[0]?.nodes.find((n) => n.name === a)?.translation;
        for (const g of lods) expect(g.nodes.find((n) => n.name === a)?.translation).toEqual(t0);
      }
    });
    it(`${spec.size} : zones de livrée (COLOR_0) sur les primitives « frame » de frame et fork`, () => {
      const g = readJson(spec.lods[0]);
      const frameMat = g.materials.findIndex((m) => m.name === 'frame');
      for (const piece of ['frame', 'fork']) {
        const node = g.nodes.find((n) => n.name === piece);
        const prim = g.meshes[node?.mesh ?? -1]?.primitives.find((p) => p.material === frameMat);
        expect(prim?.attributes.COLOR_0, piece).toBeTypeOf('number');
      }
    });
  }

  it('44 : ancres conformes au contrat (axes des roues, mains), contrat et selle embarqués', () => {
    const g = readJson(ROUBAIX_44.lods[0]);
    const at = (n: string) => g.nodes.find((x) => x.name === n)?.translation ?? [NaN, NaN, NaN];
    const m = ROUBAIX_44.metric;
    const near = (a: readonly number[], b: readonly number[] | undefined) => a.forEach((v, i) => expect(v).toBeCloseTo(b?.[i] ?? NaN, 4));
    near(at('axle_front'), m.axes.frontWheel?.originM);
    near(at('axle_rear'), m.axes.rearWheel?.originM);
    near(at('hand_L'), m.contacts.handL?.originM);
    near(at('hand_R'), m.contacts.handR?.originM);
    expect(g.asset.extras?.solMm).toBeCloseTo(ROUBAIX_44.groundOffsetMm, 3);
    // Contrat embarqué = contrat partagé, à 1e-9 près (le GLB garde des résidus de calcul de l'ordre de 1e-19).
    const flat = (o: unknown, p = ''): [string, unknown][] => (o !== null && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${p}.${k}`)) : [[p, o]]);
    const embarque = new Map(flat(g.asset.extras?.contrat));
    const partage = flat(JSON.parse(JSON.stringify(m)));
    expect([...embarque.keys()].sort()).toEqual(partage.map(([k]) => k).sort());
    for (const [k, v] of partage) {
      if (typeof v === 'number') expect(embarque.get(k) as number, k).toBeCloseTo(v, 9);
      else expect(embarque.get(k), k).toEqual(v);
    }
    expect(g.asset.extras?.reglageSelle?.axe?.direction).toEqual([...ROUBAIX_44.seatpost.directionUp]);
  });
});

describe('Roubaix : réglage de selle', () => {
  it('abaissement le long de l’axe, borné à [0 ; maxDropMm]', () => {
    const s = roubaixSpec('44');
    expect(s).toBe(ROUBAIX_44);
    if (!s) return;
    const d50 = seatpostOffset(s, 50);
    expect(d50.length()).toBeCloseTo(0.05, 6);
    expect(d50.y).toBeLessThan(0);
    expect(d50.z).toBeGreaterThan(0); // la tige penche vers l'arrière : la selle avance en descendant
    expect(seatpostOffset(s, 500).length()).toBeCloseTo(s.seatpost.maxDropMm / 1000, 6);
    expect(seatpostOffset(s, -20).length()).toBe(0);
    expect(seatpostOffset(s, Number.NaN).length()).toBe(0);
  });
  it('taille non modélisée : aucune spécification', () => {
    expect(roubaixSpec('61')).toBeUndefined();
  });
});

describe('Roubaix : disques de la taille sur les roues du jeu', () => {
  const wheel = (name: string): THREE.Object3D => {
    const w = new THREE.Object3D();
    w.name = name;
    const rotor = new THREE.Object3D();
    rotor.name = `${name}_rotor`;
    const mat = new THREE.MeshBasicMaterial();
    mat.name = `${name}_rotor_mat`;
    rotor.add(new THREE.Mesh(new THREE.BufferGeometry(), mat), new THREE.Mesh(new THREE.BufferGeometry(), mat));
    w.add(rotor);
    return w;
  };
  it('avant : pièce de la taille, arrière : disque de 160 décalé au plan 47,1 ; disques du jeu masqués', () => {
    const front = wheel('wheel_box_F'), rear = wheel('wheel_box_R');
    const piece = new THREE.Group();
    piece.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    const bike = { spec: ROUBAIX_44, lods: [new THREE.Group(), new THREE.Group(), new THREE.Group()], frontRotor: piece } as const;
    expect(fitRoubaixWheels(front, rear, bike)).toBe(true);
    expect(front.getObjectByName('wheel_box_F_rotor')?.visible).toBe(false);
    expect(rear.getObjectByName('wheel_box_R_rotor')?.visible).toBe(false);
    const fp = front.getObjectByName('wheel_box_F_rotor_roubaix');
    expect(fp).toBeDefined();
    fp?.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(((o as THREE.Mesh).material as THREE.Material).name).toBe('wheel_box_F_rotor_mat'); });
    const rp = rear.getObjectByName('wheel_box_R_rotor_roubaix');
    expect(rp?.visible).toBe(true);
    expect(rp?.position.x).toBeCloseTo((47.1 - 44) / 1000, 9);
  });
  it('roue sans disque : refus', () => {
    const bike = { spec: ROUBAIX_44, lods: [new THREE.Group(), new THREE.Group(), new THREE.Group()], frontRotor: new THREE.Group() } as const;
    expect(fitRoubaixWheels(new THREE.Object3D(), new THREE.Object3D(), bike)).toBe(false);
  });
});

describe('Roubaix : ajustement du coureur (I-4b)', () => {
  it('taille de cadre : tranche du 44 (142–155 cm), taille forcée, sinon aucune', () => {
    expect(roubaixSizeForRider(142)).toBe('44');
    expect(roubaixSizeForRider(154.9)).toBe('44');
    expect(roubaixSizeForRider(155)).toBeNull(); // tranche du 49, non modélisée
    expect(roubaixSizeForRider(178)).toBeNull();
    expect(roubaixSizeForRider(178, '44')).toBe('44');
    expect(roubaixSizeForRider(150, '61')).toBeNull();
    expect(roubaixSizeForRider(undefined)).toBeNull();
  });
  it('point d’assise : contrat, plus l’abaissement le long de la tige', () => {
    const s0 = roubaixSeat(ROUBAIX_44, 0);
    expect(s0.toArray()).toEqual([...(ROUBAIX_44.metric.contacts.saddle?.originM ?? [])]);
    const s50 = roubaixSeat(ROUBAIX_44, 50);
    expect(s50.distanceTo(s0)).toBeCloseTo(0.05, 6);
    expect(s50.y).toBeLessThan(s0.y);
  });
  it('abaissement de selle : racine d’une fonction décroissante, bornée', () => {
    expect(solveSeatDrop((d) => 40 - d, 120)).toBeCloseTo(40, 6);
    expect(solveSeatDrop((d) => -1 - d, 120)).toBe(0); // jambe trop longue : selle au plus haut
    expect(solveSeatDrop((d) => 500 - d, 120)).toBe(120); // jambe trop courte : selle au plus bas
  });
  it('point d’assise d’une selle : milieu de la zone large, dessus près du plan médian', () => {
    // Selle synthétique : bec étroit (z 0 → 0,1 ; largeur 0,04), arrière large (z −0,1 → 0 ; largeur 0,14), dessus à y 0,9.
    const pts: number[] = [];
    for (let z = -0.1; z <= 0.1001; z += 0.005) for (const x of z < 0 ? [-0.07, -0.01, 0, 0.01, 0.07] : [-0.02, 0, 0.02]) pts.push(x, 0.9 - Math.abs(x) * 0.1, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const root = new THREE.Group();
    const saddle = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    root.add(saddle);
    const p = sitPointOf(saddle, root);
    expect(p?.y).toBeCloseTo(0.9, 6);
    expect(p?.z).toBeLessThan(0);
    expect(p?.z).toBeGreaterThan(-0.1);
  });
});
