/**
 * Carte de la sortie sur canvas : polyligne décimée de l'itinéraire (x = est, z = sud),
 * coureurs positionnés par distance + décalage latéral, profil d'altitude en bas.
 * Pas de fond de carte (aucune tuile tierce à charger sur le téléphone).
 */
import type { RouteSummary } from '@allezrobert/shared';
import type { InterpolatedRider } from '../../client/src/net/index.ts';

export class RouteGeometry {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly step: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };

  constructor(readonly route: RouteSummary) {
    const n = route.polyline.length / 3;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.ys = new Float64Array(n);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = route.polyline[3 * i]!;
      const z = route.polyline[3 * i + 1]!;
      const y = route.polyline[3 * i + 2]!;
      this.xs[i] = x;
      this.zs[i] = z;
      this.ys[i] = y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    this.step = route.lengthM / Math.max(n - 1, 1);
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
  }

  /** Position (x, z) et direction à une distance donnée, avec décalage latéral (+ = droite). */
  at(d: number, lateral = 0): { x: number; z: number } {
    const n = this.xs.length;
    const L = this.route.lengthM;
    const dd = this.route.loop ? ((d % L) + L) % L : Math.min(Math.max(d, 0), L);
    const f = Math.min(dd / this.step, n - 1.000001);
    const i = Math.floor(f);
    const t = f - i;
    const j = Math.min(i + 1, n - 1);
    const x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t;
    const z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t;
    let dx = this.xs[j]! - this.xs[i]!;
    let dz = this.zs[j]! - this.zs[i]!;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    return { x: x - dz * lateral, z: z + dx * lateral };
  }

  elevationAt(d: number): number {
    const f = Math.min(Math.max(d / this.step, 0), this.ys.length - 1.000001);
    const i = Math.floor(f);
    return this.ys[i]! + (this.ys[Math.min(i + 1, this.ys.length - 1)]! - this.ys[i]!) * (f - i);
  }
}

export interface MapRider extends InterpolatedRider {
  self: boolean;
}

export function drawMap(canvas: HTMLCanvasElement, geo: RouteGeometry, riders: MapRider[], opts: { follow: boolean }): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const profileH = Math.min(70, h * 0.22);
  const mapH = h - profileH - 8;
  const b = geo.bounds;
  const self = riders.find((r) => r.self);

  // Vue : tout l'itinéraire, ou zoom de ~1,2 km centré sur soi.
  let cx = (b.minX + b.maxX) / 2;
  let cz = (b.minZ + b.maxZ) / 2;
  let spanX = b.maxX - b.minX;
  let spanZ = b.maxZ - b.minZ;
  if (opts.follow && self) {
    const p = geo.at(self.distM, self.lateralM);
    cx = p.x;
    cz = p.z;
    spanX = spanZ = 1200;
  }
  const scale = Math.min((w - 32) / Math.max(spanX, 1), (mapH - 32) / Math.max(spanZ, 1));
  const px = (x: number): number => w / 2 + (x - cx) * scale;
  const pz = (z: number): number => mapH / 2 + (z - cz) * scale;

  // Itinéraire.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  for (let i = 0; i < geo.xs.length; i++) {
    const X = px(geo.xs[i]!);
    const Z = pz(geo.zs[i]!);
    if (i === 0) ctx.moveTo(X, Z);
    else ctx.lineTo(X, Z);
  }
  if (geo.route.loop) ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#8fb3ff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Segments KOM (rouge) / sprint (vert).
  for (const s of geo.route.segments) {
    ctx.strokeStyle = s.kind === 'kom' ? '#ff5d5d' : s.kind === 'sprint' ? '#4cd964' : '#c9a0ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let d = s.startM; d <= s.endM; d += geo.step) {
      const p = geo.at(d);
      if (d === s.startM) ctx.moveTo(px(p.x), pz(p.z));
      else ctx.lineTo(px(p.x), pz(p.z));
    }
    ctx.stroke();
  }
  // Ligne de départ.
  const start = geo.at(0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(px(start.x) - 4, pz(start.z) - 4, 8, 8);

  // Coureurs (soi en dernier, au-dessus).
  const sorted = [...riders].sort((a, b2) => Number(a.self) - Number(b2.self));
  // Étiquettes : soi d'abord, puis les autres seulement s'ils ne chevauchent pas une étiquette posée.
  const labeled: Array<{ x: number; y: number }> = [];
  const canLabel = (x: number, y: number): boolean => labeled.every((p) => Math.abs(p.x - x) > 70 || Math.abs(p.y - y) > 14);
  if (self) {
    const p = geo.at(self.distM, self.lateralM);
    labeled.push({ x: px(p.x), y: pz(p.z) });
  }
  for (const r of sorted) {
    const p = geo.at(r.distM, r.lateralM);
    const X = px(p.x);
    const Z = pz(p.z);
    ctx.beginPath();
    ctx.arc(X, Z, r.self ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = r.self ? '#ffd23f' : r.isAI ? '#9aa4b2' : r.avatar.jersey;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = r.isGuest ? '#ffffff' : '#10151c';
    if (r.isGuest) ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (r.self || (opts.follow && canLabel(X, Z))) {
      if (!r.self) labeled.push({ x: X, y: Z });
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name, X + 11, Z - 8);
    }
  }

  // Profil d'altitude.
  const top = h - profileH;
  const yRange = Math.max(b.maxY - b.minY, 10);
  ctx.fillStyle = 'rgba(143,179,255,0.18)';
  ctx.strokeStyle = '#8fb3ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const L = geo.route.lengthM;
  for (let i = 0; i <= 200; i++) {
    const d = (i / 200) * L;
    ctx.lineTo((i / 200) * w, top + profileH - ((geo.elevationAt(d) - b.minY) / yRange) * (profileH - 6));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const r of sorted) {
    const x = (r.distM / L) * w;
    ctx.fillStyle = r.self ? '#ffd23f' : r.isAI ? '#9aa4b2' : r.avatar.jersey;
    ctx.fillRect(x - (r.self ? 2 : 1), top, r.self ? 4 : 2, profileH);
  }
}
