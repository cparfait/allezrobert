import { getLang } from '../i18n/index.ts';
import type { RideSession } from '../game/ride.ts';
import { CURVE_DURATIONS, durationLabel, POWER_ZONES, type RideHistoryEntry, type RideStats } from '../game/stats.ts';
import './summary.css';

/** Couleurs des séries (palette catégorielle validée sur fond sombre) et des zones (HUD). */
const C_RIDE = '#d95926';
const C_RECORD = '#3987e5';
const C_HR = '#e66767';
const C_ALT = '#64748b';
const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const INK = '#e8edf3';
const MUTED = '#8d98a6';
const GRID = 'rgba(255,255,255,0.08)';

export interface SummaryData {
  ride: RideSession;
  stats: RideStats;
  routeName: string;
  ftp: number;
  massKg: number;
  /** Sortie comparable précédente (même itinéraire), ou null. */
  previous: RideHistoryEntry | null;
  /** Records de puissance d'avant la sortie (durée → W) et durées battues. */
  records: { previous: Record<number, number>; beaten: number[] };
  /** XP gagnée et niveau (absent pour un invité). */
  xp?: { gained: number; level: number; progress: number; levelUp: boolean; detail: string; unlocked: string[] };
  /** Il y avait des équipiers, des coureurs IA ou d'autres joueurs. */
  withGroup: boolean;
  guest: boolean;
  /** Trophées gagnés par cette sortie. */
  trophies?: Array<{ name: string; description: string; xp: number }>;
}

export interface SummaryActions {
  onShareCard(): void;
  onFit(): void;
  onGpx(): void;
  /** Absent : la sortie ne peut pas reprendre (course terminée, multijoueur). */
  onResume?: () => void;
  onNewRide(): void;
  onQuit(): void;
  /** Panneau compte / Strava / intervals.icu rempli après coup. */
  onlineBox?: (box: HTMLElement) => void;
}

const fr = () => getLang() === 'fr';
const num = (v: number, d = 0) => v.toFixed(d).replace('.', fr() ? ',' : '.');

function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Écran de fin de sortie : chiffres clés, courbe de puissance et records, profil, zones, segments. */
export function showRideSummary(root: HTMLElement, d: SummaryData, a: SummaryActions): void {
  const L = fr();
  const s = d.stats;
  const prev = d.previous;
  const vs = prev ? s.avgSpeedKmh - prev.avgSpeedKmh : null;
  const tiles: Array<[string, string, string?]> = [
    [L ? 'Distance' : 'Distance', `${num(s.distanceM / 1000, 2)} km`],
    [L ? 'Temps' : 'Time', hms(s.movingS)],
    ['D+', `${Math.round(s.elevationGainM)} m`],
    [L ? 'Vitesse moy.' : 'Avg speed', `${num(s.avgSpeedKmh, 1)} km/h`, `max ${num(s.maxSpeedKmh, 1)}`],
    [L ? 'Cardio moy.' : 'Avg HR', s.avgHr ? `${Math.round(s.avgHr)} bpm` : '— bpm', s.maxHr ? `max ${s.maxHr}` : ''],
    [L ? 'Puissance moy.' : 'Avg power', `${Math.round(s.avgWatts)} W`, `${num(s.avgWatts / d.massKg, 1)} W/kg`],
    [L ? 'Normalisée' : 'Normalized', `${Math.round(s.np)} W`, `max ${Math.round(s.maxWatts)} W`],
    ['TSS · IF', `${Math.round(s.tss)} · ${num(s.ifactor, 2)}`],
    [L ? 'Calories' : 'Calories', `${Math.round(s.kcal)} kcal`, `${Math.round(s.workKJ)} kJ`],
    [
      L ? 'Vs dernière fois' : 'Vs last time',
      vs === null ? '—' : `${vs >= 0 ? '+' : '−'}${num(Math.abs(vs), 1)} km/h`,
      prev ? `${L ? 'le' : 'on'} ${new Date(prev.date).toLocaleDateString(L ? 'fr-FR' : 'en-GB')}` : L ? 'première fois ici' : 'first time here',
    ],
  ];
  const segs = d.ride.segmentResults;
  const g = d.ride.group;
  const beaten = d.records.beaten;
  root.innerHTML = `<div class="sum">
    <header class="sum-head">
      <div><h1>${L ? 'Bravo, belle sortie !' : 'Well done, great ride!'}</h1><p>${esc(d.routeName)} · ${num(s.distanceM / 1000, 1)} km</p></div>
      <nav class="sum-actions">
        <button class="sum-btn" id="s-card">${L ? 'Carte de sortie' : 'Ride card'}</button>
        ${d.guest ? '' : `<button class="sum-btn accent" id="s-fit">.fit (Strava)</button><button class="sum-btn" id="s-gpx">.gpx</button>`}
        ${a.onResume ? `<button class="sum-btn" id="s-resume">${L ? 'Reprendre' : 'Resume'}</button>` : ''}
        <button class="sum-btn" id="s-new">${L ? 'Nouvelle sortie' : 'New ride'}</button>
        <button class="sum-btn" id="s-quit">${L ? 'Quitter' : 'Quit'}</button>
      </nav>
    </header>
    <div class="sum-body">
      <aside class="sum-side">
        ${
          d.xp
            ? `<section class="sum-card sum-level"><div class="sum-lv"><b>${L ? 'Niveau' : 'Level'} ${d.xp.level}${d.xp.levelUp ? ' 🎉' : ''}</b><i class="sum-xp"><i style="width:${(d.xp.progress * 100).toFixed(0)}%"></i></i></div>
              <p>+${d.xp.gained} XP <span>(${esc(d.xp.detail)})</span></p>${d.xp.unlocked.length ? `<p class="sum-unlock">${L ? 'Débloqué' : 'Unlocked'} : ${d.xp.unlocked.map(esc).join(', ')}</p>` : ''}</section>`
            : `<section class="sum-card"><p class="sum-muted">${L ? 'Invité : sortie hors classements, sans XP ni export.' : 'Guest: no rankings, XP or export.'}</p></section>`
        }
        ${
          d.trophies?.length
            ? `<section class="sum-card"><h3>${L ? 'Trophées' : 'Trophies'}</h3>${d.trophies
                .map((t) => `<div class="sum-row sum-trophy"><span>🏆 <b>${esc(t.name)}</b><small>${esc(t.description)}</small></span><b></b><em>+${t.xp} XP</em></div>`)
                .join('')}</section>`
            : ''
        }
        ${
          beaten.length
            ? `<section class="sum-card"><h3>${L ? 'Nouveaux records' : 'New records'}</h3>${beaten
                .map((dur) => {
                  const w = s.curve.find((p) => p.durationS === dur)?.watts ?? 0;
                  return `<div class="sum-row"><span>${durationLabel(dur)}</span><b>${Math.round(w)} W</b><em>+${Math.max(1, Math.round(w - (d.records.previous[dur] ?? 0)))} W</em></div>`;
                })
                .join('')}</section>`
            : ''
        }
        ${
          d.withGroup
            ? `<section class="sum-card"><h3>${L ? 'En groupe' : 'In the group'}</h3>
              <div class="sum-row"><span>${L ? 'Dans les roues' : 'On a wheel'}</span><b>${hms(g.draftS)}</b></div>
              <div class="sum-row"><span>${L ? 'Énergie économisée' : 'Energy saved'}</span><b>${Math.round(g.savedJ / 1000)} kJ</b></div>
              <div class="sum-row"><span>${L ? 'Relais pris' : 'Pulls taken'}</span><b>${g.pulls}</b></div></section>`
            : ''
        }
        ${
          d.ride.summitPhotos.length
            ? `<section class="sum-card"><h3>${L ? 'Photos au sommet' : 'Summit photos'}</h3><div class="sum-photos">${d.ride.summitPhotos
                .map((src, i) => `<a href="${src}" download="allez-robert-sommet-${i + 1}.jpg" title="${L ? 'Enregistrer la photo' : 'Save the photo'}"><img src="${src}" alt="${L ? 'Photo au sommet' : 'Summit photo'} ${i + 1}" /></a>`)
                .join('')}</div></section>`
            : ''
        }
        <section class="sum-card" id="s-online"></section>
      </aside>
      <main class="sum-main">
        <div class="sum-tiles">${tiles
          .map(([k, v, sub]) => `<div class="sum-tile"><span>${k}</span><b>${v}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`)
          .join('')}</div>
        <div class="sum-charts">
          <section class="sum-card sum-chart"><h3>${L ? 'Courbe de puissance' : 'Power curve'}</h3>
            <div class="sum-legend"><span><i style="background:${C_RIDE}"></i>${L ? 'Cette sortie' : 'This ride'}</span><span><i class="dash" style="border-color:${C_RECORD}"></i>${L ? 'Tes records (avant)' : 'Your records (before)'}</span></div>
            <div class="sum-canvas"><canvas id="c-curve"></canvas><div class="sum-tip" hidden></div></div></section>
          <section class="sum-card sum-chart"><h3>${L ? 'Profil · puissance · cardio' : 'Profile · power · heart rate'}</h3>
            <div class="sum-canvas tall"><canvas id="c-time"></canvas><div class="sum-tip" hidden></div></div></section>
          <section class="sum-card sum-chart"><h3>${L ? 'Temps par zone' : 'Time in zone'}</h3><div class="sum-zones" id="c-zones"></div></section>
          <section class="sum-card sum-chart"><h3>${L ? 'Segments et records' : 'Segments and records'}</h3>${
            segs.length
              ? segs
                  .map(
                    (r) =>
                      `<div class="sum-row"><span>${r.seg.kind === 'kom' ? 'KOM' : 'Sprint'} · ${esc(r.seg.name)}</span><b>${hms(r.timeS)}</b><em>${Math.round(r.avgWatts)} W</em></div>`,
                  )
                  .join('')
              : `<p class="sum-muted">${L ? 'Pas de segment chronométré sur cette sortie.' : 'No timed segment on this ride.'}</p>`
          }</section>
        </div>
      </main>
    </div>
  </div>`;
  const on = (id: string, f?: () => void) => {
    const el = root.querySelector(`#${id}`) as HTMLElement | null;
    if (el && f) el.onclick = f;
  };
  on('s-card', a.onShareCard);
  on('s-fit', a.onFit);
  on('s-gpx', a.onGpx);
  on('s-resume', a.onResume);
  on('s-new', a.onNewRide);
  on('s-quit', a.onQuit);
  const online = root.querySelector('#s-online') as HTMLElement;
  if (a.onlineBox) a.onlineBox(online);
  else online.remove();
  drawZones(root.querySelector('#c-zones') as HTMLElement, s.zonesS, d.ftp);
  interactiveCanvas(root.querySelector('#c-curve') as HTMLCanvasElement, (ctx, w, h, hx) => drawCurve(ctx, w, h, hx, s, d.records.previous));
  interactiveCanvas(root.querySelector('#c-time') as HTMLCanvasElement, (ctx, w, h, hx) => drawTimeline(ctx, w, h, hx, d.ride));
}

/** Canevas net (devicePixelRatio), redessiné au survol avec la position de la souris. */
function interactiveCanvas(c: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, hoverX: number | null) => string | null): void {
  const box = c.parentElement as HTMLElement;
  const tip = box.querySelector('.sum-tip') as HTMLElement;
  const render = (hx: number | null) => {
    const w = box.clientWidth;
    const h = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const html = draw(ctx, w, h, hx);
    if (html && hx !== null) {
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.left = `${Math.min(hx + 14, w - tip.offsetWidth - 4)}px`;
    } else tip.hidden = true;
  };
  c.addEventListener('mousemove', (e) => render(e.offsetX));
  c.addEventListener('mouseleave', () => render(null));
  new ResizeObserver(() => render(null)).observe(box);
  render(null);
}

const PAD = { l: 44, r: 12, t: 10, b: 24 };

function axisText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'center'): void {
  ctx.fillStyle = MUTED;
  ctx.font = '11px system-ui, sans-serif';
  // Libellé centré qui déborderait du cadre : calé sur le bord.
  const half = ctx.measureText(text).width / 2;
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (align === 'center' && x + half > w - 2) {
    align = 'right';
    x = w - 2;
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/** Courbe de puissance : abscisse logarithmique des durées, records en pointillés. */
function drawCurve(ctx: CanvasRenderingContext2D, w: number, h: number, hx: number | null, s: RideStats, records: Record<number, number>): string | null {
  const pts = s.curve;
  const durs: number[] = CURVE_DURATIONS.filter((x) => x <= Math.max(5, pts.at(-1)?.durationS ?? 5));
  const rec: Array<{ x: number; w: number }> = [];
  for (const x of durs) {
    const w = records[x];
    if (w !== undefined) rec.push({ x, w });
  }
  const maxW = Math.max(100, ...pts.map((p) => p.watts), ...rec.map((p) => p.w)) * 1.08;
  const x0 = Math.log(durs[0] ?? 1);
  const x1 = Math.log(durs[durs.length - 1] ?? 60);
  const X = (dur: number) => PAD.l + ((Math.log(dur) - x0) / Math.max(x1 - x0, 1e-6)) * (w - PAD.l - PAD.r);
  const Y = (v: number) => h - PAD.b - (v / maxW) * (h - PAD.t - PAD.b);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const step = maxW > 800 ? 200 : maxW > 400 ? 100 : 50;
  for (let v = step; v < maxW; v += step) {
    ctx.beginPath();
    ctx.moveTo(PAD.l, Y(v));
    ctx.lineTo(w - PAD.r, Y(v));
    ctx.stroke();
    axisText(ctx, `${v}`, PAD.l - 6, Y(v) + 4, 'right');
  }
  for (const dur of durs) if ([1, 5, 60, 300, 1200, 3600].includes(dur)) axisText(ctx, durationLabel(dur), X(dur), h - 6);
  const line = (list: Array<{ x: number; w: number }>, color: string, dash: number[]) => {
    if (list.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    list.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.w)) : ctx.moveTo(X(p.x), Y(p.w))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(rec, C_RECORD, [5, 5]);
  line(
    pts.map((p) => ({ x: p.durationS, w: p.watts })),
    C_RIDE,
    [],
  );
  if (hx === null || !pts.length) return null;
  // Point le plus proche de la souris.
  let best = pts[0] as (typeof pts)[number];
  for (const p of pts) if (Math.abs(X(p.durationS) - hx) < Math.abs(X(best.durationS) - hx)) best = p;
  const bx = X(best.durationS);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(bx, PAD.t);
  ctx.lineTo(bx, h - PAD.b);
  ctx.stroke();
  for (const [v, col] of [
    [best.watts, C_RIDE],
    [records[best.durationS], C_RECORD],
  ] as Array<[number | undefined, string]>) {
    if (v === undefined) continue;
    ctx.fillStyle = col;
    ctx.strokeStyle = '#0a0e16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, Y(v), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const r = records[best.durationS];
  return `<b>${durationLabel(best.durationS)}</b><span><i style="background:${C_RIDE}"></i>${Math.round(best.watts)} W</span>${r !== undefined ? `<span><i style="background:${C_RECORD}"></i>${fr() ? 'record' : 'record'} ${r} W</span>` : ''}`;
}

/**
 * Trois petits graphiques empilés sur le même axe des distances (une échelle chacun, jamais deux
 * axes sur un même graphique) : altitude, puissance lissée sur 10 s, fréquence cardiaque.
 */
function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, hx: number | null, ride: RideSession): string | null {
  const rec = ride.records;
  if (rec.length < 2) return null;
  const hasHr = rec.some((r) => (r.hr ?? 0) > 0);
  const lanes = hasHr ? 3 : 2;
  const gap = 10;
  const laneH = (h - PAD.b - gap * (lanes - 1)) / lanes;
  const D = (rec.at(-1)?.distanceM ?? 1) || 1;
  const X = (dm: number) => PAD.l + (dm / D) * (w - PAD.l - PAD.r);
  const smooth = rec.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 9); k <= i; k++) {
      s += rec[k]?.watts ?? 0;
      n++;
    }
    return s / n;
  });
  const series: Array<{ label: string; color: string; values: number[]; unit: string; area?: boolean }> = [
    { label: fr() ? 'Altitude' : 'Elevation', color: C_ALT, values: rec.map((r) => r.altitudeM), unit: 'm', area: true },
    { label: fr() ? 'Puissance' : 'Power', color: C_RIDE, values: smooth, unit: 'W' },
  ];
  if (hasHr) series.push({ label: fr() ? 'Cardio' : 'Heart rate', color: C_HR, values: rec.map((r) => r.hr ?? 0), unit: 'bpm' });
  let idx = -1;
  if (hx !== null) {
    const dm = ((hx - PAD.l) / (w - PAD.l - PAD.r)) * D;
    let lo = 0;
    let hi = rec.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((rec[mid]?.distanceM ?? 0) < dm) lo = mid + 1;
      else hi = mid;
    }
    idx = lo;
  }
  series.forEach((sr, k) => {
    const top = k * (laneH + gap);
    const vals = sr.values.filter((v) => v > 0 || sr.unit === 'm');
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (sr.unit !== 'm') lo = Math.min(lo, sr.unit === 'W' ? 0 : lo);
    if (hi - lo < 10) hi = lo + 10;
    const Y = (v: number) => top + laneH - 4 - ((v - lo) / (hi - lo)) * (laneH - 18);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, top + laneH);
    ctx.lineTo(w - PAD.r, top + laneH);
    ctx.stroke();
    axisText(ctx, `${Math.round(hi)}`, PAD.l - 6, top + 14, 'right');
    axisText(ctx, `${Math.round(lo)}`, PAD.l - 6, top + laneH - 2, 'right');
    ctx.fillStyle = INK;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${sr.label} (${sr.unit})`, PAD.l + 4, top + 12);
    ctx.beginPath();
    rec.forEach((r, i) => {
      const v = sr.values[i] as number;
      if (i) ctx.lineTo(X(r.distanceM), Y(v));
      else ctx.moveTo(X(r.distanceM), Y(v));
    });
    if (sr.area) {
      ctx.lineTo(X(D), top + laneH);
      ctx.lineTo(X(0), top + laneH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(100,116,139,0.45)';
      ctx.fill();
    } else {
      ctx.strokeStyle = sr.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (idx >= 0) {
      const r = rec[idx] as (typeof rec)[number];
      ctx.fillStyle = sr.area ? INK : sr.color;
      ctx.strokeStyle = '#0a0e16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(r.distanceM), Y(sr.values[idx] as number), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
  for (let km = 0; km <= D / 1000; km += D > 20000 ? 5 : D > 6000 ? 2 : 1) axisText(ctx, `${km} km`, X(km * 1000), h - 6);
  if (idx < 0) return null;
  const r = rec[idx] as (typeof rec)[number];
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(r.distanceM), 0);
  ctx.lineTo(X(r.distanceM), h - PAD.b);
  ctx.stroke();
  return `<b>${num(r.distanceM / 1000, 2)} km</b><span><i style="background:${C_ALT}"></i>${Math.round(r.altitudeM)} m</span><span><i style="background:${C_RIDE}"></i>${Math.round(smooth[idx] ?? 0)} W</span>${hasHr ? `<span><i style="background:${C_HR}"></i>${r.hr ?? '—'} bpm</span>` : ''}`;
}

/** Barres horizontales Z1–Z7 (couleurs des zones du HUD), temps et part de la sortie. */
function drawZones(box: HTMLElement, zonesS: number[], ftp: number): void {
  const total = zonesS.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...zonesS, 1);
  const bounds = [0, ...POWER_ZONES.map((z) => Math.round(z * ftp))];
  box.innerHTML = zonesS
    .map((sec, i) => {
      const lo = bounds[i] as number;
      const hi = bounds[i + 1];
      const range = hi === undefined ? `> ${lo} W` : `${lo}–${hi} W`;
      return `<div class="sum-zone" title="${range}"><span>Z${i + 1}</span><div class="sum-zbar"><i style="width:${((sec / max) * 100).toFixed(1)}%;background:${ZONE_HEX[i]}"></i></div><b>${hms(sec)}</b><em>${Math.round((sec / total) * 100)} %</em></div>`;
    })
    .join('');
}
