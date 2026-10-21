/**
 * Appli compagnon d'Allez Robert ! (PWA, sans framework) : se connecte avec le même compte
 * que le jeu, rejoint la sortie en cours (rôle « companion »), affiche la carte et les
 * coureurs, le chat, et pilote le jeu : vitesses virtuelles, caméra, pause, ventilateur
 * HEADWIND, Ride On. Gros boutons tactiles, téléphone / tablette, portrait ou paysage.
 */
import './style.css';
import type { CameraMode, CompanionStateMsg, RideEventMsg, WelcomeMsg } from '@allezrobert/shared';
import { RideNetClient } from '../../client/src/net/index.ts';
import { detectLang, STRINGS, type Lang } from './i18n.ts';
import { drawMap, RouteGeometry, type MapRider } from './map.ts';

/** Serveur : même origine en production (/api, /colyseus) ; VITE_SERVER_URL en dev. */
const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:2567' : '');
const API = SERVER ? `${SERVER}/api` : `${location.origin}/api`;
const ENDPOINT = SERVER || `${location.origin}/colyseus`;
const CAMERAS: CameraMode[] = ['chase', 'cockpit', 'drone', 'tv', 'photo'];

let lang: Lang = detectLang();
let t = STRINGS[lang];
const app = document.getElementById('app')!;

const state = {
  screen: 'loading' as 'loading' | 'login' | 'waiting' | 'ride',
  providers: { google: false, discord: false, email: false, dev: false },
  me: null as null | { id: string; profile: { displayName: string } },
  net: null as RideNetClient | null,
  welcome: null as WelcomeMsg | null,
  geo: null as RouteGeometry | null,
  game: {} as CompanionStateMsg,
  follow: true,
  chat: [] as Array<{ who: string; text: string; sys?: boolean }>,
  conn: 'connecting' as string,
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function haptic(ms = 12): void {
  navigator.vibrate?.(ms);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`${API}${path}`, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as T) : null };
}

/* ───────────── Écrans ───────────── */

function header(): string {
  const dot = state.conn === 'connected' ? 'ok' : state.conn === 'reconnecting' ? 'warn' : 'off';
  const label = state.conn === 'connected' ? t.connected : state.conn === 'reconnecting' ? t.reconnecting : state.screen === 'ride' ? t.disconnected : '';
  return `<header class="bar">
    <div class="brand">Allez Robert ! <span>${esc(t.title)}</span></div>
    <div class="status">${state.screen === 'ride' ? `<i class="dot ${dot}"></i>${esc(label)}` : ''}</div>
    <button class="lang" data-act="lang">${lang === 'fr' ? 'EN' : 'FR'}</button>
  </header>`;
}

function renderLogin(): void {
  const p = state.providers;
  const redirect = encodeURIComponent(location.pathname);
  app.innerHTML = `${header()}<main class="center">
    <h1>${esc(t.loginTitle)}</h1>
    ${p.google ? `<a class="btn big" href="${API}/auth/google/start?redirect=${redirect}">${esc(t.google)}</a>` : ''}
    ${p.discord ? `<a class="btn big discord" href="${API}/auth/discord/start?redirect=${redirect}">${esc(t.discord)}</a>` : ''}
    ${p.email ? `<form class="row" data-form="magic"><input type="email" name="email" required placeholder="${esc(t.emailPlaceholder)}" autocomplete="email"/><button class="btn">${esc(t.emailSend)}</button></form><p class="hint" id="magic-msg"></p>` : ''}
    ${p.dev ? `<form class="row" data-form="dev"><input name="name" required placeholder="${esc(t.devName)}"/><button class="btn">${esc(t.devLogin)}</button></form>` : ''}
  </main>`;
}

function renderWaiting(msg = t.waiting): void {
  app.innerHTML = `${header()}<main class="center"><div class="spinner"></div><p>${esc(msg)}</p>
    <button class="btn ghost" data-act="logout">${esc(t.logout)}</button></main>`;
}

function renderRide(): void {
  const cams = CAMERAS.map((c) => `<button class="seg ${state.game.camera === c ? 'on' : ''}" data-cam="${c}">${esc(t.cameras[c])}</button>`).join('');
  app.innerHTML = `${header()}<main class="ride">
    <section class="map-wrap">
      <canvas id="map"></canvas>
      <button class="chip" data-act="follow">${state.follow ? '⤢' : '◎'}</button>
      <div class="countdown" id="countdown"></div>
    </section>
    <section class="stats" id="stats"></section>
    <section class="controls">
      <div class="gears">
        <button class="btn huge" data-cmd="shift-down">${esc(t.shiftDown)}</button>
        <div class="gear-label" id="gear">–</div>
        <button class="btn huge" data-cmd="shift-up">${esc(t.shiftUp)}</button>
      </div>
      <div class="row2">
        <button class="btn big" data-cmd="pause" id="pause">${esc(state.game.paused ? t.resume : t.pause)}</button>
        <button class="btn big rideon" data-act="rideon-mode">${esc(t.rideOn)}</button>
      </div>
      <div class="cams" role="group" aria-label="${esc(t.camera)}">${cams}</div>
      <label class="fan">${esc(t.fan)} <output id="fan-val">${state.game.fanPercent ?? 0} %</output>
        <input type="range" min="0" max="100" step="5" value="${state.game.fanPercent ?? 0}" id="fan"/></label>
    </section>
    <section class="riders"><h2>${esc(t.riders)}</h2><ul id="riders"></ul><p class="hint" id="rideon-hint"></p></section>
    <section class="chat"><h2>${esc(t.chat)}</h2><ul id="chat"></ul>
      <form class="row" data-form="chat"><input name="text" maxlength="280" autocomplete="off" placeholder="${esc(t.chatPlaceholder)}"/><button class="btn">${esc(t.send)}</button></form>
    </section>
  </main>`;
  renderChat();
  renderGame();
}

function renderChat(): void {
  const ul = document.getElementById('chat');
  if (!ul) return;
  ul.innerHTML = state.chat
    .slice(-40)
    .map((m) => `<li class="${m.sys ? 'sys' : ''}">${m.sys ? '' : `<b>${esc(m.who)}</b> `}${esc(m.text)}</li>`)
    .join('');
  ul.scrollTop = ul.scrollHeight;
}

function renderGame(): void {
  const g = state.game;
  const gear = document.getElementById('gear');
  if (gear) gear.textContent = g.gearLabel ?? (g.gear !== undefined ? String(g.gear + 1) : '–');
  const pause = document.getElementById('pause');
  if (pause) pause.textContent = g.paused ? t.resume : t.pause;
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === g.camera));
  if (g.fanPercent !== undefined) {
    const fan = document.getElementById('fan') as HTMLInputElement | null;
    if (fan && document.activeElement !== fan) fan.value = String(g.fanPercent);
    const out = document.getElementById('fan-val');
    if (out) out.textContent = `${g.fanPercent} %`;
  }
}

function render(): void {
  if (state.screen === 'login') renderLogin();
  else if (state.screen === 'waiting') renderWaiting();
  else if (state.screen === 'ride') renderRide();
  else app.innerHTML = `${header()}<main class="center"><div class="spinner"></div></main>`;
}

/* ───────────── Boucle d'affichage ───────────── */

let rideOnMode = false;
let lastList = 0;

function frame(): void {
  requestAnimationFrame(frame);
  const net = state.net;
  if (state.screen !== 'ride' || !net || !state.geo) return;
  const canvas = document.getElementById('map') as HTMLCanvasElement | null;
  const riders: MapRider[] = net.getAllInterpolated().map((r) => ({ ...r, self: r.id === net.selfId }));
  if (canvas) drawMap(canvas, state.geo, riders, { follow: state.follow });

  const cd = document.getElementById('countdown');
  if (cd) {
    const startsAt = net.welcome?.startsAt;
    const left = startsAt ? Math.ceil((startsAt - net.serverNow()) / 1000) : 0;
    cd.textContent = net.welcome?.phase === 'countdown' && left > 0 ? `${t.countdown} ${left}` : '';
  }

  const now = performance.now();
  if (now - lastList < 250) return;
  lastList = now;
  const me = riders.find((r) => r.self);
  const stats = document.getElementById('stats');
  if (stats) {
    const cell = (k: string, v: string, u = '') => `<div><span>${esc(k)}</span><b>${esc(v)}</b><small>${u}</small></div>`;
    stats.innerHTML = me
      ? cell(t.speed, (me.speedMs * 3.6).toFixed(1), 'km/h') +
        cell(t.power, String(Math.round(me.watts)), 'W') +
        cell(t.cadence, String(Math.round(me.cadence)), 'tr/min') +
        (me.hr !== undefined ? cell(t.hr, String(me.hr), 'bpm') : '') +
        cell(t.draft, String(Math.round(me.draftPct)), '%') +
        cell(t.distance, (me.unwrappedM / 1000).toFixed(2), 'km') +
        (state.geo.route.loop ? cell(t.lap, String(Math.max(me.lap, 0) + 1)) : '')
      : `<p class="hint">${esc(t.noGame)}</p>`;
  }
  const ul = document.getElementById('riders');
  if (ul) {
    const sorted = [...riders].sort((a, b) => b.unwrappedM - a.unwrappedM);
    const ref = me?.unwrappedM ?? 0;
    ul.innerHTML = sorted
      .map((r) => {
        const gap = r.unwrappedM - ref;
        const tag = r.self ? t.you : r.isAI ? t.ai : r.isGuest ? t.guest : '';
        return `<li data-rider="${esc(r.id)}" class="${r.self ? 'self' : ''} ${rideOnMode && !r.self ? 'pick' : ''}">
          <i style="background:${esc(r.avatar.jersey)}"></i><span class="n">${esc(r.name)}</span>${tag ? `<em>${esc(tag)}</em>` : ''}
          <span class="g">${r.self ? '' : `${gap >= 0 ? '+' : ''}${Math.round(gap)} m`}</span><span class="w">${Math.round(r.watts)} W</span></li>`;
      })
      .join('');
  }
}

/* ───────────── Réseau ───────────── */

async function joinRide(): Promise<void> {
  const net = new RideNetClient({ endpoint: ENDPOINT, apiBase: API });
  try {
    const w = await net.joinCurrent();
    state.net = net;
    attach(net, w);
  } catch (e) {
    await net.leave().catch(() => undefined);
    const msg = (e as Error).message;
    if (msg.includes('Connexion requise')) {
      state.screen = 'login';
      render();
      return;
    }
    state.screen = 'waiting';
    render();
    setTimeout(() => void joinRide(), 5000);
  }
}

function nameOf(id: string): string {
  return state.net?.roster.get(id)?.name ?? '?';
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function attach(net: RideNetClient, w: WelcomeMsg): void {
  state.welcome = w;
  state.geo = new RouteGeometry(w.route);
  state.screen = 'ride';
  state.conn = 'connected';
  render();
  net.on('welcome', (nw) => {
    state.welcome = nw;
    if (nw.route.id !== state.geo?.route.id) state.geo = new RouteGeometry(nw.route);
  });
  net.on('connection', (c) => {
    state.conn = c.state;
    const bar = document.querySelector('.bar');
    if (bar) bar.outerHTML = header();
    if (c.state === 'disconnected' && c.code !== 4000) {
      state.net = null;
      state.screen = 'waiting';
      render();
      setTimeout(() => void joinRide(), 3000);
    }
  });
  net.on('companionState', (s) => {
    state.game = { ...state.game, ...s };
    renderGame();
  });
  net.on('event', (ev: RideEventMsg) => {
    const push = (m: { who: string; text: string; sys?: boolean }) => {
      state.chat.push(m);
      renderChat();
    };
    if (ev.kind === 'chat') push({ who: nameOf(ev.riderId), text: ev.text });
    else if (ev.kind === 'rideOn') push({ who: '', text: `👍 ${t.rideOnFrom(nameOf(ev.from), nameOf(ev.to))}`, sys: true });
    else if (ev.kind === 'join') push({ who: '', text: t.joined(ev.name), sys: true });
    else if (ev.kind === 'leave') push({ who: '', text: t.left(nameOf(ev.riderId)), sys: true });
    else if (ev.kind === 'segmentEnd' && ev.riderId === net.selfId) {
      const seg = state.geo?.route.segments.find((s) => s.id === ev.segmentId);
      push({ who: '', text: `🏁 ${t.segment(nameOf(ev.riderId), seg?.name ?? ev.segmentId, fmtMs(ev.timeMs), ev.rank)}`, sys: true });
    } else if (ev.kind === 'error' && ev.code === 'no_game') push({ who: '', text: t.noGame, sys: true });
  });
}

/* ───────────── Interactions ───────────── */

let fanTimer: ReturnType<typeof setTimeout> | undefined;

app.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-cmd],[data-cam],[data-rider]');
  if (!el) return;
  const net = state.net;
  if (el.dataset.act === 'lang') {
    lang = lang === 'fr' ? 'en' : 'fr';
    localStorage.setItem('ar-lang', lang);
    t = STRINGS[lang];
    document.documentElement.lang = lang;
    render();
    return;
  }
  if (el.dataset.act === 'logout') {
    await api('/auth/logout', { method: 'POST' });
    state.screen = 'login';
    render();
    return;
  }
  if (el.dataset.act === 'follow') {
    state.follow = !state.follow;
    el.textContent = state.follow ? '⤢' : '◎';
    return;
  }
  if (el.dataset.act === 'rideon-mode') {
    rideOnMode = !rideOnMode;
    const hint = document.getElementById('rideon-hint');
    if (hint) hint.textContent = rideOnMode ? t.rideOnPick : '';
    haptic();
    return;
  }
  if (!net) return;
  haptic();
  if (el.dataset.cmd === 'shift-up') net.sendCompanionCommand({ kind: 'shift', action: 'up' });
  else if (el.dataset.cmd === 'shift-down') net.sendCompanionCommand({ kind: 'shift', action: 'down' });
  else if (el.dataset.cmd === 'pause') {
    const paused = !state.game.paused;
    net.sendCompanionCommand({ kind: paused ? 'pause' : 'resume' });
    state.game.paused = paused;
    renderGame();
  } else if (el.dataset.cam) {
    const camera = el.dataset.cam as CameraMode;
    net.sendCompanionCommand({ kind: 'camera', camera });
    state.game.camera = camera;
    renderGame();
  } else if (el.dataset.rider && rideOnMode && el.dataset.rider !== net.selfId) {
    net.sendCompanionCommand({ kind: 'rideOn', to: el.dataset.rider });
    rideOnMode = false;
    const hint = document.getElementById('rideon-hint');
    if (hint) hint.textContent = '';
    haptic(40);
  }
});

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id !== 'fan') return;
  const percent = Number(el.value);
  const out = document.getElementById('fan-val');
  if (out) out.textContent = `${percent} %`;
  clearTimeout(fanTimer);
  fanTimer = setTimeout(() => {
    state.net?.sendCompanionCommand({ kind: 'fan', percent });
    state.game.fanPercent = percent;
  }, 150);
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  if (form.dataset.form === 'chat') {
    const text = String(data.get('text') ?? '').trim();
    if (text && state.net) state.net.sendCompanionCommand({ kind: 'chat', text });
    form.reset();
  } else if (form.dataset.form === 'magic') {
    const r = await api('/auth/magic', { method: 'POST', body: JSON.stringify({ email: data.get('email'), redirect: location.pathname, locale: lang }) });
    const msg = document.getElementById('magic-msg');
    if (msg) msg.textContent = r.status === 204 ? t.emailSent : `Erreur ${r.status}`;
  } else if (form.dataset.form === 'dev') {
    const r = await api('/auth/dev', { method: 'POST', body: JSON.stringify({ name: data.get('name') }) });
    if (r.status === 200) void boot();
  }
});

/* ───────────── Démarrage ───────────── */

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && document.visibilityState === 'visible') wakeLock = await nav.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) void keepAwake();
});

async function boot(): Promise<void> {
  document.documentElement.lang = lang;
  state.screen = 'loading';
  render();
  const providers = await api<typeof state.providers>('/auth/providers').catch(() => null);
  if (providers?.body) state.providers = providers.body;
  const me = await api<{ id: string; profile: { displayName: string } }>('/me').catch(() => null);
  if (!me || me.status !== 200 || !me.body) {
    state.screen = 'login';
    render();
    return;
  }
  state.me = me.body;
  state.screen = 'waiting';
  render();
  void keepAwake();
  await joinRide();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js', { scope: './' }));
}
requestAnimationFrame(frame);
void boot();
