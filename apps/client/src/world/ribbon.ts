/**
 * Géométrie des rubans de chaussée, sans dépendance à Three.js (testable sous Node).
 *
 * - `ribbonEdges` : bords décalés de l'axe d'un itinéraire sans repli dans les virages serrés
 *   (épingles, demi-tours, angles droits de carrefour) : là où le décalage dépasse le rayon de
 *   courbure, les sommets du bord intérieur qui « reculent » sont fusionnés en un pivot commun
 *   (éventail de triangles), au lieu de former une queue d'aronde qui déborde en pointe.
 * - `RouteFootprint` : emprise de l'itinéraire actif (index spatial de l'axe).
 * - `sideRoadStrips` : routes du réseau OSM découpées au bord de la chaussée de l'itinéraire
 *   (doublons supprimés, carrefours arrêtés net sur la ligne de rive, raccord en altitude).
 */

export interface AxisPoint {
  x: number;
  z: number;
}

export interface AxisPoint3 extends AxisPoint {
  y: number;
  d: number;
}

/** Normales droites (−tz, tx) par tangente centrée, comme RouteTrack.positionAt. */
export function rightNormals(pts: readonly AxisPoint[], loop: boolean): Float64Array {
  const n = pts.length;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i] as AxisPoint;
    const prev = pts[loop ? (i - 1 + n) % n : Math.max(i - 1, 0)] as AxisPoint;
    const next = pts[loop ? (i + 1) % n : Math.min(i + 1, n - 1)] as AxisPoint;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-9) {
      // points confondus : on garde la normale précédente
      dx = next.x - p.x;
      dz = next.z - p.z;
      len = Math.hypot(dx, dz);
    }
    if (len < 1e-9) {
      out[i * 2] = i > 0 ? (out[i * 2 - 2] as number) : 0;
      out[i * 2 + 1] = i > 0 ? (out[i * 2 - 1] as number) : 1;
      continue;
    }
    out[i * 2] = -dz / len;
    out[i * 2 + 1] = dx / len;
  }
  return out;
}

/**
 * Virages vifs (angle de carrefour, demi-tour du tracé GPS) : le profil du sommet est démultiplié
 * sur place, normales tournant par pas d'au plus `maxStep` rad de la normale du segment entrant à
 * celle du segment sortant. Le bord extérieur décrit alors un arc de rayon égal au décalage (au
 * lieu d'un pan coupé qui laisse voir l'herbe entre l'itinéraire et la route qui continue tout
 * droit) ; le bord intérieur, lui, se resserre en pivot (`sideEdges`).
 */
export function roundCorners<T extends AxisPoint>(pts: readonly T[], loop: boolean, maxStep = 0.26): { pts: T[]; normals: Float64Array } {
  const n = pts.length;
  const base = rightNormals(pts, loop);
  const outP: T[] = [];
  const outN: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i] as T;
    if (loop || (i > 0 && i < n - 1)) {
      const a = pts[(i - 1 + n) % n] as T;
      const b = pts[(i + 1) % n] as T;
      const li = Math.hypot(p.x - a.x, p.z - a.z);
      const lo = Math.hypot(b.x - p.x, b.z - p.z);
      if (li > 1e-6 && lo > 1e-6) {
        const ix = (p.x - a.x) / li;
        const iz = (p.z - a.z) / li;
        const ox = (b.x - p.x) / lo;
        const oz = (b.z - p.z) / lo;
        // angle signé du virage ; une rotation d'angle positif fait tourner la direction vers la droite
        const theta = Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz);
        const m = Math.ceil(Math.abs(theta) / maxStep);
        if (m >= 2) {
          const nx = -iz;
          const nz = ix;
          for (let k = 0; k <= m; k++) {
            const ang = (theta * k) / m;
            const c = Math.cos(ang);
            const sn = Math.sin(ang);
            outP.push(p);
            outN.push(nx * c - nz * sn, nx * sn + nz * c);
          }
          continue;
        }
      }
    }
    outP.push(p);
    outN.push(base[i * 2] as number, base[i * 2 + 1] as number);
  }
  return { pts: outP, normals: Float64Array.from(outN) };
}

/**
 * Bords d'un même côté de l'axe (décalages de même signe, du plus proche au plus lointain) sans
 * repli. Résultat : x,z par point de l'axe, pour chaque décalage.
 *
 * Un segment de bord qui va à rebours de l'axe (produit scalaire négatif) signale une queue
 * d'aronde : les sommets concernés sont regroupés jusqu'à ce que tout le bord avance, et chaque
 * groupe devient un pivot (éventail de triangles). Les groupes sont communs à toutes les colonnes
 * du côté, si bien qu'aucune bande (chaussée, accotement) ne se retourne. Les boucles sont
 * parcourues depuis le point le plus rectiligne, pour ne jamais couper un virage en deux.
 */
export function sideEdges(pts: readonly AxisPoint[], normals: Float64Array, offsets: readonly number[], loop: boolean): Float64Array[] {
  const n = pts.length;
  const raw = offsets.map((o) => {
    const e = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      e[i * 2] = (pts[i] as AxisPoint).x + (normals[i * 2] as number) * o;
      e[i * 2 + 1] = (pts[i] as AxisPoint).z + (normals[i * 2 + 1] as number) * o;
    }
    return e;
  });
  if (n < 3 || !offsets.length) return raw;
  let start = 0;
  if (loop) {
    // Départ au milieu d'une ligne droite : normales parallèles sur ±W points (W ≥ deux décalages).
    let len = 0;
    for (let i = 0; i < n; i++) len += Math.hypot((pts[(i + 1) % n] as AxisPoint).x - (pts[i] as AxisPoint).x, (pts[(i + 1) % n] as AxisPoint).z - (pts[i] as AxisPoint).z);
    const maxO = Math.max(...offsets.map(Math.abs));
    const W = Math.min(Math.floor(n / 2), Math.max(3, Math.ceil((2 * maxO) / Math.max(len / n, 0.1))));
    const dot = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      dot[i] = (normals[a] as number) * (normals[b] as number) + (normals[a + 1] as number) * (normals[b + 1] as number);
    }
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let w = -W; w < W; w++) m = Math.min(m, dot[(i + w + n) % n] as number);
      if (m > best + 1e-12) {
        best = m;
        start = i;
      }
    }
  }
  const idx = (k: number) => (start + k) % n;
  // Groupes : rang de fin du groupe commençant au rang k (−1 si k n'ouvre pas de groupe).
  let ends: number[] = [];
  for (let k = 0; k < n; k++) ends.push(k);
  const sideSign = (offsets[0] as number) >= 0 ? 1 : -1;
  const q = (e: Float64Array, k: number): [number, number] => [e[idx(k) * 2] as number, e[idx(k) * 2 + 1] as number];
  /** Coin du bord `e` sur les rangs a..b : intersection des bords bruts prolongés de part et d'autre. */
  const corner = (e: Float64Array, a: number, b: number): [number, number] | null => {
    if (a < 2 || b > n - 3) return null;
    const [x0, z0] = q(e, a - 2);
    const [x1, z1] = q(e, a - 1);
    const [x2, z2] = q(e, b + 1);
    const [x3, z3] = q(e, b + 2);
    const d1x = x1 - x0;
    const d1z = z1 - z0;
    const d2x = x3 - x2;
    const d2z = z3 - z2;
    const den = d1x * d2z - d1z * d2x;
    const l1 = Math.hypot(d1x, d1z);
    const l2 = Math.hypot(d2x, d2z);
    // Le virage doit tourner du côté du bord (sinon : plus de 180°, giratoire parcouru) et ne pas
    // être un quasi demi-tour (droites presque parallèles : épingle plus serrée que le décalage).
    if (l1 < 1e-9 || l2 < 1e-9 || den * sideSign < 0.1 * l1 * l2 || d1x * d2x + d1z * d2z < -0.95 * l1 * l2) return null;
    // (coin derrière le dernier sommet gardé : le contrôle d'avancée élargira le groupe)
    const t1 = ((x2 - x1) * d2z - (z2 - z1) * d2x) / den;
    const cx = x1 + d1x * t1;
    const cz = z1 + d1z * t1;
    // garde-fou : le coin reste près du virage
    const m = pts[idx((a + b) >> 1)] as AxisPoint;
    if (Math.hypot(cx - m.x, cz - m.z) > 3 * Math.abs(offsets[offsets.length - 1] as number) + 4) return null;
    return [cx, cz];
  };
  /**
   * Coins acceptables : chacun du bon côté de chaque segment d'axe du groupe, dans l'ordre des
   * colonnes (sinon une bande se retournerait), et à moins de 4 décalages de l'axe (onglet borné).
   */
  const cornersConsistent = (cs: Array<[number, number]>, a: number, b: number): boolean => {
    for (let k = a - 1; k <= b; k++) {
      const p = pts[idx(k)] as AxisPoint;
      const r = pts[idx(k + 1)] as AxisPoint;
      const ex = r.x - p.x;
      const ez = r.z - p.z;
      const L = Math.hypot(ex, ez);
      if (L < 1e-9) continue;
      let prev = 0;
      for (let c = 0; c < cs.length; c++) {
        const [cx, cz] = cs[c] as [number, number];
        const lat = (((cx - p.x) * -ez + (cz - p.z) * ex) / L) * sideSign;
        if (lat < prev + 0.01 || Math.hypot(cx - p.x, cz - p.z) > 4 * Math.abs(offsets[c] as number) + 1) return false;
        prev = lat;
      }
    }
    return true;
  };
  /**
   * Pivots des rangs a..b pour chaque colonne : le coin de chaque bord (virage d'angle, onglet
   * exact) si toutes les colonnes en ont un, sinon (demi-tour, épingle serrée) un pivot unique —
   * moyenne des sommets bruts de la colonne intérieure — pour que l'accotement s'efface dans le
   * virage au lieu de se retourner sur la chaussée.
   */
  const pivots = (a: number, b: number): Array<[number, number]> => {
    const own = raw.map((e) => corner(e, a, b));
    if (own.every((c) => c) && cornersConsistent(own as Array<[number, number]>, a, b)) return own as Array<[number, number]>;
    const e = raw[0] as Float64Array;
    let mx = 0;
    let mz = 0;
    for (let k = a; k <= b; k++) {
      mx += e[idx(k) * 2] as number;
      mz += e[idx(k) * 2 + 1] as number;
    }
    const cnt = b - a + 1;
    return raw.map(() => [mx / cnt, mz / cnt] as [number, number]);
  };
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (let c = 0; c < raw.length; c++) {
      const e = raw[c] as Float64Array;
      // Unités : groupes courants (rangs k0..k1) ; position = sommet brut ou pivot du groupe.
      const k0: number[] = [];
      const k1: number[] = [];
      const posOf = (u: number): [number, number] => ((k1[u] as number) > (k0[u] as number) ? (pivots(k0[u] as number, k1[u] as number)[c] as [number, number]) : q(e, k0[u] as number));
      const forward = (a: number, b: number): boolean => {
        const ia = idx(k1[a] as number);
        const ib = idx(k0[b] as number);
        const pa = pts[ia] as AxisPoint;
        const pb = pts[ib] as AxisPoint;
        let ax = pb.x - pa.x;
        let az = pb.z - pa.z;
        if (ax * ax + az * az < 1e-12) {
          // profils démultipliés sur un même point (roundCorners) : sens donné par les normales
          ax = (normals[ia * 2 + 1] as number) + (normals[ib * 2 + 1] as number);
          az = -(normals[ia * 2] as number) - (normals[ib * 2] as number);
        }
        const qa = posOf(a);
        const qb = posOf(b);
        return (qb[0] - qa[0]) * ax + (qb[1] - qa[1]) * az >= -1e-9;
      };
      for (let k = 0; k < n; ) {
        const end = ends[k] as number;
        k0.push(k);
        k1.push(end);
        while (k0.length >= 2 && !forward(k0.length - 2, k0.length - 1)) {
          k1[k1.length - 2] = k1[k1.length - 1] as number;
          k0.pop();
          k1.pop();
          changed = true;
        }
        k = end + 1;
      }
      const next: number[] = new Array<number>(n).fill(-1);
      for (let g = 0; g < k0.length; g++) next[k0[g] as number] = k1[g] as number;
      ends = next;
    }
    if (!changed) break;
  }
  const out = raw.map((e) => Float64Array.from(e));
  const sign = sideSign;
  for (let a = 0; a < n; ) {
    const b = ends[a] as number;
    if (b > a) {
      const piv = pivots(a, b);
      // Pivots du bon côté de chaque segment d'axe qu'ils desservent (sinon triangles retournés) :
      // même translation pour toutes les colonnes, d'après la plus proche de l'axe.
      const p0 = piv[0] as [number, number];
      let tx = 0;
      let tz = 0;
      for (let k = a; k < b; k++) {
        const p = pts[idx(k)] as AxisPoint;
        const r = pts[idx(k + 1)] as AxisPoint;
        const ex = r.x - p.x;
        const ez = r.z - p.z;
        const L = Math.hypot(ex, ez);
        if (L < 1e-9) continue;
        const lat = ((p0[0] + tx - p.x) * -ez + (p0[1] + tz - p.z) * ex) / L;
        if (lat * sign < 0.05) {
          const push = (0.05 - lat * sign) * sign;
          tx += (-ez / L) * push;
          tz += (ex / L) * push;
        }
      }
      out.forEach((e, c) => {
        const pv = piv[c] as [number, number];
        for (let k = a; k <= b; k++) {
          e[idx(k) * 2] = pv[0] + tx;
          e[idx(k) * 2 + 1] = pv[1] + tz;
        }
      });
    }
    a = b + 1;
  }
  return out;
}

/**
 * Bords de colonnes de décalages quelconques (m, + = à droite), traités par côté. `normals` :
 * normales imposées par profil (voir `roundCorners`), sinon tangente centrée.
 */
export function ribbonEdges(pts: readonly AxisPoint[], offsets: readonly number[], loop: boolean, normals: Float64Array = rightNormals(pts, loop)): Float64Array[] {
  const cols: Float64Array[] = new Array<Float64Array>(offsets.length);
  const order = offsets.map((o, c) => ({ o, c }));
  const left = order.filter((e) => e.o < 0).sort((a, b) => b.o - a.o);
  const right = order.filter((e) => e.o > 0).sort((a, b) => a.o - b.o);
  for (const side of [left, right]) {
    const edges = sideEdges(pts, normals, side.map((e) => e.o), loop);
    side.forEach((e, i) => (cols[e.c] = edges[i] as Float64Array));
  }
  // Colonnes sur l'axe (décalage nul) : l'axe lui-même.
  order.forEach((e) => {
    if (e.o === 0) cols[e.c] = sideEdges(pts, normals, [0], loop)[0] as Float64Array;
  });
  return cols;
}

/**
 * Triangles d'un ruban à `cols` colonnes sur `rows` profils (sommet = profil × cols + colonne).
 * Chaque quadrilatère est coupé selon la diagonale qui garde ses deux triangles à l'endroit
 * (quadrilatère concave près d'un pivot d'éventail) ; `dropFlipped` écarte les triangles retournés
 * d'un quadrilatère vrillé (normale vers le bas : tache noire).
 */
export function ribbonIndex(pos: ArrayLike<number>, stride: number, cols: number, rows: number, dropFlipped = false): number[] {
  const index: number[] = [];
  // aire signée dans le plan xz ; un ruban vu de dessus donne une aire négative (voir RoadMesh)
  const area = (i: number, j: number, k: number) => {
    const ax = pos[i * stride] as number;
    const az = pos[i * stride + 2] as number;
    return ((pos[j * stride] as number) - ax) * ((pos[k * stride + 2] as number) - az) - ((pos[j * stride + 2] as number) - az) * ((pos[k * stride] as number) - ax);
  };
  for (let k = 0; k < rows - 1; k++)
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c;
      const b = a + 1;
      const a2 = a + cols;
      const b2 = b + cols;
      const ok1 = area(a, b, a2) <= 1e-9 && area(b, b2, a2) <= 1e-9;
      const ok2 = area(a, b, b2) <= 1e-9 && area(a, b2, a2) <= 1e-9;
      if (ok1) index.push(a, b, a2, b, b2, a2);
      else if (ok2) index.push(a, b, b2, a, b2, a2);
      else if (dropFlipped) {
        // quadrilatère vrillé : on ne garde que ses triangles à l'endroit
        if (area(a, b, a2) <= 1e-9) index.push(a, b, a2);
        if (area(b, b2, a2) <= 1e-9) index.push(b, b2, a2);
      } else index.push(a, b, a2, b, b2, a2);
    }
  return index;
}

// ————————————————————————————————————————————————————————————— Emprise de l'itinéraire

export interface FootprintHit {
  /** Distance horizontale à l'axe (m). */
  dist: number;
  /** Côté signé (+ = droite de l'axe). */
  side: number;
  /** Altitude de l'axe au point le plus proche. */
  y: number;
  /** Tangente unitaire de l'axe. */
  tx: number;
  tz: number;
  /** Point le plus proche sur l'axe. */
  px: number;
  pz: number;
  d: number;
}

/** Index spatial (grille) des segments de l'axe d'un itinéraire. */
export class RouteFootprint {
  readonly half: number;
  readonly shoulder: number;
  private readonly cell = 16;
  private readonly grid = new Map<number, number[]>();
  private readonly pts: readonly AxisPoint3[];
  private readonly segs: number;

  constructor(pts: readonly AxisPoint3[], loop: boolean, halfWidth: number, shoulder: number) {
    this.pts = pts;
    this.half = halfWidth;
    this.shoulder = shoulder;
    const n = pts.length;
    this.segs = loop ? n : n - 1;
    for (let i = 0; i < this.segs; i++) {
      const a = pts[i] as AxisPoint3;
      const b = pts[(i + 1) % n] as AxisPoint3;
      const x0 = Math.floor(Math.min(a.x, b.x) / this.cell);
      const x1 = Math.floor(Math.max(a.x, b.x) / this.cell);
      const z0 = Math.floor(Math.min(a.z, b.z) / this.cell);
      const z1 = Math.floor(Math.max(a.z, b.z) / this.cell);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = key(x, z);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(i);
        }
    }
  }

  /**
   * Point de l'axe le plus proche à moins de `maxR` m, ou null. Avec `y` : seulement les passages
   * de l'itinéraire à ce niveau (±`maxDy`), pour ignorer celui qui passe dessus ou dessous (pont).
   */
  nearest(x: number, z: number, maxR: number, y?: number, maxDy = SAME_LEVEL): FootprintHit | null {
    let best: FootprintHit | null = null;
    let bestD = maxR;
    this.scan(x, z, maxR, (s, t, dist) => {
      if (dist > bestD) return;
      const a = this.pts[s] as AxisPoint3;
      const b = this.pts[(s + 1) % this.pts.length] as AxisPoint3;
      const sy = a.y + (b.y - a.y) * t;
      if (y !== undefined && Math.abs(sy - y) > maxDy) return;
      bestD = dist;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const L = Math.hypot(ex, ez);
      const px = a.x + ex * t;
      const pz = a.z + ez * t;
      best = { dist, side: ((x - px) * -ez + (z - pz) * ex) / L, y: sy, tx: ex / L, tz: ez / L, px, pz, d: a.d + t * L };
    });
    return best;
  }

  /** Appelle `fn(segment, t, distance)` pour chaque segment de l'axe à moins de `maxR` m. */
  private scan(x: number, z: number, maxR: number, fn: (s: number, t: number, dist: number) => void): void {
    const c = this.cell;
    const r = Math.ceil(maxR / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    const pts = this.pts;
    const n = pts.length;
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const l = this.grid.get(key(cx + i, cz + j));
        if (!l) continue;
        for (const s of l) {
          const a = pts[s] as AxisPoint3;
          const b = pts[(s + 1) % n] as AxisPoint3;
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const L2 = ex * ex + ez * ez;
          if (L2 < 1e-12) continue;
          const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
          const dist = Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
          if (dist <= maxR) fn(s, t, dist);
        }
      }
  }

  /** Vrai si une case de la grille autour du point contient l'axe (test rapide). */
  near(x: number, z: number, reach: number): boolean {
    const c = this.cell;
    const r = Math.ceil(reach / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (this.grid.has(key(cx + i, cz + j))) return true;
    return false;
  }

  /**
   * Altitude maximale du terrain sous le ruban : sommets de maillage à moins de
   * demi-largeur + accotement + `reach` de l'axe abaissés juste sous la chaussée, pour qu'aucune
   * facette (interpolée entre sommets distants de `reach`) ne la traverse. Rien n'est touché au
   * droit d'un tunnel (`axisGround` : altitude du sol non abaissé sur l'axe, NaN si inconnue).
   */
  clampTerrain(x: number, z: number, h: number, reach: number, axisGround?: (x: number, z: number) => number): number {
    const R = this.half + this.shoulder + reach;
    if (!this.near(x, z, R)) return h;
    // Passage le plus bas à portée (sous un pont de l'itinéraire, c'est la route du dessous qui compte).
    let top = h;
    this.scan(x, z, R, (s, t) => {
      const a = this.pts[s] as AxisPoint3;
      const b = this.pts[(s + 1) % this.pts.length] as AxisPoint3;
      const y = a.y + (b.y - a.y) * t;
      // Tunnel : le générateur ne creuse pas, le sol reste haut sur l'axe même ; une tranchée
      // (déblai en montagne) est creusée à plat sur l'axe, même si le talus monte vite à côté.
      const g = axisGround ? axisGround(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) : Number.NaN;
      const tunnel = Number.isFinite(g) ? g - y > TUNNEL_AXIS : h - y > TUNNEL_COVER;
      if (!tunnel) top = Math.min(top, y - TERRAIN_BELOW);
    });
    return top;
  }
}

/** Écart d'altitude au-delà duquel deux routes se croisent à des niveaux différents (pont). */
const SAME_LEVEL = 2.5;
/** Le terrain reste au moins à ce retrait sous l'axe de la chaussée (m). */
const TERRAIN_BELOW = 0.04;
/** Sans altitude du sol sur l'axe : au-delà de cette hauteur de terrain au-dessus de la route, tunnel (m). */
const TUNNEL_COVER = 5;
/** Sol sur l'axe plus haut que la route de plus de ceci : tunnel (m). */
const TUNNEL_AXIS = 2.5;

const key = (x: number, z: number) => x * 73856093 + z * 19349663;

// ————————————————————————————————————————————————————————————— Réseau secondaire

export interface SideStrip {
  /** Bords gauche et droit (x,y,z) par profil. */
  left: number[];
  right: number[];
  /** Abscisse le long du tronçon (m), pour le pointillé. */
  along: number[];
}

/** Recouvrement : la route du réseau est dans la chaussée de l'itinéraire, ou la double. */
function covered(fp: RouteFootprint, x: number, z: number, y: number, dx: number, dz: number, rh: number): boolean {
  const reach = fp.half + Math.max(rh, 0.5);
  if (!fp.near(x, z, reach)) return false;
  const h = fp.nearest(x, z, reach, y);
  if (!h) return false;
  if (h.dist < fp.half + 0.25) return true;
  // Doublon décalé (même route tracée par OSM et par le GPS) : parallèle et à moitié dans la chaussée.
  return Math.abs(dx * h.tx + dz * h.tz) > 0.85 && h.dist < fp.half + rh * 0.6;
}

/** Surélévation du débouché d'une route secondaire par rapport à l'axe de l'itinéraire (m). */
const JOIN_ABOVE = 0.02;
/** Longueur de raccord en altitude d'une route secondaire sur l'itinéraire (m). */
const BLEND_M = 12;

/**
 * Découpe une route du réseau (polyligne x,y,z) contre l'emprise de l'itinéraire et construit ses
 * bords (demi-largeur `hw`, bas-côté compris). Les extrémités coupées sont posées sur la ligne de
 * rive de l'itinéraire (profil oblique si le carrefour l'est) et raccordées à son altitude.
 */
export function sideRoadStrips(pts3: readonly number[], hw: number, rh: number, fp: RouteFootprint | null, lift: number): SideStrip[] {
  const n = pts3.length / 3;
  if (n < 2) return [];
  // Densification à ~1 m pour localiser précisément l'entrée dans l'emprise.
  const P: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const ax = pts3[i * 3] as number;
    const ay = pts3[i * 3 + 1] as number;
    const az = pts3[i * 3 + 2] as number;
    const bx = pts3[i * 3 + 3] as number;
    const by = pts3[i * 3 + 4] as number;
    const bz = pts3[i * 3 + 5] as number;
    const L = Math.hypot(bx - ax, bz - az);
    const steps = fp && fp.near((ax + bx) / 2, (az + bz) / 2, L / 2 + fp.half + rh + 2) ? Math.max(1, Math.ceil(L)) : 1;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      P.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    }
  }
  P.push(pts3[(n - 1) * 3] as number, pts3[(n - 1) * 3 + 1] as number, pts3[(n - 1) * 3 + 2] as number);
  const m = P.length / 3;
  const cov = new Uint8Array(m);
  if (fp) {
    for (let i = 0; i < m; i++) {
      const a = Math.max(i - 1, 0);
      const b = Math.min(i + 1, m - 1);
      let dx = (P[b * 3] as number) - (P[a * 3] as number);
      let dz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      cov[i] = covered(fp, P[i * 3] as number, P[i * 3 + 2] as number, P[i * 3 + 1] as number, dx, dz, rh) ? 1 : 0;
    }
  }
  // Morceaux hors emprise ; extrémités coupées repérées.
  const out: SideStrip[] = [];
  let i = 0;
  while (i < m) {
    if (cov[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < m && !cov[j + 1]) j++;
    const piece: number[] = [];
    // Points densifiés gardés (seulement près de l'itinéraire) : le bord repoussé suit la rive.
    for (let k = i; k <= j; k++) piece.push(P[k * 3] as number, P[k * 3 + 1] as number, P[k * 3 + 2] as number);
    // Bout de polyligne qui s'arrête juste avant l'itinéraire (nœud OSM à quelques mètres du tracé
    // GPS, morceau voisin entièrement recouvert) : traité comme une coupe, prolongé jusqu'à la rive.
    const reachesRoute = (k: number, k2: number): boolean => {
      if (!fp || k2 < 0 || k2 >= m) return false;
      const y = P[k * 3 + 1] as number;
      const h = fp.nearest(P[k * 3] as number, P[k * 3 + 2] as number, fp.half + fp.shoulder + 1.5, y);
      const h2 = h && fp.nearest(P[k2 * 3] as number, P[k2 * 3 + 2] as number, fp.half + fp.shoulder + 30, y);
      return !!h && !!h2 && h.dist >= fp.half && h2.dist > h.dist;
    };
    const cutStart = i > 0 || reachesRoute(0, 1);
    const cutEnd = j < m - 1 || reachesRoute(m - 1, m - 2);
    const strip = buildStrip(piece, hw, lift, fp, cutStart, cutEnd);
    if (strip) out.push(strip);
    i = j + 1;
  }
  return out;
}

function buildStrip(p: number[], hw: number, lift: number, fp: RouteFootprint | null, cutStart: boolean, cutEnd: boolean): SideStrip | null {
  let n = p.length / 3;
  if (n < 2) return null;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot((p[i * 3] as number) - (p[i * 3 - 3] as number), (p[i * 3 + 2] as number) - (p[i * 3 - 1] as number));
  // Morceau résiduel trop court entre deux coupes (bout de raccord coincé dans l'emprise) : rien.
  if (len < 1.5 && (cutStart || cutEnd)) return null;
  // Raccord en altitude sur l'itinéraire aux extrémités coupées (ou qui débouchent sur la chaussée).
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) ys[i] = p[i * 3 + 1] as number;
  if (fp) {
    const joinY = (k: number): number => {
      const h = fp.nearest(p[k * 3] as number, p[k * 3 + 2] as number, fp.half + fp.shoulder + 1, p[k * 3 + 1] as number);
      // un peu au-dessus de la rive (accotement gravillonné de l'itinéraire recouvert au débouché)
      return h ? h.y + JOIN_ABOVE : Number.NaN;
    };
    const blend = (from: number, dir: 1 | -1) => {
      const y0 = joinY(from);
      if (!Number.isFinite(y0)) return;
      const delta = y0 - (ys[from] as number);
      let acc = 0;
      for (let k = from; k >= 0 && k < n; k += dir) {
        if (k !== from) acc += Math.hypot((p[k * 3] as number) - (p[(k - dir) * 3] as number), (p[k * 3 + 2] as number) - (p[(k - dir) * 3 + 2] as number));
        if (acc >= BLEND_M) break;
        const w = 1 - acc / BLEND_M;
        ys[k] = (ys[k] as number) + delta * w * w * (3 - 2 * w);
      }
    };
    if (cutStart) blend(0, 1);
    if (cutEnd) blend(n - 1, -1);
  }
  const left: number[] = [];
  const right: number[] = [];
  const along: number[] = [];
  const dirs: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3] as number;
    const z = p[i * 3 + 2] as number;
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 1, n - 1);
    let dx = (p[b * 3] as number) - (p[a * 3] as number);
    let dz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    if (i > 0) acc += Math.hypot(x - (p[i * 3 - 3] as number), z - (p[i * 3 - 1] as number));
    const y = (ys[i] as number) + lift;
    // normale droite (−dz, dx)
    dirs.push(dx, dz);
    left.push(x + dz * hw, y, z - dx * hw);
    right.push(x - dz * hw, y, z + dx * hw);
    along.push(acc);
  }
  n = along.length;
  if (fp) {
    if (cutStart) snapEnd(left, right, 0, 1, fp);
    if (cutEnd) snapEnd(left, right, n - 1, -1, fp);
    // Bords qui empiètent encore sur la chaussée (route qui longe l'itinéraire) : repoussés au bord.
    for (const e of [left, right])
      for (let i = 0; i < n; i++) {
        const x = e[i * 3] as number;
        const z = e[i * 3 + 2] as number;
        const h = fp.nearest(x, z, fp.half, (e[i * 3 + 1] as number) - lift);
        if (!h || h.dist >= fp.half) continue;
        const s = h.side >= 0 ? 1 : -1;
        e[i * 3] = h.px - h.tz * fp.half * s;
        e[i * 3 + 2] = h.pz + h.tx * fp.half * s;
      }
    // Chaque bord avance toujours dans le sens du tronçon (sinon quadrilatère vrillé, normale
    // inversée) : un sommet ramené en arrière par les corrections rejoint son voisin, en partant
    // des bouts coupés (posés sur la rive, ils ne bougent plus).
    const mid = cutEnd ? (cutStart ? n >> 1 : 0) : n;
    const back = (e: number[], i: number, j: number) => {
      // i doit précéder j dans le sens du tronçon
      const ex = (e[j * 3] as number) - (e[i * 3] as number);
      const ez = (e[j * 3 + 2] as number) - (e[i * 3 + 2] as number);
      return ex * (dirs[j * 2] as number) + ez * (dirs[j * 2 + 1] as number) < 0;
    };
    for (const e of [left, right]) {
      for (let i = 1; i < mid; i++)
        if (back(e, i - 1, i)) {
          e[i * 3] = e[i * 3 - 3] as number;
          e[i * 3 + 2] = e[i * 3 - 1] as number;
        }
      for (let i = n - 2; i >= Math.max(mid - 1, 0); i--)
        if (back(e, i, i + 1)) {
          e[i * 3] = e[i * 3 + 3] as number;
          e[i * 3 + 2] = e[i * 3 + 5] as number;
        }
    }
  }
  return { left, right, along };
}

/**
 * Extrémité coupée : chaque sommet du profil terminal glisse le long du tronçon jusqu'à la ligne
 * de rive de l'itinéraire (distance à l'axe = demi-chaussée), d'où un bout oblique qui épouse le
 * bord au lieu d'une pointe ou d'un coin de gravier.
 */
function snapEnd(left: number[], right: number[], k: number, dir: 1 | -1, fp: RouteFootprint): void {
  const k2 = k + dir;
  if (k2 < 0 || k2 * 3 >= left.length) return;
  const slides: number[] = [];
  const orig = [left[k * 3] as number, left[k * 3 + 2] as number, right[k * 3] as number, right[k * 3 + 2] as number];
  const width = Math.hypot((orig[0] as number) - (orig[2] as number), (orig[1] as number) - (orig[3] as number));
  for (const e of [left, right]) {
    slides.push(0);
    const x = e[k * 3] as number;
    const z = e[k * 3 + 2] as number;
    // direction vers l'itinéraire = du sommet voisin vers l'extrémité
    let ux = x - (e[k2 * 3] as number);
    let uz = z - (e[k2 * 3 + 2] as number);
    const L = Math.hypot(ux, uz);
    if (L < 1e-6) continue;
    ux /= L;
    uz /= L;
    const f = (t: number) => {
      const h = fp.nearest(x + ux * t, z + uz * t, fp.half + 20, e[k * 3 + 1] as number);
      return (h ? h.dist : fp.half + 20) - fp.half;
    };
    const f0 = f(0);
    const MAX = 12;
    // f > 0 : sommet hors chaussée → avancer ; f < 0 : sommet dedans → reculer.
    // premier changement de signe par pas de 0,5 m, puis dichotomie
    const dirT = f0 > 0 ? 1 : -1;
    // à reculons, au plus une largeur de chaussée (au-delà : route qui longe l'itinéraire)
    const max = dirT > 0 ? MAX : Math.min(MAX, width);
    let lo = 0;
    let hi = Number.NaN;
    for (let t = Math.min(0.5, max); t <= max; t += 0.5) {
      if (Math.sign(f(t * dirT)) !== Math.sign(f0)) {
        hi = t * dirT;
        break;
      }
      lo = t * dirT;
    }
    if (!Number.isFinite(hi)) continue; // pas de bord atteignable : on laisse
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(f(mid)) === Math.sign(f0)) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    e[k * 3] = x + ux * t;
    e[k * 3 + 2] = z + uz * t;
    slides[slides.length - 1] = t;
  }
  // Le bout ne doit pas couper la chaussée (rive concave, angle de l'itinéraire, bout de
  // demi-tour) : sinon on annule le plus long glissement ; le sommet resté dans la chaussée sera
  // repoussé au bord.
  const y = left[k * 3 + 1] as number;
  for (let tries = 0; tries < 2; tries++) {
    let cuts = false;
    for (let i = 1; i < 8 && !cuts; i++) {
      const u = i / 8;
      const x = (left[k * 3] as number) * (1 - u) + (right[k * 3] as number) * u;
      const z = (left[k * 3 + 2] as number) * (1 - u) + (right[k * 3 + 2] as number) * u;
      const h = fp.nearest(x, z, fp.half, y);
      // (flèche tolérée : corde d'un bout posé sur une rive convexe, bout de demi-tour)
      if (h && h.dist < fp.half - 0.75) cuts = true;
    }
    if (!cuts) return;
    const j = Math.abs(slides[0] as number) >= Math.abs(slides[1] as number) ? 0 : 1;
    const e = j === 0 ? left : right;
    e[k * 3] = orig[j * 2] as number;
    e[k * 3 + 2] = orig[j * 2 + 1] as number;
    slides[j] = 0;
  }
}
