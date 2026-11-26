/** Mise au point : cotes du monde utiles au décor du client (lands/archipel-des-volcansSites.ts). */
import { readFileSync } from 'node:fs';
import { ANNEAU, CINDER, HARBOURS, LAKES, LAVA_FLOWS, SEA_LINKS, TOWNS, VOLCANO, rimPoint, terrain } from './design.ts';
import { CROSS } from './build.ts';
import { LIGHTHOUSE, OBSERVATORY } from './settle.ts';
const dir = process.argv[2]!;
const g = JSON.parse(readFileSync(`${dir}/graph.json`, 'utf8'));
const r = (v: number) => Math.round(v * 10) / 10;
const sample = (name: string, every: number) => {
  const out: number[][] = [];
  for (const e of g.edges) {
    if (e.name !== name) continue;
    const line: number[] = [];
    let acc = every;
    for (let k = 0; k < e.pts.length; k += 3) {
      if (k) acc += Math.hypot(e.pts[k] - e.pts[k - 3], e.pts[k + 2] - e.pts[k - 1]);
      if (acc >= every || k + 3 >= e.pts.length) {
        line.push(r(e.pts[k]), r(e.pts[k + 1]), r(e.pts[k + 2]));
        acc = 0;
      }
    }
    out.push(line);
  }
  return out;
};
console.log(JSON.stringify({
  harbours: HARBOURS.map((h) => ({ id: h.id, x: r(h.x), z: r(h.z), dir: Math.round(h.dir * 1000) / 1000, halfLen: h.halfLen, halfWid: h.halfWid })),
  towns: TOWNS.map((t) => ({ id: t.id, x: r(t.x), z: r(t.z), level: r(t.level) })),
  links: SEA_LINKS.map((l) => ({ id: l.id, a: l.a.map(r), b: l.b.map(r), deck: l.deck })),
  volcano: { ...VOLCANO, rim: VOLCANO.rim, rimH: r(terrain(...rimPoint(0))), rimPt: rimPoint(28).map(r), lake: LAKES[0]!.level },
  observatory: OBSERVATORY.map(r), obsY: r(terrain(...OBSERVATORY)), lighthouse: LIGHTHOUSE.map(r), lhY: r(terrain(...LIGHTHOUSE)),
  cinder: CINDER, cross: CROSS, anneau: ANNEAU,
  lava: LAVA_FLOWS.map((f) => ({ name: f.name, pts: f.pts, w: f.w })),
  bridge: sample('Pont des Orgues', 30), causeway: sample('La Chaussée', 60), bike: sample('Bike park du Mont Cendre', 25), cross3: sample('Circuit de cyclo-cross', 25),
}));
process.exit(0);
