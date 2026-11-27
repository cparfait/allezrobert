/**
 * Le Désert rouge — conception (voir docs/DESERT_ROUGE.md). Un croissant de terre rouge ouvert au sud sur le golfe
 * de Corail : la corne ouest est une mer de dunes (le Grand Erg, un tiers du monde), la corne est un haut plateau en
 * gradins coiffé du massif du Vautour. Le Grand Canyon de l'Oued Rouge suit le croissant d'un bout à l'autre ; on le
 * franchit à quatre brèches (le Gué des Sables, la Brèche de l'Erg, la Brèche du Centre et les Lacets du Canyon).
 * Oasis éparses reliées en étoile au Puits de l'Étoile, Chott Blanc (lac salé à sec) au bord de l'erg.
 *
 * Repère : x vers l'est, z vers le sud, mètres, origine au centre du monde. Le croissant suit un arc de cercle de
 * centre (ARC.cx, ARC.cz) et de rayon ARC.R ; t est l'angle compté depuis le nord (positif vers l'est).
 * Tout est déterministe : deux générations donnent le même monde.
 */
import { chaikin, resample } from './geom.ts';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise.ts';

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'desert-rouge',
  name: 'Le Désert rouge',
  /** Emprise des tuiles (m) : celle des autres mondes Poly (l'écran de carte la suppose). */
  minX: -19000,
  maxX: 19000,
  minZ: -13000,
  maxZ: 13000,
  tileSizeM: 1000,
};

// ── Le croissant ──

/** Arc du croissant : centre (au sud, dans le golfe), rayon, angles des deux cornes (ouest, est). */
export const ARC = { cx: 0, cz: 11700, R: 17000, t0: -1.05, t1: 1.12 };

/** Point d'angle t et de rayon r autour du centre de l'arc. */
export function polar(t: number, r: number): Vec2 {
  return [ARC.cx + r * Math.sin(t), ARC.cz - r * Math.cos(t)];
}
export const arcT = (x: number, z: number) => Math.atan2(x - ARC.cx, ARC.cz - z);
export const arcR = (x: number, z: number) => Math.hypot(x - ARC.cx, z - ARC.cz);

/** Demi-largeur des terres de part et d'autre de l'arc (m) : large au milieu, cornes effilées (l'ouest plus épaisse). */
export function halfWidth(t: number): number {
  const u = clamp((t - ARC.t0) / (ARC.t1 - ARC.t0), 0, 1);
  const tip = lerp(2900, 2100, u);
  return tip + (5800 - tip) * Math.sin(Math.PI * u) ** 0.8;
}

/** Côtés du croissant : 1 = côte extérieure (nord, mer ouverte), −1 = côte intérieure (golfe de Corail). */
export type Side = 1 | -1;

/** Rayon du tracé dessiné du canyon (avant méandres) : il ondule autour de l'arc. */
export const canyonR = (t: number) => ARC.R + 300 + 350 * Math.sin(t * 5.3);

interface CoastFeature {
  t: number;
  side: Side;
  /** > 0 : cap (le rivage avance), < 0 : anse (m). */
  amount: number;
  width: number;
}

const FEATURES: CoastFeature[] = [
  { t: -0.15, side: 1, amount: -650, width: 800 }, // anse de Port-Vent
  { t: 0.36, side: 1, amount: 900, width: 1100 }, // cap des Vents
  { t: 0.62, side: 1, amount: -450, width: 900 }, // anse du Vautour
  { t: -0.45, side: 1, amount: 500, width: 1200 }, // pointe de la Mesa
  { t: 0.52, side: -1, amount: 600, width: 1000 }, // pointe Fauve (golfe)
  { t: -0.55, side: -1, amount: -500, width: 900 }, // anse des Sablons (golfe)
  { t: 0.95, side: -1, amount: -350, width: 600 }, // anse de Cap-Brique
];
const FEATURE_AT = FEATURES.map((f) => ({ f, p: polar(f.t, ARC.R + f.side * halfWidth(f.t)) }));

/** Rivage calme (sans bruit) devant les villes du bord de mer : (t, côté). */
const CALM: Array<[number, Side]> = [
  [0.03, -1],
  [0.12, -1],
  [-0.15, 1],
  [0.95, -1],
  [-0.96, -1],
];
const CALM_AT = CALM.map(([t, s]) => polar(t, ARC.R + s * halfWidth(t)));

/** Distance au rivage (m), calcul exact : > 0 sur la terre, < 0 en mer. */
function shoreDistExact(x: number, z: number): number {
  const t = arcT(x, z);
  const r = arcR(x, z);
  const tc = clamp(t, ARC.t0, ARC.t1);
  let d: number;
  if (t === tc) d = Math.abs(r - ARC.R);
  else {
    const [px, pz] = polar(tc, ARC.R);
    d = Math.hypot(x - px, z - pz);
  }
  let calm = 1;
  for (const [cx, cz] of CALM_AT) calm = Math.min(calm, 1 - 0.9 * Math.exp(-((Math.hypot(x - cx, z - cz) / 1300) ** 2)));
  let n = (380 * fbm(x / 3400, z / 3400, 3, 1) + 140 * fbm(x / 950, z / 950, 2, 2) + 40 * noise2(x / 260, z / 260, 3)) * calm;
  for (const { f, p } of FEATURE_AT) {
    const dd = (x - p[0]) ** 2 + (z - p[1]) ** 2;
    if (dd < (f.width * 3) ** 2) n += f.amount * Math.exp(-dd / (f.width * f.width));
  }
  return halfWidth(tc) - d + n;
}

// Rivage en grille de 20 m (le relief l'interroge des millions de fois).
const SD_CELL = 20;
const SD_N = Math.round((ISLAND.maxX - ISLAND.minX) / SD_CELL) + 1;
const SD_M = Math.round((ISLAND.maxZ - ISLAND.minZ) / SD_CELL) + 1;
let sdGrid: Float32Array | null = null;
function sdTable(): Float32Array {
  if (sdGrid) return sdGrid;
  sdGrid = new Float32Array(SD_N * SD_M);
  for (let j = 0; j < SD_M; j++) for (let i = 0; i < SD_N; i++) sdGrid[j * SD_N + i] = shoreDistExact(ISLAND.minX + i * SD_CELL, ISLAND.minZ + j * SD_CELL);
  return sdGrid;
}

/** Distance au rivage (m) : > 0 sur la terre, < 0 en mer. */
export function shoreDist(x: number, z: number): number {
  const fx = (x - ISLAND.minX) / SD_CELL;
  const fz = (z - ISLAND.minZ) / SD_CELL;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= SD_N - 1 || j >= SD_M - 1) return shoreDistExact(x, z);
  const g = sdTable();
  const u = fx - i;
  const w = fz - j;
  const o = j * SD_N + i;
  return (g[o]! * (1 - u) + g[o + 1]! * u) * (1 - w) + (g[o + SD_N]! * (1 - u) + g[o + SD_N + 1]! * u) * w;
}

/** Compatibilité : distance normalisée à la côte (> 0 sur la terre). */
export function coast(x: number, z: number): number {
  return shoreDist(x, z) / 11000;
}

/** Côté du croissant où se trouve un point (1 : extérieur, nord ; −1 : golfe). */
export const sideAt = (x: number, z: number): Side => (arcR(x, z) >= ARC.R ? 1 : -1);

/**
 * Point du rivage à l'angle t, du côté `side`, rentré de `inset` m dans les terres (le long du rayon de l'arc).
 * Rivage dentelé : recherche par dichotomie.
 */
export function coastPoint(t: number, inset: number, side: Side): Vec2 {
  const W = halfWidth(t);
  let lo = 0; // dans les terres
  let hi = W + 2600; // en mer
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    const [x, z] = polar(t, ARC.R + side * m);
    if (shoreDistExact(x, z) > inset) lo = m;
    else hi = m;
  }
  return polar(t, ARC.R + side * (lo + hi) / 2);
}

/** Direction (rad, atan2(z, x)) du large à l'angle t, côté `side`. */
export const seaward = (t: number, side: Side) => (side > 0 ? Math.atan2(-Math.cos(t), Math.sin(t)) : Math.atan2(Math.cos(t), -Math.sin(t)));

/**
 * Falaises (0 plage … 1 falaise franche) : falaises rouges sur presque toute la côte nord (sauf l'anse de Port-Vent
 * et la côte des Dunes, à l'ouest), plages dans le golfe, falaises du Levant au fond est du golfe.
 */
export function cliffAt(x: number, z: number): number {
  const t = clamp(arcT(x, z), ARC.t0 - 0.2, ARC.t1 + 0.2);
  if (arcR(x, z) >= ARC.R) return smoothstep(-0.68, -0.52, t) * (1 - Math.exp(-(((t + 0.15) / 0.05) ** 2)));
  return 0.08 + 0.85 * smoothstep(0.38, 0.5, t) * (1 - smoothstep(0.7, 0.82, t));
}

// ── Lieux ──

/** Massif du Vautour (corne est) : Pic du Vautour (observatoire au sommet) et Dent Rouge. */
const P1 = polar(0.75, ARC.R + 2300);
const P2 = polar(0.87, ARC.R + 1700);
export const MASSIF = { phare: P1, mont: P2, h1: 420, h2: 320, spread: 1700 };

/** Chott Blanc : lac salé à sec au bord de l'erg, côté golfe ; le Circuit du Chott y est posé. */
const chottC = polar(-0.26, ARC.R - 2900);
export const CHOTT = { id: 'chott-blanc', name: 'Le Chott Blanc', x: Math.round(chottC[0]), z: Math.round(chottC[1]), rx: 1500, rz: 650, rot: 0, level: NaN };

/** Circuit du Chott (boucle plate sur le sel, départ devant les tribunes). */
export const ANNEAU = { cx: CHOTT.x, cz: CHOTT.z, half: 560, radius: 215, level: 0, widthM: 8 };

/** Grand Erg (le tiers ouest) : dunes en cordons (amplitude, longueur d'onde, direction des crêtes). */
const ergC = polar(-0.72, ARC.R);
export const ERG = { x: Math.round(ergC[0]), z: Math.round(ergC[1]), amp: 22, wave: 430, ang: 0.45 };

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
  /** Part de la hauteur portée par le talus d'éboulis (0,16 par défaut ; les buttes témoins : un vrai cône d'éboulis). */
  skirt?: number;
  /** Niveau du sommet (m), calculé au premier appel. */
  top: number;
}

const mesa = (id: string, name: string | undefined, p: Vec2, rx: number, rz: number, rot: number, h: number, extra: Partial<Mesa> = {}): Mesa => ({ id, ...(name ? { name } : {}), x: Math.round(p[0]), z: Math.round(p[1]), rx, rz, rot, h, wall: Math.max(18, Math.min(60, Math.min(rx, rz) * 0.08)), apron: Math.min(260, h * 1.4), top: NaN, ...extra });

/**
 * Buttes témoins du plateau (27/11/2026, identité « Sud-Ouest américain ») : hautes tours à sommet plat et aiguilles
 * dressées seules sur la plaine, parois verticales au-dessus d'un cône d'éboulis, vues de loin depuis les routes.
 * Posées à plus de 500 m de toute route du graphe, sur un sol plat (écart < 14 m sur 300 m) : les tracés ne changent pas.
 * [x, z, rayon, hauteur, nom].
 */
const SENTINEL_SPOTS: ReadonlyArray<readonly [number, number, number, number, string?]> = [
  [5750, -7750, 150, 135, 'La Sentinelle'],
  [9750, -1000, 52, 95, "L'Aiguille Rouge"],
  [-4500, -6000, 175, 120, 'Le Château Rouge'],
  [7250, -2750, 135, 115, "L'Enclume"],
  [7480, -2560, 42, 100],
  [1500, -8750, 160, 140, 'La Butte du Corbeau'],
  [2500, -3250, 48, 88, 'La Chandelle'],
  [-5500, -8750, 185, 110, 'Le Vieux Fort'],
  [7750, -6750, 58, 110],
  [-1250, -6500, 140, 120],
  [0, -9750, 165, 100],
  [-2750, -4000, 48, 85],
  [1750, -6750, 42, 78],
  [9500, -5000, 200, 150, 'La Table du Couchant'],
  [-4750, -3250, 38, 70],
  [5500, -3500, 95, 80],
  [-5000, -750, 220, 115],
];
const SENTINELLES: Mesa[] = SENTINEL_SPOTS.map(([x, z, r, h, name], i) => {
  const spire = r < 70;
  return mesa(`sentinelle-${i}`, name, [x, z], r, r * (spire ? 0.85 : 0.72), i * 1.3, h, spire
    ? { wall: Math.max(8, r * 0.18), apron: Math.min(150, h * 1.3), skirt: 0.32 }
    : { wall: Math.max(12, r * 0.09), apron: Math.min(230, h * 1.5), skirt: 0.3 });
});

/** Buttes Rouges (bike park, sentier des Arches) : petites tours à sommet plat entre Rocherouge et L'Oasis. */
const BUTTES_C = polar(0.15, ARC.R - 4000);
export const MESAS: Mesa[] = [
  mesa('grande-mesa', 'La Grande Mesa', polar(-0.36, ARC.R + 2700), 1500, 1100, -0.36, 260, { ramp: { ang: -0.36, len: 2200, half: 0.5 } }),
  mesa('mesa-du-lion', 'La Mesa du Lion', polar(0.3, ARC.R - 4700), 600, 430, 0.3, 110),
  mesa('table-des-vents', 'La Table des Vents', polar(0.14, ARC.R + 3900), 480, 320, 0.14, 90),
  mesa('dent-rouge', 'La Dent Rouge', polar(0.6, ARC.R - 2300), 220, 180, 0.6, 140, { wall: 20, apron: 120 }),
  ...([[-600, -350, 110, 60], [-200, -550, 80, 45], [300, -250, 150, 75], [800, -450, 90, 50], [-500, 350, 130, 65], [100, 650, 70, 40], [600, 250, 120, 55], [1100, 650, 95, 50], [-900, 750, 85, 45], [1000, -50, 75, 40]] as const).map(([dx, dz, r, h], i) =>
    mesa(`butte-${i}`, i === 2 ? 'Les Buttes Rouges' : undefined, [BUTTES_C[0] + dx * 0.8, BUTTES_C[1] + dz * 0.8], r, r * 0.8, i * 0.7, h, { wall: 14, apron: 70 })),
  // Témoins isolés dans l'erg et sur le reg (vus de loin).
  mesa('temoin-1', undefined, polar(-0.62, ARC.R - 900), 170, 130, 0.5, 70, { wall: 14, apron: 90 }),
  mesa('temoin-2', undefined, polar(-0.5, ARC.R + 3800), 210, 150, 1.1, 80, { wall: 16, apron: 100 }),
  mesa('temoin-3', undefined, polar(0.45, ARC.R + 2600), 160, 120, 0.2, 60, { wall: 14, apron: 80 }),
  ...SENTINELLES,
];

/** Bike park des Buttes : entre les Buttes Rouges (voir MESAS). */
export const BIKEPARK: Vec2 = [Math.round(BUTTES_C[0] + 200), Math.round(BUTTES_C[1] - 1000)];

/** Cyclo-cross des Sables : au bord de l'erg, côté golfe (dunes adoucies autour). */
const crossP = polar(-0.62, ARC.R - 3300);
export const CROSS: Vec2 = [Math.round(crossP[0]), Math.round(crossP[1])];

/** La Piste Droite : 6 km en ligne droite et à plat à travers l'erg, de Puits-Salé vers Sablons (couloir aplani). */
const pa = polar(-0.45, ARC.R - 2000);
const pb = polar(-0.86, ARC.R - 1800);
export const PISTE = { a: [Math.round(pa[0]), Math.round(pa[1])] as Vec2, b: [Math.round(pb[0]), Math.round(pb[1])] as Vec2, half: 260, blend: 700 };

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
  /** Côté du croissant et angle t (villes du bord de mer). */
  side?: Side;
  t?: number;
  level: number;
}

const town = (id: string, name: string, p: Vec2, r: number, angle: number, size: Town['size'], extra: Partial<Town> = {}): Town => ({ id, name, x: Math.round(p[0]), z: Math.round(p[1]), r, angle, size, level: 0, ...extra });
const coastal = (t: number, inset: number, side: Side) => ({ p: coastPoint(t, inset, side), extra: { side, t } });

const grande = MESAS[0]!;
const pc = coastal(0.03, 520, -1);
const cb = coastal(0.95, 420, -1);
const pv = coastal(-0.15, 420, 1);
const ls = coastal(-0.96, 900, -1);
export const TOWNS: Town[] = [
  town('rocherouge', 'Rocherouge', polar(-0.04, ARC.R - 2700), 620, 0.0, 'bourg'),
  town('port-corail', 'Port-Corail', pc.p, 950, 0, 'ville', { seaside: true, ...pc.extra }),
  town('cap-brique', 'Cap-Brique', cb.p, 400, 0.95, 'village', { port: true, ...cb.extra }),
  town('port-vent', 'Port-Vent', pv.p, 420, -0.15, 'village', { port: true, ...pv.extra }),
  town('sablons', 'Sablons', polar(-0.9, ARC.R - 1500), 480, -0.9, 'village'),
  town('les-salines', 'Les Salines', ls.p, 320, -0.96, 'hameau', { ...ls.extra }),
  town('puits-sale', 'Puits-Salé', polar(-0.42, ARC.R - 2300), 380, -0.42, 'village'),
  town('mesa-haute', 'Mesa-Haute', [grande.x - 120, grande.z - 80], 300, -0.36, 'village'),
  town('les-cairns', 'Les Cairns', polar(0.24, ARC.R + 1800), 280, 0.24, 'hameau'),
  town('l-oasis', "L'Oasis", polar(0.36, ARC.R - 2600), 360, 0.36, 'village'),
  town('ksar-rouge', 'Ksar-Rouge', polar(0.74, ARC.R - 1600), 400, 0.74 + Math.PI / 2, 'village'),
  town('l-etoile', "Le Puits de l'Étoile", polar(0.0, ARC.R + 2300), 300, 0.0, 'hameau'),
];

// ── Oued Rouge : le Grand Canyon (tracé dessiné, lit creusé dans le relief) ──

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
  /** Canyon : fond plat sur `floor` m de part et d'autre du lit, puis parois en gradins. */
  floor?: number;
  /** Lit abaissé (fraction du cours, altitude plafond) : le canyon se creuse sous le plateau. */
  drop?: Array<[number, number]>;
}

const CANYON_T0 = 0.98;
const canyonPts: Vec2[] = [];
for (let t = CANYON_T0; t > ARC.t0 - 0.001; t -= 0.05) canyonPts.push(polar(t, canyonR(t)));
canyonPts.push(polar(-1.17, ARC.R + 500), polar(-1.3, ARC.R + 300));

export const RIVERS: River[] = [
  {
    id: 'oued-rouge',
    name: 'Oued Rouge',
    pts: canyonPts,
    w0: 2,
    w1: 10,
    v0: 260,
    v1: 340,
    floor: 48,
    drop: [[0, 1200], [0.1, 270], [0.3, 160], [0.5, 65], [0.72, 16], [0.92, 2], [1, 0]],
  },
];

/**
 * Brèches du canyon : là, les parois cèdent la place à une rampe régulière (pente `g`) de part et d'autre du lit, sur
 * `half` m de large ; ailleurs le canyon est infranchissable. Les Lacets du Canyon (pente 20 %) se montent en lacets.
 */
export interface Breach {
  id: string;
  name: string;
  t: number;
  g: number;
  half: number;
  lacets?: boolean;
}
export const BREACHES: Breach[] = [
  { id: 'gue-des-sables', name: 'Le Gué des Sables', t: -0.92, g: 0.05, half: 240 },
  { id: 'breche-de-l-erg', name: "La Brèche de l'Erg", t: -0.55, g: 0.055, half: 260 },
  { id: 'breche-du-centre', name: 'La Brèche du Centre', t: -0.02, g: 0.06, half: 300 },
  { id: 'lacets-du-canyon', name: 'Les Lacets du Canyon', t: 0.55, g: 0.2, half: 460, lacets: true },
];

// ── Oasis et guelta (le Chott Blanc est à sec : voir CHOTT) ──

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

const pond = (id: string, name: string, p: Vec2, rx: number, rz: number, rot: number): Lake => ({ id, name, kind: 'pond', x: Math.round(p[0]), z: Math.round(p[1]), rx, rz, rot, level: NaN, depth: 3 });
export const LAKES: Lake[] = [
  pond('source-de-l-oasis', "Source de l'Oasis", polar(0.385, ARC.R - 2950), 150, 95, 0.4),
  pond('puits-des-dunes', 'Oasis des Dunes', polar(-0.72, ARC.R + 2100), 120, 80, 0.8),
  pond('oasis-de-sablons', 'Oasis de Sablons', polar(-0.93, ARC.R - 950), 110, 75, 0.2),
  pond('oasis-de-l-etoile', "Oasis de l'Étoile", polar(0.03, ARC.R + 2650), 100, 70, 0.5),
  pond('oasis-des-cairns', 'Oasis des Cairns', polar(0.31, ARC.R + 2500), 110, 70, 1.1),
  pond('source-de-port-vent', 'Source de Port-Vent', polar(-0.11, ARC.R + 3700), 90, 60, 0.3),
  { id: 'guelta-du-vautour', name: 'Guelta du Vautour', kind: 'lake', ...(() => { const p = polar(0.66, ARC.R + 3150); return { x: Math.round(p[0]), z: Math.round(p[1]) }; })(), rx: 220, rz: 150, rot: 0.5, level: NaN, depth: 6 },
];

/** Oasis : sources entourées de palmeraies (land.ts, décor du client). */
export const OASES = LAKES.filter((l) => l.kind === 'pond');

/** Distance (m) à la source d'oasis la plus proche. */
export function oasisDist(x: number, z: number): number {
  let d = Infinity;
  for (const o of LAKES) d = Math.min(d, Math.hypot(x - o.x, z - o.z));
  return d;
}

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

function harbourAt(id: string, name: string, t: number, side: Side, halfLen: number, halfWid: number): Harbour {
  const [x, z] = coastPoint(t, halfLen * 0.55, side);
  return { id, name, x, z, dir: seaward(t, side), halfLen, halfWid };
}

export const HARBOURS: Harbour[] = [harbourAt('port-corail', 'Port de Port-Corail', 0.12, -1, 230, 95), harbourAt('port-cap-brique', 'Port de Cap-Brique', 0.95, -1, 140, 60), harbourAt('port-vent', 'Port de Port-Vent', -0.15, 1, 150, 70)];

// ── Relief ──

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Hauteur du plateau (m) le long du croissant : bas dans l'erg, haut plateau à l'est. */
const TILT: Array<[number, number]> = [[-1.3, 35], [-1.05, 40], [-0.6, 55], [-0.35, 85], [-0.1, 175], [0.2, 260], [0.5, 350], [0.75, 400], [0.95, 280], [1.12, 170], [1.4, 120]];
function tiltAt(t: number): number {
  if (t <= TILT[0]![0]) return TILT[0]![1];
  for (let k = 0; k + 1 < TILT.length; k++) {
    const [t0, h0] = TILT[k]!;
    const [t1, h1] = TILT[k + 1]!;
    if (t <= t1) return lerp(h0, h1, smoothstep(0, 1, (t - t0) / (t1 - t0)));
  }
  return TILT[TILT.length - 1]![1];
}

/** Masque du Grand Erg (0 … 1) : la corne ouest. */
export function ergMask(x: number, z: number): number {
  return smoothstep(-0.33, -0.5, arcT(x, z));
}

/** Montagne (0 … 1) : près du massif du Vautour. */
export function mountainAt(x: number, z: number): number {
  const dm = Math.min(Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]), Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]));
  return 1 - smoothstep(1200, 3200, dm);
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

/** Distance (m) à l'axe de la Piste Droite et position le long (0 … 1). */
export function pisteAt(x: number, z: number): { d: number; s: number } {
  const [ax, az] = PISTE.a;
  const [bx, bz] = PISTE.b;
  const dx = bx - ax;
  const dz = bz - az;
  const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(x - ax - dx * s, z - az - dz * s), s };
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

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
  const k = m.skirt ?? 0.16;
  let f = (1 - k) * (1 - smoothstep(1 - w, 1, e)) + k * (1 - smoothstep(1 - w, 1 + a, e));
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

/** Relief de base : côte, plateau incliné en gradins, massif du Vautour (sans mesas, dunes ni canyon). */
function base(x: number, z: number): number {
  const d = shoreDist(x, z);
  const cliff = cliffAt(x, z);
  // Mer : fond qui plonge doucement devant les plages, vite au pied des falaises.
  if (d < 0) return Math.max(-30, 0.25 + d * lerp(0.012, 0.12, cliff));
  const t = arcT(x, z);
  const tilt = tiltAt(t) * (1 + 0.08 * fbm(x / 5000, z / 5000, 2, 5));
  const beach = 0.25 + Math.min(d, 160) * 0.012;
  // Plage : montée douce vers le plateau ; falaise : paroi franche (110 m au plus), puis le plateau.
  const soft = smoothstep(250, 3200, d);
  const low = Math.min(tilt, 110);
  const hard = (low * smoothstep(4, 80, d) + (tilt - low) * smoothstep(80, 2400, d)) / tilt;
  let P = tilt * lerp(soft, hard, cliff) + 16 * fbm(x / 1600, z / 1600, 2, 12) * smoothstep(60, 700, d);
  // Plateaux en gradins (hors de l'erg) : paliers de 45 m, contremarches raides ou adoucies (rampes) selon l'endroit.
  const g = (1 - ergMask(x, z)) * smoothstep(100, 900, d) * smoothstep(30, 75, P);
  if (g > 0.01 && P > 0) {
    const q = P / 45;
    const k = Math.floor(q);
    const s = clamp(0.18 + 0.5 * Math.max(0, fbm(x / 2600, z / 2600, 2, 31) + 0.05), 0.18, 0.65);
    P = lerp(P, 45 * (k + smoothstep(1 - s, 1, q - k)), 0.85 * g);
  }
  let h = beach * (1 - cliff) + 0.25 * cliff + P + 2.5 * fbm(x / 350, z / 350, 2, 13) * smoothstep(100, 800, d);
  // Jamais sous la mer dans les terres (bosses du bruit, cuvettes).
  h = Math.max(h, 0.3 + Math.min(d, 600) * 0.01);
  // Massif du Vautour : deux sommets, arêtes.
  const fade = smoothstep(120, 1200, d);
  const M = MASSIF;
  const cone = (px: number, pz: number, H: number) => H * Math.exp(-((Math.hypot(x - px, z - pz) / M.spread) ** 1.7));
  const c1 = cone(M.phare[0], M.phare[1], M.h1);
  const c2 = cone(M.mont[0], M.mont[1], M.h2);
  const massif = (c1 ** 8 + c2 ** 8) ** (1 / 8);
  if (massif > 0.05) h += fade * (massif + massif * 0.12 * (ridged(x / 1400, z / 1400, 3, 31) - 0.45));
  return h;
}

/** Relief naturel sans le canyon, les lacs, les ports ni les plateaux aplanis. */
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
  // Grand Erg : cordons de dunes de sable rouge, crêtes vers le nord-est ; adoucies autour du cyclo-cross.
  const em = ergMask(x, z) * smoothstep(80, 600, d) * (1 - 0.7 * gauss(x, z, CROSS[0], CROSS[1], 450, 450));
  if (em > 0.001) {
    const u = x * Math.cos(ERG.ang) + z * Math.sin(ERG.ang);
    const phase = (2 * Math.PI * u) / ERG.wave + 2.4 * fbm(x / 1700, z / 1700, 2, 95);
    const ridge = (0.5 + 0.5 * Math.sin(phase)) ** 1.7;
    const swell = 0.6 + 0.5 * fbm(x / 1100, z / 1100, 2, 96);
    h += em * (ERG.amp * ridge * swell + 3 * fbm(x / 120, z / 120, 2, 97));
  }
  // Villes du bord de mer (ports, petite ville) : arrière-pays en pente douce sur 1,4 km (pas de falaise sous les quais).
  for (const t of COAST_TOWNS) {
    const dt = Math.hypot(x - t.x, z - t.z);
    if (dt < 1800) h = lerp(Math.min(h, 6 + dt * 0.045), h, smoothstep(900, 1800, dt));
  }
  // Cuvette du chott.
  h -= fade * 25 * gauss(x, z, CHOTT.x, CHOTT.z, CHOTT.rx * 1.5, CHOTT.rz * 2.2);
  h = Math.max(h, 0.3 + Math.min(d, 600) * 0.005);
  // La Piste Droite : couloir aplani, niveau en pente régulière d'un bout à l'autre.
  const p = pisteAt(x, z);
  if (p.d < PISTE.half + PISTE.blend) {
    const L = lerp(pisteLevel(0), pisteLevel(1), p.s);
    h = lerp(h, L, 1 - smoothstep(PISTE.half, PISTE.half + PISTE.blend, p.d));
  }
  return h;
}

const COAST_TOWNS = TOWNS.filter((t) => t.seaside || t.port);

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


/** Brèche prête à l'emploi : point du lit, tangente (vers l'aval), normale (vers l'extérieur du croissant), pente du lit. */
export interface BreachFrame extends Breach {
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  slope: number;
  /** Demi-largeur du fond plat (m). */
  fl: number;
  /** Indice du point du lit. */
  k: number;
}
let frames: BreachFrame[] | null = null;

export function breachFrames(): BreachFrame[] {
  if (frames) return frames;
  const b = riverBeds()[0]!;
  frames = BREACHES.map((br) => {
    const [cx, cz] = polar(br.t, canyonR(br.t));
    let k = 0;
    for (let i = 1; i < b.pts.length; i++) if (Math.hypot(b.pts[i]![0] - cx, b.pts[i]![1] - cz) < Math.hypot(b.pts[k]![0] - cx, b.pts[k]![1] - cz)) k = i;
    const a = b.pts[Math.max(0, k - 8)]!;
    const c = b.pts[Math.min(b.pts.length - 1, k + 8)]!;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const tx = (c[0] - a[0]) / l;
    const tz = (c[1] - a[1]) / l;
    // Normale vers l'extérieur du croissant (côté nord).
    let nx = -tz;
    let nz = tx;
    const [px, pz] = b.pts[k]!;
    if (arcR(px + nx * 50, pz + nz * 50) < arcR(px, pz)) {
      nx = -nx;
      nz = -nz;
    }
    const slope = (b.bed[Math.max(0, k - 8)]! - b.bed[Math.min(b.pts.length - 1, k + 8)]!) / l;
    return { ...br, x: px, z: pz, y: b.bed[k]!, tx, tz, nx, nz, slope, fl: b.floor[k]!, k };
  });
  return frames;
}

/** Paroi du canyon en gradins : quatre paliers entre le fond et la corniche. */
function stairs(t: number): number {
  const q = t * 4;
  const k = Math.floor(q);
  return Math.min(1, (k + smoothstep(0.5, 1, q - k)) / 4);
}

/** Canyon, brèches, lacs et ports creusés dans un relief. */
function carve(h0: number, x: number, z: number): number {
  let h = h0;
  const v = valleyAt(x, z);
  if (v && v.dist < v.width) {
    // Vallée : le relief au-dessus du lit est abaissé vers lui (jamais remonté : continu au bord de la vallée).
    // Canyon : fond plat jusqu'à `floor`, parois en gradins ensuite (corniche franche en haut).
    const canyon = v.floor > v.chan + 2.5;
    const t = canyon ? stairs(smoothstep(v.floor, v.width, v.dist) ** 0.8) : smoothstep(v.chan + 2, v.width, v.dist);
    if (h > v.bed) h = v.bed + (h - v.bed) * t;
    if (canyon && v.dist < v.floor) h = Math.min(h, v.bed + 0.6 + 0.02 * v.dist);
    if (v.dist < v.chan + 2) h = Math.min(h, v.bed - 1.2 * (1 - smoothstep(v.chan * 0.6, v.chan + 2, v.dist)));
  }
  // Brèches : rampe régulière de part et d'autre du lit (les parois du canyon y sont entaillées).
  for (const B of breachFrames()) {
    const dx = x - B.x;
    const dz = z - B.z;
    const a = dx * B.tx + dz * B.tz;
    if (Math.abs(a) > B.half + 260) continue;
    const c = Math.abs(dx * B.nx + dz * B.nz);
    if (c > 4000) continue;
    const T = B.y - B.slope * a + 0.6 + B.g * Math.max(0, c - B.fl);
    if (h <= T) continue;
    const w = 1 - smoothstep(B.half, B.half + 260, Math.abs(a));
    h = lerp(h, T, w);
  }
  return h;
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

export { clamp, gauss };

/** Mise au point : étapes du relief en un point. */
export function terrainSteps(x: number, z: number) {
  const n = natural(x, z);
  const c = carve(n, x, z);
  return { natural: n, carved: c, preLake: preLake(x, z), final: terrain(x, z), flats: getFlats().map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), level: f.level, d: Math.round(f.dist(x, z)), r0: f.r0, r1: f.r1 })).filter((f) => f.d < f.r1 + 100) };
}
