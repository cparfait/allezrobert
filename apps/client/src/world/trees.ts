import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, mix, instanceIndex, hash, color, smoothstep, texture, uv, step } from 'three/tsl';
import { rng } from '../engine/noise.ts';
import type { Node } from 'three/webgpu';

/**
 * Arbres et buissons « réels » (tuiles enrichies au LiDAR HD) : tronc, branches maîtresses et
 * cartes de feuillage (texture de feuilles dessinée à l'exécution, sans asset). Modèle nominal
 * de TREE_H m de haut et TREE_R m de rayon de houppier, mis à l'échelle de chaque arbre mesuré.
 */
export const TREE_H = 10;
export const TREE_R = 4;

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

function cylinder(b: Builder, a: THREE.Vector3, c: THREE.Vector3, ra: number, rc: number, sides: number): void {
  const axis = new THREE.Vector3().subVectors(c, a);
  const len = axis.length();
  axis.normalize();
  const t1 = new THREE.Vector3(axis.y, -axis.x, 0);
  if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(axis, t1).normalize();
  const ring = (center: THREE.Vector3, rad: number, k: number) => {
    const ang = (k / sides) * Math.PI * 2;
    const n = t1.clone().multiplyScalar(Math.cos(ang)).add(t2.clone().multiplyScalar(Math.sin(ang)));
    return { p: center.clone().add(n.clone().multiplyScalar(rad)), n };
  };
  for (let k = 0; k < sides; k++) {
    const p0 = ring(a, ra, k);
    const p1 = ring(a, ra, k + 1);
    const q0 = ring(c, rc, k);
    const q1 = ring(c, rc, k + 1);
    for (const v of [p0, p1, q0, p1, q1, q0]) {
      b.pos.push(v.p.x, v.p.y, v.p.z);
      b.nrm.push(v.n.x, v.n.y, v.n.z);
      // l'écorce pointe sur un coin opaque de l'atlas (non utilisé : alpha forcé à 1 pour le bois)
      b.uvs.push(0.25, 0.25);
      b.leaf.push(0);
      b.shade.push(0.85 + 0.15 * (v.p.y / TREE_H));
    }
  }
  void len;
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

/**
 * Feuillu nominal (TREE_H × TREE_R) : tronc, 7 à 9 branches maîtresses vers la surface du
 * houppier, rameaux, ~70 cartes de feuillage réparties dans la coquille du houppier.
 */
export function broadleafGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const b: Builder = { pos: [], nrm: [], uvs: [], leaf: [], shade: [] };
  const crown = new THREE.Vector3(0, TREE_H * 0.62, 0);
  const crY = TREE_H * 0.36; // demi-hauteur du houppier
  const forkY = TREE_H * (0.32 + r() * 0.1);
  cylinder(b, new THREE.Vector3(0, -0.3, 0), new THREE.Vector3((r() - 0.5) * 0.3, forkY, (r() - 0.5) * 0.3), 0.3, 0.2, 7);
  const fork = new THREE.Vector3(0, forkY, 0);
  const tips: THREE.Vector3[] = [];
  const nb = 7 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r() * 0.6;
    const up = 0.25 + r() * 0.7;
    const dir = new THREE.Vector3(Math.cos(a) * (1 - up * 0.6), up, Math.sin(a) * (1 - up * 0.6)).normalize();
    const tip = crown.clone().add(new THREE.Vector3(dir.x * TREE_R * 0.8, (dir.y - 0.35) * crY * 1.3, dir.z * TREE_R * 0.8));
    const start = fork.clone().add(new THREE.Vector3(0, r() * 1.2, 0));
    const mid = start.clone().lerp(tip, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.8, 0.4, (r() - 0.5) * 0.8));
    cylinder(b, start, mid, 0.13, 0.08, 5);
    cylinder(b, mid, tip, 0.08, 0.03, 4);
    tips.push(tip, mid);
    // rameaux
    for (let k = 0; k < 2; k++) {
      const from = start.clone().lerp(tip, 0.55 + r() * 0.35);
      const to = from.clone().add(new THREE.Vector3((r() - 0.5) * 2.2, 0.6 + r() * 1.2, (r() - 0.5) * 2.2));
      cylinder(b, from, to, 0.04, 0.015, 3);
      tips.push(to);
    }
  }
  // cartes : autour des extrémités de branches et dans la coquille du houppier
  const cards = 72;
  for (let k = 0; k < cards; k++) {
    let c: THREE.Vector3;
    if (k < tips.length) c = (tips[k] as THREE.Vector3).clone().add(new THREE.Vector3((r() - 0.5) * 1.2, (r() - 0.3) * 1.0, (r() - 0.5) * 1.2));
    else {
      const a = r() * Math.PI * 2;
      const el = Math.asin(r() * 1.6 - 0.6);
      const sh = 0.55 + 0.45 * Math.sqrt(r());
      c = crown.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(el) * TREE_R * sh, Math.sin(el) * crY * sh, Math.sin(a) * Math.cos(el) * TREE_R * sh));
    }
    card(b, c, 2.0 + r() * 1.1, crown, TREE_R, r);
  }
  return toGeometry(b);
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
  /** 1 = feuillage, 0 = hiver (feuillus nus). */
  amount: Node<'float'>;
  wind: Node<'float'>;
}

/**
 * Matériau des arbres réels : cartes à alpha testé, teinte de saison par arbre, balancement au
 * vent. `deciduous` : le feuillage disparaît l'hiver (les branches restent).
 */
export function realTreeMaterial(c: LeafColours, deciduous: boolean): THREE.MeshStandardNodeMaterial {
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
  const present = deciduous ? step(float(0.5), c.amount) : float(1);
  m.opacityNode = mix(float(1), tex.a.mul(present), leaf);
  m.roughnessNode = mix(float(0.95), float(0.8), leaf);
  m.metalnessNode = float(0);
  return m;
}

/** Variantes de feuillus réels (géométries partagées). */
export function broadleafVariants(): THREE.BufferGeometry[] {
  return [11, 23, 37].map(broadleafGeometry);
}
