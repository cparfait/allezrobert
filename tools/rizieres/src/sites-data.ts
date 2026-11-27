/**
 * Cotes du décor (apps/client/src/world/lands/rizieresSites.ts) tirées du générateur et du monde écrit : ports,
 * Circuit, sommets, lacs, tronçons de rivières, plages, ponts suspendus sur les routes qui franchissent une rivière,
 * passerelles, ruines, troupeaux, bambous, cascades. Imprime le bloc TypeScript à recopier dans le client.
 *
 *   npx tsx tools/rizieres/src/sites-data.ts [dossier du monde]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RoadGraphData } from '../../../packages/shared/src/roadgraph.ts';
import { A, ANNEAU, HARBOURS, LAKES, MASSIF, TEMPLE_HILL, TOWNS, UV, coastPoint, inLake, inRiver, plainZone, riverBeds, shoreDist, terrain, type Vec2 } from './design.ts';

const dir = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../../../apps/client/public/worlds/rizieres'));
const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')) as RoadGraphData;
const places = JSON.parse(readFileSync(join(dir, 'places.json'), 'utf8')) as Array<{ name: string; x: number; z: number }>;
terrain(0, 0);

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pts = (l: Vec2[]) => `[${l.map(([x, z]) => `[${r0(x)}, ${r0(z)}]`).join(', ')}]`;
const town = (id: string) => TOWNS.find((t) => t.id === id)!;
const place = (name: string): Vec2 => {
  const p = places.find((q) => q.name === name);
  if (!p) throw new Error(`lieu absent : ${name}`);
  return [p.x, p.z];
};

// Routes : segments (x, z) pour les distances et les franchissements.
const segs: Array<{ ax: number; az: number; bx: number; bz: number; name: string }> = [];
for (const e of graph.edges) for (let k = 0; k + 5 < e.pts.length; k += 3) segs.push({ ax: e.pts[k]!, az: e.pts[k + 2]!, bx: e.pts[k + 3]!, bz: e.pts[k + 5]!, name: e.name ?? '' });
const roadDist = (x: number, z: number) => {
  let d = Infinity;
  for (const s of segs) {
    if (Math.abs(s.ax - x) > 300 || Math.abs(s.az - z) > 300) continue;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - s.ax - dx * t, z - s.az - dz * t));
  }
  return d;
};

const beds = riverBeds();
const bed = (id: string) => beds.find((b) => b.river.id === id)!;
/** Points d'un lit tous les `step` m entre deux indices (lit : un point tous les 10 m). */
const every = (id: string, i0: number, i1: number, step = 60): Vec2[] => {
  const b = bed(id);
  const out: Vec2[] = [];
  for (let i = Math.max(0, i0); i <= Math.min(b.pts.length - 1, i1); i += step / 10) if (shoreDist(b.pts[i]![0], b.pts[i]![1]) > 20) out.push(b.pts[i]!);
  return out;
};
const nearestIdx = (id: string, p: Vec2) => {
  const b = bed(id);
  let best = 0;
  b.pts.forEach((q, i) => {
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(b.pts[best]![0] - p[0], b.pts[best]![1] - p[1])) best = i;
  });
  return best;
};

// Grand Fleuve : des Pilotis (2,4 km en amont) à l'embouchure ; marché flottant au droit du village.
const fl = bed('grand-fleuve');
const pil = town('les-pilotis');
const iPil = nearestIdx('grand-fleuve', [pil.x, pil.z]);
const FLEUVE = every('grand-fleuve', iPil - 240, fl.pts.length - 1);
const fIdx = (p: Vec2) => FLEUVE.reduce((bi, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(FLEUVE[bi]![0] - p[0], FLEUVE[bi]![1] - p[1]) ? i : bi), 0);
const iMarket = fIdx(fl.pts[iPil]!);
const lag = bed('bras-de-la-lagune');
const BRAS = every('bras-de-la-lagune', 0, lag.pts.length - 1);
const DRAGON = every('riviere-du-dragon', 0, bed('riviere-du-dragon').pts.length - 1);

// Plages.
const jade = town('plage-de-jade');
const ja = Math.atan2(jade.z, jade.x);
const JADE_BEACH: Vec2[] = Array.from({ length: 32 }, (_, i) => coastPoint(ja + 0.145 - (0.2 * i) / 31, 75));
const PITONS_BEACH: Vec2[] = Array.from({ length: 22 }, (_, i) => coastPoint(A(0.7) + (0.5 * i) / 21, 55)).filter(([x, z]) => !HARBOURS.some((h) => Math.hypot(h.x - x, h.z - z) < h.halfLen + 60));

// Ponts suspendus : routes qui franchissent une rivière (un par rivière, loin des villes), cap = sens de la route.
type Bridge = { id: string; x: number; z: number; cap: number; span: number };
const crossings: Array<Bridge & { river: string; score: number }> = [];
for (const s of segs) {
  const mx = (s.ax + s.bx) / 2;
  const mz = (s.az + s.bz) / 2;
  if (!inRiver(mx, mz, 0)) continue;
  for (const b of beds) {
    const k = b.pts.findIndex((q) => Math.hypot(q[0] - mx, q[1] - mz) < b.chan[0]! + b.chan[b.chan.length - 1]! + 10);
    if (k < 0) continue;
    if (crossings.some((c) => Math.hypot(c.x - mx, c.z - mz) < 400)) break;
    crossings.push({ id: '', river: b.river.id, x: mx, z: mz, cap: Math.atan2(s.bz - s.az, s.bx - s.ax), span: Math.round(b.chan[k]! * 2 + 16), score: /Chemin|Sentier|Route/.test(s.name) ? 1 : 0 });
    break;
  }
}
const pick = (river: string, near: Vec2, id: string): Bridge | null => {
  const c = crossings.filter((q) => q.river === river).sort((a, b) => Math.hypot(a.x - near[0], a.z - near[1]) - Math.hypot(b.x - near[0], b.z - near[1]))[0];
  return c ? { id, x: c.x, z: c.z, cap: c.cap, span: c.span } : null;
};
const pont = town('pont-des-lianes');
const SUSPENSION = [pick('bras-des-singes', UV(-14500, -1200), 'pont-du-delta'), pick('riviere-du-dragon', [pont.x, pont.z], 'pont-des-lianes'), pick('grand-fleuve', UV(6000, 900), 'pont-des-singes')].filter((b): b is Bridge => !!b);

// Passerelles : en travers d'une rivière, loin des routes (cap = travers du lit).
const foot = (id: string, river: string, at: Vec2): Bridge | null => {
  const b = bed(river);
  const i0 = nearestIdx(river, at);
  for (let d = 0; d < 120; d += 3)
    for (const i of [i0 + d, i0 - d]) {
      if (i < 1 || i >= b.pts.length - 1) continue;
      const [x, z] = b.pts[i]!;
      if (roadDist(x, z) < 60 || SUSPENSION.some((s) => Math.hypot(s.x - x, s.z - z) < 150)) continue;
      const a = b.pts[i - 1]!;
      const c = b.pts[i + 1]!;
      return { id, x, z, cap: Math.atan2(c[1] - a[1], c[0] - a[0]) + Math.PI / 2, span: Math.round(b.chan[i]! * 2 + 12) };
    }
  return null;
};
const FOOTBRIDGES = [foot('passerelle-des-lianes', 'riviere-du-dragon', [pont.x, pont.z]), foot('passerelle-des-gorges', 'riviere-du-dragon', UV(11800, 5000)), foot('passerelle-du-marche', 'grand-fleuve', FLEUVE[Math.min(FLEUVE.length - 1, iMarket + 14)]!)].filter((b): b is Bridge => !!b);

// Ruines (places.json), troupeaux dans la plaine, bambous, cascades.
const RUINS = [
  ['prasat-vert', 'Ruines de Prasat-Vert', 1.3],
  ['temple-englouti', 'Temple englouti du Dragon', 1],
  ['ruines-du-fleuve', 'Ruines du Fleuve', 1.1],
  ['palais-des-theiers', 'Ruines du Palais des Théiers', 1.2],
] as const;
const HERDS: Vec2[] = [];
for (let k = 0; k < 4000 && HERDS.length < 12; k++) {
  const u = -12500 + ((k * 7919) % 17000);
  const v = -2500 + ((k * 104729) % 5000);
  const [x, z] = UV(u, v);
  if (plainZone(x, z) < 0.5 || inRiver(x, z, 120) || inLake(x, z, 1.4) || roadDist(x, z) < 90) continue;
  if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 300) || Math.hypot(x - ANNEAU.cx, z - ANNEAU.cz) < 900) continue;
  if (HERDS.some((h) => Math.hypot(h[0] - x, h[1] - z) < 1300)) continue;
  HERDS.push([x, z]);
}
const bam = town('le-col');
const BAMBOO: Vec2[] = [[bam.x - 200, bam.z + 200], [bam.x + 250, bam.z - 150], [bam.x - 300, bam.z - 250], [bam.x + 380, bam.z + 260], UV(-5300, -2500), UV(-9800, 2100), UV(8600, 4800), UV(-2600, -5200), UV(-2000, 4100)];
/** Cascade : point le plus raide près de la cible, hors route et hors eau. */
const fall = (id: string, at: Vec2, h: number) => {
  let best: Vec2 = at;
  let bs = -1;
  for (let a = 0; a < 6.28; a += 0.3)
    for (let d = 0; d < 500; d += 40) {
      const x = at[0] + Math.cos(a) * d;
      const z = at[1] + Math.sin(a) * d;
      if (roadDist(x, z) < 40 || inRiver(x, z, 10) || inLake(x, z, 1.2)) continue;
      const y = terrain(x, z);
      const s = Math.max(...[[20, 0], [-20, 0], [0, 20], [0, -20]].map(([p, q]) => Math.abs(terrain(x + p!, z + q!) - y))) / 20;
      if (s < 0.9 && s > bs) {
        bs = s;
        best = [x, z];
      }
    }
  return `{ id: '${id}', x: ${r0(best[0])}, z: ${r0(best[1])}, h: ${h} }`;
};
const lotus = LAKES.find((l) => l.id === 'lac-de-robert')!;
const lagune = LAKES.find((l) => l.id === 'lagune')!;
const port = (id: string) => HARBOURS.find((h) => h.id === id)!;
const H = (id: string) => `x: ${r1(port(id).x)}, z: ${r1(port(id).z)}, dir: ${r3(port(id).dir)}, halfLen: ${port(id).halfLen}, halfWid: ${port(id).halfWid}`;
const vr = town('vat-robert');
const bridge = (b: Bridge) => `  { id: '${b.id}', x: ${r0(b.x)}, z: ${r0(b.z)}, cap: ${r3(b.cap)}, span: ${b.span} },`;

console.log(`// ports : PORT_JADE ${H('port-azur')}
// ports : PORT_PITONS ${H('port-calanque')}
// ports : PORT_JONQUES ${H('port-aber')}
export const RIZIERES_RING = { x: ${ANNEAU.cx}, z: ${ANNEAU.cz}, half: ${ANNEAU.half}, radius: ${ANNEAU.radius} };
const VAT_ROBERT = { x: ${vr.x}, z: ${vr.z}, angle: ${r3(vr.angle)} };
const TEMPLE_HILL: readonly [number, number] = [${TEMPLE_HILL.x}, ${TEMPLE_HILL.z}];
const LANTERN_PEAK: readonly [number, number] = [${r0(MASSIF.phare[0])}, ${r0(MASSIF.phare[1])}];
const TIGER_PEAK: readonly [number, number] = [${r0(MASSIF.mont[0])}, ${r0(MASSIF.mont[1])}];
const BAMBOUSERAIE: readonly [number, number] = [${bam.x}, ${bam.z}];
const LOTUS_LAKE = { x: ${lotus.x}, z: ${lotus.z}, rx: ${lotus.rx}, rz: ${lotus.rz}, rot: ${r3(lotus.rot)}, level: ${lotus.level} };
const LAGOON = { x: ${lagune.x}, z: ${lagune.z}, rx: ${lagune.rx}, rz: ${lagune.rz}, rot: ${r3(lagune.rot)}, level: ${lagune.level} };
const FLEUVE: ReadonlyArray<readonly [number, number]> = ${pts(FLEUVE)};
/** Indice du marché flottant (au droit des Pilotis) dans FLEUVE. */
const FLEUVE_MARKET = ${iMarket};
const BRAS: ReadonlyArray<readonly [number, number]> = ${pts(BRAS)};
const DRAGON: ReadonlyArray<readonly [number, number]> = ${pts(DRAGON)};
/** Indice de Pont-des-Lianes dans DRAGON. */
const DRAGON_PONT = ${DRAGON.reduce((bi, q, i) => (Math.hypot(q[0] - pont.x, q[1] - pont.z) < Math.hypot(DRAGON[bi]![0] - pont.x, DRAGON[bi]![1] - pont.z) ? i : bi), 0)};
const JADE_BEACH: ReadonlyArray<readonly [number, number]> = ${pts(JADE_BEACH)};
const PITONS_BEACH: ReadonlyArray<readonly [number, number]> = ${pts(PITONS_BEACH)};
const SUSPENSION: ReadonlyArray<{ id: string; x: number; z: number; cap: number; span: number }> = [
${SUSPENSION.map(bridge).join('\n')}
];
const FOOTBRIDGES: ReadonlyArray<{ id: string; x: number; z: number; cap: number; span: number }> = [
${FOOTBRIDGES.map(bridge).join('\n')}
];
const RUINS: ReadonlyArray<{ id: string; x: number; z: number; size: number }> = [
${RUINS.map(([id, name, size]) => `  { id: '${id}', x: ${r0(place(name)[0])}, z: ${r0(place(name)[1])}, size: ${size} },`).join('\n')}
];
const HERDS: ReadonlyArray<readonly [number, number]> = ${pts(HERDS)};
const BAMBOO: ReadonlyArray<readonly [number, number]> = ${pts(BAMBOO)};
const FALLS: ReadonlyArray<{ id: string; x: number; z: number; h: number }> = [
  ${fall('cascade-des-nuages', UV(-2900, -5900), 26)},
  ${fall('cascade-du-dragon', UV(11800, 4600), 32)},
];
const BIKE_PARK: readonly [number, number] = [${UV(-600, -4300).map(r0).join(', ')}];
const CYCLO_CROSS: readonly [number, number] = [${UV(-8400, 3300).map(r0).join(', ')}];`);
for (const name of ['Grand Temple de Vat-Robert', 'Temple des Lanternes', 'Stupa du Mont du Tigre', 'Ruines de Prasat-Vert', 'Temple englouti du Dragon', 'Ruines du Fleuve', 'Ruines du Palais des Théiers', 'Pagode des Terrasses', 'Monastère des Lotus', 'Col de la Jungle', 'Ruines du Fort du Dragon', 'Maison de thé des Nuages', 'Séchoir à thé', 'Pêcherie des Mangroves']) {
  const p = places.find((q) => q.name === name);
  console.log(`// lieu ${name} : ${p ? `${r0(p.x)}, ${r0(p.z)}` : 'absent'}`);
}
for (const t of TOWNS) console.log(`// ville ${t.id} : ${t.x}, ${t.z}`);
