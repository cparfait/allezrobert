/**
 * Ressemblance (docs/AVATARS.md § 11), partie pure : forme du visage à partir des repères de
 * MediaPipe Face Landmarker, puis curseurs qui la reproduisent.
 *
 * Étalonnage (likenessCalib.json, tools/blender/avatars/likeness_calib.py) : le même détecteur
 * est passé sur des rendus de face de l'avatar (tête de base, chaque curseur à ± 0,8) ; on garde
 * la forme de base et la variation de la forme par curseur (J). Pour une photo : repères centrés,
 * mis à l'échelle (moyenne quadratique), tournés vers la forme de référence (Procuste, méthode de
 * Horn), symétrisés, un sur trois, puis régression ridge bornée : min ‖J s − (f − f₀)‖² + λ ‖s‖²,
 * avec des colonnes de pose (lacet, tangage) qui absorbent l'angle de vue de la photo.
 * La photo et l'avatar passent par la même chaîne de mesure : aucune correspondance de maillages
 * à entretenir.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface LikenessCalibration {
  step: number;
  count: number;
  lambda: number;
  sliders: string[];
  /** Forme de référence (468 repères normalisés, tête de base de face) : cible de l'alignement. */
  ref: number[];
  /** Homologue gauche / droite de chaque repère (symétrie). */
  pairs: number[];
  /** Forme de base symétrisée (x, y, z par repère retenu). */
  base: number[];
  /** Variation de la forme par unité de chaque curseur. */
  jacobian: number[][];
  /**
   * Variations dues à la pose de la tête (lacet, tangage, premier et second ordre) : ajustées en
   * même temps que les curseurs, presque sans régularisation, puis ignorées.
   */
  pose?: number[][];
}

/** Les 468 repères du visage (sans l'iris), centrés et ramenés à une moyenne quadratique unité. `aspect` = largeur / hauteur de l'image. */
export function normalizedShape(lm: readonly Landmark[], aspect: number): number[] {
  const pts: number[][] = [];
  for (let k = 0; k < 468; k++) {
    const l = lm[k] as Landmark;
    pts.push([l.x * aspect, l.y, l.z * aspect]);
  }
  const c = [0, 1, 2].map((d) => pts.reduce((s, p) => s + (p[d] as number), 0) / pts.length);
  let ss = 0;
  for (const p of pts) for (let d = 0; d < 3; d++) ss += ((p[d] as number) - (c[d] as number)) ** 2;
  const s = Math.sqrt(ss / pts.length) || 1;
  return pts.flatMap((p) => p.map((v, d) => (v - (c[d] as number)) / s));
}

/** Rotation de Procuste (sans réflexion) de `x` vers `ref` (formes centrées, même nombre de points). */
export function alignTo(x: readonly number[], ref: readonly number[]): number[] {
  // Matrice de covariance M = Σ xᵢ refᵢᵀ ; quaternion = vecteur propre dominant de la matrice N de Horn.
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < x.length; i += 3)
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a * 3 + b] = (M[a * 3 + b] as number) + (x[i + a] as number) * (ref[i + b] as number);
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = M as [number, number, number, number, number, number, number, number, number];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [w, qx, qy, qz] = dominantEigenvector(N);
  // Matrice de rotation du quaternion (appliquée aux vecteurs colonnes : x' = R x).
  const R = [
    [w * w + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - w * qz), 2 * (qx * qz + w * qy)],
    [2 * (qx * qy + w * qz), w * w - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - w * qx)],
    [2 * (qx * qz - w * qy), 2 * (qy * qz + w * qx), w * w - qx * qx - qy * qy + qz * qz],
  ];
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i += 3)
    for (let a = 0; a < 3; a++) out[i + a] = (R[a] as number[]).reduce((s, r, b) => s + r * (x[i + b] as number), 0);
  return out;
}

/** Vecteur propre de la plus grande valeur propre d'une matrice symétrique 4 × 4 (Jacobi). */
function dominantEigenvector(A0: number[][]): [number, number, number, number] {
  const A = A0.map((r) => [...r]);
  const V = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += ((A[p] as number[])[q] as number) ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        const apq = (A[p] as number[])[q] as number;
        if (Math.abs(apq) < 1e-15) continue;
        const theta = (((A[q] as number[])[q] as number) - ((A[p] as number[])[p] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = (A[k] as number[])[p] as number;
          const akq = (A[k] as number[])[q] as number;
          (A[k] as number[])[p] = c * akp - s * akq;
          (A[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = (A[p] as number[])[k] as number;
          const aqk = (A[q] as number[])[k] as number;
          (A[p] as number[])[k] = c * apk - s * aqk;
          (A[q] as number[])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = (V[k] as number[])[p] as number;
          const vkq = (V[k] as number[])[q] as number;
          (V[k] as number[])[p] = c * vkp - s * vkq;
          (V[k] as number[])[q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (((A[i] as number[])[i] as number) > ((A[best] as number[])[best] as number)) best = i;
  return [0, 1, 2, 3].map((k) => (V[k] as number[])[best] as number) as [number, number, number, number];
}

/**
 * Forme d'un visage dans le repère de l'étalonnage : alignée sur la référence, symétrisée (chaque
 * repère moyenné avec le miroir de son homologue), un repère sur `step`.
 */
export function shapeVector(lm: readonly Landmark[], cal: LikenessCalibration, aspect: number): number[] {
  const a = alignTo(normalizedShape(lm, aspect), cal.ref);
  const out: number[] = [];
  for (let k = 0; k < cal.count; k++) {
    const i = k * cal.step;
    const j = cal.pairs[i] ?? i;
    out.push(0.5 * ((a[i * 3] as number) - (a[j * 3] as number)), 0.5 * ((a[i * 3 + 1] as number) + (a[j * 3 + 1] as number)), 0.5 * ((a[i * 3 + 2] as number) + (a[j * 3 + 2] as number)));
  }
  return out;
}

/**
 * Repères du maillage que la retouche manuelle propose de placer (ui/landmarkEditor.ts) : yeux,
 * sourcils, nez, bouche, tempes, mâchoire, menton. Une fois validés par l'utilisateur, ce sont les
 * mesures les plus sûres de la photo ; le reste du maillage (barbe, cheveux, oreilles, lunettes)
 * est deviné par le détecteur.
 */
export const HANDLE_INDICES = [33, 133, 362, 263, 70, 107, 336, 300, 168, 1, 98, 327, 61, 291, 13, 14, 10, 234, 454, 172, 397, 152] as const;

/**
 * Curseurs plus difficiles à écarter de la tête de base : les volumes mous (joues, graisse) et les
 * traits que le détecteur devine sans appui sur les points posés (oreilles, cou). Sans cela,
 * l'ajustement obtient la largeur de mâchoire d'une barbe en gonflant les joues.
 */
export const STIFFNESS: Readonly<Record<string, number>> = { faceFat: 6, cheekVolume: 4, earSize: 3, earAngle: 4, neckWidth: 3, eyelidFold: 2 };

/** Poids d'un repère éloigné de tous les points posés à la main (1 = poids plein, au pied d'un point). */
const FAR_WEIGHT = 0.25;
/** Rayon d'influence d'un point posé, en part de la distance entre les yeux. */
const HANDLE_REACH = 0.3;

/**
 * Déplace le repère `h` de (dx, dy) normalisés ; les repères du maillage tout proches (en position
 * d'origine, gaussienne de portée `sigma`) suivent. Les autres points posés à la main ne bougent jamais.
 */
export function moveLandmark(orig: readonly Landmark[], cur: Landmark[], h: number, dx: number, dy: number, sigma: number): void {
  const o = orig[h] as Landmark;
  for (let i = 0; i < cur.length; i++) {
    if (i !== h && (HANDLE_INDICES as readonly number[]).includes(i)) continue;
    const d = Math.hypot((orig[i] as Landmark).x - o.x, (orig[i] as Landmark).y - o.y);
    const w = i === h ? 1 : Math.exp(-((d / sigma) ** 2));
    if (w < 0.01) continue;
    (cur[i] as Landmark).x += dx * w;
    (cur[i] as Landmark).y += dy * w;
  }
}

/** Part du poids du bas du visage retirée par une barbe pleine. */
const BEARD_CUT = 0.85;
/** Distance sous la lèvre (en part de la distance entre les yeux) à partir de laquelle le bas du visage compte pour de bon. */
const BELOW_LIP = 0.15;

interface HandleReach {
  /** Proximité (1 = au pied du point, → 0 au loin) du point posé le plus proche. */
  near: number[];
  /** 0 au niveau de la lèvre du bas ou au-dessus → 1 à `BELOW_LIP` en dessous (menton, mâchoire). */
  below: number[];
}

const reachCache = new WeakMap<LikenessCalibration, HandleReach>();

function handleReach(cal: LikenessCalibration): HandleReach {
  const hit = reachCache.get(cal);
  if (hit) return hit;
  const at = (i: number) => [cal.ref[i * 3] as number, cal.ref[i * 3 + 1] as number, cal.ref[i * 3 + 2] as number] as const;
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));
  const iod = dist(at(33), at(263)) || 0.4;
  const reach = iod * HANDLE_REACH;
  const lipY = at(14)[1];
  const out: HandleReach = { near: [], below: [] };
  for (let k = 0; k < cal.count; k++) {
    const p = at(k * cal.step);
    out.near.push(Math.exp(-((Math.min(...HANDLE_INDICES.map((h) => dist(p, at(h)))) / reach) ** 2)));
    out.below.push(Math.max(0, Math.min(1, (p[1] - lipY) / (iod * BELOW_LIP))));
  }
  reachCache.set(cal, out);
  return out;
}

/**
 * Poids de chaque repère retenu dans l'ajustement (moyenne 1) : fort au voisinage des points posés
 * à la main, faible ailleurs. Avec une barbe (0 → 1), tout ce qui est sous la lèvre du bas (menton,
 * mâchoire, points posés compris) perd l'essentiel de son poids : le contour de la barbe n'est pas
 * celui du visage. Calculé dans la forme de référence de l'étalonnage.
 */
export function pointWeights(cal: LikenessCalibration, beard = 0): number[] {
  const { near, below } = handleReach(cal);
  const cut = BEARD_CUT * Math.max(0, Math.min(1, beard));
  const w = near.map((o, k) => (FAR_WEIGHT + (1 - FAR_WEIGHT) * o) * (1 - cut * (below[k] as number)));
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return w.map((v) => v / mean);
}

/**
 * Curseurs (−1 → 1) qui reproduisent la forme `f` : régression ridge pondérée par repère (`weights`,
 * un par repère retenu ; uniforme par défaut), régularisation multipliée par `stiffness` pour certains
 * curseurs, curseurs saturés figés puis nouvelle résolution des autres.
 */
export function fitSliders(f: readonly number[], cal: LikenessCalibration, lambda = cal.lambda, weights?: readonly number[], stiffness?: Readonly<Record<string, number>>): Record<string, number> {
  const pose = cal.pose ?? [];
  const cols = [...cal.jacobian, ...pose];
  const reg = [...cal.sliders.map((n) => lambda * (stiffness?.[n] ?? 1)), ...pose.map(() => lambda * 1e-3)];
  const nS = cols.length;
  const r = cal.base.map((b, i) => (f[i] as number) - b);
  const wt = (i: number) => weights?.[Math.floor(i / 3)] ?? 1;
  const fixed = new Map<number, number>();
  const x = new Array<number>(nS).fill(0);
  for (let pass = 0; pass < 6; pass++) {
    const free = [...Array(nS).keys()].filter((k) => !fixed.has(k));
    const rr = r.map((ri, i) => {
      let v = ri;
      for (const [k, val] of fixed) v -= (cols[k]?.[i] ?? 0) * val;
      return v;
    });
    const n = free.length;
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const bvec = new Array<number>(n).fill(0);
    for (let a = 0; a < n; a++) {
      const ja = cols[free[a] as number] as number[];
      bvec[a] = ja.reduce((s, v, i) => s + wt(i) * v * (rr[i] as number), 0);
      for (let c = a; c < n; c++) {
        const jc = cols[free[c] as number] as number[];
        const s = ja.reduce((acc, v, i) => acc + wt(i) * v * (jc[i] as number), 0);
        (A[a] as number[])[c] = s;
        (A[c] as number[])[a] = s;
      }
      (A[a] as number[])[a] = ((A[a] as number[])[a] as number) + (reg[free[a] as number] as number);
    }
    const sol = solve(A, bvec);
    let clipped = false;
    free.forEach((k, j) => {
      const v = sol[j] as number;
      if (k >= cal.sliders.length) return; // pose : non bornée, non rendue
      if (Math.abs(v) > 1) {
        fixed.set(k, Math.sign(v));
        clipped = true;
      }
      x[k] = Math.max(-1, Math.min(1, v));
    });
    for (const [k, val] of fixed) x[k] = val;
    if (!clipped) break;
  }
  return Object.fromEntries(cal.sliders.map((s, k) => [s, Math.round((x[k] as number) * 100) / 100]));
}

/** Élimination de Gauss avec pivot partiel (systèmes symétriques définis positifs, n ≤ 50). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((M[r] as number[])[c] as number) > Math.abs((M[piv] as number[])[c] as number)) piv = r;
    [M[c], M[piv]] = [M[piv] as number[], M[c] as number[]];
    const d = (M[c] as number[])[c] as number;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = ((M[r] as number[])[c] as number) / d;
      if (!f) continue;
      for (let k = c; k <= n; k++) (M[r] as number[])[k] = ((M[r] as number[])[k] as number) - f * ((M[c] as number[])[k] as number);
    }
  }
  return M.map((row, i) => {
    const d = row[i] as number;
    return Math.abs(d) < 1e-12 ? 0 : (row[n] as number) / d;
  });
}

/**
 * Plafond de chaque curseur issu d'une photo : l'ajustement seul, sur des repères imparfaits (angle,
 * focale, expression), donnait des têtes énormes et déformées. Les curseurs du crâne et du volume
 * restent proches de la tête de base ; les traits (yeux, nez, bouche) gardent plus de liberté.
 */
const TAME_LIMIT: Record<string, number> = {
  headWidth: 0.3,
  headLength: 0.3,
  headDepth: 0.3,
  foreheadSlope: 0.4,
  earSize: 0.4,
  earAngle: 0.4,
  neckWidth: 0.4,
  faceFat: 0.45,
  cheekVolume: 0.45,
  jawWidth: 0.55,
  jawHeight: 0.55,
  chinHeight: 0.5,
  chinWidth: 0.5,
};
const TAME_DEFAULT = 0.7;
/** Part de l'écart à la tête de base conservée (1 = fidèle à l'ajustement). */
const TAME_SHRINK = 0.8;

export interface TameOptions {
  /** Part de l'écart à la tête de base conservée (1 = fidèle à l'ajustement). */
  shrink?: number;
  /** Multiplicateur des plafonds de TAME_LIMIT (et de TAME_DEFAULT), borné à 1. */
  limitScale?: number;
}

/** Curseurs ramenés vers la tête de base et plafonnés (voir TAME_LIMIT). */
export function tameSliders(face: Record<string, number>, { shrink = TAME_SHRINK, limitScale = 1 }: TameOptions = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(face)) {
    const lim = Math.min(1, (TAME_LIMIT[k] ?? TAME_DEFAULT) * limitScale);
    out[k] = Math.round(Math.max(-lim, Math.min(lim, v * shrink)) * 100) / 100;
  }
  return out;
}
