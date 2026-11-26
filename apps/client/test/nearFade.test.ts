import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FADE_MIN, fadeStep, fadeTarget, updateNearFade } from '../src/game/nearFade.ts';

const v = (x: number, y: number, z: number) => ({ x, y, z });
// Caméra derrière mon coureur (4 m en arrière, 1,5 m plus haut), cible au niveau du buste.
const cam = v(0, 2.5, -4);
const me = v(0, 1.1, 0);

describe('fondu des coureurs proches : opacité voulue', () => {
  it('coureur collé à la caméra : le plus estompé', () => {
    expect(fadeTarget(cam, me, v(0.3, 2, -3.5))).toBeCloseTo(FADE_MIN);
  });
  it('coureur sur la ligne caméra → moi : estompé', () => {
    expect(fadeTarget(cam, me, v(0, 1.6, -2.2))).toBeCloseTo(FADE_MIN, 1);
  });
  it('coureur à côté de la ligne, à distance : normal', () => {
    expect(fadeTarget(cam, me, v(1.8, 0.95, -1))).toBe(1);
  });
  it('coureur devant moi : jamais estompé (il ne cache rien)', () => {
    expect(fadeTarget(cam, me, v(0, 0.95, 3))).toBe(1);
  });
  it('coureur juste à côté de moi : pas estompé', () => {
    expect(fadeTarget(cam, me, v(0.6, 0.95, 0))).toBe(1);
  });
  it('coureur derrière la caméra (dans ma roue) : pas estompé, il est hors de l’image', () => {
    const fwd = { x: 0, y: -0.35, z: 0.94 };
    expect(fadeTarget(cam, me, v(0, 0.95, -5.5), fwd)).toBe(1);
    // Juste à côté de la caméra, centre à peine derrière elle : il déborde dans l’image, toujours estompé.
    expect(fadeTarget(cam, me, v(0.8, 2.2, -4.1), fwd)).toBeLessThan(0.5);
  });
  it('coureur que je traverse (superposé au mien) : estompé ; voisin côte à côte : net', () => {
    const fwd = { x: 0, y: -0.35, z: 0.94 };
    // `me` est le point visé (buste) ; le centre d'un coureur superposé est à la même place, un peu plus bas.
    expect(fadeTarget(cam, me, v(0.1, 0.95, 0.8), fwd)).toBeCloseTo(FADE_MIN);
    expect(fadeTarget(cam, me, v(0.1, 0.95, -0.5), fwd)).toBeCloseTo(FADE_MIN);
    expect(fadeTarget(cam, me, v(0.75, 0.95, 0.2), fwd)).toBe(1);
    expect(fadeTarget(cam, me, v(0, 0.95, 2.5), fwd)).toBe(1);
  });
  it('sans cible (caméra libre) : seule la distance compte', () => {
    expect(fadeTarget(cam, null, v(0, 1.6, -2.2))).toBeGreaterThan(FADE_MIN + 0.15);
    expect(fadeTarget(cam, null, v(0, 2.3, -3.8))).toBeCloseTo(FADE_MIN);
  });
});

describe('fondu des coureurs proches : pas de temps', () => {
  it('va au bout en ≈ 0,35 s, quelle que soit la cadence', () => {
    let a = 1, b = 1;
    for (let i = 0; i < 21; i++) a = fadeStep(a, FADE_MIN, 1 / 60);
    for (let i = 0; i < 42; i++) b = fadeStep(b, FADE_MIN, 1 / 120);
    expect(a).toBe(FADE_MIN);
    expect(b).toBe(FADE_MIN);
  });
  it('dt nul : ne bouge pas', () => {
    expect(fadeStep(0.6, 1, 0)).toBe(0.6);
  });
});

describe('fondu des coureurs proches : matériaux', () => {
  const rider = (shared: THREE.Material) => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    return root;
  };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2.5, -4);
  camera.updateMatrixWorld();
  const meGround = new THREE.Vector3(0, 0, 0);

  it('estompe un coureur sans toucher le matériau partagé, puis le lui rend', () => {
    const shared = new THREE.MeshStandardNodeMaterial();
    const near = rider(shared), far = rider(shared);
    near.position.set(0, 1.3, -3.6);
    far.position.set(0, 0, 20);
    for (let i = 0; i < 30; i++) updateNearFade(1 / 60, camera, meGround, [near, far]);
    const nearMat = (near.children[0] as THREE.Mesh).material as THREE.Material;
    expect(nearMat).not.toBe(shared);
    expect(nearMat.transparent).toBe(true);
    expect(nearMat.opacity).toBeCloseTo(FADE_MIN);
    expect(shared.transparent).toBe(false);
    expect(shared.opacity).toBe(1);
    expect((far.children[0] as THREE.Mesh).material).toBe(shared);
    // Il s'éloigne : matériau d'origine rendu.
    near.position.set(0, 0, 20);
    for (let i = 0; i < 60; i++) updateNearFade(1 / 60, camera, meGround, [near, far]);
    expect((near.children[0] as THREE.Mesh).material).toBe(shared);
  });

  it('pièce double face ajourée : un seul passage, seuil de découpe baissé avec l’opacité, original intact', () => {
    const hair = new THREE.MeshStandardNodeMaterial();
    hair.side = THREE.DoubleSide;
    hair.alphaTest = 0.5;
    const near = rider(hair);
    near.position.set(0, 1.3, -3.6);
    for (let i = 0; i < 30; i++) updateNearFade(1 / 60, camera, meGround, [near]);
    const m = (near.children[0] as THREE.Mesh).material as THREE.Material;
    expect(m.forceSinglePass).toBe(true);
    expect(m.alphaTest).toBeCloseTo(0.5 * FADE_MIN);
    expect(m.alphaTest).toBeGreaterThan(0);
    expect(hair.alphaTest).toBe(0.5);
    updateNearFade(1 / 60, camera, meGround, []);
  });

  it('second fondu du même coureur : mêmes copies (pas de shader reconstruit), détruites quand il quitte la liste', () => {
    const shared = new THREE.MeshStandardNodeMaterial();
    const r = rider(shared);
    const mesh = r.children[0] as THREE.Mesh;
    const fade = (z: number) => {
      r.position.set(0, z < 0 ? 1.3 : 0, z);
      for (let i = 0; i < 60; i++) updateNearFade(1 / 60, camera, meGround, [r]);
    };
    fade(-3.6);
    const first = mesh.material as THREE.Material;
    let disposed = 0;
    first.addEventListener('dispose', () => disposed++);
    fade(20);
    expect(mesh.material).toBe(shared);
    expect(disposed).toBe(0);
    fade(-3.6);
    expect(mesh.material).toBe(first);
    fade(20);
    updateNearFade(1 / 60, camera, meGround, []);
    expect(disposed).toBe(1);
  });

  it('coureur retiré de la liste en plein fondu : matériau rendu', () => {
    const shared = new THREE.MeshStandardNodeMaterial();
    const gone = rider(shared);
    gone.position.set(0, 1.3, -3.6);
    for (let i = 0; i < 5; i++) updateNearFade(1 / 60, camera, meGround, [gone]);
    expect((gone.children[0] as THREE.Mesh).material).not.toBe(shared);
    updateNearFade(1 / 60, camera, meGround, []);
    expect((gone.children[0] as THREE.Mesh).material).toBe(shared);
  });
});
