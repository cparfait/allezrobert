import * as THREE from 'three/webgpu';
import type { VehicleKind } from '@allezrobert/physics';

/**
 * Véhicules du style jeu vidéo (low poly) : silhouettes à facettes bâties en primitives (hexaèdres effilés,
 * roues octogonales), aplats de couleur sans texture, vitrages sombres, phares et feux en pastilles plates.
 * Avant vers +z, sol en y = 0, centrés sur leur longueur (comme les modèles réalistes de traffic.ts).
 *
 * Roues : un maillage par roue, axe de rotation x (cylindre couché), centré sur son moyeu en (x, r, z),
 * `userData.radius` = son rayon : Traffic.update les fait tourner par `rotation.x`, chacune à sa vitesse.
 *
 * Partage : la géométrie de caisse (une seule, groupes par matériau) et celle des roues sont construites une
 * fois par variante ; les matériaux une fois par teinte. Une instance = un maillage de caisse + ses roues.
 */

export type LowPolyVariant = 'citadine' | 'berline' | 'break' | 'suv' | 'pickup' | 'fourgon' | 'camion' | 'tracteur' | 'tracteurRemorque';

/** Même forme que `Built` (traffic.ts), sans dépendance circulaire. */
export interface LowPolyBuilt {
  kind: VehicleKind;
  group: THREE.Object3D;
  wheels: THREE.Object3D[];
  length: number;
  wheelRadius: number;
  cruise: [number, number];
}

interface VariantSpec {
  /** Le camion compte comme un utilitaire (aspiration, son) ; sa longueur et sa vitesse lui sont propres. */
  kind: VehicleKind;
  /** Plage de vitesse de croisière (m/s). */
  cruise: [number, number];
  /** Fréquence relative dans la circulation (0 : tiré à part, tracteurs). */
  weight: number;
}

export const LOW_POLY_VARIANTS: Record<LowPolyVariant, VariantSpec> = {
  citadine: { kind: 'car', cruise: [15, 20], weight: 3 },
  berline: { kind: 'car', cruise: [16, 22], weight: 3 },
  break: { kind: 'car', cruise: [16, 21], weight: 2 },
  suv: { kind: 'car', cruise: [16, 21], weight: 2.5 },
  pickup: { kind: 'car', cruise: [15, 19], weight: 1 },
  fourgon: { kind: 'van', cruise: [14, 18], weight: 1.5 },
  camion: { kind: 'van', cruise: [13, 16], weight: 0.6 },
  tracteur: { kind: 'tractor', cruise: [8, 11], weight: 0 },
  tracteurRemorque: { kind: 'tractor', cruise: [7.5, 10], weight: 0 },
};

/** Teintes franches du style jeu vidéo (blanc, gris et noir restent courants). */
export const LOW_POLY_PAINTS = ['#f2f2ee', '#f2f2ee', '#d8dadc', '#2a2c30', '#8a9098', '#d63a2f', '#2f6fd6', '#f2b630', '#3fa65a', '#e8762c', '#1f9aa8', '#7a3fb0', '#1e3f7a', '#b02340'];

/** Variante tirée selon les fréquences, autre que `avoid` si possible (tracteurs exclus). */
export function pickLowPolyVariant(rand: () => number, avoid?: LowPolyVariant): LowPolyVariant {
  const pool = (Object.keys(LOW_POLY_VARIANTS) as LowPolyVariant[]).filter((v) => LOW_POLY_VARIANTS[v].weight > 0);
  const total = pool.reduce((s, v) => s + LOW_POLY_VARIANTS[v].weight, 0);
  let pick = pool[0] as LowPolyVariant;
  for (let k = 0; k < 4 && (k === 0 || pick === avoid); k++) {
    let x = rand() * total;
    pick = pool.find((v) => (x -= LOW_POLY_VARIANTS[v].weight) < 0) ?? (pool[0] as LowPolyVariant);
  }
  return pick;
}

/** Tracteur seul ou attelé à sa remorque. */
export function pickLowPolyTractor(rand: () => number): LowPolyVariant {
  return rand() < 0.5 ? 'tracteur' : 'tracteurRemorque';
}

/** Teinte d'une instance : fourgons blancs le plus souvent, le reste dans la palette. */
export function pickLowPolyPaint(variant: LowPolyVariant, rand: () => number): string {
  const paint = LOW_POLY_PAINTS[Math.floor(rand() * LOW_POLY_PAINTS.length)] as string;
  return variant === 'fourgon' && rand() < 0.75 ? '#f4f4f0' : paint;
}

// ——— Géométrie à facettes ———

type V3 = [number, number, number];
/** Quadrilatère : bas-gauche, bas-droite, haut-droite, haut-gauche (vu de l'extérieur). */
type Quad = [V3, V3, V3, V3];

/** Emplacements de matériau (groupes de la géométrie de caisse). */
const S = { Paint: 0, Glass: 1, Black: 2, Head: 3, Tail: 4, Grey: 5, Cargo: 6, Accent: 7, Load: 8 } as const;
const SLOT_COUNT = 9;

/** Hexaèdre : base et sommet rectangulaires (le sommet peut être plus étroit, plus court, décalé en z). */
interface Hexa {
  front: Quad;
  back: Quad;
  right: Quad;
  left: Quad;
  top: Quad;
  bottom: Quad;
  center: V3;
}

interface HexaSpec {
  y0: number;
  y1: number;
  /** Demi-largeur et étendue en z de la base. */
  xb: number;
  zb: [number, number];
  /** Idem au sommet (par défaut : comme la base). */
  xt?: number;
  zt?: [number, number];
  cx?: number;
}

function hexa(h: HexaSpec): Hexa {
  const cx = h.cx ?? 0;
  const xb = h.xb;
  const xt = h.xt ?? xb;
  const [b0, b1] = h.zb;
  const [t0, t1] = h.zt ?? h.zb;
  const { y0, y1 } = h;
  const B = (sx: number, z: number): V3 => [cx + sx * xb, y0, z];
  const T = (sx: number, z: number): V3 => [cx + sx * xt, y1, z];
  return {
    front: [B(-1, b1), B(1, b1), T(1, t1), T(-1, t1)],
    back: [B(1, b0), B(-1, b0), T(-1, t0), T(1, t0)],
    right: [B(1, b1), B(1, b0), T(1, t0), T(1, t1)],
    left: [B(-1, b0), B(-1, b1), T(-1, t1), T(-1, t0)],
    top: [T(-1, t1), T(1, t1), T(1, t0), T(-1, t0)],
    bottom: [B(-1, b0), B(1, b0), B(1, b1), B(-1, b1)],
    center: [cx, (y0 + y1) / 2, (b0 + b1 + t0 + t1) / 4],
  };
}

/** Pavé centré en (cx, ·, cz), de y0 à y1. */
function block(cx: number, y0: number, y1: number, cz: number, w: number, l: number): Hexa {
  return hexa({ cx, y0, y1, xb: w / 2, zb: [cz - l / 2, cz + l / 2] });
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Triangles accumulés par emplacement de matériau ; décalage en z (attelages recentrés). */
class Parts {
  readonly pos: number[][];
  dz = 0;
  constructor(slots: number) {
    this.pos = Array.from({ length: slots }, () => []);
  }

  /** Triangle orienté vers l'extérieur de `ref` (point intérieur du solide). */
  tri(s: number, a: V3, b: V3, c: V3, ref: V3): void {
    const n = cross(sub(b, a), sub(c, a));
    const g: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out = dot(n, sub(g, ref)) >= 0;
    const dst = this.pos[s] as number[];
    for (const p of out ? [a, b, c] : [a, c, b]) dst.push(p[0], p[1], p[2] + this.dz);
  }

  quad(s: number, q: Quad, ref: V3): void {
    this.tri(s, q[0], q[1], q[2], ref);
    this.tri(s, q[0], q[2], q[3], ref);
  }

  /** Solide fermé (sans sa face du dessous, invisible) ; `faces` : matériau propre à certaines faces. */
  solid(s: number, h: Hexa, faces: Partial<Record<'front' | 'back' | 'right' | 'left' | 'top', number>> = {}, bottom = false): void {
    for (const f of ['front', 'back', 'right', 'left', 'top'] as const) this.quad(faces[f] ?? s, h[f], h.center);
    if (bottom) this.quad(s, h.bottom, h.center);
  }

  /**
   * Pastille plate (vitre, phare, calandre) posée sur une face : sous-rectangle [u0, u1] × [v0, v1] de la face
   * (u le long du bord bas, v de bas en haut), décollée de `off` le long de sa normale.
   */
  panel(s: number, q: Quad, u0: number, u1: number, v0: number, v1: number, off = 0.012): void {
    const [a, b, c, d] = q;
    const P = (u: number, v: number) => lerp(lerp(a, b, u), lerp(d, c, u), v);
    const n = cross(sub(b, a), sub(d, a));
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const o: V3 = [(n[0] / len) * off, (n[1] / len) * off, (n[2] / len) * off];
    const lift = (p: V3): V3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    const p: Quad = [lift(P(u0, v0)), lift(P(u1, v0)), lift(P(u1, v1)), lift(P(u0, v1))];
    // Référence : en retrait derrière la pastille (orientation comme la face).
    const m = P((u0 + u1) / 2, (v0 + v1) / 2);
    this.quad(s, p, [m[0] - o[0] * 10, m[1] - o[1] * 10, m[2] - o[2] * 10]);
  }

  /** Pastilles symétriques sur les deux flancs ; u mesuré depuis l'avant. */
  sides(s: number, h: Hexa, u0: number, u1: number, v0: number, v1: number, off?: number): void {
    this.panel(s, h.right, u0, u1, v0, v1, off);
    this.panel(s, h.left, 1 - u1, 1 - u0, v0, v1, off);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const all: number[] = [];
    this.pos.forEach((p, slot) => {
      if (!p.length) return;
      g.addGroup(all.length / 3, p.length / 3, slot);
      for (const x of p) all.push(x);
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    // Non indexée : une normale par face (facettes), comme `flatShading`.
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

interface WheelSpec {
  x: number;
  z: number;
  r: number;
  w: number;
}

interface Shape {
  body: THREE.BufferGeometry;
  wheels: WheelSpec[];
  length: number;
  wheelRadius: number;
  /** Moyeux jaunes (machines agricoles) plutôt que gris. */
  yellowHubs?: boolean;
  /** Caisse de teinte imposée (vert tracteur). */
  paint?: string;
}

/**
 * Roue : prisme à `n` pans couché sur l'axe x (pneu), flancs pleins, moyeu hexagonal décollé de chaque côté
 * (couleur à part, la rotation se lit). Groupe 0 : pneu, groupe 1 : moyeu.
 */
function wheelGeometry(r: number, w: number, n: number): THREE.BufferGeometry {
  const p = new Parts(2);
  const o: V3 = [0, 0, 0];
  // Phase par défaut : milieu d'un pan en bas (angle 3π/2), quel que soit le nombre de pans.
  const at = (x: number, k: number, rad: number, m: number, phase = (3 * Math.PI) / 2 - Math.PI / m): V3 => {
    const a = (k / m) * Math.PI * 2 + phase;
    return [x, Math.sin(a) * rad, Math.cos(a) * rad];
  };
  const h = w / 2;
  // Pan du bas à plat sur la chaussée : apothème = r (sommets un peu au-delà).
  const R = r / Math.cos(Math.PI / n);
  for (let k = 0; k < n; k++) p.quad(0, [at(-h, k, R, n), at(h, k, R, n), at(h, k + 1, R, n), at(-h, k + 1, R, n)], o);
  for (const x of [-h, h]) {
    for (let k = 1; k < n - 1; k++) p.tri(0, at(x, 0, R, n), at(x, k, R, n), at(x, k + 1, R, n), o);
    // Moyeu : hexagone en saillie, tourné d'un demi-pan par rapport au pneu.
    const hx = x + Math.sign(x) * 0.015;
    const hr = r * 0.52;
    for (let k = 1; k < 5; k++) p.tri(1, at(hx, 0, hr, 6, 0), at(hx, k, hr, 6, 0), at(hx, k + 1, hr, 6, 0), o);
  }
  return p.geometry();
}

// ——— Silhouettes ———

interface CarDims {
  L: number;
  W: number;
  r: number;
  /** Bas de caisse, ceinture (bas des vitres), toit (m). */
  sill: number;
  belt: number;
  roof: number;
  /** Chanfrein du capot et de l'arrière (m, en z, au niveau de la ceinture). */
  nose: number;
  tail: number;
  /** Cabine (vitrage) : base et toit en z (arrière, avant). */
  cabB: [number, number];
  cabT: [number, number];
  axles: [number, number];
  rails?: boolean;
  cladding?: boolean;
  /** Montant central (deux vitres par flanc) ; sinon une seule. */
  pillar?: boolean;
}

/** Caisse basse (capot, coffre, chanfreins), feux, calandre, pare-chocs, passages de roue. */
function lowerBody(p: Parts, d: CarDims): Hexa {
  const lower = hexa({ y0: d.sill, y1: d.belt, xb: d.W / 2, zb: [-d.L / 2, d.L / 2], xt: d.W / 2 - 0.06, zt: [-d.L / 2 + d.tail, d.L / 2 - d.nose] });
  p.solid(S.Paint, lower);
  p.panel(S.Head, lower.front, 0.05, 0.25, 0.5, 0.86);
  p.panel(S.Head, lower.front, 0.75, 0.95, 0.5, 0.86);
  p.panel(S.Black, lower.front, 0.32, 0.68, 0.3, 0.78);
  p.panel(S.Tail, lower.back, 0.04, 0.22, 0.55, 0.9);
  p.panel(S.Tail, lower.back, 0.78, 0.96, 0.55, 0.9);
  const bumperY = d.sill + 0.02;
  p.solid(S.Black, block(0, bumperY, bumperY + 0.2, d.L / 2 - 0.02, d.W + 0.03, 0.16));
  p.solid(S.Black, block(0, bumperY, bumperY + 0.2, -d.L / 2 + 0.02, d.W + 0.03, 0.16));
  // Passages de roue : pastilles noires sur les flancs, au-dessus de chaque essieu.
  for (const z of d.axles) {
    const u = (d.L / 2 - z) / d.L;
    const du = (d.r * 1.2) / d.L;
    p.sides(S.Black, lower, u - du, u + du, 0, Math.min(0.75, (d.r * 1.15) / (d.belt - d.sill)), 0.006);
  }
  if (d.cladding) p.sides(S.Black, lower, 0.02, 0.98, 0, 0.28, 0.004);
  return lower;
}

/** Cabine vitrée (pare-brise, lunette, vitres latérales) et barres de toit. */
function greenhouse(p: Parts, d: CarDims, x0 = d.W / 2 - 0.08, x1 = d.W / 2 - 0.24): Hexa {
  const cab = hexa({ y0: d.belt, y1: d.roof, xb: x0, zb: d.cabB, xt: x1, zt: d.cabT });
  p.solid(S.Paint, cab);
  p.panel(S.Glass, cab.front, 0.06, 0.94, 0.06, 0.92);
  p.panel(S.Glass, cab.back, 0.08, 0.92, 0.12, 0.9);
  if (d.pillar) {
    p.sides(S.Glass, cab, 0.06, 0.48, 0.1, 0.88);
    p.sides(S.Glass, cab, 0.53, 0.94, 0.1, 0.88);
  } else p.sides(S.Glass, cab, 0.08, 0.9, 0.1, 0.88);
  if (d.rails)
    for (const sx of [-1, 1]) {
      const zs: [number, number] = [d.cabT[0] + 0.08, d.cabT[1] - 0.12];
      p.solid(S.Black, block(sx * (x1 - 0.08), d.roof, d.roof + 0.06, (zs[0] + zs[1]) / 2, 0.05, zs[1] - zs[0]));
    }
  return cab;
}

function wheelsAt(d: { W: number; r: number; axles: number[] }, w: number): WheelSpec[] {
  return d.axles.flatMap((z) => [1, -1].map((sx) => ({ x: sx * (d.W / 2 - w / 2 + 0.03), z, r: d.r, w })));
}

function car(d: CarDims): Shape {
  const p = new Parts(SLOT_COUNT);
  lowerBody(p, d);
  greenhouse(p, d);
  return { body: p.geometry(), wheels: wheelsAt(d, 0.22), length: d.L, wheelRadius: d.r };
}

function pickup(): Shape {
  const d: CarDims = { L: 5.1, W: 1.86, r: 0.38, sill: 0.42, belt: 1.05, roof: 1.78, nose: 0.4, tail: 0.04, cabB: [-0.2, 1.3], cabT: [-0.15, 0.85], axles: [-1.55, 1.5], cladding: true };
  const p = new Parts(SLOT_COUNT);
  const lower = lowerBody(p, d);
  const cab = hexa({ y0: d.belt, y1: d.roof, xb: d.W / 2 - 0.06, zb: d.cabB, xt: d.W / 2 - 0.18, zt: d.cabT });
  p.solid(S.Paint, cab);
  p.panel(S.Glass, cab.front, 0.06, 0.94, 0.06, 0.92);
  p.panel(S.Glass, cab.back, 0.15, 0.85, 0.35, 0.88);
  p.sides(S.Glass, cab, 0.08, 0.9, 0.1, 0.88);
  // Benne : plancher sombre, ridelles et hayon à la teinte de la caisse.
  const zt0 = -d.L / 2 + d.tail;
  const zt1 = d.L / 2 - d.nose;
  p.panel(S.Black, lower.top, 0.04, 0.96, (zt1 - (d.cabB[0] - 0.02)) / (zt1 - zt0), 0.99, 0.004);
  const bedL = d.cabB[0] - zt0;
  const bedZ = (d.cabB[0] + zt0) / 2;
  for (const sx of [-1, 1]) p.solid(S.Paint, block(sx * (d.W / 2 - 0.1), d.belt, d.belt + 0.32, bedZ, 0.08, bedL));
  p.solid(S.Paint, block(0, d.belt, d.belt + 0.32, zt0 + 0.05, d.W - 0.12, 0.08));
  return { body: p.geometry(), wheels: wheelsAt(d, 0.26), length: d.L, wheelRadius: d.r };
}

function fourgon(): Shape {
  const d: CarDims = { L: 4.9, W: 1.9, r: 0.34, sill: 0.34, belt: 1.02, roof: 2.0, nose: 0.42, tail: 0.04, cabB: [-2.42, 1.25], cabT: [-2.4, 0.78], axles: [-1.65, 1.55] };
  const p = new Parts(SLOT_COUNT);
  lowerBody(p, d);
  const box = hexa({ y0: d.belt, y1: d.roof, xb: d.W / 2 - 0.05, zb: d.cabB, xt: d.W / 2 - 0.12, zt: d.cabT });
  p.solid(S.Paint, box);
  p.panel(S.Glass, box.front, 0.05, 0.95, 0.06, 0.9);
  p.sides(S.Glass, box, 0.02, 0.24, 0.12, 0.86);
  // Portes arrière : deux petites vitres, feux verticaux aux coins.
  p.panel(S.Glass, box.back, 0.08, 0.46, 0.5, 0.88);
  p.panel(S.Glass, box.back, 0.54, 0.92, 0.5, 0.88);
  p.panel(S.Black, box.back, 0.495, 0.505, 0.02, 0.98, 0.006);
  p.panel(S.Tail, box.back, 0.0, 0.05, 0.05, 0.4);
  p.panel(S.Tail, box.back, 0.95, 1.0, 0.05, 0.4);
  return { body: p.geometry(), wheels: wheelsAt(d, 0.24), length: d.L, wheelRadius: d.r };
}

function camion(): Shape {
  const L = 7.0;
  const W = 2.3;
  const r = 0.47;
  const p = new Parts(SLOT_COUNT);
  // Châssis.
  p.solid(S.Black, block(0, 0.5, 0.82, -0.05, 1.0, L - 0.3));
  // Cabine : soubassement puis partie vitrée (pare-brise incliné).
  const low = hexa({ y0: 0.55, y1: 1.55, xb: W / 2 - 0.02, zb: [1.85, L / 2], xt: W / 2 - 0.04, zt: [1.88, L / 2 - 0.08] });
  p.solid(S.Paint, low);
  p.panel(S.Head, low.front, 0.04, 0.2, 0.3, 0.55);
  p.panel(S.Head, low.front, 0.8, 0.96, 0.3, 0.55);
  p.panel(S.Black, low.front, 0.26, 0.74, 0.25, 0.85);
  const cab = hexa({ y0: 1.55, y1: 2.8, xb: W / 2 - 0.04, zb: [1.88, L / 2 - 0.08], xt: W / 2 - 0.1, zt: [1.92, L / 2 - 0.35] });
  p.solid(S.Paint, cab);
  p.panel(S.Glass, cab.front, 0.05, 0.95, 0.08, 0.9);
  p.sides(S.Glass, cab, 0.04, 0.6, 0.12, 0.85);
  p.solid(S.Black, block(0, 0.42, 0.68, L / 2 - 0.02, W + 0.02, 0.18));
  // Caisse frigorifique blanche, bandeau à la teinte de la cabine.
  const box = hexa({ y0: 0.95, y1: 3.4, xb: W / 2 + 0.02, zb: [-L / 2, 1.78] });
  p.solid(S.Cargo, box);
  p.sides(S.Paint, box, 0.04, 0.96, 0.62, 0.8, 0.008);
  p.panel(S.Black, box.back, 0.495, 0.505, 0.02, 0.98, 0.006);
  p.panel(S.Tail, box.back, 0.02, 0.14, 0.02, 0.1);
  p.panel(S.Tail, box.back, 0.86, 0.98, 0.02, 0.1);
  p.solid(S.Black, block(0, 0.42, 0.6, -L / 2 + 0.08, W - 0.1, 0.12));
  const wheels = wheelsAt({ W, r, axles: [-2.75, -1.75, 2.6] }, 0.4);
  return { body: p.geometry(), wheels, length: L, wheelRadius: r };
}

const TRACTOR_GREEN = '#3d9b35';

/** Tracteur (grandes roues arrière, petites à l'avant), seul ou attelé à une benne chargée de paille. */
function tracteur(trailer: boolean): Shape {
  const p = new Parts(SLOT_COUNT);
  // Emprise : tracteur de −1,8 (attelage) à +2,15 (calandre) ; remorque jusqu'à −5,64. Recentré sur 0.
  const zMin = trailer ? -5.64 : -1.8;
  const zMax = 2.15;
  p.dz = -(zMin + zMax) / 2;
  // Capot (moteur) effilé vers l'avant, calandre et phares.
  const hood = hexa({ y0: 0.72, y1: 1.45, xb: 0.42, zb: [-0.05, 2.15], xt: 0.36, zt: [-0.05, 1.98] });
  p.solid(S.Paint, hood);
  p.panel(S.Black, hood.front, 0.15, 0.85, 0.08, 0.7);
  p.panel(S.Head, hood.front, 0.08, 0.3, 0.75, 0.94);
  p.panel(S.Head, hood.front, 0.7, 0.92, 0.75, 0.94);
  p.solid(S.Black, block(0, 0.42, 0.75, 0.5, 0.62, 2.9));
  // Poste de conduite : plancher, cabine vitrée sur ses quatre faces, toit noir.
  p.solid(S.Paint, block(0, 1.05, 1.3, -0.62, 1.2, 1.4));
  const cab = hexa({ y0: 1.3, y1: 2.7, xb: 0.6, zb: [-1.3, 0.06], xt: 0.56, zt: [-1.22, -0.04] });
  p.solid(S.Paint, cab);
  p.panel(S.Glass, cab.front, 0.07, 0.93, 0.05, 0.95);
  p.panel(S.Glass, cab.back, 0.07, 0.93, 0.05, 0.95);
  p.sides(S.Glass, cab, 0.06, 0.94, 0.05, 0.95);
  p.solid(S.Black, block(0, 2.7, 2.84, -0.6, 1.36, 1.6));
  // Garde-boue arrière, pot d'échappement, attelage.
  for (const sx of [-1, 1]) p.solid(S.Paint, hexa({ cx: sx * 0.88, y0: 1.5, y1: 1.62, xb: 0.3, zb: [-1.5, -0.08], xt: 0.28, zt: [-1.42, -0.16] }));
  p.solid(S.Black, block(0.24, 1.45, 2.6, 1.55, 0.08, 0.08));
  p.solid(S.Black, block(0, 0.55, 0.72, -1.6, 0.22, 0.4));
  const wheels: WheelSpec[] = [];
  for (const sx of [-1, 1]) {
    wheels.push({ x: sx * 0.88, z: -0.78, r: 0.78, w: 0.48 });
    wheels.push({ x: sx * 0.62, z: 1.38, r: 0.42, w: 0.28 });
  }
  if (trailer) {
    p.solid(S.Black, block(0, 0.58, 0.7, -2.15, 0.14, 1.1));
    const bed = hexa({ y0: 0.88, y1: 1.6, xb: 1.0, zb: [-5.6, -2.6], xt: 1.04, zt: [-5.64, -2.56] });
    p.solid(S.Accent, bed, { top: S.Load });
    p.panel(S.Tail, bed.back, 0.03, 0.13, 0.05, 0.2);
    p.panel(S.Tail, bed.back, 0.87, 0.97, 0.05, 0.2);
    for (const sx of [-1, 1]) wheels.push({ x: sx * 0.86, z: -4.1, r: 0.44, w: 0.3 });
  }
  for (const w of wheels) w.z += p.dz;
  return { body: p.geometry(), wheels, length: zMax - zMin, wheelRadius: 0.78, yellowHubs: true, paint: TRACTOR_GREEN };
}

const SHAPES: Record<LowPolyVariant, () => Shape> = {
  citadine: () => car({ L: 3.8, W: 1.68, r: 0.3, sill: 0.3, belt: 0.88, roof: 1.46, nose: 0.42, tail: 0.06, cabB: [-1.84, 0.62], cabT: [-1.7, -0.2], axles: [-1.25, 1.25], pillar: true }),
  berline: () => car({ L: 4.6, W: 1.78, r: 0.32, sill: 0.3, belt: 0.84, roof: 1.42, nose: 0.5, tail: 0.18, cabB: [-1.2, 0.8], cabT: [-0.78, 0.18], axles: [-1.4, 1.4], pillar: true }),
  break: () => car({ L: 4.7, W: 1.8, r: 0.32, sill: 0.3, belt: 0.86, roof: 1.46, nose: 0.5, tail: 0.05, cabB: [-2.25, 0.8], cabT: [-2.18, 0.15], axles: [-1.45, 1.42], pillar: true, rails: true }),
  suv: () => car({ L: 4.5, W: 1.88, r: 0.38, sill: 0.42, belt: 1.06, roof: 1.72, nose: 0.42, tail: 0.08, cabB: [-2.1, 0.72], cabT: [-1.98, 0.0], axles: [-1.38, 1.36], pillar: true, rails: true, cladding: true }),
  pickup,
  fourgon,
  camion,
  tracteur: () => tracteur(false),
  tracteurRemorque: () => tracteur(true),
};

// ——— Partage des géométries et matériaux ———

const shapes = new Map<LowPolyVariant, Shape>();
const wheelGeos = new Map<string, THREE.BufferGeometry>();
const paints = new Map<string, THREE.Material[]>();
let shared: { glass: THREE.Material; black: THREE.Material; head: THREE.Material; tail: THREE.Material; grey: THREE.Material; cargo: THREE.Material; accent: THREE.Material; load: THREE.Material; tire: THREE.Material; hub: THREE.Material; hubYellow: THREE.Material } | null = null;

function flat(color: string, roughness = 0.6, emissive = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0 });
  m.flatShading = true;
  if (emissive) {
    m.emissive.set(color);
    m.emissiveIntensity = emissive;
  }
  return m;
}

function sharedMaterials(): NonNullable<typeof shared> {
  shared ??= {
    glass: flat('#1d2a3c', 0.3),
    black: flat('#1b1c1f', 0.75),
    head: flat('#fff3c4', 0.4, 0.35),
    tail: flat('#d0161f', 0.5, 0.25),
    grey: flat('#9aa0a8', 0.5),
    cargo: flat('#f1f1ec'),
    accent: flat('#b8322a'),
    load: flat('#e0bd52', 0.85),
    tire: flat('#222225', 0.9),
    hub: flat('#c3c8ce', 0.45),
    hubYellow: flat('#f2c230', 0.5),
  };
  return shared;
}

/** Matériaux de caisse (dans l'ordre des emplacements S) pour une teinte. */
function bodyMaterials(color: string): THREE.Material[] {
  let m = paints.get(color);
  if (!m) {
    const s = sharedMaterials();
    m = [flat(color), s.glass, s.black, s.head, s.tail, s.grey, s.cargo, s.accent, s.load];
    paints.set(color, m);
  }
  return m;
}

function wheelGeo(r: number, w: number): THREE.BufferGeometry {
  const key = `${r}|${w}`;
  let g = wheelGeos.get(key);
  if (!g) wheelGeos.set(key, (g = wheelGeometry(r, w, r > 0.6 ? 10 : 8)));
  return g;
}

/** Nombre de triangles d'une variante (caisse et roues), pour le contrôle du budget. */
export function lowPolyTriangles(variant: LowPolyVariant): number {
  const s = shapeOf(variant);
  const tris = (g: THREE.BufferGeometry) => (g.getAttribute('position').count / 3) | 0;
  return tris(s.body) + s.wheels.reduce((n, w) => n + tris(wheelGeo(w.r, w.w)), 0);
}

function shapeOf(variant: LowPolyVariant): Shape {
  let s = shapes.get(variant);
  if (!s) {
    s = SHAPES[variant]();
    // Longueur hors tout (pare-chocs compris) : sert à l'espacement des véhicules et à l'aspiration.
    const bb = s.body.boundingBox;
    if (bb) s.length = Math.max(s.length, bb.max.z - bb.min.z);
    shapes.set(variant, s);
  }
  return s;
}

/** Une instance de la variante, caisse de teinte `color` (le tracteur garde son vert). */
export function buildLowPolyVehicle(variant: LowPolyVariant, color: string): LowPolyBuilt {
  const spec = LOW_POLY_VARIANTS[variant];
  const shape = shapeOf(variant);
  const s = sharedMaterials();
  const group = new THREE.Group();
  group.name = `vehicle-${variant}`;
  const body = new THREE.Mesh(shape.body, bodyMaterials(shape.paint ?? color));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const wheelMats = [s.tire, shape.yellowHubs ? s.hubYellow : s.hub];
  const wheels: THREE.Object3D[] = [];
  for (const w of shape.wheels) {
    const mesh = new THREE.Mesh(wheelGeo(w.r, w.w), wheelMats);
    mesh.name = 'wheel';
    mesh.position.set(w.x, w.r, w.z);
    mesh.userData.radius = w.r;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    wheels.push(mesh);
  }
  return { kind: spec.kind, group, wheels, length: shape.length, wheelRadius: shape.wheelRadius, cruise: spec.cruise };
}
