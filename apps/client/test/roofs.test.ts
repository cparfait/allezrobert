import { describe, expect, it } from 'vitest';
import { planRoof, roofBuffers, type RoofPlan } from '../src/world/roofs.ts';

const O = 0.4;
const OG = 0.25;

function inside(x: number, z: number, pts: number[]): boolean {
  let c = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number;
    const zi = pts[i * 2 + 1] as number;
    const xj = pts[j * 2] as number;
    const zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Distance horizontale au bâti (0 si dedans). */
function outsideBy(x: number, z: number, pts: number[]): number {
  if (inside(x, z, pts)) return 0;
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2] as number;
    const az = pts[i * 2 + 1] as number;
    const bx = pts[((i + 1) % n) * 2] as number;
    const bz = pts[((i + 1) % n) * 2 + 1] as number;
    const ex = bx - ax;
    const ez = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - k * ex, z - az - k * ez));
  }
  return best;
}

function area(pts: number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (pts[i * 2] as number) * (pts[j * 2 + 1] as number) - (pts[j * 2] as number) * (pts[i * 2 + 1] as number);
  }
  return Math.abs(a / 2);
}

function perimeter(pts: number[]): number {
  let p = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot((pts[j * 2] as number) - (pts[i * 2] as number), (pts[j * 2 + 1] as number) - (pts[i * 2 + 1] as number));
  }
  return p;
}

/** Contrôles communs : pas de NaN, rien hors emprise + débord, pans vers le haut, surface couverte sans trou. */
function check(pts: number[], plan: RoofPlan, maxOut = O * 1.6 + OG): void {
  const wallTop = 10;
  const pitch = 40;
  const buf = roofBuffers(plan, wallTop, pitch);
  const eave = wallTop - O * Math.tan((pitch * Math.PI) / 180);
  const ridge = wallTop + (plan.tEnd - O) * Math.tan((pitch * Math.PI) / 180);
  const pos = buf.roof.pos;
  expect(pos.length).toBeGreaterThan(0);
  let projected = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const a = [pos[i], pos[i + 1], pos[i + 2]] as number[];
    const b = [pos[i + 3], pos[i + 4], pos[i + 5]] as number[];
    const c = [pos[i + 6], pos[i + 7], pos[i + 8]] as number[];
    for (const p of [a, b, c]) {
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
      expect(outsideBy(p[0] as number, p[2] as number, pts)).toBeLessThanOrEqual(maxOut);
      expect(p[1]).toBeGreaterThanOrEqual(eave - 1e-6);
      expect(p[1]).toBeLessThanOrEqual(ridge + 1e-6);
      // Au-delà de la rive d'un pignon, ce qui dépasse du mur reste sous le haut du mur : un débord, pas une aile.
      if (outsideBy(p[0] as number, p[2] as number, pts) > OG / 0.3 + 1e-3) expect(p[1]).toBeLessThanOrEqual(wallTop + 1e-6);
    }
    const ny = ((b[2] as number) - (a[2] as number)) * ((c[0] as number) - (a[0] as number)) - ((b[0] as number) - (a[0] as number)) * ((c[2] as number) - (a[2] as number));
    expect(ny).toBeGreaterThanOrEqual(-1e-9);
    projected += ny / 2;
  }
  for (const v of buf.roof.uv) expect(Number.isFinite(v)).toBe(true);
  // Couverture : au moins l'emprise, au plus emprise + bande de débord (pas de pans en double).
  const A = area(pts);
  expect(projected).toBeGreaterThan(A * 0.98);
  expect(projected).toBeLessThan(A + perimeter(pts) * (O + OG) + 4 * pts.length * O * O);
  for (let i = 1; i < buf.gables.pos.length; i += 3) expect(buf.gables.pos[i]).toBeGreaterThanOrEqual(wallTop - 1e-6);
}

describe('toits sur emprise réelle', () => {
  const rect = [0, 0, 12, 0, 12, 8, 0, 8];
  const L = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];

  it('rectangle à deux pans : faîtage au milieu, pignons sur les petits côtés', () => {
    const plan = planRoof(rect, { overhang: O, gableOverhang: OG, gabled: true });
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.tEnd).toBeCloseTo(O + 4, 5);
    expect(plan.gables.length).toBeGreaterThan(0);
    check(rect, plan);
    // Les pignons restent dans le plan des murs x = 0 et x = 12.
    for (let i = 0; i < plan.gables.length; i += 4) expect([0, 12]).toContain(Math.round((plan.gables[i] as number) * 1e6) / 1e6);
  });

  it('rectangle à croupes', () => {
    const plan = planRoof(rect, { overhang: O, gableOverhang: OG, gabled: false });
    if (!plan) throw new Error('plan nul');
    expect(plan.gables.length).toBe(0);
    expect(plan.tEnd).toBeCloseTo(O + 4, 5);
    check(rect, plan);
  });

  it('bâtiment en L : pans dans l’emprise, noue au coin rentrant, pignons en bout d’aile', () => {
    for (const gabled of [true, false]) {
      const plan = planRoof(L, { overhang: O, gableOverhang: OG, gabled });
      if (!plan) throw new Error('plan nul');
      expect(plan.tEnd).toBeCloseTo(O + 2, 4);
      check(L, plan);
      // Aucun sommet dans le coin vide de l'L (au-delà du débord).
      for (let i = 0; i < plan.roof.length; i += 5) {
        const x = plan.roof[i] as number;
        const z = plan.roof[i + 1] as number;
        expect(x > 4 + O * 1.5 && z > 4 + O * 1.5).toBe(false);
      }
      if (!gabled) {
        expect(plan.gables.length).toBe(0);
        continue;
      }
      // Pignons sur les deux bouts d'aile (x = 10, z ∈ [0, 4] et z = 10, x ∈ [0, 4]), nulle part ailleurs.
      expect(plan.gables.length).toBeGreaterThan(0);
      const ends = new Set<string>();
      for (let i = 0; i < plan.gables.length; i += 4) {
        const x = plan.gables[i] as number;
        const z = plan.gables[i + 1] as number;
        // le pignon s'étend du débord de l'égout au-delà des angles
        const onA = Math.abs(x - 10) < 1e-6 && z > -O - 1e-6 && z < 4 + O + 1e-6;
        const onB = Math.abs(z - 10) < 1e-6 && x > -O - 1e-6 && x < 4 + O + 1e-6;
        expect(onA || onB).toBe(true);
        ends.add(onA ? 'A' : 'B');
      }
      expect(ends.size).toBe(2);
    }
  });

  it('T et U à deux pans : un pignon par bout d’aile', () => {
    const T = [0, 0, 12, 0, 12, 4, 8, 4, 8, 12, 4, 12, 4, 4, 0, 4];
    const U = [0, 0, 14, 0, 14, 10, 10, 10, 10, 4, 4, 4, 4, 10, 0, 10];
    for (const [pts, n] of [[T, 3], [U, 2]] as const) {
      const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled: true });
      if (!plan) throw new Error('plan nul');
      check(pts, plan);
      // au moins un triangle de pignon par bout d'aile
      expect(plan.gables.length).toBeGreaterThan(0);
      expect(plan.gables.length / 12).toBeGreaterThanOrEqual(n);
    }
  });

  it('rectangle à décrochements (BD TOPO) : deux pans gardés, pignons aux bouts seulement', () => {
    // 14 × 8 m, retrait de 0,6 m sur 4 m au milieu d'un long côté, pignon ouest en deux parties décalées de 0,5 m
    const notched = [0, 0, 5, 0, 5, 0.6, 9, 0.6, 9, 0, 14, 0, 14, 8, 0.5, 8, 0.5, 4, 0, 4];
    for (const ridgeShort of [false, true]) {
      const plan = planRoof(notched, { overhang: O, gableOverhang: OG, gabled: true, ridgeShort });
      if (!plan) throw new Error('plan nul');
      check(notched, plan);
      if (ridgeShort) continue;
      expect(plan.gables.length).toBeGreaterThan(0);
      // pignons sur les bouts x ≈ 0 et x = 14, jamais sur le décrochement du long côté (x = 5 ou 9)
      for (let i = 0; i < plan.gables.length; i += 4) {
        const x = plan.gables[i] as number;
        expect(x < 0.5 + 1e-6 || x > 14 - 1e-6).toBe(true);
      }
    }
  });

  it('pignon voisin d’un coin rentrant qui ferait sortir le toit : retour aux croupes', () => {
    // emprise réelle de Billom (BATIMENT0000000312805045) : avec pignons, le pan sortait de 1,5 m
    const pts = [-124.2, -2450.3, -126.3, -2450.2, -126.1, -2442, -125.3, -2442.1, -123.9, -2442];
    const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled: true });
    if (!plan) throw new Error('plan nul');
    check(pts, plan);
  });

  it('T, U, trapèze et polygone sens horaire', () => {
    const T = [0, 0, 12, 0, 12, 4, 8, 4, 8, 12, 4, 12, 4, 4, 0, 4];
    const U = [0, 0, 14, 0, 14, 10, 10, 10, 10, 4, 4, 4, 4, 10, 0, 10];
    const trap = [0, 0, 14, 0, 11, 7, 2, 7];
    const cw = [0, 0, 0, 8, 12, 8, 12, 0];
    for (const pts of [T, U, trap, cw]) {
      for (const gabled of [true, false]) {
        const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled });
        if (!plan) throw new Error('plan nul');
        check(pts, plan);
      }
    }
  });

  it('polygones irréguliers aléatoires : toujours dans l’emprise, jamais retournés', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 200; k++) {
      const n = 4 + Math.floor(rnd() * 9);
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
        const r = 4 + rnd() * 8;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled: rnd() < 0.5 });
      if (!plan) continue;
      // Angles aigus possibles : on tolère l'onglet du débord.
      check(pts, plan, 3);
    }
  });
});
