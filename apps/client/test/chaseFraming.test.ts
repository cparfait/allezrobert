import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraBoom, FRAME_X, keepInFrame, softLimit } from '../src/game/chaseFraming.ts';

/** Abscisse écran (−1…1) de `p` vu depuis `cam` qui regarde `look`. */
function screenX(cam: THREE.Vector3, look: THREE.Vector3, p: THREE.Vector3, fov = 62, aspect = 16 / 9): number {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
  c.position.copy(cam);
  c.lookAt(look);
  c.updateMatrixWorld();
  return p.clone().project(c).x;
}

describe('softLimit', () => {
  it('laisse passer les petits écarts et borne les grands sans jamais dépasser la limite', () => {
    expect(softLimit(0.2, 1)).toBe(0.2);
    expect(softLimit(-0.4, 1)).toBe(-0.4);
    expect(softLimit(5, 1)).toBeLessThan(1);
    expect(softLimit(5, 1)).toBeGreaterThan(0.95);
    expect(softLimit(-5, 1)).toBeGreaterThan(-1);
  });
  it('est continue et croissante (pas d’à-coup quand la butée entre en jeu)', () => {
    let prev = -Infinity;
    for (let x = 0; x < 3; x += 0.01) {
      const y = softLimit(x, 1);
      expect(y).toBeGreaterThanOrEqual(prev);
      if (prev > -Infinity) expect(y - prev).toBeLessThanOrEqual(0.0101);
      prev = y;
    }
  });
});

describe('keepInFrame', () => {
  const cam = new THREE.Vector3(0, 1.5, -3);
  const rider = new THREE.Vector3(0, 0.9, 0);
  it('ne change pas un regard qui garde le coureur au centre', () => {
    const look = new THREE.Vector3(0, 1, 10);
    const before = look.clone();
    keepInFrame(cam, look, rider, 62, 16 / 9);
    expect(look.distanceTo(before)).toBeLessThan(1e-9);
  });
  it('épingle : le point visé part derrière la caméra, le coureur reste dans le cadre', () => {
    for (const look of [new THREE.Vector3(12, 1, -2), new THREE.Vector3(-8, 1, -10), new THREE.Vector3(0, 1, -15)]) {
      keepInFrame(cam, look, rider, 62, 16 / 9);
      const x = screenX(cam, look, rider);
      expect(Math.abs(x)).toBeLessThanOrEqual(FRAME_X + 0.05);
    }
  });
  it('point visé qui passe derrière la caméra : le coureur reste du même côté de l’image (pas de bascule)', () => {
    const hint = { side: 0 };
    let prev: number | null = null;
    // Le point visé tourne de 150° à 210° autour de la caméra (passe exactement derrière).
    for (let a = 150; a <= 210; a += 2) {
      const r = THREE.MathUtils.degToRad(a);
      const look = new THREE.Vector3(cam.x + Math.sin(r) * 10, 1, cam.z + Math.cos(r) * 10);
      keepInFrame(cam, look, rider, 62, 16 / 9, hint);
      const x = screenX(cam, look, rider);
      if (prev !== null) expect(Math.abs(x - prev)).toBeLessThan(0.05);
      prev = x;
    }
  });
});

describe('CameraBoom', () => {
  // Mur (bâtiment) perpendiculaire à l'axe, à 1,5 m derrière le coureur : entre lui et la caméra voulue à 3 m.
  const wallZ = -1.5;
  const occlusion = (a: THREE.Vector3, b: THREE.Vector3): number | null => {
    if ((a.z - wallZ) * (b.z - wallZ) >= 0) return null;
    return (wallZ - a.z) / (b.z - a.z);
  };
  const rider = new THREE.Vector3(0, 0, 0);
  const end = new THREE.Vector3(0, 1.5, -3);

  it('sans obstacle, la caméra est là où on la veut', () => {
    const boom = new CameraBoom();
    const out = boom.update(rider, end, 1 / 60, () => null, new THREE.Vector3());
    expect(out.distanceTo(end)).toBeLessThan(1e-9);
  });
  it('repasse devant le mur en moins de 0,1 s (caméra posée derrière) et y reste', () => {
    const boom = new CameraBoom();
    const out = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      boom.update(rider, end, 1 / 60, occlusion, out);
      if (i >= 6) expect(out.z).toBeGreaterThan(wallZ);
    }
    // Stabilisée : à distance du mur (marge), un peu plus haut pour voir le coureur par-dessus.
    expect(out.z).toBeGreaterThan(wallZ + 0.3);
    expect(out.y).toBeGreaterThan(1.5);
  });
  it('coureur dans une emprise (itinéraire qui traverse un bâtiment) : le bras ne se replie pas sur lui', () => {
    // Bâtiment qui englobe le coureur et la caméra : tout segment qui en part le « touche » dès le départ.
    const inBuilding = (a: THREE.Vector3): number | null => (Math.abs(a.x) < 5 && a.z > -4 && a.z < 4 ? 0 : null);
    const boom = new CameraBoom();
    const out = new THREE.Vector3();
    for (let i = 0; i < 60; i++) boom.update(rider, end, 1 / 60, inBuilding, out);
    expect(out.distanceTo(end)).toBeLessThan(1e-6);
  });
  it('recule doucement quand le mur disparaît (pas de saut)', () => {
    const boom = new CameraBoom();
    const out = new THREE.Vector3();
    for (let i = 0; i < 60; i++) boom.update(rider, end, 1 / 60, occlusion, out);
    let prev = out.clone();
    for (let i = 0; i < 300; i++) {
      boom.update(rider, end, 1 / 60, () => null, out);
      expect(out.distanceTo(prev)).toBeLessThan(0.08);
      prev = out.clone();
    }
    expect(out.distanceTo(end)).toBeLessThan(0.05);
  });
});
