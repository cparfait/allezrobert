/** Mise au point des routes dessinées de montagne (longueur, altitudes aux bouts, écart au terrain). */
import { terrain } from './design.ts';
import { designedRoads } from './build.ts';

const D = designedRoads();
for (const r of D.roads.filter((q) => /^col-|route-de-pralong/.test(q.id))) {
  let L = 0;
  let worst = 0;
  for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i]![0] - r.pts[i - 1]![0], r.pts[i]![2] - r.pts[i - 1]![2]);
  let wp = r.pts[0]!;
  for (const p of r.pts) if (Math.abs(p[1] - terrain(p[0], p[2])) > worst) {
    worst = Math.abs(p[1] - terrain(p[0], p[2]));
    wp = p;
  }
  const a = r.pts[0]!;
  const b = r.pts[r.pts.length - 1]!;
  console.log(r.id, Math.round(L), 'm', a.map(Math.round).join(','), '→', b.map(Math.round).join(','), 'sol', Math.round(terrain(a[0], a[2])), Math.round(terrain(b[0], b[2])), 'écart max', Math.round(worst), 'à', wp.map(Math.round).join(','));
}
