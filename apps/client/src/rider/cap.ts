import * as THREE from 'three/webgpu';
import type { CapLook } from '@allezrobert/shared';

/**
 * Casquette de cycliste : dôme souple à quartiers et petite visière un peu incurvée, dessous gris.
 * Le maillage est construit dans le repère du modèle (+z avant, +y haut, +x gauche), ajusté à la boîte
 * du casque du coureur, puis lié à 100 % à l'os de la tête (gltfAvatar.ts) : il suit la tête comme
 * le casque. Les motifs (uni, pois, losanges, quartiers) sont dessinés sur des canevas, partagés par
 * tous les coureurs de même casquette.
 */

/** Réglages de forme (fractions de la boîte du casque ; épaisseur de la visière en mètres). */
export const CAP_FIT = {
  /** Dôme : rayons relatifs à la demi-largeur et à la demi-profondeur du casque ; hauteur relative à sa demi-largeur (sangles exclues). */
  rx: 0.98,
  rz: 1.0,
  /** Dôme : exposant du profil (< 1 : épaules plus pleines, sommet plus plat). */
  fullness: 0.8,
  ry: 1.1,
  /** Dôme : relevé (m) pour que les cheveux ne percent pas au sommet. */
  lift: 0.006,
  /** Dôme : angle (degrés depuis le sommet) du bord, devant et derrière (nuque). */
  frontEdge: 88,
  backEdge: 110,
  /** Visière : longueur (× demi-largeur), inclinaison vers le bas (degrés) et épaisseur (m). */
  billLength: 0.95,
  billTilt: -24,
  billThickness: 0.003,
};

const DOME_COLS = 56;
const DOME_ROWS = 18;
const BILL_COLS = 20;
const BILL_ROWS = 6;
/** Angle (degrés) qui remplit le rayon du canevas du dôme (projection azimutale équidistante). */
const DOME_SPAN = 108;

const deg = THREE.MathUtils.degToRad;

/** Boîte (repère du modèle, pose de repos) d'un ensemble de maillages ; les maillages articulés passent par leurs os. */
export function boxOfMeshes(meshes: readonly THREE.Mesh[]): THREE.Box3 | null {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const skinned = m as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (skinned.isSkinnedMesh) skinned.applyBoneTransform(i, v);
      box.expandByPoint(v.applyMatrix4(m.matrixWorld));
    }
  }
  return box.isEmpty() ? null : box;
}

/**
 * Géométrie de la casquette pour la boîte `head` du casque (repère du modèle), exprimée dans l'espace
 * du maillage de référence (`toLocal` = inverse de sa matrice de liaison), tout pesé sur l'os `headBone`.
 * Groupes : 0 dôme, 1 dessus de la visière, 2 dessous.
 */
export function capGeometry(head: THREE.Box3, toLocal: THREE.Matrix4, headBone: number): THREE.BufferGeometry {
  const F = CAP_FIT;
  const cx = (head.min.x + head.max.x) / 2;
  const zc = (head.min.z + head.max.z) / 2;
  const W = (head.max.x - head.min.x) / 2;
  const D = (head.max.z - head.min.z) / 2;
  const rx = W * F.rx;
  const rz = D * F.rz;
  const ry = W * F.ry;
  const cy = head.max.y - ry + F.lift;
  const edge = (phi: number) => deg(F.frontEdge + ((F.backEdge - F.frontEdge) * (1 - Math.cos(phi))) / 2);

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const push = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(u, v);
  };

  // Dôme : ellipsoïde dont le bord descend plus bas derrière (nuque) que devant (front).
  // φ part de l'avant (+z) vers la gauche (+x) ; UV : projection azimutale du sommet.
  const span = deg(DOME_SPAN);
  for (let r = 0; r <= DOME_ROWS; r++) {
    for (let c = 0; c < DOME_COLS; c++) {
      const phi = (c / DOME_COLS) * Math.PI * 2;
      const th = (r / DOME_ROWS) * edge(phi);
      const s = Math.pow(Math.sin(th), F.fullness);
      const k = (th / span) * 0.5;
      push(
        new THREE.Vector3(cx + rx * s * Math.sin(phi), cy + ry * Math.cos(th), zc + rz * s * Math.cos(phi)),
        new THREE.Vector3((s * Math.sin(phi)) / rx, Math.cos(th) / ry, (s * Math.cos(phi)) / rz).normalize(),
        0.5 + k * 2 * Math.sin(phi) * 0.5,
        0.5 + k * 2 * Math.cos(phi) * 0.5,
      );
    }
  }
  for (let r = 0; r < DOME_ROWS; r++) {
    for (let c = 0; c < DOME_COLS; c++) {
      const a = r * DOME_COLS + c;
      const b = r * DOME_COLS + ((c + 1) % DOME_COLS);
      idx.push(a, a + DOME_COLS, b, b, a + DOME_COLS, b + DOME_COLS);
    }
  }
  const domeCount = idx.length;

  // Visière : demi-ellipse posée sur le bord avant du dôme, inclinée et courbée vers le bas.
  const thF = edge(0);
  const bw = Math.sin(deg(54));
  const length = W * F.billLength;
  const tilt = Math.tan(deg(F.billTilt));
  const grid = (lift: number, flip: boolean, group: number[]): void => {
    const base = pos.length / 3;
    for (let j = 0; j <= BILL_ROWS; j++) {
      for (let i = 0; i <= BILL_COLS; i++) {
        const s = (i / BILL_COLS) * 2 - 1;
        const t = j / BILL_ROWS;
        const phi = Math.asin(s * bw);
        const th = Math.min(edge(phi), thF);
        const bx = cx + rx * Math.sin(th) * Math.sin(phi);
        const by = cy + ry * Math.cos(th);
        const bz = zc + rz * Math.sin(th) * Math.cos(phi);
        const reach = length * Math.pow(Math.max(0, 1 - s * s), 0.6);
        const x = bx + s * 0.05 * W * t;
        const z = bz + reach * t;
        const y = by - tilt * reach * t - 0.12 * W * s * s * t * t + lift;
        push(new THREE.Vector3(x, y, z), new THREE.Vector3(0, flip ? -1 : 1, 0), (x - cx) / (2 * rx * bw) + 0.5, (1 - t) * (length / (2 * rx * bw)));
      }
    }
    for (let j = 0; j < BILL_ROWS; j++) {
      for (let i = 0; i < BILL_COLS; i++) {
        const a = base + j * (BILL_COLS + 1) + i;
        const b = a + 1;
        const c = a + BILL_COLS + 1;
        const d = c + 1;
        if (flip) group.push(a, b, c, b, d, c);
        else group.push(a, c, b, b, c, d);
      }
    }
  };
  const top: number[] = [];
  const under: number[] = [];
  grid(0, false, top);
  grid(-F.billThickness, true, under);
  idx.push(...top, ...under);

  // Normales : celles de l'ellipsoïde pour le dôme (pas de pincement au sommet), calculées pour la visière.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < (DOME_ROWS + 1) * DOME_COLS; i++) n.setXYZ(i, nor[i * 3] as number, nor[i * 3 + 1] as number, nor[i * 3 + 2] as number);
  // Repère du maillage de référence (matrice de liaison inverse), normales par la matrice normale.
  const nm = new THREE.Matrix3().getNormalMatrix(toLocal);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, ...v.fromBufferAttribute(p, i).applyMatrix4(toLocal).toArray());
    n.setXYZ(i, ...v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize().toArray());
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(p.count).fill(0).flatMap(() => [headBone, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(p.count).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
  g.addGroup(0, domeCount, 0);
  g.addGroup(domeCount, top.length, 1);
  g.addGroup(domeCount + top.length, under.length, 2);
  g.computeBoundingSphere();
  return g;
}

// ————————————————————————————————————————————— Motifs

const materialCache = new Map<string, THREE.Material[]>();

/** Matériaux (dôme, dessus et dessous de visière) d'une casquette ; partagés par les coureurs qui la portent. */
export function capMaterials(cap: CapLook): THREE.Material[] {
  const key = JSON.stringify(cap);
  let mats = materialCache.get(key);
  if (!mats) {
    const fabric = (map: THREE.Texture | null, color: string, side: THREE.Side): THREE.Material => {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0, side });
      m.name = 'cap';
      if (map) m.map = map;
      else m.color.set(color);
      return m;
    };
    const bill = billTexture(cap);
    mats = [fabric(domeTexture(cap), cap.color, THREE.DoubleSide), fabric(bill, cap.color, THREE.DoubleSide), fabric(bill, cap.color, THREE.DoubleSide)];
    materialCache.set(key, mats);
  }
  return mats;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Pois en quinconce de la couleur d'accent. */
function dots(g: CanvasRenderingContext2D, size: number, cap: CapLook, step: number, radius: number): void {
  g.fillStyle = cap.accent ?? '#e8501d';
  for (let j = -1; j * step < size + step; j++) {
    for (let i = -1; i * step < size + step; i++) {
      g.beginPath();
      g.arc(i * step + (j % 2 ? step / 2 : 0), j * step, radius, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Grands triangles aux couleurs de la casquette, sur une trame de rectangles inclinés. */
function triangles(g: CanvasRenderingContext2D, size: number, cap: CapLook): void {
  const cols = cap.colors?.length ? cap.colors : [cap.color];
  const w = size * 0.17;
  const h = size * 0.34;
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(deg(24));
  const n = Math.ceil(size / w) + 2;
  const m = Math.ceil(size / h) + 2;
  for (let j = -m; j <= m; j++) {
    for (let i = -n; i <= n; i++) {
      const x = i * w;
      const y = j * h;
      const pick = (k: number) => cols[(((i * 5 + j * 3 + k * 2) % cols.length) + cols.length) % cols.length] as string;
      g.fillStyle = pick(0);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y);
      g.lineTo(x, y + h);
      g.fill();
      g.fillStyle = pick(1);
      g.beginPath();
      g.moveTo(x + w, y);
      g.lineTo(x + w, y + h);
      g.lineTo(x, y + h);
      g.fill();
    }
  }
  g.restore();
}

/** Fond et motif d'une zone carrée (dôme ou visière). */
function pattern(g: CanvasRenderingContext2D, size: number, cap: CapLook, scale: number): void {
  g.fillStyle = cap.color;
  g.fillRect(0, 0, size, size);
  if (cap.style === 'pois') dots(g, size, cap, 118 * scale, 36 * scale);
  else if (cap.style === 'losanges') triangles(g, size, cap);
}

function domeTexture(cap: CapLook): THREE.Texture {
  return canvasTexture(1024, (g) => {
    const size = 1024;
    const R = size / 2;
    if (cap.style === 'panneaux') {
      // Quatre quartiers : devant, gauche, derrière, droite (angle depuis l'avant, vers la gauche).
      const cols = cap.colors?.length ? cap.colors : [cap.color];
      for (let q = 0; q < 4; q++) {
        g.fillStyle = cols[q % cols.length] as string;
        g.beginPath();
        g.moveTo(R, R);
        // Canevas : y vers le bas ; φ = 0 vers le haut du canevas.
        g.arc(R, R, R * 1.5, deg(-90 + q * 90 - 45), deg(-90 + q * 90 + 45));
        g.fill();
      }
    } else pattern(g, size, cap, 1);
    // Coutures des quartiers et bouton du sommet.
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 4;
    for (let q = 0; q < 4; q++) {
      const a = deg(-90 + q * 90 + 45);
      g.beginPath();
      g.moveTo(R, R);
      g.lineTo(R + Math.cos(a) * R * 1.5, R + Math.sin(a) * R * 1.5);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.arc(R, R, 14, 0, Math.PI * 2);
    g.fill();
  });
}

function billTexture(cap: CapLook): THREE.Texture {
  return canvasTexture(512, (g) => {
    if (cap.style === 'panneaux') {
      g.fillStyle = cap.accent ?? cap.color;
      g.fillRect(0, 0, 512, 512);
    } else pattern(g, 512, cap, 0.7);
  });
}
