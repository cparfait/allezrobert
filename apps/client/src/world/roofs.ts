/**
 * Géométrie des toits, sans dépendance à Three.js (testable sous Node).
 *
 * Le toit suit l'emprise OSM réelle : c'est le « squelette droit » pondéré du polygone. Chaque
 * égout part de son mur (avec un débord) et monte vers l'intérieur à pente constante ; les pans se
 * rencontrent en faîtages, arêtiers et noues. Un pignon est une arête de poids nul (pan vertical).
 * Les événements gérés sont ceux du squelette : disparition d'une arête (arêtier) et scission du
 * front par un sommet rentrant (noue d'un bâtiment en L, en T, en U…). Si un cas dégénéré n'est pas
 * reconnu, le front est arrêté avant de se recouper et fermé par un terrasson plat : jamais de pan
 * hors de l'emprise ni retourné vers le bas.
 *
 * Repère : (x, z) horizontal ; le « temps » t d'un point est sa distance horizontale à l'égout de
 * son pan, sa hauteur vaut donc égout + t·tan(pente).
 */

export interface Obb {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  hl: number; // demi-longueur selon u
  hw: number; // demi-largeur selon v
}

/** Rectangle orienté minimal (calipers sur les arêtes du polygone), u selon la grande dimension. */
export function orientedBox(pts: number[]): Obb {
  let best: Obb | null = null;
  let bestArea = Infinity;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = (pts[j * 2] as number) - (pts[i * 2] as number);
    let uz = (pts[j * 2 + 1] as number) - (pts[i * 2 + 1] as number);
    const len = Math.hypot(ux, uz);
    if (len < 0.5) continue;
    ux /= len;
    uz /= len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 2] as number;
      const z = pts[k * 2 + 1] as number;
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, hl: (maxU - minU) / 2, hw: (maxV - minV) / 2 };
    }
  }
  if (best && best.hl < best.hw) best = { cx: best.cx, cz: best.cz, ux: -best.uz, uz: best.ux, hl: best.hw, hw: best.hl };
  return best ?? { cx: pts[0] as number, cz: pts[1] as number, ux: 1, uz: 0, hl: 3, hw: 3 };
}

interface P2 {
  x: number;
  z: number;
}

/** Droite d'égout qui avance : n·p = c + w·t (n normale intérieure, d direction, o origine des u). */
interface Line {
  nx: number;
  nz: number;
  dx: number;
  dz: number;
  c: number;
  w: number;
  ox: number;
  oz: number;
}

/** Sommet du front ; `l` = droite de l'arête qui part de ce sommet. */
interface Vert {
  x: number;
  z: number;
  l: number;
}

const ringArea = (p: P2[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i] as P2;
    const r = p[(i + 1) % p.length] as P2;
    a += q.x * r.z - r.x * q.z;
  }
  return a / 2;
};

/** Distance du point p au segment [a, b]. */
function segDist(p: P2, a: P2, b: P2): number {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const l2 = ex * ex + ez * ez;
  const k = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2)) : 0;
  return Math.hypot(p.x - a.x - k * ex, p.z - a.z - k * ez);
}

/**
 * Emprise nettoyée, orientée dans le sens positif : sans doublons, sans sommets presque alignés
 * (écart < tol) ni pointes aller-retour, qui rendraient le squelette instable.
 */
export function cleanFootprint(pts: number[], tol = 0.08): P2[] {
  const r: P2[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) r.push({ x: pts[i] as number, z: pts[i + 1] as number });
  if (r.length > 2) {
    const f = r[0] as P2;
    const l = r[r.length - 1] as P2;
    if (Math.hypot(f.x - l.x, f.z - l.z) < 0.05) r.pop();
  }
  let changed = true;
  while (changed && r.length >= 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length >= 3; i++) {
      const n = r.length;
      const a = r[(i - 1 + n) % n] as P2;
      const b = r[i] as P2;
      const c = r[(i + 1) % n] as P2;
      const ab = Math.hypot(b.x - a.x, b.z - a.z);
      const bc = Math.hypot(c.x - b.x, c.z - b.z);
      const spike = ab > 1e-9 && bc > 1e-9 && ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (ab * bc) < -0.97;
      if (ab < 0.05 || spike || segDist(b, a, c) < tol) {
        r.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  if (r.length < 3) return [];
  if (ringArea(r) < 0) r.reverse();
  return r;
}

/** Triangulation par oreilles d'un anneau orienté positivement (indices). */
export function earClip(p: P2[]): number[] {
  const idx = p.map((_, i) => i);
  const out: number[] = [];
  const cross = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  let guard = p.length * p.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let found = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k - 1 + idx.length) % idx.length] as number;
      const ib = idx[k] as number;
      const ic = idx[(k + 1) % idx.length] as number;
      const a = p[ia] as P2;
      const b = p[ib] as P2;
      const c = p[ic] as P2;
      if (cross(a, b, c) <= 1e-10) continue;
      let inside = false;
      for (const im of idx) {
        if (im === ia || im === ib || im === ic) continue;
        const m = p[im] as P2;
        if (cross(a, b, m) >= -1e-10 && cross(b, c, m) >= -1e-10 && cross(c, a, m) >= -1e-10) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      out.push(ia, ib, ic);
      idx.splice(k, 1);
      found = true;
      break;
    }
    if (!found) break;
  }
  for (let k = 1; k + 1 < idx.length; k++) out.push(idx[0] as number, idx[k] as number, idx[k + 1] as number);
  return out;
}

export interface RoofPlan {
  /** Pans : triangles, 5 valeurs par sommet (x, z, t, u le long de l'égout, distance horizontale à l'égout). */
  roof: number[];
  /** Pignons (pans verticaux) : triangles, 4 valeurs par sommet (x, z, t, u). */
  gables: number[];
  /** Débord horizontal de l'égout (m) : t = overhang à l'aplomb du mur. */
  overhang: number;
  /** t atteint au faîtage (ou au terrasson). */
  tEnd: number;
}

export interface RoofOptions {
  /** Débord de l'égout au-delà du mur (m). */
  overhang: number;
  /** Débord de la rive au-delà du pignon (m). */
  gableOverhang: number;
  /** Toit à deux pans si l'emprise est presque rectangulaire (sinon : croupes partout). */
  gabled: boolean;
  /** Retrait maximal (m) avant d'arrêter le toit par un terrasson plat. */
  maxInset?: number;
}

/** Arêtes de pignon (petits côtés) si l'emprise est convexe et proche de son rectangle orienté. */
function gableEdges(ring: P2[]): boolean[] | null {
  const n = ring.length;
  const flat: number[] = [];
  for (const p of ring) flat.push(p.x, p.z);
  const box = orientedBox(flat);
  if (box.hl < 1 || box.hw < 1) return null;
  if (ringArea(ring) / (4 * box.hl * box.hw) < 0.85) return null;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n] as P2;
    const b = ring[i] as P2;
    const c = ring[(i + 1) % n] as P2;
    if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < -1e-9) return null; // non convexe
  }
  const g: boolean[] = [];
  let ends = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = Math.abs(((b.x - a.x) * box.ux + (b.z - a.z) * box.uz) / len);
    const mid = ((a.x + b.x) / 2 - box.cx) * box.ux + ((a.z + b.z) / 2 - box.cz) * box.uz;
    const isG = along < 0.34 && Math.abs(mid) > box.hl * 0.6 && len > 1;
    g.push(isG);
    if (isG) ends |= mid > 0 ? 1 : 2;
  }
  return ends === 3 ? g : null;
}

function solve(l1: Line, l2: Line, c1: number, c2: number): P2 | null {
  const det = l1.nx * l2.nz - l1.nz * l2.nx;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (c1 * l2.nz - c2 * l1.nz) / det, z: (l1.nx * c2 - l2.nx * c1) / det };
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const e = 1e-9;
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/**
 * Plan du toit d'une emprise (x, z à plat). Renvoie null si l'emprise est dégénérée.
 */
export function planRoof(pts: number[], opts: RoofOptions): RoofPlan | null {
  const ring = cleanFootprint(pts);
  const n0 = ring.length;
  if (n0 < 3 || ringArea(ring) < 1) return null;
  const o = opts.overhang;
  const gable = opts.gabled ? gableEdges(ring) : null;
  const lines: Line[] = [];
  for (let i = 0; i < n0; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n0] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const isG = gable?.[i] ?? false;
    // Normale intérieure (anneau positif : intérieur à gauche). Égout décalé vers l'extérieur du débord.
    lines.push({ nx: -dz, nz: dx, dx, dz, c: -dz * a.x + dx * a.z - (isG ? 0 : o), w: isG ? 0 : 1, ox: a.x, oz: a.z });
  }
  const L = (i: number) => lines[i] as Line;
  const start: Vert[] = [];
  for (let i = 0; i < n0; i++) {
    const lp = L((i - 1 + n0) % n0);
    const ln = L(i);
    const p = solve(lp, ln, lp.c, ln.c) ?? { x: (ring[i] as P2).x - ln.nx * o, z: (ring[i] as P2).z - ln.nz * o };
    start.push({ x: p.x, z: p.z, l: i });
  }
  const roof: number[] = [];
  const gab: number[] = [];
  const og = opts.gableOverhang;
  const tLimit = opts.maxInset ?? Infinity;

  const velocity = (lp: Line, ln: Line): P2 => solve(lp, ln, lp.w, ln.w) ?? { x: ln.nx * ln.w, z: ln.nz * ln.w };
  const velocities = (loop: Vert[]): P2[] => loop.map((v, i) => velocity(L((loop[(i - 1 + loop.length) % loop.length] as Vert).l), L(v.l)));
  const at = (loop: Vert[], s: P2[], dt: number): P2[] => loop.map((v, i) => ({ x: v.x + (s[i] as P2).x * dt, z: v.z + (s[i] as P2).z * dt }));

  const valid = (loop: Vert[], p: P2[]): boolean => {
    const n = p.length;
    if (ringArea(p) < -1e-6) return false;
    for (let i = 0; i < n; i++) {
      const a = p[i] as P2;
      const b = p[(i + 1) % n] as P2;
      const ln = L((loop[i] as Vert).l);
      if ((b.x - a.x) * ln.dx + (b.z - a.z) * ln.dz < -1e-5) return false; // arête retournée
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segmentsCross(a, b, p[j] as P2, p[(j + 1) % n] as P2)) return false;
      }
    }
    return true;
  };

  const pushRoof = (p: P2, t: number, ln: Line) => roof.push(p.x, p.z, t, (p.x - ln.ox) * ln.dx + (p.z - ln.oz) * ln.dz, t);
  const emit = (loop: Vert[], s: P2[], t0: number, t1: number) => {
    const n = loop.length;
    const dt = t1 - t0;
    for (let i = 0; i < n; i++) {
      const a = loop[i] as Vert;
      const b = loop[(i + 1) % n] as Vert;
      const sa = s[i] as P2;
      const sb = s[(i + 1) % n] as P2;
      const ln = L(a.l);
      const lp = L((loop[(i - 1 + n) % n] as Vert).l);
      const lnx = L(b.l);
      const A0 = { x: a.x, z: a.z };
      const B0 = { x: b.x, z: b.z };
      const A1 = { x: a.x + sa.x * dt, z: a.z + sa.z * dt };
      const B1 = { x: b.x + sb.x * dt, z: b.z + sb.z * dt };
      if (ln.w === 0) {
        const u = (p: P2) => (p.x - ln.ox) * ln.dx + (p.z - ln.oz) * ln.dz;
        const quad: Array<[P2, number]> = [[A0, t0], [B0, t0], [B1, t1], [A1, t1]];
        for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]] as const) {
          const q0 = quad[i0] as [P2, number];
          const q1 = quad[i1] as [P2, number];
          const q2 = quad[i2] as [P2, number];
          const area = (u(q1[0]) - u(q0[0])) * (q2[1] - q0[1]) - (q1[1] - q0[1]) * (u(q2[0]) - u(q0[0]));
          if (Math.abs(area) < 1e-8) continue;
          for (const [p, t] of [q0, q1, q2]) gab.push(p.x, p.z, t, u(p));
        }
        continue;
      }
      // Rive : le pan déborde au-delà d'un pignon voisin, en glissant le long de son égout (reste plan).
      if (lp.w === 0 && og > 0) {
        const k = og / Math.max(Math.abs(ln.dx * lp.dz - ln.dz * lp.dx), 0.3);
        A0.x -= ln.dx * k;
        A0.z -= ln.dz * k;
        A1.x -= ln.dx * k;
        A1.z -= ln.dz * k;
      }
      if (lnx.w === 0 && og > 0) {
        const k = og / Math.max(Math.abs(ln.dx * lnx.dz - ln.dz * lnx.dx), 0.3);
        B0.x += ln.dx * k;
        B0.z += ln.dz * k;
        B1.x += ln.dx * k;
        B1.z += ln.dz * k;
      }
      const quad: Array<[P2, number]> = [[A0, t0], [B0, t0], [B1, t1], [A1, t1]];
      for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]] as const) {
        const q0 = quad[i0] as [P2, number];
        const q1 = quad[i1] as [P2, number];
        const q2 = quad[i2] as [P2, number];
        const area = (q1[0].x - q0[0].x) * (q2[0].z - q0[0].z) - (q1[0].z - q0[0].z) * (q2[0].x - q0[0].x);
        if (Math.abs(area) < 1e-8) continue;
        pushRoof(q0[0], q0[1], ln);
        pushRoof(q1[0], q1[1], ln);
        pushRoof(q2[0], q2[1], ln);
      }
    }
  };

  const cap = (loop: Vert[], t: number) => {
    const p = loop.map((v) => ({ x: v.x, z: v.z }));
    if (ringArea(p) < 1e-4) return;
    const tri = earClip(p);
    for (const k of tri) {
      const q = p[k] as P2;
      roof.push(q.x, q.z, t, q.x, q.z);
    }
  };

  /** Événements d'arête (fusion des sommets), alignements et pointes ; null si le front est épuisé. */
  const cleanup = (loop: Vert[]): Vert[] | null => {
    let changed = true;
    let guard = 4 * loop.length + 10;
    while (changed && guard-- > 0) {
      changed = false;
      const n = loop.length;
      if (n < 3) return null;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = loop[i] as Vert;
        const b = loop[j] as Vert;
        if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4) {
          loop[i] = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, l: b.l };
          loop.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) continue;
      for (let i = 0; i < n; i++) {
        const ip = (i - 1 + n) % n;
        const prev = loop[ip] as Vert;
        const cur = loop[i] as Vert;
        const next = loop[(i + 1) % n] as Vert;
        const lp = L(prev.l);
        const ln = L(cur.l);
        if (Math.abs(lp.dx * ln.dz - lp.dz * ln.dx) > 1e-6) continue;
        if (lp.dx * ln.dx + lp.dz * ln.dz < 0) {
          // Pointe (deux fronts opposés confondus) : il ne reste que la plus longue des deux arêtes.
          if (Math.hypot(prev.x - cur.x, prev.z - cur.z) < Math.hypot(next.x - cur.x, next.z - cur.z)) prev.l = cur.l;
        }
        loop.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (loop.length < 3 || ringArea(loop) < 1e-4) return null;
    return loop;
  };

  let loops: Vert[][] = [];
  const first = cleanup(start);
  if (first) loops.push(first);
  let T = 0;
  for (let iter = 0; iter < 8 * n0 + 40 && loops.length; iter++) {
    const S = loops.map(velocities);
    let tNext = tLimit;
    let split: { k: number; i: number; j: number } | null = null;
    // Disparition d'arête : ses deux extrémités se rejoignent.
    loops.forEach((loop, k) => {
      const n = loop.length;
      const s = S[k] as P2[];
      for (let i = 0; i < n; i++) {
        const a = loop[i] as Vert;
        const b = loop[(i + 1) % n] as Vert;
        const sa = s[i] as P2;
        const sb = s[(i + 1) % n] as P2;
        const ln = L(a.l);
        const len = (b.x - a.x) * ln.dx + (b.z - a.z) * ln.dz;
        const rate = (sb.x - sa.x) * ln.dx + (sb.z - sa.z) * ln.dz;
        if (rate < -1e-9) {
          const tc = T + Math.max(len, 0) / -rate;
          if (tc < tNext) tNext = tc;
        }
      }
    });
    // Scission : un sommet rentrant atteint une arête non voisine.
    loops.forEach((loop, k) => {
      const n = loop.length;
      const s = S[k] as P2[];
      for (let i = 0; i < n; i++) {
        const v = loop[i] as Vert;
        const lp = L((loop[(i - 1 + n) % n] as Vert).l);
        const ln = L(v.l);
        if (lp.dx * ln.dz - lp.dz * ln.dx >= -1e-9) continue;
        const sv = s[i] as P2;
        for (let j = 0; j < n; j++) {
          if (j === i || j === (i - 1 + n) % n) continue;
          const lj = L((loop[j] as Vert).l);
          const f0 = lj.nx * v.x + lj.nz * v.z - (lj.c + lj.w * T);
          const rate = lj.nx * sv.x + lj.nz * sv.z - lj.w;
          if (f0 < -1e-6 || rate >= -1e-9) continue;
          const tau = Math.max(f0, 0) / -rate;
          if (T + tau >= tNext - 1e-7) continue;
          const a = loop[j] as Vert;
          const b = loop[(j + 1) % n] as Vert;
          const sa = s[j] as P2;
          const sb = s[(j + 1) % n] as P2;
          const ax = a.x + sa.x * tau;
          const az = a.z + sa.z * tau;
          const seg = (b.x + sb.x * tau - ax) * lj.dx + (b.z + sb.z * tau - az) * lj.dz;
          if (seg < 1e-6) continue;
          const u = ((v.x + sv.x * tau - ax) * lj.dx + (v.z + sv.z * tau - az) * lj.dz) / seg;
          if (u < -1e-6 || u > 1 + 1e-6) continue;
          tNext = T + tau;
          split = { k, i, j };
        }
      }
    });
    let stop = !Number.isFinite(tNext) || tNext >= tLimit;
    if (!Number.isFinite(tNext)) tNext = T;
    // Filet de sécurité : le front ne doit jamais se recouper (sinon on s'arrête juste avant).
    const ok = (t: number) => loops.every((loop, k) => valid(loop, at(loop, S[k] as P2[], t - T)));
    if (!ok(tNext)) {
      let lo = T;
      let hi = tNext;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      tNext = lo;
      stop = true;
      split = null;
    }
    loops.forEach((loop, k) => emit(loop, S[k] as P2[], T, tNext));
    loops = loops.map((loop, k) => at(loop, S[k] as P2[], tNext - T).map((p, i) => ({ x: p.x, z: p.z, l: (loop[i] as Vert).l })));
    T = tNext;
    if (stop) {
      for (const loop of loops) cap(loop, T);
      loops = [];
      break;
    }
    if (split) {
      const { k, i, j } = split;
      const loop = loops[k] as Vert[];
      const n = loop.length;
      const v = loop[i] as Vert;
      const l1: Vert[] = [{ x: v.x, z: v.z, l: (loop[j] as Vert).l }];
      for (let m = (j + 1) % n; m !== i; m = (m + 1) % n) l1.push(loop[m] as Vert);
      const l2: Vert[] = [{ x: v.x, z: v.z, l: v.l }];
      for (let m = (i + 1) % n; m !== (j + 1) % n; m = (m + 1) % n) l2.push(loop[m] as Vert);
      loops.splice(k, 1, l1, l2);
    }
    loops = loops.map((loop) => cleanup(loop)).filter((loop): loop is Vert[] => loop !== null);
  }
  for (const loop of loops) cap(loop, T);
  return { roof, gables: gab, overhang: o, tEnd: T };
}

export interface RoofBuffers {
  roof: { pos: number[]; uv: number[] };
  gables: { pos: number[]; uv: number[] };
}

/**
 * Passe le plan en 3D : égout à wallTop − débord·tan(pente), de sorte que le pan passe exactement
 * par le haut du mur. uv des pans = (le long de l'égout, distance dans la pente) en mètres ;
 * pignons = (le long du mur, hauteur au-dessus du haut du mur + 3) comme les façades sans fenêtres.
 */
export function roofBuffers(plan: RoofPlan, wallTop: number, pitchDeg: number): RoofBuffers {
  const tan = Math.tan((pitchDeg * Math.PI) / 180);
  const cos = Math.cos((pitchDeg * Math.PI) / 180);
  const y = (t: number) => wallTop + (t - plan.overhang) * tan;
  const out: RoofBuffers = { roof: { pos: [], uv: [] }, gables: { pos: [], uv: [] } };
  const r = plan.roof;
  for (let i = 0; i + 15 <= r.length; i += 15) {
    const v = [0, 1, 2].map((k) => {
      const o = i + k * 5;
      return { x: r[o] as number, y: y(r[o + 2] as number), z: r[o + 1] as number, u: r[o + 3] as number, v: (r[o + 4] as number) / cos };
    }) as [{ x: number; y: number; z: number; u: number; v: number }, { x: number; y: number; z: number; u: number; v: number }, { x: number; y: number; z: number; u: number; v: number }];
    // Pan tourné vers le haut (normale y > 0).
    const [a, b, c] = v;
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    for (const p of ny < 0 ? [a, c, b] : [a, b, c]) {
      out.roof.pos.push(p.x, p.y, p.z);
      out.roof.uv.push(p.u, p.v);
    }
  }
  // Pignons : seulement la partie au-dessus du haut du mur (le mur lui-même est déjà extrudé).
  const g = plan.gables;
  for (let i = 0; i + 12 <= g.length; i += 12) {
    const tri = [0, 1, 2].map((k) => ({ x: g[i + k * 4] as number, z: g[i + k * 4 + 1] as number, y: y(g[i + k * 4 + 2] as number), u: g[i + k * 4 + 3] as number }));
    const poly: typeof tri = [];
    for (let k = 0; k < 3; k++) {
      const p = tri[k] as (typeof tri)[number];
      const q = tri[(k + 1) % 3] as (typeof tri)[number];
      const pin = p.y >= wallTop - 1e-6;
      const qin = q.y >= wallTop - 1e-6;
      if (pin) poly.push(p);
      if (pin !== qin) {
        const f = (wallTop - p.y) / (q.y - p.y);
        poly.push({ x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, y: wallTop, u: p.u + (q.u - p.u) * f });
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      for (const p of [poly[0], poly[k], poly[k + 1]] as Array<(typeof tri)[number]>) {
        out.gables.pos.push(p.x, p.y, p.z);
        out.gables.uv.push(p.u, p.y - wallTop + 3);
      }
    }
  }
  return out;
}

/** Toit-terrasse : emprise nettoyée triangulée à plat (uv = x, z en mètres). */
export function flatRoof(pts: number[], y: number): { pos: number[]; uv: number[] } {
  const ring = cleanFootprint(pts, 0.02);
  const pos: number[] = [];
  const uv: number[] = [];
  if (ring.length < 3) return { pos, uv };
  for (const k of earClip(ring)) {
    const p = ring[k] as P2;
    pos.push(p.x, y, p.z);
    uv.push(p.x, p.z);
  }
  return { pos, uv };
}
