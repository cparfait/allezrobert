import type { RoadGraphData, RouteSegment, RouteTrack } from '@allezrobert/shared';
import { getLang, t } from '../i18n/index.ts';

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
  /** Parle en ce moment dans le chat vocal. */
  speaking?: boolean;
  /** Coureur humain en ligne (peut recevoir un « Ride On »). */
  online?: boolean;
  /** Puissance rapportée au poids (W/kg), si connue. */
  wkg?: number;
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
  /** Monde ouvert : position du coureur (m) sur le chemin et carrefour à venir. */
  open?: { distM: number; road: string; junction: HudJunction | null };
}

/** Prochain carrefour en monde ouvert : sorties de gauche à droite, celle choisie surlignée. */
export interface HudJunction {
  inM: number;
  choices: Array<{ dir: 'left' | 'straight' | 'right' | 'back'; name: string; unpaved: boolean }>;
  selected: number;
  locked: boolean;
}

const ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
function zoneColor(watts: number, ftp: number): string {
  const r = watts / Math.max(ftp, 1);
  const idx = ZONES.findIndex((z) => r < z);
  return `var(--z${idx === -1 ? 7 : idx + 1})`;
}

const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
function zoneColorHex(watts: number, ftp: number): string {
  const r = watts / Math.max(ftp, 1);
  const idx = ZONES.findIndex((z) => r < z);
  return ZONE_HEX[idx === -1 ? 6 : idx] as string;
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
  /** Monde ouvert : réseau routier pour la mini-carte (profil et carte suivent le coureur). */
  private openGraph: RoadGraphData | null = null;
  /** Panneau « À proximité » : coureurs réels seulement (multijoueur) ou tous (IA comprises). */
  riderFilter: 'real' | 'all' = 'all';
  private lastJunction = '';

  /** Passe le HUD en monde ouvert (profil glissant, carte locale avec les routes alentour). */
  setOpen(graph: RoadGraphData): void {
    this.openGraph = graph;
  }

  constructor(root: HTMLElement, track: RouteTrack, attribution: string[]) {
    this.root = root;
    this.track = track;
    // Trois colonnes empilées en flex (centre, gauche, droite) : aucun panneau ne dépend de la
    // hauteur d'un autre, rien ne se chevauche quelle que soit la taille de la fenêtre.
    root.innerHTML = `
      <div class="hud-center">
        <div class="hud-top">
          <div class="panel metric hr"><div class="label">${t('heartRate')}</div><div class="value num" data-k="hr">--</div><div class="sub">bpm</div></div>
          <div class="panel metric power" data-k="powerBox"><div class="label">${t('power')} 3 s</div><div class="value num"><span data-k="watts">0</span><span class="unit">W</span></div><div class="sub num" data-k="wkg">0,0 W/kg</div></div>
          <div class="panel metric"><div class="label">${t('cadence')}</div><div class="value num" data-k="cad">0</div><div class="sub">tr/min</div></div>
          <div class="panel metric"><div class="label">${t('speed')}</div><div class="value num" data-k="speed">0,0</div><div class="sub">km/h</div></div>
        </div>
        <div class="panel grade-badge num" data-k="grade">0,0 %</div>
        <div class="panel junction hidden" data-k="junction"></div>
        <div class="panel challenge hidden" data-k="challenge"></div>
        <div class="panel segment hidden" data-k="segment"><div class="name" data-k="segName"></div><div class="num" data-k="segInfo"></div><div class="bar"><span data-k="segBar" style="width:0%"></span></div></div>
        <div class="toasts"></div>
      </div>
      <div class="hud-col hud-col-left">
        <div class="panel hud-left">
          <span class="k">${t('time')}</span><span class="v num" data-k="time">0:00</span>
          <span class="k">${t('distance')}</span><span class="v num" data-k="dist">0,00 km</span>
          <span class="k">${t('elevation')}</span><span class="v num" data-k="gain">0 m</span>
          <span class="k">${t('avgPower')}</span><span class="v num" data-k="avg">0 W</span>
          <span class="k">${t('np')}</span><span class="v num" data-k="np">0 W</span>
          <span class="k">${t('draft')}</span><span class="v num" data-k="draft">0 %</span>
          <span></span><span><div style="height:6px;width:110px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;margin-left:auto"><div data-k="draftBar" style="height:100%;width:0%;background:linear-gradient(90deg,#60a5fa,#22c55e)"></div></div></span>
          ${track.route.loop ? `<span class="k">${t('lap')}</span><span class="v num" data-k="lap">1</span>` : ''}
        </div>
        <div class="hud-bl">
          <div class="voice-chip panel hidden" data-k="voice"></div>
          <div class="devices-chip" data-k="devices"></div>
          <div class="hud-drive">
            <div class="panel gearbox"><div class="label metric-label" style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('gear')}</div><div class="value num" data-k="gear">34×17</div><div class="bars" data-k="gearbars"></div></div>
            <div class="panel balance hidden" data-k="balanceBox"><div style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('balance')}</div><div class="num" data-k="balance" style="font-size:20px;font-weight:700">50 / 50</div><div class="bar"><span data-k="balanceBar" style="width:50%"></span></div></div>
          </div>
        </div>
      </div>
      <div class="hud-col hud-col-right">
        <div class="panel minimap"><canvas width="460" height="460"></canvas></div>
        <div class="panel riders" data-k="riders"></div>
        <div class="chat" data-k="chat"><div class="chat-log" data-k="chatLog"></div><input class="chat-input hidden" data-k="chatInput" maxlength="200" /></div>
      </div>
      <div class="panel workout hidden" data-k="workout"><div class="row" style="justify-content:space-between"><b data-k="wName"></b><span class="num" data-k="wRemain"></span></div><div class="num" data-k="wTarget" style="font-size:30px;font-weight:800"></div><div class="num" data-k="wStep" style="color:var(--ar-muted);font-size:13px"></div><canvas width="900" height="90" data-k="wChart"></canvas></div>
      <div class="panel profile"><canvas width="1800" height="160"></canvas></div>
      <div class="attribution">${attribution.join(' · ')}</div>
    `;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k as string] = e));
    (this.el.riders as HTMLElement).addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('[data-rfilter]')) {
        this.riderFilter = this.riderFilter === 'real' ? 'all' : 'real';
        return;
      }
      const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-rideon]')?.dataset.rideon;
      if (id) this.onRideOn?.(id);
    });
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

  /** Panneau du défi KOM : élan, puis chrono et écart avec le fantôme du record (null = masqué). */
  setChallenge(c: null | { name: string; phase: 'runup' | 'climbing' | 'done'; toGoM: number; elapsedS: number; recordS: number | null; deltaS: number | null; progress: number }): void {
    const box = this.el.challenge as HTMLElement;
    if (!c) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const fr = getLang() === 'fr';
    const rec = c.recordS === null ? (fr ? 'pas de record' : 'no record') : `${fr ? 'record' : 'best'} ${fmtTime(c.recordS)}`;
    const delta =
      c.deltaS === null ? '' : `<span class="num" style="color:${c.deltaS <= 0 ? '#22c55e' : '#ef4444'}">${c.deltaS <= 0 ? '−' : '+'}${Math.abs(c.deltaS).toFixed(1).replace('.', fr ? ',' : '.')} s</span>`;
    const main =
      c.phase === 'runup'
        ? `${fr ? 'Pied de la côte dans' : 'Climb starts in'} <b class="num">${Math.round(c.toGoM)} m</b>`
        : `<b class="num">${fmtTime(c.elapsedS)}</b> ${delta} <span class="num" style="color:var(--ar-muted)">· ${Math.round(c.toGoM)} m</span>`;
    box.innerHTML = `<div class="ch-head"><b>${fr ? 'Défi' : 'Challenge'}</b><span>${c.name.replace(/[<>&]/g, '')} · ${rec}</span></div><div class="ch-main">${main}</div><div class="bar"><span style="width:${(c.progress * 100).toFixed(1)}%"></span></div>`;
  }

  /** Panneau de séance structurée (null = masqué). */
  setWorkout(
    w: null | {
      name: string;
      targetWatts: number | null;
      watts3s: number;
      stepIndex: number;
      stepCount: number;
      stepRemainingS: number;
      remainingS: number;
      next?: string;
      profile: Array<[number, number, number, number]>;
      elapsedS: number;
      totalS: number;
    },
  ): void {
    const box = this.el.workout as HTMLElement;
    if (!w) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    (this.el.wName as HTMLElement).textContent = w.name;
    (this.el.wRemain as HTMLElement).textContent = fmtTime(w.remainingS);
    const delta = w.targetWatts ? w.watts3s - w.targetWatts : 0;
    const tgt = this.el.wTarget as HTMLElement;
    tgt.textContent = w.targetWatts ? `${Math.round(w.targetWatts)} W` : 'Libre';
    tgt.style.color = !w.targetWatts ? '#f5f7fa' : Math.abs(delta) < w.targetWatts * 0.05 ? '#22c55e' : delta > 0 ? '#f97316' : '#60a5fa';
    (this.el.wStep as HTMLElement).textContent = `Étape ${Math.min(w.stepIndex + 1, w.stepCount)}/${w.stepCount} · ${fmtTime(w.stepRemainingS)}${w.next ? ` · ensuite ${w.next}` : ''}`;
    const c = this.el.wChart as HTMLCanvasElement;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, c.width, c.height);
    const maxW = Math.max(...w.profile.map((p) => Math.max(p[2], p[3]))) * 1.1;
    const X = (t: number) => (t / w.totalS) * c.width;
    const Y = (p: number) => c.height - (p / maxW) * c.height;
    for (const [t0, d, a, b] of w.profile) {
      ctx.fillStyle = zoneColorHex((a + b) / 2, this.ftp);
      ctx.globalAlpha = t0 + d < w.elapsedS ? 0.45 : 0.9;
      ctx.beginPath();
      ctx.moveTo(X(t0), c.height);
      ctx.lineTo(X(t0), Y(a));
      ctx.lineTo(X(t0 + d), Y(b));
      ctx.lineTo(X(t0 + d), c.height);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(X(w.elapsedS) - 2, 0, 4, c.height);
  }

  /** Message de chat (les 6 derniers restent affichés, puis s'estompent). */
  addChat(name: string, text: string): void {
    const log = this.el.chatLog as HTMLElement;
    const line = document.createElement('div');
    line.className = 'chat-line';
    const b = document.createElement('b');
    b.textContent = `${name} : `;
    line.append(b, document.createTextNode(text));
    log.appendChild(line);
    while (log.childElementCount > 6) log.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), 20000);
  }

  /** Ouvre la saisie du chat (touche T) ; Entrée envoie, Échap annule. */
  openChat(onSend: (text: string) => void): void {
    const input = this.el.chatInput as HTMLInputElement;
    input.classList.remove('hidden');
    input.value = '';
    input.focus();
    const close = () => {
      input.classList.add('hidden');
      input.onkeydown = null;
      input.blur();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) onSend(v);
        close();
      } else if (e.key === 'Escape') close();
    };
  }

  /**
   * État du micro du chat vocal (null = pas de voix). `discordUrl` : salon Discord de repli,
   * proposé quand la voix intégrée (LiveKit) est indisponible.
   */
  setVoice(state: null | { connected: boolean; micOn: boolean; detail?: string; discordUrl?: string | null }): void {
    const chip = this.el.voice as HTMLElement;
    if (!state) {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
    chip.textContent = !state.connected ? `🎙 ${state.detail ?? 'voix indisponible'}` : state.micOn ? '🎙 micro ouvert (V)' : '🔇 micro coupé (V)';
    if (!state.connected && state.discordUrl) {
      const a = document.createElement('a');
      a.className = 'discord-link';
      a.href = state.discordUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Rejoindre le salon Discord';
      chip.append(' · ', a);
    }
  }

  /** Clic sur 👍 dans la liste des coureurs. */
  onRideOn?: (riderId: string) => void;

  /** FTP courante (couleurs des zones). */
  ftp = 250;

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  /** Annonce temporaire au centre ; `small` : discrète (passage d'un lacet). */
  toast(text: string, small = false): void {
    const d = document.createElement('div');
    d.className = small ? 'panel toast small' : 'panel toast';
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
    (e.draftBar as HTMLElement).style.width = `${Math.min(100, (s.draftPct / 50) * 100).toFixed(0)}%`;
    // pas de compteur de tours sur un itinéraire aller simple
    if (e.lap) e.lap.textContent = String(s.lap);
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

    (e.riders as HTMLElement).innerHTML = this.nearbyHtml(s);

    this.drawJunction(s);
    if (this.openGraph && s.open) {
      this.drawOpenProfile(s, s.open.distM);
      this.drawOpenMap(s, s.open.distM);
    } else {
      this.drawProfile(s);
      this.drawMap(s);
    }
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

  /**
   * « À proximité » (façon Zwift) : jusqu'à 4 coureurs devant et 4 derrière, écart en temps à ma
   * vitesse (et en distance), W/kg. Filtre « réels » : seulement les joueurs en ligne.
   */
  private nearbyHtml(s: HudState): string {
    const fr = getLang() === 'fr';
    const me = s.riders.find((r) => r.me);
    if (!me) return '';
    const pool = s.riders.filter((r) => r.me || this.riderFilter === 'all' || (!r.isAI && !r.isGuest) || r.online).sort((a, b) => b.distM - a.distM);
    const i = pool.indexOf(me);
    const shown = pool.slice(Math.max(0, i - 4), i + 5);
    const speed = Math.max(s.speedKmh / 3.6, 2);
    const real = s.riders.filter((r) => !r.me && !r.isAI).length;
    const head = `<div class="rd-head"><b>${fr ? 'À proximité' : 'Nearby'}</b><button class="rd-filter" data-rfilter title="${fr ? 'Coureurs réels ou tous' : 'Real riders or all'}">${
      this.riderFilter === 'real' ? (fr ? `Réels (${real})` : `Real (${real})`) : fr ? 'Tous' : 'All'
    }</button></div>`;
    const rows = shown
      .map((r) => {
        const gap = r.distM - me.distM;
        const tag = r.me ? t('you') : r.isAI ? t('ai') : r.isGuest ? t('guest') : '';
        const rideOn = r.online && !r.me ? `<button class="rideon" data-rideon="${r.id}" title="Ride On">👍</button>` : '';
        const sec = gap / speed;
        const time = Math.abs(sec) >= 60 ? `${sec > 0 ? '+' : '−'}${Math.floor(Math.abs(sec) / 60)}:${String(Math.round(Math.abs(sec) % 60)).padStart(2, '0')}` : `${sec > 0 ? '+' : sec < 0 ? '−' : ''}${Math.round(Math.abs(sec))} s`;
        const dist = Math.abs(gap) >= 1000 ? `${(Math.abs(gap) / 1000).toFixed(1).replace('.', fr ? ',' : '.')} km` : `${Math.round(Math.abs(gap))} m`;
        return `<div class="row ${r.me ? 'me' : ''}"><span class="rd-name"><b style="color:${r.color}">●</b> ${r.name.replace(/[<>&]/g, '')}${r.speaking ? ' 🔊' : ''} ${rideOn}<small>${tag}</small></span><span class="num rd-wkg">${r.wkg !== undefined ? r.wkg.toFixed(1).replace('.', fr ? ',' : '.') : '—'}<small> W/kg</small></span><span class="num rd-gap">${r.me ? '' : `${time}<small>${dist}</small>`}</span></div>`;
      })
      .join('');
    return head + rows;
  }

  /** Panneau « Bifurcation dans X m » : ← / → pour choisir, sortie retenue surlignée. */
  private drawJunction(s: HudState): void {
    const box = this.el.junction as HTMLElement;
    const j = s.open?.junction;
    if (!j || j.inM > 350) {
      box.classList.add('hidden');
      this.lastJunction = '';
      return;
    }
    box.classList.remove('hidden');
    const fr = getLang() === 'fr';
    const arrow = { left: '↰', straight: '↑', right: '↱', back: '↶' } as const;
    const label = (d: keyof typeof arrow) =>
      fr ? { left: 'À gauche', straight: 'Tout droit', right: 'À droite', back: 'Demi-tour' }[d] : { left: 'Left', straight: 'Straight on', right: 'Right', back: 'Turn back' }[d];
    const key = `${j.selected}|${j.locked}|${j.choices.map((c) => c.dir + c.name).join(',')}`;
    const head = `<div class="jn-head"><b>${fr ? 'Bifurcation' : 'Junction'}</b><span class="num">${fr ? 'dans' : 'in'} ${Math.max(0, Math.round(j.inM / 10) * 10)} m</span></div>`;
    if (key === this.lastJunction) {
      const h = box.querySelector('.jn-head span');
      if (h) h.textContent = `${fr ? 'dans' : 'in'} ${Math.max(0, Math.round(j.inM / 10) * 10)} m`;
      return;
    }
    this.lastJunction = key;
    box.innerHTML = `${head}<div class="jn-choices">${j.choices
      .map(
        (c, i) =>
          `<div class="jn-choice ${i === j.selected ? 'on' : ''} ${j.locked && i !== j.selected ? 'off' : ''}"><i>${arrow[c.dir]}</i><b>${label(c.dir)}</b><span>${c.name ? c.name.replace(/[<>&]/g, '') : ''}${c.unpaved ? ' · 🌾' : ''}</span>${i === j.selected ? `<em>${fr ? 'je continue' : 'my way'}</em>` : ''}</div>`,
      )
      .join('')}</div><div class="jn-keys">${j.locked ? (fr ? 'choix retenu' : 'locked in') : fr ? '← → pour choisir · U demi-tour' : '← → to choose · U turn back'}</div>`;
  }

  /** Profil des 2 km autour du coureur (200 m derrière, 1,8 km devant). */
  private drawOpenProfile(s: HudState, d: number): void {
    const c = this.profileCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const d0 = Math.max(0, d - 200);
    const d1 = Math.min(this.track.length, d0 + 2000);
    const pts: Array<{ d: number; y: number }> = [];
    for (let x = d0; x <= d1; x += 10) pts.push({ d: x, y: this.track.sample(x).y });
    if (pts.length < 2) return;
    const ys = pts.map((p) => p.y);
    const minY = Math.min(...ys) - 5;
    const maxY = Math.max(Math.max(...ys) + 5, minY + 30);
    const X = (x: number) => ((x - d0) / 2000) * w;
    const Y = (y: number) => h - 8 - ((y - minY) / (maxY - minY)) * (h - 24);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { d: number; y: number };
      const b = pts[i] as { d: number; y: number };
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
    const j = s.open?.junction;
    if (j) {
      ctx.strokeStyle = 'rgba(255,210,63,0.9)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(X(d + j.inM), 0);
      ctx.lineTo(X(d + j.inM), h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const y = this.track.sample(d).y;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(X(d), Y(y), 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0e16';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /** Carte locale (1,6 km de côté, nord en haut) : routes alentour, chemin prévu, coureurs. */
  private drawOpenMap(s: HudState, d: number): void {
    const g = this.openGraph as RoadGraphData;
    const c = this.mapCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const me = this.track.sample(d);
    const half = 800;
    const k = w / (2 * half);
    const P = (x: number, z: number): [number, number] => [w / 2 + (x - me.x) * k, h / 2 + (z - me.z) * k];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const e of g.edges) {
      const p = e.pts;
      // Rejet grossier : extrémités et milieu loin du cadre.
      const mid = 3 * Math.floor(p.length / 6);
      const near = [0, mid, p.length - 3].some((i) => Math.abs((p[i] as number) - me.x) < half * 1.5 && Math.abs((p[i + 2] as number) - me.z) < half * 1.5);
      if (!near) continue;
      ctx.strokeStyle = /^(asphalt|paved|concrete|chipseal)/.test(e.surface) ? 'rgba(226,232,240,0.45)' : 'rgba(202,170,110,0.45)';
      ctx.lineWidth = e.kind.startsWith('primary') || e.kind.startsWith('secondary') ? 6 : 3.5;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 3) {
        const [x, y] = P(p[i] as number, p[i + 2] as number);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // Chemin prévu devant (jusqu'à 1,2 km).
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 6;
    ctx.beginPath();
    let first = true;
    for (let x = d; x <= Math.min(this.track.length, d + 1200); x += 8) {
      const q = this.track.sample(x);
      const [px, py] = P(q.x, q.z);
      if (first) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      first = false;
    }
    ctx.stroke();
    for (const r of s.riders) {
      const [x, y] = P(r.x, r.z);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
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
