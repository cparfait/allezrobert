/** Classes APUR : 0 sans végétation détectée, 1 végétation basse, 2 végétation de 1 m et plus. */
export interface ApurVegetationTile {
  res: number;
  classes: Uint8Array;
}

const HEADER_BYTES = 18;
const GRID_M = 1000;
const CREDIT = '© Apur, IGN 2021 — Couverture végétale du Grand Paris (ODbL 1.0)';
const withinSurvey = (east: number, north: number) => east >= 636000 && east < 673000 && north > 6837000 && north <= 6882000;

export function apurVegetationCredit(origin: { x: number; y: number }, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): string[] {
  return origin.x + bounds.minX < 673000 && origin.x + bounds.maxX > 636000
    && origin.y - bounds.maxZ < 6882000 && origin.y - bounds.minZ > 6837000 ? [CREDIT] : [];
}

/** Extrait une tuile dans le repère Lambert-93 en mètres (coin nord-ouest). */
export function decodeApurTile(atlas: ArrayBuffer, east: number, north: number): ApurVegetationTile | undefined {
  if (atlas.byteLength < HEADER_BYTES || east % GRID_M || north % GRID_M) return undefined;
  const header = new DataView(atlas);
  if (header.getUint32(0) !== 0x41505631) return undefined; // APV1
  const x = east / GRID_M - header.getInt32(4, true);
  const z = header.getInt32(8, true) - north / GRID_M;
  const cols = header.getUint16(12, true);
  const rows = header.getUint16(14, true);
  const res = header.getUint16(16, true);
  if (res !== 128 || x < 0 || z < 0 || x >= cols || z >= rows) return undefined;
  if (atlas.byteLength !== HEADER_BYTES + cols * rows * res * res / 4) return undefined;
  const bytes = new Uint8Array(atlas, HEADER_BYTES);
  const classes = new Uint8Array(res * res);
  let vegetated = false;
  for (let row = 0; row < res; row++) {
    const start = ((z * res + row) * cols + x) * res / 4;
    for (let i = 0; i < res; i++) {
      const kind = (bytes[start + (i >> 2)]! >> ((i & 3) * 2)) & 3;
      classes[row * res + i] = kind;
      vegetated ||= kind !== 0;
    }
  }
  // En dehors de la zone photographiée, un aplat de zéros ne remplace pas les données OSM.
  return vegetated ? { res, classes } : undefined;
}

let atlas: Promise<ArrayBuffer | undefined> | undefined;

export async function loadApurVegetation(east: number, north: number, size: number): Promise<ApurVegetationTile | undefined> {
  if (typeof location === 'undefined' || size !== GRID_M || !withinSurvey(east, north)) return undefined;
  atlas ??= fetch('/geo/grand-paris-vegetation.bin.gz').then(async (r) => {
    if (!r.ok || !r.body) return undefined;
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }).catch(() => undefined);
  const data = await atlas;
  return data ? decodeApurTile(data, east, north) : undefined;
}
