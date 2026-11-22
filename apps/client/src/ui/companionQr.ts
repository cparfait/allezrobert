/**
 * QR code de l'appli compagnon : rien en permanence à l'écran. Il est proposé avant le départ
 * de chaque sortie, quel que soit le mode (si aucun téléphone n'est déjà appairé ; la sortie part
 * d'elle-même dès qu'un téléphone se connecte), puis reste à portée : touche Q, écran de pause,
 * onglet Réglages.
 * Le téléphone qui le lit est appairé sans compte (voir game/companionLink.ts).
 */
import './blocks.css';
import './companionQr.css';
import { encode } from 'uqr';
import { strings } from '../i18n/index.ts';
import { companion, type CompanionLink } from '../game/companionLink.ts';

const S = strings(
  {
    phonesOne: '1 téléphone connecté',
    phonesMany: '{n} téléphones connectés',
    noPhone: 'Aucun téléphone connecté',
    waiting: 'En attente du téléphone',
    app: 'Appli compagnon',
    beforeYouGo: 'Avant de partir',
    close: 'Fermer',
    headline: 'Pilote ta sortie depuis ton téléphone',
    f1: 'Compteur',
    f2: 'Vitesses',
    f3: 'Carrefours',
    f4: 'Musique',
    f5: 'Chat',
    how: 'Ouvre l’appareil photo de ton téléphone et vise ce code. Aucun compte à créer.',
    start: 'Lancer la sortie',
    never: 'Ne plus proposer',
    later: 'Plus tard',
    newCode: 'Nouveau code',
    offlineState: 'Injoignable',
    offlineTitle: 'Serveur injoignable',
    offlineText: 'Le téléphone ne peut pas se connecter tant que le jeu n’atteint pas le serveur. Vérifie ta connexion à Internet ; le code s’affichera ici dès que le serveur répondra.',
    unavailable: 'L’appli compagnon n’est pas disponible pour le moment : le serveur est injoignable.',
    scanSimple: 'Scanne ce code avec l’appareil photo de ton téléphone. Pas de compte à créer.',
    showLarge: 'Afficher en grand',
    settingsText: 'Pilote la sortie depuis ton téléphone (compteur, vitesses, carrefours, musique, chat), en solo comme à plusieurs. Scanne le code avec l’appareil photo : pas de compte à créer.',
    offerLabel: 'Proposer le QR code au lancement d’une sortie',
    newCodeHint: '« Nouveau code » déconnecte les téléphones déjà appairés.',
  },
  {
    phonesOne: '1 phone connected',
    phonesMany: '{n} phones connected',
    noPhone: 'No phone connected',
    waiting: 'Waiting for the phone',
    app: 'Companion app',
    beforeYouGo: 'Before you go',
    close: 'Close',
    headline: 'Control your ride from your phone',
    f1: 'Computer',
    f2: 'Gears',
    f3: 'Junctions',
    f4: 'Music',
    f5: 'Chat',
    how: 'Open your phone camera and point it at this code. No account needed.',
    start: 'Start the ride',
    never: 'Don’t offer again',
    later: 'Later',
    newCode: 'New code',
    offlineState: 'Unreachable',
    offlineTitle: 'Server unreachable',
    offlineText: 'Your phone cannot connect while the game cannot reach the server. Check your Internet connection; the code will appear here as soon as the server answers.',
    unavailable: 'The companion app is not available right now: the server cannot be reached.',
    scanSimple: 'Scan this code with your phone camera. No account needed.',
    showLarge: 'Show large',
    settingsText: 'Control the ride from your phone (bike computer, gears, turns, music, chat), solo or with friends. Scan the code with the camera: no account needed.',
    offerLabel: 'Offer the QR code when a ride starts',
    newCodeHint: '“New code” disconnects phones already paired.',
  },
);

/** « Proposer le QR code au lancement d'une sortie » (activé par défaut). */
const OFFER_KEY = 'ar.pair.offer';
const OFFER_CLOSE_S = 40;
/** Durée de la coche verte « téléphone connecté » avant le départ automatique. */
const CONNECTED_SHOW_MS = 1800;

/** Téléphone (trait fin, comme les icônes du menu) avec ondes de liaison. */
export function phoneIcon(size = 20): string {
  return `<svg class="cmp-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.5" width="10.5" height="19" rx="2.4"/><path d="M8.8 18.4h2.9"/><path d="M18.6 8.6a3.6 3.6 0 0 1 0 4.8M21 6.4a7 7 0 0 1 0 9.2"/></svg>`;
}

/** QR code en SVG (modules noirs sur fond blanc, marge de 2 modules). */
export function qrSvg(text: string): string {
  const qr = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges"><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${d}" fill="#0a0e16"/></svg>`;
}

export function offerEnabled(): boolean {
  return localStorage.getItem(OFFER_KEY) !== 'off';
}

function phonesText(phones: number): string {
  return phones > 1 ? S('phonesMany').replace('{n}', String(phones)) : S('phonesOne');
}

function statusHtml(link: CompanionLink): string {
  const { phones } = link.presence;
  return phones ? `<i class="ok"></i>${phonesText(phones)}` : `<i></i>${S('noPhone')}`;
}

export class CompanionQr {
  readonly el = document.createElement('div');
  private open = false;
  /** Ouvert de lui-même au lancement de la sortie : se referme seul. */
  private offered = false;
  /** Proposé avant le départ : la sortie attend sa fermeture (ou un téléphone connecté). */
  private startWait: (() => void) | null = null;
  private prestart = false;
  /** La carte est déjà affichée : les mises à jour (présence, état) ne rejouent pas son animation d'entrée. */
  private shown = false;
  /** Téléphone connecté : coche verte affichée, départ programmé. */
  private connectedShown = false;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  url = '';
  svg = '';
  private readonly urlReady: Promise<void>;

  constructor(private readonly link: CompanionLink) {
    this.el.className = 'cmp-qr';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    link.listen(() => {
      // Téléphone connecté pendant la proposition : on le confirme, puis on s'efface.
      if (this.open && this.offered && link.presence.phones && !this.connectedShown) {
        this.connectedShown = true;
        clearTimeout(this.closeTimer);
        // Pastille verte un instant, puis la fenêtre se ferme et la sortie démarre (close() libère beforeRide).
        this.closeTimer = setTimeout(() => this.close(), CONNECTED_SHOW_MS);
      }
      if (this.open) this.render();
    });
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'new') void this.regenerate();
      else if (act === 'close' || e.target === this.el) this.close();
      else if (act === 'never') {
        localStorage.setItem(OFFER_KEY, 'off');
        this.close();
      }
    });
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'q' || e.key === 'Q') this.toggle();
      else if (this.open && (e.key === 'Escape' || e.key === ' ')) {
        // Échap / Espace ferment le code sans mettre la sortie en pause.
        this.close();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
    this.urlReady = this.refreshUrl();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(offered = false, prestart = false): void {
    // Serveur injoignable : un téléphone ne pourrait pas se connecter. Le code n'est pas montré, mais la fenêtre
    // l'explique (touche Q, pause) au lieu de ne rien afficher ; elle passe au code dès que le serveur répond.
    this.open = true;
    this.shown = false;
    this.connectedShown = false;
    this.offered = offered;
    this.prestart = prestart;
    clearTimeout(this.closeTimer);
    // Avant le départ, pas de fermeture automatique : c'est le joueur qui lance la sortie.
    if (offered && !prestart) this.closeTimer = setTimeout(() => this.close(), OFFER_CLOSE_S * 1000);
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.open = false;
    this.offered = false;
    clearTimeout(this.closeTimer);
    this.el.hidden = true;
    this.el.innerHTML = '';
    const go = this.startWait;
    this.startWait = null;
    go?.();
  }

  /**
   * Avant le départ d'une sortie (tous les modes) : propose le QR code si aucun téléphone n'est
   * appairé et que le joueur ne l'a pas refusé ; résolu quand il lance la sortie, ferme la
   * fenêtre ou qu'un téléphone se connecte. Sans serveur (ou refusé) : tout de suite.
   */
  async beforeRide(): Promise<void> {
    if (!offerEnabled()) return;
    // Page tout juste (re)chargée : quelques instants pour que la connexion au serveur s'établisse. Sinon, pas
    // d'attente : le départ (et son écran de préparation) suit le clic aussitôt.
    if (performance.now() < 8000) for (let i = 0; i < 6 && !this.link.connected; i++) await new Promise((r) => setTimeout(r, 250));
    await this.urlReady;
    if (!this.link.connected || this.link.presence.phones) return;
    await new Promise<void>((res) => {
      this.startWait = res;
      this.show(true, true);
    });
  }

  /**
   * Lancement d'une sortie : propose le QR code si aucun téléphone n'est appairé et que le
   * joueur ne l'a pas refusé. Attend quelques secondes la connexion au serveur (la page vient
   * de se recharger) ; sans serveur, rien n'est proposé.
   */
  async offer(): Promise<void> {
    if (!offerEnabled()) return;
    for (let i = 0; i < 12 && !this.link.connected; i++) await new Promise((r) => setTimeout(r, 500));
    await this.urlReady;
    // La présence arrive juste après l'entrée dans la salle.
    await new Promise((r) => setTimeout(r, 400));
    if (!this.link.connected || this.link.presence.phones || this.open) return;
    this.show(true);
  }

  async regenerate(): Promise<void> {
    this.link.regenerate();
    await this.refreshUrl();
  }

  private async refreshUrl(): Promise<void> {
    this.url = await this.link.url();
    this.svg = qrSvg(this.url);
    this.link.notify();
  }

  private render(): void {
    const close = `<button type="button" class="cmp-x" data-act="close" aria-label="${S('close')}">×</button>`;
    if (!this.link.connected) {
      this.el.innerHTML = `<div class="cmp-card panel${this.shown ? ' cmp-still' : ''}" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
        ${close}
        <header class="cmp-head"><span class="ab-ico sm">${phoneIcon(34)}</span><div><h2 class="ab-title" id="cmp-title">${S('offlineTitle')}</h2><p class="ab-sub">${S('app')}</p></div></header>
        <p class="ab-state is-bad cmp-status" role="status"><i></i>${S('offlineState')}</p>
        <p class="cmp-how">${S('offlineText')}</p>
        <div class="ab-foot cmp-foot"><div class="ab-btns"><button type="button" class="ab-btn ab-go" data-act="close">${this.prestart ? S('start') : S('close')}</button></div></div>
      </div>`;
      this.shown = true;
      return;
    }
    const phones = this.link.presence.phones;
    const done = this.offered && phones > 0;
    const actions = this.prestart
      ? `<button type="button" class="ab-btn" data-act="never">${S('never')}</button><div class="ab-btns"><button type="button" class="ab-btn ab-go" data-act="close">${S('start')}</button></div>`
      : this.offered
        ? `<button type="button" class="ab-btn" data-act="never">${S('never')}</button><div class="ab-btns"><button type="button" class="ab-btn ab-go" data-act="close">${S('later')}</button></div>`
        : `<button type="button" class="ab-btn" data-act="new">${S('newCode')}</button><div class="ab-btns"><button type="button" class="ab-btn ab-go" data-act="close">${S('close')}</button></div>`;
    this.el.innerHTML = `<div class="cmp-card panel${this.shown ? ' cmp-still' : ''}" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
      ${close}
      <header class="cmp-head"><span class="ab-ico sm">${phoneIcon(34)}</span><div><h2 class="ab-title" id="cmp-title">${this.prestart ? S('beforeYouGo') : S('app')}</h2><p class="ab-sub">${S('headline')}</p></div></header>
      <ul class="cmp-feats">${[S('f1'), S('f2'), S('f3'), S('f4'), S('f5')].map((f) => `<li>${f}</li>`).join('')}</ul>
      <div class="cmp-code ${done ? 'done' : ''}">${this.svg}${done ? '<svg class="cmp-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23" /><path d="M15 27 l8 8 l15 -17" /></svg>' : ''}</div>
      <p class="cmp-how">${S('how')}</p>
      <p class="ab-state cmp-status ${phones ? 'is-ok' : ''}" role="status"><i></i>${phones ? phonesText(phones) : S('waiting')}</p>
      <div class="ab-foot cmp-foot">${actions}</div>
    </div>`;
    this.shown = true;
  }
}

let instance: CompanionQr | null = null;

/** Instance unique (créée au premier appel). */
export function companionQr(): CompanionQr {
  instance ??= new CompanionQr(companion);
  return instance;
}

/**
 * Bloc « Appli compagnon » de l'onglet Réglages : petit QR code, état, proposition au
 * lancement d'une sortie, nouveau code. Se met à jour tant qu'il est affiché.
 */
export function renderCompanionSettings(el: Element | null, simple = false): void {
  if (!el) return;
  const qr = companionQr();
  const link = companion;
  const draw = () => {
    if (!link.connected) {
      el.innerHTML = `<p class="ab-state is-bad cmp-muted" role="status"><i></i>${S('unavailable')}</p>`;
      return;
    }
    // Version tutoriel : le code et l'état de la connexion, sans boutons ni options.
    if (simple) {
      el.innerHTML = `<div class="cmp-settings cmp-simple"><div class="cmp-code">${qr.svg}</div><div class="cmp-side"><p>${S('scanSimple')}</p><p class="cmp-state" role="status">${statusHtml(link)}</p></div></div>`;
      return;
    }
    el.innerHTML = `<div class="cmp-settings">
      <button type="button" class="cmp-code" data-act="big" title="${S('showLarge')}" aria-label="${S('showLarge')}">${qr.svg}</button>
      <div class="cmp-side">
        <p>${S('settingsText')}</p>
        <p class="cmp-state" role="status">${statusHtml(link)}</p>
        <label class="field cmp-offer"><input type="checkbox" data-act="offer" ${offerEnabled() ? 'checked' : ''} />${S('offerLabel')}</label>
        <div class="cmp-btns"><button type="button" class="ab-btn" data-act="big">${S('showLarge')}</button><button type="button" class="ab-btn" data-act="new">${S('newCode')}</button></div>
        <small class="cmp-hint">${S('newCodeHint')}</small>
      </div>
    </div>`;
  };
  const off = link.listen(() => (el.isConnected ? draw() : off()));
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'big') qr.show();
    else if (act === 'new') void qr.regenerate();
  });
  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.act === 'offer') localStorage.setItem(OFFER_KEY, input.checked ? 'on' : 'off');
  });
  draw();
}
