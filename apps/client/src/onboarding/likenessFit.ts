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
 * Curseurs (−1 → 1) qui reproduisent la forme `f` : régression ridge, curseurs saturés figés
 * puis nouvelle résolution des autres.
 */
export function fitSliders(f: readonly number[], cal: LikenessCalibration, lambda = cal.lambda): Record<string, number> {
  const pose = cal.pose ?? [];
  const cols = [...cal.jacobian, ...pose];
  const reg = [...cal.jacobian.map(() => lambda), ...pose.map(() => lambda * 1e-3)];
  const nS = cols.length;
  const r = cal.base.map((b, i) => (f[i] as number) - b);
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
      bvec[a] = ja.reduce((s, v, i) => s + v * (rr[i] as number), 0);
      for (let c = a; c < n; c++) {
        const jc = cols[free[c] as number] as number[];
        const s = ja.reduce((acc, v, i) => acc + v * (jc[i] as number), 0);
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
