import type { AvatarLook } from '@allezrobert/shared';
import { serverEndpoint } from '../game/multiplayer.ts';
import './blocks.css';
import './account.css';
import { getLang, strings } from '../i18n/index.ts';
import { saveSettings, type Settings } from './settings.ts';
import { inDesktopApp, setDesktopSession, startDesktopLogin } from '../net/desktopAuth.ts';
import { applyServerAtelier, equippedForServer } from './garage.ts';

/** Base de l'API du serveur (même hôte que les salles Colyseus). */
export function apiBase(): string {
  return `${serverEndpoint().replace(/\/colyseus$/, '')}/api`;
}

export interface Me {
  id: string;
  profile: { displayName: string; weightKg?: number; heightCm?: number; ftpWatts?: number; consentHr?: boolean; skipStrava?: boolean };
  progression: { level: number; xp: number };
  /** Atelier du compte : solde, pièces possédées, événements, série, ensembles complets. */
  atelier?: { credits: number; owned: string[]; events: string[]; streak: { last: string; days: number }; kits: string[] };
}

interface Providers {
  google: boolean;
  discord: boolean;
  email: boolean;
  dev: boolean;
}

const api = (path: string, init?: RequestInit) => fetch(`${apiBase()}${path}`, { credentials: 'include', ...init });

/** Compte connecté (cookie de session), ou null : hors ligne ou non connecté. */
export async function fetchMe(): Promise<Me | null> {
  try {
    const r = await api('/me');
    return r.ok ? ((await r.json()) as Me) : null;
  } catch {
    return null;
  }
}

async function fetchProviders(): Promise<Providers | null> {
  try {
    const r = await api('/auth/providers');
    return r.ok ? ((await r.json()) as Providers) : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  setDesktopSession(null);
}

/** Recopie le profil du compte dans les réglages locaux (poids, taille, FTP, nom). */
export function applyProfile(me: Me, s: Settings): void {
  const p = me.profile;
  s.name = p.displayName || s.name;
  if (p.weightKg) s.massKg = p.weightKg;
  if (p.heightCm) s.heightCm = p.heightCm;
  if (p.ftpWatts) s.ftpWatts = p.ftpWatts;
  if (p.skipStrava !== undefined) s.skipStrava = p.skipStrava;
  saveSettings(s);
  // Atelier : le compte fait foi (crédits et pièces validés par le serveur).
  if (me.atelier) applyServerAtelier(me.atelier, s);
}

/** Achat sur le compte (prix, niveau et solde vérifiés par le serveur). */
export async function buyOnServer(id: string): Promise<{ ok: boolean; credits?: number; owned?: string[]; error?: string; missing?: number }> {
  try {
    const r = await api('/shop/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    const body = (await r.json()) as { ok?: boolean; credits?: number; owned?: string[]; error?: string; missing?: number };
    return { ...body, ok: r.ok && !!body.ok };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Envoie le profil local vers le compte (après modification dans le menu, et avant d'entrer dans une
 * salle) ; renvoie true si le compte l'a enregistré.
 */
export async function pushProfile(s: Settings, level?: number): Promise<boolean> {
  // Équipement (pièces de l'atelier possédées, cosmétiques débloqués au niveau du compte) : le serveur
  // s'en sert pour le vélo roulé en salle.
  const equipped = level !== undefined ? { equipped: equippedForServer(level) } : {};
  const put = (avatar: AvatarLook, extra: object) =>
    api('/me/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: s.name, weightKg: s.massKg, heightCm: s.heightCm, ftpWatts: Math.round(s.ftpWatts), avatar, skipStrava: s.skipStrava, locale: s.lang, ...extra }),
    }).catch(() => null);
  let r = await put(s.look, equipped);
  // Pièce ou modèle de vélo refusé par le compte : le reste de l'apparence (couleurs, tenue) est
  // enregistré quand même, sinon les autres coureurs verraient l'ancien avatar.
  if (r?.status === 400) {
    const { bikeModel: _model, tune: _tune, ...look } = s.look;
    r = await put(look, {});
  }
  return !!r?.ok;
}

const S = strings(
  {
    tagline: 'Connecte-toi pour rouler en groupe, garder ta progression et envoyer tes sorties.',
    withAccount: 'Avec un compte',
    withAccountDetail: 'Google, Discord ou un lien par e-mail',
    withoutAccount: 'Sans compte',
    withoutAccountDetail: 'Pour rouler seul tout de suite',
    with1: 'Amis et sorties de groupe',
    with2: 'Progression et historique sur tous tes appareils',
    with3: 'Envoi vers Strava',
    without1: 'Sorties solo, tous les parcours',
    without2: 'Tout reste sur cet appareil',
    without3: 'Tu pourras te connecter plus tard',
    signIn: 'Se connecter',
    google: 'Continuer avec Google',
    discord: 'Continuer avec Discord',
    emailPlaceholder: 'adresse e-mail',
    emailLabel: 'Adresse e-mail pour recevoir un lien de connexion',
    getLink: 'Recevoir un lien',
    devSignIn: 'Connexion locale (dev)',
    devName: 'Nom du coureur (connexion locale)',
    oauthMissing: 'Google et Discord apparaîtront une fois leurs identifiants OAuth configurés sur le serveur.',
    unreachable: 'Serveur injoignable : tu peux rouler seul sans compte.',
    unreachableState: 'Injoignable',
    unreachableDev: 'Google, Discord et le compagnon demandent le serveur : lance <code>pnpm dev</code> (client + serveur + compagnon) à la racine du projet.',
    skip: 'Continuer sans compte',
    finishInBrowser: 'Termine la connexion dans ton navigateur, puis reviens ici…',
    invalidEmail: 'Adresse e-mail invalide : vérifie-la avant de recevoir le lien.',
    linkSent: 'Lien envoyé : ouvre ton e-mail sur cet ordinateur.',
    linkFailed: 'Envoi impossible pour le moment.',
    loading: 'Chargement du jeu en arrière-plan',
    ready: 'Le jeu est prêt.',
  },
  {
    tagline: 'Sign in to ride with friends, keep your progress and upload rides.',
    withAccount: 'With an account',
    withAccountDetail: 'Google, Discord or an email link',
    withoutAccount: 'Without an account',
    withoutAccountDetail: 'To ride solo right away',
    with1: 'Friends and group rides',
    with2: 'Progress and history on every device',
    with3: 'Upload to Strava',
    without1: 'Solo rides, every route',
    without2: 'Everything stays on this device',
    without3: 'You can sign in later',
    signIn: 'Sign in',
    google: 'Continue with Google',
    discord: 'Continue with Discord',
    emailPlaceholder: 'email address',
    emailLabel: 'Email address to receive a sign-in link',
    getLink: 'Get a link',
    devSignIn: 'Local sign-in (dev)',
    devName: 'Rider name (local sign-in)',
    oauthMissing: 'Google and Discord appear once their OAuth credentials are set on the server.',
    unreachable: 'Server unreachable: you can ride solo without an account.',
    unreachableState: 'Unreachable',
    unreachableDev: 'Google, Discord and the companion need the server: run <code>pnpm dev</code> (client + server + companion) at the project root.',
    skip: 'Continue without account',
    finishInBrowser: 'Finish signing in in your browser, then come back here…',
    invalidEmail: 'Invalid email address: check it before getting the link.',
    linkSent: 'Link sent: open your email on this computer.',
    linkFailed: 'Could not send the link right now.',
    loading: 'Loading the game in the background',
    ready: 'The game is ready.',
  },
);

/** Icônes au trait des deux blocs (24 × 24, couleur du texte). */
const ICON_GROUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.3c2.4.2 4 1.8 4.5 4.6"/></svg>';
const ICON_SOLO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c.7-4 3.5-6.2 7-6.2s6.3 2.2 7 6.2"/></svg>';

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Écran de connexion : Google, Discord, lien magique par e-mail, connexion de développement
 * (serveur local uniquement), ou « sans compte » pour rouler seul.
 */
export async function showLogin(root: HTMLElement, s: Settings, done: (me: Me | null) => void): Promise<void> {
  const prov = await fetchProviders();
  // Retour sur la page du jeu (/jouer en production : la racine est le site de présentation).
  const back = encodeURIComponent(location.pathname);
  const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const DISCORD_LOGO = '<svg viewBox="0 0 127.14 96.36" width="22" height="17" fill="#fff" aria-hidden="true"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>';
  // Boutons des fournisseurs : aux couleurs de Google et de Discord (chartes des marques), forme des blocs.
  const btn = (id: string, label: string, cls: string, icon: string, on: boolean) => (on ? `<button type="button" class="ab-btn lg-prov ${cls}" id="${id}">${icon}${label}</button>` : '');
  const list = (items: string[]) => `<ul class="lg-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  root.innerHTML = `<div class="menu"><div class="card panel lg-card">
    <header class="lg-head"><h1 class="ab-title">Allez <em>Robert</em> !</h1><p class="ab-sub">${S('tagline')}</p></header>
    <div class="ab-grid ab-grid-2 lg-modes">
      <div class="ab-tile is-on"><span class="ab-ico sm">${ICON_GROUP}</span><span class="ab-name">${S('withAccount')}</span><span class="ab-detail">${S('withAccountDetail')}</span><div class="lg-tile-body">${list([S('with1'), S('with2'), S('with3')])}</div></div>
      <div class="ab-tile"><span class="ab-ico sm">${ICON_SOLO}</span><span class="ab-name">${S('withoutAccount')}</span><span class="ab-detail">${S('withoutAccountDetail')}</span><div class="lg-tile-body">${list([S('without1'), S('without2'), S('without3')])}</div></div>
    </div>
    ${
      prov
        ? `<section class="lg-signin"><h2 class="ab-section">${S('signIn')}</h2>
      ${btn('l-google', S('google'), 'lg-google', GOOGLE_G, prov.google)}${btn('l-discord', S('discord'), 'lg-discord', DISCORD_LOGO, prov.discord)}
      ${
        prov.email
          ? `<form id="l-magic" class="lg-form"><input id="l-email" type="email" required placeholder="${S('emailPlaceholder')}" aria-label="${S('emailLabel')}" class="lg-input"/><button class="ab-btn" type="submit">${S('getLink')}</button></form><div id="l-msg" class="lg-msg" role="status"></div>`
          : ''
      }
      ${prov.dev ? `<form id="l-dev" class="lg-form"><input id="l-devname" value="${esc(s.name)}" aria-label="${S('devName')}" class="lg-input"/><button class="ab-btn" type="submit">${S('devSignIn')}</button></form>` : ''}
      ${!prov.google && !prov.discord ? `<p class="lg-msg">${S('oauthMissing')}</p>` : ''}</section>`
        : `<div class="ab-tile ab-plain is-bad lg-offline" role="status"><span class="ab-state"><i></i>${S('unreachableState')}</span><p>${S('unreachable')}</p>${import.meta.env.DEV ? `<p class="lg-dev">${S('unreachableDev')}</p>` : ''}</div>`
    }
    <div class="ab-foot"><span id="l-wait" class="lg-msg" role="status"></span><div class="ab-btns"><button type="button" class="ab-btn ab-go" id="l-skip">${S('skip')}</button></div></div>
  </div></div>`;
  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement | null;
  // Application Windows : la connexion se fait dans le navigateur du PC, puis on récupère la session.
  const desktop = inDesktopApp ? startDesktopLogin(apiBase()) : null;
  let waiting: AbortController | undefined;
  const waitDesktop = async (): Promise<void> => {
    if (!desktop) return;
    waiting?.abort();
    waiting = new AbortController();
    const wait = $('l-wait');
    if (wait) wait.textContent = S('finishInBrowser');
    if (!(await desktop.wait(waiting.signal))) return;
    const me = await fetchMe();
    if (me) applyProfile(me, s);
    done(me);
  };
  const oauth = (provider: 'google' | 'discord') => {
    if (!desktop) return void (location.href = `${apiBase()}/auth/${provider}/start?redirect=${back}`);
    void desktop.open(`${apiBase()}/auth/${provider}/start?redirect=${encodeURIComponent(desktop.redirect)}`).then(waitDesktop);
  };
  $('l-google')?.addEventListener('click', () => oauth('google'));
  $('l-discord')?.addEventListener('click', () => oauth('discord'));
  $('l-magic')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('l-email') as HTMLInputElement).value.trim();
    // Adresse vérifiée avant l'envoi : une seule arobase, un domaine avec un point, sans espace.
    const msg0 = $('l-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      if (msg0) msg0.textContent = S('invalidEmail');
      return;
    }
    const r = await api('/auth/magic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirect: desktop ? desktop.redirect : location.pathname, locale: getLang() }) }).catch(() => null);
    const msg = $('l-msg');
    if (msg) msg.textContent = r && r.ok ? S('linkSent') : S('linkFailed');
    if (r && r.ok) void waitDesktop();
  });
  $('l-dev')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('l-devname') as HTMLInputElement).value.trim() || 'Robert';
    await api('/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    const me = await fetchMe();
    if (me) applyProfile(me, s);
    done(me);
  });
  $('l-skip')?.addEventListener('click', () => {
    waiting?.abort();
    localStorage.setItem('ar.skipLogin', '1');
    done(null);
  });
}

/**
 * Choix « connexion ou sans compte » dès le démarrage, par-dessus l'écran de chargement : le jeu continue de se charger
 * derrière. Résolu tout de suite si une session existe ou si le joueur a déjà choisi de rouler sans compte.
 */
export async function earlyLogin(s: Settings): Promise<Me | null> {
  const me = await fetchMe();
  if (me || localStorage.getItem('ar.skipLogin')) return me;
  const host = document.createElement('div');
  host.id = 'early-login';
  document.body.appendChild(host);
  return new Promise<Me | null>((resolve) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    void showLogin(host, s, (m) => {
      clearInterval(timer);
      host.remove();
      resolve(m);
    }).then(() => {
      // Avancement du chargement, repris de l'écran de chargement (caché derrière) : rien n'attend la réponse du joueur.
      const card = host.querySelector('.card');
      if (!card) return;
      const line = document.createElement('p');
      line.className = 'lg-load meta';
      card.appendChild(line);
      const sync = () => {
        const step = document.getElementById('splash-step')?.textContent;
        const pct = document.getElementById('splash-pct')?.textContent;
        line.textContent = document.getElementById('splash')
          ? `${S('loading')} · ${pct ?? ''}${step ? ` · ${step}` : ''}`
          : S('ready');
      };
      sync();
      timer = setInterval(sync, 400);
    });
  });
}
