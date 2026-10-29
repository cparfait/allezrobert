/**
 * Contrôles automatiques de l'île de Robert (voir docs/ILE_DE_ROBERT.md), relus depuis les fichiers écrits
 * (ce que le jeu chargera vraiment) :
 *
 * - tuiles : fichiers présents, grilles complètes, raccords sans marche entre tuiles voisines ;
 * - sol : aucun point du sol au-dessus d'une route (chaussée et accotements) ;
 * - pentes et rayons : anneau ≤ 1 %, autres routes ≤ 10 % ;
 * - graphe : extrémités posées sur les nœuds, carrefours raccordés, pas de croisement sans nœud, d'un seul tenant ;
 * - bâtiments, bois : jamais sur la chaussée ;
 * - itinéraires : bouclés, mesurés, posés sur les routes, sans demi-tour ni marche.
 *
 *   npx tsx tools/island/src/verify.ts      (relit le monde déjà écrit)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deltaDecodeU16 } from '../../../packages/shared/src/heights.ts';
import type { RoadGraphData } from '../../../packages/shared/src/roadgraph.ts';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';

/** Tolérances (m). */
const TOL_GROUND = 0.02;
const TOL_SEAM = 0.011;
const TOL_NODE = 0.05;
/** Pente maximale (fraction) mesurée sur 10 m. */
const GRADE_RING = 0.01;
/** Pente maximale par catégorie (fraction, sur 10 m). */
function gradeLimit(kind: string, surface: string): number {
  if (kind === 'track') return surface === 'gravel' ? 0.2 : 0.27;
  return ({ cycleway: 0.07, secondary: 0.085, tertiary: 0.105, residential: 0.13, unclassified: 0.135 } as Record<string, number>)[kind] ?? 0.13;
}
const GRADE_WINDOW = 10;
/** Rayon de virage minimal (m) mesuré sur une corde de 2 × 6 m. */
const RADIUS_RING = 150;
/** Rayons minimaux : grandes routes, petites routes de montagne (épingles), chemins. */
const RADIUS_ROAD = 7.5;
const RADIUS_SMALL = 5;
const RADIUS_TRACK = 4;
const RING_NAME = "L'Anneau";

interface Grid {
  n: number;
  res: number;
  x0: number;
  z0: number;
  h: Float32Array;
}

type Seg = { ax: number; ay: number; az: number; bx: number; by: number; bz: number };

export function verifyWorld(dir: string): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const check = (name: string, errors: string[], detail = '') => {
    if (errors.length) {
      ok = false;
      lines.push(`✘ ${name} : ${errors.length} défaut${errors.length > 1 ? 's' : ''}${detail ? ` (${detail})` : ''}`);
      for (const e of errors.slice(0, 8)) lines.push(`    · ${e}`);
      if (errors.length > 8) lines.push(`    · … ${errors.length - 8} de plus`);
    } else lines.push(`✔ ${name}${detail ? ` (${detail})` : ''}`);
  };
  const f = (v: number, d = 2) => v.toFixed(d);
  const at = (x: number, z: number) => `(${f(x, 0)}, ${f(z, 0)})`;

  const meta = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldMeta;
  const T = meta.tileSizeM;
  const tilesDir = join(dir, 'tiles');

  // ── Tuiles : fichiers et grilles ──
  const tiles = new Map<string, WorldTile>();
  const grids = new Map<string, Grid>();
  {
    const errors: string[] = [];
    for (const t of meta.tiles) {
      const jf = join(tilesDir, `${t.id}.json`);
      if (!existsSync(jf)) {
        errors.push(`${t.id}.json absent`);
        continue;
      }
      const tile = JSON.parse(readFileSync(jf, 'utf8')) as WorldTile;
      tiles.set(t.id, tile);
      if (!tile.heights.delta) errors.push(`${t.id} : altitudes non codées en différences`);
      if (tile.heights.baseM !== t.baseM) errors.push(`${t.id} : baseM ${tile.heights.baseM} ≠ index ${t.baseM}`);
      for (const lod of meta.lods) {
        if (!t.lods.includes(lod.id)) continue;
        const file = join(tilesDir, `${t.id}${lod.suffix}`);
        if (!existsSync(file)) {
          errors.push(`${t.id}${lod.suffix} absent`);
          continue;
        }
        const buf = readFileSync(file);
        const N = lod.n + 1;
        if (buf.length !== N * N * 2) {
          errors.push(`${t.id}${lod.suffix} : ${buf.length} octets au lieu de ${N * N * 2}`);
          continue;
        }
        const q = new Uint16Array(N * N);
        for (let k = 0; k < N * N; k++) q[k] = buf.readUInt16LE(k * 2);
        deltaDecodeU16(q, lod.n);
        const stepM = t.stepM ?? meta.heightEncoding.stepM;
        const h = new Float32Array(N * N);
        let mn = Infinity;
        let mx = -Infinity;
        for (let k = 0; k < N * N; k++) {
          h[k] = t.baseM + q[k]! * stepM;
          mn = Math.min(mn, h[k]!);
          mx = Math.max(mx, h[k]!);
        }
        if (lod.id === 'hi' || !t.lods.includes('hi')) {
          if (Math.abs(mn - t.minM) > 0.02 || Math.abs(mx - t.maxM) > 0.02) errors.push(`${t.id}${lod.suffix} : min/max ${f(mn)}/${f(mx)} ≠ index ${t.minM}/${t.maxM}`);
        }
        grids.set(`${t.id}.${lod.id}`, { n: lod.n, res: lod.resolutionM, x0: t.tx * T, z0: t.tz * T, h });
      }
    }
    check('tuiles', errors, `${meta.tiles.length} tuiles, ${meta.tiles.filter((t) => t.lods.includes('hi')).length} en 2 m`);
  }

  /** Sol le plus fin disponible au point (grille 2 m, sinon 8 m), interpolation bilinéaire comme le jeu. */
  const ground = (x: number, z: number): number => {
    const tx = Math.floor(x / T);
    const tz = Math.floor(z / T);
    const g = grids.get(`${tx}_${tz}.hi`) ?? grids.get(`${tx}_${tz}.lo`);
    if (!g) return Number.NaN;
    return sample(g, x, z);
  };

  // ── Raccords des tuiles : bords communs identiques (même finesse) ──
  {
    const errors: string[] = [];
    let worst = 0;
    for (const t of meta.tiles) {
      for (const lod of ['hi', 'lo'] as const) {
        const a = grids.get(`${t.id}.${lod}`);
        if (!a) continue;
        const N = a.n + 1;
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          const b = grids.get(`${t.tx + dx}_${t.tz + dz}.${lod}`);
          if (!b) continue;
          let m = 0;
          for (let k = 0; k < N; k++) {
            const ha = dx ? a.h[k * N + a.n]! : a.h[a.n * N + k]!;
            const hb = dx ? b.h[k * N]! : b.h[k]!;
            m = Math.max(m, Math.abs(ha - hb));
          }
          worst = Math.max(worst, m);
          if (m > TOL_SEAM) errors.push(`${t.id} → ${t.tx + dx}_${t.tz + dz} (${lod}) : marche de ${f(m * 100, 1)} cm`);
        }
      }
      // Grille grossière et grille fine d'une même tuile : mêmes altitudes aux points communs.
      const hi = grids.get(`${t.id}.hi`);
      const lo = grids.get(`${t.id}.lo`);
      if (hi && lo) {
        const r = Math.round(lo.res / hi.res);
        let m = 0;
        for (let j = 0; j <= lo.n; j++) for (let i = 0; i <= lo.n; i++) m = Math.max(m, Math.abs(lo.h[j * (lo.n + 1) + i]! - hi.h[j * r * (hi.n + 1) + i * r]!));
        if (m > TOL_SEAM) errors.push(`${t.id} : grilles 8 m et 2 m écartées de ${f(m * 100, 1)} cm`);
      }
    }
    check('raccords des tuiles', errors, `écart max ${f(worst * 100, 1)} cm`);
  }

  // ── Routes des tuiles : morceaux, segments, index spatial ──
  interface RoadPiece {
    tile: string;
    id: string;
    name: string;
    kind: string;
    width: number;
    flat: number;
    pts: number[];
  }
  const pieces: RoadPiece[] = [];
  for (const [id, tile] of tiles)
    for (const r of tile.roads) pieces.push({ tile: id, id: r.id, name: r.name ?? '', kind: r.kind, width: r.width, flat: r.flatten?.[0] ?? r.width / 2, pts: r.pts });
  const segIndex = new SegIndex(20);
  for (const p of pieces)
    for (let k = 0; k + 5 < p.pts.length; k += 3)
      segIndex.add({ ax: p.pts[k]!, ay: p.pts[k + 1]!, az: p.pts[k + 2]!, bx: p.pts[k + 3]!, by: p.pts[k + 4]!, bz: p.pts[k + 5]! }, p);

  // ── Sol sous les routes ──
  {
    const errors: string[] = [];
    let samples = 0;
    let worst = 0;
    for (const p of pieces) {
      for (let k = 0; k + 5 < p.pts.length; k += 3) {
        const ax = p.pts[k]!;
        const ay = p.pts[k + 1]!;
        const az = p.pts[k + 2]!;
        const bx = p.pts[k + 3]!;
        const by = p.pts[k + 4]!;
        const bz = p.pts[k + 5]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const steps = Math.max(1, Math.ceil(len));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = ax + (bx - ax) * t;
          const cz = az + (bz - az) * t;
          const y = ay + (by - ay) * t;
          for (let o = -p.flat; o <= p.flat + 1e-6; o += 0.5) {
            const x = cx + nx * o;
            const z = cz + nz * o;
            const h = ground(x, z);
            if (!Number.isFinite(h)) continue;
            samples++;
            const over = h - y;
            if (over <= TOL_GROUND) continue;
            // Carrefour : le point appartient aussi à la chaussée d'une autre route, plus haute ici.
            const other = segIndex.near(x, z, 0).some(({ seg, data }) => {
              if (data === p) return false;
              const q = proj(x, z, seg);
              return q.d <= (data as RoadPiece).flat && h - (seg.ay + (seg.by - seg.ay) * q.t) <= TOL_GROUND;
            });
            if (other) continue;
            worst = Math.max(worst, over);
            if (errors.length < 200) errors.push(`${p.name || p.id} ${at(x, z)} : sol ${f(over * 100, 0)} cm au-dessus de la route`);
          }
        }
      }
    }
    check('sol sous les routes', errors, `${samples} points, dépassement max ${f(worst * 100, 1)} cm`);
  }

  // ── Graphe routier ──
  const graph = meta.open ? (JSON.parse(readFileSync(join(dir, meta.open.graph), 'utf8')) as RoadGraphData) : null;
  if (graph) {
    const errors: string[] = [];
    const nodeCount = graph.nodes.length / 3;
    const deg = new Array<number>(nodeCount).fill(0);
    const node = (i: number) => [graph.nodes[i * 3]!, graph.nodes[i * 3 + 1]!, graph.nodes[i * 3 + 2]!] as const;
    graph.edges.forEach((e, ei) => {
      deg[e.a]!++;
      deg[e.b]!++;
      const p = e.pts;
      const m = p.length;
      for (const [ni, k] of [[e.a, 0], [e.b, m - 3]] as const) {
        const n = node(ni);
        if (Math.hypot(n[0] - p[k]!, n[2] - p[k + 2]!) > TOL_NODE || Math.abs(n[1] - p[k + 1]!) > TOL_NODE)
          errors.push(`arête ${ei} (${e.name}) : extrémité ${at(p[k]!, p[k + 2]!)} hors du nœud ${ni}`);
      }
      let len = 0;
      for (let k = 3; k < m; k += 3) len += Math.hypot(p[k]! - p[k - 3]!, p[k + 2]! - p[k - 1]!);
      if (Math.abs(len - e.len) > 0.1) errors.push(`arête ${ei} (${e.name}) : longueur ${f(len)} ≠ ${e.len}`);
    });
    deg.forEach((d, i) => d === 0 && errors.push(`nœud ${i} isolé`));
    // Un seul tenant.
    const parent = Array.from({ length: nodeCount }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (const e of graph.edges) parent[find(e.a)] = find(e.b);
    const comps = new Set(Array.from({ length: nodeCount }, (_, i) => find(i))).size;
    if (comps > 1) {
      const size = new Map<number, number>();
      for (let i = 0; i < nodeCount; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
      const big = [...size.entries()].sort((p, q) => q[1] - p[1])[0]![0];
      const small = [...size.keys()].filter((k) => k !== big).map((k) => `${size.get(k)} nœuds vers ${at(node(k)[0], node(k)[2])} (${graph.edges.find((e) => find(e.a) === k)?.name ?? '?'})`);
      errors.push(`réseau en ${comps} morceaux : ${small.join(' ; ')}`);
    }
    // Culs-de-sac : jamais à quelques mètres d'une autre route (carrefour oublié).
    const edgeSegs = new SegIndex(20);
    graph.edges.forEach((e, ei) => {
      for (let k = 0; k + 5 < e.pts.length; k += 3)
        edgeSegs.add({ ax: e.pts[k]!, ay: e.pts[k + 1]!, az: e.pts[k + 2]!, bx: e.pts[k + 3]!, by: e.pts[k + 4]!, bz: e.pts[k + 5]! }, ei);
    });
    let deadEnds = 0;
    deg.forEach((d, i) => {
      if (d !== 1) return;
      deadEnds++;
      const [x, , z] = node(i);
      const mine = graph.edges.findIndex((e) => e.a === i || e.b === i);
      const close = edgeSegs.near(x, z, 8).find(({ seg, data }) => data !== mine && proj(x, z, seg).d < 8);
      if (close) errors.push(`cul-de-sac ${at(x, z)} (${graph.edges[mine]!.name}) à ${f(proj(x, z, close.seg).d, 1)} m de ${graph.edges[close.data as number]!.name} sans carrefour`);
    });
    // Croisements sans nœud.
    const crossings = new Set<string>();
    graph.edges.forEach((e, ei) => {
      for (let k = 0; k + 5 < e.pts.length; k += 3) {
        const s: Seg = { ax: e.pts[k]!, ay: e.pts[k + 1]!, az: e.pts[k + 2]!, bx: e.pts[k + 3]!, by: e.pts[k + 4]!, bz: e.pts[k + 5]! };
        for (const { seg, data } of edgeSegs.near((s.ax + s.bx) / 2, (s.az + s.bz) / 2, 3)) {
          const ej = data as number;
          if (ej <= ei) continue;
          const c = intersect(s, seg, true);
          if (!c) continue;
          // Croisement au droit d'un nœud commun : carrefour, normal.
          const shared = [e.a, e.b].filter((n) => n === graph.edges[ej]!.a || n === graph.edges[ej]!.b);
          if (shared.some((n) => Math.hypot(node(n)[0] - c[0], node(n)[2] - c[1]) < 6)) continue;
          const key = `${ei}-${ej}-${Math.round(c[0])}-${Math.round(c[1])}`;
          if (crossings.has(key)) continue;
          crossings.add(key);
          errors.push(`${e.name} croise ${graph.edges[ej]!.name} ${at(c[0], c[1])} sans carrefour`);
        }
      }
    });
    const nodeHash = new Map<string, number[]>();
    for (let i = 0; i < nodeCount; i++)
      for (const dx of [-1, 0, 1])
        for (const dz of [-1, 0, 1]) {
          const k = `${Math.round(node(i)[0]) + dx},${Math.round(node(i)[2]) + dz}`;
          (nodeHash.get(k) ?? nodeHash.set(k, []).get(k)!).push(i);
        }
    // Morceaux de route des tuiles : chaque extrémité est sur un bord de tuile ou sur un nœud du graphe.
    for (const p of pieces) {
      const t = tiles.get(p.tile)!;
      for (const k of [0, p.pts.length - 3]) {
        const x = p.pts[k]!;
        const z = p.pts[k + 2]!;
        const onEdge = Math.min(Math.abs(x - t.bounds.minX), Math.abs(x - t.bounds.maxX), Math.abs(z - t.bounds.minZ), Math.abs(z - t.bounds.maxZ)) < 0.02;
        if (onEdge) continue;
        const onNode = (nodeHash.get(`${Math.round(x)},${Math.round(z)}`) ?? []).some((i) => Math.hypot(node(i)[0] - x, node(i)[2] - z) < 0.5);
        // Boucle fermée dans la tuile : extrémités confondues.
        const closed = Math.hypot(p.pts[0]! - p.pts[p.pts.length - 3]!, p.pts[2]! - p.pts[p.pts.length - 1]!) < 0.05;
        if (!onNode && !closed) errors.push(`${p.name || p.id} : extrémité ${at(x, z)} ni au bord de la tuile ni sur un nœud`);
      }
    }
    // Départ du roulage libre sur une route.
    const s = meta.open!.start;
    const d0 = Math.min(...edgeSegs.near(s.x, s.z, 15).map(({ seg }) => proj(s.x, s.z, seg).d), Infinity);
    if (!(d0 < 15)) errors.push(`départ libre ${at(s.x, s.z)} loin de toute route`);
    check('graphe routier', errors, `${nodeCount} nœuds, ${graph.edges.length} arêtes, ${deadEnds} culs-de-sac`);

    // ── Carrefours francs : deux routes ne partent jamais d'un nœud à moins de 20° l'une de l'autre ──
    const jErr: string[] = [];
    const dirs = new Map<number, Array<{ a: number; e: number }>>();
    graph.edges.forEach((e, ei) => {
      const m = e.pts.length / 3;
      const away = (from: number, step: number) => {
        let k = from;
        let L = 0;
        while (k + step >= 0 && k + step < m && L < 8) {
          L += Math.hypot(e.pts[(k + step) * 3]! - e.pts[k * 3]!, e.pts[(k + step) * 3 + 2]! - e.pts[k * 3 + 2]!);
          k += step;
        }
        return Math.atan2(e.pts[k * 3 + 2]! - e.pts[from * 3 + 2]!, e.pts[k * 3]! - e.pts[from * 3]!);
      };
      (dirs.get(e.a) ?? dirs.set(e.a, []).get(e.a)!).push({ a: away(0, 1), e: ei });
      (dirs.get(e.b) ?? dirs.set(e.b, []).get(e.b)!).push({ a: away(m - 1, -1), e: ei });
    });
    for (const [n, l] of dirs)
      for (let i = 0; i < l.length; i++)
        for (let j = i + 1; j < l.length; j++) {
          let t = Math.abs(l[i]!.a - l[j]!.a);
          if (t > Math.PI) t = 2 * Math.PI - t;
          const trails = graph.edges[l[i]!.e]!.kind === 'track' && graph.edges[l[j]!.e]!.kind === 'track';
          if (t < ((trails ? 10 : 20) * Math.PI) / 180 && jErr.length < 60) jErr.push(`${graph.edges[l[i]!.e]!.name} / ${graph.edges[l[j]!.e]!.name} ${at(node(n)[0], node(n)[2])} : raccord en biseau (${f((t * 180) / Math.PI, 0)}°)`);
        }
    check('carrefours francs', jErr);

    // ── Pentes et rayons, sur les routes entières (arêtes du graphe) ──
    const gErr: string[] = [];
    const radiusSeen = new Set<string>();
    let ringMax = 0;
    let roadMax = 0;
    let ringMinR = Infinity;
    let roadMinR = Infinity;
    graph.edges.forEach((e) => {
      const ring = e.name === RING_NAME;
      const pts: Array<[number, number, number, number]> = [];
      let d = 0;
      for (let k = 0; k < e.pts.length; k += 3) {
        if (k) d += Math.hypot(e.pts[k]! - e.pts[k - 3]!, e.pts[k + 2]! - e.pts[k - 1]!);
        pts.push([e.pts[k]!, e.pts[k + 1]!, e.pts[k + 2]!, d]);
      }
      let j = 0;
      for (let i = 0; i < pts.length; i++) {
        while (j < pts.length - 1 && pts[j]![3] - pts[i]![3] < GRADE_WINDOW) j++;
        const dd = pts[j]![3] - pts[i]![3];
        if (dd < GRADE_WINDOW * 0.8) break;
        const g = Math.abs(pts[j]![1] - pts[i]![1]) / dd;
        if (ring) ringMax = Math.max(ringMax, g);
        else roadMax = Math.max(roadMax, g);
        if (g > (ring ? GRADE_RING : gradeLimit(e.kind, e.surface)) + 1e-4 && gErr.length < 100) gErr.push(`${e.name} (${e.kind}) ${at(pts[i]![0], pts[i]![2])} : pente ${f(g * 100, 1)} %`);
      }
      // Rayon du cercle passant par trois points espacés de ≈ 6 m.
      for (let i = 0; i + 6 < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[i + 3]!;
        const c = pts[i + 6]!;
        const r = circumradius(a[0], a[2], b[0], b[2], c[0], c[2]);
        if (ring) ringMinR = Math.min(ringMinR, r);
        else roadMinR = Math.min(roadMinR, r);
        if (r < (ring ? RADIUS_RING : e.kind === 'track' ? RADIUS_TRACK : e.kind === 'secondary' ? RADIUS_ROAD : RADIUS_SMALL) && gErr.length < 100) {
          // Un message par virage (points voisins regroupés).
          const key = `${e.name}|${Math.round(b[0] / 40)}|${Math.round(b[2] / 40)}`;
          if (!radiusSeen.has(key)) {
            radiusSeen.add(key);
            gErr.push(`${e.name} (${e.kind}) ${at(b[0], b[2])} : virage de ${f(r, 0)} m de rayon`);
          }
        }
      }
    });
    check('pentes et rayons', gErr, `anneau ${f(ringMax * 100, 2)} % / R ≥ ${f(ringMinR, 0)} m, routes ${f(roadMax * 100, 1)} % / R ≥ ${f(roadMinR, 0)} m`);
  }

  // ── Bâtiments et bois hors de la chaussée ──
  {
    const errors: string[] = [];
    let nb = 0;
    let nf = 0;
    for (const tile of tiles.values()) {
      for (const b of tile.buildings) {
        nb++;
        if (!b.roof) errors.push(`${b.id} : toit absent`);
        const poly: Array<[number, number]> = [];
        for (let k = 0; k < b.pts.length; k += 2) poly.push([b.pts[k]!, b.pts[k + 1]!]);
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
        const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const reach = Math.max(...poly.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
        for (const { seg, data } of segIndex.near(cx, cz, reach + 10)) {
          const r = data as RoadPiece;
          const d = polySegDist(poly, seg);
          if (d < r.width / 2 + 0.5) {
            errors.push(`${b.id} (${b.kind}) ${at(cx, cz)} à ${f(d, 1)} m de l'axe de ${r.name || r.id}`);
            break;
          }
        }
        // Posé sur le sol : jamais en l'air (le jeu prolonge les murs vers le bas, pas vers le haut).
        const hmin = Math.min(...poly.map(([x, z]) => ground(x, z)));
        if (b.y > hmin + 0.05) errors.push(`${b.id} : posé à ${f(b.y)} m, sol à ${f(hmin)} m (en l'air)`);
        if (hmin < 0.3) errors.push(`${b.id} (${b.kind}) ${at(cx, cz)} : les pieds dans l'eau (sol à ${f(hmin)} m)`);
      }
      // Bois : contours rastérisés (pair-impair, trous compris), chaussée testée tous les 2 m.
      for (const fo of tile.forests) {
        nf++;
        const mask = rasterize(fo.rings, tile.bounds.minX, tile.bounds.minZ, 2, 500);
        let hit = false;
        for (const p of pieces) {
          if (p.tile !== tile.id || hit) continue;
          for (let k = 0; k + 5 < p.pts.length && !hit; k += 3) {
            const x = p.pts[k]!;
            const z = p.pts[k + 2]!;
            const dx = p.pts[k + 3]! - x;
            const dz = p.pts[k + 5]! - z;
            const l = Math.hypot(dx, dz) || 1;
            for (const o of [-p.width / 2, 0, p.width / 2]) {
              const qx = x - (dz / l) * o;
              const qz = z + (dx / l) * o;
              const i = Math.floor((qx - tile.bounds.minX) / 2);
              const j = Math.floor((qz - tile.bounds.minZ) / 2);
              if (i >= 0 && j >= 0 && i < 500 && j < 500 && mask[j * 500 + i]) {
                errors.push(`bois ${fo.id} sur ${p.name || p.id} ${at(qx, qz)}`);
                hit = true;
                break;
              }
            }
          }
        }
      }
      // Eau courante jamais sur la chaussée (busage aux croisements).
      for (const w of tile.waterways) {
        for (let k = 0; k + 1 < w.pts.length; k += 2) {
          const x = w.pts[k]!;
          const z = w.pts[k + 1]!;
          const close = segIndex.near(x, z, 8).find(({ seg, data }) => proj(x, z, seg).d < (data as RoadPiece).width / 2 + w.width / 2 + 0.5);
          if (close) {
            errors.push(`${w.name ?? 'cours d\u2019eau'} ${at(x, z)} sur ${(close.data as RoadPiece).name}`);
            break;
          }
        }
      }
      for (const [k, v] of [['arbres', tile.trees], ['buissons', tile.shrubs]] as const) {
        if (!v) continue;
        for (let i = 0; i + 1 < v.length; i += k === 'arbres' ? 3 : 3) {
          const x = v[i]!;
          const z = v[i + 1]!;
          const close = segIndex.near(x, z, 5).find(({ seg, data }) => proj(x, z, seg).d < (data as RoadPiece).width / 2 + 0.5);
          if (close) errors.push(`${k} ${at(x, z)} sur ${(close.data as RoadPiece).name}`);
        }
      }
    }
    check('bâtiments, bois et eau hors chaussée', errors, `${nb} bâtiments, ${nf} bois`);
  }

  // ── Itinéraires ──
  for (const ri of meta.routes) {
    const errors: string[] = [];
    const file = join(dir, ri.file);
    if (!existsSync(file)) {
      check(`itinéraire ${ri.id}`, [`${ri.file} absent`]);
      continue;
    }
    const r = JSON.parse(readFileSync(file, 'utf8')) as RouteData;
    const P = r.points;
    const ring = ri.id === 'anneau';
    let d = 0;
    let maxStepY = 0;
    let maxGap = 0;
    let maxOff = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!;
      if (i) {
        const step = Math.hypot(p.x - P[i - 1]!.x, p.z - P[i - 1]!.z);
        d += step;
        maxGap = Math.max(maxGap, step);
        if (step < 0.5 || step > 3) errors.push(`pas de ${f(step)} m au point ${i} ${at(p.x, p.z)}`);
        maxStepY = Math.max(maxStepY, Math.abs(p.y - P[i - 1]!.y));
      }
      if (Math.abs(p.d - d) > 0.05) {
        errors.push(`distance cumulée fausse au point ${i} : ${p.d} au lieu de ${f(d)}`);
        break;
      }
      // Posé sur une route du monde.
      const off = Math.min(Infinity, ...segIndex.near(p.x, p.z, 3).map(({ seg }) => proj(p.x, p.z, seg).d));
      maxOff = Math.max(maxOff, off);
      if (off > 0.5 && errors.length < 50) errors.push(`point ${i} ${at(p.x, p.z)} hors des routes (${Number.isFinite(off) ? f(off, 1) + ' m' : 'aucune'})`);
    }
    if (r.loop !== ri.loop) errors.push(`boucle : itinéraire ${r.loop}, index ${ri.loop}`);
    if (r.loop) {
      const a = P[0]!;
      const b = P[P.length - 1]!;
      const close = Math.hypot(a.x - b.x, a.z - b.z);
      if (close < 0.5 || close > 3) errors.push(`boucle mal fermée : ${f(close)} m entre le dernier et le premier point`);
      maxStepY = Math.max(maxStepY, Math.abs(a.y - b.y));
      d += close;
    }
    if (Math.abs(r.lengthM - d) > 0.1) errors.push(`longueur annoncée ${r.lengthM} m, mesurée ${f(d)} m`);
    if (Math.abs(ri.lengthM - r.lengthM) > 0.01) errors.push(`longueur de l'index ${ri.lengthM} ≠ ${r.lengthM}`);
    const stepLim = ring ? 0.05 : r.bike === 'mtb' ? 0.6 : r.bike === 'gravel' ? 0.45 : 0.3;
    if (maxStepY > stepLim) errors.push(`marche de ${f(maxStepY * 100, 0)} cm entre deux points`);
    // Demi-tour : cap qui tourne de plus de 150° sur ± 6 m.
    const n = P.length;
    const get = (i: number) => P[r.loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
    for (let i = 0; i < n; i++) {
      const a = get(i - 3);
      const b = get(i);
      const c = get(i + 3);
      const h1 = Math.atan2(b.z - a.z, b.x - a.x);
      const h2 = Math.atan2(c.z - b.z, c.x - b.x);
      let t = Math.abs(h2 - h1);
      if (t > Math.PI) t = 2 * Math.PI - t;
      if ((a !== b && b !== c && t > (150 * Math.PI) / 180) || (a.x === c.x && a.z === c.z && a !== c)) {
        errors.push(`demi-tour au point ${i} ${at(b.x, b.z)} (${f((t * 180) / Math.PI, 0)}°)`);
        break;
      }
    }
    // Pentes de l'itinéraire.
    let gMax = 0;
    for (let i = 0; i < n; i++) {
      let j = i;
      while (j < n - 1 && P[j]!.d - P[i]!.d < GRADE_WINDOW) j++;
      const dd = P[j]!.d - P[i]!.d;
      if (dd < GRADE_WINDOW * 0.8) break;
      gMax = Math.max(gMax, Math.abs(P[j]!.y - P[i]!.y) / dd);
    }
    const lim = ring ? GRADE_RING : r.bike === 'mtb' ? 0.27 : r.bike === 'gravel' ? 0.2 : 0.135;
    if (gMax > lim + 1e-4) errors.push(`pente max ${f(gMax * 100, 1)} %`);
    // Le jeu place le coureur d'après roadWidthM sur tout le parcours : jamais plus large que la voie la plus étroite.
    const narrow = Math.min(...(r.roadWidths ?? [{ widthM: r.roadWidthM }]).map((w) => w.widthM));
    if (r.roadWidthM > narrow + 1e-6) errors.push(`largeur ${r.roadWidthM} m annoncée, voie la plus étroite ${narrow} m (coureur hors chaussée)`);
    check(`itinéraire ${ri.id}`, errors, `${f(r.lengthM / 1000, 2)} km, ${n} points, pente max ${f(gMax * 100, 1)} %, écart aux routes ${f(maxOff, 2)} m`);
  }
  if (!meta.routes.some((r) => r.id === meta.mainRoute)) check('itinéraire principal', [`${meta.mainRoute} absent de l'index`]);

  return { ok, lines };
}

// ── Outils géométriques ──

/** Polygones [x, z, …] → masque n × n (cases de `res` m), remplissage pair-impair aux centres des cases. */
function rasterize(rings: number[][], x0: number, z0: number, res: number, n: number): Uint8Array {
  const m = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = z0 + (j + 0.5) * res;
    const xs: number[] = [];
    for (const r of rings) {
      const k = r.length / 2;
      for (let a = 0, b = k - 1; a < k; b = a++) {
        const az = r[a * 2 + 1]!;
        const bz = r[b * 2 + 1]!;
        if (az > z !== bz > z) xs.push(r[a * 2]! + ((z - az) / (bz - az)) * (r[b * 2]! - r[a * 2]!));
      }
    }
    xs.sort((p, q) => p - q);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((xs[t]! - x0) / res - 0.5));
      const i1 = Math.min(n - 1, Math.floor((xs[t + 1]! - x0) / res - 0.5));
      for (let i = i0; i <= i1; i++) m[j * n + i] = 1;
    }
  }
  return m;
}

function sample(g: Grid, x: number, z: number): number {
  const N = g.n + 1;
  const fx = Math.max(0, Math.min(g.n - 1e-6, (x - g.x0) / g.res));
  const fz = Math.max(0, Math.min(g.n - 1e-6, (z - g.z0) / g.res));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const h = g.h;
  return (h[j * N + i]! * (1 - u) + h[j * N + i + 1]! * u) * (1 - v) + (h[(j + 1) * N + i]! * (1 - u) + h[(j + 1) * N + i + 1]! * u) * v;
}

function proj(x: number, z: number, s: Seg): { t: number; d: number } {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
  return { t, d: Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) };
}

/** Intersection de deux segments en plan (intérieurs seulement, ou extrémités comprises). */
function intersect(p: Seg, q: Seg, ends = false): [number, number] | null {
  const rx = p.bx - p.ax;
  const rz = p.bz - p.az;
  const sx = q.bx - q.ax;
  const sz = q.bz - q.az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.ax - p.ax) * sz - (q.az - p.az) * sx) / den;
  const u = ((q.ax - p.ax) * rz - (q.az - p.az) * rx) / den;
  const e = ends ? -1e-9 : 1e-6;
  if (t < e || t > 1 - e || u < e || u > 1 - e) return null;
  return [p.ax + rx * t, p.az + rz * t];
}

function circumradius(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const a = Math.hypot(bx - cx, bz - cz);
  const b = Math.hypot(ax - cx, az - cz);
  const c = Math.hypot(ax - bx, az - bz);
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return area2 < 1e-9 ? Infinity : (a * b * c) / (2 * area2);
}

function inPoly(x: number, z: number, p: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polyPointDist(p: Array<[number, number]>, x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    d = Math.min(d, proj(x, z, { ax: a[0], ay: 0, az: a[1], bx: b[0], by: 0, bz: b[1] }).d);
  }
  return d;
}

/** Distance d'un polygone (plein) à un segment : 0 s'ils se touchent. */
function polySegDist(p: Array<[number, number]>, s: Seg): number {
  if (inPoly(s.ax, s.az, p) || inPoly(s.bx, s.bz, p)) return 0;
  let d = Math.min(polyPointDist(p, s.ax, s.az), polyPointDist(p, s.bx, s.bz));
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const e: Seg = { ax: a[0], ay: 0, az: a[1], bx: b[0], by: 0, bz: b[1] };
    if (intersect(s, e)) return 0;
    d = Math.min(d, proj(a[0], a[1], s).d);
  }
  return d;
}

/** Index spatial de segments (grille), pour les recherches de voisinage. */
class SegIndex {
  private cells = new Map<string, Array<{ seg: Seg; data: unknown }>>();
  constructor(private readonly cs: number) {}
  add(seg: Seg, data: unknown): void {
    const e = { seg, data };
    for (let i = Math.floor(Math.min(seg.ax, seg.bx) / this.cs); i <= Math.floor(Math.max(seg.ax, seg.bx) / this.cs); i++)
      for (let j = Math.floor(Math.min(seg.az, seg.bz) / this.cs); j <= Math.floor(Math.max(seg.az, seg.bz) / this.cs); j++) {
        const k = `${i},${j}`;
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(e);
      }
  }
  near(x: number, z: number, r: number): Array<{ seg: Seg; data: unknown }> {
    const out = new Set<{ seg: Seg; data: unknown }>();
    for (let i = Math.floor((x - r) / this.cs); i <= Math.floor((x + r) / this.cs); i++)
      for (let j = Math.floor((z - r) / this.cs); j <= Math.floor((z + r) / this.cs); j++) for (const e of this.cells.get(`${i},${j}`) ?? []) out.add(e);
    return [...out];
  }
}

// Lancement direct : relit le monde déjà écrit.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const report = verifyWorld(resolve(import.meta.dirname, '../../../apps/client/public/worlds/ile-de-robert'));
  for (const l of report.lines) console.log(l);
  if (!report.ok) process.exitCode = 1;
}
