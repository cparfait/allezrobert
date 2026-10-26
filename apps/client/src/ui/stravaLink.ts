import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';

interface StravaState {
  available: boolean;
  connected: boolean;
  athleteName: string | null;
}

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
 * Liaison du compte Strava (Réglages → envoi des sorties) : visible une fois connecté avec Discord, Google ou
 * un lien magique. La sortie part ensuite vers Strava à l'enregistrement, sauf option « Ne pas envoyer ».
 */
export function renderStravaLink(el: Element | null, loggedIn: boolean): void {
  if (!el) return;
  const fr = getLang() === 'fr';
  returned ??= takeReturnCode();
  const note = (t: string) => `<p class="meta" style="color:var(--ar-muted);font-size:13px;margin:6px 0 0">${t}</p>`;
  if (!loggedIn) {
    el.innerHTML = note(fr ? 'Connecte-toi avec Discord ou Google (en haut à droite) pour relier ton compte Strava.' : 'Sign in with Discord or Google (top right) to link your Strava account.');
    return;
  }
  el.innerHTML = note(fr ? 'Strava : vérification…' : 'Strava: checking…');
  void fetchStrava().then((st) => {
    if (!el.isConnected) return;
    const msg =
      returned === 'linked'
        ? fr ? 'Compte Strava relié.' : 'Strava account linked.'
        : returned === 'scope'
          ? fr ? 'Il faut autoriser l’envoi d’activités pour relier Strava.' : 'You must allow activity uploads to link Strava.'
          : returned === 'failed'
            ? fr ? 'La liaison avec Strava a échoué, réessaie.' : 'Linking with Strava failed, try again.'
            : '';
    const flash = msg ? `<p class="meta" style="color:#ffd23f;font-size:13px;margin:0 0 6px">${msg}</p>` : '';
    if (!st) {
      el.innerHTML = note(fr ? 'Serveur injoignable : impossible de lire l’état de Strava.' : 'Server unreachable: cannot read the Strava status.');
    } else if (!st.available) {
      el.innerHTML = flash + note(fr ? 'Strava n’est pas configuré sur le serveur (STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans apps/server/.env).' : 'Strava is not configured on the server (STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in apps/server/.env).');
    } else if (st.connected) {
      el.innerHTML = `${flash}<div class="row" style="align-items:center;gap:10px"><span class="mm-chip ok">Strava${st.athleteName ? ` · ${st.athleteName}` : ''}</span><button class="btn small" id="strava-unlink">${fr ? 'Délier' : 'Unlink'}</button></div>`;
      el.querySelector('#strava-unlink')?.addEventListener('click', async () => {
        await fetch(`${apiBase()}/integrations/strava`, { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
        returned = null;
        renderStravaLink(el, true);
      });
    } else {
      el.innerHTML = `${flash}<div class="row" style="align-items:center;gap:10px"><button class="btn small primary" id="strava-link">${fr ? 'Relier mon compte Strava' : 'Link my Strava account'}</button></div>${note(fr ? 'Tes sorties enregistrées partiront sur Strava (sauf « Ne pas envoyer »).' : 'Your saved rides will be sent to Strava (unless “Don’t upload”).')}`;
      el.querySelector('#strava-link')?.addEventListener('click', () => {
        location.href = `${apiBase()}/integrations/strava/start?redirect=${encodeURIComponent(location.pathname)}`;
      });
    }
    returned = null;
  });
}
