/**
 * Relief lointain (ligne d'horizon) : grille unique de `resM` m sur ±`halfSizeM` autour de
 * l'origine, pour les sommets visibles au-delà des tuiles. Pas de 10 cm au moins (dénivelé > 655 m).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorldHorizon } from '@allezrobert/shared';
import { Dem } from './dem.ts';
import { worldToL93 } from './frame.ts';
import { encodeGrid, tileStepM } from './tiles.ts';

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function writeHorizon(halfSizeM: number, resM: number, outDir: string, log: (s: string) => void): Promise<WorldHorizon> {
  const H = halfSizeM;
  const res = resM;
  const far = new Dem(`far`, res, 10000, 64);
  const a = worldToL93(-H, H);
  const b = worldToL93(H, -H);
  await far.ensure(a.e, a.n, b.e - 1e-6, b.n - 1e-6);
  const nn = Math.round((2 * H) / res);
  const N = nn + 1;
  const h = new Float32Array(N * N);
  let minM = Infinity;
  let maxM = -Infinity;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const l = worldToL93(-H + i * res, -H + j * res);
      let v = far.sample(l.e, l.n);
      if (!Number.isFinite(v)) v = 0;
      h[j * N + i] = v;
      minM = Math.min(minM, v);
      maxM = Math.max(maxM, v);
    }
  const baseM = Math.floor(minM) - 1;
  const stepM = Math.max(0.1, tileStepM(maxM - baseM));
  const buf = encodeGrid({ n: nn, res, x0: -H, z0: -H, h }, baseM, stepM);
  const file = 'tiles/horizon.u16';
  fs.writeFileSync(path.join(outDir, file), buf);
  log(`   horizon : ${N}×${N} à ${res} m (±${H / 1000} km), ${minM.toFixed(0)}–${maxM.toFixed(0)} m, ${(buf.length / 1e6).toFixed(2)} Mo`);
  return { file, x0: -H, z0: -H, n: nn, resolutionM: res, baseM, stepM, minM: r2(minM), maxM: r2(maxM) };
}
