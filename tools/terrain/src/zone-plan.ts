/**
 * Proposition automatique de tours en boucle pour une emprise (utilisé par l'outil graphique,
 * voir zone-builder.ts). Processus séparé : `config.ts` y lit la zone temporaire donnée par
 * `TERRAIN_WORLD_JSON`, donc le repère monde est celui de l'emprise dessinée.
 *
 *   TERRAIN_WORLD_JSON=<zone.json> npx tsx src/zone-plan.ts <requete.json>
 *
 * Sortie : lignes `@@progress <texte>` puis une ligne `@@result <JSON>`.
 * Données : mêmes blocs Overpass (donc même cache) que `build:world`, aucun téléchargement en plus
 * lors de la construction ; MNT lu seulement s'il est déjà en cache (jamais téléchargé ici).
 */
import fs from 'node:fs';
import { CORRIDOR_TILES, LOD_LO, TILE_SIZE_M, WORLD } from './config.ts';
import { nearestEdgeOf, routeViaEdges } from './climb.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { Dem } from './dem.ts';
import { wgs84ToWorld, worldToL93, worldToWgs84, type Rect } from './frame.ts';
import { RoadGraph, dijkstra, type Edge } from './graph.ts';
import { rng } from './loop.ts';
import { setOffline } from './net.ts';
import { buildOsmWorld, type Poi } from './osm.ts';
import { coastClauses, fetchOsm, fetchOsmApi, overpassOnce, reachableOverpass, splitBBox, type OsmElement } from './overpass.ts';

interface Request {
  /** Seulement les infos de la zone (lieux, côte) : aucun tour. */
  meta?: boolean;
  /** Détecter la côte (natural=coastline) et activer `sea` avant de télécharger OSM. */
  detectSea?: boolean;
  targetKm: number;
  variants: number;
  seed: number;
  /** Départ choisi (sinon : le plus gros lieu de l'emprise). */
  start?: { lon: number; lat: number };
}

const progress = (s: string) => console.log(`@@progress ${s}`);
const result = (o: unknown) => console.log(`@@result ${JSON.stringify(o)}`);

const req = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Request;
const target = req.targetKm * 1000;

const rect: Rect = {
  minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
  minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
  maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
  maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
};
/** Marge au bord : les routes qui sortent de l'emprise ne sont pas roulables (cul-de-sac au bord). */
const MARGIN = 150;

async function loadOsm(): Promise<OsmElement[]> {
  const bbox = corridorWgs84();
  const mirror = await reachableOverpass();
  if (!mirror) {
    progress('OSM : aucun miroir Overpass joignable, API OpenStreetMap (plus lent)');
    return fetchOsmApi(bbox);
  }
  const chunks = splitBBox(bbox, OSM_CHUNK.lon, OSM_CHUNK.lat);
  const byKey = new Map<string, OsmElement>();
  for (const [i, c] of chunks.entries()) {
    progress(`OSM : bloc ${i + 1}/${chunks.length} (${new URL(mirror).host}, relu du cache s'il existe)`);
    const els = await fetchOsm(bbox, OSM_CHUNK.lon, OSM_CHUNK.lat, WORLD.sea ? coastClauses : undefined, (k) => k.west === c.west && k.south === c.south && k.east === c.east && k.north === c.north);
    for (const el of els) byKey.set(`${el.type}/${el.id}`, el);
  }
  return [...byKey.values()];
}

const within = (p: [number, number], m: number) => p[0] > rect.minX + m && p[0] < rect.maxX - m && p[1] > rect.minZ + m && p[1] < rect.maxZ - m;

/** Côte dans l'emprise ? Petite requête Overpass (une ligne suffit) ; en cas d'échec : non. */
async function hasCoast(): Promise<boolean> {
  try {
    const b = corridorWgs84();
    const q = `[out:json][timeout:25];way["natural"="coastline"](${b.south},${b.west},${b.north},${b.east});out ids 1;`;
    const buf = await overpassOnce(q, 'côte');
    return ((JSON.parse(buf.toString('utf8')) as { elements?: unknown[] }).elements?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let sea = !!WORLD.sea;
  if (req.detectSea) {
    progress('Côte : recherche (OSM)…');
    sea = await hasCoast();
    (WORLD as { sea?: boolean }).sea = sea;
    progress(sea ? 'Côte dans l’emprise : mode « bord de mer »' : 'Pas de côte dans l’emprise');
  }
  const els = await loadOsm();
  progress('Graphe routier…');
  const osm = buildOsmWorld(els);
  if (req.meta) {
    const rank: Record<string, number> = { city: 4, town: 3, village: 2 };
    const places = osm.pois
      .filter((p: Poi) => rank[p.kind] !== undefined && p.name && within([p.x, p.z], 0))
      .map((p: Poi) => ({ p, s: rank[p.kind]! * 10 + Math.log10(1 + (p.population ?? 0)) * 6 - Math.hypot(p.x - (rect.minX + rect.maxX) / 2, p.z - (rect.minZ + rect.maxZ) / 2) / 4000 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ p }) => ({ name: p.name, kind: p.kind, population: p.population ?? null, ...worldToWgs84(p.x, p.z) }));
    result({ meta: { sea, places } });
    return;
  }
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));
  // routes revêtues roulables (comme build:world, sans pistes), entièrement dans l'emprise
  const inside = new Map<number, boolean>();
  const usable = (e: Edge): boolean => {
    let v = inside.get(e.id);
    if (v === undefined) {
      v = e.road.paved && /^(primary|secondary|tertiary|unclassified|residential|living_street|service|cycleway)(_link)?$/.test(e.road.kind) && e.pts.every((p) => within(p, MARGIN));
      inside.set(e.id, v);
    }
    return v;
  };
  // mêmes coûts que le tour de build-open.ts : le tracé proposé est celui qui sera construit
  const cost = (e: Edge) => (!usable(e) ? Infinity : /^(primary|secondary)/.test(e.road.kind) ? e.len * 1.6 : e.road.kind === 'service' ? e.len * 1.4 : e.len);
  const nUsable = g.edges.filter(usable).length;
  progress(`${g.edges.length} arêtes, ${nUsable} roulables dans l'emprise`);
  if (nUsable < 20) throw new Error('presque aucune route revêtue dans cette emprise (OSM)');

  // ---- départ ----
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerZ = (rect.minZ + rect.maxZ) / 2;
  const toWorldXZ = (p: { lon: number; lat: number }): [number, number] => {
    const w = wgs84ToWorld(p.lon, p.lat);
    return [w.x, w.z];
  };
  const named = (e: Edge) => usable(e) && !!e.road.name;
  let startEdge = -1;
  let startXZ: [number, number] = [centerX, centerZ];
  let startName = '';
  if (req.start) {
    startXZ = toWorldXZ(req.start);
    startEdge = nearestEdgeOf(g, startXZ[0], startXZ[1], 300, usable);
    if (startEdge < 0) startEdge = nearestEdgeOf(g, startXZ[0], startXZ[1], 800, usable);
    if (startEdge < 0) throw new Error('départ choisi : aucune route revêtue à moins de 800 m');
  } else {
    const rank: Record<string, number> = { city: 4, town: 3, village: 2, hamlet: 0.5 };
    const cands = osm.pois
      .filter((p: Poi) => rank[p.kind] !== undefined && p.name && within([p.x, p.z], 500))
      .map((p: Poi) => ({ p, s: rank[p.kind]! * 10 + Math.log10(1 + (p.population ?? 0)) * 6 - Math.hypot(p.x - centerX, p.z - centerZ) / 4000 }))
      .sort((a, b) => b.s - a.s);
    for (const { p } of cands) {
      const e = nearestEdgeOf(g, p.x, p.z, 300, named);
      if (e >= 0) {
        startEdge = e;
        startXZ = [p.x, p.z];
        startName = p.name;
        break;
      }
    }
    if (startEdge < 0) {
      startEdge = nearestEdgeOf(g, centerX, centerZ, 4000, named);
      if (startEdge < 0) throw new Error('aucun départ possible : pas de route nommée au centre de l’emprise');
    }
  }
  const sEdge = g.edges[startEdge]!;
  const sMid = sEdge.pts[sEdge.pts.length >> 1]!;
  progress(`Départ : ${startName || sEdge.road.name || 'route sans nom'}`);

  // atteignable depuis le départ (composante connexe roulable)
  const reach = dijkstra(g, sEdge.a, { cost, respectOneway: false });
  const reachable = (e: Edge) => reach.dist.has(e.a) && reach.dist.has(e.b);
  const okEdge = (e: Edge) => usable(e) && reachable(e);

  // ---- MNT en cache (jamais téléchargé) ----
  let dem: Dem | null = null;
  try {
    setOffline(true);
    const lo = new Dem('lo', LOD_LO.resM, 8000);
    const a = worldToL93(rect.minX, rect.maxZ);
    const b = worldToL93(rect.maxX, rect.minZ);
    await lo.ensure(a.e, a.n, b.e - 1e-6, b.n - 1e-6);
    dem = lo;
    progress('MNT en cache : dénivelé estimé');
  } catch (err) {
    progress(`MNT absent du cache (${err instanceof Error ? err.message.slice(0, 80) : ''}) : pas de dénivelé (il sera téléchargé à la construction)`);
  }
  const heightAt = (x: number, z: number): number => {
    if (!dem) return NaN;
    const l = worldToL93(x, z);
    return dem.sample(l.e, l.n);
  };

  // ---- boucles ----
  const rand = rng(req.seed);
  const nBase = target <= 20000 ? 3 : target <= 40000 ? 4 : 5;
  const out: unknown[] = [];
  let nWp = 3;
  const seen: number[][] = [];
  const spare: Array<{ c: Candidate; score: number }> = [];
  let degraded = false;
  let closest: Candidate | null = null; // meilleure boucle rencontrée, même rejetée (pour expliquer l'échec)
  const baseAngle = rand() * Math.PI * 2;
  const tries = Math.max(req.variants * 6, 12);
  for (let v = 0; v < tries && out.length < req.variants; v++) {
    progress(`Boucle ${out.length + 1}/${req.variants} (essai ${v + 1})`);
    const phi = baseAngle + v * 2.399963 + (rand() - 0.5) * 0.3; // angle d'or : directions bien réparties
    nWp = Math.max(2, nBase + [0, -1, 1][v % 3]!);
    let r = target / (2 * Math.PI * 1.35);
    let best: Candidate | null = null;
    for (let it = 0; it < 5; it++) {
      const cand = buildLoop(r, phi);
      if (!cand) {
        r *= 0.8;
        continue;
      }
      if (!best || Math.abs(cand.length - target) < Math.abs(best.length - target)) best = cand;
      const ratio = target / cand.length;
      if (Math.abs(ratio - 1) < 0.08) break;
      r *= Math.min(1.5, Math.max(0.6, ratio));
    }
    if (!best) { progress('  rejet : points de passage sans route'); continue; }
    if (!closest || Math.abs(best.length - target) / target + best.overlap < Math.abs(closest.length - target) / target + closest.overlap) closest = best;
    const lenErr = Math.abs(best.length - target) / target;
    // acceptable de justesse : gardé en réserve, utilisé seulement si aucune boucle propre n'est trouvée
    if (lenErr > 0.25 || best.overlap > 0.15) {
      progress(`  réserve : ${(best.length / 1000).toFixed(1)} km, ${Math.round(best.overlap * 100)} % en doublon`);
      if (lenErr <= 0.4 && best.overlap <= 0.35) spare.push({ c: best, score: lenErr + best.overlap * 2 });
      continue;
    }
    const set = new Set(best.edges);
    if (seen.some((s) => s.filter((e) => set.has(e)).length / Math.max(1, set.size) > 0.7)) { progress('  rejet : trop proche d’une autre boucle'); continue; }
    seen.push([...set]);
    out.push(describe(best));
  }
  if (!out.length && spare.length) {
    degraded = true;
    spare.sort((a, b) => a.score - b.score);
    for (const { c } of spare) {
      const set = new Set(c.edges);
      if (seen.some((q) => q.filter((e) => set.has(e)).length / Math.max(1, set.size) > 0.7)) continue;
      seen.push([...set]);
      out.push(describe(c));
      if (out.length >= req.variants) break;
    }
  }
  if (!out.length) {
    const c = closest as Candidate | null;
    throw new Error(`aucune boucle satisfaisante : agrandir l’emprise ou changer de départ / de longueur${c ? ` (la plus proche : ${(c.length / 1000).toFixed(1)} km pour ${req.targetKm} km visés, ${Math.round(c.overlap * 100)} % en doublon)` : ` (aucun tracé : ${nUsable} tronçons roulables à plus de ${MARGIN} m du bord de l’emprise)`}`);
  }
  result({ degraded, sea, start: { ...worldToWgs84(sMid[0], sMid[1]), name: startName || sEdge.road.name || '' }, targetKm: req.targetKm, hasDem: !!dem, loops: out });

  // ------------------------------------------------------------------------------------------
  interface Candidate {
    edges: number[]; // arêtes du tracé, dans l'ordre
    nodes: number[];
    length: number;
    overlap: number; // part de longueur déjà parcourue
    via: number[]; // arêtes imposées (départ compris au début et à la fin)
  }

  /** Route nommée la plus proche, de plus en plus loin (île, lac, forêt entre le cercle et les routes). */
  function snap(x: number, z: number, far: number): number {
    for (const d of [400, far / 2, far]) {
      const e = nearestEdgeOf(g, x, z, Math.max(400, d), (q) => okEdge(q) && !!q.road.name);
      if (e >= 0) return e;
    }
    return nearestEdgeOf(g, x, z, far, okEdge);
  }

  function trace(startNode: number, edges: number[]): number[] {
    const nodes = [startNode];
    let n = startNode;
    for (const eid of edges) {
      n = g.other(g.edges[eid]!, n);
      nodes.push(n);
    }
    return nodes;
  }

  function buildLoop(radius: number, phi: number): Candidate | null {
    // cercle qui passe par le départ : centre à `radius` dans la direction phi
    const cx = sMid[0] + radius * Math.cos(phi);
    const cz = sMid[1] + radius * Math.sin(phi);
    const via: number[] = [startEdge];
    for (let i = 1; i <= nWp; i++) {
      const a = phi + Math.PI + (i * 2 * Math.PI) / (nWp + 1);
      const x = cx + radius * Math.cos(a);
      const z = cz + radius * Math.sin(a);
      const e = snap(x, z, Math.max(800, radius * 0.6));
      if (e < 0) return null;
      via.push(e);
    }
    via.push(startEdge);
    return finish(via);
  }

  function finish(viaIn: number[]): Candidate | null {
    let route: { start: number; edges: number[] };
    try {
      route = routeViaEdges(g, viaIn, cost);
    } catch {
      return null;
    }
    if (route.edges.length < 4) return null;
    // points de passage tous les ~2,5 km sur des arêtes de la boucle : le tracé ne change pas
    const edges = route.edges;
    const via: number[] = [];
    let since = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = g.edges[edges[i]!]!;
      since += e.len;
      if (since >= 2500 && e.len > 60 && i < edges.length - 2) {
        via.push(edges[i]!);
        since = 0;
      }
    }
    const first = edges[0]!;
    const full = [first, ...via, first];
    let route2 = route;
    try {
      route2 = routeViaEdges(g, full, cost);
    } catch {
      return null;
    }
    const used = new Map<number, number>();
    let length = 0;
    let repeated = 0;
    for (const eid of route2.edges) {
      const n = (used.get(eid) ?? 0) + 1;
      used.set(eid, n);
      length += g.edges[eid]!.len;
      if (n > 1) repeated += g.edges[eid]!.len;
    }
    return { edges: route2.edges, nodes: trace(route2.start, route2.edges), length, overlap: length ? repeated / length : 1, via: full };
  }

  function describe(c: Candidate) {
    // polyligne (L93) et dénivelé
    const poly: Array<[number, number]> = [];
    const hs: number[] = [];
    let kinds: Record<string, number> = {};
    let node = c.nodes[0]!;
    const names = new Set<string>();
    for (const eid of c.edges) {
      const e = g.edges[eid]!;
      const pts = g.orientedPts(e, node);
      for (const p of pts) {
        const l = worldToL93(p[0], p[1]);
        const last = poly[poly.length - 1];
        if (!last || Math.hypot(last[0] - l.e, last[1] - l.n) > 15) {
          poly.push([Math.round(l.e), Math.round(l.n)]);
          hs.push(heightAt(p[0], p[1]));
        }
      }
      kinds[e.road.kind.replace(/_link$/, '')] = (kinds[e.road.kind.replace(/_link$/, '')] ?? 0) + e.len;
      if (e.road.name) names.add(e.road.name);
      node = g.other(e, node);
    }
    let gain: number | null = null;
    if (hs.length && hs.every((h) => Number.isFinite(h))) {
      // lissage léger (pas de bruit de MNT compté en dénivelé)
      const sm = hs.map((_, i) => {
        let s = 0;
        let n = 0;
        for (let k = Math.max(0, i - 3); k <= Math.min(hs.length - 1, i + 3); k++) {
          s += hs[k]!;
          n++;
        }
        return s / n;
      });
      gain = 0;
      for (let i = 1; i < sm.length; i++) gain += Math.max(0, sm[i]! - sm[i - 1]!);
      gain = Math.round(gain);
    }
    // points de passage du JSON de zone : milieu de chaque arête imposée, départ en tête (le retour au départ est implicite)
    const vias = c.via.slice(0, -1).map((eid) => {
      const e = g.edges[eid]!;
      const m = e.pts[e.pts.length >> 1]!;
      const w = worldToWgs84(m[0], m[1]);
      return { lon: Math.round(w.lon * 1e5) / 1e5, lat: Math.round(w.lat * 1e5) / 1e5 };
    });
    const total = Object.values(kinds).reduce((s, v) => s + v, 0) || 1;
    kinds = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Math.round((v / total) * 100)]));
    return { lengthM: Math.round(c.length), gainM: gain, overlapPct: Math.round(c.overlap * 100), kindsPct: kinds, roads: [...names].slice(0, 8), poly, via: vias };
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  console.log(`@@error ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
