/**
 * Fiche d'un parcours (clic sur une carte de la fenêtre « Parcours ») : grande carte avec les
 * montées et les villages, profil gradué, chiffres, tes records (meilleur tour, sorties, record
 * de chaque montée ou sprint) et ceux de tes amis et de tous, chargés depuis le serveur.
 * Les temps viennent des sorties de chacun (solo ou en groupe) : montées, sprints, parcours entier.
 */
import type { RouteData, RouteSegment } from '@allezrobert/shared';
import { readKomRecord } from '../game/challenge.ts';
import { readGhostBest } from '../game/ghost.ts';
import { readSegmentPr } from '../game/sequences.ts';
import { readRideHistory } from '../game/stats.ts';
import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import { loadProgress } from './garage.ts';
import './routeDetail.css';

const fr = () => getLang() === 'fr';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (v: number, d = 1) => v.toFixed(d).replace('.', fr() ? ',' : '.');

/** Durée lisible : 4:32, 1:02:05. */
export function formatTime(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Couleur de la pente (même échelle que les cartes de parcours). */
const gradeColor = (g: number) => (g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#facc15' : g < -2 ? '#60a5fa' : '#e5e7eb');

/** Point de l'itinéraire à la distance `d` (le plus proche échantillon). */
function pointAt(r: RouteData, d: number): { x: number; z: number; y: number } {
  const step = r.stepM ?? (r.points[1] ? r.points[1].d - r.points[0]!.d : 2);
  const i = Math.max(0, Math.min(r.points.length - 1, Math.round(d / (step || 1))));
  return r.points[i] as { x: number; z: number; y: number };
}

/** Ton meilleur temps (s) sur une montée ou un sprint : sorties normales et défis KOM. */
function myLocalBest(routeId: string, seg: RouteSegment): number | null {
  const a = readSegmentPr(routeId, seg.id);
  const b = seg.kind === 'kom' ? (readKomRecord(routeId, seg.id)?.timeS ?? null) : null;
  return a !== null && b !== null ? Math.min(a, b) : (a ?? b);
}

/** Grande carte : tracé coloré selon la pente, montées surlignées et numérotées, villages, départ, arrivée. */
function bigMap(r: RouteData, segs: RouteSegment[]): string {
  const step = Math.max(1, Math.floor(r.points.length / 900));
  const sel = r.points.filter((_, i) => i % step === 0 || i === r.points.length - 1);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of sel) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const W = 640;
  const H = 420;
  const pad = 34;
  const k = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * k) / 2;
  const oz = (H - (maxZ - minZ) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k;
  const Z = (z: number) => oz + (z - minZ) * k;
  let lines = '';
  for (let i = 1; i < sel.length; i++) {
    const a = sel[i - 1]!;
    const b = sel[i]!;
    const g = ((b.y - a.y) / Math.max(1, b.d - a.d)) * 100;
    lines += `<line x1="${X(a.x).toFixed(1)}" y1="${Z(a.z).toFixed(1)}" x2="${X(b.x).toFixed(1)}" y2="${Z(b.z).toFixed(1)}" stroke="${gradeColor(g)}"/>`;
  }
  // montées : tracé épais rouge sombre sous le tracé, numéro au sommet
  const climbs = segs
    .map((s, i) => {
      const pts = sel.filter((p) => p.d >= s.startM && p.d <= s.endM);
      if (pts.length < 2) return '';
      const top = pointAt(r, s.endM);
      return `<polyline class="rd-climb" points="${pts.map((p) => `${X(p.x).toFixed(1)},${Z(p.z).toFixed(1)}`).join(' ')}"/>
        <g class="rd-climb-tag" transform="translate(${X(top.x).toFixed(1)} ${Z(top.z).toFixed(1)})"><circle r="9"/><text y="3.8">${i + 1}</text></g>`;
    })
    .join('');
  // Noms sans chevauchement : un lieu trop près (à l'écran) d'un nom déjà posé n'est pas écrit.
  const placed: Array<[number, number]> = [];
  const villages = (r.landmarks ?? [])
    .map((l) => {
      const p = pointAt(r, l.d);
      const q: [number, number] = [X(p.x), Z(p.z)];
      if (placed.some(([x, z]) => Math.abs(x - q[0]) < 70 && Math.abs(z - q[1]) < 16)) return '';
      placed.push(q);
      return `<g class="rd-village" transform="translate(${X(p.x).toFixed(1)} ${Z(p.z).toFixed(1)})"><circle r="2.6"/><text x="5" y="-4">${esc(l.name)}</text></g>`;
    })
    .join('');
  const a = r.points[0]!;
  const b = r.points[r.points.length - 1]!;
  const same = Math.hypot(a.x - b.x, a.z - b.z) < 60;
  return `<svg class="rd-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g class="rd-climbs">${climbs.replace(/<g class="rd-climb-tag"[\s\S]*?<\/g>/g, '')}</g>
    <g stroke-width="3.4" stroke-linecap="round">${lines}</g>
    <g class="rd-villages">${villages}</g>
    ${climbs.match(/<g class="rd-climb-tag"[\s\S]*?<\/g>/g)?.join('') ?? ''}
    ${same ? '' : `<g class="rd-end" transform="translate(${X(b.x).toFixed(1)} ${Z(b.z).toFixed(1)})"><circle r="8"/><text y="3.6">A</text></g>`}
    <g class="rd-start" transform="translate(${X(a.x).toFixed(1)} ${Z(a.z).toFixed(1)})"><circle r="8"/><text y="3.6">D</text></g>
  </svg>`;
}

/** Profil gradué : altitude, montées numérotées, sprints, repères kilométriques. */
function bigProfile(r: RouteData, segs: RouteSegment[]): string {
  const W = 1000;
  const H = 150;
  const top = 16;
  const bottom = 22;
  const step = Math.max(1, Math.floor(r.points.length / 700));
  const sel = r.points.filter((_, i) => i % step === 0 || i === r.points.length - 1);
  const ys = sel.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const len = r.lengthM || 1;
  const px = (d: number) => (d / len) * W;
  const py = (y: number) => top + (1 - (y - lo) / (hi - lo || 1)) * (H - top - bottom);
  const area = `M0,${H - bottom} ${sel.map((p) => `L${px(p.d).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')} L${W},${H - bottom} Z`;
  const kmStep = len > 60000 ? 10 : len > 25000 ? 5 : len > 8000 ? 2 : 1;
  let ticks = '';
  for (let km = kmStep; km * 1000 < len; km += kmStep) ticks += `<line x1="${px(km * 1000).toFixed(1)}" y1="${H - bottom}" x2="${px(km * 1000).toFixed(1)}" y2="${H - bottom + 4}"/><text x="${px(km * 1000).toFixed(1)}" y="${H - 6}">${km}</text>`;
  const kom = segs.filter((s) => s.kind === 'kom');
  const marks = segs
    .map((s) => {
      const x0 = px(s.startM);
      const x1 = px(s.endM);
      const n = kom.indexOf(s);
      return `<rect class="rd-seg rd-seg-${s.kind}" x="${x0.toFixed(1)}" y="0" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${H - bottom}"/>${n >= 0 ? `<text class="rd-seg-n" x="${((x0 + x1) / 2).toFixed(1)}" y="12">${n + 1}</text>` : ''}`;
    })
    .join('');
  return `<div class="rd-profile-box"><span class="rd-alt rd-alt-hi">${Math.round(hi)} m</span><span class="rd-alt rd-alt-lo">${Math.round(lo)} m</span>
    <svg class="rd-profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="rd-prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f" stop-opacity=".6"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".05"/></linearGradient></defs>
      ${marks}
      <path d="${area}" fill="url(#rd-prof)" stroke="#ffd23f" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <g class="rd-ticks">${ticks}</g>
    </svg></div>`;
}

/** Villages traversés : les 12 premiers, le reste dépliable. */
function placesList(list: Array<{ name: string; d: number }>): string {
  const L = fr();
  const item = (l: { name: string; d: number }) => `${esc(l.name)} <small>km ${num(l.d / 1000)}</small>`;
  const head = list.slice(0, 12).map(item).join(' · ');
  const rest = list.slice(12);
  return `<div class="rd-places">${head}${rest.length ? `<details><summary>+ ${rest.length} ${L ? 'autres' : 'more'}</summary>${rest.map(item).join(' · ')}</details>` : ''}</div>`;
}

/** Fiche complète (les temps du serveur arrivent ensuite, voir `loadRouteBoards`). */
export function routeDetailHtml(r: RouteData, name: string, opts: { loggedIn: boolean }): string {
  const L = fr();
  const segs = [...r.segments].sort((a, b) => a.startM - b.startM);
  const kom = segs.filter((s) => s.kind === 'kom');
  const h = r.lengthM / 26000 + r.elevationGainM / 700;
  const eta = Math.floor(h) ? `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : `${Math.round(h * 60)} min`;
  const ghost = readGhostBest(r.id);
  const rides = readRideHistory().filter((x) => x.routeId === r.id);
  const last = rides[rides.length - 1];
  const done = loadProgress().routesDone.includes(r.id);
  const stat = (v: string, u: string) => `<div><b>${v}</b><span>${u}</span></div>`;
  const dateFmt = (d: number | string) => new Date(d).toLocaleDateString(L ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const mine = [
    ghost ? `<li><span>${L ? 'Meilleur temps sur le parcours' : 'Best time on the route'}</span><b>${formatTime(ghost.lapTimeS)}</b><small>${dateFmt(ghost.date)}</small></li>` : '',
    `<li><span>${L ? 'Sorties sur ce parcours' : 'Rides on this route'}</span><b>${rides.length}${done && !rides.length ? ' ✓' : ''}</b>${last ? `<small>${L ? 'dernière' : 'last'} ${dateFmt(last.date)} · ${num(last.avgSpeedKmh)} km/h · ${Math.round(last.avgWatts)} W</small>` : `<small>${done ? (L ? 'parcours déjà terminé' : 'route already finished') : L ? 'jamais roulé' : 'never ridden'}</small>`}</li>`,
  ].join('');
  const rows = segs
    .map((s) => {
      const n = kom.indexOf(s);
      const best = myLocalBest(r.id, s);
      return `<tr data-seg="${esc(s.id)}">
        <td class="rd-n">${s.kind === 'kom' ? `<i class="rd-badge">${n + 1}</i>` : '<i class="rd-badge rd-sprint">S</i>'}</td>
        <td><b>${esc(s.name)}</b><small>${s.kind === 'kom' ? (L ? 'Montée' : 'Climb') : 'Sprint'} · ${num((s.endM - s.startM) / 1000)} km${s.kind === 'kom' ? ` · ${num(s.avgGrade)} %` : ''} · km ${num(s.startM / 1000)}</small></td>
        <td class="rd-me" data-mine="${best ?? ''}">${best !== null ? `<b>${formatTime(best)}</b>` : `<span class="rd-none">—</span>`}</td>
        <td class="rd-friends">${opts.loggedIn ? '<span class="rd-load">…</span>' : `<span class="rd-none">${L ? 'connecte-toi' : 'sign in'}</span>`}</td>
        <td class="rd-top"><span class="rd-load">…</span></td>
        <td>${s.kind === 'kom' ? `<button class="rd-defi" data-rd-kom="${esc(s.id)}" title="${L ? 'Défi : bats ton record sur cette montée' : 'Challenge: beat your record on this climb'}">${L ? 'Défi' : 'Challenge'} →</button>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `<div class="rd">
    <div class="rd-top-grid">
      ${bigMap(r, segs)}
      <div class="rd-side">
        <div class="rd-stats">
          ${stat(num(r.lengthM / 1000), 'km')}
          ${stat(String(Math.round(r.elevationGainM)), 'm D+')}
          ${stat(r.maxGradePct !== undefined ? String(Math.round(r.maxGradePct)) : '—', '% max')}
          ${stat(eta, L ? 'durée env.' : 'est. time')}
          ${stat(r.minElevationM !== undefined && r.maxElevationM !== undefined ? `${Math.round(r.minElevationM)}–${Math.round(r.maxElevationM)}` : '—', L ? 'altitude (m)' : 'altitude (m)')}
          ${stat(String(kom.length), kom.length > 1 ? (L ? 'montées' : 'climbs') : L ? 'montée' : 'climb')}
        </div>
        <h3>${L ? 'Tes records' : 'Your records'}</h3>
        <ul class="rd-mine">${mine}</ul>
        <h3>${L ? 'Parcours entier' : 'Whole route'}</h3>
        <div class="rd-route-board">
          <div><span>${L ? 'Tes amis' : 'Your friends'}</span><div class="rd-rb-friends">${opts.loggedIn ? '<span class="rd-load">…</span>' : `<span class="rd-none">${L ? 'connecte-toi pour voir leurs temps' : 'sign in to see their times'}</span>`}</div></div>
          <div><span>${L ? 'Meilleur temps' : 'Fastest'}</span><div class="rd-rb-top"><span class="rd-load">…</span></div></div>
        </div>
        ${r.landmarks?.length ? `<h3>${L ? 'Villages traversés' : 'Villages on the way'}</h3>${placesList(r.landmarks)}` : ''}
        <button class="rd-go" data-rd="ride">${L ? 'Rouler ce parcours' : 'Ride this route'} →</button>
      </div>
    </div>
    ${bigProfile(r, segs)}
    ${
      segs.length
        ? `<h3>${L ? 'Montées et sprints chronométrés' : 'Timed climbs and sprints'}</h3>
      <table class="rd-table"><thead><tr><th></th><th>${L ? 'Segment' : 'Segment'}</th><th>${L ? 'Ton record' : 'Your best'}</th><th>${L ? 'Tes amis' : 'Your friends'}</th><th>${L ? 'Meilleur temps' : 'Fastest'}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="mm-hint">${L ? 'Les temps sont envoyés à la fin de chaque sortie, solo ou en groupe, quand on roule avec un compte (pas en invité, ni pendant une séance ERG).' : 'Times are sent at the end of every ride, solo or in a group, when riding with an account (not as a guest, nor during an ERG workout).'}</p>`
        : `<p class="mm-hint">${L ? 'Pas de montée ni de sprint chronométré sur ce parcours.' : 'No timed climb or sprint on this route.'}</p>`
    }
  </div>`;
}

interface Board {
  rank: number;
  name: string;
  bestMs: number;
  efforts: number;
  me?: boolean;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { credentials: 'include' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Temps du serveur pour le parcours entier et chaque segment de la fiche : ton record (sorties de groupe), tes amis
 * (3 meilleurs) et le meilleur temps de tous. Remplit le tableau sur place ; hors ligne, les
 * cases indiquent « hors ligne ».
 */
export async function loadRouteBoards(root: ParentNode, r: RouteData, loggedIn: boolean): Promise<void> {
  const L = fr();
  const enc = encodeURIComponent;
  // Parcours entier : amis (3 meilleurs, toi compris) et meilleur temps de tous.
  void Promise.all([
    getJson<Board[]>(`/routes/${enc(r.id)}/leaderboard?limit=1`),
    loggedIn ? getJson<Board[]>(`/routes/${enc(r.id)}/leaderboard?scope=friends&limit=4`) : Promise.resolve(null),
  ]).then(([all, friends]) => {
    const top = root.querySelector<HTMLElement>('.rd-rb-top');
    const t0 = all?.[0];
    if (top) top.innerHTML = all === null ? `<span class="rd-none">${L ? 'hors ligne' : 'offline'}</span>` : t0 ? `<b>${formatTime(t0.bestMs / 1000)}</b> ${esc(t0.name)}` : `<span class="rd-none">${L ? 'personne encore' : 'nobody yet'}</span>`;
    const fc = root.querySelector<HTMLElement>('.rd-rb-friends');
    if (!fc || !loggedIn) return;
    fc.innerHTML =
      friends === null
        ? `<span class="rd-none">${L ? 'hors ligne' : 'offline'}</span>`
        : friends.some((x) => !x.me)
          ? `<ol>${friends.slice(0, 4).map((x) => `<li class="${x.me ? 'rd-is-me' : ''}"><b>${formatTime(x.bestMs / 1000)}</b> ${x.me ? (L ? 'toi' : 'you') : esc(x.name)}</li>`).join('')}</ol>`
          : `<span class="rd-none">${L ? 'aucun ami n’a encore roulé ce parcours' : 'no friend has ridden this route yet'}</span>`;
  });
  const mineSrv = loggedIn ? await getJson<Array<{ segmentId: string; bestMs: number }>>(`/me/segments?routeId=${enc(r.id)}`) : null;
  await Promise.all(
    r.segments.map(async (s) => {
      const row = root.querySelector<HTMLElement>(`tr[data-seg="${CSS.escape(s.id)}"]`);
      if (!row) return;
      const [all, friends] = await Promise.all([
        getJson<Board[]>(`/segments/${enc(r.id)}/${enc(s.id)}/leaderboard?limit=1`),
        loggedIn ? getJson<Board[]>(`/segments/${enc(r.id)}/${enc(s.id)}/leaderboard?scope=friends&limit=6`) : Promise.resolve(null),
      ]);
      // Ton record : le meilleur entre cet appareil et le serveur.
      const me = row.querySelector<HTMLElement>('.rd-me');
      const srv = mineSrv?.find((m) => m.segmentId === s.id)?.bestMs;
      const local = Number(me?.dataset.mine || NaN);
      if (me && srv !== undefined && !(local <= srv / 1000)) me.innerHTML = `<b>${formatTime(srv / 1000)}</b>`;
      const top = row.querySelector<HTMLElement>('.rd-top');
      const t0 = all?.[0];
      if (top) top.innerHTML = all === null ? `<span class="rd-none">${L ? 'hors ligne' : 'offline'}</span>` : t0 ? `<b>${formatTime(t0.bestMs / 1000)}</b><small>${esc(t0.name)}</small>` : `<span class="rd-none">${L ? 'personne encore' : 'nobody yet'}</span>`;
      const fc = row.querySelector<HTMLElement>('.rd-friends');
      if (!fc || !loggedIn) return;
      const others = (friends ?? []).filter((f) => !f.me).slice(0, 3);
      fc.innerHTML =
        friends === null
          ? `<span class="rd-none">${L ? 'hors ligne' : 'offline'}</span>`
          : others.length
            ? `<ol>${others.map((f) => `<li><b>${formatTime(f.bestMs / 1000)}</b> ${esc(f.name)}</li>`).join('')}</ol>`
            : `<span class="rd-none">${L ? 'pas encore de temps' : 'no times yet'}</span>`;
    }),
  );
}
