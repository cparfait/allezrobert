/**
 * Appli compagnon d'Allez Robert ! (PWA, sans framework), appairée au jeu par QR code : pas de compte, marche en solo comme
 * en groupe (salle « pair », voir packages/shared/src/companion.ts).
 *
 * Pensée pour servir en pédalant : le téléphone est sur le cintre ou sur un pied, on le touche d'un doigt humide sans s'arrêter
 * de pousser. Règles de tous les écrans de sortie : rien à faire défiler, pas de curseur, pas de clavier, de grosses touches
 * toujours à la même place, un appui = un effet visible, et les chiffres essentiels jamais cachés. Ce qui demande de lire ou
 * d'écrire (réglages, chat, recherche) est dans des panneaux à part.
 *
 * Pages (barre du bas ou balayage) : Compteur, Carte, Actions, Groupe (s'il y a quelqu'un), Musique. Ce qui presse vient tout
 * seul : carrefour, montée façon ClimbPro, séance, départ, pause.
 */
import './style.css';
import { rideOnMessage, type PairEvent, type PairRoute, type PairState } from '@allezrobert/shared';
import { trackClimb } from './climb.ts';
import { climbsOf } from './climbs.ts';
import { goTab, held, press, TOUCHABLE } from './commands.ts';
import { showToast } from './dom.ts';
import { watchGestures } from './gestures.ts';
import { connect, pairWith, type LinkHandlers } from './link.ts';
import { neighbour, tabsFor } from './logic.ts';
import { RouteGeo } from './map.ts';
import { musicSearch, placeSearch, renderPanel, touchPanel, updatePanel } from './panels.ts';
import { PhoneMic, type PhoneMicError } from './phoneMic.ts';
import { refresh, render, updateMic, useMic } from './shell.ts';
import { curTab, haptic, isStale, lang, link, S, send, t } from './state.ts';
import { keepAwake, syncInstall, syncWake, watchInstall } from './wake.ts';

const app = document.getElementById('app')!;

/* ───────────── Micro du téléphone ───────────── */

const mic = new PhoneMic(send);
let micWelcomed = false;
mic.onChange = (error?: PhoneMicError, detail?: string) => {
  updateMic();
  if (error) {
    const msg = { insecure: t.micInsecure, denied: t.micDenied, none: t.micNone, failed: `${t.micFailed}${detail ? ` (${detail})` : ''}` }[error];
    showToast(msg);
    haptic([40, 60, 40]);
  } else if (mic.state === 'on' && !micWelcomed) {
    micWelcomed = true;
    showToast(t.micLinked);
  }
};
useMic(mic);

/* ───────────── Messages du jeu ───────────── */

function onState(st: PairState): void {
  const before = S.st?.phase;
  S.st = st;
  S.stAt = Date.now();
  mic.sync(st.phase === 'menu' ? undefined : st.voice);
  trackClimb();
  if ((before === 'menu') !== (st.phase === 'menu')) {
    // Début ou fin de sortie : les panneaux se referment, la proposition d'installation s'efface ou revient.
    if (S.panel && S.panel !== 'settings') {
      S.panel = null;
      renderPanel();
    }
    syncInstall();
  }
  refresh();
}

function onRoute(route: PairRoute): void {
  S.geo = new RouteGeo(route);
  S.climbs = climbsOf(S.geo);
  refresh();
}

function onEvent(ev: PairEvent): void {
  switch (ev.kind) {
    case 'voiceToken':
      return mic.onToken(ev);
    case 'phoneMic':
      haptic(15);
      return void mic.setOn(ev.on);
    case 'musicResults':
      if (ev.query !== S.music.query) return;
      S.music = { query: ev.query, state: ev.error ? 'error' : 'done', items: ev.items, error: ev.error ?? '' };
      return updatePanel();
    case 'placeResults':
      // Une réponse à une recherche plus ancienne que la dernière demande est ignorée.
      if (ev.query !== S.place.query) return;
      S.place = { query: ev.query, state: ev.error ? 'error' : 'done', items: ev.items, error: ev.error ?? '' };
      return updatePanel();
    case 'chat':
      S.chat.push({ who: ev.who, text: ev.text });
      haptic(20);
      if (S.panel !== 'chat') {
        S.unread++;
        showToast(ev.text, ev.who);
      }
      break;
    case 'toast':
    case 'rideOn': {
      const text = ev.kind === 'toast' ? ev.text : rideOnMessage(ev.from, lang);
      S.chat.push({ who: '', text, sys: true });
      showToast(text);
      break;
    }
  }
  if (S.chat.length > 80) S.chat.splice(0, S.chat.length - 80);
  refresh();
}

const handlers: LinkHandlers = {
  onState,
  onRoute,
  onEvent,
  onPresence: (p, before) => {
    if (!p.game && mic.linked) void mic.stop(false);
    if (!p.game && before.game) trackClimb();
    syncWake();
    refresh();
  },
  onConn: refresh,
};

/* ───────────── Doigts et clavier ───────────── */

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(TOUCHABLE);
  if (el && !(el as HTMLButtonElement).disabled) press(el, mic);
  touchPanel();
});

watchGestures(app, {
  swipe: (dir) => {
    if (!S.pair || S.panel) return;
    const next = neighbour(tabsFor(S.st), curTab(), dir);
    if (next !== curTab()) goTab(next);
  },
  hold: (name, el) => held(name, el, mic),
  holdShort: () => showToast(t.holdHint),
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  const blur = () => form.querySelector<HTMLInputElement>('input')?.blur();
  if (form.dataset.form === 'music') {
    musicSearch(String(data.get('q') ?? '').trim());
    blur();
  } else if (form.dataset.form === 'place') {
    placeSearch(String(data.get('q') ?? '').trim());
    blur();
  } else if (form.dataset.form === 'chat') {
    const text = String(data.get('text') ?? '').trim();
    if (text && S.st?.multiplayer) send({ kind: 'chat', text });
    form.reset();
  } else if (form.dataset.form === 'pair' && pairWith(String(data.get('link') ?? '').trim())) {
    render();
    connect();
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) S.orient = 'any';
  if (S.panel === 'settings') renderPanel();
});
// Redimensionnement (rotation) : les canvas se recalent.
window.addEventListener('resize', refresh);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  void keepAwake();
  if (!link.room) connect();
  else send({ kind: 'sync' });
});
// Certains navigateurs n'accordent le verrou d'écran qu'après un geste.
app.addEventListener('pointerdown', () => void keepAwake(), { passive: true });
// Jeu muet : l'avertissement apparaît même si plus rien n'arrive.
let wasStale = false;
setInterval(() => {
  if (isStale() !== wasStale) {
    wasStale = !wasStale;
    refresh();
  }
}, 1000);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js', { scope: './' }));
}

/* ───────────── Démarrage ───────────── */

watchInstall();
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('demo') : null;
if (demo !== null) {
  // Développement : sortie simulée, sans jeu ni serveur (voir dev/demo.ts).
  void import('./dev/demo.ts').then(({ startDemo }) => {
    startDemo(demo, handlers);
    render();
  });
} else {
  render();
  connect(handlers);
}
