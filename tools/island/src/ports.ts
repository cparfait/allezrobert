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

export function portRoads(roads: Road[]): Road[] {
  const R = (u: number, w: number) => harbourPoint('port-robertville', u, w);
  const K = (u: number, w: number) => harbourPoint('port-kerbrou', u, w);
  const out: Road[] = [];
  // Robertville : du boulevard de la Mer à la route du Tour de l'Île, par le quai ouest.
  const bd = streetEnd(roads, [1572, 10006], /Boulevard de la Mer/);
  const tour = anchor(roads, [1610, 9872], /Tour de l'Île/);
  const quai = quay({ id: 'robertville-quai', name: 'Quai du Port', kind: 'residential', width: 6, pts: [] }, bd, [[bd[0] + 34, bd[2] + 10], [1650, 10022], R(-42, 112), R(-80, 106), R(-128, 106), R(-164, 112), [tour[0] + 22, tour[2] + 2]], tour);
  out.push(quai);
  // Les Planches prolongées jusqu'au quai.
  const planches = streetEnd(roads, [1521, 10078], /Les Planches/);
  const on = nearestOn(quai, 1655, 10022);
  const joint = quai.pts[on.i]!;
  out.push(quay({ id: 'robertville-planches-port', name: 'Promenade du Port', kind: 'cycleway', width: 4, surface: 'wood', pts: [], gmax: 0.04 }, planches, [[1558, 10087], [1610, 10096], [1652, 10092], R(22, 110), [joint[0] + 4, joint[2] + 26]], [joint[0], joint[1], joint[2]]));
  // Kerbrou : de la rue des Pêcheurs à la rue du Port, par le quai est puis le fond du bassin.
  const pecheurs = streetEnd(roads, [-1669, -10194], /Rue des Pêcheurs \(Kerbrou\)/);
  const port = anchor(roads, [-1886, -9945], /Rue du Port \(Kerbrou\)/);
  out.push(quay({ id: 'kerbrou-quai', name: 'Quai des Pêcheurs', kind: 'residential', width: 5.5, pts: [], smooth: 3 }, pecheurs, [[pecheurs[0] + 10, pecheurs[2] - 24], [-1688, -10238], K(6, 112), K(-18, 90), K(-70, 87), K(-150, 87), K(-169, 60), K(-169, 0), K(-168, -40), [port[0] + 4, port[2] - 46]], port));
  return out;
}
