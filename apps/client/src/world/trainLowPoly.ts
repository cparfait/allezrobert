import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Voiture de train en style jeu vidéo (low poly) : caisse à pans coupés, bandeau de vitres sombre, bande
 * de livrée colorée, toit gris, bogies ; la voiture de tête (et celle de queue) a un nez biseauté avec
 * pare-brise et phares. Couleurs par sommet (aplats, une facette = une couleur) : un appel de dessin
 * par voiture, ≈ 150 triangles. Repère : +z vers l'avant, y = 0 au niveau du rail.
 */
export type CarEnd = 'mid' | 'head' | 'tail';

/** Livrées : couleur de la bande et du nez. */
export const LIVERIES = ['#e0312b', '#1f5fc8', '#2a9d5a', '#f08a24'];

const BODY = '#f3f3ee';
const GLASS = '#1d2a3c';
const DARK = '#2b2d31';
const ROOF = '#9aa1a8';
const LAMP = '#fff3b0';

/** Demi-profil de la caisse (x, y), du bas vers le haut côté droit ; symétrique en x. */
const W = 1.45;
const Y0 = 0.9;
const PROFILE: Array<[number, number]> = [
  [-W, Y0],
  [W, Y0],
  [W, 3.45],
  [W - 0.4, 4.0],
  [-W + 0.4, 4.0],
  [-W, 3.45],
];

function painted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  const c = new THREE.Color(hex);
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => painted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

/**
 * Nez biseauté collé à la face avant (z = `z0`), long de `len`, tourné vers `dir` (+1 avant, −1 arrière) :
 * le profil de la caisse rétrécit et s'abaisse vers l'avant ; faces hautes en pare-brise sombre.
 */
function nose(z0: number, len: number, dir: 1 | -1, livery: string): THREE.BufferGeometry[] {
  const front = PROFILE.map(([x, y]): [number, number] => [x * 0.82, y > 3 ? Y0 + (y - Y0) * 0.62 : y]);
  const z1 = z0 + dir * len;
  const out: THREE.BufferGeometry[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hex: string) => {
    // a, b sur la face arrière (caisse), c, d à l'avant ; triangles tournés vers l'extérieur selon `dir`.
    const pts = dir > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    out.push(painted(g, hex));
  };
  const n = PROFILE.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay] = PROFILE[i] as [number, number];
    const [bx, by] = PROFILE[j] as [number, number];
    const [cx, cy] = front[j] as [number, number];
    const [dx, dy] = front[i] as [number, number];
    // 0 : dessous ; 1 et 5 : flancs ; 2, 3, 4 : pare-brise et ses montants
    const hex = i === 0 ? DARK : i === 1 || i === 5 ? BODY : GLASS;
    quad(new THREE.Vector3(ax, ay, z0), new THREE.Vector3(bx, by, z0), new THREE.Vector3(cx, cy, z1), new THREE.Vector3(dx, dy, z1), hex);
  }
  // Face avant : polygone convexe en éventail, à la couleur de la livrée.
  const cap: number[] = [];
  for (let k = 1; k + 1 < n; k++) {
    const tri = [front[0], front[k], front[k + 1]] as Array<[number, number]>;
    for (const [x, y] of dir > 0 ? tri : [tri[0], tri[2], tri[1]] as Array<[number, number]>) cap.push(x, y, z1);
  }
  const capG = new THREE.BufferGeometry();
  capG.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
  out.push(painted(capG, livery));
  // Phares
  for (const sx of [-0.75, 0.75]) out.push(box(0.36, 0.2, 0.08, sx, 1.45, z1 + dir * 0.03, LAMP));
  return out;
}

/** Caisse extrudée le long de z (de −len/2 à +len/2). */
function body(len: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(...(PROFILE[0] as [number, number]));
  for (let i = 1; i < PROFILE.length; i++) shape.lineTo(...(PROFILE[i] as [number, number]));
  shape.closePath();
  return painted(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -len / 2), BODY);
}

/** Géométrie d'une voiture (couleurs par sommet). */
export function lowPolyCarGeometry(len: number, end: CarEnd, livery: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    body(len),
    // bandeau de vitres (sombre) et bande de livrée, légèrement en saillie sur les flancs
    box(2 * W + 0.04, 0.75, len - 2.6, 0, 2.75, 0, GLASS),
    box(2 * W + 0.03, 0.38, len + 0.02, 0, 1.55, 0, livery),
    // toit et bogies
    box(2 * W - 0.9, 0.16, len - 4, 0, 4.08, 0, ROOF),
    box(2.3, 0.7, 3, 0, 0.45, -len / 2 + 3, DARK),
    box(2.3, 0.7, 3, 0, 0.45, len / 2 - 3, DARK),
  ];
  if (end === 'head') parts.push(...nose(len / 2, 2.2, 1, livery));
  if (end === 'tail') parts.push(...nose(-len / 2, 2.2, -1, livery));
  return mergeGeometries(parts) as THREE.BufferGeometry;
}
