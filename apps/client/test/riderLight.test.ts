import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { bakeLightGeometry, needsLightBuild, updateRiderLight } from '../src/game/riderLight.ts';

describe('coureur lointain en version légère', () => {
  it('un seul maillage, sommets dans le repère du coureur, couleur de chaque pièce', () => {
    const root = new THREE.Group();
    root.position.set(100, 0, -50);
    root.rotation.y = Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    frame.position.set(0, 0.8, 0);
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x0000ff }));
    wheel.position.set(0.5, 0.35, 0);
    root.add(frame, wheel);
    root.updateMatrixWorld(true);
    const g = bakeLightGeometry([frame, wheel], root);
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    expect(pos.count).toBe(frame.geometry.getAttribute('position').count + wheel.geometry.getAttribute('position').count);
    // Premier sommet du cadre : dans le repère du coureur (rotation et position de la racine retirées).
    const p0 = new THREE.Vector3().fromBufferAttribute(frame.geometry.getAttribute('position'), 0).add(frame.position);
    expect(pos.getX(0)).toBeCloseTo(p0.x, 5);
    expect(pos.getY(0)).toBeCloseTo(p0.y, 5);
    expect(col.getX(0)).toBeCloseTo(1, 3);
    expect(col.getZ(pos.count - 1)).toBeCloseTo(1, 3);
    expect(g.index?.count).toBe((frame.geometry.index?.count ?? 0) + (wheel.geometry.index?.count ?? 0));
  });

  it('corps à squelette jamais dessiné : figé à sa place, pas à son ancienne position', () => {
    const root = new THREE.Group();
    const bone = new THREE.Bone();
    const geometry = new THREE.BoxGeometry(0.4, 1.6, 0.3);
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    body.add(bone);
    root.add(body);
    root.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton([bone]));
    // Le coureur a roulé 300 m depuis la dernière mise à jour « de rendu » de son corps (masqué entre-temps).
    root.position.set(300, 0, 0);
    root.updateWorldMatrix(true, true);
    const g = bakeLightGeometry([body], root);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-0.2, 4);
    expect(g.boundingBox!.max.x).toBeCloseTo(0.2, 4);
  });

  it('rendu détaillé pas encore prêt (coureur Bêta en chargement) : pas de version légère figée', () => {
    const root = new THREE.Group();
    const detail = new THREE.Group();
    for (let i = 0; i < 3; i++) detail.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    root.add(detail);
    updateRiderLight(root, detail, 100, 1, false, true, undefined, false);
    expect(needsLightBuild(root)).toBe(true);
    expect(detail.visible).toBe(true);
    updateRiderLight(root, detail, 100, 2, false, true, undefined, true);
    expect(needsLightBuild(root)).toBe(false);
    expect(detail.visible).toBe(false);
  });

  it('texture dessinée en jeu (canevas) : jamais relue, couleur du matériau', () => {
    const root = new THREE.Group();
    let reads = 0;
    // Relecture de la moyenne : canevas 8 × 8 de la page, dont getImageData attend la carte graphique.
    const pixels = { drawImage: () => {}, getImageData: () => (reads++, { data: new Uint8ClampedArray(256).fill(255) }) };
    const g = globalThis as { document?: unknown };
    const had = g.document;
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => pixels }) };
    const canvas = { width: 128, height: 176, getContext: () => null };
    const tex = new THREE.Texture(canvas as unknown as HTMLCanvasElement);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01), new THREE.MeshStandardMaterial({ color: 0x00ff00, map: tex }));
    root.add(screen);
    root.updateMatrixWorld(true);
    try {
      for (let i = 0; i < 3; i++) {
        const col = bakeLightGeometry([screen], root).getAttribute('color');
        expect(col.getX(0)).toBeCloseTo(0, 3);
        expect(col.getY(0)).toBeCloseTo(1, 3);
      }
    } finally {
      g.document = had;
    }
    expect(reads).toBe(0);
  });
});
