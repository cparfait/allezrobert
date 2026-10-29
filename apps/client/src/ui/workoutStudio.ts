/**
 * « Studio » du choix de séance : à gauche la liste des séances (miniature du profil, durée, TSS), à droite la fiche de la
 * séance regardée : grand profil de puissance (axes en % de FTP et en watts), répartition du temps par zone, déroulé
 * des étapes, et le bouton pour la choisir. Un clic sur une ligne la montre ; « Choisir cette séance » la valide.
 */
import type { LibraryWorkout, WorkoutStep, WorkoutType } from '@allezrobert/physics';
import './workoutStudio.css';

export interface StudioCtx {
  fr: boolean;
  filter: WorkoutType | 'mine' | '';
  types: readonly WorkoutType[];
  library: readonly LibraryWorkout[];
  /** Séances importées ou enregistrées (déjà au format de la bibliothèque, identifiant « mine:… »). */
  mine: readonly LibraryWorkout[];
  favs: ReadonlySet<string>;
  /** Séance actuellement choisie pour la sortie, et séance regardée dans la fiche. */
  current: string | undefined;
  selected: string | undefined;
  ftp: number;
  typeColors: Record<WorkoutType, string>;
  typeLabels: Record<WorkoutType, { fr: string; en: string }>;
  zoneColor: (ftpFraction: number) => string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const dur = (s: number) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
};
const PMAX = 1.6;
/** Effort « à fond » : dessiné et compté à 150 % de FTP, faute de cible. */
const powerOf = (st: WorkoutStep, p: number) => (st.mode === 'max' ? 1.5 : p);

interface Profile {
  steps: WorkoutStep[];
  total: number;
  tss: number;
  ifv: number;
  avg: number;
  zones: number[];
}

function profileOf(w: LibraryWorkout, zoneIndex: (f: number) => number): Profile {
  const steps = w.build().steps;
  const total = steps.reduce((a, st) => a + st.durationS, 0) || 1;
  let p4 = 0;
  let sum = 0;
  const zones = new Array(7).fill(0) as number[];
  for (const st of steps) {
    const mid = (powerOf(st, st.powerStart) + powerOf(st, st.powerEnd)) / 2;
    p4 += mid ** 4 * st.durationS;
    sum += mid * st.durationS;
    const zi = zoneIndex(mid);
    zones[zi] = (zones[zi] ?? 0) + st.durationS;
  }
  const ifv = (p4 / total) ** 0.25;
  return { steps, total, ifv, tss: Math.round((total / 3600) * ifv * ifv * 100), avg: sum / total, zones };
}

/** Polygones du profil (une forme par suite de paliers de même zone) dans une boîte W × H, l'axe vertical allant de 0 à 160 % de FTP. */
function shapes(steps: WorkoutStep[], total: number, W: number, H: number, zoneColor: (f: number) => string, gap = 1): string {
  const y = (p: number) => (H - (Math.min(p, PMAX) / PMAX) * H).toFixed(1);
  const runs: Array<{ color: string; pts: Array<[number, number]> }> = [];
  let t = 0;
  for (const st of steps) {
    const x0 = (t / total) * W;
    const x1 = ((t + st.durationS) / total) * W;
    t += st.durationS;
    const a = powerOf(st, st.powerStart);
    const b = powerOf(st, st.powerEnd);
    const color = zoneColor((a + b) / 2);
    const last = runs.at(-1);
    if (last && last.color === color) last.pts.push([x0, a], [x1, b]);
    else runs.push({ color, pts: [[x0, a], [x1, b]] });
  }
  const minW = Math.max(2, W / 160);
  return runs
    .map((r, i) => {
      const pts = r.pts.map(([x, p]) => [x, p] as [number, number]);
      if (i > 0) pts[0]![0] += gap;
      if (i < runs.length - 1) pts[pts.length - 1]![0] -= gap;
      if (pts[pts.length - 1]![0] - pts[0]![0] < minW) {
        const c = (pts[0]![0] + pts[pts.length - 1]![0]) / 2;
        pts[0]![0] = c - minW / 2;
        pts[pts.length - 1]![0] = c + minW / 2;
      }
      const top = pts.map(([x, p]) => `${x.toFixed(1)},${y(p)}`).join(' ');
      return `<polygon points="${pts[0]![0].toFixed(1)},${H} ${top} ${pts[pts.length - 1]![0].toFixed(1)},${H}" fill="${r.color}"/>`;
    })
    .join('');
}

/** Étapes lisibles : les paliers identiques qui se suivent sont réunis (« 6 × 3 min à 105 % »). */
function stepRows(p: Profile, ctx: StudioCtx): string {
  const rows: Array<{ n: number; step: WorkoutStep }> = [];
  for (const st of p.steps) {
    const last = rows.at(-1);
    if (last && last.step.durationS === st.durationS && last.step.powerStart === st.powerStart && last.step.powerEnd === st.powerEnd && last.step.mode === st.mode) last.n++;
    else rows.push({ n: 1, step: st });
  }
  return rows
    .map(({ n, step: st }) => {
      const a = powerOf(st, st.powerStart);
      const b = powerOf(st, st.powerEnd);
      const pct = a === b ? `${Math.round(a * 100)} %` : `${Math.round(a * 100)} → ${Math.round(b * 100)} %`;
      const watts = a === b ? `${Math.round(a * ctx.ftp)} W` : `${Math.round(a * ctx.ftp)} → ${Math.round(b * ctx.ftp)} W`;
      const what = st.mode === 'max' ? (ctx.fr ? 'à fond' : 'all out') : `${pct} FTP`;
      return `<li><i style="background:${ctx.zoneColor((a + b) / 2)}"></i><b>${n > 1 ? `${n} × ` : ''}${dur(st.durationS)}</b><span>${what}</span><em>${st.mode === 'max' ? '' : watts}</em></li>`;
    })
    .join('');
}

export function workoutStudioHtml(ctx: StudioCtx): string {
  const { fr, filter } = ctx;
  const lang = fr ? 'fr' : 'en';
  const zoneIndex = (f: number) => {
    const col = ctx.zoneColor(f);
    return Math.max(0, ZONE_ORDER.indexOf(col));
  };
  const all = [...ctx.library, ...ctx.mine];
  const visible =
    filter === 'mine'
      ? [...ctx.library.filter((w) => ctx.favs.has(w.id)), ...ctx.mine]
      : filter
        ? ctx.library.filter((w) => w.type === filter)
        : [...ctx.library];
  const selected = all.find((w) => w.id === ctx.selected) ?? all.find((w) => w.id === ctx.current) ?? visible[0];
  const count = (f: WorkoutType | 'mine' | '') => (f === '' ? ctx.library.length : f === 'mine' ? ctx.favs.size + ctx.mine.length : ctx.library.filter((w) => w.type === f).length);

  // Échelle de l'intensité : une famille = une couleur de zone et 1 à 6 barres.
  const tile = (f: WorkoutType | 'mine' | '', label: string, level: number, color: string) =>
    `<button class="ws-tile${f === filter ? ' on' : ''}" data-wkfilter="${f}" style="--wk:${color}"><span class="ws-lvl">${[1, 2, 3, 4, 5, 6].map((i) => `<i${i <= level ? ' class="on"' : ''}></i>`).join('')}</span><b>${esc(label)}</b><small>${count(f)}</small></button>`;
  const tiles =
    tile('', fr ? 'Toutes' : 'All', 0, '#ffd23f') +
    ctx.types.map((t, i) => tile(t, ctx.typeLabels[t][lang], i + 1, ctx.typeColors[t])).join('') +
    tile('mine', `★ ${fr ? 'Mes séances' : 'Mine'}`, 0, '#ffd23f');

  const row = (w: LibraryWorkout) => {
    const p = profileOf(w, zoneIndex);
    const isSel = selected?.id === w.id;
    const fav = ctx.favs.has(w.id);
    return `<div class="ws-row${isSel ? ' sel' : ''}${w.id === ctx.current ? ' cur' : ''}" data-wksel="${esc(w.id)}" role="button" tabindex="0" style="--wk:${ctx.typeColors[w.type]}">
      <svg class="ws-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">${shapes(p.steps, p.total, 120, 30, ctx.zoneColor, 0.5)}</svg>
      <span class="ws-name"><b>${esc(w.name[lang])}</b><small>${ctx.typeLabels[w.type][lang]} · TSS ${p.tss}</small></span>
      <em>${dur(p.total)}</em>
      <span class="mm-wk-fav${fav ? ' on' : ''}" data-fav="${esc(w.id)}" role="button" tabindex="0" aria-pressed="${fav}" title="${fr ? (fav ? 'Retirer des favoris' : 'Ajouter aux favoris') : fav ? 'Remove from favourites' : 'Add to favourites'}">${fav ? '★' : '☆'}</span>
    </div>`;
  };
  // Liste : rangée par famille (de la plus facile à la plus dure) quand « Toutes » est choisi.
  const list = !visible.length
    ? `<p class="ws-empty">${fr ? 'Ajoute des séances à tes favoris avec l’étoile ☆ ; les séances importées (.zwo, .erg, .mrc) sont gardées ici.' : 'Star ☆ workouts to find them here; imported ones (.zwo, .erg, .mrc) are kept here too.'}</p>`
    : filter
      ? visible.map(row).join('')
      : ctx.types
          .map((t) => {
            const items = visible.filter((w) => w.type === t);
            return items.length ? `<h4 class="ws-sec" style="--wk:${ctx.typeColors[t]}">${ctx.typeLabels[t][lang]}<small>${items.length}</small></h4>${items.map(row).join('')}` : '';
          })
          .join('');

  let detail = `<p class="ws-empty">${fr ? 'Choisis une séance dans la liste.' : 'Pick a workout from the list.'}</p>`;
  if (selected) {
    const p = profileOf(selected, zoneIndex);
    const W = 640;
    const H = 210;
    const grid = [0.5, 1, 1.5]
      .map((f) => {
        const yy = H - (f / PMAX) * H;
        return `<line x1="0" x2="${W}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="${f === 1 ? 'ftp' : ''}"/><text x="4" y="${(yy - 4).toFixed(1)}">${f === 1 ? 'FTP · ' : ''}${Math.round(f * 100)} % · ${Math.round(f * ctx.ftp)} W</text>`;
      })
      .join('');
    const tick = p.total > 5400 ? 1800 : p.total > 2400 ? 900 : 600;
    const ticks: string[] = [];
    for (let t = tick; t < p.total - tick / 3; t += tick) ticks.push(`<span style="left:${((t / p.total) * 100).toFixed(1)}%">${dur(t)}</span>`);
    const zoneBar = p.zones
      .map((s, i) => (s > 0 ? `<i style="flex:${s};background:${ZONE_ORDER[i]}" title="Z${i + 1} · ${dur(s)}"><span>${s / p.total > 0.09 ? `Z${i + 1}` : ''}</span></i>` : ''))
      .join('');
    const isCur = selected.id === ctx.current;
    detail = `<div class="ws-hero" style="--wk:${ctx.typeColors[selected.type]}">
        <header><span class="ws-type">${ctx.typeLabels[selected.type][lang]}</span><h3>${esc(selected.name[lang])}</h3><p>${esc(selected.description[lang])}</p></header>
        <div class="ws-stats">
          <div><small>${fr ? 'Durée' : 'Duration'}</small><b>${dur(p.total)}</b></div>
          <div><small>TSS</small><b>${p.tss}</b></div>
          <div><small>IF</small><b>${p.ifv.toFixed(2).replace('.', fr ? ',' : '.')}</b></div>
          <div><small>${fr ? 'Puissance moy.' : 'Avg power'}</small><b>${Math.round(p.avg * ctx.ftp)} W</b></div>
        </div>
        <div class="ws-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid.replace(/<text/g, '<text')}<g class="shapes">${shapes(p.steps, p.total, W, H, ctx.zoneColor, 1.5)}</g></svg><div class="ws-ticks">${ticks.join('')}</div></div>
        <div class="ws-zones" title="${fr ? 'Temps par zone' : 'Time in zone'}">${zoneBar}</div>
        <ol class="ws-steps">${stepRows(p, ctx)}</ol>
        <div class="ws-actions"><button class="ws-go" data-preset="${esc(selected.id)}">${isCur ? (fr ? '✓ Séance choisie' : '✓ Chosen') : fr ? 'Choisir cette séance' : 'Choose this workout'}</button></div>
      </div>`;
  }

  return `<div class="ws-top"><div class="ws-tiles">${tiles}</div></div>
    <div class="ws-body">
      <div class="ws-list mm-wks-grid">${list}</div>
      <section class="ws-detail">${detail}</section>
    </div>`;
}

/** Couleurs des zones dans l'ordre Z1 → Z7 (repère de la répartition du temps). */
const ZONE_ORDER = ['#c3cbd5', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
