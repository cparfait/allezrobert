/** Liaison avec le jeu : salle Colyseus « pair » filtrée par le jeton du QR code (packages/shared/src/companion.ts). */
import { Client } from '@colyseus/sdk';
import { PAIR_MSG, PAIR_ROOM, PAIR_TOKEN_RE, type PairEvent, type PairPresence, type PairRoute, type PairState } from '@allezrobert/shared';
import { link, S } from './state.ts';

/* ?pair=…(&server=…) du QR code, mémorisé pour l'écran d'accueil. */
{
  const params = new URLSearchParams(location.search);
  const pair = params.get('pair');
  if (pair && PAIR_TOKEN_RE.test(pair)) {
    localStorage.setItem('ar-pair', pair);
    S.pair = pair;
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

/** Identifiant stable de ce téléphone (gardé sur l'appareil) : le serveur ne le compte qu'une fois, même reconnecté. */
function deviceId(): string {
  try {
    let id = localStorage.getItem('ar.companion.device');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
      localStorage.setItem('ar.companion.device', id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export interface LinkHandlers {
  onState(st: PairState): void;
  onRoute(r: PairRoute): void;
  onEvent(ev: PairEvent): void;
  onPresence(p: PairPresence, before: PairPresence): void;
  /** Connexion ouverte, perdue, ou en cours d'essai. */
  onConn(): void;
}

let handlers: LinkHandlers | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
/** Échecs de connexion d'affilée : le délai avant le prochain essai double à chaque fois (4 s, 8 s… 30 s au plus). */
let retryFails = 0;
const retryDelayMs = (): number => Math.min(30_000, 4000 * 2 ** Math.min(retryFails++, 3));

export function connect(h?: LinkHandlers): void {
  if (h) handlers = h;
  const cb = handlers;
  if (!cb || !S.pair || link.room || link.demo) return;
  clearTimeout(retry);
  S.conn = 'connecting';
  cb.onConn();
  const pair = S.pair;
  void new Client(serverEndpoint())
    .joinOrCreate(PAIR_ROOM, { pair, role: 'phone', device: deviceId() })
    .then((r) => {
      // Appairage oublié ou changé pendant la connexion.
      if (S.pair !== pair || link.room) {
        void r.leave(true).catch(() => undefined);
        return;
      }
      link.room = r;
      S.conn = 'connected';
      const joinedAt = Date.now();
      r.onMessage(PAIR_MSG.presence, (p: PairPresence) => {
        const before = S.presence;
        S.presence = p;
        if (!p.game) S.st = null;
        cb.onPresence(p, before);
      });
      r.onMessage(PAIR_MSG.state, (st: PairState) => cb.onState(st));
      r.onMessage(PAIR_MSG.route, (route: PairRoute) => cb.onRoute(route));
      r.onMessage(PAIR_MSG.event, (ev: PairEvent) => cb.onEvent(ev));
      r.onLeave(() => {
        link.room = null;
        const before = S.presence;
        S.presence = { game: false, phones: 0 };
        S.conn = 'down';
        cb.onPresence(S.presence, before);
        // Liaison tenue un moment puis perdue : nouvel essai rapide. Fermée aussitôt ouverte : délai croissant.
        const held = Date.now() - joinedAt >= 5000;
        if (held) retryFails = 0;
        retry = setTimeout(() => connect(), held ? 2000 : retryDelayMs());
      });
      cb.onConn();
    })
    .catch(() => {
      if (S.pair !== pair) return;
      S.conn = 'down';
      cb.onConn();
      retry = setTimeout(() => connect(), retryDelayMs());
    });
}

/** Oublie le jeu appairé. */
export function unpair(): void {
  localStorage.removeItem('ar-pair');
  localStorage.removeItem('ar-pair-server');
  S.pair = null;
  S.st = null;
  clearTimeout(retry);
  const r = link.room;
  link.room = null;
  r?.removeAllListeners();
  void r?.leave(true).catch(() => undefined);
  S.presence = { game: false, phones: 0 };
}

/** Lien complet du QR code collé à la main, ou jeton seul ; vrai s'il est valable. */
export function pairWith(raw: string): boolean {
  let pair = raw;
  let server: string | null = null;
  try {
    const u = new URL(raw);
    pair = u.searchParams.get('pair') ?? '';
    server = u.searchParams.get('server');
  } catch {
    /* jeton seul */
  }
  if (!PAIR_TOKEN_RE.test(pair)) return false;
  if (server && /^https?:\/\/[^\s]+$/.test(server)) localStorage.setItem('ar-pair-server', server);
  localStorage.setItem('ar-pair', pair);
  S.pair = pair;
  return true;
}
