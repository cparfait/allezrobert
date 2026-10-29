/**
 * Appli compagnon d'Allez Robert ! (PWA, sans framework), appairée au jeu par QR code : pas
 * de compte, marche en solo comme en groupe (salle « pair », voir
 * packages/shared/src/companion.ts).
 *
 * Onglets : Compteur (champs façon compteur GPS, au choix, et profil des 3 km à venir),
 * Pilotage (vitesses, pause, caméra, photo, HUD, demi-tour, ventilateur, équipiers),
 * Musique, Chat (messages rapides, Ride On), Carte. Le choix aux carrefours (monde ouvert)
 * s'affiche par-dessus tous les onglets, avec vibration. À l'approche d'une montée, page façon
 * ClimbPro (Garmin Edge) à la place du compteur et de la carte : tronçons colorés par pente,
 * restant à grimper ; bandeau réduit sur les autres onglets. Plein écran, portrait ou paysage.
 */
import './style.css';
import { Client, type Room } from '@colyseus/sdk';
import { rideOnMessage, climbAhead, climbElevation, gradeColor, PAIR_MSG, PAIR_ROOM, PAIR_TOKEN_RE, type CameraMode, type Climb, type ClimbAhead, type PairEvent, type PairMusicItem, type PairPresence, type PairRoute, type PairState, type PhoneCommand } from '@allezrobert/shared';
import { detectLang, STRINGS, type Lang } from './i18n.ts';
import { climbsOf } from './climbs.ts';
import { drawClimb, drawMap, drawProfile, RouteGeo } from './map.ts';

type Tab = 'dash' | 'ctrl' | 'music' | 'chat' | 'map';
type FieldId = keyof (typeof STRINGS)['fr']['fields'];
type Metrics = NonNullable<PairState['metrics']>;

const CAMERAS: CameraMode[] = ['chase', 'cockpit', 'action', 'gopro', 'drone', 'tv', 'photo'];
const DEFAULT_FIELDS: FieldId[] = ['power3s', 'speed', 'cadence', 'hr', 'time', 'distance', 'grade'];
const ALL_FIELDS = Object.keys(STRINGS.fr.fields) as FieldId[];

/* ───────────── Appairage : ?pair=…(&server=…), mémorisé pour l'écran d'accueil ───────────── */

const params = new URLSearchParams(location.search);
{
  const pair = params.get('pair');
  if (pair && PAIR_TOKEN_RE.test(pair)) {
    localStorage.setItem('ar-pair', pair);
    const server = params.get('server');
    if (server && /^https?:\/\/[^\s]+$/.test(server)) localStorage.setItem('ar-pair-server', server);
    else localStorage.removeItem('ar-pair-server');
    // Le jeton ne reste pas dans la barre d'adresse (captures d'écran, partage).
    history.replaceState(null, '', location.pathname);
  }
}

function serverEndpoint(): string {
  return (
    localStorage.getItem('ar-pair-server') ??
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    (import.meta.env.DEV ? `http://${location.hostname}:2567` : `${location.origin}/colyseus`)
  );
}

let lang: Lang = detectLang();
let t = STRINGS[lang];
const app = document.getElementById('app')!;

const S = {
  pair: localStorage.getItem('ar-pair'),
  conn: 'connecting' as 'connecting' | 'connected' | 'down',
  presence: { game: false, phones: 0 } as PairPresence,
  st: null as PairState | null,
  geo: null as RouteGeo | null,
  tab: (localStorage.getItem('ar-cmp-tab') as Tab | null) ?? 'dash',
  follow: true,
  chat: [] as Array<{ who: string; text: string; sys?: boolean }>,
  unread: 0,
  fields: loadFields(),
  /** Champ en cours de choix (indice), null hors du sélecteur. */
  picking: null as number | null,
  orient: 'any' as 'any' | 'landscape' | 'portrait',
  /** Montées de la route reçue, montée en cours ou à moins de `CLIMB_APPROACH_M` du pied. */
  climbs: [] as Climb[],
  climb: null as ClimbAhead | null,
  /** Page de la montée fermée par le coureur (jusqu'au sommet). */
  climbHidden: false,
  /** Le coureur remonte la route à l'envers (demi-tour) : pas de montées. */
  backwards: false,
  /** Dernière recherche Spotify : texte, état et résultats reçus du jeu. */
  music: { query: '', state: 'idle' as 'idle' | 'loading' | 'done' | 'error', items: [] as PairMusicItem[], error: '' },
};
/** La page de la montée s'ouvre 500 m avant le pied. */
const CLIMB_APPROACH_M = 500;
let room: Room | null = null;

function loadFields(): FieldId[] {
  try {
    const f = JSON.parse(localStorage.getItem('ar-cmp-fields') ?? 'null') as FieldId[] | null;
    if (Array.isArray(f) && f.length === DEFAULT_FIELDS.length && f.every((x) => ALL_FIELDS.includes(x))) return f;
  } catch {
    /* champs par défaut */
  }
  return [...DEFAULT_FIELDS];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function haptic(p: number | number[] = 12): void {
  navigator.vibrate?.(p);
}

function send(cmd: PhoneCommand): void {
  room?.send(PAIR_MSG.cmd, cmd);
}

const nf = (v: number, d = 0) => v.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d });

function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Zone de puissance (Coggan, 7 zones) : numéro et couleur. */
function zoneOf(watts: number, ftp: number): { n: number; color: string } {
  const r = watts / Math.max(ftp, 1);
  const zones: Array<[number, string]> = [
    [0.55, '#7d8796'],
    [0.75, '#3b82f6'],
    [0.9, '#22c55e'],
    [1.05, '#eab308'],
    [1.2, '#f97316'],
    [1.5, '#ef4444'],
    [Infinity, '#a855f7'],
  ];
  const i = zones.findIndex(([max]) => r < max);
  return { n: i + 1, color: zones[i]![1] };
}

/** Valeur, unité et couleur éventuelle d'un champ du compteur. */
function field(id: FieldId, m: Metrics): { v: string; u: string; color?: string } {
  switch (id) {
    case 'power3s':
      return { v: nf(m.watts3s), u: 'W', color: zoneOf(m.watts3s, m.ftp).color };
    case 'power':
      return { v: nf(m.watts), u: 'W', color: zoneOf(m.watts, m.ftp).color };
    case 'avgPower':
      return { v: nf(m.avgWatts), u: 'W' };
    case 'np':
      return { v: nf(m.np), u: 'W' };
    case 'wkg':
      return { v: nf(m.wkg, 1), u: 'W/kg' };
    case 'ftpPct':
      return { v: nf((m.watts3s / Math.max(m.ftp, 1)) * 100), u: '%', color: zoneOf(m.watts3s, m.ftp).color };
    case 'zone': {
      const z = zoneOf(m.watts3s, m.ftp);
      return { v: `Z${z.n}`, u: '', color: z.color };
    }
    case 'speed':
      return { v: nf(m.speedKmh, 1), u: 'km/h' };
    case 'cadence':
      return { v: nf(m.cadence), u: 'tr/min' };
    case 'hr':
      return { v: m.hr !== undefined ? nf(m.hr) : '–', u: 'bpm' };
    case 'distance':
      return { v: nf(m.distM / 1000, 2), u: 'km' };
    case 'time':
      return { v: fmtTime(m.elapsedS), u: '' };
    case 'grade':
      return { v: nf(m.gradePercent, 1), u: '%', ...(m.gradePercent > 8 ? { color: '#ef4444' } : m.gradePercent > 4 ? { color: '#f97316' } : {}) };
    case 'elevGain':
      return { v: nf(m.elevationGainM), u: 'm' };
    case 'altitude':
      return { v: nf(m.altitudeM), u: 'm' };
    case 'lap':
      return { v: String(m.lap), u: '' };
    case 'gear':
      return { v: m.gearLabel || String(m.gearIndex + 1), u: `${m.gearIndex + 1}/${m.gearCount}` };
    case 'draft':
      return { v: nf(m.draftPct), u: '%' };
    case 'kcal':
      return { v: nf(m.kcal), u: 'kcal' };
    case 'balance':
      return { v: m.balanceLeft !== undefined ? `${nf(m.balanceLeft)}/${nf(100 - m.balanceLeft)}` : '–', u: '%' };
  }
}

/* ───────────── Connexion ───────────── */

let retry: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  if (!S.pair || room) return;
  clearTimeout(retry);
  S.conn = 'connecting';
  renderBar();
  void new Client(serverEndpoint())
    .joinOrCreate(PAIR_ROOM, { pair: S.pair, role: 'phone' })
    .then((r) => {
      room = r;
      S.conn = 'connected';
      r.onMessage(PAIR_MSG.presence, (p: PairPresence) => {
        const was = S.presence.game;
        S.presence = p;
        if (!p.game) {
          S.st = null;
          if (was) render();
        }
        renderBar();
      });
      r.onMessage(PAIR_MSG.state, (st: PairState) => onState(st));
      r.onMessage(PAIR_MSG.route, (route: PairRoute) => {
        S.geo = new RouteGeo(route);
        S.climbs = climbsOf(S.geo);
        refresh();
      });
      r.onMessage(PAIR_MSG.event, (ev: PairEvent) => onEvent(ev));
      r.onLeave(() => {
        room = null;
        S.presence = { game: false, phones: 0 };
        S.conn = 'down';
        renderBar();
        retry = setTimeout(connect, 2000);
      });
      renderBar();
    })
    .catch(() => {
      S.conn = 'down';
      renderBar();
      retry = setTimeout(connect, 4000);
    });
}

let junctionKey = '';
let junctionLocked = false;

function onState(st: PairState): void {
  const prevPhase = S.st?.phase;
  S.st = st;
  // Carrefour qui approche : vibration à l'apparition, petite secousse quand le choix se fige.
  const j = st.junction;
  const key = j ? j.choices.map((c) => c.name + c.dir).join('|') : '';
  if (j && key !== junctionKey) haptic([70, 50, 70]);
  if (j?.locked && !junctionLocked) haptic(30);
  junctionKey = key;
  junctionLocked = !!j?.locked;
  if (prevPhase !== st.phase && (prevPhase === 'menu' || st.phase === 'menu')) render();
  else refresh();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3500);
}

function onEvent(ev: PairEvent): void {
  if (ev.kind === 'musicResults') {
    S.music = { query: ev.query, state: ev.error ? 'error' : 'done', items: ev.items, error: ev.error ?? '' };
    if (S.tab === 'music') renderMusicResults();
    return;
  }
  if (ev.kind === 'chat') {
    S.chat.push({ who: ev.who, text: ev.text });
    haptic(20);
  } else if (ev.kind === 'toast' || ev.kind === 'rideOn') {
    const text = ev.kind === 'toast' ? ev.text : rideOnMessage(ev.from, lang);
    S.chat.push({ who: '', text, sys: true });
    showToast(text);
  }
  if (S.chat.length > 80) S.chat.splice(0, S.chat.length - 80);
  if (S.tab !== 'chat' && ev.kind === 'chat') S.unread++;
  if (S.tab === 'chat') renderChatLog();
  else renderTabs();
}

/* ───────────── Rendu ───────────── */

function render(): void {
  document.documentElement.lang = lang;
  if (!S.pair) {
    app.innerHTML = `<main class="scan">
      <div class="logo">🚴</div>
      <h1>${esc(t.scanTitle)}</h1>
      <p>${esc(t.scanText)}</p>
      <form data-form="pair"><input name="link" placeholder="${esc(t.scanPaste)}" autocomplete="off"/><button class="btn">${esc(t.scanGo)}</button></form>
      <button class="lang" data-act="lang">${lang === 'fr' ? 'English' : 'Français'}</button>
    </main>`;
    return;
  }
  app.innerHTML = `<div class="shell">
    <header class="bar" id="bar"></header>
    <div id="junction"></div>
    <div id="climbmini"></div>
    <div class="toast" id="toast"></div>
    <main class="content" id="content"></main>
    <nav class="tabs" id="tabs"></nav>
    <div id="sheet"></div>
  </div>`;
  renderBar();
  renderTabs();
  renderContent();
}

function renderBar(): void {
  const bar = document.getElementById('bar');
  if (!bar) return;
  const ok = S.conn === 'connected' && S.presence.game;
  const label = S.conn === 'down' ? t.serverDown : S.conn === 'connecting' ? t.connecting : S.presence.game ? t.connected : t.offline;
  const fs = !!document.fullscreenElement;
  bar.innerHTML = `<i class="dot ${ok ? 'ok' : S.conn === 'connected' ? 'warn' : 'off'}"></i>
    <div class="where"><b>${esc(S.st?.road || S.st?.routeName || 'Allez Robert !')}</b><span>${esc(label)}</span></div>
    ${fs && 'orientation' in screen && 'lock' in (screen.orientation as object) ? `<button class="ico" data-act="rotate" title="${esc(t.rotate)}">⟳<small>${esc(t.orient[S.orient])}</small></button>` : ''}
    <button class="ico" data-act="fullscreen" title="${esc(t.fullscreen)}">${fs ? '🗗' : '⛶'}</button>
    <button class="ico" data-act="lang">${lang === 'fr' ? 'EN' : 'FR'}</button>`;
}

function renderTabs(): void {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const icons: Record<Tab, string> = { dash: '⏱', ctrl: '🎛', music: '♪', chat: '💬', map: '🗺' };
  nav.innerHTML = (Object.keys(icons) as Tab[])
    .map((k) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}"><i>${icons[k]}</i><span>${esc(t.tabs[k])}</span>${k === 'chat' && S.unread ? `<b class="badge">${S.unread}</b>` : ''}</button>`)
    .join('');
}

function waitingHtml(): string {
  if (S.conn !== 'connected') return `<div class="empty"><div class="spinner"></div><p>${esc(S.conn === 'down' ? t.serverDown : t.connecting)}</p></div>`;
  if (!S.presence.game || !S.st) return `<div class="empty"><div class="spinner"></div><p>${esc(t.waitingGame)}</p><button class="btn ghost small" data-act="unpair">${esc(t.unpair)}</button></div>`;
  return `<div class="empty"><div class="logo">🚴</div><p>${esc(t.menu)}</p></div>`;
}

/** Squelette de l'onglet courant (les valeurs sont remplies par `refresh`). */
function renderContent(): void {
  const c = document.getElementById('content');
  if (!c) return;
  c.dataset.tab = S.tab;
  const inRide = !!S.st && S.st.phase !== 'menu';
  if (S.tab === 'music') c.innerHTML = musicHtml();
  else if (S.tab === 'chat') {
    S.unread = 0;
    c.innerHTML = chatHtml();
    renderChatLog();
  } else if (!inRide) c.innerHTML = waitingHtml();
  else if (climbPageWanted()) {
    c.dataset.tab = 'climb';
    c.innerHTML = climbPageHtml();
  } else if (S.tab === 'dash') c.innerHTML = `<section class="dash" id="dash"></section><section class="extra" id="extra"></section><section class="extra" id="climbstrip"></section><section class="climb"><span>${esc(t.climb)}</span><canvas id="profile"></canvas></section>`;
  else if (S.tab === 'ctrl') c.innerHTML = ctrlHtml();
  else if (S.tab === 'map')
    c.innerHTML = `<section class="mapbox"><canvas id="map"></canvas><button class="chip" data-act="follow">${esc(S.follow ? t.whole : t.follow)}</button></section><section class="mapprof"><canvas id="mapprofile"></canvas></section>`;
  refresh();
}

/** Mise à jour des valeurs, à chaque état reçu (~4 Hz). */
function refresh(): void {
  renderBarLite();
  renderJunction();
  if (updateClimb()) return;
  const st = S.st;
  if (S.tab === 'music') return updateMusic();
  if (S.tab === 'chat') return updateChatControls();
  if (!st || st.phase === 'menu' || !st.metrics) return;
  const m = st.metrics;
  if (document.getElementById('cp')) updateClimbPage(m);
  else if (S.tab === 'dash') {
    const dash = document.getElementById('dash');
    if (!dash) return renderContent();
    // Champs construits une fois, valeurs mises à jour sur place (un bouton remplacé sous le doigt perdrait le toucher).
    if (dash.childElementCount !== S.fields.length)
      dash.innerHTML = S.fields.map((_, i) => `<button class="fld ${i === 0 ? 'big' : ''}" data-field="${i}"><span class="lbl"></span><b class="val"></b><small></small></button>`).join('');
    S.fields.forEach((id, i) => {
      const el = dash.children[i] as HTMLElement;
      const f = field(id, m);
      (el.children[0] as HTMLElement).textContent = t.fields[id];
      (el.children[1] as HTMLElement).textContent = f.v;
      (el.children[2] as HTMLElement).textContent = f.u;
      if (f.color) el.style.setProperty('--zc', f.color);
      else el.style.removeProperty('--zc');
    });
    const extra = document.getElementById('extra');
    if (extra) extra.innerHTML = extraHtml(st);
    const strip = document.getElementById('climbstrip');
    if (strip) {
      // Reconstruit seulement quand le texte change (le bouton reste sous le doigt).
      const html = climbStripHtml(m);
      if (strip.dataset.h !== html) {
        strip.innerHTML = html;
        strip.dataset.h = html;
      }
    }
    const prof = document.getElementById('profile') as HTMLCanvasElement | null;
    if (prof && S.geo) {
      const from = m.routeM - 300;
      drawProfile(prof, S.geo, m.routeM, S.geo.route.loop ? from : Math.max(from, S.geo.startD), S.geo.route.loop ? from + 3300 : Math.min(from + 3300, Math.max(S.geo.endD, m.routeM + 100)));
    }
  } else if (S.tab === 'ctrl') updateCtrl(st);
  else if (S.tab === 'map' && S.geo) {
    const canvas = document.getElementById('map') as HTMLCanvasElement | null;
    if (canvas) drawMap(canvas, S.geo, { routeM: m.routeM, ...(st.pos ? { pos: st.pos } : {}), riders: st.riders ?? [], follow: S.follow });
    const prof = document.getElementById('mapprofile') as HTMLCanvasElement | null;
    if (prof) drawProfile(prof, S.geo, m.routeM, S.geo.startD, S.geo.route.loop ? S.geo.route.lengthM : S.geo.endD);
  }
}

/** Nom de la route dans la barre, sans tout reconstruire. */
function renderBarLite(): void {
  const b = document.querySelector('#bar .where b');
  if (b) b.textContent = S.st?.road || S.st?.routeName || 'Allez Robert !';
}

function extraHtml(st: PairState): string {
  let h = '';
  const m = st.metrics!;
  if (st.workout) {
    const w = st.workout;
    h += `<div class="strip wk"><b>${esc(t.workout)}</b><span>${w.targetWatts !== null ? `${nf(w.targetWatts)} W ${esc(t.target)}` : esc(w.name)}</span><span>${fmtTime(w.stepRemainingS)} ${esc(t.stepLeft)}</span>${w.next ? `<span class="mut">${esc(t.next)} ${esc(w.next)}</span>` : ''}</div>`;
  }
  if (st.segment) {
    const s = st.segment;
    h += `<div class="strip seg ${esc(s.kind)}"><b>${s.kind === 'kom' ? '⛰' : s.kind === 'sprint' ? '⚡' : '🏁'} ${esc(s.name)}</b><span>${fmtTime(s.elapsedS)}</span><i class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></i></div>`;
  }
  // Barre des rapports.
  h += `<div class="gears" aria-label="${esc(t.gear)}">${Array.from({ length: m.gearCount }, (_, i) => `<i class="${i === m.gearIndex ? 'on' : i < m.gearIndex ? 'lo' : ''}"></i>`).join('')}</div>`;
  return h;
}

function renderJunction(): void {
  const el = document.getElementById('junction');
  if (!el) return;
  const j = S.st?.phase === 'ride' ? S.st.junction : null;
  if (!j || j.inM > 450) {
    if (el.innerHTML) el.innerHTML = '';
    el.dataset.key = '';
    return;
  }
  const arrow = { left: '↰', straight: '↑', right: '↱', back: '↶' } as const;
  const dist = `${t.inM(Math.max(0, Math.round(j.inM / 10) * 10))}${j.locked ? ` · ${t.locked}` : ''}`;
  // Reconstruit seulement quand le choix change ; la distance est mise à jour sur place.
  const key = `${lang}|${j.selected}|${j.locked}|${j.choices.map((c) => c.name + c.dir).join('|')}`;
  if (el.dataset.key === key) {
    const span = el.querySelector('.jn-head span');
    if (span) span.textContent = dist;
    return;
  }
  el.dataset.key = key;
  el.innerHTML = `<div class="jn ${j.locked ? 'locked' : ''}">
    <div class="jn-head"><b>${esc(t.junction)}</b><span>${esc(dist)}</span></div>
    <div class="jn-choices">${j.choices
      .map((c, i) => {
        const dir = (c.dir in arrow ? c.dir : 'straight') as keyof typeof arrow;
        return `<button class="${i === j.selected ? 'on' : ''}" data-turn="${i}" ${j.locked ? 'disabled' : ''}><i>${arrow[dir]}</i><b>${esc(t.dirs[dir])}</b><span>${esc(c.name)}${c.unpaved ? ` · 🌾 ${esc(t.unpaved)}` : ''}</span></button>`;
      })
      .join('')}</div>
  </div>`;
}

/* ───────────── Montées (façon ClimbPro) ───────────── */

/** Distance lisible : « 350 m », « 2,35 km ». */
function fmtDist(m: number, d = 2): string {
  m = Math.max(0, m);
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${nf(m / 1000, d)} km`;
}

/** Page de la montée affichée à la place du compteur ou de la carte ? */
function climbPageWanted(): boolean {
  return !!S.climb && !S.climbHidden && (S.tab === 'dash' || S.tab === 'map') && !!S.st && S.st.phase !== 'menu';
}

/** Barre des tronçons colorés, avec la position du coureur. */
function climbBarHtml(c: Climb, pos: number | null): string {
  return `<i class="cbar">${c.segments.map((s) => `<i style="flex:${s.to - s.from};background:${gradeColor(s.grade)}"></i>`).join('')}${
    pos !== null ? `<b style="left:${Math.min(100, (Math.max(pos, 0) / c.lengthM) * 100).toFixed(1)}%"></b>` : ''
  }</i>`;
}

/** Résumé d'une montée : « 3,2 km · 6,4 % moy. · max 9,1 % · +205 m ». */
function climbSummary(c: Climb): string {
  const ge = c.openEnd ? '≥ ' : '';
  return `${ge}${nf(c.lengthM / 1000, 1)} km · ${nf(c.avgGrade, 1)} % ${t.climbAvg} · ${t.climbMax} ${nf(c.maxGrade, 1)} % · ${ge}+${nf(c.gainM)} m`;
}

/** Sommet de la montée suivie (m sur la route), départ du chrono au pied. */
let climbEnd: number | null = null;
let climbT0: { elapsedS: number; elev: number } | null = null;
let lastRouteM: number | null = null;

/**
 * Montée en cours ou proche : vibration à l'approche, bilan au sommet, page affichée ou retirée,
 * bandeau des autres onglets. Renvoie vrai si le contenu a été reconstruit (déjà rafraîchi).
 */
function updateClimb(): boolean {
  const st = S.st;
  const m = st && st.phase !== 'menu' ? st.metrics : undefined;
  if (m && lastRouteM !== null) {
    // Sens de marche, d'après l'évolution de la position (les sauts de tour de boucle sont ignorés).
    const dm = m.routeM - lastRouteM;
    if (dm < -1 && dm > -500) S.backwards = true;
    else if (dm > 1 && dm < 500) S.backwards = false;
  }
  lastRouteM = m ? m.routeM : null;
  const a = m && S.geo && !S.backwards ? climbAhead(S.climbs, m.routeM, { loop: S.geo.route.loop, lengthM: S.geo.route.lengthM }) : null;
  S.climb = a && a.pos >= -CLIMB_APPROACH_M ? a : null;
  const start = S.climb && m ? m.routeM - S.climb.pos : null;
  // Changement de montée (ou plus de montée) : la précédente a-t-elle été gravie ?
  if (climbEnd !== null && (start === null || start > climbEnd - 1)) {
    if (m && m.routeM >= climbEnd - 30 && climbT0) {
      const dt = m.elapsedS - climbT0.elapsedS;
      const gain = Math.max(0, m.altitudeM - climbT0.elev);
      const vam = dt > 0 ? Math.round((gain * 3600) / dt) : 0;
      haptic([40, 30, 40, 30, 160]);
      showToast(`⛰ ${t.climbSummit} ${fmtTime(dt)} · +${nf(gain)} m · VAM ${nf(vam)} m/h`);
    }
    S.climbHidden = false;
    climbT0 = null;
  }
  if (start !== null && (climbEnd === null || start > climbEnd - 1)) haptic([60, 40, 60, 40, 60]);
  if (S.climb && m && S.climb.pos >= 0 && !climbT0) climbT0 = { elapsedS: m.elapsedS, elev: m.altitudeM };
  climbEnd = start !== null ? start + S.climb!.climb.lengthM : null;
  renderClimbMini();
  const c = document.getElementById('content');
  if (c && m && (c.dataset.tab === 'climb') !== climbPageWanted()) {
    renderContent();
    return true;
  }
  return false;
}

function climbPageHtml(): string {
  const f = (id: string, lbl: string) => `<div class="fld" id="${id}"><span class="lbl">${esc(lbl)}</span><b class="val">–</b><small></small></div>`;
  return `<section class="cp" id="cp">
    <header class="cp-head"><b id="cp-title"></b><span id="cp-status"></span><button class="ico" data-act="climb-close" aria-label="${esc(t.climbClose)}">✕</button></header>
    <div class="cp-fields">${f('cp-left', t.climbLeft)}${f('cp-gain', t.climbGainLeft)}${f('cp-grade', t.fields.grade)}${f('cp-power', t.fields.power3s)}</div>
    <div class="cp-prof"><canvas id="cp-canvas"></canvas></div>
    <div class="cp-foot"><div class="seg-now" id="cp-seg"></div><div class="mut" id="cp-sum"></div></div>
  </section>`;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function setField(id: string, v: string, u: string, color?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  (el.children[1] as HTMLElement).textContent = v;
  (el.children[2] as HTMLElement).textContent = u;
  if (color) el.style.setProperty('--zc', color);
  else el.style.removeProperty('--zc');
}

function updateClimbPage(m: Metrics): void {
  const a = S.climb;
  if (!a) return;
  const c = a.climb;
  const p = Math.min(Math.max(a.pos, 0), c.lengthM);
  const leftM = c.lengthM - p;
  const gainLeft = Math.max(0, c.topM - climbElevation(c, p));
  const ge = c.openEnd ? '≥ ' : '';
  setText('cp-title', `⛰ ${t.climbOf(a.index + 1, S.geo?.route.open ? 1 : S.climbs.length)}`);
  setText('cp-status', a.pos < 0 ? t.climbIn(fmtDist(-a.pos)) : `${t.climbOn} · ${Math.round((p / c.lengthM) * 100)} %`);
  const [lv, lu] = fmtDist(leftM).split(' ');
  setField('cp-left', ge + lv!, lu!);
  setField('cp-gain', ge + nf(gainLeft), 'm');
  setField('cp-grade', nf(m.gradePercent, 1), '%', gradeColor(m.gradePercent));
  setField('cp-power', nf(m.watts3s), 'W', zoneOf(m.watts3s, m.ftp).color);
  // Tronçon en cours : pente, distance jusqu'au suivant ; pente moyenne de ce qui reste.
  const seg = c.segments.find((s) => p < s.to) ?? c.segments[c.segments.length - 1]!;
  const segHtml = `<i style="background:${gradeColor(seg.grade)}"></i><span>${esc(t.climbSeg)} ${nf(seg.grade, 1)} % · ${esc(fmtDist(seg.to - p))}</span>${
    leftM > 50 ? `<span class="mut">${nf((gainLeft / leftM) * 100, 1)} % ${esc(t.climbAvgLeft)}</span>` : ''
  }`;
  const segEl = document.getElementById('cp-seg');
  if (segEl && segEl.dataset.h !== segHtml) {
    segEl.innerHTML = segHtml;
    segEl.dataset.h = segHtml;
  }
  setText('cp-sum', `${climbSummary(c)} · ${t.climbTop} ${nf(c.topM)} m`);
  const canvas = document.getElementById('cp-canvas') as HTMLCanvasElement | null;
  if (canvas) drawClimb(canvas, c, a.pos, nf);
}

/** Bandeau du compteur : montée suivante, ou montée en cours dont la page a été fermée. */
function climbStripHtml(m: Metrics): string {
  if (S.climb) {
    const c = S.climb.climb;
    return S.climbHidden
      ? `<button class="strip climb-s" data-act="climb-show"><b>⛰ ${esc(t.climbNow)}</b><span>${esc(climbSummary(c))}</span><span class="mut">${esc(t.climbShow)} ›</span>${climbBarHtml(c, null)}</button>`
      : '';
  }
  if (!S.geo || S.backwards) return '';
  const a = climbAhead(S.climbs, m.routeM, { loop: S.geo.route.loop, lengthM: S.geo.route.lengthM });
  if (!a) return '';
  const c = a.climb;
  return `<div class="strip climb-s"><b>⛰ ${esc(t.climbNext)}</b><span>${esc(t.climbIn(fmtDist(-a.pos, 1)))}</span><span class="mut">${esc(climbSummary(c))}</span>${climbBarHtml(c, null)}</div>`;
}

/** Bandeau réduit de la montée sur les onglets sans la page (pilotage, musique, chat). */
function renderClimbMini(): void {
  const el = document.getElementById('climbmini');
  if (!el) return;
  const a = S.climb;
  const show = !!a && S.tab !== 'dash' && S.tab !== 'map';
  document.getElementById('content')?.classList.toggle('pad-climb', show);
  if (!show || !a) {
    if (el.innerHTML) el.innerHTML = '';
    el.dataset.key = '';
    return;
  }
  const c = a.climb;
  const p = Math.min(Math.max(a.pos, 0), c.lengthM);
  const gainLeft = Math.max(0, c.topM - climbElevation(c, p));
  const ge = c.openEnd ? '≥ ' : '';
  const text =
    a.pos < 0
      ? `${t.climbIn(fmtDist(-a.pos))} · ${nf(c.lengthM / 1000, 1)} km · ${nf(c.avgGrade, 1)} %`
      : `${ge}${fmtDist(c.lengthM - p)} · ${ge}+${nf(gainLeft)} m · ${nf(S.st?.metrics?.gradePercent ?? 0, 1)} %`;
  // Construit une fois par montée ; texte et repère mis à jour sur place (bouton sous le doigt).
  const key = `${lang}|${c.segments.map((s) => s.grade.toFixed(1)).join(',')}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = `<button class="cm" data-act="climb-show"><b>⛰</b><span class="cm-txt"></span>${climbBarHtml(c, 0)}</button>`;
  }
  const txt = el.querySelector('.cm-txt');
  if (txt && txt.textContent !== text) txt.textContent = text;
  const mark = el.querySelector<HTMLElement>('.cbar b');
  if (mark) {
    mark.hidden = a.pos < 0;
    mark.style.left = `${((p / c.lengthM) * 100).toFixed(1)}%`;
  }
}

function ctrlHtml(): string {
  const st = S.st!;
  return `<section class="ctrl">
    <div class="shift">
      <button class="btn huge" data-cmd="shift-down">−</button>
      <div class="gearbox"><span>${esc(t.gear)}</span><b id="c-gear">–</b><small id="c-gearn"></small></div>
      <button class="btn huge" data-cmd="shift-up">+</button>
    </div>
    <div class="row3">
      <button class="btn big" data-cmd="pause" id="c-pause">${esc(st.phase === 'paused' ? t.resume : t.pause)}</button>
      <button class="btn big" data-cmd="photo">📷 ${esc(t.photo)}</button>
      <button class="btn big" data-cmd="hud" id="c-hud">${esc(t.hud)}</button>
    </div>
    <div class="row3">
      <button class="btn big" data-cmd="lookback" id="c-look">${esc(t.lookBack)}</button>
      <button class="btn big" data-cmd="mute" id="c-mute">${esc(st.muted ? t.unmute : t.mute)}</button>
    </div>
    <button class="btn big wide" data-music="toggle" id="c-music">${esc(st.music?.playing === false ? t.musicResume : t.musicCut)}</button>
    ${st.open || !st.multiplayer ? `<button class="btn big wide" data-cmd="uturn">↶ ${esc(t.uturn)}</button>` : ''}
    <h2>${esc(t.camera)}</h2>
    <div class="cams">${CAMERAS.map((c) => `<button class="seg" data-cam="${c}">${esc(t.cameras[c])}</button>`).join('')}</div>
    <label class="slider"><span>${esc(t.fan)}</span><input type="range" min="0" max="100" step="5" value="${st.fanPercent ?? 0}" id="c-fan"/><output id="c-fanv">${st.fanPercent ?? 0} %</output></label>
    ${
      st.team
        ? `<h2>${esc(t.team)} <small id="c-grp-pace"></small></h2><div class="grp"><div class="grp-radar"><i class="grp-track"></i><div id="c-grp-dots"></div><i class="grp-me"></i></div><div class="grp-scale"><span>${esc(t.groupBehind)}</span><span>${esc(t.groupYou)}</span><span>${esc(t.groupAhead)}</span></div></div><div class="row3"><button class="btn big" data-cmd="pace-down">${esc(t.paceDown)}</button><button class="btn big" data-cmd="slowdown">${esc(t.slowDown)}</button><button class="btn big" data-cmd="pace-up">${esc(t.paceUp)}</button></div><div class="row3"><button class="btn big" data-cmd="waitme">${esc(t.waitMe)}</button><button class="btn big" data-cmd="formation">${esc(t.formation)}</button></div>`
        : ''
    }
  </section>`;
}

function updateCtrl(st: PairState): void {
  const m = st.metrics!;
  const g = document.getElementById('c-gear');
  if (!g) return;
  g.textContent = m.gearLabel || String(m.gearIndex + 1);
  const gn = document.getElementById('c-gearn');
  if (gn) gn.textContent = `${m.gearIndex + 1} / ${m.gearCount}`;
  const p = document.getElementById('c-pause');
  if (p) p.textContent = st.phase === 'paused' ? t.resume : t.pause;
  const h = document.getElementById('c-hud');
  if (h) h.textContent = st.hudVisible === false ? t.hudOff : t.hudOn;
  const look = document.getElementById('c-look');
  if (look) look.classList.toggle('on', !!st.lookBack);
  const mute = document.getElementById('c-mute');
  if (mute) mute.textContent = st.muted ? t.unmute : t.mute;
  // Radar du groupe : 30 m derrière à 30 m devant, moi au centre (comme le panneau « Groupe » du jeu).
  const dots = document.getElementById('c-grp-dots');
  if (dots) {
    dots.innerHTML = (st.riders ?? [])
      .filter((r) => !r.me && Math.abs(r.gapM) <= 30)
      .map((r) => `<i style="left:${(50 + (r.gapM / 30) * 50).toFixed(1)}%;background:${esc(r.color)}" title="${esc(r.name)}"></i>`)
      .join('');
    const gp = document.getElementById('c-grp-pace');
    if (gp) gp.textContent = st.groupPacePct ? `${st.groupPacePct} % FTP` : '';
  }
  // Musique : le bouton dit ce qu'un appui fait (couper la musique en sortie sans quitter le pilotage).
  const mu = document.getElementById('c-music');
  if (mu) mu.textContent = st.music?.playing === false ? t.musicResume : t.musicCut;
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === st.camera));
  const fan = document.getElementById('c-fan') as HTMLInputElement | null;
  if (fan && document.activeElement !== fan && st.fanPercent !== undefined && Date.now() - fanTouched > 1500) {
    fan.value = String(st.fanPercent);
    const out = document.getElementById('c-fanv');
    if (out) out.textContent = `${st.fanPercent} %`;
  }
}

function musicHtml(): string {
  return `<section class="music">
    <div class="disc">♪</div>
    <div class="np"><span id="mu-src"></span><b id="mu-title">–</b></div>
    <div class="transport">
      <button class="btn round" data-music="previous" aria-label="${esc(t.previous)}">⏮</button>
      <button class="btn round huge" data-music="toggle" id="mu-play">▶</button>
      <button class="btn round" data-music="next" aria-label="${esc(t.nextTrack)}">⏭</button>
    </div>
    <label class="slider"><span>${esc(t.volume)}</span><input type="range" min="0" max="1" step="0.05" id="mu-vol"/><output id="mu-volv"></output></label>
    <div class="mu-search" id="mu-search" hidden>
      <form class="row" data-form="music"><input name="q" maxlength="100" autocomplete="off" enterkeyhint="search" placeholder="${esc(t.musicSearch)}" value="${esc(S.music.query)}"/><button class="btn">${esc(t.musicSearchGo)}</button></form>
      <button class="seg" data-act="music-mine">${esc(t.musicMine)}</button>
      <ul class="mu-results" id="mu-results"></ul>
    </div>
  </section>`;
}

/** Résultats de la recherche Spotify : un appui lance le morceau ou la playlist dans le jeu. */
function renderMusicResults(): void {
  const ul = document.getElementById('mu-results');
  if (!ul) return;
  const m = S.music;
  if (m.state === 'loading') ul.innerHTML = `<li class="mu-info">${esc(t.musicSearching)}</li>`;
  else if (m.state === 'error') ul.innerHTML = `<li class="mu-info">${esc(m.error === 'not_connected' ? t.musicNotConnected : t.musicFailed)}</li>`;
  else if (m.state === 'done' && !m.items.length) ul.innerHTML = `<li class="mu-info">${esc(t.musicNone)}</li>`;
  else
    ul.innerHTML = m.items
      .map(
        (i, n) =>
          `<li><button data-mplay="${n}">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy"/>` : '<i></i>'}<span><b>${esc(i.name)}</b><small>${esc(i.type === 'track' ? t.musicTrack : t.musicPlaylist)}${i.sub ? ` · ${esc(i.sub)}` : ''}</small></span></button></li>`,
      )
      .join('');
}

function musicSearch(query: string): void {
  S.music = { query, state: 'loading', items: [], error: '' };
  renderMusicResults();
  send({ kind: 'musicSearch', query });
}

let volTouched = 0;
let fanTouched = 0;

function updateMusic(): void {
  const mu = S.st?.music;
  const src = document.getElementById('mu-src');
  if (!src) return;
  src.textContent = !mu ? '' : mu.source === 'spotify' ? t.musicSpotify : t.musicGame;
  const title = document.getElementById('mu-title');
  if (title) title.textContent = mu ? (mu.playing ? mu.title || '…' : mu.title ? `${mu.title} (${t.stop.toLowerCase()})` : t.musicOff) : '–';
  const play = document.getElementById('mu-play');
  if (play) play.textContent = mu?.playing ? '⏸' : '▶';
  const search = document.getElementById('mu-search');
  if (search) {
    const show = mu?.source === 'spotify';
    if (search.hidden && show) renderMusicResults();
    search.hidden = !show;
  }
  const vol = document.getElementById('mu-vol') as HTMLInputElement | null;
  if (vol && mu && document.activeElement !== vol && Date.now() - volTouched > 1500) {
    vol.value = String(mu.volume);
    const out = document.getElementById('mu-volv');
    if (out) out.textContent = `${Math.round(mu.volume * 100)} %`;
  }
  document.querySelectorAll<HTMLButtonElement>('[data-music]').forEach((b) => (b.disabled = !S.presence.game));
}

function chatHtml(): string {
  return `<section class="chat">
    <ul id="chatlog"></ul>
    <p class="hint" id="chat-solo">${esc(t.chatSolo)}</p>
    <div class="quick" id="chat-quick">${t.quick.map((q) => `<button class="seg" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="row" data-form="chat"><input name="text" maxlength="280" autocomplete="off" placeholder="${esc(t.chatPlaceholder)}"/><button class="btn">${esc(t.send)}</button></form>
    <div id="rideon"></div>
  </section>`;
}

function renderChatLog(): void {
  const ul = document.getElementById('chatlog');
  if (!ul) return;
  ul.innerHTML = S.chat
    .slice(-60)
    .map((m) => `<li class="${m.sys ? 'sys' : ''}">${m.sys ? '' : `<b>${esc(m.who)}</b> `}${esc(m.text)}</li>`)
    .join('');
  ul.scrollTop = ul.scrollHeight;
  updateChatControls();
}

let lastRideOn = '';

function updateChatControls(): void {
  const multi = !!S.st?.multiplayer;
  const solo = document.getElementById('chat-solo');
  if (solo) solo.hidden = multi;
  document.querySelectorAll<HTMLElement>('#chat-quick, form[data-form="chat"]').forEach((el) => el.classList.toggle('disabled', !multi));
  const box = document.getElementById('rideon');
  if (!box) return;
  const riders = multi ? (S.st?.riders ?? []).filter((r) => !r.me && !r.ai) : [];
  const html = riders.length
    ? `<h2>${esc(t.riders)}</h2><ul class="riders">${riders
        .map((r) => `<li><i style="background:${esc(r.color)}"></i><span>${esc(r.name)}</span><button class="seg" data-rideon="${esc(r.id)}">👍 ${esc(t.rideOn)}</button></li>`)
        .join('')}</ul>`
    : '';
  if (html !== lastRideOn) {
    box.innerHTML = html;
    lastRideOn = html;
  }
}

function openPicker(i: number): void {
  S.picking = i;
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  sheet.innerHTML = `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet">
    <h2>${esc(t.pickField)}</h2>
    <div class="picks">${ALL_FIELDS.map((f) => `<button class="seg ${S.fields[i] === f ? 'on' : ''}" data-pick="${f}">${esc(t.fields[f])}</button>`).join('')}</div>
    <button class="btn ghost small" data-act="reset-fields">${esc(t.resetFields)}</button>
  </div>`;
}

function closeSheet(): void {
  S.picking = null;
  const sheet = document.getElementById('sheet');
  if (sheet) sheet.innerHTML = '';
}

/* ───────────── Interactions ───────────── */

async function toggleFullscreen(): Promise<void> {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (document.fullscreenElement || doc.webkitFullscreenElement) await document.exitFullscreen();
    else if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else throw new Error('indisponible');
  } catch {
    onEvent({ kind: 'toast', text: t.noFullscreen });
  }
}

async function rotate(): Promise<void> {
  const order = ['any', 'landscape', 'portrait'] as const;
  S.orient = order[(order.indexOf(S.orient) + 1) % order.length]!;
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try {
    if (S.orient === 'any') o.unlock();
    else await o.lock?.(S.orient);
  } catch {
    S.orient = 'any';
  }
  renderBar();
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab],[data-cmd],[data-cam],[data-turn],[data-music],[data-mplay],[data-quick],[data-rideon],[data-field],[data-pick]');
  if (!el) return;
  const d = el.dataset;
  if (d.tab) {
    S.tab = d.tab as Tab;
    localStorage.setItem('ar-cmp-tab', S.tab);
    haptic(8);
    renderTabs();
    renderContent();
    return;
  }
  if (d.act === 'lang') {
    lang = lang === 'fr' ? 'en' : 'fr';
    localStorage.setItem('ar-lang', lang);
    t = STRINGS[lang];
    render();
  } else if (d.act === 'fullscreen') void toggleFullscreen();
  else if (d.act === 'rotate') void rotate();
  else if (d.act === 'follow') {
    S.follow = !S.follow;
    el.textContent = S.follow ? t.whole : t.follow;
    refresh();
  } else if (d.act === 'unpair') {
    localStorage.removeItem('ar-pair');
    localStorage.removeItem('ar-pair-server');
    S.pair = null;
    clearTimeout(retry);
    const r = room;
    room = null;
    r?.removeAllListeners();
    void r?.leave(true).catch(() => undefined);
    render();
  } else if (d.act === 'climb-close') {
    haptic(8);
    S.climbHidden = true;
    renderContent();
  } else if (d.act === 'climb-show') {
    haptic(8);
    S.climbHidden = false;
    if (S.tab !== 'dash' && S.tab !== 'map') {
      S.tab = 'dash';
      localStorage.setItem('ar-cmp-tab', S.tab);
      renderTabs();
    }
    renderContent();
  } else if (d.act === 'close-sheet') closeSheet();
  else if (d.act === 'reset-fields') {
    S.fields = [...DEFAULT_FIELDS];
    localStorage.setItem('ar-cmp-fields', JSON.stringify(S.fields));
    closeSheet();
    refresh();
  } else if (d.field !== undefined) openPicker(Number(d.field));
  else if (d.pick && S.picking !== null) {
    S.fields[S.picking] = d.pick as FieldId;
    localStorage.setItem('ar-cmp-fields', JSON.stringify(S.fields));
    closeSheet();
    refresh();
  } else if (d.turn !== undefined) {
    haptic(25);
    send({ kind: 'turn', index: Number(d.turn) });
  } else if (d.mplay !== undefined) {
    const item = S.music.items[Number(d.mplay)];
    if (item) {
      haptic(25);
      send({ kind: 'musicPlay', uri: item.uri });
      showToast(item.name);
    }
  } else if (d.act === 'music-mine') {
    haptic();
    const q = document.querySelector<HTMLInputElement>('.mu-search input[name=q]');
    if (q) q.value = '';
    musicSearch('');
  } else if (d.music) {
    haptic();
    send({ kind: 'music', action: d.music as 'toggle' | 'next' | 'previous' });
  } else if (d.cam) {
    haptic();
    send({ kind: 'camera', camera: d.cam as CameraMode });
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b === el));
  } else if (d.quick) {
    if (!S.st?.multiplayer) return;
    haptic();
    send({ kind: 'chat', text: d.quick });
  } else if (d.rideon) {
    haptic(40);
    send({ kind: 'rideOn', to: d.rideon });
  } else if (d.cmd) {
    haptic();
    const st = S.st;
    if (d.cmd === 'shift-up') send({ kind: 'shift', action: 'up' });
    else if (d.cmd === 'shift-down') send({ kind: 'shift', action: 'down' });
    else if (d.cmd === 'pause') send({ kind: st?.phase === 'paused' ? 'resume' : 'pause' });
    else if (d.cmd === 'photo') send({ kind: 'photo' });
    else if (d.cmd === 'hud') send({ kind: 'hud' });
    else if (d.cmd === 'lookback') send({ kind: 'lookBack', on: !S.st?.lookBack });
    else if (d.cmd === 'mute') send({ kind: 'mute' });
    else if (d.cmd === 'uturn') send({ kind: 'uturn' });
    else if (d.cmd === 'slowdown') send({ kind: 'slowDown' });
    else if (d.cmd === 'waitme') send({ kind: 'waitMe' });
    else if (d.cmd === 'formation') send({ kind: 'formation' });
    else if (d.cmd === 'pace-up') send({ kind: 'pace', delta: 1 });
    else if (d.cmd === 'pace-down') send({ kind: 'pace', delta: -1 });
  }
});

let fanTimer: ReturnType<typeof setTimeout> | undefined;
let volTimer: ReturnType<typeof setTimeout> | undefined;

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'c-fan') {
    fanTouched = Date.now();
    const percent = Number(el.value);
    const out = document.getElementById('c-fanv');
    if (out) out.textContent = `${percent} %`;
    clearTimeout(fanTimer);
    fanTimer = setTimeout(() => send({ kind: 'fan', percent }), 150);
  } else if (el.id === 'mu-vol') {
    volTouched = Date.now();
    const volume = Number(el.value);
    const out = document.getElementById('mu-volv');
    if (out) out.textContent = `${Math.round(volume * 100)} %`;
    clearTimeout(volTimer);
    volTimer = setTimeout(() => send({ kind: 'music', action: 'volume', volume }), 120);
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  if (form.dataset.form === 'music') {
    musicSearch(String(data.get('q') ?? '').trim());
  } else if (form.dataset.form === 'chat') {
    const text = String(data.get('text') ?? '').trim();
    if (text && S.st?.multiplayer) send({ kind: 'chat', text });
    form.reset();
  } else if (form.dataset.form === 'pair') {
    // Lien complet du QR code, ou jeton seul.
    const raw = String(data.get('link') ?? '').trim();
    let pair = raw;
    try {
      const u = new URL(raw);
      pair = u.searchParams.get('pair') ?? '';
      const server = u.searchParams.get('server');
      if (server) localStorage.setItem('ar-pair-server', server);
    } catch {
      /* jeton seul */
    }
    if (!PAIR_TOKEN_RE.test(pair)) return;
    localStorage.setItem('ar-pair', pair);
    S.pair = pair;
    render();
    connect();
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) S.orient = 'any';
  renderBar();
});
// Redimensionnement (rotation) : les canvas se recalent.
window.addEventListener('resize', () => refresh());

/* ───────────── Écran allumé, reprise au premier plan ───────────── */

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void }> } };
    if (nav.wakeLock && document.visibilityState === 'visible') {
      const lock = await nav.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!wakeLock) void keepAwake();
  if (!room) connect();
  else send({ kind: 'sync' });
});
// Certains navigateurs n'accordent le verrou d'écran qu'après un geste.
app.addEventListener('pointerdown', () => !wakeLock && void keepAwake(), { passive: true });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js', { scope: './' }));
}

render();
void keepAwake();
connect();
