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
