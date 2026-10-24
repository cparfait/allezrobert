/**
 * Carte et profil d'altitude sur canvas, d'après la route envoyée par le jeu (`PairRoute` :
 * points décimés x, z, altitude, distance). Pas de fond de carte (aucune tuile tierce à
 * charger sur le téléphone). x = est, z = sud ; nord en haut.
 * Monde ouvert : la route n'est qu'une fenêtre autour du coureur, renvoyée au fil de la sortie.
 */
import type { PairRider, PairRoute } from '@allezrobert/shared';
import { drawClimbProfile, type Climb } from '@allezrobert/shared';

export class RouteGeo {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly ds: Float64Array;
  readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };

  constructor(readonly route: PairRoute) {
    const n = Math.floor(route.points.length / 4);
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.ds = new Float64Array(n);
    const b = this.bounds;
    for (let i = 0; i < n; i++) {
      const x = route.points[4 * i]!;
      const z = route.points[4 * i + 1]!;
      const y = route.points[4 * i + 2]!;
      this.xs[i] = x;
      this.zs[i] = z;
      this.ys[i] = y;
      this.ds[i] = route.points[4 * i + 3]!;
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
    }
  }

  get size(): number {
    return this.xs.length;
  }

  get startD(): number {
    return this.ds[0] ?? 0;
  }

  get endD(): number {
    return this.ds[this.size - 1] ?? 0;
  }

  /** Distance ramenée sur l'itinéraire (boucle : modulo la longueur). */
  wrap(d: number): number {
    const L = this.route.lengthM;
    return this.route.loop && L > 0 ? ((d % L) + L) % L : d;
  }

  /** Indice fractionnaire du point à la distance `d` (recherche dichotomique). */
  private index(d: number): number {
    const ds = this.ds;
    const n = ds.length;
    if (n < 2 || d <= ds[0]!) return 0;
    if (d >= ds[n - 1]!) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ds[mid]! <= d) lo = mid;
      else hi = mid;
    }
    return lo + (d - ds[lo]!) / Math.max(ds[hi]! - ds[lo]!, 1e-6);
  }

  private lerp(a: Float64Array, f: number): number {
    const i = Math.floor(f);
    const j = Math.min(i + 1, a.length - 1);
    return a[i]! + (a[j]! - a[i]!) * (f - i);
  }

  at(d: number): { x: number; z: number } {
    const f = this.index(this.wrap(d));
    return { x: this.lerp(this.xs, f), z: this.lerp(this.zs, f) };
  }

  elevationAt(d: number): number {
    return this.lerp(this.ys, this.index(this.wrap(d)));
  }
}

function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export interface MapView {
  /** Distance du coureur sur la route (m). */
  routeM: number;
  pos?: { x: number; z: number; heading: number };
  riders: PairRider[];
  follow: boolean;
}

export function drawMap(canvas: HTMLCanvasElement, geo: RouteGeo, v: MapView): void {
  const c = fit(canvas);
  if (!c || geo.size < 2) return;
  const { ctx, w, h } = c;
  const b = geo.bounds;
  const me = v.pos ?? { ...geo.at(v.routeM), heading: 0 };
  let cx = (b.minX + b.maxX) / 2;
  let cz = (b.minZ + b.maxZ) / 2;
  let spanX = b.maxX - b.minX;
  let spanZ = b.maxZ - b.minZ;
  if (v.follow) {
    cx = me.x;
    cz = me.z;
    spanX = spanZ = 1400;
  }
  const scale = Math.min((w - 40) / Math.max(spanX, 1), (h - 40) / Math.max(spanZ, 1));
  const px = (x: number) => w / 2 + (x - cx) * scale;
  const pz = (z: number) => h / 2 + (z - cz) * scale;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < geo.size; i++) {
    if (i === 0) ctx.moveTo(px(geo.xs[i]!), pz(geo.zs[i]!));
    else ctx.lineTo(px(geo.xs[i]!), pz(geo.zs[i]!));
  }
  if (geo.route.loop) ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#8fb3ff';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Départ (itinéraire fixe).
  if (!geo.route.open) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(px(geo.xs[0]!) - 4, pz(geo.zs[0]!) - 4, 8, 8);
  }

  // Autres coureurs : placés par leur écart sur la route.
  const labeled: Array<{ x: number; y: number }> = [{ x: px(me.x), y: pz(me.z) }];
  for (const r of v.riders) {
    if (r.me) continue;
    const d = v.routeM + r.gapM;
    if (!geo.route.loop && (d < geo.startD || d > geo.endD)) continue;
    const p = geo.at(d);
    const X = px(p.x);
    const Z = pz(p.z);
    ctx.beginPath();
    ctx.arc(X, Z, 6, 0, Math.PI * 2);
    ctx.fillStyle = r.ai ? '#9aa4b2' : r.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10151c';
    ctx.stroke();
    if (v.follow && labeled.every((q) => Math.abs(q.x - X) > 70 || Math.abs(q.y - Z) > 14)) {
      labeled.push({ x: X, y: Z });
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name, X + 10, Z - 8);
    }
  }

  // Soi : flèche dans le sens de marche.
  const X = px(me.x);
  const Z = pz(me.z);
  ctx.save();
  ctx.translate(X, Z);
  ctx.rotate(Math.atan2(Math.cos(me.heading), Math.sin(me.heading)));
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(-8, 8);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, -8);
  ctx.closePath();
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#10151c';
  ctx.stroke();
  ctx.restore();
}

/**
 * Profil d'altitude entre `from` et `to` (m), position du coureur marquée, pente colorée.
 * Légende : altitude mini / maxi de la fenêtre.
 */
export function drawProfile(canvas: HTMLCanvasElement, geo: RouteGeo, routeM: number, from: number, to: number): void {
  const c = fit(canvas);
  if (!c || geo.size < 2 || to <= from) return;
  const { ctx, w, h } = c;
  const N = Math.min(240, Math.round(w / 2));
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) ys.push(geo.elevationAt(from + ((to - from) * i) / N));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = Math.max(maxY - minY, 15);
  const top = 16;
  const bottom = h - 4;
  const Y = (y: number) => bottom - ((y - minY) / range) * (bottom - top);
  const X = (i: number) => (i / N) * w;
  // Remplissage coloré selon la pente de chaque tranche, lissée sur 80 m (points décimés bruités).
  const dx = (to - from) / N;
  for (let i = 0; i < N; i++) {
    const d = from + dx * (i + 0.5);
    const g = ((geo.elevationAt(d + 40) - geo.elevationAt(d - 40)) / 80) * 100;
    ctx.fillStyle = g > 8 ? '#e5484d' : g > 5 ? '#f97316' : g > 2.5 ? '#facc15' : g < -2 ? '#3b82f6' : '#4cd96488';
    ctx.beginPath();
    ctx.moveTo(X(i), bottom);
    ctx.lineTo(X(i), Y(ys[i]!));
    ctx.lineTo(X(i + 1), Y(ys[i + 1]!));
    ctx.lineTo(X(i + 1), bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ys.forEach((y, i) => (i ? ctx.lineTo(X(i), Y(y)) : ctx.moveTo(X(i), Y(y))));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Position.
  const fx = ((routeM - from) / (to - from)) * w;
  if (fx >= 0 && fx <= w) {
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(fx - 1.5, top - 6, 3, bottom - top + 6);
    ctx.beginPath();
    ctx.arc(fx, Y(geo.elevationAt(routeM)), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(maxY)} m`, w - 4, 11);
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(minY)} m`, 4, 11);
}

/** Profil d'une montée façon ClimbPro (dessin partagé avec le HUD du jeu). */
export function drawClimb(canvas: HTMLCanvasElement, c: Climb, pos: number, nf: (v: number, d?: number) => string): void {
  const fc = fit(canvas);
  if (fc) drawClimbProfile(fc.ctx, fc.w, fc.h, c, pos, nf);
}
