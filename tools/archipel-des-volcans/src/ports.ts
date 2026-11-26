/**
 * Quais roulables des deux ports, ajoutés une fois le réseau tracé : ils ne changent donc aucune autre route. Chaque
 * quai est une traversante (deux raccords), pour qu'un itinéraire n'ait jamais à y faire demi-tour.
 */
import { HARBOURS, type Vec2 } from './design.ts';
import { makeRoad, nearestOn, type Road, type RoadSpec } from './roads.ts';

/** Point d'un port : `u` vers le large depuis le centre du bassin, `w` en travers (à gauche en regardant la mer pour Robertville). */
export function harbourPoint(id: string, u: number, w: number): Vec2 {
  const h = HARBOURS.find((x) => x.id === id)!;
  const ux = Math.cos(h.dir);
  const uz = Math.sin(h.dir);
  return [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
}

/** Sommet de la route désignée le plus proche de `p` (le raccord s'y pose exactement). */
function anchor(roads: Road[], p: Vec2, name: RegExp): [number, number, number] {
  let best: [number, number, number] | null = null;
  let bd = Infinity;
  for (const r of roads) {
    if (!name.test(r.name)) continue;
    const q = nearestOn(r, p[0], p[1]);
    if (q.d >= bd) continue;
    bd = q.d;
    const v = r.pts[q.t < 0.5 ? q.i : (q.i + 1) % r.pts.length]!;
    best = [v[0], v[1], v[2]];
  }
  if (!best || bd > 60) throw new Error(`quai : aucune route ${name} près de ${p.map(Math.round).join(', ')}`);
  return best;
}

function quay(spec: RoadSpec, from: [number, number, number], mid: Vec2[], to: [number, number, number]): Road {
  return makeRoad({ ...spec, pts: [[from[0], from[2]], ...mid, [to[0], to[2]]], y0: from[1], y1: to[1], gmax: spec.gmax ?? 0.06, smooth: spec.smooth ?? 3 });
}

/** Extrémité d'une rue (bout libre) la plus proche de `p`. */
function streetEnd(roads: Road[], p: Vec2, name: RegExp): [number, number, number] {
  let best: [number, number, number] | null = null;
  let bd = Infinity;
  for (const r of roads) {
    if (!name.test(r.name)) continue;
    for (const v of [r.pts[0]!, r.pts[r.pts.length - 1]!]) {
      const d = Math.hypot(v[0] - p[0], v[2] - p[1]);
      if (d < bd) {
        bd = d;
        best = [v[0], v[1], v[2]];
      }
    }
  }
  if (!best || bd > 40) throw new Error(`quai : aucun bout de rue ${name} près de ${p.map(Math.round).join(', ')}`);
  return best;
}

/** Quais : aucun dans l'Archipel (les bassins sont bordés par le décor du client). */
export function portRoads(roads: Road[]): Road[] {
  void roads;
  void streetEnd;
  void anchor;
  void quay;
  return [];
}
