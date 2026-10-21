/**
 * Projection Lambert-93 (EPSG:2154, ellipsoïde GRS80) ↔ WGS84, et passage repère monde ↔ GPS.
 * Sert à reconstruire latitude / longitude des enregistrements (export FIT, Strava).
 * Formules de la notice IGN NTG_71 (conique conforme sécante).
 */
const A = 6378137;
const F = 1 / 298.257222101;
const E = Math.sqrt(F * (2 - F));
const LON0 = (3 * Math.PI) / 180;
const LAT0 = (46.5 * Math.PI) / 180;
const LAT1 = (44 * Math.PI) / 180;
const LAT2 = (49 * Math.PI) / 180;
const X0 = 700000;
const Y0 = 6600000;

function isoLat(phi: number): number {
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
}

function grandeNormale(phi: number): number {
  return A / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
}

const N = Math.log((grandeNormale(LAT2) * Math.cos(LAT2)) / (grandeNormale(LAT1) * Math.cos(LAT1))) / (isoLat(LAT1) - isoLat(LAT2));
const C = ((grandeNormale(LAT1) * Math.cos(LAT1)) / N) * Math.exp(N * isoLat(LAT1));
const YS = Y0 + C * Math.exp(-N * isoLat(LAT0));

export function wgs84ToL93(lonDeg: number, latDeg: number): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const r = C * Math.exp(-N * isoLat(phi));
  const g = N * (lam - LON0);
  return { x: X0 + r * Math.sin(g), y: YS - r * Math.cos(g) };
}

export function l93ToWgs84(x: number, y: number): { lon: number; lat: number } {
  const dx = x - X0;
  const dy = y - YS;
  const r = Math.hypot(dx, dy);
  const g = Math.atan2(dx, -dy);
  const lam = LON0 + g / N;
  const l = -Math.log(Math.abs(r / C)) / N;
  // Latitude depuis la latitude isométrique, par itération (converge en quelques pas).
  let phi = 2 * Math.atan(Math.exp(l)) - Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const es = E * Math.sin(phi);
    const next = 2 * Math.atan(((1 + es) / (1 - es)) ** (E / 2) * Math.exp(l)) - Math.PI / 2;
    if (Math.abs(next - phi) < 1e-12) {
      phi = next;
      break;
    }
    phi = next;
  }
  return { lon: (lam * 180) / Math.PI, lat: (phi * 180) / Math.PI };
}

/** Repère monde (x est, z sud) → WGS84, à partir de l'origine Lambert-93 du monde. */
export function worldToWgs84(x: number, z: number, originL93: { x: number; y: number }): { lon: number; lat: number } {
  return l93ToWgs84(originL93.x + x, originL93.y - z);
}

export function wgs84ToWorld(lon: number, lat: number, originL93: { x: number; y: number }): { x: number; z: number } {
  const p = wgs84ToL93(lon, lat);
  return { x: p.x - originL93.x, z: -(p.y - originL93.y) };
}
