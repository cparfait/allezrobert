/**
 * Les Rizières et la jungle — conception (voir docs/RIZIERES.md). Repère : x vers l'est, z vers le sud, mètres,
 * origine au centre du pays. Tout est déterministe : deux générations donnent le même monde.
 *
 * Le pays est une longue terre couchée en biais, du sud-ouest au nord-est (axe `u`, l'axe `v` va de la côte nord-ouest
 * à la côte sud-est). Le Grand Fleuve la traverse d'un bout à l'autre : il naît au pied du Mont du Tigre, au nord-est,
 * descend la plaine des rizières entre deux rangées de collines en terrasses, puis se divise en quatre bras dans un
 * delta qui avance dans la mer au sud-ouest. La chaîne de la Jungle longe la côte nord-ouest et se relève au nord-est
 * en massif (Mont des Lanternes, Mont du Tigre, col de la Jungle). Sur la côte sud-est, la baie des Pitons est semée
 * de pains de sucre calcaires ; à côté, le plateau des Théiers, entaillé par les gorges du Dragon.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'rizieres',
  name: 'Les Rizières et la jungle',
  /** Emprise des tuiles (m). */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
  /** Demi-axes de la côte (m, le long de u et de v) et exposant de la super-ellipse. */
  A: 16900,
  B: 8700,
  pow: 2.3,
};

// ── Repère du pays : u le long du Grand Fleuve (vers le nord-est), v en travers (vers le sud-est) ──

/** Direction de l'axe u (rad, atan2(z, x)). */
export const FRAME = { rot: -0.4 };
const CU = Math.cos(FRAME.rot);
const SU = Math.sin(FRAME.rot);

/** Point (x, z) à partir de (u, v). */
export function UV(u: number, v: number): Vec2 {
  return [u * CU - v * SU, u * SU + v * CU];
}

/** Coordonnées (u, v) d'un point (x, z). */
export function toUV(x: number, z: number): Vec2 {
  return [x * CU + z * SU, -x * SU + z * CU];
}

/** Direction absolue (rad) d'un angle compté dans le repère du pays (0 : pointe nord-est, π/2 : côte sud-est). */
export const A = (phi: number) => FRAME.rot + phi;

// ── Côte ──

interface CoastFeature {
  /** Direction (rad, dans le repère du pays) et demi-largeur angulaire. */
  phi: number;
  width: number;
  /** > 0 : cap (le rivage avance), < 0 : baie. */
  amount: number;
  /** Falaises (0 plage … 1 falaise franche). */
  cliff: number;
}

/** Embouchures des bras du delta (angles dans le repère du pays, autour de la pointe sud-ouest). */
const MOUTHS = { fleuve: Math.PI + 0.06, lagune: Math.PI - 0.15, sables: Math.PI - 0.28, singes: Math.PI + 0.21 };

const FEATURES: CoastFeature[] = [
  { phi: 0, width: 0.32, amount: -0.03, cliff: 0.9 }, // pointe du Tigre (nord-est), falaises de la jungle
  { phi: -0.39, width: 0.06, amount: -0.07, cliff: 0.1 }, // anse des Jonques (port)
  { phi: -0.75, width: 0.5, amount: 0.01, cliff: 0.45 }, // la chaîne de la Jungle plonge dans la mer
  { phi: -1.5, width: 0.35, amount: 0.0, cliff: 0.35 }, // côte des Nuages
  { phi: -2.25, width: 0.12, amount: -0.06, cliff: 0.15 }, // baie des Dauphins
  { phi: -2.65, width: 0.1, amount: 0.05, cliff: 0.55 }, // cap des Singes
  // Delta : lobe qui avance dans la mer, un doigt de terre le long de chaque bras, des anses entre eux.
  { phi: Math.PI, width: 0.34, amount: 0.07, cliff: 0 },
  { phi: MOUTHS.singes, width: 0.035, amount: 0.045, cliff: 0 },
  { phi: MOUTHS.fleuve, width: 0.04, amount: 0.05, cliff: 0 },
  { phi: MOUTHS.lagune, width: 0.035, amount: 0.04, cliff: 0 },
  { phi: MOUTHS.sables, width: 0.03, amount: 0.035, cliff: 0 },
  { phi: (MOUTHS.singes + MOUTHS.fleuve) / 2, width: 0.03, amount: -0.03, cliff: 0 },
  { phi: (MOUTHS.fleuve + MOUTHS.lagune) / 2, width: 0.03, amount: -0.035, cliff: 0 },
  { phi: (MOUTHS.lagune + MOUTHS.sables) / 2, width: 0.025, amount: -0.025, cliff: 0 },
  { phi: 2.42, width: 0.1, amount: 0.05, cliff: 0.2 }, // pointe des Sables blancs
  { phi: 1.845, width: 0.3, amount: -0.035, cliff: 0 }, // anse de Jade, grande plage de sable blanc
  { phi: 1.22, width: 0.07, amount: 0.05, cliff: 0.6 }, // pointe des Cocotiers (ouest de la baie)
  { phi: 0.8, width: 0.2, amount: -0.3, cliff: 0.45 }, // baie des Pitons : large et profonde, semée de pitons
  { phi: 0.38, width: 0.09, amount: 0.07, cliff: 0.9 }, // cap du Dragon (est de la baie)
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
  const phi = ang - FRAME.rot;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const I = ISLAND;
  const base = 1 / ((Math.abs(c) / I.A) ** I.pow + (Math.abs(s) / I.B) ** I.pow) ** (1 / I.pow);
  let w = 1 + 0.045 * fbm(c * 1.6 + 5, s * 1.6 + 5, 3, 1) + 0.024 * fbm(c * 7 + 1, s * 7 - 3, 3, 2) + 0.008 * noise2(c * 30, s * 30, 3);
  for (const f of FEATURES) w += f.amount * Math.exp(-((angDiff(phi, f.phi) / f.width) ** 2));
  return base * w;
}

function cliffinessExact(ang: number): number {
  const phi = ang - FRAME.rot;
  let c = 0;
  for (const f of FEATURES) if (f.cliff > c) c = Math.max(c, f.cliff * Math.exp(-((angDiff(phi, f.phi) / (f.width * 0.8)) ** 2)));
  // Delta : jamais de falaise.
  c *= smoothstep(0.3, 0.5, Math.abs(angDiff(phi, Math.PI)));
  return smoothstep(0.25, 0.75, c);
}

/** Distance au rivage (m, comptée le long du rayon) : > 0 sur la terre, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  return coastRadius(Math.atan2(z, x)) - Math.hypot(x, z);
}

/** Compatibilité : distance normalisée à la côte (> 0 sur la terre). */
export function coast(x: number, z: number): number {
  return shoreDist(x, z) / 9000;
}

/** Point à `inset` m à l'intérieur des terres dans la direction `ang` (absolue). */
export function coastPoint(ang: number, inset: number): Vec2 {
  const r = coastRadius(ang) - inset;
  return [Math.cos(ang) * r, Math.sin(ang) * r];
}

// ── Lieux ──

/**
 * Chaîne de la Jungle : arête le long de la côte nord-ouest, qui se relève au nord-est ; hauteur (m, au-dessus du
 * relief de campagne) le long de l'arête, largeur des versants (m).
 */
export const CHAIN = {
  pts: ([[-9800, -5200], [-6200, -5700], [-2400, -5800], [1500, -5500], [5200, -4900], [8400, -4400], [11000, -4000], [13600, -3100], [15600, -1300], [16700, 300]] as Vec2[]).map(([u, v]) => UV(u, v)),
  h: [200, 340, 410, 370, 310, 400, 600, 680, 560, 320],
  width: 2300,
};

/** Massif des Lanternes : Mont des Lanternes (temple au sommet) et Mont du Tigre (stupa), col de la Jungle entre les deux. */
const P1 = UV(13700, 0);
const P2 = UV(10900, -2300);
export const MASSIF = { phare: P1, mont: P2, h1: 560, h2: 480, spread: 2600 };

/** Circuit des Rizières (boucle plate au sud du fleuve, départ devant les tribunes). */
const ANC = UV(-6600, 2300);
export const ANNEAU = { cx: Math.round(ANC[0]), cz: Math.round(ANC[1]), half: 560, radius: 215, level: 0, widthM: 8 };

/** Plateau des Théiers (au sud du massif) : dessus presque plat, rebord en escarpement, entaillé par les gorges du Dragon. */
const PLC = UV(11000, 4300);
export const PLATEAU = { x: PLC[0], z: PLC[1], rx: 2500, rz: 1500, rot: FRAME.rot, h: 240 };

/** Distance normalisée au centre du plateau (1 = rebord). */
export function plateauE(x: number, z: number): number {
  const [u, v] = toUV(x - PLATEAU.x, z - PLATEAU.z);
  return Math.hypot(u / PLATEAU.rx, v / PLATEAU.rz);
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

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: Math.round(p[0]), z: Math.round(p[1]), r, angle, size, level: 0, ...extra });

export const TOWNS: Town[] = [
  town('vat-robert', 'Vat-Robert', UV(-1200, 1750), 620, FRAME.rot, 'bourg'),
  town('plage-de-jade', 'Plage-de-Jade', coastPoint(A(1.8), 520), 950, 0, 'ville', { seaside: true }),
  town('baie-des-pitons', 'Les Pitons', coastPoint(A(0.95), 600), 360, A(0.95) + 0.3, 'village', { port: true }),
  town('port-des-jonques', 'Port-des-Jonques', coastPoint(A(-0.39), 560), 380, A(-0.39) + 0.6, 'village', { port: true }),
  town('les-pilotis', 'Les Pilotis', UV(-9600, 1350), 480, FRAME.rot, 'village'),
  town('les-mangroves', 'Les Mangroves', coastPoint(A((MOUTHS.fleuve + MOUTHS.lagune) / 2), 1350), 320, FRAME.rot + 0.3, 'hameau'),
  town('rive-des-lotus', 'Rive-des-Lotus', UV(-5300, -2950), 380, FRAME.rot, 'village'),
  town('village-des-nuages', 'Village-des-Nuages', UV(-2500, -5300), 330, FRAME.rot + Math.PI / 2, 'village'),
  town('le-col', 'La Bambouseraie', UV(9400, -700), 280, FRAME.rot + 0.5, 'hameau'),
  town('les-terrasses', 'Les Terrasses', UV(-1900, 4700), 360, FRAME.rot, 'village'),
  town('les-theiers', 'Les Théiers', UV(11300, 3500), 400, FRAME.rot, 'village'),
  town('pont-des-lianes', 'Pont-des-Lianes', UV(8300, 4300), 300, FRAME.rot + 1.0, 'hameau'),
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
  /** Bras du delta : part de cette rivière (premier point recalé sur son lit, au niveau de son lit). */
  from?: string;
}

const uv = (pts: Vec2[]) => pts.map(([u, v]) => UV(u, v));
const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port);

/** Fourche du delta (u, v) : le Grand Fleuve se divise en aval. */
export const DELTA_FORK = UV(-11300, 300);

export const RIVERS: River[] = [
  {
    // Le Grand Fleuve : naît au pied du Mont du Tigre, traverse tout le pays, se divise en quatre bras dans le delta.
    id: 'grand-fleuve',
    name: 'Le Grand Fleuve',
    pts: [...uv([[15400, 400], [13600, 1300], [11200, 1500], [8600, 1250], [5600, 700], [2400, 150], [-800, -100], [-4200, 250], [-7600, -150], [-11300, 300], [-13300, 100], [-15300, -500]]), coastPoint(A(MOUTHS.fleuve), -160)],
    w0: 5,
    w1: 46,
    v0: 260,
    v1: 1100,
  },
  {
    id: 'bras-de-la-lagune',
    name: 'Le Bras de la Lagune',
    from: 'grand-fleuve',
    pts: [...uv([[-12200, 250], [-13700, 1300], [-15200, 2300]]), coastPoint(A(MOUTHS.lagune), -160)],
    w0: 30,
    w1: 34,
    v0: 300,
    v1: 350,
  },
  {
    id: 'bras-des-sables',
    name: 'Le Bras des Sables',
    from: 'bras-de-la-lagune',
    pts: [...uv([[-14300, 1650], [-15400, 3300]]), coastPoint(A(MOUTHS.sables), -160)],
    w0: 20,
    w1: 24,
    v0: 240,
    v1: 280,
  },
  {
    id: 'bras-des-singes',
    name: 'Le Bras des Singes',
    from: 'grand-fleuve',
    pts: [...uv([[-13400, 100], [-14900, -1600], [-16000, -2900]]), coastPoint(A(MOUTHS.singes), -160)],
    w0: 26,
    w1: 30,
    v0: 280,
    v1: 330,
  },
  {
    // Gorges du Dragon : la rivière garde le niveau de la côte en entaillant le plateau des Théiers.
    id: 'riviere-du-dragon',
    name: 'La Rivière du Dragon',
    pts: [...uv([[15000, 3000], [13500, 4000], [12100, 4800], [10700, 5300], [9500, 5500], [8700, 5900]]), coastPoint(A(0.66), -160)],
    w0: 3,
    w1: 13,
    v0: 160,
    v1: 280,
  },
  {
    // Vallée des Jonques : descente nord du col de la Jungle jusqu'au port.
    id: 'riviere-des-jonques',
    name: 'La Rivière des Jonques',
    pts: [0, 0.3, 0.6, 0.85].map((t) => { const [mx, mz] = coastPoint(A(-0.29), 0); const s0 = UV(13000, -1700); return [s0[0] + (mx - s0[0]) * t, s0[1] + (mz - s0[1]) * t] as Vec2; }).concat([coastPoint(A(-0.29), -160)]),
    w0: 2,
    w1: 9,
    v0: 260,
    v1: 420,
  },
  {
    id: 'ruisseau-de-jade',
    name: 'Le Ruisseau de Jade',
    pts: [...uv([[-4400, 3600], [-4000, 5200], [-3800, 6600]]), coastPoint(A(2.02), -160)],
    w0: 2,
    w1: 7,
    v0: 100,
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

const lake = (id: string, name: string | undefined, kind: Lake['kind'], p: Vec2, rx: number, rz: number, rot: number, level: number, depth: number): Lake => ({ id, ...(name ? { name } : {}), kind, x: Math.round(p[0]), z: Math.round(p[1]), rx, rz, rot, level, depth });
export const LAKES: Lake[] = [
  // Lagune entre le bras de la Lagune et celui des Sables, presque au niveau de la mer.
  lake('lagune', 'Lagune des Mangroves', 'lake', UV(-15500, 3500), 900, 380, FRAME.rot + 1.0, 0.35, 1.4),
  // Lac des Lotus : ancien méandre du fleuve (bras mort), allongé au pied des collines du nord.
  lake('lac-de-robert', 'Lac des Lotus', 'lake', UV(-5300, -1850), 1150, 330, FRAME.rot - 0.08, NaN, 6),
  lake('lac-de-pralong', 'Étang des Nuages', 'lake', UV(-3500, -6050), 170, 110, 0.4, NaN, 4),
  lake('mare-des-terrasses', undefined, 'pond', UV(-700, 5400), 90, 60, 0.8, NaN, 2),
  lake('mare-des-pilotis', undefined, 'pond', UV(-8800, 2600), 70, 50, 0.3, NaN, 2),
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

export const HARBOURS: Harbour[] = [harbourAt('port-azur', 'Port de Plage-de-Jade', A(1.71), 230, 95), harbourAt('port-calanque', 'Port des Pitons', A(0.95), 140, 60), harbourAt('port-aber', 'Port des Jonques', A(-0.39), 150, 70)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
/** Gaussienne dans le repère du pays : centre (u, v), écarts le long de u et de v. */
export function gaussUV(x: number, z: number, cu: number, cv: number, su: number, sv: number): number {
  const [u, v] = toUV(x, z);
  return Math.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2));
}

/** Vallonnement (mètres d'amplitude), réglable pour un essai : ISLAND_RELIEF='{"hills":30,…}'. */
const RELIEF = { wave: 26, hills: 42, knolls: 60, chain: 1, ...(JSON.parse(process.env.ISLAND_RELIEF ?? '{}') as Record<string, number>) };

/** Distance (m) à l'arête de la chaîne de la Jungle et hauteur de l'arête au point le plus proche. */
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

// ── Pitons karstiques : pains de sucre calcaires, dans la baie des Pitons et sur ses rives ──

export interface Piton {
  x: number;
  z: number;
  /** Rayon au pied (m) et hauteur au-dessus du sol alentour (m). */
  r: number;
  h: number;
}

/** Axe du Grand Fleuve dessiné (sans méandres), pour les zones qui le suivent (plaine des rizières). */
const RIVER_AXIS: Vec2[] = RIVERS[0]!.pts;

/** Distance (m) à l'axe du Grand Fleuve et abscisse u du point le plus proche. */
export function fleuveAxis(x: number, z: number): { d: number; u: number } {
  let best = Infinity;
  let bu = 0;
  for (let k = 0; k + 1 < RIVER_AXIS.length; k++) {
    const [ax, az] = RIVER_AXIS[k]!;
    const [bx, bz] = RIVER_AXIS[k + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bu = toUV(px, pz)[0];
    }
  }
  return { d: best, u: bu };
}

/** Plaine des rizières (0 … 1) : bande plate de part et d'autre du Grand Fleuve, de la Bambouseraie au delta. */
export function plainZone(x: number, z: number): number {
  const a = fleuveAxis(x, z);
  const along = smoothstep(-13500, -11500, a.u) * (1 - smoothstep(4000, 7500, a.u));
  return along * Math.exp(-((a.d / 2300) ** 2));
}

/** Delta (0 … 1) : plaine basse au-delà de la fourche, au ras de l'eau. */
export function deltaZone(x: number, z: number): number {
  const [u, v] = toUV(x, z);
  return (1 - smoothstep(-12400, -10800, u)) * (1 - smoothstep(5200, 7000, Math.abs(v - 300)));
}

/** Compatibilité : centre et écarts de la plaine des rizières (lieux du décor, parcours). */
const RPC = UV(-5000, 300);
export const RICE_PLAIN = { x: RPC[0], z: RPC[1], sx: 4800, sz: 1500 };
/** Colline du temple de Vat-Robert. */
const THC = UV(-2700, 3050);
export const TEMPLE_HILL = { x: Math.round(THC[0]), z: Math.round(THC[1]), r: 300, h: 48 };

let pitons: Piton[] | null = null;

/** Pitons de la baie : îlots dans la baie, quelques-uns sur ses rives, loin des villages, du port et des sentiers. */
export function karstPitons(): Piton[] {
  if (pitons) return pitons;
  const out: Piton[] = [];
  let seed = 4242;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let tries = 0; tries < 6000 && out.length < 58; tries++) {
    const phi = 0.5 + r() * 0.65;
    const sea = r() < 0.7;
    const inset = sea ? -(250 + r() * 2900) : 900 + r() * 2200;
    const [x, z] = coastPoint(A(phi), inset);
    const R = sea ? 70 + r() * 150 : 90 + r() * 120;
    const H = sea ? 60 + r() * 130 : 70 + r() * 110;
    if (Math.abs(x) > 17800 || Math.abs(z) > 12200) continue;
    if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + (sea ? 700 : 1300))) continue;
    if (HARBOURS.some((h) => Math.hypot(h.x - x, h.z - z) < 900)) continue;
    if (!sea && (inset < 1300 || plateauE(x, z) < 1.25)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + R + (sea ? 60 : 380))) continue;
    out.push({ x, z, r: R, h: H });
  }
  pitons = out;
  return out;
}

/**
 * Pitons calcaires de la plaine des rizières (27/11/2026) : tours qui sortent des rizières, en deux grands groupes
 * (plaine des Digues, entre Rive-des-Lotus et le Circuit ; plaine de l'est, au sud de Vat-Robert), quelques-uns
 * isolés près du Lac des Lotus, des Pilotis et dans le delta. Ils sont dans le relief (carte, sol, roche, jungle du
 * sommet) et habillés dans le jeu par un gabarit de piton (PLAIN_PITONS de `world/lands/rizieresSites.ts`, mêmes
 * x, z, rayon, hauteur et forme). Le relief n'en est que le cœur, toujours caché sous le gabarit : pas de doublon.
 * [x, z, rayon au pied du gabarit (m), hauteur au-dessus du pied (m), forme 0 … 3]. Chaque pied est à plus de 45 m
 * de toute route, chemin, cours d'eau ou bâtiment, hors des lacs, du fleuve, des villes et des ports.
 */
export const PLAIN_PITONS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1200, -160, 99, 185, 2], [-6120, 2760, 59, 122, 2], [-5760, 2680, 49, 97, 2], [1520, -280, 65, 129, 2], [840, -120, 61, 108, 1],
  [1120, -560, 105, 185, 1], [-6440, 2480, 84, 185, 3], [-6120, 3120, 84, 185, 3], [-5920, 2280, 89, 185, 3], [1240, 200, 93, 162, 1],
  [-6560, 2960, 59, 131, 3], [-5760, 3080, 50, 117, 3], [720, -520, 51, 115, 3], [1520, -720, 70, 160, 3], [-5360, 2560, 105, 185, 2],
  [480, 0, 90, 166, 1], [-6800, 2600, 68, 151, 3], [1920, -360, 78, 168, 3], [-5480, 2160, 49, 106, 3], [1800, 80, 79, 160, 2],
  [1040, 520, 72, 106, 0], [400, -400, 50, 106, 2], [1600, 360, 83, 148, 1], [1880, -800, 79, 173, 3], [-3280, 600, 59, 98, 0],
  [-6920, 3040, 91, 154, 1], [-6000, 3440, 71, 142, 2], [-3040, 840, 54, 109, 2], [-5600, 3400, 103, 185, 1], [-3560, 360, 72, 107, 0],
  [-2960, 360, 92, 184, 2], [160, 200, 75, 125, 0], [-15720, 2840, 96, 140, 0], [-13240, 5800, 95, 141, 0], [-5080, 2000, 103, 180, 1],
  [-5040, 2400, 62, 133, 3], [-10760, 8520, 91, 185, 3], [440, -800, 77, 122, 0], [-13320, 240, 52, 117, 3], [2200, -960, 95, 185, 2],
  [3840, -2360, 91, 182, 2], [2240, -560, 91, 185, 3], [3440, -2400, 79, 177, 3], [-2720, 1000, 59, 119, 2], [-9120, 5000, 59, 91, 0],
  [-11000, 8760, 49, 82, 1],
];

/** Profils (hauteur, rayon) du gabarit unité des pitons de la plaine (copie de PITON_PROFILES, rizieresSites.ts). */
const PITON_PROFILES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-0.06, 1.05], [0.03, 1], [0.2, 0.9], [0.42, 0.88], [0.62, 0.92], [0.78, 0.84], [0.9, 0.62], [0.97, 0.34], [1, 0]],
  [[-0.06, 1.06], [0.03, 1], [0.18, 0.86], [0.38, 0.76], [0.56, 0.7], [0.74, 0.6], [0.88, 0.44], [0.96, 0.22], [1, 0]],
  [[-0.06, 1.05], [0.03, 1], [0.24, 0.94], [0.44, 0.9], [0.52, 0.66], [0.72, 0.64], [0.88, 0.5], [0.96, 0.26], [1, 0]],
  [[-0.06, 1.08], [0.03, 1], [0.16, 0.8], [0.36, 0.66], [0.58, 0.6], [0.76, 0.56], [0.9, 0.42], [0.97, 0.2], [1, 0]],
];

/**
 * Cœur des pitons de la plaine : hauteur (0 … 1 du gabarit) atteinte à la distance d (en rayons du pied), par pas de
 * 0,005 rayon. Le rayon sûr à chaque hauteur tient compte du gabarit le plus étroit que le jeu puisse poser : pans
 * resserrés (0,84), écrasement d'un axe (0,85), arête entre deux pans irréguliers (0,866), penchant (0,12 rayon).
 * La colonne de terrain occupe toute la hauteur sous elle : on garde le plus petit rayon sûr rencontré en montant.
 */
const CORE_STEP = 0.005;
const CORE: Float32Array[] = PITON_PROFILES.map((prof) => {
  const safe = (t: number) => {
    let k = 0;
    while (k + 2 < prof.length && prof[k + 1]![0] < t) k++;
    const [t0, r0] = prof[k]!;
    const [t1, r1] = prof[k + 1]!;
    const rad = r0 + (r1 - r0) * Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    return 0.618 * rad - 0.12;
  };
  const out = new Float32Array(Math.ceil(0.6 / CORE_STEP) + 1);
  for (let i = 0; i < out.length; i++) {
    const d = i * CORE_STEP;
    let lo = Infinity;
    let top = 0;
    for (let t = 0; t <= 1; t += 0.0025) {
      lo = Math.min(lo, safe(t));
      if (lo < d) break;
      top = t;
    }
    out[i] = top;
  }
  return out;
});

let plain: Piton[] | null = null;

/** Pitons de la plaine (cœurs dans le relief) ; `r` et `h` sont ceux du gabarit qui les habille. */
export function plainPitons(): Array<Piton & { form: number }> {
  return (plain ??= PLAIN_PITONS.map(([x, z, r, h, form]) => ({ x, z, r, h, form }))) as Array<Piton & { form: number }>;
}

/** Rayon (m) du cœur d'un piton de la plaine au ras du sol. */
export function plainCoreRadius(p: Piton): number {
  return p.r * 0.5;
}

const feet = new Map<Piton, number>();

/**
 * Pied d'un piton de la plaine : point le plus bas du sol (vallées creusées, sans les pitons de la plaine) sur le
 * pourtour du gabarit, comme le pied que le jeu donne au gabarit.
 */
function plainFoot(p: Piton): number {
  let y = feet.get(p);
  if (y === undefined) {
    y = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = p.x + Math.cos(a) * p.r;
      const pz = p.z + Math.sin(a) * p.r;
      y = Math.min(y, carveBase(natural(px, pz), px, pz));
    }
    feet.set(p, y);
  }
  return y;
}

/**
 * Surcroît d'altitude d'un piton de la plaine au-dessus du sol `g` : cœur caché sous le gabarit, mesuré depuis le
 * pied (le gabarit est posé 4 m sous le pied et monte jusqu'à pied + hauteur).
 */
function plainCore(p: Piton & { form: number }, x: number, z: number, g: number): number {
  const d = Math.hypot(x - p.x, z - p.z) / p.r / CORE_STEP;
  const tab = CORE[p.form]!;
  const i = Math.floor(d);
  if (i >= tab.length - 1) return 0;
  const t = tab[i]! + (tab[i + 1]! - tab[i]!) * (d - i);
  if (t <= 0) return 0;
  return Math.max(0, plainFoot(p) - 4 + (p.h + 4) * t - g);
}

/** Surcroît des pitons de la plaine au-dessus du sol `g` (calculé à la demande, près d'un piton seulement). */
function plainKarst(x: number, z: number, g?: number): number {
  let best = 0;
  for (const p of plainPitons()) {
    const rc = p.r * 0.6;
    if (Math.abs(x - p.x) > rc || Math.abs(z - p.z) > rc) continue;
    best = Math.max(best, plainCore(p, x, z, (g ??= carveBase(natural(x, z), x, z))));
  }
  return best;
}

/** Surcroît des pitons de la baie (ajouté au relief naturel). */
function bayKarst(x: number, z: number): number {
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

/** Surcroît d'altitude des pitons (baie et plaine) en (x, z) : flancs presque verticaux, sommet arrondi. */
export function karst(x: number, z: number): number {
  return Math.max(bayKarst(x, z), plainKarst(x, z));
}

/** Relief naturel sans les rivières, lacs, ports ni plateaux aplanis (pitons de la baie compris). */
function natural(x: number, z: number): number {
  return natural0(x, z) + bayKarst(x, z);
}

/** Col de la Jungle : creux de la selle entre les deux sommets (un peu au nord de leur milieu). */
const SADDLE = UV(12350, -1250);
/** Pied sud du col (la Bambouseraie) et port des Jonques (pied nord). */
const BAMB = UV(9400, -700);
const JONQ_FOOT = coastPoint(A(-0.33), 250);
/** Pied de la descente nord du col (lacets), près du port des Jonques. */
export const JONQ_FOOT_ROAD = coastPoint(A(-0.33), 430);

/** Rampe : le relief tend vers un plan incliné de `a` (hauteur ha) à `b` (hb), sur `half` m de part et d'autre de l'axe. */
function ramp(h: number, x: number, z: number, a: Vec2, b: Vec2, ha: number, hb: number, half: number, blend: number): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2;
  if (t < -0.3 || t > 1.3) return h;
  const tc = Math.max(0, Math.min(1, t));
  const dist = Math.hypot(x - a[0] - dx * tc, z - a[1] - dz * tc);
  if (dist > half + blend) return h;
  const w = (1 - smoothstep(half, half + blend, dist)) * 0.97;
  return lerp(h, lerp(ha, hb, tc), w);
}

function natural0(x: number, z: number): number {
  const ang = Math.atan2(z, x);
  const d = coastRadius(ang) - Math.hypot(x, z);
  const cliff = cliffiness(ang);
  // Mer : fond qui plonge doucement devant les plages et le delta, vite au pied des falaises.
  if (d < 0) return Math.max(-30, 0.25 + d * lerp(0.012, 0.12, cliff));
  const beach = 0.25 + Math.min(d, 160) * 0.012 + 14 * smoothstep(160, 1800, d);
  const wall = 0.25 + 44 * smoothstep(4, 70, d) + 18 * smoothstep(70, 1500, d);
  let h = beach + (wall - beach) * cliff * (1 - smoothstep(1500, 4000, d));
  const cl = cliff * (1 - smoothstep(1500, 4000, d));
  const inland = smoothstep(150, 2400, d) * (1 - cl) + smoothstep(60, 900, d) * cl;
  // Lieux qui doivent rester faciles : Circuit, Vat-Robert, delta, dessus du plateau, rives du lac.
  const lk = LAKES[1]!;
  const calm = 1 - 0.8 * Math.max(gauss(x, z, ANNEAU.cx, ANNEAU.cz, 2400, 1700), gaussUV(x, z, -1200, 1750, 3000, 1700), deltaZone(x, z), gauss(x, z, PLATEAU.x, PLATEAU.z, 2600, 2000), gauss(x, z, lk.x, lk.z, 2600, 1600));
  // Plaine des rizières le long du fleuve : presque plate (digues droites).
  const pz = plainZone(x, z);
  const flatPlain = 1 - 0.85 * pz;
  h += flatPlain * inland * (RELIEF.wave * (fbm(x / 7000, z / 7000, 3, 11) + 0.35) + (9 + (RELIEF.hills - 9) * calm) * fbm(x / 1500, z / 1500, 2, 12) + 2.5 * fbm(x / 350, z / 350, 2, 13));
  h += flatPlain * inland * calm * RELIEF.knolls * Math.max(0, fbm(x / 2300 + 7, z / 2300 - 3, 2, 14) + 0.08) * 1.6;
  // Colline du temple de Vat-Robert : dôme régulier.
  h += TEMPLE_HILL.h * Math.exp(-((Math.hypot(x - TEMPLE_HILL.x, z - TEMPLE_HILL.z) / TEMPLE_HILL.r) ** 2));
  const fade = smoothstep(120, 1200, d);
  // Versants des routes de montagne (col des deux côtés, route des Nuages) : réguliers, sans bosses à franchir.
  const even = 1 - 0.9 * Math.max(gaussUV(x, z, 11000, -1200, 2800, 2300), gaussUV(x, z, 12700, -3200, 1700, 2400), gaussUV(x, z, -2700, -4600, 1400, 1300));
  // Chaîne de la Jungle : versants raides, crêtes et vallons (bruit en crêtes), plus douce vers la plaine.
  const c = chainAt(x, z);
  if (c.d < CHAIN.width * 3) {
    const prof = Math.exp(-((c.d / CHAIN.width) ** 1.6)) * (1 - smoothstep(CHAIN.width * 2, CHAIN.width * 3, c.d));
    const rough = 0.74 + even * (0.4 * (ridged(x / 2100, z / 2100, 4, 81) - 0.45) + 0.1 * fbm(x / 600, z / 600, 2, 82));
    // Côte nord-ouest : un replat côtier au pied de la chaîne (la route du Tour longe la mer).
    const shelf = toUV(x, z)[1] < -3000 ? smoothstep(700, 2100, d) : 1;
    h += fade * shelf * RELIEF.chain * c.h * prof * rough;
  }
  // Collines des Terrasses, de part et d'autre de la plaine : croupes rondes couvertes de rizières en terrasses.
  h += fade * 170 * gaussUV(x, z, -2200, 4500, 4200, 1500) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 22));
  h += fade * 150 * gaussUV(x, z, 1800, -3700, 4800, 1300) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 24));
  h += fade * 120 * gaussUV(x, z, 5400, 3300, 2200, 1300) * (0.85 + 0.3 * fbm(x / 1500, z / 1500, 2, 25));
  // Plateau des Théiers : dessus presque plat, rebord en escarpement.
  const pe = plateauE(x, z);
  h += fade * PLATEAU.h * (1 - smoothstep(0.42, 1.12, pe)) * (1 + 0.04 * fbm(x / 900, z / 900, 2, 23));
  // Massif des Lanternes : deux sommets, col de la Jungle entre les deux, arêtes.
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.7));
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += smoothstep(30, 1600, d) * (massif + even * massif * 0.1 * (ridged(x / 1600, z / 1600, 3, 31) - 0.45));
  // Selle du col de la Jungle, large et creusée : la route y arrive en pente régulière.
  h -= fade * 200 * gaussUV(x, z, 12350, -1250, 900, 1300);
  // Versants du col de la Jungle : deux larges rampes régulières (≈ 8 %) de la Bambouseraie au col et du col au port
  // des Jonques ; les lacets y montent sans bosse ni tranchée.
  // Montée des Théiers : rampe régulière de Pont-des-Lianes au plateau (≈ 7 %).
  h = ramp(h, x, z, UV(8650, 4200), UV(10850, 3600), 50, 300, 180, 380);
  // Arête du Mont des Lanternes : du col au temple du sommet, en pente régulière (route du temple en lacets) ;
  // les rampes du col passent par-dessus.
  h = ramp(h, x, z, SADDLE, P1, 350, 640, 420, 700);
  h = ramp(h, x, z, BAMB, SADDLE, 190, 350, 420, 800);
  h = ramp(h, x, z, SADDLE, JONQ_FOOT, 350, 15, 380, 700);
  // Villes du bord de mer (ports, station) : arrière-pays en pente douce sur 1,4 km (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.045), h, smoothstep(900, 1800, dt));
  }
  // Cuvette du lac des Lotus.
  h -= fade * 22 * gauss(x, z, lk.x, lk.z, lk.rx * 1.4, lk.rx * 0.9);
  // Delta : plaine basse qui descend doucement vers la mer (≈ 2 m par km).
  const dz0 = deltaZone(x, z);
  if (dz0 > 0.01) h = lerp(h, Math.min(h, 2.2 + 0.002 * d), dz0 * 0.95);
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

/** Profil imposé au Grand Fleuve : pente douce et régulière jusqu'à la fourche du delta (≈ 2,4 m par km). */
function fleuveCap(px: number, pz: number): number {
  const [u] = toUV(px, pz);
  const [uf] = toUV(DELTA_FORK[0], DELTA_FORK[1]);
  return u <= uf ? 1.6 + 0.0004 * (u - uf) : 1.6 + 0.0024 * (u - uf);
}

export function riverBeds(): RiverBed[] {
  if (beds) return beds;
  const out: RiverBed[] = [];
  for (const river of RIVERS) {
    const parent = river.from ? out.find((b) => b.river.id === river.from)! : null;
    // Bras du delta : départ recalé sur le lit de la rivière mère, au point le plus proche du premier point dessiné.
    let start = 0;
    const drawn = river.pts.slice();
    if (parent) {
      const [fx, fz] = drawn[0]!;
      for (let k = 1; k < parent.pts.length; k++) if (Math.hypot(parent.pts[k]![0] - fx, parent.pts[k]![1] - fz) < Math.hypot(parent.pts[start]![0] - fx, parent.pts[start]![1] - fz)) start = k;
      drawn[0] = parent.pts[start]!;
    }
    // Méandres : le tracé dessiné ondule (bruit le long du cours, amplitude croissante vers l'aval).
    const base = resample(chaikin(drawn, 4), 10);
    const amp = parent ? 0.6 : 1;
    const pts: Vec2[] = base.map(([x, z], i) => {
      const a = base[Math.max(0, i - 1)]!;
      const b2 = base[Math.min(base.length - 1, i + 1)]!;
      const dx = b2[0] - a[0];
      const dz = b2[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const t = i / (base.length - 1);
      const off = amp * (40 + 140 * t) * noise2(i / 45, 0.5, 71 + river.pts.length) * Math.min(1, i / 30, (base.length - 1 - i) / 30);
      return [x - (dz / l) * off, z + (dx / l) * off];
    });
    const n = pts.length;
    const raw = pts.map(([x, z]) => natural(x, z) - 2.5);
    const bed = raw.slice();
    if (river.id === 'grand-fleuve') for (let i = 0; i < n; i++) bed[i] = Math.min(bed[i]!, fleuveCap(pts[i]![0], pts[i]![1]));
    // Delta : lit à 0,8 m au moins jusqu'à la bouche (la plaine du delta ne s'abaisse jamais sous la mer).
    const inDelta = pts.map(([x, z]) => deltaZone(x, z) > 0.3 && shoreDist(x, z) > 0);
    for (let i = 0; i < n; i++) if (inDelta[i]) bed[i] = Math.max(bed[i]!, 0.8);
    if (parent) bed[0] = Math.min(bed[0]!, parent.bed[start]!);
    // Pente minimale : 1,5 m par km (0,3 m pour le long Grand Fleuve), 0,1 m par km dans le delta.
    const drop = pts.map((_, i) => (inDelta[i] ? 0.001 : river.id === 'grand-fleuve' ? 0.003 : 0.015));
    for (let i = 1; i < n; i++) bed[i] = Math.min(bed[i]!, bed[i - 1]! - drop[i]!);
    const mouth = pts.findIndex(([x, z]) => shoreDist(x, z) < 0);
    const end = mouth < 0 ? n - 1 : mouth;
    for (let i = 0; i < n; i++) {
      const t = smoothstep(Math.max(0, end - (parent || river.id === 'grand-fleuve' ? 60 : 150)), end, i);
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
    if (parent) sm[0] = Math.min(sm[0]!, parent.bed[start]!);
    for (let i = 1; i < n; i++) sm[i] = Math.min(sm[i]!, sm[i - 1]! - drop[i]! * 0.66);
    const chan = pts.map((_, i) => lerp(river.w0, river.w1, i / (n - 1)) / 2);
    const width = pts.map((_, i) => lerp(river.v0, river.v1, i / (n - 1)));
    out.push({ river, pts, bed: sm, chan, width });
  }
  beds = out;
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
          // Deux lits voisins (fourche du delta) : le plus bas l'emporte à distance égale.
          if (dd < dist[o]! - 0.5 || (dd < dist[o]! + 0.5 && b.bed[k]! < bed[o]!)) {
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
    t.level = Math.max(t.seaside || t.port ? 3.5 : 2.5, (s / c + carved(t.x, t.z)) / 2);
    flats.push({ x: t.x, z: t.z, dist: (x, z) => Math.hypot(x - t.x, z - t.z), r0: t.r * (t.seaside ? 1.0 : 0.55), r1: t.r * (t.seaside ? 1.6 : 1.4) + (t.seaside ? 0 : 260), level: t.level });
  }
  return flats;
}

/** Rivières, lacs et ports creusés dans un relief, puis pitons de la plaine dressés par-dessus. */
function carve(h0: number, x: number, z: number): number {
  const h = carveBase(h0, x, z);
  return h + plainKarst(x, z, h);
}

/** Rivières, lacs et ports creusés dans un relief. */
function carveBase(h0: number, x: number, z: number): number {
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

export { clamp, SADDLE };

/** Mise au point : étapes du relief en un point. */
export function terrainSteps(x: number, z: number) {
  const n = natural(x, z) + plainKarst(x, z);
  const c = carve(natural(x, z), x, z);
  return { natural: n, carved: c, preLake: preLake(x, z), final: terrain(x, z), flats: getFlats().map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), level: f.level, d: Math.round(f.dist(x, z)), r0: f.r0, r1: f.r1 })).filter((f) => f.d < f.r1 + 100) };
}
