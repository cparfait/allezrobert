/**
 * Écran de départ : avant de rouler, de gros blocs montrent chaque capteur (home trainer, puissance, cadence,
 * cardio, manettes, ventilateur) avec son état et sa valeur en direct, pendant que la sortie finit de se charger
 * derrière. Un clic sur un bloc lance l'association ou la reconnexion par le mécanisme de l'onglet Capteurs.
 *
 * La logique (quel bloc, quel état, bouton actif ou non) est dans des fonctions pures, testées
 * (test/startCheck.test.ts) ; l'affichage ne fait que les dessiner.
 */
import './startCheck.css';
import type { DeviceLive, DevicePanel } from './menu.ts';

export type CheckRole = 'trainer' | 'power' | 'cadence' | 'heartRate' | 'shifter' | 'fan';

/** État d'un bloc : valeur en direct, simulé, recherche en cours, signal perdu, rien d'associé. */
export type CheckState = 'live' | 'simulated' | 'searching' | 'lost' | 'none';

export interface CheckDevice {
  id: string;
  name: string;
  roleIds?: string[];
  simulated?: boolean;
  ok: boolean;
  /** État brut du gestionnaire d'appareils (connected, connecting, reconnecting, silent, error, disconnected). */
  raw?: string;
  canReconnect?: boolean;
  detail?: string;
}

export interface CheckInput {
  devices: readonly CheckDevice[];
  live?: DeviceLive | undefined;
  /** Simulateur autorisé dans les réglages (il ne roule que sans vrai capteur). */
  simulatorOn: boolean;
  /** La sortie a fini de se charger. */
  loaded: boolean;
}

export interface CheckTile {
  role: CheckRole;
  state: CheckState;
  /** Nom de l'appareil qui tient ce rôle (ou qui le fournit : home trainer, pédales). */
  device?: string;
  /** Puissance ou cadence fournie par un autre appareil que le capteur dédié. */
  via?: 'trainer' | 'pedals';
  /** Valeur en direct, déjà arrondie, et son unité. */
  value?: number | string;
  unit?: string;
  detail?: string;
  /** Capteur dont on peut se passer pour rouler. */
  optional: boolean;
  /** Ce que fait un clic sur le bloc. */
  action: 'pair' | 'reconnect' | 'none';
  /** Appareil à relancer (action « reconnect »). */
  deviceId?: string;
}

export interface CheckModel {
  tiles: CheckTile[];
  /** D'où viendra la puissance de la sortie. */
  powerSource: 'trainer' | 'power' | 'simulator' | 'none';
  canStart: boolean;
  /** Pourquoi le bouton de départ n'est pas actif (ou « ok »). */
  reason: 'ok' | 'loading' | 'noPower';
  /** Aucune source de puissance, mais le simulateur peut prendre le relais. */
  offerSimulator: boolean;
  /** Tous les capteurs associés répondent et une source de puissance est là. */
  allConnected: boolean;
}

export const CHECK_ROLES: readonly CheckRole[] = ['trainer', 'power', 'cadence', 'heartRate', 'shifter', 'fan'];
const OPTIONAL: ReadonlySet<CheckRole> = new Set<CheckRole>(['cadence', 'heartRate', 'shifter', 'fan']);
const SEARCHING = new Set(['connecting', 'reconnecting']);

/** État des blocs et du bouton de départ d'après les appareils connus. Fonction pure. */
export function startCheckModel(input: CheckInput): CheckModel {
  const live = input.live;
  const tiles = CHECK_ROLES.map((role): CheckTile => {
    const mine = input.devices.filter((d) => d.roleIds?.includes(role));
    const real = mine.filter((d) => !d.simulated);
    const optional = OPTIONAL.has(role);
    const liveValue = (): Pick<CheckTile, 'value' | 'unit'> => {
      if ((role === 'power' || role === 'trainer') && live?.watts !== undefined && (role === 'power' || live.powerFrom === 'trainer')) return { value: Math.round(live.watts), unit: 'W' };
      if (role === 'cadence' && live?.cadence !== undefined) return { value: Math.round(live.cadence), unit: 'tr/min' };
      if (role === 'heartRate' && live?.hr !== undefined) return { value: Math.round(live.hr), unit: 'bpm' };
      if (role === 'shifter' && live?.gear) return { value: live.gear };
      return {};
    };
    const realOk = real.find((d) => d.ok);
    if (realOk) return { role, state: 'live', device: realOk.name, optional, action: 'none', ...(realOk.detail ? { detail: realOk.detail } : {}), ...liveValue() };
    // Puissance et cadence sans capteur dédié : fournies par le home trainer ou les pédales.
    if (role === 'power' && live?.powerFrom === 'trainer' && live.powerName) return { role, state: 'live', device: live.powerName, via: 'trainer', optional, action: 'pair', ...liveValue() };
    if (role === 'cadence' && live?.cadenceName && (live.cadenceFrom === 'trainer' || live.cadenceFrom === 'pedals')) return { role, state: 'live', device: live.cadenceName, via: live.cadenceFrom, optional, action: 'pair', ...liveValue() };
    const searching = real.find((d) => SEARCHING.has(d.raw ?? ''));
    if (searching) return { role, state: 'searching', device: searching.name, optional, action: 'none' };
    const lost = real[0];
    if (lost) return { role, state: 'lost', device: lost.name, optional, action: lost.canReconnect ? 'reconnect' : 'pair', deviceId: lost.id };
    const sim = mine.find((d) => d.simulated && d.ok);
    if (sim && input.simulatorOn) return { role, state: 'simulated', device: sim.name, optional, action: 'pair', ...liveValue() };
    return { role, state: 'none', optional, action: 'pair' };
  });
  const state = (role: CheckRole): CheckState => (tiles.find((t) => t.role === role) as CheckTile).state;
  const tile = (role: CheckRole): CheckTile => tiles.find((t) => t.role === role) as CheckTile;
  // Le simulateur compte dès qu'il tourne, même si un vrai capteur associé ne répond plus (son bloc reste « signal perdu »).
  const simRuns = input.simulatorOn && input.devices.some((d) => d.simulated && d.ok && (d.roleIds?.includes('trainer') || d.roleIds?.includes('power')));
  const powerSource: CheckModel['powerSource'] =
    state('power') === 'live' && !tile('power').via ? 'power' : state('trainer') === 'live' || state('power') === 'live' ? 'trainer' : simRuns ? 'simulator' : 'none';
  const hasPower = powerSource !== 'none';
  const pending = tiles.some((t) => t.state === 'searching' || t.state === 'lost');
  return {
    tiles,
    powerSource,
    canStart: input.loaded && hasPower,
    reason: !hasPower ? 'noPower' : input.loaded ? 'ok' : 'loading',
    offerSimulator: !hasPower,
    allConnected: hasPower && !pending,
  };
}

/** Faut-il sauter l'écran ? Seulement si le joueur l'a demandé et que tout ce qui est associé répond. */
export function skipStartCheck(model: CheckModel, dontShowWhenReady: boolean): boolean {
  return dontShowWhenReady && model.allConnected;
}

/** Contexte du départ : les cas où l'écran ne doit pas retarder l'entrée dans la sortie. */
export interface StartContext {
  /** Paramètres d'URL des outils et des bancs : départ immédiat. */
  autostart: boolean;
  nointro: boolean;
  /** Invité sans matériel, tutoriel (qui a son propre appairage). */
  guest: boolean;
  tutorial: boolean;
  /** Entrée dans une salle qui existe déjà : code d'invitation, salle publique, ami à rejoindre. */
  joining: boolean;
}

/** L'écran de départ a-t-il sa place pour ce départ ? Fonction pure. */
export function startCheckWanted(ctx: StartContext): boolean {
  return !(ctx.autostart || ctx.nointro || ctx.guest || ctx.tutorial || ctx.joining);
}

const PREF_KEY = 'ar.startCheck.skipWhenReady';
const TRANSPORT_KEY = 'ar.startCheck.transport';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le choix vaut pour cette session seulement */
  }
}

/** Préférence « ne plus afficher si tout est connecté ». */
export function startCheckSkipPref(): boolean {
  return readPref(PREF_KEY) === '1';
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SVG = (d: string): string =>
  `<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<CheckRole, string> = {
  trainer: SVG('<circle cx="15" cy="30" r="9"/><path d="M15 30 26 14h10M26 14l8 16H15M34 30l6 8M10 42h32"/>'),
  power: SVG('<path d="M27 5 12 27h11l-3 16 16-23H25z"/>'),
  cadence: SVG('<circle cx="24" cy="24" r="16"/><path d="M24 24 33 15M24 8v4M40 24h-4M24 40v-4M8 24h4"/>'),
  heartRate: SVG('<path d="M24 41S6 30 6 18a9 9 0 0 1 18-2 9 9 0 0 1 18 2c0 12-18 23-18 23z"/><path d="M11 24h8l3-6 5 11 3-5h7"/>'),
  shifter: SVG('<circle cx="24" cy="24" r="7"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.5 10.5l4.3 4.3M33.2 33.2l4.3 4.3M10.5 37.5l4.3-4.3M33.2 14.8l4.3-4.3"/>'),
  fan: SVG('<circle cx="24" cy="24" r="3.5"/><path d="M24 20.5c-2-9 3-14 8-12 4 2 2 9-5 12.5M27.5 24c9-2 14 3 12 8-2 4-9 2-12.5-5M24 27.5c2 9-3 14-8 12-4-2-2-9 5-12.5M20.5 24c-9 2-14-3-12-8 2-4 9-2 12.5 5"/>'),
};

interface Texts {
  title: string;
  sub: string;
  role: Record<CheckRole, string>;
  hint: Record<CheckRole, string>;
  state: Record<CheckState, string>;
  optional: string;
  powerNeeded: string;
  viaTrainer: string;
  viaPedals: string;
  pair: string;
  reconnect: string;
  change: string;
  go: string;
  loading: string;
  noPower: string;
  useSim: string;
  skip: string;
  leave: string;
  connection: string;
  pairFailed: string;
  ready: string;
}

const TEXTS: Record<'fr' | 'en', Texts> = {
  fr: {
    title: 'Prêt à rouler ?',
    sub: 'Vérifie tes capteurs pendant que la sortie se prépare.',
    role: { trainer: 'Home trainer', power: 'Puissance', cadence: 'Cadence', heartRate: 'Cardio', shifter: 'Vitesses', fan: 'Ventilateur' },
    hint: { trainer: 'Résistance pilotée', power: 'Pédales ou manivelle', cadence: 'Capteur de cadence', heartRate: 'Ceinture ou montre', shifter: 'Manettes', fan: 'Ventilateur connecté' },
    state: { live: 'Connecté', simulated: 'Simulé', searching: 'Recherche…', lost: 'Signal perdu', none: 'Non associé' },
    optional: 'facultatif',
    powerNeeded: 'source de puissance',
    viaTrainer: 'via le home trainer',
    viaPedals: 'via les pédales',
    pair: 'Associer',
    reconnect: 'Reconnecter',
    change: 'Associer un capteur dédié',
    go: 'C’est parti',
    loading: 'La sortie finit de se charger…',
    noPower: 'Il faut une source de puissance : home trainer ou capteur de puissance.',
    useSim: 'Rouler avec le simulateur',
    skip: 'Ne plus afficher si tout est connecté',
    leave: 'Retour au menu',
    connection: 'Connexion',
    pairFailed: 'Association annulée ou impossible. Réessaie.',
    ready: 'Sortie prête',
  },
  en: {
    title: 'Ready to ride?',
    sub: 'Check your sensors while the ride gets ready.',
    role: { trainer: 'Trainer', power: 'Power', cadence: 'Cadence', heartRate: 'Heart rate', shifter: 'Shifting', fan: 'Fan' },
    hint: { trainer: 'Controlled resistance', power: 'Pedals or crank', cadence: 'Cadence sensor', heartRate: 'Strap or watch', shifter: 'Controllers', fan: 'Smart fan' },
    state: { live: 'Connected', simulated: 'Simulated', searching: 'Searching…', lost: 'Signal lost', none: 'Not paired' },
    optional: 'optional',
    powerNeeded: 'power source',
    viaTrainer: 'via the trainer',
    viaPedals: 'via the pedals',
    pair: 'Pair',
    reconnect: 'Reconnect',
    change: 'Pair a dedicated sensor',
    go: 'Let’s go',
    loading: 'The ride is still loading…',
    noPower: 'You need a power source: a trainer or a power meter.',
    useSim: 'Ride with the simulator',
    skip: 'Don’t show again when everything is connected',
    leave: 'Back to menu',
    connection: 'Connection',
    pairFailed: 'Pairing cancelled or failed. Try again.',
    ready: 'Ride ready',
  },
};

export interface StartCheckOptions {
  panel: DevicePanel;
  fr: boolean;
  /** Écran d'attente de la sortie : son avancement est repris ici, et son retrait marque la fin du chargement. */
  loading?: HTMLElement | null;
  /** Retour au menu demandé (la sortie n'a pas commencé). */
  onLeave(): void;
}

export interface StartCheckHandle {
  /** Résolu quand le joueur lance la sortie (jamais s'il retourne au menu). */
  readonly confirmed: Promise<void>;
  /** Le chargement de la sortie est fini (appelé aussi tout seul au retrait de l'écran d'attente). */
  loaded(): void;
  close(): void;
}

/** Affiche l'écran de départ par-dessus l'écran d'attente. Le chargement continue derrière. */
export function openStartCheck(parent: HTMLElement, o: StartCheckOptions): StartCheckHandle {
  const T = TEXTS[o.fr ? 'fr' : 'en'];
  const panel = o.panel;
  const el = document.createElement('div');
  el.className = 'sc';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', T.title);
  const transports = panel.transports();
  let transport = transports.find((t) => t.id === readPref(TRANSPORT_KEY))?.id ?? transports[0]?.id ?? '';
  let loaded = false;
  let closed = false;
  let busy: CheckRole | null = null;
  let failed: CheckRole | null = null;
  let resolve: () => void = () => undefined;
  const confirmed = new Promise<void>((r) => (resolve = r));

  el.innerHTML = `<div class="sc-box">
    <header class="sc-head">
      <div><h1>${T.title}</h1><p>${T.sub}</p></div>
      ${transports.length > 1 ? `<div class="sc-transport" role="radiogroup" aria-label="${T.connection}">${transports.map((t) => `<button type="button" role="radio" data-transport="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>` : ''}
    </header>
    <div class="sc-grid"></div>
    <p class="sc-msg" role="status" aria-live="polite"></p>
    <footer class="sc-foot">
      <div class="sc-load"><div class="sc-bar"><i></i></div><span class="sc-step"></span></div>
      <label class="sc-skip"><input type="checkbox" ${startCheckSkipPref() ? 'checked' : ''}/> <span>${T.skip}</span></label>
      <div class="sc-btns">
        <button type="button" class="sc-btn" data-act="leave">${T.leave}</button>
        <button type="button" class="sc-btn" data-act="sim" hidden>${T.useSim}</button>
        <button type="button" class="sc-btn sc-go" data-act="go" disabled>${T.go}</button>
      </div>
    </footer>
  </div>`;
  parent.appendChild(el);
  const grid = el.querySelector('.sc-grid') as HTMLElement;
  const msg = el.querySelector('.sc-msg') as HTMLElement;
  const goBtn = el.querySelector('[data-act="go"]') as HTMLButtonElement;
  const simBtn = el.querySelector('[data-act="sim"]') as HTMLButtonElement;
  const bar = el.querySelector('.sc-bar i') as HTMLElement;
  const step = el.querySelector('.sc-step') as HTMLElement;

  const model = (): CheckModel =>
    startCheckModel({ devices: panel.list() as CheckDevice[], live: panel.live?.(), simulatorOn: panel.simulatorOn(), loaded });

  let lastKey = '';
  let wasReady = false;
  const draw = (): void => {
    if (closed) return;
    const m = model();
    // Les blocs ne sont redessinés que si leur structure change ; les valeurs en direct sont mises à jour à part.
    const key = `${m.tiles.map((t) => `${t.role}:${t.state}:${t.device ?? ''}:${t.via ?? ''}:${t.action}`).join('|')}|${busy ?? ''}|${failed ?? ''}`;
    if (key !== lastKey) {
      lastKey = key;
      grid.innerHTML = m.tiles
        .map((t) => {
          const clickable = t.action !== 'none' && busy === null;
          const tag = t.optional ? T.optional : T.powerNeeded;
          const device = t.device ? `${esc(t.device)}${t.via ? ` · ${t.via === 'trainer' ? T.viaTrainer : T.viaPedals}` : ''}` : T.hint[t.role];
          const act = busy === t.role ? '…' : t.action === 'reconnect' ? T.reconnect : t.state === 'none' || t.state === 'lost' ? T.pair : t.action === 'pair' ? T.change : '';
          return `<button type="button" class="sc-tile is-${t.state}" data-role="${t.role}" ${clickable ? '' : 'aria-disabled="true"'}>
            <span class="sc-tag">${tag}</span>
            <span class="sc-ico">${ICONS[t.role]}</span>
            <b class="sc-role">${T.role[t.role]}</b>
            <span class="sc-dev">${device}</span>
            <span class="sc-val"><b data-val="${t.role}"></b><small data-unit="${t.role}"></small></span>
            <span class="sc-state"><i></i>${T.state[t.state]}${t.detail ? ` · ${esc(t.detail)}` : ''}</span>
            ${act ? `<span class="sc-act">${act}</span>` : ''}
          </button>`;
        })
        .join('');
    }
    for (const t of m.tiles) {
      const v = grid.querySelector<HTMLElement>(`[data-val="${t.role}"]`);
      const u = grid.querySelector<HTMLElement>(`[data-unit="${t.role}"]`);
      const text = t.value === undefined ? '' : String(t.value);
      if (v && v.textContent !== text) v.textContent = text;
      const unit = t.value === undefined ? '' : (t.unit ?? '');
      if (u && u.textContent !== unit) u.textContent = unit;
    }
    goBtn.disabled = !m.canStart;
    simBtn.hidden = !m.offerSimulator;
    const text = failed ? T.pairFailed : m.reason === 'noPower' ? T.noPower : m.reason === 'loading' ? T.loading : '';
    if (msg.textContent !== text) msg.textContent = text;
    msg.classList.toggle('warn', failed !== null || m.reason === 'noPower');
    if (m.canStart && !wasReady) goBtn.focus();
    wasReady = m.canStart;
    el.querySelectorAll<HTMLElement>('[data-transport]').forEach((b) => {
      const on = b.dataset.transport === transport;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener('keydown', onKey, true);
    el.remove();
  };
  const go = (): void => {
    if (closed || !model().canStart) return;
    close();
    resolve();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    // L'écran garde le clavier : les raccourcis du jeu ne doivent pas agir derrière lui.
    const t = e.target as HTMLElement | null;
    const onControl = !!t && el.contains(t) && (t.tagName === 'BUTTON' || t.tagName === 'INPUT');
    if (e.key === 'Enter' && !(onControl && t !== goBtn && (t as HTMLElement).tagName === 'BUTTON')) {
      e.preventDefault();
      e.stopPropagation();
      go();
      return;
    }
    // Les actions natives (Tab, Espace ou Entrée sur un bouton) restent : seule la propagation vers le jeu est coupée.
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tr = target.closest<HTMLElement>('[data-transport]');
    if (tr?.dataset.transport) {
      transport = tr.dataset.transport;
      writePref(TRANSPORT_KEY, transport);
      draw();
      return;
    }
    const actBtn = target.closest<HTMLElement>('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'go') go();
      else if (act === 'sim') {
        panel.useSimulator(true);
        draw();
      } else if (act === 'leave') {
        close();
        o.onLeave();
      }
      return;
    }
    const tileEl = target.closest<HTMLElement>('.sc-tile');
    if (!tileEl || busy !== null) return;
    const role = tileEl.dataset.role as CheckRole;
    const t = model().tiles.find((x) => x.role === role);
    if (!t || t.action === 'none') return;
    failed = null;
    if (t.action === 'reconnect' && t.deviceId && panel.reconnect) {
      panel.reconnect(t.deviceId);
      draw();
      return;
    }
    busy = role;
    draw();
    void panel
      .pair(role, transport)
      .catch(() => {
        failed = role;
      })
      .finally(() => {
        busy = null;
        draw();
      });
  });
  (el.querySelector('.sc-skip input') as HTMLInputElement).addEventListener('change', (e) => writePref(PREF_KEY, (e.target as HTMLInputElement).checked ? '1' : '0'));

  // Avancement repris de l'écran d'attente de la sortie (barre et étape) ; son retrait marque la fin du chargement.
  const syncLoad = (): void => {
    const src = o.loading;
    if (!src) return;
    const w = src.querySelector<HTMLElement>('.world-wait-bar i')?.style.width;
    if (w) bar.style.width = w;
    const label = src.querySelector<HTMLElement>('.world-wait-box > span')?.textContent ?? '';
    if (label && step.textContent !== label) step.textContent = label;
  };
  const markLoaded = (): void => {
    if (loaded) return;
    loaded = true;
    bar.style.width = '100%';
    step.textContent = T.ready;
    el.classList.add('is-loaded');
    draw();
  };
  let observer: MutationObserver | null = null;
  if (o.loading && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      if (o.loading && !o.loading.isConnected) markLoaded();
      else syncLoad();
    });
    observer.observe(o.loading, { subtree: true, attributes: true, childList: true, characterData: true });
    if (o.loading.parentNode) observer.observe(o.loading.parentNode, { childList: true });
  }
  syncLoad();

  panel.onChange(() => draw());
  // Valeurs en direct (watts, cadence, cardio) et fin du chargement, même sans notification du panneau.
  const timer = window.setInterval(() => {
    if (o.loading && !o.loading.isConnected) markLoaded();
    draw();
  }, 500);
  draw();
  return { confirmed, loaded: markLoaded, close };
}
