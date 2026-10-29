/**
 * L'île de Robert — conception (voir docs/ILE_DE_ROBERT.md) : côte, relief, rivières, lacs, ports, plateaux
 * des villes et de l'Anneau. Repère : x vers l'est, z vers le sud, mètres, origine au centre de l'île.
 * Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'ile-de-robert',
  name: "L'île de Robert",
  /** Emprise des tuiles (m) : l'île (≈ 34 × 22 km) et une marge de mer. */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
  /** Demi-axes de la côte (m) et exposant de la super-ellipse. */
  A: 16800,
  B: 10800,
  pow: 2.3,
};

// ── Côte : île étoilée (un seul rivage par direction), caps, baies et falaises par secteur ──

interface CoastFeature {
  /** Direction (rad, atan2(z, x)) et demi-largeur angulaire. */
  ang: number;
  width: number;
  /** > 0 : cap (le rivage avance), < 0 : baie. */
  amount: number;
  /** Falaises (0 plage … 1 falaise franche). */
  cliff: number;
}

const FEATURES: CoastFeature[] = [
  { ang: -0.75, width: 0.22, amount: 0.07, cliff: 1 }, // cap du Phare (nord-est), falaises
  { ang: -1.2, width: 0.25, amount: 0.0, cliff: 0.8 }, // côte nord-est rocheuse
  { ang: -1.75, width: 0.12, amount: -0.05, cliff: 0 }, // anse de Kerbrou (port du nord)
  { ang: -2.35, width: 0.2, amount: 0.04, cliff: 0.6 }, // pointe des Bois
  { ang: 3.08, width: 0.18, amount: 0.03, cliff: 0.7 }, // falaises de Saint-Pierre (ouest)
  { ang: 2.55, width: 0.22, amount: -0.04, cliff: 0 }, // lagune du sud-ouest
  { ang: 1.45, width: 0.3, amount: -0.06, cliff: 0 }, // grande baie de Robertville (plage)
  { ang: 0.95, width: 0.12, amount: 0.03, cliff: 0.4 }, // embouchure de la Robe
  { ang: 0.25, width: 0.25, amount: 0.04, cliff: 0.9 }, // falaises du plateau (est)
];

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

function coastRadiusExact(ang: number): number {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const I = ISLAND;
  const base = 1 / ((Math.abs(c) / I.A) ** I.pow + (Math.abs(s) / I.B) ** I.pow) ** (1 / I.pow);
  let w = 1 + 0.045 * fbm(c * 1.6 + 5, s * 1.6 + 5, 3, 1) + 0.018 * fbm(c * 7 + 1, s * 7 - 3, 3, 2) + 0.006 * noise2(c * 30, s * 30, 3);
  for (const f of FEATURES) w += f.amount * Math.exp(-((angDiff(ang, f.ang) / f.width) ** 2));
  return base * w;
}

function cliffinessExact(ang: number): number {
  let c = 0;
  for (const f of FEATURES) c = Math.max(c, f.cliff * Math.exp(-((angDiff(ang, f.ang) / (f.width * 0.8)) ** 2)));
  return smoothstep(0.25, 0.75, c);
}

/** Distance au rivage (m, comptée le long du rayon) : > 0 sur l'île, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  return coastRadius(Math.atan2(z, x)) - Math.hypot(x, z);
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

// ── Lieux ──

/** Massif du Phare : deux sommets, le col entre les deux ; le phare coiffe le sommet côté mer. */
const P1 = coastPoint(-0.78, 1900);
const toCenter = [-P1[0] / Math.hypot(P1[0], P1[1]), -P1[1] / Math.hypot(P1[0], P1[1])] as const;
const P2: Vec2 = [P1[0] + toCenter[0] * 2700 - toCenter[1] * 900, P1[1] + toCenter[1] * 2700 + toCenter[0] * 900];
export const MASSIF = { phare: P1, mont: P2, h1: 600, h2: 690, spread: 2300 };

export const ANNEAU = { cx: -4700, cz: 900, half: 560, radius: 215, level: 0, widthM: 8 };

export interface Town {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Rayon bâti (m) et direction de la rue principale (rad). */
  r: number;
  angle: number;
  size: 'ville' | 'bourg' | 'village' | 'hameau';
  /** Station balnéaire (front de mer, planches, cabines, villas). */
  seaside?: boolean;
  port?: boolean;
  level: number;
}

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: p[0], z: p[1], r, angle, size, level: 0, ...extra });

export const TOWNS: Town[] = [
  town('saint-robert', 'Saint-Robert', [300, -200], 620, 0.08, 'bourg'),
  town('robertville', 'Robertville-sur-Mer', coastPoint(1.47, 520), 950, 0, 'ville', { seaside: true }),
  town('kerbrou', 'Kerbrou', coastPoint(-1.75, 420), 420, 0.3, 'village', { port: true }),
  town('saint-pierre', 'Saint-Pierre', coastPoint(3.0, 1300), 480, 1.45, 'village'),
  town('la-pointe', 'La Pointe', coastPoint(2.3, 900), 330, 0.6, 'hameau'),
  town('les-granges', 'Les Granges', [12300, 900], 380, 1.4, 'village'),
  town('vallon', 'Vallon-sur-Robe', [6900, 2500], 420, 1.25, 'village'),
  town('bois-joli', 'Bois-Joli', [-8200, -2600], 360, 0.5, 'village'),
  town('les-vignes', 'Les Vignes', [-2300, 3900], 340, 0.15, 'village'),
  town('le-col', 'Le Hameau du Col', [P2[0] - 1300, P2[1] + 2500], 280, 0.9, 'hameau'),
  town('port-sable', 'Port-Sable', coastPoint(0.62, 700), 300, 2.2, 'hameau'),
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

const vallon = TOWNS.find((t) => t.id === 'vallon')!;
const robertville = TOWNS.find((t) => t.id === 'robertville')!;
export const RIVERS: River[] = [
  {
    id: 'la-robe',
    name: 'La Robe',
    pts: [[P2[0] - 300, P2[1] + 1300], [P2[0] - 900, P2[1] + 2700], [6900, -900], [vallon.x + 260, vallon.z - 300], [vallon.x + 250, vallon.z + 700], [6300, 5600], coastPoint(0.95, -150)],
    w0: 3,
    w1: 12,
    v0: 160,
    v1: 520,
  },
  {
    id: 'le-ru',
    name: 'Le Ru des Vignes',
    pts: [[-300, 6000], [500, 7100], [robertville.x + 900, robertville.z - 900], coastPoint(1.395, -150)],
    w0: 2,
    w1: 7,
    v0: 90,
    v1: 260,
  },
  {
    id: 'le-bief',
    name: 'Le Bief',
    pts: [[-10200, -4300], [-10600, -6000], [-11500, -7200], coastPoint(-2.2, -150)],
    w0: 2,
    w1: 6,
    v0: 110,
    v1: 260,
  },
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

const lagoonC = coastPoint(2.55, 650);
export const LAKES: Lake[] = [
  { id: 'lagune', name: 'La Lagune', kind: 'lake', x: lagoonC[0], z: lagoonC[1], rx: 1100, rz: 420, rot: 2.55 + Math.PI / 2, level: 0.35, depth: 1.6 },
  { id: 'lac-du-phare', name: 'Lac du Phare', kind: 'lake', x: (P1[0] + P2[0]) / 2 + 900, z: (P1[1] + P2[1]) / 2 + 700, rx: 260, rz: 170, rot: 0.6, level: NaN, depth: 6 },
  { id: 'etang-des-bois', name: 'Étang des Bois', kind: 'lake', x: -9400, z: -4600, rx: 220, rz: 140, rot: 0.3, level: NaN, depth: 3 },
  { id: 'etang-de-peche', name: 'Étang de pêche', kind: 'pond', x: vallon.x - 650, z: vallon.z + 1500, rx: 110, rz: 70, rot: 1.1, level: NaN, depth: 2.5 },
  { id: 'etang-des-granges', kind: 'pond', x: 11000, z: 2600, rx: 70, rz: 50, rot: 0.2, level: NaN, depth: 2 },
  { id: 'mare-saint-pierre', kind: 'pond', x: -11200, z: 2900, rx: 60, rz: 45, rot: 0.8, level: NaN, depth: 2 },
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
}

function harbourAt(id: string, name: string, ang: number, halfLen: number, halfWid: number): Harbour {
  const [x, z] = coastPoint(ang, halfLen * 0.55);
  return { id, name, x, z, dir: ang, halfLen, halfWid };
}

export const HARBOURS: Harbour[] = [harbourAt('port-robertville', 'Port de Robertville', 1.395, 230, 90), harbourAt('port-kerbrou', 'Port de Kerbrou', -1.75, 150, 70)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Relief naturel sans les rivières, lacs, ports ni plateaux aplanis. */
function natural(x: number, z: number): number {
  const ang = Math.atan2(z, x);
  const d = coastRadius(ang) - Math.hypot(x, z);
  const cliff = cliffiness(ang);
  // Mer : fond qui plonge doucement devant les plages, vite au pied des falaises.
  if (d < 0) return Math.max(-30, 0.25 + d * lerp(0.012, 0.12, cliff));
  // Plage (≈ 1,2 %) puis arrière-pays ; falaise : paroi de ≈ 35 m sur 60 m.
  const beach = 0.25 + Math.min(d, 160) * 0.012 + 16 * smoothstep(160, 1800, d);
  const wall = 0.25 + 34 * smoothstep(4, 70, d) + 14 * smoothstep(70, 1500, d);
  // Falaises : seulement près du rivage (la côte dépend de la direction : loin à l'intérieur, l'écart
  // ferait des rayons depuis le centre de l'île).
  let h = beach + (wall - beach) * cliff * (1 - smoothstep(1500, 4000, d));
  const cl = cliff * (1 - smoothstep(1500, 4000, d));
  const inland = smoothstep(150, 2400, d) * (1 - cl) + smoothstep(60, 900, d) * cl;
  // Campagne ondulée : grandes ondulations et petites bosses.
  h += inland * (26 * (fbm(x / 7000, z / 7000, 3, 11) + 0.35) + 9 * fbm(x / 1500, z / 1500, 3, 12) + 2.5 * fbm(x / 350, z / 350, 2, 13));
  const fade = smoothstep(120, 1200, d);
  // Les Bois (nord-ouest) : collines boisées.
  const bois = gauss(x, z, -10300, -5000, 4200, 3000);
  if (bois > 1e-3) h += fade * bois * (120 + 110 * ridged(x / 2600, z / 2600, 4, 21));
  // Les Coteaux (sud) : longue croupe exposée au sud, vignes.
  h += fade * 105 * gauss(x, z, -1500, 5300, 3800, 1250) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 22));
  // Plateau de l'est : dessus presque plat, rebord en escarpement.
  const pe = Math.hypot((x - 12300) / 5200, (z - 1200) / 3700);
  h += fade * 88 * (1 - smoothstep(0.62, 1.05, pe)) * (1 + 0.04 * fbm(x / 900, z / 900, 2, 23));
  // Massif du Phare : deux sommets, col entre les deux, arêtes.
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.55));
  // Maximum adouci : col arrondi (pas d'arête vive entre les deux sommets).
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  // (norme p : nulle loin du massif, arrondit le col sans arête vive)
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += smoothstep(30, 500, d) * (massif + massif * 0.18 * (ridged(x / 1400, z / 1400, 4, 31) - 0.45));
  // Plaine basse de la lagune (sud-ouest).
  h -= fade * 14 * gauss(x, z, lagoonC[0], lagoonC[1], 2600, 1800);
  return h;
}

// Vallées des rivières : distance au lit, altitude du lit et largeurs, sur une grille de 20 m.
interface Valley {
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
let valley: Valley | null = null;

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
      const off = (40 + 140 * t) * noise2(i / 45, 0.5, 71) * Math.min(1, i / 30, (base.length - 1 - i) / 30);
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

function getValley(): Valley {
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

function valleyAt(x: number, z: number): { dist: number; bed: number; chan: number; width: number } | null {
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
    flats.push({ x: t.x, z: t.z, dist: (x, z) => Math.hypot(x - t.x, z - t.z), r0: t.r * (t.seaside ? 1.0 : 0.55), r1: t.r * (t.seaside ? 1.6 : 1.4), level: t.level });
  }
  return flats;
}

/** Rivières, lacs et ports creusés dans un relief. */
function carve(h0: number, x: number, z: number): number {
  let h = h0;
  const v = valleyAt(x, z);
  if (v && v.dist < v.width) {
    const t = smoothstep(v.chan + 2, v.width, v.dist);
    h = v.bed + (Math.max(h, v.bed) - v.bed) * t;
    if (v.dist < v.chan + 2) h = v.bed - 1.2 * (1 - smoothstep(v.chan * 0.6, v.chan + 2, v.dist));
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
      h = Math.min(h, l.level + 0.3 + 6 * (e - 1));
      if (e < 1.2) h = Math.max(h, l.level + 0.3);
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
    if (Math.abs(w) < p.halfWid && u > -p.halfLen && u < p.halfLen + 300) h = Math.min(h, -3);
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
  const v = valleyAt(x, z);
  return !!v && v.dist < v.chan + margin;
}

export function inLake(x: number, z: number, margin = 1): boolean {
  return LAKES.some((l) => lakeE(l, x, z) < margin);
}

export function inHarbour(x: number, z: number, margin = 0): boolean {
  return HARBOURS.some((p) => {
    const dx = x - p.x;
    const dz = z - p.z;
    const u = dx * Math.cos(p.dir) + dz * Math.sin(p.dir);
    const w = -dx * Math.sin(p.dir) + dz * Math.cos(p.dir);
    return Math.abs(w) < p.halfWid + margin && u > -p.halfLen - margin;
  });
}

export { clamp };
