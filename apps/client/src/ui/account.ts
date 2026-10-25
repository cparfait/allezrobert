import { serverEndpoint } from '../game/multiplayer.ts';
import { getLang } from '../i18n/index.ts';
import { saveSettings, type Settings } from './settings.ts';
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

/** Envoie le profil local vers le compte (après modification dans le menu). */
export async function pushProfile(s: Settings, level?: number): Promise<void> {
  // Équipement (pièces de l'atelier possédées, cosmétiques débloqués au niveau du compte) : le serveur
  // s'en sert pour le vélo roulé en salle.
  const equipped = level !== undefined ? { equipped: equippedForServer(level) } : {};
  await api('/me/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: s.name, weightKg: s.massKg, heightCm: s.heightCm, ftpWatts: Math.round(s.ftpWatts), avatar: s.look, skipStrava: s.skipStrava, locale: s.lang, ...equipped }),
  }).catch(() => undefined);
}

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Écran de connexion : Google, Discord, lien magique par e-mail, connexion de développement
 * (serveur local uniquement), ou « sans compte » pour rouler seul.
 */
export async function showLogin(root: HTMLElement, s: Settings, done: (me: Me | null) => void): Promise<void> {
  const fr = getLang() === 'fr';
  const prov = await fetchProviders();
  // Retour sur la page du jeu (/jouer en production : la racine est le site de présentation).
  const back = encodeURIComponent(location.pathname);
  const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const DISCORD_LOGO = '<svg viewBox="0 0 127.14 96.36" width="22" height="17" fill="#fff" aria-hidden="true"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>';
  const btn = (id: string, label: string, style: string, icon: string, on: boolean) =>
    on ? `<button class="btn" id="${id}" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;${style};margin-bottom:10px">${icon}${label}</button>` : '';
  root.innerHTML = `<div class="menu"><div class="card panel" style="max-width:520px">
    <h1>Allez <em>Robert</em> !</h1>
    <p class="tagline">${fr ? 'Connecte-toi pour rouler en groupe, garder ta progression et envoyer tes sorties.' : 'Sign in to ride with friends, keep your progress and upload rides.'}</p>
    ${
      prov
        ? `${btn('l-google', fr ? 'Continuer avec Google' : 'Continue with Google', 'background:#fff;color:#3c4043;border:1px solid #dadce0', GOOGLE_G, prov.google)}${btn('l-discord', fr ? 'Continuer avec Discord' : 'Continue with Discord', 'background:#5865f2;color:#fff', DISCORD_LOGO, prov.discord)}
      ${
        prov.email
          ? `<form id="l-magic" class="row" style="margin:6px 0 12px"><input id="l-email" type="email" required placeholder="${fr ? 'adresse e-mail' : 'email address'}" class="btn" style="flex:1;text-align:left;font-weight:400"/><button class="btn primary" type="submit">${fr ? 'Recevoir un lien' : 'Get a link'}</button></form><div id="l-msg" class="meta" style="color:var(--ar-muted);font-size:13px"></div>`
          : ''
      }
      ${prov.dev ? `<form id="l-dev" class="row" style="margin-top:12px"><input id="l-devname" value="${esc(s.name)}" class="btn" style="flex:1;text-align:left;font-weight:400"/><button class="btn" type="submit">${fr ? 'Connexion locale (dev)' : 'Local sign-in (dev)'}</button></form>` : ''}
      ${!prov.google && !prov.discord ? `<p class="meta" style="color:var(--ar-muted);font-size:13px">${fr ? 'Google et Discord apparaîtront une fois leurs identifiants OAuth configurés sur le serveur.' : 'Google and Discord appear once their OAuth credentials are set on the server.'}</p>` : ''}`
        : `<div class="warning">${fr ? 'Serveur injoignable : tu peux rouler seul sans compte.' : 'Server unreachable: you can ride solo without an account.'}</div>`
    }
    <button class="btn" id="l-skip" style="width:100%;margin-top:14px">${fr ? 'Continuer sans compte (sortie solo)' : 'Continue without account (solo ride)'}</button>
  </div></div>`;
  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement | null;
  $('l-google')?.addEventListener('click', () => (location.href = `${apiBase()}/auth/google/start?redirect=${back}`));
  $('l-discord')?.addEventListener('click', () => (location.href = `${apiBase()}/auth/discord/start?redirect=${back}`));
  $('l-magic')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('l-email') as HTMLInputElement).value.trim();
    // Adresse vérifiée avant l'envoi : une seule arobase, un domaine avec un point, sans espace.
    const msg0 = $('l-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      if (msg0) msg0.textContent = fr ? 'Adresse e-mail invalide : vérifie-la avant de recevoir le lien.' : 'Invalid email address: check it before getting the link.';
      return;
    }
    const r = await api('/auth/magic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirect: location.pathname, locale: getLang() }) }).catch(() => null);
    const msg = $('l-msg');
    if (msg) msg.textContent = r && r.ok ? (fr ? 'Lien envoyé : ouvre ton e-mail sur cet ordinateur.' : 'Link sent: open your email on this computer.') : fr ? 'Envoi impossible pour le moment.' : 'Could not send the link right now.';
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
    localStorage.setItem('ar.skipLogin', '1');
    done(null);
  });
}
