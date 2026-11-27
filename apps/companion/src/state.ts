/** État de l'appli, préférences gardées sur le téléphone, envoi des commandes au jeu. */
import type { Room } from '@colyseus/sdk';
import { PAIR_MSG, type Climb, type ClimbAhead, type PairMusicItem, type PairPlaceItem, type PairPresence, type PairState, type PhoneCommand } from '@allezrobert/shared';
import { detectLang, STRINGS, type Lang, type Strings } from './i18n.ts';
import { readTab, tabsFor, type Density, type Tab } from './logic.ts';
import type { RouteGeo } from './map.ts';

export type FieldId = keyof Strings['fields'];
export type Metrics = NonNullable<PairState['metrics']>;
/** Panneau ouvert par-dessus la page. */
export type PanelId = 'camera' | 'view' | 'fan' | 'sound' | 'screen' | 'quick' | 'rideon' | 'chat' | 'search' | 'dest' | 'settings' | 'pick';

export const DEFAULT_FIELDS: FieldId[] = ['power3s', 'speed', 'cadence', 'hr', 'time', 'distance', 'grade'];
export const ALL_FIELDS = Object.keys(STRINGS.fr.fields) as FieldId[];

export let lang: Lang = detectLang();
export let t: Strings = STRINGS[lang];
export function setLang(l: Lang): void {
  lang = l;
  t = STRINGS[l];
  localStorage.setItem('ar-lang', l);
  document.documentElement.lang = l;
}

function loadFields(): FieldId[] {
  try {
    const f = JSON.parse(localStorage.getItem('ar-cmp-fields') ?? 'null') as FieldId[] | null;
    if (Array.isArray(f) && f.length === DEFAULT_FIELDS.length && f.every((x) => ALL_FIELDS.includes(x))) return f;
  } catch {
    /* champs par défaut */
  }
  return [...DEFAULT_FIELDS];
}

function loadDensity(): Density {
  const n = Number(localStorage.getItem('ar-cmp-density'));
  return n === 3 || n === 7 ? n : 5;
}

type SearchState = 'idle' | 'loading' | 'done' | 'error';

export const S = {
  pair: localStorage.getItem('ar-pair'),
  conn: 'connecting' as 'connecting' | 'connected' | 'down',
  presence: { game: false, phones: 0 } as PairPresence,
  st: null as PairState | null,
  /** Heure du dernier état reçu du jeu. */
  stAt: 0,
  geo: null as RouteGeo | null,
  tab: readTab(localStorage.getItem('ar-cmp-tab')),
  panel: null as PanelId | null,
  follow: true,
  chat: [] as Array<{ who: string; text: string; sys?: boolean }>,
  unread: 0,
  fields: loadFields(),
  density: loadDensity(),
  /** Champ en cours de choix (indice) dans les réglages. */
  picking: 0,
  orient: 'any' as 'any' | 'landscape' | 'portrait',
  /** Montées de la route reçue, montée en cours ou à moins de 500 m du pied. */
  climbs: [] as Climb[],
  climb: null as ClimbAhead | null,
  /** Page de la montée fermée par le coureur (jusqu'au sommet). */
  climbHidden: false,
  /** Le coureur remonte la route à l'envers (demi-tour) : pas de montées. */
  backwards: false,
  music: { query: '', state: 'idle' as SearchState, items: [] as PairMusicItem[], error: '' },
  place: { query: '', state: 'idle' as SearchState, items: [] as PairPlaceItem[], error: '' },
  /** Ressenti route : un second appui est attendu pour passer en « très fort ». */
  roadArmed: false,
};

/** Valeurs tapées à l'instant : affichées tout de suite, jusqu'à ce que le jeu les renvoie. */
const local = new Map<string, { v: unknown; at: number }>();
export function setLocal(key: string, v: unknown): void {
  local.set(key, { v, at: Date.now() });
}
export function withLocal<T>(key: string, fromGame: T): T {
  const l = local.get(key);
  return l && Date.now() - l.at < 1500 ? (l.v as T) : fromGame;
}

export const inRide = (): boolean => !!S.st && S.st.phase !== 'menu' && !!S.st.metrics;
/** Chiffres figés : liaison perdue, jeu parti ou muet depuis plusieurs secondes. */
export const isStale = (): boolean => S.conn !== 'connected' || !S.presence.game || (S.stAt > 0 && Date.now() - S.stAt > 5000);

/** Page affichée : la dernière choisie, ou le compteur si elle n'existe pas dans cette sortie (Groupe en solo). */
export const curTab = (): Tab => (tabsFor(S.st).includes(S.tab) ? S.tab : 'dash');

export function setTabPref(tab: Tab): void {
  S.tab = tab;
  localStorage.setItem('ar-cmp-tab', tab);
}

/** Liaison courante avec la salle « pair » (posée par link.ts) ; `demo` remplace le jeu en développement. */
export const link = { room: null as Room | null, demo: null as ((c: PhoneCommand) => void) | null };

export function send(cmd: PhoneCommand): void {
  if (link.demo) link.demo(cmd);
  else link.room?.send(PAIR_MSG.cmd, cmd);
}

export function haptic(p: number | number[] = 12): void {
  navigator.vibrate?.(p);
}
