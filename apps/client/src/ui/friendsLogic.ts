/**
 * Amis côté client, logique pure (sans DOM ni réseau, testée dans apps/client/test) :
 * lien d'ajout `/?ami=CODE`, tri par présence, libellés, pastille, réglages pour rejoindre.
 */
import {
  forwardRouteId,
  parseStartedRouteId,
  FRIEND_LINK_PARAM,
  isFriendCode,
  normalizeFriendCode,
  type FriendEntry,
  type FriendJoinInfo,
  type FriendPresence,
  type FriendsOverview,
  type RideMode,
} from '@allezrobert/shared';

type Lang = 'fr' | 'en';

/** Code ami valide trouvé dans la barre d'adresse (`?ami=k7qm-2xra`), sinon null. */
export function friendCodeFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(FRIEND_LINK_PARAM);
  if (!raw) return null;
  const code = normalizeFriendCode(raw);
  return isFriendCode(code) ? code : null;
}

/** Lien à partager : ouvre le jeu avec la demande d'ami pré-remplie. */
export function friendLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?${FRIEND_LINK_PARAM}=${normalizeFriendCode(code)}`;
}

/** Adresse sans le paramètre `ami` (une fois le code mis de côté, il ne doit pas resservir). */
export function withoutFriendParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FRIEND_LINK_PARAM);
  return url.toString();
}

const RANK: Record<FriendPresence['state'], number> = { riding: 0, online: 1, offline: 2 };

/** Ceux qui roulent d'abord, puis en ligne, puis hors ligne ; ordre alphabétique ensuite. */
export function sortFriends<T extends Pick<FriendEntry, 'name' | 'presence'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => RANK[a.presence.state] - RANK[b.presence.state] || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/** Pastille verte de l'onglet Amis : amis connectés (dans le menu ou en train de rouler). */
export function onlineCount(o: Pick<FriendsOverview, 'friends'> | null): number {
  return o ? o.friends.filter((f) => f.presence.state !== 'offline').length : 0;
}

/** Pastille de l'onglet Amis : demandes reçues + invitations à rouler. */
export function badgeCount(o: Pick<FriendsOverview, 'incoming' | 'invites'> | null): number {
  return o ? o.incoming.length + o.invites.length : 0;
}

export function modeLabel(mode: RideMode, lang: Lang): string {
  const fr: Record<RideMode, string> = { free: 'sortie libre', group: 'sortie de groupe', race: 'course', workout: 'entraînement', ftpTest: 'test FTP', challenge: 'défi KOM', open: 'monde ouvert' };
  const en: Record<RideMode, string> = { free: 'free ride', group: 'group ride', race: 'race', workout: 'workout', ftpTest: 'FTP test', challenge: 'KOM challenge', open: 'open world' };
  return (lang === 'fr' ? fr : en)[mode] ?? mode;
}

export function ridersLabel(n: number, lang: Lang): string {
  return lang === 'fr' ? `${n} coureur${n > 1 ? 's' : ''}` : `${n} rider${n > 1 ? 's' : ''}`;
}

/**
 * Statut d'un ami en deux parties : l'état (« Hors ligne », « En ligne · dans le menu »,
 * « Roule · sortie de groupe · 3 coureurs ») et, s'il roule, l'itinéraire (`routeName` traduit
 * l'identifiant : nom local, sinon celui de la sortie).
 */
export function presenceParts(p: FriendPresence, lang: Lang, routeName?: (id: string) => string | undefined): { state: string; where?: string } {
  if (p.state === 'offline') return { state: lang === 'fr' ? 'Hors ligne' : 'Offline' };
  if (p.state === 'online') return { state: lang === 'fr' ? 'En ligne · dans le menu' : 'Online · in the menu' };
  const verb = p.withYou ? (lang === 'fr' ? 'Roule avec toi' : 'Riding with you') : lang === 'fr' ? 'Roule' : 'Riding';
  return { state: `${verb} · ${modeLabel(p.ride.mode, lang)} · ${ridersLabel(p.ride.riders, lang)}`, where: routeName?.(p.ride.routeId) ?? p.ride.name };
}

/** Statut sur une ligne : « Roule · Boucle · sortie de groupe · 3 coureurs ». */
export function presenceLabel(p: FriendPresence, lang: Lang, routeName?: (id: string) => string | undefined): string {
  const { state, where } = presenceParts(p, lang, routeName);
  if (!where) return state;
  const [head, ...rest] = state.split(' · ');
  return [head, where, ...rest].join(' · ');
}

/** Temps restant d'une invitation : « encore 24 min », « expire bientôt ». */
export function remainingLabel(expiresAt: string, now: number, lang: Lang): string {
  const min = Math.floor((Date.parse(expiresAt) - now) / 60_000);
  if (!Number.isFinite(min) || min < 1) return lang === 'fr' ? 'expire bientôt' : 'expires soon';
  return lang === 'fr' ? `encore ${min} min` : `${min} min left`;
}

/** Temps de segment : « 4:38 », « 1:02:03 ». */
export function segmentTime(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Initiales pour la pastille d'un ami (« Jean-Pierre Dupont » → « JD »). */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/**
 * Réglages pour rejoindre la sortie d'un ami : mode groupe ou course (sinon groupe), et son
 * itinéraire s'il existe dans le monde chargé (sinon on garde l'itinéraire courant).
 */
export function joinSettings(
  info: Pick<FriendJoinInfo, 'mode' | 'routeId'>,
  routeIds: readonly string[],
  current: { mode: RideMode; routeId: string; reverse?: boolean; startM?: number },
): { mode: 'group' | 'race'; routeId: string; reverse: boolean; startM: number; routeKnown: boolean } {
  // un ami parti d'un autre point de la boucle, ou sur un parcours inversé : même départ, même sens
  const started = parseStartedRouteId(info.routeId);
  const dirId = started?.id ?? info.routeId;
  const fwd = forwardRouteId(dirId);
  const id = fwd && routeIds.includes(fwd) ? fwd : dirId;
  const routeKnown = routeIds.includes(id);
  const mode = info.mode === 'race' ? 'race' : 'group';
  return routeKnown
    ? { mode, routeId: id, reverse: id !== dirId, startM: started?.startM ?? 0, routeKnown }
    : { mode, routeId: current.routeId, reverse: !!current.reverse, startM: current.startM ?? 0, routeKnown };
}

/** Message d'erreur de l'API (champ `error`) à afficher. */
export function friendErrorMessage(code: string | undefined, lang: Lang): string {
  const fr: Record<string, string> = {
    unknown_code: 'Aucun coureur avec ce code.',
    bad_code: 'Le code ami fait 8 caractères (ex. K7QM-2XRA).',
    self: 'C’est ton propre code ami !',
    already_friends: 'Vous êtes déjà amis.',
    already_requested: 'Demande déjà envoyée.',
    too_many_friends: 'Tu as atteint le nombre maximal d’amis.',
    too_many_requests: 'Trop de demandes en attente.',
    target_full: 'Ce coureur ne peut plus recevoir de demande.',
    rate_limited: 'Trop d’essais : réessaie dans quelques minutes.',
    not_riding: 'Ton ami ne roule plus.',
    not_found: 'Introuvable (invitation expirée ou sortie terminée ?).',
    unauthorized: 'Connecte-toi pour retrouver tes amis.',
    forbidden: 'Tu ne roules pas dans cette sortie.',
    network: 'Serveur injoignable.',
  };
  const en: Record<string, string> = {
    unknown_code: 'No rider with this code.',
    bad_code: 'A friend code has 8 characters (e.g. K7QM-2XRA).',
    self: 'That is your own friend code!',
    already_friends: 'You are already friends.',
    already_requested: 'Request already sent.',
    too_many_friends: 'You have reached the maximum number of friends.',
    too_many_requests: 'Too many pending requests.',
    target_full: 'This rider cannot receive requests anymore.',
    rate_limited: 'Too many attempts: try again in a few minutes.',
    not_riding: 'Your friend is no longer riding.',
    not_found: 'Not found (invite expired or ride over?).',
    unauthorized: 'Sign in to see your friends.',
    forbidden: 'You are not riding in this ride.',
    network: 'Server unreachable.',
  };
  const table = lang === 'fr' ? fr : en;
  return table[code ?? ''] ?? (lang === 'fr' ? 'Action impossible pour le moment.' : 'Could not do that right now.');
}
