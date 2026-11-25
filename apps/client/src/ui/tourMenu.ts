import './blocks.css';
import './tourMenu.css';
import type { RouteData } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import { currentStage, standings, tourDone, tourLeaders, type Tour } from '../game/stageRace.ts';
import type { TourOptions, TourStage } from '../game/tourPlan.ts';

/**
 * Menu du tour à étapes (onglet Rouler, course, format « Tour à étapes ») : réglages d'un nouveau tour et ses étapes,
 * ou tour en cours (étapes courues, étape du jour, place au général). Rend du HTML ; ui/menu.ts branche les commandes.
 */

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);

export interface TourMenuModel {
  /** Nom du tour de la zone. */
  name: string;
  /** Tour sauvegardé de la zone, s'il y en a un. */
  tour: Tour | null;
  /** Étapes d'un nouveau tour avec ces réglages ; `null` : tracé en cours de chargement. */
  plan: TourStage[] | null;
  /** Tracé d'une étape (profil, carte), s'il est chargé. */
  routeOf(id: string): RouteData | undefined;
  /** Longueur de la grande boucle de la zone (0 : aucune). */
  loopM: number;
  /** Étapes de ville en ville possibles dans la zone. */
  cities: boolean;
  options: TourOptions;
  /** Vélo équipé : route ; sinon une ligne le rappelle. */
  roadBike: boolean;
  /** « Abandonner » cliqué une fois : confirmation demandée. */
  abandonAsk: boolean;
  /** Commandes du menu (mêmes aspects qu'ailleurs). */
  seg(id: string, current: string, opts: Array<[string, string]>): string;
  stepper(id: string, min: number, max: number, value: number): string;
  aiLevelSeg(): string;
  riders: number;
}

export const TOUR_RIDERS_MIN = 3;
export const TOUR_RIDERS_MAX = 40;

const km = (m: number): string => (m / 1000).toFixed(1).replace('.', getLang() === 'fr' ? ',' : '.');

/** Tour entamé : au moins une étape courue, et pas fini. */
export const tourOngoing = (t: Tour | null): t is Tour => !!t && t.results.length > 0 && !tourDone(t);

/** Texte du bouton de départ. */
export function tourGoLabel(t: Tour | null): string {
  const fr = getLang() === 'fr';
  return tourOngoing(t) ? `${fr ? 'Étape' : 'Stage'} ${currentStage(t) + 1}` : fr ? 'Étape 1' : 'Stage 1';
}

function kindLabel(st: TourStage, i: number): string {
  const fr = getLang() === 'fr';
  if (st.kind === 'road') return fr ? 'En ligne' : 'Road stage';
  return i === 0 && st.lengthM < 12_000 ? (fr ? 'Prologue' : 'Prologue') : fr ? 'Contre-la-montre' : 'Time trial';
}

const stageClass = (st: TourStage, i: number, done: number): string => `${st.kind}${i % 2 ? ' odd' : ''}${i < done ? ' done' : i === done ? ' now' : ''}`;

/** Tracés de toutes les étapes, ou null s'il en manque un. */
function stageRoutes(m: TourMenuModel, stages: readonly TourStage[]): RouteData[] | null {
  const out: RouteData[] = [];
  for (const st of stages) {
    const r = m.routeOf(st.routeId);
    if (!r || r.points.length < 2) return null;
    out.push(r);
  }
  return out;
}

/** Profil du tour, étapes bout à bout : une teinte par étape et un trait à chaque arrivée. */
function profile(stages: readonly TourStage[], routes: readonly RouteData[], done: number): string {
  const W = 600;
  const H = 74;
  const total = routes.reduce((a, r) => a + r.lengthM, 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of routes)
    for (const p of r.points) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  hi = Math.max(hi, lo + 60);
  let acc = 0;
  const parts = routes.map((r, i) => {
    const X = (d: number) => (((acc + d) / total) * W).toFixed(1);
    const step = Math.max(1, Math.floor(r.points.length / 90));
    const line = r.points.filter((_, k) => k % step === 0 || k === r.points.length - 1).map((p) => `L${X(p.d)} ${(H - 6 - ((p.y - lo) / (hi - lo)) * (H - 14)).toFixed(1)}`);
    const out = `<path class="${stageClass(stages[i] as TourStage, i, done)}" d="M${X(0)} ${H} ${line.join(' ')} L${X(r.lengthM)} ${H} Z"/>${i ? `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${H}"/>` : ''}`;
    acc += r.lengthM;
    return out;
  });
  return `<svg class="tm-profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Carte du tour : le tracé de chaque étape, son numéro au milieu, départs et arrivées. */
function tourMap(stages: readonly TourStage[], routes: readonly RouteData[], done: number): string {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const r of routes)
    for (const p of r.points) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
  const W = 600;
  const H = 260;
  const k = Math.min((W - 60) / Math.max(1, x1 - x0), (H - 50) / Math.max(1, z1 - z0));
  const at = (p: { x: number; z: number }) => `${(W / 2 + (p.x - (x0 + x1) / 2) * k).toFixed(1)} ${(H / 2 + (p.z - (z0 + z1) / 2) * k).toFixed(1)}`;
  const lines = routes.map((r, i) => {
    const step = Math.max(1, Math.floor(r.points.length / 160));
    const pts = r.points.filter((_, j) => j % step === 0 || j === r.points.length - 1);
    return `<path class="${stageClass(stages[i] as TourStage, i, done)}" d="M${pts.map(at).join(' L')}"/>`;
  });
  const ends = routes.flatMap((r) => [r.points[0], r.points.at(-1)]).map((p) => `<g transform="translate(${at(p as { x: number; z: number })})"><circle class="end" r="3.5"/></g>`);
  const nums = routes.map((r, i) => `<g class="${stageClass(stages[i] as TourStage, i, done)}" transform="translate(${at(r.points[r.points.length >> 1] as { x: number; z: number })})"><circle r="11"/><text dy="4.5">${i + 1}</text></g>`);
  return `<svg class="tm-map" viewBox="0 0 ${W} ${H}" aria-hidden="true">${lines.join('')}${ends.join('')}${nums.join('')}</svg>`;
}

/** Carte et profil du tour (rien tant que les tracés ne sont pas là). */
function tourPicture(m: TourMenuModel, stages: readonly TourStage[], done: number): string {
  const routes = stageRoutes(m, stages);
  return routes ? tourMap(stages, routes, done) + profile(stages, routes, done) : '';
}

function stageList(stages: readonly TourStage[], tour: Tour | null): string {
  const fr = getLang() === 'fr';
  const done = tour ? tour.results.length : 0;
  const rows = stages.map((st, i) => {
    const res = tour?.results[i];
    const rank = res ? res.order.indexOf('me') + 1 : 0;
    const winner = res ? (tour?.riders.find((r) => r.id === res.order[0])?.name ?? '') : '';
    const what = `${kindLabel(st, i)} · ${km(st.lengthM)} km · ${st.gainM} m D+${st.laps > 1 ? ` · ${st.laps} ${fr ? 'tours' : 'laps'}` : ''}`;
    const state = res ? (rank === 1 ? (fr ? '1er, victoire' : '1st, win') : fr ? `${rank}e · vainqueur ${winner}` : `${rank} · won by ${winner}`) : tour && i === done ? (fr ? 'À courir' : 'Next') : '';
    return `<li class="${res ? 'done' : tour && i === done ? 'now' : ''}${st.kind === 'tt' ? ' tt' : ''}"><i>${res ? '✓' : i + 1}</i><div><b>${esc(fr ? st.name : st.nameEn)}</b><small>${esc(what)}</small></div>${state ? `<em>${esc(state)}</em>` : ''}</li>`;
  });
  return `<ol class="tm-stages">${rows.join('')}</ol>`;
}

const totals = (stages: readonly TourStage[]): string => `${km(stages.reduce((a, s) => a + s.lengthM, 0))} km · ${Math.round(stages.reduce((a, s) => a + s.gainM, 0))} m D+`;

/** Tour en cours : étape du jour, place au général, étapes courues, classements, abandon. */
function ongoingHtml(m: TourMenuModel, t: Tour): string {
  const fr = getLang() === 'fr';
  const k = currentStage(t);
  const st = standings(t);
  const myRank = st.gc.findIndex((r) => r.me) + 1;
  const gap = Math.round((st.gc[myRank - 1]?.value ?? 0) - (st.gc[0]?.value ?? 0));
  const mine = tourLeaders(t).me;
  const jersey = mine ? { gc: fr ? 'maillot jaune' : 'yellow jersey', points: fr ? 'maillot vert' : 'green jersey', kom: fr ? 'maillot à pois' : 'polka-dot jersey' }[mine] : '';
  const overall = myRank === 1 ? (fr ? 'Tu mènes le général' : 'You lead overall') : fr ? `Tu es ${myRank}e du général, à ${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')} de ${st.gc[0]?.name ?? ''}` : `You are ${myRank} overall, ${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')} behind ${st.gc[0]?.name ?? ''}`;
  return `<div class="mm-card tm">
    <h3 class="mm-card-t tm-t">${esc(t.name)}</h3>
    <p class="mm-card-d">${fr ? `Étape ${k + 1} sur ${t.stages.length}` : `Stage ${k + 1} of ${t.stages.length}`} · ${totals(t.stages)} · ${t.aiCount} ${fr ? 'coureurs IA' : 'AI riders'}</p>
    <p class="tm-rank">${esc(overall)}${jersey ? ` · ${esc(jersey)}` : ''}</p>
    ${tourPicture(m, t.stages, k)}
    ${stageList(t.stages, t)}
    ${
      m.abandonAsk
        ? `<div class="tm-ask"><b>${fr ? 'Abandonner ce tour ? Les étapes courues sont perdues.' : 'Abandon this race? Ridden stages are lost.'}</b><div class="tm-btns"><button type="button" class="ab-btn" id="m-tourkeep">${fr ? 'Continuer le tour' : 'Keep racing'}</button><button type="button" class="ab-btn tm-danger" id="m-tourabandon">${fr ? 'Abandonner' : 'Abandon'}</button></div></div>`
        : `<div class="tm-btns"><button type="button" class="ab-btn" id="m-tourstandings">${fr ? 'Classements' : 'Standings'}</button><button type="button" class="ab-btn" id="m-tourask">${fr ? 'Abandonner le tour' : 'Abandon the race'}</button></div>`
    }
  </div>`;
}

/** Nouveau tour : réglages et étapes qui en découlent. */
function newHtml(m: TourMenuModel): string {
  const fr = getLang() === 'fr';
  const o = m.options;
  const loop = m.loopM > 0 && o.track === 'loop';
  // Zone sans assez de villes : ses parcours, boucles répétées comprises.
  const fixed = !loop && !m.cities;
  const opt = (title: string, hint: string, control: string, col = true) => `<div class="mm-opt${col ? ' mm-opt-col' : ''}"><div class="mm-opt-l"><b>${title}</b><small>${hint}</small></div>${control}</div>`;
  const last = m.tour && tourDone(m.tour) ? m.tour : null;
  const lastRank = last ? standings(last).gc.findIndex((r) => r.me) + 1 : 0;
  const plan = m.plan;
  return `<div class="mm-card tm">
    <h3 class="mm-card-t tm-t">${esc(m.name)}</h3>
    <p class="mm-card-d">${plan?.length ? `${plan.length} ${fr ? 'étapes' : 'stages'} · ${totals(plan)}` : fr ? 'Une étape quand tu veux, le tour est gardé.' : 'One stage whenever you like, the race is saved.'}</p>
    ${last ? `<p class="tm-rank">${fr ? `Dernier tour : ${lastRank === 1 ? 'victoire' : `${lastRank}e`} au général` : `Last race: ${lastRank === 1 ? 'overall win' : `${lastRank} overall`}`} <button type="button" class="mm-link" id="m-tourstandings">${fr ? 'Classements' : 'Standings'}</button></p>` : ''}
    ${
      m.loopM > 0
        ? opt(
            fr ? 'Tracé' : 'Course',
            loop
              ? fr
                ? 'La grande boucle découpée, chaque étape repart de l’arrivée de la veille.'
                : 'The big loop cut up, each stage starts where the last one finished.'
              : fr
                ? 'Des étapes d’une ville à l’autre, jamais de boucle, avec une étape de montagne.'
                : 'Stages from town to town, never a loop, with a mountain stage.',
            m.seg('m-tourtrack', loop ? 'loop' : 'cities', [
              ['cities', fr ? 'Ville à ville' : 'Town to town'],
              ['loop', fr ? 'Boucle complète' : 'Full loop'],
            ]),
          )
        : ''
    }
    ${opt(fr ? 'Nombre d’étapes' : 'Number of stages', loop ? (fr ? `${km(m.loopM)} km à partager.` : `${km(m.loopM)} km to share out.`) : fr ? 'De 2 à 7.' : 'From 2 to 7.', m.stepper('m-tourstages', 2, 7, o.stages), false)}
    ${
      loop
        ? ''
        : opt(
            fr ? 'Longueur des étapes' : 'Stage length',
            fixed ? (fr ? 'Les boucles sont répétées pour l’atteindre.' : 'Loops are repeated to reach it.') : fr ? 'Au plus près, selon les villes et la taille de la zone.' : 'As close as towns and the area allow.',
            m.seg('m-tourlength', o.length, [
              ['short', fr ? 'Courte 12 km' : 'Short 12 km'],
              ['medium', fr ? 'Moyenne 22 km' : 'Medium 22 km'],
              ['long', fr ? 'Longue 40 km' : 'Long 40 km'],
            ]),
          )
    }
    ${opt(
      fr ? 'Contre-la-montre' : 'Time trials',
      fr ? 'Départs toutes les 30 s, tu pars en dernier, sans aspiration.' : 'Starts every 30 s, you go last, no drafting.',
      m.seg('m-tourtt', o.tt, [
        ['none', fr ? 'Aucun' : 'None'],
        ['prologue', 'Prologue'],
        ['two', fr ? 'Prologue et chrono' : 'Prologue and TT'],
      ]),
    )}
    ${opt(fr ? 'Coureurs IA' : 'AI riders', fr ? 'Quatre équipes, les mêmes coureurs jusqu’au bout.' : 'Four teams, the same riders to the end.', m.stepper('m-tourriders', TOUR_RIDERS_MIN, TOUR_RIDERS_MAX, m.riders), false)}
    ${opt(fr ? 'Niveau des IA' : 'AI level', fr ? 'Leur puissance, en part de ta FTP.' : 'Their power, as a share of your FTP.', m.aiLevelSeg())}
    ${
      plan === null
        ? `<p class="tm-wait">${fr ? 'Étapes en préparation…' : 'Preparing the stages…'}</p>`
        : plan.length
          ? `<div class="tm-plan"><div class="tm-plan-h"><h4>${fr ? 'Les étapes' : 'Stages'}</h4>${loop || fixed ? '' : `<button type="button" class="ab-btn ab-chip" id="m-tourseed">${fr ? 'Autre tracé' : 'Another course'}</button>`}</div>${tourPicture(m, plan, -1)}${stageList(plan, null)}</div>`
          : `<p class="tm-wait">${fr ? 'Aucun parcours de route dans cette zone.' : 'No road route in this area.'}</p>`
    }
    ${m.roadBike ? '' : `<p class="tm-wait">${fr ? 'Le tour se court sur route : prends un vélo de route au garage.' : 'The race is on roads: pick a road bike in the garage.'}</p>`}
  </div>`;
}

export function tourMenuHtml(m: TourMenuModel): string {
  return tourOngoing(m.tour) ? ongoingHtml(m, m.tour) : newHtml(m);
}
