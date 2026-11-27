/**
 * Lieux habités des Rizières et de la jungle : rues dessinées des villes et villages, station balnéaire de
 * Plage-de-Jade (front de mer, promenade, paillotes, bungalows, hôtels), maisons le long des rues, fermes à buffles,
 * temples, pagodes, stupas et ruines envahies par la jungle.
 */
import { A, ANNEAU, MASSIF, SADDLE, TEMPLE_HILL, TOWNS, UV, coastPoint, inHarbour, inLake, inRiver, shoreDist, terrain, type Town, type Vec2 } from './design.ts';
import { orientedRect, pointInPolygon } from './geom.ts';
import { rng } from './noise.ts';
import { RoadIndex, finalHeight, type Road, type RoadSpec } from './roads.ts';
import type { Area, Building, Place } from './types.ts';

// ── Rues des villes ──

export interface TownLayout {
  town: Town;
  specs: RoadSpec[];
  /** Portes : extrémités des rues où le réseau se raccorde. */
  gates: Vec2[];
  /** Église, mairie, place. */
  centre: Vec2;
  frame: { u: Vec2; v: Vec2 };
}

const STREET_NAMES = [
  ['Rue du Marché', 'Rue du Temple', 'Rue des Lotus', 'Rue des Bambous'],
  ['Rue Principale', 'Rue des Lanternes', 'Rue des Palmiers', 'Rue des Rizières'],
  ['Rue Haute', 'Rue Basse', 'Rue des Manguiers', 'Rue des Bananiers'],
  ['Quai des Jonques', 'Rue des Pêcheurs', 'Rue des Filets', 'Rue de la Cale'],
  ['Grand-Rue', 'Rue des Théiers', 'Chemin des Fougères', 'Rue de la Cascade'],
];

export function townLayout(t: Town, k: number): TownLayout {
  if (t.seaside) return seasideLayout(t);
  const u: Vec2 = [Math.cos(t.angle), Math.sin(t.angle)];
  const v: Vec2 = [-u[1], u[0]];
  const P = (a: number, b: number): Vec2 => [t.x + a * u[0] + b * v[0], t.z + a * u[1] + b * v[1]];
  const r = rng(k * 977 + 13);
  const L = t.r * 1.1;
  const names = STREET_NAMES[t.port ? 3 : t.level > 300 ? 4 : k % 3]!;
  const kindMain = t.size === 'hameau' ? 'residential' : 'tertiary';
  const specs: RoadSpec[] = [
    { id: `${t.id}-main`, name: `${names[0]} (${t.name})`, kind: kindMain, width: t.size === 'hameau' ? 5 : 6.5, pts: [P(-L, (r() - 0.5) * 0.18 * t.r), P(-0.7 * t.r, 0), P(0, 0), P(0.7 * t.r, 0), P(L, (r() - 0.5) * 0.18 * t.r)], designed: true, gmax: 0.1 },
  ];
  const gates: Vec2[] = [P(-L, 0), P(L, 0)];
  if (t.size !== 'hameau') {
    const C = t.r * 0.8;
    specs.push({ id: `${t.id}-cross`, name: `${names[1]} (${t.name})`, kind: 'residential', width: 5.5, pts: [P((r() - 0.5) * 0.15 * t.r, -C), P(0, -0.45 * t.r), P(0, 0), P(0, 0.45 * t.r), P((r() - 0.5) * 0.15 * t.r, C)], designed: true, gmax: 0.11 });
    gates.push(P(0, -C), P(0, C));
  }
  if (t.size === 'bourg' || t.size === 'ville') {
    for (const s of [-1, 1]) {
      specs.push({
        id: `${t.id}-back${s > 0 ? 'b' : 'a'}`,
        name: `${names[s > 0 ? 2 : 3]} (${t.name})`,
        kind: 'residential',
        width: 5,
        pts: [P(-0.55 * t.r, 0), P(-0.55 * t.r, s * 0.36 * t.r), P(0.55 * t.r, s * 0.36 * t.r), P(0.55 * t.r, 0)],
        designed: true,
        gmax: 0.12,
        smooth: 3,
      });
    }
  }
  // Rues : endroits où le réseau se raccorde, vus depuis l'extrémité des rues dessinées.
  return { town: t, specs, gates, centre: [t.x, t.z], frame: { u, v } };
}

/** Station balnéaire de Plage-de-Jade : boulevard de Jade, promenade en bois sous les cocotiers, rues en damier. */
function seasideLayout(t: Town): TownLayout {
  const ang = Math.atan2(t.z, t.x);
  const along = (a0: number, a1: number, inset: number, n = 40): Vec2[] => Array.from({ length: n + 1 }, (_, i) => coastPoint(a0 + ((a1 - a0) * i) / n, inset));
  // Est (vers le port) : angles plus petits.
  const east = ang - 0.055;
  const west = ang + 0.145;
  const specs: RoadSpec[] = [
    { id: `${t.id}-boulevard`, name: 'Boulevard de Jade', kind: 'tertiary', width: 8, pts: along(east, west, 185, 60), designed: true, gmax: 0.06, smooth: 2 },
    { id: `${t.id}-planches`, name: 'La Promenade des Cocotiers', kind: 'cycleway', width: 4, surface: 'wood', pts: along(east + 0.006, west - 0.006, 125, 50), designed: true, gmax: 0.04, smooth: 2 },
    // Accès aux planches : perpendiculaires au front de mer (virages francs dans les deux sens).
    { id: `${t.id}-planches-est`, name: 'La Promenade des Cocotiers', kind: 'cycleway', width: 4, surface: 'wood', pts: [coastPoint(east + 0.006, 125), coastPoint(east + 0.006, 185)], designed: true, gmax: 0.06, smooth: 0 },
    { id: `${t.id}-planches-ouest`, name: 'La Promenade des Cocotiers', kind: 'cycleway', width: 4, surface: 'wood', pts: [coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185)], designed: true, gmax: 0.06, smooth: 0 },
    { id: `${t.id}-rue-mer`, name: 'Rue du Lagon', kind: 'residential', width: 6, pts: along(east + 0.012, west - 0.012, 480, 40), designed: true, gmax: 0.08, smooth: 2 },
    { id: `${t.id}-rue-casino`, name: 'Rue du Marché de nuit', kind: 'residential', width: 6, pts: along(east + 0.012, west - 0.012, 800, 40), designed: true, gmax: 0.09, smooth: 2 },
    { id: `${t.id}-avenue`, name: 'Avenue des Flamboyants', kind: 'tertiary', width: 7, pts: [coastPoint(ang, 185), coastPoint(ang, 480), coastPoint(ang, 800), coastPoint(ang, 1350)], designed: true, gmax: 0.08, smooth: 0 },
  ];
  // Rues perpendiculaires au front de mer.
  const side = [-0.035, -0.012, 0.025, 0.05, 0.075, 0.1, 0.125].map((da, i) => ({
    id: `${t.id}-rue-${i}`,
    name: ['Rue des Bains', 'Rue des Cocotiers', 'Rue des Frangipaniers', 'Rue des Bungalows', 'Rue des Tortues', 'Rue des Orchidées', 'Rue des Palmiers'][i]!,
    kind: 'residential',
    width: 5.5,
    pts: [coastPoint(ang + da, 185), coastPoint(ang + da, 480), coastPoint(ang + da, 800)],
    designed: true,
    gmax: 0.1,
    smooth: 0,
  }));
  specs.push(...side);
  const gates: Vec2[] = [coastPoint(east, 185), coastPoint(west, 185), coastPoint(ang, 1350), coastPoint(east + 0.012, 800), coastPoint(west - 0.012, 800)];
  const u: Vec2 = [-Math.sin(ang), Math.cos(ang)];
  const v: Vec2 = [Math.cos(ang), Math.sin(ang)];
  return { town: t, specs, gates, centre: coastPoint(ang, 640), frame: { u, v } };
}

/** L'Anneau : boucle dessinée ; les raccords se font sur des points choisis de la boucle. */
export const ANNEAU_GATES: Vec2[] = [
  [ANNEAU.cx + ANNEAU.half + ANNEAU.radius, ANNEAU.cz], // pointe est
  [ANNEAU.cx - ANNEAU.half - ANNEAU.radius, ANNEAU.cz], // pointe ouest
  [ANNEAU.cx + ANNEAU.half - 2, ANNEAU.cz - ANNEAU.radius], // fin de la ligne droite nord
  [ANNEAU.cx - 250, ANNEAU.cz + ANNEAU.radius + 9], // ligne droite sud, après les tribunes
];

// ── Bâtiments ──

/**
 * Palettes (mêmes clés que le Pays de Robert) : maisons de bois et d'enduit ocre, toits de tuiles (« tiles ») ou de
 * chaume (« slate » ici : le client lui donne la couleur de la paille, lands/rizieres.ts), tôle en montagne.
 */
const PALETTES = {
  village: { walls: ['#e8c48a', '#f1d9a8', '#d9a066', '#f4eadb', '#c98f5a', '#e9d27c', '#b9d6c4', '#f0c3a0', '#d8b48a', '#e3e8c8'], roofs: ['tiles', 'tiles', 'slate'] },
  breton: { walls: ['#8a5a36', '#9c6a40', '#7a4e2e', '#b07a4c'], roofs: ['slate', 'tiles'] },
  villa: { walls: ['#f6efe0', '#f2e4c8', '#fbf7ee', '#e9dcc0', '#f3e0c6'], roofs: ['slate', 'tiles', 'slate'] },
  farm: { walls: ['#9c6a40', '#8a5a36', '#b48a5c', '#a27648'], roofs: ['slate', 'slate', 'tiles'] },
  provence: { walls: ['#e6b980', '#d9a066', '#f0d6a8', '#c98f5a', '#e9c58f', '#e2d2b0', '#f3e2c0', '#cf9466'], roofs: ['tiles', 'slate'] },
  chalet: { walls: ['#7a4e2e', '#8a5a36', '#6a4428', '#a27648', '#94683e', '#86603e'], roofs: ['metal', 'slate', 'tiles'] },
};

class Occupancy {
  private cells = new Map<number, Vec2[][]>();
  add(poly: Vec2[]): void {
    for (const k of this.keys(poly)) (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(poly);
  }
  hits(poly: Vec2[]): boolean {
    for (const k of this.keys(poly))
      for (const o of this.cells.get(k) ?? []) if (poly.some(([x, z]) => pointInPolygon(x, z, o)) || o.some(([x, z]) => pointInPolygon(x, z, poly)) || edgesCross(poly, o)) return true;
    return false;
  }
  private keys(poly: Vec2[]): number[] {
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    const out: number[] = [];
    for (let i = Math.floor(Math.min(...xs) / 40); i <= Math.floor(Math.max(...xs) / 40); i++) for (let j = Math.floor(Math.min(...zs) / 40); j <= Math.floor(Math.max(...zs) / 40); j++) out.push(i * 100003 + j);
    return out;
  }
}

function edgesCross(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const u = b[j]!;
      const w = b[(j + 1) % b.length]!;
      const d = (q[0] - p[0]) * (w[1] - u[1]) - (q[1] - p[1]) * (w[0] - u[0]);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((u[0] - p[0]) * (w[1] - u[1]) - (u[1] - p[1]) * (w[0] - u[0])) / d;
      const s = ((u[0] - p[0]) * (q[1] - p[1]) - (u[1] - p[1]) * (q[0] - p[0])) / d;
      if (t > 0 && t < 1 && s > 0 && s < 1) return true;
    }
  }
  return false;
}

export class Builder {
  readonly out: Building[] = [];
  readonly areas: Area[] = [];
  readonly places: Place[] = [];
  private occ = new Occupancy();
  private n = 0;

  constructor(private readonly idx: RoadIndex) {}

  /** Emprise libre : hors chaussée (marge), hors eau, pas trop pentue, sans chevauchement. */
  fits(poly: Vec2[], margin = 2.5): boolean {
    const pts: Vec2[] = [...poly];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      pts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    pts.push([cx, cz]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of pts) {
      if (this.idx.edgeDist(x, z) < margin) return false;
      if (inLake(x, z, 1.25) || inRiver(x, z, 6) || inHarbour(x, z, 6) || shoreDist(x, z) < 40) return false;
      const h = terrain(x, z);
      if (h < 0.8) return false;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > 3) return false;
    return !this.occ.hits(poly);
  }

  add(b: Omit<Building, 'id' | 'y'> & { id?: string }, margin = 2.5, force = false): boolean {
    if (!force && !this.fits(b.pts, margin)) return false;
    this.occ.add(b.pts);
    // Un peu enfoncé : le sol du jeu (grille de 2 m) passe parfois quelques centimètres sous les coins.
    const y = Math.min(...b.pts.map(([x, z]) => finalHeight(this.idx, x, z))) - 0.15;
    this.out.push({ ...b, id: b.id ?? `b${this.n++}`, y });
    return true;
  }

  /** Maisons des deux côtés d'une rue, entre les indices i0 et i1 de ses points. */
  street(road: Road, opts: { spacing: number; setback: number; depth: [number, number]; len: [number, number]; levels: [number, number]; palette: keyof typeof PALETTES; inside?: (x: number, z: number) => boolean; seed: number; kind?: string; apartments?: number; sides?: number[] }): void {
    const r = rng(opts.seed);
    const pal = PALETTES[opts.palette];
    const step = Math.max(2, Math.round(opts.spacing / 2));
    for (let i = 4; i < road.pts.length - 4; i += step) {
      const a = road.pts[i - 2]!;
      const b = road.pts[i + 2]!;
      const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
      for (const side of opts.sides ?? [1, -1]) {
        if (r() < 0.12) continue;
        const depth = opts.depth[0] + r() * (opts.depth[1] - opts.depth[0]);
        const len = opts.len[0] + r() * (opts.len[1] - opts.len[0]);
        const off = road.width / 2 + opts.setback + depth / 2 + r() * 1.5;
        const cx = road.pts[i]![0] - Math.sin(ang) * off * side;
        const cz = road.pts[i]![2] + Math.cos(ang) * off * side;
        if (opts.inside && !opts.inside(cx, cz)) continue;
        const apt = opts.apartments && r() < opts.apartments;
        const levels = apt ? 3 + Math.floor(r() * 2) : opts.levels[0] + Math.floor(r() * (opts.levels[1] - opts.levels[0] + 1));
        const poly = orientedRect(cx, cz, len / 2, depth / 2, ang);
        const roofMat = pal.roofs[Math.floor(r() * pal.roofs.length)]!;
        this.add({
          kind: apt ? 'apartments' : opts.kind ?? 'house',
          height: 3 * levels + (apt ? 3.2 : 2.8),
          levels,
          roof: { shape: r() < 0.4 ? 'gabled' : 'hipped', height: 3.2, material: roofMat },
          colour: pal.walls[Math.floor(r() * pal.walls.length)]!,
          pts: poly,
        });
      }
    }
  }

  /** Emprise gardée libre de maisons (place). */
  reserve(poly: Vec2[]): void {
    this.occ.add(poly);
  }

  area(kind: string, layer: Area['layer'], ring: Vec2[], name?: string): void {
    this.areas.push({ id: `a${this.areas.length}`, kind, layer, ring, ...(name ? { name } : {}) });
  }
}

/** Centre de ville : temple et son stupa, maison commune, école, place du marché, échoppes, stade. */
export function townCentre(B: Builder, lay: TownLayout, k: number): void {
  const t = lay.town;
  const { u, v } = lay.frame;
  const [cx, cz] = lay.centre;
  const P = (a: number, b: number): Vec2 => [cx + a * u[0] + b * v[0], cz + a * u[1] + b * v[1]];
  const ang = Math.atan2(u[1], u[0]);
  B.places.push({ name: t.name, kind: t.size === 'ville' ? 'town' : t.size === 'hameau' ? 'hamlet' : 'village', x: cx, z: cz });
  if (t.seaside) return;
  if (t.size !== 'hameau') B.area('retail', 'landuse', orientedRect(cx, cz, 22, 22, ang), `Place de ${t.name}`);
  // Temple au coin de la place (toit en croupe très relevé), stupa doré accolé.
  const eg = P(30, -30);
  const nef = orientedRect(eg[0], eg[1], t.size === 'hameau' ? 7 : 13, t.size === 'hameau' ? 5 : 8, ang);
  if (B.add({ kind: 'temple', height: t.size === 'hameau' ? 8 : 12, levels: 1, roof: { shape: 'hipped', height: 6, material: 'tiles' }, colour: '#f4ead2', material: 'plaster', pts: nef, name: t.size === 'hameau' ? `Sanctuaire de ${t.name}` : `Temple de ${t.name}` }, 2)) {
    const cl = P(30 - (t.size === 'hameau' ? 10 : 18), -30);
    B.add({ kind: 'tower', height: t.size === 'hameau' ? 9 : 14, levels: 1, roof: { shape: 'pyramidal', height: 6, material: 'metal' }, colour: '#e8c35a', material: 'plaster', pts: orientedRect(cl[0], cl[1], 3, 3, ang), ...(t.size === 'hameau' ? {} : { name: `Stupa de ${t.name}` }) }, 1, true);
  }
  if (t.size === 'hameau') return;
  const mairie = P(-34, 30);
  B.add({ kind: 'public', height: 9, levels: 2, roof: { shape: 'hipped', height: 3.5, material: 'tiles' }, colour: '#f3e6c8', pts: orientedRect(mairie[0], mairie[1], 12, 7, ang), name: `Maison commune de ${t.name}` }, 2);
  const ecole = P(-0.4 * t.r, -0.22 * t.r);
  B.add({ kind: 'public', height: 8, levels: 2, roof: { shape: 'hipped', height: 3, material: 'tiles' }, colour: '#f1d9b0', pts: orientedRect(ecole[0], ecole[1], 20, 7, ang), name: `École de ${t.name}` }, 3);
  // Échoppes autour de la place du marché.
  for (const [a, b, name] of [[34, 30, 'Échoppe de nouilles'], [-34, -30, 'Marchand de thé'], [60, 30, 'Épicerie']] as const) {
    const p = P(a, b);
    B.add({ kind: 'commercial', height: 9, levels: 2, roof: { shape: 'gabled', height: 3, material: 'tiles' }, colour: ['#f4c9a8', '#e9d8b6', '#cfe3e0'][k % 3]!, pts: orientedRect(p[0], p[1], 7, 6, ang), name }, 2);
  }
  // Place du bourg : les maisons des rues s'arrêtent à ses bords (marché et lanternes : lands/rizieresSites.ts).
  if (t.size === 'bourg') B.reserve(orientedRect(cx, cz, 27, 23, ang));
  // Stade et cimetière en lisière.
  const st = P(0.75 * t.r, 0.55 * t.r);
  const stade = orientedRect(st[0], st[1], 52, 34, ang);
  if (B.fits(stade, 4)) B.area('pitch', 'landuse', stade, `Stade de ${t.name}`);
  const ci = P(-0.75 * t.r, 0.5 * t.r);
  const cim = orientedRect(ci[0], ci[1], 28, 20, ang);
  if (B.fits(cim, 4)) B.area('garden', 'landuse', cim, `Jardin de ${t.name}`);
}

/** Plage-de-Jade : hôtels, marché de nuit, bungalows face à la mer, paillotes sur le sable blanc. */
export function seasideBuildings(B: Builder, lay: TownLayout): void {
  const t = lay.town;
  const ang = Math.atan2(t.z, t.x);
  const tangent = (a: number) => {
    const p = coastPoint(a - 0.001, 0);
    const q = coastPoint(a + 0.001, 0);
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  const r = rng(4242);
  // Front de mer : bâtiments entre le boulevard (185 m) et la rue de la Mer (480 m), face à la mer.
  const specials: Array<[number, Omit<Building, 'id' | 'y' | 'pts'>, number, number]> = [
    [ang - 0.02, { kind: 'apartments', height: 16, levels: 4, roof: { shape: 'hipped', height: 5, material: 'tiles' }, colour: '#f6efe0', name: 'Hôtel des Cocotiers' }, 42, 11],
    [ang + 0.018, { kind: 'commercial', height: 9, levels: 1, roof: { shape: 'hipped', height: 5, material: 'slate' }, colour: '#e8c48a', name: 'Marché de nuit de Plage-de-Jade' }, 30, 18],
    [ang + 0.058, { kind: 'apartments', height: 15, levels: 4, roof: { shape: 'hipped', height: 5, material: 'tiles' }, colour: '#f3e3cf', name: 'Hôtel du Lagon' }, 36, 12],
    [ang + 0.095, { kind: 'apartments', height: 12, levels: 3, roof: { shape: 'hipped', height: 4, material: 'slate' }, colour: '#e9dcc4', name: 'Hôtel des Orchidées' }, 30, 11],
  ];
  for (const [a, b, hl, hw] of specials) {
    const [x, z] = coastPoint(a, 215 + hw);
    B.add({ ...b, pts: orientedRect(x, z, hl, hw, tangent(a)) }, 3);
  }
  // Bungalows le long du front de mer, toits de chaume ou de tuiles.
  for (let a = ang - 0.05; a < ang + 0.14; a += 0.0028) {
    const [x, z] = coastPoint(a, 205 + 8 + r() * 6);
    const lv = 2 + (r() < 0.4 ? 1 : 0);
    B.add({ kind: 'house', height: 3 * lv + 4, levels: lv, roof: { shape: r() < 0.3 ? 'gabled' : 'hipped', height: 4, material: r() < 0.6 ? 'slate' : 'tiles' }, colour: PALETTES.villa.walls[Math.floor(r() * 5)]!, pts: orientedRect(x, z, 7 + r() * 3, 6 + r() * 2, tangent(a)) }, 2.5);
  }
  // Paillotes de bois sur le sable blanc, en rangées devant la promenade.
  const colours = ['#9c6a40', '#b07a4c', '#8a5a36', '#c49060', '#a27648'];
  let c = 0;
  for (let a = ang - 0.045; a < ang + 0.13; a += 0.0009) {
    if (Math.floor((a - ang) / 0.012) % 3 === 2) continue; // trouées pour descendre à la plage
    const [x, z] = coastPoint(a, 100);
    B.add({ kind: 'shed', height: 2.6, levels: 1, roof: { shape: 'hipped', height: 0.9, material: 'slate' }, colour: colours[c++ % colours.length]!, pts: orientedRect(x, z, 0.85, 0.9, tangent(a)), name: c === 1 ? 'Paillotes de la plage' : undefined } as Omit<Building, 'id' | 'y'>, 1.2);
  }
  // Postes de secours.
  for (const a of [ang - 0.03, ang + 0.05, ang + 0.11]) {
    const [x, z] = coastPoint(a, 60);
    B.add({ kind: 'tower', height: 5, levels: 1, roof: { shape: 'pyramidal', height: 1.2, material: 'tiles' }, colour: '#ffffff', pts: orientedRect(x, z, 1.5, 1.5, tangent(a)), name: 'Poste de secours' }, 1);
  }
  B.places.push({ name: 'La Plage', kind: 'locality', x: coastPoint(ang, 60)[0], z: coastPoint(ang, 60)[1] });
  // Plage jusqu'aux planches, jardins publics, golf et hippodrome sur les hauteurs.
  const beach: Vec2[] = [];
  for (let a = ang - 0.06; a <= ang + 0.15; a += 0.003) beach.push(coastPoint(a, -45));
  for (let a = ang + 0.15; a >= ang - 0.06; a -= 0.003) beach.push(coastPoint(a, 112));
  B.area('sand', 'fields', beach, 'Plage de Jade');
  const golf = coastPoint(ang + 0.03, 1750);
  B.area('golf', 'landuse', orientedRect(golf[0], golf[1], 420, 220, tangent(ang)), 'Golf des Palmiers');
  const hipp = coastPoint(ang - 0.04, 1250);
  B.area('park', 'landuse', orientedRect(hipp[0], hipp[1], 300, 120, tangent(ang)), 'Jardin des Orchidées');
}

// ── Fermes, édifices isolés ──

export interface Farm {
  x: number;
  z: number;
  ang: number;
  /** Entrée de la cour (où arrive le chemin). */
  gate: Vec2;
}

export function farmSites(count: number, forest: (x: number, z: number) => number): Farm[] {
  const r = rng(777);
  const out: Farm[] = [];
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    const x = -16000 + r() * 32000;
    const z = -10500 + r() * 21000;
    if (shoreDist(x, z) < 500) continue;
    if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.6 + 200)) continue;
    if (Math.hypot(x - ANNEAU.cx, z - ANNEAU.cz) < 1200) continue;
    if (Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]) < 2500 || Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]) < 2200) continue;
    if (forest(x, z) > -0.1) continue;
    if (terrain(x, z) > 900) continue;
    if (inLake(x, z, 2) || inRiver(x, z, 60)) continue;
    const h = terrain(x, z);
    if (Math.abs(terrain(x + 40, z) - h) > 3 || Math.abs(terrain(x, z + 40) - h) > 3) continue;
    if (out.some((f) => Math.hypot(f.x - x, f.z - z) < 900)) continue;
    const ang = r() * Math.PI;
    out.push({ x, z, ang, gate: [x + Math.cos(ang + Math.PI / 2) * 38, z + Math.sin(ang + Math.PI / 2) * 38] });
  }
  return out;
}

const FARM_NAMES = ['Ferme des Buffles', 'Ferme des Trois Manguiers', 'La Grange aux Bambous', 'Ferme de la Mare aux Lotus', 'Le Clos Robert', 'Ferme du Haut-Riz', 'La Métairie des Canards', 'Ferme des Bananiers', 'Le Petit Clos', 'Ferme du Grand Buffle'];

export function farmBuildings(B: Builder, farms: Farm[]): void {
  farms.forEach((f, k) => {
    const r = rng(k * 31 + 5);
    const P = (a: number, b: number): Vec2 => [f.x + a * Math.cos(f.ang) - b * Math.sin(f.ang), f.z + a * Math.sin(f.ang) + b * Math.cos(f.ang)];
    const yard = orientedRect(f.x, f.z, 34, 26, f.ang);
    B.area('farmyard', 'landuse', yard);
    const house = P(-14, -14);
    B.add({ kind: 'farm', height: 9, levels: 2, roof: { shape: 'hipped', height: 3.5, material: r() < 0.3 ? 'tiles' : 'slate' }, colour: PALETTES.farm.walls[k % 4]!, material: 'wood', pts: orientedRect(house[0], house[1], 9, 5.5, f.ang), name: FARM_NAMES[k % FARM_NAMES.length] }, 1.5);
    const barn = P(14, -10);
    B.add({ kind: 'barn', height: 9, levels: 1, roof: { shape: 'gabled', height: 3.5, material: r() < 0.5 ? 'metal' : 'slate' }, colour: ['#8a5a36', '#7a5a3a', '#a27648', '#9c8c74'][k % 4]!, pts: orientedRect(barn[0], barn[1], 13, 8, f.ang) }, 1.5);
    const shed = P(16, 14);
    B.add({ kind: 'shed', height: 5, levels: 1, roof: { shape: 'skillion', height: 1.2, material: 'metal' }, colour: '#a59a84', pts: orientedRect(shed[0], shed[1], 8, 5, f.ang) }, 1.5);
    if (r() < 0.4) {
      const silo = P(-22, 12);
      B.add({ kind: 'shed', height: 5, levels: 1, roof: { shape: 'pyramidal', height: 2.5, material: 'slate' }, colour: '#b48a5c', pts: orientedRect(silo[0], silo[1], 2.5, 2.5, f.ang) }, 1);
    }
  });
}

/** Édifices remarquables posés hors des villes. */
export function landmarks(B: Builder): void {
  const [px, pz] = MASSIF.phare;
  B.add({ kind: 'temple', height: 10, levels: 2, roof: { shape: 'pyramidal', height: 7, material: 'tiles' }, colour: '#f4e4c0', material: 'plaster', pts: octagon(px, pz, 8), name: 'Temple des Lanternes' }, 1, true);
  B.add({ kind: 'house', height: 6, levels: 1, roof: { shape: 'hipped', height: 2.5, material: 'tiles' }, colour: '#9c6a40', material: 'wood', pts: orientedRect(px + 20, pz + 6, 7, 4.5, 0.4), name: 'Maison des Moines' }, 1);
  B.places.push({ name: 'Mont des Lanternes', kind: 'locality', x: px, z: pz });
  B.places.push({ name: 'Mont du Tigre', kind: 'locality', x: MASSIF.mont[0], z: MASSIF.mont[1] });
  B.places.push({ name: 'Col de la Jungle', kind: 'locality', x: SADDLE[0], z: SADDLE[1] });
  // Grand Temple de Vat-Robert, au sommet de sa colline, et son stupa.
  for (let k = 0; k < 30; k++) {
    const x = TEMPLE_HILL.x + Math.cos(k * 2.4) * k * 6;
    const z = TEMPLE_HILL.z + Math.sin(k * 2.4) * k * 6;
    if (B.add({ kind: 'temple', height: 13, levels: 1, roof: { shape: 'hipped', height: 8, material: 'tiles' }, colour: '#f6ecd4', material: 'plaster', pts: orientedRect(x, z, 16, 9, 0.15), name: 'Grand Temple de Vat-Robert' }, 1)) {
      B.add({ kind: 'tower', height: 18, levels: 1, roof: { shape: 'pyramidal', height: 9, material: 'metal' }, colour: '#e8c35a', material: 'plaster', pts: octagon(x - 24, z + 4, 4.5), name: 'Stupa doré' }, 1, true);
      B.places.push({ name: 'Grand Temple de Vat-Robert', kind: 'locality', x, z });
      break;
    }
  }
  // Tribunes du Circuit, le long de la ligne droite sud.
  for (const k of [-1, 0, 1]) {
    const x = ANNEAU.cx + k * 56;
    const z = ANNEAU.cz + ANNEAU.radius + 24;
    B.add({ kind: 'industrial', height: 7, levels: 1, roof: { shape: 'skillion', height: 1.6, material: 'metal' }, colour: '#e4ddcb', pts: orientedRect(x, z, 24, 6, 0), name: 'Tribunes du Circuit' }, 2);
  }
  B.places.push({ name: 'Circuit des Rizières', kind: 'locality', x: ANNEAU.cx, z: ANNEAU.cz });
  B.area('park', 'landuse', stadium(ANNEAU.cx, ANNEAU.cz, ANNEAU.half, ANNEAU.radius - 14), 'Pelouse du Circuit');
  const tries: Array<[Vec2, Omit<Building, 'id' | 'y' | 'pts'>, (x: number, z: number) => Vec2[]]> = [
    [UV(-900, 4250), { kind: 'tower', height: 14, levels: 3, roof: { shape: 'pyramidal', height: 5, material: 'tiles' }, colour: '#c0392b', material: 'wood', name: 'Pagode des Terrasses' }, (x, z) => octagon(x, z, 4.5)],
    [UV(9900, 3200), { kind: 'ruins', height: 9, levels: 1, roof: { shape: 'flat', height: 0 }, colour: '#9a9a82', material: 'stone', name: 'Ruines du Palais des Théiers' }, (x, z) => orientedRect(x, z, 18, 12, 0.5)],
    [UV(-4500, -2550), { kind: 'temple', height: 11, levels: 1, roof: { shape: 'hipped', height: 7, material: 'tiles' }, colour: '#f2e4c4', material: 'plaster', name: 'Monastère des Lotus' }, (x, z) => orientedRect(x, z, 18, 8, -0.4)],
    [coastPoint(A(0.38), 260), { kind: 'ruins', height: 7, levels: 1, roof: { shape: 'flat', height: 0 }, colour: '#a8a690', material: 'stone', name: 'Ruines du Fort du Dragon' }, (x, z) => octagon(x, z, 16)],
    [[MASSIF.mont[0] - 120, MASSIF.mont[1] + 80], { kind: 'tower', height: 9, levels: 1, roof: { shape: 'pyramidal', height: 6, material: 'metal' }, colour: '#f2f0e8', material: 'plaster', name: 'Stupa du Mont du Tigre' }, (x, z) => octagon(x, z, 4)],
    [UV(-3300, -6000), { kind: 'house', height: 6, levels: 1, roof: { shape: 'hipped', height: 3, material: 'tiles' }, colour: '#8a5a36', material: 'wood', name: 'Maison de thé des Nuages' }, (x, z) => orientedRect(x, z, 9, 6, 0.6)],
    [UV(11900, 4100), { kind: 'barn', height: 7, levels: 1, roof: { shape: 'hipped', height: 3, material: 'slate' }, colour: '#9c6a40', material: 'wood', name: 'Séchoir à thé' }, (x, z) => orientedRect(x, z, 14, 7, 0.2)],
    [UV(-15300, 2900), { kind: 'shed', height: 5, levels: 1, roof: { shape: 'hipped', height: 2, material: 'slate' }, colour: '#8a5a36', material: 'wood', name: 'Pêcherie des Mangroves' }, (x, z) => orientedRect(x, z, 12, 6, 0.4)],
    // Ruines de temples envahies par la jungle (décor : lands/rizieresSites.ts).
    [UV(12900, 800), { kind: 'ruins', height: 11, levels: 1, roof: { shape: 'pyramidal', height: 6 }, colour: '#8f8f78', material: 'stone', name: 'Ruines de Prasat-Vert' }, (x, z) => orientedRect(x, z, 14, 14, 0.3)],
    [UV(12700, 4300), { kind: 'ruins', height: 8, levels: 1, roof: { shape: 'flat', height: 0 }, colour: '#8a8c76', material: 'stone', name: 'Temple englouti du Dragon' }, (x, z) => orientedRect(x, z, 12, 9, 1.1)],
    [UV(6400, 2500), { kind: 'ruins', height: 9, levels: 1, roof: { shape: 'pyramidal', height: 5 }, colour: '#949480', material: 'stone', name: 'Ruines du Fleuve' }, (x, z) => orientedRect(x, z, 12, 12, 0.6)],
  ];

  for (const [[x0, z0], b, shape] of tries) {
    for (let k = 0; k < 40; k++) {
      const x = x0 + Math.cos(k * 2.4) * k * 25;
      const z = z0 + Math.sin(k * 2.4) * k * 25;
      if (B.add({ ...b, pts: shape(x, z) }, 6)) {
        B.places.push({ name: b.name!, kind: 'locality', x, z });
        break;
      }
    }
  }
}

function octagon(x: number, z: number, r: number): Vec2[] {
  return Array.from({ length: 8 }, (_, i) => [x + Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8) * r, z + Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) * r] as Vec2);
}

export function stadium(cx: number, cz: number, half: number, radius: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 12; i++) out.push([cx + half + radius * Math.cos(-Math.PI / 2 + (Math.PI * i) / 12), cz + radius * Math.sin(-Math.PI / 2 + (Math.PI * i) / 12)]);
  for (let i = 0; i <= 12; i++) out.push([cx - half + radius * Math.cos(Math.PI / 2 + (Math.PI * i) / 12), cz + radius * Math.sin(Math.PI / 2 + (Math.PI * i) / 12)]);
  return out;
}

/** Maisons isolées et petits hameaux le long des routes de campagne. */
export function roadsideHouses(B: Builder, roads: Road[]): void {
  const r = rng(99);
  for (const road of roads) {
    if (road.designed || !['secondary', 'tertiary', 'unclassified'].includes(road.kind)) continue;
    for (let i = 20; i < road.pts.length - 20; i += 40) {
      if (r() > 0.11) continue;
      const [x, , z] = road.pts[i]!;
      if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.3)) continue;
      // Hameau de 1 à 4 maisons.
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const j = Math.min(road.pts.length - 3, i + k * 9);
        const a = road.pts[j - 2]!;
        const b = road.pts[j + 2]!;
        const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
        const side = r() < 0.5 ? 1 : -1;
        const depth = 8 + r() * 3;
        const off = road.width / 2 + 6 + depth / 2 + r() * 6;
        const cx = road.pts[j]![0] - Math.sin(ang) * off * side;
        const cz = road.pts[j]![2] + Math.cos(ang) * off * side;
        const lv = r() < 0.5 ? 1 : 2;
        B.add({ kind: 'house', height: 3 * lv + 2.8, levels: lv, roof: { shape: r() < 0.4 ? 'gabled' : 'hipped', height: 2.8, material: r() < 0.5 ? 'tiles' : 'slate' }, colour: (terrain(cx, cz) > 300 ? PALETTES.chalet.walls[Math.floor(r() * 6)] : cz > 2500 || cx > 6000 ? PALETTES.provence.walls[Math.floor(r() * 8)] : PALETTES.village.walls[Math.floor(r() * 10)])!, material: r() < 0.5 ? 'wood' : 'plaster', pts: orientedRect(cx, cz, 5 + r() * 3, depth / 2, ang) }, 3);
      }
    }
  }
}

export { PALETTES };
