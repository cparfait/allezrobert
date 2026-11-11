/**
 * Volumes de toit d'un bâtiment depuis le MNS LiDAR HD (raster 0,5 m de lidar.ts), pour les corrections
 * visuelles v3 (`kind: "volumes"`). Méthode (ZONES-BAT-4a, portée de Python) :
 * 1. pixels du MNS dans l'emprise, trous comblés par le plus proche voisin ;
 * 2. plans de toit par croissance de région depuis les plans locaux les plus réguliers ;
 * 3. fusion des régions voisines qu'un même plan explique, rattachement des petits plans (noues, raccords) ;
 * 4. deux plans voisins de pentes opposées qui se rejoignent à leur point haut → deux pans ; sinon monopente,
 *    ou toit plat sous 3° ;
 * 5. contour de chaque volume suivi sur les bords de pixels, simplifié (Douglas-Peucker), resté simple.
 * Les ajustements se font en coordonnées centrées : en Lambert-93 brut, les moindres carrés perdent le cm.
 * Repère de sortie : celui des tuiles (x = E − origine.x, z = origine.y − N), relatif au premier sommet.
 */
import type { VolumePart } from '@allezrobert/shared/building-visual';
import type { Raster } from './lidar.ts';

export interface VolumesOptions {
  /** Écart admis entre un pixel et le plan de sa région pendant la croissance (m). */
  tol?: number;
  /** Écart quadratique maximal d'un plan commun pour fusionner deux régions (m). */
  mergeRms?: number;
  /** Aire en dessous de laquelle un plan est rattaché à ses voisins (m²). */
  minPlaneM2?: number;
  /** Tolérance de simplification des contours (m). */
  simplifyM?: number;
  /** Écart quadratique maximal d'un volume à ses pixels : au-delà, aucun découpage n'est proposé (m). */
  maxVolumeRms?: number;
}

export interface VolumesResult {
  parts: VolumePart[];
  planes: number;
  /** Écart quadratique moyen des pixels à leur toit (m), global et par volume. */
  rms: number;
  volumeRms: number[];
}

type Sums = Float64Array; // n, Σx, Σy, Σxx, Σxy, Σyy, Σz, Σxz, Σyz, Σzz

function add(s: Sums, x: number, y: number, z: number, k = 1): void {
  s[0]! += k; s[1]! += k * x; s[2]! += k * y; s[3]! += k * x * x; s[4]! += k * x * y; s[5]! += k * y * y;
  s[6]! += k * z; s[7]! += k * x * z; s[8]! += k * y * z; s[9]! += k * z * z;
}

/** Plan z = a + b·x + c·y aux moindres carrés (système normal 3 × 3), et son écart quadratique moyen. */
function solve(s: Sums): { a: number; b: number; c: number; rms: number } | null {
  const [n, sx, sy, sxx, sxy, syy, sz, sxz, syz, szz] = s as unknown as number[];
  const m = [[n!, sx!, sy!], [sx!, sxx!, sxy!], [sy!, sxy!, syy!]];
  const r = [sz!, sxz!, syz!];
  const det = (q: number[][]) => q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) - q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) + q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const d = det(m);
  if (!(Math.abs(d) > 1e-9) || n! < 3) return null;
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i]! : v)));
  const a = det(col(0)) / d, b = det(col(1)) / d, c = det(col(2)) / d;
  const sse = szz! - 2 * (a * sz! + b * sxz! + c * syz!) + a * a * n! + 2 * a * b * sx! + 2 * a * c * sy! + b * b * sxx! + 2 * b * c * sxy! + c * c * syy!;
  return { a, b, c, rms: Math.sqrt(Math.max(sse, 0) / n!) };
}

function inRing(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function edgeDist(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}

function ringArea(r: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function simple(r: ReadonlyArray<readonly [number, number]>): boolean {
  const n = r.length;
  const cr = (a: readonly number[], b: readonly number[], c: readonly number[]) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = r[i]!, b = r[(i + 1) % n]!, c = r[j]!, d = r[(j + 1) % n]!;
      const d1 = cr(a, b, c), d2 = cr(a, b, d), d3 = cr(c, d, a), d4 = cr(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
    }
  return true;
}

/** Douglas-Peucker sur un anneau fermé (ancres : les deux sommets les plus éloignés). */
function simplify(r: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (r.length <= 4 || eps <= 0) return r;
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < r.length; i++) {
    const d = Math.hypot(r[i]![0] - r[0]![0], r[i]![1] - r[0]![1]);
    if (d > best) { best = d; i1 = i; }
  }
  const dp = (pts: Array<[number, number]>): Array<[number, number]> => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let k = -1, dm = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!, d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
      if (d > dm) { dm = d; k = i; }
    }
    if (dm <= eps) return [a, b];
    const l = dp(pts.slice(0, k + 1)), rr = dp(pts.slice(k));
    return [...l.slice(0, -1), ...rr];
  };
  const one = dp(r.slice(i0, i1 + 1)), two = dp([...r.slice(i1), r[0]!]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/**
 * `ring` : emprise en Lambert-93 (même ordre que les `pts` de la tuile). Retourne null si le MNS couvre mal
 * l'emprise, si une seule région ne s'en dégage pas, ou si aucun découpage ne respecte les règles v3.
 */
export function segmentRoofVolumes(mns: Raster, ring: ReadonlyArray<readonly [number, number]>, origin: { x: number; y: number }, opts: VolumesOptions = {}): VolumesResult | null {
  const tol = opts.tol ?? 0.15, mergeRms = opts.mergeRms ?? 0.08, minPlane = opts.minPlaneM2 ?? 6, eps0 = opts.simplifyM ?? 0.4, maxVolumeRms = opts.maxVolumeRms ?? 0.4;
  const R = mns.res;
  let eMin = Infinity, eMax = -Infinity, nMin = Infinity, nMax = -Infinity;
  for (const [e, n] of ring) { eMin = Math.min(eMin, e); eMax = Math.max(eMax, e); nMin = Math.min(nMin, n); nMax = Math.max(nMax, n); }
  // Grille locale alignée sur les pixels du MNS, une marge d'un pixel.
  const i0 = Math.floor((eMin - mns.e0) / R) - 1, i1 = Math.ceil((eMax - mns.e0) / R) + 1;
  const j0 = Math.floor((mns.n0 - nMax) / R) - 1, j1 = Math.ceil((mns.n0 - nMin) / R) + 1;
  const W = i1 - i0, H = j1 - j0;
  if (W <= 2 || H <= 2 || i0 < 0 || j0 < 0 || i1 > mns.w || j1 > mns.h) return null;
  const ce = (i: number) => mns.e0 + (i0 + i + 0.5) * R, cn = (j: number) => mns.n0 - (j0 + j + 0.5) * R;
  const ec = (eMin + eMax) / 2, nc = (nMin + nMax) / 2;
  const X = (i: number) => ce(i) - ec, Y = (j: number) => cn(j) - nc; // coordonnées centrées
  const inside = new Uint8Array(W * H), measured = new Uint8Array(W * H), h = new Float64Array(W * H).fill(NaN);
  let count = 0, known = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (!inRing(ce(i), cn(j), ring)) continue;
      inside[j * W + i] = 1; count++;
      // Pixels à moins de 0,6 m d'un mur : le MNS y mélange débord, gouttière et sol ; comblés depuis l'intérieur.
      if (edgeDist(ce(i), cn(j), ring) < 0.6) continue;
      const z = mns.data[(j0 + j) * mns.w + (i0 + i)]!;
      if (Number.isFinite(z)) { h[j * W + i] = z; measured[j * W + i] = 1; known++; }
    }
  if (count < 24 || known < count * 0.4) return null;
  // Trous : plus proche voisin connu (parcours en largeur).
  const q: number[] = [];
  for (let k = 0; k < W * H; k++) if (inside[k] && Number.isFinite(h[k]!)) q.push(k);
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi]!, i = k % W, j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ii = i + di, jj = j + dj, kk = jj * W + ii;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H && inside[kk] && !Number.isFinite(h[kk]!)) { h[kk] = h[k]!; q.push(kk); }
    }
  }
  const nbrs = (k: number): number[] => {
    const i = k % W, j = (k - i) / W, out: number[] = [];
    if (i > 0) out.push(k - 1); if (i < W - 1) out.push(k + 1); if (j > 0) out.push(k - W); if (j < H - 1) out.push(k + W);
    return out.filter((kk) => inside[kk]);
  };
  const at = (p: { a: number; b: number; c: number }, k: number) => { const i = k % W, j = (k - i) / W; return p.a + p.b * X(i) + p.c * Y(j); };
  // Plans locaux 3 × 3 (1,5 m) pour ordonner les germes.
  const local = new Map<number, { a: number; b: number; c: number; rms: number }>();
  for (let k = 0; k < W * H; k++) {
    if (!inside[k]) continue;
    const i = k % W, j = (k - i) / W, s = new Float64Array(10);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H && measured[jj * W + ii]) add(s, X(ii), Y(jj), h[jj * W + ii]!);
    }
    if (s[0]! < 6) continue;
    const p = solve(s);
    if (p) local.set(k, p);
  }
  const lab = new Int32Array(W * H);
  let nLab = 0;
  for (const k of [...local.keys()].sort((a, b) => local.get(a)!.rms - local.get(b)!.rms)) {
    if (lab[k] || local.get(k)!.rms > 0.08) continue;
    nLab++;
    let p = local.get(k)!;
    const s = new Float64Array(10);
    const grow = [k];
    lab[k] = nLab; if (measured[k]) add(s, X(k % W), Y((k - (k % W)) / W), h[k]!);
    let refit = 12;
    for (let g = 0; g < grow.length; g++) {
      for (const kk of nbrs(grow[g]!)) {
        if (lab[kk] || Math.abs(at(p, kk) - h[kk]!) >= tol) continue;
        lab[kk] = nLab; grow.push(kk);
        if (measured[kk]) add(s, X(kk % W), Y((kk - (kk % W)) / W), h[kk]!);
        if (grow.length >= refit) { p = solve(s) ?? p; refit = Math.ceil(grow.length * 1.3); }
      }
    }
  }
  const sumsOf = () => {
    const m = new Map<number, Sums>();
    for (let k = 0; k < W * H; k++) {
      const l = lab[k]!;
      if (!l) continue;
      if (!m.has(l)) m.set(l, new Float64Array(10));
      // Les pixels comblés portent une étiquette mais n'entrent pas dans les plans (ils les aplatiraient).
      if (measured[k]) add(m.get(l)!, X(k % W), Y((k - (k % W)) / W), h[k]!);
    }
    return m;
  };
  // Pixels orphelins → région voisine qui les explique le mieux.
  const attach = (allowed: Set<number>, planes: Map<number, { a: number; b: number; c: number }>) => {
    for (let pass = 0; pass < 200; pass++) {
      let changed = false, left = false;
      for (let k = 0; k < W * H; k++) {
        if (!inside[k] || allowed.has(lab[k]!)) continue;
        const cand = nbrs(k).map((kk) => lab[kk]!).filter((l) => allowed.has(l));
        if (!cand.length) { left = true; continue; }
        lab[k] = cand.reduce((b, l) => (Math.abs(at(planes.get(l)!, k) - h[k]!) < Math.abs(at(planes.get(b)!, k) - h[k]!) ? l : b));
        changed = true;
      }
      if (!left || !changed) break;
    }
  };
  let sums = sumsOf();
  const solved = (m: Map<number, Sums>) => new Map([...m].map(([l, s]) => [l, solve(s)!] as const).filter(([, p]) => p));
  const minCells = Math.ceil(2 / (R * R));
  const first = solved(sums);
  attach(new Set([...sums].filter(([l, s]) => s[0]! >= minCells && first.has(l)).map(([l]) => l)), first);
  // Fusion : la paire voisine dont le plan commun est le meilleur, tant qu'il reste sous mergeRms.
  for (;;) {
    sums = sumsOf();
    const pairs = new Set<string>();
    for (let k = 0; k < W * H; k++) for (const kk of nbrs(k)) { const a = lab[k]!, b = lab[kk]!; if (a && b && a < b) pairs.add(`${a},${b}`); }
    let best: [number, number, number] | null = null;
    for (const key of pairs) {
      const [a, b] = key.split(',').map(Number) as [number, number];
      const s = new Float64Array(10);
      for (let t = 0; t < 10; t++) s[t] = sums.get(a)![t]! + sums.get(b)![t]!;
      const p = solve(s);
      if (p && p.rms < mergeRms && (!best || p.rms < best[0])) best = [p.rms, a, b];
    }
    if (!best) break;
    for (let k = 0; k < W * H; k++) if (lab[k] === best[2]) lab[k] = best[1];
  }
  // Petits plans (noues, raccords) : rattachés pixel par pixel au voisin le plus probable.
  const core = Int32Array.from(lab);
  sums = sumsOf();
  const bigPlanes = solved(sums);
  const big = new Set([...sums].filter(([l, s]) => s[0]! * R * R >= minPlane && bigPlanes.has(l)).map(([l]) => l));
  if (!big.size) return null;
  for (let k = 0; k < W * H; k++) if (lab[k] && !big.has(lab[k]!)) lab[k] = 0;
  attach(big, bigPlanes);
  sums = sumsOf();
  const planes = solved(sums);
  // Deux pans : voisins, pentes > 5°, descentes opposées, frontière ≥ 1,5 m au point haut des deux plans.
  const grad = (p: { b: number; c: number }) => Math.hypot(p.b, p.c);
  const deg = (t: number) => (Math.atan(t) * 180) / Math.PI;
  const border = new Map<string, number[]>();
  for (let k = 0; k < W * H; k++) for (const kk of nbrs(k)) {
    const a = lab[k]!, b = lab[kk]!;
    if (a && b && a !== b) { const key = `${a},${b}`; if (!border.has(key)) border.set(key, []); border.get(key)!.push(k); }
  }
  const maxZ = new Map<number, number>();
  for (let k = 0; k < W * H; k++) if (lab[k]) maxZ.set(lab[k]!, Math.max(maxZ.get(lab[k]!) ?? -Infinity, h[k]!));
  const med = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? NaN; };
  const cand: Array<[number, number, number]> = [];
  for (const [key, cellsA] of border) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    if (a > b) continue;
    const pa = planes.get(a)!, pb = planes.get(b)!;
    if (deg(grad(pa)) < 5 || deg(grad(pb)) < 5) continue;
    if ((pa.b * pb.b + pa.c * pb.c) / (grad(pa) * grad(pb)) > -0.8) continue;
    const L = cellsA.length * R;
    if (L < 1.5) continue;
    const ha = med(cellsA.map((k) => at(pa, k))), hb = med(cellsA.map((k) => at(pb, k)));
    if (Math.abs(ha - hb) < 0.3 && Math.abs(ha - maxZ.get(a)!) < 0.5 && Math.abs(hb - maxZ.get(b)!) < 0.5) cand.push([L, a, b]);
  }
  const vol = new Map<number, number[]>(), used = new Set<number>();
  for (const [, a, b] of cand.sort((x, y) => y[0] - x[0])) {
    if (used.has(a) || used.has(b)) continue;
    vol.set(vol.size + 1, [a, b]); used.add(a); used.add(b);
  }
  for (const l of planes.keys()) if (!used.has(l)) { vol.set(vol.size + 1, [l]); used.add(l); }
  const vlab = new Int32Array(W * H);
  for (const [v, regs] of vol) for (let k = 0; k < W * H; k++) if (regs.includes(lab[k]!)) vlab[k] = v;
  // Contour extérieur d'un volume : arêtes de pixels orientées, chaînées en anneaux (le plus grand gardé).
  const contour = (v: number): Array<[number, number]> | null => {
    const next = new Map<string, string>();
    const P = (i: number, j: number) => `${i},${j}`;
    for (let k = 0; k < W * H; k++) {
      if (vlab[k] !== v) continue;
      const i = k % W, j = (k - i) / W, is = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < W && jj < H && vlab[jj * W + ii] === v;
      // sommets de pixel : (i, j) coin nord-ouest ; parcours dans le sens horaire vu du nord en haut
      if (!is(i, j - 1)) next.set(P(i, j), P(i + 1, j));
      if (!is(i + 1, j)) next.set(P(i + 1, j), P(i + 1, j + 1));
      if (!is(i, j + 1)) next.set(P(i + 1, j + 1), P(i, j + 1));
      if (!is(i - 1, j)) next.set(P(i, j + 1), P(i, j));
    }
    let bestRing: Array<[number, number]> | null = null, bestA = 0;
    const seen = new Set<string>();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const r: Array<[number, number]> = [];
      let cur: string | undefined = start;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const [i, j] = cur.split(',').map(Number) as [number, number];
        r.push([mns.e0 + (i0 + i) * R, mns.n0 - (j0 + j) * R]);
        cur = next.get(cur);
      }
      if (r.length < 4) continue;
      // sommets alignés retirés (la simplification s'en charge aussi, mais l'ancre doit être un vrai coin)
      const a = Math.abs(ringArea(r));
      if (a > bestA) { bestA = a; bestRing = r; }
    }
    return bestRing;
  };
  const o = ring[0]!;
  const toTile = (e: number, n: number): [number, number] => [e - origin.x, origin.y - n];
  const ox = o[0] - origin.x, oz = origin.y - o[1];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const parts: VolumePart[] = [];
  const volumeRms: number[] = [];
  let sse = 0, ns = 0;
  for (const [v, regs] of vol) {
    const sse0 = sse, ns0 = ns;
    const raw = contour(v);
    if (!raw) continue;
    let poly: Array<[number, number]> | null = null;
    for (const eps of [eps0, eps0 / 2, R / 4]) {
      const sp = simplify(raw, eps);
      if (sp.length >= 3 && simple(sp)) { poly = sp; break; }
    }
    if (!poly) return null;
    const rel = poly.flatMap(([e, n]) => { const [x, z] = toTile(e, n); return [r2(x - ox), r2(z - oz)]; });
    // Toit ajusté sur les pixels des plans d'origine du volume (hors pixels rattachés).
    const cellsOf = (l: number) => { const out: number[] = []; for (let k = 0; k < W * H; k++) if (core[k] === l && lab[k] === l) out.push(k); return out; };
    const fit = (cells: number[]) => { const s = new Float64Array(10); for (const k of cells) if (measured[k]) add(s, X(k % W), Y((k - (k % W)) / W), h[k]!); return solve(s); };
    let roof: VolumePart['roof'];
    if (regs.length === 2) {
      const pa = fit(cellsOf(regs[0]!)) ?? planes.get(regs[0]!)!, pb = fit(cellsOf(regs[1]!)) ?? planes.get(regs[1]!)!;
      // Faîtage : intersection des deux plans, horizontal à la hauteur moyenne de l'intersection sur le volume.
      let nx = pa.b - pb.b, ny = pa.c - pb.c;
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      const off = (pb.a - pa.a) / nl; // nx·x + ny·y = off
      const dx = -ny, dy = nx;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length - ec, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length - nc;
      const t = cx * dx + cy * dy;
      const px0 = nx * off + dx * t, py0 = ny * off + dy * t;
      const ts = poly.map(([e, n]) => (e - ec - px0) * dx + (n - nc - py0) * dy);
      const zr = (q: number) => pa.a + pa.b * (px0 + dx * q) + pa.c * (py0 + dy * q);
      const ridgeM = (zr(Math.min(...ts)) + zr(Math.max(...ts))) / 2;
      const A = toTile(px0 + dx * Math.min(...ts) + ec, py0 + dy * Math.min(...ts) + nc);
      const B = toTile(px0 + dx * Math.max(...ts) + ec, py0 + dy * Math.max(...ts) + nc);
      // pente perpendiculaire au faîtage de chaque plan ; côté gauche selon la convention du contrat
      const sa = Math.abs(pa.b * nx + pa.c * ny), sb = Math.abs(pb.b * nx + pb.c * ny);
      const ca = cellsOf(regs[0]!), mid = ca[Math.floor(ca.length / 2)]!;
      const [qx, qz] = toTile(ce(mid % W), cn((mid - (mid % W)) / W));
      const side = (B[0] - A[0]) * (qz - A[1]) - (B[1] - A[1]) * (qx - A[0]);
      const [left, right] = side < 0 ? [sa, sb] : [sb, sa];
      roof = { type: 'gable', ridgeM: r2(ridgeM), ridge: [r2(A[0] - ox), r2(A[1] - oz), r2(B[0] - ox), r2(B[1] - oz)], pitchLeftDeg: r2(deg(left)), pitchRightDeg: r2(deg(right)) };
      for (let k = 0; k < W * H; k++) { if (!measured[k] || vlab[k] !== v) continue; const d = Math.min(Math.abs(at(pa, k) - h[k]!), Math.abs(at(pb, k) - h[k]!)); sse += d * d; ns++; }
    } else {
      const cells = cellsOf(regs[0]!), p = fit(cells) ?? planes.get(regs[0]!)!;
      // écart sur tous les pixels mesurés du volume, rattachés compris : c'est ce que le rendu montrera
      for (let k = 0; k < W * H; k++) { if (!measured[k] || vlab[k] !== v) continue; const d = at(p, k) - h[k]!; sse += d * d; ns++; }
      const g = grad(p);
      if (deg(g) < 3) {
        roof = { type: 'flat', topM: r2(p.a + p.b * (cx0(poly) - ec) + p.c * (cy0(poly) - nc)) };
      } else {
        const zAt = ([e, n]: [number, number]) => p.a + p.b * (e - ec) + p.c * (n - nc);
        const top = poly.reduce((b, q) => (zAt(q) > zAt(b) ? q : b));
        const [tx, tz] = toTile(top[0], top[1]);
        roof = { type: 'shed', topM: r2(zAt(top)), through: [r2(tx - ox), r2(tz - oz)], down: [Math.round((-p.b / g) * 1e4) / 1e4, Math.round((p.c / g) * 1e4) / 1e4], pitchDeg: r2(deg(g)) };
      }
    }
    parts.push({ pts: rel, roof });
    volumeRms.push(Math.sqrt((sse - sse0) / Math.max(ns - ns0, 1)));
  }
  // Garde-fou : un volume mal expliqué (pan trop étroit pour le MNS 0,5 m, végétation…) fait renoncer au tout.
  if (!parts.length || parts.length > 12 || volumeRms.some((r) => r > maxVolumeRms)) return null;
  return { parts, planes: planes.size, rms: Math.sqrt(sse / Math.max(ns, 1)), volumeRms };
}

function cx0(p: Array<[number, number]>): number { return p.reduce((s, q) => s + q[0], 0) / p.length; }
function cy0(p: Array<[number, number]>): number { return p.reduce((s, q) => s + q[1], 0) / p.length; }
