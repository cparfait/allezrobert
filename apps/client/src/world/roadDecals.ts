/**
 * Défauts et équipements de chaussée posés un par un, là où ils ont un sens (à la manière de Spiderbench) :
 * rapiéçages et tranchées, plaques d'égout, avaloirs dans le caniveau, taches d'huile avant les passages
 * piétons, passages piétons au débouché des carrefours, avaloirs dans le caniveau pavé. Ce sont des quads
 * posés 1 à 2 cm au-dessus de la chaussée, dans le même maillage et le même matériau que la voirie : leur
 * shader recalcule la chaussée en dessous (mêmes coordonnées), d'où des bords fondus sans transparence.
 * Remplace les rapiéçages et taches tirés au hasard dans le shader, qui faisaient des bandes sans logique.
 */

export const DECAL_PATCH = 1;
export const DECAL_TRENCH = 2;
export const DECAL_MANHOLE = 3;
export const DECAL_GRATE = 4;
export const DECAL_OIL = 5;
export const DECAL_CROSSWALK = 6;
export const DECAL_GUTTER = 7;

/** Largeur du caniveau pavé, contre la bordure (m) ; dessiné par le ruban (type DECAL_GUTTER dans le shader). */
export const GUTTER_W = 0.42;

/** Hauteur au-dessus de la chaussée, par type : un avaloir passe sur le caniveau, une tache sur rien d'autre. */
const LIFT: Record<number, number> = { [DECAL_GUTTER]: 0.012, [DECAL_PATCH]: 0.014, [DECAL_TRENCH]: 0.014, [DECAL_OIL]: 0.016, [DECAL_CROSSWALK]: 0.018, [DECAL_MANHOLE]: 0.02, [DECAL_GRATE]: 0.022 };

/** Un décalque : rectangle en coordonnées de voie (`u` : mètres depuis l'axe, signé ; `a` : mètres le long). */
export interface Decal {
  kind: number;
  u0: number;
  u1: number;
  a0: number;
  a1: number;
  seed: number;
}

export interface StripDecalInput {
  /** Abscisse curviligne de chaque profil (monotone). */
  along: readonly number[];
  half: number;
  /** Demi-largeur du ruban (bord de chaussée + accotement) : le caniveau finit là, contre la bordure. */
  o: number;
  /** Rue de ville (trottoirs possibles) : caniveaux, passages piétons, plaques, avaloirs. */
  city: boolean;
  /** Largeur de trottoir par profil, à gauche et à droite (0 : pas de trottoir). */
  wL: readonly number[];
  wR: readonly number[];
  /** Graine stable du tronçon (même tirage à chaque chargement). */
  seed: number;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine d'un tronçon d'après son premier point. */
export function stripSeed(x: number, z: number): number {
  return (Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663)) >>> 0;
}

/** Choisit les décalques d'un tronçon. Pur et déterministe (testé). */
export function placeDecals(s: StripDecalInput): Decal[] {
  const out: Decal[] = [];
  const n = s.along.length;
  if (n < 2) return out;
  const { half, o, city } = s;
  const r = rng(s.seed);
  const first = s.along[0] as number;
  const last = s.along[n - 1] as number;
  const A0 = Math.min(first, last);
  const A1 = Math.max(first, last);
  const len = A1 - A0;
  const dirUp = last >= first ? 1 : -1;
  const taken: Decal[] = [];
  const add = (d: Decal): boolean => {
    if (d.a1 - d.a0 < 0.05 || d.u1 - d.u0 < 0.05) return false;
    if (d.a0 < A0 - 1e-6 || d.a1 > A1 + 1e-6) return false;
    if (taken.some((t) => d.u0 < t.u1 && d.u1 > t.u0 && d.a0 < t.a1 && d.a1 > t.a0)) return false;
    out.push(d);
    taken.push(d);
    return true;
  };
  const rect = (kind: number, u0: number, u1: number, a: number, b: number): Decal => ({ kind, u0: Math.min(u0, u1), u1: Math.max(u0, u1), a0: Math.min(a, b), a1: Math.max(a, b), seed: r() });
  /** Indice du profil le plus proche d'une abscisse. */
  const nearest = (a: number): number => {
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      const e = Math.abs((s.along[i] as number) - a);
      if (e < d) {
        d = e;
        best = i;
      }
    }
    return best;
  };
  const sideW = (left: boolean, a: number): number => ((left ? s.wL : s.wR)[nearest(a)] as number) ?? 0;
  const laneU = (): number => (r() < 0.5 ? -1 : 1) * half * 0.5;
  const crossings: Array<{ a: number; dir: number }> = [];

  if (city) {
    // (Caniveaux pavés : dessinés par le ruban lui-même là où il y a un trottoir, voir network.ts.)
    // Passages piétons : là où les deux trottoirs reprennent après le carrefour (trottoirs coupés de 2 à 25 m).
    if (len > 30 && half >= 2.5) {
      for (const atStart of [true, false]) {
        const end = atStart ? 0 : n - 1;
        const step = atStart ? 1 : -1;
        let k = end;
        while (k >= 0 && k < n && (!((s.wL[k] as number) > 0) || !((s.wR[k] as number) > 0))) k += step;
        if (k < 0 || k >= n || k === end) continue;
        const run = Math.abs((s.along[k] as number) - (s.along[end] as number));
        if (run < 2 || run > 25) continue;
        const inward = (atStart ? dirUp : -dirUp) as number;
        const a = (s.along[k] as number) + inward * 0.3;
        const b = a + inward * (half >= 4 ? 3.5 : 2.8);
        if (add(rect(DECAL_CROSSWALK, -half + 0.25, half - 0.25, a, b))) crossings.push({ a: b, dir: inward });
      }
    }
    // Avaloirs : juste avant chaque passage piéton, dans le caniveau d'un côté qui a un trottoir.
    for (const c of crossings) {
      const a = c.a + c.dir * (1.2 + r() * 1.5);
      const left = r() < 0.5;
      for (const side of [left, !left]) {
        if (sideW(side, a) > 0) {
          const u0 = side ? -o : o - GUTTER_W;
          add(rect(DECAL_GRATE, u0, u0 + GUTTER_W, a, a + c.dir * 0.9));
          break;
        }
      }
    }
    // Et de loin en loin le long de la rue, en alternant les côtés.
    let side = r() < 0.5;
    for (let a = A0 + 12 + r() * 20; a < A1 - 3; a += 40 + r() * 30) {
      side = !side;
      if (sideW(side, a) > 0) {
        const u0 = side ? -o : o - GUTTER_W;
        add(rect(DECAL_GRATE, u0, u0 + GUTTER_W, a, a + 0.9));
      }
    }
    // Plaques d'égout : dans l'axe ou au milieu d'une voie, tous les 30 à 60 m.
    for (let a = A0 + 6 + r() * 22; a < A1 - 3; a += 30 + r() * 30) {
      const D = 0.72 + r() * 0.12;
      const u = r() < 0.4 ? 0 : laneU();
      add(rect(DECAL_MANHOLE, u - D / 2, u + D / 2, a, a + D));
    }
    // Taches d'huile là où les voitures attendent : avant le passage piéton, au milieu de la voie.
    for (const c of crossings) {
      const count = 1 + Math.floor(r() * 3);
      for (let k = 0; k < count; k++) {
        const D = 0.4 + r() * 0.7;
        const a = c.a + c.dir * (1.5 + r() * 9);
        const u = laneU() + (r() - 0.5) * 0.4;
        add(rect(DECAL_OIL, u - D / 2, u + D / 2, a, a + D));
      }
    }
  }

  // Rapiéçages et tranchées : une réparation tous les 15 à 40 m en ville, plus rare à la campagne.
  for (let a = A0 + r() * 12; a < A1 - 1; a += city ? 15 + r() * 25 : 30 + r() * 50) {
    const pick = r();
    const lane = r() < 0.5 ? -1 : 1;
    const laneIn = lane < 0 ? [-half + 0.25, -0.12] : [0.12, half - 0.25];
    if (pick < 0.3) {
      // Bande de voie (reprise d'enrobé).
      const L = 4 + r() * 9;
      add(rect(DECAL_PATCH, laneIn[0] as number, laneIn[1] as number, a, a + L));
    } else if (pick < 0.48) {
      // Tranchée en travers (branchement), sur toute la chaussée ou une voie.
      const W = 0.6 + r() * 0.5;
      const full = r() < 0.5;
      add(rect(DECAL_TRENCH, full ? -half + 0.2 : (laneIn[0] as number), full ? half - 0.2 : (laneIn[1] as number), a, a + W));
    } else if (pick < 0.64) {
      // Découpe carrée (regard, nid-de-poule rebouché).
      const W = 0.9 + r() * 1.5;
      const L = 0.9 + r() * 1.5;
      const u = lane * (0.3 + r() * Math.max(0.1, half - W - 0.5)) + (lane < 0 ? -W : 0);
      add(rect(DECAL_PATCH, u, u + W, a, a + L));
    } else if (city && pick < 0.74) {
      // Tranchée en long près de la rive (réseaux).
      const W = 0.6 + r() * 0.3;
      const L = 6 + r() * 19;
      const u = lane < 0 ? -half + 0.3 : half - 0.3 - W;
      add(rect(DECAL_TRENCH, u, u + W, a, a + L));
    }
  }

  // Taches d'huile éparses au milieu des voies.
  for (let a = A0 + r() * 15; a < A1 - 1; a += city ? 18 + r() * 25 : 50 + r() * 60) {
    if (r() < (city ? 0.55 : 0.3)) {
      const D = 0.3 + r() * 0.6;
      const u = laneU() + (r() - 0.5) * 0.3;
      add(rect(DECAL_OIL, u - D / 2, u + D / 2, a, a + D));
    }
  }
  return out;
}

/** Sortie partagée avec la voirie (mêmes tableaux, voir network.ts). */
export interface DecalSink {
  pos: number[];
  uvs: number[];
  info: number[];
  lit: number[];
  decal: number[];
  dsize: number[];
  side: number[];
  index: number[];
}

/**
 * Géométrie d'un décalque, collée au ruban : un profil à chaque profil de la voie qu'il recouvre (la chaussée
 * suit le relief), plus ses deux bouts. `lampAt` : état de la flaque de lumière du profil le plus proche.
 */
export function pushDecal(sink: DecalSink, left: readonly number[], right: readonly number[], along: readonly number[], o: number, half: number, d: Decal, lampAt: readonly number[]): void {
  const n = along.length;
  if (n < 2) return;
  const asc = (along[n - 1] as number) >= (along[0] as number);
  const samples: number[] = [d.a0];
  for (let i = 0; i < n; i++) {
    const a = along[i] as number;
    if (a > d.a0 + 0.02 && a < d.a1 - 0.02) samples.push(a);
  }
  samples.push(d.a1);
  samples.sort((x, y) => x - y);
  const lift = LIFT[d.kind] ?? 0.015;
  const W = d.u1 - d.u0;
  const L = d.a1 - d.a0;
  const base = sink.pos.length / 3;
  const tu0 = (d.u0 + o) / (2 * o);
  const tu1 = (d.u1 + o) / (2 * o);
  for (const a of samples) {
    // Segment de profils qui encadre `a` (abscisse monotone, croissante ou décroissante).
    let i = 0;
    while (i < n - 2 && (asc ? (along[i + 1] as number) < a : (along[i + 1] as number) > a)) i++;
    const a0 = along[i] as number;
    const a1 = along[i + 1] as number;
    const f = a1 !== a0 ? Math.min(1, Math.max(0, (a - a0) / (a1 - a0))) : 0;
    const at = (arr: readonly number[], c: number) => (arr[i * 3 + c] as number) + ((arr[(i + 1) * 3 + c] as number) - (arr[i * 3 + c] as number)) * f;
    const lx = at(left, 0);
    const ly = at(left, 1);
    const lz = at(left, 2);
    const rx = at(right, 0);
    const ry = at(right, 1);
    const rz = at(right, 2);
    const lamp = (lampAt[f < 0.5 ? i : i + 1] as number) ?? 0;
    const dv = L > 0 ? (a - d.a0) / L : 0;
    for (const [t, du, u] of [
      [tu0, 0, d.u0],
      [tu1, 1, d.u1],
    ] as const) {
      sink.pos.push(lx + (rx - lx) * t, ly + (ry - ly) * t + lift, lz + (rz - lz) * t);
      sink.uvs.push(u, a);
      sink.info.push(half, 0, 0);
      sink.lit.push(lamp);
      sink.decal.push(d.kind, du, dv, d.seed);
      sink.dsize.push(W, L);
      sink.side.push(99, 0);
    }
  }
  const P = sink.pos;
  for (let k = 0; k + 1 < samples.length; k++) {
    const p = base + k * 2;
    const q = p + 2;
    // Face tournée vers le haut, quel que soit le sens de la voie.
    const ex = (P[(p + 1) * 3] as number) - (P[p * 3] as number);
    const ez = (P[(p + 1) * 3 + 2] as number) - (P[p * 3 + 2] as number);
    const fx = (P[q * 3] as number) - (P[p * 3] as number);
    const fz = (P[q * 3 + 2] as number) - (P[p * 3 + 2] as number);
    const ny = ez * fx - ex * fz;
    if (ny >= 0) sink.index.push(p, p + 1, q, p + 1, q + 1, q);
    else sink.index.push(p, q, p + 1, p + 1, q, q + 1);
  }
}
