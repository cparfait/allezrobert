/**
 * « Studio » du choix de séance, en trois colonnes sous une seule barre d'outils (recherche, durée, tri) : à gauche
 * l'échelle des familles (de la plus facile à la plus dure), au milieu la liste des séances (miniature du profil, durée,
 * TSS), à droite la fiche de la séance regardée : grand profil de puissance (repères en % de FTP et en watts),
 * répartition du temps par zone, déroulé des étapes ; en pied de fiche l'intensité réglable (80–120 %) et le bouton
 * pour la choisir. Un clic sur une ligne la montre ; « Choisir cette séance » la valide.
 */
import type { LibraryWorkout, WorkoutStep, WorkoutType } from '@allezrobert/physics';
import { strings } from '../i18n/index.ts';
import './blocks.css';
import './workoutStudio.css';

const S = strings(
  {
    nWorkouts: '{n} séances',
    oneWorkout: '{n} séance',
    unfav: 'Retirer des favoris',
    fav: 'Ajouter aux favoris',
    all: 'Toutes',
    mine: 'Mes séances',
    noWorkoutMatchesChange: 'Aucune séance ne correspond. Change la durée ou la recherche.',
    showAll: 'Tout afficher',
    starWorkoutsToFind: 'Ajoute des séances à tes favoris avec l’étoile ☆ ; les séances importées (.zwo, .erg, .mrc) sont gardées ici.',
    pickAWorkoutFrom: 'Choisis une séance dans la liste.',
    duration: 'Durée',
    decimal: ',',
    avgPower: 'Puissance moy.',
    intensity: 'Intensité',
    lowerIntensity: 'Baisser l’intensité',
    raiseIntensity: 'Augmenter l’intensité',
    backTo100: 'Revenir à 100 %',
    allWorkoutTargetsFor: 'Toutes les cibles de la séance, pour cette sortie et les suivantes.',
    timeInZone: 'Temps par zone',
    chosen: '✓ Séance choisie',
    chooseThisWorkout: 'Choisir cette séance',
    family: 'Famille',
    length: 'Durée',
    name: 'Nom',
    searchWorkouts: 'Rechercher une séance…',
    sortBy: 'Trier par',
    allOut: 'à fond',
    steps: 'Déroulé',
    families: 'Familles de séances',
  },
  {
    nWorkouts: '{n} workouts',
    oneWorkout: '{n} workout',
    unfav: 'Remove from favourites',
    fav: 'Add to favourites',
    all: 'All',
    mine: 'Mine',
    noWorkoutMatchesChange: 'No workout matches. Change the length or the search.',
    showAll: 'Show all',
    starWorkoutsToFind: 'Star ☆ workouts to find them here; imported ones (.zwo, .erg, .mrc) are kept here too.',
    pickAWorkoutFrom: 'Pick a workout from the list.',
    duration: 'Duration',
    decimal: '.',
    avgPower: 'Avg power',
    intensity: 'Intensity',
    lowerIntensity: 'Lower intensity',
    raiseIntensity: 'Raise intensity',
    backTo100: 'Back to 100%',
    allWorkoutTargetsFor: 'All workout targets, for this ride and the next ones.',
    timeInZone: 'Time in zone',
    chosen: '✓ Chosen',
    chooseThisWorkout: 'Choose this workout',
    family: 'Family',
    length: 'Length',
    name: 'Name',
    searchWorkouts: 'Search workouts…',
    sortBy: 'Sort by',
    allOut: 'all out',
    steps: 'Steps',
    families: 'Workout families',
  },
);


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

/** Puissance la plus haute de la séance (fraction de FTP), à l'intensité donnée. */
function peakOf(steps: WorkoutStep[], k = 1): number {
  return steps.reduce((m, st) => Math.max(m, powerOf(st, st.powerStart, k), powerOf(st, st.powerEnd, k)), 0);
}

/** Polygones du profil (une forme par suite de paliers de même zone) dans une boîte W × H, l'axe vertical allant de 0 à `pmax` (fraction de FTP). */
function shapes(steps: WorkoutStep[], total: number, W: number, H: number, zoneColor: (f: number) => string, gap = 1, k = 1, pmax = PMAX): string {
  const y = (p: number) => (H - (Math.min(p, pmax) / pmax) * H).toFixed(1);
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
      const what = st.mode === 'max' ? S('allOut') : `${pct} FTP`;
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

  // Échelle des familles : une famille = une couleur de zone et 1 à 6 barres ; « Toutes » porte les six couleurs.
  const bars = (level: number) => [1, 2, 3, 4, 5, 6].map((i) => `<i${i <= level ? ' class="on"' : ''}></i>`).join('');
  const allBars = ctx.types.slice(0, 6).map((t) => `<i class="on" style="background:${ctx.typeColors[t]}"></i>`).join('');
  const fam = (f: WorkoutType | 'mine' | '', label: string, mark: string, color: string) =>
    `<button type="button" class="ws-fam${f === filter ? ' on' : ''}" data-wkfilter="${f}" aria-pressed="${f === filter}" style="--wk:${color}"><span class="ws-lvl">${mark}</span><b>${esc(label)}</b><small>${count(f)}</small></button>`;
  const rail =
    fam('', S('all'), allBars, '#ffd23f') +
    ctx.types.map((t, i) => fam(t, ctx.typeLabels[t][lang], bars(i + 1), ctx.typeColors[t])).join('') +
    fam('mine', S('mine'), '<em>★</em>', '#ffd23f');

  const grouped = !filter && ctx.sort === 'type';
  const row = (w: LibraryWorkout) => {
    const p = profileOf(w, zoneIndex, k);
    const isSel = selected?.id === w.id;
    const fav = ctx.favs.has(w.id);
    const sub = grouped ? `TSS ${p.tss}` : `${ctx.typeLabels[w.type][lang]} · TSS ${p.tss}`;
    return `<div class="ws-row${isSel ? ' sel' : ''}${w.id === ctx.current ? ' cur' : ''}" data-wksel="${esc(w.id)}" role="button" tabindex="0" style="--wk:${ctx.typeColors[w.type]}">
      <svg class="ws-spark" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">${shapes(p.steps, p.total, 120, 40, ctx.zoneColor, 0.5, k, Math.max(1, peakOf(p.steps, k) * 1.08))}</svg>
      <span class="ws-name"><b>${esc(w.name[lang])}</b><small>${sub}</small></span>
      <em>${dur(p.total)}</em>
      <span class="mm-wk-fav${fav ? ' on' : ''}" data-fav="${esc(w.id)}" role="button" tabindex="0" aria-pressed="${fav}" title="${S(fav ? 'unfav' : 'fav')}">${fav ? '★' : '☆'}</span>
    </div>`;
  };
  // Liste : rangée par famille (de la plus facile à la plus dure) quand « Toutes » est choisi et triée par famille.
  const empty = narrowed
    ? `<p class="ws-empty">${S('noWorkoutMatchesChange')} <button class="mm-link" data-wkreset>${S('showAll')}</button></p>`
    : `<p class="ws-empty">${S('starWorkoutsToFind')}</p>`;
  const list = !visible.length
    ? empty
    : !grouped
      ? visible.map(row).join('')
      : ctx.types
          .map((t) => {
            const items = visible.filter((w) => w.type === t);
            return items.length ? `<h4 class="ws-sec" style="--wk:${ctx.typeColors[t]}">${ctx.typeLabels[t][lang]}<small>${items.length}</small></h4>${items.map(row).join('')}` : '';
          })
          .join('');

  let actions = '';
  let detail = `<p class="ws-empty">${S('pickAWorkoutFrom')}</p>`;
  if (selected) {
    const p = profileOf(selected, zoneIndex, k);
    const W = 640;
    const H = 220;
    // Échelle verticale ajustée à la séance : le profil remplit le cadre au lieu de rester tassé en bas.
    const pmax = Math.max(1.25, peakOf(p.steps, k) * 1.12);
    const marks = pmax >= 1.6 ? [0.5, 1, 1.5] : [0.5, 1];
    const grid = marks
      .map((f) => {
        const yy = H - (f / pmax) * H;
        return `<line x1="0" x2="${W}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"${f === 1 ? ' class="ftp"' : ''}/>`;
      })
      .join('');
    const gridLabels = marks
      .map((f) => `<span${f === 1 ? ' class="ftp"' : ''} style="bottom:${((f / pmax) * 100).toFixed(1)}%">${f === 1 ? 'FTP · ' : ''}${Math.round(f * 100)} % · ${Math.round(f * ctx.ftp)} W</span>`)
      .join('');
    const tick = p.total > 5400 ? 1800 : p.total > 2400 ? 900 : 600;
    const ticks: string[] = [];
    for (let t = tick; t < p.total - tick / 3; t += tick) ticks.push(`<span style="left:${((t / p.total) * 100).toFixed(1)}%">${dur(t)}</span>`);
    const zoneBar = p.zones
      .map((s, i) => {
        if (s <= 0) return '';
        const share = s / p.total;
        const label = share > 0.2 ? `Z${i + 1} · ${dur(s)}` : share > 0.07 ? `Z${i + 1}` : '';
        return `<i style="flex:${s};background:${ZONE_ORDER[i]}" title="Z${i + 1} · ${dur(s)}"><span>${label}</span></i>`;
      })
      .join('');
    const isCur = selected.id === ctx.current;
    const changed = Math.abs(k - 1) > 1e-6;
    detail = `<div class="ws-hero" style="--wk:${ctx.typeColors[selected.type]}">
        <div class="ws-head"><span class="ws-type">${ctx.typeLabels[selected.type][lang]}</span><h3 class="ws-title">${esc(selected.name[lang])}</h3><p class="ws-desc">${esc(selected.description[lang])}</p></div>
        <div class="ws-stats">
          <div><small>${S('duration')}</small><b>${dur(p.total)}</b></div>
          <div><small>TSS</small><b>${p.tss}</b></div>
          <div><small>IF</small><b>${p.ifv.toFixed(2).replace('.', S('decimal'))}</b></div>
          <div><small>${S('avgPower')}</small><b>${Math.round(p.avg * ctx.ftp)} W</b></div>
        </div>
        <div class="ws-graph">
          <div class="ws-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}<g class="shapes">${shapes(p.steps, p.total, W, H, ctx.zoneColor, 1.5, k, pmax)}</g></svg><div class="ws-marks">${gridLabels}</div></div>
          <div class="ws-zones" title="${S('timeInZone')}">${zoneBar}</div>
          <div class="ws-ticks">${ticks.join('')}</div>
        </div>
        <h4 class="ab-section ws-h">${S('steps')}</h4>
        <ol class="ws-steps">${stepRows(p, ctx)}</ol>
      </div>`;
    actions = `<div class="ws-actions">
        <div class="ws-int${changed ? ' changed' : ''}" title="${S('allWorkoutTargetsFor')}">
          <span class="ws-int-lbl">${S('intensity')}</span>
          <button type="button" class="ws-int-btn" data-wkint="-1" aria-label="${S('lowerIntensity')}"${k <= 0.8 + 1e-6 ? ' disabled' : ''}>−</button>
          <b class="ws-int-val">${Math.round(k * 100)} %</b>
          <button type="button" class="ws-int-btn" data-wkint="1" aria-label="${S('raiseIntensity')}"${k >= 1.2 - 1e-6 ? ' disabled' : ''}>+</button>
          ${changed ? `<button type="button" class="mm-link ws-int-reset" data-wkint="0">${S('backTo100')}</button>` : ''}
        </div>
        <button type="button" class="ab-btn ab-go ws-go${isCur ? ' is-cur' : ''}" data-preset="${esc(selected.id)}">${isCur ? S('chosen') : S('chooseThisWorkout')}</button>
      </div>`;
  }

  const durs = WORKOUT_DUR_FILTERS.map((d) => `<button type="button" class="ws-seg${d.id === ctx.dur ? ' on' : ''}" data-wkdur="${d.id}" aria-pressed="${d.id === ctx.dur}">${d[lang]}</button>`).join('');
  const sorts: Array<[WorkoutSort, string]> = [
    ['type', S('family')],
    ['dur', S('length')],
    ['tss', 'TSS'],
    ['name', S('name')],
  ];
  const toolbar = `<div class="ws-tools">
      <label class="ws-search"><span aria-hidden="true">⌕</span><input type="search" id="ws-q" value="${esc(ctx.query)}" placeholder="${S('searchWorkouts')}" autocomplete="off" spellcheck="false" /></label>
      <div class="ws-segs" role="group" aria-label="${S('length')}">${durs}</div>
      <label class="ws-sort">${S('sortBy')}<select id="ws-sort">${sorts.map(([v, l]) => `<option value="${v}"${v === ctx.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="ws-count">${S(visible.length > 1 ? 'nWorkouts' : 'oneWorkout').replace('{n}', String(visible.length))}</span>
    </div>`;

  return `${toolbar}
    <div class="ws-body">
      <nav class="ws-rail" aria-label="${S('families')}">${rail}</nav>
      <div class="ws-list mm-wks-grid">${list}</div>
      <section class="ws-detail"><div class="ws-scroll">${detail}</div>${actions}</section>
    </div>`;
}

/** Couleurs des zones dans l'ordre Z1 → Z7 (repère de la répartition du temps). */
const ZONE_ORDER = ['#c3cbd5', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
