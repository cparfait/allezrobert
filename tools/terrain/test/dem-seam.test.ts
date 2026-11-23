import { describe, expect, it } from 'vitest';
import { seamBlend } from '../src/dem.ts';

/** Fenêtre de 401 pixels de 1 m : LiDAR à gauche de la colonne `edge`, RGE ALTI partout, `offset` plus bas que le LiDAR. */
function scene(offset: number, edge = 200, W = 401) {
  const ground = (i: number, j: number) => 100 + i * 0.02 + j * 0.01;
  const lidar = new Float32Array(W * W);
  const alti = new Float32Array(W * W);
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      lidar[j * W + i] = i < edge ? ground(i, j) : -99999;
      alti[j * W + i] = ground(i, j) - offset;
    }
  return { lidar, alti, W, ground };
}

describe('seamBlend : RGE ALTI recalé sur le LiDAR à la limite de couverture', () => {
  it('plus de marche à la limite, écart effacé en fondu au loin', () => {
    const { lidar, alti, W, ground } = scene(0.8);
    const { merged, mask } = seamBlend(lidar, alti, W, 1, 150);
    const j = 200;
    const at = (i: number) => merged[j * W + i]! - ground(i, j);
    expect(mask.every((m) => m === 0)).toBe(true);
    // côté LiDAR : intact
    expect(at(150)).toBeCloseTo(0, 5);
    // juste après la limite (pixels de bord dilatés compris) : au niveau du LiDAR, sans marche de 80 cm
    for (let i = 197; i < 215; i++) expect(Math.abs(at(i))).toBeLessThan(0.08);
    // le pas d'un pixel au suivant reste petit partout (au plus ~2 cm de plus que la pente du sol)
    for (let i = 150; i < 400; i++) expect(Math.abs(at(i + 1) - at(i))).toBeLessThan(0.03);
    // au-delà du fondu : RGE ALTI tel quel
    expect(at(390)).toBeCloseTo(-0.8, 2);
  });

  it('sans écart entre les sources : la fusion rend le RGE ALTI tel quel', () => {
    const { lidar, alti, W } = scene(0);
    const { merged, corrected } = seamBlend(lidar, alti, W, 1, 150);
    expect(corrected).toBe(0);
    for (let i = 200; i < 400; i += 17) expect(merged[200 * W + i]).toBeCloseTo(alti[200 * W + i]!, 4);
  });

  it('pixels sans aucune source : laissés masqués pour le bouchage', () => {
    const { lidar, alti, W } = scene(0.5);
    alti[10 * W + 300] = -99999;
    const { mask } = seamBlend(lidar, alti, W, 1, 150);
    expect(mask[10 * W + 300]).toBe(1);
  });
});
