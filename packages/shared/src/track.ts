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

/**
 * Accès rapide à un itinéraire par distance curviligne : position, direction, pente.
 * Partagé par le client (rendu, physique locale) et le serveur (physique de groupe).
 */
export class RouteTrack {
  readonly route: RouteData;
  readonly length: number;
  private readonly pts: RoutePoint[];
  /** Pente lissée par point (en %), calculée sur une fenêtre de ±gradeWindow mètres. */
  private readonly grades: Float32Array;

  constructor(route: RouteData, gradeWindowM = 12) {
    if (route.points.length < 2) throw new Error('Itinéraire vide');
    this.route = route;
    this.pts = route.points;
    this.length = route.loop ? route.lengthM : (this.pts[this.pts.length - 1] as RoutePoint).d;
    this.grades = new Float32Array(this.pts.length);
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i] as RoutePoint;
      const a = this.sampleRaw(p.d - gradeWindowM);
      const b = this.sampleRaw(p.d + gradeWindowM);
      this.grades[i] = ((b.y - a.y) / (2 * gradeWindowM)) * 100;
    }
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
    const g1 = this.grades[(i + 1) % this.pts.length] as number;
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
