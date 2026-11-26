/**
 * Les Rizières et la jungle — conception (voir docs/RIZIERES.md) : côte, relief (collines des terrasses, monts de la
 * jungle, pitons karstiques en pains de sucre), Grand Fleuve et delta, lacs, ports, plateaux des villes et du Circuit. Repère : x vers l'est, z vers le sud, mètres, origine au centre de l'île.
 * Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'rizieres',
  name: 'Les Rizières et la jungle',
  /** Emprise des tuiles (m) : le pays (≈ 35 × 23 km) et une marge de mer. */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
  /** Demi-axes de la côte (m) et exposant de la super-ellipse. */
  A: 17200,
  B: 11300,
  pow: 2.0,
};

// ── Côte : grand golfe au sud, calanques au sud-est, cap à l'est, côte de montagne au nord-est, aber au nord, delta à l'ouest ──

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
  { ang: 1.6, width: 0.22, amount: -0.2, cliff: 0 }, // golfe de Jade (sud), grande plage de sable blanc
  { ang: 1.12, width: 0.1, amount: 0.07, cliff: 0.5 }, // pointe des Cocotiers
  { ang: 0.84, width: 0.12, amount: 0.12, cliff: 1 }, // presqu'île des Pitons (sud-est), falaises calcaires
  { ang: 0.62, width: 0.06, amount: 0.02, cliff: 0.9 }, // falaises à l'ouest du port des Pitons
  { ang: 0.42, width: 0.12, amount: -0.07, cliff: 0.3 }, // anse des Tortues
  { ang: 0.06, width: 0.1, amount: 0.15, cliff: 0.8 }, // cap du Dragon (est)
  { ang: -0.62, width: 0.3, amount: 0.02, cliff: 0.95 }, // les monts de la jungle plongent dans la mer (nord-est)
  { ang: -1.62, width: 0.11, amount: -0.09, cliff: 0.1 }, // baie des Jonques (nord), port
  { ang: -2.3, width: 0.2, amount: 0.09, cliff: 0.7 }, // cap des Singes (nord-ouest)
  { ang: -2.75, width: 0.12, amount: -0.05, cliff: 0.3 }, // baie des Dauphins
  { ang: 2.95, width: 0.18, amount: -0.08, cliff: 0 }, // delta du Grand Fleuve (ouest)
  { ang: 2.35, width: 0.12, amount: 0.1, cliff: 0.2 }, // pointe des Sables blancs (sud-ouest)
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
  let w = 1 + 0.06 * fbm(c * 1.6 + 5, s * 1.6 + 5, 3, 1) + 0.028 * fbm(c * 7 + 1, s * 7 - 3, 3, 2) + 0.008 * noise2(c * 30, s * 30, 3);
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

/**
 * Monts de la Jungle (au nord) : arête d'ouest en est, hauteur (m, au-dessus du relief de campagne) le long de l'arête,
 * largeur des versants (m). Le massif des Lanternes la coiffe (Mont des Lanternes et Mont du Tigre, col de la Jungle entre les deux).
 */
export const CHAIN = {
  pts: [[-14500, -4600], [-10500, -6700], [-6500, -7200], [-2500, -7000], [1800, -6900], [5500, -5900], [9500, -4400], [13500, -3200]] as Vec2[],
  h: [450, 950, 1050, 820, 760, 820, 640, 420],
  width: 3300,
};

/** Massif des Lanternes : Mont des Lanternes (temple au sommet) et Mont du Tigre (stupa), col de la Jungle entre les deux. */
const P1: Vec2 = [1600, -6900];
const P2: Vec2 = [4700, -6000];
export const MASSIF = { phare: P1, mont: P2, h1: 700, h2: 790, spread: 2500 };

/** Circuit des Rizières (boucle plate, départ devant les tribunes). */
export const ANNEAU = { cx: -6900, cz: 3700, half: 560, radius: 215, level: 0, widthM: 8 };

/** Plateau des Théiers (est) : dessus presque plat, rebord en escarpement, entaillé par les gorges du Dragon. */
export const PLATEAU = { x: 11200, z: 300, rx: 4300, rz: 3300, h: 330 };

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

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: p[0], z: p[1], r, angle, size, level: 0, ...extra });

export const TOWNS: Town[] = [
  town('vat-robert', 'Vat-Robert', [-2600, 1200], 620, 0.15, 'bourg'),
  town('plage-de-jade', 'Plage-de-Jade', coastPoint(1.62, 520), 950, 0, 'ville', { seaside: true }),
  town('baie-des-pitons', 'Les Pitons', coastPoint(0.74, 420), 400, 0.5, 'village', { port: true }),
  town('port-des-jonques', 'Port-des-Jonques', coastPoint(-1.62, 420), 420, 0.1, 'village', { port: true }),
  town('les-pilotis', 'Les Pilotis', [-12300, 900], 480, 1.3, 'village'),
  town('les-mangroves', 'Les Mangroves', coastPoint(2.8, 950), 320, 0.4, 'hameau'),
  town('rive-des-lotus', 'Rive-des-Lotus', [-5600, -1000], 380, 0.12, 'village'),
  town('village-des-nuages', 'Village-des-Nuages', [-8300, -5300], 330, 0.6, 'village'),
  town('le-col', 'La Bambouseraie', [2700, -2700], 280, 0.9, 'hameau'),
  town('les-terrasses', 'Les Terrasses', [3800, 5600], 360, 0.25, 'village'),
  town('les-theiers', 'Les Théiers', [11800, -600], 400, 1.2, 'village'),
  town('pont-des-lianes', 'Pont-des-Lianes', [7600, 3700], 300, 1.4, 'hameau'),
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

const portAzur = TOWNS.find((t) => t.id === 'plage-de-jade')!;
const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port);
const pont = TOWNS.find((t) => t.id === 'pont-des-lianes')!;
export const RIVERS: River[] = [
  {
    // Le Grand Fleuve : large, lent, bordé de jungle ; il finit en delta à l'ouest.
    id: 'grand-fleuve',
    name: 'Le Grand Fleuve',
    pts: [[-10600, -6900], [-11100, -4600], [-12300, -2300], [-13400, -400], [-14800, 2000], coastPoint(2.92, -150)],
    w0: 5,
    w1: 26,
    v0: 240,
    v1: 820,
  },
  {
    // Gorges du Dragon : la rivière garde le niveau de la plaine en traversant le rebord du plateau.
    id: 'riviere-du-dragon',
    name: 'La Rivière du Dragon',
    pts: [[5500, -4500], [6300, -2500], [6900, -300], [7500, 1700], [pont.x - 250, pont.z + 300], [7900, 5800], coastPoint(0.98, -150)],
    w0: 3,
    w1: 11,
    v0: 150,
    v1: 260,
  },
  {
    // Vallée des Jonques : descente nord du col de la Jungle jusqu'au port.
    id: 'riviere-des-jonques',
    name: 'La Rivière des Jonques',
    pts: [[2800, -7200], [2400, -8000], [1900, -8900], [1450, -9650], coastPoint(-1.56, -150)],
    w0: 2,
    w1: 9,
    v0: 260,
    v1: 460,
  },
  {
    id: 'ruisseau-de-jade',
    name: 'Le Ruisseau de Jade',
    pts: [[-1700, -2700], [-1400, 300], [-900, 4300], [portAzur.x + 1150, portAzur.z - 1000], coastPoint(1.5, -150)],
    w0: 2,
    w1: 7,
    v0: 100,
    v1: 280,
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

const lagoonC = coastPoint(2.62, 720);
export const LAKES: Lake[] = [
  { id: 'lagune', name: 'Lagune des Mangroves', kind: 'lake', x: lagoonC[0], z: lagoonC[1], rx: 1300, rz: 480, rot: 2.62 + Math.PI / 2, level: 0.35, depth: 1.4 },
  { id: 'lac-de-robert', name: 'Lac des Lotus', kind: 'lake', x: -5600, z: -2500, rx: 2100, rz: 800, rot: 0.12, level: NaN, depth: 16 },
  { id: 'lac-de-l-aigle', name: 'Lac du Col', kind: 'lake', x: (P1[0] + P2[0]) / 2 + 600, z: (P1[1] + P2[1]) / 2 + 1000, rx: 280, rz: 180, rot: 0.5, level: NaN, depth: 7 },
  { id: 'lac-de-pralong', name: 'Étang des Nuages', kind: 'lake', x: -8950, z: -5850, rx: 170, rz: 110, rot: 0.4, level: NaN, depth: 4 },
  { id: 'mare-des-terrasses', kind: 'pond', x: 5200, z: 6500, rx: 90, rz: 60, rot: 0.8, level: NaN, depth: 2 },
  { id: 'mare-des-pilotis', kind: 'pond', x: -11000, z: 2700, rx: 70, rz: 50, rot: 0.3, level: NaN, depth: 2 },
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

export const HARBOURS: Harbour[] = [harbourAt('port-azur', 'Port de Plage-de-Jade', 1.53, 230, 95), harbourAt('port-calanque', 'Port des Pitons', 0.74, 140, 60), harbourAt('port-aber', 'Port des Jonques', -1.62, 150, 70)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Vallonnement (mètres d'amplitude), réglable pour un essai : ISLAND_RELIEF='{"hills":30,…}'. */
const RELIEF = { wave: 30, hills: 46, knolls: 70, chain: 1, ...(JSON.parse(process.env.ISLAND_RELIEF ?? '{}') as Record<string, number>) };

/** Distance (m) à l'arête de la chaîne du Nord et hauteur de l'arête au point le plus proche. */
export function chainAt(x: number, z: number): { d: number; h: number } {
  const P = CHAIN.pts;
  let best = Infinity;
  let h = 0;
  for (let k = 0; k + 1 < P.length; k++) {
    const [ax, az] = P[k]!;
    const [bx, bz] = P[k + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) {
      best = d;
      h = lerp(CHAIN.h[k]!, CHAIN.h[k + 1]!, t);
    }
  }
  return { d: best, h };
}

// ── Pitons karstiques : pains de sucre calcaires, en mer (baie des Pitons) et sur la presqu'île ──

export interface Piton {
  x: number;
  z: number;
  /** Rayon au pied (m) et hauteur au-dessus du sol alentour (m). */
  r: number;
  h: number;
}

/** Plaine des rizières (ouest) : sol presque plat, routes de digue droites. */
export const RICE_PLAIN = { x: -7800, z: 900, sx: 4800, sz: 1500 };
/** Colline du temple de Vat-Robert. */
export const TEMPLE_HILL = { x: -3500, z: -250, r: 300, h: 48 };

let pitons: Piton[] | null = null;

/** Pitons du sud-est : îlots de la baie, quelques-uns à terre, loin des villages, du port et des sentiers côtiers. */
export function karstPitons(): Piton[] {
  if (pitons) return pitons;
  const out: Piton[] = [];
  let seed = 4242;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const avoid: Array<[number, number, number]> = [[9300, 7500, 1500]];
  for (let tries = 0; tries < 4000 && out.length < 46; tries++) {
    const ang = 0.25 + r() * 1.05;
    const sea = r() < 0.72;
    const inset = sea ? -(250 + r() * 2600) : 900 + r() * 1700;
    const [x, z] = coastPoint(ang, inset);
    const R = sea ? 70 + r() * 150 : 90 + r() * 120;
    const H = sea ? 60 + r() * 130 : 70 + r() * 110;
    if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 700)) continue;
    if (HARBOURS.some((h) => Math.hypot(h.x - x, h.z - z) < 900)) continue;
    if (avoid.some(([ax, az, ar]) => Math.hypot(ax - x, az - z) < ar)) continue;
    if (!sea && (Math.abs(x) > 16000 || inset < 700)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + R + (sea ? 60 : 380))) continue;
    out.push({ x, z, r: R, h: H });
  }
  pitons = out;
  return out;
}

/** Surcroît d'altitude des pitons en (x, z) : flancs presque verticaux, sommet arrondi. */
export function karst(x: number, z: number): number {
  let best = 0;
  for (const p of karstPitons()) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > p.r || Math.abs(dz) > p.r) continue;
    const u = Math.hypot(dx, dz) / p.r;
    if (u >= 1) continue;
    const prof = (1 - smoothstep(0.5, 1, u)) * (1 - 0.28 * u * u) * (1 + 0.08 * noise2(x / 40, z / 40, 91));
    best = Math.max(best, p.h * prof);
  }
  return best;
}

/** Relief naturel sans les rivières, lacs, ports ni plateaux aplanis. */
function natural(x: number, z: number): number {
  return natural0(x, z) + karst(x, z);
}

function natural0(x: number, z: number): number {
  const ang = Math.atan2(z, x);
  const d = coastRadius(ang) - Math.hypot(x, z);
  const cliff = cliffiness(ang);
  // Mer : fond qui plonge doucement devant les plages, vite au pied des falaises.
  if (d < 0) return Math.max(-30, 0.25 + d * lerp(0.012, 0.12, cliff));
  const beach = 0.25 + Math.min(d, 160) * 0.012 + 16 * smoothstep(160, 1800, d);
  const wall = 0.25 + 44 * smoothstep(4, 70, d) + 18 * smoothstep(70, 1500, d);
  let h = beach + (wall - beach) * cliff * (1 - smoothstep(1500, 4000, d));
  const cl = cliff * (1 - smoothstep(1500, 4000, d));
  const inland = smoothstep(150, 2400, d) * (1 - cl) + smoothstep(60, 900, d) * cl;
  // Lieux qui doivent rester faciles : plaine de Vat-Robert et du Circuit, delta, lagune, dessus du plateau, rives du lac.
  const lake = LAKES[1]!;
  const calm = 1 - 0.8 * Math.max(gauss(x, z, ANNEAU.cx, ANNEAU.cz, 2600, 1700), gauss(x, z, -2600, 1500, 3200, 2000), gauss(x, z, lagoonC[0], lagoonC[1], 3200, 2400), gauss(x, z, -13000, 1200, 2600, 2400), gauss(x, z, PLATEAU.x, PLATEAU.z, 3000, 2200), gauss(x, z, lake.x, lake.z, 3200, 1900));
  // Plaine des rizières : presque plate (digues droites), à quelques mètres au-dessus du fleuve.
  const flatPlain = 1 - 0.88 * gauss(x, z, RICE_PLAIN.x, RICE_PLAIN.z, RICE_PLAIN.sx, RICE_PLAIN.sz);
  h += flatPlain * inland * (RELIEF.wave * (fbm(x / 7000, z / 7000, 3, 11) + 0.35) + (9 + (RELIEF.hills - 9) * calm) * fbm(x / 1500, z / 1500, 2, 12) + 2.5 * fbm(x / 350, z / 350, 2, 13));
  h += flatPlain * inland * calm * RELIEF.knolls * Math.max(0, fbm(x / 2300 + 7, z / 2300 - 3, 2, 14) + 0.08) * 1.6;
  // Colline du temple de Vat-Robert : dôme régulier.
  h += TEMPLE_HILL.h * Math.exp(-((Math.hypot(x - TEMPLE_HILL.x, z - TEMPLE_HILL.z) / TEMPLE_HILL.r) ** 2));
  const fade = smoothstep(120, 1200, d);
  // Monts de la Jungle : versants raides, crêtes et vallons (bruit en crêtes), plus douce vers la plaine.
  const c = chainAt(x, z);
  // Versants des routes de montagne (col de la Jungle des deux côtés, Village-des-Nuages) : réguliers, sans bosses à franchir.
  const even = 1 - 0.85 * Math.max(gauss(x, z, 2800, -4600, 1700, 2400), gauss(x, z, 2400, -8300, 1800, 2200), gauss(x, z, -8700, -4300, 1300, 1500));
  if (c.d < CHAIN.width * 3) {
    const prof = Math.exp(-((c.d / CHAIN.width) ** 1.6)) * (1 - smoothstep(CHAIN.width * 2, CHAIN.width * 3, c.d));
    const rough = 0.74 + even * (0.4 * (ridged(x / 2100, z / 2100, 4, 81) - 0.45) + 0.1 * fbm(x / 600, z / 600, 2, 82));
    h += fade * RELIEF.chain * c.h * prof * rough;
  }
  // Collines des Terrasses (sud) : croupes rondes couvertes de rizières en terrasses.
  h += fade * 165 * gauss(x, z, 3600, 5700, 3600, 1500) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 22));
  // Plateau des Théiers : dessus presque plat, rebord en escarpement.
  const pe = Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz);
  h += fade * PLATEAU.h * (1 - smoothstep(0.62, 1.02, pe)) * (1 + 0.04 * fbm(x / 900, z / 900, 2, 23));
  // Massif des Lanternes : deux sommets, col de la Jungle entre les deux, arêtes.
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.7));
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += smoothstep(30, 1600, d) * (massif + even * massif * 0.1 * (ridged(x / 1600, z / 1600, 3, 31) - 0.45));
  // Selle du col de la Jungle, large et creusée : la route y arrive en pente régulière.
  h -= fade * 170 * gauss(x, z, 2950, -6450, 800, 1700);
  h -= fade * 190 * gauss(x, z, 2820, -7150, 750, 800);
  // Vallée des Jonques : du col jusqu'au port, fond en pente régulière, versants raides de part et d'autre.
  {
    const [ax, az] = [2750, -7250];
    const [bx, bz] = [1450, -9650];
    const dx = bx - ax;
    const dz = bz - az;
    const t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    if (t > 0 && t < 1.1) {
      const dist = Math.hypot(x - ax - dx * Math.min(1, t), z - az - dz * Math.min(1, t));
      if (dist < 950) {
        const floor = lerp(760, 230, Math.min(1, t)) + dist * 0.1;
        // Tête de la combe estompée : le versant du Mont des Lanternes reste entier.
        h = lerp(h, lerp(Math.min(h, floor), h, smoothstep(550, 950, dist)), smoothstep(0, 0.18, t));
      }
    }
  }
  // Villes du bord de mer (ports, station) : arrière-pays en pente douce sur 1,4 km (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.045), h, smoothstep(900, 1800, dt));
  }
  // Cuvette du lac de Robert, plaine basse de la lagune et du delta.
  h -= fade * 55 * gauss(x, z, lake.x, lake.z, lake.rx * 1.5, lake.rz * 2.2);
  h -= fade * 14 * gauss(x, z, lagoonC[0], lagoonC[1], 2600, 1800);
  h -= fade * 10 * gauss(x, z, -14000, 2200, 2400, 2000);
  // Basse vallée du Grand Fleuve et delta : plaine basse qui descend doucement vers la mer (≈ 4 m par km).
  const delta = 0.9 * gauss(x, z, -13400, 600, 2600, 3200);
  if (delta > 0.01) h = lerp(h, Math.min(h, 3 + 0.004 * d), delta);
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
    // Grand Fleuve : cours inférieur lent, presque au niveau de la mer sur ses derniers kilomètres (plaine du delta,
    // marché flottant, pilotis), au lieu de dévaler les collines de l'ouest.
    if (river.id === 'grand-fleuve')
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        if (t > 0.62) bed[i] = Math.min(bed[i]!, 2 + 30 * ((1 - t) / 0.38) ** 1.3);
      }
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
    flats.push({ x: t.x, z: t.z, dist: (x, z) => Math.hypot(x - t.x, z - t.z), r0: t.r * (t.seaside ? 1.0 : 0.55), r1: t.r * (t.seaside ? 1.6 : 1.4) + (t.seaside ? 0 : 260), level: t.level });
  }
  return flats;
}

/** Rivières, lacs et ports creusés dans un relief. */
function carve(h0: number, x: number, z: number): number {
  let h = h0;
  const v = valleyAt(x, z);
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

/** Mise au point : étapes du relief en un point. */
export function terrainSteps(x: number, z: number) {
  const n = natural(x, z);
  const c = carve(n, x, z);
  return { natural: n, carved: c, preLake: preLake(x, z), final: terrain(x, z), flats: getFlats().map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), level: f.level, d: Math.round(f.dist(x, z)), r0: f.r0, r1: f.r1 })).filter((f) => f.d < f.r1 + 100) };
}
