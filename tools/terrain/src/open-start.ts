/**
 * Départ du roulage libre : le jeu place le coureur sur l'arête du graphe la plus proche du point de
 * départ, quelle qu'elle soit (piste, ruelle, voie de service). Le point est donc recalé ici sur une
 * vraie route à proximité (Ventoux : le départ de la montée tombait dans les ruelles du vieux Bédoin).
 */
import type { RoadGraphEdge } from '@allezrobert/shared';

/** Route où l'on peut démarrer : départementale, rue d'au moins 4 m, anneau ou allée de bois fermée aux voitures. */
export function goodStartEdge(e: RoadGraphEdge): boolean {
  if (e.border) return false;
  // routes départementales : toujours (largeur OSM parfois sous-estimée), rues : 4 m au moins
  if (/^(primary|secondary|tertiary)(_link)?$/.test(e.kind)) return e.width >= 3;
  if (e.width < 4) return false;
  if (/^(unclassified|residential)$/.test(e.kind)) return true;
  // routes du bois de Vincennes, anneau de Longchamp : nommées, larges, fermées aux voitures
  return /^(service|cycleway)$/.test(e.kind) && !!e.name && e.width >= 5;
}

/** Point le plus proche de (x, z) sur une route de départ correcte à moins de `maxM` ; null sinon. */
export function startOnRoad(edges: RoadGraphEdge[], x: number, z: number, maxM = 300): { x: number; z: number; edge: RoadGraphEdge; dist: number } | null {
  let best: { x: number; z: number; edge: RoadGraphEdge; dist: number } | null = null;
  for (const e of edges) {
    if (!goodStartEdge(e)) continue;
    const p = e.pts;
    for (let i = 0; i + 5 < p.length; i += 3) {
      const ax = p[i]!;
      const az = p[i + 2]!;
      const dx = p[i + 3]! - ax;
      const dz = p[i + 5]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const qx = ax + t * dx;
      const qz = az + t * dz;
      const d = Math.hypot(qx - x, qz - z);
      if (d <= maxM && (!best || d < best.dist)) best = { x: qx, z: qz, edge: e, dist: d };
    }
  }
  return best;
}

/** Arête où le jeu pose le coureur au départ libre : la plus proche, hors arêtes de bord (comme `RoadNet.nearest`). */
export function startEdgeOf(edges: RoadGraphEdge[], x: number, z: number): { edge: RoadGraphEdge; dist: number } | null {
  let best: { edge: RoadGraphEdge; dist: number } | null = null;
  for (const e of edges) {
    if (e.border) continue;
    const p = e.pts;
    for (let i = 0; i + 5 < p.length; i += 3) {
      const ax = p[i]!;
      const az = p[i + 2]!;
      const dx = p[i + 3]! - ax;
      const dz = p[i + 5]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
      if (!best || d < best.dist) best = { edge: e, dist: d };
    }
  }
  return best;
}
