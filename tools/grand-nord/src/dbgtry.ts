/** Essais de points de passage sur le graphe d'un essai : `tsx dbgtry.ts '<spec json>'` (ISLAND_OUT). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeFlaw } from './build.ts';
import { planRoute } from './routes.ts';

const graph = JSON.parse(readFileSync(join(process.env.ISLAND_OUT!, 'graph.json'), 'utf8'));
for (const a of process.argv.slice(2)) {
  const spec = JSON.parse(a);
  const r = planRoute(graph, { name: 'essai', nameEn: 'try', ...spec });
  console.log(a.slice(0, 120), r ? `${(r.lengthM / 1000).toFixed(1)} km ${routeFlaw(r)} off ${((r.surfaces ?? []).filter((s) => s.surface !== 'asphalt').reduce((s, q) => s + q.endM - q.startM, 0) / r.lengthM).toFixed(2)}` : 'impossible');
}
