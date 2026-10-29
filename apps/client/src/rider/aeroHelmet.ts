import * as THREE from 'three/webgpu';
import type { HelmetShape } from '@allezrobert/shared';

/**
 * Casques chrono choisis au garage (AvatarLook.helmetShape), en plus du casque route et du casque chrono
 * des vélos de chrono (modèle Blender) : coque lisse, intérieur en polystyrène, visière teintée (les
 * sangles sont celles du casque route). Comme la casquette (cap.ts), le maillage est construit dans le repère du modèle (+z avant,
 * +y haut, +x gauche), ajusté à la boîte du casque route du coureur, puis lié à 100 % à l'os de la tête.
 *  - « chrono » (type Ekoi TT1) : longue queue effilée qui prolonge le dos, visière du front au nez ;
 *  - « chrono-court » (type Kask Bambino, Giro Aerohead) : coque ronde et pleine qui couvre les oreilles,
 *    queue courte tronquée net, visière plus enveloppante.
 */

interface ShapeDef {
  /** Ellipsoïde de base : rayons relatifs à la demi-largeur (x, y) et à la demi-profondeur (z) du casque route. */
  rx: number;
  ry: number;
  rz: number;
  /** Centre : abaissement sous le sommet du casque route (× demi-largeur) et avancée (m). */
  drop: number;
  fwd: number;
  /** Sous l'équateur : exposant du rayon (< 1 : flancs plus droits, qui descendent sur les oreilles sans se refermer). */
  skirt: number;
  /** Bord de la coque (degrés depuis le sommet) devant, sur les côtés et derrière. */
  edgeFront: number;
  edgeSide: number;
  edgeBack: number;
  /** Queue : allongement (× rayon avant-arrière), effilement latéral et vertical, abaissement de la pointe (m). */
  tail: number;
  tailTaper: number;
  tailFlat: number;
  tailDrop: number;
  /** Troncature de la queue (m derrière le centre ; Infinity : pointe effilée). */
  cut: number;
  /** Visière : demi-ouverture (degrés), hauteur (m) et avancée devant le visage au bas (m). */
  visorSpan: number;
  visorHeight: number;
  visorOut: number;
}

const SHAPES: Record<HelmetShape, ShapeDef> = {
  chrono: {
    rx: 1.0, ry: 1.12, rz: 0.94, drop: 1.12, fwd: 0.004, skirt: 0.45,
    edgeFront: 82, edgeSide: 128, edgeBack: 112,
    tail: 1.0, tailTaper: 0.74, tailFlat: 0.6, tailDrop: 0.07,
    cut: Infinity,
    visorSpan: 68, visorHeight: 0.07, visorOut: 0.014,
  },
  'chrono-court': {
    rx: 1.06, ry: 1.16, rz: 1.0, drop: 1.12, fwd: 0.002, skirt: 0.35,
    edgeFront: 84, edgeSide: 134, edgeBack: 118,
    tail: 0.42, tailTaper: 0.3, tailFlat: 0.2, tailDrop: 0.01,
    cut: 0.155,
    visorSpan: 80, visorHeight: 0.074, visorOut: 0.016,
  },
};

/** Épaisseur de la coque (polystyrène visible au bord) et de la visière (m). */
const SHELL = 0.016;
const VISOR = 0.0025;
/** Subdivisions : coque (tour, sommet → bord) et visière ; le style jeu vidéo en prend moins (facettes). */
export interface HelmetDetail {
  cols: number;
  rows: number;
  visorCols: number;
  visorRows: number;
  /** Queue rabattue vers le bas (rad) : têtes inclinées vers l'avant (style jeu vidéo), pointe qui suit le dos. */
  tailPitch?: number;
}
export const HELMET_FINE: HelmetDetail = { cols: 64, rows: 22, visorCols: 24, visorRows: 6 };
export const HELMET_FACETED: HelmetDetail = { cols: 20, rows: 7, visorCols: 6, visorRows: 1, tailPitch: 0.3 };

const deg = THREE.MathUtils.degToRad;
const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Groupes de la géométrie : coque (couleur du casque), intérieur et bord (sombres), visière. */
export const AERO_HELMET_GROUPS = ['helmet', 'helmet_detail', 'visor'] as const;

/**
 * Géométrie d'un casque chrono pour la boîte `head` du casque route (repère du modèle), exprimée dans
 * l'espace du maillage de référence (`toLocal`), tout pesée sur l'os `headBone`. Groupes : 0 coque,
 * 1 intérieur et bord, 2 visière.
 */
export function aeroHelmetGeometry(shape: HelmetShape, head: THREE.Box3, toLocal: THREE.Matrix4, headBone: number, detail: HelmetDetail = HELMET_FINE): THREE.BufferGeometry {
  const S = SHAPES[shape];
  const { cols, rows, visorCols: vcols, visorRows: vrows } = detail;
  const W = (head.max.x - head.min.x) / 2;
  const D = (head.max.z - head.min.z) / 2;
  const rx = W * S.rx;
  const ry = W * S.ry;
  const rz = D * S.rz;
  const C = new THREE.Vector3((head.min.x + head.max.x) / 2, head.max.y - W * S.drop, (head.min.z + head.max.z) / 2 + S.fwd);
  // Bord : φ part de l'avant (+z) vers la gauche (+x) ; interpolation devant / côté / derrière en cos φ.
  const edge = (phi: number): number => {
    const c = Math.cos(phi);
    const side = S.edgeSide;
    return deg(side + ((S.edgeFront - S.edgeBack) / 2) * c + ((S.edgeFront + S.edgeBack) / 2 - side) * c * c);
  };

  /** Point de la coque (extérieur, ou intérieur décalé de `inset` vers le centre) pour φ et l'angle depuis le sommet. */
  const shellPoint = (phi: number, th: number, inset: number, out: THREE.Vector3): THREE.Vector3 => {
    // Sous l'équateur, flancs presque verticaux : le rayon diminue moins vite que sin θ.
    const s = th > Math.PI / 2 ? Math.pow(Math.sin(th), S.skirt) : Math.sin(th);
    let lat = (rx - inset) * s * Math.sin(phi);
    let up = (ry - inset) * Math.cos(th);
    let fw = (rz - inset) * s * Math.cos(phi);
    // Queue : la moitié arrière s'étire, s'effile et s'abaisse vers sa pointe.
    const k = smooth(0.05, 1, -fw / rz);
    if (k > 0) {
      fw -= S.tail * rz * Math.pow(k, 1.3);
      lat *= 1 - S.tailTaper * Math.pow(k, 1.2);
      up = up * (1 - S.tailFlat * k) - S.tailDrop * Math.pow(k, 1.5);
      const a = (detail.tailPitch ?? 0) * k;
      if (a) [fw, up] = [fw * Math.cos(a) - up * Math.sin(a), up * Math.cos(a) + fw * Math.sin(a)];
      // Queue tronquée : l'arrière s'aplatit en une face presque verticale.
      if (Number.isFinite(S.cut)) {
        const lim = -(S.cut - inset);
        if (fw < lim + 0.012) fw = lim + 0.012 * Math.exp((fw - lim - 0.012) / 0.012);
      }
    }
    return out.set(C.x + lat, C.y + up, C.z + fw);
  };

  const pos: number[] = [];
  const idx: number[] = [];
  const groups: Array<[number, number]> = [];
  const v = new THREE.Vector3();
  const push = (p: THREE.Vector3): number => {
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const group = (from: number, mat: number) => groups.push([from, mat]);

  // Coque et intérieur : grilles (sommet → bord) × (tour complet), refermées sur φ.
  const surface = (inset: number, flip: boolean): number => {
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        const phi = (c / cols) * Math.PI * 2;
        // Rangées plus serrées vers le bord (la queue s'y dessine).
        const t = r / rows;
        push(shellPoint(phi, (1 - (1 - t) * (1 - t) * 0.35 - 0.65 * (1 - t)) * edge(phi) * (r === 0 ? 0 : 1), inset, v));
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * cols + c;
        const b = base + r * cols + ((c + 1) % cols);
        if (flip) idx.push(a, b, a + cols, b, b + cols, a + cols);
        else idx.push(a, a + cols, b, b, a + cols, b + cols);
      }
    }
    return base;
  };
  group(idx.length, 0);
  const outer = surface(0, false);
  group(idx.length, 1);
  const inner = surface(SHELL, true);
  // Bord : bande entre le dernier rang extérieur et le dernier rang intérieur (sommets propres : arête vive).
  {
    const base = pos.length / 3;
    for (let c = 0; c < cols; c++) {
      v.fromArray(pos, (outer + rows * cols + c) * 3);
      push(v);
      v.fromArray(pos, (inner + rows * cols + c) * 3);
      push(v);
    }
    for (let c = 0; c < cols; c++) {
      const a = base + c * 2;
      const b = base + ((c + 1) % cols) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // Visière : du bord avant de la coque vers le bas, galbée, un peu rentrée vers le visage en bas.
  group(idx.length, 2);
  {
    const span = deg(S.visorSpan);
    for (const [off, flip] of [[0, false], [VISOR, true]] as const) {
      const base = pos.length / 3;
      for (let j = 0; j <= vrows; j++) {
        const t = j / vrows;
        for (let i = 0; i <= vcols; i++) {
          const phi = -span + (2 * span * i) / vcols;
          // Haut de la visière : sous le bord avant, devant la coque (aimantée sur sa lèvre).
          const top = shellPoint(phi, Math.min(edge(phi), deg(S.edgeFront)) - deg(2), -0.003 - off, v);
          const side = Math.abs(phi) / span;
          // Coins arrondis : la visière remonte un peu vers ses bords.
          const h = S.visorHeight * (1 - 0.35 * Math.pow(side, 3));
          // Galbe : le bas s'avance devant le nez (moins sur les côtés, qui reviennent vers les joues).
          const out = S.visorOut * Math.sin((Math.PI / 2) * t) * (1 - 0.6 * side * side);
          const nx = Math.sin(phi);
          const nz = Math.cos(phi);
          push(new THREE.Vector3(top.x + nx * out, top.y - h * t, top.z + nz * out));
        }
      }
      for (let j = 0; j < vrows; j++) {
        for (let i = 0; i < vcols; i++) {
          const a = base + j * (vcols + 1) + i;
          const b = a + 1;
          const c = a + vcols + 1;
          const d = c + 1;
          if (flip) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Sommet (rang 0, sommets confondus) : normale verticale.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let c = 0; c < cols; c++) {
    n.setXYZ(outer + c, 0, 1, 0);
    n.setXYZ(inner + c, 0, -1, 0);
  }
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const nm = new THREE.Matrix3().getNormalMatrix(toLocal);
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, ...v.fromBufferAttribute(p, i).applyMatrix4(toLocal).toArray());
    n.setXYZ(i, ...v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize().toArray());
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(p.count).fill(0).flatMap(() => [headBone, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(p.count).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
  groups.forEach(([from, mat], i) => g.addGroup(from, (groups[i + 1]?.[0] ?? idx.length) - from, mat));
  g.computeBoundingSphere();
  return g;
}
