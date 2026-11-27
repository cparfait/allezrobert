/** Mise au point : relief en quelques points (`npx tsx probe.ts x,z x,z …`). */
import { fjordEdge, shoreDist, terrainSteps } from './design.ts';

for (const a of process.argv.slice(2)) {
  const [x, z] = a.split(',').map(Number) as [number, number];
  console.log(a, 'fjord', fjordEdge(x, z).toFixed(0), 'rivage', shoreDist(x, z).toFixed(0), JSON.stringify(terrainSteps(x, z)));
}
