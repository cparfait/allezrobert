/**
 * Parcours gravel et VTT des zones ouvertes déjà construites : boucles sur pistes (`track`) tracées sur
 * le graphe publié (`worlds/<zone>/graph.json`), sans nouveau téléchargement. Les points de passage
 * (repère monde, mètres) sont dans `tools/terrain/trail-tours.json` ; ce script recalcule le tracé,
 * écrit `routes/<id>.json` (champ `bike` : gravel ou mtb) et inscrit le parcours dans `world.json` et
 * dans le catalogue `index.json`. Idempotent.
 *
 *   npx tsx src/trail-tours.ts [--only <id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadNet, itineraryRoute, joinItineraries, planItinerary, snapToRoad, type Itinerary, type RoadGraphData, type RoadGraphEdge, type RouteBike, type WorldPlace } from '@allezrobert/shared';
import { asCircuit } from './circuit.ts';
import { elevationGain } from './profile.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORLDS = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');

interface TrailTour {
  zone: string;
  id: string;
  name: string;
  nameEn: string;
  bike: Exclude<RouteBike, 'road'>;
  /** Points de passage [x, z] dans l'ordre ; le parcours revient au premier. */
  via: Array<[number, number]>;
}

const PAVED = /^(asphalt|paved|concrete|chipseal|sett|paving_stones)/;
const unpaved = (e: RoadGraphEdge) => e.kind === 'track' || !PAVED.test(e.surface);
const LOW_TRAFFIC = /^(tertiary|unclassified|residential|living_street|service|cycleway)/;

/** Coût au mètre : pistes d'abord (gravel : un peu de route pour relier), VTT : route évitée. */
function baseCost(e: RoadGraphEdge, bike: TrailTour['bike']): number {
  if (e.border) return 8;
  if (unpaved(e)) return bike === 'mtb' ? 1 : 1.1;
  if (LOW_TRAFFIC.test(e.kind)) return bike === 'mtb' ? 2.8 : 1.5;
  return /^secondary/.test(e.kind) ? 4 : 8;
}

function buildTour(t: TrailTour) {
  const dir = path.join(WORLDS, t.zone);
  const net = new RoadNet(JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8')) as RoadGraphData);
  const places = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8')) as WorldPlace[];
  const snaps = t.via.map(([x, z]) => {
    const s = snapToRoad(net, x, z, 500);
    if (!s) throw new Error(`${t.id} : point (${x}, ${z}) sans route à moins de 500 m`);
    return s;
  });
  // départ : un point de passage proche d'un village ; on préfère le sens et le départ qui se publient en boucle
  const villages = places.filter((p) => /^(village|town)$/.test(p.kind));
  const dist = (s: { x: number; z: number }) => Math.min(...villages.map((p) => Math.hypot(p.x - s.x, p.z - s.z)));
  const order = snaps.map((_, i) => i).sort((i, j) => dist(snaps[i]!) - dist(snaps[j]!));
  let best: ReturnType<typeof asCircuit> | null = null;
  for (const first of order) {
    for (const rev of [false, true]) {
      const rot = [...snaps.slice(first), ...snaps.slice(0, first)];
      const ring = rev ? [rot[0]!, ...rot.slice(1).reverse()] : rot;
      const used = new Set<RoadGraphEdge>();
      const legs: Itinerary[] = [];
      for (let i = 0; i < ring.length; i++) {
        const it = planItinerary(net, ring[i]!, ring[(i + 1) % ring.length]!, (e) => baseCost(e, t.bike) * (used.has(e) ? 3 : 1));
        if (!it) throw new Error(`${t.id} : tronçon ${i} sans chemin`);
        for (const st of it.steps) used.add(net.edge(st.edge));
        legs.push(it);
      }
      const route = itineraryRoute(net, joinItineraries(legs), { id: t.id, name: t.name, nameEn: t.nameEn, places });
      if (!route) throw new Error(`${t.id} : tracé trop court`);
      const cand = asCircuit({ ...route, bike: t.bike });
      if (!best) best = cand;
      if (cand.loop) {
        best = cand;
        break;
      }
    }
    if (best?.loop) break;
  }
  const out = best!;
  out.elevationGainM = Math.round(elevationGain(out.points.map((p) => p.y), out.loop) * 100) / 100;
  let unp = 0;
  for (const s of out.surfaces ?? []) if (!PAVED.test(s.surface)) unp += Math.min(s.endM, out.lengthM) - s.startM;
  return { dir, out, unpavedPct: Math.round((unp / out.lengthM) * 100) };
}

function writeJson(file: string, v: unknown, indent: number) {
  fs.writeFileSync(file, JSON.stringify(v, null, indent) + (indent ? '\n' : ''));
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const tours = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'terrain', 'trail-tours.json'), 'utf8')) as TrailTour[]).filter((t) => !only || t.id === only);
const catFile = path.join(WORLDS, 'index.json');
const cat = JSON.parse(fs.readFileSync(catFile, 'utf8')) as { zones: Array<{ id: string; routes: Array<Record<string, unknown> & { id: string }> }> };
for (const t of tours) {
  const { dir, out, unpavedPct } = buildTour(t);
  fs.writeFileSync(path.join(dir, 'routes', `${t.id}.json`), JSON.stringify(out));
  const metaFile = path.join(dir, 'world.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { routes: Array<Record<string, unknown> & { id: string }> };
  const entry = { id: t.id, file: `routes/${t.id}.json`, name: t.name, lengthM: out.lengthM, elevationGainM: out.elevationGainM, loop: out.loop, main: false, bike: t.bike };
  meta.routes = [...meta.routes.filter((r) => r.id !== t.id), entry];
  writeJson(metaFile, meta, 1);
  const zone = cat.zones.find((z) => z.id === t.zone);
  if (!zone) throw new Error(`${t.zone} absent du catalogue`);
  const { file: _f, main: _m, ...pub } = entry;
  zone.routes = [...zone.routes.filter((r) => r.id !== t.id), { ...pub, nameEn: t.nameEn }];
  console.log(`${t.zone}/${t.id} [${t.bike}] ${(out.lengthM / 1000).toFixed(1)} km, D+ ${out.elevationGainM} m, ${unpavedPct} % non revêtu, boucle ${out.loop}`);
}
writeJson(catFile, cat, 1);
