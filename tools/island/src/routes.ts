/**
 * Itinéraires : plus court chemin sur le graphe routier entre des points de passage, selon le vélo
 * (route, piste cyclable, gravel, VTT) ; jamais de demi-tour aux points de passage.
 */
import type { RoadGraphData } from '../../../packages/shared/src/roadgraph.ts';
import type { RouteBike, RouteData, RouteHairpin } from '../../../packages/shared/src/route.ts';
import type { Vec2 } from './design.ts';
import { ATTRIBUTION, STEP, r2 } from './roads.ts';

export type Mode = 'road' | 'cycle' | 'gravel' | 'mtb';

export interface RouteSpec {
  id: string;
  name: string;
  nameEn: string;
  loop: boolean;
  mode: Mode;
  waypoints: Vec2[];
  bike?: RouteBike;
  landmarks?: Array<{ name: string; x: number; z: number }>;
  hairpins?: boolean;
}

function edgeFactor(mode: Mode, kind: string, surface: string): number {
  const dirt = kind === 'track' && surface !== 'gravel';
  const gravel = kind === 'track' && surface === 'gravel';
  switch (mode) {
    case 'road':
      return dirt ? 80 : gravel ? 40 : kind === 'cycleway' ? 1.4 : kind === 'residential' ? 1.15 : kind === 'unclassified' ? 1.08 : 1;
    case 'cycle':
      return dirt ? 40 : gravel ? 6 : kind === 'cycleway' ? 0.45 : 1.2;
    case 'gravel':
      return gravel ? 0.4 : dirt ? 1.5 : kind === 'unclassified' || kind === 'cycleway' ? 1 : kind === 'residential' ? 1.2 : kind === 'tertiary' ? 1.6 : 2.5;
    case 'mtb':
      return dirt ? 0.3 : gravel ? 0.8 : 2.5;
  }
}

export function planRoute(graph: RoadGraphData, spec: RouteSpec): RouteData | null {
  const nNodes = graph.nodes.length / 3;
  const adj: Array<Array<{ e: number; to: number }>> = Array.from({ length: nNodes }, () => []);
  graph.edges.forEach((e, i) => {
    adj[e.a]!.push({ e: i, to: e.b });
    if (e.b !== e.a) adj[e.b]!.push({ e: i, to: e.a });
  });
  // Point de passage → nœud le plus proche parmi ceux qui conviennent au vélo.
  const nodeFor = (x: number, z: number, end = false): number => {
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < nNodes; k++) {
      if (!adj[k]!.length) continue;
      const pref = Math.min(...adj[k]!.map(({ e }) => edgeFactor(spec.mode, graph.edges[e]!.kind, graph.edges[e]!.surface)));
      // Carrefour (≥ 3 voies) de préférence : on n'arrive jamais dans un cul-de-sac (demi-tour obligé).
      // (départ et arrivée d'un parcours ouvert : un cul-de-sac convient, on n'en repart pas)
      const d = Math.hypot(graph.nodes[k * 3]! - x, graph.nodes[k * 3 + 2]! - z) * (pref > 3 ? 4 : 1) * (end ? 1 : adj[k]!.length >= 3 ? 1 : adj[k]!.length === 2 ? 2 : 50);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  // Points de passage tombés sur le même nœud : un seul (sinon la dernière étape d'une boucle peut disparaître
  // et la boucle se refermer par un demi-tour).
  const last = spec.waypoints.length - 1;
  const wps = spec.waypoints.map(([x, z], i) => nodeFor(x, z, !spec.loop && (i === 0 || i === last))).filter((n, i, a) => i === 0 || n !== a[i - 1]);
  if (spec.loop) {
    while (wps.length > 1 && wps[wps.length - 1] === wps[0]) wps.pop();
    wps.push(wps[0]!);
  }
  // Cap d'une arête au départ de chacune de ses extrémités (sur ≈ 6 m, comme le contrôle des demi-tours).
  const heading = (e: number, fromA: boolean): number => {
    const p = graph.edges[e]!.pts;
    const m = p.length / 3;
    let k = fromA ? 0 : m - 1;
    const step = fromA ? 1 : -1;
    const k0 = k;
    let L = 0;
    while (k + step >= 0 && k + step < m && L < 6) {
      L += Math.hypot(p[(k + step) * 3]! - p[k * 3]!, p[(k + step) * 3 + 2]! - p[k * 3 + 2]!);
      k += step;
    }
    return Math.atan2(p[k * 3 + 2]! - p[k0 * 3 + 2]!, p[k * 3]! - p[k0 * 3]!);
  };
  /** Virage (rad) en arrivant par `e` au nœud `v` puis en repartant par `f`. */
  const turn = (e: number, v: number, f: number): number => {
    const ed = graph.edges[e]!;
    const inH = heading(e, ed.a === v) + Math.PI; // cap d'arrivée = inverse du départ depuis v
    const fd = graph.edges[f]!;
    let t = Math.abs(heading(f, fd.a === v) - inH);
    t = t % (2 * Math.PI);
    return t > Math.PI ? 2 * Math.PI - t : t;
  };
  // Virage le plus serré permis à un carrefour (au-delà : demi-tour).
  const MAX_TURN = (135 * Math.PI) / 180;
  const used = new Map<number, number>();
  const steps: Array<{ e: number; fwd: boolean }> = [];
  for (let w = 0; w + 1 < wps.length; w++) {
    const from = wps[w]!;
    const to = wps[w + 1]!;
    if (from === to) continue;
    const inEdge = steps.length ? steps[steps.length - 1]!.e : -1;
    // Dernière étape d'une boucle : l'arrivée doit pouvoir enchaîner sur la première arête sans demi-tour.
    const closing = spec.loop && w + 2 === wps.length && steps.length ? steps[0]!.e : -1;
    // États : arête parcourue et nœud d'arrivée (indice 2·e + (arrivée en b ? 1 : 0)).
    const S = graph.edges.length * 2;
    const dist = new Float64Array(S).fill(Infinity);
    const prev = new Int32Array(S).fill(-1);
    const open = new Set<number>();
    const stateOf = (e: number, v: number) => 2 * e + (graph.edges[e]!.b === v ? 1 : 0);
    const nodeOf = (st: number) => (st & 1 ? graph.edges[st >> 1]!.b : graph.edges[st >> 1]!.a);
    const cost = (e: number) => {
      const ed = graph.edges[e]!;
      return ed.len * edgeFactor(spec.mode, ed.kind, ed.surface) * (used.has(e) ? 6 : 1);
    };
    for (const { e, to: b } of adj[from]!) {
      if (inEdge >= 0 && (e === inEdge || turn(inEdge, from, e) > MAX_TURN)) continue;
      const st = stateOf(e, b);
      if (cost(e) < dist[st]!) {
        dist[st] = cost(e);
        open.add(st);
      }
    }
    let goal = -1;
    while (open.size) {
      let a = -1;
      let ad = Infinity;
      for (const k of open)
        if (dist[k]! < ad) {
          ad = dist[k]!;
          a = k;
        }
      open.delete(a);
      const v = nodeOf(a);
      const e = a >> 1;
      if (v === to && (closing < 0 || (e !== closing && turn(e, to, closing) <= MAX_TURN))) {
        goal = a;
        break;
      }
      for (const { e: f, to: b } of adj[v]!) {
        if (f === e || turn(e, v, f) > MAX_TURN) continue;
        const st = stateOf(f, b);
        const c = dist[a]! + cost(f);
        if (c < dist[st]!) {
          dist[st] = c;
          prev[st] = a;
          open.add(st);
        }
      }
    }
    if (goal < 0) return null;
    const leg: Array<{ e: number; fwd: boolean }> = [];
    for (let st = goal; st >= 0; st = prev[st]!) leg.push({ e: st >> 1, fwd: (st & 1) === 1 });
    leg.reverse();
    for (const s of leg) {
      steps.push(s);
      used.set(s.e, (used.get(s.e) ?? 0) + 1);
    }
  }
  // Points, largeurs et revêtements.
  const raw: Array<[number, number, number]> = [];
  const widths: Array<{ startM: number; endM: number; widthM: number }> = [];
  const surfaces: Array<{ startM: number; endM: number; surface: string }> = [];
  let d = 0;
  for (const s of steps) {
    const e = graph.edges[s.e]!;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k < e.pts.length; k += 3) pts.push([e.pts[k]!, e.pts[k + 1]!, e.pts[k + 2]!]);
    if (!s.fwd) pts.reverse();
    const start = d;
    for (const p of pts) {
      const last = raw[raw.length - 1];
      if (last) {
        const st = Math.hypot(p[0] - last[0], p[2] - last[2]);
        if (st < 0.5) continue;
        d += st;
      }
      raw.push(p);
    }
    const lw = widths[widths.length - 1];
    if (lw && lw.widthM === e.width) lw.endM = r2(d);
    else widths.push({ startM: r2(start), endM: r2(d), widthM: e.width });
    const ls = surfaces[surfaces.length - 1];
    if (ls && ls.surface === e.surface) ls.endM = r2(d);
    else surfaces.push({ startM: r2(start), endM: r2(d), surface: e.surface });
  }
  if (spec.loop && raw.length > 2) {
    const a = raw[0]!;
    const b = raw[raw.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.5) raw.pop();
  }
  // Pas réguliers de 2 m au plus : les longs segments (raccords) sont redécoupés.
  const fine: Array<[number, number, number]> = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;
    fine.push(p);
    const q = spec.loop ? raw[(i + 1) % raw.length]! : raw[i + 1];
    if (!q || (i === raw.length - 1 && !spec.loop)) continue;
    const L = Math.hypot(q[0] - p[0], q[2] - p[2]);
    const k = Math.floor(L / (STEP * 1.25));
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      if (i === raw.length - 1 && spec.loop && j === k + 1) break;
      fine.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  let lengthM = 0;
  const points = fine.map((p, i) => {
    if (i > 0) lengthM += Math.hypot(p[0] - fine[i - 1]![0], p[2] - fine[i - 1]![2]);
    return { x: r2(p[0]), y: r2(p[1]), z: r2(p[2]), d: r2(lengthM) };
  });
  // Distances recalculées depuis les points arrondis (cohérence exacte avec les contrôles).
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
    points[i]!.d = r2(acc);
  }
  lengthM = acc;
  if (spec.loop) lengthM += Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.z - points[points.length - 1]!.z);
  const total = lengthM;
  if (widths.length) widths[widths.length - 1]!.endM = r2(total);
  if (surfaces.length) surfaces[surfaces.length - 1]!.endM = r2(total);
  let gain = 0;
  let maxGrade = 0;
  for (let i = 1; i < points.length; i++) gain += Math.max(0, points[i]!.y - points[i - 1]!.y);
  for (let i = 0, j = 0; i < points.length; i++) {
    while (j < points.length - 1 && points[j]!.d - points[i]!.d < 10) j++;
    const dd = points[j]!.d - points[i]!.d;
    if (dd >= 8) maxGrade = Math.max(maxGrade, (Math.abs(points[j]!.y - points[i]!.y) / dd) * 100);
  }
  const ys = points.map((p) => p.y);
  const minWidth = Math.min(...widths.map((w) => w.widthM));
  const route: RouteData = {
    id: spec.id,
    name: spec.name,
    nameEn: spec.nameEn,
    loop: spec.loop,
    lengthM: r2(total),
    elevationGainM: r2(gain),
    points,
    segments: [],
    // Le jeu place le coureur d'après cette largeur sur tout le parcours : la plus étroite traversée.
    roadWidthM: minWidth,
    attribution: ATTRIBUTION,
    roadWidths: widths,
    surfaces,
    landmarks: (spec.landmarks ?? []).map((l) => ({ name: l.name, d: points.reduce((best, p) => (Math.hypot(p.x - l.x, p.z - l.z) < Math.hypot(best.x - l.x, best.z - l.z) ? p : best)).d })),
    stepM: STEP,
    minElevationM: r2(Math.min(...ys)),
    maxElevationM: r2(Math.max(...ys)),
    maxGradePct: r2(maxGrade),
    markings: spec.mode === 'road' ? 'full' : 'none',
    ...(spec.bike ? { bike: spec.bike } : {}),
  };
  if (spec.hairpins) route.hairpins = hairpins(points);
  return route;
}

/** Lacets : virages de plus de 150° sur 60 m, numérotés du haut (1) vers le bas, comme à l'Alpe d'Huez. */
function hairpins(points: Array<{ x: number; y: number; z: number; d: number }>): RouteHairpin[] {
  const at = (d: number) => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (points[m]!.d < d) lo = m + 1;
      else hi = m;
    }
    return points[lo]!;
  };
  const found: Array<{ d: number; turn: number; y: number }> = [];
  const total = points[points.length - 1]!.d;
  for (let d = 35; d < total - 35; d += 4) {
    const a = at(d - 35);
    const b = at(d - 25);
    const c = at(d + 25);
    const e = at(d + 35);
    const h1 = Math.atan2(b.z - a.z, b.x - a.x);
    const h2 = Math.atan2(e.z - c.z, e.x - c.x);
    let t = Math.abs(h2 - h1);
    if (t > Math.PI) t = 2 * Math.PI - t;
    const deg = (t * 180) / Math.PI;
    if (deg < 150) continue;
    const last = found[found.length - 1];
    if (last && d - last.d < 90) {
      if (deg > last.turn) Object.assign(last, { d, turn: deg, y: at(d).y });
      continue;
    }
    found.push({ d, turn: deg, y: at(d).y });
  }
  return found.map((h, i) => ({ number: found.length - i, d: h.d, turnDeg: Math.round(h.turn), radiusM: 14, altitudeM: Math.round(h.y) }));
}
