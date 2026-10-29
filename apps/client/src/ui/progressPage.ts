import {
  BIKE_BRANDS,
  COSMETICS,
  MAX_LEVEL,
  MAX_XP_PER_RIDE,
  RARITY_LABEL,
  TUNE_EVENT_LABEL,
  TUNE_ITEMS,
  TUNE_KITS,
  applyTuneLook,
  bikeById,
  bikeOfLook,
  dayKey,
  kitProgress,
  trainerOf,
  xpForLevel,
  type AvatarLook,
  type CosmeticItem,
  type TuneEvent,
  type TuneItem,
} from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import { TROPHIES, earnedTrophies, trophyTotalKm } from '../game/trophies.ts';
import { rideHistory } from '../data/history/instance.ts';
import { loadProgress } from './garage.ts';
import { COIN, TUNE_SLOT_LABEL, bikeThumb, swatch as tuneSwatch } from './atelierPanel.ts';
import { bikeThumbHtml } from './bikeThumb.ts';
import './progressPage.css';

/**
 * Onglet Progression : niveau et XP, tout ce que chaque niveau débloque (vélos, tenues, pièces de
 * l'atelier, ensembles) sur une frise de 1 à 50, trophées avec leur avancement, défis de l'atelier
 * et collection. Un clic sur une récompense l'ouvre au garage (essai sur le coureur) ou à l'atelier.
 */

export type ProgressView = 'levels' | 'trophies';
type Cat = 'bike' | 'jersey' | 'helmet' | 'glasses' | 'socks' | 'trainer' | 'tune' | 'kit';

export interface ProgressHost {
  /** Niveau affiché (celui du compte une fois connecté). */
  level(): number;
  credits(): number;
  look(): AvatarLook;
  /** Vignettes du garage (couleurs et motifs d'un équipement, dessin de vélo de repli). */
  cosmeticSwatch(c: CosmeticItem): string;
  bikeIcon(colors: readonly string[]): string;
  openCosmetic(item: CosmeticItem): void;
  openTune(id: string): void;
  rerender(): void;
}

interface Reward {
  cat: Cat;
  level: number;
  id: string;
  name: string;
  sub: string;
  thumb: string;
  /** Couleur de rareté (pièces de l'atelier, ensembles). */
  rar?: string;
  state: 'on' | 'own' | 'open' | 'lock';
  stateText: string;
  tune: boolean;
  title: string;
}

const CATS: Array<[Cat, string, string]> = [
  ['bike', 'Vélos', 'Bikes'],
  ['jersey', 'Maillots', 'Jerseys'],
  ['helmet', 'Casques', 'Helmets'],
  ['glasses', 'Lunettes', 'Glasses'],
  ['socks', 'Chaussettes', 'Socks'],
  ['trainer', 'Home trainers', 'Home trainers'],
  ['tune', 'Atelier', 'Workshop'],
  ['kit', 'Ensembles', 'Sets'],
];

/** XP d'une heure de selle à allure d'endurance sur le plat (≈ 28 km/h) : 20 XP/km + 2 XP/min. */
const XP_PER_KM = 20 + (2 * 60) / 28;
const XP_PER_HOUR = 28 * 20 + 120;
const MILESTONE = (l: number) => l % 10 === 0;

const fr = () => getLang() === 'fr';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const int = (v: number) => Math.round(v).toLocaleString(fr() ? 'fr-FR' : 'en-GB');
const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(1)}%`;

/** « ≈ 27 km » ou « ≈ 1 040 km » : distance à plat pour gagner `xp`. */
function kmFor(xp: number): string {
  const km = xp / XP_PER_KM;
  return `≈ ${int(km < 20 ? Math.ceil(km) : Math.round(km / 10) * 10)} km`;
}

/** « ≈ 45 min », « ≈ 3 h 20 » de selle pour gagner `xp`. */
function timeFor(xp: number): string {
  const min = Math.max(1, Math.round((xp / XP_PER_HOUR) * 60));
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60);
  return h >= 10 ? `≈ ${int(h)} h` : `≈ ${h} h ${String(Math.round((min % 60) / 5) * 5).padStart(2, '0')}`;
}

const ICON = {
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 2.9 2.9 6.1-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.3 2 4.3 4.7.5-3.5 3.2 1 4.6L8 11.6l-4.2 2.3 1-4.6L1.3 6.1 6 5.6z" fill="currentColor"/></svg>',
  flame: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15c-3 0-5-2-5-4.8 0-2.4 1.6-3.7 2.6-5.4.3 1.3 1 2 1.8 2.3C7.1 4.6 8.3 2.4 10 1c-.2 2.4.8 3.8 1.9 5.2.7.9 1.1 2 1.1 3.1C13 12.6 11 15 8 15z" fill="currentColor"/></svg>',
  trophy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h8v4.2a4 4 0 0 1-8 0zM4 3H1.6v1.3A2.6 2.6 0 0 0 4.3 7M12 3h2.4v1.3A2.6 2.6 0 0 1 11.7 7M8 9.7v2.4M5 14.5h6M6 12.1h4v2.4H6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.6 1.6M11.4 11.4 13 13M3 13l1.6-1.6M11.4 4.6 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  shirt: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 1.5 1.5 3.6 3 7.2l1.6-.7V14.5h6.8V6.5l1.6.7 1.5-3.6-4.1-2.1C10 2.8 9.1 3.5 8 3.5S6 2.8 5.6 1.5z" fill="currentColor"/></svg>',
};

/** Familles de trophées (ordre d'affichage) et pictogramme de la médaille. */
const TROPHY_FAMILY: Record<string, [string, string, string]> = {
  'first-ride': ['Débuts', 'First steps', 'M5 12a3 3 0 1 0 0 .01M19 12a3 3 0 1 0 0 .01M5 12l4-6h6l4 6M9 6l3 6h-7M12 12l3-6'],
  'ten-km': ['Distance', 'Distance', 'M4 18 9 7l4 7 3-4 4 8z'],
  'fifty-km': ['Distance', 'Distance', 'M4 18 9 7l4 7 3-4 4 8z'],
  'hundred-km': ['Distance', 'Distance', 'M4 18 9 7l4 7 3-4 4 8z'],
  'total-500': ['Distance', 'Distance', 'M4 18 9 7l4 7 3-4 4 8z'],
  'climber-500': ['Montagne', 'Mountains', 'M3 19 10 6l3 5 2-3 6 11zM10 6l1.5 3'],
  'first-kom': ['Montagne', 'Mountains', 'M3 19 10 6l3 5 2-3 6 11zM10 6l1.5 3'],
  record: ['Entraînement', 'Training', 'M13 3 6 13h5l-1 8 7-10h-5z'],
  workout: ['Entraînement', 'Training', 'M13 3 6 13h5l-1 8 7-10h-5z'],
  rain: ['Aventure', 'Adventure', 'M7 15a4 4 0 0 1 .5-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7zM9 18l-1 2M13 18l-1 2M17 18l-1 2'],
  night: ['Aventure', 'Adventure', 'M16 4a8 8 0 1 0 4 12A7 7 0 0 1 16 4z'],
  explorer: ['Aventure', 'Adventure', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z'],
  'wheel-sucker': ['Peloton', 'Bunch', 'M5 12a3 3 0 1 0 0 .01M19 12a3 3 0 1 0 0 .01M5 12l4-6h6l4 6'],
  'team-player': ['Peloton', 'Bunch', 'M8 8a3 3 0 1 0 0-.01M16 8a3 3 0 1 0 0-.01M3 19c0-3 2.2-5 5-5s5 2 5 5M11 19c0-3 2.2-5 5-5s5 2 5 5'],
};

/** Médaille d'un trophée : bronze, argent ou or selon l'XP qu'il rapporte. */
const tier = (xp: number): 'gold' | 'silver' | 'bronze' => (xp >= 500 ? 'gold' : xp >= 200 ? 'silver' : 'bronze');
const TIER_LABEL = { gold: ['Or', 'Gold'], silver: ['Argent', 'Silver'], bronze: ['Bronze', 'Bronze'] } as const;

function medal(id: string, xp: number, earned: boolean): string {
  const path = TROPHY_FAMILY[id]?.[2] ?? 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6l-4.9 2.6.9-5.5-4-3.9 5.5-.8z';
  return `<span class="pg-medal ${earned ? tier(xp) : 'off'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

/** Barre d'avancement avec son texte (« 42 / 50 km »). */
function bar(v: number, label: string, done = false): string {
  return `<div class="pg-bar ${done ? 'done' : ''}"><i style="width:${pct(v)}"></i></div><small class="pg-bar-t">${label}</small>`;
}

export class ProgressPage {
  view: ProgressView = 'levels';
  private cats = new Set<Cat>();
  /** Dernier affichage (vue) : au premier, la frise défile jusqu'au niveau atteint ; ensuite le défilement est gardé. */
  private shownView: ProgressView | null = null;
  private scroll = 0;
  /** Récompense ouverte en fiche (sans quitter la page Progression). */
  private detail: { id: string; tune: boolean } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ProgressHost,
  ) {}

  /** Quitte l'onglet : la frise revient au niveau actuel à la prochaine ouverture. */
  reset(): void {
    this.shownView = null;
  }

  private xp(level: number): number {
    // Connecté : le niveau du compte fait foi ; l'XP locale au moins à son seuil.
    return Math.max(loadProgress().xp, xpForLevel(level));
  }

  // ————————————————————————————————————————————— Récompenses

  private rewards(level: number): Reward[] {
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const p = loadProgress();
    const out: Reward[] = [];
    for (const c of COSMETICS) {
      const open = c.level <= level;
      const on = (c.slot === 'trainer' ? trainerOf(p.equipped) : p.equipped[c.slot]) === c.id;
      const bike = c.slot === 'bike' ? bikeById(c.id) : undefined;
      const brand = bike ? (BIKE_BRANDS.find((b) => b.id === bike.brand)?.name ?? '') : '';
      const thumb =
        c.slot === 'bike'
          ? bike
            ? bikeThumbHtml(c.id, 'pg-bikeimg', c.colors ?? [c.color ?? '#7a8594'])
            : this.host.bikeIcon(c.colors ?? [c.color ?? '#7a8594'])
          : c.slot === 'glasses'
            ? this.glasses(c)
            : `<i class="pg-shape ${c.slot === 'helmet' && c.cap ? 'cap' : c.slot}" style="background:${this.host.cosmeticSwatch(c)}"></i>`;
      const sub = [bike ? (brand || CATS[0]![L ? 1 : 2]) : CATS.find((x) => x[0] === c.slot)?.[L ? 1 : 2], bike?.year, c.effect?.[lang]].filter(Boolean).join(' · ');
      out.push({
        cat: c.slot as Cat,
        level: c.level,
        id: c.id,
        name: c.name[lang],
        sub,
        thumb,
        state: on ? 'on' : open ? 'open' : 'lock',
        stateText: on ? (L ? 'Équipé' : 'Equipped') : open ? (L ? 'Débloqué' : 'Unlocked') : `${L ? 'Niveau' : 'Level'} ${c.level}`,
        tune: false,
        title: bike ? bike.desc[lang] : '',
      });
    }
    for (const t of TUNE_ITEMS) {
      if (!('level' in t.unlock) || t.family === 'event') continue;
      const lvl = t.unlock.level;
      const kit = t.family === 'kit';
      const owned = kit ? kitProgress(t, p.owned).complete : p.owned.includes(t.id);
      const on = !!t.slot && p.equipped[t.slot] === t.id;
      const rar = RARITY_LABEL[t.rarity];
      const thumb = kit ? bikeThumb(applyTuneLook(bikeOfLook({ ...this.host.look(), tune: [] }), t.pieces ?? []), t.id) : `<i class="pg-tune" style="background:${tuneSwatch(t)}"></i>`;
      const open = lvl <= level;
      out.push({
        cat: kit ? 'kit' : 'tune',
        level: lvl,
        id: t.id,
        name: t.name[lang],
        sub: [kit ? (L ? `Ensemble de ${t.pieces?.length ?? 0} pièces` : `${t.pieces?.length ?? 0}-part set`) : t.slot ? TUNE_SLOT_LABEL[t.slot][L ? 0 : 1] : '', rar[lang]].filter(Boolean).join(' · '),
        thumb,
        rar: kit ? (t.badge ?? rar.color) : rar.color,
        state: on ? 'on' : owned ? 'own' : open ? 'open' : 'lock',
        stateText: on ? (L ? 'Équipé' : 'Equipped') : owned ? (kit ? (L ? 'Complet' : 'Complete') : L ? 'Possédé' : 'Owned') : open ? (kit ? (L ? 'Disponible' : 'Available') : `${COIN} ${int(t.price)}`) : `${L ? 'Niveau' : 'Level'} ${lvl}`,
        tune: true,
        title: `${t.desc[lang]} — ${t.effect[lang]}`,
      });
    }
    return out;
  }

  /** Lunettes : monture et verres à leurs couleurs. */
  private glasses(c: CosmeticItem): string {
    const frame = c.glasses?.frame ?? '#1a1d22';
    const lens = c.glasses?.lens ?? '#3b4a5c';
    return `<svg class="pg-glasses" viewBox="0 0 64 32" aria-hidden="true"><path d="M4 9h56" stroke="${frame}" stroke-width="3.2" stroke-linecap="round"/><path d="M7 9h21c0 9-3 15-10.5 15S7 18 7 9zM36 9h21c0 9-3.5 15-10.5 15S36 18 36 9z" fill="${lens}" stroke="${frame}" stroke-width="2.6" stroke-linejoin="round"/><path d="M12 12c2-.5 4 0 6 1M41 12c2-.5 4 0 6 1" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }

  private card(r: Reward, big = false): string {
    const icon = r.state === 'lock' ? ICON.lock : r.state === 'open' && r.tune && r.cat === 'tune' ? '' : ICON.check;
    return `<button class="pg-card ${r.state} ${big ? 'big' : ''} cat-${r.cat}" ${r.tune ? `data-pgtune="${r.id}"` : `data-pgitem="${r.id}"`} ${r.rar ? `style="--rar:${r.rar}"` : ''} title="${esc(r.title || r.name)}">
      <span class="pg-thumb">${r.thumb}</span>
      <span class="pg-card-t"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>
      <span class="pg-st">${icon}${r.stateText}</span></button>`;
  }

  // ————————————————————————————————————————————— Affichage

  html(close: string): string {
    const L = fr();
    const level = this.host.level();
    const xp = this.xp(level);
    // Défilement gardé d'un rendu à l'autre (même vue).
    this.scroll = this.shownView === this.view ? (this.root.querySelector<HTMLElement>('.pg')?.scrollTop ?? 0) : -1;
    const views: Array<[ProgressView, string]> = [
      ['levels', L ? 'Niveaux et récompenses' : 'Levels and rewards'],
      ['trophies', L ? 'Trophées et défis' : 'Trophies and challenges'],
    ];
    const sub = `<nav class="hp-tabs mm-subtabs pg-subtabs" role="tablist">${views.map(([v, label]) => `<button role="tab" class="hp-tab${v === this.view ? ' on' : ''}" aria-selected="${v === this.view}" data-pgview="${v}">${label}</button>`).join('')}</nav>`;
    const rewards = this.rewards(level);
    return `<section class="mm-panel mm-center pg">${close}
      ${this.heroHtml(level, xp, rewards)}
      ${sub}
      ${this.view === 'levels' ? this.levelsHtml(level, xp, rewards) : this.trophiesHtml(level, rewards)}
    </section>${this.detailHtml(rewards)}`;
  }

  /** Fiche d'une récompense : grande vignette, état, description et caractéristiques ; « Essayer au garage » en option. */
  private detailHtml(rewards: Reward[]): string {
    const d = this.detail;
    if (!d) return '';
    const r = rewards.find((x) => x.id === d.id);
    if (!r) return '';
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const rows: Array<[string, string]> = [];
    const pm = (v: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(L ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 3 })} ${unit}`;
    const factor = (f: number) => `${f < 1 ? '−' : '+'}${Math.abs((f - 1) * 100).toFixed(1).replace('.', L ? ',' : '.')} %`;
    const perf = (o: { massKg?: number; cdaFactor?: number; crrFactor?: number; wheelInertia?: number; drivetrain?: number } | undefined) => {
      if (!o) return;
      if (o.massKg !== undefined) rows.push([L ? 'Masse' : 'Weight', pm(o.massKg, 'kg')]);
      if (o.cdaFactor !== undefined) rows.push([L ? 'Traînée aéro (CdA)' : 'Aero drag (CdA)', factor(o.cdaFactor)]);
      if (o.crrFactor !== undefined) rows.push([L ? 'Résistance au roulement' : 'Rolling resistance', factor(o.crrFactor)]);
      if (o.wheelInertia !== undefined) rows.push([L ? 'Inertie des roues' : 'Wheel inertia', `${o.wheelInertia.toLocaleString(L ? 'fr-FR' : 'en-GB')} kg·m²`]);
      if (o.drivetrain !== undefined) rows.push([L ? 'Rendement transmission' : 'Drivetrain efficiency', `+${(o.drivetrain * 100).toFixed(1).replace('.', L ? ',' : '.')} %`]);
    };
    let desc = '';
    let effect = '';
    if (d.tune) {
      const t = TUNE_ITEMS.find((x) => x.id === d.id);
      if (t) {
        desc = t.desc[lang];
        effect = t.effect[lang];
        if (t.brand) rows.push([L ? 'Marque' : 'Brand', t.brand]);
        perf(t.perf);
        if (t.bonus?.flat !== undefined) rows.push([L ? 'Gain sur le plat' : 'Flat gain', `+${t.bonus.flat} %`]);
        if (t.bonus?.climb !== undefined) rows.push([L ? 'Gain en côte' : 'Climbing gain', `+${t.bonus.climb} %`]);
        if (t.pieces?.length) rows.push([L ? 'Pièces' : 'Parts', String(t.pieces.length)]);
        if (t.price) rows.push([L ? 'Prix' : 'Price', `${COIN} ${int(t.price)}`]);
      }
    } else {
      const c = COSMETICS.find((x) => x.id === d.id);
      if (c) {
        const bike = c.slot === 'bike' ? bikeById(c.id) : undefined;
        desc = bike ? bike.desc[lang] : '';
        effect = c.effect?.[lang] ?? '';
        if (bike) {
          const brand = BIKE_BRANDS.find((b) => b.id === bike.brand)?.name;
          if (brand) rows.push([L ? 'Marque' : 'Brand', brand]);
          if (bike.year) rows.push([L ? 'Année' : 'Year', String(bike.year)]);
          rows.push([L ? 'Freins' : 'Brakes', bike.params.brakes === 'disc' ? (L ? 'à disque' : 'disc') : bike.params.brakes === 'rim' ? (L ? 'sur jante' : 'rim') : '—']);
        }
        perf(c.physics);
      }
    }
    rows.push([L ? 'Déblocage' : 'Unlock', `${L ? 'niveau' : 'level'} ${r.level}`]);
    const body = rows.map(([k, v]) => `<div class="pg-d-row"><span>${esc(k)}</span><b>${v}</b></div>`).join('');
    return `<div class="pg-modal" data-pgclose><div class="pg-detail ${r.state}" role="dialog" aria-label="${esc(r.name)}" ${r.rar ? `style="--rar:${r.rar}"` : ''}>
      <button class="pg-d-x" data-pgclose aria-label="${L ? 'Fermer' : 'Close'}">×</button>
      <div class="pg-d-thumb">${r.thumb}</div>
      <div class="pg-d-main"><h3>${esc(r.name)}</h3><p class="pg-d-sub">${esc(r.sub)}</p><span class="pg-d-state ${r.state}">${r.stateText}</span>
        ${desc ? `<p class="pg-d-desc">${esc(desc)}</p>` : ''}${effect ? `<p class="pg-d-effect">${esc(effect)}</p>` : ''}
        <div class="pg-d-rows">${body}</div>
        <div class="pg-d-actions"><button class="btn primary" data-pgtry>${d.tune ? (L ? 'Voir à l’atelier' : 'See in the workshop') : L ? 'Essayer au garage' : 'Try in the garage'}</button><button class="btn" data-pgclose>${L ? 'Fermer' : 'Close'}</button></div></div>
    </div></div>`;
  }

  private heroHtml(level: number, xp: number, rewards: Reward[]): string {
    const L = fr();
    const p = loadProgress();
    const max = level >= MAX_LEVEL;
    const cur = xpForLevel(level);
    const next = max ? cur : xpForLevel(level + 1);
    const prog = max ? 1 : (xp - cur) / (next - cur);
    const left = next - xp;
    const R = 46;
    const C = 2 * Math.PI * R;
    const earned = new Set(earnedTrophies());
    const unlocked = rewards.filter((r) => r.state !== 'lock').length;
    const events = p.events.length;
    const today = dayKey();
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const streak = p.streak.last === today || p.streak.last === yesterday ? p.streak.days : 0;
    const tile = (v: string, label: string, icon: string, hint = '') => `<div class="pg-tile" ${hint ? `title="${esc(hint)}"` : ''}><span class="pg-tile-i">${icon}</span><b>${v}</b><small>${label}</small></div>`;
    return `<header class="pg-hero">
      <div class="pg-badge" style="--p:${prog}">
        <svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="${R}" class="pg-ring-bg"/><circle cx="55" cy="55" r="${R}" class="pg-ring" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - prog)).toFixed(1)}"/></svg>
        <span><small>${L ? 'Niveau' : 'Level'}</small><b>${level}</b></span>
      </div>
      <div class="pg-hero-main">
        <h2>${max ? (L ? 'Niveau maximum atteint' : 'Max level reached') : `${L ? 'Niveau' : 'Level'} ${level} <em>→ ${level + 1}</em>`}</h2>
        <div class="pg-xpline"><b>${int(xp)} XP</b>${max ? '' : `<span>${L ? `encore <b>${int(left)} XP</b> pour le niveau ${level + 1}` : `<b>${int(left)} XP</b> to level ${level + 1}`} · ${kmFor(left)} ${L ? 'à plat' : 'on the flat'} · ${timeFor(left)} ${L ? 'de selle' : 'in the saddle'}</span>`}</div>
        <div class="pg-xpbar"><i style="width:${pct(prog)}"></i><span>${int(cur)}</span><span>${max ? '' : int(next)}</span></div>
        <div class="pg-rules"><span>${L ? 'Gagner de l’XP' : 'Earning XP'}</span><em>20 XP / km</em><em>1 XP / m D+</em><em>2 XP / min</em><em>${ICON.trophy} ${L ? 'trophées' : 'trophies'} +100 → +600</em><em class="dim">${L ? 'max' : 'max'} ${int(MAX_XP_PER_RIDE)} XP / ${L ? 'sortie' : 'ride'}</em></div>
      </div>
      <div class="pg-tiles">
        ${tile(`${earned.size}<i>/${TROPHIES.length}</i>`, L ? 'Trophées' : 'Trophies', ICON.trophy)}
        ${tile(`${unlocked}<i>/${rewards.length}</i>`, L ? 'Récompenses débloquées' : 'Rewards unlocked', ICON.star)}
        ${tile(`${events}<i>/10</i>`, L ? 'Défis de l’atelier' : 'Workshop challenges', ICON.gear)}
        ${tile(`${streak}<i> ${L ? 'j' : 'd'}</i>`, L ? 'Série en cours' : 'Current streak', ICON.flame, L ? 'Jours de sortie d’affilée' : 'Riding days in a row')}
        ${tile(`${COIN} ${int(this.host.credits())}`, L ? 'Crédits' : 'Credits', '', L ? 'Gagnés en roulant, dépensés à l’atelier' : 'Earned by riding, spent in the workshop')}
      </div>
    </header>`;
  }

  // ————————————————————————————————————————————— Niveaux

  private levelsHtml(level: number, xp: number, all: Reward[]): string {
    const L = fr();
    const shown = this.cats.size ? all.filter((r) => this.cats.has(r.cat)) : all;
    const byLevel = new Map<number, Reward[]>();
    for (const r of shown) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
    // Ordre dans un niveau : vélos, tenues, puis atelier et ensembles.
    const order = new Map(CATS.map(([c], i) => [c, i]));
    for (const list of byLevel.values()) list.sort((a, b) => (order.get(a.cat) ?? 0) - (order.get(b.cat) ?? 0));

    // Filtres : catégories avec leur avancement.
    const chip = (c: Cat | '', label: string, list: Reward[]) => {
      const on = c ? this.cats.has(c) : !this.cats.size;
      const open = list.filter((r) => r.state !== 'lock').length;
      return `<button class="pg-chip ${on ? 'on' : ''}" data-pgcat="${c}" aria-pressed="${on}">${label}<i>${open}/${list.length}</i></button>`;
    };
    const filters = `<div class="pg-filters">${chip('', L ? 'Tout' : 'All', all)}${CATS.map(([c, f, e]) => chip(c, L ? f : e, all.filter((r) => r.cat === c))).join('')}</div>`;

    // À la une : le prochain niveau et ce qu'il apporte.
    let spot = '';
    if (level < MAX_LEVEL) {
      const nextL = level + 1;
      const list = byLevel.get(nextL) ?? [];
      const left = xpForLevel(nextL) - xp;
      // Prochain palier (niveau rond) et prochain vélo, pour se projeter un peu plus loin.
      const mile = Math.min(MAX_LEVEL, Math.ceil((level + 1) / 10) * 10);
      const mileLeft = xpForLevel(mile) - xp;
      spot = `<article class="pg-spot">
        <div class="pg-spot-h"><small>${L ? 'Prochain niveau' : 'Next level'}</small><h3>${L ? 'Niveau' : 'Level'} ${nextL}</h3>
          <p>${L ? `Encore <b>${int(left)} XP</b>` : `<b>${int(left)} XP</b> to go`} · ${kmFor(left)} · ${timeFor(left)}</p>
          ${mile !== nextL ? `<p class="dim">${L ? `Palier du niveau ${mile} : ${int(mileLeft)} XP (${kmFor(mileLeft)})` : `Level ${mile} milestone: ${int(mileLeft)} XP (${kmFor(mileLeft)})`}</p>` : ''}
        </div>
        <div class="pg-spot-items">${list.length ? list.slice(0, 8).map((r) => this.card(r, true)).join('') + (list.length > 8 ? `<span class="pg-more">+${list.length - 8}</span>` : '') : `<p class="dim">${L ? 'Rien dans ces catégories à ce niveau.' : 'Nothing in these categories at this level.'}</p>`}</div>
      </article>`;
    }

    const rows: string[] = [];
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const list = byLevel.get(l) ?? [];
      if (!list.length && this.cats.size) continue;
      const done = l <= level;
      const curLv = l === level;
      const need = xpForLevel(l);
      const cls = `${done ? 'done' : 'lock'} ${curLv ? 'cur' : ''} ${l === level + 1 ? 'next' : ''} ${MILESTONE(l) ? 'mile' : ''}`;
      const tag = curLv ? `<em class="pg-tag here">${L ? 'Tu es ici' : 'You are here'}</em>` : l === level + 1 ? `<em class="pg-tag">${L ? 'Prochain' : 'Next'}</em>` : MILESTONE(l) ? `<em class="pg-tag mile">${L ? 'Palier' : 'Milestone'}</em>` : '';
      const meta = `<span class="pg-lv-xp">${l === 1 ? (L ? 'Au départ' : 'From the start') : `${int(need)} XP`}</span>${!done ? `<span class="pg-lv-eta">${kmFor(need - xp)}</span>` : ''}<span class="pg-lv-n">${list.length} ${list.length > 1 ? (L ? 'récompenses' : 'rewards') : L ? 'récompense' : 'reward'}</span>`;
      const items = `<div class="pg-items">${list.map((r) => this.card(r)).join('')}</div>`;
      // Niveaux déjà atteints : repliés (une ligne de miniatures), sauf le niveau actuel.
      const minis = `<span class="pg-minis">${list
        .slice(0, 14)
        .map((r) => `<i class="pg-mini" title="${esc(r.name)}">${r.thumb}</i>`)
        .join('')}${list.length > 14 ? `<i class="pg-mini more">+${list.length - 14}</i>` : ''}</span>`;
      const head = `<h4>${L ? 'Niveau' : 'Level'} ${l}</h4>${tag}${meta}`;
      rows.push(
        done && !curLv
          ? `<li class="pg-lv ${cls}" id="pg-lv-${l}"><span class="pg-node"><b>${l}</b></span><details class="pg-lv-main"><summary>${head}${minis}</summary>${items}</details></li>`
          : `<li class="pg-lv ${cls}" id="pg-lv-${l}"><span class="pg-node"><b>${l}</b>${curLv ? `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(1 - (level >= MAX_LEVEL ? 1 : (xp - need) / (xpForLevel(l + 1) - need))).toFixed(3)}"/></svg>` : ''}</span><div class="pg-lv-main"><header>${head}</header>${items}</div></li>`,
      );
    }
    return `<div class="pg-sticky">${filters}</div>${spot}
      <h3 class="pg-sec">${L ? 'Tous les niveaux' : 'Every level'} <small>${L ? 'Clique une récompense pour l’essayer au garage ou à l’atelier.' : 'Click a reward to try it in the garage or workshop.'}</small></h3>
      <ol class="pg-road">${rows.join('')}</ol>`;
  }

  // ————————————————————————————————————————————— Trophées et défis

  private trophiesHtml(level: number, rewards: Reward[]): string {
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const p = loadProgress();
    const earned = new Set(earnedTrophies());
    const tot = rideHistory.summary?.totals;
    const bestKm = (tot?.bestDistanceM ?? 0) / 1000;
    const bestD = tot?.bestElevationM ?? 0;
    const totalKm = trophyTotalKm();
    const n1 = (v: number) => (Math.floor(v * 10) / 10).toLocaleString(L ? 'fr-FR' : 'en-GB');
    const best = L ? 'meilleure sortie' : 'best ride';
    // Avancement mesurable des trophées : [valeur, objectif, texte].
    const prog: Record<string, [number, number, string] | undefined> = {
      'first-ride': [tot?.rides ?? 0, 1, `${tot?.rides ?? 0} / 1 ${L ? 'sortie' : 'ride'}`],
      'ten-km': [bestKm, 10, `${n1(bestKm)} / 10 km · ${best}`],
      'fifty-km': [bestKm, 50, `${n1(bestKm)} / 50 km · ${best}`],
      'hundred-km': [bestKm, 100, `${n1(bestKm)} / 100 km · ${best}`],
      'total-500': [totalKm, 500, `${int(totalKm)} / 500 km ${L ? 'au total' : 'in total'}`],
      'climber-500': [bestD, 500, `${int(bestD)} / 500 m D+ · ${best}`],
      'first-kom': [p.koms, 1, `${p.koms} / 1 ${L ? 'montée' : 'climb'}`],
    };
    const xpWon = TROPHIES.filter((t) => earned.has(t.id)).reduce((a, t) => a + t.xp, 0);
    const xpAll = TROPHIES.reduce((a, t) => a + t.xp, 0);
    const fams = [...new Set(TROPHIES.map((t) => TROPHY_FAMILY[t.id]?.[L ? 0 : 1] ?? ''))];
    const trophies = fams
      .map((fam) => {
        const list = TROPHIES.filter((t) => (TROPHY_FAMILY[t.id]?.[L ? 0 : 1] ?? '') === fam);
        return `<div class="pg-tfam"><h5>${esc(fam)} <i>${list.filter((t) => earned.has(t.id)).length}/${list.length}</i></h5><div class="pg-trophies">${list
          .map((t) => {
            const won = earned.has(t.id);
            const pr = prog[t.id];
            const tr = tier(t.xp);
            return `<article class="pg-trophy ${won ? 'won' : ''} ${tr}">
            ${medal(t.id, t.xp, won)}
            <div><b>${esc(t.name[lang])}</b><p>${esc(t.description[lang])}</p>
              ${won ? `<span class="pg-won">${ICON.check} ${L ? 'Gagné' : 'Earned'}</span>` : pr ? bar(pr[0] / pr[1], esc(pr[2])) : `<small class="pg-bar-t">${L ? 'À débloquer en sortie' : 'Unlocked while riding'}</small>`}
            </div>
            <span class="pg-xp ${tr}" title="${TIER_LABEL[tr][L ? 0 : 1]}">+${t.xp} XP</span></article>`;
          })
          .join('')}</div></div>`;
      })
      .join('');

    // Défis de l'atelier : récompenses uniques (pièces non achetables).
    const today = dayKey();
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const streak = p.streak.last === today || p.streak.last === yesterday ? p.streak.days : 0;
    const routes = p.routesDone.length;
    const evProg: Partial<Record<TuneEvent, [number, number, string]>> = {
      'route-finish': [routes, 1, `${Math.min(routes, 1)} / 1 ${L ? 'parcours' : 'route'}`],
      'routes-10': [routes, 10, `${routes} / 10 ${L ? 'parcours' : 'routes'}`],
      kom: [p.koms, 1, `${Math.min(p.koms, 1)} / 1 ${L ? 'montée' : 'climb'}`],
      'kom-5': [p.koms, 5, `${p.koms} / 5 ${L ? 'montées' : 'climbs'}`],
      'streak-3': [streak, 3, `${streak} / 3 ${L ? 'jours' : 'days'}`],
      'streak-7': [streak, 7, `${streak} / 7 ${L ? 'jours' : 'days'}`],
      'streak-30': [streak, 30, `${streak} / 30 ${L ? 'jours' : 'days'}`],
      century: [bestKm, 100, `${n1(bestKm)} / 100 km · ${best}`],
    };
    const evItems = TUNE_ITEMS.filter((t) => t.family === 'event' && 'event' in t.unlock);
    const challenges = evItems
      .map((t) => {
        const ev = (t.unlock as { event: TuneEvent }).event;
        const won = p.events.includes(ev) || p.owned.includes(t.id);
        const pr = evProg[ev];
        const rar = RARITY_LABEL[t.rarity];
        return `<button class="pg-ch ${won ? 'won' : ''}" data-pgtune="${t.id}" style="--rar:${rar.color}" title="${esc(`${t.desc[lang]} — ${t.effect[lang]}`)}">
          <span class="pg-ch-goal">${ICON.trophy}<b>${esc(TUNE_EVENT_LABEL[ev][lang])}</b></span>
          ${won ? `<span class="pg-won">${ICON.check} ${L ? 'Réussi' : 'Done'}</span>` : pr ? bar(pr[0] / pr[1], esc(pr[2])) : `<small class="pg-bar-t">${L ? 'En course' : 'In a race'}</small>`}
          <span class="pg-ch-rw"><i class="pg-tune" style="background:${tuneSwatch(t)}"></i><span><small>${L ? 'Récompense' : 'Reward'} · <em>${rar[lang]}</em></small><b>${esc(t.name[lang])}</b><small>${t.slot ? TUNE_SLOT_LABEL[t.slot][L ? 0 : 1] : ''} · ${esc(t.effect[lang])}</small></span></span>
        </button>`;
      })
      .join('');

    // Ensembles : avancement des pièces, titre gagné une fois complet.
    const kits = [...TUNE_KITS]
      .sort((a, b) => ('level' in a.unlock ? a.unlock.level : 0) - ('level' in b.unlock ? b.unlock.level : 0))
      .map((k) => {
        const kp = kitProgress(k, p.owned);
        const lvl = 'level' in k.unlock ? k.unlock.level : 1;
        const locked = lvl > level;
        const build = applyTuneLook(bikeOfLook({ ...this.host.look(), tune: [] }), k.pieces ?? []);
        return `<button class="pg-kit ${kp.complete ? 'won' : ''} ${locked ? 'lock' : ''}" data-pgtune="${k.id}" style="--rar:${k.badge ?? RARITY_LABEL[k.rarity].color}">
          <span class="pg-kit-img">${bikeThumb(build, k.id)}</span>
          <b>${esc(k.name[lang])}</b>
          <small>${L ? 'Titre' : 'Title'} « ${esc(k.title?.[lang] ?? '')} »</small>
          ${bar(kp.have / Math.max(1, kp.total), `${kp.have}/${kp.total} ${L ? 'pièces' : 'parts'}${locked ? ` · ${L ? 'niveau' : 'level'} ${lvl}` : ''}`, kp.complete)}
        </button>`;
      })
      .join('');

    // Collection : avancement par catégorie.
    const coll = CATS.map(([c, f, e]) => {
      const list = rewards.filter((r) => r.cat === c);
      const open = list.filter((r) => r.state !== 'lock').length;
      const own = c === 'tune' || c === 'kit' ? list.filter((r) => r.state === 'own' || r.state === 'on').length : null;
      return `<div class="pg-coll"><b>${L ? f : e}</b>${bar(open / Math.max(1, list.length), `${open}/${list.length} ${L ? 'débloqués' : 'unlocked'}${own !== null ? ` · ${own} ${c === 'kit' ? (L ? 'complets' : 'complete') : L ? 'possédées' : 'owned'}` : ''}`)}</div>`;
    }).join('');

    return `<h3 class="pg-sec">${L ? 'Trophées' : 'Trophies'} <i>${earned.size}/${TROPHIES.length}</i><small>${int(xpWon)} / ${int(xpAll)} XP ${L ? 'gagnés' : 'earned'} · ${L ? 'chaque trophée ne se gagne qu’une fois' : 'each trophy is earned once'}</small></h3>
      ${trophies}
      <h3 class="pg-sec">${L ? 'Défis de l’atelier' : 'Workshop challenges'} <i>${evItems.filter((t) => p.events.includes((t.unlock as { event: TuneEvent }).event) || p.owned.includes(t.id)).length}/${evItems.length}</i><small>${L ? 'Pièces exclusives, impossibles à acheter' : 'Exclusive parts that cannot be bought'}</small></h3>
      <div class="pg-chs">${challenges}</div>
      <h3 class="pg-sec">${L ? 'Ensembles' : 'Sets'} <i>${TUNE_KITS.filter((k) => kitProgress(k, p.owned).complete).length}/${TUNE_KITS.length}</i><small>${L ? 'Toutes les pièces d’un ensemble : son titre et son badge' : 'Every part of a set: its title and badge'}</small></h3>
      <div class="pg-kits">${kits}</div>
      <h3 class="pg-sec">${L ? 'Collection' : 'Collection'}</h3>
      <div class="pg-colls">${coll}</div>`;
  }

  // ————————————————————————————————————————————— Actions

  bind(): void {
    const root = this.root;
    const panel = root.querySelector<HTMLElement>('.pg');
    if (!panel) return;
    root.querySelectorAll<HTMLElement>('[data-pgview]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = el.dataset.pgview as ProgressView;
        this.host.rerender();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-pgcat]').forEach((el) =>
      el.addEventListener('click', (e) => {
        const c = el.dataset.pgcat as Cat | '';
        // Clic : cette catégorie seule ; Ctrl / Maj : ajoutée aux autres.
        if (!c) this.cats.clear();
        else if ((e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey) {
          if (this.cats.has(c)) this.cats.delete(c);
          else this.cats.add(c);
        } else if (this.cats.size === 1 && this.cats.has(c)) this.cats.clear();
        else this.cats = new Set([c]);
        this.host.rerender();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-pgitem]').forEach((el) =>
      el.addEventListener('click', () => {
        if (el.dataset.pgitem) {
          this.detail = { id: el.dataset.pgitem, tune: false };
          this.host.rerender();
        }
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-pgtune]').forEach((el) =>
      el.addEventListener('click', () => {
        if (el.dataset.pgtune) {
          this.detail = { id: el.dataset.pgtune, tune: true };
          this.host.rerender();
        }
      }),
    );
    // Fiche ouverte : fermeture (croix, fond, Échap), ou essai au garage / à l'atelier.
    const closeDetail = () => {
      this.detail = null;
      this.host.rerender();
    };
    root.querySelectorAll<HTMLElement>('[data-pgclose]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target === el || el.tagName === 'BUTTON') closeDetail();
      }),
    );
    root.querySelector<HTMLElement>('[data-pgtry]')?.addEventListener('click', () => {
      const d = this.detail;
      this.detail = null;
      if (!d) return;
      if (d.tune) this.host.openTune(d.id);
      else {
        const item = COSMETICS.find((c) => c.id === d.id);
        if (item) this.host.openCosmetic(item);
      }
    });
    if (this.detail) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        document.removeEventListener('keydown', onKey, true);
        closeDetail();
      };
      document.addEventListener('keydown', onKey, true);
    }
    // Première ouverture de la frise : le niveau actuel en vue ; sinon le défilement d'avant.
    if (this.scroll >= 0) panel.scrollTop = this.scroll;
    else if (this.view === 'levels') {
      const cur = panel.querySelector<HTMLElement>('.pg-lv.cur');
      if (cur && this.host.level() > 2) panel.scrollTop = Math.max(0, cur.getBoundingClientRect().top - panel.getBoundingClientRect().top - 150);
    }
    this.shownView = this.view;
  }
}
