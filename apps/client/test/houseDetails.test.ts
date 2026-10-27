import { describe, expect, it } from 'vitest';
import { orientedBox, planRoof, ridgeLine } from '../src/world/roofs.ts';
import { wallGroundOffset } from '../src/world/facadeGround.ts';

const O = 0.4;
const OG = 0.25;

/** Sommets du plan au faîtage (t = tEnd), en x, z. */
function ridgePoints(pts: number[], gabled: boolean, ridgeShort: boolean): Array<[number, number]> {
  const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled, ...(ridgeShort ? { ridgeShort } : {}) });
  expect(plan).not.toBeNull();
  const out: Array<[number, number]> = [];
  for (let i = 0; i < plan!.roof.length; i += 5) if (Math.abs((plan!.roof[i + 2] as number) - plan!.tEnd) < 1e-6) out.push([plan!.roof[i] as number, plan!.roof[i + 1] as number]);
  return out;
}

/** La faîtière (ridgeLine) passe par tous les points du faîtage calculé par planRoof et les couvre. */
function expectOnRidge(pts: number[], gabled: boolean, ridgeShort: boolean): ReturnType<typeof ridgeLine> {
  const box = orientedBox(pts);
  const plan = planRoof(pts, { overhang: O, gableOverhang: OG, gabled, ...(ridgeShort ? { ridgeShort } : {}) })!;
  const r = ridgeLine(box, plan, ridgeShort);
  expect(r).not.toBeNull();
  const along: number[] = [];
  for (const [x, z] of ridgePoints(pts, gabled, ridgeShort)) {
    const dx = x - r!.cx;
    const dz = z - r!.cz;
    expect(Math.abs(-dx * r!.dz + dz * r!.dx)).toBeLessThan(1e-3); // sur la ligne
    along.push(dx * r!.dx + dz * r!.dz);
  }
  expect(along.length).toBeGreaterThan(0);
  expect(Math.max(...along)).toBeCloseTo(r!.half, 3);
  expect(Math.min(...along)).toBeCloseTo(-r!.half, 3);
  return r;
}

// Rectangle 14 × 8 m tourné de 30°.
const rect = (() => {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const out: number[] = [];
  for (const [u, v] of [[-7, -4], [7, -4], [7, 4], [-7, 4]] as const) out.push(100 + u * c - v * s, 50 + u * s + v * c);
  return out;
})();

describe('faîtière et cheminée sur le faîtage', () => {
  it('deux pans, faîtage selon la longueur', () => {
    const r = expectOnRidge(rect, true, false)!;
    expect(r.half).toBeCloseTo(7 + OG);
  });

  it('deux pans, faîtage court (pignons sur les grands côtés) : faîtière selon la largeur', () => {
    const r = expectOnRidge(rect, true, true)!;
    const box = orientedBox(rect);
    expect(r.half).toBeCloseTo(4 + OG);
    expect(Math.abs(r.dx * box.ux + r.dz * box.uz)).toBeLessThan(1e-9); // perpendiculaire au grand axe
  });

  it('croupes : faîtage selon la longueur, raccourci des croupes, même si le faîtage est court', () => {
    const r = expectOnRidge(rect, false, true)!;
    const box = orientedBox(rect);
    expect(r.half).toBeCloseTo(7 - 4, 3);
    expect(Math.abs(r.dx * box.ux + r.dz * box.uz)).toBeCloseTo(1);
  });
});

describe('sol des façades', () => {
  const flat = () => 100;
  it('terrain plat : la façade part du sol, 0,3 m au-dessus du pied du mur enterré', () => {
    expect(wallGroundOffset(0, 0, 10, 0, 99.7, 6, flat)).toBeCloseTo(0.3);
  });

  it('en pente, le sol le plus haut le long du mur, même entre les angles', () => {
    // butte de 1,5 m sur un nœud de la grille de 2 m du terrain, entre les angles
    const bump = (x: number) => 100 + 1.5 * Math.max(0, 1 - Math.abs(x - 4) / 2);
    expect(wallGroundOffset(0, 0, 10, 0, 99.7, 8, bump)).toBeCloseTo(1.8);
    // mur parallèle à la pente (amont en x = 10, 3 m plus haut)
    expect(wallGroundOffset(0, 0, 10, 0, 99.7, 8, (x) => 100 + 0.3 * x)).toBeCloseTo(3.3);
  });

  it('borné : jamais sous le pied du mur, toujours un rez-de-chaussée de 2,4 m', () => {
    expect(wallGroundOffset(0, 0, 10, 0, 101, 6, flat)).toBe(0);
    expect(wallGroundOffset(0, 0, 10, 0, 90, 6, flat)).toBeCloseTo(3.6);
    expect(wallGroundOffset(0, 0, 10, 0, 90, 2, flat)).toBe(0);
  });

  it('terrain inconnu (tuile pas chargée) : façade depuis le pied du mur', () => {
    expect(wallGroundOffset(0, 0, 10, 0, 99.7, 6, () => Number.NaN)).toBe(0);
  });
});
