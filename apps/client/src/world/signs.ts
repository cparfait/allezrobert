import * as THREE from 'three/webgpu';
import type { RouteTrack } from '@allezrobert/shared';

/** Texture d'un panneau d'entrée d'agglomération (fond blanc, liseré rouge, nom en capitales). */
function signTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#c8102e';
  ctx.lineWidth = 16;
  ctx.strokeRect(14, 14, 484, 164);
  ctx.fillStyle = '#111';
  const label = name.toUpperCase();
  let size = 64;
  ctx.font = `700 ${size}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  while (ctx.measureText(label).width > 440 && size > 26) {
    size -= 2;
    ctx.font = `700 ${size}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Panneaux d'entrée d'agglomération le long de l'itinéraire, aux lieux traversés fournis
 * par le pipeline terrain (`route.landmarks`), côté droit de la chaussée.
 */
export class TownSigns {
  readonly group = new THREE.Group();

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number) {
    this.group.name = 'signs';
    const landmarks = track.route.landmarks ?? [];
    const postMat = new THREE.MeshStandardNodeMaterial({ color: '#8a8f96', roughness: 0.5, metalness: 0.6 });
    const backMat = new THREE.MeshStandardNodeMaterial({ color: '#9aa0a6', roughness: 0.6 });
    const half = track.route.roadWidthM / 2;
    for (const lm of landmarks) {
      // Panneau 40 m avant le lieu, face aux coureurs qui arrivent.
      const p = track.positionAt(lm.d - 40, half + 1.4);
      const ground = groundAt(p.x, p.z);
      const y = Number.isFinite(ground) ? ground : p.y;
      const sign = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), postMat);
      post.position.y = 1.15;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshStandardNodeMaterial({ map: signTexture(lm.name), roughness: 0.45 }));
      face.position.set(0, 2.05, 0.03);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), backMat);
      back.position.set(0, 2.05, 0.02);
      back.rotation.y = Math.PI;
      for (const m of [post, face, back]) {
        m.castShadow = true;
        sign.add(m);
      }
      sign.position.set(p.x, y, p.z);
      // Face vers les coureurs : la normale du panneau pointe à l'opposé de la direction de marche.
      sign.rotation.y = Math.atan2(-p.dirX, -p.dirZ);
      this.group.add(sign);
    }
  }
}
