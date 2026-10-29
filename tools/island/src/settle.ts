/**
 * Lieux habités : rues dessinées des villes et villages, station balnéaire (front de mer, planches,
 * cabines de plage, villas, grands hôtels), maisons le long des rues, fermes, édifices remarquables.
 */
import { ANNEAU, MASSIF, TOWNS, coastPoint, inHarbour, inLake, inRiver, shoreDist, terrain, type Town, type Vec2 } from './design.ts';
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
  ['Grand-Rue', "Rue de l'Église", 'Rue des Écoles', 'Rue du Lavoir'],
  ['Rue Principale', 'Rue de la Mairie', 'Rue des Tilleuls', 'Rue du Four'],
  ['Rue Haute', 'Rue Basse', 'Rue des Jardins', 'Rue des Vergers'],
  ['Rue du Port', 'Rue des Pêcheurs', 'Rue des Marins', 'Rue de la Cale'],
];

export function townLayout(t: Town, k: number): TownLayout {
  if (t.seaside) return seasideLayout(t);
  const u: Vec2 = [Math.cos(t.angle), Math.sin(t.angle)];
  const v: Vec2 = [-u[1], u[0]];
  const P = (a: number, b: number): Vec2 => [t.x + a * u[0] + b * v[0], t.z + a * u[1] + b * v[1]];
  const r = rng(k * 977 + 13);
  const L = t.r * 1.1;
  const names = STREET_NAMES[t.port ? 3 : k % 3]!;
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

/** Station balnéaire « à la Deauville » : boulevard du front de mer, planches, rues en damier. */
function seasideLayout(t: Town): TownLayout {
  const ang = Math.atan2(t.z, t.x);
  const along = (a0: number, a1: number, inset: number, n = 40): Vec2[] => Array.from({ length: n + 1 }, (_, i) => coastPoint(a0 + ((a1 - a0) * i) / n, inset));
  // Est (vers le port) : angles plus petits.
  const east = ang - 0.055;
  const west = ang + 0.145;
  const specs: RoadSpec[] = [
    { id: `${t.id}-boulevard`, name: 'Boulevard de la Mer', kind: 'tertiary', width: 8, pts: along(east, west, 185, 60), designed: true, gmax: 0.06, smooth: 2 },
    { id: `${t.id}-planches`, name: 'Les Planches', kind: 'cycleway', width: 4, surface: 'wood', pts: along(east + 0.006, west - 0.006, 125, 50), designed: true, gmax: 0.04, smooth: 2 },
    // Accès aux planches : perpendiculaires au front de mer (virages francs dans les deux sens).
    { id: `${t.id}-planches-est`, name: 'Les Planches', kind: 'cycleway', width: 4, surface: 'wood', pts: [coastPoint(east + 0.006, 125), coastPoint(east + 0.006, 185)], designed: true, gmax: 0.06, smooth: 0 },
    { id: `${t.id}-planches-ouest`, name: 'Les Planches', kind: 'cycleway', width: 4, surface: 'wood', pts: [coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185)], designed: true, gmax: 0.06, smooth: 0 },
    { id: `${t.id}-rue-mer`, name: 'Rue de la Mer', kind: 'residential', width: 6, pts: along(east + 0.012, west - 0.012, 480, 40), designed: true, gmax: 0.08, smooth: 2 },
    { id: `${t.id}-rue-casino`, name: 'Rue du Casino', kind: 'residential', width: 6, pts: along(east + 0.012, west - 0.012, 800, 40), designed: true, gmax: 0.09, smooth: 2 },
    { id: `${t.id}-avenue`, name: 'Avenue de la République', kind: 'tertiary', width: 7, pts: [coastPoint(ang, 185), coastPoint(ang, 480), coastPoint(ang, 800), coastPoint(ang, 1350)], designed: true, gmax: 0.08, smooth: 0 },
  ];
  // Rues perpendiculaires au front de mer.
  const side = [-0.035, -0.012, 0.025, 0.05, 0.075, 0.1, 0.125].map((da, i) => ({
    id: `${t.id}-rue-${i}`,
    name: ['Rue des Bains', 'Rue Gontaut', 'Rue Désiré', 'Rue des Villas', 'Rue des Mouettes', 'Rue Olliffe', 'Rue des Sternes'][i]!,
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

const PALETTES = {
  village: { walls: ['#f2e2c4', '#f4d6b0', '#e8c9a0', '#f0e6d8', '#d9b99b', '#f5e1a4', '#cfe0e8', '#f3c9b5', '#e6d3b3', '#dfe8d0'], roofs: ['tiles', 'tiles', 'tiles', 'slate'] },
  breton: { walls: ['#f4f4f0', '#ebe9e3', '#dcd8cf', '#f2efe6'], roofs: ['slate'] },
  villa: { walls: ['#f3ead8', '#efe2c8', '#f8f3ea', '#e7d9bf', '#f1dfc9'], roofs: ['slate', 'tiles', 'slate'] },
  farm: { walls: ['#cbb89a', '#bfae94', '#d6c7ac', '#c9b28c'], roofs: ['tiles', 'slate'] },
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
          roof: { shape: r() < 0.72 ? 'gabled' : 'hipped', height: apt ? 3.2 : 2.8, material: roofMat },
          colour: pal.walls[Math.floor(r() * pal.walls.length)]!,
          pts: poly,
        });
      }
    }
  }

  area(kind: string, layer: Area['layer'], ring: Vec2[], name?: string): void {
    this.areas.push({ id: `a${this.areas.length}`, kind, layer, ring, ...(name ? { name } : {}) });
  }
}

/** Centre de ville : église, mairie, école, place, cimetière, stade. */
export function townCentre(B: Builder, lay: TownLayout, k: number): void {
  const t = lay.town;
  const { u, v } = lay.frame;
  const [cx, cz] = lay.centre;
  const P = (a: number, b: number): Vec2 => [cx + a * u[0] + b * v[0], cz + a * u[1] + b * v[1]];
  const ang = Math.atan2(u[1], u[0]);
  B.places.push({ name: t.name, kind: t.size === 'ville' ? 'town' : t.size === 'hameau' ? 'hamlet' : 'village', x: cx, z: cz });
  if (t.seaside) return;
  if (t.size !== 'hameau') B.area('retail', 'landuse', orientedRect(cx, cz, 22, 22, ang), `Place de ${t.name}`);
  // Église au coin de la place, clocher accolé.
  const eg = P(30, -30);
  const nef = orientedRect(eg[0], eg[1], t.size === 'hameau' ? 8 : 15, t.size === 'hameau' ? 5 : 8, ang);
  if (B.add({ kind: t.size === 'hameau' ? 'chapel' : 'church', height: t.size === 'hameau' ? 9 : 15, levels: 1, roof: { shape: 'gabled', height: 6, material: 'slate' }, colour: '#d9cdb4', material: 'stone', pts: nef, name: t.size === 'hameau' ? `Chapelle de ${t.name}` : `Église de ${t.name}` }, 2)) {
    const cl = P(30 - (t.size === 'hameau' ? 10 : 18), -30);
    B.add({ kind: 'church', height: t.size === 'hameau' ? 14 : 26, levels: 4, roof: { shape: 'pyramidal', height: 7, material: 'slate' }, colour: '#d9cdb4', material: 'stone', pts: orientedRect(cl[0], cl[1], 3, 3, ang) }, 1, true);
  }
  if (t.size === 'hameau') return;
  const mairie = P(-34, 30);
  B.add({ kind: 'public', height: 11, levels: 2, roof: { shape: 'hipped', height: 3.5, material: 'slate' }, colour: '#efe6d6', pts: orientedRect(mairie[0], mairie[1], 12, 7, ang), name: `Mairie de ${t.name}` }, 2);
  const ecole = P(-0.4 * t.r, -0.22 * t.r);
  B.add({ kind: 'public', height: 8, levels: 2, roof: { shape: 'gabled', height: 3, material: 'tiles' }, colour: '#f1d9b0', pts: orientedRect(ecole[0], ecole[1], 20, 7, ang), name: `École de ${t.name}` }, 3);
  // Café et commerces autour de la place.
  for (const [a, b, name] of [[34, 30, 'Café de la Place'], [-34, -30, 'Boulangerie'], [60, 30, 'Épicerie']] as const) {
    const p = P(a, b);
    B.add({ kind: 'commercial', height: 9, levels: 2, roof: { shape: 'gabled', height: 3, material: 'tiles' }, colour: ['#f4c9a8', '#e9d8b6', '#cfe3e0'][k % 3]!, pts: orientedRect(p[0], p[1], 7, 6, ang), name }, 2);
  }
  // Stade et cimetière en lisière.
  const st = P(0.75 * t.r, 0.55 * t.r);
  const stade = orientedRect(st[0], st[1], 52, 34, ang);
  if (B.fits(stade, 4)) B.area('pitch', 'landuse', stade, `Stade de ${t.name}`);
  const ci = P(-0.75 * t.r, 0.5 * t.r);
  const cim = orientedRect(ci[0], ci[1], 28, 20, ang);
  if (B.fits(cim, 4)) B.area('cemetery', 'landuse', cim);
}

/** Robertville : grands hôtels, casino, villas face à la mer, cabines de plage. */
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
    [ang - 0.02, { kind: 'apartments', height: 21, levels: 5, roof: { shape: 'mansard', height: 4, material: 'slate' }, colour: '#efe6d2', name: 'Grand Hôtel de la Plage' }, 42, 11],
    [ang + 0.018, { kind: 'commercial', height: 13, levels: 2, roof: { shape: 'flat', height: 0, material: 'concrete' }, colour: '#fbfaf5', name: 'Casino de Robertville' }, 30, 18],
    [ang + 0.058, { kind: 'apartments', height: 19, levels: 5, roof: { shape: 'mansard', height: 4, material: 'slate' }, colour: '#f3e3cf', name: 'Hôtel Normandy' }, 36, 12],
    [ang + 0.095, { kind: 'apartments', height: 16, levels: 4, roof: { shape: 'hipped', height: 4, material: 'slate' }, colour: '#e9dcc4', name: 'Hôtel des Bains' }, 30, 11],
  ];
  for (const [a, b, hl, hw] of specials) {
    const [x, z] = coastPoint(a, 215 + hw);
    B.add({ ...b, pts: orientedRect(x, z, hl, hw, tangent(a)) }, 3);
  }
  // Villas anglo-normandes le long du front de mer et des rues.
  for (let a = ang - 0.05; a < ang + 0.14; a += 0.0028) {
    const [x, z] = coastPoint(a, 205 + 8 + r() * 6);
    const lv = 2 + (r() < 0.4 ? 1 : 0);
    B.add({ kind: 'house', height: 3 * lv + 4, levels: lv, roof: { shape: r() < 0.6 ? 'gabled' : 'hipped', height: 4, material: r() < 0.5 ? 'slate' : 'tiles' }, colour: PALETTES.villa.walls[Math.floor(r() * 5)]!, pts: orientedRect(x, z, 7 + r() * 3, 6 + r() * 2, tangent(a)) }, 2.5);
  }
  // Cabines de plage colorées, en rangées sur le sable devant les planches.
  const colours = ['#d6403a', '#2f6db5', '#f2c230', '#3aa36b', '#f08a24', '#ffffff', '#7a4fb5'];
  let c = 0;
  for (let a = ang - 0.045; a < ang + 0.13; a += 0.00026) {
    if (Math.floor((a - ang) / 0.012) % 3 === 2) continue; // trouées pour descendre à la plage
    const [x, z] = coastPoint(a, 100);
    B.add({ kind: 'shed', height: 2.6, levels: 1, roof: { shape: 'gabled', height: 0.6, material: 'tiles' }, colour: colours[c++ % colours.length]!, pts: orientedRect(x, z, 0.85, 0.9, tangent(a)), name: c === 1 ? 'Cabines de plage' : undefined } as Omit<Building, 'id' | 'y'>, 1.2);
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
  B.area('sand', 'fields', beach, 'Plage de Robertville');
  const golf = coastPoint(ang + 0.03, 1750);
  B.area('golf', 'landuse', orientedRect(golf[0], golf[1], 420, 220, tangent(ang)), 'Golf de Robertville');
  const hipp = coastPoint(ang - 0.04, 1250);
  B.area('park', 'landuse', orientedRect(hipp[0], hipp[1], 300, 120, tangent(ang)), 'Hippodrome de la Plage');
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
    if (inLake(x, z, 2) || inRiver(x, z, 60)) continue;
    const h = terrain(x, z);
    if (Math.abs(terrain(x + 40, z) - h) > 3 || Math.abs(terrain(x, z + 40) - h) > 3) continue;
    if (out.some((f) => Math.hypot(f.x - x, f.z - z) < 900)) continue;
    const ang = r() * Math.PI;
    out.push({ x, z, ang, gate: [x + Math.cos(ang + Math.PI / 2) * 38, z + Math.sin(ang + Math.PI / 2) * 38] });
  }
  return out;
}

const FARM_NAMES = ['La Ferme du Moulin', 'Ferme des Trois Chênes', 'La Grange Neuve', 'Ferme de la Mare', 'Le Clos Robert', 'Ferme du Haut-Pré', 'La Métairie', 'Ferme des Saules', 'Le Petit Clos', 'Ferme de la Croix'];

export function farmBuildings(B: Builder, farms: Farm[]): void {
  farms.forEach((f, k) => {
    const r = rng(k * 31 + 5);
    const P = (a: number, b: number): Vec2 => [f.x + a * Math.cos(f.ang) - b * Math.sin(f.ang), f.z + a * Math.sin(f.ang) + b * Math.cos(f.ang)];
    const yard = orientedRect(f.x, f.z, 34, 26, f.ang);
    B.area('farmyard', 'landuse', yard);
    const house = P(-14, -14);
    B.add({ kind: 'farm', height: 9, levels: 2, roof: { shape: 'gabled', height: 3.5, material: r() < 0.5 ? 'tiles' : 'slate' }, colour: PALETTES.farm.walls[k % 4]!, material: 'stone', pts: orientedRect(house[0], house[1], 9, 5.5, f.ang), name: FARM_NAMES[k % FARM_NAMES.length] }, 1.5);
    const barn = P(14, -10);
    B.add({ kind: 'barn', height: 9, levels: 1, roof: { shape: 'gabled', height: 3.5, material: r() < 0.5 ? 'metal' : 'tiles' }, colour: ['#8a4b33', '#7a5a3a', '#a0522d', '#9c8c74'][k % 4]!, pts: orientedRect(barn[0], barn[1], 13, 8, f.ang) }, 1.5);
    const shed = P(16, 14);
    B.add({ kind: 'shed', height: 5, levels: 1, roof: { shape: 'skillion', height: 1.2, material: 'metal' }, colour: '#a59a84', pts: orientedRect(shed[0], shed[1], 8, 5, f.ang) }, 1.5);
    if (r() < 0.4) {
      const silo = P(-22, 12);
      B.add({ kind: 'tower', height: 12, levels: 1, roof: { shape: 'pyramidal', height: 2, material: 'metal' }, colour: '#c8c8c0', pts: orientedRect(silo[0], silo[1], 2.5, 2.5, f.ang) }, 1);
    }
  });
}

/** Édifices remarquables posés hors des villes. */
export function landmarks(B: Builder): void {
  const [px, pz] = MASSIF.phare;
  B.add({ kind: 'tower', height: 32, levels: 8, roof: { shape: 'pyramidal', height: 4, material: 'metal' }, colour: '#f5f3ec', pts: octagon(px, pz, 4), name: 'Phare de Robert' }, 1, true);
  B.add({ kind: 'house', height: 7, levels: 1, roof: { shape: 'gabled', height: 2.5, material: 'slate' }, colour: '#f2f0ea', pts: orientedRect(px + 14, pz + 4, 6, 4, 0.4), name: 'Maison du gardien' }, 1);
  B.places.push({ name: 'Phare de Robert', kind: 'locality', x: px, z: pz });
  const col: Vec2 = [(MASSIF.phare[0] + MASSIF.mont[0]) / 2, (MASSIF.phare[1] + MASSIF.mont[1]) / 2];
  B.places.push({ name: 'Col du Phare', kind: 'locality', x: col[0], z: col[1] });
  // Tribunes de l'Anneau, le long de la ligne droite sud.
  for (const k of [-1, 0, 1]) {
    const x = ANNEAU.cx + k * 56;
    const z = ANNEAU.cz + ANNEAU.radius + 24;
    B.add({ kind: 'industrial', height: 7, levels: 1, roof: { shape: 'skillion', height: 1.6, material: 'metal' }, colour: '#e4ddcb', pts: orientedRect(x, z, 24, 6, 0), name: "Tribunes de l'Anneau" }, 2);
  }
  B.places.push({ name: "L'Anneau", kind: 'locality', x: ANNEAU.cx, z: ANNEAU.cz });
  B.area('park', 'landuse', stadium(ANNEAU.cx, ANNEAU.cz, ANNEAU.half, ANNEAU.radius - 14), "Pelouse de l'Anneau");
  // Moulin à vent sur les Coteaux, château près des Vignes, ruines dans les Bois, château d'eau aux Granges.
  const tries: Array<[Vec2, Omit<Building, 'id' | 'y' | 'pts'>, (x: number, z: number) => Vec2[]]> = [
    [[-3600, 5000], { kind: 'tower', height: 12, levels: 3, roof: { shape: 'pyramidal', height: 4, material: 'tiles' }, colour: '#f1ebe0', material: 'stone', name: 'Moulin des Coteaux' }, (x, z) => octagon(x, z, 3.5)],
    [[-1200, 3300], { kind: 'castle', height: 18, levels: 3, roof: { shape: 'hipped', height: 6, material: 'slate' }, colour: '#e3d7c0', material: 'stone', name: 'Château des Vignes' }, (x, z) => orientedRect(x, z, 22, 11, 0.2)],
    [[-10600, -5600], { kind: 'ruins', height: 7, levels: 1, roof: { shape: 'flat', height: 0 }, colour: '#b9b2a4', material: 'stone', name: 'Chapelle en ruine' }, (x, z) => orientedRect(x, z, 8, 5, 0.7)],
    [[13300, 400], { kind: 'tower', height: 26, levels: 1, roof: { shape: 'flat', height: 0, material: 'concrete' }, colour: '#d8d8d2', name: "Château d'eau" }, (x, z) => octagon(x, z, 5)],
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
        B.add({ kind: 'house', height: 3 * lv + 2.8, levels: lv, roof: { shape: r() < 0.7 ? 'gabled' : 'hipped', height: 2.8, material: r() < 0.7 ? 'tiles' : 'slate' }, colour: PALETTES.village.walls[Math.floor(r() * 10)]!, pts: orientedRect(cx, cz, 5 + r() * 3, depth / 2, ang) }, 3);
      }
    }
  }
}

export { PALETTES };
