/**
 * Voies ferrées et horaires des trains, sans dépendance au moteur (testable).
 * Les voies OSM arrivent découpées par tuile ; on les raboute en « lignes » continues (la
 * continuation la plus droite à chaque aiguillage), puis on fait circuler des rames selon un
 * horaire cadencé plausible (RER : un train tous les quarts d'heure, toutes les 10 min aux heures
 * de pointe ; terminus avec rebroussement).
 */

export interface RailPiece {
  /** Polyligne 3D x, y, z (y = haut du rail). */
  pts: number[];
  name?: string;
}

export interface RailLine {
  /** Polyligne 3D continue. */
  pts: number[];
  /** Abscisse cumulée de chaque point (m). */
  s: number[];
  length: number;
  /** Extrémités en cul-de-sac dans les données (heurtoir de terminus), et non coupées par une tuile absente. */
  deadStart: boolean;
  deadEnd: boolean;
  name?: string;
}

const key = (x: number, z: number) => `${Math.round(x * 2)}_${Math.round(z * 2)}`;

function heading(pts: number[], atEnd: boolean): [number, number] {
  const n = pts.length / 3;
  const [i, j] = atEnd ? [n - 2, n - 1] : [1, 0];
  const dx = (pts[j * 3] as number) - (pts[i * 3] as number);
  const dz = (pts[j * 3 + 2] as number) - (pts[i * 3 + 2] as number);
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

function polyLength(pts: number[]): number {
  let l = 0;
  for (let i = 3; i < pts.length; i += 3) l += Math.hypot((pts[i] as number) - (pts[i - 3] as number), (pts[i + 2] as number) - (pts[i - 1] as number));
  return l;
}

function reversed(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 3; i >= 0; i -= 3) out.push(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number);
  return out;
}

/**
 * Raboute les tronçons en lignes, des plus longues aux plus courtes : on part du plus long
 * tronçon libre et on prolonge à chaque bout par le tronçon libre le plus aligné (déviation
 * ≤ 35°). `onBoundary(x, z)` dit si un point est sur un bord de tuile (ligne coupée, pas un
 * terminus). Ne garde que les lignes d'au moins `minLength` mètres.
 */
export function assembleLines(pieces: RailPiece[], onBoundary: (x: number, z: number) => boolean, minLength = 300): RailLine[] {
  const ends = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    if (p.pts.length < 6) return;
    for (const atEnd of [false, true]) {
      const o = atEnd ? p.pts.length - 3 : 0;
      const k = key(p.pts[o] as number, p.pts[o + 2] as number);
      let a = ends.get(k);
      if (!a) ends.set(k, (a = []));
      a.push(i);
    }
  });
  const used = new Set<number>();
  const order = pieces.map((p, i) => [i, polyLength(p.pts)] as const).sort((a, b) => b[1] - a[1]);
  const lines: RailLine[] = [];
  for (const [start] of order) {
    if (used.has(start) || (pieces[start]?.pts.length ?? 0) < 6) continue;
    used.add(start);
    let pts = (pieces[start] as RailPiece).pts.slice();
    const name = (pieces[start] as RailPiece).name;
    // prolonge à la fin, puis (en retournant) au début
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const n = pts.length / 3;
        const ex = pts[(n - 1) * 3] as number;
        const ez = pts[(n - 1) * 3 + 2] as number;
        const [hx, hz] = heading(pts, true);
        let best = -1;
        let bestCos = Math.cos((35 * Math.PI) / 180);
        let bestRev = false;
        for (const j of ends.get(key(ex, ez)) ?? []) {
          if (used.has(j)) continue;
          const q = (pieces[j] as RailPiece).pts;
          const startsHere = key(q[0] as number, q[2] as number) === key(ex, ez);
          const cand = startsHere ? q : reversed(q);
          const [cx, cz] = heading(cand, false);
          const c = -(cx * hx + cz * hz); // heading(…, false) pointe vers l'arrière du tronçon
          if (c > bestCos) {
            bestCos = c;
            best = j;
            bestRev = !startsHere;
          }
        }
        if (best < 0) break;
        used.add(best);
        const q = (pieces[best] as RailPiece).pts;
        pts = pts.concat((bestRev ? reversed(q) : q).slice(3));
      }
      pts = reversed(pts);
    }
    const length = polyLength(pts);
    if (length < minLength) continue;
    const s = [0];
    for (let i = 3; i < pts.length; i += 3) s.push((s[s.length - 1] as number) + Math.hypot((pts[i] as number) - (pts[i - 3] as number), (pts[i + 2] as number) - (pts[i - 1] as number)));
    const n = pts.length / 3;
    const deadOf = (i: number) => {
      const x = pts[i * 3] as number;
      const z = pts[i * 3 + 2] as number;
      return !onBoundary(x, z) && (ends.get(key(x, z))?.length ?? 0) <= 1;
    };
    lines.push({ pts, s, length, deadStart: deadOf(0), deadEnd: deadOf(n - 1), ...(name ? { name } : {}) });
  }
  return lines;
}

/** Point (x, y, z) et direction (dx, dz) à l'abscisse `d` d'une ligne (bornée). */
export function pointAt(line: RailLine, d: number, out: { x: number; y: number; z: number; dx: number; dz: number }): typeof out {
  const s = line.s;
  const dd = Math.min(Math.max(d, 0), line.length);
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((s[mid] as number) <= dd) lo = mid;
    else hi = mid;
  }
  const t = ((dd - (s[lo] as number)) / ((s[hi] as number) - (s[lo] as number) || 1)) as number;
  const p = line.pts;
  out.x = (p[lo * 3] as number) + ((p[hi * 3] as number) - (p[lo * 3] as number)) * t;
  out.y = (p[lo * 3 + 1] as number) + ((p[hi * 3 + 1] as number) - (p[lo * 3 + 1] as number)) * t;
  out.z = (p[lo * 3 + 2] as number) + ((p[hi * 3 + 2] as number) - (p[lo * 3 + 2] as number)) * t;
  const dx = (p[hi * 3] as number) - (p[lo * 3] as number);
  const dz = (p[hi * 3 + 2] as number) - (p[lo * 3 + 2] as number);
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l;
  out.dz = dz / l;
  return out;
}

export interface TrainSpec {
  /** Longueur de la rame (m). */
  length: number;
  /** Vitesse maximale (m/s) et accélération / freinage (m/s²). */
  vmax: number;
  accel: number;
  /** Arrêt en gare au terminus (s) avant le départ. */
  dwell: number;
}

/** RER (rame de 8 voitures d'environ 26 m) : 90 km/h sur la section, 0,9 m/s². */
export const RER: TrainSpec = { length: 208, vmax: 25, accel: 0.9, dwell: 300 };

/** Intervalle entre deux trains (s) selon l'heure : 10 min aux heures de pointe, 15 min sinon, rien de 1 h à 5 h. */
export function headwayAt(hourOfDay: number): number {
  const h = ((hourOfDay % 24) + 24) % 24;
  if (h >= 1 && h < 5) return 0;
  if ((h >= 6.5 && h < 9.5) || (h >= 16.5 && h < 19.5)) return 600;
  return 900;
}

/** Distance parcourue `tau` secondes après un départ arrêté (accélération puis vitesse maximale). */
export function runDistance(tau: number, spec: TrainSpec): number {
  if (tau <= 0) return 0;
  const tA = spec.vmax / spec.accel;
  return tau < tA ? 0.5 * spec.accel * tau * tau : 0.5 * spec.vmax * tA + spec.vmax * (tau - tA);
}

export interface TrainPos {
  /** Abscisse de l'arrière de la rame (côté s faibles) ; la rame occupe [s0, s0 + longueur]. */
  s0: number;
  /** +1 : roule vers les s croissants, −1 : vers les s décroissants, 0 : à quai. */
  dir: 1 | -1 | 0;
}

/**
 * Rames visibles sur une ligne à l'instant `t` (secondes depuis minuit, horloge du jeu).
 * - Terminus en début de ligne (`deadStart`) : chaque rame arrive (freinage), reste à quai
 *   `dwell` secondes, puis repart (rebroussement) ; une rame toutes les `headwayAt` secondes,
 *   décalée de `phase`.
 * - Sinon (ligne traversante) : une rame par intervalle à vitesse maximale, dans le sens `pass`.
 * `anchor` : abscisse d'un point fixe du monde sur la ligne (les horaires ne sautent pas quand
 * la ligne s'allonge parce que des tuiles se chargent).
 */
export function trainsAt(line: RailLine, t: number, spec: TrainSpec, phase: number, pass: 1 | -1, anchor: number): TrainPos[] {
  const out: TrainPos[] = [];
  const head = headwayAt(t / 3600);
  if (!head) return out;
  const visible = (s0: number) => s0 + spec.length > 0 && s0 < line.length;
  if (line.deadStart || line.deadEnd) {
    // On se ramène à un terminus en s = 0 (miroir si le heurtoir est en fin de ligne).
    const mirror = !line.deadStart;
    const stop = 25; // arrière de la rame à 25 m du heurtoir
    const cycle = Math.floor((t - phase) / head);
    for (let k = cycle - 2; k <= cycle + 2; k++) {
      const dep = k * head + phase;
      const arr = dep - spec.dwell;
      let s0: number;
      let dir: 1 | -1 | 0;
      if (t < arr) {
        s0 = stop + runDistance(arr - t, spec);
        dir = -1;
      } else if (t < dep) {
        s0 = stop;
        dir = 0;
      } else {
        s0 = stop + runDistance(t - dep, spec);
        dir = 1;
      }
      if (s0 > line.length + 50) continue;
      if (mirror) {
        s0 = line.length - s0 - spec.length;
        dir = dir === 0 ? 0 : dir === 1 ? -1 : 1;
      }
      if (visible(s0)) out.push({ s0, dir });
    }
    return out;
  }
  // Ligne traversante : position = anchor + v·(t − passage au point d'ancrage).
  const k0 = Math.floor((t - phase) / head);
  for (let k = k0 - 3; k <= k0 + 3; k++) {
    const tk = k * head + phase;
    const front = anchor + pass * spec.vmax * (t - tk);
    const s0 = pass === 1 ? front - spec.length : front;
    if (visible(s0)) out.push({ s0, dir: pass });
  }
  return out;
}
