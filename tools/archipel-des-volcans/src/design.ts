/**
 * L'Archipel des volcans — conception (voir docs/ARCHIPEL_DES_VOLCANS.md) : trois îles (la Grande Île et son volcan,
 * l'Île des Orgues, l'Île de Sable-Noir), un pont et une chaussée sur la mer, relief, cratère, coulées de lave,
 * rivières, lacs, ports, plateaux des villes et du Circuit. Repère : x vers l'est, z vers le sud, mètres, origine au
 * centre de la Grande Île. Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'archipel-des-volcans',
  name: "L'Archipel des volcans",
  /** Emprise des tuiles (m) : l'archipel (≈ 35 × 22 km) et une marge de mer. */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
};

// ── Côtes : une forme par île (super-ellipse déformée), caps, anses et falaises selon la direction ──

interface CoastFeature {
  /** Direction (rad, atan2(z, x) depuis le centre de l'île) et demi-largeur angulaire. */
  ang: number;
  width: number;
  /** > 0 : cap (le rivage avance), < 0 : baie. */
  amount: number;
  /** Falaises (0 plage … 1 falaise franche). */
  cliff: number;
}

export interface Isle {
  id: string;
  name: string;
  cx: number;
  cz: number;
  /** Demi-axes (m) et exposant de la super-ellipse. */
  A: number;
  B: number;
  pow: number;
  /** Ampleur du bruit du rivage. */
  wiggle: number;
  seed: number;
  features: CoastFeature[];
  radius?: Float64Array;
  cliff?: Float64Array;
}

/**
 * La Grande Île (volcan au nord du centre), l'Île des Orgues (plateau de basalte en falaises, à l'est, reliée par le
 * Pont des Orgues) et l'Île de Sable-Noir (basse, plages noires, au sud-est, reliée par la Chaussée).
 */
export const ISLES: Isle[] = [
  {
    id: 'grande-ile',
    name: 'La Grande Île',
    cx: 0,
    cz: 0,
    A: 12300,
    B: 9800,
    pow: 2.1,
    wiggle: 1,
    seed: 1,
    features: [
      { ang: 1.62, width: 0.2, amount: -0.12, cliff: 0 }, // baie des Cendres (sud) : Sainte-Iris, plage de sable noir
      { ang: 2.15, width: 0.12, amount: 0.1, cliff: 0.65 }, // pointe de la Coulée (sud-ouest) : la lave a fait le cap
      { ang: 2.62, width: 0.08, amount: -0.05, cliff: 0.2 }, // anse de Port-Lave
      { ang: 3.0, width: 0.12, amount: 0.09, cliff: 0.75 }, // cap de la Grande Coulée (ouest)
      { ang: -2.55, width: 0.15, amount: -0.04, cliff: 0.3 }, // côte des Vignes (nord-ouest)
      { ang: -1.75, width: 0.14, amount: 0.07, cliff: 0.9 }, // coulée du Nord : falaises de lave
      { ang: -1.05, width: 0.18, amount: 0.03, cliff: 1 }, // falaises basaltiques (orgues) du nord-est
      { ang: -0.62, width: 0.07, amount: -0.05, cliff: 0.3 }, // crique de la Ravine
      { ang: -0.3, width: 0.08, amount: 0.06, cliff: 0 }, // pointe du Pont (est) : culée du Pont des Orgues
      { ang: 0.28, width: 0.12, amount: -0.05, cliff: 0.4 }, // anse de Rocheverte
      { ang: 0.6, width: 0.07, amount: 0.07, cliff: 0 }, // pointe de la Chaussée (sud-est)
      { ang: 1.05, width: 0.1, amount: -0.03, cliff: 0.8 }, // falaises des Terrasses
    ],
  },
  {
    id: 'ile-des-orgues',
    name: "L'Île des Orgues",
    cx: 15800,
    cz: -4300,
    A: 2550,
    B: 3300,
    pow: 2.3,
    wiggle: 0.8,
    seed: 2,
    features: [
      { ang: Math.PI, width: 0.32, amount: -0.04, cliff: 0.05 }, // anse des Orgues (ouest) : village, port, culée du pont
      { ang: -1.6, width: 0.4, amount: 0.06, cliff: 1 }, // falaises du nord
      { ang: 0, width: 0.5, amount: 0.08, cliff: 1 }, // cap du Phare (est)
      { ang: 1.4, width: 0.45, amount: 0.02, cliff: 1 }, // orgues du sud
    ],
  },
  {
    id: 'ile-de-sable-noir',
    name: "L'Île de Sable-Noir",
    cx: 13900,
    cz: 8600,
    A: 3300,
    B: 2300,
    pow: 2,
    wiggle: 0.9,
    seed: 3,
    features: [
      { ang: -2.6, width: 0.3, amount: -0.03, cliff: 0 }, // plage de la Chaussée (nord-ouest)
      { ang: 1.4, width: 0.35, amount: -0.1, cliff: 0 }, // grande plage de sable noir (sud)
      { ang: 0.1, width: 0.25, amount: 0.12, cliff: 0.7 }, // pointe du Mont Cendre (est)
    ],
  },
];

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

// Le rivage d'une île ne dépend que de la direction : tables de 8 192 directions, interpolées.
const NA = 8192;
function tables(I: Isle): void {
  I.radius = new Float64Array(NA + 1);
  I.cliff = new Float64Array(NA + 1);
  for (let k = 0; k <= NA; k++) {
    const a = -Math.PI + (k / NA) * 2 * Math.PI;
    I.radius[k] = coastRadiusExact(I, a);
    I.cliff[k] = cliffinessExact(I, a);
  }
}
function tab(t: Float64Array, ang: number): number {
  const f = ((ang + Math.PI) / (2 * Math.PI)) * NA;
  const k = Math.max(0, Math.min(NA - 1, Math.floor(f)));
  const u = f - k;
  return t[k]! * (1 - u) + t[k + 1]! * u;
}

/** Rayon du rivage (m) de l'île `isle` dans la direction `ang` (depuis son centre). */
export function coastRadius(ang: number, isle = 0): number {
  const I = ISLES[isle]!;
  if (!I.radius) tables(I);
  return tab(I.radius!, ang);
}

/** Falaises (0 … 1) de l'île `isle` dans la direction `ang`. */
export function cliffiness(ang: number, isle = 0): number {
  const I = ISLES[isle]!;
  if (!I.cliff) tables(I);
  return tab(I.cliff!, ang);
}

function coastRadiusExact(I: Isle, ang: number): number {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const base = 1 / ((Math.abs(c) / I.A) ** I.pow + (Math.abs(s) / I.B) ** I.pow) ** (1 / I.pow);
  const k = I.seed * 10;
  let w = 1 + I.wiggle * (0.06 * fbm(c * 1.6 + 5 + k, s * 1.6 + 5, 3, 1) + 0.03 * fbm(c * 7 + 1, s * 7 - 3 + k, 3, 2) + 0.009 * noise2(c * 30 + k, s * 30, 3));
  for (const f of I.features) w += f.amount * Math.exp(-((angDiff(ang, f.ang) / f.width) ** 2));
  return base * w;
}

function cliffinessExact(I: Isle, ang: number): number {
  let c = 0;
  for (const f of I.features) c = Math.max(c, f.cliff * Math.exp(-((angDiff(ang, f.ang) / (f.width * 0.8)) ** 2)));
  return smoothstep(0.25, 0.75, c);
}

/** Distance au rivage d'une île (m, comptée le long de son rayon) : > 0 sur l'île. */
export function isleDist(isle: number, x: number, z: number): number {
  const I = ISLES[isle]!;
  return coastRadius(Math.atan2(z - I.cz, x - I.cx), isle) - Math.hypot(x - I.cx, z - I.cz);
}

/** Île la plus proche (celle dont on est le plus à l'intérieur) et distance à son rivage. */
export function isleAt(x: number, z: number): { isle: number; d: number } {
  let best = 0;
  let bd = -Infinity;
  for (let i = 0; i < ISLES.length; i++) {
    const I = ISLES[i]!;
    // Loin d'une petite île : sa distance n'a aucune chance d'être la meilleure.
    if (i && Math.abs(x - I.cx) > I.A * 2.6 + 6000 && Math.abs(z - I.cz) > I.B * 2.6 + 6000) continue;
    const d = isleDist(i, x, z);
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  return { isle: best, d: bd };
}

/** Distance au rivage le plus proche (m) : > 0 sur une île, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  return isleAt(x, z).d;
}

/** Falaises (0 … 1) du rivage le plus proche. */
export function cliffAt(x: number, z: number): number {
  const { isle } = isleAt(x, z);
  const I = ISLES[isle]!;
  return cliffiness(Math.atan2(z - I.cz, x - I.cx), isle);
}

/** Compatibilité : distance normalisée à la côte (> 0 sur une île). */
export function coast(x: number, z: number): number {
  return shoreDist(x, z) / 11000;
}

/** Point à `inset` m à l'intérieur des terres dans la direction `ang` (depuis le centre de l'île `isle`). */
export function coastPoint(ang: number, inset: number, isle = 0): Vec2 {
  const I = ISLES[isle]!;
  const r = coastRadius(ang, isle) - inset;
  return [I.cx + Math.cos(ang) * r, I.cz + Math.sin(ang) * r];
}

/** Direction (depuis le centre de l'île `isle`) du point (x, z). */
export function isleAngle(isle: number, x: number, z: number): number {
  const I = ISLES[isle]!;
  return Math.atan2(z - I.cz, x - I.cx);
}

// ── Le volcan ──

/**
 * Le volcan de la Grande Île : cône d'≈ 1 400 m (profil exp(−(r/S)^1,5)), cratère de 520 m de rayon avec son lac,
 * brèche au sud-est du rebord où arrive la route du Cratère.
 */
export const VOLCANO = { x: -1500, z: -2600, H: 1460, S: 3900, rim: 520, floor: 175, notch: 1.0 };

/** Coulées de lave figées (du haut du cône jusqu'à la mer) : roche noire, bourrelet de quelques mètres. */
export const LAVA_FLOWS: Array<{ name: string; pts: Vec2[]; w: number }> = [
  { name: 'La Grande Coulée', pts: [[-2300, -2200], [-5200, -1300], [-8200, -500], [-10800, 300], [-12600, 700]], w: 420 },
  { name: 'La Coulée du Sud', pts: [[-2000, -1900], [-3900, 1400], [-6000, 3900], [-7700, 5800], [-8600, 7200]], w: 340 },
  { name: 'La Coulée du Nord', pts: [[-1500, -3200], [-1900, -5600], [-2300, -7600], [-2600, -9900]], w: 380 },
  { name: 'La Coulée de 1904', pts: [[-900, -3000], [1800, -4400], [3600, -5500]], w: 230 },
];

/** Distance (m) à la coulée la plus proche et position le long (0 en haut, 1 en bas). */
export function lavaAt(x: number, z: number): { d: number; t: number; w: number; name: string } {
  let best = { d: Infinity, t: 0, w: 0, name: '' };
  for (const f of LAVA_FLOWS) {
    let acc = 0;
    let total = 0;
    for (let k = 0; k + 1 < f.pts.length; k++) total += Math.hypot(f.pts[k + 1]![0] - f.pts[k]![0], f.pts[k + 1]![1] - f.pts[k]![1]);
    for (let k = 0; k + 1 < f.pts.length; k++) {
      const [ax, az] = f.pts[k]!;
      const [bx, bz] = f.pts[k + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz;
      const L = Math.sqrt(L2);
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      // Bords de la coulée irréguliers (lobes).
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t) * (1 + 0.35 * noise2(x / 380, z / 380, 91));
      if (d < best.d) best = { d, t: (acc + L * t) / total, w: f.w * (0.8 + 0.4 * (acc + L * t) / total), name: f.name };
      acc += L;
    }
  }
  return best;
}

/** Altitude du volcan (cône et cratère) au point, sans le reste du relief. */
export function volcanoHeight(x: number, z: number): number {
  const V = VOLCANO;
  const r = Math.hypot(x - V.x, z - V.z);
  const cone = (q: number) => V.H * Math.exp(-((q / V.S) ** 1.5));
  if (r > V.rim * 1.6) return cone(r);
  const rimH = cone(V.rim);
  const a = Math.atan2(z - V.z, x - V.x);
  // Bourrelet du rebord, abaissé à la brèche (route du Cratère).
  const notch = Math.exp(-((angDiff(a, V.notch) / 0.6) ** 2));
  const crest = (32 + 10 * noise2(a * 3, 0.5, 92)) * (1 - 0.85 * notch);
  if (r >= V.rim) return cone(r) + crest * Math.exp(-(((r - V.rim) / 70) ** 2));
  // Cratère : paroi raide, fond plat (le lac), à `floor` m sous le rebord.
  const u = r / V.rim;
  return rimH + crest * Math.exp(-(((r - V.rim) / 60) ** 2)) - V.floor * (1 - smoothstep(0.55, 1, u));
}

/** Point du rebord à la brèche (arrivée de la route), un peu à l'extérieur. */
export function rimPoint(out = 30): Vec2 {
  const V = VOLCANO;
  return [V.x + Math.cos(V.notch) * (V.rim + out), V.z + Math.sin(V.notch) * (V.rim + out)];
}

// ── Lieux ──

/** Circuit des Laves (boucle plate, départ devant les tribunes), sur la plaine de l'ouest. */
export const ANNEAU = { cx: -8200, cz: 3300, half: 560, radius: 215, level: 0, widthM: 8 };

/** Mont Cendre : petit cône de scories de l'Île de Sable-Noir (bike park sur les cendres). */
export const CINDER = { x: 15300, z: 8700, h: 120, spread: 650 };

// ── Le Pont des Orgues et la Chaussée : routes sur la mer ──

export interface SeaLink {
  id: string;
  name: string;
  /** Extrémités, sur la terre ferme (≈ 150 m en retrait du rivage). */
  a: Vec2;
  b: Vec2;
  /** Pont (tablier au-dessus de l'eau, `deck` m) ou chaussée (digue empierrée, chaussée à `deck` m). */
  bridge: boolean;
  deck: number;
}

/** Points de deux îles qui se font face (le plus court passage), à `inset` m du rivage. */
function facing(i: number, j: number, inset: number): [Vec2, Vec2] {
  const A = ISLES[i]!;
  const B = ISLES[j]!;
  let a = Math.atan2(B.cz - A.cz, B.cx - A.cx);
  let b = Math.atan2(A.cz - B.cz, A.cx - B.cx);
  // Quelques passes : chaque point regarde l'autre.
  for (let k = 0; k < 6; k++) {
    const pb = coastPoint(b, 0, j);
    let best = a;
    let bd = Infinity;
    for (let da = -0.25; da <= 0.25; da += 0.002) {
      const p = coastPoint(a + da, 0, i);
      const d = Math.hypot(p[0] - pb[0], p[1] - pb[1]);
      if (d < bd) {
        bd = d;
        best = a + da;
      }
    }
    a = best;
    const pa = coastPoint(a, 0, i);
    let bb = b;
    bd = Infinity;
    for (let db = -0.4; db <= 0.4; db += 0.002) {
      const p = coastPoint(b + db, 0, j);
      const d = Math.hypot(p[0] - pa[0], p[1] - pa[1]);
      if (d < bd) {
        bd = d;
        bb = b + db;
      }
    }
    b = bb;
  }
  return [coastPoint(a, inset, i), coastPoint(b, inset, j)];
}

const [pontA, pontB] = facing(0, 1, 150);
const [chA, chB] = facing(0, 2, 150);
export const SEA_LINKS: SeaLink[] = [
  { id: 'pont-des-orgues', name: 'Pont des Orgues', a: pontA, b: pontB, bridge: true, deck: 11 },
  { id: 'la-chaussee', name: 'La Chaussée', a: chA, b: chB, bridge: false, deck: 2.6 },
];

/** Distance (m) à l'axe d'une route sur la mer et indice de celle-ci ; Infinity loin de toutes. */
export function seaLinkAt(x: number, z: number): { d: number; link: SeaLink | null; t: number } {
  let best = { d: Infinity, link: null as SeaLink | null, t: 0 };
  for (const l of SEA_LINKS) {
    const dx = l.b[0] - l.a[0];
    const dz = l.b[1] - l.a[1];
    const L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - l.a[0]) * dx + (z - l.a[1]) * dz) / L2));
    const d = Math.hypot(x - l.a[0] - dx * t, z - l.a[1] - dz * t);
    if (d < best.d) best = { d, link: l, t };
  }
  return best;
}

/** Point à `m` m de `p`, vers l'intérieur de l'île `isle`. */
function inland(p: Vec2, isle: number, m: number): Vec2 {
  const I = ISLES[isle]!;
  const l = Math.hypot(p[0] - I.cx, p[1] - I.cz) || 1;
  return [p[0] - ((p[0] - I.cx) / l) * m, p[1] - ((p[1] - I.cz) / l) * m];
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
  /** Petite ville du bord de mer (front de mer, promenade, maisons colorées). */
  seaside?: boolean;
  port?: boolean;
  /** Île (indice dans ISLES). */
  isle: number;
  level: number;
}

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: p[0], z: p[1], r, angle, size, level: 0, isle: 0, ...extra });

export const TOWNS: Town[] = [
  town('sainte-iris', 'Sainte-Iris', coastPoint(1.62, 520), 900, 0, 'ville', { seaside: true }),
  town('port-lave', 'Port-Lave', coastPoint(2.62, 420), 430, 0.6, 'village', { port: true }),
  town('aigues-chaudes', 'Aigues-Chaudes', [-200, 2300], 380, 0.3, 'village'),
  town('rocheverte', 'Rocheverte', [7600, -2600], 380, 1.1, 'village'),
  town('vigne-noire', 'Vigne-Noire', [-8800, -3900], 360, 0.5, 'village'),
  town('les-terrasses', 'Les Terrasses', [5600, 3900], 360, 0.2, 'village'),
  town('la-plaine', 'La Plaine', [-5000, 4700], 560, 0.1, 'bourg'),
  town('le-pont', 'Le Pont', inland(SEA_LINKS[0]!.a, 0, 520), 260, 1.3, 'hameau'),
  town('la-chaussee', 'La Chaussée', inland(SEA_LINKS[1]!.a, 0, 520), 260, 0.5, 'hameau'),
  town('les-orgues', 'Les Orgues', coastPoint(Math.PI, 430, 1), 380, 1.57, 'village', { port: true, isle: 1 }),
  town('sable-noir', 'Sable-Noir', [12900, 8900], 360, 0.15, 'village', { isle: 2 }),
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

export const RIVERS: River[] = [
  {
    // Ravine de la forêt humide (versant est, au vent) : du flanc du volcan à la crique de la Ravine.
    id: 'la-ravine',
    name: 'La Ravine des Pluies',
    pts: [[1600, -4300], [3800, -4700], [6200, -5300], [8400, -5900], coastPoint(-0.62, -150)],
    w0: 3,
    w1: 10,
    v0: 160,
    v1: 380,
  },
  {
    // Ruisseau chaud : des sources d'Aigues-Chaudes à la baie des Cendres.
    id: 'le-ruisseau-chaud',
    name: 'Le Ruisseau Chaud',
    pts: [[700, 1500], [1500, 3600], [2100, 5800], [2500, 7600], coastPoint(1.38, -150)],
    w0: 2,
    w1: 7,
    v0: 110,
    v1: 260,
  },
  {
    id: 'la-riviere-des-vignes',
    name: 'La Rivière des Vignes',
    pts: [[-6000, -4600], [-8000, -5600], [-9600, -6400], coastPoint(-2.55, -150)],
    w0: 2,
    w1: 8,
    v0: 120,
    v1: 300,
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

export const LAKES: Lake[] = [
  { id: 'lac-du-cratere', name: 'Lac du Cratère', kind: 'lake', x: VOLCANO.x, z: VOLCANO.z, rx: 250, rz: 225, rot: 0.3, level: NaN, depth: 12 },
  { id: 'etang-des-laves', name: 'Étang des Laves', kind: 'lake', x: -7400, z: 1500, rx: 380, rz: 220, rot: 0.4, level: NaN, depth: 3 },
  { id: 'bassin-des-bains', kind: 'pond', x: 900, z: 1650, rx: 70, rz: 45, rot: 0.6, level: NaN, depth: 1.5 },
  { id: 'mare-de-sable-noir', kind: 'pond', x: 13600, z: 8000, rx: 80, rz: 55, rot: 0.2, level: NaN, depth: 1.5 },
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

function harbourAt(id: string, name: string, ang: number, halfLen: number, halfWid: number, isle = 0): Harbour {
  const [x, z] = coastPoint(ang, halfLen * 0.55, isle);
  return { id, name, x, z, dir: ang, halfLen, halfWid };
}

export const HARBOURS: Harbour[] = [harbourAt('port-lave', 'Port de Port-Lave', 2.6, 170, 75), harbourAt('port-orgues', 'Port des Orgues', Math.PI + 0.12, 120, 55, 1), harbourAt('port-iris', 'Port de Sainte-Iris', 1.48, 150, 60)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Vallonnement (mètres d'amplitude), réglable pour un essai : ISLAND_RELIEF='{"hills":30,…}'. */
const RELIEF = { wave: 22, hills: 38, knolls: 45, volcano: 1, ...(JSON.parse(process.env.ISLAND_RELIEF ?? '{}') as Record<string, number>) };

/** Compatibilité : distance au volcan (m) et hauteur de son cône. */
export function chainAt(x: number, z: number): { d: number; h: number } {
  return { d: Math.hypot(x - VOLCANO.x, z - VOLCANO.z), h: VOLCANO.H };
}

const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port || t.size === 'hameau');

/**
 * Pied des falaises : largeur (m, comptée depuis le rivage) de la grève de sable noir avant la paroi, 14 à 36 m.
 * La paroi monte à la verticale juste au-delà (sur `CLIFF_FACE` m : une à deux cases de la grille de 2 m).
 */
export function cliffFoot(x: number, z: number): number {
  return 14 + 22 * clamp(0.5 + 0.9 * noise2(x / 420, z / 420, 61), 0, 1);
}
export const CLIFF_FACE = 2.5;

/** Hauteur de la paroi d'une falaise de la Grande Île ou de Sable-Noir (m) : 24 à 56 m selon le lieu. */
function cliffHeight(x: number, z: number): number {
  return 24 + 32 * clamp(0.5 + 0.8 * noise2(x / 900, z / 900, 62) + 0.15 * noise2(x / 160, z / 160, 63), 0, 1);
}

/** Relief naturel sans les rivières, lacs, ports ni plateaux aplanis. */
function natural(x: number, z: number): number {
  const { isle, d } = isleAt(x, z);
  const I = ISLES[isle]!;
  const cliff = cliffiness(Math.atan2(z - I.cz, x - I.cx), isle);
  // Mer : fond qui plonge doucement devant les plages, vite au pied des falaises ; eaux peu profondes entre les îles.
  if (d < 0) return Math.max(-28, 0.25 + d * lerp(0.012, 0.1, cliff));
  const beach = 0.25 + Math.min(d, 160) * 0.012 + 12 * smoothstep(160, 1800, d);
  // Falaise : grève de sable noir au pied (presque plate), paroi verticale, puis le haut qui monte doucement.
  // Sur l'Île des Orgues, la paroi porte directement le plateau de basalte (voir plus bas) : socle bas ici.
  const foot = cliffFoot(x, z);
  const face = smoothstep(foot, foot + CLIFF_FACE, d);
  const wallH = isle === 1 ? 10 : cliffHeight(x, z);
  const wall = 0.25 + 0.03 * Math.min(d, foot) + face * (wallH + 14 * smoothstep(60, 1500, d));
  const cl = cliff * (1 - smoothstep(1500, 4000, d));
  let h = beach + (wall - beach) * cl;
  // Relief de l'intérieur : posé sur le haut de la paroi (pas de longue pente au-dessus de la falaise).
  const inland = smoothstep(150, 2400, d) * (1 - cl) + face * (isle === 1 ? 1 : smoothstep(-300, 900, d)) * cl;
  const fade = smoothstep(120, 1200, d);
  if (isle === 0) {
    // Lieux qui doivent rester faciles : plaine du Circuit et de La Plaine, Sainte-Iris, Port-Lave, Aigues-Chaudes.
    const calm = 1 - 0.85 * Math.max(gauss(x, z, ANNEAU.cx, ANNEAU.cz, 2800, 1900), gauss(x, z, -5000, 4700, 2600, 1800), gauss(x, z, TOWNS[0]!.x, TOWNS[0]!.z, 2400, 1500), gauss(x, z, -7400, 1500, 1500, 1100));
    h += inland * (RELIEF.wave * (fbm(x / 7000, z / 7000, 3, 11) + 0.35) + (8 + (RELIEF.hills - 8) * calm) * fbm(x / 1500, z / 1500, 2, 12) + 2.2 * fbm(x / 350, z / 350, 2, 13));
    h += inland * calm * RELIEF.knolls * Math.max(0, fbm(x / 2300 + 7, z / 2300 - 3, 2, 14) + 0.08) * 1.6;
    // Collines des Terrasses (sud-est) : croupes douces, champs en terrasses.
    h += fade * 150 * gauss(x, z, 5200, 3600, 2900, 1700) * (0.85 + 0.3 * fbm(x / 1800, z / 1800, 2, 22));
    // Le volcan : cône régulier sur le versant de la route du Cratère (sud-est), ravines ailleurs.
    const V = VOLCANO;
    const vr = Math.hypot(x - V.x, z - V.z);
    const even = 1 - 0.9 * Math.max(gauss(x, z, -200, 300, 2400, 3200), gauss(x, z, 1400, -1600, 1900, 1900));
    const gullies = vr > V.rim * 1.8 ? even * Math.min(1, (vr - V.rim * 1.8) / 1500) * (0.07 * (ridged(x / 1300, z / 1300, 3, 31) - 0.45) + 0.03 * fbm(x / 500, z / 500, 2, 32)) : 0;
    const vh = volcanoHeight(x, z);
    h += smoothstep(30, 1500, d) * RELIEF.volcano * vh * (1 + gullies);
    // Coulées : bourrelet de lave chaotique (2 à 6 m), plus marqué vers le bas.
    const lv = lavaAt(x, z);
    if (lv.d < lv.w) h += fade * (2.5 + 3.5 * lv.t) * smoothstep(lv.w, lv.w * 0.45, lv.d) * (0.75 + 0.5 * noise2(x / 60, z / 60, 93));
  } else if (isle === 1) {
    // Plateau de basalte des Orgues : dessus presque plat (≈ 70 m), entaillé par le vallon du port.
    h += inland * (55 + 18 * fbm(x / 1400, z / 1400, 2, 24) + 3 * fbm(x / 300, z / 300, 2, 25));
    h -= 30 * gauss(x, z, I.cx - I.A * 0.45, I.cz - 900, 600, 700);
  } else {
    // Île de Sable-Noir : basse, dunes, et le Mont Cendre à l'est.
    h += inland * (10 + 8 * fbm(x / 900, z / 900, 2, 26) + 1.5 * fbm(x / 200, z / 200, 2, 27));
    h += fade * CINDER.h * Math.exp(-((Math.hypot(x - CINDER.x, z - CINDER.z) / CINDER.spread) ** 1.8));
  }
  // Villes du bord de mer et culées des routes sur la mer : arrière-pays en pente douce (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.045), h, smoothstep(900, 1800, dt));
  }
  for (const l of SEA_LINKS)
    for (const p of [l.a, l.b]) {
      const dt = Math.hypot(x - p[0], z - p[1]);
      if (dt < 1200) h = lerp(Math.min(h, 3 + dt * 0.05), h, smoothstep(500, 1200, dt));
    }
  // Plaine basse de l'Étang des Laves.
  h -= fade * 8 * gauss(x, z, -7400, 1500, 1600, 1100);
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
    flats.push({ x: t.x, z: t.z, dist: (x, z) => Math.hypot(x - t.x, z - t.z), r0: t.r * (t.seaside ? 1.0 : 0.55), r1: t.r * (t.seaside ? 1.6 : 1.4) + (t.seaside ? 0 : 260), level: t.level });
  }
  return flats;
}

/**
 * Ressauts des rivières : à la fraction `at` du cours, le lit tombe de `drop` m d'un coup (paroi verticale en
 * amphithéâtre, cascade), puis la vasque rejoint la pente d'origine en aval.
 */
export const RIVER_FALL_SPECS: Array<{ id: string; river: string; at: number; drop: number }> = [
  { id: 'cascade-de-la-ravine', river: 'la-ravine', at: 0.3, drop: 16 },
  { id: 'cascade-des-vignes', river: 'la-riviere-des-vignes', at: 0.45, drop: 13 },
];

export interface RiverFall {
  id: string;
  /** Lèvre de la chute, direction de l'écoulement (rad, atan2(z, x)), hauteur, demi-largeur de l'amphithéâtre,
   * longueur (m) sur laquelle la vasque rejoint la pente d'origine. */
  x: number;
  z: number;
  dir: number;
  drop: number;
  half: number;
  len: number;
}
let falls: RiverFall[] | null = null;

export function riverFalls(): RiverFall[] {
  if (falls) return falls;
  falls = RIVER_FALL_SPECS.map((s) => {
    const b = riverBeds().find((r) => r.river.id === s.river)!;
    const n = b.pts.length;
    const k = Math.round(s.at * (n - 1));
    const a = b.pts[Math.max(0, k - 3)]!;
    const c = b.pts[Math.min(n - 1, k + 3)]!;
    // Pente du lit autour (± 100 m) : la vasque la rattrape sans jamais remonter.
    const g = Math.max(0.02, (b.bed[Math.max(0, k - 10)]! - b.bed[Math.min(n - 1, k + 10)]!) / ((Math.min(n - 1, k + 10) - Math.max(0, k - 10)) * 10));
    return { id: s.id, x: b.pts[k]![0], z: b.pts[k]![1], dir: Math.atan2(c[1] - a[1], c[0] - a[0]), drop: s.drop, half: b.width[k]! * 0.75, len: Math.min(900, Math.max(60, (s.drop / g) * 2.5)) };
  });
  return falls;
}

/** Abaissement (m) dû aux ressauts des rivières au point. */
function fallCut(x: number, z: number): number {
  let cut = 0;
  for (const f of riverFalls()) {
    const dx = x - f.x;
    const dz = z - f.z;
    if (Math.abs(dx) > f.len + f.half || Math.abs(dz) > f.len + f.half) continue;
    const s = dx * Math.cos(f.dir) + dz * Math.sin(f.dir);
    if (s <= 0 || s > f.len) continue;
    const lat = Math.abs(-dx * Math.sin(f.dir) + dz * Math.cos(f.dir));
    // Amphithéâtre : la lèvre s'arrondit vers l'amont sur les côtés, la paroi reste verticale.
    const lip = (lat / f.half) ** 2 * f.half * 0.25;
    const w = 1 - smoothstep(f.half * 0.55, f.half, lat);
    if (w <= 0) continue;
    const face = smoothstep(lip, lip + CLIFF_FACE, s);
    const fade = 1 - smoothstep(f.len * 0.3, f.len, s);
    cut = Math.max(cut, f.drop * w * face * fade);
  }
  return cut;
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
    h -= fallCut(x, z);
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
  // La Chaussée : digue empierrée sur la mer (dessus à 0,4 m sous la chaussée, talus jusqu'au fond sur 26 m).
  const s = seaLinkAt(x, z);
  if (s.link && !s.link.bridge && s.d < 40) {
    const top = s.link.deck - 0.4;
    if (h < top) h = s.d < 10 ? top : lerp(top, h, smoothstep(10, 40, s.d));
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
    // Bassin et chenal vers le large, borné : le port d'une petite île ne barre pas la mer jusqu'à la Grande Île.
    return Math.abs(w) < p.halfWid + margin && u > -p.halfLen - margin && u < p.halfLen + 400;
  });
}

export { clamp };

/** Mise au point : étapes du relief en un point. */
export function terrainSteps(x: number, z: number) {
  const n = natural(x, z);
  const c = carve(n, x, z);
  return { natural: n, carved: c, preLake: preLake(x, z), final: terrain(x, z), flats: getFlats().map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), level: f.level, d: Math.round(f.dist(x, z)), r0: f.r0, r1: f.r1 })).filter((f) => f.d < f.r1 + 100) };
}
