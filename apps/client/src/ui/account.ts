import { serverEndpoint } from '../game/multiplayer.ts';
import { getLang } from '../i18n/index.ts';
import { saveSettings, type Settings } from './settings.ts';

/** Base de l'API du serveur (même hôte que les salles Colyseus). */
export function apiBase(): string {
  return `${serverEndpoint().replace(/\/colyseus$/, '')}/api`;
}

export interface Me {
  id: string;
  profile: { displayName: string; weightKg?: number; heightCm?: number; ftpWatts?: number; consentHr?: boolean; skipStrava?: boolean };
  progression: { level: number; xp: number };
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
}

/** Envoie le profil local vers le compte (après modification dans le menu). */
export async function pushProfile(s: Settings): Promise<void> {
  await api('/me/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: s.name, weightKg: s.massKg, heightCm: s.heightCm, ftpWatts: Math.round(s.ftpWatts), avatar: s.look, skipStrava: s.skipStrava, locale: s.lang }),
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
  const back = encodeURIComponent('/');
  const btn = (id: string, label: string, color: string, on: boolean) =>
    on ? `<button class="btn" id="${id}" style="width:100%;justify-content:center;background:${color};color:#fff;margin-bottom:10px">${label}</button>` : '';
  root.innerHTML = `<div class="menu"><div class="card panel" style="max-width:520px">
    <h1>Allez <em>Robert</em> !</h1>
    <p class="tagline">${fr ? 'Connecte-toi pour rouler en groupe, garder ta progression et envoyer tes sorties.' : 'Sign in to ride with friends, keep your progress and upload rides.'}</p>
    ${
      prov
        ? `${btn('l-google', 'Google', '#4285f4', prov.google)}${btn('l-discord', 'Discord', '#5865f2', prov.discord)}
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
    const r = await api('/auth/magic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirect: '/', locale: getLang() }) }).catch(() => null);
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
