import { rng } from '../engine/noise.ts';
import type { TileBuilding } from './types.ts';

type HouseForm = Pick<TileBuilding, 'levels' | 'height' | 'roof' | 'roofHeight' | 'roofMaterial' | 'ridgeShort' | 'material'>;
type HouseFamily = HouseForm & { colours: readonly [string, ...string[]] };

const FISHERMEN: HouseFamily = {
  levels: 1, height: 5.6, roof: 'gabled', roofHeight: 2.2, roofMaterial: 'slate', material: 'stone',
  colours: ['#efe3c9', '#c4d4cf', '#e6c29a', '#c4b4a3'],
};
const TOWNHOUSE: HouseFamily = {
  levels: 2, height: 9.1, roof: 'gabled', roofHeight: 3.1, roofMaterial: 'tiles', material: 'brick', ridgeShort: true,
  colours: ['#bc7866', '#d9a07b', '#e0be91', '#a96f62'],
};
const VILLA: HouseFamily = {
  levels: 2, height: 10.8, roof: 'hipped', roofHeight: 4.6, roofMaterial: 'slate', material: 'plaster',
  colours: ['#e6d8b9', '#a4c9c0', '#e5b8a1', '#c4cad9'],
};
const TALL_VILLA: HouseFamily = {
  levels: 3, height: 13.5, roof: 'gabled', roofHeight: 3.8, roofMaterial: 'slate', material: 'plaster', ridgeShort: true,
  colours: ['#e9e0d0', '#d7a472', '#b3c3bc', '#e4bcb2'],
};
const BUNGALOW: HouseFamily = {
  levels: 1, height: 4.8, roof: 'hipped', roofHeight: 1.35, roofMaterial: 'tiles', material: 'plaster',
  colours: ['#dfcea1', '#f0dcc9', '#b7cdb1', '#a9c6d3'],
};
const STUDIO: HouseFamily = {
  levels: 1, height: 3.8, roof: 'skillion', roofHeight: 0.95, roofMaterial: 'metal', material: 'wood',
  colours: ['#697a71', '#47767c', '#ab7465', '#bea18c'],
};
const TERRACE: HouseFamily = {
  levels: 2, height: 6.4, roof: 'flat', roofHeight: 0, roofMaterial: 'concrete', material: 'concrete',
  colours: ['#e4dcd0', '#c1bec0', '#d1c4a6', '#a7b7c5'],
};

const SEAFRONT = [FISHERMEN, VILLA, VILLA, TALL_VILLA, TOWNHOUSE, TERRACE, BUNGALOW] as const;
const RESIDENTIAL = [BUNGALOW, FISHERMEN, TOWNHOUSE, STUDIO, BUNGALOW, VILLA, TERRACE] as const;

const CABIN_ROOFS = ['#f3f1ea', '#e2e6e6', '#f3f1ea', '#cfd8dc'] as const;

/** Cabine de plage : petit abri de bois devant les Planches. */
export function isBeachCabin(building: TileBuilding): boolean {
  if (building.kind !== 'shed' || building.pts.length !== 8) return false;
  const [ax, az, bx, bz, cx, cz] = building.pts as [number, number, number, number, number, number];
  if (ax < -420 || ax > 1560 || az < 9980 || az > 10460) return false;
  return Math.hypot(bx - ax, bz - az) < 2.4 && Math.hypot(cx - bx, cz - bz) < 2.4;
}

/** Varie les silhouettes et façades de Robertville à partir des emprises existantes. */
export function robertvilleBuilding(building: TileBuilding): TileBuilding {
  // Cabines blanches, comme sur les plages normandes et du Nord : pignon pointu, petit débord, toit clair.
  if (isBeachCabin(building)) {
    const i = Math.abs(Math.round(building.pts[0]! / 2.7));
    return { ...building, colour: '#fdfcf8', height: 3.5, roof: 'gabled', roofHeight: 1, roofMaterial: 'metal', roofColour: CABIN_ROOFS[i % CABIN_ROOFS.length]!, roofOverhang: 0.16 };
  }
  if (building.kind !== 'house' || building.pts.length < 6) return building;
  let x = 0;
  let z = 0;
  for (let i = 0; i < building.pts.length; i += 2) {
    x += building.pts[i]!;
    z += building.pts[i + 1]!;
  }
  const corners = building.pts.length / 2;
  x /= corners;
  z /= corners;
  if (x < -2300 || x > 3800 || z < 8650 || z > 10850) return building;

  const random = rng(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663));
  const families = z > 9550 - x * 0.15 ? SEAFRONT : RESIDENTIAL;
  const { colours, ...form } = families[Math.floor(random() * families.length)]!;
  return {
    ...building,
    ...form,
    ridgeShort: form.ridgeShort ?? false,
    height: form.height * (0.94 + random() * 0.12),
    colour: colours[Math.floor(random() * colours.length)]!,
  };
}
