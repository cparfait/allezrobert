/**
 * Profils 3D des routes OSM (hors itinéraires) et couloirs de creusement.
 * Les nœuds partagés ont une altitude unique (celle de l'itinéraire s'il y passe), ce qui
 * garantit la continuité des profils aux carrefours.
 */
import type { RouteData } from '@allezrobert/shared';
import type { DemStack } from './dem.ts';
import { worldToL93 } from './frame.ts';
import { resampleOpen, simplify3, smooth1d, type Pt } from './geom.ts';
import type { Edge, RoadGraph } from './graph.ts';
import type { CarveLine, TileRoad } from './tiles.ts';

/** Types de voies creusées dans le terrain. */
const CARVED = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|cycleway|track)(_link)?$/;

export interface RouteOnGraph {
  route: RouteData;
  edgeOf: number[];
  priority: number;
}

function demAt(dem: DemStack, x: number, z: number): number {
  const l = worldToL93(x, z);
  return dem.sample(l.e, l.n);
}

export function buildRoads3d(g: RoadGraph, dem: DemStack, routes: RouteOnGraph[]): { roads: TileRoad[]; carve: CarveLine[] } {
  const roads: TileRoad[] = [];
  const carve: CarveLine[] = [];
  const routeEdges = new Set<number>();
  const nodeH = new Map<number, number>();
  // 1. itinéraires : couloirs prioritaires, morceaux par arête (attributs OSM)
  for (const r of routes) {
    const pts = r.route.points;
    const n = pts.length;
    for (const e of r.edgeOf) routeEdges.add(e);
    carve.push({
      pts: pts.map((p) => [p.x, p.y, p.z] as [number, number, number]),
      halfWidth: r.route.roadWidthM / 2,
      priority: r.priority,
      closed: r.route.loop,
    });
    // altitude des nœuds du graphe situés sur l'itinéraire
    const nodes = new Set<number>();
    for (const eid of new Set(r.edgeOf)) {
      const e = g.edges[eid]!;
      nodes.add(e.a);
      nodes.add(e.b);
    }
    for (const nd of nodes) {
      if (nodeH.has(nd)) continue;
      const p = g.nodePos.get(nd)!;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(pts[i]!.x - p[0], pts[i]!.z - p[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bd < 15) nodeH.set(nd, pts[bi]!.y);
    }
    // morceaux de rendu : coupure à chaque changement d'arête
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && r.edgeOf[i] === r.edgeOf[start]) continue;
      const e = g.edges[r.edgeOf[start]!]!;
      const end = Math.min(i, n - 1);
      const seg = pts.slice(start, end + 1).map((p) => [p.x, p.y, p.z] as [number, number, number]);
      if (i === n && r.route.loop) seg.push([pts[0]!.x, pts[0]!.y, pts[0]!.z]);
      if (seg.length >= 2)
        roads.push({
          id: `route:${r.route.id}:${e.road.id}`,
          kind: e.road.kind,
          ...(e.road.name ? { name: e.road.name } : {}),
          ...(e.road.ref ? { ref: e.road.ref } : {}),
          width: e.road.width,
          surface: e.road.surface,
          ...(e.road.bridge ? { bridge: true } : {}),
          ...(e.road.tunnel ? { tunnel: true } : {}),
          route: r.route.id,
          flatten: [Math.round((r.route.roadWidthM / 2 + 0.5) * 100) / 100, Math.round((4 + r.route.roadWidthM / 2 + 0.5) * 100) / 100],
          pts: seg,
        });
      start = i;
    }
  }
  // 2. altitude des autres nœuds : médiane locale du MNT
  const nodeHeight = (nd: number): number => {
    let h = nodeH.get(nd);
    if (h !== undefined) return h;
    const p = g.nodePos.get(nd)!;
    const vals = [demAt(dem, p[0], p[1]), demAt(dem, p[0] + 1.5, p[1]), demAt(dem, p[0] - 1.5, p[1]), demAt(dem, p[0], p[1] + 1.5), demAt(dem, p[0], p[1] - 1.5)]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    h = vals[Math.floor(vals.length / 2)] ?? 0;
    nodeH.set(nd, h);
    return h;
  };
  // 3. arêtes OSM
  for (const e of g.edges) {
    if (routeEdges.has(e.id)) continue;
    const pts3 = edgeProfile(e, dem, nodeHeight(e.a), nodeHeight(e.b));
    const carved = CARVED.test(e.road.kind) && !e.road.bridge && !e.road.tunnel;
    const hw = e.road.width / 2;
    roads.push({
      id: `w${e.road.id}`,
      kind: e.road.kind,
      ...(e.road.name ? { name: e.road.name } : {}),
      ...(e.road.ref ? { ref: e.road.ref } : {}),
      width: e.road.width,
      surface: e.road.surface,
      ...(e.road.bridge ? { bridge: true } : {}),
      ...(e.road.tunnel ? { tunnel: true } : {}),
      ...(carved ? { flatten: [Math.round((hw + 0.5) * 100) / 100, Math.round((4 + hw + 0.5) * 100) / 100] as [number, number] } : {}),
      // géométrie de rendu simplifiée (≤ 20 cm en plan, ≤ 3 cm en altitude) ; le creusement utilise le profil dense
      pts: simplify3(pts3, 0.2, 0.03),
    });
    if (carved) carve.push({ pts: pts3, halfWidth: hw, priority: 0 });
  }
  return { roads, carve };
}

/**
 * Profil d'une arête : MNT tous les 4 m, lissage gaussien σ = 8 m, extrémités recalées sur
 * l'altitude des nœuds (correction linéaire). Ponts/tunnels : interpolation entre les nœuds.
 */
export function edgeProfile(e: Edge, dem: DemStack, ha: number, hb: number): Array<[number, number, number]> {
  const pts: Pt[] = e.len > 8 ? resampleOpen(e.pts, Math.min(8, Math.max(2, e.len / Math.ceil(e.len / 4)))) : e.pts.slice();
  const n = pts.length;
  if (e.road.bridge || e.road.tunnel || n < 3) {
    let acc = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push((acc += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])));
    const L = acc || 1;
    return pts.map((p, i) => [p[0], ha + ((hb - ha) * cum[i]!) / L, p[1]]);
  }
  const raw = pts.map((p) => demAt(dem, p[0], p[1]));
  for (let i = 0; i < n; i++) if (!Number.isFinite(raw[i]!)) raw[i] = ha + ((hb - ha) * i) / (n - 1);
  const step = e.len / (n - 1);
  const s = smooth1d(raw, 8 / step, false);
  const ca = ha - s[0]!;
  const cb = hb - s[n - 1]!;
  return pts.map((p, i) => [p[0], s[i]! + ca + ((cb - ca) * i) / (n - 1), p[1]]);
}
