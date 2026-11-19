import { planRoof, type RoofPlan } from './roofs.ts';
import type { TileBuilding } from './types.ts';

const INSET_M = 2.3;
const MAX_PITCH = Math.tan((55 * Math.PI) / 180);

/** Pans à croupes autour du terrasson, déduits de l'emprise quand le profil est compatible. */
export function urbanRoofPlan(
  building: TileBuilding,
  material: string | undefined,
  total: number,
  overhang: number,
  ileDeFrance: boolean,
): { plan: RoofPlan; height: number } | null {
  const levels = building.levels ?? Math.round(total / 3);
  const minLevels = ileDeFrance || building.roof === 'mansard' ? 3 : 4;
  if (total < 11 || levels < minLevels) return null;
  if (material !== 'metal' && material !== 'slate') return null;
  const shape = building.roof;
  if (shape && shape !== 'gabled' && shape !== 'hipped' && shape !== 'mansard') return null;
  // Une toiture presque plate ou un grand comble mesuré garde sa géométrie habituelle.
  const height = building.roofHeight ?? 2.5;
  if (height < 0.9 || height > 4.5) return null;
  const inset = Math.max(INSET_M, height / MAX_PITCH);
  const plan = planRoof(building.pts, { overhang, gableOverhang: 0, gabled: false, maxInset: overhang + inset });
  if (!plan || plan.tEnd - overhang < 0.8) return null;
  return { plan, height };
}
