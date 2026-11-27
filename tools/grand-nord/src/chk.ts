/** Mise au point : pentes et rayons du graphe d'un essai (mêmes règles que verify.ts), sans construire les tuiles. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GRAVELLY } from './routes.ts';

const g = JSON.parse(readFileSync(join(process.env.ISLAND_OUT!, 'graph.json'), 'utf8')) as { edges: Array<{ name?: string; kind: string; surface: string; pts: number[] }> };
const count = new Map<string, number>();
for (const e of g.edges) {
  if (e.name === "L'Anneau") continue;
  const lim = e.kind === 'track' ? (GRAVELLY.has(e.surface) ? 0.2 : 0.27) : e.kind === 'cycleway' ? 0.07 : 0.16;
  const rmin = e.kind === 'track' ? (GRAVELLY.has(e.surface) ? 4 : 2.5) : e.kind === 'secondary' ? 7.5 : 2.5;
  const P: number[][] = [];
  let d = 0;
  for (let k = 0; k < e.pts.length; k += 3) {
    if (k) d += Math.hypot(e.pts[k]! - e.pts[k - 3]!, e.pts[k + 2]! - e.pts[k - 1]!);
    P.push([e.pts[k]!, e.pts[k + 1]!, e.pts[k + 2]!, d]);
  }
  let j = 0;
  for (let i = 0; i < P.length; i++) {
    while (j < P.length - 1 && P[j]![3]! - P[i]![3]! < 10) j++;
    const dd = P[j]![3]! - P[i]![3]!;
    if (dd < 8) break;
    if (Math.abs(P[j]![1]! - P[i]![1]!) / dd > lim + 1e-4) console.log("pente", e.name, Math.round(P[i]![0]!), Math.round(P[i]![2]!), ((Math.abs(P[j]![1]! - P[i]![1]!) / dd) * 100).toFixed(1), P.length, i);
  }
  for (let i = 0; i + 6 < P.length; i++) {
    const [a, b, c] = [P[i]!, P[i + 3]!, P[i + 6]!];
    const ab = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
    const bc = Math.hypot(c[0]! - b[0]!, c[2]! - b[2]!);
    const ca = Math.hypot(a[0]! - c[0]!, a[2]! - c[2]!);
    const ar = Math.abs((b[0]! - a[0]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[0]! - a[0]!));
    const r = ar < 1e-9 ? Infinity : (ab * bc * ca) / (2 * ar);
    if (r < rmin) count.set(`rayon ${e.name}`, (count.get(`rayon ${e.name}`) ?? 0) + 1);
  }
}
for (const e of g.edges) {
  const m = e.pts.length / 3;
  for (let i = 4; i + 4 < m; i++) {
    const sag = (e.pts[(i - 4) * 3 + 1]! + e.pts[(i + 4) * 3 + 1]!) / 2 - e.pts[i * 3 + 1]!;
    if (sag > 0.12) {
      count.set(`creux ${e.name} ${Math.round(e.pts[i * 3]!)},${Math.round(e.pts[i * 3 + 2]!)}`, Math.round(sag * 100));
      break;
    }
  }
}
for (const [k, v] of count) console.log(k, v);
console.log(count.size ? 'défauts' : 'aucun défaut');
