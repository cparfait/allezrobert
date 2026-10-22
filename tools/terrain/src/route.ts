/**
 * Construction d'un itinéraire RouteData à partir d'un cycle orienté du graphe :
 * lissage en plan, rééchantillonnage à ~2 m, profil de chaussée lissé depuis le MNT,
 * segments KOM/sprint nommés d'après les lieux OSM.
 */
import type { RouteData, RouteSegment } from '@allezrobert/shared';
import { ATTRIBUTION, ROUTE_STEP_M } from './config.ts';
import { worldToL93 } from './frame.ts';
import { catmullRomClosed, cumulative, resampleClosed, smooth1d, type Pt } from './geom.ts';
import type { RoadGraph } from './graph.ts';
import type { DemStack } from './dem.ts';
import { cyclePolyline, type DirectedCycle } from './loop.ts';
import type { Poi } from './osm.ts';
import { detectClimbs, detectSprints, elevationGain, smoothRoadProfile, type Climb, type Sprint } from './profile.ts';

export interface BuiltRoute {
  data: RouteData;
  /** Arête du graphe sous chaque point (même indice que data.points). */
  edgeOf: number[];
  climbs: Climb[];
  sprints: Sprint[];
  maxGradePct: number;
  maxGradeChangePer20m: number;
}

const PLACE_KINDS = /^(village|town|hamlet|suburb|neighbourhood|locality|isolated_dwelling|quarter|city)$/;

/** « de » à la française : de Chevreuse, d'Orsigny, du Mesnil, des Molières, de la Madeleine. */
const MASC = /^(Carrefour|Bois|Moulin|Pont|Château|Mont|Val|Petit|Grand|Parc|Port|Trou|Christ|Domaine|Hameau|Clos|Champ|Chêne|Gué|Buisson|Pavillon|Rond-Point|Plateau|Village|Bout|Haut|Fond|Marais|Pré|Vieux|Fort|Moulin|Étang|Prieuré|Manoir|Mesnil|Plessis|Vivier|Rocher)\b/;
const FEM = /^(Plaine|Maison|Ferme|Croix|Mare|Butte|Forêt|Route|Vallée|Côte|Porte|Grange|Fontaine|Petite|Grande|Haute|Basse|Vieille|Tour|Chapelle|Garenne|Futaie|Queue|Lande|Source|Cour|Rue|Sente|Allée|Abbaye)\b/;

export function frenchDe(name: string): string {
  if (MASC.test(name)) return /^[AEIOUYÉÈÊÂÎÔ]/.test(name) ? `de l'${name}` : `du ${name}`;
  if (FEM.test(name)) return /^[AEIOUYÉÈÊÂÎÔ]/.test(name) ? `de l'${name}` : `de la ${name}`;
  if (/^Le /.test(name)) return `du ${name.slice(3)}`;
  if (/^Les /.test(name)) return `des ${name.slice(4)}`;
  if (/^La /.test(name)) return `de la ${name.slice(3)}`;
  if (/^L['’]/.test(name)) return `de l'${name.slice(2)}`;
  if (/^[AEIOUYÉÈÊÂÎÔaeiouyéèêh]/.test(name) && !/^(Hameau|Haut|Hautes?|Hu)/.test(name)) return `d'${name}`;
  return `de ${name}`;
}

export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function nearestPlace(pois: Poi[], x: number, z: number, maxD: number, exclude: Set<string> = new Set()): Poi | null {
  let best: Poi | null = null;
  let bd = maxD;
  for (const p of pois) {
    if (!PLACE_KINDS.test(p.kind) || !p.name || exclude.has(p.name)) continue;
    // les communes « pèsent » plus que les lieux-dits
    const w = /^(village|town|city)$/.test(p.kind) ? 0.7 : 1;
    const d = Math.hypot(p.x - x, p.z - z) * w;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Nom d'une côte : nom de rue explicite (« Côte de … ») sinon « Côte de <lieu> ». */
export function climbName(g: RoadGraph, edgeIds: number[], pois: Poi[], top: Pt, used: Set<string>): string {
  const byName = new Map<string, number>();
  for (const eid of edgeIds) {
    const e = g.edges[eid]!;
    if (e.road.name) byName.set(e.road.name, (byName.get(e.road.name) ?? 0) + e.len);
  }
  const named = [...byName.entries()].sort((a, b) => b[1] - a[1]);
  for (const [n] of named) {
    if (/^(Côte|Rampe|Montée|Grimpette)\b/i.test(n) && !used.has(n)) return n;
    // voie nommée d'après ses lacets : « Route des 17 Tournants » → « Côte des 17 Tournants »
    const m = /^(?:Route|Chemin|Rue|Avenue)\s+(des?\s.*(?:Tournants|Lacets|Virages).*)$/i.exec(n);
    if (m && !used.has(`Côte ${m[1]}`)) return `Côte ${m[1]}`;
  }
  const excl = new Set<string>();
  for (let k = 0; k < 4; k++) {
    const p = nearestPlace(pois, top[0], top[1], 2500, excl);
    if (!p) break;
    const name = `Côte ${frenchDe(p.name)}`;
    if (!used.has(name)) return name;
    excl.add(p.name);
  }
  return `Côte n° ${used.size + 1}`;
}

export function sprintName(pois: Poi[], mid: Pt, used: Set<string>): string {
  const excl = new Set<string>();
  for (let k = 0; k < 4; k++) {
    const p = nearestPlace(pois, mid[0], mid[1], 2500, excl);
    if (!p) break;
    const name = `Sprint ${frenchDe(p.name)}`;
    if (!used.has(name)) return name;
    excl.add(p.name);
  }
  return `Sprint n° ${used.size + 1}`;
}

/** Médiane de trois. */
function med3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export interface BuildRouteOptions {
  id?: string;
  name?: string;
  nameEn?: string;
  /** Lieu de référence pour placer le départ (sinon le plus grand village traversé). */
  startNear?: Pt;
  maxKoms?: number;
  maxSprints?: number;
}

export function buildRoute(g: RoadGraph, cycle: DirectedCycle, dem: DemStack, pois: Poi[], opts: BuildRouteOptions = {}): BuiltRoute {
  // 1. géométrie brute → lissage en plan
  const poly = cyclePolyline(g, cycle);
  const rawCum = cumulative([...poly.pts, poly.pts[0]!]);
  const rawTotal = rawCum[rawCum.length - 1]!;
  const r4 = resampleClosed(poly.pts, 4);
  const sx = smooth1d(r4.pts.map((p) => p[0]), 5 / r4.step, true);
  const sz = smooth1d(r4.pts.map((p) => p[1]), 5 / r4.step, true);
  const smoothPts: Pt[] = sx.map((x, i) => [x, sz[i]!]);
  const dense = catmullRomClosed(smoothPts, 4);
  const fin = resampleClosed(dense, ROUTE_STEP_M);
  let pts = fin.pts;
  const step = fin.step;
  const n = pts.length;
  // arête sous chaque point (par fraction d'abscisse curviligne)
  let edgeOf: number[] = [];
  {
    // projection sur la polyligne brute, au voisinage de l'abscisse attendue
    const m = poly.pts.length;
    let k0 = 0;
    for (let i = 0; i < n; i++) {
      const s = (i / n) * rawTotal;
      while (k0 < m - 1 && rawCum[k0 + 1]! <= s) k0++;
      let best = k0;
      let bd = Infinity;
      const p = pts[i]!;
      for (let dk = -60; dk <= 60; dk++) {
        const k = (((k0 + dk) % m) + m) % m;
        if (Math.abs(rawCum[k]! - s) > 120 && Math.abs(rawCum[k]! - s) < rawTotal - 120) continue;
        const a = poly.pts[k]!;
        const b = poly.pts[(k + 1) % m]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
        const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      edgeOf.push(poly.edgeOf[best]!);
    }
  }
  // 2. altitude sous la chaussée : médiane centre / ±1,5 m latéral
  const sampleH = (p: Pt, q: Pt) => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    const at = (x: number, z: number) => {
      const w = worldToL93(x, z);
      return dem.sample(w.e, w.n);
    };
    return med3(at(p[0], p[1]), at(p[0] + nx * 1.5, p[1] + nz * 1.5), at(p[0] - nx * 1.5, p[1] - nz * 1.5));
  };
  let raw = pts.map((p, i) => sampleH(p, pts[(i + 1) % n]!));
  // ponts et tunnels : interpolation linéaire entre les culées
  const isStructure = edgeOf.map((eid) => {
    const e = g.edges[eid]!;
    return e.road.bridge || e.road.tunnel;
  });
  raw = interpolateMasked(raw, isStructure);
  // 3. rotation provisoire au point le plus bas pour la détection des côtes
  const pre = smoothRoadProfile(raw, step, true);
  let hs = pre.h;
  let xs = pts.map((p) => p[0]);
  let zs = pts.map((p) => p[1]);
  // passages multiples sur une même voie (sorties réelles) : une seule altitude par endroit
  hs = harmonizeOverlaps(xs, zs, hs, edgeOf, step);
  let minI = 0;
  for (let i = 1; i < n; i++) if (hs[i]! < hs[minI]!) minI = i;
  const rot = <T>(a: T[], m: number) => [...a.slice(m), ...a.slice(0, m)];
  hs = rot(hs, minI);
  xs = rot(xs, minI);
  zs = rot(zs, minI);
  edgeOf = rot(edgeOf, minI);
  pts = rot(pts, minI);
  let climbs = detectClimbs(hs, step).sort((a, b) => b.gainM - a.gainM).slice(0, opts.maxKoms ?? 2);
  climbs.sort((a, b) => a.startIdx - b.startIdx);
  let sprints = detectSprints(xs, zs, hs, step, true, climbs.map((c) => [c.startIdx - Math.round(100 / step), c.endIdx + Math.round(100 / step)]));
  // privilégier les sprints sur routes parcourues
  sprints = sprints
    .map((s) => {
      let ridden = 0;
      for (let i = s.startIdx; i < s.endIdx; i++) if (g.edges[edgeOf[i % n]!]!.rides > 0) ridden++;
      return { s, k: s.score + (ridden / Math.max(1, s.endIdx - s.startIdx)) * 0.8 };
    })
    .sort((a, b) => b.k - a.k)
    .map((o) => o.s)
    .slice(0, opts.maxSprints ?? 1);
  // 4. choix du départ : dans le plus long intervalle libre, au plus près du lieu de référence
  const busy: Array<[number, number]> = [
    ...climbs.map((c) => [c.startIdx, c.endIdx] as [number, number]),
    ...sprints.map((s) => [s.startIdx, s.endIdx] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const free = new Uint8Array(n).fill(1);
  const before = Math.round(200 / step);
  const after = Math.round(100 / step);
  for (const [a, b] of busy) for (let i = a - before; i <= b + after; i++) free[((i % n) + n) % n] = 0;
  let ref = opts.startNear;
  if (!ref) {
    const villages = pois
      .filter((p) => /^(village|town)$/.test(p.kind))
      .map((p) => {
        let d = Infinity;
        for (let i = 0; i < n; i += 5) d = Math.min(d, Math.hypot(xs[i]! - p.x, zs[i]! - p.z));
        return { p, d };
      })
      .filter((o) => o.d < 400)
      .sort((a, b) => (b.p.population ?? 0) - (a.p.population ?? 0));
    const v = villages[0]?.p;
    if (v) ref = [v.x, v.z];
  }
  let startI = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (!free[i]) continue;
    const d = ref ? Math.hypot(xs[i]! - ref[0], zs[i]! - ref[1]) : 0;
    if (d < bestD) {
      bestD = d;
      startI = i;
    }
  }
  if (startI < 0) startI = 0;
  hs = rot(hs, startI);
  xs = rot(xs, startI);
  zs = rot(zs, startI);
  edgeOf = rot(edgeOf, startI);
  pts = rot(pts, startI);
  const shift = (i: number) => (((i - startI) % n) + n) % n;
  climbs = climbs.map((c) => ({ ...c, startIdx: shift(c.startIdx), endIdx: shift(c.endIdx) })).filter((c) => c.endIdx > c.startIdx);
  sprints = sprints.map((s) => ({ ...s, startIdx: shift(s.startIdx), endIdx: shift(s.endIdx) })).filter((s) => s.endIdx > s.startIdx);
  // 5. assemblage
  const lengthM = n * step;
  const points = pts.map((_, i) => ({
    x: round2(xs[i]!),
    y: round2(hs[i]!),
    z: round2(zs[i]!),
    d: round2(i * step),
  }));
  const used = new Set<string>();
  const segments: RouteSegment[] = [];
  for (const c of climbs) {
    const ids = edgeOf.slice(c.startIdx, c.endIdx);
    const name = climbName(g, ids, pois, [xs[c.endIdx]!, zs[c.endIdx]!], used);
    used.add(name);
    segments.push({ id: `kom-${slug(name.replace(/^Côte (de la |de l'|de |d'|du |des )?/, ''))}`, kind: 'kom', name, startM: round2(c.startIdx * step), endM: round2(c.endIdx * step), avgGrade: round2(c.avgGrade) });
  }
  for (const s of sprints) {
    const mid = Math.floor((s.startIdx + s.endIdx) / 2);
    const name = sprintName(pois, [xs[mid]!, zs[mid]!], used);
    used.add(name);
    segments.push({ id: `sprint-${slug(name.replace(/^Sprint (de la |de l'|de |d'|du |des )?/, ''))}`, kind: 'sprint', name, startM: round2(s.startIdx * step), endM: round2(s.endIdx * step), avgGrade: round2(s.avgGrade) });
  }
  segments.sort((a, b) => a.startM - b.startM);
  // largeur de chaussée
  const widthAt = edgeOf.map((eid) => g.edges[eid]!.road.width);
  const sortedW = widthAt.slice().sort((a, b) => a - b);
  const roadWidthM = sortedW[Math.floor(sortedW.length / 2)] ?? 5;
  const roadWidths: Array<{ startM: number; endM: number; widthM: number }> = [];
  for (let i = 0; i < n; i++) {
    const w = widthAt[i]!;
    const last = roadWidths[roadWidths.length - 1];
    if (last && last.widthM === w) last.endM = round2((i + 1) * step);
    else roadWidths.push({ startM: round2(i * step), endM: round2((i + 1) * step), widthM: w });
  }
  // villages traversés (repères HUD)
  const landmarks: Array<{ name: string; d: number }> = [];
  for (const p of pois) {
    if (!/^(village|town|hamlet)$/.test(p.kind) || !p.name) continue;
    let bi = -1;
    let bd = /^(village|town)$/.test(p.kind) ? 400 : 250;
    for (let i = 0; i < n; i += 2) {
      const d = Math.hypot(xs[i]! - p.x, zs[i]! - p.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) landmarks.push({ name: p.name, d: round2(bi * step) });
  }
  landmarks.sort((a, b) => a.d - b.d);
  let maxGrade = 0;
  const w = Math.round(10 / step);
  for (let i = 0; i < n; i++) maxGrade = Math.max(maxGrade, Math.abs((hs[(i + w) % n]! - hs[i]!) / (w * step)) * 100);
  const data: RouteData & Record<string, unknown> = {
    id: opts.id ?? 'route',
    name: opts.name ?? 'Boucle',
    ...(opts.nameEn ? { nameEn: opts.nameEn } : {}),
    loop: true,
    lengthM: round2(lengthM),
    elevationGainM: round2(elevationGain(hs, true)),
    points,
    segments,
    roadWidthM,
    roadWidths,
    landmarks,
    stepM: round2(step * 1000) / 1000,
    minElevationM: round2(Math.min(...hs)),
    maxElevationM: round2(Math.max(...hs)),
    maxGradePct: round2(maxGrade),
    attribution: [...ATTRIBUTION],
  };
  return { data, edgeOf, climbs, sprints, maxGradePct: maxGrade, maxGradeChangePer20m: pre.maxGradeChangePer20m };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Remplace les valeurs masquées (ou non finies) par interpolation linéaire circulaire. */
export function interpolateMasked(v: number[], mask: boolean[]): number[] {
  const n = v.length;
  const ok = v.map((x, i) => Number.isFinite(x) && !mask[i]);
  if (!ok.some(Boolean)) return v.map((x) => (Number.isFinite(x) ? x : 0));
  const out = v.slice();
  for (let i = 0; i < n; i++) {
    if (ok[i]) continue;
    let a = i;
    let da = 0;
    while (!ok[(a - 1 + n) % n] && da < n) {
      a = (a - 1 + n) % n;
      da++;
    }
    a = (a - 1 + n) % n;
    da++;
    let b = i;
    let db = 0;
    while (!ok[(b + 1) % n] && db < n) {
      b = (b + 1) % n;
      db++;
    }
    b = (b + 1) % n;
    db++;
    out[i] = (v[a]! * db + v[b]! * da) / (da + db);
  }
  return out;
}

/**
 * Altitude unique là où l'itinéraire repasse sur la même arête (répétitions, fermeture qui
 * reprend une voie déjà roulée) : chaque point superposé (< 2,5 m, même arête, à plus de 60 m
 * le long du parcours) est ramené vers la moyenne des passages. La correction est lissée
 * (σ = 10 m) pour ne pas créer de marche aux entrées/sorties des tronçons communs ; quelques
 * itérations suffisent. Les ponts et ce qu'ils enjambent sont des arêtes distinctes : intacts.
 */
export function harmonizeOverlaps(xs: number[], zs: number[], hs: number[], edgeOf: number[], step: number, iterations = 6): number[] {
  const n = hs.length;
  const cell = 4;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(xs[i]! / cell)}_${Math.floor(zs[i]! / cell)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  const minGap = Math.round(60 / step);
  const partners: number[][] = new Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i]! / cell);
    const cz = Math.floor(zs[i]! / cell);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of grid.get(`${cx + dx}_${cz + dz}`) ?? []) {
          const gap = Math.min(Math.abs(i - j), n - Math.abs(i - j));
          if (gap < minGap || edgeOf[j] !== edgeOf[i]) continue;
          if (Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!) < 2.5) out.push(j);
        }
    if (out.length) any = true;
    partners[i] = out;
  }
  if (!any) return hs;
  let h = hs.slice();
  for (let it = 0; it < iterations; it++) {
    const corr = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const p = partners[i]!;
      if (!p.length) continue;
      let s = h[i]!;
      for (const j of p) s += h[j]!;
      corr[i] = s / (p.length + 1) - h[i]!;
    }
    const sm = smooth1d(corr, 10 / step, true);
    h = h.map((v, i) => v + sm[i]!);
  }
  return h;
}
