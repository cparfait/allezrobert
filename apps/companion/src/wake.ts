/** Écran gardé allumé tant qu'un jeu est appairé ; proposition d'installation (PWA). */
import { esc } from './dom.ts';
import { S, t } from './state.ts';

let wakeLock: { release(): Promise<void> } | null = null;
/** L'écran ne reste allumé que si un jeu est appairé : sans jeu, le téléphone se met en veille normalement. */
const wantAwake = (): boolean => S.presence.game;

export async function keepAwake(): Promise<void> {
  if (wakeLock || !wantAwake()) return;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void }> } };
    if (nav.wakeLock && document.visibilityState === 'visible') {
      const lock = await nav.wakeLock.request('screen');
      // Le jeu est parti pendant la demande (ou un autre verrou est arrivé avant) : on rend celui-ci tout de suite.
      if (!wantAwake() || wakeLock) {
        void lock.release().catch(() => undefined);
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    }
  } catch {
    wakeLock = null;
  }
}

/** Prend ou rend le verrou d'écran selon la présence du jeu. */
export function syncWake(): void {
  if (wantAwake()) void keepAwake();
  else if (wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    void lock.release().catch(() => undefined);
  }
}

/**
 * Proposition d'installation : bandeau sur les écrans d'attente seulement (jamais en roulant). Chrome / Edge / Android :
 * bouton « Installer » (événement beforeinstallprompt) ; iPhone / iPad : consigne « Sur l'écran d'accueil ».
 * Rien si l'appli est déjà installée ; « Plus tard » le masque 14 jours.
 */
const INSTALL_KEY = 'ar.companion.installAsked';
let installEvent: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const riding = () => !!S.st && S.st.phase !== 'menu';

function installAsked(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(INSTALL_KEY) ?? 0) < 14 * 86_400_000;
  } catch {
    return false;
  }
}

function showInstall(): void {
  if (riding() || standalone() || installAsked() || document.getElementById('install')) return;
  if (!installEvent && !isIos()) return;
  const el = document.createElement('div');
  el.id = 'install';
  el.className = 'install';
  el.innerHTML = `<div><b>${esc(t.installTitle)}</b><span>${esc(installEvent ? t.installText : t.installIos)}</span></div>
    ${installEvent ? `<button class="btn go" data-act="install">${esc(t.installBtn)}</button>` : ''}
    <button class="btn ghost" data-act="later">${esc(t.installLater)}</button>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'install' && installEvent) {
      void installEvent.prompt();
      void installEvent.userChoice.finally(() => el.remove());
      installEvent = null;
    } else if (act === 'later') {
      localStorage.setItem(INSTALL_KEY, String(Date.now()));
      el.remove();
    }
  });
}

/** Passage de l'accueil à la sortie ou l'inverse : le bandeau s'efface en roulant et revient à l'accueil. */
export function syncInstall(): void {
  if (riding()) document.getElementById('install')?.remove();
  else showInstall();
}

export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as typeof installEvent;
    setTimeout(showInstall, 2500);
  });
  window.addEventListener('appinstalled', () => document.getElementById('install')?.remove());
  // iPhone : pas d'événement, la consigne est montrée une fois le téléphone appairé.
  if (isIos() && !standalone()) setTimeout(showInstall, 6000);
}
