/**
 * Projection conique conforme de Lambert (2 parallèles automécoïques) — Lambert-93 (EPSG:2154).
 * Ellipsoïde GRS80, RGF93 ≡ WGS84 à mieux que le mètre (ici on assimile les deux systèmes,
 * comme le fait l'IGN pour les usages courants).
 *
 * Formules : IGN, note technique NT/G 71 « Projection cartographique conique conforme de Lambert »
 * (algorithmes ALG0001 latitude isométrique, ALG0002 inverse, ALG0003/ALG0004 projection).
 */

const A = 6378137.0; // demi-grand axe GRS80
const F = 1 / 298.257222101; // aplatissement GRS80
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);

const DEG = Math.PI / 180;
const LON0 = 3 * DEG;
const LAT0 = 46.5 * DEG;
const LAT1 = 44 * DEG;
const LAT2 = 49 * DEG;
const X0 = 700000;
const Y0 = 6600000;

/** Latitude isométrique (ALG0001). */
export function isometricLatitude(phi: number): number {
  const s = Math.sin(phi);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
}

/** Latitude à partir de la latitude isométrique (ALG0002), itération jusqu'à 1e-12 rad. */
export function latitudeFromIsometric(l: number): number {
  let phi = 2 * Math.atan(Math.exp(l)) - Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const s = Math.sin(phi);
    const next = 2 * Math.atan(Math.pow((1 + E * s) / (1 - E * s), E / 2) * Math.exp(l)) - Math.PI / 2;
    if (Math.abs(next - phi) < 1e-13) return next;
    phi = next;
  }
  return phi;
}

/** Grande normale. */
function grandeNormale(phi: number): number {
  const s = Math.sin(phi);
  return A / Math.sqrt(1 - E2 * s * s);
}

// Constantes de la projection (ALG0054 : cas sécant).
const N1 = grandeNormale(LAT1);
const N2 = grandeNormale(LAT2);
const L1 = isometricLatitude(LAT1);
const L2 = isometricLatitude(LAT2);
/** Exposant de la projection. */
export const LCC_N = Math.log((N2 * Math.cos(LAT2)) / (N1 * Math.cos(LAT1))) / (L1 - L2);
/** Constante de la projection. */
export const LCC_C = ((N1 * Math.cos(LAT1)) / LCC_N) * Math.exp(LCC_N * L1);
const XS = X0;
const YS = Y0 + LCC_C * Math.exp(-LCC_N * isometricLatitude(LAT0));

export interface L93 {
  x: number; // easting (m)
  y: number; // northing (m)
}

/** WGS84 (degrés) → Lambert-93 (m). */
export function toL93(lonDeg: number, latDeg: number): L93 {
  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const r = LCC_C * Math.exp(-LCC_N * isometricLatitude(phi));
  const g = LCC_N * (lambda - LON0);
  return { x: XS + r * Math.sin(g), y: YS - r * Math.cos(g) };
}

/** Lambert-93 (m) → WGS84 (degrés). */
export function fromL93(x: number, y: number): { lon: number; lat: number } {
  const dx = x - XS;
  const dy = y - YS;
  const r = Math.sqrt(dx * dx + dy * dy);
  const g = Math.atan2(dx, -dy);
  const lambda = LON0 + g / LCC_N;
  const l = -Math.log(Math.abs(r / LCC_C)) / LCC_N;
  return { lon: lambda / DEG, lat: latitudeFromIsometric(l) / DEG };
}

/** Facteur d'échelle linéaire de la projection à la latitude donnée (1 sur les parallèles 44° et 49°). */
export function scaleFactor(latDeg: number): number {
  const phi = latDeg * DEG;
  const r = LCC_C * Math.exp(-LCC_N * isometricLatitude(phi));
  return (LCC_N * r) / (grandeNormale(phi) * Math.cos(phi));
}
