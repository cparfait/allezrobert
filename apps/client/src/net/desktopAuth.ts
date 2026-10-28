/**
 * Connexion de l'application Windows. Les cookies de session ne suivent pas (la page vit sur
 * tauri.localhost) : la connexion se fait dans le navigateur du PC, puis l'application récupère la
 * session auprès du serveur avec un nonce qu'elle est seule à connaître, la garde ici et l'envoie
 * en `Authorization: Bearer` sur chaque requête vers l'API. Sans effet dans un navigateur.
 */
export const inDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const KEY = 'ar.desktopSession';

export function desktopSession(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setDesktopSession(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Racine de l'API : celle du serveur configuré à la construction (VITE_SERVER_URL). */
function apiRoot(): string | null {
  const url = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SERVER_URL;
  return url ? `${url.replace(/\/colyseus$/, '')}/api` : null;
}

if (inDesktopApp) {
  const native = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const token = desktopSession();
    const root = apiRoot();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!token || !root || !url.startsWith(`${root}/`)) return native(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return native(input, { ...init, headers });
  };
}

/** Ouvre une adresse https dans le navigateur du PC (commande Rust `open_external`). */
async function openExternal(url: string): Promise<void> {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
  await internals.invoke('open_external', { url });
}

function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface DesktopLogin {
  /** Chemin (relatif au serveur) vers lequel le navigateur est renvoyé une fois connecté. */
  redirect: string;
  /** Ouvre la page de connexion dans le navigateur, avec le chemin de retour. */
  open: (redirect: string) => Promise<void>;
  /** Attend la session (jusqu'à 5 min) ; vrai si elle a été reçue. */
  wait: (signal: AbortSignal) => Promise<boolean>;
}

export function startDesktopLogin(apiBase: string): DesktopLogin {
  const nonce = newNonce();
  return {
    redirect: `/api/auth/desktop/finish?nonce=${nonce}`,
    open: (redirect) => openExternal(redirect.startsWith('http') ? redirect : `${apiBase}${redirect}`),
    async wait(signal) {
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const r = await fetch(`${apiBase}/auth/desktop/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce }), signal });
          if (r.status === 200) {
            setDesktopSession(((await r.json()) as { sessionToken: string }).sessionToken);
            return true;
          }
        } catch {
          /* réseau coupé : on réessaie */
        }
      }
      return false;
    },
  };
}
