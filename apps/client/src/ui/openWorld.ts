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
import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import { dotsSvg, mapSvg, type Bounds, type MapInput } from './openWorldMap.ts';
import { arrivingLabel, friendsLabel, ridersLabel, zoneOfRoute } from './openWorldLabels.ts';
import './openWorld.css';

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
    const html = `<div class="ow-top"><b>${fr ? 'Monde ouvert' : 'Open world'}</b><span>${fr ? 'Retrouve d’autres coureurs, à tout moment. Fais demi-tour quand tu veux.' : 'Meet other riders any time. Turn around whenever you like.'}</span></div>
      ${rows
        .map(({ d, zone }) => {
          // Amis qui viennent de lancer leur session : annoncés tout de suite, à part de ceux qui roulent déjà.
          const arriving = d.arriving ?? [];
          const friends = [friendsLabel(d.friends.filter((n) => !arriving.includes(n)), fr), arrivingLabel(arriving, fr)].filter(Boolean).join(' · ');
          return `<button type="button" class="ow-zone" data-ow-route="${esc(d.routeId)}" data-ow-world="${esc(zone.id)}">
            <span class="ow-name">${esc(zone.name)}<small>${esc(zone.region ?? '')}</small></span>
            <span class="ow-meta"><i class="ow-dot${d.riders > 0 ? ' on' : ''}"></i>${esc(ridersLabel(d.riders, fr))}${friends ? `<em>${esc(friends)}</em>` : ''}</span>
            <span class="ow-go">${d.riders > 0 ? (fr ? 'Rejoindre' : 'Join') : fr ? 'Rouler' : 'Ride'}</span>
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
      <header><div><small>${fr ? 'Monde ouvert' : 'Open world'}</small><h2>${esc(zone?.name ?? routeId)}</h2></div><button type="button" class="ow-x" aria-label="${fr ? 'Fermer' : 'Close'}">×</button></header>
      <div class="ow-body">
        <div class="ow-map" id="ow-map"><p class="mm-hint">${fr ? 'Chargement de la carte…' : 'Loading the map…'}</p></div>
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
          (f) => `<li><span class="ow-fname"><span><i class="ow-pin"></i>${esc(f.name)}</span><small>${f.loading ? (fr ? 'vient de lancer sa session, il arrive…' : 'just started a session, joining…') : f.dir === -1 ? (fr ? 'roule à contresens' : 'riding backwards') : fr ? 'roule dans le sens du parcours' : 'riding the route direction'}</small></span>
            <button type="button" class="ow-btn" data-ow-friend="${esc(f.id)}" ${f.full ? 'disabled' : ''}>${f.full ? (fr ? 'Salle pleine' : 'Room full') : logged ? (fr ? 'Rejoindre' : 'Join') : fr ? 'Se connecter' : 'Sign in'}</button></li>`,
        )
        .join('');
      const html = `<div class="ow-count"><i class="ow-dot${riders > 0 ? ' on' : ''}"></i><b>${esc(ridersLabel(riders, fr))}</b></div>
        <section class="ow-friends"><h3>${fr ? 'Mes amis ici' : 'My friends here'}</h3>
          ${friends.length ? `<ul>${friendRows}</ul><p class="mm-hint">${fr ? 'Tu apparais dans la roue de ton ami, dans le même sens que lui.' : 'You start right behind your friend, riding the same way.'}</p>` : `<p class="mm-hint">${logged ? (fr ? 'Aucun ami en ligne ici pour l’instant.' : 'None of your friends are online here right now.') : fr ? 'Connecte-toi pour retrouver tes amis.' : 'Sign in to find your friends.'}</p>`}
        </section>
        <button type="button" class="ow-join" data-ow-peloton>${logged ? (fr ? 'Rejoindre le peloton' : 'Join the bunch') : fr ? 'Se connecter pour rouler' : 'Sign in to ride'}</button>
        <p class="mm-hint">${fr ? 'Chat (T) et voix (V) : seulement avec les coureurs proches. Demi-tour : touche U.' : 'Chat (T) and voice (V): nearby riders only. U-turn: U key.'}</p>`;
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
        if (map) map.innerHTML = `<p class="mm-hint">${fr ? 'Carte indisponible : serveur injoignable.' : 'Map unavailable: server unreachable.'}</p>`;
        return;
      }
      input = { polyline: summary.polyline, lengthM: summary.lengthM, loop: summary.loop, origin };
      const m = mapSvg(input, detail?.dots ?? [], fr);
      bounds = m.bounds;
      map.innerHTML = `${m.svg}<div class="ow-legend"><span><i class="ow-key"></i>${fr ? 'Coureurs en ligne' : 'Riders online'}</span><span><i class="ow-key friend"></i>${fr ? 'Mes amis' : 'My friends'}</span><span><i class="ow-key start"></i>${fr ? 'Départ' : 'Start'}</span></div>${origin ? '<small class="ow-attr">© IGN — Plan IGN</small>' : ''}`;
      paintDots();
    })();
    void poll();
  }
}
