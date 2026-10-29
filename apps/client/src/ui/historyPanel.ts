/**
 * Onglet « Historique » du menu : totaux, forme / fatigue / fraîcheur, temps par zone semaine par
 * semaine, records de puissance, historique des FTP, liste des sorties (filtres, ressenti,
 * suppression) et sorties des amis. Données : historique local (rideHistory), synchronisé avec le
 * compte quand on est connecté.
 */
import { WORKOUT_LIBRARY, WORKOUT_TYPES, WORKOUT_TYPE_LABELS, type WorkoutType } from '@allezrobert/physics';
import type { RideKind, RideFeedback } from '@allezrobert/shared';
import { rideHistory } from '../data/history/instance.ts';
import { loadSeries, totals, weeklyZones, type LocalRide } from '../data/history/index.ts';
import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import './historyPanel.css';

const fr = () => getLang() === 'fr';
const nf = (v: number, d = 0) => v.toFixed(d).replace('.', fr() ? ',' : '.');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Couleurs : forme et fatigue (validées sur fond sombre), zones Z1–Z7 comme le HUD. */
const C_CTL = '#3987e5';
const C_ATL = '#e66767';
const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const PAGE = 20;
/** Pastille du type d'entraînement : couleur de la zone qu'il travaille (comme le HUD). */
const TYPE_DOT: Record<WorkoutType, string> = { recovery: ZONE_HEX[0]!, endurance: ZONE_HEX[1]!, tempo: ZONE_HEX[2]!, sweetspot: ZONE_HEX[3]!, threshold: ZONE_HEX[3]!, vo2max: ZONE_HEX[4]!, anaerobic: ZONE_HEX[5]! };
const isType = (t: string | null | undefined): t is WorkoutType => !!t && (WORKOUT_TYPES as readonly string[]).includes(t);

const KIND_LABEL: Record<RideKind, [string, string]> = {
  free: ['Libre', 'Free ride'],
  workout: ['Séance', 'Workout'],
  race: ['Course', 'Race'],
  group: ['Groupe', 'Group'],
  ftp_test: ['Test FTP', 'FTP test'],
};
const FEEL: Record<RideFeedback, [string, string]> = { easy: ['facile', 'easy'], right: ['juste bien', 'just right'], hard: ['dur', 'hard'], failed: ['pas tenu', 'not finished'] };
const FTP_SOURCE: Record<string, [string, string]> = { manual: ['saisie', 'entered'], ramp: ['test rampe', 'ramp test'], '20min': ['test 20 min', '20 min test'], estimate: ['estimation', 'estimate'], import: ['reprise', 'imported'] };

function hm(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function durLabel(d: number): string {
  return d < 60 ? `${d} s` : d < 3600 ? `${d / 60} min` : `${d / 3600} h`;
}

const dateFmt = () => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Nom d'une séance de la bibliothèque, dans la langue du jeu. */
function workoutLabel(r: LocalRide): string | null {
  const lib = r.workoutId ? WORKOUT_LIBRARY.find((w) => w.id === r.workoutId) : undefined;
  return lib ? lib.name[getLang()] : (r.workoutName ?? null);
}

type HistoryView = 'rides' | 'form' | 'records' | 'friends';

export class HistoryPanel {
  private kind: RideKind | '' = '';
  /** Filtre du type d'entraînement. */
  private ttype: WorkoutType | '' = '';
  private page = 0;
  private box: HTMLElement | null = null;
  private massKg = 75;
  /** Fil des amis déjà chargé (gardé entre deux rendus). */
  private feedHtml = '';
  private unsubscribe: (() => void) | null = null;
  /** Sorties cochées pour une suppression groupée. */
  private readonly selected = new Set<string>();
  /** Sous-onglet affiché (tout tient dans la fenêtre, sans faire défiler la page). */
  private view: HistoryView = 'rides';

  /** Remplit `box` (rappelé à chaque rendu du menu). */
  mount(box: HTMLElement | null, opts: { massKg: number; loggedIn: boolean }): void {
    this.box = box;
    this.massKg = opts.massKg;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!box) return;
    this.unsubscribe = rideHistory.subscribe(() => void this.render());
    void this.render();
    if (opts.loggedIn) void this.friends();
  }

  private filter(): { kind?: RideKind; trainingType?: string } {
    return { ...(this.kind ? { kind: this.kind } : {}), ...(this.ttype ? { trainingType: this.ttype } : {}) };
  }

  private async render(): Promise<void> {
    const box = this.box;
    if (!box) return;
    const L = fr();
    const now = Date.now();
    const DAY = 86_400_000;
    const [all, page, count, ftp, records] = await Promise.all([
      rideHistory.rides({ from: now - 400 * DAY }),
      rideHistory.rides({ limit: PAGE, offset: this.page * PAGE, ...this.filter() }),
      rideHistory.countRides(this.filter()),
      rideHistory.ftpHistory(),
      rideHistory.powerRecords(),
    ]);
    if (this.box !== box) return;
    const allTime = await rideHistory.countRides();
    const lifetime = rideHistory.summary?.totals ?? totals(all);
    const week = totals(all.filter((r) => r.startedAt >= now - 7 * DAY));
    const month = totals(all.filter((r) => r.startedAt >= now - 28 * DAY));
    const load = loadSeries(all, 90, now);
    const today = load.at(-1);
    const st = rideHistory.status;
    const account = rideHistory.currentAccount;
    const syncLine = !account
      ? L ? 'Gardé sur cet appareil. Connecte-toi pour le retrouver partout.' : 'Kept on this device. Sign in to find it everywhere.'
      : st.state === 'syncing'
        ? L ? 'Synchronisation…' : 'Syncing…'
        : st.state === 'offline'
          ? L ? 'Hors ligne : envoi au retour du réseau.' : 'Offline: will sync when back online.'
          : st.state === 'error'
            ? `${L ? 'Synchronisation impossible' : 'Sync failed'} (${esc(st.error ?? '')})`
            : st.at
              ? `${L ? 'Synchronisé' : 'Synced'} ${new Date(st.at).toLocaleTimeString(L ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : L ? 'Synchronisé avec ton compte.' : 'Synced with your account.';

    const tile = (label: string, t: ReturnType<typeof totals>) =>
      `<div class="hp-tile"><span>${label}</span><b>${t.rides} ${L ? (t.rides > 1 ? 'sorties' : 'sortie') : t.rides === 1 ? 'ride' : 'rides'}</b><small>${nf(t.distanceM / 1000)} km · ${hm(t.movingS)} · TSS ${Math.round(t.tss)}</small></div>`;
    const form = today
      ? `<div class="hp-tile"><span>${L ? 'Forme' : 'Fitness'} <i class="hp-dot" style="background:${C_CTL}"></i></span><b>${Math.round(today.ctl)}</b><small>${L ? 'charge sur 42 jours' : '42-day load'}</small></div>
         <div class="hp-tile"><span>${L ? 'Fatigue' : 'Fatigue'} <i class="hp-dot" style="background:${C_ATL}"></i></span><b>${Math.round(today.atl)}</b><small>${L ? 'charge sur 7 jours' : '7-day load'}</small></div>
         <div class="hp-tile"><span>${L ? 'Fraîcheur' : 'Form'}</span><b>${today.tsb > 0 ? '+' : ''}${Math.round(today.tsb)}</b><small>${today.tsb > 5 ? (L ? 'reposé' : 'fresh') : today.tsb >= -10 ? (L ? 'normal' : 'neutral') : today.tsb >= -25 ? (L ? 'fatigué' : 'tired') : L ? 'très fatigué' : 'very tired'}</small></div>`
      : '';

    const recMap = new Map(records.map(([d, w]) => [d, w]));
    const recRows = [5, 15, 60, 300, 1200, 3600]
      .filter((d) => recMap.has(d))
      .map((d) => `<tr><td>${durLabel(d)}</td><td class="num">${Math.round(recMap.get(d)!)} W</td><td class="num">${nf(recMap.get(d)! / this.massKg, 1)} W/kg</td></tr>`)
      .join('');
    const ftpRows = [...ftp]
      .reverse()
      .slice(0, 8)
      .map((f) => `<tr><td>${new Date(f.recordedAt).toLocaleDateString(L ? 'fr-FR' : 'en-GB')}</td><td class="num">${f.ftpWatts} W</td><td class="muted">${FTP_SOURCE[f.source]?.[L ? 0 : 1] ?? f.source}</td></tr>`)
      .join('');

    const df = dateFmt();
    const rows = page
      .map((r) => {
        const wk = workoutLabel(r);
        return `<tr data-ride="${esc(r.clientId)}" class="${this.selected.has(r.clientId) ? 'sel' : ''}">
          <td><input type="checkbox" class="hp-check" data-sel="${esc(r.clientId)}" ${this.selected.has(r.clientId) ? 'checked' : ''} aria-label="${L ? 'Sélectionner' : 'Select'}"/></td>
          <td>${esc(df.format(r.startedAt))}</td>
          <td><b>${esc(r.name)}</b>${wk ? `<small>${esc(wk)}</small>` : ''}</td>
          <td class="hp-types"><span class="hp-kind hp-kind-${r.kind}">${KIND_LABEL[r.kind]?.[L ? 0 : 1] ?? r.kind}</span>${isType(r.trainingType) ? `<span class="hp-tt" title="${r.workoutId ? (L ? 'Type de la séance' : 'Workout type') : L ? 'Estimé d’après le temps passé dans chaque zone' : 'Estimated from time in each zone'}"><i style="background:${TYPE_DOT[r.trainingType]}"></i>${WORKOUT_TYPE_LABELS[r.trainingType][L ? 'fr' : 'en']}</span>` : ''}</td>
          <td class="num">${nf(r.distanceM / 1000, 1)} km</td>
          <td class="num">${hm(r.movingS)}</td>
          <td class="num">${Math.round(r.elevationM)} m</td>
          <td class="num">${r.np ? `${Math.round(r.np)} W` : '—'}</td>
          <td class="num">${r.tss !== null ? Math.round(r.tss) : '—'}</td>
          <td class="num">${r.intensity !== null ? nf(r.intensity, 2) : '—'}</td>
          <td class="muted">${r.feedback ? FEEL[r.feedback][L ? 0 : 1] : ''}</td>
          <td><button class="hp-del" data-del="${esc(r.clientId)}" title="${L ? 'Supprimer cette sortie' : 'Delete this ride'}">${L ? 'Supprimer' : 'Delete'}</button></td>
        </tr>`;
      })
      .join('');
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const kinds: Array<RideKind | ''> = ['', 'free', 'workout', 'group', 'race', 'ftp_test'];

    const views: Array<[HistoryView, string]> = [
      ['rides', `${L ? 'Sorties' : 'Rides'} <small>${allTime}</small>`],
      ['form', L ? 'Forme' : 'Fitness'],
      ['records', L ? 'Records et FTP' : 'Records and FTP'],
      ...(this.feedHtml ? ([['friends', L ? 'Amis' : 'Friends']] as Array<[HistoryView, string]>) : []),
    ];
    if (!views.some(([v]) => v === this.view)) this.view = 'rides';
    const body: Record<HistoryView, () => string> = {
      rides: () => `<section class="hp-card hp-rides"><header class="hp-rides-head">
        <div class="hp-filters"><div class="hp-chips" role="group" aria-label="${L ? 'Nature de la sortie' : 'Ride kind'}">${kinds.map((k) => `<button class="hp-chip${k === this.kind ? ' on' : ''}" data-kind="${k}">${k ? KIND_LABEL[k][L ? 0 : 1] : L ? 'Toutes' : 'All'}</button>`).join('')}</div>
        <div class="hp-chips" role="group" aria-label="${L ? 'Type d’entraînement' : 'Training type'}">${(['', ...WORKOUT_TYPES] as Array<WorkoutType | ''>).map((t) => `<button class="hp-chip${t === this.ttype ? ' on' : ''}" data-ttype="${t}">${t ? `<i class="hp-chip-dot" style="background:${TYPE_DOT[t]}"></i>${WORKOUT_TYPE_LABELS[t][L ? 'fr' : 'en']}` : L ? 'Tous les types' : 'All types'}</button>`).join('')}</div></div>
        <div class="hp-rides-side"><span class="hp-count">${count} ${L ? (count > 1 ? 'sorties' : 'sortie') : count === 1 ? 'ride' : 'rides'}</span>${this.selected.size ? `<button class="btn small hp-delsel" id="hp-delsel">${L ? `Supprimer la sélection (${this.selected.size})` : `Delete selected (${this.selected.size})`}</button>` : ''}</div></header>
        <div class="hp-scroll"><table class="hp-table hp-list"><thead><tr><th><input type="checkbox" class="hp-check" data-selall ${page.length && page.every((r) => this.selected.has(r.clientId)) ? 'checked' : ''} aria-label="${L ? 'Tout sélectionner' : 'Select all'}"/></th><th>${L ? 'Date' : 'Date'}</th><th>${L ? 'Sortie' : 'Ride'}</th><th>${L ? 'Type' : 'Type'}</th><th class="num">${L ? 'Distance' : 'Distance'}</th><th class="num">${L ? 'Temps' : 'Time'}</th><th class="num">D+</th><th class="num">NP</th><th class="num">TSS</th><th class="num">IF</th><th>${L ? 'Ressenti' : 'Feel'}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="12" class="hp-muted">${L ? 'Aucune sortie pour ces filtres.' : 'No ride for these filters.'}</td></tr>`}</tbody></table></div>
        ${pages > 1 ? `<div class="hp-pager"><button class="btn small" data-page="-1" ${this.page === 0 ? 'disabled' : ''}>‹</button><span>${this.page + 1} / ${pages}</span><button class="btn small" data-page="1" ${this.page + 1 >= pages ? 'disabled' : ''}>›</button></div>` : ''}
      </section>`,
      form: () => `<div class="hp-tiles">${tile(L ? '7 derniers jours' : 'Last 7 days', week)}${tile(L ? '28 derniers jours' : 'Last 28 days', month)}${form}</div>
      <div class="hp-grid hp-grid-2">
        <section class="hp-card"><h3>${L ? 'Forme et fatigue · 90 jours' : 'Fitness and fatigue · 90 days'}</h3>
          <div class="hp-legend"><span><i style="background:${C_CTL}"></i>${L ? 'Forme (42 j)' : 'Fitness (42 d)'}</span><span><i style="background:${C_ATL}"></i>${L ? 'Fatigue (7 j)' : 'Fatigue (7 d)'}</span></div>
          <div class="hp-chart" id="hp-load"></div></section>
        <section class="hp-card"><h3>${L ? 'Temps par zone · 12 semaines' : 'Time in zone · 12 weeks'}</h3>
          <div class="hp-legend">${ZONE_HEX.map((c, i) => `<span><i style="background:${c}"></i>Z${i + 1}</span>`).join('')}</div>
          <div class="hp-chart" id="hp-zones"></div></section>
      </div>`,
      records: () => `<div class="hp-grid hp-grid-2">
        <section class="hp-card"><h3>${L ? 'Records de puissance' : 'Power records'}</h3>${recRows ? `<table class="hp-table">${recRows}</table>` : `<p class="hp-muted">—</p>`}</section>
        <section class="hp-card"><h3>${L ? 'Historique des FTP' : 'FTP history'}</h3>${ftpRows ? `<table class="hp-table">${ftpRows}</table>` : `<p class="hp-muted">—</p>`}</section>
      </div>`,
      friends: () => `<section class="hp-card"><h3>${L ? 'Dernières sorties des amis' : 'Friends’ latest rides'}</h3><div class="hp-feed">${this.feedHtml}</div></section>`,
    };

    box.innerHTML =
      allTime === 0
        ? `<div class="hp-bar"><p class="hp-sync">${syncLine}</p>${account ? `<button class="btn small" id="hp-sync">${L ? 'Synchroniser' : 'Sync now'}</button>` : ''}</div>
      <p class="hp-empty">${L ? 'Aucune sortie pour l’instant. Chaque sortie terminée s’ajoute ici, avec sa puissance, son TSS et ses zones.' : 'No rides yet. Every finished ride is added here, with its power, TSS and zones.'}</p>`
        : `<div class="hp-top">
        <div class="hp-odo"><span>${L ? 'Compteur' : 'Odometer'}</span><b>${Math.round(lifetime.distanceM / 1000).toLocaleString(L ? 'fr-FR' : 'en-GB')} <small>km</small></b><em>${lifetime.rides} ${L ? (lifetime.rides > 1 ? 'sorties' : 'sortie') : lifetime.rides === 1 ? 'ride' : 'rides'} · ${hm(lifetime.movingS)} · ${nf(lifetime.elevationM)} m D+</em></div>
        <div class="hp-bar"><p class="hp-sync">${syncLine}</p>${account ? `<button class="btn small" id="hp-sync">${L ? 'Synchroniser' : 'Sync now'}</button>` : ''}</div>
      </div>
      <nav class="hp-tabs" role="tablist">${views.map(([v, label]) => `<button role="tab" class="hp-tab${v === this.view ? ' on' : ''}" aria-selected="${v === this.view}" data-view="${v}">${label}</button>`).join('')}</nav>
      <div class="hp-view hp-view-${this.view}" role="tabpanel">${body[this.view]()}</div>`;

    box.querySelectorAll<HTMLElement>('[data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        this.view = b.dataset.view as HistoryView;
        void this.render();
      }),
    );
    this.loadChart(box.querySelector('#hp-load'), load);
    this.zonesChart(box.querySelector('#hp-zones'), weeklyZones(all, 12, now));
    box.querySelector('#hp-sync')?.addEventListener('click', () => void rideHistory.sync());
    box.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) =>
      b.addEventListener('click', () => {
        this.kind = (b.dataset.kind ?? '') as RideKind | '';
        this.page = 0;
        void this.render();
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-ttype]').forEach((b) =>
      b.addEventListener('click', () => {
        this.ttype = (b.dataset.ttype ?? '') as WorkoutType | '';
        this.page = 0;
        void this.render();
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-page]').forEach((b) =>
      b.addEventListener('click', () => {
        this.page = Math.max(0, this.page + Number(b.dataset.page));
        void this.render();
      }),
    );
    const remove = async (ids: string[]) => {
      const msg = ids.length > 1 ? (L ? `Supprimer ces ${ids.length} sorties de l’historique (et du compte) ?` : `Delete these ${ids.length} rides from your history (and account)?`) : L ? 'Supprimer cette sortie de l’historique (et du compte) ?' : 'Delete this ride from your history (and account)?';
      if (!confirm(msg)) return;
      for (const id of ids) {
        this.selected.delete(id);
        await rideHistory.deleteRide(id);
      }
    };
    box.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', () => void remove([b.dataset.del as string])));
    box.querySelector('#hp-delsel')?.addEventListener('click', () => void remove([...this.selected]));
    box.querySelectorAll<HTMLInputElement>('[data-sel]').forEach((c) =>
      c.addEventListener('change', () => {
        if (c.checked) this.selected.add(c.dataset.sel as string);
        else this.selected.delete(c.dataset.sel as string);
        void this.render();
      }),
    );
    box.querySelector<HTMLInputElement>('[data-selall]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      for (const r of page) {
        if (on) this.selected.add(r.clientId);
        else this.selected.delete(r.clientId);
      }
      void this.render();
    });
  }

  /** Forme et fatigue : deux courbes sur le même axe (TSS par jour), réticule et info-bulle. */
  private loadChart(el: HTMLElement | null, load: ReturnType<typeof loadSeries>): void {
    if (!el || load.length < 2) return;
    const W = 640;
    const H = 170;
    const P = { l: 34, r: 10, t: 8, b: 20 };
    const max = Math.max(10, ...load.map((d) => Math.max(d.ctl, d.atl))) * 1.1;
    const x = (i: number) => P.l + (i / (load.length - 1)) * (W - P.l - P.r);
    const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
    const line = (k: 'ctl' | 'atl') => load.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
    const ticks = [0, Math.round(max / 2), Math.round(max * 0.95)];
    const months = load.map((d, i) => [d, i] as const).filter(([d]) => d.date.endsWith('-01'));
    const df = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { month: 'short' });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${fr() ? 'Forme et fatigue sur 90 jours' : 'Fitness and fatigue over 90 days'}">
      ${ticks.map((t) => `<line class="hp-grid-l" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="hp-axis" x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join('')}
      ${months.map(([d, i]) => `<text class="hp-axis" x="${x(i)}" y="${H - 5}" text-anchor="middle">${df.format(new Date(`${d.date}T12:00:00Z`))}</text>`).join('')}
      <path d="${line('atl')}" fill="none" stroke="${C_ATL}" stroke-width="2" stroke-linejoin="round"/>
      <path d="${line('ctl')}" fill="none" stroke="${C_CTL}" stroke-width="2" stroke-linejoin="round"/>
      <line class="hp-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
      <rect x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent"/>
    </svg><div class="hp-tip" hidden></div>`;
    const svg = el.querySelector('svg') as SVGSVGElement;
    const tip = el.querySelector('.hp-tip') as HTMLElement;
    const cross = el.querySelector('.hp-cross') as SVGLineElement;
    const dfl = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
    svg.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.round(((px - P.l) / (W - P.l - P.r)) * (load.length - 1));
      const d = load[Math.min(load.length - 1, Math.max(0, i))];
      if (!d) return;
      cross.setAttribute('x1', String(x(load.indexOf(d))));
      cross.setAttribute('x2', String(x(load.indexOf(d))));
      cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${dfl.format(new Date(`${d.date}T12:00:00Z`))}</b><span><i style="background:${C_CTL}"></i>${fr() ? 'Forme' : 'Fitness'} ${Math.round(d.ctl)}</span><span><i style="background:${C_ATL}"></i>${fr() ? 'Fatigue' : 'Fatigue'} ${Math.round(d.atl)}</span><span>${fr() ? 'Fraîcheur' : 'Form'} ${d.tsb > 0 ? '+' : ''}${Math.round(d.tsb)}</span><span>TSS ${Math.round(d.tss)}</span>`;
      const left = ((x(load.indexOf(d)) / W) * rect.width);
      tip.style.left = `${Math.min(rect.width - 150, Math.max(0, left + 10))}px`;
    });
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
    });
  }

  /** Temps par zone : barres empilées par semaine (heures), info-bulle par barre. */
  private zonesChart(el: HTMLElement | null, weeks: ReturnType<typeof weeklyZones>): void {
    if (!el) return;
    const W = 640;
    const H = 170;
    const P = { l: 34, r: 10, t: 8, b: 20 };
    const hours = weeks.map((w) => w.zonesS.reduce((a, b) => a + b, 0) / 3600);
    const max = Math.max(1, ...hours) * 1.1;
    const slot = (W - P.l - P.r) / weeks.length;
    const bw = Math.min(34, slot - 6);
    const y = (h: number) => P.t + (1 - h / max) * (H - P.t - P.b);
    const df = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
    const bars = weeks
      .map((w, i) => {
        let acc = 0;
        const x0 = P.l + i * slot + (slot - bw) / 2;
        const segs = w.zonesS
          .map((s, z) => {
            if (s <= 0) return '';
            const h0 = acc / 3600;
            acc += s;
            const h1 = acc / 3600;
            // 2 px d'espace entre segments (couleur du fond).
            return `<rect x="${x0.toFixed(1)}" y="${y(h1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(h0) - y(h1) - 2).toFixed(1)}" fill="${ZONE_HEX[z]}" rx="${z === w.zonesS.findLastIndex((v) => v > 0) ? 3 : 0}"/>`;
          })
          .join('');
        return `<g data-week="${i}">${segs}<rect x="${P.l + i * slot}" y="${P.t}" width="${slot}" height="${H - P.t - P.b}" fill="transparent"/></g>
          ${i % 2 === 0 ? `<text class="hp-axis" x="${x0 + bw / 2}" y="${H - 5}" text-anchor="middle">${df.format(new Date(`${w.week}T12:00:00Z`))}</text>` : ''}`;
      })
      .join('');
    const ticks = [0, max / 2, max * 0.95];
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${fr() ? 'Temps par zone de puissance, par semaine' : 'Time in power zone per week'}">
      ${ticks.map((t) => `<line class="hp-grid-l" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="hp-axis" x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">${nf(t, t < 3 ? 1 : 0)} h</text>`).join('')}
      ${bars}</svg><div class="hp-tip" hidden></div>`;
    const tip = el.querySelector('.hp-tip') as HTMLElement;
    const svg = el.querySelector('svg') as SVGSVGElement;
    el.querySelectorAll<SVGGElement>('[data-week]').forEach((g) => {
      g.addEventListener('pointerenter', () => {
        const w = weeks[Number(g.dataset.week)]!;
        const total = w.zonesS.reduce((a, b) => a + b, 0);
        tip.hidden = false;
        tip.innerHTML = `<b>${fr() ? 'Semaine du' : 'Week of'} ${df.format(new Date(`${w.week}T12:00:00Z`))} · ${hm(total)}</b>${w.zonesS
          .map((s, z) => (s > 0 ? `<span><i style="background:${ZONE_HEX[z]}"></i>Z${z + 1} ${hm(s)}</span>` : ''))
          .join('')}`;
        const rect = svg.getBoundingClientRect();
        const left = ((P.l + (Number(g.dataset.week) + 1) * slot) / W) * rect.width;
        tip.style.left = `${Math.min(rect.width - 160, left + 6)}px`;
      });
      g.addEventListener('pointerleave', () => (tip.hidden = true));
    });
  }

  /** Dernières sorties des amis (compte requis). */
  private async friends(): Promise<void> {
    try {
      const r = await fetch(`${apiBase()}/history/friends`, { credentials: 'include' });
      if (!r.ok) return;
      const feed = (await r.json()) as Array<{ name: string; startedAt: number; distanceM: number; movingS: number; elevationM: number; kind: RideKind; workoutName: string | null }>;
      if (feed.length === 0) return;
      const df = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
      this.feedHtml = feed
        .slice(0, 10)
        .map((f) => `<div class="hp-feed-row"><b>${esc(f.name)}</b><span>${df.format(f.startedAt)} · ${nf(f.distanceM / 1000, 1)} km · ${hm(f.movingS)}${f.workoutName ? ` · ${esc(f.workoutName)}` : ''}</span></div>`)
        .join('');
      void this.render();
    } catch {
      // Hors ligne : pas de fil des amis.
    }
  }
}
