/**
 * Itinéraire fidèle à une sortie Garmin : recalage « HMM » (Viterbi, à la Newson & Krumm) de la
 * trace sur le graphe routier, en une marche ordonnée d'arêtes, puis fermeture de la boucle par
 * le plus court chemin cyclable entre la fin et le début de la partie conservée. Les demi-tours
 * (aller-retour sur une même arête) sont retirés : injouables, et presque toujours du bruit GPS.
 *
 * Seule la partie publique de la sortie est utilisée (dans le corridor du monde, loin des
 * départs/arrivées) : le résultat est une suite d'arêtes OSM, jamais la trace brute.
 */
import { projectOnSegment, type Pt } from './geom.ts';
import { dijkstra, pathTo, type Edge, type RoadGraph } from './graph.ts';
import type { DirectedCycle } from './loop.ts';

/** Bruit GPS (m) : coût d'émission ½ (d/σ)². */
const SIGMA_M = 6;
/** Échelle de l'écart distance routière / distance à vol d'oiseau (m). */
const BETA_M = 8;
/** Rayon de recherche des arêtes candidates (m) et nombre maximal de candidats. */
const SEARCH_M = 35;
const MAX_CANDS = 6;
/** Pas minimal entre deux échantillons GPS utilisés (m). */
const SAMPLE_M = 15;

interface Cand {
  edge: number;
  s: number; // abscisse le long de l'arête depuis le nœud a (m)
  d: number; // distance au tracé (m)
  pen?: number; // pénalité d'émission
}

const emission = (c: Cand) => 0.5 * (c.d / SIGMA_M) ** 2 + (c.pen ?? 0);

/** Point d'arête le plus proche (abscisse depuis le nœud a). */
function projectOnEdge(e: Edge, x: number, z: number): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  let acc = 0;
  for (let i = 1; i < e.pts.length; i++) {
    const a = e.pts[i - 1]!;
    const b = e.pts[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const p = projectOnSegment(x, z, a[0], a[1], b[0], b[1]);
    if (p.d < best.d) best = { d: p.d, s: acc + p.t * seg };
    acc += seg;
  }
  return best;
}

/** Plus courts chemins (longueur réelle) depuis une position au milieu d'une arête. */
function fromCand(g: RoadGraph, c: Cand, usable: (e: Edge) => boolean, maxCost: number) {
  const e = g.edges[c.edge]!;
  // source virtuelle : on part du nœud a (coût s) ou du nœud b (coût len − s)
  const ra = dijkstra(g, e.a, { cost: (x) => (usable(x) ? x.len : Infinity), respectOneway: false, maxCost, bannedEdges: new Set([c.edge]) });
  const rb = dijkstra(g, e.b, { cost: (x) => (usable(x) ? x.len : Infinity), respectOneway: false, maxCost, bannedEdges: new Set([c.edge]) });
  const dist = (n: number): { d: number; via: number } => {
    const da = (ra.dist.get(n) ?? Infinity) + c.s;
    const db = (rb.dist.get(n) ?? Infinity) + e.len - c.s;
    return da <= db ? { d: da, via: e.a } : { d: db, via: e.b };
  };
  return { ra, rb, dist };
}

/** Distance routière entre deux candidats (et nœuds de sortie / d'entrée). */
function routeDist(g: RoadGraph, a: Cand, b: Cand, from: ReturnType<typeof fromCand>): { d: number; exit: number; enter: number } {
  if (a.edge === b.edge) return { d: Math.abs(b.s - a.s), exit: -1, enter: -1 };
  const eb = g.edges[b.edge]!;
  const toA = from.dist(eb.a);
  const toB = from.dist(eb.b);
  const viaA = toA.d + b.s;
  const viaB = toB.d + eb.len - b.s;
  return viaA <= viaB ? { d: viaA, exit: toA.via, enter: eb.a } : { d: viaB, exit: toB.via, enter: eb.b };
}

export interface RideWalk {
  /** Arêtes parcourues dans l'ordre, et nœuds (un de plus que d'arêtes). */
  edges: number[];
  nodes: number[];
  /** Longueur de la marche (somme des arêtes, m). */
  lengthM: number;
  /** Longueur recalée entre les projections du premier et du dernier point GPS (m). */
  matchedM: number;
  /** Longueur de la trace GPS recalée (m). */
  gpsLengthM: number;
  /** Longueur des allers-retours parasites retirés (m). */
  spursM: number;
  /** Arêtes des allers-retours retirés. */
  spurs: number[];
}

/**
 * Recale une trace (points monde contigus) sur le graphe : marche ordonnée d'arêtes entières,
 * du premier au dernier carrefour franchi. `usable` filtre les arêtes admises.
 */
export function matchWalk(
  g: RoadGraph,
  track: Array<{ x: number; z: number }>,
  usable: (e: Edge) => boolean = () => true,
  /** Pénalité d'émission par arête (trottoirs, sites propres… au profit de la chaussée voisine). */
  penalty: (e: Edge) => number = () => 0,
): RideWalk | null {
  // 1. échantillons espacés d'au moins SAMPLE_M
  const smp: Pt[] = [];
  let gpsLengthM = 0;
  for (let i = 0; i < track.length; i++) {
    const p = track[i]!;
    if (i > 0) gpsLengthM += Math.hypot(p.x - track[i - 1]!.x, p.z - track[i - 1]!.z);
    const last = smp[smp.length - 1];
    if (!last || Math.hypot(p.x - last[0], p.z - last[1]) >= SAMPLE_M || i === track.length - 1) smp.push([p.x, p.z]);
  }
  // 2. candidats
  const cands: Cand[][] = smp.map(([x, z]) => {
    const out: Cand[] = [];
    for (const eid of g.index.query(x, z, SEARCH_M)) {
      const e = g.edges[eid]!;
      if (!usable(e)) continue;
      const p = projectOnEdge(e, x, z);
      if (p.d <= SEARCH_M) out.push({ edge: eid, s: p.s, d: p.d, pen: penalty(e) });
    }
    return out.sort((a, b) => emission(a) - emission(b)).slice(0, MAX_CANDS);
  });
  const keep = cands.map((c) => c.length > 0);
  const S = smp.filter((_, i) => keep[i]);
  const C = cands.filter((_, i) => keep[i]);
  if (S.length < 2) return null;
  // 3. Viterbi
  const T = S.length;
  const cost: number[][] = [C[0]!.map(emission)];
  const back: number[][] = [C[0]!.map(() => -1)];
  for (let t = 1; t < T; t++) {
    const gc = Math.hypot(S[t]![0] - S[t - 1]![0], S[t]![1] - S[t - 1]![1]);
    const prev = C[t - 1]!;
    const cur = C[t]!;
    const ct = cur.map(() => Infinity);
    const bt = cur.map(() => -1);
    for (let bound = gc * 2 + 120; ; bound *= 4) {
      for (let i = 0; i < prev.length; i++) {
        const base = cost[t - 1]![i]!;
        if (!Number.isFinite(base)) continue;
        const from = fromCand(g, prev[i]!, usable, bound);
        for (let j = 0; j < cur.length; j++) {
          const r = routeDist(g, prev[i]!, cur[j]!, from);
          if (!Number.isFinite(r.d)) continue;
          const v = base + Math.abs(r.d - gc) / BETA_M + emission(cur[j]!);
          if (v < ct[j]!) {
            ct[j] = v;
            bt[j] = i;
          }
        }
      }
      if (ct.some(Number.isFinite) || bound > 20000) break;
    }
    if (!ct.some(Number.isFinite)) {
      // rupture (aucun chemin) : on repart du meilleur candidat
      let bi = 0;
      for (let i = 1; i < prev.length; i++) if (cost[t - 1]![i]! < cost[t - 1]![bi]!) bi = i;
      for (let j = 0; j < cur.length; j++) {
        ct[j] = cost[t - 1]![bi]! + 1000 + emission(cur[j]!);
        bt[j] = bi;
      }
    }
    // normalisation (évite la dérive numérique)
    const m = Math.min(...ct);
    cost.push(ct.map((v) => v - m));
    back.push(bt);
  }
  const seq: Cand[] = new Array(T);
  let j = 0;
  for (let i = 1; i < C[T - 1]!.length; i++) if (cost[T - 1]![i]! < cost[T - 1]![j]!) j = i;
  for (let t = T - 1; t >= 0; t--) {
    seq[t] = C[t]![j]!;
    j = back[t]![j]!;
  }
  // 4. marche d'arêtes : (arête, nœud d'entrée)
  const steps: Array<{ edge: number; from: number }> = [];
  let spursM = 0;
  const spurs: number[] = [];
  let curEdge = seq[0]!.edge;
  let curFrom = -1; // inconnu tant qu'on n'a pas quitté la première arête
  let reach = 0; // plus grande avancée dans l'arête courante depuis son nœud d'entrée
  const reachFrom = (c: Cand, from: number) => (from === g.edges[c.edge]!.a ? c.s : g.edges[c.edge]!.len - c.s);
  const push = (edge: number, from: number) => steps.push({ edge, from });
  for (let t = 1; t < T; t++) {
    const a = seq[t - 1]!;
    const b = seq[t]!;
    if (a.edge === b.edge) {
      if (curFrom >= 0) reach = Math.max(reach, reachFrom(b, curFrom));
      continue;
    }
    const gc = Math.hypot(S[t]![0] - S[t - 1]![0], S[t]![1] - S[t - 1]![1]);
    let from = fromCand(g, a, usable, gc * 2 + 120);
    let r = routeDist(g, a, b, from);
    for (let bound = gc * 8 + 480; !Number.isFinite(r.d) && bound < 80000; bound *= 4) {
      from = fromCand(g, a, usable, bound);
      r = routeDist(g, a, b, from);
    }
    if (!Number.isFinite(r.d)) throw new Error('trace discontinue (aucun chemin entre deux points recalés)');
    const ea = g.edges[a.edge]!;
    // l'arête courante est parcourue vers son nœud de sortie ; sinon demi-tour dans l'arête
    const entry = curFrom >= 0 ? curFrom : g.other(ea, r.exit);
    if (entry !== r.exit) push(a.edge, entry);
    else if (curFrom >= 0) {
      spursM += 2 * reach;
      spurs.push(a.edge);
    }
    // chemin intermédiaire entre le nœud de sortie et le nœud d'entrée de b
    const tree = r.exit === ea.a ? from.ra : from.rb;
    const mid = pathTo(g, tree, r.exit, r.enter) ?? [];
    let n = r.exit;
    for (const eid of mid) {
      push(eid, n);
      n = g.other(g.edges[eid]!, n);
    }
    curEdge = b.edge;
    curFrom = r.enter;
    reach = reachFrom(b, curFrom);
  }
  if (curFrom >= 0) push(curEdge, curFrom);
  // 5. raccords : retrait des demi-tours (A→B puis B→A sur la même arête)
  let out: Array<{ edge: number; from: number }> = [];
  for (const st of steps) {
    const last = out[out.length - 1];
    if (last && last.edge === st.edge && last.from !== st.from) {
      out.pop();
      spursM += 2 * g.edges[st.edge]!.len;
      spurs.push(st.edge);
      continue;
    }
    out.push(st);
  }
  if (!out.length) return null;
  // longueur recalée entre le premier et le dernier point GPS (hors bouts d'arêtes)
  let matchedM = 0;
  for (const st of out) matchedM += g.edges[st.edge]!.len;
  const s0 = seq[0]!;
  const s1 = seq[T - 1]!;
  const before = out[0]!.edge === s0.edge ? reachFrom(s0, out[0]!.from) : 0;
  const lastSt = out[out.length - 1]!;
  const after = lastSt.edge === s1.edge ? g.edges[lastSt.edge]!.len - reachFrom(s1, lastSt.from) : 0;
  matchedM -= before + after;
  // arêtes extrêmes à moitié parcourues au plus : la marche commence / finit au carrefour
  if (out.length > 1 && before > g.edges[out[0]!.edge]!.len / 2) out = out.slice(1);
  if (out.length > 1 && after > g.edges[lastSt.edge]!.len / 2) out = out.slice(0, -1);
  const edges = out.map((st) => st.edge);
  const nodes = [out[0]!.from];
  for (const st of out) nodes.push(g.other(g.edges[st.edge]!, st.from));
  for (let i = 1; i < out.length; i++) if (out[i]!.from !== nodes[i]) throw new Error('marche discontinue');
  let lengthM = 0;
  for (const e of edges) lengthM += g.edges[e]!.len;
  return { edges, nodes, lengthM, matchedM, gpsLengthM, spursM, spurs };
}

/**
 * Ferme une marche en boucle : plus court chemin (coût `cost`) du dernier nœud au premier, puis
 * retrait des demi-tours au raccord. Renvoie le cycle, la longueur roulée conservée et la
 * longueur de la fermeture.
 */
export function closeWalk(g: RoadGraph, w: RideWalk, cost: (e: Edge) => number): { cycle: DirectedCycle; keptM: number; closureM: number } | null {
  const start = w.nodes[0]!;
  const end = w.nodes[w.nodes.length - 1]!;
  let closure: number[] = [];
  if (start !== end) {
    const used = new Set(w.edges);
    const c = (e: Edge) => cost(e) * (used.has(e.id) ? 3 : 1);
    // sens uniques respectés, sinon (impasse au bord du monde) ignorés
    let p = pathTo(g, dijkstra(g, end, { cost: c, target: start }), end, start);
    p ??= pathTo(g, dijkstra(g, end, { cost: c, target: start, respectOneway: false }), end, start);
    if (!p) return null;
    closure = p;
  }
  // marche fermée, puis retrait circulaire des demi-tours
  let steps: Array<{ edge: number; from: number; closure: boolean }> = [];
  let n = start;
  for (const [k, eid] of [...w.edges, ...closure].entries()) {
    steps.push({ edge: eid, from: n, closure: k >= w.edges.length });
    n = g.other(g.edges[eid]!, n);
  }
  for (let changed = true; changed && steps.length > 2; ) {
    changed = false;
    const out: typeof steps = [];
    for (const s of steps) {
      const last = out[out.length - 1];
      if (last && last.edge === s.edge && last.from !== s.from) {
        out.pop();
        changed = true;
      } else out.push(s);
    }
    // raccord fin → début
    while (out.length > 2 && out[0]!.edge === out[out.length - 1]!.edge && out[0]!.from !== out[out.length - 1]!.from) {
      out.shift();
      out.pop();
      changed = true;
    }
    steps = out;
  }
  if (steps.length < 3) return null;
  const edges = steps.map((s) => s.edge);
  const nodes = [steps[0]!.from];
  for (const s of steps) nodes.push(g.other(g.edges[s.edge]!, s.from));
  if (nodes[nodes.length - 1] !== nodes[0]) throw new Error('boucle non fermée');
  // longueurs finales : partie roulée conservée / fermeture (après retrait des demi-tours)
  let keptM = 0;
  let closureM = 0;
  for (const st of steps) {
    if (st.closure) closureM += g.edges[st.edge]!.len;
    else keptM += g.edges[st.edge]!.len;
  }
  return { cycle: { start: nodes[0]!, edges, nodes }, keptM, closureM };
}
