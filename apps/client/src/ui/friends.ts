/**
 * Onglet « Amis » du menu principal et invitations en cours de sortie.
 *
 * - Mon code ami (copier, lien `/?ami=CODE`, nouveau code), ajout par code ou par lien.
 * - Demandes reçues / envoyées, invitations à rouler reçues (aussi en bandeau sur tous les
 *   onglets), liste des amis avec présence : hors ligne, dans le menu, en train de rouler
 *   (« Rejoindre » en un clic, sans code : le serveur ne le donne qu'aux amis).
 * - Cocher des amis puis « Partir et inviter » : la sortie de groupe est créée et les amis
 *   cochés reçoivent l'invitation (main.ts → sendRideInvites).
 * - Classements entre amis des segments de l'itinéraire choisi, records d'un ami.
 *
 * Présence et nouveautés : GET /api/friends toutes les 25 s tant que le menu est affiché
 * (interrogation légère plutôt qu'un canal temps réel : voir apps/server/src/friends/hub.ts).
 */
import { findRoute } from '../game/direction.ts';
import { formatFriendCode, FRIEND_INVITE_MAX, FRIENDS_POLL_S, type FriendJoinInfo, type FriendRequestResult, type FriendsOverview, type RouteData } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import {
  badgeCount,
  friendCodeFromSearch,
  friendErrorMessage,
  friendLink,
  initials,
  modeLabel,
  onlineCount,
  presenceLabel,
  presenceParts,
  remainingLabel,
  ridersLabel,
  segmentTime,
  sortFriends,
  withoutFriendParam,
} from './friendsLogic.ts';
import './friends.css';

const PENDING_KEY = 'ar.friendCode';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const fr = () => getLang() === 'fr';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${apiBase()}${path}`, {
      method,
      credentials: 'include',
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (r.ok) return { ok: true, data: json as T };
    return { ok: false, error: (json as { error?: string } | null)?.error ?? 'error' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Lien `/?ami=CODE` : le code est mis de côté (il survit à une connexion OAuth dans le même
 * onglet) et retiré de l'adresse ; l'onglet Amis le propose ensuite.
 */
function capturePendingCode(): void {
  try {
    const code = friendCodeFromSearch(location.search);
    if (!code) return;
    sessionStorage.setItem(PENDING_KEY, code);
    history.replaceState(null, '', withoutFriendParam(location.href));
  } catch {
    // Stockage indisponible (navigation privée stricte) : le lien est simplement ignoré.
  }
}
capturePendingCode();

function pendingCode(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPendingCode(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // rien à faire
  }
}

/** Invite des amis (identifiants de relation) dans la sortie en cours ; renvoie le nombre d'invitations. */
export async function sendRideInvites(roomId: string, friendIds: string[]): Promise<number> {
  if (!roomId || !friendIds.length) return 0;
  const r = await call<{ sent: number }>('POST', '/friends/invites', { roomId, friends: friendIds.slice(0, FRIEND_INVITE_MAX) });
  return r.ok ? r.data.sent : 0;
}

export interface FriendsHooks {
  loggedIn(): boolean;
  login(): void;
  routes: RouteData[];
  currentRouteId(): string;
  /** Rejoindre la sortie d'un ami (code fourni par le serveur). */
  join(info: FriendJoinInfo): void;
  /** Créer une sortie de groupe et y inviter ces amis. */
  rideWith(friendIds: string[]): void;
}

export class FriendsPanel {
  private data: FriendsOverview | null = null;
  private failure: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private root: HTMLElement | null = null;
  private tabOpen = false;
  private painted = '';
  private readonly selected = new Set<string>();
  private msg: { text: string; ok: boolean } | null = null;
  private boards: { routeId: string; at: number; html: string } | null = null;
  private bests: { id: string; html: string } | null = null;

  constructor(private readonly hooks: FriendsHooks) {}

  /** Un lien d'ami attend d'être traité (le menu ouvre alors l'onglet Amis). */
  hasPendingCode(): boolean {
    return !!pendingCode();
  }

  /** Interrogation périodique tant que le menu est affiché (compte connecté seulement). */
  start(): void {
    this.stop();
    this.running = true;
    if (!this.hooks.loggedIn()) {
      this.data = null;
      return;
    }
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.running || !this.hooks.loggedIn()) return;
    this.timer = setTimeout(() => void this.refresh(), (this.data?.pollS ?? FRIENDS_POLL_S) * 1000);
  }

  async refresh(): Promise<void> {
    if (!this.hooks.loggedIn()) return;
    // Onglet en arrière-plan : on attend le prochain tour sans solliciter le serveur.
    if (typeof document !== 'undefined' && document.hidden && this.data) return this.schedule();
    const r = await call<FriendsOverview>('GET', '/friends');
    if (r.ok) {
      this.data = r.data;
      this.failure = null;
      // Amis retirés entre-temps : plus cochés.
      for (const id of this.selected) if (!r.data.friends.some((f) => f.id === id)) this.selected.delete(id);
    } else {
      this.failure = r.error;
    }
    this.paint();
    this.schedule();
  }

  badgeHtml(): string {
    const n = this.hooks.loggedIn() ? badgeCount(this.data) : 0;
    const on = this.hooks.loggedIn() ? onlineCount(this.data) : 0;
    return `<span class="mm-online" ${on ? '' : 'hidden'} title="${this.onlineTitle(on)}">${on}</span><span class="mm-badge" ${n ? '' : 'hidden'}>${n}</span>`;
  }

  private onlineTitle(n: number): string {
    return fr() ? `${n} ami${n > 1 ? 's' : ''} en ligne` : `${n} friend${n > 1 ? 's' : ''} online`;
  }

  // ————————————————————————————————————————————— Rendu

  /** Panneau de l'onglet (les parties vivantes sont remplies par paint()). */
  html(): string {
    const L = fr();
    const head = `<header class="mm-head"><h2>${L ? 'Amis' : 'Friends'}</h2><p>${L ? 'Ajoute tes amis avec leur code ami, vois qui roule et rejoins-les en un clic.' : 'Add friends with their friend code, see who is riding and join them in one click.'}</p></header>`;
    const close = `<button class="mm-close" data-tab="ride" aria-label="${L ? 'Fermer' : 'Close'}" title="${L ? 'Fermer (Échap)' : 'Close (Esc)'}">×</button>`;
    if (!this.hooks.loggedIn()) {
      const code = pendingCode();
      return `<section class="mm-panel mm-center mm-xl fr-panel">${close}${head}
        <div class="fr-empty fr-signin">
          <b>${L ? 'Connecte-toi pour retrouver tes amis' : 'Sign in to find your friends'}</b>
          <p>${L ? 'Les amis, leur présence et les invitations à rouler demandent un compte (les invités sans compte roulent seuls ou avec un code d’invitation).' : 'Friends, presence and ride invites need an account (guests without an account ride solo or with an invite code).'}</p>
          ${code ? `<p class="fr-note">${L ? 'Lien d’ami reçu' : 'Friend link received'} : <b class="fr-mono">${esc(formatFriendCode(code))}</b> — ${L ? 'la demande te sera proposée après la connexion.' : 'you will be offered to send the request after signing in.'}</p>` : ''}
          <button class="btn primary" data-fr="login">${L ? 'Se connecter' : 'Sign in'}</button>
        </div></section>`;
    }
    return `<section class="mm-panel mm-center mm-wide mm-xl fr-panel">${close}${head}
      <div class="fr-grid">
        <div class="fr-col">
          <div class="fr-card fr-mine" id="fr-mine"></div>
          <form class="fr-add" id="fr-add" autocomplete="off">
            <input id="fr-input" class="mm-input" maxlength="16" spellcheck="false" placeholder="${L ? 'Code ami (ex. K7QM-2XRA)' : 'Friend code (e.g. K7QM-2XRA)'}" value="${esc(formatFriendCode(pendingCode() ?? ''))}" />
            <button class="btn primary" type="submit">${L ? 'Ajouter' : 'Add'}</button>
          </form>
          <div class="fr-msg" id="fr-msg" aria-live="polite"></div>
          <div id="fr-left"></div>
        </div>
        <div class="fr-col">
          <div id="fr-right"></div>
          <div id="fr-boards" class="fr-boards"></div>
        </div>
      </div>
    </section>`;
  }

  /**
   * Après chaque rendu du menu : branche les événements (délégation sur le panneau et le
   * bandeau) puis remplit les parties vivantes.
   */
  mount(root: HTMLElement, tabOpen: boolean): void {
    this.root = root;
    this.tabOpen = tabOpen;
    this.painted = '';
    const panel = root.querySelector<HTMLElement>('.fr-panel');
    if (panel) {
      panel.addEventListener('click', (e) => this.onClick(e));
      panel.addEventListener('change', (e) => {
        const box = (e.target as HTMLElement).closest<HTMLInputElement>('[data-fr-select]');
        if (!box) return;
        const id = box.dataset.frSelect as string;
        if (box.checked && this.selected.size < FRIEND_INVITE_MAX) this.selected.add(id);
        else {
          this.selected.delete(id);
          box.checked = false;
        }
        this.paintInviteBar();
      });
      panel.querySelector('#fr-add')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = panel.querySelector<HTMLInputElement>('#fr-input');
        void this.addByCode(input?.value ?? '');
      });
    }
    root.querySelector('#m-friendbar')?.addEventListener('click', (e) => this.onClick(e));
    this.paint();
    if (tabOpen && this.hooks.loggedIn()) void this.loadBoards();
  }

  /** Met à jour pastille, bandeau et listes (sans toucher au champ de saisie). */
  private paint(): void {
    const root = this.root;
    if (!root?.isConnected) return;
    const L = fr();
    const badge = root.querySelector<HTMLElement>('.mm-tab[data-tab="friends"] .mm-badge');
    const n = this.hooks.loggedIn() ? badgeCount(this.data) : 0;
    if (badge) {
      badge.hidden = !n;
      badge.textContent = String(n);
    }
    const online = root.querySelector<HTMLElement>('.mm-tab[data-tab="friends"] .mm-online');
    const on = this.hooks.loggedIn() ? onlineCount(this.data) : 0;
    if (online) {
      online.hidden = !on;
      online.textContent = String(on);
      online.title = this.onlineTitle(on);
    }
    const bar = root.querySelector<HTMLElement>('#m-friendbar');
    if (bar) bar.innerHTML = this.tabOpen ? '' : this.bannerHtml();
    if (!this.tabOpen || !this.hooks.loggedIn()) return;
    const key = JSON.stringify([this.data, this.failure, this.msg, [...this.selected], this.bests?.id, L, Math.floor(Date.now() / 60_000)]);
    if (key === this.painted) return;
    this.painted = key;
    const mine = root.querySelector('#fr-mine');
    const left = root.querySelector('#fr-left');
    const right = root.querySelector('#fr-right');
    const msg = root.querySelector('#fr-msg');
    if (msg) msg.innerHTML = this.msg ? `<span class="${this.msg.ok ? 'ok' : 'bad'}">${esc(this.msg.text)}</span>` : '';
    if (!this.data) {
      const text = this.failure ? friendErrorMessage(this.failure, L ? 'fr' : 'en') : L ? 'Chargement…' : 'Loading…';
      if (mine) mine.innerHTML = `<span class="fr-label">${L ? 'Mon code ami' : 'My friend code'}</span><b class="fr-code fr-dim">····-····</b>`;
      if (right) right.innerHTML = `<div class="fr-empty">${esc(text)}</div>`;
      if (left) left.innerHTML = '';
      return;
    }
    if (mine) mine.innerHTML = this.mineHtml(this.data.code);
    if (left) left.innerHTML = this.pendingHtml() + this.invitesHtml() + this.requestsHtml();
    if (right) right.innerHTML = this.friendsHtml();
  }

  private mineHtml(code: string): string {
    const L = fr();
    return `<span class="fr-label">${L ? 'Mon code ami' : 'My friend code'}</span>
      <b class="fr-code fr-mono" title="${L ? 'À donner à tes amis' : 'Give it to your friends'}">${esc(formatFriendCode(code))}</b>
      <div class="fr-mine-actions">
        <button class="btn small" data-fr="copy-code">${L ? 'Copier' : 'Copy'}</button>
        <button class="btn small" data-fr="copy-link">${L ? 'Copier le lien' : 'Copy link'}</button>
        <button class="mm-link" data-fr="regen" title="${L ? 'L’ancien code et les liens déjà partagés ne marcheront plus' : 'The old code and shared links will stop working'}">${L ? 'Nouveau code' : 'New code'}</button>
      </div>`;
  }

  private pendingHtml(): string {
    const code = pendingCode();
    if (!code) return '';
    const L = fr();
    return `<div class="fr-card fr-pending"><span>${L ? 'Lien d’ami reçu' : 'Friend link received'} : <b class="fr-mono">${esc(formatFriendCode(code))}</b></span>
      <div><button class="btn small primary" data-fr="pending-send">${L ? 'Envoyer la demande' : 'Send request'}</button><button class="mm-link" data-fr="pending-drop">${L ? 'Ignorer' : 'Ignore'}</button></div></div>`;
  }

  private routeName = (id: string): string | undefined => {
    const r = findRoute(this.hooks.routes, id);
    if (!r) return undefined;
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  };

  private dot(name: string, color: string, state?: string): string {
    return `<i class="fr-dot ${state ? `fr-${state}` : ''}" style="background:${esc(color)}">${esc(initials(name))}</i>`;
  }

  private invitesHtml(): string {
    const d = this.data;
    if (!d?.invites.length) return '';
    const L = fr();
    const lang = L ? 'fr' : 'en';
    return `<h3>${L ? 'Invitations à rouler' : 'Ride invites'}</h3><div class="fr-list">${d.invites
      .map(
        (i) => `<div class="fr-row fr-invite">${this.dot(i.from, i.fromColor, 'riding')}
          <div class="fr-who"><b>${esc(i.from)} ${L ? 't’invite à rouler' : 'invites you to ride'}</b><span class="fr-where">${esc(this.routeName(i.ride.routeId) ?? i.ride.name)}</span><span>${esc(modeLabel(i.ride.mode, lang))} · ${esc(ridersLabel(i.ride.riders, lang))} · ${esc(remainingLabel(i.expiresAt, Date.now(), lang))}</span></div>
          <div class="fr-act"><button class="btn small primary" data-fr="join-invite" data-id="${esc(i.id)}">${L ? 'Rejoindre' : 'Join'}</button><button class="mm-link" data-fr="ignore-invite" data-id="${esc(i.id)}">${L ? 'Ignorer' : 'Ignore'}</button></div></div>`,
      )
      .join('')}</div>`;
  }

  private requestsHtml(): string {
    const d = this.data;
    if (!d) return '';
    const L = fr();
    const incoming = d.incoming.length
      ? `<h3>${L ? 'Demandes reçues' : 'Requests received'} <span class="fr-count">${d.incoming.length}</span></h3><div class="fr-list">${d.incoming
          .map(
            (r) => `<div class="fr-row">${this.dot(r.name, r.color)}<div class="fr-who"><b>${esc(r.name)}</b><span>${L ? 'veut rouler avec toi' : 'wants to ride with you'}</span></div>
              <div class="fr-act"><button class="btn small primary" data-fr="accept" data-id="${esc(r.id)}">${L ? 'Accepter' : 'Accept'}</button><button class="mm-link" data-fr="decline" data-id="${esc(r.id)}">${L ? 'Refuser' : 'Decline'}</button></div></div>`,
          )
          .join('')}</div>`
      : '';
    const outgoing = d.outgoing.length
      ? `<h3>${L ? 'Demandes envoyées' : 'Requests sent'}</h3><div class="fr-list">${d.outgoing
          .map(
            (r) => `<div class="fr-row fr-quiet">${this.dot(r.name, r.color)}<div class="fr-who"><b>${esc(r.name)}</b><span>${L ? 'en attente de réponse' : 'waiting for an answer'}</span></div>
              <div class="fr-act"><button class="mm-link" data-fr="cancel" data-id="${esc(r.id)}">${L ? 'Annuler' : 'Cancel'}</button></div></div>`,
          )
          .join('')}</div>`
      : '';
    return incoming + outgoing;
  }

  private friendsHtml(): string {
    const d = this.data;
    if (!d) return '';
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const list = sortFriends(d.friends);
    const riding = list.filter((f) => f.presence.state === 'riding').length;
    const online = list.filter((f) => f.presence.state === 'online').length;
    const head = `<h3 class="fr-h3-first">${L ? 'Mes amis' : 'My friends'} <span class="fr-count">${list.length}</span>${list.length ? `<span class="fr-sum">${riding ? `${riding} ${L ? 'roule' : 'riding'}${riding > 1 && L ? 'nt' : ''} · ` : ''}${online} ${L ? 'en ligne' : 'online'}</span>` : ''}</h3>`;
    if (!list.length) {
      return `${head}<div class="fr-empty"><b>${L ? 'Pas encore d’amis' : 'No friends yet'}</b><p>${L ? 'Donne ton code ami (ou le lien) à tes partenaires de sortie, ou saisis le leur à gauche.' : 'Give your friend code (or link) to your riding buddies, or enter theirs on the left.'}</p></div>`;
    }
    const rows = list
      .map((f) => {
        const st = f.presence.state;
        const sel = this.selected.has(f.id);
        const best = this.bests?.id === f.id ? `<div class="fr-bests">${this.bests.html}</div>` : '';
        const pres = presenceParts(f.presence, lang, this.routeName);
        return `<div class="fr-row fr-friend fr-st-${st}">
          <label class="fr-pick" title="${L ? 'Inviter dans ma sortie' : 'Invite to my ride'}"><input type="checkbox" data-fr-select="${esc(f.id)}" ${sel ? 'checked' : ''}/></label>
          ${this.dot(f.name, f.color, st)}
          <div class="fr-who"><b>${esc(f.name)} <small>${L ? 'niv.' : 'lvl'} ${f.level}</small></b><span class="fr-state">${esc(pres.state)}</span>${pres.where ? `<span class="fr-where" title="${esc(pres.where)}">${esc(pres.where)}</span>` : ''}</div>
          <div class="fr-act">
            ${st === 'riding' && !(f.presence.state === 'riding' && f.presence.withYou) ? `<button class="btn small primary" data-fr="join-friend" data-id="${esc(f.id)}">${L ? 'Rejoindre' : 'Join'}</button>` : ''}
            <button class="mm-link" data-fr="bests" data-id="${esc(f.id)}">${L ? 'Records' : 'Records'}</button>
            <button class="fr-x" data-fr="remove" data-id="${esc(f.id)}" data-name="${esc(f.name)}" title="${L ? 'Retirer de mes amis' : 'Remove friend'}" aria-label="${L ? 'Retirer' : 'Remove'}">×</button>
          </div></div>${best}`;
      })
      .join('');
    return `${head}<div class="fr-list">${rows}</div><div class="fr-invitebar" id="fr-invitebar">${this.inviteBarHtml()}</div>`;
  }

  private inviteBarHtml(): string {
    const L = fr();
    const n = this.selected.size;
    const r = this.routeName(this.hooks.currentRouteId()) ?? '';
    return `<span>${n ? (L ? `${n} ami${n > 1 ? 's' : ''} coché${n > 1 ? 's' : ''}` : `${n} friend${n > 1 ? 's' : ''} selected`) : L ? 'Coche des amis pour les inviter' : 'Tick friends to invite them'}<small>${L ? `Sortie de groupe sur ${esc(r)} ; ils reçoivent l’invitation dans leur menu.` : `Group ride on ${esc(r)}; they get the invite in their menu.`}</small></span>
      <button class="btn small primary" data-fr="ride-with" ${n ? '' : 'disabled'}>${L ? 'Partir et inviter' : 'Ride and invite'}</button>`;
  }

  private paintInviteBar(): void {
    const bar = this.root?.querySelector('#fr-invitebar');
    if (bar) bar.innerHTML = this.inviteBarHtml();
  }

  /** Bandeau d'invitation (onglets autres que Amis) : la plus récente, Rejoindre / Ignorer. */
  private bannerHtml(): string {
    const inv = this.hooks.loggedIn() ? this.data?.invites[0] : undefined;
    if (!inv) return '';
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const more = (this.data?.invites.length ?? 1) - 1;
    return `<div class="fr-banner" role="status">${this.dot(inv.from, inv.fromColor, 'riding')}
      <span class="fr-banner-text"><span><b>${esc(inv.from)}</b> ${L ? 't’invite à rouler sur' : 'invites you to ride on'} <b>${esc(this.routeName(inv.ride.routeId) ?? inv.ride.name)}</b></span>
        <small>${esc(modeLabel(inv.ride.mode, lang))} · ${esc(ridersLabel(inv.ride.riders, lang))} · ${esc(remainingLabel(inv.expiresAt, Date.now(), lang))}${more > 0 ? ` · ${L ? `+${more} autre${more > 1 ? 's' : ''}` : `+${more} more`}` : ''}</small></span>
      <button class="btn small primary" data-fr="join-invite" data-id="${esc(inv.id)}">${L ? 'Rejoindre' : 'Join'}</button>
      <button class="btn small" data-fr="ignore-invite" data-id="${esc(inv.id)}">${L ? 'Ignorer' : 'Ignore'}</button></div>`;
  }

  // ————————————————————————————————————————————— Classements entre amis

  private async loadBoards(force = false): Promise<void> {
    const box = () => this.root?.querySelector<HTMLElement>('#fr-boards');
    const routeId = this.hooks.currentRouteId();
    const route = findRoute(this.hooks.routes, routeId);
    const L = fr();
    if (!route) return;
    if (!force && this.boards && this.boards.routeId === routeId && Date.now() - this.boards.at < 60_000) {
      const b = box();
      if (b) b.innerHTML = this.boards.html;
      return;
    }
    const title = `<h3>${L ? 'Classements entre amis' : 'Friends leaderboards'} · <span class="fr-route">${esc(this.routeName(routeId) ?? route.name)}</span></h3>`;
    if (!route.segments.length) {
      const html = `${title}<div class="fr-empty fr-small">${L ? 'Pas de segment chronométré sur cet itinéraire.' : 'No timed segment on this route.'}</div>`;
      this.boards = { routeId, at: Date.now(), html };
      const b = box();
      if (b) b.innerHTML = html;
      return;
    }
    const results = await Promise.all(
      route.segments.map((s) =>
        call<Array<{ rank: number; name: string; bestMs: number; me?: boolean }>>('GET', `/segments/${encodeURIComponent(routeId)}/${encodeURIComponent(s.id)}/leaderboard?scope=friends&limit=5`).then((r) => ({ seg: s, rows: r.ok ? r.data : null })),
      ),
    );
    const cards = results
      .map(({ seg, rows }) => {
        const kind = seg.kind === 'kom' ? 'KOM' : 'Sprint';
        const body = !rows
          ? `<div class="fr-small">${L ? 'Indisponible' : 'Unavailable'}</div>`
          : rows.length
            ? `<ol>${rows.map((x) => `<li class="${x.me ? 'me' : ''}"><span>${x.rank}</span><b>${esc(x.name)}</b><em>${segmentTime(x.bestMs)}</em></li>`).join('')}</ol>`
            : `<div class="fr-small">${L ? 'Personne n’a encore de temps ici.' : 'Nobody has a time here yet.'}</div>`;
        return `<div class="fr-board"><div class="fr-board-h"><i class="fr-kind fr-${seg.kind}">${kind}</i><b>${esc(seg.name)}</b></div>${body}</div>`;
      })
      .join('');
    const html = `${title}<div class="fr-boardgrid">${cards}</div>`;
    this.boards = { routeId, at: Date.now(), html };
    const b = box();
    if (b) b.innerHTML = html;
  }

  private async toggleBests(id: string): Promise<void> {
    if (this.bests?.id === id) {
      this.bests = null;
      this.paint();
      return;
    }
    const L = fr();
    const routeId = this.hooks.currentRouteId();
    const route = findRoute(this.hooks.routes, routeId);
    const r = await call<Array<{ segmentId: string; bestMs: number }>>('GET', `/friends/${encodeURIComponent(id)}/bests?routeId=${encodeURIComponent(routeId)}`);
    const where = esc(this.routeName(routeId) ?? routeId);
    let html: string;
    if (!r.ok) html = esc(friendErrorMessage(r.error, L ? 'fr' : 'en'));
    else if (!r.data.length) html = L ? `Aucun record sur ${where}.` : `No record on ${where}.`;
    else
      html = r.data
        .map((b) => {
          const seg = route?.segments.find((s) => s.id === b.segmentId);
          return `<span><i class="fr-kind fr-${seg?.kind ?? 'kom'}">${seg?.kind === 'sprint' ? 'Sprint' : 'KOM'}</i> ${esc(seg?.name ?? b.segmentId)} <b>${segmentTime(b.bestMs)}</b></span>`;
        })
        .join('');
    this.bests = { id, html };
    this.paint();
  }

  // ————————————————————————————————————————————— Actions

  private say(text: string, ok: boolean): void {
    this.msg = { text, ok };
    this.paint();
  }

  private async addByCode(raw: string): Promise<void> {
    const L = fr();
    const r = await call<FriendRequestResult>('POST', '/friends/requests', { code: raw.slice(0, 32) });
    if (r.ok) {
      clearPendingCode();
      const input = this.root?.querySelector<HTMLInputElement>('#fr-input');
      if (input) input.value = '';
      this.say(
        r.data.status === 'accepted'
          ? L
            ? `${r.data.name} t’avait déjà demandé : vous êtes amis !`
            : `${r.data.name} had already asked: you are now friends!`
          : L
            ? `Demande envoyée à ${r.data.name}.`
            : `Request sent to ${r.data.name}.`,
        true,
      );
    } else this.say(friendErrorMessage(r.error, L ? 'fr' : 'en'), false);
    await this.refresh();
  }

  private async copy(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.say(done, true);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé) : le texte est affiché pour une copie manuelle.
      this.say(text, true);
    }
  }

  private async act(method: string, path: string, after?: (ok: boolean) => void): Promise<void> {
    const r = await call<unknown>(method, path);
    if (!r.ok) this.say(friendErrorMessage(r.error, fr() ? 'fr' : 'en'), false);
    after?.(r.ok);
    await this.refresh();
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-fr]');
    if (!el) return;
    const L = fr();
    const id = el.dataset.id ?? '';
    const path = encodeURIComponent(id);
    switch (el.dataset.fr) {
      case 'login':
        return this.hooks.login();
      case 'copy-code':
        if (this.data) void this.copy(formatFriendCode(this.data.code), L ? 'Code copié.' : 'Code copied.');
        return;
      case 'copy-link':
        if (this.data) void this.copy(friendLink(location.origin, this.data.code), L ? 'Lien copié : envoie-le à un ami.' : 'Link copied: send it to a friend.');
        return;
      case 'regen':
        if (!confirm(L ? 'Créer un nouveau code ami ? L’ancien et les liens déjà partagés ne marcheront plus.' : 'Create a new friend code? The old one and shared links will stop working.')) return;
        void this.act('POST', '/friends/code', (ok) => ok && this.say(L ? 'Nouveau code créé.' : 'New code created.', true));
        return;
      case 'pending-send':
        void this.addByCode(pendingCode() ?? '');
        return;
      case 'pending-drop': {
        clearPendingCode();
        const input = this.root?.querySelector<HTMLInputElement>('#fr-input');
        if (input) input.value = '';
        this.painted = '';
        this.paint();
        return;
      }
      case 'accept':
        void this.act('POST', `/friends/requests/${path}/accept`, (ok) => ok && this.say(L ? 'Demande acceptée.' : 'Request accepted.', true));
        return;
      case 'decline':
      case 'cancel':
        void this.act('DELETE', `/friends/requests/${path}`);
        return;
      case 'remove':
        if (!confirm(L ? `Retirer ${el.dataset.name ?? ''} de tes amis ?` : `Remove ${el.dataset.name ?? ''} from your friends?`)) return;
        this.selected.delete(id);
        void this.act('DELETE', `/friends/${path}`);
        return;
      case 'bests':
        void this.toggleBests(id);
        return;
      case 'ignore-invite':
        void this.act('DELETE', `/friends/invites/${path}`);
        return;
      case 'join-invite':
      case 'join-friend': {
        el.setAttribute('disabled', '');
        const url = el.dataset.fr === 'join-invite' ? `/friends/invites/${path}/join` : `/friends/${path}/join`;
        void call<FriendJoinInfo>('POST', url).then((r) => {
          if (r.ok) {
            this.stop();
            this.hooks.join(r.data);
          } else {
            el.removeAttribute('disabled');
            this.say(friendErrorMessage(r.error, L ? 'fr' : 'en'), false);
            void this.refresh();
          }
        });
        return;
      }
      case 'ride-with':
        if (!this.selected.size) return;
        this.stop();
        this.hooks.rideWith([...this.selected]);
        this.selected.clear();
        return;
    }
  }
}

/**
 * Pause en sortie de groupe : inviter des amis dans la sortie en cours (cases à cocher puis
 * « Inviter »). Rien n'est affiché sans compte ou sans ami.
 */
export async function renderRideInvite(box: HTMLElement, roomId: string): Promise<void> {
  const L = fr();
  const lang = L ? 'fr' : 'en';
  const r = await call<FriendsOverview>('GET', '/friends');
  // Les amis déjà dans cette sortie ne sont pas proposés.
  const list = r.ok ? sortFriends(r.data.friends.filter((f) => !(f.presence.state === 'riding' && f.presence.withYou))) : [];
  if (!box.isConnected || !list.length) return;
  box.innerHTML = `<div class="fr-ride">
    <h3>${L ? 'Inviter des amis dans cette sortie' : 'Invite friends to this ride'}</h3>
    <div class="fr-ride-list">${list
      .map(
        (f) => `<label class="fr-ride-row"><input type="checkbox" value="${esc(f.id)}"/><i class="fr-dot fr-${f.presence.state}" style="background:${esc(f.color)}">${esc(initials(f.name))}</i>
          <span><b>${esc(f.name)}</b><small>${esc(presenceLabel(f.presence, lang))}</small></span></label>`,
      )
      .join('')}</div>
    <div class="fr-ride-foot"><span class="fr-ride-msg"></span><button class="btn small primary" type="button">${L ? 'Inviter' : 'Invite'}</button></div></div>`;
  const btn = box.querySelector<HTMLButtonElement>('.fr-ride-foot button');
  const msg = box.querySelector<HTMLElement>('.fr-ride-msg');
  btn?.addEventListener('click', async () => {
    const ids = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((i) => i.value).slice(0, FRIEND_INVITE_MAX);
    if (!ids.length) {
      if (msg) msg.textContent = L ? 'Coche au moins un ami.' : 'Tick at least one friend.';
      return;
    }
    btn.disabled = true;
    const n = await sendRideInvites(roomId, ids);
    btn.disabled = false;
    if (msg) msg.textContent = n ? (L ? `Invitation envoyée (${n}) : elle reste valable 30 min.` : `Invite sent (${n}): valid for 30 min.`) : L ? 'Invitation impossible pour le moment.' : 'Could not send the invite right now.';
    box.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => (i.checked = false));
  });
}
