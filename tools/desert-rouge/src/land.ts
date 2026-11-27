/**
 * Occupation du sol du Désert rouge : sol nu ocre presque partout, palmeraies irriguées autour des oasis seulement
 * (aucun bois ailleurs), sable de l'erg et des plages, roche rouge (sommets, falaises, parois des mesas et du canyon),
 * sel du Chott Blanc et des Salines.
 */
import { ARC, CHOTT, HARBOURS, LAKES, MESAS, TOWNS, chottE, cliffAt, coastPoint, ergMask, inHarbour, inLake, inRiver, lakeE, mesaShare, mountainAt, oasisDist, riverBeds, shoreDist, terrain, type Side, type Vec2 } from './design.ts';
import { clipPolygon, orientedRect, polygonArea } from './geom.ts';
import { fbm, rng, smoothstep } from './noise.ts';
import type { Area } from './types.ts';

export interface LandCtx {
  farms: Vec2[];
}

const mountain = mountainAt;

/** Pente (fraction) au point. */
function slopeAt(x: number, z: number, h = terrain(x, z)): number {
  return Math.max(Math.abs(terrain(x + 12, z) - h), Math.abs(terrain(x, z + 12) - h)) / 12;
}

/** Lieux sans arbres (villes, Circuit, fermes, plages, eau) : < 0 interdit. */
function clearing(x: number, z: number, ctx: LandCtx): number {
  let c = 1;
  for (const t of TOWNS) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r * 2) c = Math.min(c, (d - t.r * (t.seaside ? 1.9 : 1.2)) / 150);
  }
  c = Math.min(c, (chottE(x, z) - 1.08) * 4);
  for (const [fx, fz] of ctx.farms) {
    const d = Math.hypot(x - fx, z - fz);
    if (d < 400) c = Math.min(c, (d - 160) / 80);
  }
  return c;
}

/** Sur une mesa ou une butte (sommet ou paroi). */
function onMesa(x: number, z: number): boolean {
  return MESAS.some((m) => Math.abs(x - m.x) < m.rx * 1.6 && Math.abs(z - m.z) < m.rx * 1.6 && mesaShare(m, x, z) > 0.3);
}

/** Masque des bosquets : > 0 boisé. Seulement la couronne de palmiers des oasis : le désert reste nu. */
export function forestMask(x: number, z: number, ctx: LandCtx): number {
  const d = shoreDist(x, z);
  if (d < 140) return -1;
  const od = oasisDist(x, z);
  if (od > 700) return -1;
  let f = 0.35 - od / 700 + 0.25 * fbm(x / 120, z / 120, 2, 43);
  if (mountain(x, z) > 0.6 || onMesa(x, z)) f = -1;
  f = Math.min(f, clearing(x, z, ctx), (d - 200) / 100);
  for (const l of LAKES) if (lakeE(l, x, z) < 1.6) f = Math.min(f, (lakeE(l, x, z) - 1.25) * 2);
  if (inHarbour(x, z, 120)) f = -1;
  return f;
}

export function forestKind(_x: number, _z: number): 'deciduous' | 'conifer' | 'mixed' {
  return 'deciduous';
}

/** Landes : aucune (les touffes sèches et les cactus sont posés par le décor du client). */
export function heathMask(_x: number, _z: number): number {
  return -1;
}

/** Sable : Grand Erg, pied des dunes de la côte ouest, cuvettes sableuses. */
export function sandMask(x: number, z: number): number {
  const d = shoreDist(x, z);
  if (d < 0) return -1;
  let m = (ergMask(x, z) - 0.28 + 0.18 * fbm(x / 700, z / 700, 2, 57)) * 3;
  // Sable soufflé au pied des buttes et le long de la Piste (traînées).
  m = Math.max(m, 0.6 * fbm(x / 400, z / 400, 2, 58) - 0.45);
  if (inLake(x, z, 1.4) || inRiver(x, z, 8) || chottE(x, z) < 1.05) return -1;
  if (TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.1)) m = Math.min(m, -0.2);
  if (oasisDist(x, z) < 450) m = -1;
  return m;
}

/** Rochers : falaises du rivage, sommets, parois raides (mesas, canyon, crêtes). */
export function rockMask(x: number, z: number): number {
  const d = shoreDist(x, z);
  const cliff = cliffAt(x, z);
  let m = cliff > 0.5 ? (85 - d) / 20 : -1;
  if (d < 0) return -1;
  const h = terrain(x, z);
  if (mountain(x, z) > 0.2) m = Math.max(m, (h - 760 + 60 * fbm(x / 300, z / 300, 2, 52)) / 30);
  if (h > 15) m = Math.max(m, (slopeAt(x, z, h) - 0.62) * 4);
  if (inHarbour(x, z, 80) || TOWNS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r * 1.2)) m = -1;
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

/** Distance (m) à la rive de la source d'oasis la plus proche (la guelta du Vautour n'a pas de jardins). */
function gardenDist(x: number, z: number): number {
  let d = Infinity;
  for (const o of LAKES) if (o.kind === 'pond') d = Math.min(d, Math.hypot(x - o.x, z - o.z) - Math.max(o.rx, o.rz));
  return d;
}

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
      if (forestMask(cx, cz, ctx) > 0.1) continue;
      if (clearing(cx, cz, ctx) < 0.2) continue;
      // Pente : pas de culture au-delà de 15 %.
      const h = q.map(([x, z]) => terrain(x, z));
      if (Math.max(...h) - Math.min(...h) > S * 0.15) continue;
      const roll = r();
      // Cultures irriguées seulement : palmeraies et jardins serrés autour des sources d'oasis (pas la guelta), à
      // moins de 200 à 320 m de l'eau ; tout le reste du désert garde son sol ocre (27/11/2026 : l'ancien rayon de
      // 950 m faisait de grandes étendues vertes en plein désert, jusqu'au pied des buttes).
      const gd = gardenDist(cx, cz);
      if (gd > 260 + 60 * fbm(cx / 300, cz / 300, 2, 44)) continue;
      const kind = roll < 0.72 ? 'orchard' : 'farmland';
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

/** Plages de sable (secteurs sans falaise), Salines, croûte de sel du Chott Blanc. */
export function shoreAreas(skip: (x: number, z: number) => boolean): Area[] {
  const out: Area[] = [];
  const n = 1400;
  for (const side of [1, -1] as Side[])
    for (let k = 0; k < n; k++) {
      const a0 = ARC.t0 + (k / n) * (ARC.t1 - ARC.t0);
      const a1 = ARC.t0 + ((k + 1) / n) * (ARC.t1 - ARC.t0);
      const mid = coastPoint((a0 + a1) / 2, 50, side);
      if (cliffAt(mid[0], mid[1]) > 0.3) continue;
      if (skip(mid[0], mid[1]) || inHarbour(mid[0], mid[1], 150) || inRiver(mid[0], mid[1], 30)) continue;
      out.push({ id: `plage-${side > 0 ? 'n' : 's'}${k}`, kind: 'sand', layer: 'fields', ring: [coastPoint(a0, -45, side), coastPoint(a1, -45, side), coastPoint(a1, 105, side), coastPoint(a0, 105, side)] });
    }
  // Les Salines : bassins de sel blanc au bord du golfe, près du hameau.
  const sal = TOWNS.find((t) => t.id === 'les-salines')!;
  for (let k = 0; k < 6; k++) {
    const t = (sal.t ?? 0) + 0.025 + k * 0.011;
    const ring = [coastPoint(t, 160, -1), coastPoint(t + 0.009, 160, -1), coastPoint(t + 0.009, 420, -1), coastPoint(t, 420, -1)];
    out.push({ id: `saline-${k}`, kind: 'quarry', layer: 'landuse', ring, ...(k === 0 ? { name: 'Les Salines' } : {}) });
  }
  // Chott Blanc : croûte de sel (sol clair).
  const salt: Vec2[] = [];
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const ex = Math.cos(a) * CHOTT.rx * (0.99 + 0.02 * Math.sin(k * 1.7));
    const ez = Math.sin(a) * CHOTT.rz * (0.99 + 0.02 * Math.cos(k * 2.3));
    salt.push([CHOTT.x + ex * Math.cos(CHOTT.rot) - ez * Math.sin(CHOTT.rot), CHOTT.z + ex * Math.sin(CHOTT.rot) + ez * Math.cos(CHOTT.rot)]);
  }
  out.push({ id: 'chott', kind: 'quarry', layer: 'landuse', ring: salt, name: CHOTT.name });
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
