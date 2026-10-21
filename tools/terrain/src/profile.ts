/**
 * Profils en long : lissage de l'altitude de chaussée, détection des côtes (KOM) et des
 * lignes droites plates (sprints).
 */
import { smooth1d } from './geom.ts';

export interface Climb {
  startIdx: number;
  endIdx: number;
  lengthM: number;
  gainM: number;
  avgGrade: number; // %
  maxGrade: number; // % sur 50 m
}

export interface Sprint {
  startIdx: number;
  endIdx: number;
  lengthM: number;
  avgGrade: number; // %
  maxDeviationM: number;
  score: number;
}

/**
 * Lisse un profil d'altitude de chaussée échantillonné à pas `step` :
 * gaussienne σ = `sigmaM`, puis passes locales supplémentaires là où la variation de pente
 * dépasse `maxGradeChange` (fraction de pente par tranche de 20 m).
 */
export function smoothRoadProfile(h: number[], step: number, circular: boolean, sigmaM = 10, maxGradeChange = 0.035): { h: number[]; maxGradeChangePer20m: number } {
  let out = smooth1d(h, sigmaM / step, circular);
  const n = out.length;
  const w = Math.max(1, Math.round(10 / step));
  const at = (arr: number[], i: number) => (circular ? arr[((i % n) + n) % n]! : arr[Math.max(0, Math.min(n - 1, i))]!);
  const gradeChange = (arr: number[], i: number) => {
    const g1 = (at(arr, i) - at(arr, i - w)) / (w * step);
    const g2 = (at(arr, i + w) - at(arr, i)) / (w * step);
    return Math.abs(g2 - g1);
  };
  for (let pass = 0; pass < 8; pass++) {
    const bad = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!circular && (i < w || i >= n - w)) continue;
      if (gradeChange(out, i) > maxGradeChange) {
        any = true;
        const r = Math.round(30 / step);
        for (let k = i - r; k <= i + r; k++) {
          const kk = circular ? ((k % n) + n) % n : k;
          if (kk >= 0 && kk < n) bad[kk] = 1;
        }
      }
    }
    if (!any) break;
    const sm = smooth1d(out, 8 / step, circular);
    out = out.map((v, i) => (bad[i] ? sm[i]! : v));
  }
  let maxC = 0;
  for (let i = 0; i < n; i++) {
    if (!circular && (i < w || i >= n - w)) continue;
    maxC = Math.max(maxC, gradeChange(out, i));
  }
  return { h: out, maxGradeChangePer20m: maxC };
}

/** Extrema avec hystérésis (zig-zag) : indices alternés min/max. */
export function zigzag(h: number[], hyst: number): Array<{ i: number; type: 'min' | 'max' }> {
  const out: Array<{ i: number; type: 'min' | 'max' }> = [];
  const n = h.length;
  if (n < 2) return out;
  let minI = 0;
  let maxI = 0;
  let trend = 0; // 1 montée, −1 descente
  let i = 1;
  for (; i < n && trend === 0; i++) {
    if (h[i]! < h[minI]!) minI = i;
    if (h[i]! > h[maxI]!) maxI = i;
    if (h[i]! - h[minI]! >= hyst) {
      out.push({ i: minI, type: 'min' });
      trend = 1;
      maxI = i;
    } else if (h[maxI]! - h[i]! >= hyst) {
      out.push({ i: maxI, type: 'max' });
      trend = -1;
      minI = i;
    }
  }
  for (; i < n; i++) {
    const v = h[i]!;
    if (trend === 1) {
      if (v > h[maxI]!) maxI = i;
      else if (h[maxI]! - v >= hyst) {
        out.push({ i: maxI, type: 'max' });
        trend = -1;
        minI = i;
      }
    } else {
      if (v < h[minI]!) minI = i;
      else if (v - h[minI]! >= hyst) {
        out.push({ i: minI, type: 'min' });
        trend = 1;
        maxI = i;
      }
    }
  }
  if (trend === 1) out.push({ i: maxI, type: 'max' });
  else if (trend === -1) out.push({ i: minI, type: 'min' });
  return out;
}

/**
 * Côtes d'un profil (pas régulier `step`) : montées min→max (hystérésis 4 m), extrémités
 * rognées des parties plates, gardées si longueur ≥ minLen et pente moyenne ≥ minGrade.
 */
export function detectClimbs(h: number[], step: number, minLen = 500, minGrade = 3): Climb[] {
  const ext = zigzag(h, 4);
  const climbs: Climb[] = [];
  const look = Math.max(1, Math.round(50 / step));
  for (let k = 0; k + 1 < ext.length; k++) {
    const a = ext[k]!;
    const b = ext[k + 1]!;
    if (a.type !== 'min' || b.type !== 'max') continue;
    let s = a.i;
    let e = b.i;
    // rognage : approche plate (< 1,5 % sur 50 m)
    while (s + look < e && (h[s + look]! - h[s]!) / (look * step) < 0.015) s++;
    while (e - look > s && (h[e]! - h[e - look]!) / (look * step) < 0.015) e--;
    const len = (e - s) * step;
    const gain = h[e]! - h[s]!;
    const avg = (gain / Math.max(len, 1)) * 100;
    if (len < minLen || avg < minGrade) continue;
    let maxG = 0;
    for (let i = s; i + look <= e; i++) maxG = Math.max(maxG, ((h[i + look]! - h[i]!) / (look * step)) * 100);
    climbs.push({ startIdx: s, endIdx: e, lengthM: len, gainM: gain, avgGrade: avg, maxGrade: maxG });
  }
  return climbs;
}

/**
 * Lignes droites plates : fenêtres de 300 à 500 m, pente moyenne ≤ 1 %, pente locale ≤ 2,5 %,
 * écart latéral à la corde ≤ 10 m. Renvoie les meilleures sans chevauchement.
 */
export function detectSprints(xs: number[], zs: number[], h: number[], step: number, circular: boolean, exclude: Array<[number, number]> = []): Sprint[] {
  const n = h.length;
  const at = (arr: number[], i: number) => arr[circular ? ((i % n) + n) % n : i]!;
  const cands: Sprint[] = [];
  const stride = Math.max(1, Math.round(10 / step));
  const look = Math.max(1, Math.round(25 / step));
  const lim = circular ? n : n - 1;
  for (let s = 0; s < lim; s += stride) {
    for (let L = 500; L >= 300; L -= 25) {
      const len = Math.round(L / step);
      const e = s + len;
      if (!circular && e >= n) continue;
      if (exclude.some(([a, b]) => overlapCirc(s, e, a, b, n, circular))) continue;
      const g = ((at(h, e) - at(h, s)) / L) * 100;
      if (Math.abs(g) > 1) continue;
      let ok = true;
      for (let i = s; i + look <= e; i += look) {
        if (Math.abs((at(h, i + look) - at(h, i)) / (look * step)) > 0.025) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ax = at(xs, s);
      const az = at(zs, s);
      const bx = at(xs, e);
      const bz = at(zs, e);
      const cl = Math.hypot(bx - ax, bz - az);
      if (cl < L * 0.97) continue;
      let dev = 0;
      for (let i = s; i <= e; i += stride) {
        const px = at(xs, i);
        const pz = at(zs, i);
        const d = Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / Math.max(cl, 1e-6);
        if (d > dev) dev = d;
      }
      if (dev > 10) continue;
      cands.push({ startIdx: s, endIdx: e, lengthM: L, avgGrade: g, maxDeviationM: dev, score: L / 500 - Math.abs(g) * 0.5 - dev / 20 });
      break; // plus longue fenêtre valide pour ce départ
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked: Sprint[] = [];
  for (const c of cands) {
    if (picked.some((p) => overlapCirc(c.startIdx, c.endIdx, p.startIdx, p.endIdx, n, circular))) continue;
    picked.push(c);
  }
  return picked;
}

function overlapCirc(a0: number, a1: number, b0: number, b1: number, n: number, circular: boolean): boolean {
  if (!circular) return a0 < b1 && b0 < a1;
  for (const off of [-n, 0, n]) if (a0 < b1 + off && b0 + off < a1) return true;
  return false;
}

/** Dénivelé positif cumulé (avec seuil d'hystérésis optionnel). */
export function elevationGain(h: number[], circular: boolean): number {
  let g = 0;
  for (let i = 1; i < h.length; i++) g += Math.max(0, h[i]! - h[i - 1]!);
  if (circular && h.length > 1) g += Math.max(0, h[0]! - h[h.length - 1]!);
  return g;
}
