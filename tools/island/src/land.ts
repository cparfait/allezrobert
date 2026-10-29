/**
 * Occupation du sol : bois (masque continu, contours par marching squares tuile par tuile), parcelles
 * agricoles variées, plages, dunes, landes et rochers, lacs, rivières.
 */
import { ANNEAU, HARBOURS, LAKES, MASSIF, TOWNS, cliffiness, coastPoint, inHarbour, inLake, inRiver, lakeE, riverBeds, shoreDist, terrain, type Vec2 } from './design.ts';
import { clipPolygon, orientedRect, polygonArea } from './geom.ts';
import { fbm, rng, smoothstep } from './noise.ts';
import type { Area } from './types.ts';

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

export interface LandCtx {
  farms: Vec2[];
}

/** Lieux sans arbres (villes, Anneau, fermes, golf, plages, eau) : < 0 interdit. */
function clearing(x: number, z: number, ctx: LandCtx): number {
  let c = 1;
  for (const t of TOWNS) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r * 2) c = Math.min(c, (d - t.r * (t.seaside ? 1.9 : 1.2)) / 150);
  }
  c = Math.min(c, (Math.hypot(Math.max(0, Math.abs(x - ANNEAU.cx) - ANNEAU.half), z - ANNEAU.cz) - 420) / 120);
  for (const [fx, fz] of ctx.farms) {
    const d = Math.hypot(x - fx, z - fz);
    if (d < 400) c = Math.min(c, (d - 160) / 80);
  }
  return c;
}

/** Masque des bois : > 0 boisé. */
export function forestMask(x: number, z: number, ctx: LandCtx): number {
  const d = shoreDist(x, z);
  if (d < 140) return -1;
  let f = -0.36 + 0.95 * fbm(x / 2300, z / 2300, 3, 41) + 0.15 * fbm(x / 400, z / 400, 2, 42);
  // Les Bois : grande forêt.
  const bois = gauss(x, z, -10300, -5000, 4400, 3200);
  f = Math.max(f, bois * 1.7 - 0.45 + 0.3 * fbm(x / 800, z / 800, 2, 43));
  // Massif du Phare : résineux sur les pentes moyennes.
  const dm = Math.min(Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]), Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]));
  if (dm < 5000) {
    const h = terrain(x, z);
    f = Math.max(f, (0.55 + 0.3 * fbm(x / 600, z / 600, 2, 44)) * smoothstep(90, 160, h) * (1 - smoothstep(380, 460, h)));
  }
  // Ripisylve le long des rivières.
  if (inRiver(x, z, 45) && !inRiver(x, z, 4)) f = Math.max(f, 0.25);
  // Coteaux exposés au sud : vignes, pas de bois ; plateau de l'est : grandes cultures.
  f -= 0.9 * gauss(x, z, -1500, 5600, 3600, 900);
  f -= 0.35 * gauss(x, z, 12300, 1200, 4500, 3200);
  f = Math.min(f, clearing(x, z, ctx), (d - 200) / 100);
  for (const l of LAKES) if (lakeE(l, x, z) < 1.6) f = Math.min(f, (lakeE(l, x, z) - 1.3) * 2);
  if (inHarbour(x, z, 120)) f = -1;
  return f;
}

export function forestKind(x: number, z: number): 'deciduous' | 'conifer' | 'mixed' {
  const dm = Math.min(Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]), Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]));
  if (dm < 4500) return 'conifer';
  if (gauss(x, z, -10300, -5000, 4400, 3200) > 0.3) return 'mixed';
  return 'deciduous';
}

/** Landes (massif, dunes) et rochers (sommets, falaises). */
export function heathMask(x: number, z: number): number {
  const d = shoreDist(x, z);
  const ang = Math.atan2(z, x);
  const cliff = cliffiness(ang);
  // Dunes derrière les plages de sable.
  let m = d > 100 && d < 300 && cliff < 0.3 ? 0.4 - Math.abs(d - 200) / 250 : -1;
  const dm = Math.min(Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]), Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]));
  if (dm < 4000) m = Math.max(m, (terrain(x, z) - 430 + 40 * fbm(x / 500, z / 500, 2, 51)) / 40);
  if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.5)) m = -1;
  return m;
}

export function rockMask(x: number, z: number): number {
  const d = shoreDist(x, z);
  const cliff = cliffiness(Math.atan2(z, x));
  let m = cliff > 0.5 ? (75 - d) / 20 : -1;
  if (d < 0) m = -1;
  const dm = Math.min(Math.hypot(x - MASSIF.phare[0], z - MASSIF.phare[1]), Math.hypot(x - MASSIF.mont[0], z - MASSIF.mont[1]));
  if (dm < 2500) m = Math.max(m, (terrain(x, z) - 600 + 30 * fbm(x / 300, z / 300, 2, 52)) / 25);
  if (inHarbour(x, z, 80)) m = -1;
  return m;
}

// ── Contours (marching squares) ──

/**
 * Contours de `mask > 0` sur la tuile [x0, x0+size]², grille de `res` m (une case de marge, comptée
 * négative : contours toujours fermés), découpés exactement au bord de la tuile.
 */
export function contours(mask: (x: number, z: number) => number, x0: number, z0: number, size: number, res: number): Vec2[][] {
  const n = Math.round(size / res) + 2;
  const v = new Float32Array((n + 1) * (n + 1));
  let any = false;
  let all = true;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const border = i === 0 || j === 0 || i === n || j === n;
      const val = border ? -1 : mask(x0 + (i - 1) * res, z0 + (j - 1) * res);
      v[j * (n + 1) + i] = val === 0 ? -1e-6 : val;
      if (!border) {
        if (val > 0) any = true;
        else all = false;
      }
    }
  if (!any) return [];
  if (all) return [[[x0, z0], [x0 + size, z0], [x0 + size, z0 + size], [x0, z0 + size]]];
  const N1 = n + 1;
  const px = (i: number) => x0 + (i - 1) * res;
  const pz = (j: number) => z0 + (j - 1) * res;
  // Points sur les arêtes : clé = arête horizontale (i, j)→(i+1, j) : 2·k, verticale : 2·k + 1.
  const pt = new Map<number, Vec2>();
  const edgePoint = (key: number): Vec2 => {
    const e = pt.get(key);
    if (e) return e;
    const k = key >> 1;
    const i = k % N1;
    const j = Math.floor(k / N1);
    const a = v[k]!;
    let p: Vec2;
    if ((key & 1) === 0) {
      const b = v[k + 1]!;
      const t = a / (a - b);
      p = [px(i) + t * res, pz(j)];
    } else {
      const b = v[k + N1]!;
      const t = a / (a - b);
      p = [px(i), pz(j) + t * res];
    }
    pt.set(key, p);
    return p;
  };
  const next = new Map<number, number>();
  const link = (a: number, b: number) => next.set(a, b);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * N1 + i;
      const a = v[k]! > 0 ? 1 : 0; // haut-gauche
      const b = v[k + 1]! > 0 ? 2 : 0; // haut-droite
      const c = v[k + N1 + 1]! > 0 ? 4 : 0; // bas-droite
      const d = v[k + N1]! > 0 ? 8 : 0; // bas-gauche
      const top = 2 * k;
      const bottom = 2 * (k + N1);
      const left = 2 * k + 1;
      const right = 2 * (k + 1) + 1;
      // Segments orientés : intérieur à gauche.
      switch (a | b | c | d) {
        case 1: link(top, left); break;
        case 2: link(right, top); break;
        case 3: link(right, left); break;
        case 4: link(bottom, right); break;
        case 5: {
          const centre = (v[k]! + v[k + 1]! + v[k + N1 + 1]! + v[k + N1]!) / 4 > 0;
          if (centre) { link(top, right); link(bottom, left); } else { link(top, left); link(bottom, right); }
          break;
        }
        case 6: link(bottom, top); break;
        case 7: link(bottom, left); break;
        case 8: link(left, bottom); break;
        case 9: link(top, bottom); break;
        case 10: {
          const centre = (v[k]! + v[k + 1]! + v[k + N1 + 1]! + v[k + N1]!) / 4 > 0;
          if (centre) { link(left, top); link(right, bottom); } else { link(right, top); link(left, bottom); }
          break;
        }
        case 11: link(right, bottom); break;
        case 12: link(left, right); break;
        case 13: link(top, right); break;
        case 14: link(left, top); break;
      }
    }
  const rings: Vec2[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const ring: Vec2[] = [];
    let cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      ring.push(edgePoint(cur));
      const nx = next.get(cur);
      if (nx === undefined) break;
      cur = nx;
    }
    if (ring.length >= 3) {
      const c = clipPolygon(simplify(ring, res * 0.15), { minX: x0, minZ: z0, maxX: x0 + size, maxZ: z0 + size });
      if (c.length >= 3 && Math.abs(polygonArea(c)) > res * res) rings.push(c);
    }
  }
  return rings;
}

/** Retire les points presque alignés (écart < tol). */
function simplify(ring: Vec2[], tol: number): Vec2[] {
  if (ring.length < 8) return ring;
  const out: Vec2[] = [ring[0]!];
  for (let i = 1; i < ring.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = ring[i]!;
    const c = ring[i + 1]!;
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const dev = Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / l;
    if (dev > tol) out.push(b);
  }
  out.push(ring[ring.length - 1]!);
  return out;
}

// ── Parcelles, plages, eau (calculées une fois pour toute l'île) ──

export function parcels(ctx: LandCtx, avoid: (x: number, z: number) => boolean): Area[] {
  const out: Area[] = [];
  const r = rng(2024);
  const S = 230;
  const rot = 0.35;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const W = (u: number, w: number): Vec2 => [u * c - w * s, u * s + w * c];
  const jitter = new Map<string, Vec2>();
  const J = (i: number, j: number): Vec2 => {
    const k = `${i},${j}`;
    let p = jitter.get(k);
    if (!p) {
      const q = rng((i * 73856093) ^ (j * 19349663));
      p = W((i + (q() - 0.5) * 0.5) * S, (j + (q() - 0.5) * 0.5) * S * 0.8);
      jitter.set(k, p);
    }
    return p;
  };
  const R = 20000;
  for (let i = -Math.ceil(R / S); i < Math.ceil(R / S); i++)
    for (let j = -Math.ceil(R / (S * 0.8)); j < Math.ceil(R / (S * 0.8)); j++) {
      const q: Vec2[] = [J(i, j), J(i + 1, j), J(i + 1, j + 1), J(i, j + 1)];
      const cx = (q[0]![0] + q[2]![0]) / 2;
      const cz = (q[0]![1] + q[2]![1]) / 2;
      if (Math.abs(cx) > 17500 || Math.abs(cz) > 11500) continue;
      if (shoreDist(cx, cz) < 300) continue;
      if (q.some(([x, z]) => shoreDist(x, z) < 220 || inLake(x, z, 1.3) || inRiver(x, z, 20) || avoid(x, z))) continue;
      if (forestMask(cx, cz, ctx) > -0.08) continue;
      if (clearing(cx, cz, ctx) < 0.2) continue;
      // Pente : pas de culture au-delà de 15 %.
      const h = q.map(([x, z]) => terrain(x, z));
      if (Math.max(...h) - Math.min(...h) > S * 0.15) continue;
      const roll = r();
      const vine = gauss(cx, cz, -1500, 5600, 3600, 900) > 0.35 && terrain(cx, cz + 60) < terrain(cx, cz - 60);
      const plateau = gauss(cx, cz, 12300, 1200, 4500, 3200) > 0.4;
      const valleyFloor = inRiver(cx, cz, 220);
      const kind = vine ? (roll < 0.8 ? 'vineyard' : 'meadow') : plateau ? (roll < 0.8 ? 'farmland' : 'meadow') : valleyFloor ? (roll < 0.7 ? 'meadow' : 'farmland') : roll < 0.42 ? 'farmland' : roll < 0.82 ? 'meadow' : roll < 0.9 ? 'orchard' : null;
      if (!kind) continue;
      // Haies : parcelle rétrécie de 3 m (bandes en herbe entre les champs). Parfois coupée en deux.
      const shrink = (poly: Vec2[]) => {
        const mx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
        const mz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
        return poly.map(([x, z]) => {
          const d = Math.hypot(x - mx, z - mz) || 1;
          return [x - ((x - mx) / d) * 4, z - ((z - mz) / d) * 4] as Vec2;
        });
      };
      if (kind === 'farmland' && r() < 0.45) {
        const m01: Vec2 = [(q[0]![0] + q[1]![0]) / 2, (q[0]![1] + q[1]![1]) / 2];
        const m32: Vec2 = [(q[3]![0] + q[2]![0]) / 2, (q[3]![1] + q[2]![1]) / 2];
        out.push({ id: `p${out.length}`, kind, layer: 'fields', ring: shrink([q[0]!, m01, m32, q[3]!]) });
        out.push({ id: `p${out.length}`, kind: r() < 0.5 ? 'farmland' : 'meadow', layer: 'fields', ring: shrink([m01, q[1]!, q[2]!, m32]) });
      } else out.push({ id: `p${out.length}`, kind, layer: 'fields', ring: shrink(q) });
    }
  return out;
}

/** Plages de sable (secteurs sans falaise), zones humides de la lagune, lacs. */
export function shoreAreas(skip: (x: number, z: number) => boolean): Area[] {
  const out: Area[] = [];
  const n = 2400;
  for (let k = 0; k < n; k++) {
    const a0 = -Math.PI + (k / n) * 2 * Math.PI;
    const a1 = -Math.PI + ((k + 1) / n) * 2 * Math.PI;
    if (cliffiness((a0 + a1) / 2) > 0.3) continue;
    const mid = coastPoint((a0 + a1) / 2, 50);
    if (skip(mid[0], mid[1]) || inHarbour(mid[0], mid[1], 150) || inRiver(mid[0], mid[1], 30)) continue;
    out.push({ id: `plage-${k}`, kind: 'sand', layer: 'fields', ring: [coastPoint(a0, -14), coastPoint(a1, -14), coastPoint(a1, 105), coastPoint(a0, 105)] });
  }
  const lag = LAKES.find((l) => l.id === 'lagune')!;
  const ring: Vec2[] = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const ex = Math.cos(a) * lag.rx * 1.45;
    const ez = Math.sin(a) * lag.rz * 1.7;
    ring.push([lag.x + ex * Math.cos(lag.rot) - ez * Math.sin(lag.rot), lag.z + ex * Math.sin(lag.rot) + ez * Math.cos(lag.rot)]);
  }
  out.push({ id: 'marais', kind: 'wetland', layer: 'fields', ring, name: 'Marais de la Lagune' });
  return out;
}

export interface WaterPoly {
  id: string;
  kind: 'lake' | 'pond';
  name?: string;
  level: number;
  ring: Vec2[];
}

export function lakes(): WaterPoly[] {
  terrain(0, 0); // niveaux calculés
  return LAKES.map((l) => {
    const ring: Vec2[] = [];
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const ex = Math.cos(a) * l.rx;
      const ez = Math.sin(a) * l.rz;
      ring.push([l.x + ex * Math.cos(l.rot) - ez * Math.sin(l.rot), l.z + ex * Math.sin(l.rot) + ez * Math.cos(l.rot)]);
    }
    return { id: l.id, kind: l.kind, ...(l.name ? { name: l.name } : {}), level: l.level, ring };
  });
}

export interface Waterway {
  id: number;
  kind: string;
  width: number;
  name: string;
  pts: Vec2[];
}

/** Rivières : lit tous les 20 m, coupé au passage des routes (busage) et dans les lacs et la mer. */
export function waterways(nearRoad: (x: number, z: number) => boolean): Waterway[] {
  const out: Waterway[] = [];
  for (const b of riverBeds()) {
    let cur: Vec2[] = [];
    let w = 0;
    const flush = () => {
      if (cur.length > 2) out.push({ id: out.length + 1, kind: w > 5 ? 'river' : 'stream', width: Math.round(w * 10) / 10, name: b.river.name, pts: cur });
      cur = [];
    };
    for (let k = 0; k < b.pts.length; k += 2) {
      const [x, z] = b.pts[k]!;
      const blocked = nearRoad(x, z) || shoreDist(x, z) < -5 || inLake(x, z, 1.05) || HARBOURS.some((h) => Math.hypot(h.x - x, h.z - z) < h.halfLen + 40);
      if (blocked) {
        flush();
        continue;
      }
      w = b.chan[k]! * 2;
      cur.push([x, z]);
    }
    flush();
  }
  return out;
}

export { orientedRect };
