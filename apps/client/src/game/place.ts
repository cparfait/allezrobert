import type { WorldPlace } from '@allezrobert/shared';
import { isInParis } from '../world/parisBoundary.ts';

/** Poids des types de lieux : une ville « pèse » plus loin qu'un hameau. */
const REACH_M: Record<string, number> = { city: 4500, town: 3500, suburb: 2500, village: 2500, hamlet: 1100, locality: 900, isolated_dwelling: 500 };

/**
 * Lieu affiché dans le HUD. Le contour communal détermine l'appartenance à Paris.
 * Ailleurs, on utilise les lieux du monde (`places.json`) puis les villages de l'itinéraire
 * (`landmarks`), et on garde cette estimation pendant 40 m.
 */
export class PlaceFinder {
  private lastX = Infinity;
  private lastZ = Infinity;
  private last: string | null = null;

  constructor(
    private readonly places: readonly WorldPlace[] | undefined,
    private readonly landmarks: ReadonlyArray<{ name: string; d: number }> | undefined,
    private readonly routeLengthM: number,
    private readonly loop: boolean,
    private readonly originL93?: { x: number; y: number },
  ) {}

  get available(): boolean {
    return !!this.originL93 || !!this.places?.length || !!this.landmarks?.length;
  }

  /** Lieu à la position (x, z) du monde ; `distM` : abscisse sur l'itinéraire (repli sur les villages traversés). */
  at(x: number, z: number, distM: number): string | null {
    if (this.originL93 && isInParis(this.originL93.x + x, this.originL93.y - z)) return 'Paris';
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 40) return this.last;
    this.lastX = x;
    this.lastZ = z;
    this.last = this.fromPlaces(x, z) ?? this.fromLandmarks(distM);
    return this.last;
  }

  private fromPlaces(x: number, z: number): string | null {
    let best: WorldPlace | null = null;
    let bestScore = Infinity;
    for (const p of this.places ?? []) {
      if (this.originL93 && p.kind === 'city' && p.name === 'Paris') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      const reach = REACH_M[p.kind] ?? 700;
      if (d > reach) continue;
      // Plus proche d'abord, mais un village voisin l'emporte sur un hameau un peu plus près.
      const score = d / reach;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best?.name ?? null;
  }

  private fromLandmarks(distM: number): string | null {
    const marks = this.landmarks;
    if (!marks?.length) return null;
    const len = Math.max(this.routeLengthM, 1);
    const dist = (a: number, b: number) => {
      const d = Math.abs(a - b);
      return this.loop ? Math.min(d, len - d) : d;
    };
    let best: (typeof marks)[number] | undefined;
    let bestDistance = Infinity;
    for (const m of marks) {
      if (this.originL93 && m.name === 'Paris') continue;
      const d = dist(m.d, distM);
      if (d < bestDistance) {
        best = m;
        bestDistance = d;
      }
    }
    return bestDistance <= 2500 ? best?.name ?? null : null;
  }
}
