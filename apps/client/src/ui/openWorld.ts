/**
 * « Monde ouvert » dans l'onglet Rouler : zones où l'on retrouve d'autres coureurs à tout moment
 * (salles publiques du serveur, sans hôte).
 *
 * - Carte de l'onglet : une ligne par zone avec l'affluence et les amis présents (GET /api/public/zones
 *   toutes les 25 s tant que le menu est affiché, comme la présence des amis).
 * - Un clic ouvre la fenêtre de la zone, au centre : tracé du parcours sur le Plan IGN et coureurs en ligne
 *   (rafraîchis toutes les 3 s). Les amis y portent leur nom et un bouton « Rejoindre » qui fait apparaître
 *   dans leur roue ; « Rejoindre le peloton » prend la salle la plus fréquentée.
 * La zone est jointe par le menu (`join`), qui charge d'abord le monde si besoin.
 */
import { FRIENDS_POLL_S, type PublicZoneDetail, type PublicZoneInfo, type RouteSummary, type WorldCatalogue } from '@allezrobert/shared';
import { getLang, strings } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import { dotsSvg, mapSvg, type Bounds, type MapInput } from './openWorldMap.ts';
import { arrivingLabel, friendsLabel, ridersLabel, zoneOfRoute } from './openWorldLabels.ts';
import './blocks.css';
import './openWorld.css';

const S = strings(
  {
    openWorld: 'Monde ouvert',
    meetOtherRidersAny: 'Retrouve d’autres coureurs, à tout moment. Fais demi-tour quand tu veux.',
    join: 'Rejoindre',
    ride: 'Rouler',
    close: 'Fermer',
    loadingTheMap: 'Chargement de la carte…',
    justStartedASession: 'vient de lancer sa session, il arrive…',
    ridingBackwards: 'roule à contresens',
    ridingTheRouteDirection: 'roule dans le sens du parcours',
    roomFull: 'Salle pleine',
    signIn: 'Se connecter',
    myFriendsHere: 'Mes amis ici',
    youStartRightBehind: 'Tu apparais dans la roue de ton ami, dans le même sens que lui.',
    noneOfYourFriends: 'Aucun ami en ligne ici pour l’instant.',
    signInToFind: 'Connecte-toi pour retrouver tes amis.',
    joinTheBunch: 'Rejoindre le peloton',
    signInToRide: 'Se connecter pour rouler',
    chatTAndVoice: 'Chat (T) et voix (V) : seulement avec les coureurs proches. Demi-tour : touche U.',
    mapUnavailableServerUnreachable: 'Carte indisponible : serveur injoignable.',
    ridersOnline: 'Coureurs en ligne',
    myFriends: 'Mes amis',
    start: 'Départ',
  },
  {
    openWorld: 'Open world',
    meetOtherRidersAny: 'Meet other riders any time. Turn around whenever you like.',
    join: 'Join',
    ride: 'Ride',
    close: 'Close',
    loadingTheMap: 'Loading the map…',
    justStartedASession: 'just started a session, joining…',
    ridingBackwards: 'riding backwards',
    ridingTheRouteDirection: 'riding the route direction',
    roomFull: 'Room full',
    signIn: 'Sign in',
    myFriendsHere: 'My friends here',
    youStartRightBehind: 'You start right behind your friend, riding the same way.',
    noneOfYourFriends: 'None of your friends are online here right now.',
    signInToFind: 'Sign in to find your friends.',
    joinTheBunch: 'Join the bunch',
    signInToRide: 'Sign in to ride',
    chatTAndVoice: 'Chat (T) and voice (V): nearby riders only. U-turn: U key.',
    mapUnavailableServerUnreachable: 'Map unavailable: server unreachable.',
    ridersOnline: 'Riders online',
    myFriends: 'My friends',
    start: 'Start',
  },
);

export { friendsLabel, ridersLabel, zoneOfRoute };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Rafraîchissement des coureurs sur la carte de la fenêtre (s). */
const MAP_POLL_S = 3;

export interface OpenWorldHooks {
  loggedIn(): boolean;
  login(): void;
  /** Catalogue des zones (pour relier un itinéraire public à sa zone). */
  zones(): WorldCatalogue['zones'];
  /** Rejoindre le monde ouvert d'un itinéraire public (monde `worldId`) ; `friendId` : apparaître dans la roue de cet ami. */
  join(routeId: string, worldId: string, friendId?: string): void;
}

export class OpenWorldPanel {
  private data: PublicZoneInfo[] | null = null;
  private root: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private dialog: { close(): void } | null = null;

  constructor(private readonly hooks: OpenWorldHooks) {}

  start(): void {
    this.stop();
    this.running = true;
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dialog?.close();
  }

  private async refresh(): Promise<void> {
    if (!this.running) return;
    if (typeof document === 'undefined' || !document.hidden || !this.data) {
      try {
        const r = await fetch(`${apiBase()}/public/zones`, { credentials: 'include' });
        this.data = r.ok ? ((await r.json()) as PublicZoneInfo[]) : null;
      } catch {
        this.data = null;
      }
      this.paint();
    }
    clearTimeout(this.timer);
    if (this.running) this.timer = setTimeout(() => void this.refresh(), FRIENDS_POLL_S * 1000);
  }

  /** Branche le panneau sur l'écran qui vient d'être dessiné (le conteneur `#m-openworld`). */
  mount(root: HTMLElement): void {
    this.root = root;
    const el = root.querySelector<HTMLElement>('#m-openworld');
    el?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ow-route]');
      if (btn) this.open(btn.dataset.owRoute as string, btn.dataset.owWorld as string);
    });
    this.paint();
  }

  private paint(): void {
    const el = this.root?.querySelector<HTMLElement>('#m-openworld');
    if (!el) return;
    const fr = getLang() === 'fr';
    const zones = this.hooks.zones();
    const rows = (this.data ?? [])
      .map((d) => ({ d, zone: zoneOfRoute(zones, d.routeId) }))
      .filter((x): x is { d: PublicZoneInfo; zone: WorldCatalogue['zones'][number] } => !!x.zone);
    // Serveur injoignable, aucune zone ouverte ou catalogue absent : rien à proposer.
    el.hidden = rows.length === 0;
    if (!rows.length) return el.replaceChildren();
    const html = `<div class="ow-top"><b class="ab-section">${S('openWorld')}</b><span>${S('meetOtherRidersAny')}</span></div>
      ${rows
        .map(({ d, zone }) => {
          // Amis qui viennent de lancer leur session : annoncés tout de suite, à part de ceux qui roulent déjà.
          const arriving = d.arriving ?? [];
          const friends = [friendsLabel(d.friends.filter((n) => !arriving.includes(n)), fr), arrivingLabel(arriving, fr)].filter(Boolean).join(' · ');
          return `<button type="button" class="ow-zone" data-ow-route="${esc(d.routeId)}" data-ow-world="${esc(zone.id)}">
            <span class="ow-name">${esc(zone.name)}<small>${esc(zone.region ?? '')}</small></span>
            <span class="ow-meta"><i class="ow-dot${d.riders > 0 ? ' on' : ''}"></i>${esc(ridersLabel(d.riders, fr))}${friends ? `<em>${esc(friends)}</em>` : ''}</span>
            <span class="ow-go">${d.riders > 0 ? S('join') : S('ride')}</span>
          </button>`;
        })
        .join('')}`;
    if ((el as HTMLElement & { _html?: string })._html !== html) {
      (el as HTMLElement & { _html?: string })._html = html;
      el.innerHTML = html;
    }
  }

  /** Fenêtre de la zone : carte du parcours et des coureurs en ligne, amis à rejoindre. */
  private open(routeId: string, worldId: string): void {
    this.dialog?.close();
    const fr = getLang() === 'fr';
    const zone = zoneOfRoute(this.hooks.zones(), routeId);
    const overlay = document.createElement('div');
    overlay.className = 'ow-modal';
    overlay.innerHTML = `<div class="ow-dialog" role="dialog" aria-modal="true" aria-label="${esc(zone?.name ?? routeId)}">
      <header><div><h2 class="ab-title">${esc(zone?.name ?? routeId)}</h2><p class="ab-sub">${S('openWorld')}</p></div><button type="button" class="ow-x" aria-label="${S('close')}">×</button></header>
      <div class="ow-body">
        <div class="ow-map" id="ow-map"><p class="mm-hint">${S('loadingTheMap')}</p></div>
        <aside class="ow-side" id="ow-side"></aside>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let input = null as MapInput | null;
    let bounds = null as Bounds | null;
    let detail = null as PublicZoneDetail | null;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (this.dialog === handle) this.dialog = null;
    };
    const handle = { close };
    this.dialog = handle;
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || (e.target as HTMLElement).closest('.ow-x')) close();
    });

    const join = (friendId?: string): void => {
      close();
      if (!this.hooks.loggedIn()) return this.hooks.login();
      this.hooks.join(routeId, worldId, friendId);
    };

    const paintSide = (): void => {
      const side = overlay.querySelector<HTMLElement>('#ow-side');
      if (!side) return;
      const logged = this.hooks.loggedIn();
      const riders = detail?.riders ?? 0;
      const friends = detail?.friends ?? [];
      const friendRows = friends
        .map(
          (f) => `<li><span class="ow-fname"><span><i class="ow-pin"></i>${esc(f.name)}</span><small>${f.loading ? S('justStartedASession') : f.dir === -1 ? S('ridingBackwards') : S('ridingTheRouteDirection')}</small></span>
            <button type="button" class="ab-btn ow-btn" data-ow-friend="${esc(f.id)}" ${f.full ? 'disabled' : ''}>${f.full ? S('roomFull') : logged ? S('join') : S('signIn')}</button></li>`,
        )
        .join('');
      const html = `<div class="ow-count"><i class="ow-dot${riders > 0 ? ' on' : ''}"></i><b>${esc(ridersLabel(riders, fr))}</b></div>
        <section class="ow-friends"><h3 class="ab-section">${S('myFriendsHere')}</h3>
          ${friends.length ? `<ul>${friendRows}</ul><p class="mm-hint">${S('youStartRightBehind')}</p>` : `<p class="mm-hint">${logged ? S('noneOfYourFriends') : S('signInToFind')}</p>`}
        </section>
        <button type="button" class="ab-btn ab-go ow-join" data-ow-peloton>${logged ? S('joinTheBunch') : S('signInToRide')}</button>
        <p class="mm-hint">${S('chatTAndVoice')}</p>`;
      // Rafraîchi toutes les 3 s : le DOM n'est refait que si le contenu change (sinon un clic en cours serait perdu).
      if (side.dataset.html === html) return;
      side.dataset.html = html;
      side.innerHTML = html;
    };
    overlay.querySelector('#ow-side')?.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const friend = t.closest<HTMLButtonElement>('[data-ow-friend]');
      if (friend) {
        if (!friend.disabled) join(friend.dataset.owFriend);
        return;
      }
      if (t.closest('[data-ow-peloton]')) join();
    });
    paintSide();

    const paintDots = (): void => {
      const g = overlay.querySelector('#ow-dots');
      if (g && input && bounds && detail) g.innerHTML = dotsSvg(input, detail.dots, bounds, fr);
    };
    const poll = async (): Promise<void> => {
      if (closed) return;
      try {
        const r = await fetch(`${apiBase()}/public/zones/${encodeURIComponent(routeId)}`, { credentials: 'include' });
        if (r.ok) detail = (await r.json()) as PublicZoneDetail;
      } catch {
        // Serveur injoignable : on garde la dernière carte.
      }
      if (closed) return;
      paintSide();
      paintDots();
      timer = setTimeout(() => void poll(), MAP_POLL_S * 1000);
    };

    // Tracé (serveur) et origine Lambert-93 du monde (fond de carte) ; la carte s'affiche dès que le tracé est là.
    void (async () => {
      const [summary, origin] = await Promise.all([
        fetch(`${apiBase()}/routes/${encodeURIComponent(routeId)}/summary`).then((r) => (r.ok ? (r.json() as Promise<RouteSummary>) : null)).catch(() => null),
        fetch(`/worlds/${encodeURIComponent(worldId)}/world.json`)
          .then((r) => (r.ok ? (r.json() as Promise<{ originL93?: { x: number; y: number } }>) : null))
          .then((w) => w?.originL93)
          .catch(() => undefined),
      ]);
      if (closed) return;
      const map = overlay.querySelector<HTMLElement>('#ow-map');
      if (!summary || !map) {
        if (map) map.innerHTML = `<p class="mm-hint">${S('mapUnavailableServerUnreachable')}</p>`;
        return;
      }
      input = { polyline: summary.polyline, lengthM: summary.lengthM, loop: summary.loop, origin };
      const m = mapSvg(input, detail?.dots ?? [], fr);
      bounds = m.bounds;
      map.innerHTML = `${m.svg}<div class="ow-legend"><span><i class="ow-key"></i>${S('ridersOnline')}</span><span><i class="ow-key friend"></i>${S('myFriends')}</span><span><i class="ow-key start"></i>${S('start')}</span></div>${origin ? '<small class="ow-attr">© IGN — Plan IGN</small>' : ''}`;
      paintDots();
    })();
    void poll();
  }
}
