/** Ce que fait chaque touche : commande envoyée au jeu, réponse immédiate à l'écran, panneau ouvert ou refermé. */
import { ROAD_FEEL, stepCameraTune, type CameraMode, type PairFanMode, type PairSoundBus, type PhoneCommand } from '@allezrobert/shared';
import { flash, showToast } from './dom.ts';
import { junctionArmed } from './junction.ts';
import { unpair } from './link.ts';
import { roadStep, stepValue, type Density, type Tab } from './logic.ts';
import { humans } from './pages/group.ts';
import { closePanel, musicSearch, openPanel, renderPanel } from './panels.ts';
import type { PhoneMic } from './phoneMic.ts';
import { DEFAULT_FIELDS, haptic, lang, S, send, setLang, setLocal, setTabPref, t, withLocal, type FieldId, type PanelId } from './state.ts';
import { refresh, render } from './shell.ts';
import { syncWake } from './wake.ts';

export const TOUCHABLE = '[data-act],[data-tab],[data-panel],[data-cmd],[data-cam],[data-tune],[data-turn],[data-music],[data-vol],[data-mplay],[data-pgo],[data-quick],[data-rideon],[data-fan],[data-fanmode],[data-sound],[data-dens],[data-slot],[data-pick],[data-road]';

/** Change de page et referme ce qui est ouvert par-dessus. */
export function goTab(tab: Tab): void {
  setTabPref(tab);
  if (S.panel) closePanel();
  haptic(8);
  refresh();
}

/** Commandes simples des touches `data-cmd`. */
function simple(cmd: string): PhoneCommand | null {
  const st = S.st;
  switch (cmd) {
    case 'shift-up':
      return { kind: 'shift', action: 'up' };
    case 'shift-down':
      return { kind: 'shift', action: 'down' };
    case 'pause':
      return { kind: st?.phase === 'paused' ? 'resume' : 'pause' };
    case 'photo':
      return { kind: 'photo' };
    case 'hud':
      setLocal('hud', !withLocal('hud', st?.hudVisible !== false));
      return { kind: 'hud' };
    case 'ghost': {
      const on = !withLocal('ghost', !!st?.ghost);
      setLocal('ghost', on);
      return { kind: 'ghost', on };
    }
    case 'lookback': {
      const on = !withLocal('lookBack', !!st?.lookBack);
      setLocal('lookBack', on);
      return { kind: 'lookBack', on };
    }
    case 'mute':
      setLocal('muted', !withLocal('muted', !!st?.muted));
      return { kind: 'mute' };
    case 'slowdown':
      return { kind: 'slowDown' };
    case 'waitme':
      return { kind: 'waitMe' };
    case 'team-attack':
      return { kind: 'teamAttack' };
    case 'team-pull':
      return { kind: 'teamPull' };
    case 'formation':
      return { kind: 'formation' };
    case 'pace-up':
      return { kind: 'pace', delta: 1 };
    case 'pace-down':
      return { kind: 'pace', delta: -1 };
    case 'start-race':
      return { kind: 'startRace' };
  }
  return null;
}

async function toggleFullscreen(): Promise<void> {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (document.fullscreenElement || doc.webkitFullscreenElement) await document.exitFullscreen();
    else if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else throw new Error('indisponible');
  } catch {
    showToast(t.noFullscreen);
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
  renderPanel();
}

function saveFields(): void {
  localStorage.setItem('ar-cmp-fields', JSON.stringify(S.fields));
}

function act(name: string, mic: PhoneMic): void {
  switch (name) {
    case 'lang':
      setLang(lang === 'fr' ? 'en' : 'fr');
      render();
      break;
    case 'mic':
      haptic(25);
      void mic.toggle();
      break;
    case 'fullscreen':
      void toggleFullscreen();
      break;
    case 'rotate':
      void rotate();
      break;
    case 'map-screen': {
      haptic();
      const open = !withLocal('mapOpen', !!S.st?.mapOpen);
      setLocal('mapOpen', open);
      send({ kind: 'map', open });
      refresh();
      break;
    }
    case 'follow':
      S.follow = !S.follow;
      refresh();
      break;
    case 'climb-close':
    case 'climb-show':
      haptic(8);
      S.climbHidden = name === 'climb-close';
      refresh();
      break;
    case 'close-panel':
      haptic(8);
      closePanel();
      refresh();
      break;
    case 'reset-fields':
      S.fields = [...DEFAULT_FIELDS];
      saveFields();
      renderPanel();
      refresh();
      break;
    case 'dest-clear':
      haptic();
      send({ kind: 'clearDestination' });
      closePanel();
      break;
    case 'music-mine': {
      haptic();
      const q = document.querySelector<HTMLInputElement>('#p-mform input[name=q]');
      if (q) q.value = '';
      musicSearch('');
      break;
    }
    case 'toast':
      // Message d'un joueur : répondre d'un appui.
      if (document.getElementById('toast')?.classList.contains('msg') && S.st?.multiplayer) openPanel('quick');
      break;
  }
}

/** Appui sur une touche. */
export function press(el: HTMLElement, mic: PhoneMic): void {
  const d = el.dataset;
  if (d.tab) return goTab(d.tab as Tab);
  if (d.panel) {
    haptic(8);
    return openPanel(d.panel as PanelId);
  }
  if (d.act) return act(d.act, mic);
  if (d.turn !== undefined) {
    if (!junctionArmed()) return;
    haptic(25);
    send({ kind: 'turn', index: Number(d.turn) });
    // Réponse immédiate : la flèche choisie s'éclaire sans attendre le jeu.
    if (S.st?.junction && !S.st.junction.locked) S.st.junction.selected = Number(d.turn);
    return refresh();
  }
  if (d.cmd) {
    const c = simple(d.cmd);
    if (!c) return;
    haptic();
    flash(el);
    send(c);
    return refresh();
  }
  if (d.cam) {
    haptic();
    setLocal('camera', d.cam);
    send({ kind: 'camera', camera: d.cam as CameraMode });
    closePanel();
    return refresh();
  }
  if (d.tune) {
    const cur = withLocal('cameraTune', S.st?.cameraTune ?? { height: 0, tilt: 0 });
    const [axis, step] = d.tune.split(':');
    const cmd = d.tune === 'reset' ? { reset: true } : axis === 'height' ? { height: step === '1' ? (1 as const) : (-1 as const) } : { tilt: step === '1' ? (1 as const) : (-1 as const) };
    const next = stepCameraTune(cur, cmd);
    if (next.height === cur.height && next.tilt === cur.tilt) return haptic([10, 40, 10]);
    haptic();
    // Le réglage ne vaut que pour la caméra arrière : on y passe si une autre vue est affichée.
    if (withLocal('camera', S.st?.camera) !== 'chase') {
      setLocal('camera', 'chase');
      send({ kind: 'camera', camera: 'chase' });
    }
    setLocal('cameraTune', next);
    send({ kind: 'cameraTune', ...cmd });
    return refresh();
  }
  if (d.fan) {
    haptic();
    const percent = stepValue(withLocal('fan', S.st?.fanPercent ?? 0), d.fan === '1' ? 1 : -1, 10);
    setLocal('fan', percent);
    // Régler la force passe le ventilateur en mode fixe (côté jeu aussi).
    if (S.st?.fanMode) setLocal('fanMode', 'manual');
    send({ kind: 'fan', percent });
    return refresh();
  }
  if (d.fanmode) {
    haptic();
    setLocal('fanMode', d.fanmode);
    send({ kind: 'fanMode', mode: d.fanmode as PairFanMode });
    return refresh();
  }
  if (d.sound) {
    haptic();
    const bus = d.sound as PairSoundBus;
    const on = !withLocal(`snd-${bus}`, !!S.st?.sounds?.[bus]);
    setLocal(`snd-${bus}`, on);
    send({ kind: 'sound', bus, on });
    return refresh();
  }
  if (d.music) {
    haptic();
    flash(el);
    if (d.music === 'toggle') setLocal('playing', !withLocal('playing', !!S.st?.music?.playing));
    send({ kind: 'music', action: d.music as 'toggle' | 'next' | 'previous' });
    return refresh();
  }
  if (d.vol) {
    haptic();
    const volume = stepValue(withLocal('volume', S.st?.music?.volume ?? 0.5) * 100, d.vol === '1' ? 1 : -1, 10) / 100;
    setLocal('volume', volume);
    send({ kind: 'music', action: 'volume', volume });
    return refresh();
  }
  if (d.mplay !== undefined) {
    const item = S.music.items[Number(d.mplay)];
    if (!item) return;
    haptic(25);
    send({ kind: 'musicPlay', uri: item.uri });
    closePanel();
    showToast(item.name);
    return;
  }
  if (d.pgo !== undefined) {
    const item = S.place.items[Number(d.pgo)];
    if (!item) return;
    haptic(25);
    send({ kind: 'goTo', x: item.x, z: item.z, name: item.name });
    closePanel();
    return;
  }
  if (d.quick) {
    if (!S.st?.multiplayer) return;
    haptic(25);
    send({ kind: 'chat', text: d.quick });
    closePanel();
    showToast(`${t.sent} : ${d.quick}`);
    return;
  }
  if (d.rideon) {
    // Plusieurs joueurs : on choisit lequel ; un seul : c'est parti.
    if (d.rideon === 'pick') return openPanel('rideon');
    const who = humans(S.st).find((r) => r.id === d.rideon);
    if (!who) return;
    haptic(40);
    send({ kind: 'rideOn', to: who.id });
    if (S.panel === 'rideon') closePanel();
    showToast(`${t.rideOnSent} : ${who.name}`);
    return;
  }
  if (d.dens) {
    S.density = Number(d.dens) as Density;
    localStorage.setItem('ar-cmp-density', d.dens);
    renderPanel();
    return refresh();
  }
  if (d.slot !== undefined) {
    S.picking = Number(d.slot);
    return openPanel('pick');
  }
  if (d.pick) {
    S.fields[S.picking] = d.pick as FieldId;
    saveFields();
    closePanel();
    return refresh();
  }
  if (d.road) {
    haptic();
    const r = roadStep(withLocal('road', S.st?.roadFeel?.percent ?? 0), d.road === '1' ? 1 : -1, S.roadArmed);
    S.roadArmed = r.needsConfirm;
    if (!r.needsConfirm) {
      setLocal('road', Math.min(r.value, ROAD_FEEL.maxPercent));
      send({ kind: 'roadFeel', percent: r.value });
    }
    return refresh();
  }
}

/** Appui maintenu jusqu'au bout. */
export function held(name: string, el: HTMLElement, mic: PhoneMic): void {
  haptic([30, 40, 60]);
  flash(el);
  if (name === 'uturn') send({ kind: 'uturn' });
  else if (name === 'unpair') {
    void mic.stop(false);
    S.panel = null;
    unpair();
    // Plus de jeu appairé : l'écran peut se remettre en veille.
    syncWake();
    render();
  }
}
