import { describe, expect, it } from 'vitest';
import { RouteTrack, type RouteData } from '../src/index.ts';

function squareLoop(side: number, climb: number): RouteData {
  const pts = [];
  const corners = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ] as const;
  let d = 0;
  for (let c = 0; c < 4; c++) {
    const [x0, z0] = corners[c]!;
    const [x1, z1] = corners[(c + 1) % 4]!;
    for (let k = 0; k < 100; k++) {
      const t = k / 100;
      // Montée sur le premier côté, descente sur le troisième.
      const y = c === 0 ? climb * t : c === 1 ? climb : c === 2 ? climb * (1 - t) : 0;
      pts.push({ x: x0 + (x1 - x0) * t, y, z: z0 + (z1 - z0) * t, d });
      d += side / 100;
    }
  }
  return { id: 't', name: 't', loop: true, lengthM: 4 * side, elevationGainM: climb, points: pts, segments: [], roadWidthM: 6, attribution: [] };
}

describe('RouteTrack', () => {
  const track = new RouteTrack(squareLoop(1000, 50));

  it('referme la boucle', () => {
    expect(track.length).toBe(4000);
    expect(track.wrap(4100)).toBeCloseTo(100);
    expect(track.wrap(-100)).toBeCloseTo(3900);
  });

  it('donne position, direction et pente', () => {
    const s = track.sample(500);
    expect(s.x).toBeCloseTo(500);
    expect(s.dirX).toBeCloseTo(1);
    expect(s.grade).toBeCloseTo(5, 0);
    expect(track.sample(2500).grade).toBeCloseTo(-5, 0);
  });

  it('applique le décalage latéral à droite', () => {
    // Sens +x, droite = +z (sud) dans le repère Three.js.
    const p = track.positionAt(500, 2);
    expect(p.z).toBeCloseTo(2);
  });
});

describe('RouteTrack.surfaceAt', () => {
  it('renvoie le revêtement du tronçon, y compris après un tour', () => {
    const route = {
      ...squareLoop(1000, 0),
      surfaces: [
        { startM: 0, endM: 1500, surface: 'asphalt' },
        { startM: 1500, endM: 2200, surface: 'gravel' },
        { startM: 2200, endM: 4000, surface: 'asphalt' },
      ],
    };
    const t = new RouteTrack(route);
    expect(t.surfaceAt(100)).toBe('asphalt');
    expect(t.surfaceAt(1800)).toBe('gravel');
    expect(t.surfaceAt(4000 + 1800)).toBe('gravel');
    expect(new RouteTrack(squareLoop(1000, 0)).surfaceAt(1800)).toBeUndefined();
  });
});

describe('RouteTrack : trajectoire et virages', () => {
  // Carré parcouru vers l'est puis le sud : chaque coin est un virage à droite de 90°.
  const track = new RouteTrack(squareLoop(1000, 0));
  const heading = (s: { dirX: number; dirZ: number }) => (Math.atan2(s.dirX, s.dirZ) * 180) / Math.PI;

  it('arrondit un angle droit : cap progressif, coin coupé', () => {
    // Sur la ligne du tracé, le cap passe de 90° à 0° en 6 m ; sur la trajectoire, sur bien plus.
    const caps = [-8, -4, 0, 4, 8].map((k) => heading(track.linePositionAt(1000 + k, 0, 10)));
    for (let i = 1; i < caps.length; i++) expect(caps[i]!).toBeLessThan(caps[i - 1]! + 1e-6);
    expect(caps[0]!).toBeGreaterThan(80);
    expect(caps[2]!).toBeCloseTo(45, 0);
    expect(caps[4]!).toBeLessThan(10);
    const corner = track.linePositionAt(1000, 0, 10);
    // coupé vers l'intérieur (ouest et sud du coin), d'au plus 2,5 m
    expect(corner.x).toBeLessThan(1000);
    expect(corner.z).toBeGreaterThan(0);
    expect(Math.hypot(corner.x - 1000, corner.z)).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it('en ligne droite, la trajectoire est le tracé', () => {
    const a = track.linePositionAt(500, 1.5, 12);
    const b = track.positionAt(500, 1.5);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });

  it('annonce le prochain virage, son côté et sa distance', () => {
    const t = track.nextTurn(900);
    expect(t).not.toBeNull();
    expect(t!.angleDeg).toBeGreaterThan(80);
    expect(t!.angleDeg).toBeLessThan(100);
    expect(t!.inM).toBeGreaterThan(70);
    expect(t!.inM).toBeLessThan(100);
    // à contresens : le même coin pris vers la gauche
    const back = track.nextTurn(1100, -1);
    expect(back!.angleDeg).toBeLessThan(-80);
    // rien en vue en pleine ligne droite
    expect(track.nextTurn(300, 1, 200)).toBeNull();
  });
});

describe('RouteTrack : la trajectoire reste sur la chaussée', () => {
  const track = new RouteTrack(squareLoop(1000, 0));
  it('coureur serré à l\'intérieur du virage : la corde ne le fait pas sortir de la route (façades)', () => {
    const half = Math.max(0.9, track.widthAt(1000) / 2 - 0.4);
    for (const k of [-6, -3, 0, 3, 6]) {
      const p = track.linePositionAt(1000 + k, half, 12);
      // Distance au bord intérieur du coin (x ≤ 1000, z ≥ 0 sur la chaussée) : jamais au-delà de la demi-largeur.
      const c = track.sample(1000 + k);
      const lat = (p.x - c.x) * -c.dirZ + (p.z - c.z) * c.dirX;
      expect(Math.abs(lat)).toBeLessThanOrEqual(half + 1e-6);
    }
  });
});

/** Ancien calcul de `sample` et `widthAt` (objets intermédiaires, parcours linéaire), gardé comme référence. */
class ReferenceTrack {
  readonly length: number;
  private readonly pts: RouteData['points'];
  private readonly grades: Float32Array;

  constructor(private readonly route: RouteData, w = 12) {
    this.pts = route.points;
    this.length = route.loop ? route.lengthM : this.pts[this.pts.length - 1]!.d;
    this.grades = new Float32Array(this.pts.length);
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]!;
      this.grades[i] = ((this.sampleRaw(p.d + w).y - this.sampleRaw(p.d - w).y) / (2 * w)) * 100;
    }
  }

  wrap(d: number): number {
    if (this.route.loop) return ((d % this.length) + this.length) % this.length;
    return Math.min(Math.max(d, 0), this.length);
  }

  private segment(dIn: number) {
    const d = this.wrap(dIn);
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pts[mid]!.d <= d) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const a = this.pts[i]!;
    let b = this.pts[i + 1];
    let bd: number;
    if (b) bd = b.d;
    else {
      b = this.pts[0]!;
      bd = this.length;
    }
    const span = Math.max(bd - a.d, 1e-6);
    return { a, b, t: Math.min(Math.max((d - a.d) / span, 0), 1), i, d };
  }

  private sampleRaw(d: number) {
    const { a, b, t } = this.segment(d);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  sample(dIn: number) {
    const { a, b, t, i, d } = this.segment(dIn);
    const p0 = this.sampleRaw(d - 3);
    const p1 = this.sampleRaw(d + 3);
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const g0 = this.grades[i]!;
    const g1 = (i + 1 < this.pts.length ? this.grades[i + 1] : this.grades[this.route.loop ? 0 : i])!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, dirX: dx / len, dirZ: dz / len, grade: g0 + (g1 - g0) * t, d };
  }

  widthAt(d: number): number {
    const x = this.wrap(d);
    return this.route.roadWidths?.find((r) => x >= r.startM && x <= r.endM)?.widthM ?? this.route.roadWidthM;
  }
}

/** Tracé irrégulier (pas variables, virages, relief), déterministe. */
function wigglyRoute(loop: boolean): RouteData {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  let x = 0;
  let z = 0;
  let d = 0;
  let heading = 0;
  for (let k = 0; k < 600; k++) {
    pts.push({ x, y: 40 * Math.sin(k / 37) + 3 * rnd(), z, d });
    const step = 0.5 + 6 * rnd();
    heading += (rnd() - 0.5) * 0.6;
    x += Math.cos(heading) * step;
    z += Math.sin(heading) * step;
    d += step;
  }
  return { id: 'w', name: 'w', loop, lengthM: d + 4, elevationGainM: 0, points: pts, segments: [], roadWidthM: 6, attribution: [] };
}

describe('RouteTrack : échantillonnage sans allocation et largeur par dichotomie', () => {
  const sameSample = (track: RouteTrack, ref: ReferenceTrack, d: number): void => {
    const out = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
    expect(track.sample(d, out)).toBe(out);
    expect(out).toEqual(ref.sample(d));
    expect(track.sample(d)).toEqual(ref.sample(d));
  };

  for (const loop of [true, false]) {
    it(`sample identique à l'ancien calcul (${loop ? 'boucle' : 'itinéraire ouvert'})`, () => {
      const route = wigglyRoute(loop);
      const track = new RouteTrack(route);
      const ref = new ReferenceTrack(route);
      const L = track.length;
      const ds = [0, 1e-9, 2.999, 3, 3.001, L - 3, L - 1e-6, L, L + 0.5, L + 3, -0.5, -3, -L - 7, 2 * L + 11, L / 2];
      for (const p of route.points) ds.push(p.d, p.d - 1e-7, p.d + 1e-7);
      for (let k = 0; k < 4000; k++) ds.push(-50 + (k / 4000) * (L + 100));
      for (const d of ds) sameSample(track, ref, d);
    });
  }

  it('widthAt identique : tronçons triés, jonctions, trous, bornes', () => {
    const route = wigglyRoute(true);
    const L = route.lengthM;
    route.roadWidths = [
      { startM: 0, endM: 40, widthM: 5 },
      { startM: 40, endM: 40, widthM: 9 }, // tronçon de longueur nulle à une jonction
      { startM: 40, endM: 120.5, widthM: 3.5 },
      { startM: 200, endM: 310, widthM: 7 }, // trou de 120,5 à 200
      { startM: 310, endM: L, widthM: 4 },
    ];
    const track = new RouteTrack(route);
    const ref = new ReferenceTrack(route);
    const ds = [0, 40, 120.5, 200, 310, L, -1, L + 1, 150, 39.999999, 40.000001, 120.500001, 199.999999];
    for (let k = 0; k <= 5000; k++) ds.push(-20 + (k / 5000) * (L + 40));
    for (const d of ds) expect(track.widthAt(d)).toBe(ref.widthAt(d));
    // Liste remplacée en cours de route (mode ouvert) : la nouvelle est prise en compte.
    route.roadWidths = [{ startM: 0, endM: L, widthM: 11 }];
    expect(track.widthAt(100)).toBe(11);
    delete route.roadWidths;
    expect(track.widthAt(100)).toBe(6);
  });

  it('widthAt identique : tronçons non triés ou qui se recouvrent (repli sur le parcours)', () => {
    const route = wigglyRoute(false);
    const L = new RouteTrack(route).length;
    route.roadWidths = [
      { startM: 300, endM: 500, widthM: 8 },
      { startM: 0, endM: 350, widthM: 4 },
      { startM: 100, endM: 200, widthM: 2 },
    ];
    const track = new RouteTrack(route);
    const ref = new ReferenceTrack(route);
    for (let k = 0; k <= 3000; k++) {
      const d = -20 + (k / 3000) * (L + 40);
      expect(track.widthAt(d)).toBe(ref.widthAt(d));
    }
  });
});
