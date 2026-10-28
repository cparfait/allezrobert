/**
 * L'île de Robert — fichier de conception (voir docs/ILE_DE_ROBERT.md).
 *
 * Repère du monde : x vers l'est, z vers le sud, mètres, origine au centre de l'île. Tout ce qui est décrit
 * ici est déterministe (aucun hasard non semé) : deux générations donnent le même monde.
 */

export type Vec2 = [number, number];

export const ISLAND = {
  id: 'ile-de-robert',
  name: "L'île de Robert",
  region: 'Monde imaginaire · Jeu vidéo',
  /** Emprise des tuiles (m) : 12 × 8 km plus une marge de mer. */
  minX: -7000,
  maxX: 7000,
  minZ: -5000,
  maxZ: 5000,
  tileSizeM: 1000,
  /** Demi-axes de la côte (m) et exposant de la super-ellipse (plus grand = plus carré). */
  coastA: 5600,
  coastB: 3600,
  coastPow: 2.6,
};

// ── Bruit lisse déterministe (sommes de sinus) pour la côte et les ondulations ──
function ripple(x: number, z: number, seed: number, scale: number): number {
  let v = 0;
  let a = 1;
  let f = 1 / scale;
  for (let o = 0; o < 4; o++) {
    v += a * Math.sin(x * f * 1.13 + seed * 1.7 + o * 2.3) * Math.cos(z * f * 0.97 - seed * 0.9 + o * 1.1);
    a *= 0.5;
    f *= 2.07;
  }
  return v / 1.875;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

/** Distance normalisée à la côte : > 0 sur l'île (≈ 1 au centre), < 0 en mer. */
export function coast(x: number, z: number): number {
  const I = ISLAND;
  const wobble = 1 + 0.07 * ripple(x, z, 3, 1800) + 0.03 * ripple(x, z, 11, 500);
  const r = (Math.abs(x / I.coastA) ** I.coastPow + Math.abs(z / I.coastB) ** I.coastPow) ** (1 / I.coastPow);
  return 1 - r / wobble;
}

// ── Zones ──
export const ANNEAU = {
  /** Centre, demi-longueur des lignes droites, rayon des virages (périmètre ≈ 3,6 km). */
  cx: -2700,
  cz: 300,
  half: 560,
  radius: 215,
  /** Plateau parfaitement plat autour de l'anneau. */
  level: 32,
  widthM: 8,
};

export const BOURG = { cx: 0, cz: 250, level: 26, radius: 700 };

/** Sommet du col du Phare, à ≈ 700 m du rivage (étape 2 : tracé de la montée et falaises à reprendre). */
export const COL = { cx: 3600, cz: -1800, height: 430 };

/** Altitude du terrain naturel (avant arasement sous les routes). */
export function terrain(x: number, z: number): number {
  const c = coast(x, z);
  // Plage en pente douce (≈ 1 %) qui passe sous l'eau au trait de côte, puis fond marin jusqu'à −14 m :
  // profil continu, sans marche au bord de l'eau.
  if (c < 0.02) return Math.max(-14, 1.2 + 60 * (c - 0.02));
  // Arrière-plage puis talus jusqu'au plateau intérieur (≈ 22 m), ondulations douces.
  let h = 1.2 + 22 * smooth(0.02, 0.3, c) + 6 * ripple(x, z, 5, 900) * smooth(0.1, 0.4, c);
  // Reliefs nuls sur la plage (raccord continu), entiers à quelques centaines de mètres du rivage :
  // collines de l'ouest (les Bois) et du sud (la Vallée), massif du col du Phare au nord-est.
  const inland = smooth(0.02, 0.1, c);
  h += inland * (45 * gauss(x, z, -4200, -1900, 1100, 900) + 30 * gauss(x, z, 1800, 2000, 900, 700));
  h += inland * (COL.height - 20) * gauss(x, z, COL.cx, COL.cz, 1500, 1050) ** 1.15;
  // Plateaux aplanis de l'Anneau et du Bourg (raccord progressif).
  const a = 1 - smooth(0.85, 1.35, anneauDist(x, z) / 520);
  h = h + (ANNEAU.level - h) * a;
  const b = 1 - smooth(0.7, 1.2, Math.hypot(x - BOURG.cx, z - BOURG.cz) / BOURG.radius);
  h = h + (BOURG.level - h) * b;
  return h;
}

/** Distance normalisée au centre de l'anneau (forme de stade), pour le plateau. */
function anneauDist(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - ANNEAU.cx) - ANNEAU.half);
  const dz = z - ANNEAU.cz;
  return Math.hypot(dx, dz) + Math.min(Math.abs(x - ANNEAU.cx), ANNEAU.half) * 0.25;
}

/** Points de l'anneau (sens horaire vu du ciel), espacés d'environ `step` mètres, boucle fermée. */
export function anneauLoop(step = 4): Vec2[] {
  const { cx, cz, half, radius } = ANNEAU;
  const pts: Vec2[] = [];
  const straight = Math.round((2 * half) / step);
  const arc = Math.round((Math.PI * radius) / step);
  // Ligne droite nord (ouest → est), légèrement bombée vers le nord pour un tracé plus vivant.
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

// ── Le Bourg : rues, maisons, église, stade ──
export interface StreetSpec {
  id: string;
  name: string;
  kind: 'secondary' | 'tertiary' | 'residential' | 'cycleway' | 'unclassified';
  width: number;
  pts: Vec2[];
  /** Pas de maisons le long (voie verte, route de l'anneau). */
  bare?: boolean;
}

const B = BOURG;
export function bourgStreets(): StreetSpec[] {
  const s: StreetSpec[] = [
    { id: 'grand-rue', name: 'Grand-Rue', kind: 'tertiary', width: 7, pts: [[B.cx - 720, B.cz + 20], [B.cx - 300, B.cz], [B.cx + 300, B.cz], [B.cx + 720, B.cz - 25]] },
    { id: 'rue-eglise', name: "Rue de l'Église", kind: 'residential', width: 6, pts: [[B.cx, B.cz - 520], [B.cx, B.cz - 60], [B.cx, B.cz], [B.cx, B.cz + 480]] },
    { id: 'rue-ecoles', name: 'Rue des Écoles', kind: 'residential', width: 5.5, pts: [[B.cx - 420, B.cz - 130], [B.cx + 420, B.cz - 130]] },
    { id: 'rue-moulin', name: 'Rue du Moulin', kind: 'residential', width: 5.5, pts: [[B.cx - 420, B.cz + 140], [B.cx + 420, B.cz + 140]] },
    { id: 'rue-ouest', name: 'Rue des Tilleuls', kind: 'residential', width: 5.5, pts: [[B.cx - 260, B.cz - 260], [B.cx - 260, B.cz + 300]] },
    { id: 'rue-est', name: 'Rue des Pommiers', kind: 'residential', width: 5.5, pts: [[B.cx + 260, B.cz - 260], [B.cx + 260, B.cz + 300]] },
  ];
  return s;
}

/** Place de l'église : carré pavé autour du carrefour central. */
export const PLACE = { x: B.cx, z: B.cz, half: 32 };
export const EGLISE = { x: B.cx + 58, z: B.cz - 52, w: 16, d: 30 };
export const STADE = { x: B.cx + 430, z: B.cz + 330, w: 68, l: 105 };
