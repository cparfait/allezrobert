import { describe, expect, it } from 'vitest';
import { fromL93, scaleFactor, toL93 } from '../src/lambert93.ts';
import { l93ToWorld, wgs84ToWorld, worldToL93, worldToWgs84 } from '../src/frame.ts';
import { ORIGIN_L93 } from '../src/config.ts';

/** Écart en mètres entre deux positions géographiques proches. */
function geoErrorM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * 111132;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

describe('Lambert-93 (EPSG:2154)', () => {
  it("place l'origine (3° E, 46,5° N) en (700 000, 6 600 000)", () => {
    const p = toL93(3, 46.5);
    expect(Math.abs(p.x - 700000)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - 6600000)).toBeLessThan(1e-6);
  });

  it("a un facteur d'échelle de 1 sur les parallèles automécoïques 44° et 49°", () => {
    expect(Math.abs(scaleFactor(44) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(scaleFactor(49) - 1)).toBeLessThan(1e-12);
    // et < 1 entre les deux (projection sécante)
    expect(scaleFactor(46.5)).toBeLessThan(1);
  });

  it('respecte le méridien central (x = 700 000 sur 3° E)', () => {
    for (const lat of [42, 45, 48.7, 51]) expect(Math.abs(toL93(3, lat).x - 700000)).toBeLessThan(1e-6);
  });

  // Points de référence (coordonnées publiées au centimètre)
  const refs: Array<{ name: string; lon: number; lat: number; x: number; y: number }> = [
    // Paris (Notre-Dame) : valeur de référence EPSG:4326 → EPSG:2154 couramment publiée
    { name: 'Paris', lon: 2.3522, lat: 48.8566, x: 652469.02, y: 6862035.26 },
    { name: 'origine', lon: 3, lat: 46.5, x: 700000, y: 6600000 },
  ];
  for (const r of refs) {
    it(`retrouve le point de référence ${r.name} à moins d'un centimètre`, () => {
      const p = toL93(r.lon, r.lat);
      expect(Math.hypot(p.x - r.x, p.y - r.y)).toBeLessThan(0.01);
      const g = fromL93(r.x, r.y);
      expect(geoErrorM(g.lon, g.lat, r.lon, r.lat)).toBeLessThan(0.01);
    });
  }

  it('aller-retour < 1 mm sur toute la France métropolitaine', () => {
    for (let lon = -5; lon <= 9.5; lon += 0.75)
      for (let lat = 41.3; lat <= 51.1; lat += 0.5) {
        const p = toL93(lon, lat);
        const g = fromL93(p.x, p.y);
        expect(geoErrorM(lon, lat, g.lon, g.lat)).toBeLessThan(0.001);
      }
  });
});

describe('repère monde', () => {
  it('x = E − originX, z = −(N − originY)', () => {
    const w = l93ToWorld(ORIGIN_L93.x + 120, ORIGIN_L93.y + 300);
    expect(w.x).toBeCloseTo(120, 9);
    expect(w.z).toBeCloseTo(-300, 9); // nord = z négatif
    const back = worldToL93(w.x, w.z);
    expect(back.e).toBeCloseTo(ORIGIN_L93.x + 120, 9);
    expect(back.n).toBeCloseTo(ORIGIN_L93.y + 300, 9);
  });

  it("l'origine est près de Chevreuse", () => {
    const g = worldToWgs84(0, 0);
    expect(geoErrorM(g.lon, g.lat, 2.0386, 48.7065)).toBeLessThan(1500);
    const c = wgs84ToWorld(2.0386, 48.7065);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(1500);
  });
});
