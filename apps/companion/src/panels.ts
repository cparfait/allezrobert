/**
 * Panneaux ouverts par-dessus la page, refermés par une large touche en bas de l'écran. En roulant : caméra, ventilateur,
 * son, écran, message tout prêt, Ride On (grosses touches, retour automatique au bout de 20 s sans appui). À l'arrêt :
 * réglages, chat écrit, recherche de musique ou de destination.
 */
import { PAIR_FAN_MODES, PAIR_SOUND_BUSES, ROAD_FEEL, ROAD_FEEL_SURFACE_LABEL, ROAD_FEEL_TEXT, roadFeelLevel, type CameraMode, type PairFanMode, type PairSoundBus } from '@allezrobert/shared';
import { $, esc, setHtml, setText } from './dom.ts';
import { icon, tile, type IconId } from './icons.ts';
import type { Density } from './logic.ts';
import { fanWord } from './pages/actions.ts';
import { humans } from './pages/group.ts';
import { ALL_FIELDS, inRide, lang, S, send, t, withLocal, type PanelId } from './state.ts';

const CAMERAS: CameraMode[] = ['chase', 'cockpit', 'action', 'gopro', 'drone', 'tv', 'photo'];
const FAN_ICONS: Record<PairFanMode, IconId> = { off: 'off', manual: 'fan', speed: 'gauge', heartRate: 'heart', grade: 'mountain' };
const SOUND_ICONS: Record<PairSoundBus, IconId> = { ambience: 'tree', wind: 'wind', bike: 'bike', breath: 'breath', crowd: 'crowd', traffic: 'car', voice: 'mic' };

/** Panneaux utilisés en pédalant : ils se referment seuls si on les oublie. */
const RIDE_PANELS: PanelId[] = ['camera', 'fan', 'sound', 'screen', 'quick', 'rideon'];
const IDLE_MS = 20_000;
let idle: ReturnType<typeof setTimeout> | undefined;

export function touchPanel(): void {
  clearTimeout(idle);
  if (S.panel && RIDE_PANELS.includes(S.panel)) idle = setTimeout(closePanel, IDLE_MS);
}

export function openPanel(id: PanelId): void {
  S.panel = id;
  S.roadArmed = false;
  if (id === 'chat') S.unread = 0;
  // Sans rien taper : les playlists du compte, ou les lieux les plus proches.
  if (id === 'search' && S.music.state === 'idle' && S.st?.music?.source === 'spotify') musicSearch('');
  if (id === 'dest') placeSearch('');
  renderPanel();
  touchPanel();
}

export function closePanel(): void {
  clearTimeout(idle);
  // Le choix d'un champ revient aux réglages.
  S.panel = S.panel === 'pick' ? 'settings' : null;
  renderPanel();
}

export function renderPanel(): void {
  const el = $('panel');
  if (!el) return;
  const id = S.panel;
  el.hidden = !id;
  if (!id) {
    el.innerHTML = '';
    return;
  }
  const ride = RIDE_PANELS.includes(id);
  el.innerHTML = `<div class="pn ${ride ? 'ride' : 'read'}" data-id="${id}"><h1>${esc(titleOf(id))}</h1><div class="pn-body" id="pn-body">${bodyOf(id)}</div><button class="btn closer" data-act="close-panel">${icon('close')}${esc(id === 'pick' ? t.back : t.close)}</button></div>`;
  updatePanel();
}

function titleOf(id: PanelId): string {
  const titles: Record<PanelId, string> = {
    camera: t.camera,
    fan: t.fan,
    sound: t.sound,
    screen: t.screenSub,
    quick: t.quickTitle,
    rideon: t.rideOnTitle,
    chat: S.st?.multiplayer ? t.chat : t.news,
    search: t.musicPickTitle,
    dest: t.destTitle,
    settings: t.settings,
    pick: t.pickField,
  };
  return titles[id];
}

function bodyOf(id: PanelId): string {
  const st = S.st;
  switch (id) {
    case 'camera':
      return `<div class="tiles fill">${CAMERAS.map((c) => tile(`data-cam="${c}"`, c === 'photo' ? 'photo' : 'camera', esc(t.cameras[c]))).join('')}</div>`;
    case 'fan':
      return `<div class="stepper tall"><button data-fan="-1" aria-label="−">${icon('minus')}</button><div><span>${esc(t.fanPower)}</span><b id="p-fan"></b></div><button data-fan="1" aria-label="+">${icon('plus')}</button></div>
        ${st?.fanMode ? `<div class="tiles fill">${PAIR_FAN_MODES.map((m) => tile(`data-fanmode="${m}"`, FAN_ICONS[m], esc(t.fanModes[m]))).join('')}</div>` : ''}`;
    case 'sound':
      return `<div class="tiles fill">${tile('data-cmd="mute"', 'mute', '', { id: 'p-mute', cls: 'wide2' })}${st?.sounds ? PAIR_SOUND_BUSES.map((b) => tile(`data-sound="${b}"`, SOUND_ICONS[b], esc(t.soundNames[b]), { sub: '' })).join('') : ''}</div>`;
    case 'screen':
      return `<div class="tiles fill one">${tile('data-cmd="hud"', 'hud', esc(t.hudName), { id: 'p-hud', sub: '' })}${st?.ghost === undefined || st.ghost === null ? '' : tile('data-cmd="ghost"', 'ghost', esc(t.ghostName), { id: 'p-ghost', sub: '' })}${st?.mapOpen === undefined ? '' : tile('data-act="map-screen"', 'map', esc(t.mapName), { id: 'p-map', sub: '' })}</div>`;
    case 'quick':
      return `<div class="tiles fill">${t.quick.map((q) => tile(`data-quick="${esc(q)}"`, 'chat', esc(q))).join('')}</div>`;
    case 'rideon':
      return `<div class="tiles fill one" id="p-riders"></div>`;
    case 'chat':
      return `${st?.multiplayer ? `<form class="row" data-form="chat"><input name="text" maxlength="280" autocomplete="off" enterkeyhint="send" placeholder="${esc(t.chatPlaceholder)}"/><button class="btn go">${esc(t.send)}</button></form>` : ''}<ul class="log" id="p-log"></ul>`;
    case 'search':
      return `<p class="hint" id="p-need">${esc(t.musicNeedSpotify)}</p>
        <form class="row" data-form="music" id="p-mform"><input name="q" maxlength="100" autocomplete="off" enterkeyhint="search" placeholder="${esc(t.musicSearch)}" value="${esc(S.music.query)}"/><button class="btn" aria-label="${esc(t.musicSearchGo)}">${icon('search')}</button></form>
        <button class="btn" data-act="music-mine" id="p-mine">${icon('list')}${esc(t.musicMine)}</button>
        <ul class="rows" id="p-results"></ul>`;
    case 'dest':
      return `<div id="p-dest"></div><form class="row" data-form="place"><input name="q" maxlength="100" autocomplete="off" enterkeyhint="search" placeholder="${esc(t.destSearch)}" value="${esc(S.place.query)}"/><button class="btn" aria-label="${esc(t.destSearchGo)}">${icon('search')}</button></form>
        <ul class="rows" id="p-places"></ul>`;
    case 'settings':
      return settingsHtml();
    case 'pick':
      return `<div class="picks">${ALL_FIELDS.map((f) => `<button class="opt ${S.fields[S.picking] === f ? 'on' : ''}" data-pick="${f}">${esc(t.fields[f])}</button>`).join('')}</div>`;
  }
}

function settingsHtml(): string {
  const st = S.st;
  const fs = !!document.fullscreenElement;
  const canRotate = fs && 'orientation' in screen && 'lock' in (screen.orientation as object);
  return `<p class="hint">${esc(t.setStop)}</p>
    <h2>${esc(t.setFields)}</h2>
    <div class="opts">${([3, 5, 7] as Density[]).map((n) => `<button class="opt ${S.density === n ? 'on' : ''}" data-dens="${n}">${esc(t.setDensityNames[n]!)}</button>`).join('')}</div>
    <div class="slots">${S.fields
      .slice(0, S.density)
      .map((f, i) => `<button class="opt" data-slot="${i}"><small>${i + 1}</small>${esc(t.fields[f])}</button>`)
      .join('')}</div>
    <button class="btn ghost" data-act="reset-fields">${esc(t.resetFields)}</button>
    ${st?.roadFeel ? `<h2>${esc(ROAD_FEEL_TEXT[lang].title)}</h2><div class="stepper"><button data-road="-1" aria-label="−">${icon('minus')}</button><div><b id="p-road"></b></div><button data-road="1" aria-label="+">${icon('plus')}</button></div><p class="road" id="p-roadmsg"></p>` : ''}
    <h2>${esc(t.setPhone)}</h2>
    <div class="opts"><button class="opt ${fs ? 'on' : ''}" data-act="fullscreen">${esc(t.fullscreen)}</button>${canRotate ? `<button class="opt" data-act="rotate">${esc(t.rotate)} : ${esc(t.orient[S.orient])}</button>` : ''}<button class="opt" data-act="lang">${lang === 'fr' ? 'English' : 'Français'}</button></div>
    <h2>${esc(t.setMore)}</h2>
    <div class="opts"><button class="opt" data-panel="chat">${esc(st?.multiplayer ? t.chat : t.news)}</button><button class="opt danger" data-hold="unpair">${esc(t.unpair)}</button></div>`;
}

/** Met à jour le panneau ouvert, sans remplacer les touches. */
export function updatePanel(): void {
  const st = S.st;
  const on = (sel: string, test: (el: HTMLElement) => boolean) => document.querySelectorAll<HTMLElement>(`#pn-body ${sel}`).forEach((el) => el.classList.toggle('on', test(el)));
  const word = (id: string, text: string, lit: boolean) => {
    const el = $(id);
    setText(el?.querySelector('small') ?? null, text);
    el?.classList.toggle('on', lit);
  };
  switch (S.panel) {
    case 'camera': {
      const cam = withLocal('camera', st?.camera);
      on('[data-cam]', (el) => el.dataset.cam === cam);
      break;
    }
    case 'fan': {
      if (!st) break;
      const mode = withLocal('fanMode', st.fanMode);
      on('[data-fanmode]', (el) => el.dataset.fanmode === mode);
      setText($('p-fan'), mode && mode !== 'manual' && mode !== 'off' ? t.auto : fanWord(st));
      break;
    }
    case 'sound': {
      const muted = withLocal('muted', !!st?.muted);
      setHtml($('p-mute'), `${icon(muted ? 'sound' : 'mute')}<span class="tx"><b>${esc(muted ? t.unmute : t.mute)}</b></span>`);
      $('p-mute')?.classList.toggle('bad', muted);
      document.querySelectorAll<HTMLElement>('#pn-body [data-sound]').forEach((el) => {
        const lit = withLocal(`snd-${el.dataset.sound}`, !!st?.sounds?.[el.dataset.sound as PairSoundBus]);
        el.classList.toggle('on', lit && !muted);
        el.classList.toggle('dim', !lit || muted);
        setText(el.querySelector('small'), lit ? t.soundOn : t.soundOff);
      });
      break;
    }
    case 'screen': {
      const hud = withLocal('hud', st?.hudVisible !== false);
      const ghost = withLocal('ghost', !!st?.ghost);
      const map = withLocal('mapOpen', !!st?.mapOpen);
      word('p-hud', hud ? t.shown : t.hidden, hud);
      word('p-ghost', ghost ? t.shown : t.hidden, ghost);
      word('p-map', map ? t.opened : t.closed, map);
      break;
    }
    case 'rideon': {
      const list = humans(st).slice(0, 6);
      setHtml($('p-riders'), list.length ? list.map((r) => tile(`data-rideon="${esc(r.id)}"`, 'thumb', esc(r.name))).join('') : `<p class="hint">${esc(t.nobody)}</p>`);
      break;
    }
    case 'chat':
      S.unread = 0;
      if (
        setHtml(
          $('p-log'),
          S.chat.length
            ? S.chat
                .slice(-60)
                .reverse()
                .map((m) => `<li class="${m.sys ? 'sys' : ''}">${m.sys ? '' : `<b>${esc(m.who)}</b> `}${esc(m.text)}</li>`)
                .join('')
            : `<li class="sys">${esc(t.newsNone)}</li>`,
        )
      )
        $('p-log')?.scrollTo(0, 0);
      break;
    case 'search': {
      const ready = st?.music?.source === 'spotify';
      const need = $('p-need');
      if (need) need.hidden = ready;
      for (const id of ['p-mform', 'p-mine']) {
        const el = $(id);
        if (el) el.hidden = !ready;
      }
      const m = S.music;
      setHtml(
        $('p-results'),
        !ready
          ? ''
          : m.state === 'loading'
            ? `<li class="info">${esc(t.musicSearching)}</li>`
            : m.state === 'error'
              ? `<li class="info">${esc(m.error === 'not_connected' ? t.musicNotConnected : t.musicFailed)}</li>`
              : m.state === 'done' && !m.items.length
                ? `<li class="info">${esc(t.musicNone)}</li>`
                : m.items
                    .map((i, n) => `<li><button data-mplay="${n}">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy"/>` : '<i></i>'}<span><b>${esc(i.name)}</b><small>${esc(i.type === 'track' ? t.musicTrack : t.musicPlaylist)}${i.sub ? ` · ${esc(i.sub)}` : ''}</small></span></button></li>`)
                    .join(''),
      );
      break;
    }
    case 'dest': {
      const d = st?.destination;
      setHtml($('p-dest'), d ? `<button class="btn cancel" data-act="dest-clear">${icon('close')}<span><b>${esc(t.destStop)}</b><small>${esc(d.name)}</small></span></button>` : '');
      const p = S.place;
      setHtml(
        $('p-places'),
        p.state === 'loading'
          ? `<li class="info">${esc(t.destSearching)}</li>`
          : p.state === 'error'
            ? `<li class="info">${esc(t.destUnavailable)}</li>`
            : p.state === 'done' && !p.items.length
              ? `<li class="info">${esc(t.destNone)}</li>`
              : `${p.items.length && !p.query ? `<li class="info">${esc(t.destNear)}</li>` : ''}${p.items.map((i, n) => `<li><button data-pgo="${n}">${icon('flag')}<span><b>${esc(i.name)}</b><small>${esc(i.sub)}</small></span></button></li>`).join('')}`,
      );
      break;
    }
    case 'settings': {
      const rf = st?.roadFeel;
      if (!rf) break;
      const pct = withLocal('road', rf.percent);
      setText($('p-road'), pct > 0 ? `${pct} %` : t.roadOff);
      const level = roadFeelLevel(pct);
      const msg = $('p-roadmsg');
      if (msg) {
        msg.className = `road ${S.roadArmed ? 'extreme' : level}`;
        // Revêtement simulé en ce moment : on voit le ressenti suivre la route.
        const now = rf.supported && pct > 0 && inRide() ? ` ${t.now} : ${ROAD_FEEL_SURFACE_LABEL[lang][rf.surface] ?? rf.surface}.` : '';
        setText(msg, S.roadArmed ? `${t.roadConfirm} (${ROAD_FEEL.extremePercent} %)` : `${ROAD_FEEL_TEXT[lang][level]}${rf.supported ? '' : ` ${ROAD_FEEL_TEXT[lang].unsupported}`}${now}`);
      }
      break;
    }
  }
}

export function musicSearch(query: string): void {
  S.music = { query, state: 'loading', items: [], error: '' };
  send({ kind: 'musicSearch', query });
  updatePanel();
}

export function placeSearch(query: string): void {
  S.place = { query, state: 'loading', items: [], error: '' };
  send({ kind: 'placeSearch', query });
  updatePanel();
}
