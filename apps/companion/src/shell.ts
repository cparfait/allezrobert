/**
 * Coquille : barre du haut (route, micro, réglages), bandeau de trois chiffres (sur toutes les pages sauf le compteur, on ne
 * quitte jamais sa puissance des yeux), page, barre du bas. Tout est rafraîchi sur place à chaque état reçu.
 */
import { gradeColor, type PairState } from '@allezrobert/shared';
import { climbBarHtml, climbLeft, moveClimbMark } from './climb.ts';
import { $, esc, numHtml, setHtml, setNum, setText } from './dom.ts';
import { fmtDist, fmtTime, nf, zoneOf } from './format.ts';
import { icon, type IconId } from './icons.ts';
import { updateJunction } from './junction.ts';
import { bandKind, tabsFor, targetTone, TONE_COLORS, type Tab } from './logic.ts';
import { actionsHtml, actionsKey, updateActions } from './pages/actions.ts';
import { dashHtml, dashKey, updateDash } from './pages/dash.ts';
import { groupHtml, groupKey, updateGroup } from './pages/group.ts';
import { mapHtml, mapKey, updateMap } from './pages/mapPage.ts';
import { musicHtml, updateMusic } from './pages/music.ts';
import { renderPanel, updatePanel } from './panels.ts';
import { curTab, inRide, isStale, lang, S, t, type Metrics } from './state.ts';
import type { PhoneMic } from './phoneMic.ts';

const app = document.getElementById('app')!;
const TAB_ICONS: Record<Tab, IconId> = { dash: 'gauge', map: 'map', act: 'grid', grp: 'group', music: 'music' };

let mic: PhoneMic | null = null;
export function useMic(m: PhoneMic): void {
  mic = m;
}

/** Reconstruit tout (démarrage, langue, appairage). */
export function render(): void {
  document.documentElement.lang = lang;
  if (!S.pair) {
    app.innerHTML = `<main class="scan">
      ${robertWait()}
      <h1>${esc(t.scanTitle)}</h1>
      <p>${esc(t.scanText)}</p>
      <form data-form="pair"><input name="link" placeholder="${esc(t.scanPaste)}" autocomplete="off"/><button class="btn go">${esc(t.scanGo)}</button></form>
      <button class="btn ghost" data-act="lang">${lang === 'fr' ? 'English' : 'Français'}</button>
    </main>`;
    return;
  }
  app.innerHTML = `<div class="shell" id="shell">
    <header class="top"><i class="dot" id="t-dot"></i><div class="where"><b id="t-where"></b><span id="t-sub"></span></div><button class="ico mic" id="t-mic" data-act="mic" aria-label="${esc(t.micTitle)}" hidden></button><button class="ico" data-panel="settings" aria-label="${esc(t.settings)}">${icon('gear')}</button></header>
    <section class="band" id="band" hidden><div class="band-nums">${numHtml('tint')}${numHtml('tint')}${numHtml('tint')}</div><div id="band-climb"></div></section>
    <main class="page" id="page"></main>
    <nav class="dock" id="dock"></nav>
    <div class="scene" id="scene" hidden></div>
    <div class="junction" id="junction" hidden></div>
    <div class="toast" id="toast" data-act="toast"></div>
    <div class="panel" id="panel" hidden></div>
  </div>`;
  renderPanel();
  refresh();
}

/** Met l'écran à jour ; la page n'est reconstruite que si sa composition change. */
export function refresh(): void {
  if (!$('shell')) return;
  const tab = curTab();
  const ride = inRide();
  updateTop();
  updateBand(tab, ride);
  updateDock(tab);
  updatePage(tab, ride);
  updateScene(tab);
  updateJunction();
  if (S.panel) updatePanel();
}

function updateTop(): void {
  const st = S.st;
  const stale = isStale();
  const ride = inRide();
  $('t-dot')!.className = `dot ${stale ? (S.conn === 'connected' ? 'warn' : 'off') : 'ok'}`;
  $('shell')!.classList.toggle('stale', stale && ride);
  $('shell')!.dataset.tab = curTab();
  const dest = ride ? st?.destination : null;
  setText($('t-where'), ride ? (st?.road || st?.routeName || 'Allez Robert !') : 'Allez Robert !');
  // Deuxième ligne : seulement ce qui sert (liaison perdue, destination), rien d'autre à lire en roulant.
  setText($('t-sub'), stale && ride ? (S.conn === 'connected' ? t.lostGame : t.lost) : dest ? `${dest.name} · ${fmtDist(dest.remainingM, 1)}` : '');
  updateMic();
}

/** Micro : visible quand la sortie a une voix (ou que le téléphone y est relié), avec l'état du micro. */
export function updateMic(): void {
  const b = $('t-mic');
  if (!b || !mic) return;
  const show = mic.linked || mic.state === 'connecting' || (!!S.st?.voice?.available && S.st.phase !== 'menu');
  b.hidden = !show;
  if (!show) return;
  const label = mic.state === 'on' ? t.micOn : mic.state === 'connecting' ? t.micWait : mic.state === 'muted' ? t.micOff : t.mic;
  setHtml(b, `${icon(mic.state === 'muted' ? 'micOff' : 'mic')}<small>${esc(label)}</small>`);
  b.className = `ico mic ${mic.state}`;
}

/** Trois chiffres toujours visibles : puissance, puis ce qui compte en ce moment (séance, montée, ou vitesse et cœur). */
function updateBand(tab: Tab, ride: boolean): void {
  const el = $('band');
  if (!el) return;
  const st = S.st;
  const m = st?.metrics;
  el.hidden = !ride || tab === 'dash' || !m;
  if (el.hidden || !st || !m) return;
  const [a, b, c] = Array.from(el.firstElementChild!.children);
  const l = climbLeft();
  const kind = bandKind(st, !!l);
  const z = zoneOf(m.watts3s, m.ftp);
  if (kind === 'workout') {
    const w = st.workout!;
    const tone = targetTone(m.watts3s, w.targetWatts!);
    setNum(a!, t.power, nf(m.watts3s), 'W', TONE_COLORS[tone]);
    setNum(b!, t.target, nf(w.targetWatts!), 'W');
    setNum(c!, t.toGo, fmtTime(w.stepRemainingS), '');
  } else if (kind === 'climb' && l) {
    setNum(a!, t.power, nf(m.watts3s), 'W', z.color);
    const [v, u] = fmtDist(l.on ? l.leftM : l.inM, 1).split(' ');
    setNum(b!, `${l.on ? t.climbLeft : t.climbSoon} ${u}`, (l.on ? l.ge : '') + v!, u!);
    setNum(c!, `${t.fields.grade} %`, nf(m.gradePercent, 1), '%', gradeColor(m.gradePercent));
  } else {
    setNum(a!, t.power, nf(m.watts3s), 'W', z.color);
    setNum(b!, t.fields.speed, nf(m.speedKmh, 1), 'km/h');
    if (m.hr !== undefined) setNum(c!, t.heart, nf(m.hr), 'bpm');
    else setNum(c!, t.fields.cadence, nf(m.cadence), lang === 'fr' ? 'tr/min' : 'rpm');
  }
  const bar = $('band-climb');
  setHtml(bar, kind === 'climb' && S.climb ? climbBarHtml(S.climb.climb) : '');
  if (l) moveClimbMark(bar, l.k, l.on);
}

function updateDock(tab: Tab): void {
  const nav = $('dock');
  const tabs = tabsFor(S.st);
  const ride = !!S.st && S.st.phase !== 'menu';
  setHtml(nav, tabs.map((k) => `<button data-tab="${k}">${icon(k === 'dash' && !ride ? 'home' : TAB_ICONS[k])}<span>${esc(k === 'dash' && !ride ? t.home : t.tabs[k])}</span><i class="badge"></i></button>`).join(''));
  nav?.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
    setText(b.querySelector('.badge'), b.dataset.tab === 'grp' && S.unread ? String(S.unread) : '');
  });
}

let pageKey = '';

function updatePage(tab: Tab, ride: boolean): void {
  const c = $('page');
  if (!c) return;
  const st = S.st;
  const m = st?.metrics;
  const kind = tab === 'music' ? 'music' : ride && st && m ? tab : 'wait';
  const own = kind === 'dash' ? dashKey() : kind === 'map' ? mapKey(st!) : kind === 'act' ? actionsKey(st!) : kind === 'grp' ? groupKey(st!) : kind === 'wait' ? waitKey() : '';
  const key = `${kind}|${lang}|${own}`;
  if (key !== pageKey || !c.firstElementChild) {
    pageKey = key;
    c.dataset.page = kind;
    c.innerHTML = kind === 'music' ? musicHtml() : kind === 'dash' ? dashHtml() : kind === 'map' ? mapHtml(st!) : kind === 'act' ? actionsHtml(st!) : kind === 'grp' ? groupHtml(st!) : waitHtml();
    c.scrollTop = 0;
  }
  updateKind(kind, st, m);
}

function updateKind(kind: string, st: PairState | null, m: Metrics | undefined): void {
  if (kind === 'music') return updateMusic();
  if (!st || !m) return;
  if (kind === 'dash') updateDash(st, m);
  else if (kind === 'map') updateMap(st, m);
  else if (kind === 'act') updateActions(st, m);
  else if (kind === 'grp') updateGroup(st);
}

/** Une seule grosse action jaune en bas : donner le départ (partout), ou reprendre quand la sortie est en pause (compteur, carte). */
function updateScene(tab: Tab): void {
  const el = $('scene');
  if (!el) return;
  const st = S.st;
  const start = inRide() && st?.awaitingStart;
  const paused = inRide() && st?.phase === 'paused' && (tab === 'dash' || tab === 'map');
  el.hidden = !start && !paused;
  setHtml(
    el,
    start
      ? `<button class="btn go" data-cmd="start-race">${icon('flag')}${esc(start === 'tt' ? t.startTt : t.startRace)}</button>`
      : paused
        ? `<span>${esc(t.paused)}</span><button class="btn go" data-cmd="pause">${icon('play')}${esc(t.resume)}</button>`
        : '',
  );
}

/* ───────────── Attente ───────────── */

/** Robert qui pédale (calques de l'illustration du jeu, animés en CSS), pour les écrans d'attente. */
function robertWait(): string {
  const l = (name: string, cls = '') => `<img src="${import.meta.env.BASE_URL}robert-velo/${name}.webp" alt=""${cls ? ` class="${cls}"` : ''}>`;
  return `<div class="rb" aria-hidden="true"><div class="rb-bike">${l('base')}${l('leg', 'rb-leg')}<div class="rb-upper">${l('upper')}${l('arm', 'rb-arm')}</div></div></div>`;
}

const gameUp = (): boolean => S.conn === 'connected' && S.presence.game && !!S.st;
const waitKey = (): string => `${S.conn}${gameUp()}`;

function waitHtml(): string {
  const state = S.conn === 'connected' ? 'ok' : S.conn === 'down' ? 'bad' : 'warn';
  const word = S.conn === 'connected' ? t.linkOk : S.conn === 'down' ? t.linkDown : t.linkWait;
  const [title, text] = S.conn !== 'connected' ? [t.waitConnTitle, S.conn === 'down' ? t.serverDown : t.connecting] : gameUp() ? [t.waitMenuTitle, t.menu] : [t.waitGameTitle, t.waitingGame];
  return `<section class="wait">${robertWait()}<h1>${esc(title)}</h1><p>${esc(text)}</p><span class="pill ${state}"><i></i>${esc(word)}</span></section>`;
}
