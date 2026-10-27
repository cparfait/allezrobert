import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, mix, instanceIndex, hash, color, smoothstep, texture, uv } from 'three/tsl';
import { rng } from '../engine/noise.ts';
import { backlitOutput } from './sunlight.ts';
import type { Node } from 'three/webgpu';
import type { Vec3Node } from '../engine/tsl.ts';

/**
 * Haies et buissons « réels » (tuiles enrichies au LiDAR HD) : cartes de feuillage (texture de
 * feuilles dessinée à l'exécution, sans asset). Les arbres réels reprennent le feuillu semé
 * (vegetation.ts), bien moins coûteux que des cartes à alpha testé.
 */
/** Atlas 2 × 2 de bouquets de feuilles (niveaux de gris, alpha), teinté par le matériau. */
function leafAtlas(): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rng(91);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * (S / 2);
    const oy = Math.floor(cell / 2) * (S / 2);
    const cx = ox + S / 4;
    const cy = oy + S / 4;
    // feuilles du fond (sombres) puis du dessus (claires)
    for (let k = 0; k < 150; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * (S / 4 - 16);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const len = 9 + r() * 9 + (cell === 3 ? 4 : 0);
      const wid = len * (cell === 2 ? 0.32 : 0.48);
      const l = Math.round(95 + (k / 150) * 120 + r() * 35);
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.beginPath();
      g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      g.fill();
      // nervure
      g.strokeStyle = `rgba(0,0,0,0.25)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-len * 0.9, 0);
      g.lineTo(len * 0.9, 0);
      g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

let atlas: THREE.Texture | null = null;
function getAtlas(): THREE.Texture {
  return (atlas ??= leafAtlas());
}

interface Builder {
  pos: number[];
  nrm: number[];
  uvs: number[];
  leaf: number[];
  shade: number[];
}

/** Carte de feuillage carrée, orientée au hasard, normale « sphérique » (éclairage doux du houppier). */
function card(b: Builder, center: THREE.Vector3, size: number, crown: THREE.Vector3, crownR: number, r: () => number): void {
  const n = new THREE.Vector3(r() - 0.5, r() * 0.8 - 0.2, r() - 0.5).normalize();
  const t1 = new THREE.Vector3(n.y, -n.x, 0.3).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const cell = Math.floor(r() * 3); // 3 bouquets différents (le 4e sert aux buissons)
  const u0 = (cell % 2) * 0.5;
  const v0 = Math.floor(cell / 2) * 0.5;
  const h = size / 2;
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  const sph = new THREE.Vector3();
  for (const [a, c] of corners) {
    const p = center.clone().add(t1.clone().multiplyScalar(a * h)).add(t2.clone().multiplyScalar(c * h));
    b.pos.push(p.x, p.y, p.z);
    sph.set(p.x - crown.x, (p.y - crown.y) * 0.9, p.z - crown.z).normalize();
    b.nrm.push(sph.x, sph.y, sph.z);
    b.uvs.push(u0 + (a + 1) * 0.25, v0 + (c + 1) * 0.25);
    b.leaf.push(1);
    // intérieur et bas du houppier plus sombres (occlusion)
    const depth = Math.min(1, center.distanceTo(crown) / crownR);
    b.shade.push(0.55 + 0.35 * depth + 0.15 * Math.min(1, Math.max(0, (p.y - crown.y) / crownR + 0.5)));
  }
}

function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  g.setAttribute('leaf', new THREE.Float32BufferAttribute(b.leaf, 1));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(b.shade, 1));
  g.computeBoundingSphere();
  return g;
}

/** Buisson nominal de 1 m de haut, 0,9 m de rayon : bouquets de feuilles en dôme. */
export function shrubGeometry(): THREE.BufferGeometry {
  const r = rng(5);
  const b: Builder = { pos: [], nrm: [], uvs: [], leaf: [], shade: [] };
  const crown = new THREE.Vector3(0, 0.45, 0);
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.7;
    const c = new THREE.Vector3(Math.cos(a) * d, 0.2 + r() * 0.6, Math.sin(a) * d);
    card(b, c, 0.9 + r() * 0.4, crown, 0.9, r);
  }
  // bouquets plus fins (4e case de l'atlas) pour les buissons
  for (let i = 0; i < b.uvs.length; i += 2) {
    b.uvs[i] = 0.5 + ((b.uvs[i] as number) % 0.5);
    b.uvs[i + 1] = 0.5 + ((b.uvs[i + 1] as number) % 0.5);
  }
  return toGeometry(b);
}

export interface LeafColours {
  a: Node<'color'> | Node<'vec3'>;
  b: Node<'color'> | Node<'vec3'>;
  c: Node<'color'> | Node<'vec3'>;
  wind: Node<'float'>;
}

/** Matériau des buissons réels : cartes à alpha testé, teinte de saison par buisson, balancement au vent. */
export function shrubMaterial(c: LeafColours): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  m.alphaTest = 0.45;
  const leaf = attribute<'float'>('leaf');
  const shade = attribute<'float'>('shade');
  const raw = attribute<'vec3'>('position');
  const h = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(13));
  const y = raw.y.max(0);
  const gust = sin(time.mul(0.35).add(h.mul(6.28))).mul(0.5).add(0.5);
  const sway = sin(time.mul(float(1.2).add(h2.mul(0.5))).add(h.mul(40))).mul(c.wind).mul(y.mul(y).mul(0.001)).mul(gust.mul(0.6).add(0.4));
  const flutter = sin(time.mul(6).add(raw.x.mul(2.3)).add(raw.z.mul(1.7))).mul(0.05).mul(leaf).mul(c.wind);
  m.positionNode = positionLocal.add(vec3(sway.add(flutter), flutter.mul(0.5), sway.mul(0.6)));
  const tex = texture(getAtlas(), uv());
  const leafCol = mix(mix(c.a as Node<'vec3'>, c.b as Node<'vec3'>, smoothstep(0.2, 0.8, h)), c.c as Node<'vec3'>, smoothstep(0.7, 0.97, h2));
  // la texture module la teinte (≈ 0,6 en moyenne) ; ×1,5 pour garder la luminosité de la palette
  const foliage = leafCol.mul(tex.rgb).mul(1.5);
  const bark = color('#4d4237').mul(h2.mul(0.2).add(0.85));
  m.colorNode = mix(bark, foliage, leaf).mul(shade);
  m.opacityNode = mix(float(1), tex.a, leaf);
  m.roughnessNode = mix(float(0.95), float(0.8), leaf);
  m.metalnessNode = float(0);
  // Contre-jour : les feuilles s'illuminent quand le soleil est derrière elles.
  m.outputNode = backlitOutput(foliage as unknown as Vec3Node, leaf);
  return m;
}
