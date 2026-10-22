/**
 * Montées point à point (Alpe d'Huez, Ventoux…) : chemin OSM imposé, géométrie fidèle aux
 * lacets (lissage en plan très léger, pas de Catmull-Rom qui arrondirait les épingles),
 * altitude de la plate-forme de chaussée lue dans le MNT LiDAR, détection des lacets.
 */
import { dijkstra, pathTo, type Edge, type RoadGraph } from './graph.ts';
import { cumulative, projectOnSegment, resampleOpen, smooth1d, type Pt } from './geom.ts';

/** Polyligne d'un chemin d'arêtes partant du nœud `start` ; `edgeOf[k]` = arête du segment k. */
export function pathPolyline(g: RoadGraph, start: number, edges: number[]): { pts: Pt[]; edgeOf: number[] } {
  const pts: Pt[] = [];
  const edgeOf: number[] = [];
  let n = start;
  for (const eid of edges) {
    const e = g.edges[eid]!;
    const o = g.orientedPts(e, n);
    for (let i = 0; i < o.length - 1; i++) {
      pts.push(o[i]!);
      edgeOf.push(eid);
    }
    n = g.other(e, n);
  }
  const last = edges.length ? g.nodePos.get(n) : undefined;
  if (last) pts.push(last);
  return { pts, edgeOf };
}

/** Arête la plus proche d'un point (distance au segment), parmi celles acceptées par `ok`. */
export function nearestEdgeOf(g: RoadGraph, x: number, z: number, maxD: number, ok: (e: Edge) => boolean): number {
  let best = -1;
  let bd = maxD;
  for (const eid of g.index.query(x, z, maxD)) {
    const e = g.edges[eid]!;
    if (!ok(e)) continue;
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1]!;
      const b = e.pts[i]!;
      const d = projectOnSegment(x, z, a[0], a[1], b[0], b[1]).d;
      if (d < bd) {
        bd = d;
        best = eid;
      }
    }
  }
  return best;
}

/**
 * Chemin le plus court qui parcourt entièrement chacune des arêtes `must` dans l'ordre (une par
 * point de passage), dans le sens le moins coûteux permis par les sens uniques. Renvoie le nœud
 * de départ et la liste d'arêtes ; les extrémités sont à rogner ensuite (projection des points).
 */
export function routeViaEdges(g: RoadGraph, must: number[], cost: (e: Edge) => number): { start: number; edges: number[] } {
  const list = must.filter((e, i) => i === 0 || e !== must[i - 1]);
  type Opt = { from: number; to: number };
  const opts = (eid: number): Opt[] => {
    const e = g.edges[eid]!;
    const o: Opt[] = [];
    if (g.canTraverse(e, e.a)) o.push({ from: e.a, to: e.b });
    if (g.canTraverse(e, e.b)) o.push({ from: e.b, to: e.a });
    return o;
  };
  const sp = new Map<number, ReturnType<typeof dijkstra>>();
  const spFrom = (n: number) => {
    let r = sp.get(n);
    if (!r) sp.set(n, (r = dijkstra(g, n, { cost })));
    return r;
  };
  // programmation dynamique sur le sens de parcours de chaque arête imposée
  let layer = opts(list[0]!).map((o) => ({ o, first: o, cost: g.edges[list[0]!]!.len, path: [list[0]!] }));
  for (let k = 1; k < list.length; k++) {
    const eid = list[k]!;
    const next: typeof layer = [];
    for (const o of opts(eid)) {
      let best: (typeof layer)[number] | null = null;
      for (const p of layer) {
        const r = spFrom(p.o.to);
        const c = p.o.to === o.from ? 0 : r.dist.get(o.from);
        if (c === undefined) continue;
        const total = p.cost + c + g.edges[eid]!.len;
        if (!best || total < best.cost) {
          const mid = p.o.to === o.from ? [] : (pathTo(g, r, p.o.to, o.from) ?? []);
          best = { o, first: p.first, cost: total, path: [...p.path, ...mid, eid] };
        }
      }
      if (best) next.push(best);
    }
    if (!next.length) throw new Error(`pas de chemin jusqu'au point de passage ${k}`);
    layer = next;
  }
  const best = layer.sort((a, b) => a.cost - b.cost)[0]!;
  return { start: best.first.from, edges: best.path };
}

/** Abscisse curviligne de la projection d'un point sur une polyligne (première moitié/seconde moitié). */
export function projectArc(pts: Pt[], p: Pt, from = 0, to = Infinity): { s: number; d: number } {
  const cum = cumulative(pts);
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    if (cum[i + 1]! < from || cum[i]! > to) continue;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const pr = projectOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (pr.d < best.d) best = { s: cum[i]! + (cum[i + 1]! - cum[i]!) * pr.t, d: pr.d };
  }
  return best;
}

/** Morceau [s0, s1] (abscisses curvilignes) d'une polyligne, avec l'arête de chaque segment. */
export function slicePolyline(pts: Pt[], edgeOf: number[], s0: number, s1: number): { pts: Pt[]; edgeOf: number[] } {
  const cum = cumulative(pts);
  const at = (s: number, i: number): Pt => {
    const t = (s - cum[i]!) / Math.max(1e-9, cum[i + 1]! - cum[i]!);
    const a = pts[i]!;
    const b = pts[i + 1]!;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out: Pt[] = [];
  const eo: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = cum[i]!;
    const b = cum[i + 1]!;
    if (b <= s0 || a >= s1) continue;
    if (!out.length) out.push(a < s0 ? at(s0, i) : pts[i]!);
    out.push(b > s1 ? at(s1, i) : pts[i + 1]!);
    eo.push(edgeOf[i]!);
  }
  return { pts: out, edgeOf: eo };
}

/**
 * Géométrie en plan d'une montée : rééchantillonnage à 1 m, lissage gaussien léger (σ en m,
 * efface le crénelage des nœuds OSM sans rogner les épingles), rééchantillonnage uniforme au pas
 * visé. `edgeOf` suit l'abscisse curviligne (fraction de longueur).
 */
export function smoothOpenPath(raw: Pt[], rawEdgeOf: number[], sigmaM: number, step: number): { pts: Pt[]; step: number; edgeOf: number[] } {
  const r1 = resampleOpen(raw, 1);
  const s1 = cumulative(r1);
  const step1 = s1[s1.length - 1]! / Math.max(1, r1.length - 1);
  const sx = smooth1d(r1.map((p) => p[0]), sigmaM / step1, false);
  const sz = smooth1d(r1.map((p) => p[1]), sigmaM / step1, false);
  // extrémités fixes (le lissage par réflexion les déplace à peine, on les remet exactement)
  sx[0] = r1[0]![0];
  sz[0] = r1[0]![1];
  sx[sx.length - 1] = r1[r1.length - 1]![0];
  sz[sz.length - 1] = r1[r1.length - 1]![1];
  const sm: Pt[] = sx.map((x, i) => [x, sz[i]!]);
  const fin = resampleOpen(sm, step);
  const total = cumulative(fin)[fin.length - 1]!;
  const rawCum = cumulative(raw);
  const rawTotal = rawCum[rawCum.length - 1]!;
  const edgeOf: number[] = [];
  let k = 0;
  for (let i = 0; i < fin.length; i++) {
    const s = (i / Math.max(1, fin.length - 1)) * rawTotal;
    while (k < rawEdgeOf.length - 1 && rawCum[k + 1]! <= s) k++;
    edgeOf.push(rawEdgeOf[k]!);
  }
  return { pts: fin, step: total / Math.max(1, fin.length - 1), edgeOf };
}

/**
 * Angles de carrefour trop serrés pour la chaussée (rayon de l'axe < `minR`, ex. demi-largeur
 * + 1 m) : lissage local supplémentaire (σ = 4 m) sur ±15 m, jusqu'à disparition. Les lacets
 * (rayon ≥ 5 m) ne sont pas touchés. Renvoie la polyligne rééchantillonnée au même pas.
 */
export function relaxTightCorners(pts: Pt[], minR: number, step: number, maxIter = 6): { pts: Pt[]; relaxed: number } {
  let cur = pts;
  let relaxed = 0;
  const k = Math.max(1, Math.round(4 / step));
  for (let it = 0; it < maxIter; it++) {
    const xs = cur.map((p) => p[0]);
    const zs = cur.map((p) => p[1]);
    const n = cur.length;
    const mask = new Uint8Array(n);
    let any = false;
    const w = Math.round(15 / step);
    for (let i = 0; i < n; i++) {
      if (circumradius(xs, zs, i, k) >= minR) continue;
      any = true;
      for (let j = Math.max(1, i - w); j <= Math.min(n - 2, i + w); j++) mask[j] = 1;
    }
    if (!any) break;
    relaxed++;
    const sx = smooth1d(xs, 4 / step, false);
    const sz = smooth1d(zs, 4 / step, false);
    const blended: Pt[] = cur.map((p, i) => (mask[i] ? [sx[i]!, sz[i]!] : p));
    cur = resampleOpen(blended, step);
  }
  return { pts: cur, relaxed };
}

/** Cap déroulé (radians) en chaque point. */
export function unwrappedHeading(xs: number[], zs: number[]): number[] {
  const n = xs.length;
  const out = new Array<number>(n).fill(0);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let h = Math.atan2(zs[b]! - zs[a]!, xs[b]! - xs[a]!);
    if (i > 0) {
      while (h - prev > Math.PI) h -= 2 * Math.PI;
      while (h - prev < -Math.PI) h += 2 * Math.PI;
    }
    out[i] = h;
    prev = h;
  }
  return out;
}

/** Rayon du cercle passant par les points i−k, i, i+k (Infinity si alignés). */
export function circumradius(xs: number[], zs: number[], i: number, k: number): number {
  const n = xs.length;
  const a = Math.max(0, i - k);
  const c = Math.min(n - 1, i + k);
  if (a === i || c === i) return Infinity;
  const ax = xs[a]!;
  const az = zs[a]!;
  const bx = xs[i]!;
  const bz = zs[i]!;
  const cx = xs[c]!;
  const cz = zs[c]!;
  const ab = Math.hypot(bx - ax, bz - az);
  const bc = Math.hypot(cx - bx, cz - bz);
  const ca = Math.hypot(ax - cx, az - cz);
  const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

export interface DetectedHairpin {
  startIdx: number;
  endIdx: number;
  apexIdx: number;
  /** Virage net (°, valeur absolue) entre le début et la fin du lacet. */
  turnDeg: number;
  /** Rayon minimal de l'axe dans le virage (m), sur une corde de ±`chordM`. */
  radiusM: number;
}

/**
 * Lacets : virages d'au moins `minTurnDeg` (net) sur au plus `maxSpanM` de route. Les fenêtres
 * qui se chevauchent forment un seul lacet ; le sommet est le point de courbure maximale.
 * `skip(i)` écarte des points (giratoires).
 */
export function detectHairpins(xs: number[], zs: number[], step: number, opts: { minTurnDeg?: number; maxSpanM?: number; chordM?: number; skip?: (i: number) => boolean } = {}): DetectedHairpin[] {
  const n = xs.length;
  const minTurn = ((opts.minTurnDeg ?? 150) * Math.PI) / 180;
  const span = Math.max(2, Math.round((opts.maxSpanM ?? 120) / step));
  const k = Math.max(1, Math.round((opts.chordM ?? 4) / step));
  const T = unwrappedHeading(xs, zs);
  const windows: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < Math.min(n, i + span + 1); j++) {
      if (Math.abs(T[j]! - T[i]!) >= minTurn) {
        windows.push([i, j]);
        break;
      }
    }
  }
  const clusters: Array<[number, number]> = [];
  for (const [a, b] of windows) {
    const last = clusters[clusters.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else clusters.push([a, b]);
  }
  const out: DetectedHairpin[] = [];
  for (const [a, b] of clusters) {
    let apex = a;
    let minR = Infinity;
    for (let i = a; i <= b; i++) {
      const r = circumradius(xs, zs, i, k);
      if (r < minR) {
        minR = r;
        apex = i;
      }
    }
    if (opts.skip?.(apex)) continue;
    out.push({ startIdx: a, endIdx: b, apexIdx: apex, turnDeg: (Math.abs(T[b]! - T[a]!) * 180) / Math.PI, radiusM: minR });
  }
  return out;
}

/**
 * Altitude de la plate-forme de chaussée en un point : profil en travers du MNT sur ±`halfM`
 * (pas 0,5 m), fenêtre de ±`winM` la plus plate (pente transversale minimale, légère préférence
 * pour l'axe OSM), altitude = moyenne de la fenêtre. Corrige les décalages de quelques mètres
 * entre le tracé OSM et la route réelle sur les pentes raides (talus, murs de soutènement).
 * Renvoie aussi le décalage latéral retenu (m, positif à gauche du sens de marche).
 */
export function platformHeight(sample: (x: number, z: number) => number, p: Pt, dir: Pt, halfM = 5, winM = 2): { h: number; offset: number; crossSlope: number } {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const nx = -dir[1] / l;
  const nz = dir[0] / l;
  const st = 0.5;
  const m = Math.round(halfM / st);
  const w = Math.round(winM / st);
  const hs: number[] = [];
  for (let k = -m; k <= m; k++) hs.push(sample(p[0] + nx * k * st, p[1] + nz * k * st));
  let best = { score: Infinity, h: NaN, offset: 0, slope: 0 };
  for (let c = -m + w; c <= m - w; c++) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let cnt = 0;
    for (let q = c - w; q <= c + w; q++) {
      const v = hs[q + m]!;
      if (!Number.isFinite(v)) continue;
      const x = q * st;
      sx += x;
      sy += v;
      sxx += x * x;
      sxy += x * v;
      cnt++;
    }
    if (cnt < w) continue;
    const den = cnt * sxx - sx * sx;
    const slope = den > 0 ? (cnt * sxy - sx * sy) / den : 0;
    const score = Math.abs(slope) + 0.015 * Math.abs(c * st);
    if (score < best.score) best = { score, h: sy / cnt, offset: c * st, slope };
  }
  if (!Number.isFinite(best.h)) {
    const v = hs[m]!;
    return { h: v, offset: 0, crossSlope: NaN };
  }
  return { h: best.h, offset: best.offset, crossSlope: best.slope };
}

/** Interpolation linéaire des valeurs masquées (ou non finies) d'un profil ouvert. */
export function interpolateMaskedOpen(v: number[], mask: boolean[]): number[] {
  const n = v.length;
  const ok = v.map((x, i) => Number.isFinite(x) && !mask[i]);
  const out = v.slice();
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    if (last < i - 1) {
      for (let k = last + 1; k < i; k++) out[k] = last < 0 ? v[i]! : v[last]! + ((v[i]! - v[last]!) * (k - last)) / (i - last);
    }
    last = i;
  }
  if (last >= 0) for (let k = last + 1; k < n; k++) out[k] = v[last]!;
  return out;
}

/** « Virage de la Savoyâte » → « La Savoyâte » ; « Virage des Hollandais » → « Les Hollandais ». */
export function hairpinShortName(name: string): string {
  let s = name.replace(/^Virage\s+/i, '');
  s = s.replace(/^de la /, 'La ').replace(/^de l['’]/, "L'").replace(/^du /, 'Le ').replace(/^des /, 'Les ').replace(/^de /, '').replace(/^d['’]/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
