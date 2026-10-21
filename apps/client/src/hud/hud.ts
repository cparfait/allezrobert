import type { RouteSegment, RouteTrack } from '@allezrobert/shared';
import { t } from '../i18n/index.ts';

export interface HudRider {
  id: string;
  name: string;
  distM: number;
  x: number;
  z: number;
  me: boolean;
  isAI: boolean;
  isGuest: boolean;
  color: string;
}

export interface HudState {
  watts3s: number;
  watts: number;
  hr?: number;
  cadence: number;
  speedKmh: number;
  distM: number;
  lapDistM: number;
  elapsedS: number;
  elevationGainM: number;
  gradePercent: number;
  avgWatts: number;
  np: number;
  ftp: number;
  gearLabel: string;
  gearIndex: number;
  gearCount: number;
  balanceLeft?: number;
  draftPct: number;
  lap: number;
  riders: HudRider[];
  segment?: { seg: RouteSegment; progress: number; elapsedS: number };
  devices: Array<{ label: string; state: 'ok' | 'warn' | 'off' }>;
}

const ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
function zoneColor(watts: number, ftp: number): string {
  const r = watts / Math.max(ftp, 1);
  const idx = ZONES.findIndex((z) => r < z);
  return `var(--z${idx === -1 ? 7 : idx + 1})`;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** HUD clair et lisible : puissance au centre, profil en bas, mini-carte et coureurs à droite. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly profileCanvas: HTMLCanvasElement;
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly track: RouteTrack;
  private readonly profile: Array<{ d: number; y: number }>;
  private readonly mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly toasts: HTMLElement;

  constructor(root: HTMLElement, track: RouteTrack, attribution: string[]) {
    this.root = root;
    this.track = track;
    root.innerHTML = `
      <div class="hud-top">
        <div class="panel metric hr"><div class="label">${t('heartRate')}</div><div class="value num" data-k="hr">--</div><div class="sub">bpm</div></div>
        <div class="panel metric power" data-k="powerBox"><div class="label">${t('power')} 3 s</div><div class="value num"><span data-k="watts">0</span><span class="unit">W</span></div><div class="sub num" data-k="wkg">0,0 W/kg</div></div>
        <div class="panel metric"><div class="label">${t('cadence')}</div><div class="value num" data-k="cad">0</div><div class="sub">tr/min</div></div>
        <div class="panel metric"><div class="label">${t('speed')}</div><div class="value num" data-k="speed">0,0</div><div class="sub">km/h</div></div>
      </div>
      <div class="panel grade-badge num" data-k="grade">0,0 %</div>
      <div class="panel hud-left">
        <span class="k">${t('time')}</span><span class="v num" data-k="time">0:00</span>
        <span class="k">${t('distance')}</span><span class="v num" data-k="dist">0,00 km</span>
        <span class="k">${t('elevation')}</span><span class="v num" data-k="gain">0 m</span>
        <span class="k">${t('avgPower')}</span><span class="v num" data-k="avg">0 W</span>
        <span class="k">${t('np')}</span><span class="v num" data-k="np">0 W</span>
        <span class="k">${t('draft')}</span><span class="v num" data-k="draft">0 %</span>
        <span class="k">${t('lap')}</span><span class="v num" data-k="lap">1</span>
      </div>
      <div class="panel minimap"><canvas width="460" height="460"></canvas></div>
      <div class="panel riders" data-k="riders"></div>
      <div class="panel gearbox"><div class="label metric-label" style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('gear')}</div><div class="value num" data-k="gear">34×17</div><div class="bars" data-k="gearbars"></div></div>
      <div class="panel balance hidden" data-k="balanceBox"><div style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('balance')}</div><div class="num" data-k="balance" style="font-size:20px;font-weight:700">50 / 50</div><div class="bar"><span data-k="balanceBar" style="width:50%"></span></div></div>
      <div class="panel segment hidden" data-k="segment"><div class="name" data-k="segName"></div><div class="num" data-k="segInfo"></div><div class="bar"><span data-k="segBar" style="width:0%"></span></div></div>
      <div class="devices-chip" data-k="devices"></div>
      <div class="toasts"></div>
      <div class="panel profile"><canvas width="1800" height="160"></canvas></div>
      <div class="attribution">${attribution.join(' · ')}</div>
    `;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k as string] = e));
    this.profileCanvas = root.querySelector('.profile canvas') as HTMLCanvasElement;
    this.mapCanvas = root.querySelector('.minimap canvas') as HTMLCanvasElement;
    this.toasts = root.querySelector('.toasts') as HTMLElement;
    this.profile = track.profile(600);
    const pts = track.route.points;
    this.mapBounds = {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minZ: Math.min(...pts.map((p) => p.z)),
      maxZ: Math.max(...pts.map((p) => p.z)),
    };
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  toast(text: string): void {
    const d = document.createElement('div');
    d.className = 'panel toast';
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  update(s: HudState, massKg: number): void {
    const e = this.el;
    const nf1 = (v: number) => v.toFixed(1).replace('.', ',');
    (e.watts as HTMLElement).textContent = String(Math.round(s.watts3s));
    (e.wkg as HTMLElement).textContent = `${nf1(s.watts3s / massKg)} W/kg`;
    (e.powerBox as HTMLElement).style.borderBottomColor = zoneColor(s.watts3s, s.ftp);
    (e.hr as HTMLElement).textContent = s.hr ? String(Math.round(s.hr)) : '--';
    (e.cad as HTMLElement).textContent = String(Math.round(s.cadence));
    (e.speed as HTMLElement).textContent = nf1(s.speedKmh);
    const g = s.gradePercent;
    (e.grade as HTMLElement).textContent = `${g >= 0 ? '' : '−'}${nf1(Math.abs(g))} %`;
    (e.grade as HTMLElement).style.color = g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#eab308' : g < -1 ? '#60a5fa' : '#f5f7fa';
    (e.time as HTMLElement).textContent = fmtTime(s.elapsedS);
    (e.dist as HTMLElement).textContent = `${(s.distM / 1000).toFixed(2).replace('.', ',')} km`;
    (e.gain as HTMLElement).textContent = `${Math.round(s.elevationGainM)} m`;
    (e.avg as HTMLElement).textContent = `${Math.round(s.avgWatts)} W`;
    (e.np as HTMLElement).textContent = `${Math.round(s.np)} W`;
    (e.draft as HTMLElement).textContent = `${Math.round(s.draftPct)} %`;
    (e.lap as HTMLElement).textContent = String(s.lap);
    (e.gear as HTMLElement).textContent = s.gearLabel;
    const bars = e.gearbars as HTMLElement;
    if (bars.childElementCount !== s.gearCount) bars.innerHTML = '<i></i>'.repeat(s.gearCount);
    Array.from(bars.children).forEach((c, i) => c.classList.toggle('on', i <= s.gearIndex));
    const bb = e.balanceBox as HTMLElement;
    if (s.balanceLeft !== undefined) {
      bb.classList.remove('hidden');
      (e.balance as HTMLElement).textContent = `${Math.round(s.balanceLeft)} / ${Math.round(100 - s.balanceLeft)}`;
      (e.balanceBar as HTMLElement).style.width = `${s.balanceLeft}%`;
    } else bb.classList.add('hidden');

    const segEl = e.segment as HTMLElement;
    if (s.segment) {
      segEl.classList.remove('hidden');
      segEl.classList.toggle('sprint', s.segment.seg.kind === 'sprint');
      (e.segName as HTMLElement).textContent = `${s.segment.seg.kind === 'kom' ? t('kom') : t('sprint')} · ${s.segment.seg.name}`;
      const remain = (s.segment.seg.endM - s.segment.seg.startM) * (1 - s.segment.progress);
      (e.segInfo as HTMLElement).textContent = `${fmtTime(s.segment.elapsedS)} · ${Math.round(remain)} m`;
      (e.segBar as HTMLElement).style.width = `${(s.segment.progress * 100).toFixed(1)}%`;
    } else segEl.classList.add('hidden');

    (e.devices as HTMLElement).innerHTML = s.devices.map((d) => `<div class="${d.state}">${d.label}</div>`).join('');

    const sorted = [...s.riders].sort((a, b) => b.distM - a.distM);
    const me = sorted.find((r) => r.me);
    (e.riders as HTMLElement).innerHTML = sorted
      .slice(0, 12)
      .map((r) => {
        const gap = me && !r.me ? r.distM - me.distM : 0;
        const tag = r.me ? t('you') : r.isAI ? t('ai') : r.isGuest ? t('guest') : '';
        return `<div class="row ${r.me ? 'me' : ''}"><span><b style="color:${r.color}">●</b> ${r.name}</span><span class="gap num">${r.me ? '' : `${gap > 0 ? '+' : ''}${Math.round(gap)} m`}</span><span class="gap">${tag}</span></div>`;
      })
      .join('');

    this.drawProfile(s);
    this.drawMap(s);
  }

  private drawProfile(s: HudState): void {
    const c = this.profileCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const ys = this.profile.map((p) => p.y);
    const minY = Math.min(...ys) - 5;
    const maxY = Math.max(...ys) + 5;
    const L = this.track.length;
    const X = (d: number) => (d / L) * w;
    const Y = (y: number) => h - 8 - ((y - minY) / (maxY - minY)) * (h - 24);
    // Segments KOM / sprint en arrière-plan.
    for (const seg of this.track.route.segments) {
      ctx.fillStyle = seg.kind === 'kom' ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)';
      ctx.fillRect(X(seg.startM), 0, X(seg.endM) - X(seg.startM), h);
    }
    // Profil coloré selon la pente.
    for (let i = 1; i < this.profile.length; i++) {
      const a = this.profile[i - 1] as { d: number; y: number };
      const b = this.profile[i] as { d: number; y: number };
      const grade = ((b.y - a.y) / Math.max(b.d - a.d, 1)) * 100;
      ctx.fillStyle = grade > 6 ? '#ef4444' : grade > 3 ? '#f97316' : grade > 1 ? '#eab308' : grade < -1 ? '#3b82f6' : '#64748b';
      ctx.beginPath();
      ctx.moveTo(X(a.d), h);
      ctx.lineTo(X(a.d), Y(a.y));
      ctx.lineTo(X(b.d), Y(b.y));
      ctx.lineTo(X(b.d), h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.profile.forEach((p, i) => (i ? ctx.lineTo(X(p.d), Y(p.y)) : ctx.moveTo(X(p.d), Y(p.y))));
    ctx.stroke();
    // Coureurs.
    for (const r of s.riders) {
      const d = this.track.wrap(r.distM);
      const y = this.track.sample(d).y;
      ctx.fillStyle = r.me ? '#ffd23f' : r.color;
      ctx.beginPath();
      ctx.arc(X(d), Y(y), r.me ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
      if (r.me) {
        ctx.strokeStyle = '#0a0e16';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  private drawMap(s: HudState): void {
    const c = this.mapCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const b = this.mapBounds;
    const scale = Math.min((w - 40) / (b.maxX - b.minX), (h - 40) / (b.maxZ - b.minZ));
    const ox = (w - (b.maxX - b.minX) * scale) / 2;
    const oz = (h - (b.maxZ - b.minZ) * scale) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - b.minX) * scale, oz + (z - b.minZ) * scale];
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 9;
    const pts = this.track.route.points;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i] as { x: number; z: number };
        const [x, y] = P(p.x, p.z);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      if (this.track.route.loop) ctx.closePath();
    };
    path();
    ctx.stroke();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 5;
    path();
    ctx.stroke();
    for (const r of s.riders) {
      const [x, y] = P(r.x, r.z);
      ctx.fillStyle = r.me ? '#ffd23f' : r.color;
      ctx.beginPath();
      ctx.arc(x, y, r.me ? 10 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a0e16';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
