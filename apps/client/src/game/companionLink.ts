/**
 * Lien avec l'appli compagnon appairée par QR code (salle « pair », voir
 * packages/shared/src/companion.ts) : marche en solo comme en groupe, sans compte.
 *
 * Le jeton d'appairage est tiré une fois et gardé (ar.pair) : un téléphone appairé se
 * raccroche tout seul à chaque sortie (la page se recharge entre deux sorties). « Nouveau QR
 * code » le renouvelle et déconnecte les téléphones déjà appairés.
 *
 * Le jeu ne pousse son état que lorsqu'un téléphone écoute (~4 Hz) ; l'état vient d'un
 * fournisseur posé par l'accueil puis par la sortie (`provider`), de même pour les commandes
 * (`onCommand`).
 */
import { Client, type Room } from '@colyseus/sdk';
import { PAIR_MSG, PAIR_ROOM, type PairEvent, type PairPresence, type PairRoute, type PairState, type PhoneCommand } from '@allezrobert/shared';
import { serverEndpoint } from './multiplayer.ts';

const TOKEN_KEY = 'ar.pair';
const STATE_HZ = 4;
const RETRY_MS = 5000;

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class CompanionLink {
  token: string;
  presence: PairPresence = { game: false, phones: 0 };
  connected = false;
  /** État du jeu à pousser vers les téléphones. */
  provider: (() => PairState) | null = null;
  onCommand: ((c: PhoneCommand) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private room: Room | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private lastRoute: PairRoute | null = null;
  private closed = false;

  constructor() {
    const saved = localStorage.getItem(TOKEN_KEY);
    this.token = saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved) ? saved : newToken();
    localStorage.setItem(TOKEN_KEY, this.token);
    setInterval(() => this.pushState(), 1000 / STATE_HZ);
    // Retour au premier plan : reconnexion immédiate si la salle a été perdue.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.room) this.connect();
    });
  }

  connect(): void {
    if (this.room || this.closed) return;
    clearTimeout(this.retry);
    void new Client(serverEndpoint())
      .joinOrCreate(PAIR_ROOM, { pair: this.token, role: 'game' })
      .then((room) => {
        this.room = room;
        this.connected = true;
        room.onMessage(PAIR_MSG.cmd, (c: PhoneCommand) => {
          if (c.kind === 'sync') {
            if (this.lastRoute) room.send(PAIR_MSG.route, this.lastRoute);
            this.pushState(true);
          }
          this.onCommand?.(c);
        });
        room.onMessage(PAIR_MSG.presence, (p: PairPresence) => {
          const arrived = p.phones > this.presence.phones;
          this.presence = p;
          if (arrived) this.pushState(true);
          this.notify();
        });
        room.onLeave(() => {
          this.room = null;
          this.connected = false;
          this.presence = { game: false, phones: 0 };
          this.notify();
          this.retry = setTimeout(() => this.connect(), RETRY_MS);
        });
        if (this.lastRoute) room.send(PAIR_MSG.route, this.lastRoute);
        this.notify();
      })
      .catch(() => {
        this.connected = false;
        this.notify();
        this.retry = setTimeout(() => this.connect(), RETRY_MS);
      });
  }

  /** Nouveau jeton : les téléphones appairés sont déconnectés, un nouveau QR code s'affiche. */
  regenerate(): void {
    this.token = newToken();
    localStorage.setItem(TOKEN_KEY, this.token);
    const room = this.room;
    this.room = null;
    this.connected = false;
    this.presence = { game: false, phones: 0 };
    clearTimeout(this.retry);
    if (room) {
      room.removeAllListeners();
      void room.leave(true).catch(() => undefined);
    }
    this.connect();
  }

  /** Prévenu quand le nombre de téléphones ou l'état de connexion change ; renvoie le désabonnement. */
  listen(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  notify(): void {
    for (const cb of [...this.listeners]) cb();
  }

  sendRoute(r: PairRoute): void {
    this.lastRoute = r;
    this.room?.send(PAIR_MSG.route, r);
  }

  sendEvent(e: PairEvent): void {
    if (this.presence.phones) this.room?.send(PAIR_MSG.event, e);
  }

  private pushState(force = false): void {
    if (!this.room || !this.provider || (!force && !this.presence.phones)) return;
    try {
      this.room.send(PAIR_MSG.state, this.provider());
    } catch (e) {
      console.warn('Compagnon : état illisible', e);
    }
  }

  /**
   * Adresse ouverte par le QR code. Production : /companion/ à côté du serveur (même origine
   * que /colyseus) ; appli de bureau : dérivée de VITE_SERVER_URL ; développement : adresse du
   * réseau local (le téléphone ne joint pas « localhost »), serveur passé en paramètre.
   */
  async url(): Promise<string> {
    const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
    const pair = `pair=${this.token}`;
    if (env.VITE_COMPANION_URL) return `${env.VITE_COMPANION_URL}${env.VITE_COMPANION_URL.includes('?') ? '&' : '?'}${pair}`;
    const endpoint = serverEndpoint();
    if (/\/colyseus\/?$/.test(endpoint)) return `${endpoint.replace(/\/colyseus\/?$/, '/companion/')}?${pair}`;
    let host = new URL(endpoint).hostname;
    if (env.DEV && (host === 'localhost' || host === '127.0.0.1')) {
      const lan: { ip?: string } = await fetch('/__lan')
        .then((r) => (r.ok ? (r.json() as Promise<{ ip?: string }>) : {}))
        .catch(() => ({}));
      if (lan.ip) host = lan.ip;
    }
    const server = new URL(endpoint);
    server.hostname = host;
    return `http://${host}:5174/?${pair}&server=${encodeURIComponent(server.origin)}`;
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.retry);
    void this.room?.leave(true).catch(() => undefined);
  }
}

/** Instance unique : l'accueil et la sortie partagent le même lien. */
export const companion = new CompanionLink();
