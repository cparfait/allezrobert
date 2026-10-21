import type { RideSession } from '../game/ride.ts';
import { getLang } from '../i18n/index.ts';

/**
 * Image de fin de sortie à partager (1200 × 630, format des aperçus de liens) : tracé,
 * distance, durée, puissance moyenne et normalisée, TSS, kcal, segments réalisés.
 */
export async function shareCard(ride: RideSession, opts: { routeName: string; riderName: string; ftp: number; photo?: string }): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const fr = getLang() === 'fr';
  // Fond : photo de la sortie assombrie si fournie, sinon dégradé nuit → or.
  if (opts.photo) {
    const img = await createImageBitmap(await (await fetch(opts.photo)).blob());
    const scale = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * scale) / 2, (H - img.height * scale) / 2, img.width * scale, img.height * scale);
    ctx.fillStyle = 'rgba(10,14,22,0.55)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0a0e16');
    g.addColorStop(1, '#3a2a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Tracé (repère monde x/z), ajusté dans le cadre de droite.
  const pts = ride.records as Array<{ x?: number; z?: number }>;
  const xs = pts.map((p) => p.x ?? 0);
  const zs = pts.map((p) => p.z ?? 0);
  if (pts.length > 2) {
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const box = { x: 700, y: 90, w: 440, h: 440 };
    const s = Math.min(box.w / Math.max(maxX - minX, 1), box.h / Math.max(maxZ - minZ, 1));
    const ox = box.x + (box.w - (maxX - minX) * s) / 2;
    const oz = box.y + (box.h - (maxZ - minZ) * s) / 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [w, col] of [
      [14, 'rgba(0,0,0,0.45)'],
      [7, '#ffd23f'],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const X = ox + ((p.x ?? 0) - minX) * s;
        const Y = oz + ((p.z ?? 0) - minZ) * s;
        if (i) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
      });
      ctx.stroke();
    }
  }
  const km = (ride.records.at(-1)?.distanceM ?? 0) / 1000;
  const np = ride.normalizedPower();
  const ifactor = np / Math.max(opts.ftp, 1);
  const tss = (ride.elapsedS * np * ifactor) / (Math.max(opts.ftp, 1) * 3600) * 100;
  const kcal = (ride.avgWatts() * ride.elapsedS) / 1000 / 0.24 / 4.184;
  const h = Math.floor(ride.elapsedS / 3600);
  const m = Math.floor((ride.elapsedS % 3600) / 60);
  ctx.fillStyle = '#ffd23f';
  ctx.font = '800 54px Inter, "Segoe UI", sans-serif';
  ctx.fillText('Allez Robert !', 60, 100);
  ctx.fillStyle = '#f5f7fa';
  ctx.font = '600 28px Inter, "Segoe UI", sans-serif';
  const title = `${opts.riderName} · ${opts.routeName}`;
  ctx.fillText(title.length > 46 ? `${title.slice(0, 45).trimEnd()}…` : title, 60, 148);
  const stats: Array<[string, string]> = [
    [fr ? 'Distance' : 'Distance', `${km.toFixed(1).replace('.', fr ? ',' : '.')} km`],
    [fr ? 'Durée' : 'Time', h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`],
    [fr ? 'Puissance moy.' : 'Avg power', `${Math.round(ride.avgWatts())} W`],
    ['NP', `${Math.round(np)} W`],
    ['TSS', `${Math.round(tss)}`],
    ['kcal', `${Math.round(kcal)}`],
    ['D+', `${Math.round(ride.elevationGainM)} m`],
  ];
  stats.forEach(([k, v], i) => {
    const x = 60 + (i % 2) * 300;
    const y = 220 + Math.floor(i / 2) * 92;
    ctx.fillStyle = '#9aa5b1';
    ctx.font = '600 20px Inter, "Segoe UI", sans-serif';
    ctx.fillText(k.toUpperCase(), x, y);
    ctx.fillStyle = '#f5f7fa';
    ctx.font = '800 44px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(v, x, y + 46);
  });
  // Trophées : segments réalisés.
  ctx.font = '600 22px Inter, "Segoe UI", sans-serif';
  let x = 60;
  for (const r of ride.segmentResults.slice(0, 2)) {
    const label = `${r.seg.kind === 'kom' ? '⛰' : '⚡'} ${r.seg.name} ${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`;
    ctx.fillStyle = r.seg.kind === 'kom' ? '#f87171' : '#4ade80';
    ctx.fillText(label, x, 596);
    x += ctx.measureText(label).width + 36;
  }
  return c.convertToBlob({ type: 'image/png' });
}
