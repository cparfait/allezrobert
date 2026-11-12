/// <reference types="node" />
/**
 * Vélo de référence (audit n° 3, étape E1.2a).
 *
 * 1. Les valeurs de BIKE_REFERENCE sont comparées à des valeurs écrites en clair ici (indépendantes du module).
 * 2. Elles sont confrontées aux modèles réellement chargés par le jeu (apps/client/public/models/bikes/*.glb,
 *    bloc JSON seulement : transformations des nœuds et min/max des accesseurs, non compressés, en mètres),
 *    sans imposer la référence aux familles qui s'en écartent (lowpro, roues propres du VTT).
 * 3. Le rayon physique (DEFAULT_BIKE.wheelRadiusM) est constaté égal au rayon visuel à ce jour, sans couplage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BIKE_FAMILIES, BIKE_REFERENCE, BIKE_REFERENCE_WHEELBASE_M, DEFAULT_BIKE } from '../src/index.ts';

// Valeurs attendues, écrites en clair (build_cyclist.py : BB, CRANK, WHEEL_R, REAR_AXLE, FRONT_AXLE, PEDAL_AXIS_X, REST_PITCH).
const EXPECTED = {
  wheelRadiusM: 0.335,
  bottomBracket: [0, 0.27, 0],
  crankLengthM: 0.1725,
  pedalAxisOffsetXM: 0.072,
  pedalRestPitchRad: 0.35,
  frontAxle: [0, 0.335, 0.59],
  rearAxle: [0, 0.335, -0.41],
};

describe('vélo de référence : valeurs', () => {
  it('valeurs exactes attendues', () => {
    expect(BIKE_REFERENCE).toEqual(EXPECTED);
    expect(BIKE_REFERENCE_WHEELBASE_M).toBeCloseTo(1.0, 12);
  });

  it('seuls les champs génériques prévus (pas de cible du cycliste, de réglage ni de donnée de famille)', () => {
    expect(Object.keys(BIKE_REFERENCE).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('cohérence interne : axes à la hauteur du rayon, boîtier sous les axes, avant devant, arrière derrière', () => {
    expect(BIKE_REFERENCE.frontAxle[1]).toBe(BIKE_REFERENCE.wheelRadiusM);
    expect(BIKE_REFERENCE.rearAxle[1]).toBe(BIKE_REFERENCE.wheelRadiusM);
    expect(BIKE_REFERENCE.wheelRadiusM - BIKE_REFERENCE.bottomBracket[1]).toBeCloseTo(0.065, 12);
    expect(BIKE_REFERENCE.frontAxle[2]).toBeGreaterThan(BIKE_REFERENCE.bottomBracket[2]);
    expect(BIKE_REFERENCE.rearAxle[2]).toBeLessThan(BIKE_REFERENCE.bottomBracket[2]);
    // Pédale en bas au-dessus du sol (garde au sol de la pédale).
    expect(BIKE_REFERENCE.bottomBracket[1] - BIKE_REFERENCE.crankLengthM).toBeGreaterThan(0.05);
  });

  it('valeurs figées (non modifiables à l\'exécution)', () => {
    expect(Object.isFrozen(BIKE_REFERENCE)).toBe(true);
    expect(Object.isFrozen(BIKE_REFERENCE.bottomBracket)).toBe(true);
    expect(Object.isFrozen(BIKE_REFERENCE.frontAxle)).toBe(true);
    expect(Object.isFrozen(BIKE_REFERENCE.rearAxle)).toBe(true);
  });

  it('rayon physique (DEFAULT_BIKE.wheelRadiusM) égal au rayon visuel à ce jour (constat, pas un couplage)', () => {
    expect(DEFAULT_BIKE.wheelRadiusM).toBe(0.335);
    expect(DEFAULT_BIKE.wheelRadiusM).toBe(BIKE_REFERENCE.wheelRadiusM);
  });
});

// ---------------------------------------------------------------------------------------------
// Confrontation aux modèles 3D du jeu (bloc JSON des GLB)
// ---------------------------------------------------------------------------------------------

interface GNode {
  name?: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}
interface Gltf {
  extensionsUsed?: string[];
  nodes: GNode[];
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; material?: number }> }>;
  materials?: Array<{ name?: string }>;
  accessors: Array<{ min?: number[]; max?: number[] }>;
}

const BIKES_DIR = fileURLToPath(new URL('../../../apps/client/public/models/bikes/', import.meta.url));

function glbJson(name: string): Gltf {
  const b = readFileSync(`${BIKES_DIR}${name}.glb`);
  expect(b.toString('ascii', 0, 4)).toBe('glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len)) as Gltf;
}
const node = (g: Gltf, name: string): GNode => {
  const n = g.nodes.find((x) => x.name === name);
  expect(n, name).toBeDefined();
  return n as GNode;
};
const t = (g: Gltf, name: string): [number, number, number] => node(g, name).translation ?? [0, 0, 0];
/** Rayon du pneu d'une roue : métadonnées min/max (JSON) de la primitive au matériau « tire ». */
const tireRadius = (g: Gltf, name: string): number => {
  const m = g.meshes?.[node(g, name).mesh ?? -1];
  const p = m?.primitives.find((q) => g.materials?.[q.material ?? -1]?.name === 'tire');
  const acc = g.accessors[p?.attributes.POSITION ?? -1];
  return Math.max(Math.abs(acc?.min?.[1] ?? Number.NaN), Math.abs(acc?.max?.[1] ?? Number.NaN));
};

const FAMILIES = [...BIKE_FAMILIES, 'gravel', 'mtb'];
const FILES = FAMILIES.flatMap((f) => [f, `${f}_lod1`]);
const present = existsSync(BIKES_DIR) && FILES.every((f) => existsSync(`${BIKES_DIR}${f}.glb`));
const REF = BIKE_REFERENCE;

describe.skipIf(!present)(`vélo de référence ↔ modèles du jeu${present ? '' : ' — IGNORÉ : modèles absents'}`, () => {
  it('modèles non compressés (positions du JSON en mètres)', () => {
    for (const f of FILES) expect(glbJson(f).extensionsUsed ?? [], f).toEqual([]);
  });

  it.each(FILES)('%s : boîtier, manivelle, écart et inclinaison des pédales = référence', (f) => {
    const g = glbJson(f);
    const bb = t(g, 'crankset');
    for (let k = 0; k < 3; k++) expect(bb[k], `crankset[${k}]`).toBeCloseTo(REF.bottomBracket[k] as number, 6);
    const pl = t(g, 'pedal_L');
    const pr = t(g, 'pedal_R');
    expect(pl[0]).toBeCloseTo(REF.pedalAxisOffsetXM, 6);
    expect(pr[0]).toBeCloseTo(-REF.pedalAxisOffsetXM, 6);
    // Manivelle 0 : pédale gauche en bas, droite en haut, à une manivelle de l'axe du boîtier.
    expect(Math.hypot(pl[1] - bb[1], pl[2] - bb[2])).toBeCloseTo(REF.crankLengthM, 6);
    expect(Math.hypot(pr[1] - bb[1], pr[2] - bb[2])).toBeCloseTo(REF.crankLengthM, 6);
    for (const p of ['pedal_L', 'pedal_R']) {
      const q = node(g, p).rotation ?? [0, 0, 0, 1];
      expect(2 * Math.atan2(q[0], q[3]), p).toBeCloseTo(REF.pedalRestPitchRad, 4);
    }
  });

  // VTT exclu des deux contrôles suivants : empattement propre, axes = ses roues réelles (voir « VTT » plus bas, E1.3b).
  it.each(FILES.filter((f) => !f.startsWith('mtb')))('%s : axe arrière = référence', (f) => {
    const g = glbJson(f);
    const a = t(g, 'axle_rear');
    for (let k = 0; k < 3; k++) expect(a[k], `axle_rear[${k}]`).toBeCloseTo(REF.rearAxle[k] as number, 6);
  });

  it.each(FILES.filter((f) => !f.startsWith('lowpro') && !f.startsWith('mtb')))('%s : axe avant = référence (empattement 1,00 m)', (f) => {
    const g = glbJson(f);
    const a = t(g, 'axle_front');
    for (let k = 0; k < 3; k++) expect(a[k], `axle_front[${k}]`).toBeCloseTo(REF.frontAxle[k] as number, 6);
    expect(a[2] - t(g, 'axle_rear')[2]).toBeCloseTo(BIKE_REFERENCE_WHEELBASE_M, 6);
  });

  it.each(['lowpro', 'lowpro_lod1'])('%s : famille particulière, roue avant réduite (×0,86), hors référence', (f) => {
    const g = glbJson(f);
    const s = node(g, 'axle_front').scale?.[0] ?? 1;
    expect(s).toBeCloseTo(0.86, 5);
    // Roue de référence réduite et posée au sol : axe à la hauteur du rayon de référence × échelle.
    expect(t(g, 'axle_front')[1]).toBeCloseTo(REF.wheelRadiusM * s, 4);
    expect(t(g, 'axle_front')[2]).not.toBeCloseTo(REF.frontAxle[2], 3);
  });

  it.each(['wheels', 'wheels_lod1'])('%s : pneu de chaque roue de la bibliothèque au rayon de référence', (f) => {
    const g = glbJson(f);
    for (const ty of ['box', 'c35', 'c50', 'c65', 'disc', 'tri']) for (const s of ['F', 'R']) expect(tireRadius(g, `wheel_${ty}_${s}`), `wheel_${ty}_${s}`).toBeCloseTo(REF.wheelRadiusM, 3);
  });

  it('gravel : roues propres au rayon de référence, posées sur les axes de référence', () => {
    const g = glbJson('gravel');
    for (const [w, axle] of [['wheel_front', REF.frontAxle], ['wheel_rear', REF.rearAxle]] as const) {
      expect(tireRadius(g, w), w).toBeCloseTo(REF.wheelRadiusM, 3);
      for (let k = 0; k < 3; k++) expect(t(g, w)[k], `${w}[${k}]`).toBeCloseTo(axle[k] as number, 6);
    }
  });

  it.each(['mtb', 'mtb_lod1'])('VTT %s : roues propres au rayon de référence, empattement propre (hors référence), axes = roues réelles', (f) => {
    const g = glbJson(f);
    for (const w of ['wheel_front', 'wheel_rear']) expect(tireRadius(g, w), w).toBeCloseTo(REF.wheelRadiusM, 3);
    // Roues réelles du VTT : empattement ≈ 1,159 m, hors référence (1,00 m).
    expect(t(g, 'wheel_front')[2] - t(g, 'wheel_rear')[2]).toBeCloseTo(1.1587, 3);
    expect(t(g, 'wheel_front')[2] - t(g, 'wheel_rear')[2]).not.toBeCloseTo(BIKE_REFERENCE_WHEELBASE_M, 2);
    // Ancres des axes sur les roues réelles du fichier (E1.3b ; auparavant valeurs du vélo aero, écart D3).
    expect(t(g, 'axle_front')).toEqual(t(g, 'wheel_front'));
    expect(t(g, 'axle_rear')).toEqual(t(g, 'wheel_rear'));
    expect(t(g, 'axle_front')[2] - t(g, 'axle_rear')[2]).toBeCloseTo(1.1587, 3);
    // Axe arrière au sol, à la hauteur du rayon de référence (au dixième de millimètre près : réglage du bras oscillant).
    expect(t(g, 'axle_rear')[1]).toBeCloseTo(REF.wheelRadiusM, 3);
    expect(t(g, 'axle_front')[1]).toBeCloseTo(REF.wheelRadiusM, 6);
  });

  it('VTT : mêmes roues et mêmes ancres d\'axes aux deux niveaux de détail', () => {
    const a = glbJson('mtb');
    const b = glbJson('mtb_lod1');
    for (const n of ['wheel_front', 'wheel_rear', 'axle_front', 'axle_rear']) expect(t(b, n), n).toEqual(t(a, n));
  });
});
