/**
 * « Studio » du choix de séance : en haut l'échelle des familles, puis la recherche, le filtre de durée et le tri ; à
 * gauche la liste des séances (miniature du profil, durée, TSS), à droite la fiche de la séance regardée : grand profil de
 * puissance (axes en % de FTP et en watts), intensité réglable (80–120 %), répartition du temps par zone, déroulé des
 * étapes, et le bouton pour la choisir. Un clic sur une ligne la montre ; « Choisir cette séance » la valide.
 */
import type { LibraryWorkout, WorkoutStep, WorkoutType } from '@allezrobert/physics';
import './workoutStudio.css';

/** Filtre de durée (en minutes arrondies) : tout, ≤ 30, 31–45, 46–60, 61–90, plus de 90. */
export type WorkoutDurFilter = '' | 'le30' | '30-45' | '45-60' | '60-90' | 'gt90';
/** Ordre de la liste : par famille (de la plus facile à la plus dure), durée, TSS ou nom. */
export type WorkoutSort = 'type' | 'dur' | 'tss' | 'name';

export const WORKOUT_DUR_FILTERS: ReadonlyArray<{ id: WorkoutDurFilter; fr: string; en: string }> = [
  { id: '', fr: 'Toutes durées', en: 'Any length' },
  { id: 'le30', fr: '≤ 30 min', en: '≤ 30 min' },
  { id: '30-45', fr: '30–45 min', en: '30–45 min' },
  { id: '45-60', fr: '45–60 min', en: '45–60 min' },
  { id: '60-90', fr: '1 h – 1 h 30', en: '1 h – 1 h 30' },
  { id: 'gt90', fr: '> 1 h 30', en: '> 1 h 30' },
];

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
  /** Recherche (nom, description, famille), filtre de durée et ordre de la liste. */
  query: string;
  dur: WorkoutDurFilter;
  sort: WorkoutSort;
  /** Intensité réglée (1 = 100 %) : multiplie les cibles affichées et celles de la sortie. */
  intensity: number;
}

/** Texte comparable : minuscules, sans accents ni espaces superflus. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** La durée (s) tombe-t-elle dans le filtre ? Les bornes sont en minutes arrondies, la borne haute incluse. */
export function durationMatches(totalS: number, f: WorkoutDurFilter): boolean {
  const m = Math.round(totalS / 60);
  switch (f) {
    case 'le30':
      return m <= 30;
    case '30-45':
      return m > 30 && m <= 45;
    case '45-60':
      return m > 45 && m <= 60;
    case '60-90':
      return m > 60 && m <= 90;
    case 'gt90':
      return m > 90;
    default:
      return true;
  }
}

/** Durée totale (s), TSS, IF et puissance moyenne (fraction de FTP) d'une séance, à l'intensité donnée. */
export function workoutStats(w: LibraryWorkout, intensity = 1): { total: number; tss: number; ifv: number; avg: number } {
  const p = profileOf(w, () => 0, intensity);
  return { total: p.total, tss: p.tss, ifv: p.ifv, avg: p.avg };
}

/**
 * Séances visibles : famille ou « mes séances », recherche et durée, puis tri. Le tri « famille » garde l'ordre de la
 * bibliothèque (les sections sont faites à l'affichage) ; les autres trient la liste entière.
 */
export function visibleWorkouts(
  ctx: Pick<StudioCtx, 'filter' | 'library' | 'mine' | 'favs' | 'query' | 'dur' | 'sort' | 'typeLabels' | 'types'>,
): LibraryWorkout[] {
  const base =
    ctx.filter === 'mine'
      ? [...ctx.library.filter((w) => ctx.favs.has(w.id)), ...ctx.mine]
      : ctx.filter
        ? ctx.library.filter((w) => w.type === ctx.filter)
        : [...ctx.library];
  const q = normalizeSearch(ctx.query);
  const words = q ? q.split(' ') : [];
  const stats = new Map(base.map((w) => [w.id, workoutStats(w)]));
  const out = base.filter((w) => {
    if (!durationMatches(stats.get(w.id)!.total, ctx.dur)) return false;
    if (!words.length) return true;
    const hay = normalizeSearch(`${w.name.fr} ${w.name.en} ${w.description.fr} ${w.description.en} ${ctx.typeLabels[w.type].fr} ${ctx.typeLabels[w.type].en}`);
    return words.every((x) => hay.includes(x));
  });
  if (ctx.sort === 'dur') out.sort((a, b) => stats.get(a.id)!.total - stats.get(b.id)!.total || a.name.fr.localeCompare(b.name.fr, 'fr'));
  else if (ctx.sort === 'tss') out.sort((a, b) => stats.get(b.id)!.tss - stats.get(a.id)!.tss || a.name.fr.localeCompare(b.name.fr, 'fr'));
  else if (ctx.sort === 'name') out.sort((a, b) => a.name.fr.localeCompare(b.name.fr, 'fr', { numeric: true }));
  else if (!ctx.filter || ctx.filter === 'mine') {
    const rank = (t: WorkoutType) => ctx.types.indexOf(t);
    out.sort((a, b) => rank(a.type) - rank(b.type));
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const dur = (s: number) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
};
const PMAX = 1.6;
/** Effort « à fond » : dessiné et compté à 150 % de FTP, faute de cible (l'intensité ne le change pas). */
const powerOf = (st: WorkoutStep, p: number, k = 1) => (st.mode === 'max' ? 1.5 : p * k);

interface Profile {
  steps: WorkoutStep[];
  total: number;
  tss: number;
  ifv: number;
  avg: number;
  zones: number[];
}

/** Cache des étapes construites (la liste est redessinée à chaque frappe de la recherche). */
const builtSteps = new WeakMap<LibraryWorkout, WorkoutStep[]>();
function stepsOf(w: LibraryWorkout): WorkoutStep[] {
  let s = builtSteps.get(w);
  if (!s) {
    s = w.build().steps;
    builtSteps.set(w, s);
  }
  return s;
}

function profileOf(w: LibraryWorkout, zoneIndex: (f: number) => number, k = 1): Profile {
  const steps = stepsOf(w);
  const total = steps.reduce((a, st) => a + st.durationS, 0) || 1;
  let p4 = 0;
  let sum = 0;
  const zones = new Array(7).fill(0) as number[];
  for (const st of steps) {
    const mid = (powerOf(st, st.powerStart, k) + powerOf(st, st.powerEnd, k)) / 2;
    p4 += mid ** 4 * st.durationS;
    sum += mid * st.durationS;
    const zi = zoneIndex(mid);
    zones[zi] = (zones[zi] ?? 0) + st.durationS;
  }
  const ifv = (p4 / total) ** 0.25;
  return { steps, total, ifv, tss: Math.round((total / 3600) * ifv * ifv * 100), avg: sum / total, zones };
}

/** Polygones du profil (une forme par suite de paliers de même zone) dans une boîte W × H, l'axe vertical allant de 0 à 160 % de FTP. */
function shapes(steps: WorkoutStep[], total: number, W: number, H: number, zoneColor: (f: number) => string, gap = 1, k = 1): string {
  const y = (p: number) => (H - (Math.min(p, PMAX) / PMAX) * H).toFixed(1);
  const runs: Array<{ color: string; pts: Array<[number, number]> }> = [];
  let t = 0;
  for (const st of steps) {
    const x0 = (t / total) * W;
    const x1 = ((t + st.durationS) / total) * W;
    t += st.durationS;
    const a = powerOf(st, st.powerStart, k);
    const b = powerOf(st, st.powerEnd, k);
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
      const a = powerOf(st, st.powerStart, ctx.intensity);
      const b = powerOf(st, st.powerEnd, ctx.intensity);
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
  const k = ctx.intensity;
  const all = [...ctx.library, ...ctx.mine];
  const visible = visibleWorkouts(ctx);
  const narrowed = !!(normalizeSearch(ctx.query) || ctx.dur);
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
    const p = profileOf(w, zoneIndex, k);
    const isSel = selected?.id === w.id;
    const fav = ctx.favs.has(w.id);
    return `<div class="ws-row${isSel ? ' sel' : ''}${w.id === ctx.current ? ' cur' : ''}" data-wksel="${esc(w.id)}" role="button" tabindex="0" style="--wk:${ctx.typeColors[w.type]}">
      <svg class="ws-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">${shapes(p.steps, p.total, 120, 30, ctx.zoneColor, 0.5, k)}</svg>
      <span class="ws-name"><b>${esc(w.name[lang])}</b><small>${ctx.typeLabels[w.type][lang]} · TSS ${p.tss}</small></span>
      <em>${dur(p.total)}</em>
      <span class="mm-wk-fav${fav ? ' on' : ''}" data-fav="${esc(w.id)}" role="button" tabindex="0" aria-pressed="${fav}" title="${fr ? (fav ? 'Retirer des favoris' : 'Ajouter aux favoris') : fav ? 'Remove from favourites' : 'Add to favourites'}">${fav ? '★' : '☆'}</span>
    </div>`;
  };
  // Liste : rangée par famille (de la plus facile à la plus dure) quand « Toutes » est choisi et triée par famille.
  const empty = narrowed
    ? `<p class="ws-empty">${fr ? 'Aucune séance ne correspond. Change la durée ou la recherche.' : 'No workout matches. Change the length or the search.'} <button class="mm-link" data-wkreset>${fr ? 'Tout afficher' : 'Show all'}</button></p>`
    : `<p class="ws-empty">${fr ? 'Ajoute des séances à tes favoris avec l’étoile ☆ ; les séances importées (.zwo, .erg, .mrc) sont gardées ici.' : 'Star ☆ workouts to find them here; imported ones (.zwo, .erg, .mrc) are kept here too.'}</p>`;
  const list = !visible.length
    ? empty
    : filter || ctx.sort !== 'type'
      ? visible.map(row).join('')
      : ctx.types
          .map((t) => {
            const items = visible.filter((w) => w.type === t);
            return items.length ? `<h4 class="ws-sec" style="--wk:${ctx.typeColors[t]}">${ctx.typeLabels[t][lang]}<small>${items.length}</small></h4>${items.map(row).join('')}` : '';
          })
          .join('');

  let actions = '';
  let detail = `<p class="ws-empty">${fr ? 'Choisis une séance dans la liste.' : 'Pick a workout from the list.'}</p>`;
  if (selected) {
    const p = profileOf(selected, zoneIndex, k);
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
        <div class="ws-int${Math.abs(k - 1) > 1e-6 ? ' changed' : ''}">
          <span class="ws-int-lbl">${fr ? 'Intensité' : 'Intensity'}</span>
          <button type="button" class="ws-int-btn" data-wkint="-1" aria-label="${fr ? 'Baisser l’intensité' : 'Lower intensity'}"${k <= 0.8 + 1e-6 ? ' disabled' : ''}>−</button>
          <b class="ws-int-val">${Math.round(k * 100)} %</b>
          <button type="button" class="ws-int-btn" data-wkint="1" aria-label="${fr ? 'Augmenter l’intensité' : 'Raise intensity'}"${k >= 1.2 - 1e-6 ? ' disabled' : ''}>+</button>
          ${Math.abs(k - 1) > 1e-6 ? `<button type="button" class="mm-link ws-int-reset" data-wkint="0">${fr ? 'Revenir à 100 %' : 'Back to 100%'}</button>` : ''}
          <small>${fr ? 'Toutes les cibles de la séance, pour cette sortie et les suivantes.' : 'All workout targets, for this ride and the next ones.'}</small>
        </div>
        <div class="ws-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid.replace(/<text/g, '<text')}<g class="shapes">${shapes(p.steps, p.total, W, H, ctx.zoneColor, 1.5, k)}</g></svg><div class="ws-ticks">${ticks.join('')}</div></div>
        <div class="ws-zones" title="${fr ? 'Temps par zone' : 'Time in zone'}">${zoneBar}</div>
        <ol class="ws-steps">${stepRows(p, ctx)}</ol>
      </div>`;
    actions = `<div class="ws-actions"><button class="ws-go" data-preset="${esc(selected.id)}">${isCur ? (fr ? '✓ Séance choisie' : '✓ Chosen') : fr ? 'Choisir cette séance' : 'Choose this workout'}</button></div>`;
  }

  const durs = WORKOUT_DUR_FILTERS.map((d) => `<button type="button" class="ws-seg${d.id === ctx.dur ? ' on' : ''}" data-wkdur="${d.id}" aria-pressed="${d.id === ctx.dur}">${d[lang]}</button>`).join('');
  const sorts: Array<[WorkoutSort, string]> = [
    ['type', fr ? 'Famille' : 'Family'],
    ['dur', fr ? 'Durée' : 'Length'],
    ['tss', 'TSS'],
    ['name', fr ? 'Nom' : 'Name'],
  ];
  const toolbar = `<div class="ws-tools">
      <label class="ws-search"><span aria-hidden="true">⌕</span><input type="search" id="ws-q" value="${esc(ctx.query)}" placeholder="${fr ? 'Rechercher une séance…' : 'Search workouts…'}" autocomplete="off" spellcheck="false" /></label>
      <div class="ws-segs" role="group" aria-label="${fr ? 'Durée' : 'Length'}">${durs}</div>
      <label class="ws-sort">${fr ? 'Trier par' : 'Sort by'}<select id="ws-sort">${sorts.map(([v, l]) => `<option value="${v}"${v === ctx.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="ws-count">${visible.length} ${fr ? (visible.length > 1 ? 'séances' : 'séance') : visible.length > 1 ? 'workouts' : 'workout'}</span>
    </div>`;

  return `<div class="ws-top"><div class="ws-tiles">${tiles}</div>${toolbar}</div>
    <div class="ws-body">
      <div class="ws-list mm-wks-grid">${list}</div>
      <section class="ws-detail"><div class="ws-scroll">${detail}</div>${actions}</section>
    </div>`;
}

/** Couleurs des zones dans l'ordre Z1 → Z7 (repère de la répartition du temps). */
const ZONE_ORDER = ['#c3cbd5', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
