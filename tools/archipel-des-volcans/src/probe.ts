/** Mise au point du relief : altitudes de quelques lieux, routes sur la mer (npx tsx tools/archipel-des-volcans/src/probe.ts). */
import { ISLES, LAKES, SEA_LINKS, TOWNS, VOLCANO, rimPoint, shoreDist, terrain } from './design.ts';

const f = (v: number) => v.toFixed(0);
for (const l of SEA_LINKS) console.log(`${l.name} : ${l.a.map(f)} → ${l.b.map(f)} (${f(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]))} m), sol ${terrain(...l.a).toFixed(1)} / ${terrain(...l.b).toFixed(1)}, milieu ${terrain((l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2).toFixed(1)}`);
for (const t of TOWNS) console.log(`${t.name} : ${f(t.x)}, ${f(t.z)}, sol ${terrain(t.x, t.z).toFixed(1)}, niveau ${t.level.toFixed(1)}, rivage ${f(shoreDist(t.x, t.z))}`);
console.log(`volcan : sommet ${terrain(VOLCANO.x + VOLCANO.rim, VOLCANO.z).toFixed(0)} (rebord est), brèche ${terrain(...rimPoint(0)).toFixed(0)}, centre ${terrain(VOLCANO.x, VOLCANO.z).toFixed(0)}`);
for (const l of LAKES) console.log(`${l.id} : niveau ${l.level}`);
for (const I of ISLES) console.log(`${I.name} : centre ${terrain(I.cx, I.cz).toFixed(0)} m`);
// Coupe nord-sud et est-ouest par le volcan.
const row: string[] = [];
for (let r = 0; r <= 9000; r += 500) row.push(`${r}:${terrain(VOLCANO.x, VOLCANO.z + r).toFixed(0)}`);
console.log('coupe sud', row.join(' '));
// Carte ASCII (1 car. = 1 km).
const ch = (h: number) => (h < 0 ? '~' : h < 20 ? '.' : h < 100 ? ':' : h < 300 ? '-' : h < 600 ? '=' : h < 1000 ? '+' : '#');
for (let z = -13000; z < 13000; z += 1000) {
  let s = '';
  for (let x = -19000; x < 19000; x += 500) s += ch(terrain(x, z));
  console.log(s);
}
