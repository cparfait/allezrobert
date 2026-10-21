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
