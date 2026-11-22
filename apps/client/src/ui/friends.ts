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
import { getLang, strings } from '../i18n/index.ts';
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
import './blocks.css';
import './friends.css';

const PENDING_KEY = 'ar.friendCode';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Textes du module (français, anglais). */
const S = strings(
  {
    friends: 'Amis',
    seeWhoIsRiding: 'Vois qui roule et rejoins tes amis en un clic.',
    close: 'Fermer',
    closeEsc: 'Fermer (Échap)',
    signInToFind: 'Connecte-toi pour retrouver tes amis',
    friendsAndRideInvites: 'Les amis et les invitations à rouler demandent un compte.',
    friendLinkReceived: 'Lien d’ami reçu',
    youWillBeOffered: 'La demande te sera proposée après la connexion.',
    signIn: 'Se connecter',
    addAFriend: 'Ajouter un ami',
    friendCode: 'Code ami',
    theirFriendCodeE: 'Son code ami, par exemple K7QM-2XRA',
    add: 'Ajouter',
    loading: 'Chargement…',
    myFriendCode: 'Mon code ami',
    giveItToYour: 'À donner à tes amis',
    copy: 'Copier',
    copyLink: 'Copier le lien',
    theOldCodeAnd: 'L’ancien code et les liens déjà partagés ne marcheront plus',
    newCode: 'Nouveau code',
    sendRequest: 'Envoyer la demande',
    ignore: 'Ignorer',
    rideInvites: 'Invitations à rouler',
    invitesYouOn: 't’invite sur',
    join: 'Rejoindre',
    requestsReceived: 'Demandes reçues',
    wantsToRideWith: 'veut rouler avec toi',
    waiting: 'En attente',
    decline: 'Refuser',
    accept: 'Accepter',
    requestsSent: 'Demandes envoyées',
    hasNotAnsweredYet: 'n’a pas encore répondu',
    cancel: 'Annuler',
    myFriends: 'Mes amis',
    riding: 'roule',
    online: 'en ligne',
    noFriendsYet: 'Pas encore d’amis',
    sendYourLinkTo: 'Envoie ton lien à tes partenaires de sortie.',
    copyMyLink: 'Copier mon lien',
    level: 'Niveau',
    inviteToMyRide: 'Inviter dans ma sortie',
    invite: 'Inviter',
    lvl: 'niv.',
    records: 'Records',
    removeFriend: 'Retirer de mes amis',
    remove: 'Retirer',
    tickInviteOnYour: 'Coche « Inviter » sur tes amis pour partir ensemble',
    groupRideOn: 'Sortie de groupe sur {n}.',
    rideAndInvite: 'Partir et inviter',
    invitesYouToRide: 't’invite à rouler sur',
    friendsLeaderboards: 'Classements entre amis',
    noTimedSegmentOn: 'Pas de segment chronométré sur cet itinéraire.',
    unavailable: 'Indisponible',
    nobodyHasATime: 'Personne n’a encore de temps ici.',
    noRecordOn: 'Aucun record sur {n}.',
    hadAlreadyAskedYou: '{n} t’avait déjà demandé : vous êtes amis !',
    requestSentTo: 'Demande envoyée à {n}.',
    codeCopied: 'Code copié.',
    linkCopiedSendIt: 'Lien copié : envoie-le à un ami.',
    createANewFriend: 'Créer un nouveau code ami ? L’ancien et les liens déjà partagés ne marcheront plus.',
    newCodeCreated: 'Nouveau code créé.',
    requestAccepted: 'Demande acceptée.',
    removeFromYourFriends: 'Retirer {n} de tes amis ?',
    inviteFriendsToThis: 'Inviter des amis dans cette sortie',
    tickAtLeastOne: 'Coche au moins un ami.',
    inviteSentValidFor: 'Invitation envoyée ({n}) : elle reste valable 30 min.',
    couldNotSendThe: 'Invitation impossible pour le moment.',
    online1: '{n} ami en ligne',
    onlineN: '{n} amis en ligne',
    riding1: '{n} roule',
    ridingN: '{n} roulent',
    ticked1: '{n} ami coché',
    tickedN: '{n} amis cochés',
    more1: '+{n} autre',
    moreN: '+{n} autres',
  },
  {
    friends: 'Friends',
    seeWhoIsRiding: 'See who is riding and join your friends in one click.',
    close: 'Close',
    closeEsc: 'Close (Esc)',
    signInToFind: 'Sign in to find your friends',
    friendsAndRideInvites: 'Friends and ride invites need an account.',
    friendLinkReceived: 'Friend link received',
    youWillBeOffered: 'You will be offered to send the request after signing in.',
    signIn: 'Sign in',
    addAFriend: 'Add a friend',
    friendCode: 'Friend code',
    theirFriendCodeE: 'Their friend code, e.g. K7QM-2XRA',
    add: 'Add',
    loading: 'Loading…',
    myFriendCode: 'My friend code',
    giveItToYour: 'Give it to your friends',
    copy: 'Copy',
    copyLink: 'Copy link',
    theOldCodeAnd: 'The old code and shared links will stop working',
    newCode: 'New code',
    sendRequest: 'Send request',
    ignore: 'Ignore',
    rideInvites: 'Ride invites',
    invitesYouOn: 'invites you on',
    join: 'Join',
    requestsReceived: 'Requests received',
    wantsToRideWith: 'wants to ride with you',
    waiting: 'Waiting',
    decline: 'Decline',
    accept: 'Accept',
    requestsSent: 'Requests sent',
    hasNotAnsweredYet: 'has not answered yet',
    cancel: 'Cancel',
    myFriends: 'My friends',
    riding: 'riding',
    online: 'online',
    noFriendsYet: 'No friends yet',
    sendYourLinkTo: 'Send your link to your riding buddies.',
    copyMyLink: 'Copy my link',
    level: 'Level',
    inviteToMyRide: 'Invite to my ride',
    invite: 'Invite',
    lvl: 'lvl',
    records: 'Records',
    removeFriend: 'Remove friend',
    remove: 'Remove',
    tickInviteOnYour: 'Tick “Invite” on your friends to ride together',
    groupRideOn: 'Group ride on {n}.',
    rideAndInvite: 'Ride and invite',
    invitesYouToRide: 'invites you to ride on',
    friendsLeaderboards: 'Friends leaderboards',
    noTimedSegmentOn: 'No timed segment on this route.',
    unavailable: 'Unavailable',
    nobodyHasATime: 'Nobody has a time here yet.',
    noRecordOn: 'No record on {n}.',
    hadAlreadyAskedYou: '{n} had already asked: you are now friends!',
    requestSentTo: 'Request sent to {n}.',
    codeCopied: 'Code copied.',
    linkCopiedSendIt: 'Link copied: send it to a friend.',
    createANewFriend: 'Create a new friend code? The old one and shared links will stop working.',
    newCodeCreated: 'New code created.',
    requestAccepted: 'Request accepted.',
    removeFromYourFriends: 'Remove {n} from your friends?',
    inviteFriendsToThis: 'Invite friends to this ride',
    tickAtLeastOne: 'Tick at least one friend.',
    inviteSentValidFor: 'Invite sent ({n}): valid for 30 min.',
    couldNotSendThe: 'Could not send the invite right now.',
    online1: '{n} friend online',
    onlineN: '{n} friends online',
    riding1: '{n} riding',
    ridingN: '{n} riding',
    ticked1: '{n} friend selected',
    tickedN: '{n} friends selected',
    more1: '+{n} more',
    moreN: '+{n} more',
  },
);

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
    return S(n > 1 ? 'onlineN' : 'online1').replace('{n}', String(n));
  }

  // ————————————————————————————————————————————— Rendu

  /** Panneau de l'onglet (les parties vivantes sont remplies par paint()). */
  html(): string {
    const head = `<header class="mm-head"><h2 class="ab-title">${S('friends')}</h2><p class="ab-sub">${S('seeWhoIsRiding')}</p></header>`;
    const close = `<button class="mm-close" data-tab="ride" aria-label="${S('close')}" title="${S('closeEsc')}">×</button>`;
    if (!this.hooks.loggedIn()) {
      const code = pendingCode();
      return `<section class="mm-panel mm-center mm-xl fr-panel">${close}${head}
        <div class="ab-tile ab-plain fr-empty fr-signin">
          <b>${S('signInToFind')}</b>
          <p>${S('friendsAndRideInvites')}</p>
          ${code ? `<p class="fr-note">${S('friendLinkReceived')} : <b class="fr-mono">${esc(formatFriendCode(code))}</b>. ${S('youWillBeOffered')}</p>` : ''}
          <button class="ab-btn ab-go" data-fr="login">${S('signIn')}</button>
        </div></section>`;
    }
    return `<section class="mm-panel mm-center mm-wide mm-xl fr-panel">${close}${head}
      <div class="fr-top">
        <div class="ab-tile ab-plain fr-mine" id="fr-mine"></div>
        <div class="ab-tile ab-plain fr-addbox">
          <b class="fr-add-t">${S('addAFriend')}</b>
          <form class="fr-add" id="fr-add" autocomplete="off">
            <input id="fr-input" class="mm-input" maxlength="16" spellcheck="false" aria-label="${S('friendCode')}" placeholder="${S('theirFriendCodeE')}" value="${esc(formatFriendCode(pendingCode() ?? ''))}" />
            <button class="ab-btn" type="submit">${S('add')}</button>
          </form>
          <div class="fr-msg" id="fr-msg" aria-live="polite"></div>
        </div>
      </div>
      <div id="fr-left"></div>
      <div id="fr-right"></div>
      <div id="fr-boards" class="fr-boards"></div>
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
      const text = this.failure ? friendErrorMessage(this.failure, getLang()) : S('loading');
      if (mine) mine.innerHTML = `<b class="fr-add-t">${S('myFriendCode')}</b><b class="fr-code fr-dim">····-····</b>`;
      if (right) right.innerHTML = `<div class="fr-empty">${esc(text)}</div>`;
      if (left) left.innerHTML = '';
      return;
    }
    if (mine) mine.innerHTML = this.mineHtml(this.data.code);
    if (left) left.innerHTML = this.pendingHtml() + this.invitesHtml() + this.requestsHtml();
    if (right) right.innerHTML = this.friendsHtml();
  }

  private mineHtml(code: string): string {
    return `<b class="fr-add-t">${S('myFriendCode')}</b>
      <b class="fr-code fr-mono" title="${S('giveItToYour')}">${esc(formatFriendCode(code))}</b>
      <div class="fr-mine-actions">
        <button class="ab-btn ab-chip" data-fr="copy-code">${S('copy')}</button>
        <button class="ab-btn ab-chip" data-fr="copy-link">${S('copyLink')}</button>
        <button class="mm-link" data-fr="regen" title="${S('theOldCodeAnd')}">${S('newCode')}</button>
      </div>`;
  }

  private pendingHtml(): string {
    const code = pendingCode();
    if (!code) return '';
    return `<div class="ab-tile ab-plain is-warn fr-pending"><span>${S('friendLinkReceived')} : <b class="fr-mono">${esc(formatFriendCode(code))}</b></span>
      <div><button class="ab-act" data-fr="pending-send">${S('sendRequest')}</button><button class="mm-link" data-fr="pending-drop">${S('ignore')}</button></div></div>`;
  }

  private routeName = (id: string): string | undefined => {
    const r = findRoute(this.hooks.routes, id);
    if (!r) return undefined;
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  };

  private dot(name: string, color: string, state?: string): string {
    return `<i class="fr-dot ${state ? `fr-${state}` : ''}" style="background:${esc(color)}">${esc(initials(name))}</i>`;
  }

  /** Carré d'icône d'un bloc : les initiales sur la couleur de l'ami. */
  private ava(name: string, color: string): string {
    return `<span class="ab-ico sm fr-ava" style="background:${esc(color)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }

  private invitesHtml(): string {
    const d = this.data;
    if (!d?.invites.length) return '';
    const lang = getLang();
    return `<h3 class="ab-section">${S('rideInvites')}</h3><div class="ab-grid ab-grid-2 fr-tiles">${d.invites
      .map(
        (i) => `<div class="ab-tile is-ok fr-invite">${this.ava(i.from, i.fromColor)}
          <b class="ab-name">${esc(i.from)}</b>
          <span class="ab-detail">${S('invitesYouOn')} <b>${esc(this.routeName(i.ride.routeId) ?? i.ride.name)}</b> · ${esc(modeLabel(i.ride.mode, lang))} · ${esc(ridersLabel(i.ride.riders, lang))}</span>
          <span class="ab-state"><i></i>${esc(remainingLabel(i.expiresAt, Date.now(), lang))}</span>
          <div class="fr-act"><button class="mm-link" data-fr="ignore-invite" data-id="${esc(i.id)}">${S('ignore')}</button><button class="ab-act" data-fr="join-invite" data-id="${esc(i.id)}">${S('join')}</button></div></div>`,
      )
      .join('')}</div>`;
  }

  private requestsHtml(): string {
    const d = this.data;
    if (!d) return '';
    const incoming = d.incoming.length
      ? `<h3 class="ab-section">${S('requestsReceived')} <span class="fr-count">${d.incoming.length}</span></h3><div class="ab-grid ab-grid-2 fr-tiles">${d.incoming
          .map(
            (r) => `<div class="ab-tile is-warn">${this.ava(r.name, r.color)}<b class="ab-name">${esc(r.name)}</b><span class="ab-detail">${S('wantsToRideWith')}</span>
              <span class="ab-state"><i></i>${S('waiting')}</span>
              <div class="fr-act"><button class="mm-link" data-fr="decline" data-id="${esc(r.id)}">${S('decline')}</button><button class="ab-act" data-fr="accept" data-id="${esc(r.id)}">${S('accept')}</button></div></div>`,
          )
          .join('')}</div>`
      : '';
    const outgoing = d.outgoing.length
      ? `<h3 class="ab-section">${S('requestsSent')}</h3><div class="ab-grid ab-grid-2 fr-tiles">${d.outgoing
          .map(
            (r) => `<div class="ab-tile fr-quiet">${this.ava(r.name, r.color)}<b class="ab-name">${esc(r.name)}</b><span class="ab-detail">${S('hasNotAnsweredYet')}</span>
              <span class="ab-state"><i></i>${S('waiting')}</span>
              <div class="fr-act"><button class="mm-link" data-fr="cancel" data-id="${esc(r.id)}">${S('cancel')}</button></div></div>`,
          )
          .join('')}</div>`
      : '';
    return incoming + outgoing;
  }

  private friendsHtml(): string {
    const d = this.data;
    if (!d) return '';
    const lang = getLang();
    const list = sortFriends(d.friends);
    const riding = list.filter((f) => f.presence.state === 'riding').length;
    const online = list.filter((f) => f.presence.state === 'online').length;
    const head = `<h3 class="ab-section">${S('myFriends')} <span class="fr-count">${list.length}</span>${list.length ? `<span class="fr-sum">${riding ? `${S(riding > 1 ? 'ridingN' : 'riding1').replace('{n}', String(riding))} · ` : ''}${online} ${S('online')}</span>` : ''}</h3>`;
    if (!list.length) {
      return `${head}<div class="ab-tile ab-plain fr-empty"><b>${S('noFriendsYet')}</b><p>${S('sendYourLinkTo')}</p><button class="ab-btn" data-fr="copy-link">${S('copyMyLink')}</button></div>`;
    }
    const rows = list
      .map((f) => {
        const st = f.presence.state;
        const sel = this.selected.has(f.id);
        const best = this.bests?.id === f.id ? `<div class="fr-bests">${this.bests.html}</div>` : '';
        const pres = presenceParts(f.presence, lang, this.routeName);
        // État en un mot (« Roule », « En ligne », « Hors ligne ») ; le reste du statut passe dans la ligne de détail.
        const [word, ...more] = pres.state.split(' · ');
        const detail = [pres.where, ...more].filter(Boolean).join(' · ') || `${S('level')} ${f.level}`;
        const tone = st === 'riding' ? 'is-ok' : st === 'online' ? 'is-info' : '';
        return `<div class="ab-tile fr-friend fr-st-${st} ${tone}">
          <label class="ab-tag fr-pick" title="${S('inviteToMyRide')}"><input type="checkbox" data-fr-select="${esc(f.id)}" ${sel ? 'checked' : ''}/>${S('invite')}</label>
          ${this.ava(f.name, f.color)}
          <b class="ab-name">${esc(f.name)} <small>${S('lvl')} ${f.level}</small></b>
          <span class="ab-detail" title="${esc(detail)}">${esc(detail)}</span>
          <span class="ab-state"><i></i>${esc(word ?? '')}</span>
          <div class="fr-act">
            <button class="mm-link" data-fr="bests" data-id="${esc(f.id)}">${S('records')}</button>
            <button class="fr-x" data-fr="remove" data-id="${esc(f.id)}" data-name="${esc(f.name)}" title="${S('removeFriend')}" aria-label="${S('remove')}">×</button>
            ${st === 'riding' && !(f.presence.state === 'riding' && f.presence.withYou) ? `<button class="ab-act" data-fr="join-friend" data-id="${esc(f.id)}">${S('join')}</button>` : ''}
          </div>${best}</div>`;
      })
      .join('');
    return `${head}<div class="ab-grid ab-grid-2 fr-tiles">${rows}</div><div class="ab-foot fr-invitebar" id="fr-invitebar">${this.inviteBarHtml()}</div>`;
  }

  private inviteBarHtml(): string {
    const n = this.selected.size;
    const r = this.routeName(this.hooks.currentRouteId()) ?? '';
    return `<span>${n ? S(n > 1 ? 'tickedN' : 'ticked1').replace('{n}', String(n)) : S('tickInviteOnYour')}<small>${S('groupRideOn').replace('{n}', String(esc(r)))}</small></span>
      <div class="ab-btns"><button class="ab-btn ab-go" data-fr="ride-with" ${n ? '' : 'disabled'}>${S('rideAndInvite')}</button></div>`;
  }

  private paintInviteBar(): void {
    const bar = this.root?.querySelector('#fr-invitebar');
    if (bar) bar.innerHTML = this.inviteBarHtml();
  }

  /** Bandeau d'invitation (onglets autres que Amis) : la plus récente, Rejoindre / Ignorer. */
  private bannerHtml(): string {
    const inv = this.hooks.loggedIn() ? this.data?.invites[0] : undefined;
    if (!inv) return '';
    const lang = getLang();
    const more = (this.data?.invites.length ?? 1) - 1;
    return `<div class="fr-banner" role="status">${this.dot(inv.from, inv.fromColor, 'riding')}
      <span class="fr-banner-text"><span><b>${esc(inv.from)}</b> ${S('invitesYouToRide')} <b>${esc(this.routeName(inv.ride.routeId) ?? inv.ride.name)}</b></span>
        <small>${esc(modeLabel(inv.ride.mode, lang))} · ${esc(ridersLabel(inv.ride.riders, lang))} · ${esc(remainingLabel(inv.expiresAt, Date.now(), lang))}${more > 0 ? ` · ${S(more > 1 ? 'moreN' : 'more1').replace('{n}', String(more))}` : ''}</small></span>
      <button class="btn small primary" data-fr="join-invite" data-id="${esc(inv.id)}">${S('join')}</button>
      <button class="btn small" data-fr="ignore-invite" data-id="${esc(inv.id)}">${S('ignore')}</button></div>`;
  }

  // ————————————————————————————————————————————— Classements entre amis

  private async loadBoards(force = false): Promise<void> {
    const box = () => this.root?.querySelector<HTMLElement>('#fr-boards');
    const routeId = this.hooks.currentRouteId();
    const route = findRoute(this.hooks.routes, routeId);
    if (!route) return;
    if (!force && this.boards && this.boards.routeId === routeId && Date.now() - this.boards.at < 60_000) {
      const b = box();
      if (b) b.innerHTML = this.boards.html;
      return;
    }
    const title = `<h3 class="ab-section">${S('friendsLeaderboards')} <span class="fr-route">${esc(this.routeName(routeId) ?? route.name)}</span></h3>`;
    if (!route.segments.length) {
      const html = `${title}<div class="fr-empty fr-small">${S('noTimedSegmentOn')}</div>`;
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
          ? `<div class="fr-small">${S('unavailable')}</div>`
          : rows.length
            ? `<ol>${rows.map((x) => `<li class="${x.me ? 'me' : ''}"><span>${x.rank}</span><b>${esc(x.name)}</b><em>${segmentTime(x.bestMs)}</em></li>`).join('')}</ol>`
            : `<div class="fr-small">${S('nobodyHasATime')}</div>`;
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
    const routeId = this.hooks.currentRouteId();
    const route = findRoute(this.hooks.routes, routeId);
    const r = await call<Array<{ segmentId: string; bestMs: number }>>('GET', `/friends/${encodeURIComponent(id)}/bests?routeId=${encodeURIComponent(routeId)}`);
    const where = esc(this.routeName(routeId) ?? routeId);
    let html: string;
    if (!r.ok) html = esc(friendErrorMessage(r.error, getLang()));
    else if (!r.data.length) html = S('noRecordOn').replace('{n}', String(where));
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
    const r = await call<FriendRequestResult>('POST', '/friends/requests', { code: raw.slice(0, 32) });
    if (r.ok) {
      clearPendingCode();
      const input = this.root?.querySelector<HTMLInputElement>('#fr-input');
      if (input) input.value = '';
      this.say(
        r.data.status === 'accepted'
          ? S('hadAlreadyAskedYou').replace('{n}', String(r.data.name))
          : S('requestSentTo').replace('{n}', String(r.data.name)),
        true,
      );
    } else this.say(friendErrorMessage(r.error, getLang()), false);
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
    if (!r.ok) this.say(friendErrorMessage(r.error, getLang()), false);
    after?.(r.ok);
    await this.refresh();
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-fr]');
    if (!el) return;
    const id = el.dataset.id ?? '';
    const path = encodeURIComponent(id);
    switch (el.dataset.fr) {
      case 'login':
        return this.hooks.login();
      case 'copy-code':
        if (this.data) void this.copy(formatFriendCode(this.data.code), S('codeCopied'));
        return;
      case 'copy-link':
        if (this.data) void this.copy(friendLink(location.origin, this.data.code), S('linkCopiedSendIt'));
        return;
      case 'regen':
        if (!confirm(S('createANewFriend'))) return;
        void this.act('POST', '/friends/code', (ok) => ok && this.say(S('newCodeCreated'), true));
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
        void this.act('POST', `/friends/requests/${path}/accept`, (ok) => ok && this.say(S('requestAccepted'), true));
        return;
      case 'decline':
      case 'cancel':
        void this.act('DELETE', `/friends/requests/${path}`);
        return;
      case 'remove':
        if (!confirm(S('removeFromYourFriends').replace('{n}', String(el.dataset.name ?? '')))) return;
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
            this.say(friendErrorMessage(r.error, getLang()), false);
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
  const lang = getLang();
  const r = await call<FriendsOverview>('GET', '/friends');
  // Les amis déjà dans cette sortie ne sont pas proposés.
  const list = r.ok ? sortFriends(r.data.friends.filter((f) => !(f.presence.state === 'riding' && f.presence.withYou))) : [];
  if (!box.isConnected || !list.length) return;
  box.innerHTML = `<div class="fr-ride">
    <h3>${S('inviteFriendsToThis')}</h3>
    <div class="fr-ride-list">${list
      .map(
        (f) => `<label class="fr-ride-row"><input type="checkbox" value="${esc(f.id)}"/><i class="fr-dot fr-${f.presence.state}" style="background:${esc(f.color)}">${esc(initials(f.name))}</i>
          <span><b>${esc(f.name)}</b><small>${esc(presenceLabel(f.presence, lang))}</small></span></label>`,
      )
      .join('')}</div>
    <div class="fr-ride-foot"><span class="fr-ride-msg"></span><button class="btn small primary" type="button">${S('invite')}</button></div></div>`;
  const btn = box.querySelector<HTMLButtonElement>('.fr-ride-foot button');
  const msg = box.querySelector<HTMLElement>('.fr-ride-msg');
  btn?.addEventListener('click', async () => {
    const ids = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((i) => i.value).slice(0, FRIEND_INVITE_MAX);
    if (!ids.length) {
      if (msg) msg.textContent = S('tickAtLeastOne');
      return;
    }
    btn.disabled = true;
    const n = await sendRideInvites(roomId, ids);
    btn.disabled = false;
    if (msg) msg.textContent = n ? (S('inviteSentValidFor').replace('{n}', String(n))) : S('couldNotSendThe');
    box.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => (i.checked = false));
  });
}
