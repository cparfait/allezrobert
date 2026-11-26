/**
 * Le Désert rouge — conception (voir docs/DESERT_ROUGE.md) : côte, relief, oueds, canyon, mesas et buttes, erg,
 * chott (lac salé à sec), oasis, ports, plateaux des villes et du Circuit du Chott. Repère : x vers l'est, z vers le
 * sud, mètres, origine au centre du monde. Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'desert-rouge',
  name: 'Le Désert rouge',
  /** Emprise des tuiles (m) : le plateau (≈ 35 × 23 km) et une marge de mer. */
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

// ── Côte : golfe de Corail au sud (plage), falaises rouges presque partout ailleurs (le plateau finit dans la mer),
// côte des Dunes à l'ouest (l'erg descend jusqu'à l'eau), anse de Port-Vent au nord ──

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
  { ang: 1.6, width: 0.22, amount: -0.2, cliff: 0 }, // golfe de Corail (sud), grande plage
  { ang: 1.12, width: 0.1, amount: 0.07, cliff: 0.7 }, // pointe Fauve
  { ang: 0.84, width: 0.12, amount: 0.12, cliff: 1 }, // presqu'île des Falaises Rouges (sud-est)
  { ang: 0.62, width: 0.06, amount: 0.02, cliff: 0.9 }, // falaises à l'ouest de Cap-Brique
  { ang: 0.42, width: 0.12, amount: -0.07, cliff: 0.7 }, // anse du Levant
  { ang: 0.06, width: 0.1, amount: 0.15, cliff: 1 }, // cap du Levant (est), tour de guet
  { ang: -0.62, width: 0.3, amount: 0.02, cliff: 1 }, // les Monts de Braise plongent dans la mer (nord-est)
  { ang: -1.62, width: 0.11, amount: -0.09, cliff: 0.1 }, // anse de Port-Vent (nord), port
  { ang: -2.3, width: 0.2, amount: 0.09, cliff: 0.9 }, // cap du Nord-Ouest
  { ang: -2.75, width: 0.12, amount: -0.05, cliff: 0.6 }, // baie des Phoques moines
  { ang: 2.95, width: 0.18, amount: -0.08, cliff: 0 }, // côte des Dunes (ouest)
  { ang: 2.35, width: 0.12, amount: 0.1, cliff: 0.2 }, // pointe des Sables (sud-ouest)
  { ang: 2.62, width: 0.16, amount: 0, cliff: 0 }, // plage de la Lagune des Flamants
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

/** Distance au rivage (m, comptée le long du rayon) : > 0 sur la terre, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  return coastRadius(Math.atan2(z, x)) - Math.hypot(x, z);
}

/** Compatibilité : distance normalisée à la côte (> 0 sur la terre). */
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
 * Monts de Braise (nord) : arête d'ouest en est, hauteur (m, au-dessus du relief) le long de l'arête, largeur des
 * versants (m). Le massif du Vautour la coiffe (deux sommets, col des Vents entre les deux, ≈ 900 m).
 */
export const CHAIN = {
  pts: [[-14500, -5200], [-10500, -7400], [-6500, -7300], [-2500, -7000], [1800, -6900], [5500, -5900], [9500, -4400], [13500, -3200]] as Vec2[],
  h: [330, 640, 900, 840, 760, 820, 660, 420],
  width: 3300,
};

/** Massif du Vautour : Pic du Vautour (observatoire au sommet) et Dent Rouge, col des Vents entre les deux. */
const P1: Vec2 = [1600, -6900];
const P2: Vec2 = [4700, -6000];
export const MASSIF = { phare: P1, mont: P2, h1: 700, h2: 790, spread: 2500 };

/** Chott Blanc : lac salé à sec, cuvette plate et blanche au pied des Monts de Braise ; le Circuit du Chott y est posé. */
export const CHOTT = { id: 'chott-blanc', name: 'Le Chott Blanc', x: -5600, z: -2500, rx: 2100, rz: 820, rot: 0.12, level: NaN };

/** Circuit du Chott (boucle plate sur le sel, départ devant les tribunes). */
export const ANNEAU = { cx: CHOTT.x, cz: CHOTT.z, half: 560, radius: 215, level: 0, widthM: 8 };

/** Plateau des Canyons (est) : dessus presque plat, rebord en escarpement, entaillé par le canyon de l'Oued Rouge. */
export const PLATEAU = { x: 9800, z: 0, rx: 4600, rz: 3600, h: 340 };

/**
 * Mesas et buttes : sommet plat (niveau du relief au centre + `h`), parois verticales (`wall` m), éboulis au pied
 * (`apron` m). La Grande Mesa garde une rampe (côté `ramp.ang`, longue de `ramp.len` m) : la route y monte en lacets.
 */
export interface Mesa {
  id: string;
  name?: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  h: number;
  wall: number;
  apron: number;
  ramp?: { ang: number; len: number; half: number };
  /** Niveau du sommet (m), calculé au premier appel. */
  top: number;
}

const mesa = (id: string, name: string | undefined, x: number, z: number, rx: number, rz: number, rot: number, h: number, extra: Partial<Mesa> = {}): Mesa => ({ id, ...(name ? { name } : {}), x, z, rx, rz, rot, h, wall: Math.max(18, Math.min(60, Math.min(rx, rz) * 0.08)), apron: Math.min(260, h * 1.4), top: NaN, ...extra });

export const MESAS: Mesa[] = [
  mesa('grande-mesa', 'La Grande Mesa', -10200, -3300, 1500, 1100, 0.3, 300, { ramp: { ang: 0.85, len: 2200, half: 0.5 } }),
  mesa('mesa-du-lion', 'La Mesa du Lion', 1300, 2700, 650, 470, -0.4, 120),
  mesa('mesa-du-levant', 'La Mesa du Levant', 14000, 3600, 720, 500, 0.7, 140),
  mesa('table-des-vents', 'La Table des Vents', 7400, 6200, 420, 300, 0.2, 95),
  // Buttes Rouges (bike park et sentier des Arches) : petites tours à sommet plat entre Rocherouge et les monts.
  ...([[-1700, -3300, 110, 60], [-1200, -3550, 80, 45], [-600, -3200, 150, 75], [-80, -3450, 90, 50], [-1500, -2600, 130, 65], [-850, -2250, 70, 40], [-200, -2700, 120, 55], [320, -2250, 95, 50], [-1950, -2050, 85, 45], [250, -3100, 75, 40]] as const).map(([x, z, r, h], i) =>
    mesa(`butte-${i}`, i === 2 ? 'Les Buttes Rouges' : undefined, x, z, r, r * 0.8, i * 0.7, h, { wall: 14, apron: 70 })),
  // Témoins isolés le long de la Piste Droite (vus de loin).
  mesa('temoin-1', undefined, -7400, -300, 170, 130, 0.5, 70, { wall: 14, apron: 90 }),
  mesa('temoin-2', undefined, -9200, 2300, 210, 150, 1.1, 80, { wall: 16, apron: 100 }),
  mesa('temoin-3', undefined, -5800, 2350, 140, 120, 0.2, 60, { wall: 14, apron: 80 }),
];

/** Grand Erg (ouest) : dunes en cordons (amplitude, longueur d'onde, direction des crêtes). */
export const ERG = { x: -10000, z: 4300, sx: 4300, sz: 2700, amp: 20, wave: 430, ang: 0.45 };

/** La Piste Droite : 7 km en ligne droite et à plat, de Rocherouge vers Sablons (couloir aplani). */
/** Cyclo-cross des Sables : au bord de l'erg (dunes adoucies autour). */
export const CROSS: Vec2 = [-6300, 2900];

/** Bike park des Buttes : entre les Buttes Rouges (voir MESAS). */
export const BIKEPARK: Vec2 = [-1100, -2950];

export const PISTE = { a: [-4000, 1150] as Vec2, b: [-11300, 950] as Vec2, half: 260, blend: 700 };

export interface Town {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Rayon bâti (m) et direction de la rue principale (rad). */
  r: number;
  angle: number;
  size: 'ville' | 'bourg' | 'village' | 'hameau';
  /** Petite ville du bord de mer (front de mer, promenade, villas). */
  seaside?: boolean;
  port?: boolean;
  level: number;
}

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: p[0], z: p[1], r, angle, size, level: 0, ...extra });

const grande = MESAS[0]!;
export const TOWNS: Town[] = [
  town('rocherouge', 'Rocherouge', [-2600, 1200], 620, 0.15, 'bourg'),
  town('port-corail', 'Port-Corail', coastPoint(1.62, 520), 950, 0, 'ville', { seaside: true }),
  town('cap-brique', 'Cap-Brique', coastPoint(0.74, 420), 400, 0.5, 'village', { port: true }),
  town('port-vent', 'Port-Vent', coastPoint(-1.62, 420), 420, 0.1, 'village', { port: true }),
  town('sablons', 'Sablons', [-12300, 900], 480, 1.3, 'village'),
  town('les-salines', 'Les Salines', coastPoint(2.8, 950), 320, 0.4, 'hameau'),
  town('puits-sale', 'Puits-Salé', [-5600, -800], 380, 0.12, 'village'),
  town('mesa-haute', 'Mesa-Haute', [grande.x - 120, grande.z - 80], 300, 0.6, 'village'),
  town('les-cairns', 'Les Cairns', [2700, -2700], 280, 0.9, 'hameau'),
  town('l-oasis', "L'Oasis", [3800, 5600], 360, 0.25, 'village'),
  town('ksar-rouge', 'Ksar-Rouge', [11800, -600], 400, 1.2, 'village'),
  town('le-gue', 'Le Gué', [7600, 3700], 300, 1.4, 'hameau'),
];

// ── Oueds (tracés dessinés, lit creusé dans le relief) ──

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
  /** Canyon : fond plat sur `floor` m de part et d'autre du lit, puis parois presque verticales. */
  floor?: number;
  /** Lit abaissé (fraction du cours, altitude plafond) : le canyon garde le niveau du bas pays sous le plateau. */
  drop?: Array<[number, number]>;
}

const portCorail = TOWNS.find((t) => t.id === 'port-corail')!;
const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port);
const gue = TOWNS.find((t) => t.id === 'le-gue')!;
export const RIVERS: River[] = [
  {
    id: 'oued-des-sables',
    name: 'Oued des Sables',
    pts: [[-11800, -7300], [-12700, -4900], [-13500, -2500], [-14300, -400], [-15100, 2000], coastPoint(2.92, -150)],
    w0: 2,
    w1: 8,
    v0: 180,
    v1: 420,
  },
  {
    // Canyon : l'oued garde le niveau de la plaine en traversant le Plateau des Canyons (parois de plus de 300 m).
    id: 'oued-rouge',
    name: 'Oued Rouge',
    pts: [[5500, -4500], [6300, -2500], [6900, -300], [7500, 1700], [gue.x - 250, gue.z + 300], [7900, 5800], coastPoint(0.98, -150)],
    w0: 3,
    w1: 10,
    v0: 210,
    v1: 260,
    floor: 48,
    drop: [[0, 1200], [0.14, 250], [0.56, 14], [1, 0]],
  },
  {
    // Vallée de Port-Vent : descente nord du col des Vents jusqu'au port.
    id: 'oued-du-vent',
    name: 'Oued du Vent',
    pts: [[2800, -7200], [2400, -8000], [1900, -8900], [1450, -9650], coastPoint(-1.56, -150)],
    w0: 2,
    w1: 7,
    v0: 260,
    v1: 460,
  },
  {
    id: 'oued-corail',
    name: 'Oued Corail',
    pts: [[-200, -1500], [-800, 300], [-900, 4300], [portCorail.x + 1150, portCorail.z - 1000], coastPoint(1.5, -150)],
    w0: 2,
    w1: 6,
    v0: 100,
    v1: 260,
  },
];

// ── Lacs, oasis et lagune (le Chott Blanc est à sec : voir CHOTT) ──

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
const oasis = TOWNS.find((t) => t.id === 'l-oasis')!;
export const LAKES: Lake[] = [
  { id: 'lagune', name: 'Lagune des Flamants', kind: 'lake', x: lagoonC[0], z: lagoonC[1], rx: 1300, rz: 480, rot: 2.62 + Math.PI / 2, level: 0.35, depth: 1.4 },
  { id: 'guelta-du-vautour', name: 'Guelta du Vautour', kind: 'lake', x: (P1[0] + P2[0]) / 2 + 600, z: (P1[1] + P2[1]) / 2 + 1000, rx: 240, rz: 160, rot: 0.5, level: NaN, depth: 6 },
  { id: 'source-de-l-oasis', name: "Source de l'Oasis", kind: 'pond', x: oasis.x + 420, z: oasis.z + 430, rx: 150, rz: 95, rot: 0.4, level: NaN, depth: 3 },
  { id: 'puits-des-dunes', name: 'Oasis des Dunes', kind: 'pond', x: -9900, z: 4700, rx: 120, rz: 80, rot: 0.8, level: NaN, depth: 2.5 },
];

/** Oasis : sources entourées de palmeraies (land.ts, décor du client). */
export const OASES = LAKES.filter((l) => l.kind === 'pond');

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

export const HARBOURS: Harbour[] = [harbourAt('port-corail', 'Port de Port-Corail', 1.53, 230, 95), harbourAt('port-cap-brique', 'Port de Cap-Brique', 0.74, 140, 60), harbourAt('port-vent', 'Port de Port-Vent', -1.62, 150, 70)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Vallonnement (mètres d'amplitude), réglable pour un essai : ISLAND_RELIEF='{"hills":30,…}'. */
const RELIEF = { wave: 30, hills: 40, knolls: 50, chain: 1, dunes: 1, ...(JSON.parse(process.env.ISLAND_RELIEF ?? '{}') as Record<string, number>) };

/** Distance (m) à l'arête des Monts de Braise et hauteur de l'arête au point le plus proche. */
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

/** Distance normalisée au centre d'une ellipse tournée (1 = bord). */
function ellE(cx: number, cz: number, rx: number, rz: number, rot: number, x: number, z: number): number {
  const dx = x - cx;
  const dz = z - cz;
  const u = dx * Math.cos(rot) + dz * Math.sin(rot);
  const w = -dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.hypot(u / rx, w / rz);
}

/** Distance normalisée au Chott Blanc (1 = bord du sel). */
export function chottE(x: number, z: number): number {
  return ellE(CHOTT.x, CHOTT.z, CHOTT.rx, CHOTT.rz, CHOTT.rot, x, z);
}

/** Masque du Grand Erg (0 … 1). */
export function ergMask(x: number, z: number): number {
  return smoothstep(0.08, 0.5, gauss(x, z, ERG.x, ERG.z, ERG.sx, ERG.sz));
}

/** Distance (m) à l'axe de la Piste Droite et position le long (0 … 1). */
export function pisteAt(x: number, z: number): { d: number; s: number } {
  const [ax, az] = PISTE.a;
  const [bx, bz] = PISTE.b;
  const dx = bx - ax;
  const dz = bz - az;
  const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(x - ax - dx * s, z - az - dz * s), s };
}

/** Distance normalisée d'une mesa, bord dentelé (1 = pied de la paroi). */
export function mesaE(m: Mesa, x: number, z: number): number {
  const e = ellE(m.x, m.z, m.rx, m.rz, m.rot, x, z);
  return e * (1 + 0.07 * fbm(x / 260, z / 260, 2, 91 + m.x * 0.001));
}

/** Part du relief de la mesa (0 : plaine, 1 : sommet), rampe comprise. */
export function mesaShare(m: Mesa, x: number, z: number): number {
  const rm = Math.sqrt(m.rx * m.rz);
  const e = mesaE(m, x, z);
  const w = m.wall / rm;
  const a = m.apron / rm;
  if (e > 1 + a + 0.05 && !m.ramp) return 0;
  let f = 0.84 * (1 - smoothstep(1 - w, 1, e)) + 0.16 * (1 - smoothstep(1 - w, 1 + a, e));
  if (m.ramp) {
    const ang = Math.atan2(z - m.z, x - m.x);
    const s = 1 - smoothstep(m.ramp.half * 0.65, m.ramp.half, Math.abs(angDiff(ang, m.ramp.ang)));
    if (s > 0) {
      const t = clamp(1 - ((e - 1 + w) * rm) / m.ramp.len, 0, 1);
      f = Math.max(f, s * smoothstep(0, 1, t) * 0.5 + s * t * 0.5);
    }
  }
  return f;
}

/** Relief de base : côte, campagne, Monts de Braise, plateau, massif, collines (sans mesas, dunes ni couloirs). */
function base(x: number, z: number): number {
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
  // Lieux qui doivent rester faciles : plaine de Rocherouge, chott, lagune, erg, dessus du plateau.
  const calm = 1 - 0.8 * Math.max(gauss(x, z, CHOTT.x, CHOTT.z, 3300, 2000), gauss(x, z, -2600, 1500, 3200, 2000), gauss(x, z, lagoonC[0], lagoonC[1], 3200, 2400), gauss(x, z, ERG.x, ERG.z, ERG.sx, ERG.sz), gauss(x, z, PLATEAU.x, PLATEAU.z, 3000, 2200));
  h += inland * (RELIEF.wave * (fbm(x / 7000, z / 7000, 3, 11) + 0.35) + (9 + (RELIEF.hills - 9) * calm) * fbm(x / 1500, z / 1500, 2, 12) + 2.5 * fbm(x / 350, z / 350, 2, 13));
  h += inland * calm * RELIEF.knolls * Math.max(0, fbm(x / 2300 + 7, z / 2300 - 3, 2, 14) + 0.08) * 1.6;
  const fade = smoothstep(120, 1200, d);
  // Monts de Braise : versants raides, crêtes et ravins (bruit en crêtes), plus doux vers la plaine.
  const c = chainAt(x, z);
  // Versants des routes de montagne (col des Vents des deux côtés) : réguliers, sans bosses à franchir.
  const even = 1 - 0.85 * Math.max(gauss(x, z, 2800, -4600, 1700, 2400), gauss(x, z, 2400, -8300, 1800, 2200));
  if (c.d < CHAIN.width * 3) {
    const prof = Math.exp(-((c.d / CHAIN.width) ** 1.6)) * (1 - smoothstep(CHAIN.width * 2, CHAIN.width * 3, c.d));
    const rough = 0.74 + even * (0.44 * (ridged(x / 2100, z / 2100, 4, 81) - 0.45) + 0.1 * fbm(x / 600, z / 600, 2, 82));
    h += fade * RELIEF.chain * c.h * prof * rough;
  }
  // Collines Fauves (sud, autour de L'Oasis) : croupes douces et rocailleuses.
  h += fade * 120 * gauss(x, z, 3600, 5700, 3600, 1500) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 22));
  // Plateau des Canyons : dessus presque plat, rebord en escarpement.
  const pe = Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz);
  h += fade * PLATEAU.h * (1 - smoothstep(0.62, 1.02, pe)) * (1 + 0.04 * fbm(x / 900, z / 900, 2, 23));
  // Massif du Vautour : deux sommets, col entre les deux, arêtes.
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.7));
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += smoothstep(30, 1600, d) * (massif + even * massif * 0.1 * (ridged(x / 1600, z / 1600, 3, 31) - 0.45));
  // Socle du massif du Vautour : tout le col est relevé d'un bloc (col des Vents à ≈ 900 m).
  h += fade * 100 * gauss(x, z, 2900, -6200, 5000, 4000);
  // Selle du col des Vents, large et creusée : la route y arrive en pente régulière.
  h -= fade * 170 * gauss(x, z, 2950, -6450, 800, 1700);
  h -= fade * 190 * gauss(x, z, 2820, -7150, 750, 800);
  // Passage du col des Vents : couloir nord-sud dessiné (col à ≈ 895 m, versants réguliers de 7,5 % et 9 %), le relief
  // y est relevé ou entaillé ; les deux sommets restent entiers de part et d'autre.
  {
    const dx = x - 2920;
    const w = Math.exp(-((dx / 900) ** 2)) * smoothstep(-8300, -7700, z) * (1 - smoothstep(-4700, -4100, z));
    if (w > 0.001) {
      const P = z > -6500 ? 895 - 0.075 * (z + 6500) : 895 - 0.09 * (-6500 - z);
      h = lerp(h, P + 0.28 * Math.abs(dx), w);
    }
  }
  // Vallée de Port-Vent : du col jusqu'au port, fond en pente régulière, versants raides de part et d'autre.
  {
    const [ax, az] = [2750, -7250];
    const [bx, bz] = [1450, -9650];
    const dx = bx - ax;
    const dz = bz - az;
    const t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    if (t > 0 && t < 1.1) {
      const dist = Math.hypot(x - ax - dx * Math.min(1, t), z - az - dz * Math.min(1, t));
      if (dist < 950) {
        const floor = lerp(860, 230, Math.min(1, t)) + dist * 0.1;
        h = lerp(h, lerp(Math.min(h, floor), h, smoothstep(550, 950, dist)), smoothstep(0, 0.18, t));
      }
    }
  }
  return h;
}

/** Relief naturel sans les oueds, lacs, ports ni plateaux aplanis. */
function natural(x: number, z: number): number {
  const d = shoreDist(x, z);
  const fade = smoothstep(120, 1200, d);
  let h = base(x, z);
  if (d < 0) return h;
  // Mesas et buttes : sommet plat, parois verticales, éboulis.
  for (const m of MESAS) {
    const R = Math.max(m.rx, m.rz) * 1.25 + m.apron + (m.ramp?.len ?? 0);
    if (Math.abs(x - m.x) > R || Math.abs(z - m.z) > R) continue;
    const f = mesaShare(m, x, z);
    if (f <= 0) continue;
    if (Number.isNaN(m.top)) m.top = base(m.x, m.z) + m.h;
    const top = m.top + 1.2 * fbm(x / 400, z / 400, 2, 92);
    if (top > h) h += (top - h) * f * fade;
  }
  // Grand Erg : cordons de dunes de sable rouge, crêtes vers le nord-est.
  const em = ergMask(x, z) * smoothstep(80, 600, d) * (1 - 0.7 * gauss(x, z, CROSS[0], CROSS[1], 450, 450));
  if (em > 0.001) {
    const u = x * Math.cos(ERG.ang) + z * Math.sin(ERG.ang);
    const phase = (2 * Math.PI * u) / ERG.wave + 2.4 * fbm(x / 1700, z / 1700, 2, 95);
    const ridge = (0.5 + 0.5 * Math.sin(phase)) ** 1.7;
    const swell = 0.6 + 0.5 * fbm(x / 1100, z / 1100, 2, 96);
    h += em * RELIEF.dunes * (ERG.amp * ridge * swell + 3 * fbm(x / 120, z / 120, 2, 97));
  }
  // Villes du bord de mer (ports, petite ville) : arrière-pays en pente douce sur 1,4 km (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.045), h, smoothstep(900, 1800, dt));
  }
  // Cuvette du chott, plaine basse de la lagune.
  h -= fade * 30 * gauss(x, z, CHOTT.x, CHOTT.z, CHOTT.rx * 1.5, CHOTT.rz * 2.2);
  h -= fade * 14 * gauss(x, z, lagoonC[0], lagoonC[1], 2600, 1800);
  // La Piste Droite : couloir aplani, niveau en pente régulière d'un bout à l'autre.
  const p = pisteAt(x, z);
  if (p.d < PISTE.half + PISTE.blend) {
    const L = lerp(pisteLevel(0), pisteLevel(1), p.s);
    h = lerp(h, L, 1 - smoothstep(PISTE.half, PISTE.half + PISTE.blend, p.d));
  }
  return h;
}

const pisteLv: number[] = [];
/** Niveau de la Piste Droite à un bout (moyenne du relief de base autour). */
function pisteLevel(end: 0 | 1): number {
  if (pisteLv[end] === undefined) {
    const [cx, cz] = end ? PISTE.b : PISTE.a;
    let s = 0;
    for (let k = 0; k < 16; k++) s += base(cx + Math.cos(k * 0.39) * 300, cz + Math.sin(k * 0.39) * 300);
    pisteLv[end] = Math.round((s / 16) * 2) / 2;
  }
  return pisteLv[end]!;
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
  floor: Float32Array;
}
let valley: Valley | null = null;

/** Lit des rivières : points tous les 10 m, altitude du lit (toujours descendante), largeurs. */
export interface RiverBed {
  river: River;
  pts: Vec2[];
  bed: number[];
  chan: number[];
  width: number[];
  floor: number[];
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
    if (river.drop) {
      const D = river.drop;
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        let k = 0;
        while (k + 2 < D.length && D[k + 1]![0] < t) k++;
        const [t0, y0] = D[k]!;
        const [t1, y1] = D[k + 1]!;
        bed[i] = Math.min(bed[i]!, lerp(y0, y1, clamp((t - t0) / (t1 - t0), 0, 1)));
      }
    }
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
    const floor = chan.map((c) => Math.max(c + 2, river.floor ?? 0));
    return { river, pts, bed: sm, chan, width, floor };
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
  const floor = new Float32Array(n * m);
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
            floor[o] = b.floor[k]!;
          }
        }
    }
  }
  valley = { n, m, cell, x0, z0, dist, bed, chan, width, floor };
  return valley;
}

function valleyAt(x: number, z: number): { dist: number; bed: number; chan: number; width: number; floor: number } | null {
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
    return { dist: d0, bed: v.bed[o]!, chan: v.chan[o]!, width: v.width[o]!, floor: v.floor[o]! };
  }
  return { dist, bed: lerp4(v.bed), chan: lerp4(v.chan), width: lerp4(v.width), floor: lerp4(v.floor) };
}

/** Plateaux aplanis : Chott Blanc (et son Circuit) et villes (niveau pris au relief naturel du centre). */
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

function getFlats(): Flat[] {
  if (flats) return flats;
  const carved = (x: number, z: number) => carve(natural(x, z), x, z);
  // Chott Blanc : cuvette plate un peu sous le point le plus bas de son pourtour ; le Circuit y est posé.
  let lo = Infinity;
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const ex = Math.cos(a) * CHOTT.rx * 1.15;
    const ez = Math.sin(a) * CHOTT.rz * 1.15;
    lo = Math.min(lo, carved(CHOTT.x + ex * Math.cos(CHOTT.rot) - ez * Math.sin(CHOTT.rot), CHOTT.z + ex * Math.sin(CHOTT.rot) + ez * Math.cos(CHOTT.rot)));
  }
  CHOTT.level = Math.max(4, Math.round((lo - 1.5) * 2) / 2);
  ANNEAU.level = CHOTT.level;
  flats = [{ x: CHOTT.x, z: CHOTT.z, dist: (x, z) => chottE(x, z) * 1000, r0: 1000, r1: 1500, level: CHOTT.level }];
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
    // Canyon : fond plat jusqu'à `floor`, parois presque verticales ensuite (corniche franche en haut).
    const t = v.floor > v.chan + 2.5 ? smoothstep(v.floor, v.width, v.dist) ** 0.8 : smoothstep(v.chan + 2, v.width, v.dist);
    if (h > v.bed) h = v.bed + (h - v.bed) * t;
    if (v.floor > v.chan + 2.5 && v.dist < v.floor) h = Math.min(h, v.bed + 0.6 + 0.02 * v.dist);
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

// ── Le Circuit du Chott ──

/** Points du circuit (sens horaire vu du ciel), espacés d'environ `step` mètres, boucle fermée. */
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
