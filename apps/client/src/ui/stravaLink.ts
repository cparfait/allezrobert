import { inDesktopApp, openExternal } from '../net/desktopAuth.ts';
import './blocks.css';
import { strings } from '../i18n/index.ts';
import { apiBase } from './account.ts';

interface StravaState {
  available: boolean;
  connected: boolean;
  athleteName: string | null;
}

const S = strings(
  {
    detail: 'Envoi automatique des sorties enregistrées.',
    signIn: 'Connecte-toi avec Discord ou Google (en haut à droite) pour relier ton compte Strava.',
    stateSignedOut: 'Sans compte',
    checking: 'Vérification…',
    linked: 'Compte Strava relié.',
    scope: 'Il faut autoriser l’envoi d’activités pour relier Strava.',
    failed: 'La liaison avec Strava a échoué, réessaie.',
    unreachable: 'Serveur injoignable : impossible de lire l’état de Strava.',
    stateUnreachable: 'Injoignable',
    notConfigured: 'Strava n’est pas configuré sur le serveur (STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans apps/server/.env).',
    stateNotConfigured: 'Indisponible',
    stateLinked: 'Relié',
    connectedAs: 'Relié au compte {name}.',
    connectedNoName: 'Tes sorties enregistrées partent sur Strava.',
    unlink: 'Délier',
    desktopWait: 'Termine la liaison dans ton navigateur, puis reviens ici : le bloc se met à jour tout seul.',
    stateWaiting: 'En attente de Strava…',
    stateNotLinked: 'Non relié',
    link: 'Relier mon compte Strava',
    linkHint: 'Tes sorties enregistrées partiront sur Strava (sauf « Ne pas envoyer »).',
  },
  {
    detail: 'Saved rides are uploaded automatically.',
    signIn: 'Sign in with Discord or Google (top right) to link your Strava account.',
    stateSignedOut: 'No account',
    checking: 'Checking…',
    linked: 'Strava account linked.',
    scope: 'You must allow activity uploads to link Strava.',
    failed: 'Linking with Strava failed, try again.',
    unreachable: 'Server unreachable: cannot read the Strava status.',
    stateUnreachable: 'Unreachable',
    notConfigured: 'Strava is not configured on the server (STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in apps/server/.env).',
    stateNotConfigured: 'Unavailable',
    stateLinked: 'Linked',
    connectedAs: 'Linked to the {name} account.',
    connectedNoName: 'Your saved rides are sent to Strava.',
    unlink: 'Unlink',
    desktopWait: 'Finish linking in your browser, then come back here: this block updates by itself.',
    stateWaiting: 'Waiting for Strava…',
    stateNotLinked: 'Not linked',
    link: 'Link my Strava account',
    linkHint: 'Your saved rides will be sent to Strava (unless “Don’t upload”).',
  },
);

const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Flèche d'envoi (trait fin, comme les autres icônes des blocs). */
const UPLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>';

async function fetchStrava(): Promise<StravaState | null> {
  try {
    const r = await fetch(`${apiBase()}/integrations`, { credentials: 'include' });
    if (!r.ok) return null;
    return ((await r.json()) as { strava: StravaState }).strava;
  } catch {
    return null;
  }
}

/** Résultat de la liaison, ajouté à l'adresse par le serveur au retour de Strava (?strava=linked|failed|scope). */
function takeReturnCode(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get('strava');
  if (!code) return null;
  url.searchParams.delete('strava');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return code;
}

let returned: string | null | undefined;

/**
 * Images officielles de Strava (developers.strava.com/guidelines, archives 1.1 et 1.2), utilisées telles quelles :
 * bouton « Connect with Strava » (48 px de haut) et logo « Compatible with Strava » (blanc, sur fond sombre).
 */
const STRAVA_BUTTON = `${import.meta.env.BASE_URL}strava/btn_strava_connect_with_orange.svg`;
export const STRAVA_COMPATIBLE_LOGO = `${import.meta.env.BASE_URL}strava/api_logo_cptblWith_strava_horiz_white.svg`;
/** Logo « Compatible with Strava », plus discret que le nom du jeu (règles de marque de Strava). */
export function stravaCompatibleHtml(): string {
  return `<img class="strava-compat" src="${STRAVA_COMPATIBLE_LOGO}" alt="Compatible with Strava" height="14" loading="lazy" />`;
}

/** Bloc « Strava » au langage des gros blocs : icône, détail, état en toutes lettres, action en pied. */
function tile(tone: '' | 'is-ok' | 'is-info' | 'is-warn' | 'is-bad', detail: string, state: string, action = ''): string {
  return `<div class="ab-tile ${tone}" style="padding:14px 16px 12px"><span class="ab-ico sm">${UPLOAD_ICON}</span><span class="ab-name">Strava</span><span class="ab-detail">${detail}</span><span class="ab-state"><i></i>${state}</span>${action}</div><div class="strava-compat-row">${stravaCompatibleHtml()}</div>`;
}

/** Application de bureau : adresse de liaison ouverte dans le navigateur du PC, puis attente de la liaison (5 min). */
async function linkFromDesktop(el: Element): Promise<void> {
  el.innerHTML = tile('is-info', S('desktopWait'), S('stateWaiting'));
  try {
    const r = await fetch(`${apiBase()}/integrations/strava/link-url`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect: '/site/strava.html' }) });
    if (!r.ok) throw new Error(String(r.status));
    await openExternal(((await r.json()) as { url: string }).url);
  } catch {
    el.innerHTML = tile('is-bad', S('failed'), S('stateUnreachable'));
    return;
  }
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until && el.isConnected) {
    await new Promise((res) => setTimeout(res, 3000));
    const st = await fetchStrava();
    if (st?.connected) {
      returned = 'linked';
      renderStravaLink(el, true);
      return;
    }
  }
  if (el.isConnected) renderStravaLink(el, true);
}

/**
 * Liaison du compte Strava (Réglages → envoi des sorties) : visible une fois connecté avec Discord, Google ou
 * un lien magique. La sortie part ensuite vers Strava à l'enregistrement, sauf option « Ne pas envoyer ».
 */
export function renderStravaLink(el: Element | null, loggedIn: boolean): void {
  if (!el) return;
  returned ??= takeReturnCode();
  if (!loggedIn) {
    el.innerHTML = tile('', S('signIn'), S('stateSignedOut'));
    return;
  }
  el.innerHTML = tile('', S('detail'), S('checking'));
  void fetchStrava().then((st) => {
    if (!el.isConnected) return;
    const msg = returned === 'linked' ? S('linked') : returned === 'scope' ? S('scope') : returned === 'failed' ? S('failed') : '';
    const flash = msg ? `<p class="ab-sub" style="color:#ffe37a;font-size:14px;margin:0 0 8px" role="status">${msg}</p>` : '';
    if (!st) {
      el.innerHTML = tile('is-bad', S('unreachable'), S('stateUnreachable'));
    } else if (!st.available) {
      el.innerHTML = flash + tile('is-warn', S('notConfigured'), S('stateNotConfigured'));
    } else if (st.connected) {
      const detail = st.athleteName ? S('connectedAs').replace('{name}', esc(st.athleteName)) : S('connectedNoName');
      el.innerHTML = flash + tile('is-ok', detail, S('stateLinked'), `<button type="button" class="ab-btn ab-chip" id="strava-unlink">${S('unlink')}</button>`);
      el.querySelector('#strava-unlink')?.addEventListener('click', async () => {
        await fetch(`${apiBase()}/integrations/strava`, { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
        returned = null;
        renderStravaLink(el, true);
      });
    } else {
      // Bouton officiel « Connect with Strava » (image de Strava, non modifiée) : il mène à la page d'autorisation de Strava.
      el.innerHTML = flash + tile('', S('linkHint'), S('stateNotLinked'), `<button type="button" class="strava-connect" id="strava-link" aria-label="${S('link')}"><img src="${STRAVA_BUTTON}" alt="Connect with Strava" width="237" height="48" /></button>`);
      el.querySelector('#strava-link')?.addEventListener('click', () => {
        if (!inDesktopApp) {
          // Navigateur : aller-retour sur Strava, retour sur le jeu (/jouer).
          location.href = `${apiBase()}/integrations/strava/start?redirect=${encodeURIComponent(location.pathname)}`;
          return;
        }
        // Application de bureau : la liaison se fait dans le navigateur du PC (l'application ne quitte pas son écran),
        // puis l'application vérifie toutes les 3 s que le compte est relié.
        void linkFromDesktop(el);
      });
    }
    returned = null;
  });
}
