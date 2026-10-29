/**
 * QR code de l'appli compagnon : rien en permanence à l'écran. Il est proposé avant le départ
 * de chaque sortie, quel que soit le mode (si aucun téléphone n'est déjà appairé ; la sortie part
 * d'elle-même dès qu'un téléphone se connecte), puis reste à portée : touche Q, écran de pause,
 * onglet Réglages.
 * Le téléphone qui le lit est appairé sans compte (voir game/companionLink.ts).
 */
import './companionQr.css';
import { encode } from 'uqr';
import { getLang } from '../i18n/index.ts';
import { companion, type CompanionLink } from '../game/companionLink.ts';

/** « Proposer le QR code au lancement d'une sortie » (activé par défaut). */
const OFFER_KEY = 'ar.pair.offer';
const OFFER_CLOSE_S = 40;

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

function statusHtml(link: CompanionLink): string {
  const fr = getLang() === 'fr';
  const { phones } = link.presence;
  if (phones) return `<i class="ok"></i>${fr ? `${phones} téléphone${phones > 1 ? 's' : ''} connecté${phones > 1 ? 's' : ''}` : `${phones} phone${phones > 1 ? 's' : ''} connected`}`;
  return `<i></i>${fr ? 'Aucun téléphone connecté' : 'No phone connected'}`;
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
      if (this.open && this.offered && link.presence.phones) {
        clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => this.close(), 1500);
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
    // Serveur injoignable : un téléphone ne pourrait pas se connecter, on n'affiche pas de code.
    if (!this.link.connected) return;
    this.open = true;
    this.shown = false;
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
    const fr = getLang() === 'fr';
    const done = this.offered && this.link.presence.phones > 0;
    this.el.innerHTML = `<div class="cmp-card panel${this.shown ? ' cmp-still' : ''}" role="dialog" aria-label="${fr ? 'Appli compagnon' : 'Companion app'}">
      <button class="cmp-x" data-act="close" aria-label="${fr ? 'Fermer' : 'Close'}">×</button>
      <span class="cmp-badge">${phoneIcon(26)}</span>
      <b>${this.prestart ? (fr ? 'Avant de partir' : 'Before you go') : fr ? 'Appli compagnon' : 'Companion app'}</b>
      <h2>${fr ? 'Pilote ta sortie depuis ton téléphone' : 'Control your ride from your phone'}</h2>
      <ul class="cmp-feats">${(fr ? ['Compteur', 'Vitesses', 'Carrefours', 'Musique', 'Chat'] : ['Computer', 'Gears', 'Junctions', 'Music', 'Chat']).map((f) => `<li>${f}</li>`).join('')}</ul>
      <div class="cmp-code ${done ? 'done' : ''}">${this.svg}${done ? '<span>✓</span>' : ''}</div>
      <p class="cmp-how">${fr ? 'Ouvre l’appareil photo de ton téléphone et vise ce code.<br>Aucun compte à créer.' : 'Open your phone camera and point it at this code.<br>No account needed.'}</p>
      <p class="cmp-state">${statusHtml(this.link)}</p>
      <div class="cmp-row">
        ${
          this.prestart
            ? `<button class="btn primary" data-act="close">${fr ? 'Lancer la sortie' : 'Start the ride'}</button><button class="btn ghost" data-act="never">${fr ? 'Ne plus proposer' : 'Don’t offer again'}</button>`
            : this.offered
              ? `<button class="btn primary" data-act="close">${fr ? 'Plus tard' : 'Later'}</button><button class="btn ghost" data-act="never">${fr ? 'Ne plus proposer' : 'Don’t offer again'}</button>`
              : `<button class="btn" data-act="new">${fr ? 'Nouveau code' : 'New code'}</button>`
        }
      </div>
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
  const fr = getLang() === 'fr';
  const draw = () => {
    if (!link.connected) {
      el.innerHTML = `<p class="cmp-muted">${fr ? 'L’appli compagnon n’est pas disponible pour le moment.' : 'The companion app is not available right now.'}</p>`;
      return;
    }
    // Version tutoriel : le code et l'état de la connexion, sans boutons ni options.
    if (simple) {
      el.innerHTML = `<div class="cmp-settings cmp-simple"><div class="cmp-code">${qr.svg}</div><div class="cmp-side"><p>${fr ? 'Scanne ce code avec l’appareil photo de ton téléphone. Pas de compte à créer.' : 'Scan this code with your phone camera. No account needed.'}</p><p class="cmp-state">${statusHtml(link)}</p></div></div>`;
      return;
    }
    el.innerHTML = `<div class="cmp-settings">
      <button class="cmp-code" data-act="big" title="${fr ? 'Afficher en grand' : 'Show large'}">${qr.svg}</button>
      <div class="cmp-side">
        <p>${fr ? 'Pilote la sortie depuis ton téléphone (compteur, vitesses, carrefours, musique, chat), en solo comme à plusieurs. Scanne le code avec l’appareil photo : pas de compte à créer.' : 'Control the ride from your phone (bike computer, gears, turns, music, chat), solo or with friends. Scan the code with the camera: no account needed.'}</p>
        <p class="cmp-state">${statusHtml(link)}</p>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-act="offer" ${offerEnabled() ? 'checked' : ''} style="width:auto" />${fr ? 'Proposer le QR code au lancement d’une sortie' : 'Offer the QR code when a ride starts'}</label>
        <div class="row"><button class="btn" data-act="big">${fr ? 'Afficher en grand' : 'Show large'}</button><button class="btn" data-act="new">${fr ? 'Nouveau code' : 'New code'}</button></div>
        <small class="cmp-hint">${fr ? '« Nouveau code » déconnecte les téléphones déjà appairés.' : '“New code” disconnects phones already paired.'}</small>
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
