import type { RouteData, RoutePoint } from './route.ts';

/** Échantillon d'itinéraire à une distance donnée. */
export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** Direction unitaire dans le plan (x, z). */
  dirX: number;
  dirZ: number;
  /** Pente en % (positive = montée). */
  grade: number;
  /** Distance normalisée dans [0, length). */
  d: number;
}

/** Trajectoire d'affichage (`linePositionAt`) : un virage n'est jamais coupé de plus de 2,5 m (épingles, routes étroites). */
const LINE_MAX_CUT_M = 2.5;
/** Trajectoire d'affichage : marge au bord de la chaussée (m), comme la physique (EDGE_MARGIN_M). */
const LINE_EDGE_M = 0.4;
/** Inclinaison maximale d'un coureur en virage (≈ 28°). */
const LEAN_MAX_RAD = 0.49;
const _leanA: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
const _leanB: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

/**
 * Accès rapide à un itinéraire par distance curviligne : position, direction, pente.
 * Partagé par le client (rendu, physique locale) et le serveur (physique de groupe).
 */
export class RouteTrack {
  readonly route: RouteData;
  /** Longueur (m) ; elle grandit quand un itinéraire ouvert est prolongé ({@link extend}). */
  length: number;
  private readonly pts: RoutePoint[];
  /** Pente lissée par point (en %), calculée sur une fenêtre de ±gradeWindow mètres. */
  private grades: Float32Array;
  private readonly gradeWindowM: number;

  constructor(route: RouteData, gradeWindowM = 12) {
    if (route.points.length < 2) throw new Error('Itinéraire vide');
    this.route = route;
    this.pts = route.points;
    this.gradeWindowM = gradeWindowM;
    this.length = route.loop ? route.lengthM : (this.pts[this.pts.length - 1] as RoutePoint).d;
    this.grades = new Float32Array(this.pts.length);
    this.computeGrades(0);
  }

  private computeGrades(from: number): void {
    const w = this.gradeWindowM;
    for (let i = from; i < this.pts.length; i++) {
      const p = this.pts[i] as RoutePoint;
      const a = this.sampleRaw(p.d - w);
      const b = this.sampleRaw(p.d + w);
      this.grades[i] = ((b.y - a.y) / (2 * w)) * 100;
    }
  }

  /**
   * Itinéraire ouvert seulement (mode ouvert) : remplace les points à partir de la distance
   * `fromD` par `points` (distances croissantes, la première ≥ fromD) et met à jour longueur et
   * pentes. Les points avant `fromD` ne bougent pas.
   */
  extend(points: RoutePoint[], fromD: number): void {
    if (this.route.loop) throw new Error('extend : itinéraire en boucle');
    const pts = this.pts;
    while (pts.length > 1 && (pts[pts.length - 1] as RoutePoint).d >= fromD - 1e-9) pts.pop();
    for (const p of points) if (p.d > (pts[pts.length - 1] as RoutePoint).d + 1e-9) pts.push(p);
    if (this.grades.length < pts.length) {
      const g = new Float32Array(Math.max(pts.length, this.grades.length * 2));
      g.set(this.grades);
      this.grades = g;
    }
    this.length = (pts[pts.length - 1] as RoutePoint).d;
    this.route.lengthM = this.length;
    // Les pentes dépendent des points à ±fenêtre : on recalcule depuis un peu avant fromD.
    let i = pts.length - 1;
    while (i > 0 && (pts[i] as RoutePoint).d > fromD - 2 * this.gradeWindowM) i--;
    this.computeGrades(i);
  }

  /** Ramène une distance dans [0, length) pour une boucle, ou la borne sinon. */
  wrap(d: number): number {
    if (this.route.loop) return ((d % this.length) + this.length) % this.length;
    return Math.min(Math.max(d, 0), this.length);
  }

  /** Indice du dernier point dont la distance est ≤ d (recherche dichotomique). */
  private indexAt(d: number): number {
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.pts[mid] as RoutePoint).d <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private segment(dIn: number): { a: RoutePoint; b: RoutePoint; t: number; i: number; d: number } {
    const d = this.wrap(dIn);
    const i = this.indexAt(d);
    const a = this.pts[i] as RoutePoint;
    let b = this.pts[i + 1];
    let bd: number;
    if (b) bd = b.d;
    else {
      // Fin de boucle : on referme sur le premier point.
      b = this.pts[0] as RoutePoint;
      bd = this.length;
    }
    const span = Math.max(bd - a.d, 1e-6);
    return { a, b, t: Math.min(Math.max((d - a.d) / span, 0), 1), i, d };
  }

  private sampleRaw(d: number): { x: number; y: number; z: number } {
    const { a, b, t } = this.segment(d);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Échantillonne l'itinéraire ; `out` permet d'éviter les allocations dans la boucle de jeu. */
  sample(dIn: number, out: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 }): TrackSample {
    const { a, b, t, i, d } = this.segment(dIn);
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    // Direction lissée : différence centrale sur ±3 m pour éviter les à-coups aux sommets.
    const p0 = this.sampleRaw(d - 3);
    const p1 = this.sampleRaw(d + 3);
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    out.dirX = dx / len;
    out.dirZ = dz / len;
    const g0 = this.grades[i] as number;
    const g1 = (i + 1 < this.pts.length ? this.grades[i + 1] : this.grades[this.route.loop ? 0 : i]) as number;
    out.grade = g0 + (g1 - g0) * t;
    out.d = d;
    return out;
  }

  /** Position monde avec un décalage latéral (positif = à droite dans le sens de marche). */
  positionAt(d: number, lateral: number, out: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 }): TrackSample {
    this.sample(d, out);
    // Droite = rotation de -90° de la direction dans le plan (x est, z sud) : (−dirZ, dirX).
    out.x += -out.dirZ * lateral;
    out.z += out.dirX * lateral;
    return out;
  }

  /**
   * Position et cap « en trajectoire », pour l'affichage des coureurs (pas pour la physique : la distance
   * parcourue ne change pas). Moyenne pondérée des points à d − w, d, d + w et cap sur la corde d ± w, avec
   * w qui grandit avec la vitesse (3 à 9 m) : un carrefour à angle droit devient un arc, le vélo tourne
   * progressivement au lieu de pivoter d'un coup. La corde coupe le virage d'au plus LINE_MAX_CUT_M.
   */
  /** Largeur de chaussée (m) à la distance d (tronçons `roadWidths`, sinon largeur de l'itinéraire). */
  widthAt(d: number): number {
    const x = this.wrap(d);
    return this.route.roadWidths?.find((r) => x >= r.startM && x <= r.endM)?.widthM ?? this.route.roadWidthM;
  }

  linePositionAt(d: number, lateral: number, speedMs: number, out: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 }): TrackSample {
    this.sample(d, out);
    const w = Math.min(9, Math.max(3, 2 + 0.45 * Math.max(0, speedMs)));
    // Itinéraire ouvert : pas de fenêtre au-delà des extrémités (le cap resterait figé).
    const lo = this.route.loop ? d - w : Math.max(0, d - w);
    const hi = this.route.loop ? d + w : Math.min(this.length, d + w);
    if (hi - lo > 0.5) {
      const a = this.sampleRaw(lo);
      const b = this.sampleRaw(hi);
      // Droite du tracé à d (avant de changer de cap) : pour mesurer le décalage latéral final.
      const r0x = -out.dirZ;
      const r0z = out.dirX;
      let cx = (a.x + b.x) / 4 - out.x / 2;
      let cz = (a.z + b.z) / 4 - out.z / 2;
      const cut = Math.hypot(cx, cz);
      if (cut > LINE_MAX_CUT_M) {
        cx *= LINE_MAX_CUT_M / cut;
        cz *= LINE_MAX_CUT_M / cut;
      }
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-3) {
        out.dirX = dx / len;
        out.dirZ = dz / len;
      }
      // Jamais hors de la chaussée : la corde plus le décalage du coureur restent à LINE_EDGE_M du bord
      // (dans les bourgs, les façades sont au ras de la route : couper davantage faisait traverser les murs).
      const half = Math.max(0.9, this.widthAt(d) / 2 - LINE_EDGE_M);
      const limit = Math.max(half, Math.abs(lateral));
      const latFinal = cx * r0x + cz * r0z + lateral * (-out.dirZ * r0x + out.dirX * r0z);
      if (Math.abs(latFinal) > limit) {
        const excess = latFinal - Math.sign(latFinal) * limit;
        cx -= excess * r0x;
        cz -= excess * r0z;
      }
      out.x += cx;
      out.z += cz;
    }
    out.x += -out.dirZ * lateral;
    out.z += out.dirX * lateral;
    return out;
  }

  /**
   * Courbure (1/m, positive = virage à droite dans le sens de l'itinéraire) de la trajectoire d'affichage à d,
   * cap mesuré à ±2 m. Sert à l'inclinaison des coureurs et à la vitesse des voitures en virage.
   */
  curvatureAt(d: number, speedMs: number): number {
    const a = this.linePositionAt(d - 2, 0, speedMs, _leanA);
    const b = this.linePositionAt(d + 2, 0, speedMs, _leanB);
    // x est, z sud : (dirX, dirZ) → (dirX', dirZ') tourne à droite quand le produit vectoriel est positif.
    return Math.atan2(a.dirX * b.dirZ - a.dirZ * b.dirX, a.dirX * b.dirX + a.dirZ * b.dirZ) / 4;
  }

  /**
   * Inclinaison d'un coureur en virage (rad, positive = penché à droite) sur la trajectoire d'affichage :
   * angle physique atan(v² · κ / g), κ la courbure de la trajectoire (cap mesuré à ±2 m), borné à
   * LEAN_MAX_RAD. `sign` : sens de marche (−1 à contresens : le virage change de côté).
   */
  leanAt(d: number, speedMs: number, sign: 1 | -1 = 1): number {
    const lean = Math.atan((speedMs * speedMs * this.curvatureAt(d, speedMs)) / 9.81) * sign;
    return Math.max(-LEAN_MAX_RAD, Math.min(LEAN_MAX_RAD, lean));
  }

  /**
   * Prochain virage marqué (≥ 30° de cap sur 25 m) entre 8 et `maxAheadM` m devant, dans le sens `sign`
   * (−1 après un demi-tour) : distance jusqu'à son entrée et angle total (degrés, positif = à droite).
   * Les courbes douces et les zigzags d'un tracé bruité (moins de 30° nets) ne comptent pas.
   */
  nextTurn(d: number, sign: 1 | -1 = 1, maxAheadM = 200): { inM: number; angleDeg: number } | null {
    const HALF = 12.5;
    const STEP = 5;
    const heading = (x: number) => {
      const a = this.sampleRaw(d + sign * (x - 1.5));
      const b = this.sampleRaw(d + sign * (x + 1.5));
      return Math.atan2(b.x - a.x, b.z - a.z);
    };
    const diff = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
    // Angle signé du cap, positif à droite (x est, z sud : la droite de (dx, dz) est (−dz, dx)).
    const turnAt = (x: number) => -diff(heading(x - HALF), heading(x + HALF));
    const limit = this.route.loop ? maxAheadM : Math.min(maxAheadM, sign > 0 ? this.length - d : d) - HALF;
    for (let x = 8; x <= limit; x += STEP) {
      if (Math.abs(turnAt(x)) < (30 * Math.PI) / 180) continue;
      // Entrée : on recule tant que ça tourne encore un peu ; sortie : on avance de même.
      let start = x;
      while (start - STEP >= 0 && Math.abs(turnAt(start - STEP)) > (12 * Math.PI) / 180) start -= STEP;
      let end = x;
      while (end + STEP <= limit + 60 && Math.abs(turnAt(end + STEP)) > (12 * Math.PI) / 180) end += STEP;
      const angle = -diff(heading(start - HALF), heading(end + HALF));
      if (Math.abs(angle) < (30 * Math.PI) / 180) {
        x = end;
        continue;
      }
      return { inM: Math.max(0, start - HALF), angleDeg: (angle * 180) / Math.PI };
    }
    return null;
  }

  /** Revêtement à la distance `d` (tag OSM), ou undefined si l'itinéraire ne le précise pas. */
  surfaceAt(d: number): string | undefined {
    const list = this.route.surfaces;
    if (!list?.length) return undefined;
    const x = this.wrap(d);
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((list[mid] as { startM: number }).startM <= x) lo = mid;
      else hi = mid - 1;
    }
    const s = list[lo] as { startM: number; endM: number; surface: string };
    return x >= s.startM && x <= s.endM ? s.surface : undefined;
  }

  /** Profil d'altitude échantillonné (pour le HUD). */
  profile(samples: number): Array<{ d: number; y: number }> {
    const res: Array<{ d: number; y: number }> = [];
    for (let k = 0; k <= samples; k++) {
      const d = (k / samples) * this.length;
      res.push({ d, y: this.sampleRaw(Math.min(d, this.length - 0.01)).y });
    }
    return res;
  }
}
