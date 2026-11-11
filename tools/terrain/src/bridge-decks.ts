/**
 * Altitude des extrémités de ponts.
 *
 * Le MNT (sol nu) efface les tabliers : un nœud OSM posé au bout d'un pont mais encore au-dessus du vide
 * (voie `bridge` plus courte que l'ouvrage, ou pont en plusieurs voies) reçoit l'altitude de la berge, et
 * le pont, interpolé entre ses nœuds, plonge de plusieurs mètres.
 *
 * Correction prudente : le nœud est remonté au tablier mesuré dans le MNS LiDAR HD seulement si
 *   1. le MNS le long du pont ressemble à un tablier (régulier, pente ≤ 12 %) ;
 *   2. le tablier a des bords : le MNS retombe d'au moins 1 m sur un côté (sinon c'est une dalle large
 *      ou un ouvrage qui passe au-dessus de la route) ;
 *   3. la BD TOPO (`troncon_de_route` hors sol, Z par sommet) donne la même altitude à 1,5 m près ;
 *   4. le nœud est à plus de 1 m sous ce tablier.
 * Tout le reste garde l'altitude du MNT.
 */
import { ORIGIN_L93, TILE_SIZE_M } from './config.ts';
import type { DemStack } from './dem.ts';
import { worldToL93 } from './frame.ts';
import type { Pt } from './geom.ts';
import type { RoadGraph } from './graph.ts';
import { fetchRaster, LAYER_MNS, rasterAt, type Raster } from './lidar.ts';
import { cachePath, fetchCached } from './net.ts';

const WFS = 'https://data.geopf.fr/wfs/ows';
const PAGE = 1000;

/** Pas des stations le long du pont (m). */
export const DECK_STEP_M = 2;
/** Relèvement minimal pour corriger un nœud (m) : en dessous, c'est le bruit du MNS. */
export const DECK_MIN_LIFT_M = 1;
const DECK_MAX_LIFT_M = 60;
const DECK_MAX_GRADE = 0.12;
/** Écart toléré entre le MNS et la BD TOPO (m) : le Z de la BD TOPO vaut ±0,9 m sur les routes au sol. */
export const DECK_BDTOPO_TOL_M = 1.5;

export interface DeckStation {
  /** Abscisse le long du pont (m). */
  s: number;
  /** MNS sur l'axe (médiane axe / ±1 m), NaN si absent. */
  mns: number;
  /** MNS de part et d'autre, au-delà de la chaussée (NaN si absent). */
  left: number;
  right: number;
  /** Z BD TOPO du tronçon hors sol apparié, NaN sinon. */
  bd: number;
}

export type DeckVerdict =
  | { ok: true; ha: number; hb: number; liftA: number; liftB: number }
  | { ok: false; reason: 'court' | 'mns absent' | 'pas un tablier' | 'sans bords' | 'bdtopo absente' | 'bdtopo en désaccord' | 'déjà au niveau' };

const median = (a: number[]): number => {
  const s = a.filter(Number.isFinite).sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const quantile = (a: number[], q: number): number => {
  const s = a.filter(Number.isFinite).sort((u, v) => u - v);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))]! : NaN;
};

/**
 * Décide des altitudes de tablier aux deux bouts d'un pont. `ya`, `yb` : altitudes actuelles des nœuds (MNT).
 * Fonction pure, testée seule.
 */
export function deckVerdict(st: DeckStation[], ya: number, yb: number): DeckVerdict {
  if (st.length < 3) return { ok: false, reason: 'court' };
  const len = st[st.length - 1]!.s - st[0]!.s;
  const have = st.filter((p) => Number.isFinite(p.mns));
  if (have.length < 3 || have.length < st.length * 0.6) return { ok: false, reason: 'mns absent' };
  // altitude de chaque bout : médiane des stations à moins de 6 m
  const endH = (s0: number) => median(have.filter((p) => Math.abs(p.s - s0) <= 6).map((p) => p.mns));
  const ha = endH(st[0]!.s);
  const hb = endH(st[st.length - 1]!.s);
  if (!Number.isFinite(ha) || !Number.isFinite(hb)) return { ok: false, reason: 'mns absent' };
  // 1. forme de tablier : proche de la droite entre ses bouts (un pont en dos d'âne s'en écarte peu)
  const res = have.map((p) => Math.abs(p.mns - (ha + ((hb - ha) * (p.s - st[0]!.s)) / Math.max(1e-6, len))));
  if (Math.abs(hb - ha) > DECK_MAX_GRADE * Math.max(len, 1) + 0.5 || median(res) > 0.6 || quantile(res, 0.9) > 1.5) return { ok: false, reason: 'pas un tablier' };
  // 4. (au plus tôt : cas courant) rien à corriger
  const liftA = ha - ya;
  const liftB = hb - yb;
  const need = (l: number) => l > DECK_MIN_LIFT_M && l < DECK_MAX_LIFT_M;
  if (!need(liftA) && !need(liftB)) return { ok: false, reason: 'déjà au niveau' };
  // 2. bords : sur la majorité des stations, un côté au moins est 1 m sous le tablier
  const edged = have.filter((p) => (Number.isFinite(p.left) && p.mns - p.left > 1) || (Number.isFinite(p.right) && p.mns - p.right > 1)).length;
  if (edged < have.length * 0.5) return { ok: false, reason: 'sans bords' };
  // 3. accord de la BD TOPO
  const both = have.filter((p) => Number.isFinite(p.bd));
  if (both.length < 3 && both.length < have.length * 0.5) return { ok: false, reason: 'bdtopo absente' };
  if (Math.abs(median(both.map((p) => p.bd - p.mns))) > DECK_BDTOPO_TOL_M) return { ok: false, reason: 'bdtopo en désaccord' };
  return { ok: true, ha, hb, liftA, liftB };
}

/** Pente maximale imposée aux voies qui rejoignent un nœud relevé (la correction se répartit sur toute leur longueur). */
export const APPROACH_MAX_GRADE = 0.1;

/** Vrai si relever un nœud de `lift` m garde ses voies d'accès (longueurs en m) sous `APPROACH_MAX_GRADE`. */
export function approachOk(lift: number, approachLens: number[]): boolean {
  return approachLens.every((len) => lift / Math.max(len, 1e-6) <= APPROACH_MAX_GRADE);
}

/** Segment d'un tronçon BD TOPO, en repère monde. `pos` : position par rapport au sol (> 0 pont, < 0 tunnel). */
export interface BdSeg {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  pos: number;
}

/** Tronçons de route BD TOPO d'une tuile de 1 km, avec leur Z (même requête et même cache que `enrich.ts`). */
export async function fetchBdTopoSegs(tx: number, tz: number, origin: { x: number; y: number } = ORIGIN_L93): Promise<BdSeg[]> {
  const eMin = origin.x + tx * TILE_SIZE_M - 50;
  const nMax = origin.y - tz * TILE_SIZE_M + 50;
  const eMax = eMin + TILE_SIZE_M + 100;
  const nMin = nMax - TILE_SIZE_M - 100;
  const out: BdSeg[] = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&SRSNAME=EPSG:2154` +
      `&BBOX=${eMin},${nMin},${eMax},${nMax},EPSG:2154&COUNT=${PAGE}&STARTINDEX=${start}&SORTBY=cleabs&OUTPUTFORMAT=application/json`;
    const buf = await fetchCached(url, cachePath('bdtopo-route', `${eMin}_${nMin}_${eMax}_${nMax}_${start}`, '.json'), {
      timeoutMs: 120000,
      retries: 4,
      validate: (b) => (b[0] === 0x7b ? null : `pas du JSON : ${b.subarray(0, 120).toString()}`),
    });
    const fc = JSON.parse(buf.toString('utf8')) as {
      features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][] | number[][][] } | null }>;
    };
    for (const f of fc.features) {
      if (f.properties.fictif === true || !f.geometry) continue;
      const pos = Number(f.properties.position_par_rapport_au_sol ?? 0) || 0;
      const g = f.geometry;
      const lines = g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [g.coordinates as number[][]];
      for (const line of lines)
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1]!;
          const b = line[i]!;
          // Z absent ou sentinelle (−1000 = non renseigné)
          if (!(a[2]! > -900) || !(b[2]! > -900)) continue;
          out.push({ ax: a[0]! - origin.x, az: origin.y - a[1]!, ay: a[2]!, bx: b[0]! - origin.x, bz: origin.y - b[1]!, by: b[2]!, pos });
        }
    }
    if (fc.features.length < PAGE) break;
  }
  return out;
}

/** Z BD TOPO au droit d'un point (cap `dx, dz` normé) : tronçon de la classe voulue à moins de 8 m et de 30°. */
export function bdTopoZAt(segs: BdSeg[], x: number, z: number, dx: number, dz: number, want: -1 | 0 | 1): number {
  let best = 8;
  let y = NaN;
  for (const s of segs) {
    if (Math.sign(s.pos) !== want) continue;
    const ux = s.bx - s.ax;
    const uz = s.bz - s.az;
    const L2 = ux * ux + uz * uz;
    if (L2 < 1e-6) continue;
    if (Math.abs(ux * dx + uz * dz) / Math.sqrt(L2) < 0.866) continue;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ux + (z - s.az) * uz) / L2));
    const d = Math.hypot(s.ax + ux * t - x, s.az + uz * t - z);
    if (d < best) {
      best = d;
      y = s.ay + (s.by - s.ay) * t;
    }
  }
  return y;
}

/** Stations d'un pont : polyligne monde [x, z], demi-largeur de chaussée. */
export function deckStations(pts: Pt[], halfWidth: number, mnsAt: (x: number, z: number) => number, segs: BdSeg[]): DeckStation[] {
  const out: DeckStation[] = [];
  const side = halfWidth + 6;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) continue;
    const dx = (b[0] - a[0]) / L;
    const dz = (b[1] - a[1]) / L;
    const n = Math.max(1, Math.round(L / DECK_STEP_M));
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / n);
      const z = a[1] + (b[1] - a[1]) * (k / n);
      const at = (o: number) => mnsAt(x - dz * o, z + dx * o);
      out.push({ s: acc + (L * k) / n, mns: median([at(0), at(1), at(-1)]), left: at(side), right: at(-side), bd: bdTopoZAt(segs, x, z, dx, dz, 1) });
    }
    acc += L;
  }
  return out;
}

export interface DeckNodeResult {
  /** Altitude imposée aux nœuds d'extrémité de ponts (identifiant de nœud → m). */
  nodeHeights: Map<number, number>;
  /** Par pont examiné : identifiant OSM, verdict. */
  report: Array<{ wayId: number; kind: string; name: string; lenM: number; verdict: DeckVerdict }>;
  /** Nœuds écartés parce qu'une voie d'accès deviendrait trop raide. */
  steepRejected: number;
}

/** Altitudes de tablier des nœuds d'extrémité de tous les ponts routiers du graphe (MNS et BD TOPO en cache ou téléchargés). */
export async function bridgeNodeHeights(g: RoadGraph, dem: DemStack): Promise<DeckNodeResult> {
  const perNode = new Map<number, number[]>();
  const report: DeckNodeResult['report'] = [];
  const segCache = new Map<string, BdSeg[]>();
  const groups: number[][] = [];
  const mntAt = (p: Pt): number => {
    const l = worldToL93(p[0], p[1]);
    return dem.sample(l.e, l.n);
  };
  for (const e of g.edges) {
    if (!e.road.bridge || e.len < 8 || e.pts.length < 2) continue;
    const xs = e.pts.map((p) => p[0]);
    const zs = e.pts.map((p) => p[1]);
    const half = e.road.width / 2;
    const m = half + 8;
    const lo = worldToL93(Math.min(...xs) - m, Math.max(...zs) + m);
    const hi = worldToL93(Math.max(...xs) + m, Math.min(...zs) - m);
    let mns: Raster;
    try {
      mns = await fetchRaster(LAYER_MNS, lo.e, lo.n, hi.e, hi.n);
    } catch {
      report.push({ wayId: e.road.id, kind: e.road.kind, name: e.road.name ?? '', lenM: e.len, verdict: { ok: false, reason: 'mns absent' } });
      continue;
    }
    const segs: BdSeg[] = [];
    for (let tx = Math.floor(Math.min(...xs) / TILE_SIZE_M); tx <= Math.floor(Math.max(...xs) / TILE_SIZE_M); tx++)
      for (let tz = Math.floor(Math.min(...zs) / TILE_SIZE_M); tz <= Math.floor(Math.max(...zs) / TILE_SIZE_M); tz++) {
        const k = `${tx}_${tz}`;
        let s = segCache.get(k);
        if (!s) {
          try {
            s = (await fetchBdTopoSegs(tx, tz)).filter((q) => q.pos > 0);
          } catch {
            s = [];
          }
          segCache.set(k, s);
        }
        segs.push(...s);
      }
    const st = deckStations(e.pts, half, (x, z) => {
      const l = worldToL93(x, z);
      return rasterAt(mns, l.e, l.n);
    }, segs);
    const verdict = deckVerdict(st, mntAt(e.pts[0]!), mntAt(e.pts[e.pts.length - 1]!));
    report.push({ wayId: e.road.id, kind: e.road.kind, name: e.road.name ?? '', lenM: e.len, verdict });
    if (!verdict.ok) continue;
    const add = (nd: number, h: number, lift: number) => {
      if (lift <= DECK_MIN_LIFT_M) return;
      let l = perNode.get(nd);
      if (!l) perNode.set(nd, (l = []));
      l.push(h);
    };
    add(e.a, verdict.ha, verdict.liftA);
    add(e.b, verdict.hb, verdict.liftB);
    groups.push([verdict.liftA, verdict.liftB].some((l) => l > DECK_MIN_LIFT_M) ? [e.a, e.b].filter((_, i) => [verdict.liftA, verdict.liftB][i]! > DECK_MIN_LIFT_M) : []);
  }
  const cands = new Map<number, number>();
  for (const [nd, hs] of perNode) cands.set(nd, median(hs));
  const base = new Map<number, number>();
  const baseAt = (nd: number): number => {
    let h = base.get(nd);
    if (h === undefined) {
      const p = g.nodePos.get(nd);
      h = p ? mntAt(p) : NaN;
      base.set(nd, h);
    }
    return h;
  };
  const { nodeHeights, rejected } = pruneLifts(cands, groups, g.edges, (nd) => g.adj.get(nd) ?? [], baseAt);
  return { nodeHeights, report, steepRejected: rejected };
}

/** Pente maximale d'un pont après relèvement (au-delà, le tablier mesuré n'est pas celui de la route). */
export const DECK_MAX_FINAL_GRADE = 0.12;

/**
 * Garde les relèvements cohérents, en itérant jusqu'à stabilité :
 * - toute voie touchant un nœud relevé garde une pente finale ≤ max(sa pente d'origine, 10 % accès / 12 % pont) ;
 * - les nœuds d'un même pont sont relevés ensemble ou pas du tout (un seul bout relevé ferait une rampe).
 * `groups` : pour chaque pont retenu, les nœuds qu'il veut relever. `base` : altitude d'un nœud sans correction.
 */
export function pruneLifts(
  cands: Map<number, number>,
  groups: number[][],
  edges: ReadonlyArray<{ a: number; b: number; len: number; road: { bridge: boolean } }>,
  adj: (nd: number) => number[],
  base: (nd: number) => number,
): { nodeHeights: Map<number, number>; rejected: number } {
  const keep = new Map(cands);
  const groupsOf = new Map<number, number[][]>();
  for (const gr of groups)
    for (const nd of gr) {
      let l = groupsOf.get(nd);
      if (!l) groupsOf.set(nd, (l = []));
      l.push(gr);
    }
  const h = (nd: number) => keep.get(nd) ?? base(nd);
  const drop = (nd: number, todo: number[]) => {
    if (!keep.delete(nd)) return;
    // les autres nœuds de ses ponts tombent avec lui
    for (const gr of groupsOf.get(nd) ?? []) for (const o of gr) if (keep.has(o)) todo.push(o);
    // ses voisins sont à revérifier
    for (const eid of adj(nd)) {
      const e = edges[eid]!;
      for (const o of [e.a, e.b]) if (keep.has(o)) todo.push(o);
    }
  };
  let todo = [...keep.keys()];
  while (todo.length) {
    const next: number[] = [];
    for (const nd of todo) {
      if (!keep.has(nd)) continue;
      const bad = adj(nd).some((eid) => {
        const e = edges[eid]!;
        const len = Math.max(e.len, 1e-6);
        const before = Math.abs(base(e.a) - base(e.b)) / len;
        const after = Math.abs(h(e.a) - h(e.b)) / len;
        return after > Math.max(before, e.road.bridge ? DECK_MAX_FINAL_GRADE : APPROACH_MAX_GRADE) + 1e-9;
      });
      if (bad) drop(nd, next);
    }
    todo = next;
  }
  return { nodeHeights: keep, rejected: cands.size - keep.size };
}
