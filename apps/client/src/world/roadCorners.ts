/**
 * Coudes arrondis des voies OSM : chaque sommet intérieur d'une polyligne (hors carrefour) est remplacé par un arc
 * de cercle tangent aux deux tronçons, avant que la chaussée, ses bords, ses trottoirs, le terrain creusé dessous
 * et l'écartement des bâtiments ne la lisent (tileDecode.ts) : tous suivent la même ligne. Sans cela chaque sommet
 * faisait un angle vif dans l'enrobé, les bordures et le marquage.
 *
 * Rayon borné par trois choses : la corde coupée au sommet (CUT_M : la chaussée dessinée coupe le virage comme la
 * trajectoire affichée du coureur, la physique gardant la polyligne d'origine), la longueur des tronçons voisins (au plus SHARE de
 * chacun, pour que deux coudes proches ne se chevauchent pas : un virage serré de village reste serré), et un plafond
 * (MAX_RADIUS_M). Les points superflus d'OSM sont d'abord retirés (simplifyPolyline). Pur, sans DOM ni three.js (exécuté dans les Web Workers de décodage des tuiles).
 */

/**
 * Corde coupée au plus au sommet d'un coude (m) : celle de la trajectoire affichée du coureur (LINE_MAX_CUT_M,
 * packages/shared/src/track.ts), qui prend déjà les virages en arc ; à 1,2 m, un angle droit gardait un rayon de 3 m.
 */
const CUT_M = 2.5;
/** Part d'un tronçon qu'un coude peut prendre à chaque bout. */
const SHARE = 0.45;
const MAX_RADIUS_M = 60;
/** Pas angulaire de l'arc (rad, ≈ 8,6°). */
const STEP_RAD = 0.15;
/** En dessous (rad, ≈ 3°), le coude est déjà doux : laissé tel quel. */
const MIN_TURN_RAD = 0.05;

/**
 * Simplification avant l'arrondi : un sommet à moins de 0,3 m (en plan) et 0,15 m (en altitude) de la droite de ses
 * voisins est retiré. OSM serre souvent des points juste avant un coin (un sommet à 4 m d'un angle droit limitait son
 * arc à 45 % de ces 4 m : un rayon de 1,7 m, toujours un angle vu d'en haut).
 */
const SIMPLIFY_M = 0.3;
const SIMPLIFY_Y_M = 0.15;

const key = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;

/** Douglas–Peucker (plan x, z et altitude), extrémités et sommets de `keep` gardés. */
export function simplifyPolyline(p: readonly number[], keep: ReadonlySet<string> = new Set(), tol = SIMPLIFY_M, tolY = SIMPLIFY_Y_M): number[] {
  const n = p.length / 3;
  if (n < 3) return p.slice();
  const kept = new Uint8Array(n);
  kept[0] = 1;
  kept[n - 1] = 1;
  for (let i = 1; i < n - 1; i++) if (keep.has(key(p[i * 3] as number, p[i * 3 + 2] as number))) kept[i] = 1;
  const stack: Array<[number, number]> = [];
  let a = 0;
  for (let i = 1; i < n; i++)
    if (kept[i]) {
      stack.push([a, i]);
      a = i;
    }
  while (stack.length) {
    const [i0, i1] = stack.pop() as [number, number];
    if (i1 - i0 < 2) continue;
    const ax = p[i0 * 3] as number, ay = p[i0 * 3 + 1] as number, az = p[i0 * 3 + 2] as number;
    const bx = p[i1 * 3] as number, by = p[i1 * 3 + 1] as number, bz = p[i1 * 3 + 2] as number;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let worst = -1;
    let at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const x = p[i * 3] as number, y = p[i * 3 + 1] as number, z = p[i * 3 + 2] as number;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const e = Math.max(Math.hypot(ax + dx * t - x, az + dz * t - z) / tol, Math.abs(ay + (by - ay) * t - y) / tolY);
      if (e > worst) {
        worst = e;
        at = i;
      }
    }
    if (worst > 1) {
      kept[at] = 1;
      stack.push([i0, at], [at, i1]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (kept[i]) out.push(p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number);
  return out;
}

/**
 * Sommets de carrefour : plus de deux directions s'y rejoignent (routes qui s'y croisent ou y finissent). Une copie
 * d'itinéraire qui double une voie OSM (mêmes voisins) n'en fait pas un carrefour.
 */
export function junctionKeys(lines: readonly (readonly number[])[]): Set<string> {
  const around = new Map<string, Set<string>>();
  for (const p of lines) {
    const n = p.length / 3;
    for (let i = 0; i < n; i++) {
      const k = key(p[i * 3] as number, p[i * 3 + 2] as number);
      let s = around.get(k);
      if (!s) around.set(k, (s = new Set()));
      if (i > 0) s.add(key(p[i * 3 - 3] as number, p[i * 3 - 1] as number));
      if (i < n - 1) s.add(key(p[i * 3 + 3] as number, p[i * 3 + 5] as number));
    }
  }
  const out = new Set<string>();
  for (const [k, s] of around) if (s.size > 2) out.add(k);
  return out;
}

/** Tronçon court entre deux coudes du même sens : fusionnés en un seul coin (voir `mergeShortCorners`). */
const SHORT_LEG_M = 8;
/** Le coin fusionné (intersection des tronçons voisins) reste à moins de ceci du tronçon court qu'il remplace (m). */
const MERGE_MAX_M = 3;

/**
 * Deux coudes du même sens séparés par un tronçon court (un angle d'OSM dessiné en deux fois, avec un pan coupé)
 * deviennent un seul coin, à l'intersection des tronçons voisins : l'arc d'un sommet ne peut prendre que 45 % du
 * tronçon court, d'où un rayon de 1 à 2 m qui laissait un angle. L'arrondi (CUT_M) ramène ensuite la route près du
 * tracé d'origine. Extrémités et sommets de `keep` jamais touchés.
 */
export function mergeShortCorners(p: readonly number[], keep: ReadonlySet<string> = new Set()): number[] {
  let q = p.slice();
  for (let pass = 0; pass < 8; pass++) {
    const n = q.length / 3;
    let merged = false;
    for (let i = 1; i + 2 < n; i++) {
      const at = (k: number) => [q[k * 3] as number, q[k * 3 + 1] as number, q[k * 3 + 2] as number] as const;
      const [ax, , az] = at(i - 1);
      const [bx, by, bz] = at(i);
      const [cx, cy, cz] = at(i + 1);
      const [dx, , dz] = at(i + 2);
      if (keep.has(key(bx, bz)) || keep.has(key(cx, cz))) continue;
      const leg = Math.hypot(cx - bx, cz - bz);
      if (leg > SHORT_LEG_M || leg < 1e-3) continue;
      const turn = (ux: number, uz: number, vx: number, vz: number) => Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
      const t1 = turn(bx - ax, bz - az, cx - bx, cz - bz);
      const t2 = turn(cx - bx, cz - bz, dx - cx, dz - cz);
      if (Math.sign(t1) !== Math.sign(t2) || Math.abs(t1) < MIN_TURN_RAD || Math.abs(t2) < MIN_TURN_RAD || Math.abs(t1 + t2) > Math.PI - 0.2) continue;
      // Intersection des droites (a → b) et (d → c).
      const e1x = bx - ax, e1z = bz - az, e2x = cx - dx, e2z = cz - dz;
      const den = e1x * e2z - e1z * e2x;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((dx - ax) * e2z - (dz - az) * e2x) / den;
      const ix = ax + e1x * u, iz = az + e1z * u;
      // Le coin doit être en avant de b et de c, et proche du tronçon court.
      if ((ix - bx) * e1x + (iz - bz) * e1z < 0 || (ix - cx) * e2x + (iz - cz) * e2z < 0) continue;
      const lx = cx - bx, lz = cz - bz;
      const tt = Math.max(0, Math.min(1, ((ix - bx) * lx + (iz - bz) * lz) / (leg * leg)));
      if (Math.hypot(bx + lx * tt - ix, bz + lz * tt - iz) > MERGE_MAX_M) continue;
      const iy = (by + cy) / 2;
      q = [...q.slice(0, i * 3), ix, iy, iz, ...q.slice((i + 2) * 3)];
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return q;
}

/** Polyligne x,y,z aux coudes arrondis ; extrémités et sommets de `keep` (carrefours) inchangés. */
export function roundPolyline(p: readonly number[], keep: ReadonlySet<string> = new Set()): number[] {
  const n = p.length / 3;
  if (n < 3) return p.slice();
  const out: number[] = [p[0] as number, p[1] as number, p[2] as number];
  for (let i = 1; i < n - 1; i++) {
    const ax = p[i * 3 - 3] as number, ay = p[i * 3 - 2] as number, az = p[i * 3 - 1] as number;
    const vx = p[i * 3] as number, vy = p[i * 3 + 1] as number, vz = p[i * 3 + 2] as number;
    const bx = p[i * 3 + 3] as number, by = p[i * 3 + 4] as number, bz = p[i * 3 + 5] as number;
    const li = Math.hypot(vx - ax, vz - az);
    const lo = Math.hypot(bx - vx, bz - vz);
    const ix = (vx - ax) / (li || 1), iz = (vz - az) / (li || 1);
    const ox = (bx - vx) / (lo || 1), oz = (bz - vz) / (lo || 1);
    const theta = Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz);
    const turn = Math.abs(theta);
    if (keep.has(key(vx, vz)) || li < 1e-3 || lo < 1e-3 || turn < MIN_TURN_RAD || turn > Math.PI - 0.05) {
      out.push(vx, vy, vz);
      continue;
    }
    const half = turn / 2;
    const tanH = Math.tan(half);
    // Rayon le plus grand permis : corde coupée (R (1/cos − 1) ≤ CUT_M), tronçons voisins (R tan ≤ SHARE × l), plafond.
    const R = Math.min(MAX_RADIUS_M, CUT_M / (1 / Math.cos(half) - 1), (SHARE * Math.min(li, lo)) / tanH);
    const t = R * tanH;
    if (R * turn < 0.3) {
      out.push(vx, vy, vz);
      continue;
    }
    // Points de tangence sur les deux tronçons, altitudes prises le long de chacun.
    const t1x = vx - ix * t, t1z = vz - iz * t, t1y = vy + (ay - vy) * (t / li);
    const t2y = vy + (by - vy) * (t / lo);
    // Centre : du côté où l'on tourne, à R du premier point de tangence.
    const side = Math.sign(theta);
    const nx = -iz * side, nz = ix * side;
    const cx = t1x + nx * R, cz = t1z + nz * R;
    const a0 = Math.atan2(t1z - cz, t1x - cx);
    const m = Math.max(2, Math.ceil(turn / STEP_RAD));
    for (let k = 0; k <= m; k++) {
      const f = k / m;
      const ang = a0 + side * turn * f;
      out.push(cx + Math.cos(ang) * R, t1y + (t2y - t1y) * f, cz + Math.sin(ang) * R);
    }
  }
  out.push(p[(n - 1) * 3] as number, p[(n - 1) * 3 + 1] as number, p[(n - 1) * 3 + 2] as number);
  return out;
}

/**
 * Coudes arrondis de toutes les voies d'une tuile : sommets intérieurs (hors carrefours), puis raccords de deux
 * bouts de voie seuls (deux voies OSM mises bout à bout, sans troisième voie) : un seul arc pour le raccord, chaque
 * voie en prend la moitié et toutes deux finissent sur son point milieu (les tronçons restent chaînés).
 */
export function roundRoads(lines: readonly (readonly number[])[]): number[][] {
  const keep = junctionKeys(lines);
  const out = lines.map((p) => roundPolyline(mergeShortCorners(simplifyPolyline(p, keep), keep), keep));
  // Bouts de voie par sommet, avec le point voisin (déjà arrondi) ; un sommet vu aussi à l'intérieur d'une voie est laissé.
  const ends = new Map<string, Array<{ li: number; start: boolean; adj: string }>>();
  const inner = new Set<string>();
  out.forEach((p, li) => {
    const n = p.length / 3;
    if (n < 2) return;
    for (let i = 1; i < n - 1; i++) inner.add(key(p[i * 3] as number, p[i * 3 + 2] as number));
    for (const start of [true, false]) {
      const i = start ? 0 : n - 1;
      const j = start ? 1 : n - 2;
      const k = key(p[i * 3] as number, p[i * 3 + 2] as number);
      const list = ends.get(k) ?? [];
      list.push({ li, start, adj: key(p[j * 3] as number, p[j * 3 + 2] as number) });
      ends.set(k, list);
    }
  });
  for (const [k, list] of ends) {
    if (list.length < 2 || inner.has(k) || keep.has(k)) continue;
    const sides = [...new Set(list.map((e) => e.adj))];
    if (sides.length !== 2) continue;
    // Arc du raccord, du côté du premier voisin vers le second.
    const pick = (adj: string) => list.find((e) => e.adj === adj) as { li: number; start: boolean };
    const pt = (e: { li: number; start: boolean }, fromEnd: number) => {
      const p = out[e.li] as number[];
      const n = p.length / 3;
      const i = e.start ? fromEnd : n - 1 - fromEnd;
      return [p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number];
    };
    const e0 = pick(sides[0] as string);
    const e1 = pick(sides[1] as string);
    const arc = roundPolyline([...pt(e0, 1), ...pt(e0, 0), ...pt(e1, 1)]);
    const m = arc.length / 3;
    if (m <= 3) continue;
    // Points de l'arc sans les deux voisins, et son milieu (point commun aux deux moitiés).
    const mid: number[] = arc.slice(3, (m - 1) * 3);
    const cnt = mid.length / 3;
    const h = Math.floor(cnt / 2);
    const firstHalf = mid.slice(0, (h + 1) * 3);
    const secondHalf = mid.slice(h * 3);
    const reversed = (a: number[]) => {
      const r: number[] = [];
      for (let i = a.length / 3 - 1; i >= 0; i--) r.push(a[i * 3] as number, a[i * 3 + 1] as number, a[i * 3 + 2] as number);
      return r;
    };
    for (const e of list) {
      const p = out[e.li] as number[];
      // Moitié de l'arc du côté de ce bout, dans le sens de la voie.
      const half = e.adj === sides[0] ? firstHalf : reversed(secondHalf);
      // `half` va du voisin vers le milieu ; une voie qui commence ici le prend à rebours.
      out[e.li] = e.start ? [...reversed(half), ...p.slice(3)] : [...p.slice(0, p.length - 3), ...half];
    }
  }
  return out;
}
