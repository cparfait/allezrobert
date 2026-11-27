/**
 * Le Grand Nord robertien — conception (voir docs/GRAND_NORD.md). Pays de montagnes entaillé de toutes parts par des
 * fjords profonds et étroits qui rayonnent depuis la calotte de Robert, au centre ; haut-plateau de toundra de Vidda
 * (sud-est) semé de dizaines de petits lacs ; « strandflat » bas et tourbeux au sud-ouest, semé d'îlots (skerries) ;
 * villages au fond des fjords, reliés par des vallées. Repère : x vers l'est, z vers le sud, mètres, origine au
 * centre du pays. Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, rng, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'grand-nord',
  name: 'Le Grand Nord robertien',
  /** Emprise des tuiles (m) : le pays (≈ 33 × 22 km) et une marge de mer. */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
};

// ── Côte : contour dessiné en coordonnées polaires (18 rayons, un tous les 20°) ──
// Grande presqu'île du sud-ouest (le strandflat), épaule du nord-est, côte nord rentrée, côte est massive.

/** Rayon du rivage (km) dans les directions −π + k·π/9 (k = 0 : ouest ; 9 : est ; 13 : sud ; 4 : nord). */
const COAST_R = [14.6, 15.8, 10.0, 11.4, 10.4, 8.0, 12.4, 16.4, 16.0, 13.2, 15.8, 12.2, 7.8, 9.6, 10.8, 12.6, 16.8, 12.4];

/** Strandflat : plate-forme côtière basse du sud-ouest (directions, rad), tourbières, landes, îlots. */
const STRAND = { a0: 1.86, a1: 3.08, soft: 0.1 };
/** Anse de Port-Boréal : rivage régulier (sans pointes) autour de cette direction. */
const PB_ANG = 2.2;

export function strandWeight(ang: number): number {
  const a = ang < 0 ? ang + 2 * Math.PI : ang;
  return smoothstep(STRAND.a0 - STRAND.soft, STRAND.a0 + STRAND.soft, a) * (1 - smoothstep(STRAND.a1 - STRAND.soft, STRAND.a1 + STRAND.soft, a));
}

/**
 * Fjords : bras de mer étroits et profonds qui entaillent la côte entre de hautes parois. Chaque fjord suit une ligne
 * (du fond vers le large, prolongée en mer) ; sa demi-largeur croît du fond (`w0`) à l'embouchure (`w1`).
 */
export interface Fjord {
  id: string;
  name: string;
  pts: Vec2[];
  w0: number;
  w1: number;
}

/** Petite vik (anse étroite) qui entaille la côte dans la direction `ang`, sur `depth` m. */
function vik(id: string, name: string, ang: number, depth: number, bend: number): Fjord {
  const head = coastPoint(ang, depth);
  const mid = coastPoint(ang + bend, depth * 0.45);
  const mouth = coastPoint(ang + bend * 1.4, -1600);
  return { id, name, pts: [head, mid, mouth], w0: 70, w1: 300 };
}

export const FJORDS: Fjord[] = [
  { id: 'fjord-du-glacier', name: 'Le Fjord du Glacier', pts: [[-600, -6300], [-900, -7600], [-1500, -9000], [-1300, -10500], [-1600, -13400]], w0: 190, w1: 700 },
  { id: 'storfjord', name: 'Le Storfjord', pts: [[6000, -5900], [7600, -6800], [9800, -8300], [12000, -9800], [14800, -13200]], w0: 220, w1: 900 },
  { id: 'fjord-du-bac', name: 'Le Fjord du Bac', pts: [[11400, -1300], [12800, -2300], [14200, -2200], [15800, -3000], [19200, -3500]], w0: 210, w1: 800 },
  { id: 'fjord-de-skarvik', name: 'Le Fjord de Skarvik', pts: [[10600, 6000], [11800, 7400], [12400, 8800], [13900, 10300], [15800, 13200]], w0: 190, w1: 700 },
  { id: 'sorfjord', name: 'Le Sørfjord', pts: [[2600, 7600], [3000, 8700], [2500, 9800], [2900, 11200], [2600, 13400]], w0: 180, w1: 620 },
  { id: 'grand-fjord', name: 'Le Grand Fjord', pts: [[-7200, -600], [-8800, -1300], [-10600, -800], [-12600, -1600], [-14600, -1200], [-19200, -1600]], w0: 220, w1: 900 },
  { id: 'fjord-de-fjellheim', name: 'Le Fjord de Fjellheim', pts: [[-5600, -5200], [-7000, -6200], [-8200, -7800], [-10200, -8800], [-12000, -11000], [-13600, -13400]], w0: 200, w1: 760 },
];

interface FjordLine {
  f: Fjord;
  pts: Vec2[];
  /** Abscisse (m depuis le fond) de chaque point. */
  s: number[];
  len: number;
  box: [number, number, number, number];
}
let fjordLines: FjordLine[] | null = null;
function lines(): FjordLine[] {
  if (fjordLines) return fjordLines;
  fjordLines = FJORDS.map((f) => {
    const pts = resample(chaikin(f.pts, 3), 90);
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const m = f.w1 + 1700;
    return { f, pts, s, len: s[s.length - 1]!, box: [Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m] as [number, number, number, number] };
  });
  return fjordLines;
}

/** Demi-largeur d'un fjord à l'abscisse `s` (bords un peu irréguliers). */
function fjordHalf(L: FjordLine, s: number): number {
  const t = Math.min(1, Math.max(0, s) / L.len);
  return lerp(L.f.w0, L.f.w1, t ** 1.3) * (1 + 0.16 * noise2(s / 380, L.f.w0, 17));
}

// Distance aux fjords tamponnée une fois sur une grille de 20 m (le relief la lit des millions de fois), interpolée.
const FS = 20;
let fgrid: { n: number; m: number; d: Float32Array } | null = null;
function fjordGrid() {
  if (fgrid) return fgrid;
  const n = Math.ceil((ISLAND.maxX - ISLAND.minX) / FS) + 1;
  const m = Math.ceil((ISLAND.maxZ - ISLAND.minZ) / FS) + 1;
  const best = new Float32Array(n * m).fill(1e5);
  for (const L of lines()) {
    const P = L.pts;
    const R = L.f.w1 * 1.3 + 1700;
    for (let s = 0; s + 1 < P.length; s++) {
      const [ax, az] = P[s]!;
      const [bx, bz] = P[s + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - ISLAND.minX) / FS));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R - ISLAND.minX) / FS));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - ISLAND.minZ) / FS));
      const j1 = Math.min(m - 1, Math.ceil((Math.max(az, bz) + R - ISLAND.minZ) / FS));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = ISLAND.minX + i * FS;
          const z = ISLAND.minZ + j * FS;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          const o = j * n + i;
          if (d - L.f.w1 * 1.3 > best[o]!) continue;
          const v = d - fjordHalf(L, L.s[s]! + (L.s[s + 1]! - L.s[s]!) * t);
          if (v < best[o]!) best[o] = v;
        }
    }
  }
  // Au-delà de 1 500 m, le fjord ne compte plus (distance gonflée).
  for (let k = 0; k < best.length; k++) if (best[k]! > 1500) best[k] = Math.min(1e5, 1500 + (best[k]! - 1500) * 8);
  fgrid = { n, m, d: best };
  return fgrid;
}

/** Distance (m) au bord de l'eau du fjord le plus proche : < 0 dans le fjord ; très grande loin de tout fjord. */
export function fjordEdge(x: number, z: number): number {
  const g = fjordGrid();
  const fx = (x - ISLAND.minX) / FS;
  const fz = (z - ISLAND.minZ) / FS;
  if (fx < 0 || fz < 0 || fx >= g.n - 1 || fz >= g.m - 1) return 1e5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const w = fz - j;
  const o = j * g.n + i;
  const a = g.d;
  return (a[o]! * (1 - u) + a[o + 1]! * u) * (1 - w) + (a[o + g.n]! * (1 - u) + a[o + g.n + 1]! * u) * w;
}

function onLine(id: string, fromHead: number): { L: FjordLine; p: Vec2; dir: Vec2 } {
  const L = lines().find((q) => q.f.id === id)!;
  let i = 0;
  while (i + 2 < L.pts.length && L.s[i + 1]! < fromHead) i++;
  const [ax, az] = L.pts[i]!;
  const [bx, bz] = L.pts[i + 1]!;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const t = (fromHead - L.s[i]!) / l;
  return { L, p: [ax + (bx - ax) * t, az + (bz - az) * t], dir: [(bx - ax) / l, (bz - az) / l] };
}

/**
 * Point sur une rive de fjord : à `fromHead` m du fond (le long de l'axe), du côté `side` (+1 : à droite en
 * regardant le large), à `inset` m de l'eau. Sert aux embarcadères du bac et aux villages des rives.
 */
export function fjordBank(id: string, fromHead: number, side: 1 | -1, inset: number): Vec2 {
  const { L, p, dir } = onLine(id, fromHead);
  const off = fjordHalf(L, fromHead) + inset;
  return [p[0] - dir[1] * off * side, p[1] + dir[0] * off * side];
}

/** Axe d'un fjord à `fromHead` m du fond : point et direction du large. */
export function fjordAxis(id: string, fromHead: number): { p: Vec2; dir: Vec2 } {
  const { p, dir } = onLine(id, fromHead);
  return { p, dir };
}

/** Fond d'un fjord : point à `inset` m dans les terres, dans le prolongement de l'axe. */
export function fjordHead(id: string, inset: number): Vec2 {
  const { L, p, dir } = onLine(id, 0);
  const off = fjordHalf(L, 0) + inset;
  return [p[0] - dir[0] * off, p[1] - dir[1] * off];
}

/** Falaises (0 … 1) au point : celles du rivage dans cette direction, et les parois des fjords. */
export function cliffAt(x: number, z: number): number {
  return Math.max(cliffiness(Math.atan2(z, x)), 1 - smoothstep(300, 900, fjordEdge(x, z)));
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

// Le rivage ne dépend que de la direction : tables de 16 384 directions, interpolées.
const NA = 16384;
let radiusTab: Float64Array | null = null;
let cliffTab: Float64Array | null = null;
function tables(): void {
  radiusTab = new Float64Array(NA + 1);
  cliffTab = new Float64Array(NA + 1);
  for (let k = 0; k <= NA; k++) {
    const a = -Math.PI + (k / NA) * 2 * Math.PI;
    radiusTab[k] = coastRadiusExact(a);
    cliffTab[k] = cliffinessExact(a);
  }
}
function tab(t: Float64Array, ang: number): number {
  const f = ((ang + Math.PI) / (2 * Math.PI)) * NA;
  const k = Math.max(0, Math.min(NA - 1, Math.floor(f)));
  const u = f - k;
  return t[k]! * (1 - u) + t[k + 1]! * u;
}

/** Rayon du rivage (m) dans la direction `ang`. */
export function coastRadius(ang: number): number {
  if (!radiusTab) tables();
  return tab(radiusTab!, ang);
}

/** Falaises (0 … 1) dans la direction `ang`. */
export function cliffiness(ang: number): number {
  if (!cliffTab) tables();
  return tab(cliffTab!, ang);
}

/** Contour dessiné : spline de Catmull-Rom périodique sur les 18 rayons. */
function baseRadius(ang: number): number {
  const n = COAST_R.length;
  const f = ((ang + Math.PI) / (2 * Math.PI)) * n;
  const k = Math.floor(f);
  const t = f - k;
  const P = (i: number) => COAST_R[((i % n) + n) % n]! * 1000;
  const p0 = P(k - 1);
  const p1 = P(k);
  const p2 = P(k + 1);
  const p3 = P(k + 2);
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function coastRadiusExact(ang: number): number {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  // Côte très découpée : caps et anses à toutes les échelles, sauf dans l'anse de Port-Boréal.
  const calm = Math.exp(-((angDiff(ang, PB_ANG) / 0.17) ** 2));
  // Anneau de côte régulier autour de Port-Boréal : rivage en arc de cercle (rues du front de mer perpendiculaires).
  const arc = Math.exp(-((angDiff(ang, PB_ANG + 0.045) / 0.2) ** 4));
  const w = 1 + 0.05 * fbm(c * 1.7 + 5, s * 1.7 + 5, 3, 1) + (0.035 * fbm(c * 7 + 1, s * 7 - 3, 3, 2) + 0.02 * noise2(c * 30, s * 30, 3) + 0.01 * noise2(c * 75 + 2, s * 75 - 1, 4)) * (1 - calm);
  return lerp(baseRadius(ang), baseRadius(PB_ANG + 0.045), arc) * w;
}

function cliffinessExact(ang: number): number {
  // Partout des parois rocheuses, quelques criques ; le strandflat et l'anse de Port-Boréal sont bas.
  const cove = Math.max(0, noise2(Math.cos(ang) * 9, Math.sin(ang) * 9, 6));
  const c = (0.95 - 0.5 * cove) * (1 - strandWeight(ang));
  return smoothstep(0.25, 0.75, c);
}

/** Distance au rivage (m, comptée le long du rayon, ou en travers d'un fjord) : > 0 à terre, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  return Math.min(coastRadius(Math.atan2(z, x)) - Math.hypot(x, z), fjordEdge(x, z));
}

/** Compatibilité : distance normalisée à la côte (> 0 sur l'île). */
export function coast(x: number, z: number): number {
  return shoreDist(x, z) / 11000;
}

/** Point à `inset` m à l'intérieur des terres dans la direction `ang`. */
export function coastPoint(ang: number, inset: number): Vec2 {
  const r = coastRadius(ang) - inset;
  return [Math.cos(ang) * r, Math.sin(ang) * r];
}

// Viks : petites anses profondes entre les grands fjords (côte très découpée).
FJORDS.push(
  vik('vik-des-phoques', 'La Vik des Phoques', -2.78, 2600, 0.05),
  vik('vik-du-nord-ouest', 'La Vik du Nord-Ouest', -2.05, 2300, -0.04),
  vik('vik-des-eiders', 'La Vik des Eiders', -1.32, 1200, 0.04),
  vik('vik-du-corbeau', 'La Vik du Corbeau', -1.0, 2200, -0.03),
  vik('vik-des-baleines', 'La Vik des Baleines', -0.45, 2600, 0.03),
  vik('vik-du-cap', 'La Vik du Cap', 0.22, 2300, -0.03),
  vik('vik-des-sternes', 'La Vik des Sternes', 0.43, 2000, 0.03),
  vik('vik-du-levant', 'La Vik du Levant', 0.95, 2200, -0.04),
  vik('vik-des-galets', 'La Vik des Galets', 1.62, 1800, 0.03),
);

// ── Grands traits du relief ──

/** Calotte de Robert : dôme de glace au centre du pays (centre, demi-axes, altitude du sommet et du pourtour). */
export const CAP = { x: -1200, z: -2600, rx: 2800, rz: 2200, top: 1080, rim: 560 };

/** Distance normalisée au centre de la calotte (1 ≈ bord de la glace, un peu irrégulier). */
export function capE(x: number, z: number): number {
  const e = Math.hypot((x - CAP.x) / CAP.rx, (z - CAP.z) / CAP.rz);
  return e * (1 + 0.07 * fbm(x / 1400, z / 1400, 2, 33));
}

/** Glacier de Robert : langue de glace qui descend de la calotte jusqu'au fond du fjord du Glacier. */
export const GLACIER = { from: [-760, -4500] as Vec2, to: [-640, -6050] as Vec2, head: [-600, -6300] as Vec2, half: 230, top: 560 };

/**
 * Massif du Storfjell, à l'est de la calotte : le Storfjell (belvédère des Aurores au sommet) et la Dent du Renne,
 * col du Renne entre les deux.
 */
const P1: Vec2 = [2000, -4300];
const P2: Vec2 = [5100, -3300];
export const MASSIF = { phare: P1, mont: P2, h1: 430, h2: 600, spread: 2400 };

/** Haut-plateau de Vidda (sud-est) : toundra presque plate semée de lacs, rebord en escarpement. */
export const PLATEAU = { x: 5200, z: 1500, rx: 3800, rz: 2500, h: 230 };

/** Distance normalisée au centre du haut-plateau (rebord un peu irrégulier). */
export function plateauE(x: number, z: number): number {
  return Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz) * (1 + 0.06 * fbm(x / 1800, z / 1800, 2, 34));
}

/** Circuit du Grand Nord (boucle plate sur la toundra, départ devant les tribunes). */
export const ANNEAU = { cx: 3000, cz: 2500, half: 560, radius: 215, level: 0, widthM: 8 };

/**
 * Vallées dessinées : fond régulier (altitudes aux points de passage), demi-largeur du fond. Elles relient les
 * fonds de fjords au haut-plateau et entre eux ; les routes et les rivières les suivent.
 */
export interface Valley {
  id: string;
  pts: Vec2[];
  h: number[];
  w: number;
}

export interface Town {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Rayon bâti (m) et direction de la rue principale (rad). */
  r: number;
  angle: number;
  size: 'ville' | 'bourg' | 'village' | 'hameau';
  /** Station balnéaire (front de mer, promenade, cabines, villas). */
  seaside?: boolean;
  port?: boolean;
  level: number;
}

/** Direction en travers d'un fjord (rad) : rue principale des villages des rives, tournée vers l'eau. */
function fjordNormal(id: string, fromHead: number): number {
  const { dir } = fjordAxis(id, fromHead);
  return Math.atan2(-dir[0], dir[1]);
}

/** Direction d'un fjord (rad) : rue principale des villages des rives, le long de l'eau. */
function fjordAlong(id: string, fromHead: number): number {
  const { dir } = fjordAxis(id, fromHead);
  return Math.atan2(dir[1], dir[0]);
}

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: p[0], z: p[1], r, angle, size, level: 0, ...extra });
/** Village au fond d'un fjord : à `inset` m de l'eau, rue principale en travers de la vallée. */
const headTown = (id: string, name: string, fjord: string, inset: number, r: number, size: Town['size'], extra: Partial<Town> = {}): Town => town(id, name, fjordHead(fjord, inset), r, fjordNormal(fjord, 0), size, extra);

export const TOWNS: Town[] = [
  town('nordrobert', 'Nordrobert', [5000, 1000], 600, 0.2, 'bourg'),
  town('port-boreal', 'Port-Boréal', coastPoint(PB_ANG, 520), 950, 0, 'ville', { seaside: true, port: true }),
  headTown('skarvik', 'Skarvik', 'fjord-de-skarvik', 300, 400, 'village', { port: true }),
  headTown('nordvik', 'Nordvik', 'storfjord', 300, 420, 'village', { port: true }),
  headTown('sorvik', 'Sørvik', 'sorfjord', 280, 360, 'village', { port: true }),
  town('granlia', 'Granlia', coastPoint(2.93, 900), 420, 1.3, 'village'),
  town('myrbu', 'Myrbu', coastPoint(2.6, 820), 320, 0.4, 'hameau'),
  headTown('vatnby', 'Vatnby', 'grand-fjord', 320, 380, 'village', { port: true }),
  headTown('fjellheim', 'Fjellheim', 'fjord-de-fjellheim', 300, 340, 'village', { port: true }),
  town('rennesby', 'Rennesby', [4000, -150], 280, 0.9, 'hameau'),
  town('mille-lacs', 'Les Mille-Lacs', [5900, 3300], 340, 0.25, 'village'),
  town('vidda', 'Vidda', [8100, 1300], 380, 1.2, 'village'),
  headTown('fossbru', 'Fossbru', 'fjord-du-bac', 280, 300, 'hameau', { port: true }),
  // Embarcadères du bac, face à face sur les rives du fjord du Bac ; Isbrevik sur la rive est du fjord du Glacier.
  town('ferjeby', 'Ferjeby', fjordBank('fjord-du-bac', 2700, -1, 330), 200, fjordAlong('fjord-du-bac', 2700), 'hameau', { port: true }),
  town('utnes', 'Utnes', fjordBank('fjord-du-bac', 2700, 1, 330), 200, fjordAlong('fjord-du-bac', 2700), 'hameau', { port: true }),
  town('isbrevik', 'Isbrevik', fjordBank('fjord-du-glacier', 1300, 1, 280), 220, fjordAlong('fjord-du-glacier', 1300), 'hameau', { port: true }),
];

/** Lieux remarquables hors des villages (générateur et décor du client). */
export const SPOTS = {
  bikePark: [-5900, -4300] as Vec2,
  cycloCross: [6900, 4300] as Vec2,
  meteo: [8900, 2400] as Vec2,
  antenne: [9300, 600] as Vec2,
  cabane: [6700, 3900] as Vec2,
  stavkirke: [-5900, 450] as Vec2,
  fumoir: [-6700, 750] as Vec2,
  refuge: [-4600, -3300] as Vec2,
};

const T = (id: string): Vec2 => {
  const t = TOWNS.find((q) => q.id === id)!;
  return [t.x, t.z];
};

/** Le long d'une rive de fjord, du fond vers le large : plate-forme pour une route (≈ 250 m de l'eau). */
function bankLine(id: string, side: 1 | -1, s0: number, s1: number, inset: number, n: number): Vec2[] {
  return Array.from({ length: n + 1 }, (_, k) => fjordBank(id, s0 + ((s1 - s0) * k) / n, side, inset));
}

export const VALLEYS: Valley[] = [
  // Du haut-plateau aux fonds de fjords.
  { id: 'vallee-de-sorvik', pts: [[4500, 3700], [3900, 5000], [3200, 6200], T('sorvik')], h: [222, 150, 70, 6], w: 260 },
  { id: 'vallee-de-skarvik', pts: [[8000, 3400], [9000, 4500], [9900, 5400], T('skarvik')], h: [222, 140, 60, 6], w: 260 },
  { id: 'gorges-de-la-renne', pts: [[8900, 700], [9900, 100], [10700, -500], T('fossbru')], h: [222, 140, 60, 6], w: 200 },
  { id: 'vallee-du-grand-fjord', pts: [[1700, 1700], [-600, 1500], [-3200, 1000], [-5600, 300], T('vatnby')], h: [222, 175, 120, 45, 6], w: 320 },
  // Vallée de la Myra : de la vallée du Grand Fjord au strandflat de Port-Boréal.
  { id: 'vallee-de-la-myra', pts: [[-2900, 1050], [-3900, 3500], [-5200, 6000], [-6600, 8300], [-7300, 9600]], h: [128, 100, 62, 26, 8], w: 300 },
  // Col de Vatnby : du fond du Grand Fjord au fond du fjord de Fjellheim.
  { id: 'col-de-vatnby', pts: [T('vatnby'), [-7000, -1700], [-6700, -2900], [-6300, -4000], T('fjellheim')], h: [6, 70, 118, 70, 6], w: 240 },
  // Vallée des Lemmings : du fond du fjord du Glacier à la combe de Nordvik, au nord du Storfjell.
  { id: 'vallee-des-lemmings', pts: [T('isbrevik'), [800, -6800], [2200, -6900], [3600, -6500], [4500, -6050], [5150, -5850], T('nordvik')], h: [6, 70, 130, 85, 40, 14, 6], w: 300 },
  // Vallon du Renne : du rebord nord du plateau (Rennesby) jusqu'à la selle du col ; vallon de la Calotte (Fjellheim → refuge).
  { id: 'vallon-du-renne', pts: [[4000, -400], [3800, -1500], [3550, -2600], [3620, -3500]], h: [236, 300, 375, 432], w: 380 },
  { id: 'vallon-de-la-calotte', pts: [[-5150, -4750], [-4950, -4250], [-4750, -3750], [-4600, -3350]], h: [20, 120, 230, 320], w: 340 },
  // Routes des rives : fjord du Bac (les deux rives jusqu'aux embarcadères), Grand Fjord (rive sud jusqu'au large).
  { id: 'rive-sud-du-bac', pts: [T('fossbru'), ...bankLine('fjord-du-bac', -1, 400, 2700, 260, 5), T('ferjeby')], h: [6, 14, 22, 26, 22, 14, 8, 6], w: 150 },
  { id: 'rive-nord-du-bac', pts: [T('fossbru'), ...bankLine('fjord-du-bac', 1, 400, 2700, 260, 5), T('utnes')], h: [6, 14, 22, 26, 22, 14, 8, 6], w: 150 },
  { id: 'rive-du-grand-fjord', pts: [T('vatnby'), ...bankLine('grand-fjord', -1, 500, 6800, 280, 9), [-14200, 1200], T('granlia')], h: [6, 12, 20, 28, 32, 30, 28, 24, 18, 14, 12, 10, 8], w: 170 },
];

// ── Rivières (tracés dessinés, lit creusé dans le relief) ──

export interface River {
  id: string;
  name: string;
  /** De la source à l'embouchure. */
  pts: Vec2[];
  /** Largeur du lit à la source et à l'embouchure (m). */
  w0: number;
  w1: number;
  /** Demi-largeur de la vallée (m) à la source et à l'embouchure. */
  v0: number;
  v1: number;
}

/** Point en mer, au-delà du fond d'un fjord (embouchure d'une rivière). */
const intoFjord = (id: string, m: number): Vec2 => fjordAxis(id, m).p;
const sorvik = TOWNS.find((t) => t.id === 'sorvik')!;
const skarvik = TOWNS.find((t) => t.id === 'skarvik')!;

export const RIVERS: River[] = [
  // La Renne : sort des lacs du plateau et descend en gorges jusqu'au fond du fjord du Bac.
  { id: 'la-renne', name: 'La Renne', pts: [[8300, 1000], [8900, 700], [9900, 150], [10700, -450], intoFjord('fjord-du-bac', 150)], w0: 3, w1: 10, v0: 120, v1: 200 },
  // La Vik : du pied de la combe de Nordvik au fond du Storfjord.
  { id: 'la-vik', name: 'La Vik', pts: [[4350, -5250], [4700, -5550], [5100, -5800], intoFjord('storfjord', 150)], w0: 2, w1: 8, v0: 160, v1: 280 },
  // Le Ru Boréal : du plateau au fond du Sørfjord.
  { id: 'le-ru', name: 'Le Ru Boréal', pts: [[4700, 3300], [4100, 4700], [3500, 5900], [sorvik.x + 150, sorvik.z - 200], intoFjord('sorfjord', 120)], w0: 2, w1: 7, v0: 100, v1: 240 },
  // La Skarva : du plateau au fond du fjord de Skarvik.
  { id: 'la-skarva', name: 'La Skarva', pts: [[7700, 3100], [8700, 4200], [9700, 5200], [skarvik.x - 150, skarvik.z - 150], intoFjord('fjord-de-skarvik', 120)], w0: 2, w1: 7, v0: 100, v1: 240 },
  // La Saumonée : du rebord ouest du plateau au fond du Grand Fjord.
  { id: 'la-saumonee', name: 'La Saumonée', pts: [[1300, 1900], [-600, 1700], [-3200, 1200], [-5600, 500], intoFjord('grand-fjord', 150)], w0: 3, w1: 13, v0: 200, v1: 460 },
  // La Myra : par la vallée de la Myra jusqu'au strandflat, à l'ouest de Port-Boréal.
  { id: 'la-myra', name: 'La Myra', pts: [[-3300, 1900], [-4100, 3700], [-5300, 6100], [-6700, 8400], coastPoint(2.27, -150)], w0: 2, w1: 9, v0: 160, v1: 380 },
];

// ── Lacs et étangs ──

export interface Lake {
  id: string;
  name?: string;
  kind: 'lake' | 'pond';
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  /** Niveau de l'eau (m), calculé au premier appel. */
  level: number;
  depth: number;
}

const LAKE_NAMES = ['Lac de Vidda', 'Lac des Rennes', 'Lac Noir', 'Lac Long', 'Lac des Plongeons', 'Lac du Lemming', 'Lac des Mousses', 'Lac Rond', 'Lac des Linaigrettes', 'Lac du Harfang', 'Lac des Lagopèdes', 'Lac Gris', 'Lac des Airelles', 'Lac des Bécasseaux', 'Lac du Cairn', 'Lac des Sternes'];

/** Distance (m) à une polyligne. */
function polyDist(x: number, z: number, P: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Lacs du haut-plateau : semis de dizaines de petits lacs (hors des villages, du Circuit, des vallées et des rivières). */
function tundraLakes(): Lake[] {
  const r = rng(6011);
  const out: Lake[] = [];
  let named = 0;
  for (let tries = 0; tries < 4000 && out.length < 34; tries++) {
    const a = r() * Math.PI * 2;
    const q = Math.sqrt(r()) * 0.86;
    const x = PLATEAU.x + Math.cos(a) * q * PLATEAU.rx;
    const z = PLATEAU.z + Math.sin(a) * q * PLATEAU.rz;
    const big = r() < 0.3;
    const rx = big ? 200 + r() * 170 : 70 + r() * 110;
    const rz = rx * (0.4 + r() * 0.35);
    const R = rx;
    if (plateauE(x, z) > 0.84) continue;
    if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.5 + R + 220)) continue;
    if (Math.hypot(Math.max(0, Math.abs(x - ANNEAU.cx) - ANNEAU.half), z - ANNEAU.cz) < ANNEAU.radius + R + 500) continue;
    if (VALLEYS.some((v) => polyDist(x, z, v.pts) < v.w + R + 250)) continue;
    if (RIVERS.some((v) => polyDist(x, z, v.pts) < v.v0 + R + 120)) continue;
    if (out.some((l) => Math.hypot(l.x - x, l.z - z) < l.rx + R + 260)) continue;
    const name = big && named < LAKE_NAMES.length ? LAKE_NAMES[named++] : undefined;
    out.push({ id: `lac-${out.length + 1}`, ...(name ? { name } : {}), kind: rx > 120 ? 'lake' : 'pond', x: Math.round(x), z: Math.round(z), rx: Math.round(rx), rz: Math.round(rz), rot: Math.round(r() * 314) / 100, level: NaN, depth: rx > 120 ? 3 : 2 });
  }
  return out;
}

export const LAKES: Lake[] = [
  // Lacs de montagne : lac du Renne sous le col, lac de la Calotte au pied de la glace, lac du Storfjell.
  { id: 'lac-du-renne', name: 'Lac du Renne', kind: 'lake', x: 3900, z: -2500, rx: 240, rz: 150, rot: 0.5, level: NaN, depth: 6 },
  { id: 'lac-de-la-calotte', name: 'Lac de la Calotte', kind: 'lake', x: -4200, z: -2900, rx: 200, rz: 120, rot: 1.2, level: NaN, depth: 6 },
  { id: 'lac-de-fjellheim', name: 'Lac de Fjellheim', kind: 'pond', x: -7700, z: -4300, rx: 150, rz: 95, rot: 0.4, level: NaN, depth: 4 },
  { id: 'lac-des-skerries', name: 'Lac des Skerries', kind: 'pond', x: Math.round(coastPoint(2.45, 1500)[0]), z: Math.round(coastPoint(2.45, 1500)[1]), rx: 160, rz: 100, rot: 0.8, level: NaN, depth: 2 },
  ...tundraLakes(),
];

// ── Ports : bassins creusés sous le niveau de la mer, quais autour ──

export interface Harbour {
  id: string;
  name: string;
  /** Centre du bassin, direction du large (rad), demi-longueur (vers le large) et demi-largeur. */
  x: number;
  z: number;
  dir: number;
  halfLen: number;
  halfWid: number;
  /** Chenal creusé au-delà du bassin vers le large (m) ; 300 par défaut. */
  reach?: number;
}

/** Cale du bac sur une rive du fjord du Bac : petit bassin ouvert en travers du fjord. */
function ferryHarbour(id: string, name: string, side: 1 | -1): Harbour {
  const [x, z] = fjordBank('fjord-du-bac', 2700, side, 8);
  const { p } = fjordAxis('fjord-du-bac', 2700);
  return { id, name, x, z, dir: Math.atan2(p[1] - z, p[0] - x), halfLen: 34, halfWid: 16, reach: 40 };
}

/** Port au fond d'un fjord : bassin qui s'ouvre dans l'axe du fjord. */
function headHarbour(id: string, name: string, fjord: string, halfLen: number, halfWid: number): Harbour {
  const { L, p, dir } = onLine(fjord, 0);
  const back = fjordHalf(L, 0) - halfLen * 0.45;
  return { id, name, x: p[0] - dir[0] * back, z: p[1] - dir[1] * back, dir: Math.atan2(dir[1], dir[0]), halfLen, halfWid, reach: 120 };
}

function harbourAt(id: string, name: string, ang: number, halfLen: number, halfWid: number): Harbour {
  const [x, z] = coastPoint(ang, halfLen * 0.55);
  return { id, name, x, z, dir: ang, halfLen, halfWid };
}

export const HARBOURS: Harbour[] = [
  harbourAt('port-boreal', 'Port de Port-Boréal', PB_ANG - 0.07, 230, 95),
  headHarbour('port-skarvik', 'Port de Skarvik', 'fjord-de-skarvik', 140, 60),
  headHarbour('port-nordvik', 'Port de Nordvik', 'storfjord', 150, 70),
  ferryHarbour('bac-ferjeby', 'Cale du bac de Ferjeby', -1),
  ferryHarbour('bac-utnes', "Cale du bac d'Utnes", 1),
];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Amplitude des montagnes (facteur), réglable pour un essai : ISLAND_RELIEF='{"mountains":0.8}'. */
const RELIEF = { mountains: 1, ...(JSON.parse(process.env.ISLAND_RELIEF ?? '{}') as Record<string, number>) };

interface ValleyLine {
  v: Valley;
  pts: Vec2[];
  h: number[];
  box: [number, number, number, number];
}
let valleyLines: ValleyLine[] | null = null;
function vlines(): ValleyLine[] {
  if (valleyLines) return valleyLines;
  valleyLines = VALLEYS.map((v) => {
    // Altitude du fond le long du tracé, proportionnelle à la distance entre points de passage.
    const s = [0];
    for (let i = 1; i < v.pts.length; i++) s.push(s[i - 1]! + Math.hypot(v.pts[i]![0] - v.pts[i - 1]![0], v.pts[i]![1] - v.pts[i - 1]![1]));
    const pts = resample(chaikin(v.pts, 3), 25);
    const h: number[] = [];
    const total = accTotal(pts) || 1;
    let acc = 0;
    pts.forEach((p, i) => {
      if (i) acc += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
      const f = (acc / total) * s[s.length - 1]!;
      let k = 0;
      while (k + 2 < s.length && s[k + 1]! < f) k++;
      const t = clamp((f - s[k]!) / (s[k + 1]! - s[k]! || 1), 0, 1);
      h.push(lerp(v.h[k]!, v.h[k + 1]!, t));
    });
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const m = v.w * 2.6;
    return { v, pts, h, box: [Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m] as [number, number, number, number] };
  });
  return valleyLines;
}
function accTotal(pts: Vec2[]): number {
  let a = 0;
  for (let i = 1; i < pts.length; i++) a += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return a;
}

/** Fond de vallée le plus proche : distance (m), altitude du fond, demi-largeur. */
export function valleyAt(x: number, z: number): { d: number; h: number; w: number } | null {
  let best: { d: number; h: number; w: number } | null = null;
  for (const L of vlines()) {
    if (x < L.box[0] || z < L.box[1] || x > L.box[2] || z > L.box[3]) continue;
    const P = L.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i]!;
      const [bx, bz] = P[i + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (!best || d / L.v.w < best.d / best.w) best = { d, h: lerp(L.h[i]!, L.h[i + 1]!, t), w: L.v.w };
    }
  }
  return best;
}

// Vallées tamponnées une fois sur une grille de 20 m : distance relative au fond (d / w, ≤ 9) et altitude du fond.
const VC = 20;
let vgrid: { n: number; m: number; k: Float32Array; h: Float32Array } | null = null;
function valleyGrid() {
  if (vgrid) return vgrid;
  const n = Math.ceil((ISLAND.maxX - ISLAND.minX) / VC) + 1;
  const m = Math.ceil((ISLAND.maxZ - ISLAND.minZ) / VC) + 1;
  const k = new Float32Array(n * m).fill(9);
  const h = new Float32Array(n * m);
  for (const L of vlines()) {
    const P = L.pts;
    const R = L.v.w * 2.6;
    for (let s = 0; s + 1 < P.length; s++) {
      const [ax, az] = P[s]!;
      const [bx, bz] = P[s + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - ISLAND.minX) / VC));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R - ISLAND.minX) / VC));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - ISLAND.minZ) / VC));
      const j1 = Math.min(m - 1, Math.ceil((Math.max(az, bz) + R - ISLAND.minZ) / VC));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = ISLAND.minX + i * VC;
          const z = ISLAND.minZ + j * VC;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const q = Math.hypot(x - ax - dx * t, z - az - dz * t) / L.v.w;
          const o = j * n + i;
          if (q < k[o]!) {
            k[o] = q;
            h[o] = lerp(L.h[s]!, L.h[s + 1]!, t);
          }
        }
    }
  }
  vgrid = { n, m, k, h };
  return vgrid;
}
function valleyCached(x: number, z: number): { k: number; h: number } {
  const g = valleyGrid();
  const fx = (x - ISLAND.minX) / VC;
  const fz = (z - ISLAND.minZ) / VC;
  if (fx < 0 || fz < 0 || fx >= g.n - 1 || fz >= g.m - 1) return { k: 9, h: 0 };
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const w = fz - j;
  const o = j * g.n + i;
  const L = (a: Float32Array) => (a[o]! * (1 - u) + a[o + 1]! * u) * (1 - w) + (a[o + g.n]! * (1 - u) + a[o + g.n + 1]! * u) * w;
  return { k: L(g.k), h: L(g.h) };
}

/** Montagne (0 … 1) : hors du plateau, du strandflat, des vallées et de la côte. */
export function mountainous(x: number, z: number): number {
  const d = shoreDist(x, z);
  const sw = strandWeight(Math.atan2(z, x)) * (1 - smoothstep(1700, 3400, d));
  const pw = 1 - smoothstep(0.82, 1.08, plateauE(x, z));
  const v = valleyCached(x, z);
  return smoothstep(150, 1200, d) * (1 - sw) * (1 - pw) * smoothstep(1, 2.2, v.k);
}

/** Îlots (skerries) au large : petites bosses de roche qui affleurent, plus nombreuses devant le strandflat. */
function skerry(x: number, z: number, off: number): number {
  const ang = Math.atan2(z, x);
  const env = (0.45 + 0.55 * strandWeight(ang)) * smoothstep(250, 700, off) * (1 - smoothstep(2600, 4600, off));
  if (env <= 0) return -99;
  if (Math.abs(x) > 18300 || Math.abs(z) > 12300) return -99;
  for (const h of HARBOURS) if (Math.hypot(x - h.x, z - h.z) < 1300) return -99;
  const k = fbm(x / 380, z / 380, 3, 91) + 0.35 * fbm(x / 1500, z / 1500, 2, 92);
  return Math.min((k - 0.5) * 120 * env, 6 + 9 * Math.max(0, fbm(x / 120, z / 120, 2, 93))) - 3;
}

/** Îles rocheuses au large (centre, rayon, sommet) : Hvalø, Ytterøy, Kvitøy, Fyrøy. */
export const ISLES: Array<{ name: string; x: number; z: number; r: number; h: number }> = [
  { name: 'Hvalø', x: -16600, z: 8900, r: 1400, h: 150 },
  { name: 'Ytterøy', x: 8600, z: 11600, r: 950, h: 95 },
  { name: 'Kvitøy', x: -4200, z: -11700, r: 1050, h: 170 },
  { name: 'Fyrøy', x: 17200, z: 6800, r: 950, h: 115 },
];

function isles(x: number, z: number): number {
  let best = -99;
  for (const I of ISLES) {
    const d = Math.hypot(x - I.x, z - I.z) * (1 + 0.18 * fbm(x / 700, z / 700, 2, 95));
    if (d > I.r * 1.3) continue;
    const t = Math.max(0, 1 - d / I.r);
    best = Math.max(best, I.h * t ** 1.3 * (0.75 + 0.5 * ridged(x / 600, z / 600, 3, 96)) - 6 + 6 * t);
  }
  return best;
}

/** Relief naturel sans les rivières, lacs, ports ni plateaux aplanis. */
function natural(x: number, z: number): number {
  const ang = Math.atan2(z, x);
  const d = shoreDist(x, z);
  const cliff = cliffAt(x, z);
  const fe = fjordEdge(x, z);
  // Mer : fond qui plonge doucement devant les plages, vite au pied des falaises ; îlots au large (hors des fjords).
  if (d < 0) {
    const sea = Math.max(-30, 0.25 + d * lerp(0.012, 0.12, cliff));
    const off = Math.hypot(x, z) - coastRadius(ang);
    return fe > 300 ? Math.max(sea, skerry(x, z, off), isles(x, z)) : sea;
  }
  const beach = 0.25 + Math.min(d, 160) * 0.012 + 16 * smoothstep(160, 1800, d);
  const wall = 0.25 + 44 * smoothstep(4, 70, d) + 18 * smoothstep(70, 1500, d);
  let h = beach + (wall - beach) * cliff * (1 - smoothstep(1500, 4000, d));
  // Montagnes partout : crêtes et vallons (bruit en crêtes), qui montent vite derrière le rivage (parois des fjords).
  const fade = smoothstep(40, 1000 - 550 * (1 - smoothstep(300, 1500, fe)), d);
  const env = 520 + 230 * fbm(x / 8000, z / 8000, 2, 11);
  // Versants des routes de montagne (col du Renne des deux côtés, montée de la calotte) : réguliers.
  const even = Math.max(gauss(x, z, 3500, -2300, 1500, 1500), gauss(x, z, 4300, -5000, 1100, 900), gauss(x, z, -5600, -3700, 1300, 1300));
  const rough = lerp(0.6 + 0.62 * (ridged(x / 2300, z / 2300, 4, 81) - 0.45) + 0.12 * fbm(x / 650, z / 650, 2, 82), 0.62, 0.8 * even);
  h += fade * RELIEF.mountains * env * rough;
  // Strandflat : plate-forme côtière basse et bosselée (rochers moutonnés, tourbières) jusqu'à ≈ 2 km du rivage.
  const sw = strandWeight(ang) * (1 - smoothstep(1700, 3400, d));
  if (sw > 0) h = lerp(h, 3 + d * 0.006 + 7 * Math.max(0, fbm(x / 420, z / 420, 2, 24) + 0.2), sw);
  // Haut-plateau de Vidda : toundra presque plate, ondulée de bosses et de creux (où dorment les lacs).
  const pe = plateauE(x, z);
  const pw = 1 - smoothstep(0.82, 1.08, pe);
  if (pw > 0) h = lerp(h, PLATEAU.h + 9 * fbm(x / 900, z / 900, 2, 22) + 4 * fbm(x / 260, z / 260, 2, 23), pw);
  // Massif du Storfjell : deux sommets, col entre les deux, arêtes.
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.7));
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += fade * (1 - pw) * (massif + (1 - even) * massif * 0.1 * (ridged(x / 1600, z / 1600, 3, 31) - 0.45));
  // Selle du col du Renne, large et creusée : la route y arrive en pente régulière.
  h -= fade * 300 * gauss(x, z, 3450, -3750, 900, 1700);
  // Calotte de Robert : dôme de glace.
  const ce = capE(x, z);
  if (ce < 1.4) {
    const dome = CAP.rim + (CAP.top - CAP.rim) * Math.sqrt(Math.max(0, 1 - Math.min(1, ce) ** 2));
    h = lerp(h, Math.max(h, dome), 1 - smoothstep(0.95, 1.4, ce));
  }
  // Combe de Nordvik : du col jusqu'au fond du Storfjord, fond en pente régulière, versants raides de part et d'autre.
  {
    const [ax, az] = [3650, -3900];
    const [bx, bz] = [5350, -5650];
    const dx = bx - ax;
    const dz = bz - az;
    const t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    if (t > 0 && t < 1.1) {
      const dist = Math.hypot(x - ax - dx * Math.min(1, t), z - az - dz * Math.min(1, t));
      if (dist < 950) {
        const floor = lerp(430, 30, Math.min(1, t)) + dist * 0.1;
        h = lerp(h, lerp(Math.min(h, floor), h, smoothstep(550, 950, dist)), smoothstep(0, 0.08, t));
      }
    }
  }
  // Glacier de Robert : auge en U du bord de la calotte jusqu'au fond du fjord du Glacier.
  {
    const G = GLACIER;
    const [ax, az] = G.from;
    const [bx, bz] = G.head;
    const dx = bx - ax;
    const dz = bz - az;
    const t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    if (t > -0.15 && t < 1.1) {
      const tc = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(x - ax - dx * tc, z - az - dz * tc);
      if (dist < G.half * 2.8) {
        const floor = 10 + (G.top - 10) * (1 - tc) ** 1.4 + (dist / G.half) ** 2 * 45;
        const edge = smoothstep(G.half * 1.3, G.half * 2.8, dist) + (1 - smoothstep(-0.15, 0.05, t));
        h = lerp(Math.min(h, floor), h, Math.min(1, edge));
      }
    }
  }
  // Vallées : fond régulier, versants qui remontent jusqu'au relief (jamais au-dessus de lui).
  const v = valleyCached(x, z);
  if (v.k < 2.4) {
    const floor = v.h + Math.max(0, v.k - 0.35) * 30 + 3 * fbm(x / 300, z / 300, 2, 25);
    h = lerp(Math.min(h, floor), h, smoothstep(1, 2.4, v.k));
  }
  // Villages du bord de l'eau (ports, fonds de fjords) : arrière-pays en pente douce sur 1,4 km (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.05), h, smoothstep(700, 1800, dt));
  }
  return h;
}
const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port);

// Vallées des rivières : distance au lit, altitude du lit et largeurs, sur une grille de 20 m.
interface RiverGrid {
  n: number;
  m: number;
  cell: number;
  x0: number;
  z0: number;
  dist: Float32Array;
  bed: Float32Array;
  chan: Float32Array;
  width: Float32Array;
}
let valley: RiverGrid | null = null;

/** Lit des rivières : points tous les 10 m, altitude du lit (toujours descendante), largeurs. */
export interface RiverBed {
  river: River;
  pts: Vec2[];
  bed: number[];
  chan: number[];
  width: number[];
}
let beds: RiverBed[] | null = null;

export function riverBeds(): RiverBed[] {
  if (beds) return beds;
  beds = RIVERS.map((river) => {
    // Méandres : le tracé dessiné ondule (bruit le long du cours, amplitude croissante vers l'aval).
    const base = resample(chaikin(river.pts, 4), 10);
    const pts: Vec2[] = base.map(([x, z], i) => {
      const a = base[Math.max(0, i - 1)]!;
      const b2 = base[Math.min(base.length - 1, i + 1)]!;
      const dx = b2[0] - a[0];
      const dz = b2[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const t = i / (base.length - 1);
      const off = (25 + 70 * t) * noise2(i / 45, 0.5, 71) * Math.min(1, i / 30, (base.length - 1 - i) / 30);
      return [x - (dz / l) * off, z + (dx / l) * off];
    });
    const n = pts.length;
    const raw = pts.map(([x, z]) => natural(x, z) - 2.5);
    // Toujours en descente (≥ 0,15 %), jusqu'à 0,1 m à l'embouchure.
    const bed = raw.slice();
    for (let i = 1; i < n; i++) bed[i] = Math.min(bed[i]!, bed[i - 1]! - 0.015);
    const mouth = pts.findIndex(([x, z]) => shoreDist(x, z) < 0);
    const end = mouth < 0 ? n - 1 : mouth;
    for (let i = 0; i < n; i++) {
      const t = smoothstep(Math.max(0, end - 150), end, i);
      bed[i] = Math.max(-1.5, lerp(bed[i]!, Math.min(bed[i]!, -0.6), t));
    }
    // Pente lissée (moyenne glissante sur ± 200 m), toujours descendante.
    const sm = bed.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) {
        s += bed[j]!;
        c++;
      }
      return s / c;
    });
    for (let i = 1; i < n; i++) sm[i] = Math.min(sm[i]!, sm[i - 1]! - 0.01);
    const chan = pts.map((_, i) => lerp(river.w0, river.w1, i / (n - 1)) / 2);
    const width = pts.map((_, i) => lerp(river.v0, river.v1, i / (n - 1)));
    return { river, pts, bed: sm, chan, width };
  });
  return beds;
}

function getValley(): RiverGrid {
  if (valley) return valley;
  const cell = 20;
  const x0 = ISLAND.minX;
  const z0 = ISLAND.minZ;
  const n = Math.ceil((ISLAND.maxX - x0) / cell) + 1;
  const m = Math.ceil((ISLAND.maxZ - z0) / cell) + 1;
  const dist = new Float32Array(n * m).fill(1e9);
  const bed = new Float32Array(n * m);
  const chan = new Float32Array(n * m);
  const width = new Float32Array(n * m);
  for (const b of riverBeds()) {
    for (let k = 0; k < b.pts.length; k++) {
      const [px, pz] = b.pts[k]!;
      const W = b.width[k]! + 40;
      const i0 = Math.max(0, Math.floor((px - W - x0) / cell));
      const i1 = Math.min(n - 1, Math.ceil((px + W - x0) / cell));
      const j0 = Math.max(0, Math.floor((pz - W - z0) / cell));
      const j1 = Math.min(m - 1, Math.ceil((pz + W - z0) / cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const dd = Math.hypot(x0 + i * cell - px, z0 + j * cell - pz);
          const o = j * n + i;
          if (dd < dist[o]!) {
            dist[o] = dd;
            bed[o] = b.bed[k]!;
            chan[o] = b.chan[k]!;
            width[o] = b.width[k]!;
          }
        }
    }
  }
  valley = { n, m, cell, x0, z0, dist, bed, chan, width };
  return valley;
}

function riverAt(x: number, z: number): { dist: number; bed: number; chan: number; width: number } | null {
  const v = getValley();
  const fx = (x - v.x0) / v.cell;
  const fz = (z - v.z0) / v.cell;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= v.n - 1 || j >= v.m - 1) return null;
  const o = j * v.n + i;
  const u = fx - i;
  const w = fz - j;
  const lerp4 = (a: Float32Array) => (a[o]! * (1 - u) + a[o + 1]! * u) * (1 - w) + (a[o + v.n]! * (1 - u) + a[o + v.n + 1]! * u) * w;
  const dist = lerp4(v.dist);
  if (dist > 1e8 || v.dist[o]! > 1e8 || v.dist[o + 1]! > 1e8 || v.dist[o + v.n]! > 1e8 || v.dist[o + v.n + 1]! > 1e8) {
    // Bord de la zone d'influence : valeur du plus proche voisin.
    const d0 = v.dist[o]!;
    if (d0 > 1e8) return null;
    return { dist: d0, bed: v.bed[o]!, chan: v.chan[o]!, width: v.width[o]! };
  }
  return { dist, bed: lerp4(v.bed), chan: lerp4(v.chan), width: lerp4(v.width) };
}

/** Plateaux aplanis : Anneau et villes (niveau pris au relief naturel du centre). */
interface Flat {
  x: number;
  z: number;
  /** Distance (m) : 0 au centre ; plat jusqu'à r0, raccordé jusqu'à r1. */
  dist: (x: number, z: number) => number;
  r0: number;
  r1: number;
  level: number;
}
let flats: Flat[] | null = null;

function anneauDist(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - ANNEAU.cx) - ANNEAU.half);
  return Math.hypot(dx, z - ANNEAU.cz);
}

function getFlats(): Flat[] {
  if (flats) return flats;
  const carved = (x: number, z: number) => carve(natural(x, z), x, z);
  ANNEAU.level = Math.round(carved(ANNEAU.cx, ANNEAU.cz) * 2) / 2;
  flats = [{ x: ANNEAU.cx, z: ANNEAU.cz, dist: anneauDist, r0: ANNEAU.radius + 120, r1: ANNEAU.radius + 520, level: ANNEAU.level }];
  for (const t of TOWNS) {
    // Ville en pente douce : niveau moyen, plat sur le cœur, raccord progressif.
    let s = 0;
    let c = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      s += carved(t.x + Math.cos(a) * t.r * 0.5, t.z + Math.sin(a) * t.r * 0.5);
      c++;
    }
    t.level = Math.max(t.seaside || t.port ? 3.5 : 2, (s / c + carved(t.x, t.z)) / 2);
    flats.push({ x: t.x, z: t.z, dist: (x, z) => Math.hypot(x - t.x, z - t.z), r0: t.r * (t.seaside ? 1.0 : 0.55), r1: t.r * (t.seaside ? 1.6 : 1.4) + (t.seaside ? 0 : 260), level: t.level });
  }
  return flats;
}

/** Rivières creusées dans un relief. */
function carve(h0: number, x: number, z: number): number {
  let h = h0;
  const v = riverAt(x, z);
  if (v && v.dist < v.width) {
    // Vallée : le relief au-dessus du lit est abaissé vers lui (jamais remonté : continu au bord de la vallée).
    const t = smoothstep(v.chan + 2, v.width, v.dist);
    if (h > v.bed) h = v.bed + (h - v.bed) * t;
    if (v.dist < v.chan + 2) h = Math.min(h, v.bed - 1.2 * (1 - smoothstep(v.chan * 0.6, v.chan + 2, v.dist)));
  }
  return h;
}

function lakeLevels(): void {
  for (const l of LAKES) {
    if (!Number.isNaN(l.level)) continue;
    // Niveau : un peu sous le point le plus bas du pourtour (le bassin reste fermé).
    let lo = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const [px, pz] = lakeEdge(l, a, 1.2);
      lo = Math.min(lo, preLake(px, pz));
    }
    l.level = Math.round((lo - 0.6) * 10) / 10;
  }
}

function lakeEdge(l: Lake, a: number, s: number): Vec2 {
  const ex = Math.cos(a) * l.rx * s;
  const ez = Math.sin(a) * l.rz * s;
  return [l.x + ex * Math.cos(l.rot) - ez * Math.sin(l.rot), l.z + ex * Math.sin(l.rot) + ez * Math.cos(l.rot)];
}

/** Distance normalisée au centre d'un lac (1 = rive). */
export function lakeE(l: Lake, x: number, z: number): number {
  const dx = x - l.x;
  const dz = z - l.z;
  const u = dx * Math.cos(l.rot) + dz * Math.sin(l.rot);
  const w = -dx * Math.sin(l.rot) + dz * Math.cos(l.rot);
  return Math.hypot(u / l.rx, w / l.rz);
}

function preLake(x: number, z: number): number {
  let h = carve(natural(x, z), x, z);
  // Jamais sur la plage ni en mer (le front de mer garde son sable).
  const shore = smoothstep(150, 330, shoreDist(x, z));
  for (const f of getFlats()) {
    if (Math.abs(x - f.x) > f.r1 + 600 || Math.abs(z - f.z) > f.r1 + 600) continue;
    const t = (1 - smoothstep(f.r0, f.r1, f.dist(x, z))) * shore;
    if (t > 0) h = lerp(h, f.level, t);
  }
  return h;
}

let lakesReady = false;

/** Altitude du terrain (avant arasement sous les routes). */
export function terrain(x: number, z: number): number {
  if (!lakesReady) {
    lakesReady = true;
    lakeLevels();
  }
  let h = preLake(x, z);
  for (const l of LAKES) {
    if (Math.abs(x - l.x) > l.rx * 1.7 + l.rz * 1.7 || Math.abs(z - l.z) > l.rx * 1.7 + l.rz * 1.7) continue;
    const e = lakeE(l, x, z);
    if (e >= 1.6) continue;
    // Cuvette sous l'eau ; berges en pente douce, jamais sous le niveau jusqu'à 1,2 × le rayon (bassin fermé).
    if (e < 1) h = Math.min(h, l.level - l.depth * (1 - e * e) - 0.2);
    else {
      // Berge : à 0,3 m au-dessus de l'eau sur la rive, puis raccord continu au relief jusqu'à 1,6 × le rayon ;
      // relief plus bas que l'eau : digue jusqu'à 1,2 × le rayon, puis talus.
      h = h >= l.level + 0.3 ? lerp(l.level + 0.3, h, smoothstep(1, 1.6, e)) : lerp(l.level + 0.3, h, smoothstep(1.2, 1.6, e));
    }
  }
  for (const p of HARBOURS) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > 800 || Math.abs(dz) > 800) continue;
    const u = dx * Math.cos(p.dir) + dz * Math.sin(p.dir);
    const w = -dx * Math.sin(p.dir) + dz * Math.cos(p.dir);
    const out = Math.max(Math.abs(w) - p.halfWid, -u - p.halfLen, 0);
    // Bassin à −3 m ouvert vers le large (u > 0), quais à 2,5 m sur 30 m, raccord au-delà.
    if (Math.abs(w) < p.halfWid && u > -p.halfLen && u < p.halfLen + (p.reach ?? 300)) h = Math.min(h, -3);
    else if (out < 30 && u < p.halfLen + 40) h = Math.max(2.5, Math.min(h, 2.5));
    else if (out < 90 && u < p.halfLen + 40) h = lerp(2.5, h, smoothstep(30, 90, out));
  }
  return h;
}

// ── L'Anneau ──

/** Points de l'anneau (sens horaire vu du ciel), espacés d'environ `step` mètres, boucle fermée. */
export function anneauLoop(step = 4): Vec2[] {
  const { cx, cz, half, radius } = ANNEAU;
  const pts: Vec2[] = [];
  const straight = Math.round((2 * half) / step);
  const arc = Math.round((Math.PI * radius) / step);
  for (let i = 0; i < straight; i++) {
    const t = i / straight;
    pts.push([cx - half + 2 * half * t, cz - radius - 18 * Math.sin(Math.PI * t)]);
  }
  for (let i = 0; i < arc; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / arc;
    pts.push([cx + half + radius * Math.cos(a), cz + radius * Math.sin(a)]);
  }
  for (let i = 0; i < straight; i++) {
    const t = i / straight;
    pts.push([cx + half - 2 * half * t, cz + radius + 10 * Math.sin(Math.PI * t)]);
  }
  for (let i = 0; i < arc; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / arc;
    pts.push([cx - half + radius * Math.cos(a), cz + radius * Math.sin(a)]);
  }
  return pts;
}

/** Point dans le lit d'une rivière (élargi de `margin` m). */
export function inRiver(x: number, z: number, margin = 0): boolean {
  const v = riverAt(x, z);
  return !!v && v.dist < v.chan + margin;
}

export function inLake(x: number, z: number, margin = 1): boolean {
  return LAKES.some((l) => lakeE(l, x, z) < margin);
}

/** Point sur la glace (calotte de Robert ou langue du glacier), élargi de `margin` m. */
export function inGlacier(x: number, z: number, margin = 0): boolean {
  if (capE(x, z) < 1 + margin / 2500) return true;
  const [ax, az] = GLACIER.from;
  const [bx, bz] = GLACIER.to;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t) < GLACIER.half * (1 - 0.35 * t) + margin;
}

export function inHarbour(x: number, z: number, margin = 0): boolean {
  return HARBOURS.some((p) => {
    const dx = x - p.x;
    const dz = z - p.z;
    const u = dx * Math.cos(p.dir) + dz * Math.sin(p.dir);
    const w = -dx * Math.sin(p.dir) + dz * Math.cos(p.dir);
    return Math.abs(w) < p.halfWid + margin && u > -p.halfLen - margin && u < p.halfLen + (p.reach ?? 1e9) + margin;
  });
}

export { clamp };

/** Mise au point : étapes du relief en un point. */
export function terrainSteps(x: number, z: number) {
  const n = natural(x, z);
  const c = carve(n, x, z);
  return { natural: n, carved: c, preLake: preLake(x, z), final: terrain(x, z), flats: getFlats().map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), level: f.level, d: Math.round(f.dist(x, z)), r0: f.r0, r1: f.r1 })).filter((f) => f.d < f.r1 + 100) };
}
