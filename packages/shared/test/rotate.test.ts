import { describe, expect, it } from 'vitest';
import {
  baseRouteId,
  mirrorStartM,
  parseStartedRouteId,
  rankRouteId,
  reverseRoute,
  rotateRoute,
  RouteTrack,
  startedRouteId,
  startIndex,
  type RouteData,
} from '../src/index.ts';

/**
 * Boucle carrée de 4 × 500 m (points tous les 2 m, fermeture de 2 m) : montée de 400 m à 5 % au
 * début, sprint vers la fin, revêtement en deux tronçons, deux villages, un lacet.
 */
function loop(): RouteData {
  const points = [];
  for (let i = 0; i < 1000; i++) {
    const d = i * 2;
    const side = Math.floor(d / 500);
    const t = d % 500;
    const [x, z] = side === 0 ? [t, 0] : side === 1 ? [500, t] : side === 2 ? [500 - t, 500] : [0, 500 - t];
    points.push({ x, y: d <= 400 ? d * 0.05 : d <= 1200 ? 20 : 20 - (d - 1200) * 0.025, z, d });
  }
  return {
    id: 'carre',
    name: 'Le Carré',
    loop: true,
    lengthM: 2000,
    elevationGainM: 20,
    points,
    segments: [
      { id: 'carre-kom-1', kind: 'kom', name: 'Côte 1', startM: 0, endM: 400, avgGrade: 5 },
      { id: 'carre-sprint-1', kind: 'sprint', name: 'Sprint', startM: 1600, endM: 1800, avgGrade: 0 },
    ],
    roadWidthM: 5,
    attribution: [],
    stepM: 2,
    surfaces: [{ startM: 0, endM: 900, surface: 'gravel' }, { startM: 900, endM: 2000, surface: 'asphalt' }],
    landmarks: [{ name: 'Le Bourg', d: 600 }, { name: 'Issoire', d: 1500 }],
    hairpins: [{ d: 1000, turnDeg: 160, radiusM: 8, altitudeM: 20 }],
  };
}

describe('départ choisi sur une boucle', () => {
  it('identifiant « -depart-<m> », lu dans les deux sens et ramené au parcours d’origine', () => {
    expect(startedRouteId('carre', 1499.6)).toBe('carre-depart-1500');
    expect(parseStartedRouteId('carre-inverse-depart-1500')).toEqual({ id: 'carre-inverse', startM: 1500 });
    expect(parseStartedRouteId('carre')).toBeNull();
    expect(rankRouteId('carre-inverse-depart-1500')).toBe('carre-inverse');
    expect(baseRouteId('carre-inverse-depart-1500')).toBe('carre');
    expect(baseRouteId('carre-inverse')).toBe('carre');
  });

  it('se cale sur le point du tracé le plus proche ; la fermeture ramène au départ', () => {
    const r = loop();
    expect(startIndex(r, 1001)).toBe(500);
    expect(startIndex(r, 1001.2)).toBe(501);
    expect(startIndex(r, 1999.4)).toBe(0);
    expect(startIndex(r, 2600)).toBe(300);
    expect(rotateRoute(r, 1999.4)).toBe(r);
    expect(rotateRoute(r, 0)).toBe(r);
  });

  it('distances, montées, sprints, villages, revêtements et lacets repartent du nouveau départ', () => {
    const r = loop();
    const s = rotateRoute(r, 1500);
    expect(s.id).toBe('carre-depart-1500');
    expect(s.name).toBe('Le Carré (départ à Issoire)');
    expect(s.lengthM).toBe(2000);
    expect(s.points).toHaveLength(r.points.length);
    expect(s.points[0]).toEqual({ ...r.points[750], d: 0 });
    expect(s.points.at(-1)).toEqual({ ...r.points[749], d: 1998 });
    // l'ancienne fermeture (dernier → premier point) est maintenant au milieu, sans trou
    expect(s.points[249]).toMatchObject({ x: r.points[999]!.x, d: 498 });
    expect(s.points[250]).toMatchObject({ x: 0, z: 0, d: 500 });
    for (let i = 1; i < s.points.length; i++) expect(s.points[i]!.d).toBeGreaterThan(s.points[i - 1]!.d);
    // la côte (même identifiant : records partagés) arrive au km 0,5, le sprint au km 0,1
    expect(s.segments.map((g) => [g.id, g.startM, g.endM])).toEqual([
      ['carre-sprint-1', 100, 300],
      ['carre-kom-1', 500, 900],
    ]);
    expect(s.landmarks).toEqual([{ name: 'Issoire', d: 0 }, { name: 'Le Bourg', d: 1100 }]);
    expect(s.hairpins?.map((h) => h.d)).toEqual([1500]);
    // le tronçon d'enrobé passe sur le départ : coupé en fin et en début de tour
    expect(s.surfaces).toEqual([
      { startM: 0, endM: 500, surface: 'asphalt' },
      { startM: 500, endM: 1400, surface: 'gravel' },
      { startM: 1400, endM: 2000, surface: 'asphalt' },
    ]);
    // même tracé : le point à 600 m du nouveau départ est celui à 100 m de l'ancien
    const a = new RouteTrack(r).sample(100);
    const b = new RouteTrack(s).sample(600);
    expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
  });

  it('une montée à cheval sur le nouveau départ n’est plus chronométrée', () => {
    const s = rotateRoute(loop(), 200);
    expect(s.id).toBe('carre-depart-200');
    expect(s.name).toBe('Le Carré (départ au Bourg)');
    expect(s.segments.map((g) => g.id)).toEqual(['carre-sprint-1']);
    // départ pris juste après un village : il est au départ, pas en fin de tour
    expect(rotateRoute(loop(), 610).landmarks?.[0]).toEqual({ name: 'Le Bourg', d: 0 });
    // sans village à moins de 800 m : le kilomètre du tracé d'origine
    expect(rotateRoute({ ...loop(), landmarks: [] }, 200).name).toBe('Le Carré (départ au km 0,2)');
  });

  it('se combine avec le sens inverse : même point physique de part et d’autre', () => {
    const r = loop();
    const rev = reverseRoute(r);
    const startRev = mirrorStartM(r.lengthM, 1500);
    expect(startRev).toBe(500);
    const s = rotateRoute(rev, startRev);
    expect(s.id).toBe('carre-inverse-depart-500');
    expect(s.name).toBe('Le Carré (sens inverse, départ à Issoire)');
    expect(s.nameEn).toBe('Le Carré (reverse, start at Issoire)');
    expect(s.points[0]).toMatchObject({ x: r.points[750]!.x, z: r.points[750]!.z, d: 0 });
    // on roule dans l'autre sens : le point suivant est le précédent du sens normal
    expect(s.points[1]).toMatchObject({ x: r.points[749]!.x, z: r.points[749]!.z });
    expect(mirrorStartM(2000, 0)).toBe(0);
  });

  it('un aller simple garde son départ', () => {
    const r = { ...loop(), loop: false, lengthM: 1998 };
    expect(rotateRoute(r, 1000)).toBe(r);
  });
});
