import type { LoadedTile, Rings } from './types.ts';
import { SPLAT_CHANNELS } from './types.ts';

const RES = 256;

/** Occupations du sol OSM rangées par canal. */
const FIELD_KINDS = new Set(['farmland', 'orchard', 'vineyard', 'allotments', 'farmyard', 'bare', 'sand']);
const MEADOW_KINDS = new Set(['meadow', 'grass', 'heath', 'scrub', 'wetland', 'park', 'golf', 'pitch', 'cemetery', 'garden']);
const URBAN_KINDS = new Set(['residential', 'industrial', 'commercial', 'railway', 'quarry', 'retail']);

/**
 * Rastérise les entités vectorielles d'une tuile en carte d'occupation du sol
 * (forêt, champ, prairie, eau, urbain, route), utilisée par le matériau du terrain
 * et le placement de la végétation. Les trous des polygones sont respectés (pair-impair).
 */
export function rasterizeSplat(tile: LoadedTile, skipRoute: string | null = null): { res: number; data: Uint8Array } {
  const canvas = new OffscreenCanvas(RES, RES);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const scale = RES / tile.size;
  const data = new Uint8Array(RES * RES * SPLAT_CHANNELS.length);
  const f = tile.features;

  const line = (pts: number[], stride = 2) => {
    for (let i = 0; i < pts.length; i += stride) {
      const x = ((pts[i] as number) - tile.x0) * scale;
      const y = ((pts[i + (stride === 3 ? 2 : 1)] as number) - tile.z0) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  const poly = (rings: Rings) => {
    ctx.beginPath();
    for (const r of rings) {
      line(r);
      ctx.closePath();
    }
    ctx.fill('evenodd');
  };

  const channelDraws: Array<() => void> = [
    () => f.forests.forEach((p) => poly(p.rings)),
    () => {
      f.fields.filter((p) => FIELD_KINDS.has(p.kind)).forEach((p) => poly(p.rings));
      f.landuse.filter((p) => FIELD_KINDS.has(p.kind)).forEach((p) => poly(p.rings));
    },
    () => {
      f.fields.filter((p) => MEADOW_KINDS.has(p.kind)).forEach((p) => poly(p.rings));
      f.landuse.filter((p) => MEADOW_KINDS.has(p.kind)).forEach((p) => poly(p.rings));
    },
    () => {
      f.water.forEach((p) => poly(p.rings));
      f.waterways
        .filter((w) => !w.tunnel)
        .forEach((w) => {
          ctx.lineWidth = Math.max(w.width * scale, 1);
          ctx.beginPath();
          line(w.pts);
          ctx.stroke();
        });
    },
    () => {
      f.landuse.filter((p) => URBAN_KINDS.has(p.kind)).forEach((p) => poly(p.rings));
      // Emprises élargies autour des bâtiments (jardins, cours).
      ctx.lineWidth = 12 * scale;
      ctx.lineJoin = 'round';
      f.buildings.forEach((b) => {
        ctx.beginPath();
        line(b.pts);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    },
    () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      f.roads
        // la chaussée de l'itinéraire actif est le ruban de RoadMesh : la teinter ici déborderait
        // de ±4 m (un pixel ≈ 4 m) sur ses bas-côtés
        .filter((r) => !r.tunnel && (!skipRoute || r.route !== skipRoute))
        .forEach((r) => {
          ctx.lineWidth = Math.max(r.width * scale, 1);
          ctx.beginPath();
          if (r.pts3) line(r.pts3, 3);
          else line(r.pts);
          ctx.stroke();
        });
    },
    () => {
      if (!skipRoute) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      f.roads
        .filter((r) => r.route === skipRoute)
        .forEach((r) => {
          ctx.lineWidth = (r.width + 9) * scale;
          ctx.beginPath();
          if (r.pts3) line(r.pts3, 3);
          else line(r.pts);
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
