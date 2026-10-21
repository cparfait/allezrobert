import type { LoadedTile } from './types.ts';
import { SPLAT_CHANNELS } from './types.ts';

const RES = 256;

/**
 * Rastérise les entités vectorielles d'une tuile en carte d'occupation du sol
 * (forêt, champ, prairie, eau, urbain, route), utilisée par le matériau du terrain
 * et le placement de la végétation.
 */
export function rasterizeSplat(tile: LoadedTile): { res: number; data: Uint8Array } {
  const canvas = new OffscreenCanvas(RES, RES);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const scale = RES / tile.size;
  const data = new Uint8Array(RES * RES * SPLAT_CHANNELS.length);
  const f = tile.features;

  const path = (pts: number[]) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = ((pts[i] as number) - tile.x0) * scale;
      const y = ((pts[i + 1] as number) - tile.z0) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  const channelDraws: Array<() => void> = [
    () => f.forests.forEach((p) => (path(p.pts), ctx.closePath(), ctx.fill())),
    () => f.fields.filter((p) => p.kind === 'farmland' || p.kind === 'orchard').forEach((p) => (path(p.pts), ctx.closePath(), ctx.fill())),
    () => f.fields.filter((p) => p.kind === 'meadow' || p.kind === 'grass').forEach((p) => (path(p.pts), ctx.closePath(), ctx.fill())),
    () => {
      f.water.forEach((p) => (path(p.pts), ctx.closePath(), ctx.fill()));
      f.waterways.forEach((w) => {
        ctx.lineWidth = Math.max(w.width * scale, 1);
        path(w.pts);
        ctx.stroke();
      });
    },
    () => {
      // Zones bâties : emprises élargies autour des bâtiments (jardins, cours).
      ctx.lineWidth = 14 * scale;
      ctx.lineJoin = 'round';
      f.buildings.forEach((b) => (path(b.pts), ctx.closePath(), ctx.fill(), ctx.stroke()));
    },
    () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      f.roads.forEach((r) => {
        ctx.lineWidth = Math.max(r.width * scale, 1);
        path(r.pts);
        ctx.stroke();
      });
    },
  ];

  channelDraws.forEach((draw, c) => {
    ctx.clearRect(0, 0, RES, RES);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    draw();
    const img = ctx.getImageData(0, 0, RES, RES).data;
    for (let i = 0; i < RES * RES; i++) data[i * SPLAT_CHANNELS.length + c] = img[i * 4 + 3] as number;
  });
  return { res: RES, data };
}

/** Lecture d'un canal du raster à une position monde (0–1). */
export function splatAt(tile: LoadedTile, channel: number, x: number, z: number): number {
  const s = tile.splat;
  if (!s) return 0;
  const i = Math.min(Math.max(Math.floor(((x - tile.x0) / tile.size) * s.res), 0), s.res - 1);
  const j = Math.min(Math.max(Math.floor(((z - tile.z0) / tile.size) * s.res), 0), s.res - 1);
  return (s.data[(j * s.res + i) * SPLAT_CHANNELS.length + channel] as number) / 255;
}
